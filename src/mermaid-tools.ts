import { copyFile, mkdtemp, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import DOMPurify from "dompurify"
import mermaid from "mermaid"
import { AppError } from "./errors.js"

// Mermaid's parser invokes the browser-oriented DOMPurify surface while normalizing labels.
// In Node the default export is a factory, so provide the two side-effect-free methods needed
// for parsing. Browser rendering still uses Mermaid's bundled DOMPurify implementation.
const nodePurify = DOMPurify as unknown as {
  addHook?: (...args: unknown[]) => void
  sanitize?: (value: unknown) => string
}
if (typeof nodePurify.addHook !== "function") nodePurify.addHook = () => undefined
if (typeof nodePurify.sanitize !== "function") {
  nodePurify.sanitize = value => String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

export const MERMAID_DIAGRAM_TYPES = [
  "flowchart",
  "sequence",
  "class",
  "state",
  "er",
  "journey",
  "gantt",
  "pie",
  "gitgraph",
  "mindmap",
  "timeline",
  "sankey",
  "xychart",
  "block",
  "packet"
] as const

export type MermaidDiagramType = (typeof MERMAID_DIAGRAM_TYPES)[number]
export type MermaidTheme = "default" | "dark" | "forest" | "neutral"

interface MermaidDoc {
  description: string
  keywords: string[]
  syntax: string
  tips: string[]
}

const MERMAID_DOCUMENTATION: Record<MermaidDiagramType, MermaidDoc> = {
  flowchart: {
    description: "Process flows, decisions, and dependency graphs.",
    keywords: ["flowchart", "graph", "TD", "LR", "-->", "-.->"],
    syntax: "flowchart TD\n    Start([Start]) --> Check{Valid?}\n    Check -->|Yes| Done([Done])\n    Check -->|No| Start",
    tips: ["Use TD, TB, LR, or RL for direction.", "Use [] for a process and {} for a decision."]
  },
  sequence: {
    description: "Time-ordered interactions between actors or systems.",
    keywords: ["sequenceDiagram", "participant", "actor", "->>", "-->>"],
    syntax: "sequenceDiagram\n    participant A as Client\n    participant B as SAP\n    A->>B: Request\n    B-->>A: Response",
    tips: ["Declare participants when aliases improve readability.", "Use activate/deactivate for lifetimes."]
  },
  class: {
    description: "Classes, members, and object-oriented relationships.",
    keywords: ["classDiagram", "class", "<|--", "*--", "o--"],
    syntax: "classDiagram\n    class Service {\n      +run()\n    }\n    Service <|-- SapService",
    tips: ["Use +, -, #, and ~ for visibility.", "Use <|-- for inheritance and --> for association."]
  },
  state: {
    description: "States and transitions in a state machine.",
    keywords: ["stateDiagram-v2", "state", "[*]", "-->"],
    syntax: "stateDiagram-v2\n    [*] --> Idle\n    Idle --> Running\n    Running --> [*]",
    tips: ["Use [*] for start and end states.", "Put a transition label after a colon."]
  },
  er: {
    description: "Entities, attributes, and database cardinalities.",
    keywords: ["erDiagram", "||--o{", "}o--||"],
    syntax: "erDiagram\n    CUSTOMER ||--o{ ORDER : places\n    CUSTOMER {\n      string id PK\n    }",
    tips: ["Use braces for attributes.", "State relationship cardinality on both ends."]
  },
  journey: {
    description: "User-journey stages and satisfaction scores.",
    keywords: ["journey", "title", "section"],
    syntax: "journey\n    title Purchase\n    section Browse\n      Search: 5: User\n      Select: 4: User",
    tips: ["Scores range from 1 to 5.", "Group related steps under sections."]
  },
  gantt: {
    description: "Project schedules, durations, and dependencies.",
    keywords: ["gantt", "dateFormat", "section", ":done", ":active"],
    syntax: "gantt\n    title Delivery\n    dateFormat YYYY-MM-DD\n    section Build\n    Implement :a1, 2026-07-13, 5d",
    tips: ["Declare dateFormat explicitly.", "Use after taskId for dependencies."]
  },
  pie: {
    description: "Proportional values as pie slices.",
    keywords: ["pie", "title", "showData"],
    syntax: "pie title Findings\n    \"Passed\" : 92\n    \"Failed\" : 8",
    tips: ["Quote labels.", "Values must be numeric."]
  },
  gitgraph: {
    description: "Git commits, branches, checkouts, and merges.",
    keywords: ["gitGraph", "commit", "branch", "checkout", "merge"],
    syntax: "gitGraph\n    commit\n    branch feature\n    checkout feature\n    commit\n    checkout main\n    merge feature",
    tips: ["Create a branch before checking it out.", "Use quoted commit messages when needed."]
  },
  mindmap: {
    description: "Hierarchical topics arranged as a mind map.",
    keywords: ["mindmap", "root"],
    syntax: "mindmap\n  root((SAP))\n    ABAP\n      ADT\n      ATC\n    Operations",
    tips: ["Indentation defines hierarchy.", "Keep node labels concise."]
  },
  timeline: {
    description: "Events grouped along a chronological timeline.",
    keywords: ["timeline", "title", "section"],
    syntax: "timeline\n    title Releases\n    2025 : Preview\n    2026 : General availability",
    tips: ["Put the time period before a colon.", "Use sections to group parallel histories."]
  },
  sankey: {
    description: "Weighted flows between sources and destinations.",
    keywords: ["sankey-beta"],
    syntax: "sankey-beta\nSource,Processed,80\nSource,Rejected,20\nProcessed,Delivered,80",
    tips: ["Each row is source,target,value.", "Quote CSV fields that contain commas."]
  },
  xychart: {
    description: "XY bar and line charts.",
    keywords: ["xychart-beta", "x-axis", "y-axis", "bar", "line"],
    syntax: "xychart-beta\n    title \"Runtime\"\n    x-axis [A, B, C]\n    y-axis \"ms\" 0 --> 100\n    bar [25, 60, 40]",
    tips: ["Keep series lengths aligned with x-axis values.", "Declare a y-axis range for predictable scaling."]
  },
  block: {
    description: "Block-layout diagrams with explicit columns and connections.",
    keywords: ["block-beta", "columns", "space"],
    syntax: "block-beta\n    columns 3\n    A[Client] space B[SAP]\n    A --> B",
    tips: ["Use columns to control layout.", "Use space to reserve an empty cell."]
  },
  packet: {
    description: "Bit-field and network-packet layouts.",
    keywords: ["packet-beta", "start", "end", "bits"],
    syntax: "packet-beta\n    0-7: \"Header\"\n    8-15: \"Payload length\"",
    tips: ["Use inclusive bit ranges.", "Avoid overlapping ranges."]
  }
}

function normalizeType(rawType: string): MermaidDiagramType | "unknown" {
  const normalized = rawType.toLowerCase().replace(/[_-]/g, "")
  if (normalized.startsWith("flowchart") || normalized === "graph") return "flowchart"
  if (normalized.startsWith("sequence")) return "sequence"
  if (normalized.startsWith("class")) return "class"
  if (normalized.startsWith("state")) return "state"
  if (normalized.startsWith("er")) return "er"
  if (normalized.startsWith("journey")) return "journey"
  if (normalized.startsWith("gantt")) return "gantt"
  if (normalized.startsWith("pie")) return "pie"
  if (normalized.startsWith("gitgraph")) return "gitgraph"
  if (normalized.startsWith("mindmap")) return "mindmap"
  if (normalized.startsWith("timeline")) return "timeline"
  if (normalized.startsWith("sankey")) return "sankey"
  if (normalized.startsWith("xychart")) return "xychart"
  if (normalized.startsWith("block")) return "block"
  if (normalized.startsWith("packet")) return "packet"
  return "unknown"
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export async function validateMermaidSyntax(code: string, suppressErrors = true) {
  try {
    const parsed = await mermaid.parse(code, { suppressErrors: false })
    if (!parsed) throw new Error("Mermaid parser did not return a result")
    return {
      isValid: true,
      diagramType: normalizeType(parsed.diagramType),
      rawDiagramType: parsed.diagramType,
      codeLength: code.length
    }
  } catch (error) {
    if (!suppressErrors) {
      throw new AppError("MERMAID_SYNTAX_INVALID", errorMessage(error))
    }
    return {
      isValid: false,
      diagramType: "unknown" as const,
      error: errorMessage(error),
      codeLength: code.length
    }
  }
}

export async function detectMermaidDiagramType(code: string) {
  const parsed = await validateMermaidSyntax(code, false)
  return {
    detectedType: parsed.diagramType,
    rawDiagramType: parsed.rawDiagramType,
    confidence: parsed.diagramType === "unknown" ? 0.1 : 1,
    codeLength: code.length
  }
}

export function getMermaidDocumentation(
  diagramType: MermaidDiagramType | "all" = "all",
  includeExamples = true
) {
  const entries: Array<[string, MermaidDoc]> = diagramType === "all"
    ? Object.entries(MERMAID_DOCUMENTATION)
    : [[diagramType, MERMAID_DOCUMENTATION[diagramType]]]
  return {
    diagramType,
    supportedTypes: MERMAID_DIAGRAM_TYPES,
    documentation: Object.fromEntries(
      entries.map(([type, info]) => [
        type,
        {
          description: info.description,
          keywords: info.keywords,
          tips: info.tips,
          ...(includeExamples ? { syntax: info.syntax } : {})
        }
      ])
    )
  }
}

export async function createMermaidDiagram(
  code: string,
  requestedType: MermaidDiagramType | "auto" = "auto",
  theme: MermaidTheme = "forest"
) {
  const detection = await detectMermaidDiagramType(code)
  if (requestedType !== "auto" && detection.detectedType !== requestedType) {
    throw new AppError(
      "MERMAID_TYPE_MISMATCH",
      `Requested ${requestedType}, but Mermaid parsed the diagram as ${detection.detectedType}`
    )
  }

  const outputDirectory = await mkdtemp(join(tmpdir(), "sap-abap-mcp-mermaid-"))
  const assetPath = join(outputDirectory, "mermaid.min.js")
  const htmlPath = join(outputDirectory, "diagram.html")
  const require = createRequire(import.meta.url)
  await copyFile(require.resolve("mermaid/dist/mermaid.min.js"), assetPath)
  const encodedCode = Buffer.from(code, "utf8").toString("base64")
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src 'self' data:">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Mermaid diagram</title>
  <style>
    :root { color-scheme: light dark; }
    body { margin: 0; font: 14px system-ui, sans-serif; background: Canvas; color: CanvasText; }
    header { position: sticky; top: 0; z-index: 1; display: flex; gap: 8px; padding: 10px; background: Canvas; border-bottom: 1px solid GrayText; }
    button { padding: 6px 10px; }
    #viewport { overflow: auto; padding: 24px; min-height: calc(100vh - 70px); }
    #diagram { transform-origin: top left; width: max-content; }
    #error { color: #b91c1c; white-space: pre-wrap; }
  </style>
</head>
<body>
  <header>
    <button id="zoomOut" type="button">−</button>
    <button id="reset" type="button">100%</button>
    <button id="zoomIn" type="button">+</button>
    <button id="download" type="button">Download SVG</button>
  </header>
  <main id="viewport"><div id="diagram"></div><pre id="error" hidden></pre></main>
  <script src="./mermaid.min.js"></script>
  <script>
    const source = new TextDecoder().decode(Uint8Array.from(atob("${encodedCode}"), c => c.charCodeAt(0)));
    const diagram = document.getElementById("diagram");
    const error = document.getElementById("error");
    let zoom = 1;
    const applyZoom = () => { diagram.style.transform = \`scale(\${zoom})\`; document.getElementById("reset").textContent = Math.round(zoom * 100) + "%"; };
    document.getElementById("zoomOut").onclick = () => { zoom = Math.max(0.1, zoom - 0.1); applyZoom(); };
    document.getElementById("zoomIn").onclick = () => { zoom = Math.min(5, zoom + 0.1); applyZoom(); };
    document.getElementById("reset").onclick = () => { zoom = 1; applyZoom(); };
    document.getElementById("download").onclick = () => {
      const svg = diagram.querySelector("svg");
      if (!svg) return;
      const link = document.createElement("a");
      link.href = URL.createObjectURL(new Blob([svg.outerHTML], { type: "image/svg+xml" }));
      link.download = "diagram.svg";
      link.click();
      URL.revokeObjectURL(link.href);
    };
    mermaid.initialize({ startOnLoad: false, theme: "${theme}", securityLevel: "strict" });
    mermaid.render("sap-abap-mcp-diagram", source).then(({ svg, bindFunctions }) => {
      diagram.innerHTML = svg;
      bindFunctions?.(diagram);
    }).catch(value => { error.hidden = false; error.textContent = String(value); });
  </script>
</body>
</html>`
  await writeFile(htmlPath, html, "utf8")
  return {
    mode: "headless_interactive_html",
    diagramType: detection.detectedType,
    rawDiagramType: detection.rawDiagramType,
    theme,
    htmlPath,
    assetPath,
    message: "Open htmlPath in a browser to view, zoom, and export the rendered SVG."
  }
}

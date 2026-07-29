import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { spawnSync } from "node:child_process"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const output = process.argv[2] ?? join(root, "assets", "demo.gif")
const stage = await mkdtemp(join(tmpdir(), "sap-abap-mcp-demo-"))

const frames = [
  {
    step: "SAP ABAP MCP 1.0",
    accent: "HEADLESS · CLIENT-NEUTRAL · LOCAL",
    lines: [
      ["prompt", "$ npx @coaspe/sap-abap-mcp@latest setup"],
      ["muted", "Connect an AI coding agent to SAP through ADT."],
      ["success", "No IDE runtime. No publisher-operated proxy."]
    ]
  },
  {
    step: "1 / 4  VERIFY THE SAP PROFILE",
    accent: "LOCAL SETUP",
    lines: [
      ["prompt", "$ npx @coaspe/sap-abap-mcp@latest setup"],
      ["plain", "Server name   DEV100"],
      ["plain", "SAP URL       https://sap.example.invalid"],
      ["success", "✓ DEV100 verified through SAP ADT"],
      ["success", "✓ secret protected by the operating system"]
    ]
  },
  {
    step: "2 / 4  INSPECT THE REPOSITORY",
    accent: "READ · RESOLVE · EXPLAIN",
    lines: [
      ["prompt", "> Find ZCL_MCP_DEMO and explain its dependencies."],
      ["success", "✓ sap.repository.search       1 class"],
      ["success", "✓ sap.source.read             86 lines"],
      ["plain", "  ZCL_MCP_DEMO → ZIF_MCP_DEMO → ZCL_MCP_STORE"]
    ]
  },
  {
    step: "3 / 4  RUN QUALITY GATES",
    accent: "ABAP UNIT · ATC",
    lines: [
      ["prompt", "> Run ABAP Unit and ATC. Do not change the object."],
      ["success", "✓ sap.quality.unit_test       4 passed · 0 failed"],
      ["success", "✓ sap.quality.atc.run         0 findings"],
      ["muted", "Read-only checks completed on DEV100."]
    ]
  },
  {
    step: "4 / 4  ASSESS THE TRANSPORT",
    accent: "EVIDENCE WITHOUT RELEASE",
    lines: [
      ["prompt", "> Assess DEVK900123. Do not release it."],
      ["success", "✓ sap.transport.assess        gate: passed"],
      ["plain", "  evidence                     JSON · SARIF · JUnit"],
      ["success", "✓ released                     false"]
    ]
  },
  {
    step: "READY FOR AN AGENTIC ABAP WORKFLOW",
    accent: "115 V1 TOOLS · 7 RESOURCES",
    lines: [
      ["success", "✓ Multiple SAP profiles"],
      ["success", "✓ Production profiles are read-only"],
      ["success", "✓ Package restrictions and confirmations"],
      ["success", "✓ Explicit live-SAP evidence boundary"],
      ["prompt", "github.com/Coaspe/sap-abap-mcp"]
    ]
  }
]

function escapeXml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
}

function renderFrame(frame) {
  const colors = {
    prompt: "#7DD3FC",
    plain: "#E5E7EB",
    success: "#6EE7B7",
    muted: "#94A3B8"
  }
  const lines = frame.lines.map(([kind, value], index) => (
    `<text x="106" y="${285 + index * 58}" fill="${colors[kind]}" ` +
    `font-size="25" font-family="SFMono-Regular,Consolas,monospace">${escapeXml(value)}</text>`
  )).join("\n")

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 1200 675">
  <defs>
    <linearGradient id="background" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#071426"/>
      <stop offset="1" stop-color="#132238"/>
    </linearGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="18" stdDeviation="24" flood-color="#020617" flood-opacity="0.55"/>
    </filter>
  </defs>
  <rect width="1200" height="675" fill="url(#background)"/>
  <circle cx="1110" cy="70" r="180" fill="#0A6ED1" opacity="0.12"/>
  <circle cx="95" cy="640" r="220" fill="#14B8A6" opacity="0.08"/>
  <rect x="58" y="54" width="1084" height="567" rx="24" fill="#0B1220" stroke="#334155" filter="url(#shadow)"/>
  <rect x="58" y="54" width="1084" height="72" rx="24" fill="#111C2E"/>
  <rect x="58" y="102" width="1084" height="24" fill="#111C2E"/>
  <circle cx="95" cy="90" r="8" fill="#FB7185"/>
  <circle cx="123" cy="90" r="8" fill="#FBBF24"/>
  <circle cx="151" cy="90" r="8" fill="#34D399"/>
  <text x="188" y="99" fill="#CBD5E1" font-size="22" font-family="SFMono-Regular,Consolas,monospace">sap-abap-mcp</text>
  <text x="92" y="184" fill="#F8FAFC" font-size="30" font-weight="700" font-family="Inter,Arial,sans-serif">${escapeXml(frame.step)}</text>
  <rect x="92" y="207" width="1016" height="2" fill="#0A6ED1"/>
  <text x="92" y="244" fill="#38BDF8" font-size="18" font-weight="700" letter-spacing="2" font-family="Inter,Arial,sans-serif">${escapeXml(frame.accent)}</text>
  ${lines}
  <text x="92" y="588" fill="#64748B" font-size="16" font-family="Inter,Arial,sans-serif">Synthetic demo · no live SAP data or credentials</text>
  <text x="1108" y="588" text-anchor="end" fill="#64748B" font-size="16" font-family="Inter,Arial,sans-serif">MIT</text>
</svg>`
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" })
  if (result.status !== 0) {
    throw new Error(
      result.stderr.trim() ||
      result.stdout.trim() ||
      `${command} exited with status ${result.status}`
    )
  }
}

function chromeExecutable() {
  if (process.env.CHROME) return process.env.CHROME
  if (process.platform === "darwin") {
    return "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  }
  return "google-chrome"
}

try {
  for (const [index, frame] of frames.entries()) {
    const sequence = String(index).padStart(2, "0")
    const svgPath = join(stage, `frame-${sequence}.svg`)
    const pngPath = join(stage, `frame-${sequence}.png`)
    await writeFile(svgPath, renderFrame(frame))
    run(chromeExecutable(), [
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      "--force-device-scale-factor=1",
      "--window-size=1200,675",
      `--screenshot=${pngPath}`,
      pathToFileURL(svgPath).href
    ])
  }

  run(
    process.env.FFMPEG ?? "ffmpeg",
    [
      "-hide_banner",
      "-loglevel", "error",
      "-framerate", "1/4",
      "-i", join(stage, "frame-%02d.png"),
      "-vf", "fps=12,split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer",
      "-loop", "0",
      "-y",
      output
    ]
  )
  console.log(`Rendered ${frames.length} synthetic demo frames to ${output}`)
} finally {
  await rm(stage, { recursive: true, force: true })
}

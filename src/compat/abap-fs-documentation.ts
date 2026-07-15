import { AppError } from "../errors.js"
import {
  ABAP_FS_BASELINE,
  ABAP_FS_MCP_TOOL_NAMES,
  ABAP_FS_UPSTREAM_MCP_TOOL_NAMES,
  IMPLEMENTED_TOOL_NAMES
} from "./abap-fs-tools.js"

export type DocumentationAction =
  | "get_documentation"
  | "search_documentation"
  | "get_settings"
  | "search_settings"

const TOOL_GROUPS = {
  "Connection and discovery": [
    "get_connected_systems", "get_sap_system_info", "get_sap_capabilities", "adt_discovery_export"
  ],
  "Repository read and navigation": [
    "search_abap_objects", "get_abap_object_lines", "search_abap_object_lines",
    "get_abap_object_info", "get_batch_lines", "get_object_by_uri", "find_where_used",
    "get_abap_object_url", "get_abap_object_workspace_uri", "open_object", "inspect_abap_code",
    "get_abap_dependency_graph", "compare_abap_systems"
  ],
  "Repository write and activation": [
    "create_object_programmatically", "replace_string_in_abap_object", "get_abap_diagnostics",
    "abap_activate", "manage_text_elements", "create_test_include", "refactor_abap_code",
    "manage_abapgit", "manage_rap_generator", "manage_abap_versions"
  ],
  "Quality and lifecycle": [
    "run_atc_analysis", "get_atc_decorations", "run_unit_tests", "get_version_history",
    "manage_transport_requests", "abap_download"
  ],
  "Data and reference": ["execute_data_query", "get_abap_sql_syntax", "abap_fs_documentation"],
  "Runtime operations": [
    "run_abap_application", "run_sap_transaction", "abap_debug_session", "abap_debug_breakpoint",
    "abap_debug_step", "abap_debug_variable", "abap_debug_stack", "abap_debug_status",
    "analyze_abap_dumps", "analyze_abap_traces", "manage_heartbeat"
  ],
  "Artifacts": [
    "create_mermaid_diagram", "validate_mermaid_syntax", "get_mermaid_documentation",
    "detect_mermaid_diagram_type", "create_test_documentation"
  ]
} as const

const DOCUMENTATION = [
  "# sap-abap-mcp ABAP FS compatibility reference",
  "",
  `Baseline: ABAP FS ${ABAP_FS_BASELINE.version}, commit ${ABAP_FS_BASELINE.commit}`,
  `Official upstream: ${ABAP_FS_BASELINE.repository}`,
  `Pinned upstream MCP tools: ${ABAP_FS_UPSTREAM_MCP_TOOL_NAMES.length}`,
  `Strict-compatible local tools: ${ABAP_FS_MCP_TOOL_NAMES.length}`,
  "Omitted upstream tool: manage_subagents (requires the VS Code agent host)",
  `Total locally advertised tools: ${IMPLEMENTED_TOOL_NAMES.length}`,
  "SAP-dependent parity features are implemented but remain live-unverified until a selected connection succeeds.",
  "ABAP REPL requires ZCL_ABAP_REPL and SICF /sap/bc/z_abap_repl.",
  "Generic report/program-console execution is not implemented.",
  "",
  "This server exposes the strict-compatible ABAP FS language-model tool surface without requiring VS Code.",
  "SAP work runs through authenticated ADT connections. UI-only actions return a headless artifact or URI.",
  "",
  "## Safety model",
  "",
  "- Production profiles reject repository writes.",
  "- A non-empty allowedPackages list restricts writes to those packages; an empty list allows all packages.",
  "- Non-$TMP writes require a transport request.",
  "- Source replacement requires exactly one current-source match, then locks, re-reads, writes, checks syntax, and optionally activates.",
  "- Data queries accept read-only SELECT/WITH statements only.",
  "",
  "## Headless adaptations",
  "",
  "- open_object returns an ADT workspace URI and metadata instead of opening an editor.",
  "- create_mermaid_diagram writes an interactive local HTML viewer instead of a VS Code webview.",
  "- execute_data_query returns bounded JSON or writes CSV/XLSX instead of opening a grid.",
  "- create_test_documentation writes a DOCX file to a temporary output directory.",
  "- adt_discovery_export returns discovery JSON through MCP.",
  "",
  "## Tool groups",
  "",
  ...Object.entries(TOOL_GROUPS).flatMap(([group, tools]) => [
    `### ${group}`,
    "",
    ...tools.map(tool => `- ${tool}`),
    ""
  ]),
  "## Recommended workflow",
  "",
  "1. Call get_connected_systems when connectionId is unknown.",
  "2. Search and read the current object before editing.",
  "3. Run diagnostics and ATC before activation.",
  "4. Run unit tests and inspect the transport before handing off.",
  ""
].join("\n")

const SETTINGS = [
  "# sap-abap-mcp settings reference",
  "",
  "Settings are profile fields managed by the sap-abap-mcp CLI, not VS Code settings.",
  "",
  "## Profile fields",
  "",
  "- id: uppercase profile/connection identifier such as DEV100.",
  "- url: SAP HTTPS base URL.",
  "- client: three-digit SAP client.",
  "- language: two-letter SAP logon language; default EN.",
  "- environment: development, quality, or production. Production disables repository writes.",
  "- authType: basic.",
  "- username: SAP user name.",
  "- allowedPackages: optional uppercase write allowlist. Empty means all packages are allowed.",
  "",
  "## Storage",
  "",
  "- SAP_ABAP_MCP_HOME overrides the configuration directory.",
  "- Windows default: %APPDATA%\\sap-abap-mcp.",
  "- macOS/Linux default: $XDG_CONFIG_HOME/sap-abap-mcp or ~/.config/sap-abap-mcp.",
  "- Profile metadata is stored in profiles.json with user-only permissions.",
  "- Passwords are stored separately in macOS Keychain or Windows DPAPI-encrypted files.",
  "",
  "## CLI",
  "",
  "setup",
  "setup edit [<server-name>]",
  "setup remove [<server-name>]",
  "profile add <id> --url <url> --client <nnn> [--language EN] [--environment development|quality|production] [--username <user>] [--packages ZPKG1,ZPKG2] [--login [--password-stdin]]",
  "profile list",
  "profile remove <id>",
  "auth login <id> [--username <user>] [--password-stdin]",
  "auth status <id>",
  "auth logout <id>",
  "doctor <id> [--include-components]",
  "serve [--profile <id>]",
  ""
].join("\n")

function getLines(content: string, startLine: number, lineCount: number) {
  const lines = content.split("\n")
  const startIndex = Math.min(lines.length, Math.max(0, startLine - 1))
  const selected = lines.slice(startIndex, startIndex + lineCount)
  return {
    startLine: startIndex + 1,
    endLine: startIndex + selected.length,
    totalLines: lines.length,
    content: selected.join("\n")
  }
}

function searchLines(content: string, query: string, contextLines: number) {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) {
    throw new AppError("DOCUMENTATION_QUERY_REQUIRED", "searchQuery cannot be blank")
  }
  const lines = content.split("\n")
  const matches = lines.flatMap((line, index) => {
    const matchedTerms = terms.filter(term => line.toLowerCase().includes(term))
    if (matchedTerms.length === 0) return []
    const startIndex = Math.max(0, index - contextLines)
    const endIndex = Math.min(lines.length, index + contextLines + 1)
    return [{
      lineNumber: index + 1,
      line,
      matchedTerms,
      contextStartLine: startIndex + 1,
      context: lines.slice(startIndex, endIndex).join("\n")
    }]
  })
  return { query, terms, matchCount: matches.length, matches }
}

export function readAbapFsDocumentation(input: {
  action: DocumentationAction
  searchQuery?: string
  startLine: number
  lineCount: number
}) {
  const settings = input.action.endsWith("settings")
  const content = settings ? SETTINGS : DOCUMENTATION
  const source = settings ? "bundled-settings-reference" : "bundled-compatibility-reference"
  if (input.action.startsWith("search_")) {
    if (!input.searchQuery) {
      throw new AppError(
        "DOCUMENTATION_QUERY_REQUIRED",
        `searchQuery is required for ${input.action}`
      )
    }
    return { source, action: input.action, ...searchLines(content, input.searchQuery, input.lineCount) }
  }
  return { source, action: input.action, ...getLines(content, input.startLine, input.lineCount) }
}

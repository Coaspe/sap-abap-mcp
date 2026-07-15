import { DEFERRED_RESULT_TOOL_NAME } from "../deferred-results.js"

export const ABAP_FS_BASELINE = {
  repository: "https://github.com/marcellourbani/vscode_abap_remote_fs",
  version: "2.6.5",
  commit: "3041418d35558e043993a4d7f9fa6b727fcf9cf1"
} as const

export const ABAP_FS_MCP_TOOL_NAMES = [
  "search_abap_objects",
  "get_abap_object_lines",
  "search_abap_object_lines",
  "get_abap_object_info",
  "get_batch_lines",
  "get_object_by_uri",
  "create_object_programmatically",
  "get_abap_object_url",
  "get_abap_object_workspace_uri",
  "create_mermaid_diagram",
  "validate_mermaid_syntax",
  "get_mermaid_documentation",
  "detect_mermaid_diagram_type",
  "create_test_documentation",
  "execute_data_query",
  "get_abap_sql_syntax",
  "run_atc_analysis",
  "get_atc_decorations",
  "manage_text_elements",
  "open_object",
  "abap_download",
  "run_unit_tests",
  "create_test_include",
  "manage_transport_requests",
  "abap_debug_session",
  "abap_debug_breakpoint",
  "abap_debug_step",
  "abap_debug_variable",
  "abap_debug_stack",
  "abap_debug_status",
  "analyze_abap_dumps",
  "analyze_abap_traces",
  "find_where_used",
  "get_sap_system_info",
  "get_connected_systems",
  "get_version_history",
  "abap_fs_documentation",
  "manage_heartbeat",
  "adt_discovery_export",
  "abap_activate",
  "replace_string_in_abap_object",
  "get_abap_diagnostics"
] as const

export const ABAP_FS_UPSTREAM_MCP_TOOL_NAMES = [
  ...ABAP_FS_MCP_TOOL_NAMES,
  "manage_subagents"
] as const

export const EXTENDED_TOOL_NAMES = [
  DEFERRED_RESULT_TOOL_NAME,
  "inspect_abap_code",
  "refactor_abap_code",
  "manage_abapgit",
  "manage_rap_generator",
  "manage_abap_versions",
  "compare_abap_systems",
  "get_abap_dependency_graph",
  "run_sap_transaction",
  "get_sap_capabilities",
  "run_abap_application"
] as const

export const IMPLEMENTED_TOOL_NAMES = [
  ...ABAP_FS_MCP_TOOL_NAMES,
  ...EXTENDED_TOOL_NAMES
] as const

export const TOOLSET_NAMES = [
  "core",
  "write",
  "analysis",
  "debug",
  "operations",
  "artifacts",
  "all"
] as const

export type ToolsetName = typeof TOOLSET_NAMES[number]

export const ABAP_MCP_TOOLSETS: Record<
  Exclude<ToolsetName, "all">,
  readonly typeof IMPLEMENTED_TOOL_NAMES[number][]
> = {
  core: [
    DEFERRED_RESULT_TOOL_NAME,
    "get_connected_systems",
    "get_sap_system_info",
    "search_abap_objects",
    "get_abap_object_lines",
    "search_abap_object_lines",
    "get_abap_object_info",
    "get_batch_lines",
    "get_object_by_uri",
    "find_where_used",
    "get_abap_object_url",
    "get_abap_object_workspace_uri",
    "open_object",
    "abap_fs_documentation",
    "get_abap_sql_syntax",
    "get_abap_diagnostics",
    "inspect_abap_code",
    "get_sap_capabilities"
  ],
  write: [
    DEFERRED_RESULT_TOOL_NAME,
    "create_object_programmatically",
    "manage_text_elements",
    "create_test_include",
    "abap_activate",
    "replace_string_in_abap_object",
    "refactor_abap_code",
    "manage_abapgit",
    "manage_rap_generator",
    "manage_abap_versions",
    "run_abap_application"
  ],
  analysis: [
    DEFERRED_RESULT_TOOL_NAME,
    "execute_data_query",
    "run_atc_analysis",
    "get_atc_decorations",
    "run_unit_tests",
    "manage_transport_requests",
    "get_version_history",
    "compare_abap_systems",
    "get_abap_dependency_graph"
  ],
  debug: [
    DEFERRED_RESULT_TOOL_NAME,
    "abap_debug_session",
    "abap_debug_breakpoint",
    "abap_debug_step",
    "abap_debug_variable",
    "abap_debug_stack",
    "abap_debug_status"
  ],
  operations: [
    DEFERRED_RESULT_TOOL_NAME,
    "analyze_abap_dumps",
    "analyze_abap_traces",
    "manage_heartbeat",
    "adt_discovery_export",
    "run_sap_transaction"
  ],
  artifacts: [
    DEFERRED_RESULT_TOOL_NAME,
    "create_mermaid_diagram",
    "validate_mermaid_syntax",
    "get_mermaid_documentation",
    "detect_mermaid_diagram_type",
    "create_test_documentation",
    "abap_download"
  ]
}

export function toolsForToolsets(toolsets: readonly ToolsetName[]): ReadonlySet<string> {
  if (toolsets.includes("all")) return new Set(IMPLEMENTED_TOOL_NAMES)
  const selected = toolsets.filter(
    (toolset): toolset is Exclude<ToolsetName, "all"> => toolset !== "all"
  )
  return new Set(selected.flatMap(toolset => ABAP_MCP_TOOLSETS[toolset]))
}

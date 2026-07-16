import assert from "node:assert/strict"
import test from "node:test"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { IMPLEMENTED_TOOL_NAMES } from "../src/compat/abap-fs-tools.js"
import { createMcpServer } from "../src/mcp-server.js"
import { AbapToolService } from "../src/tool-service.js"

type AuditPolicy = "bounded" | "compact" | "paged" | "primary" | "explicit-detail"

const RESPONSE_AUDIT: Record<
  string,
  { variants: readonly string[]; policy: AuditPolicy }
> = {
  read_deferred_result: { variants: ["read"], policy: "bounded" },
  get_connected_systems: { variants: ["list"], policy: "compact" },
  get_sap_system_info: { variants: ["summary", "includeComponents"], policy: "explicit-detail" },
  get_sap_capabilities: { variants: ["summary", "includeEvidence"], policy: "explicit-detail" },
  search_abap_objects: { variants: ["search"], policy: "paged" },
  get_abap_object_lines: { variants: ["source", "method"], policy: "paged" },
  search_abap_object_lines: { variants: ["literal", "regexp"], policy: "paged" },
  get_abap_object_info: { variants: ["summary", "includeStructure"], policy: "explicit-detail" },
  get_batch_lines: { variants: ["batch"], policy: "bounded" },
  get_object_by_uri: { variants: ["source"], policy: "paged" },
  get_abap_object_url: { variants: ["url"], policy: "compact" },
  get_abap_object_workspace_uri: { variants: ["workspaceUri"], policy: "compact" },
  open_object: { variants: ["headless"], policy: "compact" },
  find_where_used: { variants: ["references", "includeSnippets"], policy: "paged" },
  get_abap_dependency_graph: { variants: ["graph"], policy: "bounded" },
  compare_abap_systems: { variants: ["diff"], policy: "bounded" },
  create_object_programmatically: { variants: ["create", "createWithSource"], policy: "primary" },
  replace_string_in_abap_object: { variants: ["replace"], policy: "bounded" },
  get_abap_diagnostics: { variants: ["diagnostics"], policy: "paged" },
  abap_activate: { variants: ["single", "batch"], policy: "bounded" },
  inspect_abap_code: {
    variants: ["completion", "definition", "quick_fixes", "format_preview", "completion_element", "documentation", "type_hierarchy", "components"],
    policy: "paged"
  },
  refactor_abap_code: {
    variants: ["preview_rename", "preview_change_package", "preview_extract_method", "preview_quick_fix", "preview_format", "preview_delete", "execute"],
    policy: "bounded"
  },
  manage_text_elements: { variants: ["read", "create", "update"], policy: "primary" },
  run_unit_tests: { variants: ["summary", "failures", "all"], policy: "explicit-detail" },
  create_test_include: { variants: ["create", "alreadyExists"], policy: "compact" },
  manage_transport_requests: {
    variants: ["get_user_transports", "get_transport_details", "get_transport_objects", "compare_transports", "create_transport", "release_transport", "delete_transport", "set_owner", "add_user", "add_object", "list_system_users", "resolve_object"],
    policy: "paged"
  },
  manage_abapgit: {
    variants: ["list_repositories", "remote_info", "create_repository", "pull_repository", "unlink_repository", "stage_repository", "push_repository", "check_repository", "switch_branch"],
    policy: "paged"
  },
  manage_rap_generator: {
    variants: ["availability", "get_schema", "get_defaults", "validate", "preview", "generate", "publish", "unpublish", "service_details"],
    policy: "bounded"
  },
  manage_abap_versions: { variants: ["list_inactive", "get_inactive_source", "preview_restore", "execute_restore"], policy: "paged" },
  get_version_history: { variants: ["list_versions", "get_version_source", "compare_versions"], policy: "paged" },
  run_atc_analysis: { variants: ["run_analysis", "get_documentation"], policy: "paged" },
  get_atc_decorations: { variants: ["file", "allFiles"], policy: "paged" },
  analyze_abap_dumps: { variants: ["list_dumps", "analyze_dump"], policy: "paged" },
  analyze_abap_traces: { variants: ["list_runs", "list_configurations", "analyze_run", "get_statements", "get_hitlist"], policy: "paged" },
  abap_debug_session: { variants: ["start", "stop", "status"], policy: "compact" },
  abap_debug_breakpoint: { variants: ["set", "remove"], policy: "bounded" },
  abap_debug_step: { variants: ["continue", "stepInto", "stepOver", "stepReturn", "jumpToLine"], policy: "bounded" },
  abap_debug_variable: { variants: ["variables"], policy: "paged" },
  abap_debug_stack: { variants: ["stack"], policy: "primary" },
  abap_debug_status: { variants: ["status"], policy: "compact" },
  execute_data_query: { variants: ["internal", "ui", "download_to_file"], policy: "paged" },
  get_abap_sql_syntax: { variants: ["syntax"], policy: "bounded" },
  abap_download: { variants: ["summary", "includeFileList"], policy: "explicit-detail" },
  manage_heartbeat: {
    variants: ["status", "start", "stop", "trigger", "history", "add_task", "remove_task", "update_task", "enable_task", "disable_task", "list_tasks", "get_watchlist"],
    policy: "paged"
  },
  adt_discovery_export: { variants: ["summary", "full", "file"], policy: "explicit-detail" },
  run_sap_transaction: { variants: ["url", "launch"], policy: "compact" },
  run_abap_application: { variants: ["repl_health", "preview_class", "preview_snippet", "executeClass", "executeSnippet"], policy: "bounded" },
  abap_fs_documentation: { variants: ["get_documentation", "search_documentation", "get_settings", "search_settings"], policy: "paged" },
  create_mermaid_diagram: { variants: ["artifact"], policy: "bounded" },
  validate_mermaid_syntax: { variants: ["validation"], policy: "compact" },
  get_mermaid_documentation: { variants: ["documentation"], policy: "bounded" },
  detect_mermaid_diagram_type: { variants: ["detection"], policy: "compact" },
  create_test_documentation: { variants: ["artifact"], policy: "bounded" }
}

const ACTION_AUDIT: Record<string, readonly string[]> = {
  abap_fs_documentation: ["get_documentation", "search_documentation", "get_settings", "search_settings"],
  run_atc_analysis: ["run_analysis", "get_documentation"],
  manage_text_elements: ["read", "create", "update"],
  manage_transport_requests: ["get_user_transports", "get_transport_details", "get_transport_objects", "compare_transports", "create_transport", "release_transport", "delete_transport", "set_owner", "add_user", "add_object", "list_system_users", "resolve_object"],
  get_version_history: ["list_versions", "get_version_source", "compare_versions"],
  abap_debug_session: ["start", "stop", "status"],
  abap_debug_breakpoint: ["set", "remove"],
  analyze_abap_dumps: ["list_dumps", "analyze_dump"],
  analyze_abap_traces: ["list_runs", "list_configurations", "analyze_run", "get_statements", "get_hitlist"],
  manage_heartbeat: ["status", "start", "stop", "trigger", "history", "add_task", "remove_task", "update_task", "enable_task", "disable_task", "list_tasks", "get_watchlist"],
  inspect_abap_code: ["completion", "definition", "quick_fixes", "format_preview", "completion_element", "documentation", "type_hierarchy", "components"],
  refactor_abap_code: ["preview_rename", "preview_change_package", "preview_extract_method", "preview_quick_fix", "preview_format", "preview_delete", "execute"],
  manage_abapgit: ["list_repositories", "remote_info", "create_repository", "pull_repository", "unlink_repository", "stage_repository", "push_repository", "check_repository", "switch_branch"],
  manage_rap_generator: ["availability", "get_schema", "get_defaults", "validate", "preview", "generate", "publish", "unpublish", "service_details"],
  manage_abap_versions: ["list_inactive", "get_inactive_source", "preview_restore", "execute_restore"],
  run_abap_application: ["repl_health", "preview_class", "preview_snippet", "execute"]
}

test("response audit catalog covers every advertised MCP tool", () => {
  assert.deepEqual(
    Object.keys(RESPONSE_AUDIT).sort(),
    [...IMPLEMENTED_TOOL_NAMES].sort()
  )
  assert.equal(Object.keys(RESPONSE_AUDIT).length, 53)
  assert.ok(Object.values(RESPONSE_AUDIT).every(item => item.variants.length > 0))
})

test("response audit covers every documented action branch", () => {
  const variantCount = Object.values(RESPONSE_AUDIT)
    .reduce((sum, item) => sum + item.variants.length, 0)

  assert.equal(variantCount, 149)
})

test("response audit action lists match the schemas advertised by MCP", async () => {
  const service = new AbapToolService({
    async listConnections() { return [] },
    async getClient() { throw new Error("not used while listing tools") }
  })
  const server = createMcpServer(service)
  const client = new Client({ name: "response-audit", version: "1.0.0" })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  await client.connect(clientTransport)

  try {
    const tools = (await client.listTools()).tools
    const advertised = Object.fromEntries(tools.flatMap(tool => {
      const action = tool.inputSchema.properties?.action as { enum?: string[] } | undefined
      return action?.enum ? [[tool.name, action.enum] as const] : []
    }))
    assert.deepEqual(Object.keys(advertised).sort(), Object.keys(ACTION_AUDIT).sort())
    for (const [tool, actions] of Object.entries(ACTION_AUDIT)) {
      assert.deepEqual([...advertised[tool]!].sort(), [...actions].sort(), tool)
    }
  } finally {
    await client.close()
    await server.close()
  }
})

import type { IMPLEMENTED_TOOL_NAMES } from "../../compat/abap-fs-tools.js"

export type V0ToolName = typeof IMPLEMENTED_TOOL_NAMES[number]
export type V1MigrationDisposition =
  | "first_slice"
  | "planned"
  | "extension"
  | "resource"
  | "v0_only"
  | "compatibility"

export interface V1MigrationEntry {
  targets: readonly string[]
  disposition: V1MigrationDisposition
}

export const V1_MIGRATION_CATALOG = {
  read_deferred_result: {
    targets: ["resource-links", "cursor-pages"], disposition: "compatibility"
  },
  get_connected_systems: {
    targets: ["sap.system.list"], disposition: "first_slice"
  },
  get_sap_system_info: {
    targets: ["sap.system.inspect"], disposition: "first_slice"
  },
  get_sap_capabilities: {
    targets: ["sap.system.capabilities", "sap-capability://{system}"],
    disposition: "first_slice"
  },
  search_abap_objects: {
    targets: ["sap.repository.search"], disposition: "first_slice"
  },
  get_abap_object_lines: {
    targets: ["sap.source.read", "adt://{system}/{+adtPath}"],
    disposition: "first_slice"
  },
  search_abap_object_lines: {
    targets: ["sap.source.search"], disposition: "planned"
  },
  get_abap_object_info: {
    targets: ["sap.repository.inspect"], disposition: "planned"
  },
  get_batch_lines: {
    targets: ["sap.source.read_batch"], disposition: "planned"
  },
  get_object_by_uri: {
    targets: ["sap.source.read"], disposition: "planned"
  },
  get_abap_object_url: {
    targets: ["sap.ui.object_url"], disposition: "extension"
  },
  get_abap_object_workspace_uri: {
    targets: ["sap.repository.resolve"], disposition: "planned"
  },
  open_object: {
    targets: ["sap.repository.resolve"], disposition: "planned"
  },
  find_where_used: {
    targets: ["sap.repository.where_used"], disposition: "planned"
  },
  get_abap_dependency_graph: {
    targets: ["sap.repository.dependency_graph"], disposition: "planned"
  },
  compare_abap_systems: {
    targets: ["sap.repository.compare"], disposition: "planned"
  },
  create_object_programmatically: {
    targets: ["sap.repository.create"], disposition: "planned"
  },
  replace_string_in_abap_object: {
    targets: ["sap.source.patch"], disposition: "planned"
  },
  get_abap_diagnostics: {
    targets: ["sap.source.diagnose"], disposition: "planned"
  },
  abap_activate: {
    targets: ["sap.source.activate"], disposition: "planned"
  },
  inspect_abap_code: {
    targets: [
      "sap.semantic.complete",
      "sap.semantic.definition",
      "sap.semantic.documentation",
      "sap.semantic.hierarchy",
      "sap.semantic.components",
      "sap.semantic.quick_fixes",
      "sap.semantic.format_preview"
    ],
    disposition: "planned"
  },
  refactor_abap_code: {
    targets: ["sap.refactor.preview", "sap.refactor.execute"],
    disposition: "planned"
  },
  manage_text_elements: {
    targets: ["sap.text_elements.read", "sap.text_elements.write"],
    disposition: "planned"
  },
  run_unit_tests: {
    targets: ["sap.quality.unit_test"], disposition: "planned"
  },
  create_test_include: {
    targets: ["sap.quality.test_include.create"], disposition: "planned"
  },
  manage_transport_requests: {
    targets: [
      "sap.transport.list",
      "sap.transport.inspect",
      "sap.transport.assess",
      "sap.transport.compare",
      "sap.transport.create",
      "sap.transport.release",
      "sap.transport.delete",
      "sap.transport.owner.set",
      "sap.transport.user.add",
      "sap.transport.object.add",
      "sap.transport.user.list",
      "sap.transport.object.resolve"
    ],
    disposition: "planned"
  },
  manage_abapgit: {
    targets: [
      "sap.git.list",
      "sap.git.inspect",
      "sap.git.create",
      "sap.git.pull",
      "sap.git.unlink",
      "sap.git.stage",
      "sap.git.push",
      "sap.git.check",
      "sap.git.branch.switch"
    ],
    disposition: "planned"
  },
  manage_rap_generator: {
    targets: [
      "sap.rap.availability",
      "sap.rap.schema",
      "sap.rap.defaults",
      "sap.rap.validate",
      "sap.rap.preview",
      "sap.rap.generate",
      "sap.rap.binding.inspect",
      "sap.rap.binding.publish",
      "sap.rap.binding.unpublish"
    ],
    disposition: "planned"
  },
  manage_abap_versions: {
    targets: [
      "sap.version.inactive.list",
      "sap.version.inactive.read",
      "sap.version.restore.preview",
      "sap.version.restore.execute"
    ],
    disposition: "planned"
  },
  get_version_history: {
    targets: [
      "sap.version.history.list",
      "sap.version.history.read",
      "sap.version.history.compare"
    ],
    disposition: "planned"
  },
  run_atc_analysis: {
    targets: ["sap.quality.atc.run", "sap.quality.atc.documentation"],
    disposition: "planned"
  },
  get_atc_decorations: {
    targets: ["sap.quality.atc.cached"], disposition: "v0_only"
  },
  analyze_abap_dumps: {
    targets: ["sap.runtime.dump.list", "sap.runtime.dump.inspect"],
    disposition: "planned"
  },
  analyze_abap_traces: {
    targets: [
      "sap.runtime.trace.list",
      "sap.runtime.trace.configuration",
      "sap.runtime.trace.inspect",
      "sap.runtime.trace.statements",
      "sap.runtime.trace.hit_list"
    ],
    disposition: "planned"
  },
  abap_debug_session: {
    targets: [
      "sap.debug.session.start",
      "sap.debug.session.stop",
      "sap.debug.session.inspect"
    ],
    disposition: "planned"
  },
  abap_debug_breakpoint: {
    targets: ["sap.debug.breakpoint.set", "sap.debug.breakpoint.remove"],
    disposition: "planned"
  },
  abap_debug_step: {
    targets: ["sap.debug.step"], disposition: "planned"
  },
  abap_debug_variable: {
    targets: ["sap.debug.variables", "sap.debug.evaluate"], disposition: "planned"
  },
  abap_debug_stack: {
    targets: ["sap.debug.stack"], disposition: "planned"
  },
  abap_debug_status: {
    targets: ["sap.debug.status"], disposition: "planned"
  },
  execute_data_query: {
    targets: ["sap.data.query", "sap.data.export"], disposition: "planned"
  },
  get_abap_sql_syntax: {
    targets: ["sap-docs://data-query"], disposition: "resource"
  },
  abap_download: {
    targets: ["sap.source.export"], disposition: "extension"
  },
  manage_heartbeat: {
    targets: ["sap.ops.watch.*"], disposition: "v0_only"
  },
  adt_discovery_export: {
    targets: ["sap.system.discovery", "sap.system.discovery.export"],
    disposition: "planned"
  },
  run_sap_transaction: {
    targets: ["sap.ui.transaction_url", "sap.ui.transaction_launch"],
    disposition: "extension"
  },
  run_abap_application: {
    targets: [
      "sap.execution.health",
      "sap.execution.preview",
      "sap.execution.execute"
    ],
    disposition: "planned"
  },
  abap_fs_documentation: {
    targets: ["sap-docs://compat/*"], disposition: "resource"
  },
  create_mermaid_diagram: {
    targets: ["sap.artifact.mermaid.create"], disposition: "extension"
  },
  validate_mermaid_syntax: {
    targets: ["sap.artifact.mermaid.validate"], disposition: "extension"
  },
  get_mermaid_documentation: {
    targets: ["sap-docs://mermaid/*"], disposition: "resource"
  },
  detect_mermaid_diagram_type: {
    targets: ["sap.artifact.mermaid.detect"], disposition: "extension"
  },
  create_test_documentation: {
    targets: ["sap.artifact.test_document.create"], disposition: "extension"
  }
} as const satisfies Record<V0ToolName, V1MigrationEntry>

export const V1_FIRST_SLICE_TOOL_NAMES = [
  V1_MIGRATION_CATALOG.get_connected_systems.targets[0],
  V1_MIGRATION_CATALOG.get_sap_system_info.targets[0],
  V1_MIGRATION_CATALOG.get_sap_capabilities.targets[0],
  V1_MIGRATION_CATALOG.search_abap_objects.targets[0],
  V1_MIGRATION_CATALOG.get_abap_object_lines.targets[0]
] as const

export const V1_FIRST_SLICE_V0_TOOL_NAMES = [
  "get_connected_systems",
  "get_sap_system_info",
  "get_sap_capabilities",
  "search_abap_objects",
  "get_abap_object_lines"
] as const

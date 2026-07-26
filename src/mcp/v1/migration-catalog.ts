import type { IMPLEMENTED_TOOL_NAMES } from "../../compat/abap-fs-tools.js"

export type V0ToolName = typeof IMPLEMENTED_TOOL_NAMES[number]
export type V1MigrationDisposition =
  | "implemented"
  | "planned"
  | "extension"
  | "resource"
  | "v0_only"
  | "compatibility"

export interface V1MigrationEntry {
  targets: readonly string[]
  disposition: V1MigrationDisposition
  implementedTargets?: readonly string[]
}

export const V1_MIGRATION_CATALOG = {
  read_deferred_result: {
    targets: ["resource-links", "cursor-pages"], disposition: "compatibility"
  },
  get_connected_systems: {
    targets: ["sap.system.list"], disposition: "implemented"
  },
  get_sap_system_info: {
    targets: ["sap.system.inspect"], disposition: "implemented"
  },
  get_sap_capabilities: {
    targets: ["sap.system.capabilities", "sap-capability://{system}"],
    disposition: "implemented"
  },
  search_abap_objects: {
    targets: ["sap.repository.search"], disposition: "implemented"
  },
  get_abap_object_lines: {
    targets: ["sap.source.read", "adt://{system}/{+adtPath}"],
    disposition: "implemented"
  },
  search_abap_object_lines: {
    targets: ["sap.source.search"], disposition: "implemented"
  },
  get_abap_object_info: {
    targets: ["sap.repository.inspect"], disposition: "implemented"
  },
  get_batch_lines: {
    targets: ["sap.source.read_batch"], disposition: "implemented"
  },
  get_object_by_uri: {
    targets: ["sap.source.read"], disposition: "implemented"
  },
  get_abap_object_url: {
    targets: ["sap.ui.object_url"], disposition: "implemented"
  },
  get_abap_object_workspace_uri: {
    targets: ["sap.repository.resolve"], disposition: "implemented"
  },
  open_object: {
    targets: ["sap.repository.resolve"], disposition: "implemented"
  },
  find_where_used: {
    targets: ["sap.repository.where_used"], disposition: "implemented"
  },
  get_abap_dependency_graph: {
    targets: ["sap.repository.dependency_graph"], disposition: "implemented"
  },
  compare_abap_systems: {
    targets: ["sap.repository.compare"], disposition: "implemented"
  },
  create_object_programmatically: {
    targets: ["sap.repository.create"], disposition: "implemented"
  },
  replace_string_in_abap_object: {
    targets: ["sap.source.patch"], disposition: "implemented"
  },
  get_abap_diagnostics: {
    targets: ["sap.source.diagnose"], disposition: "implemented"
  },
  abap_activate: {
    targets: ["sap.source.activate"], disposition: "implemented"
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
    disposition: "implemented"
  },
  refactor_abap_code: {
    targets: [
      "sap.refactor.preview",
      "sap.refactor.execute",
      "sap.repository.delete.preview",
      "sap.repository.delete.execute"
    ],
    disposition: "implemented"
  },
  manage_text_elements: {
    targets: ["sap.text_elements.read", "sap.text_elements.write"],
    disposition: "implemented"
  },
  run_unit_tests: {
    targets: ["sap.quality.unit_test"], disposition: "implemented"
  },
  create_test_include: {
    targets: ["sap.quality.test_include.create"], disposition: "implemented"
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
    disposition: "implemented"
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
    disposition: "implemented"
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
    disposition: "implemented"
  },
  manage_abap_versions: {
    targets: [
      "sap.version.inactive.list",
      "sap.version.inactive.read",
      "sap.version.restore.preview",
      "sap.version.restore.execute"
    ],
    disposition: "implemented"
  },
  get_version_history: {
    targets: [
      "sap.version.history.list",
      "sap.version.history.read",
      "sap.version.history.compare"
    ],
    disposition: "implemented"
  },
  run_atc_analysis: {
    targets: ["sap.quality.atc.run", "sap.quality.atc.documentation"],
    disposition: "implemented"
  },
  get_atc_decorations: {
    targets: ["sap.quality.atc.cached"], disposition: "implemented"
  },
  analyze_abap_dumps: {
    targets: ["sap.runtime.dump.list", "sap.runtime.dump.inspect"],
    disposition: "implemented"
  },
  analyze_abap_traces: {
    targets: [
      "sap.runtime.trace.list",
      "sap.runtime.trace.configuration",
      "sap.runtime.trace.inspect",
      "sap.runtime.trace.statements",
      "sap.runtime.trace.hit_list"
    ],
    disposition: "implemented"
  },
  abap_debug_session: {
    targets: [
      "sap.debug.session.start",
      "sap.debug.session.stop",
      "sap.debug.session.inspect"
    ],
    disposition: "implemented"
  },
  abap_debug_breakpoint: {
    targets: ["sap.debug.breakpoint.set", "sap.debug.breakpoint.remove"],
    disposition: "implemented"
  },
  abap_debug_step: {
    targets: ["sap.debug.step"], disposition: "implemented"
  },
  abap_debug_variable: {
    targets: ["sap.debug.variables", "sap.debug.evaluate"], disposition: "implemented"
  },
  abap_debug_stack: {
    targets: ["sap.debug.stack"], disposition: "implemented"
  },
  abap_debug_status: {
    targets: ["sap.debug.status"], disposition: "implemented"
  },
  execute_data_query: {
    targets: ["sap.data.query", "sap.data.export"],
    disposition: "implemented"
  },
  get_abap_sql_syntax: {
    targets: ["sap-docs://data-query"], disposition: "resource"
  },
  abap_download: {
    targets: ["sap.source.export"], disposition: "implemented"
  },
  manage_heartbeat: {
    targets: [
      "sap.ops.watch.status",
      "sap.ops.watch.start",
      "sap.ops.watch.stop",
      "sap.ops.watch.trigger",
      "sap.ops.watch.history",
      "sap.ops.watch.task.add",
      "sap.ops.watch.task.remove",
      "sap.ops.watch.task.update",
      "sap.ops.watch.task.enable",
      "sap.ops.watch.task.disable",
      "sap.ops.watch.task.list",
      "sap.ops.watch.watchlist.read"
    ],
    disposition: "implemented"
  },
  adt_discovery_export: {
    targets: ["sap.system.discovery", "sap.system.discovery.export"],
    disposition: "implemented"
  },
  run_sap_transaction: {
    targets: ["sap.ui.transaction_url", "sap.ui.transaction_launch"],
    disposition: "implemented"
  },
  run_abap_application: {
    targets: [
      "sap.execution.health",
      "sap.execution.preview",
      "sap.execution.execute"
    ],
    disposition: "implemented"
  },
  abap_fs_documentation: {
    targets: ["sap-docs://compat/{document}"], disposition: "resource"
  },
  create_mermaid_diagram: {
    targets: ["sap.artifact.mermaid.create"], disposition: "implemented"
  },
  validate_mermaid_syntax: {
    targets: ["sap.artifact.mermaid.validate"], disposition: "implemented"
  },
  get_mermaid_documentation: {
    targets: ["sap-docs://mermaid/{document}"], disposition: "resource"
  },
  detect_mermaid_diagram_type: {
    targets: ["sap.artifact.mermaid.detect"], disposition: "implemented"
  },
  create_test_documentation: {
    targets: ["sap.artifact.test_document.create"], disposition: "implemented"
  }
} as const satisfies Record<V0ToolName, V1MigrationEntry>

function uniqueToolTargets(
  entries: readonly V1MigrationEntry[]
): readonly string[] {
  return Object.freeze([...new Set(entries.flatMap(entry =>
    entry.targets.filter(target => target.startsWith("sap."))
  ))].sort())
}

export const V1_TOOL_NAMES = uniqueToolTargets(
  Object.values(V1_MIGRATION_CATALOG)
)

export const V1_IMPLEMENTED_TOOL_NAMES = uniqueToolTargets(
  (Object.values(V1_MIGRATION_CATALOG) as V1MigrationEntry[]).map(entry => ({
    targets: entry.disposition === "implemented"
      ? entry.targets
      : "implementedTargets" in entry
        ? entry.implementedTargets
        : [],
    disposition: entry.disposition
  }))
)

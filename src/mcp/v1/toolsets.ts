import type { ToolsetName } from "../../compat/abap-fs-tools.js"
import { V1_TOOL_NAMES } from "./migration-catalog.js"

type PrimaryToolsetName = Exclude<ToolsetName, "all">

export const V1_MCP_TOOLSETS: Record<PrimaryToolsetName, readonly string[]> = {
  core: [
    "sap.repository.inspect",
    "sap.repository.resolve",
    "sap.repository.search",
    "sap.repository.where_used",
    "sap.semantic.complete",
    "sap.semantic.components",
    "sap.semantic.definition",
    "sap.semantic.documentation",
    "sap.semantic.format_preview",
    "sap.semantic.hierarchy",
    "sap.semantic.quick_fixes",
    "sap.source.diagnose",
    "sap.source.read",
    "sap.source.read_batch",
    "sap.source.search",
    "sap.system.capabilities",
    "sap.system.inspect",
    "sap.system.list",
    "sap.text_elements.read",
    "sap.ui.object_url"
  ],
  write: [
    "sap.execution.execute",
    "sap.git.branch.switch",
    "sap.git.create",
    "sap.git.pull",
    "sap.git.push",
    "sap.git.stage",
    "sap.git.unlink",
    "sap.quality.test_include.create",
    "sap.rap.binding.publish",
    "sap.rap.binding.unpublish",
    "sap.rap.generate",
    "sap.refactor.execute",
    "sap.repository.create",
    "sap.source.activate",
    "sap.source.patch",
    "sap.text_elements.write",
    "sap.transport.create",
    "sap.transport.delete",
    "sap.transport.object.add",
    "sap.transport.owner.set",
    "sap.transport.release",
    "sap.transport.user.add",
    "sap.version.restore.execute"
  ],
  analysis: [
    "sap.data.query",
    "sap.git.check",
    "sap.git.inspect",
    "sap.git.list",
    "sap.quality.atc.cached",
    "sap.quality.atc.documentation",
    "sap.quality.atc.run",
    "sap.quality.unit_test",
    "sap.rap.availability",
    "sap.rap.binding.inspect",
    "sap.rap.defaults",
    "sap.rap.preview",
    "sap.rap.schema",
    "sap.rap.validate",
    "sap.refactor.preview",
    "sap.repository.compare",
    "sap.repository.dependency_graph",
    "sap.transport.assess",
    "sap.transport.compare",
    "sap.transport.inspect",
    "sap.transport.list",
    "sap.transport.object.resolve",
    "sap.transport.user.list",
    "sap.version.history.compare",
    "sap.version.history.list",
    "sap.version.history.read",
    "sap.version.inactive.list",
    "sap.version.inactive.read",
    "sap.version.restore.preview"
  ],
  debug: [
    "sap.debug.breakpoint.remove",
    "sap.debug.breakpoint.set",
    "sap.debug.evaluate",
    "sap.debug.session.inspect",
    "sap.debug.session.start",
    "sap.debug.session.stop",
    "sap.debug.stack",
    "sap.debug.status",
    "sap.debug.step",
    "sap.debug.variables"
  ],
  operations: [
    "sap.execution.health",
    "sap.execution.preview",
    "sap.ops.watch.history",
    "sap.ops.watch.start",
    "sap.ops.watch.status",
    "sap.ops.watch.stop",
    "sap.ops.watch.task.add",
    "sap.ops.watch.task.disable",
    "sap.ops.watch.task.enable",
    "sap.ops.watch.task.list",
    "sap.ops.watch.task.remove",
    "sap.ops.watch.task.update",
    "sap.ops.watch.trigger",
    "sap.ops.watch.watchlist.read",
    "sap.runtime.dump.inspect",
    "sap.runtime.dump.list",
    "sap.runtime.trace.configuration",
    "sap.runtime.trace.hit_list",
    "sap.runtime.trace.inspect",
    "sap.runtime.trace.list",
    "sap.runtime.trace.statements",
    "sap.system.discovery",
    "sap.ui.transaction_launch",
    "sap.ui.transaction_url"
  ],
  artifacts: [
    "sap.artifact.mermaid.create",
    "sap.artifact.mermaid.detect",
    "sap.artifact.mermaid.validate",
    "sap.artifact.test_document.create",
    "sap.data.export",
    "sap.source.export",
    "sap.system.discovery.export"
  ]
}

export const V1_RESOURCE_NAMES = [
  "sap-adt-source",
  "sap-capability-evidence",
  "sap-docs-compat",
  "sap-docs-data-query",
  "sap-docs-mermaid",
  "sap-evidence",
  "sap-transport"
] as const

export type V1ResourceName = typeof V1_RESOURCE_NAMES[number]

export const V1_IMPLEMENTED_RESOURCE_NAMES = [
  "sap-adt-source",
  "sap-capability-evidence"
] as const satisfies readonly V1ResourceName[]

export const V1_RESOURCE_TOOLSETS: Record<
  PrimaryToolsetName,
  readonly V1ResourceName[]
> = {
  core: ["sap-adt-source", "sap-capability-evidence", "sap-evidence"],
  write: ["sap-evidence", "sap-transport"],
  analysis: ["sap-docs-data-query", "sap-evidence", "sap-transport"],
  debug: ["sap-evidence"],
  operations: ["sap-evidence"],
  artifacts: ["sap-docs-compat", "sap-docs-mermaid", "sap-evidence"]
}

export function v1ToolsForToolsets(
  toolsets: readonly ToolsetName[]
): ReadonlySet<string> {
  if (toolsets.includes("all")) return new Set(V1_TOOL_NAMES)
  const selected = toolsets.filter(
    (name): name is PrimaryToolsetName => name !== "all"
  )
  return new Set(selected.flatMap(name => V1_MCP_TOOLSETS[name]))
}

export function v1ResourcesForToolsets(
  toolsets: readonly ToolsetName[]
): ReadonlySet<V1ResourceName> {
  if (toolsets.includes("all")) return new Set(V1_RESOURCE_NAMES)
  const selected = toolsets.filter(
    (name): name is PrimaryToolsetName => name !== "all"
  )
  return new Set(selected.flatMap(name => V1_RESOURCE_TOOLSETS[name]))
}

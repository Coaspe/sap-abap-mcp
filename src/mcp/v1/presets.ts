import type { V1ResourceName } from "./toolsets.js"

export const V1_PRESET_NAMES = ["compact", "development", "assurance"] as const
export type V1PresetName = typeof V1_PRESET_NAMES[number]

const COMPACT_TOOLS = [
  "sap.repository.inspect",
  "sap.repository.resolve",
  "sap.repository.search",
  "sap.repository.where_used",
  "sap.semantic.complete",
  "sap.semantic.definition",
  "sap.source.diagnose",
  "sap.source.read",
  "sap.source.search",
  "sap.system.capabilities",
  "sap.system.inspect",
  "sap.system.list"
] as const

export const V1_MCP_PRESETS: Record<V1PresetName, readonly string[]> = {
  compact: COMPACT_TOOLS,
  development: [
    ...COMPACT_TOOLS,
    "sap.git.check",
    "sap.git.inspect",
    "sap.git.list",
    "sap.git.pull",
    "sap.git.push",
    "sap.git.stage",
    "sap.quality.atc.run",
    "sap.quality.unit_test",
    "sap.refactor.execute",
    "sap.refactor.preview",
    "sap.repository.create",
    "sap.semantic.components",
    "sap.semantic.documentation",
    "sap.semantic.format_preview",
    "sap.semantic.quick_fixes",
    "sap.source.activate",
    "sap.source.patch",
    "sap.source.read_batch",
    "sap.transport.create",
    "sap.transport.inspect",
    "sap.transport.list",
    "sap.transport.object.add"
  ],
  assurance: [
    "sap.quality.atc.run",
    "sap.quality.unit_test",
    "sap.repository.compare",
    "sap.repository.dependency_graph",
    "sap.repository.inspect",
    "sap.repository.resolve",
    "sap.source.read",
    "sap.system.capabilities",
    "sap.system.inspect",
    "sap.system.list",
    "sap.transport.assess",
    "sap.transport.compare",
    "sap.transport.inspect",
    "sap.transport.list",
    "sap.transport.object.resolve"
  ]
}

export const V1_PRESET_RESOURCE_NAMES: Record<
  V1PresetName,
  readonly V1ResourceName[]
> = {
  compact: ["sap-adt-source", "sap-capability-evidence", "sap-evidence"],
  development: [
    "sap-adt-source",
    "sap-capability-evidence",
    "sap-evidence",
    "sap-transport"
  ],
  assurance: [
    "sap-adt-source",
    "sap-capability-evidence",
    "sap-evidence",
    "sap-transport"
  ]
}

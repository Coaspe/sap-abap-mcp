export interface McpProfile {
  id: string
  version: string
  status: "proposal" | "stable"
  description: string
  requiredTools: Array<{
    name: string
    capability: string
    readOnly: true
  }>
  requiredExecutionTools?: Array<{
    name: string
    capability: string
    readOnly: false
  }>
  requiredResources: Array<{
    name: string
    purpose: string
  }>
  optionalMutationRequirements: {
    accurateToolAnnotations: boolean
    previewBeforeDestructiveExecution: boolean
    explicitConfirmation: boolean
  }
}

export interface ProfileDiscovery {
  server: {
    name: string
    version: string
  }
  tools: Array<{
    name: string
    annotations?: { readOnlyHint?: boolean }
  }>
  resources: Array<{ name: string }>
}

export interface ProfileConformanceResult {
  profile: {
    id: string
    version: string
    status: McpProfile["status"]
  }
  server: ProfileDiscovery["server"]
  requiredTools: {
    expected: number
    found: number
    missing: string[]
  }
  requiredResources: {
    expected: number
    found: number
    missing: string[]
  }
  failures: Array<{
    kind: "missing-tool" | "missing-resource" | "read-only-tool-unverified" | "execution-tool-risk-unverified"
    name: string
  }>
  passed: boolean
}

function requirementNames(
  requirements: Array<{ name: string }>,
  label: string
): string[] {
  const names = requirements.map(requirement => requirement.name)
  if (names.some(name => !name.trim())) {
    throw new Error(`${label} contains an empty name`)
  }
  if (new Set(names).size !== names.length) {
    throw new Error(`${label} contains duplicate names`)
  }
  return names
}

export function evaluateProfile(
  profile: McpProfile,
  discovery: ProfileDiscovery
): ProfileConformanceResult {
  const executionTools = profile.requiredExecutionTools ?? []
  const requiredTools = requirementNames([...profile.requiredTools, ...executionTools], "requiredTools")
  const requiredResources = requirementNames(
    profile.requiredResources,
    "requiredResources"
  )
  const discoveredTools = new Set(discovery.tools.map(tool => tool.name))
  const discoveredResources = new Set(
    discovery.resources.map(resource => resource.name)
  )
  const missingTools = requiredTools.filter(name => !discoveredTools.has(name))
  const missingResources = requiredResources.filter(
    name => !discoveredResources.has(name)
  )
  const unverifiedReadOnlyTools = profile.requiredTools.filter(requirement => {
    const tool = discovery.tools.find(tool => tool.name === requirement.name)
    return tool !== undefined && tool.annotations?.readOnlyHint !== true
  })
  const failures: ProfileConformanceResult["failures"] = [
    ...missingTools.map(name => ({ kind: "missing-tool" as const, name })),
    ...missingResources.map(name => ({ kind: "missing-resource" as const, name })),
    ...unverifiedReadOnlyTools.map(({ name }) => ({
      kind: "read-only-tool-unverified" as const,
      name
    })),
    ...executionTools.filter(requirement => {
      const tool = discovery.tools.find(tool => tool.name === requirement.name)
      return tool !== undefined && tool.annotations?.readOnlyHint !== false
    }).map(({ name }) => ({ kind: "execution-tool-risk-unverified" as const, name }))
  ]

  return {
    profile: {
      id: profile.id,
      version: profile.version,
      status: profile.status
    },
    server: discovery.server,
    requiredTools: {
      expected: requiredTools.length,
      found: requiredTools.length - missingTools.length,
      missing: missingTools
    },
    requiredResources: {
      expected: requiredResources.length,
      found: requiredResources.length - missingResources.length,
      missing: missingResources
    },
    failures,
    passed: failures.length === 0
  }
}

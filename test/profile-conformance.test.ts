import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import {
  evaluateProfile,
  type McpProfile,
  type ProfileDiscovery
} from "../src/profile-conformance.js"

const profile = JSON.parse(
  readFileSync("spec/sap-abap-mcp-profile-v1.json", "utf8")
) as McpProfile

function completeDiscovery(): ProfileDiscovery {
  return {
    server: {
      name: "profile-test-server",
      version: "1.0.0"
    },
    tools: profile.requiredTools.map(requirement => ({
      name: requirement.name,
      annotations: { readOnlyHint: true }
    })),
    resources: profile.requiredResources.map(requirement => ({
      name: requirement.name
    }))
  }
}

test("v1 compatibility profile has stable proposal metadata and unique requirements", () => {
  assert.equal(profile.id, "io.github.Coaspe/sap-abap-mcp/profile/v1")
  assert.equal(profile.version, "1.0.0")
  assert.equal(profile.status, "proposal")
  assert.equal(profile.requiredTools.length, 10)
  assert.equal(profile.requiredResources.length, 3)
  assert.equal(
    new Set(profile.requiredTools.map(requirement => requirement.name)).size,
    profile.requiredTools.length
  )
  assert.equal(
    new Set(profile.requiredResources.map(requirement => requirement.name)).size,
    profile.requiredResources.length
  )
  assert.ok(profile.requiredTools.every(requirement => requirement.readOnly))
})

test("complete profile discovery passes with exact evidence counts", () => {
  const result = evaluateProfile(profile, completeDiscovery())

  assert.equal(result.passed, true)
  assert.deepEqual(result.failures, [])
  assert.deepEqual(result.requiredTools, {
    expected: 10,
    found: 10,
    missing: []
  })
  assert.deepEqual(result.requiredResources, {
    expected: 3,
    found: 3,
    missing: []
  })
})

test("a missing required capability fails with its exact tool name", () => {
  const discovery = completeDiscovery()
  discovery.tools = discovery.tools.filter(tool => tool.name !== "sap.transport.assess")

  const result = evaluateProfile(profile, discovery)

  assert.equal(result.passed, false)
  assert.deepEqual(result.requiredTools.missing, ["sap.transport.assess"])
  assert.deepEqual(result.failures, [
    {
      kind: "missing-tool",
      name: "sap.transport.assess"
    }
  ])
})

for (const readOnlyHint of [false, undefined]) {
  test(`required tool without an explicit read-only hint fails (${readOnlyHint})`, () => {
    const discovery = completeDiscovery()
    const tool = discovery.tools.find(tool => tool.name === "sap.quality.unit_test")!
    if (readOnlyHint === undefined) delete tool.annotations
    else tool.annotations = { readOnlyHint }

    const result = evaluateProfile(profile, discovery)

    assert.equal(result.passed, false)
    assert.deepEqual(result.requiredTools.missing, [])
    assert.deepEqual(result.failures, [
      { kind: "read-only-tool-unverified", name: "sap.quality.unit_test" }
    ])
  })
}

test("execution hints on optional tools do not fail the read-only core", () => {
  const discovery = completeDiscovery()
  discovery.tools.push({ name: "optional.execute", annotations: { readOnlyHint: false } })

  assert.equal(evaluateProfile(profile, discovery).passed, true)
})

test("a missing required resource fails with its exact resource name", () => {
  const discovery = completeDiscovery()
  discovery.resources = discovery.resources.filter(resource => resource.name !== "sap-evidence")

  const result = evaluateProfile(profile, discovery)

  assert.equal(result.passed, false)
  assert.deepEqual(result.failures, [
    { kind: "missing-resource", name: "sap-evidence" }
  ])
})

const releaseProfile = JSON.parse(
  readFileSync("spec/sap-abap-mcp-release-profile-draft.json", "utf8")
) as McpProfile

function releaseDiscovery(): ProfileDiscovery {
  return {
    ...completeDiscovery(),
    tools: [
      ...releaseProfile.requiredTools.map(({ name }) => ({ name, annotations: { readOnlyHint: true } })),
      ...releaseProfile.requiredExecutionTools!.map(({ name }) => ({ name, annotations: { readOnlyHint: false } }))
    ]
  }
}

test("release draft requires all ten capabilities with accurate execution risk", () => {
  const result = evaluateProfile(releaseProfile, releaseDiscovery())
  assert.equal(result.passed, true)
  assert.equal(result.requiredTools.expected, 10)
  assert.equal(result.requiredTools.found, 10)
  assert.equal(releaseProfile.requiredTools.length, 8)
  assert.equal(releaseProfile.requiredExecutionTools!.length, 2)
  assert.equal(releaseProfile.status, "proposal")
})

test("release draft fails when execution is missing or is advertised as read-only", () => {
  const discovery = releaseDiscovery()
  const execution = discovery.tools.find(tool => tool.name === "sap.quality.unit_test")!
  execution.annotations = { readOnlyHint: true }
  discovery.tools = discovery.tools.filter(tool => tool.name !== "sap.transport.assess")
  const result = evaluateProfile(releaseProfile, discovery)
  assert.equal(result.passed, false)
  assert.deepEqual(result.failures, [
    { kind: "missing-tool", name: "sap.transport.assess" },
    { kind: "execution-tool-risk-unverified", name: "sap.quality.unit_test" }
  ])
})

test("release draft does not claim conformance to the unchanged read-only proposal", () => {
  const result = evaluateProfile(profile, releaseDiscovery())
  assert.equal(result.passed, false)
  assert.deepEqual(result.failures.map(failure => failure.name), ["sap.quality.unit_test", "sap.transport.assess"])
})

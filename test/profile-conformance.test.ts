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
      name: requirement.name
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

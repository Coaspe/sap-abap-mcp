import assert from "node:assert/strict"
import test from "node:test"
import type { UsageReference } from "abap-adt-api"
import type { SapClient } from "../src/sap-client.js"
import { AbapToolService } from "../src/tool-service.js"

const root = {
  name: "ZROOT", type: "PROG/P", uri: "/sap/bc/adt/programs/programs/zroot", packageName: "Z_TEST"
}

function reference(name: string, suffix = ""): UsageReference {
  return {
    uri: `/sap/bc/adt/programs/programs/${name.toLowerCase()}${suffix}`,
    objectIdentifier: `ABAPFullName;${name}`,
    parentUri: "",
    isResult: true,
    canHaveChildren: true,
    usageInformation: "call",
    "adtcore:responsible": "TEST",
    "adtcore:name": name,
    "adtcore:type": "PROG/P",
    packageRef: { "adtcore:uri": "/sap/bc/adt/packages/z_test", "adtcore:name": "Z_TEST" }
  }
}

function harness(usages: (uri: string) => UsageReference[]) {
  const calls: string[] = []
  const client = {
    async searchObjects() { return [root] },
    async readObject() { return { object: root, sourceUri: `${root.uri}/source/main`, source: "REPORT zroot." } },
    async findUsageReferences(uri: string) { calls.push(uri); return usages(uri) }
  } as unknown as SapClient
  const service = new AbapToolService({
    async listConnections() { return [] },
    async getClient() { return client }
  })
  return { service, calls }
}

const input = { connectionId: "DEV100", objectName: "ZROOT", objectType: "PROG/P", depth: 5, maxNodes: 10, customOnly: false }

test("dependency traversal queries each object once despite URI aliases and cycles", async () => {
  const { service, calls } = harness(uri => uri.includes("zroot")
    ? [reference("ZA", "#start=1,0"), reference("ZA", "#start=2,0")]
    : [reference("ZROOT"), reference("ZROOT", "#start=3,0")])
  const result = await service.dependencyGraph(input)
  assert.equal(result.nodeCount, 2)
  assert.equal(result.edgeCount, 2)
  assert.equal(calls.length, 2)
  assert.equal(calls[1], "/sap/bc/adt/programs/programs/za")
  assert.equal(result.coverage.depthLimited, false)
})

test("dependency traversal reports unexplored depth separately from node truncation", async () => {
  const { service, calls } = harness(() => [reference("ZA")])
  const result = await service.dependencyGraph({ ...input, depth: 1 })
  assert.equal(result.truncated, false)
  assert.equal(calls.length, 1)
  assert.deepEqual(result.coverage, {
    direction: "where_used", expandedNodes: 1, depthLimited: true, nodeLimited: false
  })
})

test("node budget bounds calls and every retained edge has two retained nodes", async () => {
  const { service, calls } = harness(uri => uri.includes("zroot")
    ? [reference("ZA"), reference("ZB"), reference("ZC")]
    : [])
  const result = await service.dependencyGraph({ ...input, maxNodes: 2 })
  assert.equal(result.truncated, true)
  assert.equal(result.nodeCount, 2)
  assert.equal(calls.length, 2)
  const ids = new Set(result.nodes.map(node => node.id))
  assert.deepEqual(result.coverage, {
    direction: "where_used", expandedNodes: 2, depthLimited: false, nodeLimited: true
  })
  for (const edge of result.edges) {
    assert.ok(ids.has(edge.source))
    assert.ok(ids.has(edge.target))
  }
})

import assert from "node:assert/strict"
import test from "node:test"
import type { ConnectionSummary } from "../src/connection-manager.js"
import type { SapClient, SapObjectReference, SapSystemInfo } from "../src/sap-client.js"
import { AbapToolService } from "../src/tool-service.js"

const connection: ConnectionSummary = {
  id: "DEV100",
  url: "https://sap.example.test",
  client: "100",
  language: "EN",
  environment: "development",
  username: "DEVELOPER",
  credentialAvailable: true
}

const object: SapObjectReference = {
  name: "ZCL_TOKEN_TEST",
  type: "CLAS/OC",
  uri: "/sap/bc/adt/oo/classes/zcl_token_test",
  description: "Token efficiency fixture",
  packageName: "Z_TOKEN"
}

const sourceLines = Array.from(
  { length: 80 },
  (_, index) => `${index + 1}  value = ${index};`
)
const source = sourceLines.join("\n")

const usageReferences = Array.from({ length: 20 }, (_, index) => ({
  uri: `/sap/bc/adt/programs/programs/zrep_caller_${index}`,
  objectIdentifier: `ABAPFullName;ZREP_CALLER_${index}`,
  parentUri: `/sap/bc/adt/programs/programs/zrep_caller_${index}`,
  isResult: true,
  canHaveChildren: false,
  usageInformation: "method call",
  "adtcore:responsible": "DEVELOPER",
  "adtcore:name": `ZREP_CALLER_${index}`,
  "adtcore:type": "PROG/P",
  "adtcore:description": `Caller program ${index}`,
  packageRef: {
    "adtcore:uri": "/sap/bc/adt/packages/z_token",
    "adtcore:name": "Z_TOKEN"
  }
}))

const structure = {
  objectUrl: object.uri,
  metaData: {
    "adtcore:name": object.name,
    "adtcore:type": object.type,
    "adtcore:changedAt": 123,
    "adtcore:changedBy": "DEVELOPER",
    "adtcore:createdAt": 100,
    "adtcore:language": "EN",
    "adtcore:responsible": "OWNER",
    "adtcore:version": "active",
    links: Array.from({ length: 8 }, (_, index) => ({
      rel: `http://www.sap.com/adt/relations/link-${index}`,
      href: `${object.uri}/link-${index}`
    }))
  },
  links: Array.from({ length: 8 }, (_, index) => ({ href: `${object.uri}/link-${index}` })),
  includes: [{ name: "main" }, { name: "definitions" }]
}

const systemInfo: SapSystemInfo = {
  profileId: "DEV100",
  url: "https://sap.example.test",
  client: "100",
  language: "EN",
  environment: "development",
  username: "DEVELOPER",
  sapRelease: "2023",
  systemType: "S/4HANA",
  logicalSystem: "DEVCLNT100",
  clientName: "Development",
  timezone: { name: "KST", description: "Korea", utcOffset: "+09:00" },
  softwareComponents: [],
  discoveryCollections: 12,
  warnings: [],
  queryTimestamp: "2026-07-16T00:00:00.000Z"
}

function createService() {
  const client = {
    searchObjects: async () => [object],
    readObject: async () => ({
      object,
      source,
      sourceUri: `${object.uri}/source/main`
    }),
    getObjectStructure: async () => structure,
    getObjectEnhancements: async () => ({ implementations: [] }),
    findUsageReferences: async () => usageReferences,
    getUsageReferenceSnippets: async (
      references: Parameters<SapClient["getUsageReferenceSnippets"]>[0]
    ) => references.map(reference => ({
      objectIdentifier: reference.objectIdentifier ?? "",
      snippets: [{
        uri: { uri: reference.uri, start: { line: 7, column: 2 } },
        matches: "zcl_token=>run( )",
        content: "zcl_token=>run( ).",
        description: "method call"
      }]
    })),
    readSourceByUri: async () => ({ source, sourceUri: `${object.uri}/source/main` }),
    formatSource: async () => `${source}\n`,
    getAdtDiscovery: async () => ({ discovery: [], core: [] }),
    getSystemInfo: async () => systemInfo,
    getDumps: async () => ({
      dumps: [{
        id: "DUMP-1",
        author: "DEVELOPER",
        text: "<p>failure</p>",
        type: "text/html",
        categories: [{ term: "FAILURE", label: "Failure" }],
        links: Array.from({ length: 8 }, (_, index) => ({
          href: `/sap/bc/adt/runtime/dumps/DUMP-1/link-${index}`,
          rel: `detail-${index}`,
          type: "application/xml"
        }))
      }]
    }),
    getTraceRuns: async () => ({
      runs: [{
        id: "TRACE-1",
        author: "DEVELOPER",
        title: "Token trace",
        published: new Date("2026-07-16T00:00:00.000Z"),
        updated: new Date("2026-07-16T00:01:00.000Z"),
        authorUri: "/sap/bc/adt/users/developer",
        type: "application/atom+xml",
        src: "/sap/bc/adt/runtime/traces/TRACE-1",
        lang: "EN",
        links: Array.from({ length: 8 }, (_, index) => ({ href: `/trace/link-${index}` })),
        extendedData: {
          host: "appserver",
          size: 100,
          runtime: 1000,
          runtimeABAP: 500,
          runtimeSystem: 100,
          runtimeDatabase: 400,
          expiration: new Date("2026-07-23T00:00:00.000Z"),
          system: "DEV",
          client: 100,
          isAggregated: false,
          objectName: object.name,
          state: { value: "F", text: "Finished" }
        }
      }]
    }),
    getTraceConfigurations: async () => ({
      requests: [{
        id: "CONFIG-1",
        lang: "EN",
        title: "Token trace config",
        published: new Date("2026-07-16T00:00:00.000Z"),
        updated: new Date("2026-07-16T00:01:00.000Z"),
        links: Array.from({ length: 8 }, (_, index) => ({ href: `/config/link-${index}` })),
        authors: [{ name: "DEVELOPER", role: "owner", uri: "/sap/bc/adt/users/developer" }],
        contentSrc: "/sap/bc/adt/runtime/traces/config-1/content",
        contentType: "application/xml",
        extendedData: {
          description: "Trace one execution",
          executions: { maximal: 1, completed: 0 },
          isAggregated: false,
          host: "appserver",
          expires: new Date("2026-07-23T00:00:00.000Z"),
          processType: "dialog",
          objectType: "report",
          requestIndex: 1,
          clients: [{ id: 100, role: "client" }]
        }
      }]
    }),
    getAtcCustomizing: async () => ({
      properties: [{ name: "systemCheckVariant", value: "DEFAULT" }]
    }),
    checkAtcVariant: async () => "DEFAULT",
    runAtc: async () => ({ id: "ATC-1", timestamp: 1, infos: [] }),
    getAtcWorklist: async () => ({
      objects: [{
        ...object,
        findings: Array.from({ length: 20 }, (_, index) => ({
          uri: `${object.uri}/atc/${index}`,
          priority: 2,
          checkId: "CHECK",
          checkTitle: "Token check",
          messageId: `MSG-${index}`,
          messageTitle: `Warning ${index}`,
          location: { uri: `${object.uri}/source/main`, range: { start: { line: index + 1 } } },
          exemptionApproval: "",
          link: { href: `/sap/bc/adt/atc/doc/${index}` }
        }))
      }]
    })
  } as unknown as SapClient

  return new AbapToolService({
    async listConnections() {
      return [connection]
    },
    async getClient() {
      return client
    }
  })
}

test("connected system discovery omits connection details already available from the profile", async () => {
  const result = await createService().getConnectedSystems()

  assert.deepEqual(result, {
    systems: [{
      id: "DEV100",
      environment: "development",
      credentialAvailable: true
    }]
  })
  assert.ok(
    Buffer.byteLength(JSON.stringify(result), "utf8") <
      Buffer.byteLength(JSON.stringify({ systems: [connection] }), "utf8") / 2
  )
})

test("object info keeps useful scalar metadata without returning raw ADT links", async () => {
  const result = await createService().getObjectInfo({
    objectName: object.name,
    objectType: "CLAS",
    connectionId: "DEV100",
    includeStructure: false
  })

  assert.deepEqual(result.structureSummary, {
    changedAt: 123,
    changedBy: "DEVELOPER",
    createdAt: 100,
    language: "EN",
    responsible: "OWNER",
    version: "active",
    includeCount: 2
  })
  assert.doesNotMatch(JSON.stringify(result), /relations|link-\d/)
  const legacy = {
    ...result,
    structureSummary: {
      metaData: structure.metaData,
      sections: Object.keys(structure),
      linkCount: structure.links.length,
      includeCount: structure.includes.length
    }
  }
  assert.ok(
    Buffer.byteLength(JSON.stringify(result), "utf8") <
      Buffer.byteLength(JSON.stringify(legacy), "utf8") / 2
  )

  const full = await createService().getObjectInfo({
    objectName: object.name,
    objectType: "CLAS",
    connectionId: "DEV100",
    includeStructure: true
  })
  assert.equal(full.structure, structure)
})

test("source reads identify the object without repeating search metadata", async () => {
  const result = await createService().getObjectLines({
    objectName: object.name,
    objectType: "CLAS",
    startLine: 1,
    lineCount: 10,
    connectionId: "DEV100"
  })

  assert.deepEqual(result.object, { name: object.name, type: object.type })
  assert.equal(result.code, sourceLines.slice(0, 10).join("\n"))
  assert.doesNotMatch(JSON.stringify(result), /Token efficiency fixture|Z_TOKEN/)
  assert.ok(
    Buffer.byteLength(JSON.stringify(result), "utf8") + 100 <
      Buffer.byteLength(JSON.stringify({ ...result, object }), "utf8")
  )
})

test("source search merges overlapping contexts in the primary response", async () => {
  const service = createService()
  const result = await service.searchObjectLines({
    objectName: object.name,
    searchTerm: "value",
    contextLines: 3,
    connectionId: "DEV100",
    isRegexp: false,
    maxObjects: 1,
    startIndex: 19,
    maxResults: 20
  })

  assert.equal(result.matchCount, 80)
  assert.equal(result.returnedMatches, 20)
  assert.equal(result.nextStartIndex, 39)
  assert.deepEqual(result.results[0]?.object, { name: object.name, type: object.type })
  assert.deepEqual(
    result.results[0]?.matchLineNumbers,
    Array.from({ length: 20 }, (_, index) => index + 20)
  )
  assert.equal(result.results[0]?.contextBlocks.length, 1)
  assert.equal(result.results[0]?.contextBlocks[0]?.startLine, 17)
  assert.equal(result.results[0]?.contextBlocks[0]?.lines.length, 26)
  assert.equal("matches" in (result.results[0] ?? {}), false)

  const legacyMatches = Array.from({ length: 20 }, (_, index) => index + 20).map(
    lineNumber => ({
      lineNumber,
      line: sourceLines[lineNumber - 1],
      context: sourceLines
        .slice(lineNumber - 4, lineNumber + 3)
        .map((text, contextIndex) => ({
          lineNumber: lineNumber - 3 + contextIndex,
          text,
          isMatch: contextIndex === 3
        }))
    })
  )
  const legacy = {
    ...result,
    results: [{
      object,
      sourceUri: `${object.uri}/source/main`,
      totalLines: sourceLines.length,
      matches: legacyMatches,
      enhancementMatches: []
    }]
  }
  assert.ok(
    Buffer.byteLength(JSON.stringify(result), "utf8") <
      Buffer.byteLength(JSON.stringify(legacy), "utf8") / 3
  )
})

test("capability discovery keeps capability-relevant system metadata only", async () => {
  const result = await createService().getSapCapabilities("DEV100")

  assert.deepEqual(result.systemMetadata, {
    environment: "development",
    sapRelease: "2023",
    systemType: "S/4HANA",
    logicalSystem: "DEVCLNT100",
    discoveryCollections: 12,
    warnings: []
  })
  assert.doesNotMatch(JSON.stringify(result), /sap\.example\.test|DEVELOPER|Development|Korea/)
})

test("system summary omits the empty component collection unless explicitly requested", async () => {
  const service = createService()
  const summary = await service.getSapSystemInfo("DEV100", false)
  const detailed = await service.getSapSystemInfo("DEV100", true)

  assert.equal("softwareComponents" in summary, false)
  assert.deepEqual((detailed as SapSystemInfo).softwareComponents, [])
})

test("object-centric analysis responses use a compact object identity", async () => {
  const result = await createService().inspectCode({
    action: "format_preview",
    fileUri: `${object.uri}/source/main`,
    connectionId: "DEV100",
    line: 1,
    column: 0,
    implementation: false,
    startIndex: 0,
    maxResults: 20
  })

  assert.deepEqual(result.object, { name: object.name, type: object.type })
  assert.doesNotMatch(JSON.stringify(result), /Token efficiency fixture|Z_TOKEN/)
})

test("where-used and dependency graph responses omit internal ADT object metadata", async () => {
  const service = createService()
  const usages = await service.findWhereUsed({
    objectName: object.name,
    objectType: "CLAS",
    connectionId: "DEV100",
    maxResults: 20,
    includeSnippets: false,
    startIndex: 0
  })

  assert.deepEqual(usages.references[0], {
    name: "ZREP_CALLER_0",
    type: "PROG/P",
    uri: "/sap/bc/adt/programs/programs/zrep_caller_0",
    usageInformation: "method call",
    description: "Caller program 0",
    packageName: "Z_TOKEN"
  })
  assert.doesNotMatch(JSON.stringify(usages.references), /adtcore:|packageRef|canHaveChildren|isResult/)

  const legacy = { ...usages, references: usageReferences }
  assert.ok(
    Buffer.byteLength(JSON.stringify(usages), "utf8") <
      Buffer.byteLength(JSON.stringify(legacy), "utf8") * 0.75
  )

  const usagesWithSnippets = await service.findWhereUsed({
    objectName: object.name,
    objectType: "CLAS",
    connectionId: "DEV100",
    maxResults: 20,
    includeSnippets: true,
    startIndex: 0
  })
  assert.equal(
    usagesWithSnippets.snippets[0] && "referenceIndex" in usagesWithSnippets.snippets[0]
      ? usagesWithSnippets.snippets[0].referenceIndex
      : undefined,
    0
  )
  assert.doesNotMatch(JSON.stringify(usagesWithSnippets), /ABAPFullName;/)

  const graph = await service.dependencyGraph({
    objectName: object.name,
    objectType: "CLAS",
    connectionId: "DEV100",
    depth: 1,
    maxNodes: 100,
    customOnly: false
  })
  assert.equal(graph.nodeCount, 21)
  for (const node of graph.nodes) {
    assert.equal("uri" in node, false)
    assert.equal("parentUri" in node, false)
    assert.equal("objectIdentifier" in node, false)
    assert.equal("canExpand" in node, false)
    assert.equal("responsible" in node, false)
    assert.equal("usageInformation" in node, false)
  }
})

test("batch source reads do not repeat the parent connection ID", async () => {
  const result = await createService().getBatchLines({
    connectionId: "DEV100",
    requests: [
      { objectName: object.name, startLine: 0, lineCount: 5 },
      { objectName: object.name, startLine: 5, lineCount: 5 }
    ]
  })

  assert.equal(result.connectionId, "DEV100")
  for (const item of result.results) {
    assert.equal(item.ok, true)
    if (item.ok && item.result) assert.equal("connectionId" in item.result, false)
  }
})

test("dump and trace listings omit details available from their analysis actions", async () => {
  const service = createService()
  const dumps = await service.analyzeDumps({
    action: "list_dumps",
    connectionId: "DEV100",
    maxResults: 20,
    includeFullContent: false,
    contentOffset: 0,
    contentLength: 1000,
    startIndex: 0
  })
  const traces = await service.analyzeTraces({
    action: "list_runs",
    connectionId: "DEV100",
    maxResults: 20,
    includeDetails: false,
    startIndex: 0
  })
  const configurations = await service.analyzeTraces({
    action: "list_configurations",
    connectionId: "DEV100",
    maxResults: 20,
    includeDetails: false,
    startIndex: 0
  })

  assert.equal("links" in dumps.dumps![0]!, false)
  assert.deepEqual(traces.runs![0], {
    id: "TRACE-1",
    title: "Token trace",
    author: "DEVELOPER",
    published: new Date("2026-07-16T00:00:00.000Z"),
    objectName: object.name,
    host: "appserver",
    state: { value: "F", text: "Finished" },
    isAggregated: false
  })
  assert.deepEqual(configurations.configurations![0], {
    id: "CONFIG-1",
    title: "Token trace config",
    published: new Date("2026-07-16T00:00:00.000Z"),
    description: "Trace one execution",
    authors: ["DEVELOPER"],
    executions: { maximal: 1, completed: 0 },
    isAggregated: false,
    host: "appserver",
    expires: new Date("2026-07-23T00:00:00.000Z"),
    processType: "dialog",
    objectType: "report",
    clients: [100]
  })
})

test("ATC findings reference one object catalog instead of repeating object metadata", async () => {
  const result = await createService().runAtcAnalysis({
    action: "run_analysis",
    objectUri: `${object.uri}/source/main`,
    connectionId: "DEV100",
    startIndex: 0,
    maxResults: 20,
    documentationOffset: 0,
    documentationLength: 1000
  })

  const analysis = result as {
    objects: unknown[]
    findings: Array<{ objectIndex?: number; object?: unknown }>
  }
  assert.equal(analysis.objects.length, 1)
  assert.equal(analysis.findings.length, 20)
  assert.ok(analysis.findings.every(finding => finding.objectIndex === 0))
  assert.ok(analysis.findings.every(finding => !("object" in finding)))

  const decorations = createService().getAtcDecorations(
    `adt://dev100${object.uri}/source/main`,
    0,
    20
  )
  assert.equal(decorations.count, 0)

  const service = createService()
  await service.runAtcAnalysis({
    action: "run_analysis",
    objectUri: `${object.uri}/source/main`,
    connectionId: "DEV100",
    startIndex: 0,
    maxResults: 20,
    documentationOffset: 0,
    documentationLength: 1000
  })
  const cached = service.getAtcDecorations(`adt://dev100${object.uri}/source/main`, 0, 20)
  assert.equal(cached.objects.length, 1)
  assert.equal(cached.decorations.length, 20)
  assert.ok(cached.decorations.every(finding => finding.objectIndex === 0))
  assert.ok(cached.decorations.every(finding => !("object" in finding)))
})

test("heartbeat mutations honor includeDetails=false", async () => {
  const result = await createService().manageHeartbeat({
    action: "add_task",
    description: "Watch a large query",
    sampleQuery: `SELECT ${"FIELD,".repeat(200)} LAST_FIELD FROM ZTOKEN`,
    checkInstructions: Array.from({ length: 50 }, (_, index) => `Check ${index}`),
    startIndex: 0,
    maxResults: 20,
    includeDetails: false
  })

  const task = (result as { task: Record<string, unknown> }).task
  assert.equal(task.description, "Watch a large query")
  assert.equal("sampleQuery" in task, false)
  assert.equal("checkInstructions" in task, false)
})

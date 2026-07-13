import assert from "node:assert/strict"
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import test from "node:test"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { ConnectionManager, type ConnectionSummary } from "../src/connection-manager.js"
import { IMPLEMENTED_TOOL_NAMES } from "../src/compat/abap-fs-tools.js"
import { createMcpServer } from "../src/mcp-server.js"
import { ProfileStore, type SapProfile } from "../src/profile-store.js"
import { MemorySecretStore } from "../src/secret-store.js"
import type {
  SapClient,
  SapObjectReference,
  SapObjectSource,
  SapSystemInfo
} from "../src/sap-client.js"
import {
  AbapToolService,
  extractAbapMethod,
  replaceExactlyOnce
} from "../src/tool-service.js"

const object: SapObjectReference = {
  name: "ZCL_DEMO",
  type: "CLAS/OC",
  uri: "/sap/bc/adt/oo/classes/zcl_demo",
  description: "Demo class",
  packageName: "Z_DEMO"
}

const source = [
  "CLASS zcl_demo IMPLEMENTATION.",
  "  METHOD run.",
  "    result = 42.",
  "  ENDMETHOD.",
  "ENDCLASS."
].join("\n")

function systemInfo(profile: SapProfile): SapSystemInfo {
  return {
    profileId: profile.id,
    url: profile.url,
    client: profile.client,
    language: profile.language,
    environment: profile.environment,
    username: profile.username ?? "",
    sapRelease: "758",
    systemType: "S/4HANA",
    logicalSystem: "DEVCLNT100",
    clientName: "Development",
    timezone: { name: "KOREA", description: "Korea", utcOffset: "UTC+9" },
    softwareComponents: [],
    discoveryCollections: 12,
    warnings: [],
    queryTimestamp: "2026-07-13T00:00:00.000Z"
  }
}

class FakeSapClient implements SapClient {
  loginCount = 0
  logoutCount = 0
  currentSource = source
  createdObject: unknown
  debugActive = false

  constructor(readonly profile: SapProfile) {}

  async login(): Promise<void> {
    this.loginCount += 1
  }

  async logout(): Promise<void> {
    this.logoutCount += 1
  }

  async searchObjects(
    query: string,
    objectType?: string,
    _maxResults?: number
  ): Promise<SapObjectReference[]> {
    if (!query.toUpperCase().includes("ZCL_DEMO")) return []
    if (objectType && objectType.replace(/\/.*$/, "") !== "CLAS") return []
    return [object]
  }

  async readObject(reference: SapObjectReference): Promise<SapObjectSource> {
    return { source: this.currentSource, sourceUri: `${reference.uri}/source/main`, object: reference }
  }

  async readSourceByUri(uri: string) {
    if (uri.endsWith("/revisions/1")) {
      return { source: this.currentSource, sourceUri: uri }
    }
    if (uri.endsWith("/revisions/2")) {
      return { source: source.replace("result = 42", "result = 41"), sourceUri: uri }
    }
    return {
      source: this.currentSource,
      sourceUri: uri.endsWith("/source/main") ? uri : `${uri}/source/main`
    }
  }

  async getObjectStructure(uri: string): Promise<any> {
    return {
      objectUrl: uri,
      metaData: {
        "adtcore:name": object.name,
        "adtcore:type": object.type,
        "adtcore:changedAt": 0,
        "adtcore:changedBy": "DEVELOPER",
        "adtcore:createdAt": 0,
        "adtcore:language": "EN",
        "adtcore:responsible": "DEVELOPER",
        "adtcore:version": "active"
      },
      links: []
    }
  }

  async getObjectEnhancements(): Promise<any> {
    return { implementations: [] }
  }

  async findUsageReferences(): Promise<any[]> {
    return [
      {
        uri: "/sap/bc/adt/programs/programs/zrep_caller",
        objectIdentifier: "ABAPFullName;ZREP_CALLER",
        parentUri: "/sap/bc/adt/programs/programs/zrep_caller",
        isResult: true,
        canHaveChildren: false,
        usageInformation: "method call",
        "adtcore:responsible": "DEVELOPER",
        "adtcore:name": "ZREP_CALLER",
        "adtcore:type": "PROG/P",
        packageRef: {
          "adtcore:uri": "/sap/bc/adt/packages/z_demo",
          "adtcore:name": "Z_DEMO"
        }
      }
    ]
  }

  async getUsageReferenceSnippets(): Promise<any[]> {
    return [
      {
        objectIdentifier: "ABAPFullName;ZREP_CALLER",
        snippets: [
          {
            uri: { uri: "/sap/bc/adt/programs/programs/zrep_caller", start: { line: 7, column: 2 } },
            matches: "zcl_demo=>run( )",
            content: "zcl_demo=>run( ).",
            description: "method call"
          }
        ]
      }
    ]
  }

  async getMainPrograms(): Promise<any[]> {
    return []
  }

  async checkSyntax(
    _objectUri: string,
    sourceUri: string,
    sourceText: string
  ): Promise<any[]> {
    return sourceText.includes("SYNTAX_ERROR")
      ? [{ uri: sourceUri, line: 3, offset: 4, severity: "E", text: "Syntax error" }]
      : []
  }

  async replaceSource(
    _objectName: string,
    _objectUri: string,
    sourceUri: string,
    expectedSource: string,
    nextSource: string,
    _transport?: string,
    activate = false
  ): Promise<any> {
    assert.equal(this.currentSource, expectedSource)
    this.currentSource = nextSource
    const diagnostics = await this.checkSyntax("", sourceUri, nextSource)
    return {
      diagnostics,
      ...(activate && diagnostics.length === 0
        ? { activation: { success: true, messages: [], inactive: [] } }
        : {}),
      activationSkipped: activate && diagnostics.length > 0
    }
  }

  async activateObject(): Promise<any> {
    return { success: true, messages: [], inactive: [] }
  }

  async validateNewObject(): Promise<any> {
    return { success: true }
  }

  async createObject(options: unknown): Promise<void> {
    this.createdObject = options
  }

  async createTransport(): Promise<string> {
    return "DEVK900001"
  }

  async runQuery(sql: string): Promise<any> {
    if (sql.includes("Z_TOKEN_BUDGET")) {
      return {
        columns: [{ name: "ROW_ID", type: "I", description: "Row" }],
        values: Array.from({ length: 250 }, (_, index) => ({ ROW_ID: index + 1 }))
      }
    }
    return {
      columns: [
        {
          name: "MATNR",
          type: "C",
          description: "Material",
          keyAttribute: true,
          colType: "",
          isKeyFigure: false,
          length: 18
        }
      ],
      values: [{ MATNR: "MAT-002" }, { MATNR: "MAT-001" }]
    }
  }

  async runUnitTests(): Promise<any[]> {
    return [
      {
        "adtcore:uri": `${object.uri}/testclasses/ltcl_demo`,
        "adtcore:type": "CLAS/OL",
        "adtcore:name": "LTCL_DEMO",
        uriType: "",
        durationCategory: "short",
        riskLevel: "harmless",
        alerts: [],
        testmethods: [
          {
            "adtcore:uri": `${object.uri}/testclasses/ltcl_demo/methods/test_run`,
            "adtcore:type": "CLAS/OM",
            "adtcore:name": "TEST_RUN",
            executionTime: 0.01,
            uriType: "",
            unit: "s",
            alerts: []
          }
        ]
      }
    ]
  }

  async createTestInclude(): Promise<void> {}

  async getAtcCustomizing(): Promise<any> {
    return { properties: [{ name: "systemCheckVariant", value: "DEFAULT" }], excemptions: [] }
  }

  async checkAtcVariant(): Promise<string> {
    return "DEFAULT"
  }

  async runAtc(): Promise<any> {
    return { id: "ATC-1", timestamp: 1, infos: [] }
  }

  async getAtcWorklist(): Promise<any> {
    return {
      id: "ATC-1",
      timestamp: 1,
      usedObjectSet: "LAST",
      objectSetIsComplete: true,
      objectSets: [],
      objects: [
        {
          uri: object.uri,
          type: object.type,
          name: object.name,
          packageName: "Z_DEMO",
          author: "DEVELOPER",
          findings: [
            {
              uri: `${object.uri}/atc/1`,
              location: {
                uri: `${object.uri}/source/main`,
                range: {
                  start: { line: 2, column: 2 },
                  end: { line: 2, column: 8 }
                }
              },
              priority: 2,
              checkId: "CHECK",
              checkTitle: "Demo check",
              messageId: "MSG",
              messageTitle: "Demo warning",
              exemptionApproval: "",
              exemptionKind: "",
              link: { href: "/sap/bc/adt/atc/doc/1", rel: "doc", type: "text/html" }
            }
          ]
        }
      ]
    }
  }

  async getAtcDocumentation(): Promise<string> {
    return "<h1>Demo check</h1><p>Fix the warning.</p>"
  }

  async getTextElements(): Promise<any> {
    return {
      programName: object.name,
      textElements: [{ id: "001", text: "Old text", maxLength: 20 }]
    }
  }

  async updateTextElements(): Promise<any> {
    return { success: true, messages: [], inactive: [] }
  }

  async getUserTransports(): Promise<any> {
    return { workbench: [], customizing: [] }
  }

  async getTransportDetails(transportNumber: string): Promise<any> {
    return {
      "tm:number": transportNumber,
      "tm:owner": "DEVELOPER",
      "tm:desc": "Demo transport",
      "tm:status": "D",
      "tm:uri": `/sap/bc/adt/cts/transportrequests/${transportNumber}`,
      links: [],
      objects: [
        {
          "tm:pgmid": "R3TR",
          "tm:type": "CLAS",
          "tm:name": object.name,
          "tm:dummy_uri": object.uri,
          "tm:obj_info": "Demo class"
        }
      ],
      tasks: []
    }
  }

  async getRevisions(): Promise<any[]> {
    return [
      {
        uri: `${object.uri}/revisions/1`,
        date: "2026-07-13T00:00:00Z",
        author: "DEVELOPER",
        version: "DEVK900123",
        versionTitle: "Latest"
      },
      {
        uri: `${object.uri}/revisions/2`,
        date: "2026-07-12T00:00:00Z",
        author: "DEVELOPER",
        version: "DEVK900122",
        versionTitle: "Previous"
      }
    ]
  }

  async getNodeContents(): Promise<any> {
    return { nodes: [], categories: [], objectTypes: [] }
  }

  async startDebugSession(): Promise<any> {
    this.debugActive = true
    return {
      active: true,
      state: "paused",
      mode: "user",
      debugUser: "DEVELOPER",
      breakpointCount: 0
    }
  }

  async stopDebugSession(): Promise<any> {
    this.debugActive = false
    return { active: false, state: "stopped", breakpointCount: 0 }
  }

  getDebugStatus(): any {
    return {
      active: this.debugActive,
      state: this.debugActive ? "paused" : "stopped",
      breakpointCount: 0
    }
  }

  async setDebugBreakpoints(sourceUri: string, lines: number[]): Promise<any[]> {
    return lines.map(line => ({
      kind: "line",
      clientId: "client",
      id: `bp-${line}`,
      nonAbapFlavour: "",
      uri: {
        uri: sourceUri,
        range: {
          start: { line, column: 0 },
          end: { line, column: 0 }
        }
      },
      type: object.type,
      name: object.name
    }))
  }

  async debugStep(): Promise<any> {
    return { result: { isDebuggeeChanged: false }, stack: await this.getDebugStack() }
  }

  async getDebugStack(): Promise<any> {
    return {
      isRfc: false,
      isSameSystem: true,
      serverName: "appserver",
      stack: [
        {
          stackPosition: 0,
          programName: object.name,
          includeName: object.name,
          line: 3,
          eventType: "METHOD",
          eventName: "RUN",
          systemProgram: false,
          uri: { uri: `${object.uri}/source/main` }
        }
      ]
    }
  }

  async getDebugVariables(): Promise<any> {
    return {
      variables: [
        {
          ID: "LV_RESULT",
          NAME: "LV_RESULT",
          DECLARED_TYPE_NAME: "I",
          ACTUAL_TYPE_NAME: "I",
          KIND: "",
          INSTANTIATION_KIND: "",
          ACCESS_KIND: "",
          META_TYPE: "simple",
          PARAMETER_KIND: "",
          VALUE: "43",
          HEX_VALUE: "",
          READ_ONLY: "",
          TECHNICAL_TYPE: "I",
          LENGTH: 4,
          TABLE_BODY: "",
          TABLE_LINES: 0,
          IS_VALUE_INCOMPLETE: "",
          IS_EXCEPTION: "",
          INHERITANCE_LEVEL: 0,
          INHERITANCE_CLASS: ""
        }
      ]
    }
  }

  async getDumps(): Promise<any> {
    return {
      href: "/sap/bc/adt/runtime/dumps",
      title: "Dumps",
      updated: new Date("2026-07-13T00:00:00Z"),
      dumps: [
        {
          id: "DUMP-1",
          author: "DEVELOPER",
          text: "<h1>MESSAGE_TYPE_X</h1><p>Demo dump</p>",
          type: "text/html",
          categories: [{ term: "MESSAGE_TYPE_X", label: "ABAP runtime error" }],
          links: []
        }
      ]
    }
  }

  async getTraceRuns(): Promise<any> {
    return {
      author: "DEVELOPER",
      contributor: "",
      title: "Traces",
      updated: new Date("2026-07-13T00:00:00Z"),
      runs: [
        {
          id: "/sap/bc/adt/runtime/traces/run-1",
          author: "DEVELOPER",
          title: "Demo trace",
          published: new Date("2026-07-13T00:00:00Z"),
          updated: new Date("2026-07-13T00:00:00Z"),
          authorUri: "",
          type: "",
          src: "",
          lang: "EN",
          links: [],
          extendedData: {
            host: "appserver",
            size: 1,
            runtime: 100,
            runtimeABAP: 60,
            runtimeSystem: 10,
            runtimeDatabase: 30,
            expiration: new Date("2026-07-20T00:00:00Z"),
            system: "DEV",
            client: 100,
            isAggregated: false,
            objectName: object.name,
            state: { value: "F", text: "Finished" }
          }
        }
      ]
    }
  }

  async getTraceConfigurations(): Promise<any> {
    return { title: "Configurations", contributorName: "", contributorRole: "", requests: [] }
  }

  async getTraceHitList(): Promise<any> {
    return { parentLink: "", entries: [] }
  }

  async getTraceStatements(): Promise<any> {
    return {
      withDetails: true,
      withSysEvents: true,
      count: 1,
      parentLink: "",
      statements: [
        {
          index: 1,
          id: 1,
          description: "SELECT",
          hitCount: 1,
          hasDetailSubnodes: false,
          hasProcedureLikeSubnodes: false,
          callerId: 0,
          callLevel: 1,
          subnodeCount: 0,
          directSubnodeCount: 0,
          directSubnodeCountProcedureLike: 0,
          hitlistAnchor: 1,
          callingProgram: { context: "", byteCodeOffset: 0, name: object.name },
          grossTime: { time: 30, percentage: 30 },
          traceEventNetTime: { time: 30, percentage: 30 },
          proceduralNetTime: { time: 30, percentage: 30 }
        }
      ]
    }
  }

  async getAdtDiscovery(): Promise<any> {
    return {
      discovery: [
        {
          title: "Repository",
          collection: [{ href: "/sap/bc/adt/repository", templateLinks: [] }]
        }
      ],
      core: [
        {
          title: "Repository",
          collection: { href: "/sap/bc/adt/repository", title: "Repository", category: "repo" }
        }
      ]
    }
  }

  async ping(): Promise<any> {
    return { collections: 1, timestamp: "2026-07-13T00:00:00.000Z" }
  }

  async getSystemInfo(): Promise<SapSystemInfo> {
    return systemInfo(this.profile)
  }
}

test("ConnectionManager logs in once, caches the client, and logs out", async t => {
  const directory = await mkdtemp(join(tmpdir(), "sap-abap-mcp-connection-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const profiles = new ProfileStore(directory)
  const profile = await profiles.upsert({
    id: "DEV100",
    url: "https://sap.example.test",
    client: "100",
    username: "DEVELOPER"
  })
  const secrets = new MemorySecretStore()
  await secrets.set(profile.id, "secret")
  const fake = new FakeSapClient(profile)
  const manager = new ConnectionManager(profiles, secrets, () => fake, profile.id)

  assert.equal(await manager.getClient("dev100"), fake)
  assert.equal(await manager.getClient("DEV100"), fake)
  assert.equal(fake.loginCount, 1)
  await manager.close()
  assert.equal(fake.logoutCount, 1)
})

test("ConnectionManager keeps multiple SAP profiles and clients isolated", async t => {
  const directory = await mkdtemp(join(tmpdir(), "sap-abap-mcp-multi-profile-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const profiles = new ProfileStore(directory)
  const dev = await profiles.upsert({
    id: "DEV100",
    url: "https://sap-dev.example.test",
    client: "100",
    username: "DEV_USER"
  })
  const quality = await profiles.upsert({
    id: "QAS200",
    url: "https://sap-qas.example.test",
    client: "200",
    environment: "quality",
    username: "QAS_USER"
  })
  const secrets = new MemorySecretStore()
  await secrets.set(dev.id, "dev-secret")
  await secrets.set(quality.id, "qas-secret")

  const clients = new Map<string, FakeSapClient>()
  const manager = new ConnectionManager(profiles, secrets, profile => {
    const client = new FakeSapClient(profile)
    clients.set(profile.id, client)
    return client
  })

  assert.deepEqual(
    (await manager.listConnections()).map(connection => connection.id),
    ["DEV100", "QAS200"]
  )
  assert.equal((await manager.getClient("DEV100")).profile.url, dev.url)
  assert.equal((await manager.getClient("QAS200")).profile.url, quality.url)
  assert.notEqual(clients.get("DEV100"), clients.get("QAS200"))
  assert.equal(clients.get("DEV100")?.loginCount, 1)
  assert.equal(clients.get("QAS200")?.loginCount, 1)

  await manager.close()
  assert.equal(clients.get("DEV100")?.logoutCount, 1)
  assert.equal(clients.get("QAS200")?.logoutCount, 1)
})

test("ABAP method extraction returns exact 1-based source lines", () => {
  assert.deepEqual(extractAbapMethod(source, "RUN"), {
    code: ["  METHOD run.", "    result = 42.", "  ENDMETHOD."].join("\n"),
    startLine: 2,
    endLine: 4
  })
})

test("ABAP source replacement requires one exact match", () => {
  assert.match(replaceExactlyOnce(source, "result = 42", "result = 43"), /result = 43/)
  assert.throws(
    () => replaceExactlyOnce("WRITE x.\nWRITE x.", "WRITE x.", "WRITE y."),
    /matched 2 locations/
  )
})

test("write allowlists, production blocking, transports, and read-only SQL are enforced", async () => {
  const makeService = (profile: SapProfile) => {
    const fake = new FakeSapClient(profile)
    return new AbapToolService({
      async listConnections() { return [] },
      async getClient() { return fake }
    })
  }
  const rejectsCode = async (operation: Promise<unknown>, code: string) => {
    await assert.rejects(operation, error =>
      typeof error === "object" && error !== null && "code" in error && error.code === code
    )
  }
  const objectInput = {
    objectType: "CLAS/OC",
    name: "ZCL_SAFE_TEST",
    description: "Safety policy test",
    packageName: "Z_DEMO",
    connectionId: "DEV100"
  }

  await rejectsCode(
    makeService({
      id: "PRD100", url: "https://sap.example.test", client: "100", language: "EN",
      environment: "production", authType: "basic", username: "DEVELOPER",
      allowedPackages: ["Z_DEMO"]
    }).createObjectProgrammatically({ ...objectInput, connectionId: "PRD100" }),
    "PRODUCTION_WRITE_BLOCKED"
  )
  await rejectsCode(
    makeService({
      id: "DEV100", url: "https://sap.example.test", client: "100", language: "EN",
      environment: "development", authType: "basic", username: "DEVELOPER",
      allowedPackages: []
    }).createObjectProgrammatically(objectInput),
    "PACKAGE_NOT_ALLOWED"
  )
  const developmentService = makeService({
    id: "DEV100", url: "https://sap.example.test", client: "100", language: "EN",
    environment: "development", authType: "basic", username: "DEVELOPER",
    allowedPackages: ["Z_DEMO"]
  })
  await rejectsCode(
    developmentService.createObjectProgrammatically(objectInput),
    "TRANSPORT_REQUIRED"
  )
  await rejectsCode(
    developmentService.executeDataQuery({
      sql: "DELETE FROM MARA",
      displayMode: "internal",
      connectionId: "DEV100",
      maxRows: 10,
      rowRange: { start: 0, end: 10 }
    }),
    "QUERY_NOT_READ_ONLY"
  )
})

test("MCP exposes and executes the ABAP FS-compatible tool surface", async t => {
  const profile: SapProfile = {
    id: "DEV100",
    url: "https://sap.example.test",
    client: "100",
    language: "EN",
    environment: "development",
    authType: "basic",
    username: "DEVELOPER",
    allowedPackages: ["Z_DEMO"]
  }
  const fake = new FakeSapClient(profile)
  const summary: ConnectionSummary = {
    id: profile.id,
    url: profile.url,
    client: profile.client,
    language: profile.language,
    environment: profile.environment,
    username: "DEVELOPER",
    credentialAvailable: true
  }
  const service = new AbapToolService({
    async listConnections() {
      return [summary]
    },
    async getClient() {
      return fake
    }
  })
  const server = createMcpServer(service)
  const client = new Client({ name: "test-client", version: "1.0.0" })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  t.after(async () => {
    await client.close()
    await server.close()
  })
  await server.connect(serverTransport)
  await client.connect(clientTransport)

  const listed = await client.listTools()
  assert.deepEqual(
    listed.tools.map(tool => tool.name).sort(),
    [...IMPLEMENTED_TOOL_NAMES].sort()
  )
  const filteredServer = createMcpServer(service, {
    enabledTools: new Set(["get_connected_systems"])
  })
  const filteredClient = new Client({ name: "filtered-test-client", version: "1.0.0" })
  const [filteredClientTransport, filteredServerTransport] =
    InMemoryTransport.createLinkedPair()
  await filteredServer.connect(filteredServerTransport)
  await filteredClient.connect(filteredClientTransport)
  assert.deepEqual(
    (await filteredClient.listTools()).tools.map(tool => tool.name),
    ["get_connected_systems"]
  )
  await filteredClient.close()
  await filteredServer.close()

  const callJson = async (name: string, args: Record<string, unknown>) => {
    const response = await client.callTool({ name, arguments: args })
    const text = (
      (response as { content: Array<{ type: "text"; text: string }> }).content[0] as {
        type: "text"
        text: string
      }
    ).text
    return JSON.parse(text)
  }

  const systems = await callJson("get_connected_systems", {})
  assert.equal(systems.systems[0].id, "DEV100")
  const sapInfo = await callJson("get_sap_system_info", {
    connectionId: "DEV100",
    includeComponents: false
  })
  assert.equal(sapInfo.sapRelease, "758")

  const search = await client.callTool({
    name: "search_abap_objects",
    arguments: {
      pattern: "ZCL_DEMO",
      types: ["CLAS"],
      connectionId: "DEV100"
    }
  })
  const searchText = (
    (search as { content: Array<{ type: "text"; text: string }> }).content[0] as {
      type: "text"
      text: string
    }
  ).text
  assert.equal(JSON.parse(searchText).objects[0].name, "ZCL_DEMO")
  assert.equal(searchText.includes("\n"), false)

  const method = await client.callTool({
    name: "get_abap_object_lines",
    arguments: {
      objectName: "ZCL_DEMO",
      objectType: "CLAS",
      methodName: "RUN",
      connectionId: "DEV100"
    }
  })
  const methodText = (
    (method as { content: Array<{ type: "text"; text: string }> }).content[0] as {
      type: "text"
      text: string
    }
  ).text
  assert.match(JSON.parse(methodText).code, /result = 42/)

  const sourceSearch = await callJson("search_abap_object_lines", {
    objectName: "ZCL_DEMO",
    searchTerm: "result = 42",
    connectionId: "DEV100"
  })
  assert.equal(sourceSearch.matchCount, 1)
  assert.equal(sourceSearch.results[0].matches[0].lineNumber, 3)

  fake.currentSource = Array.from(
    { length: 1000 },
    (_, index) => `result = 42. " ${index} ${"X".repeat(180)}`
  ).join("\n")
  const pagedSearch = await callJson("search_abap_object_lines", {
    objectName: "ZCL_DEMO",
    searchTerm: "result = 42",
    connectionId: "DEV100",
    contextLines: 0,
    startIndex: 10,
    maxResults: 10
  })
  assert.equal(pagedSearch.matchCount, 1000)
  assert.equal(pagedSearch.returnedMatches, 10)
  assert.equal(pagedSearch.nextStartIndex, 20)
  const boundedSource = await callJson("get_abap_object_lines", {
    objectName: "ZCL_DEMO",
    objectType: "CLAS",
    connectionId: "DEV100",
    lineCount: 5000
  })
  assert.equal(boundedSource.truncated, true)
  assert.ok(Buffer.byteLength(JSON.stringify(boundedSource), "utf8") < 100 * 1024)
  fake.currentSource = source

  const info = await callJson("get_abap_object_info", {
    objectName: "ZCL_DEMO",
    objectType: "CLAS",
    connectionId: "DEV100",
    includeStructure: true
  })
  assert.equal(info.totalLines, 5)
  assert.equal(info.structure.metaData["adtcore:name"], "ZCL_DEMO")
  const compactInfo = await callJson("get_abap_object_info", {
    objectName: "ZCL_DEMO",
    objectType: "CLAS",
    connectionId: "DEV100"
  })
  assert.equal(compactInfo.structure, undefined)
  assert.equal(compactInfo.structureSummary.metaData["adtcore:name"], "ZCL_DEMO")

  const batch = await callJson("get_batch_lines", {
    requests: [{ objectName: "ZCL_DEMO", startLine: 1, lineCount: 2 }],
    connectionId: "DEV100"
  })
  assert.equal(batch.results[0].ok, true)
  assert.match(batch.results[0].result.code, /METHOD run/)
  const oversizedBatch = await callJson("get_batch_lines", {
    requests: Array.from(
      { length: 6 },
      () => ({ objectName: "ZCL_DEMO", startLine: 0, lineCount: 1000 })
    ),
    connectionId: "DEV100"
  })
  assert.equal(oversizedBatch.code, "BATCH_LINE_LIMIT")

  const byUri = await callJson("get_object_by_uri", {
    uri: object.uri,
    startLine: 2,
    lineCount: 1,
    connectionId: "DEV100"
  })
  assert.equal(byUri.startLine, 2)
  assert.match(byUri.code, /result = 42/)

  const mermaidValid = await callJson("validate_mermaid_syntax", {
    code: "flowchart TD\n    A[Client] --> B[SAP ADT]"
  })
  assert.equal(mermaidValid.isValid, true)
  assert.equal(mermaidValid.diagramType, "flowchart")
  const mermaidInvalid = await callJson("validate_mermaid_syntax", {
    code: "flowchart TD\n    A -->"
  })
  assert.equal(mermaidInvalid.isValid, false)
  const mermaidStrictError = await callJson("validate_mermaid_syntax", {
    code: "flowchart TD\n    A -->",
    suppressErrors: false
  })
  assert.equal(mermaidStrictError.code, "MERMAID_SYNTAX_INVALID")
  const mermaidType = await callJson("detect_mermaid_diagram_type", {
    code: "sequenceDiagram\n    Client->>SAP: Read"
  })
  assert.equal(mermaidType.detectedType, "sequence")
  const mermaidDocs = await callJson("get_mermaid_documentation", {
    diagramType: "flowchart",
    includeExamples: true
  })
  assert.match(mermaidDocs.documentation.flowchart.syntax, /flowchart TD/)
  const mermaid = await callJson("create_mermaid_diagram", {
    code: "flowchart TD\n    A[Client] --> B[SAP ADT]",
    theme: "neutral"
  })
  t.after(() => rm(dirname(mermaid.htmlPath), { recursive: true, force: true }))
  assert.equal(mermaid.mode, "headless_interactive_html")
  assert.match(await readFile(mermaid.htmlPath, "utf8"), /mermaid\.render/)

  const screenshotDirectory = await mkdtemp(join(tmpdir(), "sap-abap-mcp-screenshot-"))
  t.after(() => rm(screenshotDirectory, { recursive: true, force: true }))
  const screenshotPath = join(screenshotDirectory, "result.png")
  await writeFile(
    screenshotPath,
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64"
    )
  )
  const testDocument = await callJson("create_test_documentation", {
    reportTitle: "Integration Test Report",
    testDate: "13-07-2026",
    scenarios: [{
      scenarioId: 1,
      scenarioName: "Read class",
      scenarioDescription: "Confirms that the class source is readable.",
      screenshots: [{ filePath: screenshotPath, description: "Successful source read" }]
    }]
  })
  t.after(() => rm(dirname(testDocument.outputPath), { recursive: true, force: true }))
  assert.equal(testDocument.embeddedScreenshots, 1)
  assert.ok((await stat(testDocument.outputPath)).size > 1000)
  assert.equal((await readFile(testDocument.outputPath)).subarray(0, 2).toString(), "PK")

  const compatibilityDocs = await callJson("abap_fs_documentation", {
    action: "search_documentation",
    searchQuery: "production writes",
    lineCount: 2
  })
  assert.ok(compatibilityDocs.matchCount >= 1)

  const usages = await callJson("find_where_used", {
    objectName: "ZCL_DEMO",
    objectType: "CLAS",
    connectionId: "DEV100",
    includeSnippets: true,
    filter: { excludeSystemObjects: true }
  })
  assert.equal(usages.count, 1)
  assert.equal(usages.references[0]["adtcore:name"], "ZREP_CALLER")
  assert.equal(usages.snippets[0].snippets[0].uri.start.line, 7)

  const objectUrl = await callJson("get_abap_object_url", {
    objectName: "ZCL_DEMO",
    objectType: "CLAS/OC",
    connectionId: "DEV100"
  })
  assert.equal(objectUrl.transaction, "SE24")
  assert.match(objectUrl.url, /\/sap\/bc\/gui\/sap\/its\/webgui/)

  const workspace = await callJson("get_abap_object_workspace_uri", {
    objectName: "ZCL_DEMO",
    objectType: "CLAS/OC",
    connectionId: "DEV100"
  })
  assert.equal(workspace.workspaceUri, `adt://dev100${object.uri}/source/main`)

  const opened = await callJson("open_object", {
    objectName: "ZCL_DEMO",
    objectType: "CLAS",
    connectionId: "DEV100"
  })
  assert.equal(opened.mode, "headless")
  assert.equal(opened.object.name, "ZCL_DEMO")

  const diagnostics = await callJson("get_abap_diagnostics", {
    fileUri: `adt://dev100${object.uri}/source/main`
  })
  assert.equal(diagnostics.errorCount, 0)

  const replaced = await callJson("replace_string_in_abap_object", {
    fileUri: `adt://dev100${object.uri}/source/main`,
    oldString: "result = 42",
    newString: "result = 43",
    transport: "DEVK900123",
    activate: true
  })
  assert.equal(replaced.changed, true)
  assert.equal(replaced.activation.success, true)
  assert.match(fake.currentSource, /result = 43/)

  const activated = await callJson("abap_activate", {
    url: `adt://dev100${object.uri}/source/main`
  })
  assert.equal(activated.success, true)

  const created = await callJson("create_object_programmatically", {
    objectType: "CLAS/OC",
    name: "ZCL_CREATED",
    description: "Created by integration test",
    packageName: "Z_DEMO",
    connectionId: "DEV100",
    additionalOptions: {
      transportRequest: { type: "existing", number: "DEVK900123" }
    }
  })
  assert.equal(created.success, true)
  assert.equal(created.object.name, "ZCL_CREATED")
  assert.equal((fake.createdObject as { transport: string }).transport, "DEVK900123")

  const query = await callJson("execute_data_query", {
    sql: "SELECT MATNR FROM MARA",
    displayMode: "internal",
    connectionId: "DEV100",
    rowRange: { start: 0, end: 1 },
    sortColumns: [{ column: "MATNR", direction: "asc" }]
  })
  assert.equal(query.returnedRows, 1)
  assert.equal(query.values[0].MATNR, "MAT-001")
  const pagedQuery = await callJson("execute_data_query", {
    sql: "SELECT ROW_ID FROM Z_TOKEN_BUDGET",
    displayMode: "ui",
    connectionId: "DEV100",
    maxRows: 250
  })
  assert.equal(pagedQuery.returnedRows, 100)
  assert.equal(pagedQuery.nextRowStart, 100)
  assert.equal(pagedQuery.truncated, true)
  const secondQueryPage = await callJson("execute_data_query", {
    webviewId: pagedQuery.webviewId,
    displayMode: "internal",
    connectionId: "DEV100",
    rowRange: { start: 100, end: 200 }
  })
  assert.equal(secondQueryPage.values[0].ROW_ID, 101)
  const cachedQuery = await callJson("execute_data_query", {
    webviewId: query.webviewId,
    displayMode: "internal",
    connectionId: "DEV100",
    rowRange: { start: 0, end: 10 },
    resetSorting: true,
    resetFilters: true,
    filters: [{ column: "MATNR", value: "MAT-001" }]
  })
  assert.equal(cachedQuery.webviewId, query.webviewId)
  assert.equal(cachedQuery.returnedRows, 1)
  const queryExportDirectory = await mkdtemp(join(tmpdir(), "sap-abap-mcp-query-export-"))
  t.after(() => rm(queryExportDirectory, { recursive: true, force: true }))
  const csvExport = await callJson("execute_data_query", {
    sql: "SELECT MATNR FROM MARA",
    displayMode: "download_to_file",
    connectionId: "DEV100",
    filePath: join(queryExportDirectory, "materials"),
    fileType: "csv"
  })
  assert.match(await readFile(csvExport.outputPath, "utf8"), /MAT-001/)
  const xlsxExport = await callJson("execute_data_query", {
    sql: "SELECT MATNR FROM MARA",
    displayMode: "download_to_file",
    connectionId: "DEV100",
    filePath: join(queryExportDirectory, "materials"),
    fileType: "xlsx"
  })
  assert.equal((await readFile(xlsxExport.outputPath)).subarray(0, 2).toString(), "PK")

  const sqlSyntax = await callJson("get_abap_sql_syntax", {})
  assert.match(sqlSyntax.rules[0], /SELECT/)

  const atc = await callJson("run_atc_analysis", {
    objectName: "ZCL_DEMO",
    objectType: "CLAS/OC",
    connectionId: "DEV100"
  })
  assert.equal(atc.summary.warnings, 1)
  const decorations = await callJson("get_atc_decorations", {
    fileUri: `adt://dev100${object.uri}/source/main`
  })
  assert.equal(decorations.count, 1)

  const textRead = await callJson("manage_text_elements", {
    objectName: "ZCL_DEMO",
    objectType: "CLASS",
    action: "read",
    connectionId: "DEV100"
  })
  assert.equal(textRead.textElements[0].id, "001")
  const textUpdate = await callJson("manage_text_elements", {
    objectName: "ZCL_DEMO",
    objectType: "CLASS",
    action: "update",
    connectionId: "DEV100",
    transport: "DEVK900123",
    textElements: [{ id: "001", text: "New text", maxLength: 20 }]
  })
  assert.equal(textUpdate.activation.success, true)

  const unit = await callJson("run_unit_tests", {
    objectName: "ZCL_DEMO",
    connectionId: "DEV100"
  })
  assert.equal(unit.allPassed, true)
  assert.equal(unit.classes.length, 0)

  const testInclude = await callJson("create_test_include", {
    className: "ZCL_DEMO",
    connectionId: "DEV100",
    transport: "DEVK900123"
  })
  assert.equal(testInclude.created, true)

  const transport = await callJson("manage_transport_requests", {
    action: "get_transport_objects",
    connectionId: "DEV100",
    transportNumber: "DEVK900123"
  })
  assert.equal(transport.objects[0]["tm:name"], "ZCL_DEMO")

  const versions = await callJson("get_version_history", {
    objectName: "ZCL_DEMO",
    objectType: "CLAS/OC",
    connectionId: "DEV100"
  })
  assert.equal(versions.totalVersions, 2)
  const comparison = await callJson("get_version_history", {
    objectName: "ZCL_DEMO",
    objectType: "CLAS/OC",
    connectionId: "DEV100",
    action: "compare_versions",
    version1: 1,
    version2: 2
  })
  assert.match(comparison.added.join("\n"), /result = 43/)

  const downloadDirectory = await mkdtemp(join(tmpdir(), "sap-abap-mcp-download-"))
  t.after(() => rm(downloadDirectory, { recursive: true, force: true }))
  const download = await callJson("abap_download", {
    source: "ZCL_DEMO",
    target: downloadDirectory,
    connectionId: "DEV100"
  })
  assert.equal(download.files, 1)

  const debugStarted = await callJson("abap_debug_session", {
    connectionId: "DEV100",
    action: "start"
  })
  assert.equal(debugStarted.active, true)
  const breakpoint = await callJson("abap_debug_breakpoint", {
    connectionId: "DEV100",
    filePath: `adt://dev100${object.uri}/source/main`,
    lineNumbers: [3]
  })
  assert.equal(breakpoint.results[0].uri.range.start.line, 3)
  const stack = await callJson("abap_debug_stack", {
    connectionId: "DEV100"
  })
  assert.equal(stack.frames[0].frameId, 1_000_000_000_000)
  const variable = await callJson("abap_debug_variable", {
    connectionId: "DEV100",
    frameId: 1_000_000_000_000,
    variableName: "LV_RESULT"
  })
  assert.equal(variable.variables[0].VALUE, "43")
  const stepped = await callJson("abap_debug_step", {
    connectionId: "DEV100",
    stepType: "stepOver"
  })
  assert.equal(stepped.stack.stack[0].line, 3)
  const debugStatus = await callJson("abap_debug_status", { connectionId: "DEV100" })
  assert.equal(debugStatus.state, "paused")

  const dumps = await callJson("analyze_abap_dumps", {
    action: "list_dumps",
    connectionId: "DEV100"
  })
  assert.equal(dumps.dumps[0].id, "DUMP-1")
  const dump = await callJson("analyze_abap_dumps", {
    action: "analyze_dump",
    connectionId: "DEV100",
    dumpId: "DUMP-1"
  })
  assert.match(dump.dump.plainText, /MESSAGE_TYPE_X/)

  const traces = await callJson("analyze_abap_traces", {
    action: "list_runs",
    connectionId: "DEV100"
  })
  assert.equal(traces.total, 1)
  const statements = await callJson("analyze_abap_traces", {
    action: "get_statements",
    connectionId: "DEV100",
    traceId: "/sap/bc/adt/runtime/traces/run-1"
  })
  assert.equal(statements.statements[0].description, "SELECT")

  const heartbeatTask = await callJson("manage_heartbeat", {
    action: "add_task",
    description: "Watch materials",
    connectionId: "DEV100",
    sampleQuery: "SELECT MATNR FROM MARA",
    alertThreshold: 1,
    maxChecks: 2
  })
  assert.equal(heartbeatTask.task.enabled, true)
  const heartbeat = await callJson("manage_heartbeat", {
    action: "trigger",
    reason: "integration test"
  })
  assert.equal(heartbeat.results[0].status, "threshold_exceeded")
  const heartbeatHistory = await callJson("manage_heartbeat", {
    action: "history",
    count: 1
  })
  assert.equal(heartbeatHistory.entries.length, 1)
  const reminder = await callJson("manage_heartbeat", {
    action: "add_task",
    description: "Review transport",
    reminderOnly: true,
    startAt: "2026-07-13T00:00:00.000Z"
  })
  assert.equal(reminder.task.removeWhenDone, true)
  await callJson("manage_heartbeat", { action: "trigger", reason: "reminder test" })
  const tasksAfterReminder = await callJson("manage_heartbeat", { action: "list_tasks" })
  assert.equal(tasksAfterReminder.tasks.some((task: any) => task.id === reminder.task.id), false)

  const discovery = await callJson("adt_discovery_export", { connectionId: "DEV100" })
  assert.equal(discovery.summary.services, 1)
  assert.equal(discovery.discovery, undefined)

  const debugStopped = await callJson("abap_debug_session", {
    connectionId: "DEV100",
    action: "stop"
  })
  assert.equal(debugStopped.active, false)
})

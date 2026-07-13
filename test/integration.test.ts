import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { ConnectionManager, type ConnectionSummary } from "../src/connection-manager.js"
import { createMcpServer } from "../src/mcp-server.js"
import { ProfileStore, type SapProfile } from "../src/profile-store.js"
import { MemorySecretStore } from "../src/secret-store.js"
import type {
  SapClient,
  SapObjectReference,
  SapObjectSource,
  SapSystemInfo
} from "../src/sap-client.js"
import { AbapToolService, extractAbapMethod } from "../src/tool-service.js"

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
    if (objectType && objectType !== "CLAS") return []
    return [object]
  }

  async readObject(reference: SapObjectReference): Promise<SapObjectSource> {
    return { source, sourceUri: `${reference.uri}/source/main`, object: reference }
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

test("MCP exposes and executes the first ABAP FS-compatible vertical slice", async t => {
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
    [
      "get_abap_object_lines",
      "get_connected_systems",
      "get_sap_system_info",
      "search_abap_objects"
    ]
  )

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
})

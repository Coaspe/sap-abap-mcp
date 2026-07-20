import assert from "node:assert/strict"
import test from "node:test"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import {
  ResourceTemplate,
  type McpServer,
  type RegisteredResource,
  type RegisteredResourceTemplate
} from "@modelcontextprotocol/sdk/server/mcp.js"
import {
  ErrorCode,
  McpError,
  type CallToolResult
} from "@modelcontextprotocol/sdk/types.js"
import { AdtErrorException } from "abap-adt-api"
import { createMcpServer } from "../src/mcp-server.js"
import { V1_ERROR_SCHEMA } from "../src/mcp/v1/contracts.js"
import type { V1ReadService } from "../src/mcp/v1/service.js"
import type { SapClient } from "../src/sap-client.js"
import { AbapToolService } from "../src/tool-service.js"

const SECRET_DIAGNOSTIC = [
  "GET https://url-user:url-pass@sap.example.test failed",
  "Authorization=Basic basic-assignment-secret",
  "Authorization: Bearer bearer-header-secret",
  "token=bearer-assignment-secret",
  "client_secret=client-secret-value",
  "clientsecret=compact-secret-value",
  "api_key=api-key-value",
  "Proxy-Authorization: Basic proxy-secret-value",
  'client_secret="prefix\\"escaped-quote-secret"',
  '{\n  "client_secret":\n    "pretty-json-secret"\n}',
  "Authorization:\n  Basic\n  folded-authorization-secret"
].join("\n")

const SECRET_VALUES = [
  "url-user",
  "url-pass",
  "basic-assignment-secret",
  "bearer-header-secret",
  "bearer-assignment-secret",
  "client-secret-value",
  "compact-secret-value",
  "api-key-value",
  "proxy-secret-value",
  "escaped-quote-secret",
  "pretty-json-secret",
  "folded-authorization-secret"
]

const MULTILINE_SECRET_DIAGNOSTIC = `{
  "client_secret"
  :
  "newline-colon-secret"
}
Authorization:
  Basic
  first-continuation-secret
  second-continuation-secret`

const MULTILINE_SECRET_VALUES = [
  "newline-colon-secret",
  "first-continuation-secret",
  "second-continuation-secret"
]

const RAW_ABAP_SOURCE = [
  "REPORT z_secret_literals.",
  "DATA(url) = 'https://code-user:code-pass@example.test'.",
  "DATA(auth) = 'Authorization=Basic code-secret'.",
  "DATA(client_secret) = 'raw-client-secret'.",
  "DATA(api_key) = 'raw-api-key'.",
  "DATA(proxy_auth) = 'Proxy-Authorization: Basic raw-proxy-secret'.",
  `'client_secret="raw-prefix\\"raw-escaped-secret"'.`,
  "* client_secret:",
  "*   'raw-multiline-secret'.",
  "* Authorization:",
  "*   Basic raw-folded-secret."
].join("\n")

function unused<T>(name: string): T {
  return (async () => {
    throw new Error(`${name} was not expected`)
  }) as T
}

function baseService(overrides: Partial<V1ReadService> = {}): V1ReadService {
  return {
    getConnectedSystems: unused<V1ReadService["getConnectedSystems"]>("getConnectedSystems"),
    getSapSystemInfo: unused<V1ReadService["getSapSystemInfo"]>("getSapSystemInfo"),
    getSapCapabilities: unused<V1ReadService["getSapCapabilities"]>("getSapCapabilities"),
    searchObjects: unused<V1ReadService["searchObjects"]>("searchObjects"),
    getObjectLines: unused<V1ReadService["getObjectLines"]>("getObjectLines"),
    getObjectByUri: unused<V1ReadService["getObjectByUri"]>("getObjectByUri"),
    ...overrides
  }
}

function systemInfo(warnings: string[] = []) {
  return {
    profileId: "DEV100",
    url: "https://sap.example.test",
    client: "100",
    language: "EN",
    environment: "development" as const,
    username: "DEVELOPER",
    sapRelease: "758",
    systemType: "S/4HANA" as const,
    logicalSystem: "DEVCLNT100",
    clientName: "Development",
    timezone: null,
    softwareComponents: [],
    discoveryCollections: 1,
    warnings,
    queryTimestamp: "2026-07-20T00:00:00.000Z"
  }
}

function capabilityResult(warnings: string[], evidence: string[]) {
  return {
    connectionId: "DEV100",
    adapterVersion: "abap-adt-api@8.4.1",
    systemMetadata: {
      environment: "development" as const,
      sapRelease: "758",
      systemType: "S/4HANA" as const,
      logicalSystem: "DEVCLNT100",
      discoveryCollections: 1,
      warnings
    },
    capabilities: [{
      id: "repository.activate.batch",
      category: "repository" as const,
      implementation: "implemented" as const,
      system: "advertised" as const,
      authorization: "allowed" as const,
      status: "supported" as const,
      evidence,
      lastObservedAt: null
    }]
  }
}

async function connectedClient(
  service: V1ReadService | AbapToolService,
  configure?: (server: McpServer) => void
) {
  const server = createMcpServer(service as AbapToolService, { apiVersion: "v1" })
  configure?.(server)
  const client = new Client({ name: "v1-final-hardening", version: "1.0.0" })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  await client.connect(clientTransport)
  return {
    server,
    client,
    async close() {
      await client.close()
      await server.close()
    }
  }
}

function text(result: CallToolResult): string {
  const content = result.content[0]
  assert.equal(content?.type, "text")
  if (content?.type !== "text") throw new Error("expected text content")
  return content.text
}

function resourceText(result: { contents: Array<{ text: string } | { blob: string }> }): string {
  const content = result.contents[0]
  return content && "text" in content ? content.text : ""
}

function assertSecretsAbsent(
  serialized: string,
  secrets: readonly string[] = SECRET_VALUES
): void {
  for (const secret of secrets) {
    assert.equal(serialized.includes(secret), false)
  }
}

async function assertResourceError(
  operation: () => Promise<unknown>,
  code: ErrorCode
): Promise<McpError> {
  let captured: McpError | undefined
  await assert.rejects(operation, (error: unknown) => {
    assert.ok(error instanceof McpError)
    assert.equal(error.code, code)
    captured = error
    return true
  })
  assert.ok(captured)
  return captured
}

async function completionValues(
  client: Client,
  uri: string,
  argumentName: string
): Promise<string[]> {
  return (await client.complete({
    ref: { type: "ref/resource", uri },
    argument: { name: argumentName, value: "v" }
  })).completion.values
}

async function assertInvalidCompletion(
  client: Client,
  uri: string,
  argumentName: string
): Promise<void> {
  await assertResourceError(
    () => client.complete({
      ref: { type: "ref/resource", uri },
      argument: { name: argumentName, value: "v" }
    }),
    ErrorCode.InvalidParams
  )
}

function completionTemplate(
  uriTemplate: string,
  argumentName: string,
  suffix: string
): ResourceTemplate {
  return new ResourceTemplate(uriTemplate, {
    list: undefined,
    complete: { [argumentName]: value => [`${value}-${suffix}`] }
  })
}

function registerDynamicPair(
  server: McpServer,
  label: "modern" | "deprecated"
): void {
  const fixedCallback = async (uri: URL) => ({
    contents: [{ uri: uri.href, text: `${label} fixed` }]
  })
  const templateCallback = async (uri: URL) => ({
    contents: [{ uri: uri.href, text: `${label} template` }]
  })
  const template = completionTemplate(
    `${label}-template://{name}`,
    "name",
    label
  )
  if (label === "deprecated") {
    server.resource(`${label}-fixed`, `${label}-fixed://one`, fixedCallback)
    server.resource(`${label}-template`, template, templateCallback)
    return
  }
  server.registerResource(`${label}-fixed`, `${label}-fixed://one`, {}, fixedCallback)
  server.registerResource(`${label}-template`, template, {}, templateCallback)
}

test("v1 tool errors sanitize direct and multiline credentials", async t => {
  for (const [diagnostic, secrets] of [
    [SECRET_DIAGNOSTIC, SECRET_VALUES],
    [MULTILINE_SECRET_DIAGNOSTIC, MULTILINE_SECRET_VALUES]
  ] as const) {
    const connection = await connectedClient(baseService({
      async getSapSystemInfo() { throw new Error(diagnostic) }
    }))
    t.after(() => connection.close())
    const result = await connection.client.callTool({
      name: "sap.system.inspect",
      arguments: { systemId: "DEV100" }
    }) as CallToolResult
    assert.equal(result.isError, true)
    assertSecretsAbsent(text(result), secrets)
  }
})

test("v1 partial warnings use the shared bounded sanitizer", async t => {
  const connection = await connectedClient(baseService({
    async getSapSystemInfo() {
      return systemInfo([`${SECRET_DIAGNOSTIC}\n${"詳".repeat(1_000)}`])
    }
  }))
  t.after(() => connection.close())

  const result = await connection.client.callTool({
    name: "sap.system.inspect",
    arguments: { systemId: "DEV100" }
  }) as CallToolResult
  const warning = (
    result.structuredContent?.warnings as Array<{ message: string }>
  )[0]?.message ?? ""

  assert.equal(result.structuredContent?.status, "partial")
  assertSecretsAbsent(JSON.stringify(result))
  assert.ok(Buffer.byteLength(warning, "utf8") <= 512)
  assert.match(warning, /\[TRUNCATED\]$/)
})

test("v1 capability tool and Resource recursively sanitize warnings and evidence", async t => {
  const connection = await connectedClient(baseService({
    async getSapCapabilities() {
      return capabilityResult([SECRET_DIAGNOSTIC], [SECRET_DIAGNOSTIC])
    }
  }))
  t.after(() => connection.close())

  const tool = await connection.client.callTool({
    name: "sap.system.capabilities",
    arguments: { systemId: "DEV100", includeEvidence: true }
  }) as CallToolResult
  const resource = await connection.client.readResource({
    uri: "sap-capability://dev100"
  })

  assertSecretsAbsent(JSON.stringify(tool))
  assertSecretsAbsent(JSON.stringify(resource))
})

test("v1 source Tool and Resource preserve raw ABAP source text", async t => {
  const connection = await connectedClient(baseService({
    async getObjectLines(input) {
      return {
        connectionId: input.connectionId,
        object: { name: input.objectName, type: "PROG" },
        sourceUri: "/sap/bc/adt/programs/programs/z_secret_literals/source/main",
        startLine: 1,
        endLine: 3,
        totalLines: 3,
        truncated: false,
        nextLine: null,
        code: RAW_ABAP_SOURCE
      }
    },
    async getObjectByUri(input) {
      return {
        connectionId: input.connectionId,
        requestedUri: input.uri,
        sourceUri: input.uri,
        startLine: 0,
        endLine: 3,
        totalLines: 3,
        truncated: false,
        nextLine: null,
        code: RAW_ABAP_SOURCE
      }
    }
  }))
  t.after(() => connection.close())

  const tool = await connection.client.callTool({
    name: "sap.source.read",
    arguments: { systemId: "DEV100", objectName: "Z_SECRET_LITERALS" }
  }) as CallToolResult
  const resource = await connection.client.readResource({
    uri: "adt://dev100/sap/bc/adt/programs/programs/z_secret_literals/source/main"
  })
  const resourceContent = resource.contents[0]

  assert.equal((tool.structuredContent?.data as { code: string }).code, RAW_ABAP_SOURCE)
  assert.ok(resourceContent && "text" in resourceContent)
  assert.equal(resourceContent && "text" in resourceContent ? resourceContent.text : "", RAW_ABAP_SOURCE)
})

test("typed ADT errors normalize through the real AbapToolService boundary", async t => {
  const cases = [
    { status: 401, code: "AUTH_REQUIRED", category: "authentication", retryable: false },
    { status: 403, code: "SAP_AUTHORIZATION_DENIED", category: "authorization", retryable: false },
    { status: 429, code: "SAP_OPERATION_FAILED", category: "sap", retryable: true },
    { status: 502, code: "SAP_OPERATION_FAILED", category: "sap", retryable: true },
    { status: 503, code: "SAP_OPERATION_FAILED", category: "sap", retryable: true },
    { status: 504, code: "SAP_OPERATION_FAILED", category: "sap", retryable: true },
    { status: 500, code: "SAP_OPERATION_FAILED", category: "sap", retryable: false }
  ] as const

  for (const expected of cases) {
    await t.test(String(expected.status), async t => {
      const error = AdtErrorException.create(
        expected.status,
        {},
        "",
        `typed ADT ${expected.status}`
      )
      const clientDouble = {
        async getSystemInfo() { throw error }
      } as unknown as SapClient
      const service = new AbapToolService({
        async listConnections() { return [] },
        async getClient() { return clientDouble }
      })
      const connection = await connectedClient(service)
      t.after(() => connection.close())

      const result = await connection.client.callTool({
        name: "sap.system.inspect",
        arguments: { systemId: "DEV100" }
      }) as CallToolResult
      const payload = V1_ERROR_SCHEMA.parse(JSON.parse(text(result)))

      assert.equal(payload.code, expected.code)
      assert.equal(payload.category, expected.category)
      assert.equal(payload.retryable, expected.retryable)
      assert.equal(payload.details?.httpStatus, expected.status)
    })
  }
})

test("both Resource service failures stay Resource errors with sanitized messages", async t => {
  const connection = await connectedClient(baseService({
    async getSapCapabilities() { throw new Error(SECRET_DIAGNOSTIC) },
    async getObjectByUri() { throw new Error(SECRET_DIAGNOSTIC) }
  }))
  t.after(() => connection.close())

  for (const uri of [
    "sap-capability://dev100",
    "adt://dev100/sap/bc/adt/oo/classes/zcl_demo/source/main"
  ]) {
    const error = await assertResourceError(
      () => connection.client.readResource({ uri }),
      ErrorCode.InternalError
    )
    assertSecretsAbsent(error.message)
    assert.equal((error.message.match(/MCP error -32603:/g) ?? []).length, 1)
  }
})

test("Resource service failures have one exact client-side MCP prefix", async t => {
  const connection = await connectedClient(baseService({
    async getSapCapabilities() { throw new Error("upstream unavailable") }
  }))
  t.after(() => connection.close())

  const error = await assertResourceError(
    () => connection.client.readResource({ uri: "sap-capability://dev100" }),
    ErrorCode.InternalError
  )

  assert.equal(error.message, "MCP error -32603: upstream unavailable")
})

test("async Resource list, read, and completion failures sanitize multiline secrets", async t => {
  const failAsync = async () => {
    await Promise.resolve()
    throw new Error(MULTILINE_SECRET_DIAGNOSTIC)
  }
  const connection = await connectedClient(baseService(), server => {
    server.registerResource(
      "async-read-error",
      "error-fixed://one",
      {},
      failAsync
    )
    server.registerResource(
      "async-template-error",
      new ResourceTemplate("error-template://{name}", {
        list: failAsync,
        complete: { name: failAsync }
      }),
      {},
      async uri => ({ contents: [{ uri: uri.href, text: "unused" }] })
    )
  })
  t.after(() => connection.close())

  for (const operation of [
    () => connection.client.listResources(),
    () => connection.client.readResource({ uri: "error-fixed://one" }),
    () => connection.client.complete({
      ref: { type: "ref/resource" as const, uri: "error-template://{name}" },
      argument: { name: "name", value: "v" }
    })
  ]) {
    const error = await assertResourceError(operation, ErrorCode.InternalError)
    assertSecretsAbsent(error.message, MULTILINE_SECRET_VALUES)
    assert.equal((error.message.match(/MCP error -32603:/g) ?? []).length, 1)
  }
})

test("raw C0 controls in Resource authorities and paths are invalid params with zero SAP calls", async t => {
  let calls = 0
  const connection = await connectedClient(baseService({
    async getObjectByUri(input) {
      calls += 1
      return {
        connectionId: input.connectionId,
        requestedUri: input.uri,
        sourceUri: input.uri,
        startLine: 0,
        endLine: 1,
        totalLines: 1,
        truncated: false,
        nextLine: null,
        code: "REPORT zsafe."
      }
    }
  }))
  t.after(() => connection.close())

  for (let codePoint = 0; codePoint <= 0x1f; codePoint += 1) {
    const control = String.fromCodePoint(codePoint)
    for (const uri of [
      `adt://dev${control}100/sap/bc/adt/oo/classes/zcl_demo/source/main`,
      `adt://dev100/sap/bc/adt/oo/classes/zcl${control}demo/source/main`
    ]) {
      await assertResourceError(
        () => connection.client.readResource({ uri }),
        ErrorCode.InvalidParams
      )
    }
  }

  assert.equal(calls, 0)
})

test("actual ADT Resource reads preserve ordinary and trailing path spaces", async t => {
  const requestedPaths: string[] = []
  const connection = await connectedClient(baseService({
    async getObjectByUri(input) {
      requestedPaths.push(input.uri)
      return {
        connectionId: input.connectionId,
        requestedUri: input.uri,
        sourceUri: input.uri,
        startLine: 0,
        endLine: 1,
        totalLines: 1,
        truncated: false,
        nextLine: null,
        code: "REPORT zspace."
      }
    }
  }))
  t.after(() => connection.close())

  const uri = "adt://dev100/sap/bc/adt/oo/classes/zcl demo/source/main "
  const result = await connection.client.readResource({ uri })

  assert.deepEqual(requestedPaths, [
    "/sap/bc/adt/oo/classes/zcl%20demo/source/main%20"
  ])
  assert.equal(
    result.contents[0]?.uri,
    "adt://dev100/sap/bc/adt/oo/classes/zcl%20demo/source/main%20"
  )
})

test("actual v1 Resource reads reject explicit empty userinfo and port syntax", async t => {
  let calls = 0
  const connection = await connectedClient(baseService({
    async getSapCapabilities() {
      calls += 1
      return capabilityResult([], [])
    },
    async getObjectByUri() {
      calls += 1
      throw new Error("must not be called")
    }
  }))
  t.after(() => connection.close())

  for (const uri of [
    "adt://@dev100/sap/bc/adt/oo/classes/zcl_demo",
    "adt://:@dev100/sap/bc/adt/oo/classes/zcl_demo",
    "adt://dev100:/sap/bc/adt/oo/classes/zcl_demo",
    "sap-capability://@dev100",
    "sap-capability://:@dev100",
    "sap-capability://dev100:"
  ]) {
    await assertResourceError(
      () => connection.client.readResource({ uri }),
      ErrorCode.InvalidParams
    )
  }

  assert.equal(calls, 0)
})

test("Resource URI validation is invalid params while preserving template metadata", async t => {
  let calls = 0
  const connection = await connectedClient(baseService({
    async getObjectByUri() {
      calls += 1
      throw new Error("must not be called")
    }
  }))
  t.after(() => connection.close())

  for (const uri of [
    "adt://dev100/not/adt",
    "adt://dev100/sap/bc/adt/oo/classes/zcl_demo?version=active",
    "adt://dev100/sap/bc/adt/oo/classes/zcl_demo#source"
  ]) {
    await assertResourceError(
      () => connection.client.readResource({ uri }),
      ErrorCode.InvalidParams
    )
  }
  assert.equal(calls, 0)

  assert.deepEqual(
    (await connection.client.listResourceTemplates()).resourceTemplates,
    [{
      name: "sap-capability-evidence",
      title: "SAP Capability Evidence",
      description: "Complete capability discovery evidence for one SAP system.",
      uriTemplate: "sap-capability://{system}",
      mimeType: "application/json"
    }, {
      name: "sap-adt-source",
      title: "SAP ABAP Source",
      description: "Complete active ABAP source for one canonical ADT resource.",
      uriTemplate: "adt://{system}/{+adtPath}",
      mimeType: "text/x-abap"
    }]
  )
})

test("exact fixed ADT and capability Resources win before built-in templates", async t => {
  let sapCalls = 0
  const connection = await connectedClient(baseService({
    async getSapCapabilities() {
      sapCalls += 1
      return capabilityResult([], [])
    },
    async getObjectByUri() {
      sapCalls += 1
      throw new Error("built-in ADT callback must not run")
    }
  }), server => {
    server.registerResource(
      "exact-fixed-adt",
      "adt://dev100/sap/bc/adt/oo/classes/zcl_exact",
      { mimeType: "text/plain" },
      async uri => ({ contents: [{ uri: uri.href, text: "fixed ADT" }] })
    )
    server.registerResource(
      "exact-fixed-capability",
      "sap-capability://dev100",
      { mimeType: "text/plain" },
      async uri => ({ contents: [{ uri: uri.href, text: "fixed capability" }] })
    )
  })
  t.after(() => connection.close())

  assert.equal(
    resourceText(await connection.client.readResource({
      uri: "adt://dev100/sap/bc/adt/oo/classes/zcl_exact"
    })),
    "fixed ADT"
  )
  assert.equal(
    resourceText(await connection.client.readResource({
      uri: "sap-capability://dev100"
    })),
    "fixed capability"
  )
  assert.equal(sapCalls, 0)
})

test("a dynamic fixed Resource uses canonical identity for reads and duplicates", async t => {
  const connection = await connectedClient(baseService(), server => {
    server.registerResource(
      "third-fixed-resource",
      "HTTP://EXAMPLE.com:80/item",
      {
        title: "Third Fixed Resource",
        description: "A fixed Resource registered by a caller.",
        mimeType: "text/plain"
      },
      async uri => ({
        contents: [{ uri: uri.href, mimeType: "text/plain", text: "third content" }]
      })
    )
  })
  t.after(() => connection.close())

  const listed = (await connection.client.listResources()).resources.find(
    resource => resource.name === "third-fixed-resource"
  )
  assert.deepEqual(listed, {
    name: "third-fixed-resource",
    title: "Third Fixed Resource",
    description: "A fixed Resource registered by a caller.",
    uri: "HTTP://EXAMPLE.com:80/item",
    mimeType: "text/plain"
  })

  const read = await connection.client.readResource({ uri: "http://example.com/item" })
  assert.equal(read.contents[0] && "text" in read.contents[0] ? read.contents[0].text : "", "third content")
  assert.throws(() => connection.server.registerResource(
    "third-fixed-duplicate",
    "http://example.com/item",
    {},
    async uri => ({ contents: [{ uri: uri.href, text: "duplicate" }] })
  ))
})

test("post-creation fixed and template Resources retain update, enable, disable, and remove behavior", async t => {
  let fixed: RegisteredResource | undefined
  let template: RegisteredResourceTemplate | undefined
  let lifecycleServer: McpServer | undefined
  const connection = await connectedClient(baseService(), server => {
    lifecycleServer = server
    fixed = server.registerResource(
      "lifecycle-fixed",
      "memo://example/original",
      { mimeType: "text/plain" },
      async uri => ({ contents: [{ uri: uri.href, text: "fixed-original" }] })
    )
    template = server.registerResource(
      "lifecycle-template",
      completionTemplate("memo-template://{name}", "name", "original"),
      { mimeType: "text/plain" },
      async (uri, variables) => ({
        contents: [{ uri: uri.href, text: `template-original:${variables.name}` }]
      })
    )
  })
  t.after(() => connection.close())
  assert.ok(fixed)
  assert.ok(template)
  assert.deepEqual(
    await completionValues(connection.client, "memo-template://{name}", "name"),
    ["v-original"]
  )

  fixed.update({
    name: "lifecycle-fixed-updated",
    title: "Fixed updated",
    uri: "memo://example/updated",
    metadata: {
      description: "Fixed updated description",
      mimeType: "text/updated"
    },
    callback: async uri => ({ contents: [{ uri: uri.href, text: "fixed-updated" }] })
  })
  assert.equal(
    resourceText(await connection.client.readResource({ uri: "memo://example/updated" })),
    "fixed-updated"
  )
  assert.deepEqual(
    await completionValues(connection.client, "memo://example/updated", "unused"),
    []
  )
  const fixedAfterUpdate = await connection.client.listResources()
  assert.equal(fixedAfterUpdate.resources.some(resource =>
    resource.uri === "memo://example/original"
  ), false)
  assert.deepEqual(fixedAfterUpdate.resources.find(resource =>
    resource.uri === "memo://example/updated"
  ), {
    uri: "memo://example/updated",
    name: "lifecycle-fixed-updated",
    title: "Fixed updated",
    description: "Fixed updated description",
    mimeType: "text/updated"
  })
  assert.throws(() => lifecycleServer?.registerResource(
    "duplicate-fixed",
    "memo://example/updated",
    { mimeType: "text/plain" },
    async uri => ({ contents: [{ uri: uri.href, text: "duplicate" }] })
  ))
  await assertResourceError(
    () => connection.client.readResource({ uri: "memo://example/original" }),
    ErrorCode.InvalidParams
  )
  await assertInvalidCompletion(
    connection.client,
    "memo://example/original",
    "unused"
  )
  assert.ok(lifecycleServer)
  const oldFixedReplacement = lifecycleServer.registerResource(
    "replacement-fixed-original",
    "memo://example/original",
    { mimeType: "text/plain" },
    async uri => ({ contents: [{ uri: uri.href, text: "replacement original" }] })
  )
  assert.equal(
    resourceText(await connection.client.readResource({ uri: "memo://example/original" })),
    "replacement original"
  )
  assert.deepEqual(
    await completionValues(connection.client, "memo://example/original", "unused"),
    []
  )
  oldFixedReplacement.remove()
  assert.equal((await connection.client.listResources()).resources.some(resource =>
    resource.uri === "memo://example/original"
  ), false)
  await assertInvalidCompletion(
    connection.client,
    "memo://example/original",
    "unused"
  )
  fixed.disable()
  await assertResourceError(
    () => connection.client.readResource({ uri: "memo://example/updated" }),
    ErrorCode.InvalidParams
  )
  fixed.enable()
  assert.equal(
    resourceText(await connection.client.readResource({ uri: "memo://example/updated" })),
    "fixed-updated"
  )

  template.update({
    name: "lifecycle-template-updated",
    title: "Template updated",
    template: completionTemplate("note-template://{name}", "name", "updated"),
    metadata: {
      description: "Template updated description",
      mimeType: "text/updated"
    },
    callback: async (uri, variables) => ({
      contents: [{ uri: uri.href, text: `template-updated:${variables.name}` }]
    })
  })
  await assertResourceError(
    () => connection.client.readResource({ uri: "memo-template://first" }),
    ErrorCode.InvalidParams
  )
  await assertInvalidCompletion(connection.client, "memo-template://{name}", "name")
  assert.equal(
    resourceText(await connection.client.readResource({ uri: "note-template://second" })),
    "template-updated:second"
  )
  assert.deepEqual(
    await completionValues(
      connection.client,
      "note-template://{name}",
      "name"
    ),
    ["v-updated"]
  )
  const templatesAfterUpdate = await connection.client.listResourceTemplates()
  assert.equal(templatesAfterUpdate.resourceTemplates.some(entry =>
    entry.name === "lifecycle-template"
  ), false)
  assert.deepEqual(templatesAfterUpdate.resourceTemplates.find(entry =>
    entry.name === "lifecycle-template-updated"
  ), {
    name: "lifecycle-template-updated",
    uriTemplate: "note-template://{name}",
    title: "Template updated",
    description: "Template updated description",
    mimeType: "text/updated"
  })
  assert.throws(() => lifecycleServer?.registerResource(
    "lifecycle-template-updated",
    new ResourceTemplate("duplicate-template://{name}", { list: undefined }),
    { mimeType: "text/plain" },
    async uri => ({ contents: [{ uri: uri.href, text: "duplicate" }] })
  ))
  template.disable()
  await assertResourceError(
    () => connection.client.readResource({ uri: "note-template://second" }),
    ErrorCode.InvalidParams
  )
  template.enable()
  assert.equal(
    resourceText(await connection.client.readResource({ uri: "note-template://third" })),
    "template-updated:third"
  )

  fixed.remove()
  template.remove()
  assert.equal((await connection.client.listResources()).resources.some(resource =>
    resource.uri === "memo://example/updated"
  ), false)
  assert.equal((await connection.client.listResourceTemplates()).resourceTemplates.some(entry =>
    entry.name === "lifecycle-template-updated"
  ), false)
  await assertResourceError(
    () => connection.client.readResource({ uri: "memo://example/updated" }),
    ErrorCode.InvalidParams
  )
  await assertResourceError(
    () => connection.client.readResource({ uri: "note-template://third" }),
    ErrorCode.InvalidParams
  )
  await assertInvalidCompletion(
    connection.client,
    "note-template://{name}",
    "name"
  )

  assert.ok(lifecycleServer)
  lifecycleServer.registerResource(
    "replacement-fixed",
    "memo://example/updated",
    { mimeType: "text/plain" },
    async uri => ({ contents: [{ uri: uri.href, text: "replacement fixed" }] })
  )
  lifecycleServer.registerResource(
    "lifecycle-template-updated",
    completionTemplate("note-template://{name}", "name", "replacement"),
    { mimeType: "text/plain" },
    async uri => ({ contents: [{ uri: uri.href, text: "replacement template" }] })
  )
  assert.equal(
    resourceText(await connection.client.readResource({ uri: "memo://example/updated" })),
    "replacement fixed"
  )
  assert.equal(
    resourceText(await connection.client.readResource({ uri: "note-template://fourth" })),
    "replacement template"
  )
  assert.deepEqual(
    await completionValues(connection.client, "note-template://{name}", "name"),
    ["v-replacement"]
  )
})

test("modern and deprecated dynamic Resources share discovery, reads, and completion", async t => {
  const connection = await connectedClient(baseService(), server => {
    registerDynamicPair(server, "modern")
    registerDynamicPair(server, "deprecated")
  })
  t.after(() => connection.close())

  const resources = await connection.client.listResources()
  const templates = await connection.client.listResourceTemplates()
  for (const label of ["modern", "deprecated"] as const) {
    assert.equal(resources.resources.some(resource =>
      resource.name === `${label}-fixed`
    ), true)
    assert.equal(templates.resourceTemplates.some(template =>
      template.name === `${label}-template`
    ), true)
    for (const kind of ["fixed", "template"] as const) {
      assert.equal(resourceText(await connection.client.readResource({
        uri: `${label}-${kind}://one`
      })), `${label} ${kind}`)
    }
    assert.deepEqual(
      await completionValues(
        connection.client,
        `${label}-template://{name}`,
        "name"
      ),
      [`v-${label}`]
    )
  }
})

test("Template discovery merges metadata and excludes disabled callbacks", async t => {
  let template: RegisteredResourceTemplate | undefined
  let listCalls = 0
  let readCalls = 0
  let completionCalls = 0
  const connection = await connectedClient(baseService(), server => {
    template = server.registerResource(
      "catalog-template",
      new ResourceTemplate("catalog://{name}", {
        list: async () => {
          listCalls += 1
          return { resources: [{
            uri: "catalog://one",
            name: "catalog-one",
            title: "Listed title",
            mimeType: "text/plain"
          }] }
        },
        complete: { name: async value => {
          completionCalls += 1
          return [`${value}-catalog`]
        } }
      }),
      {
        title: "Template title",
        description: "Template description",
        mimeType: "application/json"
      },
      async uri => {
        readCalls += 1
        return { contents: [{ uri: uri.href, text: "catalog" }] }
      }
    )
  })
  t.after(() => connection.close())

  const listed = (await connection.client.listResources()).resources.find(resource =>
    resource.uri === "catalog://one"
  )
  assert.deepEqual(listed, {
    uri: "catalog://one",
    name: "catalog-one",
    title: "Listed title",
    description: "Template description",
    mimeType: "text/plain"
  })
  assert.equal(listCalls, 1)
  assert.ok(template)
  template.disable()
  assert.equal((await connection.client.listResources()).resources.some(resource =>
    resource.uri === "catalog://one"
  ), false)
  assert.equal((await connection.client.listResourceTemplates()).resourceTemplates.some(
    candidate => candidate.name === "catalog-template"
  ), false)
  await assertResourceError(() => connection.client.readResource({
    uri: "catalog://one"
  }), ErrorCode.InvalidParams)
  await assertInvalidCompletion(connection.client, "catalog://{name}", "name")
  assert.deepEqual([listCalls, readCalls, completionCalls], [1, 0, 0])
})

test("sap.system.inspect rejects malformed canonical IDs before service calls", async t => {
  let calls = 0
  const connection = await connectedClient(baseService({
    async getSapSystemInfo() {
      calls += 1
      return systemInfo()
    }
  }))
  t.after(() => connection.close())

  const result = await connection.client.callTool({
    name: "sap.system.inspect",
    arguments: { systemId: "dev.100" }
  }) as CallToolResult
  const payload = V1_ERROR_SCHEMA.parse(JSON.parse(text(result)))

  assert.equal(calls, 0)
  assert.equal(result.isError, true)
  assert.equal(payload.code, "INVALID_ADT_URI")
  assert.equal(payload.category, "validation")
})

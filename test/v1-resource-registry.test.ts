import assert from "node:assert/strict"
import test from "node:test"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import {
  McpServer,
  ResourceTemplate
} from "@modelcontextprotocol/sdk/server/mcp.js"
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js"
import { installV1CompletionRouter } from "../src/mcp/v1/completion-router.js"
import {
  installV1ResourceRegistry,
  type V1ResourceRegistry
} from "../src/mcp/v1/resource-registry.js"

function resourceText(
  result: { contents: Array<{ text: string } | { blob: string }> }
): string {
  const content = result.contents[0]
  return content && "text" in content ? content.text : ""
}

async function connectedClient(server: McpServer) {
  const client = new Client({
    name: "v1-resource-registry-test-client",
    version: "1.0.0"
  })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  await client.connect(clientTransport)
  return {
    client,
    async close() {
      await client.close()
      await server.close()
    }
  }
}

function registryServer(): {
  server: McpServer
  registry: V1ResourceRegistry
} {
  const server = new McpServer({
    name: "v1-resource-registry-test",
    version: "1.0.0"
  })
  const router = installV1CompletionRouter(server)
  const registry = installV1ResourceRegistry(server, router)
  return { server, registry }
}

async function assertResourceError(
  callback: () => Promise<unknown>,
  code: ErrorCode,
  absent: readonly string[] = []
): Promise<void> {
  await assert.rejects(callback, (error: unknown) => {
    assert.ok(error instanceof McpError)
    assert.equal(error.code, code)
    for (const secret of absent) {
      assert.equal(error.message.includes(secret), false)
    }
    const prefix = `MCP error ${code}: `
    assert.equal(error.message.startsWith(prefix), true)
    assert.equal(error.message.slice(prefix.length).startsWith("MCP error"), false)
    return true
  })
}

test("fixed Resources use canonical identity and support atomic lifecycle updates", async t => {
  const { server } = registryServer()
  const fixed = server.registerResource(
    "memo-fixed",
    "HTTP://EXAMPLE.com:80/item",
    {
      title: "Before",
      description: "before description",
      mimeType: "text/plain"
    },
    async uri => ({ contents: [{ uri: uri.href, text: "before" }] })
  )
  const connection = await connectedClient(server)
  t.after(() => connection.close())

  assert.equal(
    resourceText(await connection.client.readResource({
      uri: "http://example.com/item"
    })),
    "before"
  )
  assert.deepEqual((await connection.client.complete({
    ref: { type: "ref/resource", uri: "http://example.com/item" },
    argument: { name: "unused", value: "v" }
  })).completion.values, [])
  assert.deepEqual((await connection.client.complete({
    ref: { type: "ref/resource", uri: "memo://missing" },
    argument: { name: "unused", value: "v" }
  })).completion.values, [])
  assert.deepEqual((await connection.client.listResources()).resources, [{
    uri: "HTTP://EXAMPLE.com:80/item",
    name: "memo-fixed",
    title: "Before",
    description: "before description",
    mimeType: "text/plain"
  }])
  assert.throws(() => server.registerResource(
    "duplicate",
    "http://example.com/item",
    { mimeType: "text/plain" },
    async uri => ({ contents: [{ uri: uri.href, text: "duplicate" }] })
  ))

  fixed.update({
    name: "memo-fixed-updated",
    title: "After",
    uri: "memo://example/after",
    metadata: {
      title: "stale metadata title",
      description: "after description",
      mimeType: "text/updated"
    },
    callback: async uri => ({
      contents: [{ uri: uri.href, text: "after" }]
    })
  })

  await assertResourceError(
    () => connection.client.readResource({ uri: "http://example.com/item" }),
    ErrorCode.InvalidParams
  )
  assert.equal(
    resourceText(await connection.client.readResource({
      uri: "memo://example/after"
    })),
    "after"
  )
  assert.deepEqual((await connection.client.listResources()).resources, [{
    uri: "memo://example/after",
    name: "memo-fixed-updated",
    title: "After",
    description: "after description",
    mimeType: "text/updated"
  }])

  server.registerResource(
    "old-identity-reused",
    "http://example.com/item",
    { mimeType: "text/plain" },
    async uri => ({ contents: [{ uri: uri.href, text: "old identity" }] })
  )
  fixed.disable()
  assert.equal((await connection.client.listResources()).resources.some(resource =>
    resource.uri === "memo://example/after"
  ), false)
  await assertResourceError(
    () => connection.client.readResource({ uri: "memo://example/after" }),
    ErrorCode.InvalidParams
  )
  await assertResourceError(
    () => connection.client.complete({
      ref: { type: "ref/resource", uri: "memo://example/after" },
      argument: { name: "unused", value: "v" }
    }),
    ErrorCode.InvalidParams
  )
  assert.throws(() => server.registerResource(
    "disabled-duplicate",
    "memo://example/after",
    { mimeType: "text/plain" },
    async uri => ({ contents: [{ uri: uri.href, text: "duplicate" }] })
  ))

  fixed.enable()
  assert.equal(
    resourceText(await connection.client.readResource({
      uri: "memo://example/after"
    })),
    "after"
  )
  fixed.remove()
  await assertResourceError(
    () => connection.client.readResource({ uri: "memo://example/after" }),
    ErrorCode.InvalidParams
  )
  server.registerResource(
    "new-identity-reused",
    "memo://example/after",
    { mimeType: "text/plain" },
    async uri => ({ contents: [{ uri: uri.href, text: "new identity" }] })
  )
  assert.equal(
    resourceText(await connection.client.readResource({
      uri: "memo://example/after"
    })),
    "new identity"
  )
})

test("all four deprecated Resource overloads register, read, and remove", async t => {
  const { server } = registryServer()
  const fixedPlain = server.resource(
    "legacy-plain",
    "legacy://plain",
    async uri => ({ contents: [{ uri: uri.href, text: "plain" }] })
  )
  const fixedMetadata = server.resource(
    "legacy-metadata",
    "legacy://metadata",
    { title: "Legacy", mimeType: "text/plain" },
    async uri => ({ contents: [{ uri: uri.href, text: "metadata" }] })
  )
  const templatePlain = server.resource(
    "legacy-template-plain",
    new ResourceTemplate("legacy-plain://{name}", { list: undefined }),
    async (uri, variables) => ({
      contents: [{ uri: uri.href, text: `plain:${variables.name}` }]
    })
  )
  const templateMetadata = server.resource(
    "legacy-template-metadata",
    new ResourceTemplate("legacy-meta://{name}", { list: undefined }),
    { title: "Legacy Template", mimeType: "text/plain" },
    async (uri, variables) => ({
      contents: [{ uri: uri.href, text: `metadata:${variables.name}` }]
    })
  )
  const connection = await connectedClient(server)
  t.after(() => connection.close())

  const cases = [
    ["legacy://plain", "plain"],
    ["legacy://metadata", "metadata"],
    ["legacy-plain://one", "plain:one"],
    ["legacy-meta://two", "metadata:two"]
  ] as const
  for (const [uri, expected] of cases) {
    assert.equal(resourceText(await connection.client.readResource({ uri })), expected)
  }

  fixedPlain.remove()
  fixedMetadata.remove()
  templatePlain.remove()
  templateMetadata.remove()
  assert.deepEqual((await connection.client.listResources()).resources, [])
  assert.deepEqual((await connection.client.listResourceTemplates()).resourceTemplates, [])
})

test("Resource Templates merge metadata and follow current lifecycle state", async t => {
  const { server } = registryServer()
  let listCalls = 0
  const template = server.registerResource(
    "memo-template",
    new ResourceTemplate("memo://{name}", {
      list: async () => {
        listCalls += 1
        return {
          resources: [{
            uri: "memo://one",
            name: "one",
            title: "Listed title",
            mimeType: "text/plain"
          }]
        }
      },
      complete: {
        name: async value => [`${value}-one`, `${value}-two`]
      }
    }),
    {
      title: "Template",
      description: "template metadata",
      mimeType: "application/json"
    },
    async (uri, variables) => ({
      contents: [{ uri: uri.href, text: String(variables.name) }]
    })
  )
  const connection = await connectedClient(server)
  t.after(() => connection.close())

  assert.deepEqual((await connection.client.listResources()).resources, [{
    uri: "memo://one",
    name: "one",
    title: "Listed title",
    description: "template metadata",
    mimeType: "text/plain"
  }])
  assert.equal(listCalls, 1)
  assert.deepEqual((await connection.client.listResourceTemplates()).resourceTemplates, [{
    name: "memo-template",
    uriTemplate: "memo://{name}",
    title: "Template",
    description: "template metadata",
    mimeType: "application/json"
  }])
  assert.equal(
    resourceText(await connection.client.readResource({ uri: "memo://first" })),
    "first"
  )
  assert.deepEqual((await connection.client.complete({
    ref: { type: "ref/resource", uri: "memo://{name}" },
    argument: { name: "name", value: "f" }
  })).completion.values, ["f-one", "f-two"])

  template.update({
    name: "note-template",
    title: "Updated Template",
    template: new ResourceTemplate("note://{slug}", {
      list: async () => {
        listCalls += 1
        return {
          resources: [{ uri: "note://two", name: "two" }]
        }
      },
      complete: {
        slug: async value => [`${value}-updated`]
      }
    }),
    metadata: {
      title: "stale template metadata title",
      description: "updated metadata",
      mimeType: "text/updated"
    },
    callback: async (uri, variables) => ({
      contents: [{ uri: uri.href, text: `updated:${variables.slug}` }]
    })
  })

  await assertResourceError(
    () => connection.client.readResource({ uri: "memo://first" }),
    ErrorCode.InvalidParams
  )
  await assertResourceError(
    () => connection.client.complete({
      ref: { type: "ref/resource", uri: "memo://{name}" },
      argument: { name: "name", value: "f" }
    }),
    ErrorCode.InvalidParams
  )
  assert.equal(
    resourceText(await connection.client.readResource({ uri: "note://second" })),
    "updated:second"
  )
  assert.deepEqual((await connection.client.complete({
    ref: { type: "ref/resource", uri: "note://{slug}" },
    argument: { name: "slug", value: "s" }
  })).completion.values, ["s-updated"])
  assert.deepEqual((await connection.client.listResourceTemplates()).resourceTemplates, [{
    name: "note-template",
    uriTemplate: "note://{slug}",
    title: "Updated Template",
    description: "updated metadata",
    mimeType: "text/updated"
  }])
  assert.equal(
    (await connection.client.listResources()).resources[0]?.uri,
    "note://two"
  )
  assert.throws(() => server.registerResource(
    "note-template",
    new ResourceTemplate("duplicate://{name}", { list: undefined }),
    {},
    async uri => ({ contents: [{ uri: uri.href, text: "duplicate" }] })
  ))

  template.disable()
  assert.deepEqual((await connection.client.listResourceTemplates()).resourceTemplates, [])
  assert.deepEqual((await connection.client.listResources()).resources, [])
  assert.equal(listCalls, 2)
  await assertResourceError(
    () => connection.client.readResource({ uri: "note://second" }),
    ErrorCode.InvalidParams
  )
  await assertResourceError(
    () => connection.client.complete({
      ref: { type: "ref/resource", uri: "note://{slug}" },
      argument: { name: "slug", value: "s" }
    }),
    ErrorCode.InvalidParams
  )

  template.enable()
  assert.equal(
    resourceText(await connection.client.readResource({ uri: "note://third" })),
    "updated:third"
  )
  template.remove()
  assert.deepEqual((await connection.client.listResourceTemplates()).resourceTemplates, [])
  server.registerResource(
    "note-template",
    new ResourceTemplate("replacement://{name}", { list: undefined }),
    {},
    async (uri, variables) => ({
      contents: [{ uri: uri.href, text: `replacement:${variables.name}` }]
    })
  )
  assert.equal(
    resourceText(await connection.client.readResource({ uri: "replacement://four" })),
    "replacement:four"
  )
})

test("reserved fixed Resources canonicalize identity and beat broad Templates", async t => {
  const { server } = registryServer()
  let templateCalls = 0
  server.registerResource(
    "broad-adt",
    new ResourceTemplate("adt://{system}/{+adtPath}", { list: undefined }),
    {},
    async uri => {
      templateCalls += 1
      return { contents: [{ uri: uri.href, text: "template ADT" }] }
    }
  )
  server.registerResource(
    "broad-capability",
    new ResourceTemplate("sap-capability://{system}", { list: undefined }),
    {},
    async uri => {
      templateCalls += 1
      return { contents: [{ uri: uri.href, text: "template capability" }] }
    }
  )
  server.registerResource(
    "fixed-adt",
    "ADT://DEV100/sap/bc/adt/oo/classes/zcl_exact",
    {},
    async uri => ({ contents: [{ uri: uri.href, text: "fixed ADT" }] })
  )
  server.registerResource(
    "fixed-capability",
    "SAP-CAPABILITY://DEV100",
    {},
    async uri => ({ contents: [{ uri: uri.href, text: "fixed capability" }] })
  )
  const connection = await connectedClient(server)
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
  assert.equal(templateCalls, 0)
  assert.throws(() => server.registerResource(
    "duplicate-adt",
    "adt://dev100/sap/bc/adt/oo/classes/zcl_exact",
    {},
    async uri => ({ contents: [{ uri: uri.href, text: "duplicate" }] })
  ))
  assert.throws(() => server.registerResource(
    "duplicate-capability",
    "sap-capability://dev100",
    {},
    async uri => ({ contents: [{ uri: uri.href, text: "duplicate" }] })
  ))
})

test("raw invalid Resource URIs fail before callbacks", async t => {
  const { server } = registryServer()
  let calls = 0
  server.registerResource(
    "catch-all",
    new ResourceTemplate("{+uri}", { list: undefined }),
    {},
    async uri => {
      calls += 1
      return { contents: [{ uri: uri.href, text: "unexpected" }] }
    }
  )
  assert.throws(() => server.registerResource(
    "bad-registration",
    "memo://bad/%zz",
    {},
    async uri => ({ contents: [{ uri: uri.href, text: "bad" }] })
  ))
  const connection = await connectedClient(server)
  t.after(() => connection.close())

  for (const uri of ["memo://bad/%zz", "memo://bad/\u0000path"]) {
    await assertResourceError(
      () => connection.client.readResource({ uri }),
      ErrorCode.InvalidParams
    )
  }
  assert.equal(calls, 0)
})

test("failed identity updates leave fixed and Template Resources unchanged", async t => {
  const { server } = registryServer()
  server.registerResource(
    "fixed-blocker",
    "memo://blocker",
    {},
    async uri => ({ contents: [{ uri: uri.href, text: "blocker" }] })
  )
  const fixed = server.registerResource(
    "fixed-original",
    "memo://original",
    { title: "Original fixed", mimeType: "text/plain" },
    async uri => ({ contents: [{ uri: uri.href, text: "fixed original" }] })
  )
  server.registerResource(
    "template-blocker",
    new ResourceTemplate("blocker://{name}", { list: undefined }),
    {},
    async uri => ({ contents: [{ uri: uri.href, text: "template blocker" }] })
  )
  const template = server.registerResource(
    "template-original",
    new ResourceTemplate("original://{name}", {
      list: undefined,
      complete: { name: async value => [`${value}-original`] }
    }),
    { title: "Original template", mimeType: "text/plain" },
    async (uri, variables) => ({
      contents: [{ uri: uri.href, text: `template original:${variables.name}` }]
    })
  )
  const connection = await connectedClient(server)
  t.after(() => connection.close())

  assert.throws(() => fixed.update({
    name: "fixed-mutated",
    title: "Mutated fixed",
    uri: "memo://blocker",
    metadata: { mimeType: "text/mutated" },
    callback: async uri => ({ contents: [{ uri: uri.href, text: "mutated" }] })
  }))
  assert.throws(() => template.update({
    name: "template-blocker",
    title: "Mutated template",
    template: new ResourceTemplate("mutated://{slug}", {
      list: undefined,
      complete: { slug: async value => [`${value}-mutated`] }
    }),
    metadata: { mimeType: "text/mutated" },
    callback: async uri => ({ contents: [{ uri: uri.href, text: "mutated" }] })
  }))

  assert.equal(
    resourceText(await connection.client.readResource({ uri: "memo://original" })),
    "fixed original"
  )
  assert.equal(
    resourceText(await connection.client.readResource({ uri: "original://one" })),
    "template original:one"
  )
  assert.deepEqual((await connection.client.complete({
    ref: { type: "ref/resource", uri: "original://{name}" },
    argument: { name: "name", value: "v" }
  })).completion.values, ["v-original"])
  assert.deepEqual(
    (await connection.client.listResources()).resources.find(resource =>
      resource.uri === "memo://original"
    ),
    {
      uri: "memo://original",
      name: "fixed-original",
      title: "Original fixed",
      mimeType: "text/plain"
    }
  )
  assert.deepEqual(
    (await connection.client.listResourceTemplates()).resourceTemplates.find(entry =>
      entry.name === "template-original"
    ),
    {
      name: "template-original",
      uriTemplate: "original://{name}",
      title: "Original template",
      mimeType: "text/plain"
    }
  )
})

test("list, read, and completion failures are sanitized while success is unchanged", async t => {
  const { server } = registryServer()
  const rawSuccess = [
    "REPORT z_raw.",
    "* client_secret=literal-secret",
    "* Authorization: Basic literal-basic",
    "* Bearer literal-bearer"
  ].join("\n")
  server.registerResource(
    "raw-success",
    "memo://raw-success",
    { mimeType: "text/x-abap" },
    async uri => ({
      contents: [{ uri: uri.href, mimeType: "text/x-abap", text: rawSuccess }]
    })
  )
  server.registerResource(
    "read-error",
    "memo://read-error",
    {},
    async () => {
      throw new Error("client_secret:\n  read-first\n  read-second")
    }
  )
  server.registerResource(
    "error-template",
    new ResourceTemplate("error://{name}", {
      list: async () => {
        throw new Error("Authorization:\n  Basic\n  list-first\n  list-second")
      },
      complete: {
        name: async () => {
          throw new Error("client_secret:\n  completion-first\n  completion-second")
        }
      }
    }),
    {},
    async uri => ({ contents: [{ uri: uri.href, text: "unused" }] })
  )
  const connection = await connectedClient(server)
  t.after(() => connection.close())

  assert.equal(
    resourceText(await connection.client.readResource({ uri: "memo://raw-success" })),
    rawSuccess
  )
  await assertResourceError(
    () => connection.client.readResource({ uri: "memo://read-error" }),
    ErrorCode.InternalError,
    ["read-first", "read-second"]
  )
  await assertResourceError(
    () => connection.client.listResources(),
    ErrorCode.InternalError,
    ["list-first", "list-second"]
  )
  await assertResourceError(
    () => connection.client.complete({
      ref: { type: "ref/resource", uri: "error://{name}" },
      argument: { name: "name", value: "x" }
    }),
    ErrorCode.InternalError,
    ["completion-first", "completion-second"]
  )
})

test("all registry entry points share one state and notify once per successful change", async () => {
  const server = new McpServer({
    name: "v1-resource-registry-notification-test",
    version: "1.0.0"
  })
  let notifications = 0
  server.sendResourceListChanged = () => {
    notifications += 1
  }
  const router = installV1CompletionRouter(server)
  const registry = installV1ResourceRegistry(server, router)
  const fixed = registry.registerFixed(
    "direct-fixed",
    "memo://direct",
    {},
    async (uri: URL) => ({ contents: [{ uri: uri.href, text: "direct" }] })
  )
  assert.equal(notifications, 1)

  fixed.update({ title: "Updated" })
  assert.equal(notifications, 2)
  fixed.disable()
  assert.equal(notifications, 3)
  fixed.disable()
  assert.equal(notifications, 3)
  fixed.enable()
  assert.equal(notifications, 4)

  const duplicate = registry.registerFixed(
    "duplicate-target",
    "memo://duplicate",
    {},
    async (uri: URL) => ({ contents: [{ uri: uri.href, text: "duplicate" }] })
  )
  assert.equal(notifications, 5)
  assert.throws(() => fixed.update({ uri: "memo://duplicate" }))
  assert.equal(notifications, 5)

  fixed.remove()
  assert.equal(notifications, 6)
  fixed.remove()
  assert.equal(notifications, 6)
  duplicate.remove()
  assert.equal(notifications, 7)

  const directTemplate = registry.registerTemplate(
    "direct-template",
    new ResourceTemplate("direct://{name}", { list: undefined }),
    {},
    async (uri: URL) => ({ contents: [{ uri: uri.href, text: "direct template" }] })
  )
  assert.equal(notifications, 8)
  directTemplate.remove()
  assert.equal(notifications, 9)
})

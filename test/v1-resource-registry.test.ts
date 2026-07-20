import assert from "node:assert/strict"
import test from "node:test"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import {
  McpServer,
  ResourceTemplate,
  type ReadResourceCallback,
  type ReadResourceTemplateCallback,
  type RegisteredResource,
  type RegisteredResourceTemplate
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

async function readText(client: Client, uri: string): Promise<string> {
  return resourceText(await client.readResource({ uri }))
}

async function assertInvalidRead(client: Client, uri: string): Promise<void> {
  await assertResourceError(
    () => client.readResource({ uri }),
    ErrorCode.InvalidParams
  )
}

async function completeValues(
  client: Client,
  uri: string,
  name: string
): Promise<string[]> {
  return (await client.complete({
    ref: { type: "ref/resource", uri },
    argument: { name, value: "v" }
  })).completion.values
}

async function assertInvalidCompletion(
  client: Client,
  uri: string,
  name: string
): Promise<void> {
  await assertResourceError(
    () => client.complete({
      ref: { type: "ref/resource", uri },
      argument: { name, value: "v" }
    }),
    ErrorCode.InvalidParams
  )
}

type FixedRegistrar = (
  server: McpServer,
  name: string,
  uri: string,
  callback: ReadResourceCallback
) => RegisteredResource

type TemplateRegistrar = (
  server: McpServer,
  name: string,
  template: ResourceTemplate,
  callback: ReadResourceTemplateCallback
) => RegisteredResourceTemplate

async function verifyFixedLifecycle(
  label: string,
  register: FixedRegistrar
): Promise<void> {
  const { server } = registryServer()
  const initialUri = `legacy-${label}://original`
  const blockerUri = `legacy-${label}://blocker`
  const updatedUri = `legacy-${label}://updated`
  const initialMetadata = label === "metadata"
    ? { title: "Legacy fixed", mimeType: "text/plain" }
    : {}
  const updatedMetadata = {
    description: "updated fixed metadata",
    mimeType: "text/updated"
  }
  const initialCallback: ReadResourceCallback = uri => ({
    contents: [{ uri: uri.href, text: "initial fixed" }]
  })
  const fixed = register(server, `fixed-${label}`, initialUri, initialCallback)
  server.resource(
    `fixed-blocker-${label}`,
    blockerUri,
    uri => ({ contents: [{ uri: uri.href, text: "blocker" }] })
  )
  const connection = await connectedClient(server)

  try {
    assert.equal(await readText(connection.client, initialUri), "initial fixed")
    assert.throws(() => fixed.update({
      name: `mutated-${label}`,
      title: "Mutated fixed",
      uri: blockerUri,
      metadata: { mimeType: "text/mutated" },
      callback: uri => ({ contents: [{ uri: uri.href, text: "mutated" }] }),
      enabled: false
    }))
    assert.equal(fixed.name, `fixed-${label}`)
    assert.equal(fixed.title, label === "metadata" ? "Legacy fixed" : undefined)
    assert.deepEqual(fixed.metadata, initialMetadata)
    assert.equal(fixed.readCallback, initialCallback)
    assert.equal(fixed.enabled, true)
    assert.equal(await readText(connection.client, initialUri), "initial fixed")

    fixed.update({
      name: `updated-${label}`,
      title: "Updated fixed",
      uri: updatedUri,
      metadata: updatedMetadata,
      callback: uri => ({ contents: [{ uri: uri.href, text: "updated fixed" }] }),
      enabled: false
    })
    assert.equal(fixed.name, `updated-${label}`)
    assert.equal(fixed.title, "Updated fixed")
    assert.deepEqual(fixed.metadata, updatedMetadata)
    await assertInvalidRead(connection.client, updatedUri)
    await assertInvalidCompletion(connection.client, updatedUri, "unused")
    assert.equal((await connection.client.listResources()).resources.some(
      resource => resource.uri === updatedUri
    ), false)
    fixed.enable()
    assert.equal(await readText(connection.client, updatedUri), "updated fixed")
    assert.deepEqual(
      await completeValues(connection.client, updatedUri, "unused"),
      []
    )
    assert.deepEqual(
      (await connection.client.listResources()).resources.find(resource =>
        resource.uri === updatedUri
      ),
      {
        uri: updatedUri,
        name: `updated-${label}`,
        title: "Updated fixed",
        description: "updated fixed metadata",
        mimeType: "text/updated"
      }
    )
    fixed.disable()
    await assertInvalidRead(connection.client, updatedUri)
    fixed.enable()
    fixed.remove()
    await assertInvalidRead(connection.client, updatedUri)

    const replacement = register(
      server,
      `replacement-${label}`,
      updatedUri,
      uri => ({ contents: [{ uri: uri.href, text: "replacement fixed" }] })
    )
    assert.equal(await readText(connection.client, updatedUri), "replacement fixed")
    replacement.remove()
  } finally {
    await connection.close()
  }
}

async function verifyTemplateLifecycle(
  label: string,
  register: TemplateRegistrar
): Promise<void> {
  const { server } = registryServer()
  const initialPattern = `legacy-${label}://{name}`
  const updatedPattern = `updated-${label}://{slug}`
  const blockerName = `template-blocker-${label}`
  const updatedName = `template-updated-${label}`
  const initialMetadata = label === "metadata"
    ? { title: "Legacy Template", mimeType: "text/plain" }
    : {}
  const updatedMetadata = {
    description: "updated template metadata",
    mimeType: "text/updated"
  }
  const initialTemplate = new ResourceTemplate(initialPattern, {
    list: undefined,
    complete: { name: value => [`${value}-initial`] }
  })
  const initialCallback: ReadResourceTemplateCallback = (uri, variables) => ({
    contents: [{ uri: uri.href, text: `initial:${variables.name}` }]
  })
  let updatedListCalls = 0
  const template = register(
    server,
    `template-${label}`,
    initialTemplate,
    initialCallback
  )
  server.resource(
    blockerName,
    new ResourceTemplate(`blocker-${label}://{name}`, { list: undefined }),
    uri => ({ contents: [{ uri: uri.href, text: "blocker" }] })
  )
  const connection = await connectedClient(server)

  try {
    assert.equal(
      await readText(connection.client, `legacy-${label}://one`),
      "initial:one"
    )
    assert.throws(() => template.update({
      name: blockerName,
      title: "Mutated Template",
      template: new ResourceTemplate(`mutated-${label}://{slug}`, {
        list: undefined
      }),
      metadata: { mimeType: "text/mutated" },
      callback: uri => ({ contents: [{ uri: uri.href, text: "mutated" }] }),
      enabled: false
    }))
    assert.equal(template.resourceTemplate, initialTemplate)
    assert.equal(
      template.title,
      label === "metadata" ? "Legacy Template" : undefined
    )
    assert.deepEqual(template.metadata, initialMetadata)
    assert.equal(template.readCallback, initialCallback)
    assert.equal(template.enabled, true)
    assert.equal(
      (await connection.client.listResourceTemplates()).resourceTemplates.find(
        candidate => candidate.uriTemplate === initialPattern
      )?.name,
      `template-${label}`
    )
    assert.equal(
      await readText(connection.client, `legacy-${label}://two`),
      "initial:two"
    )

    const updatedTemplate = new ResourceTemplate(updatedPattern, {
      list: () => {
        updatedListCalls += 1
        return { resources: [] }
      },
      complete: { slug: value => [`${value}-updated`] }
    })
    template.update({
      name: updatedName,
      title: "Updated Template",
      template: updatedTemplate,
      metadata: updatedMetadata,
      callback: (uri, variables) => ({
        contents: [{ uri: uri.href, text: `updated:${variables.slug}` }]
      }),
      enabled: false
    })
    assert.equal(template.resourceTemplate, updatedTemplate)
    assert.equal(template.title, "Updated Template")
    assert.deepEqual(template.metadata, updatedMetadata)
    await assertInvalidRead(connection.client, `updated-${label}://three`)
    await assertInvalidCompletion(connection.client, updatedPattern, "slug")
    assert.equal((await connection.client.listResourceTemplates()).resourceTemplates.some(
      candidate => candidate.name === updatedName
    ), false)
    await connection.client.listResources()
    assert.equal(updatedListCalls, 0)
    template.enable()
    assert.equal(
      await readText(connection.client, `updated-${label}://four`),
      "updated:four"
    )
    assert.deepEqual(
      await completeValues(connection.client, updatedPattern, "slug"),
      ["v-updated"]
    )
    await connection.client.listResources()
    assert.equal(updatedListCalls, 1)
    assert.deepEqual(
      (await connection.client.listResourceTemplates()).resourceTemplates.find(
        candidate => candidate.name === updatedName
      ),
      {
        name: updatedName,
        uriTemplate: updatedPattern,
        title: "Updated Template",
        description: "updated template metadata",
        mimeType: "text/updated"
      }
    )
    template.disable()
    await assertInvalidRead(connection.client, `updated-${label}://five`)
    template.enable()
    template.remove()
    await assertInvalidRead(connection.client, `updated-${label}://six`)
    await assertInvalidCompletion(connection.client, updatedPattern, "slug")

    const replacement = register(
      server,
      updatedName,
      new ResourceTemplate(`replacement-${label}://{name}`, { list: undefined }),
      (uri, variables) => ({
        contents: [{ uri: uri.href, text: `replacement:${variables.name}` }]
      })
    )
    assert.equal(
      await readText(connection.client, `replacement-${label}://six`),
      "replacement:six"
    )
    replacement.remove()
  } finally {
    await connection.close()
  }
}

test("fixed Resources canonicalize identity and keep the current title", async t => {
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

  assert.equal(await readText(connection.client, "http://example.com/item"), "before")
  assert.deepEqual(
    await completeValues(connection.client, "http://example.com/item", "unused"),
    []
  )
  await assertInvalidCompletion(connection.client, "memo://missing", "unused")
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
    title: "After",
    metadata: {
      title: "stale metadata title",
      description: "after description",
      mimeType: "text/updated"
    }
  })
  assert.deepEqual((await connection.client.listResources()).resources, [{
    uri: "HTTP://EXAMPLE.com:80/item",
    name: "memo-fixed",
    title: "After",
    description: "after description",
    mimeType: "text/updated"
  }])
})

test("fixed canonical completion wins before an identical Template reference", async t => {
  const { server } = registryServer()
  let templateCalls = 0
  server.registerResource(
    "ambiguous-template",
    new ResourceTemplate("memo://x/{name}", {
      list: undefined,
      complete: {
        name: value => {
          templateCalls += 1
          return [`${value}-template`]
        }
      }
    }),
    {},
    uri => ({ contents: [{ uri: uri.href, text: "template" }] })
  )
  server.registerResource(
    "brace-fixed",
    "memo://x/{name}",
    {},
    uri => ({ contents: [{ uri: uri.href, text: "fixed" }] })
  )
  const connection = await connectedClient(server)
  t.after(() => connection.close())

  for (const uri of ["memo://x/{name}", "memo://x/%7Bname%7D"]) {
    assert.deepEqual((await connection.client.complete({
      ref: { type: "ref/resource", uri },
      argument: { name: "name", value: "v" }
    })).completion.values, [])
  }
  assert.equal(templateCalls, 0)
})

test("disabled overlapping Templates are skipped for read and completion", async t => {
  const { server } = registryServer()
  let firstReadCalls = 0
  let firstCompletionCalls = 0
  const first = server.registerResource(
    "overlap-first",
    new ResourceTemplate("overlap://{name}", {
      list: undefined,
      complete: {
        name: value => {
          firstCompletionCalls += 1
          return [`${value}-first`]
        }
      }
    }),
    {},
    (uri, variables) => {
      firstReadCalls += 1
      return { contents: [{ uri: uri.href, text: `first:${variables.name}` }] }
    }
  )
  server.registerResource(
    "overlap-second",
    new ResourceTemplate("overlap://{name}", {
      list: undefined,
      complete: { name: value => [`${value}-second`] }
    }),
    {},
    (uri, variables) => ({
      contents: [{ uri: uri.href, text: `second:${variables.name}` }]
    })
  )
  first.disable()
  const connection = await connectedClient(server)
  t.after(() => connection.close())

  assert.equal(
    resourceText(await connection.client.readResource({ uri: "overlap://one" })),
    "second:one"
  )
  assert.deepEqual((await connection.client.complete({
    ref: { type: "ref/resource", uri: "overlap://{name}" },
    argument: { name: "name", value: "v" }
  })).completion.values, ["v-second"])
  assert.equal(firstReadCalls, 0)
  assert.equal(firstCompletionCalls, 0)

  first.enable()
  assert.equal(
    resourceText(await connection.client.readResource({ uri: "overlap://two" })),
    "first:two"
  )
  assert.deepEqual((await connection.client.complete({
    ref: { type: "ref/resource", uri: "overlap://{name}" },
    argument: { name: "name", value: "v" }
  })).completion.values, ["v-first"])
})

test("modern and deprecated Resource forms preserve the full lifecycle", async () => {
  await verifyFixedLifecycle(
    "modern-fixed",
    (server, name, uri, callback) => server.registerResource(
      name,
      uri,
      {},
      callback
    )
  )
  await verifyTemplateLifecycle(
    "modern-template",
    (server, name, template, callback) => server.registerResource(
      name,
      template,
      {},
      callback
    )
  )
  await verifyFixedLifecycle(
    "plain",
    (server, name, uri, callback) => server.resource(name, uri, callback)
  )
  await verifyFixedLifecycle(
    "metadata",
    (server, name, uri, callback) => server.resource(
      name,
      uri,
      { title: "Legacy fixed", mimeType: "text/plain" },
      callback
    )
  )
  await verifyTemplateLifecycle(
    "plain",
    (server, name, template, callback) => server.resource(
      name,
      template,
      callback
    )
  )
  await verifyTemplateLifecycle(
    "metadata",
    (server, name, template, callback) => server.resource(
      name,
      template,
      { title: "Legacy Template", mimeType: "text/plain" },
      callback
    )
  )
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
    title: "Updated Template",
    metadata: {
      title: "stale template metadata title",
      description: "updated metadata",
      mimeType: "text/updated"
    }
  })
  assert.deepEqual((await connection.client.listResourceTemplates()).resourceTemplates, [{
    name: "memo-template",
    uriTemplate: "memo://{name}",
    title: "Updated Template",
    description: "updated metadata",
    mimeType: "text/updated"
  }])
  assert.deepEqual((await connection.client.listResources()).resources, [{
    uri: "memo://one",
    name: "one",
    title: "Listed title",
    description: "updated metadata",
    mimeType: "text/plain"
  }])
  assert.equal(listCalls, 2)
  assert.throws(() => server.registerResource(
    "memo-template",
    new ResourceTemplate("duplicate://{name}", { list: undefined }),
    {},
    async uri => ({ contents: [{ uri: uri.href, text: "duplicate" }] })
  ))
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

test("synchronous callback failures are sanitized while success is unchanged", async t => {
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
    () => {
      throw new Error("client_secret:\n  read-first\n  read-second")
    }
  )
  server.registerResource(
    "error-template",
    new ResourceTemplate("error://{name}", {
      list: () => {
        throw new Error("Authorization:\n  Basic\n  list-first\n  list-second")
      },
      complete: {
        name: () => {
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

import assert from "node:assert/strict"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import {
  AUDIT_ARGUMENT_TOTAL_BYTE_LIMIT,
  AUDIT_SCHEMA_VERSION,
  AuditRecorder,
  auditArgumentsDigest,
  classifyAuditOutcome,
  createAuditSink,
  createFileAuditSink,
  extractAuditSystemId,
  extractAuditTarget,
  parseAuditSinkName,
  redactAuditArguments,
  type AuditEvent,
  type AuditSink
} from "../src/audit-log.js"
import { extractToolErrorCode } from "../src/mcp/audit-instrumentation.js"
import { AppError } from "../src/errors.js"
import { createMcpServer } from "../src/mcp-server.js"
import { AbapToolService } from "../src/tool-service.js"

function memorySink(): AuditSink & { events: AuditEvent[] } {
  const events: AuditEvent[] = []
  return {
    name: "stderr",
    events,
    write: event => {
      events.push(event)
    },
    close: async () => undefined
  }
}

function recorderWith(sink: AuditSink, includeArguments = false): AuditRecorder {
  let counter = 0
  return new AuditRecorder({
    sink,
    apiVersion: "v1",
    includeArguments,
    principal: { id: "tester", source: "local-process" },
    now: () => new Date("2026-08-05T00:00:00.000Z"),
    newEventId: () => `event-${(counter += 1)}`
  })
}

test("audit redaction removes credential-shaped keys at every depth", () => {
  const redacted = redactAuditArguments({
    systemId: "DEV100",
    password: "hunter2",
    apiKey: "abc",
    nested: {
      "client-secret": "s3cret",
      accessToken: "t",
      sqlQuery: "SELECT * FROM USR02",
      keep: "visible"
    },
    list: [{ sessionCookie: "c" }]
  })

  assert.deepEqual(redacted, {
    systemId: "DEV100",
    password: "[redacted]",
    apiKey: "[redacted]",
    nested: {
      "client-secret": "[redacted]",
      accessToken: "[redacted]",
      sqlQuery: "[redacted]",
      keep: "visible"
    },
    list: [{ sessionCookie: "[redacted]" }]
  })
})

test("audit redaction truncates long strings so ABAP source is never logged whole", () => {
  const source = "a".repeat(4000)
  const redacted = redactAuditArguments({ newSource: source }) as {
    newSource: string
  }

  assert.ok(redacted.newSource.endsWith("[truncated:4000B]"))
  assert.ok(Buffer.byteLength(redacted.newSource, "utf8") < 600)
})

test("audit redaction omits arguments that exceed the total byte budget", () => {
  const wide: Record<string, unknown> = {}
  for (let index = 0; index < 60; index += 1) {
    wide[`field${index}`] = "x".repeat(200)
  }

  const redacted = redactAuditArguments(wide) as { omitted: boolean; bytes: number }

  assert.equal(redacted.omitted, true)
  assert.ok(redacted.bytes > AUDIT_ARGUMENT_TOTAL_BYTE_LIMIT)
})

test("audit redaction caps arrays and recursion depth", () => {
  const redacted = redactAuditArguments({
    objects: Array.from({ length: 25 }, (_unused, index) => `OBJ${index}`),
    deep: { a: { b: { c: { d: { e: { f: { g: "too deep" } } } } } } }
  }) as { objects: string[]; deep: unknown }

  assert.equal(redacted.objects.length, 21)
  assert.equal(redacted.objects[20], "[omitted:5]")
  assert.equal(
    JSON.stringify(redacted.deep),
    JSON.stringify({ a: { b: { c: { d: { e: "[depth-limit]" } } } } })
  )
})

test("the arguments digest is stable and derived from redacted values", () => {
  const first = auditArgumentsDigest(redactAuditArguments({
    systemId: "DEV100",
    password: "one"
  }))
  const second = auditArgumentsDigest(redactAuditArguments({
    systemId: "DEV100",
    password: "two"
  }))
  const different = auditArgumentsDigest(redactAuditArguments({
    systemId: "QAS200",
    password: "one"
  }))

  assert.equal(first.length, 32)
  assert.equal(first, second)
  assert.notEqual(first, different)
})

test("system and target extraction returns only scalar object identity", () => {
  const args = {
    connectionId: "DEV100",
    objectName: "ZCL_DEMO",
    objectType: "CLAS/OC",
    package: "$TMP",
    transportNumber: "DEVK900123",
    methodName: "RUN",
    newSource: "CLASS zcl_demo DEFINITION."
  }

  assert.equal(extractAuditSystemId(args), "DEV100")
  assert.deepEqual(extractAuditTarget(args), {
    objectName: "ZCL_DEMO",
    objectType: "CLAS/OC",
    package: "$TMP",
    transport: "DEVK900123",
    method: "RUN"
  })
  assert.equal(extractAuditTarget({ newSource: "x" }), undefined)
})

test("guardrail refusals are classified as denied and SAP faults as failed", () => {
  assert.equal(classifyAuditOutcome(undefined), "succeeded")
  assert.equal(classifyAuditOutcome("PRODUCTION_WRITE_BLOCKED"), "denied")
  assert.equal(classifyAuditOutcome("PACKAGE_NOT_ALLOWED"), "denied")
  assert.equal(classifyAuditOutcome("TRANSPORT_REQUIRED"), "denied")
  assert.equal(classifyAuditOutcome("QUERY_NOT_READ_ONLY"), "denied")
  assert.equal(classifyAuditOutcome("DATA_QUERY_NOT_ALLOWED"), "denied")
  assert.equal(classifyAuditOutcome("DATA_QUERY_TABLE_DENIED"), "denied")
  assert.equal(classifyAuditOutcome("DATA_QUERY_CONFIRMATION_REQUIRED"), "denied")
  assert.equal(classifyAuditOutcome("DATA_QUERY_SOURCE_UNRESOLVED"), "denied")
  assert.equal(classifyAuditOutcome("SAP_OPERATION_FAILED"), "failed")
  assert.equal(classifyAuditOutcome("OBJECT_NOT_FOUND"), "failed")
})

test("tool error codes are read from v0, v1, and deferred envelopes", () => {
  assert.equal(extractToolErrorCode({ content: [], isError: false }), undefined)
  assert.equal(
    extractToolErrorCode({
      isError: true,
      content: [{ type: "text", text: JSON.stringify({ code: "PACKAGE_NOT_ALLOWED" }) }]
    }),
    "PACKAGE_NOT_ALLOWED"
  )
  assert.equal(
    extractToolErrorCode({
      isError: true,
      content: [{
        type: "text",
        text: JSON.stringify({
          schemaVersion: "1.0",
          code: "SAP_OPERATION_FAILED",
          category: "sap"
        })
      }]
    }),
    "SAP_OPERATION_FAILED"
  )
  assert.equal(
    extractToolErrorCode({
      isError: true,
      content: [{
        type: "text",
        text: JSON.stringify({
          format: "compact-v1",
          deferred: true,
          error: { code: "TRANSPORT_REQUIRED", message: "x" }
        })
      }]
    }),
    "TRANSPORT_REQUIRED"
  )
  assert.equal(
    extractToolErrorCode({ isError: true, content: [{ type: "text", text: "not json" }] }),
    "UNKNOWN_ERROR"
  )
})

test("a disabled recorder records nothing", () => {
  const recorder = new AuditRecorder({
    sink: createAuditSink({ sink: "none", includeArguments: false }),
    apiVersion: "v1"
  })

  assert.equal(recorder.enabled, false)
  assert.equal(
    recorder.record({
      kind: "tool",
      name: "sap.system.list",
      mutation: false,
      destructive: false,
      outcome: "succeeded",
      durationMs: 1
    }),
    undefined
  )
})

test("arguments are excluded unless auditing is explicitly configured to include them", () => {
  const sink = memorySink()
  const withoutArguments = recorderWith(sink).build({
    kind: "tool",
    name: "sap.source.patch",
    mutation: true,
    destructive: true,
    outcome: "succeeded",
    durationMs: 5,
    arguments: { systemId: "DEV100", newSource: "CLASS x." }
  })
  const withArguments = recorderWith(sink, true).build({
    kind: "tool",
    name: "sap.source.patch",
    mutation: true,
    destructive: true,
    outcome: "succeeded",
    durationMs: 5,
    arguments: { systemId: "DEV100", newSource: "CLASS x." }
  })

  assert.equal(withoutArguments.arguments, undefined)
  assert.deepEqual(withArguments.arguments, {
    systemId: "DEV100",
    newSource: "CLASS x."
  })
  assert.equal(withoutArguments.argumentsDigest, withArguments.argumentsDigest)
})

test("the file sink appends one JSON line per event with owner-only permissions", async () => {
  const directory = await mkdtemp(join(tmpdir(), "sap-abap-mcp-audit-"))
  const path = join(directory, "nested", "audit.jsonl")
  const sink = createFileAuditSink(path)
  const recorder = recorderWith(sink)
  try {
    recorder.record({
      kind: "tool",
      name: "sap.system.list",
      mutation: false,
      destructive: false,
      outcome: "succeeded",
      durationMs: 2
    })
    recorder.record({
      kind: "resource",
      name: "sap-adt-source",
      mutation: false,
      destructive: false,
      outcome: "succeeded",
      durationMs: 3,
      uri: "adt://DEV100/oo/classes/zcl_demo/source/main"
    })
    await recorder.close()

    const lines = (await readFile(path, "utf8")).trim().split("\n")
    assert.equal(lines.length, 2)
    const [first, second] = lines.map(line => JSON.parse(line) as AuditEvent)
    assert.equal(first?.schema, AUDIT_SCHEMA_VERSION)
    assert.equal(first?.kind, "tool")
    assert.equal(first?.name, "sap.system.list")
    assert.equal(first?.principal.id, "tester")
    assert.equal(second?.kind, "resource")
    assert.equal(second?.uri, "adt://DEV100/oo/classes/zcl_demo/source/main")
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("audit sink names are validated and file sinks require a path", () => {
  assert.equal(parseAuditSinkName(undefined), "none")
  assert.equal(parseAuditSinkName("STDERR"), "stderr")
  assert.throws(() => parseAuditSinkName("syslog"), /INVALID_AUDIT_SINK|Unknown audit log sink/)
  assert.throws(
    () => createAuditSink({ sink: "file", includeArguments: false }),
    /AUDIT_LOG_FILE_REQUIRED|--audit-log-file/
  )
})

async function callToolWithAudit(
  service: AbapToolService,
  sink: AuditSink,
  name: string,
  args: Record<string, unknown>
): Promise<void> {
  const server = createMcpServer(service, {
    apiVersion: "v1",
    auditRecorder: recorderWith(sink)
  })
  const client = new Client({ name: "audit-test", version: "1.0.0" })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  await client.connect(clientTransport)
  try {
    await client.callTool({ name, arguments: args })
  } finally {
    await client.close()
    await server.close()
  }
}

test("a successful v1 tool call emits exactly one succeeded audit event", async () => {
  const sink = memorySink()
  const service = new AbapToolService({
    async listConnections() {
      return [{
        id: "DEV100",
        url: "https://sap.example.com",
        client: "100",
        language: "EN",
        environment: "development" as const,
        credentialAvailable: true
      }]
    },
    async getClient() { throw new Error("not used") }
  })

  await callToolWithAudit(service, sink, "sap.system.list", {})

  assert.equal(sink.events.length, 1)
  const [event] = sink.events
  assert.equal(event?.kind, "tool")
  assert.equal(event?.name, "sap.system.list")
  assert.equal(event?.outcome, "succeeded")
  assert.equal(event?.mutation, false)
  assert.equal(event?.destructive, false)
  assert.equal(typeof event?.durationMs, "number")
})

test("a blocked production write is audited as denied with its policy code", async () => {
  const sink = memorySink()
  const service = new AbapToolService({
    async listConnections() { return [] },
    async getClient() {
      throw new AppError(
        "PRODUCTION_WRITE_BLOCKED",
        "Writes are disabled for production profile PRD100"
      )
    }
  })

  await callToolWithAudit(service, sink, "sap.source.patch", {
    systemId: "PRD100",
    fileUri: "/sap/bc/adt/oo/classes/zcl_demo/source/main",
    oldString: "a",
    newString: "b"
  })

  assert.equal(sink.events.length, 1)
  const [event] = sink.events
  assert.equal(event?.name, "sap.source.patch")
  assert.equal(event?.outcome, "denied")
  assert.equal(event?.errorCode, "PRODUCTION_WRITE_BLOCKED")
  assert.equal(event?.mutation, true)
  assert.equal(event?.destructive, true)
  assert.equal(event?.systemId, "PRD100")
  assert.equal(
    event?.target?.objectUri,
    "/sap/bc/adt/oo/classes/zcl_demo/source/main"
  )
  assert.equal(event?.arguments, undefined)
})

test("auditing is inert when no recorder is configured", async () => {
  const service = new AbapToolService({
    async listConnections() { return [] },
    async getClient() { throw new Error("not used") }
  })
  const server = createMcpServer(service, { apiVersion: "v1" })
  const client = new Client({ name: "audit-off", version: "1.0.0" })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  await client.connect(clientTransport)
  try {
    const result = await client.callTool({ name: "sap.system.list", arguments: {} })
    assert.ok(Array.isArray(result.content))
  } finally {
    await client.close()
    await server.close()
  }
})

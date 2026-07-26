import assert from "node:assert/strict"
import test from "node:test"
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js"
import { z } from "zod"
import { AppError } from "../src/errors.js"
import {
  V1_ERROR_SCHEMA,
  V1_SUCCESS_SHAPE
} from "../src/mcp/v1/contracts.js"
import {
  runV1Tool,
  sanitizeV1Message,
  toV1ProtocolError,
  v1Failure,
  v1Success
} from "../src/mcp/v1/result.js"

const SUCCESS_SCHEMA = z.object({
  ...V1_SUCCESS_SHAPE,
  data: z.record(z.string(), z.unknown())
})

function textPayload(result: ReturnType<typeof v1Success>): Record<string, unknown> {
  const block = result.content[0]
  assert.equal(block?.type, "text")
  return JSON.parse(block.text) as Record<string, unknown>
}

test("success has the v1 defaults and text/structured parity", () => {
  const result = v1Success({ objects: [] })
  const payload = SUCCESS_SCHEMA.parse(result.structuredContent)

  assert.equal(payload.schemaVersion, "1.0")
  assert.notEqual(payload.requestId, "")
  assert.equal(payload.status, "succeeded")
  assert.deepEqual(payload.warnings, [])
  assert.deepEqual(textPayload(result), result.structuredContent)
})

test("success retains a supplied request ID", () => {
  const result = v1Success({ system: "DEV100" }, { requestId: "request-123" })

  assert.equal(result.structuredContent?.requestId, "request-123")
})

test("AUTH_REQUIRED maps to authentication and is not retryable", async () => {
  const result = await runV1Tool(async () => {
    throw new AppError("AUTH_REQUIRED", "Credentials are required")
  })
  const payload = V1_ERROR_SCHEMA.parse(textPayload(result))

  assert.equal(result.isError, true)
  assert.equal(payload.category, "authentication")
  assert.equal(payload.retryable, false)
})

test("SAP_AUTHORIZATION_DENIED maps to authorization and is not retryable", () => {
  const payload = V1_ERROR_SCHEMA.parse(textPayload(v1Failure(
    new AppError("SAP_AUTHORIZATION_DENIED", "Access denied")
  )))

  assert.equal(payload.category, "authorization")
  assert.equal(payload.retryable, false)
})

test("SAP_CAPABILITY_UNAVAILABLE maps to capability and is not retryable", () => {
  const payload = V1_ERROR_SCHEMA.parse(textPayload(v1Failure(
    new AppError("SAP_CAPABILITY_UNAVAILABLE", "Capability unavailable")
  )))

  assert.equal(payload.category, "capability")
  assert.equal(payload.retryable, false)
})

test("a transient read-side SAP operation failure is retryable", () => {
  const payload = V1_ERROR_SCHEMA.parse(textPayload(v1Failure(
    new AppError("SAP_OPERATION_FAILED", "SAP is unavailable", { httpStatus: 503 })
  )))

  assert.equal(payload.category, "sap")
  assert.equal(payload.retryable, true)
})

test("failure redacts secrets and bounds details by UTF-8 bytes", () => {
  const result = v1Failure(new AppError(
    "SAP_OPERATION_FAILED",
    "Authorization: Bearer top-secret",
    {
      nested: { access_token: "top-secret" },
      diagnostic: "詳".repeat(10_000)
    }
  ))
  const serialized = result.content[0]?.type === "text" ? result.content[0].text : ""
  const payload = V1_ERROR_SCHEMA.parse(JSON.parse(serialized))

  assert.equal(serialized.includes("top-secret"), false)
  assert.equal(result.structuredContent, undefined)
  assert.ok(payload.details)
  assert.ok(Buffer.byteLength(JSON.stringify(payload.details), "utf8") <= 8 * 1024)
})

test("failure redacts a standalone bearer credential in its message", () => {
  const result = v1Failure(new Error("Upstream rejected Bearer message-secret"))
  const serialized = result.content[0]?.type === "text" ? result.content[0].text : ""

  assert.equal(serialized.includes("message-secret"), false)
})

test("failure redacts a standalone bearer credential in nested detail text", () => {
  const result = v1Failure(new AppError("SAP_OPERATION_FAILED", "SAP failed", {
    nested: { diagnostic: "Upstream rejected Bearer detail-secret" }
  }))
  const serialized = result.content[0]?.type === "text" ? result.content[0].text : ""

  assert.equal(serialized.includes("detail-secret"), false)
})

test("the shared sanitizer redacts standalone basic and bearer credentials", () => {
  for (const [scheme, secret] of [
    ["Basic", "basic-secret"],
    ["Bearer", "bearer-secret"]
  ] as const) {
    assert.equal(
      sanitizeV1Message(`Upstream rejected ${scheme} ${secret}`).includes(secret),
      false
    )
  }
})

test("the shared sanitizer fail-closes folded standalone credentials", () => {
  for (const scheme of ["Basic", "Bearer"]) {
    const sanitized = sanitizeV1Message(
      `Upstream rejected ${scheme} first-secret\r\n second-secret\r\n third-secret`
    )

    for (const secret of ["first-secret", "second-secret", "third-secret"]) {
      assert.equal(sanitized.includes(secret), false)
    }
  }
})

test("the shared sanitizer fail-closes folded credential continuations", () => {
  for (const scheme of ["Basic", "Bearer"]) {
    const sanitized = sanitizeV1Message(
      `Authorization: ${scheme} first-secret\r\n second-secret\r\n third-secret`
    )

    for (const secret of ["first-secret", "second-secret", "third-secret"]) {
      assert.equal(sanitized.includes(secret), false)
    }
  }
})

test("the shared sanitizer redacts multi-at URL userinfo through the last authority at", () => {
  const sanitized = sanitizeV1Message(
    "https://url-user:url-pass@password-tail@sap.example.test/path"
  )

  for (const secret of ["url-user", "url-pass", "password-tail"]) {
    assert.equal(sanitized.includes(secret), false)
  }
  assert.equal(sanitized.includes("sap.example.test/path"), true)
})

test("the shared sanitizer redacts adversarial sensitive key spellings", () => {
  const cases = [
    ["client_secret=client-secret-value", "client-secret-value"],
    ["clientsecret=compact-secret-value", "compact-secret-value"],
    ["api_key=api-key-value", "api-key-value"],
    ["Proxy-Authorization: Basic proxy-secret-value", "proxy-secret-value"],
    ['client_secret="prefix\\"escaped-quote-secret"', "escaped-quote-secret"],
    ['api_key="unterminated-secret tail', "unterminated-secret"],
    ['{\n  "client_secret":\n    "pretty-json-secret"\n}', "pretty-json-secret"],
    ["Authorization:\n  Basic\n  folded-authorization-secret", "folded-authorization-secret"],
    ['client_secret:\n  "unterminated-multiline-secret\nnext line', "unterminated-multiline-secret"],
    ["client_secret=\n  first-multiline-secret extra-multiline-secret", "extra-multiline-secret"],
    ["Authorization:\n  Basic\n  first-folded-secret extra-folded-secret", "extra-folded-secret"]
  ] as const

  for (const [diagnostic, secret] of cases) {
    assert.equal(sanitizeV1Message(diagnostic).includes(secret), false)
  }

  const multilineCases = [
    [
      "Authorization:\n  Basic\n  first-secret\n  second-secret",
      ["first-secret", "second-secret"]
    ],
    [
      "client_secret=\n  first-secret\n  second-secret",
      ["first-secret", "second-secret"]
    ],
    [
      "{\n  \"client_secret\"\n  :\n  \"json-secret\"\n}",
      ["json-secret"]
    ],
    [
      "client_secret:\n  \"unterminated-secret\n  continuation-secret",
      ["unterminated-secret", "continuation-secret"]
    ]
  ] as const

  for (const [diagnostic, secrets] of multilineCases) {
    const sanitized = sanitizeV1Message(diagnostic)
    for (const secret of secrets) assert.equal(sanitized.includes(secret), false)
  }

  const structured = v1Failure(new AppError("SAP_OPERATION_FAILED", "SAP failed", {
    client_secret: "structured-client-secret",
    clientsecret: "structured-compact-secret",
    api_key: "structured-api-key",
    "Proxy-Authorization": "Basic structured-proxy-secret"
  }))
  const serialized = structured.content[0]?.type === "text" ? structured.content[0].text : ""

  for (const secret of [
    "structured-client-secret",
    "structured-compact-secret",
    "structured-api-key",
    "structured-proxy-secret"
  ]) {
    assert.equal(serialized.includes(secret), false)
  }
})

test("protocol conversion preserves codes and sanitizes its message", () => {
  const converted = toV1ProtocolError(
    new McpError(ErrorCode.InvalidParams, "client_secret:\n  protocol-secret")
  )

  assert.equal(converted.code, ErrorCode.InvalidParams)
  assert.equal(converted.message.includes("protocol-secret"), false)
  assert.equal(converted.message.startsWith("MCP error"), false)
})

test("failure does not execute an enumerable root toJSON after redaction", () => {
  const result = v1Failure(new AppError("SAP_OPERATION_FAILED", "SAP failed", {
    diagnostic: "safe root diagnostic",
    toJSON() {
      return { access_token: "root-to-json-secret" }
    }
  }))
  const serialized = result.content[0]?.type === "text" ? result.content[0].text : ""

  assert.equal(serialized.includes("root-to-json-secret"), false)
  assert.equal(serialized.includes("safe root diagnostic"), true)
})

test("failure does not execute an enumerable nested toJSON after redaction", () => {
  const result = v1Failure(new AppError("SAP_OPERATION_FAILED", "SAP failed", {
    nested: {
      diagnostic: "safe nested diagnostic",
      toJSON() {
        return { authorization: "Bearer nested-to-json-secret" }
      }
    }
  }))
  const serialized = result.content[0]?.type === "text" ? result.content[0].text : ""

  assert.equal(serialized.includes("nested-to-json-secret"), false)
  assert.equal(serialized.includes("safe nested diagnostic"), true)
})

test("success derives text and structured content from one JSON-safe envelope", () => {
  const result = v1Success({
    kept: "value",
    omitted: undefined,
    transformed: Number.NaN
  })
  const payload = textPayload(result)

  assert.deepEqual(result.structuredContent, payload)
  assert.deepEqual(payload.data, { kept: "value", transformed: null })
})

test("success rejects data that cannot be represented as JSON", () => {
  assert.throws(
    () => v1Success({ count: 1n }),
    (error: unknown) => error instanceof AppError && error.code === "V1_RESULT_INVALID"
  )
})

test("success rejects fields outside its declared schema", () => {
  const invalidOptions = [
    { requestId: "" },
    { systemId: "" },
    { warnings: [{ code: "", message: "warning" }] },
    { warnings: [{ code: "WARNING", message: "" }] },
    { page: { returned: -1 } },
    { page: { returned: 1, nextCursor: "" } }
  ]

  for (const options of invalidOptions) {
    assert.throws(
      () => v1Success({}, options),
      (error: unknown) => error instanceof AppError && error.code === "V1_RESULT_INVALID"
    )
  }
})

test("failure normalizes empty terminal fields to its declared schema", () => {
  const payload = V1_ERROR_SCHEMA.parse(textPayload(v1Failure(
    new AppError("", ""),
    "" as never
  )))

  assert.notEqual(payload.requestId, "")
  assert.equal(payload.code, "INTERNAL_ERROR")
  assert.equal(payload.message, "Internal operation failed")
})

test("resource links follow rather than replace the parity text block", () => {
  const result = v1Success(
    { source: "CLASS zcl_demo DEFINITION." },
    {
      resourceLinks: [{
        uri: "adt://dev100/sap/bc/adt/oo/classes/zcl_demo",
        name: "ZCL_DEMO",
        description: "ABAP class source",
        mimeType: "text/plain"
      }]
    }
  )

  assert.equal(result.content[0]?.type, "text")
  assert.deepEqual(textPayload(result), result.structuredContent)
  assert.deepEqual(result.content[1], {
    type: "resource_link",
    uri: "adt://dev100/sap/bc/adt/oo/classes/zcl_demo",
    name: "ZCL_DEMO",
    description: "ABAP class source",
    mimeType: "text/plain"
  })
})

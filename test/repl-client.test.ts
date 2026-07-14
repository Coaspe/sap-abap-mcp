import assert from "node:assert/strict"
import test from "node:test"
import {
  checkReplAvailability,
  executeAbapCode,
  type ReplHttpClient
} from "../src/repl-client.js"
import { AppError } from "../src/errors.js"
import { DEVELOPMENT_PARITY_FIXTURES } from "./fixtures/development-parity.js"

test("ABAP REPL health check uses the single audited GET route", async () => {
  const calls: Array<{ path: string; options: unknown }> = []
  const http: ReplHttpClient = {
    async request(path, options) {
      calls.push({ path, options })
      return { status: 200, body: JSON.stringify(DEVELOPMENT_PARITY_FIXTURES.replHealth) }
    }
  }

  const health = await checkReplAvailability(http)

  assert.deepEqual(health, DEVELOPMENT_PARITY_FIXTURES.replHealth)
  assert.equal(health.production, false)
  assert.deepEqual(calls, [{
    path: "/sap/bc/z_abap_repl",
    options: { method: "GET", timeout: 10_000 }
  }])
})

test("ABAP REPL execution uses the single audited JSON POST route", async () => {
  const calls: Array<{ path: string; options: unknown }> = []
  const http: ReplHttpClient = {
    async request(path, options) {
      calls.push({ path, options })
      return { status: 200, body: JSON.stringify(DEVELOPMENT_PARITY_FIXTURES.replExecution) }
    }
  }

  const execution = await executeAbapCode(http, "WRITE 42.")

  assert.deepEqual(execution, DEVELOPMENT_PARITY_FIXTURES.replExecution)
  assert.equal(execution.output, "42\n")
  assert.deepEqual(calls, [{
    path: "/sap/bc/z_abap_repl",
    options: {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: '{"code":"WRITE 42."}',
      timeout: 60_000
    }
  }])
})

test("ABAP REPL sanitizes raw controls and never retries malformed or missing endpoints", async () => {
  let callCount = 0
  const http: ReplHttpClient = {
    async request() {
      callCount += 1
      if (callCount === 1) {
        return {
          status: 200,
          body: '{"success":true,"output":"first' + "\n" + "second" + "\t"
            + 'value","error":"","runtime_ms":5}'
        }
      }
      if (callCount === 2) return { status: 200, body: '{"success":"yes"}' }
      return { status: 404, body: "Not found" }
    }
  }

  const sanitized = await executeAbapCode(http, "WRITE 42.")
  assert.equal(sanitized.output, "first\nsecond\tvalue")
  assert.equal(callCount, 1)

  await assert.rejects(
    executeAbapCode(http, "WRITE 42."),
    { message: "ABAP REPL field success must be boolean" }
  )
  assert.equal(callCount, 2)

  await assert.rejects(
    checkReplAvailability(http),
    { message: "ABAP REPL returned HTTP 404" }
  )
  assert.equal(callCount, 3)
})

test("ABAP REPL rejects a top-level JSON array with stable malformed JSON details", async () => {
  const http: ReplHttpClient = {
    async request() {
      return { status: 200, body: "[]" }
    }
  }

  await assert.rejects(checkReplAvailability(http), error => {
    assert.ok(error instanceof AppError)
    assert.equal(error.code, "SAP_OPERATION_FAILED")
    assert.equal(error.message, "ABAP REPL returned malformed JSON")
    assert.deepEqual(error.details, {
      endpoint: "/sap/bc/z_abap_repl",
      cause: "object expected"
    })
    return true
  })
})

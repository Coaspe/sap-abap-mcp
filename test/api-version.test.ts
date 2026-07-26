import assert from "node:assert/strict"
import test from "node:test"
import { AppError } from "../src/errors.js"
import { MCP_API_VERSIONS, parseMcpApiVersion } from "../src/mcp/api-version.js"

test("an omitted API version selects the current v1 API", () => {
  assert.equal(parseMcpApiVersion(), "v1")
})

test("the two public API versions are accepted", () => {
  assert.deepEqual(
    MCP_API_VERSIONS.map(parseMcpApiVersion),
    ["v0", "v1"]
  )
})

test("the internal combined API mode is rejected by the public parser", () => {
  assert.throws(
    () => parseMcpApiVersion("all"),
    (error: unknown) => error instanceof AppError &&
      error.code === "INVALID_API_VERSION" &&
      assert.deepEqual(error.details, { available: ["v0", "v1"] }) === undefined
  )
})

test("unknown API versions fail with the available values", () => {
  assert.throws(
    () => parseMcpApiVersion("v2"),
    (error: unknown) => error instanceof AppError &&
      error.code === "INVALID_API_VERSION" &&
      assert.deepEqual(error.details, { available: ["v0", "v1"] }) === undefined
  )
})

test("an explicitly empty API version is invalid", () => {
  assert.throws(
    () => parseMcpApiVersion(""),
    (error: unknown) => error instanceof AppError &&
      error.code === "INVALID_API_VERSION"
  )
})

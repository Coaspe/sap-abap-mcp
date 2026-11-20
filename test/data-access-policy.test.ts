import assert from "node:assert/strict"
import test from "node:test"
import { requireAllowedDataSources, requireDataQueryOptIn } from "../src/data-access-policy.js"

function rejectsCode(operation: () => unknown, code: string): void {
  assert.throws(operation, error =>
    typeof error === "object" && error !== null && "code" in error && error.code === code
  )
}

test("SAP data queries require an explicit profile opt-in", () => {
  rejectsCode(() => requireDataQueryOptIn({}), "DATA_QUERY_NOT_ALLOWED")
  rejectsCode(
    () => requireDataQueryOptIn({ allowDataQueries: false }),
    "DATA_QUERY_NOT_ALLOWED"
  )
})

test("an opted-in profile allows SAP data queries", () => {
  assert.doesNotThrow(() => requireDataQueryOptIn({ allowDataQueries: true }))
})

test("a production profile stays blocked even if its stored opt-in was edited", () => {
  rejectsCode(
    () => requireDataQueryOptIn({ environment: "production", allowDataQueries: true }),
    "DATA_QUERY_NOT_ALLOWED"
  )
})

test("sensitive identifiers are refused in nested queries, joins and quoted names", () => {
  for (const sql of [
    "SELECT * FROM USR02", "SELECT * FROM mara JOIN usr21 ON 1 = 1",
    'SELECT * FROM "SAPABAP1"."PA0001"',
    "SELECT * FROM mara WHERE x IN (SELECT x FROM HRP1000)",
    "WITH x AS (SELECT * FROM usr02) SELECT * FROM x"
  ]) rejectsCode(() => requireAllowedDataSources({}, sql), "DATA_SOURCE_BLOCKED")
  assert.doesNotThrow(() => requireAllowedDataSources({}, "SELECT * FROM MARA WHERE TEXT = 'USR02'"))
  rejectsCode(() => requireAllowedDataSources({ blockedDataSources: ["ZSECRET*"] }, "SELECT * FROM zsecret1"), "DATA_SOURCE_BLOCKED")
})

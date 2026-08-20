import assert from "node:assert/strict"
import test from "node:test"
import { requireDataQueryOptIn } from "../src/data-access-policy.js"

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

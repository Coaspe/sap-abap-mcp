import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv-provider.js"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const index = JSON.parse(await readFile(resolve(root, "docs/evidence/index.json"), "utf8"))
const schema = JSON.parse(await readFile(resolve(root, "docs/compatibility-evidence.schema.json"), "utf8"))
const validate = new AjvJsonSchemaValidator().getValidator(schema)
let supported = 0
for (const file of index.records) {
  assert.match(file, /^[a-z0-9-]+\.json$/)
  const record = JSON.parse(await readFile(resolve(root, "docs/evidence", file), "utf8"))
  const result = validate(record)
  assert.equal(result.valid, true, `${file}: ${result.errorMessage ?? "invalid evidence"}`)
  if (record.scope === "live-sap" && record.status === "supported" && record.productVersion === index.currentProductVersion) supported++
  const check = value => {
    if (!value || typeof value !== "object") return
    for (const [key, child] of Object.entries(value)) {
      assert.doesNotMatch(key, /^(sapUrl|hostname|username|password|token|cookie|sourceCode|objectName|transportNumber|businessData)$/i)
      check(child)
    }
  }
  check(record.sanitizedResult)
}
assert.equal(supported, index.currentLiveSupportedCount)
const readme = await readFile(resolve(root, "README.md"), "utf8")
if (supported === 0) assert.match(readme, /Current 2\.x live-SAP acceptance \| \*\*not verified\*\*/)
const fixture = { schemaVersion: "1.0", productVersion: "fixture", sourceCommit: "1234567",
  scope: "automated-fixture", connection: "fixture", system: { sapRelease: "N/A", systemType: "N/A" },
  capability: "negative-control", status: "supported", observedAt: "2026-10-20T00:00:00Z",
  operation: "negative-control", sanitizedResult: {} }
assert.equal(validate(fixture).valid, false, "Fixture evidence must never become live-supported")
const comparison = JSON.parse(await readFile(resolve(root, "docs/evidence/task-comparison-2026-10-20.json"), "utf8"))
assert.equal(comparison.runs.length, comparison.counts.scheduled)
for (const status of ["success", "partial", "failed", "unsupported", "blocked", "not_run"]) {
  assert.equal(comparison.runs.filter(run => run.status === status).length, comparison.counts[status])
}
assert.equal(comparison.runs.filter(run => run.attempted).length, comparison.counts.attempted)
for (const product of comparison.products) {
  assert.equal(comparison.runs.filter(run => run.product === product.id).length, 15)
}
console.log(JSON.stringify({ scheduledComparisonRuns: comparison.runs.length, validatedRecords: index.records.length, currentLiveSupportedCount: supported, fixturePromotionRejected: true }))

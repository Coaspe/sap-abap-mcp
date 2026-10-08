import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import Ajv from "ajv"

const root = fileURLToPath(new URL("../../", import.meta.url))
const source = JSON.parse(await readFile(new URL("schema-source.json", import.meta.url), "utf8"))
const schemaText = process.argv[2] ? await readFile(process.argv[2], "utf8")
  : await (await fetch(source.sourceUrl)).text()
assert.equal(createHash("sha256").update(schemaText).digest("hex"), source.schemaSha256)
const validate = new Ajv({ strict: false, allErrors: true }).compile(JSON.parse(schemaText))
const formPath = join(root, ".github/ISSUE_TEMPLATE/compatibility-report.yml")
const form = JSON.parse(execFileSync("/usr/bin/ruby", ["-rjson", "-ryaml", "-e",
  "puts JSON.generate(YAML.safe_load(File.read(ARGV[0])))", formPath], { encoding: "utf8" }))
assert.equal(validate(form), true, JSON.stringify(validate.errors))
const ids = ["build", "sap_family", "mcp_client", "operating_system", "starting_state",
  "setup_time", "setup_outcome", "first_read", "failure_category", "repeat_use", "aggregate_consent"]
const safeIntake = value => {
  const fields = value.body.filter(field => field.type !== "markdown")
  return fields.length === ids.length && new Set(fields.map(field => field.id)).size === ids.length
    && fields.every(field => ids.includes(field.id) &&
      (field.id === "build" ? field.type === "input" : field.type === "dropdown"))
}
assert.ok(safeIntake(form))
assert.equal(form.body.filter(field => field.type === "input").length, 1)
for (const field of form.body.filter(field => field.type !== "markdown")) {
  assert.equal(field.validations.required, field.id !== "repeat_use")
  if (field.type === "dropdown") {
    assert.ok(field.attributes.options.length <= 5)
    assert.equal(new Set(field.attributes.options).size, field.attributes.options.length)
  }
}
const malformed = structuredClone(form)
malformed.body.find(field => field.id === "first_read").attributes.options = [123]
assert.equal(validate(malformed), false)
const duplicate = structuredClone(form)
duplicate.body.push(duplicate.body.find(field => field.id === "build"))
assert.equal(safeIntake(duplicate), false)
const credential = structuredClone(form)
credential.body.push({ type: "input", id: "password", attributes: { label: "Password" } })
assert.equal(safeIntake(credential), false)
const upload = structuredClone(form)
upload.body.push({ type: "upload", id: "logs", attributes: { label: "Logs" } })
assert.equal(safeIntake(upload), false)
const scorecard = JSON.parse(await readFile(new URL("scorecard.json", import.meta.url), "utf8"))
assert.deepEqual(scorecard.reports, [])
assert.equal(scorecard.medianSetupTimeBand, null)
assert.ok(Object.values(scorecard).filter(value => typeof value === "number").every(value => value === 0))
assert.equal(scorecard.telemetry, "off")
assert.equal(scorecard.completionClaim, false)
const result = { generatedAt: new Date().toISOString(), node: process.versions.node,
  yamlParsed: true, schemaValidated: true, schemaSource: source.sourceUrl,
  schemaSha256: source.schemaSha256, fieldCount: ids.length, requestedUploads: 0,
  freeTextFields: ["build"], negativeControlsPassed: ["Malformed dropdown option",
    "Duplicate field identifier", "Credential input field", "Diagnostic upload field"],
  zeroRecordedReportsAndNullableMedian: true, runtimeCodeChanged: false, remoteWrites: 0,
  limitations: ["SchemaStore and local policy validation are not GitHub server or rendered-form acceptance.",
    "No contributor session, live SAP operation, first read, external report or adoption was collected.",
    "The form requests no secrets; it cannot prevent arbitrary GitHub edits or contributor mistakes.",
    "Ruby is a local verification dependency, not a product runtime requirement."] }
const output = JSON.stringify(result, null, 2) + "\n"
if (process.argv[3]) await writeFile(process.argv[3], output)
else process.stdout.write(output)

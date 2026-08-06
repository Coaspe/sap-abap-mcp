import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import test from "node:test"
import {
  CHANGE_ASSURANCE_EXIT_CODES,
  changeAssuranceExitCode
} from "../src/change-assurance.js"
import { environmentVariableName } from "../src/secret-store.js"
import { readText } from "./helpers/read-text.js"

const action = readText("action.yml")

const PROFILE_IDS = [
  "CI",
  "ci",
  "B4D",
  "b4d-100",
  "CI_TARGET",
  "dev.100",
  "QAS200"
] as const

test("the assurance gate maps onto blocking exit codes", () => {
  assert.deepEqual(CHANGE_ASSURANCE_EXIT_CODES, {
    passed: 0,
    failed: 1,
    incomplete: 2
  })
  assert.equal(changeAssuranceExitCode("passed"), 0)
  assert.equal(changeAssuranceExitCode("failed"), 1)
  // Unproven safety blocks by default.
  assert.equal(changeAssuranceExitCode("incomplete"), 2)
  assert.equal(changeAssuranceExitCode("incomplete", "failed"), 0)
  assert.equal(changeAssuranceExitCode("failed", "failed"), 1)
  assert.equal(changeAssuranceExitCode("passed", "failed"), 0)
})

test("the action's shell password-variable rule matches the secret store", () => {
  // action.yml reimplements environmentVariableName in shell for the runner.
  // Both implementations must agree for every accepted profile id shape.
  const script = `
password_variable() {
  printf 'SAP_ABAP_MCP_PASSWORD_%s' \\
    "$(printf '%s' "$1" | tr '[:lower:]' '[:upper:]' | tr -c 'A-Z0-9' '_')"
}
for id in ${PROFILE_IDS.join(" ")}; do
  password_variable "$id"
  printf '\\n'
done
`
  let shellOutput: string
  try {
    shellOutput = execFileSync("bash", ["-c", script], { encoding: "utf8" })
  } catch {
    // bash is unavailable on this runner; the structural assertions below still
    // guard the rule, so skip only the differential comparison.
    return
  }
  const fromShell = shellOutput.trim().split("\n").map(line => line.trim())
  const fromSource = PROFILE_IDS.map(id => environmentVariableName(id))

  assert.deepEqual(fromShell, fromSource)
})

test("the action derives the password variable with the documented pipeline", () => {
  assert.match(action, /SAP_ABAP_MCP_PASSWORD_%s/)
  assert.match(action, /tr '\[:lower:\]' '\[:upper:\]'/)
  assert.match(action, /tr -c 'A-Z0-9' '_'/)
})

test("the action gates the pipeline on the assure exit code", () => {
  assert.match(action, /using: composite/)
  // The recorded exit code of `assure` must be the step's exit code, otherwise a
  // failing gate would silently pass the pipeline.
  assert.match(action, /assure_exit=\$\?/)
  assert.match(action, /exit "\$\{assure_exit\}"/)
  assert.match(action, /npx --yes "@coaspe\/sap-abap-mcp@\$\{VERSION\}" "\$\{args\[@\]\}"/)
})

test("the action never passes a password as a command argument", () => {
  // Secrets reach the CLI only through the environment, never argv, so they do
  // not appear in a process list or a runner command echo. Shell comments are
  // stripped first: the action documents *why* it avoids --login.
  const executable = action
    .split("\n")
    .filter(line => !/^\s*#/.test(line))
    .join("\n")

  assert.equal(/--password/.test(executable), false)
  assert.equal(/--password-stdin/.test(executable), false)
  assert.equal(/--login/.test(executable), false)
  assert.match(action, /SAP_PASSWORD: \$\{\{ inputs\.sap-password \}\}/)
  assert.match(action, /export "\$\(password_variable "\$\{SYSTEM_ID\}"\)=\$\{SAP_PASSWORD\}"/)
})

test("the action declares the read-only contract and its outputs", () => {
  assert.match(action, /Never releases or\s+modifies the transport/)
  for (const output of ["gate", "report-json", "report-sarif", "report-junit"]) {
    assert.ok(action.includes(`  ${output}:`), `missing output ${output}`)
  }
  for (const input of [
    "sap-url",
    "sap-client",
    "sap-username",
    "sap-password",
    "transport",
    "checks",
    "fail-on",
    "formats"
  ]) {
    assert.ok(action.includes(`  ${input}:`), `missing input ${input}`)
  }
})

test("the assure command is documented in the CLI help", () => {
  const help = readText("src/index.ts")
  assert.match(help, /assure <id> --transport <trkorr>/)
  assert.match(help, /Exit 0 passed, 1 failed,/)
  const readme = readText("README.md")
  assert.match(readme, /assure/)
})

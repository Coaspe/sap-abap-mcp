import assert from "node:assert/strict"
import test from "node:test"
import { summarizeUserOutcomes } from "../src/user-outcomes.js"

const success = { participant: 1, participantType: "external_abap_developer", aggregateConsent: true,
  evidence: "self_reported", productVersion: "2.0.1", client: "codex", clientVersion: "1.0.0", os: "windows",
  installAttempted: true, mcp: "ready", sapAuthentication: "verified", firstUsefulRead: "success",
  firstTask: "success", day7DifferentTaskReuse: "yes" }

test("failures and missing follow-ups remain in the fixed preregistered cohort denominator", () => {
  const result = summarizeUserOutcomes([success, { ...success, participant: 2, mcp: "setup_required",
    sapAuthentication: "not_run", firstUsefulRead: "not_run", firstTask: "blocked", day7DifferentTaskReuse: "unobserved" }])
  assert.equal(result.cohortDenominator, 10)
  assert.equal(result.firstTask.success, 1)
  assert.equal(result.firstTask.blocked, 1)
  assert.equal(result.mcpInitializedReady, 1)
  assert.equal(result.setupRequired, 1)
  assert.equal(result.unobservedCohortMembers, 8)
  assert.equal(result.targetDecision, "pending")
  // Later reuse is independent of the first task outcome.
  assert.equal(summarizeUserOutcomes([{ ...success, firstTask: "failed" }]).day7DifferentTaskReuse, 1)
})

test("exports reject private fields, impossible stage success and duplicate participants; consent is explicit", () => {
  assert.throws(() => summarizeUserOutcomes([{ ...success, sapUrl: "https://private.invalid" }]))
  assert.throws(() => summarizeUserOutcomes([{ ...success, mcp: "setup_required" }]))
  assert.throws(() => summarizeUserOutcomes([success, success]))
  const result = summarizeUserOutcomes([{ ...success, aggregateConsent: false }])
  assert.equal(result.recordedConsentedParticipants, 0)
  assert.equal(result.targetDecision, "pending")
  assert.equal(JSON.stringify(result).includes("participantType"), false)
})

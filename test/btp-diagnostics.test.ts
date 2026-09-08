import assert from "node:assert/strict"
import test from "node:test"
import { btpConfigurationDiagnostics } from "../src/btp-diagnostics.js"
import type { SapProfile } from "../src/profile-store.js"

const profile: Extract<SapProfile, { authType: "btp_destination" }> = {
  id: "BTP100", url: "https://sap.example.test", client: "100", language: "EN",
  environment: "development", allowedPackages: [], authType: "btp_destination",
  destinationName: "ABAP_DEV", destinationAuthentication: "OAuth2UserTokenExchange"
}

test("BTP local diagnostics distinguish missing, invalid and duplicate bindings without disclosing credentials", () => {
  assert.deepEqual(btpConfigurationDiagnostics(profile, undefined).checks.map(check => check.status), ["missing", "missing"])
  const invalid = btpConfigurationDiagnostics(profile, '{"secret-value"')
  assert.deepEqual(invalid.checks.map(check => check.status), ["invalid_configuration", "invalid_configuration"])
  const report = btpConfigurationDiagnostics(profile, JSON.stringify({
    destination: [{ label: "destination", name: "secret-name", credentials: { clientsecret: "secret-value" } }],
    xsuaa: [{ label: "xsuaa" }, { label: "xsuaa" }]
  }))
  assert.deepEqual(report.checks.map(check => check.status), ["found", "multiple"])
  assert.doesNotMatch(JSON.stringify([report, invalid]), /secret-value|secret-name|clientsecret/)
  assert.equal(report.ok, false)
  assert.equal(report.connectionVerified, false)
})

test("principal propagation diagnostics require connectivity but never claim live verification", () => {
  const input = { ...profile, destinationAuthentication: "PrincipalPropagation" as const }
  const vcap = Object.fromEntries(["destination", "xsuaa", "connectivity"].map(label => [label, [{ label }]]))
  const report = btpConfigurationDiagnostics(input, JSON.stringify(vcap))
  assert.deepEqual(report.checks.map(check => check.status), ["found", "found", "found"])
  assert.equal(report.ok, false)
  assert.match(report.nextAction, /sap.system.inspect/)
  assert.equal(report.localCredentialRequired, false)
})

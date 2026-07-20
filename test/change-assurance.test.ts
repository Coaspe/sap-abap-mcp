import assert from "node:assert/strict"
import test from "node:test"
import {
  renderChangeAssuranceArtifact,
  type ChangeAssuranceReport
} from "../src/change-assurance.js"

const report: ChangeAssuranceReport = {
  schemaVersion: "1.0",
  generatedAt: "2026-07-20T00:00:00.000Z",
  source: "live-sap-adt",
  connectionId: "DEV100",
  targetConnectionId: "QAS100",
  transport: {
    number: "DEVK900123",
    owner: "DEVELOPER",
    description: "Fix <critical> flow",
    status: "D",
    totalObjects: 1,
    assessedObjects: 1,
    truncated: false
  },
  policy: {
    checks: ["atc", "unit_tests", "target_compare"],
    failOnAtcWarnings: false,
    maxObjects: 20
  },
  gate: {
    status: "failed",
    reasons: ["ATC reported 1 error"]
  },
  summary: {
    passedChecks: 2,
    warningChecks: 0,
    failedChecks: 1,
    incompleteChecks: 0,
    atcErrors: 1,
    atcWarnings: 0,
    unitTests: 1,
    unitTestFailures: 0,
    targetDifferences: 1
  },
  objects: [{
    object: {
      key: "R3TR.CLAS.ZCL_DEMO",
      pgmid: "R3TR",
      type: "CLAS",
      name: "ZCL_DEMO",
      uri: "/sap/bc/adt/oo/classes/zcl_demo"
    },
    atc: {
      status: "failed",
      total: 1,
      errors: 1,
      warnings: 0,
      infos: 0,
      findings: [{
        priority: 1,
        checkId: "SECURITY_CHECK",
        checkTitle: "Security check",
        messageId: "UNSAFE_SQL",
        messageTitle: "Unsafe SQL & input",
        location: {
          uri: "/sap/bc/adt/oo/classes/zcl_demo/source/main",
          range: {
            start: { line: 7, column: 2 },
            end: { line: 7, column: 10 }
          }
        }
      }]
    },
    unitTests: {
      status: "passed",
      total: 1,
      passed: 1,
      failed: 0,
      allPassed: true
    },
    targetComparison: {
      status: "different",
      sourceConnectionId: "DEV100",
      targetConnectionId: "QAS100",
      identical: false,
      addedLines: 1,
      removedLines: 0
    }
  }]
}

test("change assurance renders CI-native JSON, SARIF, and JUnit artifacts", () => {
  const json = JSON.parse(renderChangeAssuranceArtifact(report, "json"))
  assert.equal(json.schemaVersion, "1.0")
  assert.equal(json.gate.status, "failed")

  const sarif = JSON.parse(renderChangeAssuranceArtifact(report, "sarif"))
  assert.equal(sarif.version, "2.1.0")
  assert.equal(sarif.runs[0].tool.driver.name, "sap-abap-mcp change assurance")
  assert.equal(sarif.runs[0].results[0].ruleId, "SECURITY_CHECK")
  assert.equal(
    sarif.runs[0].results[0].locations[0].physicalLocation.region.startColumn,
    3
  )

  const junit = renderChangeAssuranceArtifact(report, "junit")
  assert.match(junit, /<testsuite[^>]+failures="1"/)
  assert.match(junit, /Fix &lt;critical&gt; flow/)
  assert.match(junit, /Unsafe SQL &amp; input/)
})

test("JUnit and SARIF keep incomplete missing-test evidence blocking", () => {
  const incomplete: ChangeAssuranceReport = {
    ...report,
    gate: { status: "incomplete", reasons: ["1 requested check was incomplete"] },
    summary: {
      ...report.summary,
      passedChecks: 0,
      failedChecks: 0,
      incompleteChecks: 1,
      atcErrors: 0,
      unitTests: 0,
      targetDifferences: 0
    },
    objects: [{
      object: report.objects[0]!.object,
      unitTests: {
        status: "no_tests",
        total: 0,
        passed: 0,
        failed: 0,
        allPassed: false
      }
    }]
  }

  assert.match(renderChangeAssuranceArtifact(incomplete, "junit"), /errors="1"/)
  const sarif = JSON.parse(renderChangeAssuranceArtifact(incomplete, "sarif"))
  assert.equal(sarif.runs[0].results[0].ruleId, "ABAP_UNIT_MISSING")
  assert.equal(sarif.runs[0].results[0].level, "error")
})

test("empty incomplete transports still fail CI-native artifacts", () => {
  const empty: ChangeAssuranceReport = {
    ...report,
    transport: {
      ...report.transport,
      totalObjects: 0,
      assessedObjects: 0
    },
    gate: { status: "incomplete", reasons: ["The transport contains no objects"] },
    summary: {
      passedChecks: 0,
      warningChecks: 0,
      failedChecks: 0,
      incompleteChecks: 0,
      atcErrors: 0,
      atcWarnings: 0,
      unitTests: 0,
      unitTestFailures: 0,
      targetDifferences: 0
    },
    objects: []
  }

  assert.match(renderChangeAssuranceArtifact(empty, "junit"), /errors="1"/)
  const sarif = JSON.parse(renderChangeAssuranceArtifact(empty, "sarif"))
  assert.equal(sarif.runs[0].results[0].ruleId, "TRANSPORT_ASSESSMENT_INCOMPLETE")
  assert.equal(sarif.runs[0].results[0].level, "error")
})

import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

export type ChangeAssuranceCheck = "atc" | "unit_tests" | "target_compare"
export type ChangeAssuranceFormat = "json" | "sarif" | "junit"
export type ChangeAssuranceGateStatus = "passed" | "failed" | "incomplete"

export interface ChangeAssuranceError {
  code: string
  message: string
}

export interface ChangeAssuranceFinding {
  priority: number
  checkId: string
  checkTitle: string
  messageId: string
  messageTitle: string
  location?: {
    uri?: string
    range?: {
      start?: { line?: number; column?: number }
      end?: { line?: number; column?: number }
    }
  }
  docUri?: string | null
}

export interface ChangeAssuranceObjectResult {
  object: {
    key: string
    pgmid: string
    type: string
    name: string
    uri?: string
  }
  atc?: {
    status: "passed" | "warning" | "failed" | "incomplete" | "error"
    total?: number
    errors?: number
    warnings?: number
    infos?: number
    returned?: number
    truncated?: boolean
    findings?: ChangeAssuranceFinding[]
    error?: ChangeAssuranceError
  }
  unitTests?: {
    status: "passed" | "failed" | "no_tests" | "not_applicable" | "error"
    total?: number
    passed?: number
    failed?: number
    allPassed?: boolean
    failures?: unknown[]
    error?: ChangeAssuranceError
  }
  targetComparison?: {
    status: "identical" | "different" | "missing" | "error"
    sourceConnectionId: string
    targetConnectionId: string
    identical?: boolean
    addedLines?: number
    removedLines?: number
    patchTruncated?: boolean
    patch?: string
    error?: ChangeAssuranceError
  }
}

export interface ChangeAssuranceReport {
  schemaVersion: "1.0"
  generatedAt: string
  source: "live-sap-adt"
  connectionId: string
  targetConnectionId?: string
  transport: {
    number: string
    owner: string
    description: string
    status: string
    totalObjects: number
    assessedObjects: number
    truncated: boolean
  }
  policy: {
    checks: ChangeAssuranceCheck[]
    failOnAtcWarnings: boolean
    maxObjects: number
  }
  gate: {
    status: ChangeAssuranceGateStatus
    reasons: string[]
  }
  summary: {
    passedChecks: number
    warningChecks: number
    failedChecks: number
    incompleteChecks: number
    atcErrors: number
    atcWarnings: number
    unitTests: number
    unitTestFailures: number
    targetDifferences: number
  }
  objects: ChangeAssuranceObjectResult[]
}

export interface ChangeAssuranceArtifact {
  format: ChangeAssuranceFormat
  mimeType: string
  outputPath: string
}

function xmlEscape(value: unknown): string {
  return String(value)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, "\uFFFD")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
}

function sarifRegion(finding: ChangeAssuranceFinding) {
  const start = finding.location?.range?.start
  const end = finding.location?.range?.end
  if (start?.line === undefined) return undefined
  return {
    startLine: start.line,
    ...(start.column === undefined ? {} : { startColumn: start.column + 1 }),
    ...(end?.line === undefined ? {} : { endLine: end.line }),
    ...(end?.column === undefined ? {} : { endColumn: end.column + 1 })
  }
}

function renderSarif(report: ChangeAssuranceReport): string {
  const results: Record<string, unknown>[] = []
  const rules = new Map<string, { id: string; name: string; shortDescription: { text: string } }>()
  const addResult = (
    ruleId: string,
    title: string,
    level: "error" | "warning" | "note",
    message: string,
    uri?: string,
    region?: Record<string, number>
  ) => {
    rules.set(ruleId, { id: ruleId, name: title, shortDescription: { text: title } })
    results.push({
      ruleId,
      level,
      message: { text: message },
      ...(uri
        ? {
            locations: [{
              physicalLocation: {
                artifactLocation: { uri },
                ...(region ? { region } : {})
              }
            }]
          }
        : {})
    })
  }

  for (const item of report.objects) {
    for (const finding of item.atc?.findings ?? []) {
      addResult(
        finding.checkId || finding.messageId || "ABAP_ATC",
        finding.checkTitle || "ABAP Test Cockpit",
        finding.priority === 1 ||
          (finding.priority === 2 && report.policy.failOnAtcWarnings)
          ? "error"
          : finding.priority === 2 ? "warning" : "note",
        `${item.object.name}: ${finding.messageTitle}`,
        finding.location?.uri ?? item.object.uri,
        sarifRegion(finding)
      )
    }
    if (item.atc?.status === "error" && item.atc.error) {
      addResult(
        "ABAP_ATC_EXECUTION",
        "ATC execution",
        "error",
        `${item.object.name}: ${item.atc.error.message}`,
        item.object.uri
      )
    } else if (item.atc?.truncated) {
      addResult(
        "ABAP_ATC_TRUNCATED",
        "ATC result coverage",
        "error",
        `${item.object.name}: ATC returned a truncated finding set`,
        item.object.uri
      )
    }
    if (item.unitTests?.status === "failed") {
      addResult(
        "ABAP_UNIT",
        "ABAP Unit",
        "error",
        `${item.object.name}: ${item.unitTests.failed ?? 0} test(s) failed`,
        item.object.uri
      )
    } else if (item.unitTests?.status === "error" && item.unitTests.error) {
      addResult(
        "ABAP_UNIT_EXECUTION",
        "ABAP Unit execution",
        "error",
        `${item.object.name}: ${item.unitTests.error.message}`,
        item.object.uri
      )
    } else if (item.unitTests?.status === "no_tests") {
      addResult(
        "ABAP_UNIT_MISSING",
        "ABAP Unit coverage",
        "error",
        `${item.object.name}: no ABAP Unit tests were discovered`,
        item.object.uri
      )
    }
    if (item.targetComparison?.status === "error" && item.targetComparison.error) {
      addResult(
        "TARGET_COMPARE_EXECUTION",
        "Target system comparison",
        "error",
        `${item.object.name}: ${item.targetComparison.error.message}`,
        item.object.uri
      )
    }
  }

  if (report.transport.truncated) {
    addResult(
      "TRANSPORT_ASSESSMENT_TRUNCATED",
      "Transport assessment coverage",
      "error",
      `Only ${report.transport.assessedObjects} of ${report.transport.totalObjects} transport objects were assessed`
    )
  }
  if (
    report.gate.status === "incomplete" &&
    !results.some(result => result.level === "error")
  ) {
    addResult(
      "TRANSPORT_ASSESSMENT_INCOMPLETE",
      "Transport assessment gate",
      "error",
      report.gate.reasons.join("; ") || "Transport assessment is incomplete"
    )
  }

  return `${JSON.stringify({
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    version: "2.1.0",
    runs: [{
      tool: {
        driver: {
          name: "sap-abap-mcp change assurance",
          informationUri: "https://github.com/Coaspe/sap-abap-mcp",
          rules: [...rules.values()]
        }
      },
      invocations: [{
        executionSuccessful: report.gate.status !== "incomplete",
        properties: {
          connectionId: report.connectionId,
          transportNumber: report.transport.number,
          gateStatus: report.gate.status
        }
      }],
      results
    }]
  }, null, 2)}\n`
}

interface JunitCase {
  name: string
  classname: string
  failure?: string
  error?: string
  skipped?: string
  output?: string
}

function renderJunit(report: ChangeAssuranceReport): string {
  const cases: JunitCase[] = []
  for (const item of report.objects) {
    if (item.atc) {
      const messages = (item.atc.findings ?? []).map(finding => finding.messageTitle).join("\n")
      cases.push({
        name: `${item.object.name} ATC`,
        classname: `${report.transport.number}.${item.object.type}`,
        ...(item.atc.status === "failed" ? { failure: messages || "ATC gate failed" } : {}),
        ...(item.atc.status === "error" ? { error: item.atc.error?.message ?? "ATC execution failed" } : {}),
        ...(item.atc.status === "incomplete" ? { error: "ATC returned a truncated finding set" } : {}),
        ...(item.atc.status === "warning" ? { output: messages } : {})
      })
    }
    if (item.unitTests) {
      cases.push({
        name: `${item.object.name} ABAP Unit`,
        classname: `${report.transport.number}.${item.object.type}`,
        ...(item.unitTests.status === "failed"
          ? { failure: `${item.unitTests.failed ?? 0} of ${item.unitTests.total ?? 0} test(s) failed` }
          : {}),
        ...(item.unitTests.status === "error"
          ? { error: item.unitTests.error?.message ?? "ABAP Unit execution failed" }
          : {}),
        ...(item.unitTests.status === "no_tests" ? { error: "No ABAP Unit tests discovered" } : {}),
        ...(item.unitTests.status === "not_applicable" ? { skipped: "Not an ABAP class" } : {})
      })
    }
    if (item.targetComparison) {
      cases.push({
        name: `${item.object.name} target comparison`,
        classname: `${report.transport.number}.${item.object.type}`,
        ...(item.targetComparison.status === "error"
          ? { error: item.targetComparison.error?.message ?? "Target comparison failed" }
          : {}),
        ...(item.targetComparison.status === "missing" ? { output: "Object is not present on the target system" } : {}),
        ...(item.targetComparison.status === "different"
          ? { output: `Target differs: +${item.targetComparison.addedLines ?? 0} -${item.targetComparison.removedLines ?? 0}` }
          : {})
      })
    }
  }

  if (report.transport.truncated) {
    cases.push({
      name: "transport coverage",
      classname: report.transport.number,
      error: `Only ${report.transport.assessedObjects} of ${report.transport.totalObjects} objects were assessed`
    })
  }
  if (report.gate.status === "incomplete" && !cases.some(item => item.error)) {
    cases.push({
      name: "transport assessment gate",
      classname: report.transport.number,
      error: report.gate.reasons.join("; ") || "Transport assessment is incomplete"
    })
  }

  const failures = cases.filter(item => item.failure).length
  const errors = cases.filter(item => item.error).length
  const skipped = cases.filter(item => item.skipped).length
  const body = cases.map(item => {
    const details = [
      item.failure ? `<failure message="${xmlEscape(item.failure)}">${xmlEscape(item.failure)}</failure>` : "",
      item.error ? `<error message="${xmlEscape(item.error)}">${xmlEscape(item.error)}</error>` : "",
      item.skipped ? `<skipped message="${xmlEscape(item.skipped)}"/>` : "",
      item.output ? `<system-out>${xmlEscape(item.output)}</system-out>` : ""
    ].join("")
    return `  <testcase name="${xmlEscape(item.name)}" classname="${xmlEscape(item.classname)}">${details}</testcase>`
  }).join("\n")

  return [
    "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
    `<testsuite name="${xmlEscape(`${report.transport.number} ${report.transport.description}`)}" tests="${cases.length}" failures="${failures}" errors="${errors}" skipped="${skipped}">`,
    body,
    "</testsuite>",
    ""
  ].join("\n")
}

export function renderChangeAssuranceArtifact(
  report: ChangeAssuranceReport,
  format: ChangeAssuranceFormat
): string {
  if (format === "sarif") return renderSarif(report)
  if (format === "junit") return renderJunit(report)
  return `${JSON.stringify(report, null, 2)}\n`
}

export async function writeChangeAssuranceArtifacts(
  report: ChangeAssuranceReport,
  formats: ChangeAssuranceFormat[],
  reportDirectory?: string
): Promise<ChangeAssuranceArtifact[]> {
  const outputDirectory = reportDirectory?.trim()
    ? resolve(reportDirectory)
    : await mkdtemp(join(tmpdir(), "sap-abap-mcp-assurance-"))
  await mkdir(outputDirectory, { recursive: true })
  const safeTransport = report.transport.number.replace(/[^A-Za-z0-9._-]/g, "_")
  const mimeTypes: Record<ChangeAssuranceFormat, string> = {
    json: "application/json",
    sarif: "application/sarif+json",
    junit: "application/xml"
  }
  const extensions: Record<ChangeAssuranceFormat, string> = {
    json: "json",
    sarif: "sarif",
    junit: "xml"
  }
  const artifacts: ChangeAssuranceArtifact[] = []
  for (const format of [...new Set(formats)]) {
    const outputPath = join(
      outputDirectory,
      `${safeTransport}-change-assurance.${extensions[format]}`
    )
    await writeFile(outputPath, renderChangeAssuranceArtifact(report, format), "utf8")
    artifacts.push({ format, mimeType: mimeTypes[format], outputPath })
  }
  return artifacts
}

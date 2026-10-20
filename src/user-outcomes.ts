import { z } from "zod"

const reportSchema = z.object({
  participant: z.number().int().min(1).max(10),
  participantType: z.literal("external_abap_developer"),
  aggregateConsent: z.boolean(),
  evidence: z.enum(["self_reported", "owner_observed_with_consent"]),
  productVersion: z.string().regex(/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/),
  client: z.enum(["codex", "claude_code", "claude_desktop", "other"]),
  clientVersion: z.string().regex(/^[A-Za-z0-9.+_-]{1,40}$/),
  os: z.enum(["macos", "windows", "linux", "other"]),
  installAttempted: z.boolean(),
  mcp: z.enum(["ready", "setup_required", "failed", "not_run"]),
  sapAuthentication: z.enum(["verified", "failed", "not_run"]),
  firstUsefulRead: z.enum(["success", "failed", "not_run"]),
  firstTask: z.enum(["success", "partial", "failed", "blocked", "not_run"]),
  day7DifferentTaskReuse: z.enum(["yes", "no", "not_due", "unobserved"])
}).strict().superRefine((report, context) => {
  if ((report.firstTask === "success" || report.firstUsefulRead === "success") &&
      (report.mcp !== "ready" || report.sapAuthentication !== "verified" || !report.installAttempted)) {
    context.addIssue({ code: "custom", message: "Task/read success requires an attempted install, ready MCP and verified SAP authentication" })
  }
  if (report.day7DifferentTaskReuse === "yes" &&
      (report.mcp !== "ready" || report.sapAuthentication !== "verified" || !report.installAttempted)) {
    context.addIssue({ code: "custom", message: "Confirmed task reuse requires an attempted install, ready MCP and verified SAP authentication" })
  }
})

export function summarizeUserOutcomes(input: unknown) {
  const reports = z.array(reportSchema).parse(input).filter(report => report.aggregateConsent)
  if (new Set(reports.map(report => report.participant)).size !== reports.length) throw new Error("One current record per preregistered participant is required")
  const count = (matches: (report: typeof reports[number]) => boolean) => reports.filter(matches).length
  const firstTaskSuccess = count(report => report.firstTask === "success")
  const reuse = count(report => report.day7DifferentTaskReuse === "yes")
  return { telemetry: "off", cohortDenominator: 10, recordedConsentedParticipants: reports.length,
    unobservedCohortMembers: 10 - reports.length,
    installationAttempts: count(report => report.installAttempted),
    mcpInitializedReady: count(report => report.mcp === "ready"),
    setupRequired: count(report => report.mcp === "setup_required"),
    sapAuthenticationVerified: count(report => report.sapAuthentication === "verified"),
    firstUsefulReadSuccess: count(report => report.firstUsefulRead === "success"),
    firstTask: Object.fromEntries(["success", "partial", "failed", "blocked", "not_run"].map(status => [status, count(report => report.firstTask === status)])),
    day7DifferentTaskReuse: reuse,
    day7Unobserved: count(report => report.day7DifferentTaskReuse === "unobserved"),
    day7NotDue: count(report => report.day7DifferentTaskReuse === "not_due"),
    initialDecisionTargets: { firstTaskSuccess: 8, day7DifferentTaskReuse: 5 },
    targetDecision: reports.length < 10 || reports.some(report => ["not_due", "unobserved"].includes(report.day7DifferentTaskReuse))
      ? "pending" : firstTaskSuccess >= 8 && reuse >= 5 ? "met" : "not_met",
    interpretation: "Initial owner-defined decision criteria, not a market benchmark or guarantee. Failures and missing follow-ups stay in the fixed cohort denominator. Self reports are not live compatibility records or adopter permission." }
}

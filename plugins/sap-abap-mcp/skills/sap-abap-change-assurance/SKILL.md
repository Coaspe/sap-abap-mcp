---
name: sap-abap-change-assurance
description: Assess an SAP transport before release by running ATC, ABAP Unit, and optional cross-system comparison, then produce JSON, SARIF, and JUnit evidence. Use when reviewing a transport, preparing a release gate, investigating a failed quality gate, or integrating SAP change checks into CI.
---

# SAP ABAP change assurance

Assess a transport through live, read-only ADT checks. Keep the assessment distinct from the destructive release action.

## Run the assessment

1. Call `get_connected_systems`. Require the user to identify the exact source `connectionId` if it is not already explicit. Never infer or silently switch systems.
2. Require a transport number. Ask for a target `connectionId` only when the user wants a DEV-to-QAS or other landscape comparison.
3. Call `manage_transport_requests` with:

   - `action: "assess_transport"`
   - the exact source `connectionId` and `transportNumber`
   - `checks: ["atc", "unit_tests"]` by default
   - add `"target_compare"` and `targetConnectionId` only for an explicit landscape comparison
   - `reportFormats: ["json", "sarif", "junit"]` when CI evidence is requested
   - `maxObjects` set high enough for the transport, up to 200
   - `failOnAtcWarnings: true` only when the user or repository policy makes warnings blocking

4. If the caller supplied a trusted local CI artifact directory, pass it as `reportDirectory`. Otherwise use the temporary paths returned by the tool.
5. Do not call `release_transport` as part of this skill. Release is a separate mutation requiring an explicit user request and exact transport-number confirmation.

## Interpret the gate

- `passed`: Every requested applicable check completed, no blocking ATC finding or ABAP Unit failure occurred, and the transport was not truncated. ATC warnings may still appear when they are non-blocking.
- `failed`: A blocking ATC result or ABAP Unit failure occurred. Summarize the affected objects and findings; do not recommend release.
- `incomplete`: A requested check failed to execute, a class had no discoverable tests, the transport contained no objects, ATC findings were truncated, or more objects existed than `maxObjects`. Never present an incomplete result as a pass.

Treat `targetComparison.status: "different"` as evidence of the expected source delta, not automatically as a defect. Treat `missing` as a risk that needs human review. Report `error` as incomplete evidence.

## Use the artifacts

- JSON is the canonical complete report and preserves the explicit gate decision and policy.
- SARIF 2.1.0 is for code-scanning ingestion. It contains ATC findings, failed ABAP Unit checks, execution errors, and coverage truncation.
- JUnit XML is for CI test-report ingestion. Failed checks become failures, execution, coverage, and missing-test problems become errors, and non-applicable checks become skipped cases.

Return each artifact path and the gate summary. Do not claim that an SAP release, feature, or authorization is supported merely because the local MCP process is connected; only the selected live system's evidence is authoritative.

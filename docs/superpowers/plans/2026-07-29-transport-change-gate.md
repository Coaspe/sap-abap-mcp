# Transport Change Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Productize the existing read-only transport assessment as a deterministic CLI, compact MCP preset, and reusable GitHub composite Action.

**Architecture:** Reuse `AbapToolService.manageTransportRequests({ action: "assess_transport" })` as the single assessment engine. Add a small policy parser and CLI wrapper that emit compact, non-sensitive console output while retaining full JSON/SARIF/JUnit artifacts on disk. The GitHub Action invokes the same built CLI and requires a customer-controlled runner with SAP network access.

**Tech Stack:** TypeScript 7, Node.js 20/24, Zod 4, SAP ADT, GitHub composite Actions, JSON, SARIF 2.1.0, JUnit XML.

## Global Constraints

- Complete `2026-07-29-security-and-ci-hardening.md` and `2026-07-29-data-access-policy-hardening.md` first.
- Keep transport assessment read-only and never call `release_transport`.
- Fail closed: both `failed` and `incomplete` must return nonzero exit codes.
- Preserve all existing MCP tool and Resource names.
- Do not write SAP credentials or profile configuration into the repository or Action artifacts.
- Console output must exclude SAP URL, username, source, transport description, object names, and finding text.
- Full reports may contain development metadata and must remain in the user's controlled artifact store.
- The Action must document that GitHub-hosted runners normally cannot reach private SAP systems.

---

### Task 1: Define and validate the gate policy

**Files:**
- Create: `src/transport-gate.ts`
- Create: `test/transport-gate.test.ts`

**Interfaces:**
- Consumes: `ChangeAssuranceCheck`, `ChangeAssuranceFormat`, `ChangeAssuranceGateStatus`, and `ManageTransportsInput`.
- Produces:

```ts
export interface TransportGatePolicy {
  schemaVersion: "1.0"
  checks: ChangeAssuranceCheck[]
  failOnAtcWarnings: boolean
  maxObjects: number
  targetConnectionId?: string
  reportFormats: ChangeAssuranceFormat[]
}

export interface TransportGateRequest {
  connectionId: string
  transportNumber: string
  policy: TransportGatePolicy
  reportDirectory: string
}

export interface TransportGateSummary {
  schemaVersion: "1.0"
  gate: ChangeAssuranceGateStatus
  transportNumber: string
  assessedObjects: number
  totalObjects: number
  reasons: string[]
  reports: Array<{
    format: ChangeAssuranceFormat
    outputPath: string
  }>
}

export const DEFAULT_TRANSPORT_GATE_POLICY: TransportGatePolicy
export function parseTransportGatePolicy(value: unknown): TransportGatePolicy
export function readTransportGatePolicy(path?: string): Promise<TransportGatePolicy>
export function transportGateExitCode(status: ChangeAssuranceGateStatus): 0 | 1 | 2
```

- [ ] **Step 1: Write failing policy tests**

Test these exact outcomes:

```ts
assert.deepEqual(parseTransportGatePolicy({
  schemaVersion: "1.0",
  checks: ["atc", "unit_tests"],
  failOnAtcWarnings: true,
  maxObjects: 200,
  reportFormats: ["json", "sarif", "junit"]
}), {
  schemaVersion: "1.0",
  checks: ["atc", "unit_tests"],
  failOnAtcWarnings: true,
  maxObjects: 200,
  reportFormats: ["json", "sarif", "junit"]
})

assert.equal(transportGateExitCode("passed"), 0)
assert.equal(transportGateExitCode("failed"), 1)
assert.equal(transportGateExitCode("incomplete"), 2)
```

Also assert rejection of duplicate checks, an empty check list, unknown fields, `maxObjects` outside 1–200, `target_compare` without `targetConnectionId`, non-JSON policy files, and report formats outside `json|sarif|junit`.

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
npm run build && node --test dist/test/transport-gate.test.js
```

Expected: FAIL because `src/transport-gate.ts` does not exist.

- [ ] **Step 3: Implement strict policy parsing**

Use a strict Zod object. The default policy is:

```ts
{
  schemaVersion: "1.0",
  checks: ["atc", "unit_tests"],
  failOnAtcWarnings: false,
  maxObjects: 200,
  reportFormats: ["json", "sarif", "junit"]
}
```

`readTransportGatePolicy()` must return that default when no path is supplied. When a path is supplied, resolve it to an absolute path, read UTF-8 JSON, parse once, and throw `AppError("TRANSPORT_GATE_POLICY_INVALID", ...)` with only the file path and validation issue paths.

- [ ] **Step 4: Run the focused test**

Run:

```bash
npm run build && node --test dist/test/transport-gate.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/transport-gate.ts test/transport-gate.test.ts
git commit -m "feat: define transport gate policy"
```

### Task 2: Add a reusable gate runner

**Files:**
- Modify: `src/transport-gate.ts`
- Modify: `test/transport-gate.test.ts`

**Interfaces:**
- Consumes:

```ts
export interface TransportAssessmentService {
  manageTransportRequests(input: ManageTransportsInput): Promise<unknown>
}
```

- Produces:

```ts
export function runTransportGate(
  service: TransportAssessmentService,
  request: TransportGateRequest
): Promise<{
  report: ChangeAssuranceReport & { reports: ChangeAssuranceArtifact[] }
  summary: TransportGateSummary
  exitCode: 0 | 1 | 2
}>
```

- [ ] **Step 1: Write a failing pass/fail/incomplete runner test**

Use one fake service that records its input and returns a supplied report. Assert:

- `action` is exactly `assess_transport`;
- `startIndex` is `0`;
- `maxResults` is `1000`;
- `includeObjects` is `false`;
- the policy fields and report directory are forwarded exactly;
- the summary contains counts and report paths but not `owner`, `description`, `objects`, `findings`, `connectionId`, or `targetConnectionId`;
- passed/failed/incomplete map to exit codes 0/1/2.
- equal source and target connection IDs are rejected before the service call.

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
npm run build && node --test dist/test/transport-gate.test.js
```

Expected: FAIL because `runTransportGate` is absent.

- [ ] **Step 3: Implement the runner as one service call**

Call:

```ts
service.manageTransportRequests({
  action: "assess_transport",
  connectionId: request.connectionId,
  transportNumber: request.transportNumber,
  startIndex: 0,
  maxResults: 1000,
  includeObjects: false,
  checks: request.policy.checks,
  failOnAtcWarnings: request.policy.failOnAtcWarnings,
  maxObjects: request.policy.maxObjects,
  reportFormats: request.policy.reportFormats,
  reportDirectory: request.reportDirectory,
  ...(request.policy.targetConnectionId
    ? { targetConnectionId: request.policy.targetConnectionId }
    : {})
})
```

Normalize profile and transport IDs to uppercase before the call. Reject equal source and target IDs with `AppError("SAME_CONNECTION", ...)`.
Validate that the returned value contains `schemaVersion: "1.0"`, a known gate status, transport counts, summary counts, and a report list before constructing the public summary. Reject another action's response with `AppError("TRANSPORT_GATE_RESULT_INVALID", ...)`.

- [ ] **Step 4: Run the focused test**

Run:

```bash
npm run build && node --test dist/test/transport-gate.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/transport-gate.ts test/transport-gate.test.ts
git commit -m "feat: run transport assurance as a gate"
```

### Task 3: Expose the gate through the CLI

**Files:**
- Modify: `src/index.ts`
- Modify: `src/compat/abap-fs-documentation.ts`
- Create: `test/cli-transport-gate.test.ts`

**Interfaces:**
- Consumes: `readTransportGatePolicy()` and `runTransportGate()`.
- Produces:

```text
sap-abap-mcp gate transport <transport-number>
  --profile <id>
  [--policy <absolute-or-relative-json-path>]
  --report-directory <absolute-or-relative-path>
```

- [ ] **Step 1: Export a testable CLI operation**

Define:

```ts
export interface TransportGateCommandDependencies {
  profiles: ProfileStore
  secrets: SecretStore
  createManager: (
    profiles: ProfileStore,
    secrets: SecretStore,
    profileId: string
  ) => ConnectionManager
}

export function executeTransportGateCommand(
  parsed: ParsedArguments,
  dependencies: TransportGateCommandDependencies
): Promise<{ summary: TransportGateSummary; exitCode: 0 | 1 | 2 }>
```

Make `ParsedArguments` exportable without changing its fields.

- [ ] **Step 2: Write failing CLI tests**

Assert:

- missing `transport` subcommand returns `UNKNOWN_COMMAND`;
- missing transport number returns `ARGUMENT_REQUIRED`;
- missing `--profile` returns `OPTION_REQUIRED`;
- missing `--report-directory` returns `OPTION_REQUIRED`;
- the profile must exist before SAP access;
- manager closure occurs for passed, failed, incomplete, and thrown service errors;
- only `TransportGateSummary` is written to stdout;
- `runCli` sets `process.exitCode` to 1 or 2 without converting gate results into `INTERNAL_ERROR`.

- [ ] **Step 3: Implement CLI routing**

Add `gate` to `HELP` and dispatch it before `serve`. Construct `ConnectionManager(profiles, secrets, undefined, profileId)`, construct `AbapToolService`, call the gate runner, and close the manager in `finally`.

Use the process exit code only at the outer `runCli` boundary:

```ts
const result = await executeTransportGateCommand(parsed, dependencies)
writeJson(result.summary)
process.exitCode = result.exitCode
```

- [ ] **Step 4: Run CLI and regression tests**

Run:

```bash
npm run build
node --test \
  dist/test/cli-transport-gate.test.js \
  dist/test/cli-profile.test.js \
  dist/test/change-assurance.test.js \
  dist/test/integration.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add \
  src/index.ts \
  src/compat/abap-fs-documentation.ts \
  test/cli-transport-gate.test.ts
git commit -m "feat: expose transport change gate CLI"
```

### Task 4: Add the compact assurance MCP preset

**Files:**
- Create: `src/mcp/presets.ts`
- Modify: `src/mcp/tool-selection.ts`
- Modify: `src/index.ts`
- Create: `test/v1-presets.test.ts`
- Modify: `test/compatibility.test.ts`

**Interfaces:**
- Consumes: existing v1 tool and Resource names.
- Produces:

```ts
export type McpPresetName = "assurance"

export interface McpPresetSelection {
  tools: ReadonlySet<string>
  resources: ReadonlySet<V1ResourceName>
}

export function selectionForPreset(name: McpPresetName): McpPresetSelection
```

CLI:

```text
serve [--preset assurance]
```

- [ ] **Step 1: Write failing exact-inventory tests**

Require the assurance preset to expose exactly these ten tools:

```text
sap.system.list
sap.system.inspect
sap.system.capabilities
sap.repository.search
sap.source.read
sap.source.diagnose
sap.quality.unit_test
sap.quality.atc.run
sap.transport.inspect
sap.transport.assess
```

Require exactly these four Resources:

```text
sap-adt-source
sap-capability-evidence
sap-evidence
sap-transport
```

Assert that unversioned `serve` without `--preset` still exposes 115 tools and seven Resources. Assert `--preset` and `--toolsets` together return `TOOL_SELECTION_CONFLICT`.

- [ ] **Step 2: Run focused tests and verify they fail**

Run:

```bash
npm run build
node --test dist/test/v1-presets.test.js dist/test/compatibility.test.js
```

Expected: FAIL because presets do not exist.

- [ ] **Step 3: Implement the explicit preset**

Keep the preset as an explicit list rather than deriving it from broad toolsets. Validate names against `V1_TOOL_NAMES` and `V1_RESOURCE_NAMES` at module initialization so a future rename fails tests.

- [ ] **Step 4: Add CLI parsing**

Accept only `assurance`. Reject `--preset` for v0 with `PRESET_API_VERSION_UNSUPPORTED`. Pass the selected sets through the existing `ServeToolSelection` interface.

- [ ] **Step 5: Run inventory and smoke tests**

Run:

```bash
npm run build
node --test \
  dist/test/v1-presets.test.js \
  dist/test/api-version.test.js \
  dist/test/compatibility.test.js \
  dist/test/v0-contract.test.js
node scripts/smoke-v1-stdio.mjs
```

Expected: PASS; the default remains 115/7 and assurance is 10/4.

- [ ] **Step 6: Commit**

```bash
git add \
  src/mcp/presets.ts \
  src/mcp/tool-selection.ts \
  src/index.ts \
  test/v1-presets.test.ts \
  test/compatibility.test.ts
git commit -m "feat: add compact assurance MCP preset"
```

### Task 5: Add the GitHub composite Action

**Files:**
- Create: `.github/actions/transport-gate/action.yml`
- Create: `docs/examples/transport-gate.yml`
- Create: `docs/transport-change-gate.md`
- Modify: `test/registry-metadata.test.ts`

**Interfaces:**
- Consumes: a preconfigured local profile and the CLI built at the Action tag.
- Produces: a failed, incomplete, or passed check and reports under the requested directory.

- [ ] **Step 1: Write failing Action metadata tests**

Assert the Action:

- uses `node "$GITHUB_ACTION_PATH/dist/src/index.js" gate transport`;
- accepts `profile`, `transport`, `policy`, and `report-directory`;
- does not accept SAP password, token, URL, username, or source as inputs;
- invokes no transport release command;
- is a composite Action.

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
npm run build && node --test dist/test/registry-metadata.test.js
```

Expected: FAIL because the Action is absent.

- [ ] **Step 3: Create the composite Action**

Use `shell: bash` and construct an argument array so paths are not evaluated by the shell. Require `report-directory`; append `--policy` only when the input is non-empty.

Run the checked-out Action code:

```bash
node "$GITHUB_ACTION_PATH/dist/src/index.js" \
  gate transport "$TRANSPORT_NUMBER" \
  --profile "$PROFILE_ID" \
  --report-directory "$REPORT_DIRECTORY"
```

Do not run `npx @latest`; the Action tag and runtime code must be the same release.

- [ ] **Step 4: Add the example workflow**

The example must:

- use `runs-on: self-hosted`;
- create or verify a non-production profile before invoking the Action;
- supply the profile-specific secret through an environment variable;
- upload JSON/JUnit reports with `actions/upload-artifact`;
- upload SARIF with `github/codeql-action/upload-sarif@v4` using `if: always()`;
- state that the workflow never releases a transport.

- [ ] **Step 5: Document network and secret boundaries**

Document:

- self-hosted runner or approved network route required for private SAP;
- use a dedicated technical/developer identity with least privilege;
- never use a production profile for the gate;
- retain report artifacts according to customer policy;
- reports can contain object names and finding details even though console output does not.

- [ ] **Step 6: Run metadata tests**

Run:

```bash
npm run build
node --test dist/test/registry-metadata.test.js
ruby -e 'require "yaml"; YAML.load_file(".github/actions/transport-gate/action.yml", aliases: true)'
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add \
  .github/actions/transport-gate/action.yml \
  docs/examples/transport-gate.yml \
  docs/transport-change-gate.md \
  test/registry-metadata.test.ts
git commit -m "feat: add transport gate GitHub Action"
```

### Task 6: Reposition documentation around the gate

**Files:**
- Modify: `README.md`
- Modify: `docs/demo-script.md`
- Modify: `ROADMAP.md`
- Modify: `CHANGELOG.md`
- Test: `test/v1-documentation.test.ts`

**Interfaces:**
- Consumes: the verified CLI, preset, and Action.
- Produces: one primary product story: assess an SAP transport without releasing it.

- [ ] **Step 1: Add failing documentation assertions**

Require the README to contain:

- the `gate transport` command;
- exit-code meanings 0/1/2;
- the assurance preset command;
- a link to `docs/transport-change-gate.md`;
- an explicit statement that assessment never releases a transport.

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
npm run build && node --test dist/test/v1-documentation.test.js
```

Expected: FAIL until documentation is updated.

- [ ] **Step 3: Update the README and demo**

Lead with the outcome, not the 115-tool count. Show:

```bash
sap-abap-mcp gate transport DEVK900123 \
  --profile DEV100 \
  --policy ./transport-gate.policy.json \
  --report-directory ./artifacts
```

Keep the existing full-tool documentation but move it below the gate workflow.

- [ ] **Step 4: Run documentation tests**

Run:

```bash
npm run build
node --test dist/test/v1-documentation.test.js dist/test/registry-metadata.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add README.md docs/demo-script.md ROADMAP.md CHANGELOG.md test/v1-documentation.test.ts
git commit -m "docs: lead with transport change assurance"
```

### Task 7: Complete local and live acceptance

**Files:**
- Modify: `docs/live-sap-acceptance.md`
- Create after a successful live run: a private, customer-controlled report directory only; do not commit it.

**Interfaces:**
- Consumes: the full branch and a disposable development transport.
- Produces: release evidence without releasing or modifying the transport.

- [ ] **Step 1: Run complete automated verification**

Run:

```bash
npm run check
npm run smoke:v1
npm run conformance:v1
npm run build:mcpb
npm pack --dry-run
npm audit --omit=dev
git diff --check
```

Expected: every command exits zero.

- [ ] **Step 2: Run a passed live gate**

Use a disposable, unreleased development transport containing only approved test objects. Run ATC and ABAP Unit and verify exit code 0, all three artifact types, and no SAP mutation.

- [ ] **Step 3: Run a deliberate incomplete live gate**

Use a disposable test transport or policy that produces missing-test evidence. Verify exit code 2 and that JUnit/SARIF remain blocking.

- [ ] **Step 4: Inspect redaction**

Capture stdout only and verify it contains no SAP URL, username, source, object name, transport description, ATC message text, or target-system details.

- [ ] **Step 5: Open a ready PR**

Require all security and CI checks from the P0 plan. The PR description must state the exact live transport scope and confirm that no release occurred, without naming the SAP host, user, or proprietary objects.

### Task 8: Publish version 1.1.0

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `server.json`
- Modify: `mcpb/manifest.json`
- Modify: `CHANGELOG.md`
- Create: `artifacts/sap-abap-mcp-1.1.0.mcpb`

**Interfaces:**
- Consumes: the merged and live-accepted transport-gate feature.
- Produces: aligned npm, GitHub Release, MCPB, and Official MCP Registry version `1.1.0`.

- [ ] **Step 1: Set version 1.1.0**

Run:

```bash
npm version 1.1.0 --no-git-tag-version
```

Update `server.json` and `mcpb/manifest.json`, regenerate the MCPB, and add the gate CLI, assurance preset, composite Action, exit codes, and security boundaries to `CHANGELOG.md`.

- [ ] **Step 2: Run the release gate**

Run:

```bash
npm ci
npm run check
npm run smoke:v1
npm run conformance:v1
npm run build:mcpb
npm pack --dry-run
npm audit --omit=dev
npm audit signatures
git diff --check
```

Expected: every command exits zero; default v1 remains 115/7, v0 remains 53, and the assurance preset is 10/4.

- [ ] **Step 3: Open and merge the release PR**

Commit only the five metadata files, changelog, and `artifacts/sap-abap-mcp-1.1.0.mcpb`. Merge after CI, package, dependency-review, and CodeQL checks pass.

- [ ] **Step 4: Tag and publish the merged commit**

Fast-forward local `main`, create and push tag `v1.1.0`, publish npm with provenance, publish the Official MCP Registry entry, and create the GitHub release with the MCPB and its SHA-256 checksum.

- [ ] **Step 5: Verify the installed release**

From a fresh temporary directory, install or run `@coaspe/sap-abap-mcp@1.1.0` and verify:

- `help` shows `gate transport` and `--preset assurance`;
- default v1 discovery returns 115 tools and seven Resources;
- assurance discovery returns ten tools and four Resources;
- v0 discovery returns 53 tools;
- npm displays provenance;
- the GitHub MCPB checksum matches the local artifact.

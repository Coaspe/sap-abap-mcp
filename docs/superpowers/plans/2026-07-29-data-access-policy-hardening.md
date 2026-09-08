# Data Access Policy Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep user-defined SAP SQL and query-backed monitoring disabled by default while preserving repository development, system diagnostics, local-data export, and the existing MCP discovery contracts.

**Architecture:** Add one persisted profile capability, `allowDataQueries`, defaulting to `false` for existing and new profiles. Enforce it immediately before every user-defined SAP `runQuery` path in `AbapToolService`; keep internal bounded system-metadata reads inside `AdtSapClient.getSystemInfo()` unchanged. Leave the tools discoverable for compatibility, but make their descriptions and errors explain the explicit opt-in.

**Tech Stack:** TypeScript 7, Zod 4, existing profile store, MCP v0/v1 adapters, Node test runner.

## Global Constraints

- Complete and release `2026-07-29-security-and-ci-hardening.md` as `1.0.1` first.
- Preserve the v1 115-tool/seven-Resource and v0 53-tool discovery contracts.
- Default existing profiles and newly created profiles to `allowDataQueries: false`.
- Reject `allowDataQueries: true` for production profiles.
- Do not block repository reads, ATC, ABAP Unit, transport assessment, system discovery, or bounded internal system metadata used by `doctor`.
- Do not treat production read-only mode as permission to query application data.
- Local caller-supplied `data` export remains available because it does not call SAP.
- Never log SQL text when access is denied.
- Release this additive policy control together with the Change Gate as version `1.1.0`.

---

### Task 1: Add the profile capability

**Files:**
- Modify: `src/profile-store.ts`
- Modify: `src/index.ts`
- Modify: `test/profile-store.test.ts`
- Modify: `test/cli-profile.test.ts`

**Interfaces:**
- Consumes: stored profile file version 1.
- Produces:

```ts
export interface SapProfileInput {
  // existing fields
  allowDataQueries?: boolean
}
```

Every normalized `SapProfile` contains:

```ts
allowDataQueries: boolean
```

CLI:

```text
profile add <id> ... [--allow-data-queries]
```

- [ ] **Step 1: Write failing profile migration tests**

Assert:

```ts
assert.equal(normalizeProfile({
  id: "DEV100",
  url: "https://sap.example.test",
  client: "100"
}).allowDataQueries, false)

assert.equal(normalizeProfile({
  id: "DEV100",
  url: "https://sap.example.test",
  client: "100",
  allowDataQueries: true
}).allowDataQueries, true)
```

Write a version-1 profile JSON fixture without `allowDataQueries`, load it, and assert the returned profile contains `false`. Save it again and assert the field is written explicitly.
Assert that `environment: "production"` together with `allowDataQueries: true` is rejected with `DATA_QUERY_PRODUCTION_FORBIDDEN`.

- [ ] **Step 2: Run focused tests and verify they fail**

Run:

```bash
npm run build
node --test dist/test/profile-store.test.js dist/test/cli-profile.test.js
```

Expected: FAIL because the property and CLI flag do not exist.

- [ ] **Step 3: Extend the profile schema compatibly**

Add:

```ts
allowDataQueries: z.boolean().default(false)
```

to `baseProfileSchema`. Forward `input.allowDataQueries ?? false` from `normalizeProfile()`.
After parsing the normalized environment, throw `AppError("DATA_QUERY_PRODUCTION_FORBIDDEN", ...)` when a production profile requests the capability.

- [ ] **Step 4: Parse the advanced CLI flag**

When `profile add` receives `--allow-data-queries`, set `allowDataQueries: true`. Do not add the flag to the interactive setup wizard; setup-created profiles remain false.

- [ ] **Step 5: Run focused tests**

Run:

```bash
npm run build
node --test dist/test/profile-store.test.js dist/test/cli-profile.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/profile-store.ts src/index.ts test/profile-store.test.ts test/cli-profile.test.ts
git commit -m "feat: make SAP data queries profile opt-in"
```

### Task 2: Enforce the capability on interactive queries

**Files:**
- Modify: `src/tool-service.ts`
- Modify: `test/integration.test.ts`
- Modify: `test/v1-artifact-tools.test.ts`

**Interfaces:**
- Consumes: `client.profile.allowDataQueries`.
- Produces:

```ts
function requireDataQueriesAllowed(client: SapClient): void
```

Denied calls throw:

```ts
new AppError(
  "DATA_QUERY_NOT_ALLOWED",
  "SAP data queries are disabled for this profile. Recreate or edit the profile with explicit data-query permission."
)
```

- [ ] **Step 1: Write failing default-deny tests**

Use one profile with `allowDataQueries: false` and assert:

- `executeDataQuery({ sql: "SELECT MATNR FROM MARA", ... })` fails before `client.runQuery`;
- the error payload does not contain the SQL string;
- a production profile remains denied and cannot be configured to opt in;
- `executeDataQuery({ data: { columns, values }, ... })` can render and export caller-supplied data without calling SAP.

Use a second development profile with `allowDataQueries: true` and assert the existing bounded SQL path succeeds.

- [ ] **Step 2: Run focused tests and verify they fail**

Run:

```bash
npm run build
node --test dist/test/integration.test.js dist/test/v1-artifact-tools.test.js
```

Expected: FAIL because SQL is not policy-gated.

- [ ] **Step 3: Enforce immediately before the SAP call**

In `executeDataQuery`, call `requireDataQueriesAllowed(client)` only when `input.sql` is present. Keep the existing SELECT/WITH validation and row bounds after authorization.

Do not call the policy guard for caller-provided `input.data`. A cached view requires no new SAP query; it may be filtered or exported within the same process.

- [ ] **Step 4: Run focused tests**

Run:

```bash
npm run build
node --test \
  dist/test/integration.test.js \
  dist/test/v1-artifact-tools.test.js \
  dist/test/v0-contract.test.js
```

Expected: PASS with unchanged discovery fixtures.

- [ ] **Step 5: Commit**

```bash
git add src/tool-service.ts test/integration.test.ts test/v1-artifact-tools.test.ts
git commit -m "feat: enforce profile data query permission"
```

### Task 3: Enforce the capability on heartbeat sample queries

**Files:**
- Modify: `src/tool-service.ts`
- Modify: `test/integration.test.ts`
- Modify: `test/token-efficiency.test.ts`

**Interfaces:**
- Consumes: heartbeat tasks with `connectionId` and `sampleQuery`.
- Produces: no SAP query unless the selected profile explicitly allows it.

- [ ] **Step 1: Write failing heartbeat policy tests**

Assert:

- a heartbeat task may still be stored while disabled;
- running a task with `sampleQuery` on a default-deny profile records `DATA_QUERY_NOT_ALLOWED` as a bounded task error and makes no SAP query;
- a connectivity-only heartbeat without `sampleQuery` still pings SAP;
- an allowed profile executes the bounded sample query;
- heartbeat history does not retain the SQL string.

- [ ] **Step 2: Run focused tests and verify they fail**

Run:

```bash
npm run build
node --test dist/test/integration.test.js dist/test/token-efficiency.test.js
```

Expected: FAIL because heartbeat sample queries bypass the policy.

- [ ] **Step 3: Apply the same guard**

Immediately before `client.runQuery(task.sampleQuery, 1000)`, call `requireDataQueriesAllowed(client)`. Catch the policy error at the per-task boundary so one denied task does not abort unrelated reminder or connectivity tasks. Store only `{ status: "error", code: "DATA_QUERY_NOT_ALLOWED" }` in heartbeat history.

- [ ] **Step 4: Run focused tests**

Run:

```bash
npm run build
node --test dist/test/integration.test.js dist/test/token-efficiency.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tool-service.ts test/integration.test.ts test/token-efficiency.test.ts
git commit -m "feat: gate monitored SAP queries by profile"
```

### Task 4: Make the public contract explicit

**Files:**
- Modify: `src/mcp-server.ts`
- Modify: `src/mcp/v1/analysis-tools.ts`
- Modify: `src/mcp/v1/artifact-tools.ts`
- Modify: `src/mcp/v1/operations-tools.ts`
- Modify: `README.md`
- Modify: `PRIVACY.md`
- Modify: `llms-install.md`
- Modify: `src/compat/abap-fs-documentation.ts`
- Modify: `test/v1-documentation.test.ts`
- Modify: `test/compatibility.test.ts`

**Interfaces:**
- Consumes: the enforced profile flag.
- Produces: tool descriptions and setup documentation that do not imply default data access.

- [ ] **Step 1: Write failing documentation assertions**

Require documentation to state:

- user-defined SAP SQL is disabled by default;
- `--allow-data-queries` is an explicit advanced opt-in for development and quality profiles;
- production environment profiles cannot opt in, and opt-in never overrides SAP authorization or customer policy;
- `doctor` system metadata is bounded and separate from arbitrary queries;
- the assurance preset contains no data-query tool.

- [ ] **Step 2: Run focused tests and verify they fail**

Run:

```bash
npm run build
node --test dist/test/v1-documentation.test.js dist/test/compatibility.test.js
```

Expected: FAIL until descriptions and guides are updated.

- [ ] **Step 3: Update tool descriptions**

For `execute_data_query`, `sap.data.query`, `sap.data.export`, and heartbeat `sampleQuery`, state that SAP-backed queries require a profile created with `--allow-data-queries`. Do not change names, input schemas, annotations, or v0 fixture order.

- [ ] **Step 4: Update privacy and setup guides**

Document that the project does not transmit query results to the publisher, but the user's MCP host may receive results. Recommend dedicated development data, SAP authorization restrictions, row bounds, and customer approval before enabling the flag.

- [ ] **Step 5: Run documentation and contract tests**

Run:

```bash
npm run build
node --test \
  dist/test/v1-documentation.test.js \
  dist/test/compatibility.test.js \
  dist/test/v0-contract.test.js \
  dist/test/response-audit.test.js
```

Expected: PASS with unchanged tool discovery.

- [ ] **Step 6: Commit**

```bash
git add \
  src/mcp-server.ts \
  src/mcp/v1/analysis-tools.ts \
  src/mcp/v1/artifact-tools.ts \
  src/mcp/v1/operations-tools.ts \
  README.md \
  PRIVACY.md \
  llms-install.md \
  src/compat/abap-fs-documentation.ts \
  test/v1-documentation.test.ts \
  test/compatibility.test.ts
git commit -m "docs: clarify opt-in SAP data access"
```

### Task 5: Verify the policy boundary

**Files:**
- Verify all files changed by Tasks 1–4.
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: the complete policy branch.
- Produces: a reviewed prerequisite for the Change Gate release.

- [ ] **Step 1: Run complete verification**

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

- [ ] **Step 2: Verify default denial from a clean profile**

Create a disposable profile without `--allow-data-queries`. Verify:

- `doctor` still succeeds;
- repository read and transport assessment still work;
- user-defined SQL returns `DATA_QUERY_NOT_ALLOWED`;
- the error and logs contain no SQL text.

- [ ] **Step 3: Verify explicit opt-in**

Create a disposable development profile with `--allow-data-queries`. Run one bounded query against approved non-sensitive development data and verify the existing row limit and export behavior.

- [ ] **Step 4: Record and merge**

Add the default-deny behavior and migration note to `CHANGELOG.md`, open a ready PR, and merge only after all security and CI checks pass. Do not publish separately; this becomes part of version `1.1.0` after the Change Gate plan completes.

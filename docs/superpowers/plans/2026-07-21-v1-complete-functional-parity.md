# SAP ABAP MCP v1 Complete Functional Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace every v0 capability with the approved 113-tool v1 contract and seven Resources while preserving the exact 53-tool v0 compatibility surface.

**Architecture:** Keep `AbapToolService` as the only application-service boundary. Add small registrars under `src/mcp/v1/` by the existing static toolsets; each registrar removes the v0 action union, injects the corresponding service action, renames SAP profiles to `systemId`, and returns the shared v1 result envelope. Do not move or rewrite the v0 presenter and do not add a second SAP client path.

**Tech Stack:** TypeScript 7.0.2, Node.js 20+, `@modelcontextprotocol/sdk` 1.29.0, Zod 4.4.3, Node test runner, in-memory MCP transport.

## Global Constraints

- Preserve unversioned `serve` and `--api-version v0` as the exact 53-tool v0 surface in the committed order and schema snapshot.
- Implement all 113 unique v1 target names as callable handlers; catalog, placeholder, and name-only registration do not count.
- Implement all seven planned Resource registry names and URI families.
- Preserve the `core`, `write`, `analysis`, `debug`, `operations`, and `artifacts` primary toolsets and their existing budgets.
- Use strict per-target input schemas. Do not expose a copied v0 multi-action union when the catalog split it into atomic targets.
- Every v1 success returns one v1 envelope as both `structuredContent` and the first minified JSON text block. Every callback failure uses the v1 error envelope.
- Reuse `AbapToolService`; do not copy SAP/ADT calls into v1 files.
- Implement test-first and record a meaningful RED before each production slice.
- Run focused v1 contract tests and the v0 contract/response-audit regression after every slice.
- Do not run live SAP tests until all local parity gates pass. Later mutation tests are limited to profile `B4D` and run-owned `$TMP` objects.
- Do not modify, remove, stage, or commit `docs/live-sap-53-tool-test-prompts.ko.md` or `docs/live-sap-v1-test-prompt.ko.md`.
- Do not use `git add -A`, publish, or push before the complete local gate passes.

---

### Task 1: Freeze executable parity accounting

**Files:**
- Create: `docs/v1-parity-matrix.md`
- Create: `test/v1-runtime-parity.test.ts`
- Modify: `src/mcp/v1/migration-catalog.ts`

**Interfaces:**
- Consumes: `V1_MIGRATION_CATALOG`, `V1_TOOL_NAMES`, actual `tools/list`, and `V1_RESOURCE_NAMES`.
- Produces: an assertion that catalog state can be called complete only when runtime discovery has 113 v1 names and seven Resource owners.

- [x] **Step 1: Record all 113 target rows and seven Resource rows with current handler, schema, and test evidence**

The audit is committed as `docs/v1-parity-matrix.md`; absent handlers and schemas are explicitly marked absent.

- [x] **Step 2: Write a failing runtime-parity test**

The test must request v1 with all toolsets, compare actual names to
`V1_TOOL_NAMES`, verify every Tool has `inputSchema`, `outputSchema`, and all
four annotations, and compare Resource discovery to all seven registry names.

Run:

```bash
pnpm run build && node --test dist/test/v1-runtime-parity.test.js
```

Expected RED: actual v1 names are 5 rather than 113 and Resource registry names are 2 rather than 7.

- [x] **Step 3: Keep the parity test red while implementing Tasks 2-7**

Do not weaken the expected counts or substitute catalog membership for runtime discovery.

---

### Task 2: Complete the core toolset

**Files:**
- Create: `src/mcp/v1/core-tools.ts`
- Create: `test/v1-core-tools.test.ts`
- Modify: `src/mcp/v1/source-tools.ts`
- Modify: `src/mcp/v1/register.ts`
- Modify: `src/mcp/v1/migration-catalog.ts`
- Modify: `test/v1-source-read.test.ts`

**Interfaces:**
- Consumes: existing `AbapToolService` repository, source, semantic, diagnostic, text-element, and URL methods.
- Produces: all 20 `V1_MCP_TOOLSETS.core` names as callable tools.

- [x] **Step 1: Write discovery/schema RED tests for the 20 exact core names**

Assert every target has a strict action-free input schema, a v1 output envelope,
read-only annotations, and stays within the 32 KiB default-core budget.

- [x] **Step 2: Write shared-service call RED tests for each missing target**

Use a test service double whose methods record inputs. Call each target through
the real MCP client and assert exactly one matching method call with normalized
`systemId` and the fixed service action. Cover both name and canonical URI forms
of `sap.source.read`.

- [x] **Step 3: Implement the minimum core registrars**

Register `repository.inspect`, `repository.resolve`, `repository.where_used`,
the seven semantic tools, `source.diagnose`, `source.read_batch`,
`source.search`, `text_elements.read`, and `ui.object_url`. Extend
`sap.source.read` with a strict discriminated name/URI input while retaining
its existing result contract and ADT Resource Link.

- [x] **Step 4: Verify core and v0 regressions**

Run:

```bash
pnpm run build
node --test dist/test/v1-core-tools.test.js dist/test/v1-source-read.test.js dist/test/v1-system-tools.test.js dist/test/v1-repository-search.test.js
node --test dist/test/v0-contract.test.js dist/test/response-audit.test.js dist/test/integration.test.js
```

Expected: 20 v1 core tools, no v0 snapshot or response-audit change.

---

### Task 3: Complete the write toolset

**Files:**
- Create: `src/mcp/v1/write-tools.ts`
- Create: `test/v1-write-tools.test.ts`
- Modify: `src/mcp/v1/register.ts`
- Modify: `src/mcp/v1/migration-catalog.ts`

**Interfaces:**
- Consumes: existing create, activate, patch, refactor, text, transport, abapGit, RAP, version, test-include, and execution service methods.
- Produces: all 23 `V1_MCP_TOOLSETS.write` names as callable tools with fixed mutation actions.

- [x] **Step 1: Write discovery/schema/annotation RED tests for all 23 write names**

Require strict action-free inputs, appropriate destructive/idempotent hints,
and explicit plan/confirmation inputs on confirmed execution tools.

- [x] **Step 2: Write one-call and policy-propagation RED tests**

For every target, assert the adapter injects the exact v0 service action and
passes package, transport, state handle, plan ID, confirmation, and pagination
fields without changing existing policy semantics.

- [x] **Step 3: Implement thin write registrars**

Call only the corresponding `AbapToolService` methods. Do not add local retry,
fallback, confirmation generation, or SAP calls.

- [x] **Step 4: Verify write and v0 safety regressions**

Run:

```bash
pnpm run build
node --test dist/test/v1-write-tools.test.js dist/test/integration.test.js dist/test/sap-client-contract.test.js
node --test dist/test/v0-contract.test.js dist/test/response-audit.test.js
```

Expected: 23 callable write names and unchanged v0 policy behavior.

---

### Task 4: Complete the analysis toolset

**Files:**
- Create: `src/mcp/v1/analysis-tools.ts`
- Create: `test/v1-analysis-tools.test.ts`
- Modify: `src/mcp/v1/register.ts`
- Modify: `src/mcp/v1/migration-catalog.ts`

**Interfaces:**
- Consumes: existing query, Git read, ATC, Unit, RAP preview, refactor preview, comparison, dependency, transport read/assessment, and version service methods.
- Produces: all 29 `V1_MCP_TOOLSETS.analysis` names as callable tools.

- [x] **Step 1: Write discovery/schema/annotation RED tests for all 29 names**

Require action-free schemas, bounded pagination fields, read/analysis
annotations, and distinct inputs for transport details versus object lists.

- [x] **Step 2: Write fixed-action one-call RED tests**

Call every target through the MCP boundary and compare recorded service input
to the corresponding v0 capability in `docs/v1-parity-matrix.md`.

- [x] **Step 3: Implement thin analysis registrars**

Return bounded service results inside the v1 envelope and preserve Resource
Links for large or follow-up evidence instead of adding v0 deferred-result calls.

- [x] **Step 4: Verify analysis and v0 regressions**

Run:

```bash
pnpm run build
node --test dist/test/v1-analysis-tools.test.js dist/test/change-assurance.test.js dist/test/result-summaries.test.js
node --test dist/test/v0-contract.test.js dist/test/response-audit.test.js
```

Expected: 29 callable analysis names and unchanged v0 results.

---

### Task 5: Complete the debug toolset

**Files:**
- Create: `src/mcp/v1/debug-tools.ts`
- Create: `test/v1-debug-tools.test.ts`
- Modify: `src/mcp/v1/register.ts`
- Modify: `src/mcp/v1/migration-catalog.ts`

**Interfaces:**
- Consumes: existing debugger session, breakpoint, step, variable, stack, and status service methods.
- Produces: all 10 `V1_MCP_TOOLSETS.debug` names as callable tools.

- [x] **Step 1: Write discovery and fixed-operation RED tests**

Verify separate start/stop/inspect, set/remove, variables/evaluate tools and one
bounded `sap.debug.step` operation enum for the five identical-risk step modes.

- [x] **Step 2: Implement the debug registrar**

Preserve thread/frame IDs, source locations, expression execution semantics,
and zero hidden debugger calls.

- [x] **Step 3: Verify debug and v0 regressions**

Run:

```bash
pnpm run build
node --test dist/test/v1-debug-tools.test.js dist/test/integration.test.js
node --test dist/test/v0-contract.test.js dist/test/response-audit.test.js
```

Expected: 10 callable debug names and unchanged v0 debugger behavior.

---

### Task 6: Complete the operations toolset

**Files:**
- Create: `src/mcp/v1/operations-tools.ts`
- Create: `test/v1-operations-tools.test.ts`
- Modify: `src/mcp/v1/register.ts`
- Modify: `src/mcp/v1/migration-catalog.ts`

**Interfaces:**
- Consumes: existing dump, trace, heartbeat/watch, discovery, transaction, and ABAP execution health/preview service methods.
- Produces: all 24 `V1_MCP_TOOLSETS.operations` names as callable tools.

- [x] **Step 1: Write discovery and 24 fixed-action RED tests**

Cover all 12 exact watch names, five trace actions, two dump actions, discovery
summary/full, transaction URL/launch, and execution health/preview.

- [x] **Step 2: Implement the operations registrar**

Keep local-launch and open-world annotations accurate. Preserve watch task IDs,
history pagination, and preview plan handles exactly.

- [x] **Step 3: Verify operations and v0 regressions**

Run:

```bash
pnpm run build
node --test dist/test/v1-operations-tools.test.js dist/test/repl-client.test.js
node --test dist/test/v0-contract.test.js dist/test/response-audit.test.js
```

Expected: 24 callable operations names and unchanged v0 behavior.

---

### Task 7: Complete artifacts and all seven Resources

**Files:**
- Create: `src/mcp/v1/artifact-tools.ts`
- Create: `src/mcp/v1/evidence-store.ts`
- Create: `test/v1-artifact-tools.test.ts`
- Create: `test/v1-resources-complete.test.ts`
- Modify: `src/mcp/v1/resources.ts`
- Modify: `src/mcp/v1/resource-uri.ts`
- Modify: `src/mcp/v1/register.ts`
- Modify: `src/mcp/v1/toolsets.ts`
- Modify: `src/mcp/v1/migration-catalog.ts`

**Interfaces:**
- Consumes: existing Mermaid, test-document, data export, ABAP download, ADT discovery, documentation, transport, and deferred/evidence behavior.
- Produces: seven callable artifact Tools and all seven Resource registry names.

- [x] **Step 1: Write artifact Tool RED tests**

Assert exact schemas and one-call adapters for Mermaid create/detect/validate,
test document creation, data export, source export, and discovery export.

- [x] **Step 2: Write Resource discovery/read/canonicalization RED tests**

Require all seven names, the approved URI families, zero-call discovery,
bounded/redacted session evidence, transport reads, documentation reads,
toolset ownership, and existing registry lifecycle guarantees.

- [x] **Step 3: Implement artifact registrars and Resource providers**

Reuse the current project-owned Resource registry. Add only URI parsers and
providers required by the five missing Resource families; do not create a
second dispatcher or expose credentials/local arbitrary files.

- [x] **Step 4: Verify artifacts, Resources, and v0 regressions**

Run:

```bash
pnpm run build
node --test dist/test/v1-artifact-tools.test.js dist/test/v1-resources-complete.test.js dist/test/v1-resource-registry.test.js dist/test/v1-final-hardening.test.js
node --test dist/test/v0-contract.test.js dist/test/response-audit.test.js
```

Expected: seven callable artifact names and seven implemented Resource names.

---

### Task 8: Close the deterministic local parity gate

**Files:**
- Modify: `test/v1-runtime-parity.test.ts`
- Modify: `test/v1-migration-catalog.test.ts`
- Modify: `test/v1-surface-budget.test.ts`
- Modify: `test/v1-toolsets.test.ts`
- Modify: `test/v1-documentation.test.ts`
- Modify: `docs/v1-parity-matrix.md`
- Modify: `docs/v1-migration.md`

**Interfaces:**
- Consumes: actual MCP discovery/calls from Tasks 2-7.
- Produces: local evidence for 53 v0 Tools, 113 v1 Tools, seven Resources, toolset budgets, and zero catalog-only implementations.

- [x] **Step 1: Require every Tool catalog entry to be implemented**

Remove `planned`, `v0_only`, and first-slice semantics only after the related
handler and tests exist. Keep non-Tool parity paths explicitly `resource`,
`extension`, or `compatibility` only when their runtime path is tested.

- [x] **Step 2: Run actual count and callability checks**

Assert v1 all advertises 113 unique names, API `all` advertises 166 unique
names, and each target accepts one valid fixture or returns only a documented
prerequisite/capability error from the real handler.

- [x] **Step 3: Run schema budgets and full automated regression**

Run:

```bash
pnpm run build
node --test dist/test/v1-runtime-parity.test.js dist/test/v1-surface-budget.test.js dist/test/v1-toolsets.test.js
node --test dist/test/*.test.js
```

Expected: zero failures; 53 v0, 113 v1, 166 combined, seven Resources; all
default and per-toolset schema budgets pass.

- [x] **Step 4: Audit the protected worktree and diff**

Run:

```bash
git status --short
git diff --check
git diff -- docs/live-sap-53-tool-test-prompts.ko.md docs/live-sap-v1-test-prompt.ko.md
```

Expected: the two user-owned paths remain exactly the pre-existing unstaged
changes and are absent from every staged/committed change.

- [x] **Step 5: Stop before live SAP and push**

Report the local gate evidence. Run the separate B4D read-only and `$TMP`
mutation campaign only with the already approved live-test boundary. Do not
push or claim complete replacement before this task is fully green.

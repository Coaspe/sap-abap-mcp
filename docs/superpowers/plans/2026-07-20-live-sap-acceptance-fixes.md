# Live SAP Acceptance Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix class-include diagnostics, object-level dependency identity, definition cursor expansion, and source-contract documentation, then repeat the disposable S4D acceptance.

**Architecture:** Keep repository identity, source identity, and syntax-check identity separate in the existing editable-target flow. Normalize usage references at the dependency boundary, and derive navigation ranges immediately before the ADT definition call. Preserve all existing APIs except for one optional trailing `syntaxObjectUri` argument on `SapClient.replaceSource`.

**Tech Stack:** TypeScript 7, Node.js 20+, `abap-adt-api@8.4.1`, MCP SDK 1.29, Node test runner, SAP ADT.

## Global Constraints

- Do not overwrite or stage unrelated dirty-worktree changes.
- Do not add dependencies or generic create-time source support.
- Use TDD: each production behavior must have a test that fails for the intended reason first.
- Live mutations are allowed only on connection `S4D`, environment `development`, package `$TMP`, and newly generated names containing both `MCP_TEST` and the current RUN_ID.
- Do not create, modify, or release transports.
- Live cleanup is mandatory even after a failed assertion.

---

### Task 1: Separate class-include syntax identity

**Files:**
- Modify: `test/integration.test.ts`
- Modify: `src/tool-service.ts`
- Modify: `src/sap-client.ts`

**Interfaces:**
- Consumes: `EditableTarget.objectUri`, `EditableTarget.sourceUri`, `SapClient.checkSyntax`.
- Produces: `EditableTarget.syntaxObjectUri: string` and optional trailing `syntaxObjectUri?: string` on `SapClient.replaceSource`.

- [ ] **Step 1: Add failing integration coverage**

Add a fake-client assertion for a workspace path ending in `/includes/testclasses`. Require `getAbapDiagnostics` to call syntax checking with the include URI, and require `replaceStringInObject` to pass the same syntax URI separately while retaining the parent class URI for mutation:

```typescript
assert.deepEqual(fake.syntaxCheckArgs.at(-1), {
  objectUri: testIncludeUri,
  sourceUri: testIncludeUri,
  sourceText: fake.currentSource,
  mainProgram: undefined
})
assert.equal(fake.replaceSourceCalls.at(-1)?.objectUri, object.uri)
assert.equal(fake.replaceSourceCalls.at(-1)?.syntaxObjectUri, testIncludeUri)
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npm run build && node --test --test-name-pattern="class include.*syntax" dist/test/integration.test.js
```

Expected: FAIL because syntax check receives the parent class URI or because `syntaxObjectUri` is absent.

- [ ] **Step 3: Implement URI separation**

Add `syntaxObjectUri` to `EditableTarget` and derive it without changing `objectUri`:

```typescript
function syntaxObjectUriFromSourceUri(objectUri: string, sourceUri: string): string {
  return /\/sap\/bc\/adt\/oo\/(?:classes|interfaces)\/[^/]+\/includes\/[^/?#]+$/i
    .test(sourceUri.replace(/[?#].*$/, ""))
    ? sourceUri.replace(/[?#].*$/, "")
    : objectUri
}
```

Pass it to `getAbapDiagnostics` and as the final optional `replaceSource` argument. In `AdtSapClient.replaceSource`, keep lock and activation on `objectUri` but call:

```typescript
const diagnostics = await this.checkSyntax(
  syntaxObjectUri ?? objectUri,
  sourceUri,
  source,
  mainProgram
)
```

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the same focused command. Expected: PASS.

---

### Task 2: Normalize dependency references to owning class objects

**Files:**
- Modify: `test/integration.test.ts`
- Modify: `test/token-efficiency.test.ts`
- Modify: `src/tool-service.ts`

**Interfaces:**
- Consumes: ADT `UsageReference.objectIdentifier`, `adtcore:type`, `adtcore:name`, `uri`, and `parentUri`.
- Produces: unique object-level dependency node IDs and optional edge `member` evidence.

- [ ] **Step 1: Add failing graph tests**

Provide usage references for `ZCL_FIRST=>PING`, `ZCL_SECOND=>PING`, and a `ZCL_FIRST=========CP` class pool. Assert that method names cannot collide and compiler-pool references normalize to the same owner:

```typescript
assert.deepEqual(
  graph.nodes.map(node => node.id).sort(),
  ["ZCL_DEMO::CLAS/OC", "ZCL_FIRST::CLAS/OC", "ZCL_SECOND::CLAS/OC"].sort()
)
assert.equal(graph.nodes.some(node => node.id === "PING::CLAS/OM"), false)
assert.equal(graph.nodes.some(node => /=========CP/.test(String(node.name))), false)
assert.equal(graph.edges.some(edge => edge.member === "PING"), true)
```

- [ ] **Step 2: Run focused graph tests and verify RED**

Run:

```bash
npm run build && node --test --test-name-pattern="dependency graph.*owner|token-efficient" dist/test/integration.test.js dist/test/token-efficiency.test.js
```

Expected: FAIL because both methods currently use `PING::CLAS/OM` and compiler pools remain program nodes.

- [ ] **Step 3: Implement owner normalization**

In `dependencyReference`, derive a safe class owner from `ABAPFullName` or a `=+CP` pool name. Emit `CLAS/OC` identity when an owner exists and retain the method in `member`:

```typescript
const methodName = type === "CLAS/OM" ? reference["adtcore:name"] : undefined
const owner = type === "CLAS/OM"
  ? parts[1].replace(/=+.*$/, "")
  : name.match(/^(.+?)=+CP$/i)?.[1]
if (owner) {
  name = owner
  type = "CLAS/OC"
}
```

Use the normalized owner URI for expansion when possible and add `member` to the edge only when present.

- [ ] **Step 4: Run focused graph tests and verify GREEN**

Run the same focused command. Expected: PASS with bounded, object-level nodes.

---

### Task 3: Expand definition lookup ranges

**Files:**
- Modify: `test/integration.test.ts`
- Modify: `src/tool-service.ts`

**Interfaces:**
- Consumes: active source, one-based `line`, zero-based `column`, optional `endColumn`.
- Produces: `{ startColumn, endColumn }` passed to `SapClient.findDefinition`.

- [ ] **Step 1: Add failing semantic tests**

Capture fake `findDefinition` arguments for a cursor inside `zcl_target=>ping( )`. Without `endColumn`, require the full class identifier; with an explicit end, require exact preservation:

```typescript
assert.deepEqual(fake.definitionArgs.at(-1), {
  line: 3,
  startColumn: 13,
  endColumn: 23
})
```

Add cases for `<field_symbol>` and `/NS/ZCL_TARGET` through the same public `inspectCode` action.

- [ ] **Step 2: Run focused semantic tests and verify RED**

Run:

```bash
npm run build && node --test --test-name-pattern="definition.*identifier range" dist/test/integration.test.js
```

Expected: FAIL because the current default sends `startColumn === endColumn`.

- [ ] **Step 3: Implement bounded identifier expansion**

Add a local helper that clamps the requested line and column, recognizes `[A-Za-z0-9_]`, field-symbol brackets, and namespaced identifiers, and returns a one-character fallback on whitespace. In `definition`, use it only when `endColumn` is absent:

```typescript
const range = input.endColumn === undefined
  ? abapIdentifierRange(target.source, input.line, input.column)
  : { startColumn: input.column, endColumn: input.endColumn }
```

- [ ] **Step 4: Run focused semantic tests and verify GREEN**

Run the same focused command. Expected: PASS.

---

### Task 4: Align the source contract and live acceptance instructions

**Files:**
- Modify: `test/integration.test.ts`
- Modify: `test/compatibility.test.ts`
- Modify: `src/mcp-server.ts`
- Modify: `docs/live-sap-acceptance.md`

**Interfaces:**
- Consumes: existing BDEF-only runtime validation.
- Produces: accurate MCP tool descriptions and executable class fixture instructions.

- [ ] **Step 1: Add failing contract tests**

Inspect `tools/list` and documentation text. Require descriptions to contain `BDEF/BDO`, require class creation instructions to omit create-time `source`, and require the batch comment to be inside a method body:

```typescript
assert.match(String(createTool.inputSchema.properties?.source?.description), /BDEF\/BDO/)
assert.match(String(createTool.inputSchema.properties?.activate?.description), /BDEF\/BDO/)
assert.match(acceptance, /Create `CLAS\/OC` without `source`/)
assert.match(acceptance, /inside a method body/)
```

- [ ] **Step 2: Run focused contract tests and verify RED**

Run:

```bash
npm run build && node --test --test-name-pattern="create-time source|live SAP acceptance" dist/test/integration.test.js dist/test/compatibility.test.js
```

Expected: FAIL because the schema fields lack descriptions and the class fixture workflow is not explicit.

- [ ] **Step 3: Update schema and documentation**

Describe `source` as `BDEF/BDO`-only and state that `activate:true` at creation also requires `BDEF/BDO` source. Add a class fixture note to `docs/live-sap-acceptance.md` that creates classes without source, reads the generated source, replaces it exactly, and inserts batch comments inside a method body. Document definition cursor placement at the method token.

- [ ] **Step 4: Run focused contract tests and verify GREEN**

Run the same focused command. Expected: PASS.

---

### Task 5: Complete automated and live verification

**Files:**
- Verify: all modified source, test, and documentation files
- Live system: S4D `$TMP` fixture only

**Interfaces:**
- Consumes: locally built `sap-abap-mcp serve` and configured S4D profile.
- Produces: sanitized acceptance evidence and zero remaining fixture objects.

- [ ] **Step 1: Run the complete automated suite**

```bash
npm run check
npm audit --omit=dev
npm pack --dry-run
git diff --check
```

Expected: all tests pass, zero audit vulnerabilities, package dry run succeeds, and no whitespace errors.

- [ ] **Step 2: Smoke-test the packed local MCP**

Pack to a temporary directory, install it in an isolated prefix, start `sap-abap-mcp serve`, call `tools/list`, and require the full tool count and documented `create_object_programmatically` schema.

- [ ] **Step 3: Run the S4D fixture acceptance**

Use a fresh six-character RUN_ID and create only:

```text
ZCL_MCP_TEST_B_<RUN_ID>
ZCL_MCP_TEST_A_<RUN_ID>
ZCL_MCP_TEST_RUN_<RUN_ID>
```

Create each `CLAS/OC` without `source`, replace its generated source, create and populate RUNNER testclasses, check zero diagnostics, activate, verify direct class dependency edges, verify cross-class definition with omitted `endColumn`, batch activate A and B, run Unit/ATC/class runner, and verify the one-use plan rejection.

- [ ] **Step 4: Clean up and record the verdict**

Delete RUNNER, A, and B through fresh `preview_delete` plans. Search each exact name and `*<RUN_ID>*`; all counts must be zero. Report `PASS`, `PARTIAL`, or `FAIL-SAFETY` with sanitized evidence.

# v1 Compatibility and Exposure Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Freeze the existing v0 contract, enumerate the complete 113-name v1 catalog, assign every v1 tool and Resource to a bounded toolset, and route CLI/server filtering through separate v0 and v1 selections without registering unimplemented handlers.

**Architecture:** Keep the v0 presenter and its `enabledV0Tools` filter unchanged in behavior. Add a catalog-only v1 toolset layer, then pass exact `enabledV1Tools` and `enabledV1Resources` sets into the existing v1 registrars; current handlers remain the same five read-only tools. Measure every advertised surface with deterministic zero-SAP-call helpers and enforce the approved schema budgets before later slices add handlers.

**Tech Stack:** TypeScript 7.0.2, Node.js 20+, `@modelcontextprotocol/sdk` 1.29.0, Zod 4.4.3, Node test runner, npm scripts.

## Global Constraints

- Preserve unversioned `serve` and `--api-version v0` as the exact 53-tool v0 surface.
- Preserve the 150-entry v0 response/action audit and all existing v0 fixture behavior.
- Do not change SAP application-service calls, ADT requests, profile semantics, credentials, policy, or result payloads in this slice.
- Do not register placeholder v1 tools. The catalog contains 113 names, while discovery exposes only handlers present in `V1_IMPLEMENTED_TOOL_NAMES`.
- `serve --api-version v1` selects `core`; `serve --api-version v1 --toolsets all` selects the complete catalog but advertises only implemented handlers.
- `serve --api-version all` remains the explicit unfiltered v0+v1 comparison mode.
- Default v1 `core` must stay at or below 24 tools and 32 KiB; each named non-`all` toolset must stay at or below 32 tools and 64 KiB; v1 `all` must stay at or below 384 KiB; one tool definition must stay at or below 8 KiB.
- No live SAP call, local profile mutation, credential access, npm publication, MCPB update, or plugin-default change is allowed in this slice.
- Preserve the user's unstaged changes in `docs/live-sap-53-tool-test-prompts.ko.md` and `docs/live-sap-v1-test-prompt.ko.md`; every commit stages only the files named in that task.
- Follow the repository's no-semicolon TypeScript style and existing MCP in-memory test pattern.

---

## File Map

- `src/mcp/v1/migration-catalog.ts`: authoritative v0-to-v1 target mapping, implemented/pending disposition, derived 113-name and implemented-name lists.
- `src/mcp/v1/toolsets.ts`: exact primary toolset assignment for all 113 tool names and seven Resource families.
- `src/mcp/tool-selection.ts`: pure CLI selection resolver for independent v0/v1 tool and Resource sets.
- `src/mcp/v1/surface-budget.ts`: deterministic schema measurement and approved budget constants.
- `src/mcp/v1/register.ts`: exact-name v1 filtering; no v0-name reverse lookup.
- `src/mcp/v1/resources.ts`: Resource registration filtered by v1 Resource names.
- `src/mcp-server.ts`: accepts separate `enabledV0Tools`, `enabledV1Tools`, and `enabledV1Resources` options.
- `src/index.ts`: parses shared toolset names and applies `resolveServeToolSelection`.
- `scripts/benchmark-mcp-surface.mjs`: reports v0 and v1 toolsets with byte and token-proxy metrics.
- `scripts/smoke-v1-stdio.mjs`: derives the expected implemented core set instead of hard-coding five names.
- `test/v0-contract.test.ts`: characterizes both unversioned and explicit v0 surfaces.
- `test/v1-migration-catalog.test.ts`: locks 115 target references, 113 unique tool names, exact watch names, and current implemented names.
- `test/v1-toolsets.test.ts`: proves exact once-only toolset coverage and Resource ownership.
- `test/v1-tool-selection.test.ts`: proves default/explicit CLI selection without starting stdio.
- `test/v1-surface-budget.test.ts`: enforces schema budgets with zero SAP calls.
- Existing v1/integration/deferred tests: use renamed server option fields and dynamic implemented counts.
- `docs/v1-migration.md`: documents core default, complete-catalog selection, preview status, and conformance-only `all` mode.

---

### Task 1: Lock Explicit v0 Compatibility Before Refactoring Filters

**Files:**
- Modify: `test/v0-contract.test.ts`
- Verify: `test/fixtures/v0-tool-surface.json`
- Verify: `test/response-audit.test.ts`

**Interfaces:**
- Consumes: `advertisedTools(options?)`, `stableToolSurface(tools)` from `test/helpers/mcp-surface.ts`.
- Produces: a characterization gate proving unversioned and explicit v0 return the committed surface.

- [ ] **Step 1: Run the existing v0 baseline before editing**

Run:

```bash
npm run build
node --test dist/test/v0-contract.test.js dist/test/compatibility.test.js dist/test/response-audit.test.js
```

Expected: all tests pass; `v0-tool-surface.json` is not modified.

- [ ] **Step 2: Replace the single v0 contract test with a shared fixture loader and two characterization tests**

Use this complete structure in `test/v0-contract.test.ts`:

```ts
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import { advertisedTools, stableToolSurface } from "./helpers/mcp-surface.js"

async function committedV0Surface(): Promise<unknown> {
  return JSON.parse(
    await readFile("test/fixtures/v0-tool-surface.json", "utf8")
  )
}

test("unversioned MCP retains the committed v0 tool surface", async () => {
  assert.deepEqual(
    stableToolSurface(await advertisedTools()),
    await committedV0Surface()
  )
})

test("explicit v0 MCP is identical to the committed unversioned surface", async () => {
  assert.deepEqual(
    stableToolSurface(await advertisedTools({ apiVersion: "v0" })),
    await committedV0Surface()
  )
})
```

This is a characterization test, so it must pass before the filtering refactor; do not update the fixture.

- [ ] **Step 3: Run the v0 characterization tests**

Run:

```bash
npm run build
node --test dist/test/v0-contract.test.js dist/test/compatibility.test.js dist/test/response-audit.test.js
```

Expected: all tests pass and the response audit still reports 53 tools/150 variants.

- [ ] **Step 4: Commit only the characterization test**

```bash
git add test/v0-contract.test.ts
git commit -m "test: lock explicit v0 MCP contract"
```

---

### Task 2: Enumerate the Complete v1 Migration Catalog

**Files:**
- Modify: `src/mcp/v1/migration-catalog.ts`
- Modify: `test/v1-migration-catalog.test.ts`
- Modify: `test/v1-source-read.test.ts`

**Interfaces:**
- Consumes: `IMPLEMENTED_TOOL_NAMES` and the existing `V1_MIGRATION_CATALOG` entry shape.
- Produces: `V1_TOOL_NAMES: readonly string[]`, `V1_IMPLEMENTED_TOOL_NAMES: readonly string[]`, and an exact 12-target watch mapping.

- [ ] **Step 1: Write failing catalog tests**

Replace the first-slice-only assertions in `test/v1-migration-catalog.test.ts` with:

```ts
import assert from "node:assert/strict"
import test from "node:test"
import { IMPLEMENTED_TOOL_NAMES } from "../src/compat/abap-fs-tools.js"
import {
  V1_IMPLEMENTED_TOOL_NAMES,
  V1_MIGRATION_CATALOG,
  V1_TOOL_NAMES
} from "../src/mcp/v1/migration-catalog.js"

const WATCH_TOOL_NAMES = [
  "sap.ops.watch.status",
  "sap.ops.watch.start",
  "sap.ops.watch.stop",
  "sap.ops.watch.trigger",
  "sap.ops.watch.history",
  "sap.ops.watch.task.add",
  "sap.ops.watch.task.remove",
  "sap.ops.watch.task.update",
  "sap.ops.watch.task.enable",
  "sap.ops.watch.task.disable",
  "sap.ops.watch.task.list",
  "sap.ops.watch.watchlist.read"
] as const

test("every advertised v0 tool has one migration disposition", () => {
  assert.deepEqual(
    Object.keys(V1_MIGRATION_CATALOG).sort(),
    [...IMPLEMENTED_TOOL_NAMES].sort()
  )
})

test("the complete catalog has exact targets without wildcard names", () => {
  const targetReferences = Object.values(V1_MIGRATION_CATALOG)
    .flatMap(entry => entry.targets)
    .filter(target => target.startsWith("sap."))

  assert.equal(targetReferences.length, 115)
  assert.equal(V1_TOOL_NAMES.length, 113)
  assert.equal(new Set(V1_TOOL_NAMES).size, 113)
  assert.ok(V1_TOOL_NAMES.every(name => /^sap\.[a-z0-9_.]+$/.test(name)))
  assert.ok(Object.values(V1_MIGRATION_CATALOG).every(entry =>
    entry.targets.every(target => !target.includes("*"))
  ))
})

test("watch and cached ATC mappings are exact parity targets", () => {
  assert.deepEqual(
    V1_MIGRATION_CATALOG.manage_heartbeat.targets,
    WATCH_TOOL_NAMES
  )
  assert.deepEqual(V1_MIGRATION_CATALOG.get_atc_decorations, {
    targets: ["sap.quality.atc.cached"],
    disposition: "planned"
  })
})

test("only the existing five read tools are implemented in this slice", () => {
  assert.deepEqual(V1_IMPLEMENTED_TOOL_NAMES, [
    "sap.repository.search",
    "sap.source.read",
    "sap.system.capabilities",
    "sap.system.inspect",
    "sap.system.list"
  ])
})
```

Update `test/v1-source-read.test.ts` to import `V1_IMPLEMENTED_TOOL_NAMES` and compare discovery to that list instead of `V1_FIRST_SLICE_TOOL_NAMES`.

- [ ] **Step 2: Run the catalog tests to verify they fail**

Run:

```bash
npm run build
node --test dist/test/v1-migration-catalog.test.js dist/test/v1-source-read.test.js
```

Expected: build fails because `V1_TOOL_NAMES` and `V1_IMPLEMENTED_TOOL_NAMES` do not exist, or the tests fail because the wildcard and `first_slice` dispositions remain.

- [ ] **Step 3: Add the implemented disposition and exact watch targets**

In `src/mcp/v1/migration-catalog.ts`, make these exact changes:

```ts
export type V1MigrationDisposition =
  | "implemented"
  | "planned"
  | "extension"
  | "resource"
  | "v0_only"
  | "compatibility"
```

Change the five existing `first_slice` entries to `implemented`. Change
`get_atc_decorations` from `v0_only` to `planned`. Replace the heartbeat entry
with:

```ts
manage_heartbeat: {
  targets: [
    "sap.ops.watch.status",
    "sap.ops.watch.start",
    "sap.ops.watch.stop",
    "sap.ops.watch.trigger",
    "sap.ops.watch.history",
    "sap.ops.watch.task.add",
    "sap.ops.watch.task.remove",
    "sap.ops.watch.task.update",
    "sap.ops.watch.task.enable",
    "sap.ops.watch.task.disable",
    "sap.ops.watch.task.list",
    "sap.ops.watch.watchlist.read"
  ],
  disposition: "planned"
},
```

Add these derivations after the catalog:

```ts
function uniqueToolTargets(
  entries: readonly V1MigrationEntry[]
): readonly string[] {
  return Object.freeze([...new Set(entries.flatMap(entry =>
    entry.targets.filter(target => target.startsWith("sap."))
  ))].sort())
}

export const V1_TOOL_NAMES = uniqueToolTargets(
  Object.values(V1_MIGRATION_CATALOG)
)

export const V1_IMPLEMENTED_TOOL_NAMES = uniqueToolTargets(
  Object.values(V1_MIGRATION_CATALOG).filter(entry =>
    entry.disposition === "implemented"
  )
)
```

Keep the existing `V1_FIRST_SLICE_TOOL_NAMES` and
`V1_FIRST_SLICE_V0_TOOL_NAMES` exports temporarily so `src/index.ts` continues
to compile after this task. Task 4 removes both aliases after all imports have
been migrated to the exact v1 selection boundary.

The `startsWith("sap.")` check intentionally excludes Resource schemes such as
`sap-capability://` and `sap-docs://`.

- [ ] **Step 4: Run focused catalog and existing v1 tests**

Run:

```bash
npm run build
node --test dist/test/v1-migration-catalog.test.js dist/test/v1-source-read.test.js dist/test/v1-system-tools.test.js
```

Expected: all focused tests pass; discovery still advertises five tools.

- [ ] **Step 5: Commit the exact catalog**

```bash
git add src/mcp/v1/migration-catalog.ts test/v1-migration-catalog.test.ts test/v1-source-read.test.ts
git commit -m "feat: enumerate complete v1 migration catalog"
```

---

### Task 3: Assign All v1 Tools and Resources to Static Toolsets

**Files:**
- Create: `src/mcp/v1/toolsets.ts`
- Create: `test/v1-toolsets.test.ts`

**Interfaces:**
- Consumes: `ToolsetName` from `src/compat/abap-fs-tools.ts`, `V1_TOOL_NAMES`, and `V1_IMPLEMENTED_TOOL_NAMES`.
- Produces: `V1_MCP_TOOLSETS`, `V1_RESOURCE_TOOLSETS`, `V1_RESOURCE_NAMES`, `V1_IMPLEMENTED_RESOURCE_NAMES`, `v1ToolsForToolsets()`, and `v1ResourcesForToolsets()`.

- [ ] **Step 1: Write the failing toolset coverage test**

Create `test/v1-toolsets.test.ts`:

```ts
import assert from "node:assert/strict"
import test from "node:test"
import { V1_IMPLEMENTED_TOOL_NAMES, V1_TOOL_NAMES } from "../src/mcp/v1/migration-catalog.js"
import {
  V1_IMPLEMENTED_RESOURCE_NAMES,
  V1_MCP_TOOLSETS,
  V1_RESOURCE_NAMES,
  V1_RESOURCE_TOOLSETS,
  v1ResourcesForToolsets,
  v1ToolsForToolsets
} from "../src/mcp/v1/toolsets.js"

test("v1 primary toolsets cover all 113 names exactly once", () => {
  const counts = Object.fromEntries(
    Object.entries(V1_MCP_TOOLSETS).map(([name, tools]) => [name, tools.length])
  )
  assert.deepEqual(counts, {
    core: 20,
    write: 23,
    analysis: 29,
    debug: 10,
    operations: 24,
    artifacts: 7
  })

  const grouped = Object.values(V1_MCP_TOOLSETS).flat()
  assert.equal(grouped.length, 113)
  assert.equal(new Set(grouped).size, 113)
  assert.deepEqual([...grouped].sort(), [...V1_TOOL_NAMES].sort())
  assert.deepEqual([...v1ToolsForToolsets(["all"])].sort(), [...V1_TOOL_NAMES].sort())
  assert.ok(V1_IMPLEMENTED_TOOL_NAMES.every(name => V1_MCP_TOOLSETS.core.includes(name)))
})

test("v1 Resource ownership is exact and evidence is available to every set", () => {
  assert.deepEqual(V1_RESOURCE_NAMES, [
    "sap-adt-source",
    "sap-capability-evidence",
    "sap-docs-compat",
    "sap-docs-data-query",
    "sap-docs-mermaid",
    "sap-evidence",
    "sap-transport"
  ])
  assert.deepEqual(V1_IMPLEMENTED_RESOURCE_NAMES, [
    "sap-adt-source",
    "sap-capability-evidence"
  ])
  assert.ok(Object.values(V1_RESOURCE_TOOLSETS).every(names =>
    names.includes("sap-evidence")
  ))
  assert.deepEqual(
    [...v1ResourcesForToolsets(["all"])].sort(),
    [...V1_RESOURCE_NAMES].sort()
  )
})
```

- [ ] **Step 2: Run the test to verify the module is missing**

Run:

```bash
npm run build
```

Expected: TypeScript fails to resolve `../src/mcp/v1/toolsets.js`.

- [ ] **Step 3: Create the exact v1 toolset catalog**

Create `src/mcp/v1/toolsets.ts` with the following complete arrays:

```ts
import type { ToolsetName } from "../../compat/abap-fs-tools.js"
import { V1_TOOL_NAMES } from "./migration-catalog.js"

type PrimaryToolsetName = Exclude<ToolsetName, "all">

export const V1_MCP_TOOLSETS: Record<PrimaryToolsetName, readonly string[]> = {
  core: [
    "sap.repository.inspect",
    "sap.repository.resolve",
    "sap.repository.search",
    "sap.repository.where_used",
    "sap.semantic.complete",
    "sap.semantic.components",
    "sap.semantic.definition",
    "sap.semantic.documentation",
    "sap.semantic.format_preview",
    "sap.semantic.hierarchy",
    "sap.semantic.quick_fixes",
    "sap.source.diagnose",
    "sap.source.read",
    "sap.source.read_batch",
    "sap.source.search",
    "sap.system.capabilities",
    "sap.system.inspect",
    "sap.system.list",
    "sap.text_elements.read",
    "sap.ui.object_url"
  ],
  write: [
    "sap.execution.execute",
    "sap.git.branch.switch",
    "sap.git.create",
    "sap.git.pull",
    "sap.git.push",
    "sap.git.stage",
    "sap.git.unlink",
    "sap.quality.test_include.create",
    "sap.rap.binding.publish",
    "sap.rap.binding.unpublish",
    "sap.rap.generate",
    "sap.refactor.execute",
    "sap.repository.create",
    "sap.source.activate",
    "sap.source.patch",
    "sap.text_elements.write",
    "sap.transport.create",
    "sap.transport.delete",
    "sap.transport.object.add",
    "sap.transport.owner.set",
    "sap.transport.release",
    "sap.transport.user.add",
    "sap.version.restore.execute"
  ],
  analysis: [
    "sap.data.query",
    "sap.git.check",
    "sap.git.inspect",
    "sap.git.list",
    "sap.quality.atc.cached",
    "sap.quality.atc.documentation",
    "sap.quality.atc.run",
    "sap.quality.unit_test",
    "sap.rap.availability",
    "sap.rap.binding.inspect",
    "sap.rap.defaults",
    "sap.rap.preview",
    "sap.rap.schema",
    "sap.rap.validate",
    "sap.refactor.preview",
    "sap.repository.compare",
    "sap.repository.dependency_graph",
    "sap.transport.assess",
    "sap.transport.compare",
    "sap.transport.inspect",
    "sap.transport.list",
    "sap.transport.object.resolve",
    "sap.transport.user.list",
    "sap.version.history.compare",
    "sap.version.history.list",
    "sap.version.history.read",
    "sap.version.inactive.list",
    "sap.version.inactive.read",
    "sap.version.restore.preview"
  ],
  debug: [
    "sap.debug.breakpoint.remove",
    "sap.debug.breakpoint.set",
    "sap.debug.evaluate",
    "sap.debug.session.inspect",
    "sap.debug.session.start",
    "sap.debug.session.stop",
    "sap.debug.stack",
    "sap.debug.status",
    "sap.debug.step",
    "sap.debug.variables"
  ],
  operations: [
    "sap.execution.health",
    "sap.execution.preview",
    "sap.ops.watch.history",
    "sap.ops.watch.start",
    "sap.ops.watch.status",
    "sap.ops.watch.stop",
    "sap.ops.watch.task.add",
    "sap.ops.watch.task.disable",
    "sap.ops.watch.task.enable",
    "sap.ops.watch.task.list",
    "sap.ops.watch.task.remove",
    "sap.ops.watch.task.update",
    "sap.ops.watch.trigger",
    "sap.ops.watch.watchlist.read",
    "sap.runtime.dump.inspect",
    "sap.runtime.dump.list",
    "sap.runtime.trace.configuration",
    "sap.runtime.trace.hit_list",
    "sap.runtime.trace.inspect",
    "sap.runtime.trace.list",
    "sap.runtime.trace.statements",
    "sap.system.discovery",
    "sap.ui.transaction_launch",
    "sap.ui.transaction_url"
  ],
  artifacts: [
    "sap.artifact.mermaid.create",
    "sap.artifact.mermaid.detect",
    "sap.artifact.mermaid.validate",
    "sap.artifact.test_document.create",
    "sap.data.export",
    "sap.source.export",
    "sap.system.discovery.export"
  ]
}

export const V1_RESOURCE_NAMES = [
  "sap-adt-source",
  "sap-capability-evidence",
  "sap-docs-compat",
  "sap-docs-data-query",
  "sap-docs-mermaid",
  "sap-evidence",
  "sap-transport"
] as const

export type V1ResourceName = typeof V1_RESOURCE_NAMES[number]

export const V1_IMPLEMENTED_RESOURCE_NAMES = [
  "sap-adt-source",
  "sap-capability-evidence"
] as const satisfies readonly V1ResourceName[]

export const V1_RESOURCE_TOOLSETS: Record<
  PrimaryToolsetName,
  readonly V1ResourceName[]
> = {
  core: ["sap-adt-source", "sap-capability-evidence", "sap-evidence"],
  write: ["sap-evidence", "sap-transport"],
  analysis: ["sap-docs-data-query", "sap-evidence", "sap-transport"],
  debug: ["sap-evidence"],
  operations: ["sap-evidence"],
  artifacts: ["sap-docs-compat", "sap-docs-mermaid", "sap-evidence"]
}

export function v1ToolsForToolsets(
  toolsets: readonly ToolsetName[]
): ReadonlySet<string> {
  if (toolsets.includes("all")) return new Set(V1_TOOL_NAMES)
  const selected = toolsets.filter(
    (name): name is PrimaryToolsetName => name !== "all"
  )
  return new Set(selected.flatMap(name => V1_MCP_TOOLSETS[name]))
}

export function v1ResourcesForToolsets(
  toolsets: readonly ToolsetName[]
): ReadonlySet<V1ResourceName> {
  if (toolsets.includes("all")) return new Set(V1_RESOURCE_NAMES)
  const selected = toolsets.filter(
    (name): name is PrimaryToolsetName => name !== "all"
  )
  return new Set(selected.flatMap(name => V1_RESOURCE_TOOLSETS[name]))
}
```

- [ ] **Step 4: Run the exact coverage test**

Run:

```bash
npm run build
node --test dist/test/v1-toolsets.test.js dist/test/v1-migration-catalog.test.js
```

Expected: both tests pass with `20 + 23 + 29 + 10 + 24 + 7 = 113` and no duplicate tool name.

- [ ] **Step 5: Commit the static v1 toolsets**

```bash
git add src/mcp/v1/toolsets.ts test/v1-toolsets.test.ts
git commit -m "feat: define bounded v1 toolsets"
```

---

### Task 4: Separate v0 and v1 Selection Through CLI and Registration

**Files:**
- Create: `src/mcp/tool-selection.ts`
- Create: `test/v1-tool-selection.test.ts`
- Modify: `src/index.ts`
- Modify: `src/mcp-server.ts`
- Modify: `src/mcp/v1/register.ts`
- Modify: `src/mcp/v1/resources.ts`
- Modify: `src/mcp/v1/migration-catalog.ts`
- Modify: `test/deferred-results.test.ts`
- Modify: `test/integration.test.ts`
- Modify: `test/v1-documentation.test.ts`
- Modify: `test/v1-system-tools.test.ts`

**Interfaces:**
- Consumes: `McpApiVersion`, `ToolsetName`, `toolsForToolsets()`, `v1ToolsForToolsets()`, `v1ResourcesForToolsets()`, and `V1_IMPLEMENTED_TOOL_NAMES`.
- Produces: `ServeToolSelection`, `resolveServeToolSelection()`, and `McpServerOptions` with three independent filters.

- [ ] **Step 1: Write failing pure selection tests**

Create `test/v1-tool-selection.test.ts`:

```ts
import assert from "node:assert/strict"
import test from "node:test"
import { ABAP_MCP_TOOLSETS, IMPLEMENTED_TOOL_NAMES } from "../src/compat/abap-fs-tools.js"
import { resolveServeToolSelection } from "../src/mcp/tool-selection.js"
import { V1_MCP_TOOLSETS, V1_RESOURCE_NAMES } from "../src/mcp/v1/toolsets.js"

test("unversioned and explicit v0 remain unfiltered all", () => {
  assert.deepEqual(resolveServeToolSelection("v0"), {})
})

test("v1 defaults to core tools and core Resources", () => {
  const selection = resolveServeToolSelection("v1")
  assert.deepEqual(
    [...selection.enabledV1Tools!].sort(),
    [...V1_MCP_TOOLSETS.core].sort()
  )
  assert.deepEqual(
    [...selection.enabledV1Resources!].sort(),
    ["sap-adt-source", "sap-capability-evidence", "sap-evidence"]
  )
  assert.equal(selection.enabledV0Tools, undefined)
})

test("all API mode without toolsets remains unfiltered comparison", () => {
  assert.deepEqual(resolveServeToolSelection("all"), {})
})

test("explicit toolsets resolve independently for v0 and v1", () => {
  const selection = resolveServeToolSelection("all", ["write"])
  assert.deepEqual(
    [...selection.enabledV0Tools!].sort(),
    [...ABAP_MCP_TOOLSETS.write].sort()
  )
  assert.deepEqual(
    [...selection.enabledV1Tools!].sort(),
    [...V1_MCP_TOOLSETS.write].sort()
  )
})

test("explicit all selects both complete catalogs", () => {
  const selection = resolveServeToolSelection("all", ["all"])
  assert.equal(selection.enabledV0Tools!.size, IMPLEMENTED_TOOL_NAMES.length)
  assert.equal(selection.enabledV1Tools!.size, 113)
  assert.deepEqual(
    [...selection.enabledV1Resources!].sort(),
    [...V1_RESOURCE_NAMES].sort()
  )
})
```

- [ ] **Step 2: Run the selection test to verify the module is missing**

Run:

```bash
npm run build
```

Expected: TypeScript fails to resolve `src/mcp/tool-selection.ts`.

- [ ] **Step 3: Implement the pure selection resolver**

Create `src/mcp/tool-selection.ts`:

```ts
import {
  toolsForToolsets,
  type ToolsetName
} from "../compat/abap-fs-tools.js"
import type { McpApiVersion } from "./api-version.js"
import {
  v1ResourcesForToolsets,
  v1ToolsForToolsets,
  type V1ResourceName
} from "./v1/toolsets.js"

export interface ServeToolSelection {
  enabledV0Tools?: ReadonlySet<string>
  enabledV1Tools?: ReadonlySet<string>
  enabledV1Resources?: ReadonlySet<V1ResourceName>
}

export function resolveServeToolSelection(
  apiVersion: McpApiVersion,
  toolsets?: readonly ToolsetName[]
): ServeToolSelection {
  if (toolsets === undefined) {
    if (apiVersion !== "v1") return {}
    return {
      enabledV1Tools: v1ToolsForToolsets(["core"]),
      enabledV1Resources: v1ResourcesForToolsets(["core"])
    }
  }

  return {
    ...(apiVersion !== "v1"
      ? { enabledV0Tools: toolsForToolsets(toolsets) }
      : {}),
    ...(apiVersion !== "v0"
      ? {
          enabledV1Tools: v1ToolsForToolsets(toolsets),
          enabledV1Resources: v1ResourcesForToolsets(toolsets)
        }
      : {})
  }
}
```

- [ ] **Step 4: Change server options without changing v0 behavior**

In `src/mcp-server.ts`, replace `enabledTools` with exact fields:

```ts
import type { V1ResourceName } from "./mcp/v1/toolsets.js"

export interface McpServerOptions {
  enabledV0Tools?: ReadonlySet<string>
  enabledV1Tools?: ReadonlySet<string>
  enabledV1Resources?: ReadonlySet<V1ResourceName>
  apiVersion?: McpApiVersion
}
```

Change the two v0 checks only by field name:

```ts
const deferredResultsEnabled = !options.enabledV0Tools ||
  options.enabledV0Tools.has(DEFERRED_RESULT_TOOL_NAME)

if (options.enabledV0Tools && !options.enabledV0Tools.has(name)) return undefined
```

At the end of `createMcpServer`, pass the exact v1 filters:

```ts
if (apiVersion === "v1" || apiVersion === "all") {
  registerV1Tools(server, tools, {
    ...(options.enabledV1Tools
      ? { enabledTools: options.enabledV1Tools }
      : {}),
    ...(options.enabledV1Resources
      ? { enabledResources: options.enabledV1Resources }
      : {})
  })
}
```

- [ ] **Step 5: Replace reverse v0 mapping with exact v1-name filtering**

In `src/mcp/v1/register.ts`, use:

```ts
import type { V1ResourceName } from "./toolsets.js"

export interface V1RegistrationOptions {
  enabledTools?: ReadonlySet<string>
  enabledResources?: ReadonlySet<V1ResourceName>
}

export function isV1ToolEnabled(
  v1ToolName: string,
  enabledTools?: ReadonlySet<string>
): boolean {
  return enabledTools === undefined || enabledTools.has(v1ToolName)
}
```

Keep the existing registrar calls, but filter their v1 names against
`options.enabledTools`. Call Resources with:

```ts
registerV1Resources(server, service, options.enabledResources)
```

Remove the `V1_MIGRATION_CATALOG` import from this file.

- [ ] **Step 6: Filter the two implemented Resources by exact Resource name**

In `src/mcp/v1/resources.ts`, add the parameter and guard helpers:

```ts
import type { V1ResourceName } from "./toolsets.js"

function resourceEnabled(
  name: V1ResourceName,
  enabled?: ReadonlySet<V1ResourceName>
): boolean {
  return enabled === undefined || enabled.has(name)
}

export function registerV1Resources(
  server: McpServer,
  service: V1ReadService,
  enabled?: ReadonlySet<V1ResourceName>
): void {
  const capabilityEnabled = resourceEnabled("sap-capability-evidence", enabled)
  const sourceEnabled = resourceEnabled("sap-adt-source", enabled)
  if (!capabilityEnabled && !sourceEnabled) return

  const completionRouter = installV1CompletionRouter(server)
  installV1ResourceRegistry(server, completionRouter)

  if (capabilityEnabled) {
    server.registerResource(
      "sap-capability-evidence",
      new ResourceTemplate("sap-capability://{system}", { list: undefined }),
      {
        title: "SAP Capability Evidence",
        description: "Complete capability discovery evidence for one SAP system.",
        mimeType: "application/json"
      },
      uri => readCapabilityResource(uri.toString(), service)
    )
  }

  if (sourceEnabled) {
    server.registerResource(
      "sap-adt-source",
      new ResourceTemplate("adt://{system}/{+adtPath}", { list: undefined }),
      {
        title: "SAP ABAP Source",
        description: "Complete active ABAP source for one canonical ADT resource.",
        mimeType: "text/x-abap"
      },
      uri => readAdtResource(uri.toString(), service)
    )
  }
}
```

- [ ] **Step 7: Route parsed CLI toolsets through the resolver**

In `src/index.ts`:

1. Remove `V1_FIRST_SLICE_V0_TOOL_NAMES` and `toolsForToolsets` imports.
2. Import `V1_IMPLEMENTED_TOOL_NAMES` and `resolveServeToolSelection`.
3. Keep the existing invalid-toolset validation, but retain the parsed array as
   `selectedToolsets: ToolsetName[] | undefined`.
4. Resolve and validate with:

```ts
const selection = resolveServeToolSelection(apiVersion, selectedToolsets)
if (apiVersion === "v1" && selection.enabledV1Tools &&
  !V1_IMPLEMENTED_TOOL_NAMES.some(name => selection.enabledV1Tools!.has(name))) {
  throw new AppError(
    "V1_TOOLSET_EMPTY",
    "The selected toolsets contain no implemented v1 tools",
    { available: ["core", "all"] }
  )
}
```

Create the server with:

```ts
const server = createMcpServer(
  new AbapToolService(manager, secrets),
  { apiVersion, ...selection }
)
```

After `src/index.ts` and `test/v1-source-read.test.ts` no longer import them,
delete `V1_FIRST_SLICE_TOOL_NAMES` and `V1_FIRST_SLICE_V0_TOOL_NAMES` from
`src/mcp/v1/migration-catalog.ts`.

- [ ] **Step 8: Rename internal option call sites and update exact filtering assertions**

Apply these mechanical replacements only:

- v0-only tests and deferred-result tests: `enabledTools` -> `enabledV0Tools`.
- mixed `all` tests: pass both `enabledV0Tools` and `enabledV1Tools`.
- v1-only tests: pass `enabledV1Tools`.

Update the filtering assertions in `test/v1-system-tools.test.ts` to:

```ts
test("v1 tool filtering uses exact v1 names", () => {
  assert.equal(isV1ToolEnabled("sap.system.list"), true)
  assert.equal(
    isV1ToolEnabled("sap.system.list", new Set(["sap.system.list"])),
    true
  )
  assert.equal(
    isV1ToolEnabled("sap.system.list", new Set(["sap.system.inspect"])),
    false
  )
  assert.equal(
    isV1ToolEnabled("sap.ops.watch.start", new Set(["sap.ops.watch.start"])),
    true
  )
})
```

For the `all`-mode write test, use:

```ts
const writeV0Tools = toolsForToolsets(["write"])
const writeV1Tools = v1ToolsForToolsets(["write"])
const tools = await advertisedTools({
  apiVersion: "all",
  enabledV0Tools: writeV0Tools,
  enabledV1Tools: writeV1Tools,
  enabledV1Resources: v1ResourcesForToolsets(["write"])
})
assert.deepEqual(
  sortedNames(tools.map(tool => tool.name)),
  sortedNames(IMPLEMENTED_TOOL_NAMES.filter(name => writeV0Tools.has(name)))
)
```

The expected list contains only v0 write tools because this foundation slice
does not register placeholder v1 write handlers.

- [ ] **Step 9: Run selection, v0, Resource, and integration tests**

Run:

```bash
npm run build
node --test dist/test/v1-tool-selection.test.js dist/test/v1-toolsets.test.js dist/test/v1-system-tools.test.js dist/test/v1-capabilities.test.js dist/test/v1-source-read.test.js dist/test/v0-contract.test.js dist/test/deferred-results.test.js dist/test/integration.test.js
```

Expected: all tests pass; explicit v1 core advertises the same five implemented
tools, v1 write advertises none, and v0 remains identical to the fixture.

- [ ] **Step 10: Commit the independent selection boundary**

```bash
git add src/index.ts src/mcp-server.ts src/mcp/tool-selection.ts src/mcp/v1/migration-catalog.ts src/mcp/v1/register.ts src/mcp/v1/resources.ts test/deferred-results.test.ts test/integration.test.ts test/v1-documentation.test.ts test/v1-system-tools.test.ts test/v1-tool-selection.test.ts
git commit -m "feat: separate v0 and v1 tool selection"
```

---

### Task 5: Measure and Enforce v1 Schema Budgets

**Files:**
- Create: `src/mcp/v1/surface-budget.ts`
- Create: `test/v1-surface-budget.test.ts`
- Modify: `scripts/benchmark-mcp-surface.mjs`
- Modify: `test/v1-documentation.test.ts`

**Interfaces:**
- Consumes: MCP `Tool`, `V1_MCP_TOOLSETS`, `v1ToolsForToolsets()`, `v1ResourcesForToolsets()`, `resolveServeToolSelection()`, and `advertisedTools()`.
- Produces: `V1_SURFACE_BUDGETS`, `V1_MAX_TOOL_SCHEMA_BYTES`, `measureToolSurface()`, and benchmark JSON containing byte and token-proxy metrics.

- [ ] **Step 1: Write failing budget tests**

Create `test/v1-surface-budget.test.ts`:

```ts
import assert from "node:assert/strict"
import test from "node:test"
import type { ToolsetName } from "../src/compat/abap-fs-tools.js"
import { V1_IMPLEMENTED_TOOL_NAMES } from "../src/mcp/v1/migration-catalog.js"
import {
  V1_MAX_TOOL_SCHEMA_BYTES,
  V1_SURFACE_BUDGETS,
  measureToolSurface
} from "../src/mcp/v1/surface-budget.js"
import { v1ResourcesForToolsets, v1ToolsForToolsets } from "../src/mcp/v1/toolsets.js"
import { advertisedTools } from "./helpers/mcp-surface.js"

const TOOLSETS: ToolsetName[] = [
  "core", "write", "analysis", "debug", "operations", "artifacts", "all"
]

test("every implemented v1 surface stays inside its approved budget", async () => {
  for (const toolset of TOOLSETS) {
    const enabledV1Tools = v1ToolsForToolsets([toolset])
    const hasImplementedTool = V1_IMPLEMENTED_TOOL_NAMES.some(name =>
      enabledV1Tools.has(name)
    )
    const tools = hasImplementedTool
      ? await advertisedTools({
          apiVersion: "v1",
          enabledV1Tools,
          enabledV1Resources: v1ResourcesForToolsets([toolset])
        })
      : []
    const measurement = measureToolSurface(tools)
    const budget = V1_SURFACE_BUDGETS[toolset]
    assert.ok(measurement.toolCount <= budget.maxTools, toolset)
    assert.ok(measurement.schemaBytes <= budget.maxSchemaBytes, toolset)
    assert.ok(measurement.largestTools.every(tool =>
      tool.bytes <= V1_MAX_TOOL_SCHEMA_BYTES
    ), toolset)
  }
})

test("token proxy is the ceiling of minified bytes divided by four", async () => {
  const tools = await advertisedTools({
    apiVersion: "v1",
    enabledV1Tools: v1ToolsForToolsets(["core"])
  })
  const measurement = measureToolSurface(tools)
  assert.equal(
    measurement.estimatedTokensCeilBytesDiv4,
    Math.ceil(measurement.schemaBytes / 4)
  )
})
```

- [ ] **Step 2: Run the build to verify the budget module is missing**

Run:

```bash
npm run build
```

Expected: TypeScript fails to resolve `surface-budget.js`.

- [ ] **Step 3: Implement deterministic surface measurement**

Create `src/mcp/v1/surface-budget.ts`:

```ts
import type { Tool } from "@modelcontextprotocol/sdk/types.js"
import type { ToolsetName } from "../../compat/abap-fs-tools.js"

interface SurfaceBudget {
  maxTools: number
  maxSchemaBytes: number
}

export const V1_MAX_TOOL_SCHEMA_BYTES = 8 * 1024

export const V1_SURFACE_BUDGETS: Record<ToolsetName, SurfaceBudget> = {
  core: { maxTools: 24, maxSchemaBytes: 32 * 1024 },
  write: { maxTools: 32, maxSchemaBytes: 64 * 1024 },
  analysis: { maxTools: 32, maxSchemaBytes: 64 * 1024 },
  debug: { maxTools: 32, maxSchemaBytes: 64 * 1024 },
  operations: { maxTools: 32, maxSchemaBytes: 64 * 1024 },
  artifacts: { maxTools: 32, maxSchemaBytes: 64 * 1024 },
  all: { maxTools: 113, maxSchemaBytes: 384 * 1024 }
}

export function measureToolSurface(tools: readonly Tool[]) {
  const largestTools = tools.map(tool => ({
    name: tool.name,
    bytes: Buffer.byteLength(JSON.stringify(tool), "utf8")
  })).sort((left, right) => right.bytes - left.bytes)
  const schemaBytes = Buffer.byteLength(JSON.stringify(tools), "utf8")

  return {
    toolCount: tools.length,
    schemaBytes,
    estimatedTokensCeilBytesDiv4: Math.ceil(schemaBytes / 4),
    largestTools: largestTools.slice(0, 10)
  }
}
```

- [ ] **Step 4: Make the benchmark use the same selection and measurement code**

Replace `scripts/benchmark-mcp-surface.mjs` with this complete script:

```js
import { writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { createMcpServer } from "../dist/src/mcp-server.js"
import { resolveServeToolSelection } from "../dist/src/mcp/tool-selection.js"
import { V1_IMPLEMENTED_TOOL_NAMES } from "../dist/src/mcp/v1/migration-catalog.js"
import { measureToolSurface } from "../dist/src/mcp/v1/surface-budget.js"
import { AbapToolService } from "../dist/src/tool-service.js"

const TOOLSETS = [
  "all", "core", "write", "analysis", "debug", "operations", "artifacts"
]

const requestedOutputIndex = process.argv.indexOf("--output")
const requestedOutput = requestedOutputIndex >= 0
  ? process.argv[requestedOutputIndex + 1]
  : undefined
if (requestedOutputIndex >= 0 && !requestedOutput) {
  throw new Error("--output requires a file path")
}

async function measure(toolset, apiVersion) {
  const selection = resolveServeToolSelection(apiVersion, [toolset])
  if (apiVersion === "v1" && selection.enabledV1Tools &&
    !V1_IMPLEMENTED_TOOL_NAMES.some(name => selection.enabledV1Tools.has(name))) {
    return {
      apiVersion,
      toolset,
      ...measureToolSurface([]),
      status: "no-implemented-tools"
    }
  }

  const service = new AbapToolService({
    async listConnections() { return [] },
    async getClient() {
      throw new Error("No SAP call is allowed during schema benchmarking")
    }
  })
  const server = createMcpServer(service, { apiVersion, ...selection })
  const client = new Client({ name: "sap-abap-mcp-benchmark", version: "1.0.0" })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  await client.connect(clientTransport)
  try {
    const tools = (await client.listTools()).tools
    return {
      apiVersion,
      toolset,
      ...measureToolSurface(tools)
    }
  } finally {
    await client.close()
    await server.close()
  }
}

const report = {
  schemaVersion: "1.0",
  generatedAt: new Date().toISOString(),
  measurement: "minified UTF-8 MCP tool array",
  liveSapCalls: 0,
  v0Toolsets: [],
  v1Toolsets: [],
  versionedSurfaces: []
}
for (const toolset of TOOLSETS) {
  report.v0Toolsets.push(await measure(toolset, "v0"))
  report.v1Toolsets.push(await measure(toolset, "v1"))
}
report.versionedSurfaces.push(await measure("all", "all"))

const serialized = `${JSON.stringify(report, null, 2)}\n`
if (requestedOutput) {
  const outputPath = resolve(requestedOutput)
  await writeFile(outputPath, serialized, "utf8")
  process.stdout.write(`${outputPath}\n`)
} else {
  process.stdout.write(serialized)
}
```

The early return is required because an MCP server with zero registered Tool
handlers does not advertise the `tools` capability, so `client.listTools()` is
not valid for the currently empty v1 write/analysis/debug/operations/artifacts
surfaces.

- [ ] **Step 5: Remove duplicate budget logic from the documentation test**

In `test/v1-documentation.test.ts`, keep documentation and dynamic count
assertions, but remove the local `< 24 * 1024` check. Replace fixed counts with:

```ts
assert.equal(v1Tools.length, V1_IMPLEMENTED_TOOL_NAMES.length)
assert.equal(
  allTools.length,
  IMPLEMENTED_TOOL_NAMES.length + V1_IMPLEMENTED_TOOL_NAMES.length
)
```

Import both name arrays from their authoritative modules.

- [ ] **Step 6: Run budget tests and the benchmark**

Run:

```bash
npm run build
node --test dist/test/v1-surface-budget.test.js dist/test/v1-documentation.test.js
node scripts/benchmark-mcp-surface.mjs
```

Expected: tests pass; report includes v0/v1 measurements for seven toolsets,
`liveSapCalls` is `0`, v1 core remains below 32 KiB, and no implemented tool
exceeds 8 KiB.

- [ ] **Step 7: Commit budget enforcement**

```bash
git add src/mcp/v1/surface-budget.ts scripts/benchmark-mcp-surface.mjs test/v1-documentation.test.ts test/v1-surface-budget.test.ts
git commit -m "test: enforce v1 surface budgets"
```

---

### Task 6: Document the Preview Boundary and Make Smoke Counts Dynamic

**Files:**
- Modify: `docs/v1-migration.md`
- Modify: `scripts/smoke-v1-stdio.mjs`
- Modify: `test/v1-documentation.test.ts`

**Interfaces:**
- Consumes: `V1_IMPLEMENTED_TOOL_NAMES` and `v1ToolsForToolsets()` from compiled modules.
- Produces: truthful preview documentation and a core smoke test that grows only when an implemented core handler is added.

- [ ] **Step 1: Write failing documentation expectations**

In `test/v1-documentation.test.ts`, require the guide to contain all of these
exact statements:

```ts
for (const statement of [
  "The unversioned `serve` remains the complete v0 compatibility surface.",
  "Explicit v1 mode defaults to the `core` toolset.",
  "The complete v1 catalog contains 113 target tool names, but only implemented handlers are advertised.",
  "Do not describe the preview as complete v1 until the 53-tool/150-variant parity gate passes.",
  "`--api-version all` is reserved for migration conformance because it exposes duplicate capabilities."
]) {
  assert.ok(guide.includes(statement), statement)
}
```

Also require these exact launch lines in order:

```text
npx @coaspe/sap-abap-mcp@latest serve
npx @coaspe/sap-abap-mcp@latest serve --api-version v1
npx @coaspe/sap-abap-mcp@latest serve --api-version v1 --toolsets all
npx @coaspe/sap-abap-mcp@latest serve --api-version all
```

- [ ] **Step 2: Run the documentation test to verify it fails**

Run:

```bash
npm run build
node --test dist/test/v1-documentation.test.js
```

Expected: failure because the guide does not contain the new core/catalog/parity statements.

- [ ] **Step 3: Rewrite the opening and launch section of the migration guide**

Keep the existing five implemented mappings, and add the exact statements and
four launch commands from Step 1. The guide must say:

- v0 is complete and unchanged;
- explicit v1 defaults to core;
- the current five tools are implemented preview handlers, not complete v1;
- `--toolsets all` selects the complete catalog filter but cannot advertise a
  handler that has not been implemented;
- final live acceptance waits for 53-tool/150-variant parity;
- `all` is conformance-only and duplicates capabilities.

Do not claim that 113 handlers already exist.

- [ ] **Step 4: Derive the stdio smoke expectation from implemented core names**

In `scripts/smoke-v1-stdio.mjs`, replace the hard-coded five-name array with:

```js
import { V1_IMPLEMENTED_TOOL_NAMES } from "../dist/src/mcp/v1/migration-catalog.js"
import { v1ToolsForToolsets } from "../dist/src/mcp/v1/toolsets.js"

const coreNames = v1ToolsForToolsets(["core"])
const expectedToolNames = V1_IMPLEMENTED_TOOL_NAMES
  .filter(name => coreNames.has(name))
  .sort()
```

Keep the zero-profile `sap.system.list` call. Change the final message to:

```js
process.stdout.write(
  `v1 stdio smoke passed: ${expectedToolNames.length} core tools, 0 systems\n`
)
```

- [ ] **Step 5: Run documentation, smoke, and full verification**

Run:

```bash
npm run build
node --test dist/test/v1-documentation.test.js
npm run smoke:v1
npm test
npm run benchmark:surface
git diff --check
```

Expected:

- v1 documentation test passes;
- smoke reports five implemented core tools and zero systems;
- the complete automated suite passes with zero failures;
- benchmark performs zero SAP calls and all v1 budgets pass;
- `git diff --check` prints nothing.

- [ ] **Step 6: Inspect the final compatibility evidence before committing**

Run:

```bash
git status --short
git diff -- test/fixtures/v0-tool-surface.json
git diff -- docs/live-sap-53-tool-test-prompts.ko.md docs/live-sap-v1-test-prompt.ko.md
```

Expected:

- `test/fixtures/v0-tool-surface.json` has no diff;
- the two live prompt files contain only the user's pre-existing unstaged work;
- no profile, credential, package, MCPB, plugin, or generated SAP artifact file appears.

- [ ] **Step 7: Commit the truthful preview documentation and smoke test**

```bash
git add docs/v1-migration.md scripts/smoke-v1-stdio.mjs test/v1-documentation.test.ts
git commit -m "docs: define v1 preview and toolset boundary"
```

---

## Slice 1 Completion Criteria

Slice 1 is complete only when:

1. Unversioned and explicit v0 both match `test/fixtures/v0-tool-surface.json`.
2. The v0 inventory remains 53 tools and 150 audited variants.
3. `V1_TOOL_NAMES` contains 113 unique exact names from 115 target references.
4. The six v1 primary toolsets contain 20/23/29/10/24/7 names with no duplicate or omission.
5. Discovery still advertises only the five implemented v1 handlers; no planned name has a callback.
6. Explicit v1 defaults to core, while unversioned v0 and unfiltered `all` preserve their approved behavior.
7. Existing core Resources are filtered independently from v0 tools.
8. All surface budget tests, the full automated suite, stdio smoke, and benchmark pass.
9. The v0 fixture and the user's live-test prompt changes are untouched.

After this slice, write a separate focused plan for **Slice 2: Core Read Parity**. Do not begin repository/source/semantic handler migration inside this foundation plan.

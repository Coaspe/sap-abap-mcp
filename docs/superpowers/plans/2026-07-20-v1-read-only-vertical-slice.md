# SAP ABAP MCP v1 Read-Only Vertical Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the opt-in v1 contract and its first five read-only tools while preserving the complete v0 surface and every unversioned launch path.

**Architecture:** Keep `AbapToolService` as the shared application-service boundary. The existing `src/mcp-server.ts` remains the v0 compatibility presenter; small modules under `src/mcp/v1/` add v1 schemas, result/error presentation, canonical Resource identities, and v1 registration. `createMcpServer` selects v0, v1, or both without duplicating SAP calls or moving unrelated code.

**Tech Stack:** TypeScript 7, Node.js 20+, `@modelcontextprotocol/sdk` 1.29.0, Zod 4, Node test runner, in-memory MCP transport.

**Implementation note (2026-07-21):** The hybrid v1 Resource dispatcher was
replaced by the approved [v1 Resource Registry redesign](../specs/2026-07-20-v1-resource-registry-redesign.md). Historical RED/GREEN evidence below is unchanged.

## Global Constraints

- Unversioned `serve` and every existing package, MCPB, and plugin launch command remain v0 for the complete 1.x line.
- v1 is exposed only by `serve --api-version v1`; `all` is for migration testing only.
- Do not bump a package version, publish, change `@latest` launch arguments, or change registry/MCPB/plugin defaults in this slice.
- Do not change v0 tool names, schemas, annotations, text responses, deferred-result behavior, toolsets, or SAP call counts.
- The slice adds exactly five v1 tools: `sap.system.list`, `sap.system.inspect`, `sap.system.capabilities`, `sap.repository.search`, and `sap.source.read`.
- All five v1 tools are read-only, non-destructive, idempotent, and open-world.
- Do not add Streamable HTTP, MCP OAuth, browser SSO, mTLS, MCP Tasks, Prompts,
  progress plumbing, mutation policy, profile migration, or BTP service-key
  support in this slice.
- Reuse `AbapToolService`; do not create a second SAP client path and do not perform a wholesale `src/core/` migration.
- `--toolsets` continues to select the existing v0 capabilities. In v1/all mode, a v1 tool is enabled when at least one of its mapped v0 source tools is enabled. Thus `core` exposes all five first-slice tools and `write` exposes none.
- A CLI launch using `--api-version v1` fails explicitly when the selected
  toolsets map to zero implemented v1 tools; it must not start a seemingly
  broken tool-less server. In `--api-version all`, such a filter remains valid
  because its selected v0 tools are still exposed.
- Runtime tool failures use the v1 error envelope. Input rejected before callback invocation remains the MCP SDK's standard input-validation error; document this protocol-layer distinction in the approved design rather than weakening the advertised input schemas.
- Implement test-first. Run the named focused test after every production change and `npm run check` before the final commit.
- When a test introduces a brand-new TypeScript module or exported symbol, a
  compiler failure caused solely by that missing API is an accepted RED. Record
  the exact missing-module or missing-export diagnostic before implementation.
  Syntax errors, incorrect imports, fixture errors, and unrelated build failures
  are not accepted RED evidence.
- Every commit must leave the TypeScript build and all tests green.

Use these exact discovery labels:

| Tool | Title | Description |
| --- | --- | --- |
| `sap.system.list` | List SAP Systems | List configured SAP system IDs and local credential availability. |
| `sap.system.inspect` | Inspect SAP System | Read normalized SAP client, release, timezone, and optional software component metadata. |
| `sap.system.capabilities` | Inspect SAP Capabilities | Read implemented, advertised, authorized, and observed capabilities for one SAP system. |
| `sap.repository.search` | Search SAP Repository | Search ABAP repository objects by name pattern and object type. |
| `sap.source.read` | Read ABAP Source | Read a bounded active ABAP source range or one class method. |

---

## Task 1: Freeze the v0 Contract and Make the Migration Map Executable

**Files:**

- Create: `test/helpers/mcp-surface.ts`
- Create: `test/v0-contract.test.ts`
- Create: `test/fixtures/v0-tool-surface.json` (generated, then committed)
- Create: `scripts/update-v0-contract.mjs`
- Create: `src/mcp/v1/migration-catalog.ts`
- Create: `test/v1-migration-catalog.test.ts`
- Modify: `package.json`

**Interfaces:**

```ts
// test/helpers/mcp-surface.ts
export async function advertisedTools(
  options?: McpServerOptions
): Promise<Tool[]>

export function stableToolSurface(tools: Tool[]): Array<{
  name: string
  title?: string
  description?: string
  inputSchema: Tool["inputSchema"]
  annotations?: Tool["annotations"]
}>
```

```ts
// src/mcp/v1/migration-catalog.ts
import type { IMPLEMENTED_TOOL_NAMES } from "../../compat/abap-fs-tools.js"

export type V0ToolName = typeof IMPLEMENTED_TOOL_NAMES[number]
export type V1MigrationDisposition =
  | "first_slice"
  | "planned"
  | "extension"
  | "resource"
  | "v0_only"
  | "compatibility"

export interface V1MigrationEntry {
  targets: readonly string[]
  disposition: V1MigrationDisposition
}

export const V1_MIGRATION_CATALOG: Record<V0ToolName, V1MigrationEntry>
export const V1_FIRST_SLICE_TOOL_NAMES: readonly [
  "sap.system.list",
  "sap.system.inspect",
  "sap.system.capabilities",
  "sap.repository.search",
  "sap.source.read"
]
export const V1_FIRST_SLICE_V0_TOOL_NAMES: readonly [
  "get_connected_systems",
  "get_sap_system_info",
  "get_sap_capabilities",
  "search_abap_objects",
  "get_abap_object_lines"
]
```

The catalog is the machine-readable form of the approved 53-row mapping. Use
this complete object:

```ts
export const V1_MIGRATION_CATALOG = {
  read_deferred_result: {
    targets: ["resource-links", "cursor-pages"], disposition: "compatibility"
  },
  get_connected_systems: {
    targets: ["sap.system.list"], disposition: "first_slice"
  },
  get_sap_system_info: {
    targets: ["sap.system.inspect"], disposition: "first_slice"
  },
  get_sap_capabilities: {
    targets: ["sap.system.capabilities", "sap-capability://{system}"],
    disposition: "first_slice"
  },
  search_abap_objects: {
    targets: ["sap.repository.search"], disposition: "first_slice"
  },
  get_abap_object_lines: {
    targets: ["sap.source.read", "adt://{system}/{+adtPath}"],
    disposition: "first_slice"
  },
  search_abap_object_lines: {
    targets: ["sap.source.search"], disposition: "planned"
  },
  get_abap_object_info: {
    targets: ["sap.repository.inspect"], disposition: "planned"
  },
  get_batch_lines: {
    targets: ["sap.source.read_batch"], disposition: "planned"
  },
  get_object_by_uri: {
    targets: ["sap.source.read"], disposition: "planned"
  },
  get_abap_object_url: {
    targets: ["sap.ui.object_url"], disposition: "extension"
  },
  get_abap_object_workspace_uri: {
    targets: ["sap.repository.resolve"], disposition: "planned"
  },
  open_object: {
    targets: ["sap.repository.resolve"], disposition: "planned"
  },
  find_where_used: {
    targets: ["sap.repository.where_used"], disposition: "planned"
  },
  get_abap_dependency_graph: {
    targets: ["sap.repository.dependency_graph"], disposition: "planned"
  },
  compare_abap_systems: {
    targets: ["sap.repository.compare"], disposition: "planned"
  },
  create_object_programmatically: {
    targets: ["sap.repository.create"], disposition: "planned"
  },
  replace_string_in_abap_object: {
    targets: ["sap.source.patch"], disposition: "planned"
  },
  get_abap_diagnostics: {
    targets: ["sap.source.diagnose"], disposition: "planned"
  },
  abap_activate: {
    targets: ["sap.source.activate"], disposition: "planned"
  },
  inspect_abap_code: {
    targets: [
      "sap.semantic.complete",
      "sap.semantic.definition",
      "sap.semantic.documentation",
      "sap.semantic.hierarchy",
      "sap.semantic.components",
      "sap.semantic.quick_fixes",
      "sap.semantic.format_preview"
    ],
    disposition: "planned"
  },
  refactor_abap_code: {
    targets: ["sap.refactor.preview", "sap.refactor.execute"],
    disposition: "planned"
  },
  manage_text_elements: {
    targets: ["sap.text_elements.read", "sap.text_elements.write"],
    disposition: "planned"
  },
  run_unit_tests: {
    targets: ["sap.quality.unit_test"], disposition: "planned"
  },
  create_test_include: {
    targets: ["sap.quality.test_include.create"], disposition: "planned"
  },
  manage_transport_requests: {
    targets: [
      "sap.transport.list",
      "sap.transport.inspect",
      "sap.transport.assess",
      "sap.transport.compare",
      "sap.transport.create",
      "sap.transport.release",
      "sap.transport.delete",
      "sap.transport.owner.set",
      "sap.transport.user.add",
      "sap.transport.object.add",
      "sap.transport.user.list",
      "sap.transport.object.resolve"
    ],
    disposition: "planned"
  },
  manage_abapgit: {
    targets: [
      "sap.git.list",
      "sap.git.inspect",
      "sap.git.create",
      "sap.git.pull",
      "sap.git.unlink",
      "sap.git.stage",
      "sap.git.push",
      "sap.git.check",
      "sap.git.branch.switch"
    ],
    disposition: "planned"
  },
  manage_rap_generator: {
    targets: [
      "sap.rap.availability",
      "sap.rap.schema",
      "sap.rap.defaults",
      "sap.rap.validate",
      "sap.rap.preview",
      "sap.rap.generate",
      "sap.rap.binding.inspect",
      "sap.rap.binding.publish",
      "sap.rap.binding.unpublish"
    ],
    disposition: "planned"
  },
  manage_abap_versions: {
    targets: [
      "sap.version.inactive.list",
      "sap.version.inactive.read",
      "sap.version.restore.preview",
      "sap.version.restore.execute"
    ],
    disposition: "planned"
  },
  get_version_history: {
    targets: [
      "sap.version.history.list",
      "sap.version.history.read",
      "sap.version.history.compare"
    ],
    disposition: "planned"
  },
  run_atc_analysis: {
    targets: ["sap.quality.atc.run", "sap.quality.atc.documentation"],
    disposition: "planned"
  },
  get_atc_decorations: {
    targets: ["sap.quality.atc.cached"], disposition: "v0_only"
  },
  analyze_abap_dumps: {
    targets: ["sap.runtime.dump.list", "sap.runtime.dump.inspect"],
    disposition: "planned"
  },
  analyze_abap_traces: {
    targets: [
      "sap.runtime.trace.list",
      "sap.runtime.trace.configuration",
      "sap.runtime.trace.inspect",
      "sap.runtime.trace.statements",
      "sap.runtime.trace.hit_list"
    ],
    disposition: "planned"
  },
  abap_debug_session: {
    targets: [
      "sap.debug.session.start",
      "sap.debug.session.stop",
      "sap.debug.session.inspect"
    ],
    disposition: "planned"
  },
  abap_debug_breakpoint: {
    targets: ["sap.debug.breakpoint.set", "sap.debug.breakpoint.remove"],
    disposition: "planned"
  },
  abap_debug_step: {
    targets: ["sap.debug.step"], disposition: "planned"
  },
  abap_debug_variable: {
    targets: ["sap.debug.variables", "sap.debug.evaluate"],
    disposition: "planned"
  },
  abap_debug_stack: {
    targets: ["sap.debug.stack"], disposition: "planned"
  },
  abap_debug_status: {
    targets: ["sap.debug.status"], disposition: "planned"
  },
  execute_data_query: {
    targets: ["sap.data.query", "sap.data.export"], disposition: "planned"
  },
  get_abap_sql_syntax: {
    targets: ["sap-docs://data-query"], disposition: "resource"
  },
  abap_download: {
    targets: ["sap.source.export"], disposition: "extension"
  },
  manage_heartbeat: {
    targets: ["sap.ops.watch.*"], disposition: "v0_only"
  },
  adt_discovery_export: {
    targets: ["sap.system.discovery", "sap.system.discovery.export"],
    disposition: "planned"
  },
  run_sap_transaction: {
    targets: ["sap.ui.transaction_url", "sap.ui.transaction_launch"],
    disposition: "extension"
  },
  run_abap_application: {
    targets: [
      "sap.execution.health",
      "sap.execution.preview",
      "sap.execution.execute"
    ],
    disposition: "planned"
  },
  abap_fs_documentation: {
    targets: ["sap-docs://compat/*"], disposition: "resource"
  },
  create_mermaid_diagram: {
    targets: ["sap.artifact.mermaid.create"], disposition: "extension"
  },
  validate_mermaid_syntax: {
    targets: ["sap.artifact.mermaid.validate"], disposition: "extension"
  },
  get_mermaid_documentation: {
    targets: ["sap-docs://mermaid/*"], disposition: "resource"
  },
  detect_mermaid_diagram_type: {
    targets: ["sap.artifact.mermaid.detect"], disposition: "extension"
  },
  create_test_documentation: {
    targets: ["sap.artifact.test_document.create"], disposition: "extension"
  }
} as const satisfies Record<V0ToolName, V1MigrationEntry>
```

- [ ] **Step 1: Add the test-only surface helper and write the failing v0 snapshot test**

Implement `advertisedTools` and `stableToolSurface` in
`test/helpers/mcp-surface.ts` first. This is test infrastructure, not production
behavior. It must use the real `McpServer`, SDK `Client`, and
`InMemoryTransport`; it must not mock the advertised tool list.

```ts
test("unversioned MCP retains the committed v0 tool surface", async () => {
  const expected = JSON.parse(
    await readFile("test/fixtures/v0-tool-surface.json", "utf8")
  )
  assert.deepEqual(stableToolSurface(await advertisedTools()), expected)
})
```

Run: `npm run build && node --test dist/test/v0-contract.test.js`

Expected: FAIL only because `test/fixtures/v0-tool-surface.json` does not exist.

- [ ] **Step 2: Add the deterministic snapshot updater**

`stableToolSurface` must sort tools by `name`, recursively preserve array order, and sort object keys before serialization. It must omit only `undefined`; it must not normalize away schema constraints or annotations.

`scripts/update-v0-contract.mjs` imports the compiled helper, calls `advertisedTools()` with no version option, and writes:

```js
await writeFile(
  "test/fixtures/v0-tool-surface.json",
  `${JSON.stringify(stableToolSurface(await advertisedTools()), null, 2)}\n`,
  "utf8"
)
```

Add:

```json
"contract:v0:update": "npm run build && node scripts/update-v0-contract.mjs"
```

Run: `npm run contract:v0:update`

Expected: creates a deterministic fixture containing exactly 53 tools.

- [ ] **Step 3: Make the snapshot test pass**

Run: `npm run build && node --test dist/test/v0-contract.test.js`

Expected: PASS with one test.

- [ ] **Step 4: Write the failing migration-catalog tests**

```ts
test("every advertised v0 tool has one migration disposition", () => {
  assert.deepEqual(
    Object.keys(V1_MIGRATION_CATALOG).sort(),
    [...IMPLEMENTED_TOOL_NAMES].sort()
  )
})

test("the first slice has one unambiguous v0 source per v1 tool", () => {
  const inverse = Object.entries(V1_MIGRATION_CATALOG).flatMap(([v0, entry]) =>
    entry.disposition === "first_slice"
      ? entry.targets
          .filter(target => target.startsWith("sap."))
          .map(target => [target, v0] as const)
      : []
  )
  assert.deepEqual(Object.fromEntries(inverse), {
    "sap.system.list": "get_connected_systems",
    "sap.system.inspect": "get_sap_system_info",
    "sap.system.capabilities": "get_sap_capabilities",
    "sap.repository.search": "search_abap_objects",
    "sap.source.read": "get_abap_object_lines"
  })
})
```

Run: `npm run build && node --test dist/test/v1-migration-catalog.test.js`

Expected: FAIL because the catalog does not exist.

- [ ] **Step 5: Add the complete typed 53-row catalog**

Use `satisfies Record<V0ToolName, V1MigrationEntry>` on the object literal so a missing, misspelled, or extra v0 key fails compilation. Derive `V1_FIRST_SLICE_TOOL_NAMES` from the five exact targets, but export it as a fixed ordered tuple so the advertised v1 order is stable.

Run: `npm run build && node --test dist/test/v1-migration-catalog.test.js`

Expected: PASS with two tests and TypeScript proves complete v0 key coverage.

- [ ] **Step 6: Commit**

```bash
git add package.json scripts/update-v0-contract.mjs src/mcp/v1/migration-catalog.ts test/helpers/mcp-surface.ts test/v0-contract.test.ts test/v1-migration-catalog.test.ts test/fixtures/v0-tool-surface.json
git commit -m "test: freeze v0 MCP migration contract"
```

---

## Task 2: Define API-Version Parsing Without Exposing an Incomplete Mode

**Files:**

- Create: `src/mcp/api-version.ts`
- Create: `test/api-version.test.ts`

**Interfaces:**

```ts
// src/mcp/api-version.ts
export const MCP_API_VERSIONS = ["v0", "v1", "all"] as const
export type McpApiVersion = typeof MCP_API_VERSIONS[number]

export function parseMcpApiVersion(value?: string): McpApiVersion {
  if (value === undefined) return "v0"
  if (MCP_API_VERSIONS.includes(value as McpApiVersion)) {
    return value as McpApiVersion
  }
  throw new AppError("INVALID_API_VERSION", `Unknown API version: ${value}`, {
    available: MCP_API_VERSIONS
  })
}
```

- [ ] **Step 1: Write parsing tests first**

```ts
test("an omitted API version remains v0", () => {
  assert.equal(parseMcpApiVersion(), "v0")
})

test("the three public API versions are accepted", () => {
  assert.deepEqual(
    MCP_API_VERSIONS.map(parseMcpApiVersion),
    ["v0", "v1", "all"]
  )
})

test("unknown API versions fail with the available values", () => {
  assert.throws(
    () => parseMcpApiVersion("v2"),
    (error: unknown) => error instanceof AppError &&
      error.code === "INVALID_API_VERSION" &&
      assert.deepEqual(error.details, { available: ["v0", "v1", "all"] }) === undefined
  )
})

test("an explicitly empty API version is invalid", () => {
  assert.throws(
    () => parseMcpApiVersion(""),
    (error: unknown) => error instanceof AppError &&
      error.code === "INVALID_API_VERSION"
  )
})
```

Run: `npm run build && node --test dist/test/api-version.test.js`

Expected: FAIL because `src/mcp/api-version.ts` does not exist.

- [ ] **Step 2: Implement only the parser**

Do not add the CLI flag or `McpServerOptions.apiVersion` in this task. Exposing a
mode before it has at least one usable v1 tool would create an MCP server with
no tool capability. The parser is committed as an internal prerequisite and is
wired atomically with the first two v1 tools in Task 5.

Run: `npm run build && node --test dist/test/api-version.test.js`

Expected: PASS with four tests.

- [ ] **Step 3: Prove the unversioned snapshot did not change**

Run: `npm run build && node --test dist/test/v0-contract.test.js dist/test/api-version.test.js`

Expected: PASS; the committed 53-tool fixture is unchanged.

- [ ] **Step 4: Commit**

```bash
git add src/mcp/api-version.ts test/api-version.test.ts
git commit -m "feat: define MCP API version parsing"
```

---

## Task 3: Implement the v1 Success and Error Envelopes

**Files:**

- Create: `src/mcp/v1/contracts.ts`
- Create: `src/mcp/v1/result.ts`
- Create: `test/v1-result.test.ts`
- Modify: `docs/superpowers/specs/2026-07-20-sap-abap-mcp-v1-standardization-design.md:329-356`

**Interfaces:**

```ts
// src/mcp/v1/contracts.ts
export const V1_SCHEMA_VERSION = "1.0" as const
export const V1_WARNING_SCHEMA = z.object({
  code: z.string().min(1),
  message: z.string().min(1)
})
export const V1_PAGE_SCHEMA = z.object({
  nextCursor: z.string().min(1).optional(),
  returned: z.number().int().nonnegative(),
  total: z.number().int().nonnegative().optional()
})
export const V1_SUCCESS_SHAPE = {
  schemaVersion: z.literal(V1_SCHEMA_VERSION),
  requestId: z.string().min(1),
  status: z.enum(["succeeded", "partial"]),
  systemId: z.string().min(1).optional(),
  warnings: z.array(V1_WARNING_SCHEMA),
  evidence: z.record(z.string(), z.unknown()).optional(),
  page: V1_PAGE_SCHEMA.optional()
}
export const V1_ERROR_SCHEMA = z.object({
  schemaVersion: z.literal(V1_SCHEMA_VERSION),
  requestId: z.string().min(1),
  code: z.string().min(1),
  category: z.enum([
    "validation", "authentication", "authorization", "policy",
    "conflict", "capability", "sap", "transport", "internal"
  ]),
  message: z.string().min(1),
  retryable: z.boolean(),
  details: z.record(z.string(), z.unknown()).optional()
})
```

```ts
// src/mcp/v1/result.ts
export interface V1SuccessOptions {
  requestId?: string
  status?: "succeeded" | "partial"
  systemId?: string
  warnings?: Array<{ code: string; message: string }>
  evidence?: Record<string, unknown>
  page?: { nextCursor?: string; returned: number; total?: number }
  resourceLinks?: Array<{
    uri: string
    name: string
    description?: string
    mimeType?: string
  }>
}

export function v1Success(
  data: Record<string, unknown>,
  options?: V1SuccessOptions
): CallToolResult

export function v1Failure(error: unknown, requestId?: string): CallToolResult

export async function runV1Tool(
  operation: () => Promise<CallToolResult>
): Promise<CallToolResult>
```

`v1Success` creates one UUID when no request ID is supplied, puts the exact same envelope in `structuredContent` and minified JSON text, and appends any Resource links after the text block. `v1Failure` uses `errorPayload`, recursively redacts sensitive keys/text, caps serialized details at 8 KiB, and never returns `structuredContent` for an error because the registered output schema describes successful output only. `runV1Tool` returns the callback result unchanged and converts a thrown value with `v1Failure`; this lets each presenter derive warnings, status, page data, and Resource links from its service result before calling `v1Success`.

Use explicit error classification tables, not a broad substring guess:

```ts
const ERROR_CATEGORIES: Readonly<Record<string, V1ErrorCategory>> = {
  AUTH_REQUIRED: "authentication",
  OAUTH_CLIENT_CREDENTIALS_REQUIRED: "authentication",
  SAP_AUTHORIZATION_DENIED: "authorization",
  PROFILE_NOT_ALLOWED: "policy",
  PRODUCTION_DATA_BLOCKED: "policy",
  PRODUCTION_WRITE_BLOCKED: "policy",
  PACKAGE_NOT_ALLOWED: "policy",
  OBJECT_CHANGED: "conflict",
  SOURCE_CHANGED: "conflict",
  CONNECTION_MISMATCH: "conflict",
  OBJECT_AMBIGUOUS: "conflict",
  SAP_CAPABILITY_UNAVAILABLE: "capability",
  SAP_VALIDATION_FAILED: "validation",
  OBJECT_NOT_FOUND: "validation",
  METHOD_NOT_FOUND: "validation",
  INVALID_ADT_URI: "validation",
  SAP_OPERATION_FAILED: "sap",
  SOURCE_READ_FAILED: "sap",
  CANCELLED: "transport"
}
```

Unknown `AppError` and non-`AppError` values map to `internal`. Only read-side `SAP_OPERATION_FAILED` with `details.httpStatus` in `429, 502, 503, 504` is retryable in this slice; all other errors are non-retryable.

- [ ] **Step 1: Write parity, classification, and redaction tests**

Test these exact cases:

1. Success has schema version `1.0`, a non-empty request ID, `status: "succeeded"`, empty warnings, and text/structured deep equality.
2. A supplied `requestId` is retained.
3. `AUTH_REQUIRED` maps to authentication/non-retryable.
4. `SAP_AUTHORIZATION_DENIED` maps to authorization/non-retryable.
5. `SAP_CAPABILITY_UNAVAILABLE` maps to capability/non-retryable.
6. `SAP_OPERATION_FAILED` with `httpStatus: 503` maps to sap/retryable.
7. `Authorization: Bearer top-secret` and `{ access_token: "top-secret" }` never appear in serialized content.
8. Resource links follow, rather than replace, the parity text block.

Run: `npm run build && node --test dist/test/v1-result.test.js`

Expected: FAIL because the modules do not exist.

- [ ] **Step 2: Implement the common schemas and presenter**

Keep request-ID generation in the presenter with `node:crypto.randomUUID`. Do not add request IDs to `AbapToolService` or SAP adapter inputs.

Run: `npm run build && node --test dist/test/v1-result.test.js`

Expected: PASS with all eight cases.

- [ ] **Step 3: Clarify the protocol validation boundary in the design**

Add after the v1 error contract:

```text
Input rejected by the MCP SDK before a tool callback runs is reported through
the protocol's standard input-validation path. The v1 error envelope applies to
failures after a valid request enters the operation. This preserves strict,
machine-readable input schemas instead of advertising a permissive catch-all.
```

Run: `rg -n "protocol's standard input-validation path" docs/superpowers/specs/2026-07-20-sap-abap-mcp-v1-standardization-design.md`

Expected: one match.

- [ ] **Step 4: Commit**

```bash
git add src/mcp/v1/contracts.ts src/mcp/v1/result.ts test/v1-result.test.ts docs/superpowers/specs/2026-07-20-sap-abap-mcp-v1-standardization-design.md
git commit -m "feat: define MCP v1 result contracts"
```

---

## Task 4: Add Canonical SAP Resource Identities

**Files:**

- Create: `src/mcp/v1/resource-uri.ts`
- Create: `test/v1-resource-uri.test.ts`

**Interfaces:**

```ts
export interface ParsedAdtResourceUri {
  systemId: string       // normalized uppercase profile ID
  adtPath: string        // encoded absolute ADT path
  canonicalUri: string   // lowercase authority, no query/fragment
}

export function normalizeV1SystemId(value: string): string
export function toAdtResourceUri(systemId: string, adtPath: string): string
export function parseAdtResourceUri(value: string): ParsedAdtResourceUri
export function toCapabilityResourceUri(systemId: string): string
export function parseCapabilityResourceUri(value: string): {
  systemId: string
  canonicalUri: string
}
```

Rules implemented by these functions:

- Profile IDs are trimmed, uppercased, and must match `[A-Z0-9_-]+`.
- ADT paths begin with `/sap/bc/adt/`.
- Queries, fragments, usernames, passwords, and ports are rejected.
- A percent sign not followed by two hexadecimal digits is rejected.
- WHATWG `URL` canonicalization encodes spaces and preserves `%2F` as an encoded segment boundary.
- Builders serialize authorities in lowercase; parsers return uppercase `systemId`.
- Failures use `AppError("INVALID_ADT_URI", ...)`, except a supplied tool `systemId` that disagrees with a parsed authority, which callers report as `CONNECTION_MISMATCH`.

- [ ] **Step 1: Write canonicalization tests**

Cover all exact examples:

```ts
assert.equal(
  toAdtResourceUri(" dev100 ", "/sap/bc/adt/oo/classes/zcl_demo/source/main"),
  "adt://dev100/sap/bc/adt/oo/classes/zcl_demo/source/main"
)
assert.deepEqual(
  parseAdtResourceUri("adt://dev100/sap/bc/adt/oo/classes/%2Fns%2Fzcl_demo"),
  {
    systemId: "DEV100",
    adtPath: "/sap/bc/adt/oo/classes/%2Fns%2Fzcl_demo",
    canonicalUri: "adt://dev100/sap/bc/adt/oo/classes/%2Fns%2Fzcl_demo"
  }
)
assert.equal(toCapabilityResourceUri("DEV100"), "sap-capability://dev100")
```

Reject `/not/adt`, `adt://dev100/...?...`, `adt://dev100/...#...`, `%ZZ`, profile IDs containing `.`, and non-ADT schemes.

Run: `npm run build && node --test dist/test/v1-resource-uri.test.js`

Expected: FAIL because the module does not exist.

- [ ] **Step 2: Implement the URI functions**

Use `new URL(...)` only after the explicit malformed-percent check. Never call `decodeURIComponent` on the whole path.

Run: `npm run build && node --test dist/test/v1-resource-uri.test.js`

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/mcp/v1/resource-uri.ts test/v1-resource-uri.test.ts
git commit -m "feat: add canonical SAP resource identities"
```

---

## Task 5: Register `sap.system.list` and `sap.system.inspect`

**Files:**

- Create: `src/mcp/v1/service.ts`
- Create: `src/mcp/v1/system-tools.ts`
- Create: `src/mcp/v1/register.ts`
- Create: `test/v1-system-tools.test.ts`
- Modify: `src/index.ts:31-57,440-468`
- Modify: `src/mcp-server.ts`
- Modify: `test/integration.test.ts`

**Interfaces:**

```ts
// src/mcp/v1/service.ts
export type V1ReadService = Pick<AbapToolService,
  | "getConnectedSystems"
  | "getSapSystemInfo"
  | "getSapCapabilities"
  | "searchObjects"
  | "getObjectLines"
  | "getObjectByUri"
>
```

```ts
// src/mcp/v1/register.ts
export interface V1RegistrationOptions {
  enabledV0Tools?: ReadonlySet<string>
}

export function isV1ToolEnabled(
  v1ToolName: string,
  enabledV0Tools?: ReadonlySet<string>
): boolean

export function registerV1Tools(
  server: McpServer,
  service: V1ReadService,
  options?: V1RegistrationOptions
): void
```

`isV1ToolEnabled` returns `true` when no filter exists. With a filter, it finds
the catalog entry whose `targets` contains the exact v1 tool name and returns
whether the corresponding v0 key exists in `enabledV0Tools`. Resource URI
targets and wildcard roadmap targets never participate in tool filtering.

Extend the server options only when the first tools are ready:

```ts
export interface McpServerOptions {
  enabledTools?: ReadonlySet<string>
  apiVersion?: McpApiVersion
}
```

Use this exact annotation object for every first-slice tool:

```ts
export const V1_READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true
} satisfies ToolAnnotations
```

`sap.system.list` input is `{}`. Its `data` is:

```ts
z.object({
  systems: z.array(z.object({
    id: z.string().min(1),
    environment: z.enum(["development", "quality", "production"]),
    credentialAvailable: z.boolean()
  }))
})
```

`sap.system.inspect` input is:

```ts
{
  systemId: z.string().min(1),
  includeComponents: z.boolean().default(false)
}
```

Its `data` schema is exactly:

```ts
z.object({
  client: z.string(),
  language: z.string(),
  environment: z.enum(["development", "quality", "production"]),
  sapRelease: z.string(),
  systemType: z.enum(["S/4HANA", "ECC", "Unknown"]),
  logicalSystem: z.string(),
  clientName: z.string(),
  timezone: z.object({
    name: z.string(),
    description: z.string(),
    utcOffset: z.string()
  }).nullable(),
  softwareComponents: z.array(z.object({
    component: z.string(),
    release: z.string(),
    extRelease: z.string(),
    componentType: z.string()
  })).optional(),
  discoveryCollections: z.number().int().nonnegative(),
  queryTimestamp: z.string()
})
```

It excludes `profileId`, `url`, `username`, and the service's raw `warnings`.
Convert every service warning into `{ code: "SAP_SYSTEM_WARNING", message }`;
use `status: "partial"` when warnings are non-empty.

- [ ] **Step 1: Write API-mode and tool-discovery tests**

Add an integration helper that lists tool names for supplied
`McpServerOptions`. Before production wiring, assert these target outcomes:

```ts
assert.deepEqual(await toolNames(), [...IMPLEMENTED_TOOL_NAMES])
assert.deepEqual(await toolNames({ apiVersion: "v0" }), [...IMPLEMENTED_TOOL_NAMES])
assert.deepEqual(await toolNames({ apiVersion: "v1" }), [
  "sap.system.list",
  "sap.system.inspect"
])
assert.deepEqual(await toolNames({ apiVersion: "all" }), [
  ...IMPLEMENTED_TOOL_NAMES,
  "sap.system.list",
  "sap.system.inspect"
])
```

For `apiVersion: "v1"`, verify exact names, non-empty titles/descriptions,
annotations, input required fields, and that each advertises an `outputSchema`
requiring `schemaVersion`, `requestId`, `status`, `data`, and `warnings`.

Run: `npm run build && node --test dist/test/v1-system-tools.test.js`

Expected: FAIL because `McpServerOptions` has no API version and no v1 tools are registered.

- [ ] **Step 2: Write shared-service and result-shape tests**

Use a typed stub of `V1ReadService` with counters. Call the v1 tools through `Client` and `InMemoryTransport`, then assert:

```ts
assert.equal(calls.getConnectedSystems, 1)
assert.equal(calls.getSapSystemInfo, 1)
assert.deepEqual(call.structuredContent, JSON.parse(firstText(call)))
assert.equal(call.structuredContent.systemId, "DEV100")
assert.equal("profileId" in call.structuredContent.data, false)
assert.equal("url" in call.structuredContent.data, false)
assert.equal("username" in call.structuredContent.data, false)
```

Also invoke v0 `get_connected_systems` against the same stub and prove it increments the same `getConnectedSystems` method rather than a new adapter method.

Run: same focused command.

Expected: FAIL.

- [ ] **Step 3: Implement system registration and atomically wire the CLI mode**

Update the help line exactly:

```text
serve [--profile <id>] [--api-version v0|v1|all] [--toolsets core,write,analysis,debug,operations,artifacts|all]
```

In `serveCommand`, parse before allocating `ConnectionManager`:

```ts
const rawApiVersion = parsed.options.get("api-version")
if (rawApiVersion === true) {
  throw new AppError("OPTION_REQUIRED", "--api-version requires a value")
}
const apiVersion = parseMcpApiVersion(rawApiVersion)
```

Add CLI tests proving `runCli(["serve", "--api-version"])` fails with
`OPTION_REQUIRED` and `runCli(["serve", "--api-version", "v2"])` fails with
`INVALID_API_VERSION` before a connection manager or transport is started.

After resolving `enabledTools`, reject only the v1-only empty selection:

```ts
if (apiVersion === "v1" && enabledTools &&
  !V1_FIRST_SLICE_V0_TOOL_NAMES.some(name => enabledTools.has(name))) {
  throw new AppError(
    "V1_TOOLSET_EMPTY",
    "The selected toolsets contain no implemented v1 tools",
    { available: ["core", "all"] }
  )
}
```

Test `runCli(["serve", "--api-version", "v1", "--toolsets", "write"])`
fails with `V1_TOOLSET_EMPTY`. Do not apply this rejection to `apiVersion:
"all"`, where the v0 write tools remain usable.

Pass `{ apiVersion, ...(enabledTools ? { enabledTools } : {}) }` to
`createMcpServer`.

Inside `createMcpServer`:

```ts
const apiVersion = options.apiVersion ?? "v0"
const includeV0 = apiVersion === "v0" || apiVersion === "all"
```

Change the existing local v0 `registerTool` guard to:

```ts
if (!includeV0) return undefined
if (options.enabledTools && !options.enabledTools.has(name)) return undefined
```

Do not move or edit the 53 existing registrations. Select server instructions
by version so v1 never tells a model to call absent v0 names; preserve the
current instruction string byte-for-byte for v0.

At the end of `createMcpServer`, before `return server`, add:

```ts
if (apiVersion === "v1" || apiVersion === "all") {
  registerV1Tools(
    server,
    tools,
    options.enabledTools ? { enabledV0Tools: options.enabledTools } : {}
  )
}
```

`registerV1Tools` calls domain registrars only. It must not contain SAP logic.

Run: `npm run build && node --test dist/test/api-version.test.js dist/test/v1-system-tools.test.js`

Expected: PASS.

- [ ] **Step 4: Update API-version integration expectations**

The API-mode test written in this task now expects:

- default/v0: the exact 53 committed v0 names;
- v1: `sap.system.list`, `sap.system.inspect` at this checkpoint;
- all: all 53 v0 names plus those two v1 names;
- v1 with `enabledTools: toolsForToolsets(["core"])`: both system tools.

Run: `npm run build && node --test --test-name-pattern="API version" dist/test/integration.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/index.ts src/mcp-server.ts src/mcp/v1/service.ts src/mcp/v1/system-tools.ts src/mcp/v1/register.ts test/v1-system-tools.test.ts test/integration.test.ts
git commit -m "feat: add v1 SAP system read tools"
```

---

## Task 6: Add `sap.system.capabilities` and Its Resource Template

**Files:**

- Modify: `src/mcp/v1/system-tools.ts`
- Modify: `src/mcp/v1/register.ts`
- Create: `src/mcp/v1/resources.ts`
- Create: `test/v1-capabilities.test.ts`
- Modify: `test/integration.test.ts`

**Tool contract:**

```ts
const inputSchema = {
  systemId: z.string().min(1),
  category: z.enum([
    "connection", "repository", "execution", "semantic",
    "quality", "debugging", "insight"
  ]).optional(),
  includeEvidence: z.boolean().default(false)
}
```

The output `data` schema is exactly:

```ts
z.object({
  adapterVersion: z.string(),
  resourceUri: z.string(),
  systemMetadata: z.object({
    environment: z.enum(["development", "quality", "production"]),
    sapRelease: z.string(),
    systemType: z.enum(["S/4HANA", "ECC", "Unknown"]),
    logicalSystem: z.string(),
    discoveryCollections: z.number().int().nonnegative()
  }),
  capabilities: z.array(z.object({
    id: z.string(),
    category: z.enum([
      "connection", "repository", "execution", "semantic",
      "quality", "debugging", "insight"
    ]),
    implementation: z.enum(["implemented", "missing"]),
    system: z.enum(["advertised", "not_advertised", "unknown"]),
    authorization: z.enum(["allowed", "denied", "unknown"]),
    status: z.enum(["supported", "unsupported", "unverified"]),
    evidence: z.array(z.string()).optional(),
    lastObservedAt: z.string().nullable()
  }))
})
```

`resourceUri` equals `sap-capability://<lowercase-system>`.

Move service `systemMetadata.warnings` to the common warnings array with code `SAP_SYSTEM_WARNING`. Do not repeat `connectionId` inside `data` because the common envelope has normalized `systemId`.

Register this template only for v1/all:

```ts
new ResourceTemplate("sap-capability://{system}", { list: undefined })
```

The Resource callback parses the URI, calls `getSapCapabilities(systemId, undefined, true)`, and returns one `application/json` text content whose `uri` is canonical and whose JSON includes the complete evidence-bearing service result after removing duplicate `connectionId`.

- [ ] **Step 1: Write discovery, call, and Resource tests**

Assert:

1. v1 now advertises three tools.
2. The capability tool has exact annotations and output schema.
3. `includeEvidence: false` omits evidence on each capability.
4. `includeEvidence: true` retains bounded evidence.
5. The text and structured envelope match.
6. Content includes one native `resource_link` with `sap-capability://dev100`.
7. `listResourceTemplates()` contains `sap-capability://{system}`.
8. `readResource({ uri: "sap-capability://dev100" })` calls the same service method with evidence enabled.

Run: `npm run build && node --test dist/test/v1-capabilities.test.js`

Expected: FAIL because the tool and Resource template are absent.

- [ ] **Step 2: Implement the tool and Resource registrar**

`registerV1Resources` is called exactly once by `registerV1Tools`; it does not register in v0 mode because the v1 registrar itself is not called.

Run: same focused command.

Expected: PASS.

- [ ] **Step 3: Update the version-mode expectation to three v1 tools**

Run: `npm run build && node --test --test-name-pattern="API version" dist/test/integration.test.js`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/mcp/v1/system-tools.ts src/mcp/v1/register.ts src/mcp/v1/resources.ts test/v1-capabilities.test.ts test/integration.test.ts
git commit -m "feat: add v1 SAP capability discovery"
```

---

## Task 7: Add `sap.repository.search`

**Files:**

- Create: `src/abap-object-types.ts`
- Create: `src/mcp/v1/repository-tools.ts`
- Modify: `src/mcp/v1/register.ts`
- Modify: `src/mcp-server.ts:22-67`
- Create: `test/v1-repository-search.test.ts`
- Modify: `test/integration.test.ts`

**Tool contract:**

First move the existing `ABAP_OBJECT_TYPES` tuple byte-for-byte from
`src/mcp-server.ts` to `src/abap-object-types.ts`. Import it from both v0 and v1
presenters, and re-export it from `src/mcp-server.ts` so the current module's
export surface remains compatible. This prevents a circular dependency from a
v1 registrar back into its owning server module.

```ts
const inputSchema = {
  systemId: z.string().min(1),
  pattern: z.string().min(1),
  objectTypes: z.array(z.enum(ABAP_OBJECT_TYPES)).min(1),
  limit: z.number().int().min(1).max(500).default(20)
}
```

Call the shared service exactly once:

```ts
service.searchObjects({
  connectionId: normalizeV1SystemId(systemId),
  pattern,
  types: objectTypes,
  maxResults: limit
})
```

The output `data` is:

```ts
z.object({
  pattern: z.string(),
  objects: z.array(z.object({
    name: z.string(),
    type: z.string(),
    description: z.string().optional(),
    packageName: z.string().optional(),
    resourceUri: z.string()
  }))
})
```

Convert each raw ADT `uri` to `resourceUri` with `toAdtResourceUri`; do not expose raw `uri` or repeat `connectionId`. Set common `page.returned` to the object count. Do not claim a `total` or `nextCursor`, because the current ADT search result does not provide either.

- [ ] **Step 1: Write schema and execution tests**

Assert:

- advertised input property names are exactly `systemId`, `pattern`, `objectTypes`, `limit`;
- the service receives `connectionId`, `types`, and `maxResults` in the existing shape;
- one service call produces one SAP search path;
- every output object has canonical `resourceUri` and no raw `uri`;
- `page` equals `{ returned: objects.length }`;
- text and structured output match;
- `apiVersion: "v1"` now advertises four exact tools.

Run: `npm run build && node --test dist/test/v0-contract.test.js dist/test/v1-repository-search.test.js`

Expected: FAIL.

- [ ] **Step 2: Implement and register the repository tool**

Keep presenter mapping in `repository-tools.ts`; do not change
`AbapToolService.searchObjects`, because v0 depends on its current output. The
v0 snapshot must prove that extracting the object-type tuple changed no schema.

Run: same focused command.

Expected: PASS.

- [ ] **Step 3: Update and run the API-version integration test**

Run: `npm run build && node --test --test-name-pattern="API version" dist/test/integration.test.js`

Expected: PASS with four v1 names and 57 names in `all` mode.

- [ ] **Step 4: Commit**

```bash
git add src/abap-object-types.ts src/mcp-server.ts src/mcp/v1/repository-tools.ts src/mcp/v1/register.ts test/v1-repository-search.test.ts test/integration.test.ts
git commit -m "feat: add v1 ABAP repository search"
```

---

## Task 8: Add `sap.source.read` and the ADT Source Resource

**Files:**

- Create: `src/mcp/v1/source-tools.ts`
- Modify: `src/mcp/v1/register.ts`
- Modify: `src/mcp/v1/resources.ts`
- Create: `test/v1-source-read.test.ts`
- Modify: `test/integration.test.ts`

**Tool contract:**

```ts
const inputSchema = {
  systemId: z.string().min(1),
  objectName: z.string().min(1),
  objectType: z.enum(ABAP_OBJECT_TYPES).optional(),
  methodName: z.string().min(1).optional(),
  startLine: z.number().int().min(1).default(1),
  lineCount: z.number().int().min(1).max(5000).default(50)
}
```

Call `service.getObjectLines` with the existing v0 argument shape. The output `data` contains:

```ts
z.object({
  object: z.object({ name: z.string(), type: z.string() }),
  resourceUri: z.string(),
  methodName: z.string().optional(),
  startLine: z.number().int().positive(),
  endLine: z.number().int().nonnegative(),
  methodEndLine: z.number().int().positive().optional(),
  totalLines: z.number().int().nonnegative().optional(),
  truncated: z.boolean(),
  nextLine: z.number().int().positive().nullable(),
  code: z.string()
})
```

Map service `sourceUri` to canonical `resourceUri` and omit the raw `sourceUri` and repeated `connectionId`. Include one native `resource_link` for the same URI after the parity text block.

Register the source template:

```ts
new ResourceTemplate("adt://{system}/{+adtPath}", { list: undefined })
```

The callback:

1. parses and canonicalizes the Resource URI;
2. calls `service.getObjectByUri({ connectionId: systemId, uri: adtPath, startLine: 0, lineCount: Number.MAX_SAFE_INTEGER })` exactly once;
3. returns one `text/x-abap` content with raw ABAP source in `text`;
4. includes bounded `_meta` values `startLine`, `endLine`, `totalLines`, `truncated`, and `nextLine`;
5. returns the canonical URI in the Resource content.

Do not add query or fragment pagination to the Resource URI. The Tool remains the bounded, model-controlled range reader.

- [ ] **Step 1: Write tool tests**

Test a full object read and a method read. Assert exact service arguments, canonical link, absence of `sourceUri`, text/structured parity, output-schema presence, and no extra SAP call. Assert v1 tool discovery equals `V1_FIRST_SLICE_TOOL_NAMES` and `all` contains exactly 58 unique tools.

Run: `npm run build && node --test dist/test/v1-source-read.test.js`

Expected: FAIL.

- [ ] **Step 2: Write Resource-template tests**

Assert:

```ts
const templates = await client.listResourceTemplates()
assert.deepEqual(
  templates.resourceTemplates.map(template => template.uriTemplate).sort(),
  ["adt://{system}/{+adtPath}", "sap-capability://{system}"]
)
```

Read `adt://dev100/sap/bc/adt/oo/classes/zcl_demo/source/main` and verify one `getObjectByUri` invocation with uppercase `DEV100`, unchanged encoded ADT path, `startLine: 0`, and `lineCount: Number.MAX_SAFE_INTEGER`.

Run: same focused command.

Expected: FAIL.

- [ ] **Step 3: Implement the tool and source Resource**

Keep Resource errors on the MCP Resource error path; tool result envelopes are not Resource response bodies.

Run: `npm run build && node --test dist/test/v1-source-read.test.js`

Expected: PASS.

- [ ] **Step 4: Run all first-slice contract tests together**

```bash
npm run build && node --test \
  dist/test/v1-result.test.js \
  dist/test/v1-resource-uri.test.js \
  dist/test/v1-system-tools.test.js \
  dist/test/v1-capabilities.test.js \
  dist/test/v1-repository-search.test.js \
  dist/test/v1-source-read.test.js
```

Expected: all pass; v1 advertises exactly five tools and two Resource templates.

- [ ] **Step 5: Commit**

```bash
git add src/mcp/v1/source-tools.ts src/mcp/v1/register.ts src/mcp/v1/resources.ts test/v1-source-read.test.ts test/integration.test.ts
git commit -m "feat: add v1 ABAP source reads"
```

---

## Task 9: Add Schema-Cost Evidence and Migration Documentation

**Files:**

- Modify: `scripts/benchmark-mcp-surface.mjs`
- Create: `scripts/smoke-v1-stdio.mjs`
- Modify: `package.json`
- Modify: `README.md`
- Create: `docs/v1-migration.md`
- Create: `test/v1-documentation.test.ts`

**Benchmark contract:**

Preserve the current top-level `toolsets` array as v0 measurements so existing consumers do not break. Add a `versionedSurfaces` array with this exact shape:

```ts
Array<{
  apiVersion: "v1" | "all"
  toolset: "all"
  toolCount: number
  schemaBytes: number
  largestTools: Array<{ name: string; bytes: number }>
}>
```

Populate it by calling `measure("all", "v1")` followed by
`measure("all", "all")`. `measure(toolset, apiVersion)` passes both
`enabledTools: toolsForToolsets([toolset])` and `apiVersion` to
`createMcpServer`. Keep `liveSapCalls: 0` and use a service double that throws if
any SAP client is requested.

`docs/v1-migration.md` must state:

- unversioned `serve` remains v0 through 1.x;
- the exact v0/v1/all commands and their intent;
- the five implemented mappings;
- v1 is an opt-in first slice, not full v0 replacement yet;
- existing MCPB/plugin/`@latest serve` commands stay v0;
- `all` duplicates capabilities and is only for comparison;
- no write or execute v1 tool is part of this slice.

README adds one short “v1 opt-in preview” subsection linking to the migration document. Do not change the Quick Start's existing default command.

The stdio smoke script uses the real built CLI and SDK
`StdioClientTransport`. It creates a temporary config directory and supplies it
as `SAP_ABAP_MCP_HOME`, starts:

```text
node dist/src/index.js serve --api-version v1
```

It asserts the exact five tool names, calls `sap.system.list`, verifies an empty
`data.systems` array, closes the client, and removes only the temporary
directory it created. It must never read the developer's real profiles or make
a SAP request. Add:

```json
"smoke:v1": "npm run build && node scripts/smoke-v1-stdio.mjs"
```

- [ ] **Step 1: Write documentation guard tests**

Assert the migration document contains the unversioned 1.x guarantee, all three commands, all five tool names, and the “read-only” limitation. Assert the current plugin `.mcp.json`, MCPB manifest, and `server.json` launch arguments still do not include `--api-version v1`.

Run: `npm run build && node --test dist/test/v1-documentation.test.js`

Expected: FAIL because the migration document does not exist.

- [ ] **Step 2: Update docs without changing launch defaults**

Run: same focused command.

Expected: PASS.

- [ ] **Step 3: Extend and run the schema benchmark**

Run: `npm run build && npm run benchmark:surface`

Expected:

- existing v0 `toolsets` measurements remain present;
- v1/all reports exactly 5 tools;
- all/all reports exactly 58 tools;
- the script exits 0 without requesting a SAP client.

- [ ] **Step 4: Add explicit schema budget assertions**

In `test/v1-documentation.test.ts`, run the same in-memory measurement logic without spawning the CLI and assert:

```ts
assert.ok(v1SchemaBytes < 24 * 1024)
assert.equal(v1ToolCount, 5)
assert.equal(allToolCount, 58)
```

Do not raise or remove the existing v0 64 KiB guardrail.

Run: `npm run build && node --test dist/test/v1-documentation.test.js`

Expected: PASS.

- [ ] **Step 5: Run the real stdio transport smoke test**

Run: `npm run smoke:v1`

Expected: exits 0 after discovering five v1 tools and calling
`sap.system.list` against an isolated empty profile store.

- [ ] **Step 6: Commit**

```bash
git add package.json README.md docs/v1-migration.md scripts/benchmark-mcp-surface.mjs scripts/smoke-v1-stdio.mjs test/v1-documentation.test.ts
git commit -m "docs: document the opt-in MCP v1 slice"
```

---

## Task 10: Complete Regression and Contract Verification

**Files:**

- Modify only if a test exposes a defect directly caused by Tasks 1-9.

- [ ] **Step 1: Verify the v0 snapshot is byte-for-byte unchanged**

Run: `git diff --exit-code HEAD~8 -- test/fixtures/v0-tool-surface.json`

Expected: exit 0. If the task commit count differs, compare the fixture against the Task 1 commit instead; do not regenerate it to hide a difference.

- [ ] **Step 2: Run the full repository check**

Run: `npm run check`

Expected: build succeeds and all existing plus new Node tests pass.

- [ ] **Step 3: Run package and dependency checks**

```bash
npm pack --dry-run
npm audit --omit=dev
```

Expected: both exit 0; the dry-run contains `dist/src/mcp/v1/*` through the existing `dist/src` package rule and contains no credentials or generated local benchmark output.

- [ ] **Step 4: Run contract counts and default-safety checks**

```bash
npm run build
node --test dist/test/v0-contract.test.js dist/test/v1-migration-catalog.test.js dist/test/v1-documentation.test.js
```

Expected:

- v0 snapshot: 53 tools;
- migration catalog: 53 mapped/dispositioned v0 tools;
- v1: 5 tools and 2 Resource templates;
- all: 58 unique tools;
- the JSON-parsing assertions in `v1-documentation.test.ts` prove existing
  launch entries still end at unversioned `serve`.

- [ ] **Step 5: Inspect the diff for scope**

Run: `git diff --stat 78b152d..HEAD && git status --short`

Expected: only the files named in this plan changed; worktree clean after committed tasks. No package version, registry metadata, MCPB command, plugin command, write policy, or SAP adapter file changed.

- [ ] **Step 6: Record the verified outcome**

Append the actual test count and measured schema bytes to the implementation PR description or handoff, not to hard-coded product documentation. If any v0 fixture differs, stop and treat it as a compatibility defect rather than approving the slice.

# Complete v1 Functional Parity and Surface Budget Design

Date: 2026-07-21
Status: Approved
Supersedes: the partial-release and `v0_only` allowances in
`2026-07-20-sap-abap-mcp-v1-standardization-design.md`

## Objective

Complete the SAP ABAP MCP v1 contract before presenting it as a release-ready
surface or running the final B4D acceptance campaign. v1 must preserve the
functional coverage of all 53 v0 tools and all 150 audited response/action
variants while replacing their public API contract with atomic, domain-first
tools, typed results, canonical Resources, explicit policy, and deterministic
conformance evidence.

This is functional parity, not a 1:1 tool-name migration. v0 remains unchanged
for compatibility. v1 and v0 call the same application services so the new
contract does not create a second SAP implementation.

## Approved Decisions

- Preserve the complete v0 tool names, schemas, default `serve` behavior,
  response shapes, policy semantics, and service invocation counts.
- Replace the public API contract only in `--api-version v1`.
- Migrate all 53 v0 tools and 150 audited variants before calling v1 complete.
- Split grouped v0 actions when risk, authorization, confirmation, result,
  retry, or idempotency semantics differ.
- Use the atomic mapping in `V1_MIGRATION_CATALOG`; resolve its remaining
  wildcard and `v0_only` entries before the parity gate.
- Make the complete v1 catalog available through `--toolsets all`, but do not
  preload the full catalog in the default LLM session.
- Make `core` the default toolset for explicit v1 mode. Keep unversioned and
  explicit v0 startup behavior unchanged.
- Keep `--api-version all` as an explicit migration/conformance mode, never as
  the recommended daily configuration.
- Do not depend on subagents, dynamic tool-list handling, experimental MCP
  Tasks, or a particular host's tool-search implementation for correctness.
- Use a deterministic MCP conformance runner for exhaustive coverage. Use LLM
  sessions only for host workflow and tool-selection tests.
- Run the final live campaign against profile `B4D` only after complete parity.
  Mutations are restricted to run-owned `$TMP` fixtures and must be cleaned up.

## Alternatives Considered

### 1. Copy the 53 v0 tools into v1

This is the fastest implementation, but it preserves mixed read/write actions,
large action unions, inaccurate annotations, and inconsistent result shapes.
It does not produce a stable standard and is rejected.

### 2. Expose 30-50 grouped domain tools

This reduces the visible tool count, but combines operations with different
outputs and safety semantics. It recreates the ambiguity that v1 is intended
to remove and is rejected as the primary contract.

### 3. Atomic v1 tools with bounded toolsets

This produces the clearest schemas and safest annotations. Schema cost is
controlled with static startup toolsets, concise contracts, Resources, and
budget tests. This is the approved approach.

## Compatibility Boundary

The request paths remain separate presenters over one implementation:

```text
v0 MCP presenter ─┐
                  ├─> policy/application service ─> ADT adapter ─> SAP
v1 MCP presenter ─┘
```

The following are release-blocking compatibility invariants:

1. Unversioned `serve` advertises the same 53 v0 tools in the same order.
2. `serve --api-version v0` is identical to unversioned `serve`.
3. All committed v0 input-schema snapshots remain unchanged.
4. All 150 v0 fixture variants retain their reviewed output behavior.
5. Existing v0 profile and safety-policy semantics are not reinterpreted.
6. A corresponding v0 and v1 operation invokes the same application-service
   method once and does not add a hidden SAP call.
7. v1 files do not import v0 MCP presenter callbacks. Both presenters depend
   on application-service interfaces.

If any invariant fails, the v1 slice cannot merge.

## Complete Parity Inventory

The committed baseline contains 53 v0 tools and 150 audited variants. The
current migration catalog contains 103 non-Resource target references and 101
unique v1 tool names; two pairs intentionally consolidate into shared tools:

- `get_abap_object_lines` and `get_object_by_uri` -> `sap.source.read`
- `get_abap_object_workspace_uri` and `open_object` ->
  `sap.repository.resolve`

The `sap.ops.watch.*` wildcard is not a valid final contract. It is replaced by
these 12 exact tool names:

```text
sap.ops.watch.status
sap.ops.watch.start
sap.ops.watch.stop
sap.ops.watch.trigger
sap.ops.watch.history
sap.ops.watch.task.add
sap.ops.watch.task.remove
sap.ops.watch.task.update
sap.ops.watch.task.enable
sap.ops.watch.task.disable
sap.ops.watch.task.list
sap.ops.watch.watchlist.read
```

After that expansion, the approved catalog contains 115 tool target references
and 113 unique v1 tool names. `sap.quality.atc.cached` becomes a supported
read-only v1 tool instead of remaining `v0_only`. No catalog entry may retain a
`planned`, `v0_only`, or wildcard disposition at the complete-parity gate.
The catalog type adds an `implemented` disposition; completed Tool entries use
`implemented`, while non-Tool entries retain only the exact `resource`,
`extension`, or `compatibility` disposition that supplies their parity path.

`read_deferred_result` does not require a v1 tool with the same shape. Its
functional requirement is satisfied by bounded cursor pages and Resource Links
to server-owned evidence artifacts. Static documentation tools likewise become
Resources when no model-controlled operation is required. A mapping is complete
only when the v0 variant's useful result and follow-up path remain available.

## Tool Design Contract

Every v1 tool:

- uses a lowercase `sap.<domain>.<operation>` name;
- owns one atomic operation or variants with identical policy and result
  semantics;
- has a strict input schema and operation-specific output schema;
- returns the v1 success envelope in both `structuredContent` and the first JSON
  text block;
- returns the canonical v1 tool-error envelope after valid input reaches the
  operation;
- publishes accurate `readOnlyHint`, `destructiveHint`, `idempotentHint`, and
  `openWorldHint` annotations;
- uses `systemId` for a configured SAP profile and canonical Resource URIs for
  SAP identities;
- returns bounded collections and never embeds an unbounded secondary result;
- calls a shared application service instead of reproducing v0 callback logic.

Input rejected by the MCP SDK remains a protocol validation error. A valid call
that fails inside the operation returns `isError: true` with the v1 error
contract. Write, execute, delete, transport release, Git mutation, and remote
publication tools use explicit policy and state-bound confirmation contracts.

## Resource Contract

The complete v1 surface uses these Resource identity families:

```text
adt://<system>/<canonical-adt-path>
sap-capability://<system>
sap-transport://<system>/<transport>
sap-evidence://<run-id>/<artifact>
sap-docs://data-query
sap-docs://compat/<document>
sap-docs://mermaid/<document>
```

Authorities are canonical lowercase profile IDs. SAP object paths come from
validated ADT responses. Transport IDs are uppercase path values. Evidence run
and artifact segments are URL-safe opaque identifiers. Credentials, userinfo,
ports, queries, fragments, malformed percent escapes, and raw control
characters are rejected where the scheme does not explicitly allow them.

Large source, trace, dump, ATC, Unit, discovery, comparison, transport, and
artifact results return bounded structured summaries and Resource Links.
`sap-evidence` artifacts are session-owned, redacted, size-bounded, and
time-limited. Cursor pagination is used for collections. v1 does not expose the
v0 deferred-result tool.

Resource registration follows toolset ownership without depending on dynamic
list changes:

- `adt` and `sap-capability` are registered with `core`;
- `sap-transport` is registered with `analysis` or `write`;
- `sap-docs://data-query` is registered with `analysis`;
- `sap-docs://compat/*` and `sap-docs://mermaid/*` are registered with
  `artifacts`;
- `sap-evidence` is registered in every v1 mode because any enabled tool can
  return a bounded evidence artifact.

Resource Template discovery performs no SAP call. A Resource read performs only
the operation required by that Resource and applies the same profile and policy
checks as its corresponding Tool.

## Toolset and Token Budget

All 113 tool names belong to exactly one primary toolset. A tool can depend on a
Resource without duplicating the Resource as another tool.

- `core`: system, repository, source read/search, semantic read, and resolution
- `write`: repository/source mutation, refactor execution, text writes, test
  include creation, transport mutation, Git mutation, RAP mutation, restore,
  and ABAP execution
- `analysis`: dependency/comparison, quality, version reads, transport reads
  and assessment, and bounded data query
- `debug`: debugger status, session, breakpoint, stepping, stack, variables,
  and evaluation
- `operations`: runtime dump/trace, watch operations, discovery, transaction UI,
  and execution health/preview
- `artifacts`: source/data export, Mermaid, test documents, and documentation
  Resources

Startup behavior is exact:

```text
serve                         -> v0 all, unchanged
serve --api-version v0        -> v0 all, unchanged
serve --api-version v1        -> v1 core
serve --api-version v1 --toolsets <set[,set]> -> selected v1 sets
serve --api-version v1 --toolsets all         -> complete v1 catalog
serve --api-version all       -> v0 all + v1 all for migration conformance
```

Static startup filtering is the reference behavior because every host supports
initial `tools/list`. Tool-list change notifications and pagination may improve
individual hosts but are not required for completeness or token control.

CI measures the minified UTF-8 `tools/list` payload with zero SAP calls. It
records byte size, tool count, ten largest schemas, and the advisory
`ceil(bytes / 4)` token proxy. The hard budgets are:

- default v1 `core`: at most 24 tools and 32 KiB;
- each individual non-`all` toolset: at most 32 tools and 64 KiB;
- complete v1 `all`: at most 384 KiB;
- one tool definition: at most 8 KiB unless an approved schema-budget exception
  names the exact tool and measured reason.

The benchmark fails CI when a hard budget regresses. Host acceptance records
actual prompt-token deltas when the host exposes them, but correctness never
depends on host telemetry.

## Subagent and Host Strategy

The MCP server does not create or manage subagents. Subagent orchestration is a
host concern and is not part of the v1 standard.

Giving every subagent the complete catalog can multiply schema cost. Host
guidance therefore recommends separate MCP registrations or sessions with the
narrowest applicable toolset:

- general ABAP review: `core`;
- quality review: `core,analysis`;
- controlled change: `core,write`;
- debugger workflow: `core,debug`;
- operational diagnosis: `core,operations`;
- artifact generation: `core,artifacts`.

Subagents may improve workflow parallelism, but no feature, test, cleanup, or
safety guarantee relies on their existence. A host that supports only one agent
must still be able to use every v1 feature by selecting the required toolset.

## Deterministic Conformance

Exhaustive acceptance is not delegated to one LLM prompt containing 113
schemas. A raw MCP conformance runner performs the complete inventory and emits
JSON, JUnit, and SARIF artifacts.

The runner:

1. walks paginated `tools/list` and Resource Template discovery;
2. compares names, schemas, annotations, toolsets, and Resources to committed
   contracts;
3. verifies success text/structured parity and unique request IDs;
4. verifies tool-level and protocol-level error contracts;
5. checks v0/v1 shared-service call counts with deterministic doubles;
6. executes every safe fixture variant and records explicit prerequisites for
   live-only variants;
7. validates redaction and rejects evidence containing configured secret
   canaries;
8. records cleanup ownership and outcome for every mutation fixture;
9. emits a 53-tool/150-variant parity ledger and a 113-tool v1 ledger;
10. fails when an entry is missing, guessed, silently skipped, or reported as
    supported without evidence.

LLM host tests are separate. They verify discovery, correct tool selection,
multi-step workflow quality, confirmation handling, and Resource use in Codex,
Claude Code, VS Code, and MCP Inspector. Each host test uses a bounded toolset,
not the complete catalog.

## Live B4D Acceptance

The final live campaign begins only after deterministic complete parity passes.
It has two gates:

### Read-only gate

- restrict the server to profile `B4D`;
- test every read, analysis, status, preview, and Resource path supported by the
  B4D release and authorizations;
- distinguish unsupported, unauthorized, unavailable fixture, and contract
  failure;
- emit sanitized evidence without source, credentials, hosts, users, tokens, or
  business data.

### Mutation gate

- require an explicit start approval for the run;
- create only uniquely named run-owned fixtures in package `$TMP`;
- record every created object and state handle in an ownership manifest after
  immediate read-back verification;
- never modify or delete an object discovered by search or created before the
  current run;
- prohibit transport release/deletion and remote Git mutation unless a separate
  authorized fixture is supplied;
- clean up only manifest-owned state and fail the run if cleanup cannot be
  proven;
- leave pre-existing debugger, trace, watch, repository, package, transport,
  and local filesystem state untouched.

The existing five-tool prompt remains a first-slice diagnostic only. It is not
the final v1 acceptance prompt. Final prompts and the live runner are generated
from the completed parity catalog so counts and names cannot drift manually.

## Delivery Decomposition

The work is delivered as independently reviewable slices. Automated tests run
after every slice; the public complete-v1 claim waits for all slices.

1. **Compatibility and exposure foundation**: freeze v0 contracts, enumerate
   the 113-name catalog, assign primary toolsets, and add schema budgets.
2. **Core read parity**: finish repository, source, resolution, semantic, text
   read, and documentation Resources.
3. **Analysis parity**: migrate dependency, comparison, quality, version,
   transport read/assessment, and bounded data-query operations.
4. **Policy and mutation parity**: add explicit v1 profile policy, repository
   and source writes, activation, refactor execution, transport mutation, Git,
   RAP, restore, and ABAP execution.
5. **Debug and operations parity**: migrate debugger, dumps, traces, all 12
   watch operations, discovery, transactions, and execution probes.
6. **Artifact and Resource parity**: migrate exports, Mermaid and test-document
   artifacts, transport/evidence Resources, progress, cancellation, and large
   result links.
7. **Conformance and live evidence**: complete the deterministic runner, host
   matrix, B4D read-only gate, B4D `$TMP` mutation gate, and generated reports.
8. **Release readiness**: remove preview labeling only after all gates pass and
   publish the full migration and toolset guidance.

Each slice gets a focused implementation plan and test-first review. Slices may
share application-service extraction, but no slice may refactor unrelated v0
presenter behavior.

## Complete-v1 Release Gates

v1 is complete only when all gates pass:

1. All existing v0 automated tests pass without changed compatibility
   expectations.
2. The v0 surface remains exactly 53 tools and the response audit remains 150
   variants.
3. Every audited variant maps to a tested v1 tool, Resource, or documented
   compatibility mechanism with no functional loss.
4. The final catalog contains exactly 113 unique tool names, no wildcard target,
   and no `planned`, `v0_only`, or `first_slice` disposition. Implemented Tool
   entries use `implemented`; other entries use only `resource`, `extension`,
   or `compatibility` with a tested parity path.
5. Every v1 tool validates input, output, annotations, canonical success, and
   canonical failure behavior.
6. All v0/v1 parity pairs share one application-service invocation.
7. Default and per-toolset schema budgets pass.
8. Deterministic conformance emits valid JSON, JUnit, and SARIF with zero
   redaction violations.
9. B4D read-only evidence passes for supported capabilities.
10. B4D mutation evidence proves run ownership and complete cleanup.
11. Host tests pass with bounded toolsets; no host is required to preload all
    113 tools or create subagents.
12. Documentation consistently distinguishes v0 compatibility, complete v1,
    and `all` migration mode.

## Rollout

Until every release gate passes, v1 remains an internal preview and is not the
recommended production surface. Unversioned `serve` remains v0. A complete v1
release remains explicit through `--api-version v1`; changing the unversioned
default is a later breaking-release decision with a separate deprecation and
migration window.

No npm release, MCPB update, plugin default change, or final live-test claim is
made from a partial slice. Existing users can continue using v0 throughout the
implementation without opting into v1.

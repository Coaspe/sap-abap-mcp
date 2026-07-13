# ABAP FS Development Parity Foundation Design

Date: 2026-07-14

## Objective

Make ABAP FS full-extension development capabilities usable from Claude and Codex through a headless MCP server. The target is capability equivalence, not a copy of VS Code UI elements. Editor-only features must become structured MCP results, guarded operations, resources, or artifacts.

This specification covers the first independently verifiable delivery:

1. an explicit per-connection SAP capability catalog;
2. BDEF creation parity;
3. batch activation;
4. ABAP class execution and ABAP FS-compatible REPL execution;
5. richer semantic inspection.

Later parity work remains visible in the catalog but is not implemented by this delivery.

## Approved Principles

- Use feature-sliced delivery rather than porting the entire extension in one change.
- Preserve the current MCP interface unless this specification explicitly extends it.
- Do not expose a generic raw ADT request tool.
- Do not guess alternate endpoints or parameter combinations after a failure.
- Separate locally verified behavior from facts that require a live SAP system.
- A feature without live evidence is reported as `unverified`, not advertised as supported.
- Production profiles reject source mutations and arbitrary ABAP execution.
- Existing package allowlists, transport requirements, output limits, and secret redaction remain in force.

## Source-Audit Corrections

Two earlier design labels are replaced with the exact ABAP FS behavior:

- ABAP FS provides class execution through `abap-adt-api`'s `runClass`. Its ABAP REPL is not the SAP report/program console. It calls a separately installed custom service at `/sap/bc/z_abap_repl`. This delivery implements class execution and that exact REPL contract. Generic report execution is outside this delivery and remains unverified until an official endpoint contract is added.
- Signature detail is obtained through `codeCompletionElement`; there is no separate signature-help client method in `abap-adt-api` 8.4.1. The MCP action is therefore named `completion_element` and returns normalized signature/detail data when SAP provides it.

## Architecture

The request path is fixed:

```text
MCP input schema
  -> ToolService validation, safety, and capability gate
  -> explicit SapClient method
  -> abap-adt-api or one audited ABAP FS-compatible REPL route
  -> normalized, bounded MCP result
```

The implementation extends the existing `SapClient`, `ToolService`, and MCP registration layers. It does not reorganize unrelated code in `mcp-server.ts` or `tool-service.ts`. Capability definitions and observations live in a small dedicated module because every future parity slice will use them.

No operation may reach `ADTClient.httpClient` except the audited REPL adapter for the fixed `/sap/bc/z_abap_repl` contract. All other operations use public `abap-adt-api` methods.

## Capability Catalog

### MCP surface

Add `get_sap_capabilities` to the `core` toolset.

Input:

```text
connectionId: non-empty string
category?: connection | repository | execution | semantic | quality | debugging | insight
includeEvidence: boolean, default true
```

Output:

```text
connectionId
generatedAt
adapterVersion
systemMetadata
capabilities[]
```

Each capability contains:

```text
id: stable dotted identifier
category
implementation: implemented | missing
system: advertised | not_advertised | unknown
authorization: allowed | denied | unknown
status: supported | unsupported | unverified
evidence[]
lastObservedAt: ISO timestamp | null
```

### Status rules

- `unsupported` when the adapter is missing or SAP conclusively omits the required service.
- `supported` only when the adapter exists and a safe probe or real operation has succeeded for the selected connection.
- `unverified` when the adapter exists but discovery, authorization, or a live response is inconclusive.
- HTTP 401 or 403 records `authorization: denied` for that connection and capability.
- A successful call records `authorization: allowed` and `lastObservedAt` in process memory.
- Observations are keyed by connection ID and are not persisted across MCP process restarts.
- Discovery and health checks are read-only. The server never performs a mutation solely to prove a capability.
- `unsupported` operations are rejected before the SAP call. `unverified` operations may run, but their response includes the status at execution.

Initial implemented IDs:

```text
repository.create.bdef
repository.activate.batch
execution.class_runner
execution.abap_repl
semantic.completion_element
semantic.documentation
semantic.type_hierarchy
semantic.components
```

The catalog also declares the later parity backlog as `implementation: missing`, including enterprise/cloud authentication, ABAP Cleaner, ATC exemptions, coverage, trace configuration, watchpoints, message and exception breakpoints, debug recording/replay, blame, S/4HANA readiness, ADT communication logs, and feeds. Declaring an item does not claim support.

## BDEF Creation

### Type registration

Register the ABAP FS BDEF descriptor idempotently before object validation:

```text
typeId: BDEF/BDO
creationPath: bo/behaviordefinitions
validationPath: bo/behaviordefinitions/validation
rootName: blue:blueSource
namespace: xmlns:blue="http://www.sap.com/wbobj/blue"
label: Behavior Definition
maxLen: 30
```

The descriptor is added only when `CreatableTypes` does not already contain `BDEF/BDO`.

### MCP compatibility

Extend `create_object_programmatically` without breaking existing inputs:

```text
source?: string
activate: boolean, default false
```

`objectType: BDEF/BDO` uses the same package allowlist and transport rules as other non-local objects. Names are uppercased and limited by the registered 30-character descriptor.

`source` is accepted only for repository types whose created object exposes a source URI. Package and service-binding creation reject it. `activate: true` requires `source`; activation without a supplied source is invalid rather than silently ignored.

If `source` is absent, the tool performs the existing validate-and-create behavior only. If `source` is present, the stages are:

1. validate the new object;
2. create the object;
3. resolve and read its initial source;
4. lock and replace the source;
5. run syntax diagnostics;
6. activate only when requested and syntax has no errors;
7. unlock in `finally`.

An error after creation includes `stage`, `created: true`, the object URI, transport, and `manualCleanupRequired: true`. The server does not automatically delete a newly created repository object after a later-stage failure.

## Batch Activation

Extend `abap_activate` with a mutually exclusive batch form while preserving the legacy form:

```text
Legacy:
  url: string
  connectionId?: string

Batch:
  urls: string[1..100]
  connectionId?: string
```

Providing both `url` and `urls`, or neither, is invalid. Every URL may be an `adt://` workspace URI or an ADT path. All batch members must resolve to the same connection. Cross-connection batches are rejected before SAP is called.

ToolService resolves each object, applies the package write policy, and constructs the exact `InactiveObject[]` expected by `ADTClient.activate`. SapClient makes one batch activation request with preaudit enabled. Local dependency sorting is not invented; SAP receives the complete batch and performs its own activation dependency handling.

The result contains:

```text
status: complete | partial | failed
requested[]
objectResults[] with outcome activated | failed | unknown
messages[]
remainingInactive[]
capabilityStatusAtExecution
```

An object is marked `failed` only when SAP associates an error or inactive result with it. It is marked `activated` only when the SAP response provides sufficient evidence. Otherwise it is `unknown`. Batch activation has no automatic rollback.

## ABAP Execution

Add `run_abap_application` to the `write` toolset because arbitrary execution can cause side effects.

Actions:

```text
repl_health
preview_class
preview_snippet
execute
```

Inputs are action-dependent:

```text
connectionId: required
className: required for preview_class
code: required for preview_snippet
planId and confirmation: required for execute
```

`preview_class` validates an uppercase class name and creates a ten-minute execution plan. `preview_snippet` validates a non-empty bounded code string and creates the same kind of plan. `execute` accepts only the exact plan ID and confirmation generated by the preview. The plan stores the code or class name so raw executable content is not accepted during execution.

Class execution calls `ADTClient.runClass(className)`. Snippet execution calls only `/sap/bc/z_abap_repl` with the request and response shape audited from ABAP FS. `repl_health` checks the same fixed service and records capability evidence.

Production is blocked when either the local profile or the REPL health response identifies production. Development and quality profiles still require the preview confirmation. Output uses the existing inline byte limit and returns truncation metadata.

The first delivery does not implement generic report/program-console execution.

## Semantic Inspection

Extend `inspect_abap_code.action` with:

```text
completion_element
documentation
type_hierarchy
components
```

Existing actions remain unchanged.

- `completion_element` calls `codeCompletionElement` with the current source and cursor. Structured XML results are normalized. A legacy string/HTML response is bounded and reported as legacy evidence rather than treated as a structured signature.
- `documentation` calls `abapDocumentation` with the object URI, current source, cursor, and profile language.
- `type_hierarchy` calls `typeHierarchy`; a new optional `superTypes` input defaults to `false`.
- `components` calls `classComponents` for the resolved object URI and is valid only for class/interface objects.

All list-like semantic results honor `startIndex` and `maxResults`. These operations are read-only and distinguish endpoint absence from authorization denial.

## Error Model

Normalize new failure classes to these codes:

```text
SAP_CAPABILITY_UNAVAILABLE
SAP_AUTHORIZATION_DENIED
SAP_VALIDATION_FAILED
SAP_OPERATION_FAILED
```

The original HTTP status, ADT endpoint, and sanitized SAP message are preserved in error details. Passwords, tokens, cookies, CSRF values, and session identifiers are removed. A 5xx or parsing failure does not trigger a guessed fallback request.

Partial activation is returned as structured data, not disguised as success. Creation failures after the object exists are errors with recovery data, not success responses.

## Test Strategy

Development follows strict red-green-refactor TDD. Each behavior begins with a failing test whose failure is observed before production code is written.

### MCP schema tests

- New tools and actions accept only the specified shapes.
- Legacy single activation remains valid.
- Batch forms reject mixed connections and invalid cardinality.
- Existing tool schemas remain backward compatible.
- The complete advertised schema remains under the existing 64 KiB guardrail.

### SapClient contract tests

- Verify exact `abap-adt-api` method names and argument order.
- Verify batch activation sends one `InactiveObject[]` call with preaudit enabled.
- Verify class execution uses `runClass` once.
- Verify the REPL adapter uses only `/sap/bc/z_abap_repl`.
- Verify semantic actions call `codeCompletionElement`, `abapDocumentation`, `typeHierarchy`, and `classComponents` exactly once.
- Verify no fallback request follows a failure.

### ToolService tests

- Capability state derivation and connection isolation.
- BDEF registration is idempotent.
- BDEF creation stage failures include recovery metadata.
- Package, transport, and production policies remain enforced.
- Batch activation complete, partial, failed, and unknown outcomes.
- Execution plans expire and reject stale or mismatched confirmations.
- Local-profile and REPL-reported production are both blocked.
- Output bounds and secret redaction.

### Fixture tests

Use sanitized fixtures derived from the pinned ABAP FS source and `abap-adt-api` 8.4.1 contracts. Cover success, endpoint absence, 401/403, syntax failure, partial activation, legacy completion-element responses, REPL health, empty output, malformed responses, and oversized output. A response shape without an audited fixture remains `unverified`.

### MCP integration tests

- Tool discovery and toolset filtering include the two new tools.
- Existing tools still register and execute through the in-memory SAP client.
- Error serialization and pagination remain bounded.
- README tool counts equal the actual registered surface.

## Completion Criteria

The delivery is complete only when:

- TypeScript build succeeds;
- every existing and new automated test passes;
- the public schema size guard passes;
- the legacy single-object paths still pass regression tests;
- all new responses include capability evidence where specified;
- README distinguishes implemented, live-verified, and unverified features;
- strict ABAP FS MCP compatibility counts are corrected from source rather than documentation prose: the pinned upstream exposes 43 MCP tools, while the current local compatibility list contains 42 and omits the VS Code-specific `manage_subagents` tool;
- a separate live-SAP acceptance guide defines disposable packages, transports, classes, BDEF objects, and REPL prerequisites;
- no new feature is documented as live-supported without live evidence.

Live SAP acceptance is not an automated-suite prerequisite. Its absence keeps affected capability records `unverified`; it does not justify skipping deterministic contract tests.

## Deferred Parity Slices

Each item below receives its own design, plan, implementation, and verification cycle after this foundation:

1. ABAP Cleaner, ATC exemption workflows, package tests, and coverage.
2. Debugger mutation, watchpoints, message/exception breakpoints, trace configuration, and debug recording/replay.
3. Basic, bearer, certificate, Kerberos/SPNEGO, browser SSO, OAuth, and BTP/Cloud authentication profiles.
4. Blame, S/4HANA readiness, ADT communication logs, and feeds as structured MCP data or artifacts.
5. Host-neutral Claude/Codex skills, MCP resources, and prompts replacing VS Code-specific agent configuration.

## References

- ABAP FS baseline: <https://github.com/marcellourbani/vscode_abap_remote_fs/tree/3041418d35558e043993a4d7f9fa6b727fcf9cf1>
- ABAP FS BDEF registration: <https://github.com/marcellourbani/vscode_abap_remote_fs/blob/3041418d35558e043993a4d7f9fa6b727fcf9cf1/client/src/adt/operations/BdefCreator.ts>
- ABAP ADT API: <https://github.com/marcellourbani/abap-adt-api>

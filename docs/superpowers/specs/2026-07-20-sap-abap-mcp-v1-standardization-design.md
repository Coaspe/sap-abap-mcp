# SAP ABAP MCP v1 Standardization Design

Date: 2026-07-20

## Objective

Turn `sap-abap-mcp` from a broad local SAP tool server into the open reference
implementation and conformance system for a stable SAP-to-AI MCP contract.

The target is a global open-source de facto standard used across MCP hosts and
SAP system families. v1.0 is a contract-stabilization release, not a tool-count
release. It succeeds when another maintainer can understand, implement, test,
and provide evidence for the same contract without depending on private
knowledge held by this repository's owner.

## Approved Decisions

- Preserve the current 53-tool contract as the v0 compatibility surface.
- Introduce a separate v1 contract and run v0 and v1 in parallel during a
  documented migration window.
- Use an open core, SAP adapter, policy, MCP contract, and conformance design.
- Keep local `stdio` as the default deployment and security boundary.
- Add only code boundaries in v1.0; do not split the repository into multiple
  npm packages before independent consumers require that split.
- Implement a read-only vertical slice before migrating mutation workflows.
- Treat live SAP execution evidence as the source of compatibility claims.
- Keep capabilities `unverified` when evidence is absent or inconclusive.
- Make v1 profiles read-only until their write policy is explicit.
- Defer production Streamable HTTP, MCP authorization, browser SSO, mTLS,
  experimental MCP Tasks, multi-tenancy, and a central gateway until after the
  v1.0 foundation.

## Current Baseline

The v0.4.15 baseline provides:

- 53 MCP tools and 150 documented action variants;
- a 52,515-byte minified `tools/list` schema for the complete surface;
- 133 passing automated tests using in-memory SAP doubles;
- zero findings from `npm audit --omit=dev` on 2026-07-20;
- production write blocking, package allowlists, transport requirements,
  stale-state checks, bounded results, and one-use confirmations;
- Basic Auth and opt-in OAuth client credentials;
- local `stdio` distribution through npm, MCPB, Codex, Claude, the MCP
  Registry, and Smithery.

The baseline does not provide public live-SAP support evidence, v1 structured
outputs, MCP Resources or Prompts, progress or cancellation propagation,
Streamable HTTP, MCP authorization, a PR validation workflow, a public
contribution process, or a stable cross-implementation conformance kit.

The compatibility boundary remains explicit: passing local tests proves the
implementation against doubles, not support for a SAP release, configuration,
or authorization set.

## Success Criteria

v1.0 is complete only when all of the following are true:

1. Every existing v0 contract test still passes.
2. Every v1 tool publishes an `outputSchema` and returns conforming
   `structuredContent` plus backwards-compatible JSON text.
3. v0 and v1 call the same application service and do not duplicate SAP
   operations.
4. Every v0 tool and action has a tested v1 equivalent or an explicit,
   documented extension or v0-only disposition before v1 becomes the default.
5. The first read-only slice works in Codex, Claude Code, VS Code, and the MCP
   Inspector, subject to each host's supported MCP features.
6. A conformance command emits schema-valid, redacted, reproducible evidence.
7. Stable v1.0 live-support claims include sanitized successful evidence from
   at least one Classic or S/4HANA system and one ABAP Cloud system. Until then,
   affected capabilities remain beta or `unverified`.
8. A contributor can run local contract tests and prepare live evidence using
   public documentation only.
9. Pull requests run the supported build, test, schema, packaging, and security
   checks before merge.
10. v1.0 has published migration, deprecation, security, contribution, and
   release policies.

## Non-Goals for v1.0

v1.0 does not include:

- a publisher-operated hosted SAP proxy;
- multi-tenant credential or SAP session management;
- a production Streamable HTTP deployment;
- MCP OAuth 2.1 or Enterprise-Managed Authorization;
- browser SSO, OIDC principal propagation, Kerberos, or client certificates;
- experimental MCP task-augmented tool execution;
- a complete replacement for SAP GUI or ADT;
- support for every SAP business API;
- a separate adapter package for every SAP release;
- a rewrite of all 53 tools at once;
- a requirement to expose every v1 capability through Tools, Resources, and
  Prompts simultaneously;
- automatic upload of source, hosts, users, credentials, or business data.

## Architecture

The request path is:

```text
MCP host
  -> stdio transport
  -> v1 contract or v0 compatibility presenter
  -> policy enforcement
  -> SAP application service
  -> ADT adapter
  -> authorized SAP system
```

Results return through:

```text
ADT response
  -> adapter normalization
  -> application result and evidence
  -> redaction and output policy
  -> v1 structured result or v0 compatibility result
```

The initial source boundaries are:

```text
src/
  core/             SAP domain inputs, results, errors, and application services
  adapters/adt/     abap-adt-api and release/capability differences
  policy/           write, execute, data, transport, and confirmation controls
  mcp/v1/           stable v1 tools, resources, prompts, and presenters
  mcp/compat/       current v0 and ABAP FS-compatible presenters
```

These are code ownership boundaries, not a requirement to move every current
file before the first feature works. Extraction follows vertical slices. A
module moves only when both v0 and v1 need the same behavior or when the policy
boundary must prevent an adapter from bypassing a control.

### Core rules

- Core contracts do not import the MCP SDK or `abap-adt-api`.
- Core results contain domain values, warnings, evidence, and pagination, not
  MCP content blocks.
- The adapter is the only layer that translates ADT-specific shapes.
- The policy layer authorizes an operation before the adapter mutates SAP.
- v0 and v1 presenters format one core result; they do not reimplement business
  behavior.
- No generic raw ADT request tool is introduced.
- No fallback endpoint or payload shape is guessed after a SAP failure.

## Version and Migration Model

During the pre-1.0 beta cycle, the CLI accepts:

```text
serve --api-version v0
serve --api-version v1
serve --api-version all
```

The exact flag is part of the public CLI contract and will be tested.

- v0 remains the default through the 0.x beta releases.
- v1 is opt-in while its schemas and mappings are being validated.
- `all` is intended for migration testing and schema comparison. It is not the
  recommended daily configuration because it exposes duplicate capabilities.
- At 1.0.0, v1 becomes the default only after every v0 tool and action has a
  tested v1 equivalent or an explicit extension or v0-only disposition. Until
  that gate passes, releases remain pre-1.0 and v0 remains the default.
- v0 receives compatibility and security fixes for at least two v1 minor
  releases and no less than six months after 1.0.0.
- Removal requires a major release and an earlier deprecation notice.

The package, MCPB, and plugins select an API version explicitly once v1 becomes
stable so a future default change cannot silently alter their tool surface.

## v1 Tool Design Rules

v1 uses dotted, domain-first names. Names remain lowercase ASCII and use only
characters allowed by the MCP tool-name guidance.

Split a v0 action group when any of the following differ:

- read, write, execute, or destructive risk;
- authorization scope;
- confirmation behavior;
- input and output meaning;
- retry or idempotency behavior.

Keep actions together only when they are variants of one atomic operation with
the same policy and result contract. Tool count is not minimized at the cost of
incorrect annotations. Toolsets and capability-driven selection control schema
cost instead.

Every v1 tool declares accurate MCP annotations. A read action is never exposed
under a tool annotated as destructive merely because a sibling v0 action can
mutate SAP.

### Initial read-only vertical slice

The first implementation slice contains:

```text
sap.system.list
sap.system.inspect
sap.system.capabilities
sap.repository.search
sap.source.read
```

It reuses the current connection manager and SAP client behavior. The slice is
complete when:

- both v0 and v1 execute one shared core method;
- the same request causes no additional SAP calls;
- v1 inputs and outputs validate against committed schemas;
- default v0 behavior and results remain compatible;
- schema benchmarks record the incremental cost;
- host smoke tests cover tool discovery and one call for each tool.

## v0 to v1 Mapping

This table is the migration baseline. A comma-separated v1 entry means the v0
action union will be split. `Resource` means v1 prefers an MCP Resource while a
small resolving tool may remain where model-controlled discovery is useful.
`Extension` means the feature is retained outside the core SAP development
toolset. Exact per-action schemas are written in the implementation plan for
each vertical slice.

| v0 tool | Proposed v1 contract | Disposition |
| --- | --- | --- |
| `read_deferred_result` | Resource links, cursor pages | v0 compatibility only after v1 replacements exist |
| `get_connected_systems` | `sap.system.list` | First slice |
| `get_sap_system_info` | `sap.system.inspect` | First slice |
| `get_sap_capabilities` | `sap.system.capabilities` | First slice and Resource |
| `search_abap_objects` | `sap.repository.search` | First slice |
| `get_abap_object_lines` | `sap.source.read` | First slice and Resource |
| `search_abap_object_lines` | `sap.source.search` | Core read |
| `get_abap_object_info` | `sap.repository.inspect` | Core read |
| `get_batch_lines` | `sap.source.read_batch` | Core read |
| `get_object_by_uri` | `sap.source.read` | Consolidate by canonical URI |
| `get_abap_object_url` | `sap.ui.object_url` | UI extension |
| `get_abap_object_workspace_uri` | `sap.repository.resolve` | Consolidate |
| `open_object` | `sap.repository.resolve` | Consolidate |
| `find_where_used` | `sap.repository.where_used` | Core read |
| `get_abap_dependency_graph` | `sap.repository.dependency_graph` | Analysis toolset |
| `compare_abap_systems` | `sap.repository.compare` | Analysis toolset |
| `create_object_programmatically` | `sap.repository.create` | Core write |
| `replace_string_in_abap_object` | `sap.source.patch` | Core write |
| `get_abap_diagnostics` | `sap.source.diagnose` | Core read |
| `abap_activate` | `sap.source.activate` | Core write |
| `inspect_abap_code` | `sap.semantic.complete`, `sap.semantic.definition`, `sap.semantic.documentation`, `sap.semantic.hierarchy`, `sap.semantic.components`, `sap.semantic.quick_fixes`, `sap.semantic.format_preview` | Split by result meaning; all read-only previews |
| `refactor_abap_code` | `sap.refactor.preview`, `sap.refactor.execute` | Separate preview and mutation |
| `manage_text_elements` | `sap.text_elements.read`, `sap.text_elements.write` | Separate read and write |
| `run_unit_tests` | `sap.quality.unit_test` | Analysis toolset |
| `create_test_include` | `sap.quality.test_include.create` | Write toolset |
| `manage_transport_requests` | `sap.transport.list`, `sap.transport.inspect`, `sap.transport.assess`, `sap.transport.compare`, `sap.transport.create`, `sap.transport.release`, `sap.transport.delete`, `sap.transport.owner.set`, `sap.transport.user.add`, `sap.transport.object.add`, `sap.transport.user.list`, `sap.transport.object.resolve` | Split by risk and result |
| `manage_abapgit` | `sap.git.list`, `sap.git.inspect`, `sap.git.create`, `sap.git.pull`, `sap.git.unlink`, `sap.git.stage`, `sap.git.push`, `sap.git.check`, `sap.git.branch.switch` | Split read and mutations |
| `manage_rap_generator` | `sap.rap.availability`, `sap.rap.schema`, `sap.rap.defaults`, `sap.rap.validate`, `sap.rap.preview`, `sap.rap.generate`, `sap.rap.binding.inspect`, `sap.rap.binding.publish`, `sap.rap.binding.unpublish` | Split previews and mutations |
| `manage_abap_versions` | `sap.version.inactive.list`, `sap.version.inactive.read`, `sap.version.restore.preview`, `sap.version.restore.execute` | Split read, preview, and mutation |
| `get_version_history` | `sap.version.history.list`, `sap.version.history.read`, `sap.version.history.compare` | Core read |
| `run_atc_analysis` | `sap.quality.atc.run`, `sap.quality.atc.documentation` | Analysis toolset |
| `get_atc_decorations` | `sap.quality.atc.cached` | v0-only in v1.0; a cached-finding Resource requires a separate approved design |
| `analyze_abap_dumps` | `sap.runtime.dump.list`, `sap.runtime.dump.inspect` | Runtime analysis toolset |
| `analyze_abap_traces` | `sap.runtime.trace.list`, `sap.runtime.trace.configuration`, `sap.runtime.trace.inspect`, `sap.runtime.trace.statements`, `sap.runtime.trace.hit_list` | Runtime analysis toolset |
| `abap_debug_session` | `sap.debug.session.start`, `sap.debug.session.stop`, `sap.debug.session.inspect` | Split by risk |
| `abap_debug_breakpoint` | `sap.debug.breakpoint.set`, `sap.debug.breakpoint.remove` | Debug toolset |
| `abap_debug_step` | `sap.debug.step` | Debug toolset |
| `abap_debug_variable` | `sap.debug.variables`, `sap.debug.evaluate` | Separate read from expression execution |
| `abap_debug_stack` | `sap.debug.stack` | Debug toolset |
| `abap_debug_status` | `sap.debug.status` | Debug toolset |
| `execute_data_query` | `sap.data.query`, `sap.data.export` | Separate bounded read and local artifact; supplied-data processing leaves core |
| `get_abap_sql_syntax` | `sap-docs://data-query` | Resource/Prompt; v0 compatibility tool remains |
| `abap_download` | `sap.source.export` | Artifact extension |
| `manage_heartbeat` | `sap.ops.watch.*` | v0-only in v1.0; a later operations extension requires a separate approved design |
| `adt_discovery_export` | `sap.system.discovery`, `sap.system.discovery.export` | Separate read and artifact |
| `run_sap_transaction` | `sap.ui.transaction_url`, `sap.ui.transaction_launch` | UI extension; separate pure URL from launch |
| `run_abap_application` | `sap.execution.health`, `sap.execution.preview`, `sap.execution.execute` | Separate probe, preview, and execution |
| `abap_fs_documentation` | `sap-docs://compat/*` | Resource; v0 compatibility tool remains |
| `create_mermaid_diagram` | `sap.artifact.mermaid.create` | Artifact extension |
| `validate_mermaid_syntax` | `sap.artifact.mermaid.validate` | Artifact extension |
| `get_mermaid_documentation` | `sap-docs://mermaid/*` | Resource in artifact extension |
| `detect_mermaid_diagram_type` | `sap.artifact.mermaid.detect` | Artifact extension |
| `create_test_documentation` | `sap.artifact.test_document.create` | Artifact extension |

The mapping is directional, not a commitment to register every proposed tool in
the first implementation plan. Only the first slice is committed by the first
plan. Later slices require focused designs that justify schema cost and host
behavior. The v1.0 default-switch gate still requires every v0 action to have a
tested replacement or a documented extension or v0-only disposition.

## v1 Result Contract

Every successful v1 tool returns an operation-specific object with these common
fields:

```text
schemaVersion: "1.0"
requestId: non-empty opaque string
status: succeeded | partial
systemId?: normalized configured system ID
data: operation-specific object
warnings: array of { code, message }
evidence?: bounded operation-specific evidence
page?: { nextCursor?: opaque string, returned: integer, total?: integer }
```

Rules:

- `outputSchema` describes the complete operation-specific object.
- `structuredContent` contains that exact object.
- A text content block contains the same object serialized as minified JSON for
  clients that do not consume structured content.
- `partial` is used only when useful bounded data is returned and the omitted or
  failed portion is identified in warnings and evidence.
- A failed operation returns `isError: true` and the v1 error contract; it is not
  represented as a successful result with `status: failed`.
- Raw ADT metadata is omitted unless it is the requested evidence or needed for
  a safe follow-up operation.
- Common fields stay small. Tools do not repeat system or object metadata inside
  every list member.

### Error contract

v1 errors contain:

```text
schemaVersion: "1.0"
requestId
code
category: validation | authentication | authorization | policy | conflict |
          capability | sap | transport | internal
message
retryable: boolean
details?: bounded and redacted object
```

Errors distinguish:

- malformed input;
- missing local credentials;
- SAP authorization denial;
- local policy denial;
- unsupported SAP capability;
- stale object or confirmation state;
- SAP operation failure;
- transport interruption with an uncertain mutation result;
- internal implementation failure.

A timeout or lost connection after a mutation begins is `retryable: false` until
the application service re-reads SAP state. v1 never automatically retries a
mutation merely because the network failed.

## Resources and Prompts

v1.0 implements only Resources that remove repeated context or provide a stable
identity for a large result:

```text
adt://<SYSTEM>/<canonical-adt-path>
sap-capability://<SYSTEM>
sap-transport://<SYSTEM>/<TRANSPORT>
sap-evidence://<RUN-ID>/<ARTIFACT>
```

The existing `adt://` form remains canonical for source and object identities.
Its v1 canonical form is:

```text
adt://<lowercase-profile-id><absolute-adt-path>
```

- The authority is a configured profile ID matching `[A-Z0-9_-]+`, serialized
  in lowercase and compared case-insensitively.
- The path begins with `/sap/bc/adt/` and comes from a SAP ADT response or a
  validated adapter result.
- Canonical Resource URIs do not contain a query or fragment. Version and range
  selection are Resource read arguments or Tool inputs rather than URI query
  parameters.
- The URI uses WHATWG URL percent-encoding. Parsing must preserve encoded path
  segment boundaries, including namespaced ABAP names, and must reject malformed
  percent escapes rather than reinterpret them.
- A supplied profile ID must match the URI authority or the request fails with
  a connection-mismatch error.

The additional Resource schemes use the same lowercase profile authority.
Transport identifiers are uppercase path segments. Evidence run IDs and
artifact names are opaque URL-safe ASCII segments matching `[A-Za-z0-9._-]+`.
v1 does not invent a second SAP object URI scheme.

Initial Resource Templates cover source by canonical URI and system capability
evidence. Large v1 results return a bounded structured summary and a resource
link rather than an operation-specific deferred-result protocol. Cursor
pagination remains the default for collections.

Initial Prompts are optional, host-dependent helpers for:

- safe object review;
- transport release readiness;
- ATC result interpretation;
- cross-system comparison.

Setup, credentials, and secret collection remain CLI or client-owned workflows.
No Prompt requests a password, token, certificate private key, source upload, or
other secret.

Neither Resources nor Prompts are allowed to duplicate every Tool merely to
claim feature completeness.

## Progress, Cancellation, and Large Operations

v1.0 adds progress and cancellation plumbing for operations that can be long or
expensive, beginning with ATC, Unit, batch activation, and transport assessment
when those slices migrate.

- Progress uses only a token provided by the client.
- Progress is monotonic and stops at completion, failure, or cancellation.
- Cancellation propagates through the application service and adapter wherever
  the underlying API accepts an abort signal.
- If SAP cannot cancel an operation, the result states that cancellation was
  requested but the remote outcome is uncertain.
- `read_deferred_result` remains available to v0 during migration.
- MCP Tasks are not required for v1.0 because task-augmented execution remains
  experimental in the current MCP specification.

## SAP Authentication Design

v1.0 introduces a credential-provider boundary without replacing the working
local stores. Providers return one of the adapter-supported credentials and do
not expose secret values to core, policy, MCP results, logs, or evidence.

Required v1.0 providers are:

- macOS Keychain;
- Windows DPAPI;
- profile-specific environment variables for Linux and CI;
- Basic Auth;
- OAuth client credentials;
- import of SAP BTP ABAP service-key JSON into non-secret profile metadata and
  the platform secret store.

Service-key import extracts only documented ABAP URL and UAA fields, validates
HTTPS URLs, stores the client secret through the selected secret provider, and
never writes the original service-key document to the profile file.

The CLI contract is:

```text
profile import-service-key <PROFILE> --file <PATH> --login
```

It reads the local file without printing its contents, validates the SAP
connection before replacing an existing profile or secret, and leaves the
source file unchanged. The command reports that the source file still contains
credentials and must be retained or removed according to the user's secret
handling policy.

Browser SSO with PKCE, OIDC bearer handling, principal propagation, Kerberos,
mTLS, Vault, KMS, and enterprise secret managers require separate designs after
the provider boundary and live BTP evidence exist.

## Policy and Safe Defaults

v1 replaces the ambiguous empty package allowlist with an explicit profile
policy:

```text
writePolicy.mode: read_only | packages | all
writePolicy.packages: string[]
executionPolicy.mode: disabled | confirmed
dataPolicy.mode: disabled | bounded_read | export
transportPolicy.release: disabled | confirmed
```

Rules:

- New profiles default to `read_only`, `disabled`, `disabled`, and `disabled`.
- `packages` requires a non-empty normalized package list.
- `all` is valid only for development or quality and requires an explicit setup
  choice. It is never inferred from an empty array.
- Production remains read-only regardless of other values.
- An absent or unreviewed environment classification is read-only.
- Where reliable SAP metadata contradicts the configured profile, the stricter
  interpretation wins and the conflict is reported.
- Execution, data export, transport release, deletion, and remote repository
  mutation remain separate opt-ins.

Current v0 profiles are not silently reinterpreted. The command
`profile migrate-v1 <PROFILE>` shows the existing profile and requires the user
to choose `read_only`, `packages`, or `all`. Until reviewed, v1 treats the
profile as read-only. v0 continues to use the existing semantics during its
support window.

Confirmations bind at least:

- system ID;
- operation;
- normalized target identity;
- relevant source or state fingerprint;
- transport when required;
- policy context;
- expiration time.

One attempt consumes the confirmation even when the remote operation fails.

## Reliability and Audit

v1 application services apply:

- explicit operation timeouts;
- bounded retries only for safe read operations;
- exponential backoff for retryable SAP throttling or transient reads;
- per-connection concurrency limits;
- serialization for conflicting mutations;
- request and correlation IDs;
- bounded, redacted audit events;
- post-failure state reads for uncertain mutations where a safe read exists.

The local server does not enable network telemetry by default. Optional metrics
or OpenTelemetry export requires an explicit configuration and a separate data
inventory. Audit events never include credentials, cookies, CSRF values, full
source bodies, query rows, debugger values, or business data by default.

Rate limits protect SAP and the local process from model loops. They are policy
limits, not a substitute for SAP authorization.

## Conformance and Compatibility Evidence

The public command is designed as:

```text
sap-abap-mcp conformance run --profile <PROFILE> --output <DIRECTORY>
```

It is opt-in and defaults to read-only probes. Mutation suites require an
explicit disposable fixture policy, allowed package, cleanup contract, and
separate confirmation.

The output contains:

- product version and source commit;
- MCP contract version;
- conformance schema version;
- sanitized system family, release, and type;
- authentication method category without credentials;
- host and platform category;
- capability and operation IDs;
- implemented, advertised, authorized, executed, and overall status;
- timestamps, bounded evidence, and cleanup status;
- JSON plus optional JUnit and SARIF artifacts.

The existing compatibility evidence schema evolves rather than being replaced
without migration. Evidence rules remain fail-closed:

- discovery proves advertisement, not successful execution;
- an authorization denial is not endpoint absence;
- fixture tests prove implementation behavior, not live support;
- a mutation suite cannot pass without confirmed cleanup;
- evidence with redaction violations is rejected;
- support is scoped to the recorded product, contract, SAP release, system type,
  authentication category, and operation.

The repository publishes a generated matrix from accepted evidence. Submitting
evidence is optional and never uploads automatically.

## Test and Release Strategy

Implementation follows test-first vertical slices.

### Contract tests

- snapshot the v0 tool names and input schemas;
- validate every v1 input and output schema;
- require structured content and JSON text parity;
- verify v0 and v1 share one service invocation;
- test error-category and retryability mapping;
- benchmark each selectable tool surface;
- reject undocumented v1 tools and unmapped v0 removals.

### Application and policy tests

- test core services without MCP or ADT dependencies;
- test adapters against recorded, sanitized fixtures and in-memory doubles;
- test policy decisions as a matrix of environment, package, scope, operation,
  transport, and profile migration state;
- test cancellation, timeout, concurrency, stale state, and uncertain results;
- retain current secret redaction and output-boundary tests.

### Host and packaging tests

- use the MCP Inspector as the protocol baseline;
- smoke-test Codex, Claude Code, and VS Code configurations;
- test npm package, MCPB, and plugin startup artifacts;
- run supported Node versions on Linux, Windows, and macOS where the workflow
  requires platform-specific credential behavior.

### Pull request and release controls

Add a pull-request workflow separate from manual publishing. It runs build,
tests, schema checks, benchmarks, package dry-run, registry validation where
offline validation is available, dependency audit, and secret scanning.

Releases provide:

- a generated changelog;
- npm provenance or an equivalent verifiable build attestation;
- an SBOM;
- checksums for packaged artifacts;
- synchronized npm, registry, MCPB, and plugin metadata;
- generated tool counts and test counts from a single source of truth.

This removes current documentation drift such as `SERVICES.md` recording 119
tests while the verified suite contains 133.

## Open-Source Governance

Before v1.0, add:

- `CONTRIBUTING.md` with setup, tests, scope, and review expectations;
- `SECURITY.md` with private reporting and response targets;
- `CODE_OF_CONDUCT.md`;
- maintainer and reviewer responsibilities;
- a lightweight RFC process for public contract changes;
- ADRs for accepted architecture decisions;
- a public roadmap and release support policy;
- issue templates for bugs, SAP compatibility evidence, adapter proposals, and
  security-safe professional support;
- contributor fixtures and good-first-issue labels.

The contract schemas, error taxonomy, capability IDs, URI rules, evidence
schema, and conformance expectations are documented independently of the
TypeScript implementation. This allows another language implementation to
target the same behavior later without copying internal code.

## Delivery Sequence

### Phase 0: Contract baseline

1. Commit v1 naming, result, error, version, and migration contracts.
2. Snapshot v0 tools and action variants.
3. Add v0-to-v1 mapping validation.
4. Add `--api-version` parsing tests without changing the default surface.

### Phase 1: Read-only vertical slice

1. Define schemas for the five initial v1 tools.
2. Introduce the minimum core result and presenter boundaries.
3. Route v0 and v1 through shared application services.
4. Add structured outputs, Resource identities, schema benchmarks, and host
   smoke tests.

### Phase 2: Policy and mutation slice

1. Add explicit v1 profile policy and reviewed migration.
2. Migrate source patch, diagnostics, and activation as one safe workflow.
3. Bind confirmations to state and policy context.
4. Add timeout, cancellation, concurrency, and uncertain-result behavior.

### Phase 3: Conformance and live evidence

1. Implement the read-only conformance runner.
2. Extend the evidence schema and generated compatibility matrix.
3. Collect authorized sanitized evidence from Classic/S/4HANA and ABAP Cloud.
4. Keep unsupported or untested combinations visibly `unverified`.

### Phase 4: v1.0 release readiness

1. Add PR CI and supply-chain artifacts.
2. Publish migration, security, contribution, and support policies.
3. Complete the host and platform matrix.
4. Release candidates retain v0 as the default until the v1 gates pass.
5. Release 1.0.0 with v1 as the explicit default and the documented v0 support
   window.

## Post-v1.0 Roadmap

### v1.1 candidates

- production Streamable HTTP;
- MCP OAuth 2.1 and Enterprise-Managed Authorization;
- browser SSO with PKCE, OIDC, and client-certificate authentication;
- external secret managers;
- MCP Tasks behind capability negotiation;
- Resource subscriptions where host behavior is proven.

### v1.2 and later candidates

- a public adapter SDK;
- independently maintained SAP adapters;
- an optional enterprise gateway;
- implementations in additional languages;
- a neutral multi-maintainer or working-group governance model.

Post-v1 features require user evidence or independent implementers. They are not
added solely because the protocol makes them possible.

## Risks and Mitigations

### Excessive schema growth

Splitting grouped actions can increase tool count. Mitigate with toolsets,
capability-driven exposure, schema benchmarks, and registration only after a
vertical slice is usable. Do not expose `all` by default.

### Two divergent implementations

Parallel v0 and v1 could drift. Prevent this by sharing application services and
testing one service invocation for both presenters. Compatibility code formats
results only.

### Premature abstraction

Creating packages and per-release adapters before two implementations need the
boundary would slow delivery. Use source-directory boundaries and extract only
along implemented slices.

### False compatibility claims

Automated doubles and discovery can appear more authoritative than they are.
Keep implementation, advertisement, authorization, execution, and live support
as separate evidence dimensions.

### Security regression during migration

Changing empty allowlist semantics can either break users or preserve unsafe
defaults. Require explicit v1 profile review, keep v0 behavior during its support
window, and never silently convert an empty list to unrestricted writes.

### Host feature inconsistency

MCP hosts support structured outputs, Resources, Prompts, progress, and Tasks at
different rates. Keep core Tools usable without optional primitives and test
capability negotiation rather than assuming host support.

### Maintainer bottleneck

A single maintainer cannot validate every SAP release. Make conformance safe,
reproducible, redacted, and easy for organizations to run, then document how
independent evidence is reviewed.

## Reference Standards and SAP Guidance

- MCP specification 2025-11-25: Tools, Resources, Prompts, Transports,
  Authorization, Progress, Cancellation, and experimental Tasks.
- MCP Security Best Practices for local servers, Streamable HTTP, sessions,
  authorization, origin validation, and scope minimization.
- SAP ADT authentication guidance for classic and ABAP Cloud projects.
- SAP BTP ABAP service-key guidance.
- SAP supported inbound HTTP authentication guidance, including Basic,
  certificate, OIDC, and authorization-code-with-PKCE scenarios.

This design does not treat protocol availability as an implementation mandate.
Each optional feature enters a delivery plan only when it strengthens the v1
contract without delaying the approved foundation.

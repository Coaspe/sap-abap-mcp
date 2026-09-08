# Adaptive capability discovery

Unreleased local CLI builds start with **five gateways** (`minimal`) instead of
exposing every schema. The optional `adaptive` preset also exposes 12 common
read tools, for 17 tools total. Both retain the full capability catalog and
native workflow prompts. [Workflow measurements](workflow-mode-benchmark.md)
explain the default and the cost of additional discovery calls.
The separately published npm package is not updated by these local changes.

## Startup and compatibility

```sh
npm run build
node dist/src/index.js serve --profile DEV100
```

The profile must already exist. Omit `--profile` to expose configured profiles
under their existing policies. MCP hosts should launch the absolute path to this
checkout's `dist/src/index.js`; starting the npm package runs the published code.
New setups need no preset flag to receive the reduced surface.

| Selection | Direct tools | Reachable capabilities |
|---|---:|---|
| Default CLI / `--preset minimal` | 5 | All 120 v1 capabilities, filtered by role |
| `--preset adaptive` | 17 | All 120 v1 capabilities, filtered by role |
| `--preset compact` | 12 | Only the selected read/inspect tools |
| `--toolsets all` | 120 | Full direct v1 compatibility |
| `--preset development` / `assurance` | 34 / 15 | Selected development / assurance tools |
| `--api-version v0` | 53 | Legacy API |

Library embedding deliberately retains its default: `createMcpServer(service)`
registers the full direct catalog. Embedders opt in with `{ adaptive: true }`.
Explicit toolsets and other presets still select their respective surfaces.

The proposed v1 compatibility profile requires particular directly advertised
tool names. Therefore `conformance:v1` launches `serve --toolsets all`; the
minimal default is tested separately through actual stdio protocol calls.
Adaptive reachability must not be reported as direct-discovery conformance.

## How an agent uses it

1. Call a directly available read/inspect tool when it fits the task.
2. Use `sap.capability.search` for another task, or browse its paginated categories.
3. Call `sap.capability.describe` for the chosen name to receive its exact input schema, risk and schema hash.
4. Call `sap.capability.invoke_read`, `invoke_write` or `invoke_destructive` with that name, hash and original arguments.
5. Reuse the described schema in the session. Describe again if the server reports `CAPABILITY_SCHEMA_CHANGED`.

When the exact name is already known, search can be skipped. The model does not
need to fetch every schema. Description returns the output schema only when
explicitly requested. Keyword search currently matches English tool metadata;
category browsing and exact names are the fallback when natural-language search
misses. Native prompts include the exact capability names and dispatch guidance.
The initialization guidance also directs known names straight to description;
when the system ID is unknown, it points to `sap.system.list`. The workflow
benchmark measures this path separately from search-and-describe, and reports
initialization-instruction tokens separately from tool-schema tokens.

Task queries give more weight to terms appearing in fewer allowed capabilities,
so `syntax check` is not dominated by unrelated generic check tools. The
[discovery benchmark](discovery-benchmark.md) records ranks and response costs
across all discovery modes and roles, with explicit measurement limits.

Search also indexes declared string enum options inside input schemas, including
array items. For example, `jumpToLine` discovers `sap.debug.step` and `sarif`
discovers `sap.transport.assess`. Previously these values were absent from the index.
The index remains internal: search responses do not include the input schemas,
and initial tool-schema size is unchanged. Defaults are not added as search
terms. Session role restrictions still apply before results are selected.

Fixed after the 2026-09-08 discovery checks: SDK 1.30.0 advertised an empty
`{type: "object", properties: {}}` for top-level Zod unions even though calls
were validated against those unions. `sap.execution.preview`, `sap.classic.read`,
`sap.classic.write` and `sap.ddic.update` now use an object-root adapter. It
advertises the original union's JSON Schema branches through Zod metadata,
validates against the original schema and preserves its parsed defaults.
Direct `tools/list` and deferred `describe` now expose branch-specific required
fields. The single gateway's fixed schema remains 209 tokens; the full catalog
and on-demand descriptions grow because they now contain the missing contracts.
String constants in these branches are also searchable, so `upsert` can find
`sap.classic.write`. Local protocol tests validate advertised schemas with AJV
and exercise every branch, defaults, missing fields and rejected extra fields
against service fixtures. This is not live SAP execution evidence.

DDIC updates now select their validation branch by `kind`; classic writes select
by `kind` and, for screens, `operation`. A GUI-status upsert missing `definition`
therefore reports that field rather than all screen-upsert/delete failures.
The object adapter retains failed validation as a parse result instead of
throwing a second raw Zod exception while applying defaults. In one local single
gateway fixture, the complete error result dropped from 1,974 bytes / 497
`o200k_base` tokens to 206 bytes / 47 tokens. This measures response serialization
only, not model billing or the number of attempts an LLM needs. All twelve valid
branches remain covered by JSON Schema and MCP invocation tests.

The gateway calls an internal MCP server built from the same tool registrations
and service instance. Validation is performed by the original tools, including
transport, package, production, preview and confirmation checks. Viewer catalogs
exclude mutation tools; developer catalogs exclude admin-only capabilities.
Wrong-risk invocation and schema-hash mismatches fail before dispatch.

The outer audit records the underlying capability name and arguments once.
Evidence created through a deferred call uses the same store as the outer
Resource handlers. The gateway is initialized lazily and closed with the server.
Discovery alone makes no SAP calls. Tool availability is permission-filtered,
but it does not prove that a particular SAP system supports every endpoint.

## Measured fixed cost

Measured on 2026-09-07 from this checkout using `npm run benchmark:surface`:

| Surface | Tools | Minified tool-schema bytes | Bytes / 4, rounded up |
|---|---:|---:|---:|
| Full v1 | 120 | 168,227 | 42,057 |
| Adaptive | 17 | 26,821 | 6,706 |

Fixed schema bytes decrease by **84.1%**. The last column is a rough proxy,
not a tokenizer measurement. Search/description outputs, invocation arguments,
results and client prompt formatting also consume context. Tasks using many
different capabilities can pay additional discovery costs. No total-task token
reduction or live-SAP latency claim follows from this measurement alone.

## Verification and remaining work

`npm test` passes 473 tests in this checkout. Gateway tests enumerate every v1
capability, compare direct and routed validation, exercise successful calls,
reject stale schemas and risk mismatches, check role filtering, audit attribution,
evidence Resources and workflow prompt access. The stdio smoke test validates
default minimal startup and explicit adaptive/full modes in separate processes.

Run `npm run smoke:v1` for a short local check. No SAP credentials are needed.
Live-SAP acceptance, representative agent task/token measurements, safe source
caching and richer dependency context remain work toward the broader goal.

## Task-level payload cost

The [workflow benchmark](workflow-cost-benchmark.md) includes gateway discovery,
schema retrieval, invocation wrappers and repeated source results. In its fixed
fixture, adaptive adds two tool calls and 4,556 bytes of gateway traffic. The
schema reduction still outweighs that cost, but host-native deferral and real
model behavior must be measured separately. Run `npm run benchmark:workflow`
to reproduce the comparison with correctness assertions.

### Finding features inside existing tools

Capability keyword search also examines input parameter names, titles and
descriptions. For example, `query: "KTD", category: "semantic", risk: "read"`
finds the optional documentation view on `sap.semantic.components`, while
`query: "includeRelated"` finds its related-contract option. Search results stay
compact summaries: parameter schemas are returned only by capability description.
Exact tool-name matches retain priority, and role/category/risk filters still
apply. This is lexical matching, not translation or semantic search.

This change adds no tools, parameters or fixed schema bytes. Local validation
passes 496 tests, including parameter-only discovery, exact-name priority,
risk filtering and schema omission from search results.

## Minimal fixed surface

```sh
sap-abap-mcp serve --preset minimal
```

`minimal` exposes only the five discovery/invocation gateways. All 120 existing
capabilities remain discoverable, with the same original argument validation,
role restrictions, audit behavior and separate read/write/destructive gateways.
The seven resources and four workflow prompts remain available. When the system
ID is unknown, describe `sap.system.list` and invoke it through `invoke_read`.
This preset applies only to v1 and cannot combine with `--toolsets`.

Its fixed tool array is 3,782 bytes / 883 `o200k_base` tokens, versus optional
adaptive 26,821 bytes / 6,583 tokens. `minimal` is useful when fixed context cost
matters more than immediate access to the common read tools. Minimal is the local CLI default; it adds discovery calls for tools that
adaptive advertises directly.
Reuse descriptions within a session and describe again on schema changes.

The contracts-plus-KTD fixture takes three calls with either integrated mode;
one measured minimal run totaled 4,991 payload tokens versus adaptive 10,685.
For the separate-call workflow, minimal needs 14 calls versus adaptive 10.
These are synthetic tokenizer measurements, not live model latency or billed
usage. The token benchmark reports this mode as `gateway-only`.

Local validation passes 497 tests. Real stdio smoke checks enumerate the entire
catalog, invoke system listing through the gateway, and verify resources/prompts
for default minimal as well as explicit adaptive and full modes.
## Optional single gateway

`--preset single` is now available in this checkout for the smallest advertised
tool surface. It exposes one gateway while retaining schema hashes and server
policy checks; the default is minimal. See [usage, approval tradeoffs and
measurements](single-tool-mode.md).

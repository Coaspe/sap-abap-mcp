# MCP v1 migration

The unversioned `serve` uses the minimal v1 surface. Existing MCPB and plugin
launch commands advertise 5 gateways and seven Resources. All 120 capabilities
remain discoverable through the gateway.
With no `--toolsets` or `--preset`, minimal mode is enabled.
Use `--toolsets all` to advertise all 120 tools directly. These changes describe
the local unreleased source; `@latest` behavior depends on the published version.
All 53 v0 capabilities remain available through `--api-version v0`.

Normal use needs neither `--api-version` nor `--toolsets`:

```bash
# Registry release; local unreleased builds instead default to 5 gateways.
npx @coaspe/sap-abap-mcp@latest serve

# Optional schema-budget control for hosts that should preload fewer tools.
npx @coaspe/sap-abap-mcp@latest serve --preset compact

# Full direct-tool compatibility.
npx @coaspe/sap-abap-mcp@latest serve --toolsets all

# Custom schema-budget control.
npx @coaspe/sap-abap-mcp@latest serve --toolsets core,analysis

# Explicit legacy compatibility surface: 53 v0 tools.
npx @coaspe/sap-abap-mcp@latest serve --api-version v0
```

The complete v1 surface contains 120 callable tools and seven Resources. Each
v1 tool has an action-free input contract, a declared output schema, the v1
success/error envelope, and a thin adapter to the same `AbapToolService` used by
v0. The combined v0 + v1 surface is internal to automated parity tests and is not accepted by the CLI.

## Toolsets

For common workloads, prefer a curated preset: `compact` exposes 12 everyday
read/inspect tools, `development` exposes 34 read/write/quality tools, and
`assurance` exposes 15 read-only review tools. Presets and toolsets are mutually
exclusive, and presets apply only to v1.

Toolsets are optional schema-budget controls, not feature levels. Select one or
more comma-separated toolsets to replace adaptive discovery with direct tool
registration. See [adaptive mode](adaptive-mode.md) for gateway usage.

| Toolset | Tools | Scope |
| --- | ---: | --- |
| `core` | 21 | Systems, repository/source/DDIC reads, semantic inspection, text reads, object URLs |
| `write` | 26 | Repository/source/DDIC/classic mutations, transport/Git/RAP writes, confirmed execution |
| `analysis` | 30 | Quality, comparisons, versions, transport review, read-only data queries |
| `debug` | 10 | Debug sessions, breakpoints, stepping, stack and variables |
| `operations` | 26 | Runtime dumps/traces/feeds, classic reads, watch tasks, execution preview, discovery, transaction URLs |
| `artifacts` | 7 | Mermaid/test documents, data/source/discovery exports |
| `all` | 120 | Every v1 tool |

The static split limits schema-token growth without changing handler behavior.

## Resources

The seven v1 Resource registry names cover these canonical URI families:

- `sap-adt-source`: `adt://<system>/<canonical-adt-path>`
- `sap-capability-evidence`: `sap-capability://<system>`
- `sap-transport`: `sap-transport://<system>/<transport>`
- `sap-evidence`: `sap-evidence://<run-id>/<artifact>`
- `sap-docs-data-query`: `sap-docs://data-query`
- `sap-docs-compat`: `sap-docs://compat/<document>`
- `sap-docs-mermaid`: `sap-docs://mermaid/<document>`

Resource discovery performs no SAP call. Resource reads validate and
canonicalize the URI before calling the corresponding shared provider.
Session evidence is bounded, redacted, time-limited, and isolated to one MCP
server run.

## Contract changes

- Use `systemId` instead of the v0 `connectionId` name.
- Select one operation-specific v1 tool instead of passing a broad v0 `action`.
- Read the first JSON content block or `structuredContent`; both represent the
  same v1 envelope.
- Follow returned Resource Links for complete source, capability, transport, or
  artifact evidence.
- Preserve confirmation values and plan IDs exactly for mutation and execution
  tools. v1 adapters use the existing v0 safety and policy enforcement.
- Set `profiling: true` on the class branch of `sap.execution.preview` when an
  aggregate ABAP profiler trace is needed. Execute the returned one-use plan
  unchanged; ordinary class execution remains the default.
- Use the program branch of `sap.execution.preview` for confirmed executable
  program runs with a bounded server-time profile.
- `sap.ddic.read` and `sap.ddic.update` provide typed Domain/Data Element
  properties and guarded Table/Structure DDL. `sap.classic.*` requires the
  separately installed same-origin bridge documented in `classic-bridge.md`.
- Delete one exact repository object through `sap.repository.delete.preview`,
  then pass its unchanged `planId` and `confirmation` to
  `sap.repository.delete.execute`. Generic refactoring tools reject delete plans.

The complete row-by-row mapping is in
[`v1-parity-matrix.md`](v1-parity-matrix.md).

## Verification boundary

The local implementation gate covers 53 unchanged v0 tools, all 120 callable
v1 tools, all seven Resources, per-toolset schema budgets, and the full
automated regression suite. Live SAP acceptance remains a separate gate; local
completion does not claim that every optional ADT endpoint is supported or
authorized on a particular SAP system. The live mutation campaign is limited
to the B4D `$TMP` boundary.

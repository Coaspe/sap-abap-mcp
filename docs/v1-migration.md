# MCP v1 migration

The unversioned `serve` is the complete current v1 surface. Existing MCPB,
plugin, and `@coaspe/sap-abap-mcp@latest serve` launch commands therefore use
all 113 v1 tools and seven Resources without adding startup flags.
With no `--toolsets`, all six v1 toolsets are enabled.
All 53 v0 capabilities remain available through `--api-version v0`.

Normal use needs neither `--api-version` nor `--toolsets`:

```bash
# Current v1 surface: 113 tools and seven Resources.
npx @coaspe/sap-abap-mcp@latest serve

# Optional schema-budget control for hosts that should preload fewer tools.
npx @coaspe/sap-abap-mcp@latest serve --toolsets core,analysis

# Explicit legacy compatibility surface: 53 v0 tools.
npx @coaspe/sap-abap-mcp@latest serve --api-version v0
```

The complete v1 surface contains 113 callable tools and seven Resources. Each
v1 tool has an action-free input contract, a declared output schema, the v1
success/error envelope, and a thin adapter to the same `AbapToolService` used by
v0. The combined v0 + v1 surface is internal to automated parity tests and is not accepted by the CLI.

## Toolsets

Toolsets are optional schema-budget controls, not feature levels. Omitting the
flag enables `all`. Select one or more comma-separated toolsets only when a host
should advertise a smaller surface.

| Toolset | Tools | Scope |
| --- | ---: | --- |
| `core` | 20 | Systems, repository/source reads, semantic inspection, text reads, object URLs |
| `write` | 23 | Repository/source mutations, transport/Git/RAP writes, confirmed execution |
| `analysis` | 29 | Quality, comparisons, versions, transport review, read-only data queries |
| `debug` | 10 | Debug sessions, breakpoints, stepping, stack and variables |
| `operations` | 24 | Runtime dumps/traces, watch tasks, execution preview, discovery, transaction URLs |
| `artifacts` | 7 | Mermaid/test documents, data/source/discovery exports |
| `all` | 113 | Every v1 tool |

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

The complete row-by-row mapping is in
[`v1-parity-matrix.md`](v1-parity-matrix.md).

## Verification boundary

The local implementation gate covers 53 unchanged v0 tools, all 113 callable
v1 tools, all seven Resources, per-toolset schema budgets, and the full
automated regression suite. Live SAP acceptance remains a separate gate; local
completion does not claim that every optional ADT endpoint is supported or
authorized on a particular SAP system. The live mutation campaign is limited
to the B4D `$TMP` boundary.

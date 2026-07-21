# MCP v1 migration preview

The unversioned `serve` remains the complete v0 compatibility surface. Existing
MCPB, plugin, and `@coaspe/sap-abap-mcp@latest serve` launch commands therefore
continue to use the complete and unchanged v0 surface without configuration
changes.

Choose an API surface explicitly when evaluating the v1 preview:

```bash
# Stable v0 surface; this is also the unversioned default.
npx @coaspe/sap-abap-mcp@latest serve

# Opt-in read-only v1 preview. Explicit v1 mode defaults to the `core` toolset.
npx @coaspe/sap-abap-mcp@latest serve --api-version v1

# Complete v1 catalog filter; only implemented handlers are advertised.
npx @coaspe/sap-abap-mcp@latest serve --api-version v1 --toolsets all

# v0 and v1 together, for migration conformance only.
npx @coaspe/sap-abap-mcp@latest serve --api-version all
```

The complete v1 catalog contains 113 target tool names, but only implemented handlers are advertised.
`--toolsets all` selects the complete catalog filter, but cannot advertise a
handler that has not been implemented.

`--api-version all` is reserved for migration conformance because it exposes duplicate capabilities.
It is not a long-term client configuration.

## Implemented mappings

| v0 tool | v1 tool |
|---|---|
| `get_connected_systems` | `sap.system.list` |
| `get_sap_system_info` | `sap.system.inspect` |
| `get_sap_capabilities` | `sap.system.capabilities` |
| `search_abap_objects` | `sap.repository.search` |
| `get_abap_object_lines` | `sap.source.read` |

These five tools are the implemented preview handlers, not complete v1. The v1
preview is read-only: no write or execute v1 tool is part of this slice.
Continue using v0 for capabilities that are not listed above. Do not describe the preview as complete v1 until the 53-tool/150-variant parity gate passes.
Final live acceptance waits for that parity.

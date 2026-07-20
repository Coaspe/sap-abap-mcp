# MCP v1 migration preview

The unversioned `serve` remains v0 through 1.x. Existing MCPB, plugin, and
`@coaspe/sap-abap-mcp@latest serve` launch commands therefore continue to use
the complete v0 surface without configuration changes.

Choose an API surface explicitly when evaluating the v1 preview:

```bash
# Stable v0 surface; this is also the unversioned default.
npx @coaspe/sap-abap-mcp@latest serve

# Opt-in read-only v1 first slice.
npx @coaspe/sap-abap-mcp@latest serve --api-version v1

# v0 and v1 together, for migration comparison only.
npx @coaspe/sap-abap-mcp@latest serve --api-version all
```

The `all` mode duplicates capabilities under v0 and v1 names. It is intended
only for comparison, not as a long-term client configuration.

## Implemented mappings

| v0 tool | v1 tool |
|---|---|
| `get_connected_systems` | `sap.system.list` |
| `get_sap_system_info` | `sap.system.inspect` |
| `get_sap_capabilities` | `sap.system.capabilities` |
| `search_abap_objects` | `sap.repository.search` |
| `get_abap_object_lines` | `sap.source.read` |

This is an opt-in first slice, not a full v0 replacement yet. The v1 preview is
read-only: no write or execute v1 tool is part of this slice. Continue using v0
for capabilities that are not listed above.

# 1.7.1 release and verification scope

This patch contains two fixes on top of 1.7.0:

- Interactive passwords and tokens display `*` while typing, with Enter/Ctrl+C guidance and validation/storage progress. Plaintext secrets are not echoed.
- Service binding creation honors category (`0` Web API, `1` UI) and an independent `bindingVersion` (`V2` or `V4`, default `V2`) in both v0 and v1. SAP validation and creation use the selected version, bypassing the dependency's hardcoded V2/Web API XML.

For an OData V4 UI binding, include these fields under `additionalOptions`:

```json
{
  "serviceDefinition": "Z_MY_SERVICE",
  "bindingType": "ODATA",
  "bindingCategory": "1",
  "bindingVersion": "V4"
}
```

Category 1 alone selects UI, not V4. Existing calls without a version retain V2.

## Validation scope

Local regression tests cover masked input, editing, cancellation, both MCP schemas, the validation query, and all four version/category combinations in outgoing XML. No live SAP objects were created or deleted. SAP-side V4 creation, activation, and publication remain unverified.

## Updating

For a global installation, run `npm install -g @coaspe/sap-abap-mcp@1.7.1`.
For an npx-based MCP configuration, set its package argument to `@coaspe/sap-abap-mcp@1.7.1`.
Restart the MCP process so it loads the updated runtime and schemas. Updating the package does not repair existing SAP bindings.

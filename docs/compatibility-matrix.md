# SAP compatibility and evidence matrix

This project separates implementation coverage from live SAP compatibility. Passing the automated suite proves the local MCP behavior against in-memory doubles; it does not prove support for a particular SAP release, system configuration, or authorization set.

## Current evidence

| Evidence scope | SAP release | System type | Result |
| --- | --- | --- | --- |
| Automated TypeScript and MCP integration suite | Not applicable | In-memory SAP double | Implementation regression coverage only |
| Sanitized live evidence committed to this repository | Not supplied | Not supplied | Unverified |

No SAP release is listed as live-supported until a sanitized record from the exact operation passes the rules in [`live-sap-acceptance.md`](live-sap-acceptance.md) and validates against [`compatibility-evidence.schema.json`](compatibility-evidence.schema.json).

## Evidence rules

- Record the npm product version and exact source commit so results are reproducible.
- Use `scope: "live-sap"` only for an operation executed against the recorded SAP connection. Automated doubles must use `scope: "automated-fixture"` and `status: "unverified"`.
- Record the SAP release and system type returned by the selected live connection. Do not infer a release from documentation or a competitor's result.
- Redact users, hosts, source code, cookies, authorization headers, tokens, CSRF values, session identifiers, and business data. Store a hash or bounded structural summary when the raw result is sensitive.
- Treat endpoint discovery as availability evidence, not execution or authorization evidence.
- Keep an authorization denial distinct from an absent endpoint. Both prevent a `supported` result, but they have different remediation paths.

## Repeatable local benchmark

Run the schema benchmark without connecting to SAP:

```bash
npm run build
npm run benchmark:surface
```

The first command refreshes the local build. The benchmark then emits machine-readable JSON for every toolset: tool count, minified UTF-8 `listTools` schema bytes, and the ten largest tool definitions. Use `-- --output <path>` to save the report. This measures MCP context cost, not model tokens, network latency, or live SAP performance.

For transport release confidence, use `manage_transport_requests` with `action: "assess_transport"`. Its JSON, SARIF, and JUnit artifacts are operation evidence; the result remains `incomplete` when requested checks or transport coverage are incomplete.

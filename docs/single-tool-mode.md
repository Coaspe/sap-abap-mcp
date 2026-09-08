# Single-tool mode

This opt-in mode advertises one `sap` tool while retaining the existing internal
capability catalog, Resources and workflow prompts. The default is minimal (five gateways).
Run from this built development checkout; this is not yet a published npm feature:

```sh
node dist/src/index.js serve --preset single
```

1. Find capabilities: `sap({name:"search", arguments:{query:"public API"}})`.
2. Describe one: `sap({name:"describe", arguments:{name:"sap.system.list"}})`.
3. Invoke that name with its returned `risk`, `schemaHash` and schema-valid
   `arguments`. Re-describe after `CAPABILITY_SCHEMA_CHANGED`.

Search arguments also support exact `name`, `category`, `risk`, `cursor` and
`limit`, as in the five-gateway mode. Unknown argument fields are rejected.
Invalid search/describe arguments return `CAPABILITY_ARGUMENTS_INVALID` in the
validation category with the expected input schema. Correct the input before
retrying; the error does not repeat supplied values. This recovery schema is
returned only on error and adds nothing to the advertised tool schema.
Invocation requires the matching risk and schema hash; original tool validation,
role filtering, confirmations and SAP policy checks still execute.
`CAPABILITY_GATEWAY_CLOSED` means the session is shutting down or already closed;
reconnect before making another request. Repeating discovery in that session
does not restart its internal server. This also applies to adaptive/minimal mode.

Developer/admin sessions advertise the universal gateway as potentially
destructive. Clients may therefore ask for approval even for reads. Viewer
sessions expose a read-only gateway backed by a read-only internal catalog.
Choose adaptive/minimal when separate tool-level read/write approval hints are
more useful. Audit events use the invoked capability name and its server-resolved
risk; the resolved-risk marker is internal and adds no JSON payload.

## Measurements and limits

On 2026-09-08, the default single gateway's serialized tool array was 846 bytes,
or 209 `o200k_base` tokens, versus minimal's 3,782 bytes / 883 tokens. This is
about 76% less fixed tool-schema cost. ARC-1 1.2.0 hyperfocused also measured
209 tokens with the same tokenizer; this is not a claim of overall superiority.

The public-contract fixture with KTD retained identical contract bodies and
documentation in 3 MCP calls: 4,330 counted tokens for single versus 4,973 for
minimal in one run. Counts include tool schemas, requests and responses, but
exclude initialization instructions, conversation replay, model billing and SAP
HTTP latency. Generated IDs make exact totals vary slightly. No live SAP or LLM
task success was measured. Reproduce with `npm run benchmark:tokens`.

Exact capability-name searches now return only that capability, including when
the query has surrounding whitespace or different letter case. Category, risk
and explicit name filters still apply; partial-name and feature searches retain
ranked results. This also applies to adaptive/minimal discovery. It avoids
returning unrelated tools when the caller already knows the operation name.
For `query: "sap.semantic.components"` with the default limit, a local MCP
response measurement fell from 10 tools / 4,892 bytes / 1,068 `o200k_base` tokens
to 1 tool / 1,002 bytes / 250 tokens. These counts serialize the whole call result
with the generated request UUID normalized; they exclude request/schema tokens,
model billing and live SAP work. The single gateway schema remains 209 tokens.

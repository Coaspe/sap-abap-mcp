# Conditional source reads

Unreleased local builds reduce repeated source text in MCP responses through the
existing `sap.source.read` tool. This complements the SAP-side ETag cache: the
cache reduces backend transfer, while conditional reads reduce returned content.

## Usage

1. Read the required source range normally. Keep its `code` and `contentHash`.
2. Repeat the read with the previous hash in `ifNoneMatch` while that source is still available in your context.
3. If `notModified` is true, reuse the previously read range. The reply has no `code` field.
4. If `notModified` is false, use the returned `code` and new hash.
5. Omit `ifNoneMatch` when earlier code is no longer available, for example after context compaction.

```json
{
  "systemId": "DEV100",
  "objectName": "ZCL_DEMO",
  "startLine": 1,
  "lineCount": 200,
  "ifNoneMatch": "<64-character contentHash from the earlier response>"
}
```

The placeholder must be replaced with the actual returned hash. Normal reads
retain the existing fields and code, with additive `contentHash` and
`notModified: false`. A matching conditional response retains range and paging
metadata, sets `notModified: true`, and omits both code and the redundant source
Resource link. Empty source is distinct from omitted source.

This works with object names, method reads and canonical Resource URIs, through
both direct tools and adaptive invocation. In adaptive mode, describe
`sap.source.read` to obtain its current schema, then include `ifNoneMatch` inside
the invocation's original arguments. Native workflow prompts explain this reuse.

## Scope and freshness

The hash covers the returned representation: canonical system Resource URI,
object/method metadata when present, line range, paging metadata and source text.
It does not hash the whole repository object when only a range was requested.
For `truncated: true`, follow `nextLine` to inspect omitted content. A matching
hash cannot prove that other methods or callers were unchanged.

Every request still goes through the normal authorized source service. The
supplied hash does not bypass SAP access, refresh or validation. An error remains
an error, rather than a successful unchanged result. There is no server-side
cross-user response cache. Different request representations can conservatively
produce different hashes even if their visible code happens to match.

This is a read optimization, not a write precondition. Source writes still use
their existing locked source comparison. Clients implementing the output schema
must account for `code` being absent only on a matching conditional response.
The legacy v0 tool contracts are unchanged.

## Evidence

The direct and adaptive MCP protocol tests use a 200-line source fixture:

| Response | Serialized MCP result bytes |
|---|---:|
| Full source | 29,173 |
| Unchanged source | 974 |

That is **96.7% fewer response bytes in this fixture**, including text and
structured output. It is not a measured model-token ratio or an end-to-end task
cost benchmark. A normal first read pays the small hash/flag overhead, and
conditional calls include the hash argument. Short source snippets may save
little. Clients can always request the full range again.

The additional schema fields cost 271 bytes in the measured tool list, with no
new tool. The adaptive surface at that measurement was 17 tools and 26,457 schema bytes versus
167,230 bytes for the full catalog (84.2% less fixed schema data).

All 449 local tests pass, including changes, system/range/method separation,
paging metadata, URI reads, access failures and malformed hashes. Stdio checks
and the explicit full-surface compatibility check also pass. Live SAP and actual
agent task/token measurements remain separate acceptance work.

Run `npm test` to reproduce the fixture checks and byte measurements.

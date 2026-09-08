# Public contract workflow cost

```sh
npm run build
npm run benchmark:contracts -- --output /tmp/public-contract-cost.json
```

This executes the real MCP server, adaptive gateway and `AbapToolService` against
a synthetic SAP adapter. It compares a root class with three explicit related
types using separate definition/contract calls versus `includeRelated=true`.
Both paths must return identical related public code, source URIs and hashes;
private declarations must be absent. CI runs these assertions and verifies lower
tool-call count and combined bytes for this fixture.

Measured on 2026-09-08, minified UTF-8 JSON bytes:

| Mode | Related contracts | MCP calls | Schema bytes | Request + result bytes | Combined bytes |
|---|---|---:|---:|---:|---:|
| Full | Separate | 7 | 169,159 | 12,342 | 181,501 |
| Full | Integrated | 1 | 169,159 | 6,052 | 175,211 |
| Adaptive | Separate | 9 | 26,821 | 19,228 | 46,049 |
| Adaptive | Integrated | 3 | 26,821 | 12,548 | 39,369 |

Adaptive integration reduces combined bytes by 14.5% in this fixture; excluding
initial tool schemas, request/result bytes fall by 34.7%. This corrects the
previous 21.0% / 46.6% figures: the earlier harness unnecessarily discovered and
described `sap.semantic.definition`, which adaptive mode already advertises.
The harness now calls every advertised tool directly and only discovers deferred
tools. Both paths need the deferred components schema, whose size now includes
the optional documentation input.
Full mode still pays for the full schema catalog, which dominates this short task.

The report separately rechecks each integrated result with `ifNoneMatch`.
The response falls from 5,878 to 708 bytes (88.0% in this fixture), with unchanged
SAP adapter call counts. Request size grows by the validator: 255 bytes in full
mode or 385 via the adaptive gateway. This extra repeat is reported separately
from the table's first-read task so both table paths still perform the same work.
CI verifies that every input is rechecked and no declaration/contract body is
returned on a matching hash. Initial full results pay for the content hash too.

SAP adapter calls change from 7 source reads, 7 structure reads, 3 repository
searches and 3 definition resolutions to 4 source reads, 4 structure reads, no
searches and 3 definition resolutions. These counts are adapter method calls,
not HTTP requests: transport retries, cache validation and SAP endpoint behavior
are outside this fixture. Definition targets are always resolved, not guessed.

The report includes per-stage request/result byte counts and complete MCP result
envelopes, including duplicated text/structured content where present. It excludes
JSON-RPC framing, initialization, host-native discovery, tokenization, conversation
replay and model/SAP network latency. No SAP credentials or customer code are used.
These are reproducible fixture savings, not an ARC-1 benchmark or general token
savings guarantee. Source pages too large for the shared budget still require
follow-up reads; this fixture intentionally fits all contracts in one page.


## Contracts plus KTD

The same command also compares a separate repository inspection for the root
KTD against `documentation` on the integrated public API call. Both paths must
return identical documentation content, URI, page metadata and full-document
hash, in addition to identical contracts. The integrated result's extra
`objectName` field is attribution metadata, excluded only from equivalence
comparison; its bytes remain counted. The synthetic Unicode document fits the
2,000-character page. No document bodies are persisted in the report.

| Mode | Contracts and KTD | MCP calls | Request + result bytes | Combined bytes |
|---|---|---:|---:|---:|
| Full | Separate | 8 | 16,075 | 185,234 |
| Full | Integrated | 1 | 8,903 | 178,062 |
| Adaptive | Separate | 10 | 22,961 | 49,782 |
| Adaptive | Integrated | 3 | 15,399 | 42,220 |

For adaptive mode, combined bytes fall by 15.2%, and request/result bytes by
32.9%. One KTD adapter read occurs in either path. Integration also reduces
source/structure adapter reads from eight each to four each, and searches from
four to zero. The conditional repeat still performs the one document read and
all contract input reads, returning a 708-byte MCP result. This remains an
in-process fixture, not live SAP or an independent ARC-1 comparison.

## Tokenizer measurement

From a development checkout after `npm ci`, run:

```sh
npm run benchmark:tokens -- --output /tmp/public-contract-tokens.json
```

This optionally loads the pinned development-only `js-tiktoken` dependency and
encodes each minified schema array, request and complete result with
`o200k_base`. No ranks are downloaded during measurement. The default byte-only
benchmark still works without development dependencies. Neither the MCP server
nor published runtime imports the tokenizer. CI checks that integrated workflows
retain identical content while reducing both bytes and tokenizer counts.

One local run on 2026-09-08 measured:

| Payload/workflow | Separate/full | Integrated/adaptive |
|---|---:|---:|
| Initial tool schemas, full vs adaptive | 42,150 | 6,583 |
| Adaptive contracts only, separate vs integrated | 12,166 | 10,004 |
| Adaptive contracts plus KTD, separate vs integrated | 13,127 | 10,687 |

Workflow totals include the initial schema once. For the KTD task, request/result
tokens alone fell from 6,544 to 4,104 (37.3%); including schemas, the reduction
was 18.6%. Random request IDs can slightly vary payload token counts across runs.
The JSON report separates schema, request, response and conditional-repeat counts.

This is a local encoding measurement, not the tokenizer or billed usage of every
model. It does not include model-specific tool formatting, message framing,
conversation replay, cached-input pricing or host processing. Both text and
structured response representations are counted; hosts may handle them differently.
It therefore cannot establish an actual Claude/Codex bill or ARC-1 superiority.

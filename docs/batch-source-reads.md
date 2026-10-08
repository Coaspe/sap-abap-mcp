# Bounded batch source reads

`sap.source.read_batch` accepts up to 100 objects and 5,000 requested lines
in total. Returned source code now shares a 64 KiB UTF-8 budget across the
whole batch, in request order. This supplements existing per-object limits.
The budget counts code, not JSON metadata or duplicated MCP representations.

Check root `truncated`, `returnedSourceBytes` and `sourceByteLimit`, then each
successful item's `result.truncated` and `result.nextLine`. Lines are never
split. When the budget omits a line, `truncationReason` is `batch_byte_budget`;
`endLine` can be `startLine - 1` if no complete line fits. Other objects can
still return smaller lines that fit the remaining budget.

Resume only needed objects in a smaller batch using the one-based `nextLine`
as the v1 request's `startLine`. Prefer `sap.source.read` when reading one
object or a single line exceeding 64 KiB, since repeating that giant line in
another batch cannot make progress. The underlying legacy service batch API
uses zero-based request offsets; v1 tool inputs use one-based line numbers.

Source reads execute in groups of four. Once a group hits the code budget,
later groups are deferred without reading SAP. Already-started reads in the
current group still complete. Source snapshots are not atomic across objects. Per-object failures remain separate from successful
results. These original bounds introduce no new tool.

Local tests verify a Unicode batch retains complete lines within 65,536 bytes,
resumes an omitted object without data loss, and returns a continuation for an
oversized single line. The complete suite passes 509 tests.

Failed items reuse the existing diagnostic redaction routine before returning
error text. Recognized authorization/token/password assignments are redacted,
and each message is limited to 512 UTF-8 bytes. This applies in the shared
service, including legacy callers; successful source is not passed through the
error sanitizer. The mixed success/failure regression includes a long Unicode
error containing synthetic credentials and verifies the other object's source
remains intact. The complete local suite now passes 510 tests.

The v1 MCP envelope reports `partial` when any item fails or is truncated, and
`succeeded` only when every item succeeds without truncation. Per-item results
remain available even when all items fail; callers must inspect their `ok` flags.
The v1 adapter echoes each request using the original one-based `startLine`,
matching the tool input and returned `nextLine`. Legacy service offsets remain
zero-based internally. MCP client tests cover complete, truncated and failed
batches and verify the reply validates against its advertised output schema.
The complete local suite passes 511 tests.

Each batch now runs at most four object-read operations concurrently, rather
than launching up to 100 at once. Completion order does not change response
order or which object receives the shared byte budget. A failed object frees
its slot and the rest continue. This is a per-batch limit, not a global SAP
HTTP request limiter; other requests/sessions and transport internals remain
outside its scope. On unconstrained systems large batches can take longer, but
one batch no longer creates 100 simultaneous object-read operations.

A gated nine-object test forces reverse completion and one failure, verifies
peak concurrency of four, and confirms all results retain request order. The
complete local suite passes 512 tests. No tool schema or user setting is added.

## End-to-end cost, including continuation

Run `npm run benchmark:batch` after building. It uses the real adaptive MCP
server/service and synthetic source, checking byte-for-byte reconstruction of
all five objects from the returned pages. Discovery/description and every
continuation call are included. CI runs the assertions; no SAP is contacted.

One local run before the latest description wording measured:

| Fixture | Separate reads | Batch with continuation |
|---|---:|---:|
| Small ranges: MCP calls | 5 | 2 |
| Small ranges: request/result bytes | 37,940 | 38,106 |
| Large ranges: MCP calls | 5 | 5 |
| Large ranges: request/result bytes | 417,940 | 425,557 |
| Large ranges: source adapter reads | 5 | 12 |

The shared initial schema adds 26,821 bytes to either workflow. Batching reduces
calls for small ranges but does not guarantee fewer payload bytes. For large
ranges it can cost more because sources for omitted ranges are read again on
continuation. Prefer individual `sap.source.read` calls for known large ranges;
batching is intended for several small ranges that fit its shared budget.
The 64 KiB cap bounds batch code output; it is not evidence that each batch
response is smaller than an individual read. Adapter reads are not HTTP counts,
and payload bytes are not model tokens or billed usage.


## Requests deferred before SAP execution

After a group hits the byte budget, later items have `ok: false` and
`deferred: true`, with their original request and a bounded explanation. They
have not been read from SAP; this is different from a backend failure. Retry
these requests unchanged in a smaller batch. For already-read truncated items,
continue using `result.nextLine` as before. Both cases make the v1 envelope
`partial`. No invented object URI or source metadata is returned for deferred items.

A twelve-object oversized fixture now starts only the first four reads and
marks the remaining eight as deferred, retaining request order. The end-to-end
benchmark also follows these deferred requests and verifies exact reconstruction.
The five-object large-range fixture decreases from twelve to eleven source
adapter reads; this remains more than five separate reads, so the recommendation
to use individual reads for known large ranges still applies. Four-read groups
can wait for their slowest member before starting the next group. All 513 local
tests pass, including v1 deferred status and one-based request preservation.

## Conditional batch rechecks (unreleased)

Keep each successful item's code and `result.contentHash`. To recheck that same
system, object and requested range, add the hash as the item's `ifNoneMatch`:

```json
{
  "systemId": "DEV100",
  "requests": [
    { "objectName": "ZCL_ORDER", "startLine": 1, "lineCount": 100,
      "ifNoneMatch": "<64-character hash from this batch item's earlier result>" },
    { "objectName": "ZCL_ITEM", "startLine": 1, "lineCount": 100 }
  ]
}
```

Replace the placeholder with a real hash. `notModified: true` omits `code` and
requires reuse of the retained earlier range. `notModified: false` includes
current code, including an empty string for empty source. Omit the validator
when the earlier code is unavailable, including after context compaction.
Batch hashes describe batch items; do not interchange them with validators
from `sap.source.read`, SAP ETags, or write preconditions.

Every scheduled object still follows the authorized source-read path. There is
no response cache or credential shortcut. The validator includes the normalized
system/object, requested range, source URI, returned code and paging metadata.
An unchanged page can still be truncated: follow `nextLine`, and inspect `ok`
and root `partial` status. Source outside that page has not been verified.

Matching code consumes zero bytes of the shared output budget. Changed items
and first reads use the same 64 KiB limit and continuation rules. The hash of a
byte-truncated page cannot suppress source that becomes available when more
budget is free. Failed/deferred items retain their original retry arguments;
successful `request` fields identify the range without repeating `ifNoneMatch`.
`returnedSourceBytes` counts only code actually returned in this response.
The legacy v0 batch schema and response remain unchanged.

Run `npm run benchmark:conditional-batch -- --tokens` for the real MCP client
and service with synthetic sources. It compares separate/full/conditional
reads and batches in four modes, including first reads, descriptions, one
external edit and zero/one/twenty unchanged rounds. Every object is restored
exactly; bytes and optional o200k estimates include both MCP result renderings.
The benchmark reports schema overhead and source-adapter reads separately.
It does not measure billed tokens, model correctness, live SAP HTTP calls or
agent success. Large-range continuation is covered by `benchmark:batch` and
protocol tests, separately from this small-range workload.

The 2026-10-01 default-minimal run (five 100-line objects, twenty unchanged rounds,
then one external edit) measured:

| Strategy | MCP calls | Source-adapter reads | Estimated total tokens |
| --- | ---: | ---: | ---: |
| Previous full batch | 23 | 110 | 512,408 |
| Existing individual conditional reads | 111 | 110 | 77,682 |
| Conditional batch | 23 | 110 | 69,266 |

The default schema remains five tools / 880 o200k tokens, and single mode
remains one tool / 215 tokens. The full catalog grows by 43 schema tokens;
minimal/adaptive/single do not preload this hidden capability. First reads pay
the new item hash/flag overhead; savings depend on retained code and repeated
or partially changed ranges. These totals count the schema once, initialization
instructions, known-name descriptions, requests and both result renderings.
They are fixture estimates, not provider billing or comparative agent success.
All 628 tests pass, including revoked access, Unicode budgets, empty source and
truncated-page recovery. [Full evidence](competitive-conditional-batch-2026-10-01/verification.json).

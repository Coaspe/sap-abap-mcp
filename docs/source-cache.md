# SAP-revalidated source cache

Unreleased local builds retain eligible source responses in memory for the
lifetime of one `AdtSapClient`. No new MCP tools, settings or dependencies are
added. Source is not persisted to disk.

Each source read still resolves its source URI and checks SAP. With a cached
ETag, the request includes `If-None-Match`; a 304 response reuses the body that
SAP just validated. A 200 response replaces it. The implementation handles both
ordinary 304 responses and the exceptions produced by abap-adt-api's HTTP adapter.

| Situation | Behavior |
|---|---|
| Changed source | Return the new body and replace the validator |
| Missing ETag, `no-store` on the source response, oversized body | Return the body without retaining it |
| Authentication, authorization, deletion or server error | Evict the entry and propagate the failure; never serve stale source |
| Activation, source edit or other serialized mutation | Clear the connection cache before and after the operation, including failures |
| Logout | Clear memory before closing the SAP session |

Entries are separated by exact source URI and requested version, including
unspecified, active and inactive variants. Connections do not share cache state.
Retention is limited to 64 entries, 8 MiB of source bodies, and 512 KiB per entry.
Bodies larger than that remain readable but are not cached. No TTL is used to
declare source fresh: SAP remains the authority on every hit.

If an in-flight read overlaps a local cache invalidation, it cannot repopulate
the cache with its old snapshot. That read reports a conflict. Source writes
still acquire the SAP lock and read current source directly through the original
uncached API before comparing the expected source. Caching therefore does not
replace optimistic concurrency protection.

## What this saves

A 304 response avoids retransmitting an unchanged source body from SAP. It does
not eliminate the source HTTP request. Object URI discovery still uses a
source-structure lookup; explicit source files skip that lookup. It does
not shorten the source returned to an MCP client. This is a transfer-cost
improvement, not a measured model-token reduction. The fixed tool schema surface
remains unchanged at 17 tools in adaptive mode.

## Verification

The complete local suite passes 506 tests. Added tests cover ETag changes,
versions, errors, retention limits, connection separation, in-flight invalidation,
activation, and uncached locked write checks. A local HTTP server also exercises
the installed ADT client's real 200/304 normalization path. The measured adaptive
and explicit full stdio modes continue to pass their smoke checks.

These are local tests, not live SAP backend acceptance. ETag support and its
correct authorization/freshness behavior still need verification on each target
SAP release. Backends without validators simply continue returning full bodies.

Run `npm test` to reproduce the local checks.

For reducing repeated MCP source responses as well, see
[conditional source reads](conditional-source-reads.md).

## URI probing and failure preservation

Object/source URI discovery now stops on known authorization, rate-limit, server
or transport failures, preserving the original error for MCP classification.
A failed source read during object URI discovery only probes another candidate for 404, 405 or 501 endpoint
compatibility responses. Local `SOURCE_CHANGED` conflicts are terminal too.
The initial structure probe still permits unclassified legacy parser errors,
because older SAP object types can lack compatible structure metadata.
This avoids redundant requests; it does not add automatic retries or turn
failed authorization into an empty source result.

Explicit `/source/main` and class `/includes/...` locations are read directly,
without resolving or substituting the owning object's main include. This keeps
local declaration reads on the requested file and avoids a metadata request.
Their failures, including 404, propagate unchanged. Version selection and ETag
revalidation still apply. Regression tests cover main, definitions,
implementations and testclasses paths, encoded namespaces, and error propagation.

## KTD representation reuse

KTD document reads share the same per-connection cache and mutation/logout
invalidation. Cache identity includes the requested Accept media type as well
as URI and version. Each page still checks SAP before reusing the XML body;
conditional HTTP responses reduce backend transfer, not the Markdown returned
to the model. XML decoding and document hash generation still run for each page.

## Revalidation policy changes

A 304 response can update cache metadata, per
[RFC 9111 section 4.3.4](https://www.rfc-editor.org/rfc/rfc9111.html#section-4.3.4).
The cache now drops retained content when a readable 304 carries `no-store` or
`Vary: *`. A mismatched ETag rejects the old body with `SOURCE_CHANGED`; weak
and strong forms of the same tag remain usable.

The pinned ADT adapter can turn an empty 304 into an exception that discards
response headers. Its Axios wrapper does not forward `validateStatus`. When
headers cannot be inspected, the current validated body is returned but the
entry is evicted; the next request fetches a full response and its policy. This
reduces repeat-transfer savings on that transport. It avoids retaining a body
under an unknowable updated policy without replacing the shared SAP transport.
A local HTTP-server regression test exercises the actual ADT adapter path.


## Concurrent reads

Overlapping reads of the same URI, version and Accept representation on one
connection share the in-flight SAP request when its response remains eligible
for retention. A later read still revalidates with SAP; there is no freshness
TTL. The regression fixture reduces eight simultaneous identical reads to one
request, followed by a second request for the later revalidation. This measures
local transport callback calls, not live SAP latency or model-token savings.

Per [RFC 9111 section 4](https://www.rfc-editor.org/rfc/rfc9111.html#section-4),
responses that cannot be reused must be forwarded separately. Waiting readers
therefore make their own request after `no-store`, `Vary: *`, missing validators,
oversized content or a 304 whose policy headers are unavailable. This can add
waiting time for uncacheable sources. Errors propagate to the existing waiters;
a future read can try again.

Mutation/logout clears pending lookup state as well as retained entries. A new
read after invalidation never joins an earlier request; late earlier responses
cannot repopulate the cache, and late failures cannot evict a new validator.
The in-flight map lives only for outstanding requests and introduces no new
settings, tools or fixed schemas.


Delivery checks also cover invalidation after the HTTP continuation has finished
but before the shared result reaches its caller. Both the leading request and
a follower's separate uncacheable request check the generation at final delivery.
Deterministic microtask-order tests reproduce these boundaries without timing
sleeps. An overlap returns `SOURCE_CHANGED` rather than earlier source. This
covers local invalidation; external changes still rely on SAP revalidation.

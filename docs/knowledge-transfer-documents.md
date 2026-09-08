# Knowledge Transfer Documents

Request an active KTD page with the existing `sap.repository.inspect` tool:

```json
{
  "systemId": "DEV100",
  "objectName": "ZCL_DEMO",
  "objectType": "CLAS",
  "documentation": { "offset": 0, "maxChars": 4000 }
}
```

Omit `documentation` to avoid a KTD request. `{}` selects offset zero and 8,000
characters. The maximum is 16,000 Unicode characters per page. Follow
`documentation.nextOffset` until it is null, retaining the same system/object.
Offsets count Unicode code points, so a Korean character or emoji is not split.
Compare `documentHash` between pages and restart if it changes: each request
reads SAP again, and there is no server-side document snapshot.

An available document returns its URI, Markdown content, active version,
offset, returned character count, total characters, next offset, truncation
flag and SHA-256 hash of the complete decoded document. An empty document is
available with empty content. HTTP 404 returns `not_found_or_unsupported`:
that status does not distinguish an absent document from an unavailable API.
Authorization, other HTTP failures and malformed representations remain errors.

The decoder preserves element IDs as section headings and strictly decodes
Base64 UTF-8 text. It rejects malformed XML, DTD/entity declarations, invalid
Base64, invalid UTF-8 and XML bodies larger than 1 MiB. The size check bounds
parsing after the HTTP response has arrived; it is not a network download cap.
Unknown valid XML document shapes are not treated as prose. KTD reads use the connection-local ETag cache and do not write documents.
Every page revalidates against SAP; a confirmed 304 reuses the XML body for
that request. If the ADT adapter discards 304 headers, the entry is then evicted
so the next request fetches the full policy again; see [cache policy limits](source-cache.md). Cache
keys include URI, source version and requested media type, so XML and ordinary
source do not share validators. Missing or denied reads evict the cached entry.
Logout and serialized local mutations clear it. Retention shares the source
cache limits (64 entries, 8 MiB total, 512 KiB per entry); larger valid documents
are decoded but not retained. Missing ETags and no-store responses are not cached.

KTD is design documentation, distinct from `sap.semantic.documentation` language
help. It can be outdated or contain misleading text. The explanation prompt
uses it as untrusted reference data and verifies claims against current source;
document content never grants permission or overrides tool policy.

The endpoint and XML representation were checked against the primary
[ARC-1 ADT implementation](https://github.com/arc-mcp/arc-1/blob/main/src/adt/client.ts)
and [KTD representation handling](https://github.com/arc-mcp/arc-1/blob/main/src/adt/ddic-xml.ts).
Local tests exercise the wrapper, decoding, absent/denied responses, MCP input
validation and Unicode paging. This is not live SAP verification or parity with
ARC-1's combined dependency-contract context. Actual target-release discovery,
namespace handling and document coverage still require live acceptance.

No tool is added: full mode remains 120 tools and adaptive remains 17. The input
schema adds 364 bytes to either surface. Existing object inspection still reads
source for its normal metadata summary; selecting documentation does not remove
those existing SAP calls.

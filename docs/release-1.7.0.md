# 1.7.0 release and verification scope

The release promotes the company-tested 1.7.0-beta.1 runtime from commit
`77cdc6355ff7b9b93451fd0ad1735afd20be1825`. The final promotion changes
version metadata and release documentation, not runtime feature code.
The reconciled tree incorporates the actual npm 1.6.0 contract; see
[reconciliation](reconciliation-1.7.0-beta.1.md). Main history is merged
without replacing the verified reconciled source with older release code.

## Company acceptance reported by the user

On 2026-09-08 the user supplied screenshots of Claude Code's test summary.
This is user-supplied acceptance evidence, not a SAP run performed by the
release agent. The tested beta's version, source commit and archive SHA-256
matched the delivered build. Basic authentication was used against one
on-premise ABAP development system and one existing custom class.

- Package smoke checks (five modes), profile conformance and connection
  diagnostics passed. Claude Code discovery, describe and read invocation passed.
- The live read runner reported eight successful stages, including conditional
  source and public-contract revalidation. Repeated responses omitted unchanged
  bodies. Related types were returned with explicit coverage limits.
- KTD returned not_found_or_unsupported; document bodies were not validated.
- An initial PC-wide TLS bypass was removed for a repeat run: diagnostics
  reported TLS ok and all eight read stages passed with certificate validation
  enabled. The server certificate chain was reported as publicly trusted.

No claim is made for live writes, activation/deletion, SQL/export, transports,
ABAP Unit/ATC, BTP/OAuth/bearer authentication, HTTP hosting, inherited member
resolution, KTD bodies, or complete repository/type coverage. The reported
certificate expiry was approximately two months away; renewal remains a system
administration task, not a package change.

## Interface clarifications

- `sap.repository.search` accepts name pattern, object types and limit.
  `packageName` is returned metadata, not a supported search filter.
- To expose all direct tools use `--toolsets all`; `--preset full` is invalid.
- New CLI sessions default to minimal (five gateways); all 120 v1 capabilities
  remain discoverable. Native v0 retains 53 tool definitions.

The beta passed 548 local tests on Node 20 and 24 plus packed-runtime checks.
The final release is rebuilt and tested by the provenance-enabled npm workflow.

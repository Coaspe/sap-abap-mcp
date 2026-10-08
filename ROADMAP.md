# Roadmap

SAP ABAP MCP follows an evidence-first roadmap. Dates are intentionally absent:
an item is complete only when its contract, automated tests, documentation, and
applicable live-SAP evidence agree.

## Now

- Keep npm, GitHub Releases, the Official MCP Registry, MCPB, Smithery, and
  directory metadata aligned with the same stable version.
- Publish the v1 compatibility profile and implementation-independent
  conformance evidence.
- Expand sanitized live-SAP evidence across ECC, S/4HANA, and ABAP Cloud
  without publishing customer systems or source.
- Recruit verified adopters and document reproducible workflows.

## Next

The [2026-10-01 competitor and setup review](docs/competitive-research-2026-10-01.ko.md)
defines acceptance criteria for BTP identity verification, guided advanced
authentication, first-user setup, and identical-task comparisons. Recovery
guidance, MCP progress notifications, guided OAuth/BTP service-key authentication,
batched capability descriptions, and read-only first-run access scope are implemented locally, pending release;
they do not close the live BTP/SSO or comparative task-success gaps.
Existing registration comparison and the actual Claude CLI argument-order fix
also have isolated local evidence; cross-platform installation and live SAP
first-query acceptance remain open.
Conditional batch source rechecks also have local protocol and complete-workload
token estimates, with unchanged minimal/single schemas; live task/billing
acceptance remains open. See [batch source reads](docs/batch-source-reads.md).
Desktop credential renewal can explicitly reopen the existing local setup
wizard without another CLI, with per-profile cache invalidation after saving;
native host and live identity-provider acceptance remain open.
HTTP OIDC deployments also have protected-resource metadata and 401 discovery
for a reviewed public HTTPS endpoint, with real SDK PKCE/signed-token fixture
acceptance. External IdP registration, resource/audience mapping and native-host
login remain acceptance gates; this does not claim a deployed BTP OAuth service.
The checkout now refuses direct MCP-token forwarding to SAP, including legacy
passthrough profiles, and rejects Internet exchange headers that reuse the input
token. Existing files remain readable. Local SDK/HTTP tests preserve Destination
exchange/Connectivity assertions and independent SAP credentials; real BTP
identity, proxy configuration and SAP permission acceptance remain open.
The browser setup also has captured Korean/English backward-navigation and
keyboard evidence: a freshly saved profile appears immediately for reuse,
the current step number resets and focus follows the new heading. SAP validation
and credential persistence in those UI checks are synthetic; native-host,
protected-store and novice-user first-query acceptance remain open.
Dependency patch refreshes also preserve the recorded workload while reducing
production audit affected-package counts from eight to four. The remaining
node-forge/SAP SDK warnings, upstream patch availability and deployment-specific
reachability remain tracked; this is not a zero-vulnerability release claim.
Synthetic SDK certificate-call tracing now has a positive instrumentation control
and three-runtime local evidence. Maintained Node 22/24 LTS and minimum-compatible
Node 20 pass the existing suite and workload; native hosts, other operating
systems and remote CI still require acceptance. Node 22 is added to CI coverage.

Saved target/authentication changes also invalidate cached direct and HTTP
Destination clients on their next acquisition. Policy-only changes keep the
existing session; no new MCP schema or call is introduced. Local regressions
pass, while live SAP profile-edit acceptance remains open.

The pinned MCP SDK is also refreshed within 1.x to reject oversized HTTP
message batches before tool execution. The 101-message regression and normal
workload pass locally without changing tool schemas or token estimates; the
remaining SAP SDK/node-forge audit warnings are not suppressed.

- Add SAP principal propagation. Per-person SAP profiles already give per-person
  SAP attribution and authorization, but the server still holds each person's SAP
  credential. Forwarding an end-user token into SAP requires Cloud Connector or
  the BTP `OAuth2UserTokenExchange` flow.
- Add BTP Cloud Foundry deployment with XSUAA and the Destination Service, so an
  existing BTP landscape can host the server without bespoke configuration.
- Add an audit sink for the BTP Audit Log Service alongside the file and stderr
  sinks.
- Define an admin-governed Dynpro extension profile for systems where public
  ADT endpoints do not provide the required screen CRUD operations.
- Add end-to-end Fiori workflows that compose RAP/OData backend generation
  with established SAP Fiori project tooling instead of duplicating it.
- Add more conformance levels for safe writes, quality gates, transports, RAP,
  runtime analysis, and cross-system operations.
- Publish compatibility evidence produced by independent implementations.

## Later

- Propose the compatibility profile through a neutral, multi-maintainer
  governance process after at least three independent organizations have
  adopted it.
- Add additional authentication and enterprise deployment models only when
  they preserve the local secret and authorization boundaries.

## How decisions are made

Open a [GitHub Discussion](https://github.com/Coaspe/sap-abap-mcp/discussions)
for proposals that change public contracts or security boundaries. Open an
issue for a reproducible defect. A roadmap entry is not a promise of SAP
backend availability or a substitute for SAP product documentation.

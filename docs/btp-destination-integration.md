# BTP Destination integration: verified design boundary

Status: experimental profile-to-transport integration implemented and tested
locally on 2026-09-08. Actual BTP operation is not yet verified. Later sections
retain the investigation and implementation stages in chronological order.
No live SAP/BTP connection is available in this checkout. The latest registry
versions observed for `@sap-cloud-sdk/connectivity` and
`@sap-cloud-sdk/http-client` were both 4.9.1. The linked repository main sources
are architectural evidence, not a claim that they exactly match those archives.

## Experimental local checkout usage

Build this checkout, then create a Destination profile without a stored password:

```sh
npm run build
node dist/src/index.js profile add BTP100 --url https://your-abap-host --client 100 --auth-type btp-destination --destination-name ABAP_DEV --destination-auth OAuth2UserTokenExchange
```

For Cloud Connector, select `--destination-auth PrincipalPropagation` and the
destination's exact virtual SAP URL instead. Configure the existing HTTP OIDC
listener with the BTP identity provider and required Destination/XSUAA bindings;
principal propagation also needs Connectivity Service and Cloud Connector.
See [HTTP deployment](http-deployment.md) for listener configuration. This
profile requires the authenticated caller JWT to be usable by the BTP SDK;
configuring an arbitrary OIDC provider does not establish BTP trust.

The HTTP session creates a private ADT client using the refreshing Destination
transport. Shared/direct connections and API-key-only or stdio requests cannot
use this profile. `profile add --login` and `auth login` reject it with an OIDC
session instruction. Existing browser onboarding only edits Basic profiles;
use the CLI for this experimental mode. This command is for the local checkout,
not a claim that the published npm release contains it.

CLI/profile and manager tests verify persistence, local-login rejection, absence
of stored-password reads, and separate ownership for two users. They do not
prove live token exchange, Cloud Connector reachability or SAP permissions.

For local setup checks, run:

```sh
node dist/src/index.js auth status BTP100
node dist/src/index.js doctor BTP100
```

`auth status` identifies HTTP OIDC as the credential source and states that no
local password is required. BTP `doctor` inspects only `VCAP_SERVICES` in its own
process environment, so run it in the same deployment environment as the HTTP
server. It reports missing, duplicate or malformed bindings without printing
service instance names or credentials. Alternative SDK binding sources are not inspected.
It exits with code 2 even when bindings are present because it has not connected
to SAP. Finish verification through an authenticated MCP session with
`sap.system.inspect`; binding presence is not credential or connection validation.

## Evidence that changes the implementation plan

SAP's [destination accessor](https://github.com/SAP/cloud-sdk-js/blob/main/packages/connectivity/src/scp-cf/destination/destination-accessor.ts)
resolves destinations from multiple sources, including environment, registered
values, service bindings and Destination Service. A destination name alone does
not prove that a platform-managed destination or user-propagating authentication
was selected. The adapter must validate the resolved destination before use.
The same source documents XSUAA and Destination bindings for service resolution.

SAP's [HTTP executor](https://github.com/SAP/cloud-sdk-js/blob/main/packages/http-client/src/http-client.ts)
builds destination headers and agent/proxy configuration and then merges request
configuration. Authentication/proxy headers must not be overridden by ADT's
ordinary direct-connection credentials. Its CSRF handling is optional.
The [v4 upgrade guide](https://github.com/SAP/cloud-sdk-js/blob/main/V4-Upgrade-Guide.md)
notes destination caching is enabled by default. Initial integration should
explicitly disable cross-call destination caching until tenant/user isolation
has been verified; source caches must remain scoped to the resulting SAP client.

Installed `abap-adt-api@8.4.1` accepts a custom `HttpClient` as the first
`ADTClient` constructor argument. That interface receives `url`, `method`,
`headers`, `qs`, `body` and transport options and returns a string body with
status, status text and response headers. Its higher ADT layer owns cookies,
CSRF and stateful session handling. Therefore a transport adapter can reuse
existing ADT operations without reimplementing 120 MCP tools.

However, constructor injection alone is insufficient in the pinned 8.4.1
implementation. `AdtHTTP` assigns an empty `baseURL` for a custom transport;
`ADTClient.statelessClone` then constructs its clone from that empty URL instead
of preserving the transport. A local, network-free reproduction on 2026-09-08
created `new ADTClient(customTransport, "TRANSPORT_TEST", "fixture-only")` and
accessed `statelessClone`: it threw `Invalid ADTClient configuration: url, login
and password are required`, with zero transport requests. Current direct URL
connections do not exercise this failure.

Our syntax checks, completion, definition navigation and debugger listener use
that clone. Debug execution also constructs a separate client directly from
`profile.url`. Destination integration must route both paths through the same
identity-bound transport factory while preserving independent ADT session state.
Do not expose a Destination profile after testing only the main source reader.

### Implemented transport prerequisite

`AdtSapClient` now accepts an optional internal `AdtTransportFactory`; a single
creation path is used for the main and debugger execution clients.
`TransportAdtClient` preserves that factory for a lazily created stateless clone,
keeps separate ADT cookie/CSRF state and attempts logout for both logged-in
sessions even if one fails. Existing direct URL connections retain the upstream
client. The factory must bind all transports to the same endpoint and identity;
it must not maintain an independent shared ADT cookie jar.

Three regression tests exercise the real pinned ADT implementation:

- A loopback HTTP fixture verifies login query parameters, Unicode source reads,
  ETag/304 reuse, encoded navigation parameters and POST body, separate cookies
  and CSRF tokens, and logout of both sessions.
- A transport fixture checks clone reuse, rejection of stateful mode on clones,
  and cleanup of the second session when the first logout fails.
- A debugger fixture checks that listener and execution requests use the custom
  bearer transport, with stateless listening and separate stateful execution.

These initial transport fixtures do not emulate BTP Destination resolution,
token exchange, proxying or SAP authorization. They added no profile mode or
MCP tool.

### SAP Cloud SDK HTTP bridge

`destination-transport.ts` now uses the pinned 4.9.1 SDK to execute ADT requests
against an already resolved destination. SDK loading is dynamic and confined to
creation of this transport. Both SDK packages are runtime dependencies; installing
the package still installs them even when using a direct connection.

The bridge preserves the destination's authentication and proxy configuration,
ignores conflicting ADT transport credentials/agents/base URL, and retains ADT's
cookies and CSRF headers. SDK CSRF fetching and redirect following are disabled.
Bodies remain strings even with a JSON content type; status, ETag, cache policy
and multiple Set-Cookie headers survive, including 304 and HTTP error responses.
Transport failures do not retain SDK error objects containing credentials.

An actual SDK-to-loopback HTTP test verifies those behaviors plus the on-premise
proxy route using a local proxy endpoint and fixture principal-propagation
headers. It also reproduced an SDK encoding trap: ordinary custom query values
are treated as already encoded, losing `#start=...` in navigation URIs. The bridge
sets `parameterEncoder: encodeAllParameters` and tests exact URI round trips.

This is a low-level bridge, not yet a user-selectable Destination profile. The
bridge itself does not resolve destinations, validate the caller's identity,
perform token exchange or prove Cloud Connector connectivity. The real SDK proxy test supplies
fixture tokens and cannot establish SAP-side identity or authorization.

### User Destination resolver

`user-destination.ts` calls the public SDK
`getDestinationFromDestinationService` accessor with the caller JWT,
`alwaysSubscriber` and `useCache: false`. It bypasses environment/registered
destinations and does not fall back to a provider-account destination. Missing
caller tokens fail before lookup; SDK lookup failures return a fixed message
without retaining SDK error objects or service credentials.

After resolution it checks the configured URL, SAP client and exact requested
authentication mode. Internet user-token exchange requires HTTPS and one
successful Bearer exchange result; a reported non-positive or invalid lifetime
is rejected. Principal propagation requires
an OnPremise destination with both proxy and user propagation Bearer headers.
Technical-user modes, trust-all TLS, direct token forwarding and conflicting
configured authentication headers are rejected. These are deliberately explicit
initial compatibility limits, including the subscriber-only selection policy.

Four offline tests exercise repeated calls for two users, endpoint/client/auth
mismatches, propagation headers, missing identity and error sanitization. Their
SDK service boundary is injected: they do not prove successful Destination
Service access or token exchange. The input JWT must come from the authenticated
HTTP caller; the resolver does not authenticate that JWT itself. Connecting this
resolver to an identity-scoped profile and validating the actual BTP flows remain
required before exposing the feature to users.

The existing identity-scoped connection provider now has terminal, idempotent
closure. A profile lookup that finishes after closure cannot start a new user
login. A login already in progress is awaited and logged out once, and its client
is not returned to the waiting caller. Shared direct connections remain owned by
the shared manager. Deterministic lifecycle tests cover both races; this is also
a prerequisite for safely owning Destination clients in the HTTP session.

OIDC token rotation now invalidates the old MCP session and disposes its SAP
scope. The response is HTTP 404, requiring initialization with the refreshed
token. An HTTP regression test verifies both cleanup and forwarding of the new
token to the new session. This fixes retention of the opening SAP bearer token;
it does not yet refresh exchanged Destination credentials inside a SAP client.

The subsequent `createUserDestinationTransportFactory` composes service-only
resolution with the SDK HTTP bridge. It snapshots the configured endpoint and
caller token and resolves fresh credentials for every ADT HTTP request, including
requests from stateless clones. There is no retained exchanged token or stale
fallback: lookup failure prevents the SAP request. ADT continues to own and
forward each session's cookie and CSRF state.

This deliberately incurs one Destination lookup per ADT request; it is not a
claim of optimal latency or service-call cost. A local SDK/proxy regression test
verifies changed credentials on successive requests, no request after failed
refresh, binding despite mutation of the caller's input object, and isolation
between two users and clone transports. Actual BTP token exchange remains
unverified, and the factory still needs integration with a selectable profile.

## Intended integration, not a new working configuration

1. Add an explicit Destination-backed profile mode. Keep current Basic,
   client-credentials, browser OAuth and direct bearer passthrough semantics.
   Do not silently reinterpret an existing profile as token exchange.
2. Resolve the destination with the already-authenticated HTTP caller's JWT.
   Validate the chosen auth/proxy mode and endpoint against the configured
   profile; do not fall back to a technical user when propagation is required.
3. Inject the SDK-backed transport into the existing ADT client. Preserve
   raw XML/text, encoded paths, query parameters, cookies, all response headers,
   304 responses, error classifications and ADT's CSRF/stateful behavior.
   Do not enable a second independent CSRF/session implementation.
4. Keep the connection inside the existing identity-scoped provider. Reject
   absent identity and unsupported destination modes. Verify renewal, logout,
   tenant/user separation and policy enforcement before enabling caching.
5. Load BTP dependencies only for this profile mode, with no additional MCP
   tools or default schema growth. Add diagnostic setup output for missing
   bindings/destinations; never print service credentials or exchanged tokens.

## Acceptance evidence still needed

Offline contract tests must cover header precedence, body/query fidelity,
encoded namespaces, 304 retention policy, error conversion and separate users.
A local HTTP adapter test must exercise real ADT login, CSRF and cookie reuse.
Live BTP validation must demonstrate both ABAP Environment user-token exchange
and on-premise Cloud Connector propagation with two users of different SAP
permissions. It must also show failure without required bindings or identity.
Until those checks pass, README's existing token-exchange limitation remains
accurate. The current stdio modes and protocol conformance pass, but that is not
BTP acceptance evidence.

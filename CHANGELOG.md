# Changelog

All notable changes to `@coaspe/sap-abap-mcp` are documented here. This project follows semantic versioning.

## Unreleased

## 1.3.1 - 2026-08-19

### Fixed

- **Published directory documentation**: release and marketplace status now describes the current 120-tool catalog without retaining the previous 1.2.0/115-tool wording in the npm README. Version metadata remains synchronized across npm, the Official MCP Registry, MCPB, LobeHub, and the Claude Code/Codex repository marketplace.

## 1.3.0 - 2026-08-19

### Added

- **Structured DDIC workflows**: `sap.ddic.read` and `sap.ddic.update` read and update typed Domain/Data Element properties, while Tables and Structures use guarded DDL source with optimistic fingerprints, syntax checks, activation, transport policy, and read-back verification.
- **Classic Screen and GUI Status bridge**: opt-in `sap.classic.read` and `sap.classic.write` tools reuse the configured SAP origin, ADT session, CSRF protection, package restrictions, transport policy, exact confirmation, and production guardrails. The bridge path must be relative to `/sap/...`; installation and support boundaries are documented in [`docs/classic-bridge.md`](docs/classic-bridge.md).
- **Runtime feeds and program profiling**: `sap.runtime.feed.read` exposes bounded system-message and Gateway error feeds, and confirmed executable-program plans can run with a bounded server-time profiler trace. Class and snippet execution contracts remain compatible.
- **Enhancement inspection and composed advanced workflows**: repository inspection can include bounded enhancement implementations, elements, and optionally source. Behavior implementation classes, CDS Unit, local test includes, and program profiling are documented as token-efficient compositions of existing action-specific tools.
- **Browser OAuth Authorization Code with PKCE**: profiles can launch a loopback browser login, persist protected access/refresh credentials, refresh before expiry, and rotate the stored refresh credential without exposing tokens in MCP arguments.
- **Request-scoped SAP bearer forwarding**: OIDC-authenticated HTTP sessions can use `bearer-passthrough` profiles so the caller's JWT reaches SAP only for that session and only for profiles that explicitly opt in. Static API keys are never forwarded, sessions remain principal-bound, and request-scoped SAP clients are closed with the MCP session.
- **LobeHub manifest synchronization**: `npm run sync:lobehub` introspects the built unversioned runtime and keeps the committed full tool schemas and package version aligned. The default v1 surface now contains 120 tools and seven Resources; the compact preset remains 12 tools.

### Security

- Classic-bridge profiles reject absolute or cross-origin URLs and use the existing SAP session instead of accepting a second credential or endpoint in tool input.
- OAuth authorization and token endpoints require clean HTTPS URLs; browser login validates `state`, uses S256 PKCE and a loopback callback, bounds its wait, and rejects malformed token responses.
- Per-request SAP bearer clients are isolated by MCP session and optional `systemIds`, and are never inserted into the process-wide connection cache.

## 1.2.0 - 2026-08-19

### Added

- **Opt-in SAP data-query policy**: new profiles disable caller-supplied SAP SQL by default, production profiles cannot opt in, sensitive identity/credential/banking/payroll/tax tables remain blocked, and selected business-document tables require an explicit per-call risk acknowledgement. Dynamic table sources are refused when they cannot be inspected. SQL text is redacted from optional audit arguments.
- **Token-efficient v1 presets**: `serve --preset compact|development|assurance` advertises curated 12-, 34-, or 15-tool surfaces without changing the default 115-tool contract. Automated byte budgets keep the compact preset near 5.5k estimated schema tokens; custom `--toolsets` remain available and cannot be combined with a preset.
- **Broader source-backed object creation**: the existing repository-create tools can now write and optionally activate create-time source for classes, interfaces, programs/includes, CDS data definitions, DCL sources, metadata extensions, annotation definitions, service definitions, and BDEFs. Structured object types still reject textual source before any SAP mutation.
- **Paged repository children**: the existing repository-inspection tools can return bounded child pages for ADT package, program, and function-group parents. Package inspection no longer assumes that a package has a source document, and no new tool schema is added to the default surface.
- **Confirmed class profiling**: class execution previews accept `profiling: true` and produce a distinct one-use confirmation before creating a bounded aggregate ABAP profiler trace. The default trace excludes SQL and DB detail to limit SAP overhead and response volume; successful class output is retained with a warning if the follow-up trace lookup is unavailable.
- **Embeddable library entry**: package-root imports now expose `createEmbeddedMcpServer`, `createMcpServer`, `AbapToolService`, and their provider/client types without running the CLI. Applications supply a connection provider and choose their own MCP transport; the CLI binary and local-first defaults remain unchanged.

## 1.1.0 - 2026-08-19

### Added

- **Self-hosted HTTP mode**: `serve --http` runs the same MCP surface over Streamable HTTP so one instance can be operated centrally per SAP system. Built directly on `node:http` with **no new runtime dependency**. `--api-keys-file` is mandatory; the file stores only SHA-256 digests of keys, generated by the new `apikey new <id> [--role]` command. `GET /healthz` needs no credential and performs no SAP call.
- **API key roles**: `viewer` sees only tools advertised with `readOnlyHint: true`, `developer` sees everything except an explicit admin-only list of irreversible or landscape-wide tools (transport release/delete/owner/user, repository delete execute, version restore execute, abapGit push/unlink/branch switch, RAP binding publish/unpublish, and local transaction launch), and `admin` sees the complete selected surface. Roles filter registration, so a hidden tool is not advertised and cannot be called by name. On the grouped legacy `--api-version v0` surface only the `viewer` restriction is meaningful.
- **HTTP transport hardening**: bind address defaults to `127.0.0.1`; requests carrying an `Origin` header are rejected unless allowlisted with `--allowed-origin`, which blocks browser cross-site and DNS-rebinding access; `--allowed-host` validates `Host`; sessions are bound to the API key that opened them so a captured session id cannot be replayed; per-principal rate limiting with `RateLimit-*` and `Retry-After`; an in-flight SAP request bound; session count and idle timeout limits; a 4 MiB body cap; and HSTS, `nosniff`, `DENY` framing, `default-src 'none'` CSP, `no-referrer`, and `no-store` on every response. CORS stays off unless configured.
- **Per-session isolation**: each HTTP session gets its own tool service, so preview plans, staged abapGit snapshots, and execution plans are never shared between principals, while SAP logins stay pooled. `AbapToolService.dispose()` stops background heartbeat work owned by a closing session.
- **Session audit events**: the audit log records `kind: "session"` events for authentication failures, session open and close, session limit, origin and host rejection, rate limiting, and session-principal mismatch, so failed access attempts are visible alongside capability calls.
- **Container image**: a multi-stage `Dockerfile` running as a non-root user with a health check. The image contains no SAP credentials and no API keys.
- **OIDC/JWT client authentication**: `serve --http --oidc-issuer <url> --oidc-audience <aud>` accepts access tokens from an existing identity provider instead of, or alongside, static API keys. Verification uses `node:crypto` only and adds no dependency: JWKs are imported through `createPublicKey({ format: "jwk" })`, cached for five minutes, and refreshed once on an unknown `kid` so key rotation is picked up. `RS`, `PS`, and `ES` families are accepted; `HS*` and `none` are refused because verifying an HMAC would require the server to hold the signing secret. `iss` and `aud` must match, `exp` is required, `nbf` is honoured, and 60 seconds of clock skew is tolerated. `sub` becomes the audit principal, and the role comes from a configurable claim through `--oidc-role-map`, with the highest mapped privilege winning.
- **Per-user SAP identity**: an API key record may carry `systemIds`, restricting that principal to its own SAP profiles. Registering one profile per developer makes SAP change documents attribute work to that person's SAP user and makes SAP authorization objects apply per person, instead of routing every session through one technical account. `sap.system.list` shows a principal only its own systems, and naming another returns `PROFILE_NOT_ALLOWED` without disclosing other people's assignments. Omitting `systemIds` keeps the single-identity default, and SAP logins stay pooled across sessions. This is credential separation, not SAP principal propagation, which remains on the roadmap.
- **Reproducible live-SAP evidence harness**: `npm run evidence:live -- <systemId>` exercises the `$TMP`-scoped portion of the v1 surface against a real system and prints a per-capability matrix. Safety is enforced in code: exactly one class is created in the local package `$TMP` under a run-unique name, it becomes owned only after a create receipt and an immediate exact read-back agree on system, package, type, name, and source URI, every mutation asserts that ownership before running, existing objects are only ever read, and the run deletes its object and verifies it is gone. A missing SAP-side prerequisite is recorded as `unsupported` rather than as a defect, while an MCP input-validation rejection is always recorded as a harness defect so a run cannot overstate what a system lacks. Results against two live systems are in [`docs/live-sap-evidence.md`](docs/live-sap-evidence.md): 93 passed on an S/4HANA 758 system and 87 on an ECC 758 system, 0 failed on both, for 200 live checks in total once the HTTP and CI runs are counted. The S/4HANA run covers the complete class-runner and debugger chain, including an attached 13-frame stack, variables, expression evaluation, and a step. An error code that is the specified answer for its input, such as refusing to format already-formatted source, is recorded as a pass rather than a failure.
- **CI assurance gate without an MCP host**: `assure <id> --transport <trkorr>` runs the same read-only ATC and ABAP Unit assessment the `sap.transport.assess` tool performs, writes JSON, SARIF 2.1.0, and JUnit artifacts, and turns the gate into an exit code — `0` passed, `1` failed, `2` incomplete. Unproven coverage blocks by default; `--fail-on failed` downgrades it. The command never releases or modifies the transport, so an ABAP change gate no longer requires an AI agent in the pipeline.
- **GitHub Action**: [`action.yml`](action.yml) wraps `assure`, outputs `gate` and the three report paths for `upload-sarif`, and writes a job summary. The SAP password reaches the CLI only through a profile-specific environment variable, never as a command argument. A differential test asserts the action's shell rule for deriving that variable name matches `environmentVariableName` in `src/secret-store.ts`.
- **BTP service key import**: `profile add <id> --service-key <path>` derives the ABAP endpoint, OAuth token endpoint, client id, and client secret from an SAP BTP ABAP environment service key, verifies them against SAP, and stores the secret in the protected credential store without it ever being typed or passed as an argument. Certificate-only keys are rejected with `SERVICE_KEY_CERTIFICATE_UNSUPPORTED` instead of producing a profile that could never authenticate.
- **Profile governance for the compatibility profile**: `spec/GOVERNANCE.md` states the change process, the rules that constrain the editor (no single-vendor requirements, no unverifiable requirements, a read-only required core, recorded objections), and the preconditions for moving the profile to a neutral multi-maintainer repository. `docs/profile-invitation.md` holds the unsent draft invitation to other ABAP MCP implementations.
- **Structured audit log**: `serve --audit-log stderr|file` records one `sap-abap-mcp.audit/v1` JSON Lines event per tool call and Resource read, with principal, capability name, `mutation`/`destructive` hints, selected system, scalar object identity, outcome, error code, duration, and a redacted-arguments digest. `outcome: "denied"` separates guardrail refusals such as `PRODUCTION_WRITE_BLOCKED` and `PACKAGE_NOT_ALLOWED` from technical failures. Auditing is off by default; arguments are excluded unless `--audit-include-arguments` is set, and are redacted and bounded even then. `SAP_ABAP_MCP_AUDIT_LOG`, `SAP_ABAP_MCP_AUDIT_LOG_FILE`, and `SAP_ABAP_MCP_AUDIT_INCLUDE_ARGUMENTS` allow a managed launcher to enable auditing without changing the registered MCP command.

### Fixed

- **Quadratic trailing-character trimming**: three call sites trimmed with a pattern anchored as `X+$`, which backtracks and costs time quadratic in the input on repetition-heavy strings — the OIDC issuer, a BTP service key URL, and a secret read from stdin. `src/text.ts` replaces them with a single backwards scan; a 200,000-character pathological input now trims in under a millisecond.
- **A disclosed key file could be attacked offline**: a length rule raises the floor but cannot prove a key is random, so a long hand-written key remained brute-forceable from a disclosed key file. `apikey pepper` generates a server-side secret, `apikey new --pepper-file` stores `keyHmacSha256` instead of `keySha256`, and `serve --http --api-key-pepper-file` supplies it. Each record names its own algorithm, so a key file is never ambiguous and both kinds may coexist during a migration. A `keyHmacSha256` record without the secret is refused rather than downgraded to a plain hash, and `serve` refuses to start when the key file needs a secret that was not supplied. HMAC-SHA256 stays fast, so this does not reintroduce the denial-of-service concern a slow key-derivation function would.
- **API keys had no enforced entropy floor**: any credential of 32 characters or more was accepted, so a hand-written weak key could be stored under a fast hash and brute-forced from a disclosed key file. A credential must now have at least the 43 base64url characters that 32 CSPRNG bytes encode to. SHA-256 is retained deliberately: iteration hardening does not change the feasibility of searching a 256-bit space, and deriving a key per request would let an unauthenticated caller consume CPU at will, since rate limiting applies per principal and a caller has none until its credential resolves.
- **A rejected class run gave no reason**: the ADT class-run endpoint answers a class it will not run either with a bare HTTP 500 or with a 200 whose body is an error string, so a rejection surfaced as an opaque failure or, worse, as a successful call whose `output` happened to begin with "Error:". `runClass` now raises `SAP_CLASS_RUN_FAILED` carrying the endpoint, HTTP status, ADT error type, and the exact SAP text.
- **Transport release failures lost their SAP evidence**: `TRANSPORT_RELEASE_UNSUPPORTED` reported only the transport number and HTTP status, discarding the ADT endpoint, ADT error type, and SAP response text. Those are now preserved in the error details, bounded to 4 KiB. Repeating a failed release to recover them is not safe, and they are the evidence required to implement the asynchronous background-run release path.

### Known limitations

- A request rejected by MCP input-schema validation is not audited, because it never reaches the capability or SAP.
- HTTP mode authenticates clients per user, but every session still reaches SAP through the selected profile's stored credential, so SAP-side change documents attribute work to that profile's SAP user. True SAP principal propagation through Cloud Connector or BTP token exchange remains on the roadmap.
- The HTTP listener speaks plain HTTP. Terminate TLS at a reverse proxy.

## 1.0.1

### Security

- XLSX export remains supported through a dependency-light OOXML writer, replacing the vulnerable ExcelJS/archive dependency chain. npm releases now publish with provenance, and pull requests run dependency and code-security gates.

## 1.0.0

First stable release. Consolidates the v1 MCP surface (v1 is the default tool set) with reliability and robustness fixes for RAP, transport release, and abapGit tools, verified against a live SAP system (B4D) and covered by regression tests. No tools added or removed relative to 0.4.15.

### Fixed

- **`sap.rap.generate` false negative**: the generator handler compared the objects echoed in the generate response against the preceding preview and failed the whole operation when a system returned only a subset (for example just the service binding). It now verifies each previewed object with a repository read-back and only reports `RAP_GENERATION_RESULT_MISMATCH` (with the missing set) when an object is genuinely absent, returning `readBackVerified: true` on success.
- **`sap.rap.binding.inspect` crash on V4 and unpublished bindings**: inspecting a binding with no active OData query links (unpublished or V4) crashed inside the ADT client. The service-binding read now returns metadata without service details in that case instead of throwing.
- **`sap.rap.binding.inspect` crash on V2 bindings**: mapping a V2 service dereferenced a service URL that V2 bindings leave undefined, throwing during inspection. The mapping now falls back to the populated service URL and omits the preview URL when it cannot be built.
- **`sap.rap.binding.unpublish` for OData V4**: unpublish previously supported only V2 bindings. V4 bindings are now unpublished through the OData V4 job endpoint; `serviceName` and `serviceVersion` are optional and used only for V2.
- **`sap.transport.release` on newer systems**: release now creates the ATC check worklist the ADT release gate expects and releases open, non-empty tasks before the request. When a system rejects the synchronous release of an object-bearing transport, the tool returns a clear `TRANSPORT_RELEASE_UNSUPPORTED` error pointing to SE10/SE09 instead of a raw HTTP 500.
- **abapGit tools on systems without the ADT backend**: the git tools now return `ABAPGIT_BACKEND_UNAVAILABLE` with installation guidance when `/sap/bc/adt/abapgit/*` is not present, rather than an opaque "resource does not exist" error.
- **v0 contract and distribution catalog tooling**: `scripts/update-v0-contract.mjs` pins `--api-version v0` so the committed legacy fixture remains exact. The MCPB and Smithery catalogs follow the unversioned runtime and advertise the default v1 surface.

### Known limitations

- Object-bearing transport release is unsupported on systems that only run release as a GUI background job; release such transports from SE10/SE09. A future release may add the asynchronous background-run path used by the SAP GUI.
- The abapGit tools require the abapGit ADT backend; the standalone abapGit report (SE38) does not expose the required endpoints.

## 0.4.15

Baseline for the v1 MCP surface (v1 as the default tool set) and the read-only slice. See the Git history for details.

# SAP ABAP MCP

[![npm version](https://img.shields.io/npm/v/%40coaspe%2Fsap-abap-mcp)](https://www.npmjs.com/package/@coaspe/sap-abap-mcp)
[![npm downloads](https://img.shields.io/npm/dw/%40coaspe%2Fsap-abap-mcp)](https://www.npmjs.com/package/@coaspe/sap-abap-mcp)

For ABAP developers using a local AI coding assistant against an ADT-enabled
SAP development system. Read current code and its direct impact, make one
scoped change, then inspect diagnostics, activation, ABAP Unit and ATC evidence.
The change workflow returns **diff → actual checks → uncertainty → next action**.

This branch is an **unreleased reliability candidate based on 2.0.1**. npm latest
remains 2.0.1; published installations do not contain the candidate fixes below.
The 2026-10-20 review reproduced broken no-argument startup and empty macOS
Keychain writes in 2.0.1. Use a stable checkout of this candidate for evaluation.

## Quick start

Prerequisites: maintained Node.js 22/24, npm, a local MCP host, SAP HTTPS/VPN
access and ADT permission. Obtain the URL, three-digit client and approved
credentials from your SAP administrator. Never put credentials in chat.

From this candidate checkout, build and run the local setup:

```sh
npm ci
npm run build
node dist/src/index.js onboard
```

On Windows, use `node.exe` if `node` is unavailable under that name. The browser
wizard supports Windows DPAPI and macOS Keychain. On Linux use
`node dist/src/index.js setup`; credentials are environment-only.

The wizard preserves existing registrations. From a stable checkout it registers
that checkout with `node` resolved from PATH. From an npm installation it pins
the current package version with `npx` (`npx.cmd` on Windows), so registrations
contain no npm-cache or version-specific Node executable path. Keep the checkout
for a development registration; prefer the version-pinned package after release.

Restart the host. Ask it to list configured systems, verify the selected client,
and read one approved development object. A connected MCP or `setup_required`
state is not SAP authentication, a first useful read or a completed ABAP task.

For the **published 2.0.1** transport, explicitly include `serve`:

```sh
npx -y @coaspe/sap-abap-mcp@2.0.1 serve
```

Windows uses `npx.cmd` with the same arguments. The candidate additionally treats
no arguments on non-interactive stdin as stdio `serve`; interactive no-argument
invocation and explicit `--help` retain help output. MCP stdout contains protocol
messages only. With no profiles, discovery stays available with `SETUP_REQUIRED`.

## One existing-object change

Select the existing `sap-change-object` prompt, with the configured `systemId`,
exact Z program/class as `target`, and desired behavior in `goal`. It reuses the
existing source, semantic/public API, dependency, quality and transport features.

Read-only and production policies, package restrictions, transport requirements
and exact-source conflict checks remain in force. The candidate checks active
and inactive source under lock and refuses a conflicting inactive version.
After an uncertain write failure, inspect saved state before resuming. Multi-object
quick fixes stop with completed/uncertain/unattempted identities; they do not
attempt automatic rollback or claim an atomic transaction. Zero tests,
unsupported checks and partial findings cannot establish completion.

See [workflow prompts](docs/workflow-prompts.md) and the unchanged
[T1–T5 comparison contract](docs/abap-task-comparison.md).

## Verified environments and limits

| Scope | Current evidence |
|---|---|
| Clean npm tarball, macOS arm64, Node 24 | Candidate initializes and lists tools with/without `serve`, with/without fixture profiles, including spaces/Unicode paths; help and shutdown checked |
| macOS Keychain | Actual throwaway UTF-8/long-value storage, renewal and deletion verified; no SAP credential was used |
| Windows `npx.cmd` / DPAPI | Field run required; CI commands prepared; this Mac run does not verify Windows |
| Claude Desktop MCPB / actual host restart | Standalone bundle checks are separate from native app installation; field acceptance remains open |
| Current 2.x live-SAP acceptance | **not verified** |
| Historical live-SAP evidence | Limited runs reported on 2026-08-05; not current-release acceptance; original product labels need component reconfirmation |
| Same-model ABAP task comparison | Coaspe / ARC-1 / VSP T1–T5 remain blocked without an authorized common SAP fixture |

See the [evidence index](docs/evidence/index.json),
[compatibility matrix](docs/compatibility-matrix.md), and
[historical live record](docs/live-sap-evidence.md). No overall product ranking
is claimed from tool counts, tests, downloads or synthetic replay.

## If setup fails

| Symptom | Next action |
|---|---|
| Connection closes immediately | On 2.0.1 append `serve`; check MCP stderr and Node on the host PATH |
| No profiles / `SETUP_REQUIRED` | Run local setup, then reconnect; do not count this as a successful install |
| Removed Node/cache or an old server version | Run [registration doctor and reviewed repair](docs/registration-recovery.md) |
| SAP authentication/authorization failure | Use local credential renewal or ask the administrator for ADT permission; no repeated blind login attempts |
| Inactive conflict / uncertain write | Inspect active and inactive state with its owner before resuming |

## Reference and release status

- [Full product/HTTP/plugin/reference guide](docs/product-reference.md), [CLI](docs/cli-reference.md), [profiles](docs/setup-and-profiles.md).
- [Roadmap](ROADMAP.md), [adopters](ADOPTERS.md), [distribution status](docs/mcp-directory-submissions.md).
- [Transport `assure` and CI](docs/product-reference.md#transport-change-assurance), [MCP Registry](https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.Coaspe/sap-abap-mcp).
- [Development and reliability validation](docs/reliability-2026-10-20.ko.md). Checkout manifest version: `2.0.1`; candidate changes are not published.

Normal clients should omit both `--api-version` and `--toolsets`. The default
five discovery/invocation gateways still reach the existing 120 capabilities.

## Privacy Policy

[PRIVACY.md](PRIVACY.md): no default remote telemetry. SAP credentials remain in
OS-protected storage. Feedback and aggregate exports are voluntary; public
adopter names or quotes require separate explicit permission.

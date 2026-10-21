# SAP ABAP MCP

[![npm version](https://img.shields.io/npm/v/%40coaspe%2Fsap-abap-mcp)](https://www.npmjs.com/package/@coaspe/sap-abap-mcp)
[![npm downloads](https://img.shields.io/npm/dw/%40coaspe%2Fsap-abap-mcp)](https://www.npmjs.com/package/@coaspe/sap-abap-mcp)

Connect your AI assistant to an ADT-enabled SAP system to read ABAP, make scoped changes and inspect actual check results.

![SAP ABAP MCP demo](https://raw.githubusercontent.com/Coaspe/sap-abap-mcp/main/assets/demo.gif)

## Quick start

1. Install Node.js 22/24 and connect to your company VPN.
2. Run `npx -y @coaspe/sap-abap-mcp@2.2.0 onboard` (`npx.cmd` on Windows).
3. Verify and save your SAP connection, register your host, then restart the app and verify an actual SAP system read.

| Host | Setup command |
|---|---|
| Claude Code | `npx -y @coaspe/sap-abap-mcp@2.2.0 onboard` |
| Codex | `npx -y @coaspe/sap-abap-mcp@2.2.0 onboard` |
| VS Code | `npx -y @coaspe/sap-abap-mcp@2.2.0 register DEV100 --client vscode --apply` |
| Cursor | `npx -y @coaspe/sap-abap-mcp@2.2.0 register DEV100 --client cursor --apply` |
| Gemini CLI | `npx -y @coaspe/sap-abap-mcp@2.2.0 register DEV100 --client gemini --apply` |
| Claude Desktop | `npx -y @coaspe/sap-abap-mcp@2.2.0 register DEV100 --client claude-desktop --apply` |

Version **2.2.0** includes company CA files, six-host registration and Windows SAP
Logon import. Omit `--apply` to preview a registration; existing entries are
preserved and existing settings files are backed up. Claude Desktop MCPB users
should avoid a duplicate registration. On Windows replace `npx` with `npx.cmd`.

CA profiles use file format version 3 and need 2.2.0 or later. Existing npm
registrations pin their package version: restart alone does not update a 2.1.0
registration. Use [registration doctor and reviewed repair](docs/registration-recovery.md)
to update an existing registration to 2.2.0 before using a CA profile.

See [setup details](docs/setup-and-profiles.md#quick-start-details), including
Linux environment-only credentials and registration recovery.

**2.1.0** fixes noninteractive startup, native macOS credential storage and
registration recovery. Windows DPAPI explicitly loads its native security module
even when Node inherits a PowerShell 7 module path. Bundled npm/npx Windows
launchers are resolved without a shell while preserving custom wrappers. This release also reduces the runtime package. Patched vendor bytes are preserved across Windows
and Unix checkouts. Existing five gateways still reach 120 capabilities.

## Fixes in 2.2.0

Repeated source patches use the same current-source view, preserve literal `$`
sequences and activate after unlock. Transport release supports ADT background
runs; the release also improves RAP response recovery, V4 unpublish errors,
old open-transport discovery, CTS-key object assignment, Dictionary checks and
top-level package creation. See [the eight fixes and validation limits](docs/bugfixes-2026-10-21.ko.md).

These paths have local automated coverage. Live B4D write/release acceptance
has not been established by this release. Older npm 2.1.0 still has the reported
source-patch limitations; upgrading the package and its pinned host registration
is required to use the fixes.

## One existing-object change

Select the existing `sap-change-object` prompt, with the configured `systemId`,
exact Z program/class as `target`, and desired behavior in `goal`. It reuses
source, semantic/public API, dependency, quality and transport features.

Production/read-only policy, package restrictions, transport requirements and
exact-source checks remain enforced. In 2.2.0, source writes
recheck the same current-source view under lock, without an explicit inactive
probe. A changed current version stops the write. Requested activation follows
successful unlock and is skipped on syntax errors. Uncertain
multi-object writes stop with saved/uncertain/unattempted identities; there is
no automatic rollback or atomic-transaction claim. Inspect state before retrying.
Zero tests, unsupported checks and partial findings cannot establish completion.

For a read-only evaluation, keep `readOnly: true` and expose only search,
describe and invoke_read gateways in the host. Do not execute write, activation,
Unit, ATC, debugger or profiling operations during that evaluation.
See [workflow prompts](docs/workflow-prompts.md) and [T1–T5 criteria](docs/abap-task-comparison.md).

## Verified environments and limits

| Scope | Evidence and limit |
|---|---|
| Clean npm tarball, macOS arm64, Node 24 | Eight launch/profile combinations, Unicode/spaces, help, invalid commands and shutdown passed on the reliability candidate |
| macOS Keychain | Actual throwaway legacy-item/UTF-8/9,000-byte storage, renewal and deletion passed |
| Windows read-only field procedure | Owner reports all supplied steps passed without candidate source changes; [sanitized operation records were not supplied](docs/evidence/owner-windows-readonly-report.json) |
| Windows DPAPI / npx.cmd automation | [Windows CI passed](docs/evidence/windows-ci-210.json): native storage/module-shadow regression, bundled launchers and eight installed-tarball protocol cases |
| Native Desktop MCPB / host restart | Standalone bundle checks and an owner's overall field report remain distinct from retained app-level evidence |
| Current 2.x live-SAP acceptance | **not verified** by retained operation-level records; owner-reported read-only completion is recorded separately |
| Historical live SAP / model comparison | 2026-08-05 results are historical; no identical-model T1–T5 completion rate or product ranking is established |

Candidate measurements reduced compressed npm size from 26.29 to 13.33 MB and
installed dependency bytes from 118.89 to 91.81 MB. Three warm protocol sessions
measured 346–351 to 223–239 ms. Cold install was 12.92 to 16.06 seconds; no cold
speed improvement is claimed. See [exact snapshots and limits](docs/evidence/candidate-reliability.json).

## If setup fails

| Symptom | Next action |
|---|---|
| MCP closes immediately | Keep `serve` explicit, especially on 2.0.1; verify Node on the host PATH |
| `SETUP_REQUIRED` | Complete local setup and reconnect; this state is not an accepted SAP installation |
| Removed Node/cache or old registered version | Run [registration doctor and reviewed repair/update](docs/registration-recovery.md) |
| Certificate untrusted / expired / hostname mismatch | Keep verification enabled; use the company CA PEM file or ask the administrator to fix the certificate/URL. See [TLS trust](docs/setup-and-profiles.md#company-ca-and-tls-trust) |
| SAP URL unknown | On Windows use SAP Logon import to find candidate URLs, then check ADT and confirm the endpoint with your administrator |
| SAP authentication/authorization failure | Renew locally or ask the administrator for ADT permission; avoid blind repeated logins |
| Inactive conflict / uncertain write | Read current active/inactive state and reconcile with its owner before resuming |

## Reference and release status

- [Transport `assure` and CI](docs/product-reference.md#transport-change-assurance), [full reference](docs/product-reference.md), [CLI](docs/cli-reference.md), [profiles](docs/setup-and-profiles.md), [changelog](CHANGELOG.md).
- [Evidence index](docs/evidence/index.json), [compatibility](docs/compatibility-matrix.md), [historical live record](docs/live-sap-evidence.md).
- [Roadmap](ROADMAP.md), [adopters](ADOPTERS.md), [distribution](docs/mcp-directory-submissions.md), [2.2.0 release](https://github.com/Coaspe/sap-abap-mcp/releases/tag/v2.2.0).
- [Reliability validation](docs/reliability-2026-10-20.ko.md) and [field procedure](docs/field-acceptance-2026-10-20.ko.md). Checkout manifest version: `2.2.0`.

Normal clients should omit both `--api-version` and `--toolsets`.

## Privacy Policy

[PRIVACY.md](PRIVACY.md): no default remote telemetry. Credentials remain in
OS-protected storage. Feedback exports are voluntary; public adopter names and
quotes require separate explicit permission. Downloads and automated tests do
not establish active users, task success or independent adoption.

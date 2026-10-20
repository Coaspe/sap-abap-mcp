# SAP ABAP MCP

[![npm version](https://img.shields.io/npm/v/%40coaspe%2Fsap-abap-mcp)](https://www.npmjs.com/package/@coaspe/sap-abap-mcp)
[![npm downloads](https://img.shields.io/npm/dw/%40coaspe%2Fsap-abap-mcp)](https://www.npmjs.com/package/@coaspe/sap-abap-mcp)

For ABAP developers using a local AI coding assistant against an ADT-enabled
SAP development system. Read current code and its direct impact, make one
scoped change, then inspect diagnostics, activation, ABAP Unit and ATC evidence.
The change workflow returns **diff → actual checks → uncertainty → next action**.

**2.1.0** fixes noninteractive startup, native macOS credential storage and
registration recovery. Windows DPAPI explicitly loads its native security module
even when Node inherits a PowerShell 7 module path. Bundled npm/npx Windows
launchers are resolved without a shell while preserving custom wrappers. This release also reduces the runtime package and preserves
conflicting inactive source. Patched vendor bytes are preserved across Windows
and Unix checkouts. Existing five gateways still reach 120 capabilities.

## Quick start

Prerequisites: Node.js 22/24, npm, a local MCP host, SAP HTTPS/VPN access and
ADT permission. Obtain connection details from your SAP administrator and
enter credentials only in local setup.

Windows PowerShell:

```powershell
npx.cmd -y @coaspe/sap-abap-mcp@2.1.0 onboard
```

macOS:

```sh
npx -y @coaspe/sap-abap-mcp@2.1.0 onboard
```

The browser wizard uses Windows DPAPI or macOS Keychain and defaults new
profiles to read-only. On Linux use `npx -y @coaspe/sap-abap-mcp@2.1.0 setup`;
credentials are environment-only. Existing registrations are preserved.

Restart the host. List configured systems, verify the actual SID/client, and
read one approved development object. A connected MCP or `setup_required`
state is not SAP authentication, a first useful read or a completed ABAP task.

For manual MCP registration, use `npx` (`npx.cmd` on Windows) with arguments
`["--yes", "@coaspe/sap-abap-mcp@2.1.0", "serve"]`. npm registrations pin the
package version rather than an npm-cache or version-specific Node path.
A maintained source checkout can use `npm ci`, `npm run build`, then
`node dist/src/index.js onboard`; keep that checkout for its local registration.

Noninteractive no-argument invocation also starts stdio. Explicit `--help`
and interactive no-argument invocation show help. MCP stdout contains protocol
messages only. Empty-profile discovery advertises `SETUP_REQUIRED`.

## One existing-object change

Select the existing `sap-change-object` prompt, with the configured `systemId`,
exact Z program/class as `target`, and desired behavior in `goal`. It reuses
source, semantic/public API, dependency, quality and transport features.

Production/read-only policy, package restrictions, transport requirements and
exact-source checks remain enforced. Source writes recheck active and inactive
versions under lock. A conflicting inactive version is preserved. Uncertain
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
| Windows DPAPI / npx.cmd automation | Separate Windows CI gate checks native storage and the installed tarball; a Mac run does not verify Windows |
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
| SAP authentication/authorization failure | Renew locally or ask the administrator for ADT permission; avoid blind repeated logins |
| Inactive conflict / uncertain write | Read current active/inactive state and reconcile with its owner before resuming |

## Reference and release status

- [Transport `assure` and CI](docs/product-reference.md#transport-change-assurance), [full reference](docs/product-reference.md), [CLI](docs/cli-reference.md), [profiles](docs/setup-and-profiles.md), [changelog](CHANGELOG.md).
- [Evidence index](docs/evidence/index.json), [compatibility](docs/compatibility-matrix.md), [historical live record](docs/live-sap-evidence.md).
- [Roadmap](ROADMAP.md), [adopters](ADOPTERS.md), [distribution](docs/mcp-directory-submissions.md), [2.1.0 release](https://github.com/Coaspe/sap-abap-mcp/releases/tag/v2.1.0).
- [Reliability validation](docs/reliability-2026-10-20.ko.md) and [field procedure](docs/field-acceptance-2026-10-20.ko.md). Checkout manifest version: `2.1.0`.

Normal clients should omit both `--api-version` and `--toolsets`.

## Privacy Policy

[PRIVACY.md](PRIVACY.md): no default remote telemetry. Credentials remain in
OS-protected storage. Feedback exports are voluntary; public adopter names and
quotes require separate explicit permission. Downloads and automated tests do
not establish active users, task success or independent adoption.

# Setup and profile management

This guide covers local SAP connection profiles used by the npm package,
repository plugins, and local MCP registry installs. Profiles are independent
of a particular MCP client and remain on the user's machine.

The `npx ...@latest` examples run the published npm version. The behavior
described here is included in 2.0.0; use `@2.0.0` to pin this release.

Interactive `setup` creates and edits Basic Auth profiles. OAuth profiles use
the explicit commands below; Destination profiles use the BTP guide.

The browser `onboard` flow supports Basic Auth, BTP ABAP service-key
import, OAuth client credentials and browser OAuth Authorization Code with PKCE.
The screen supports English and Korean. The browser's first preferred language
selects Korean for `ko` and English for other language tags; clients without a
language preference retain Korean. Use the header language link before entering
credentials, or append `&lang=en` / `&lang=ko` to the printed URL. Switching reloads
the page; saved profiles remain available, while unsaved form input is discarded.
Screen language does not change the profile's SAP language.

Choose the authentication mode before entering credentials. Service-key import
derives the SAP URL, client 100 and OAuth settings. Browser OAuth requires a
registered native client accepting a random-port loopback callback; it does not
guarantee compatibility with every corporate SAML/Kerberos SSO configuration.
Certificate-only service keys remain unsupported. BTP Destination profiles use
the authenticated HTTP setup rather than local secrets. Legacy direct bearer
passthrough is refused in this checkout; see the migration section below.

The flow validates authentication and an ADT system read before protected storage.
It preserves the stored package/data-query/bridge policy when renewing the same
authentication type; a different auth type requires a new connection name.
Cancel interrupts browser login and prevents persistence while SAP validation is
still pending; it does not roll back a save that has already started. A failed
login leaves the original profile and credential intact. Stored OAuth profiles
can be edited and renewed in the wizard without revealing their protected secrets.
Only macOS Keychain and Windows DPAPI support browser credential persistence.

In this checkout, returning from connection review immediately shows the profile
you just saved. Use **Verify connection** to reuse its saved credential, or
**Edit settings and authentication** to change it. Step changes move keyboard
focus to the new heading; the next Tab reaches that step's controls. This does
not add a second registration or automatically weaken the connection's scope.

It offers recovery guidance after setup failures and a copyable first
system-query prompt after registration. The query verifies SAP access from the
MCP host; it does not edit source or read business data. A configured client and
an authenticated SAP session are separate checks. Company SSO-only users should
use the supported advanced authentication flow rather than guess a password.

## Access scope in this checkout

The browser wizard starts new profiles with **read-only** access.
No development package is required for the first system or source query. The
Access scope selector can instead enable changes in selected packages (a
non-empty allowlist is required) or explicitly in all packages. Production
profiles always remain read-only. Renewing credentials preserves the saved
policy unless the user explicitly chooses a different scope.

Read-only access blocks SAP object/transport changes, debugger controls, ABAP
applications and ABAP Unit execution. Source inspection, repository queries and
static diagnostics/ATC remain subject to SAP permissions. Direct table SQL has
its separate `allowDataQueries` opt-in; read-only scope does not enable it.
Package restrictions apply to existing package-aware write paths; they are not
an execution sandbox for an entire ABAP program or transport.

Use the **built checkout's** CLI for the new flags:

```bash
node /absolute/path/to/sap-abap-mcp/dist/src/index.js profile add DEV100 \
  --url https://sap.example.com --client 100 --username DEVELOPER --read-only
```

To explicitly enable the existing guarded write paths, repeat the same profile
command with `--allow-writes --packages ZMCP`. Using both access flags is an
error. Without either flag, an existing explicit read-only/write policy and its
package list are preserved. A newly created manual CLI or terminal profile
retains the legacy behavior; only new browser profiles default to read-only.
Terminal `setup edit` also preserves an existing explicit policy.

Profiles with an explicit `readOnly` value use file **format 2**, including
explicit write-enabled profiles. Older runtimes reject this file with
`PROFILE_FILE_INVALID`; do not change its version field to bypass the check.
Before using such a profile, build/start the current checkout (or the release
containing this change). A fresh wizard registration uses the Node executable
and server file running the wizard. Existing registrations are preserved and
may still point at an older runtime: inspect their command and update it through
the client's normal configuration flow before the first query.

`sap.system.list` includes `readOnly: true` for restricted systems. Cached
connections receive policy changes on their next acquisition without another
SAP login. An operation already admitted is not cancelled or rolled back by
changing the profile; finish it before narrowing scope.

## Existing registration checks

In 2.0.0, Step 3 compares the selected profile against an
existing `sap-abap` registration. Codex uses `mcp get --json`; Claude uses the
displayed fields from `mcp get`. The comparison checks the Node/server paths,
v1/stdio mode, selected profile (or an unfiltered current server), explicit
`SAP_ABAP_MCP_HOME`, and enabled status. It preserves the existing tool preset
and other startup/permission settings instead of rewriting them.

Different settings show **Review registration** and the required runtime,
profile and directory values. Review only the relevant fields through the
client's normal MCP configuration flow, retain other arguments and permissions,
then select **Check again**. The wizard does not remove a registration, add a
duplicate server or overwrite custom settings. An unreadable/unsupported detail
format, a missing explicit profile directory or an unresolved environment
placeholder is **unknown**, not verified. Update/check the client's configuration
until its details can be compared. Matching at least one usable client enables
Finish; SAP authorization still requires the first real system query.

This compares configuration fields, not the contents of another package, the
identity of an already-running worker or a real SAP session. A registration using
`npx`, a wrapper or another runtime can be valid but is not identified as this
installation. Claude's human-readable output is less precise than Codex's JSON;
unusual quoting/custom commands need manual review. Restart the client after
changing its settings.

The Claude registration command puts `sap-abap` before `--env` because that option
accepts multiple values. This was reproduced with the real CLI; see
[Claude's official stdio guide](https://code.claude.com/docs/en/mcp#option-3-add-a-local-stdio-server)
and [Codex's official MCP guide](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).

## Desktop bundle first setup

The 2.0.0 MCPB bundle can start the browser wizard through Claude
Desktop's built-in Node runtime when no profiles exist. That app manages the
registration; the wizard does not require npm, Claude Code or Codex CLI and
does not add another MCP server. See [desktop bundle setup](desktop-bundle-setup.md).
The prerequisites below apply to the npm/CLI path.

## Prerequisites

- A maintained Node.js LTS release (currently 22 or 24; minimum compatible version: 20).
- Network or VPN access to the SAP HTTPS endpoint.
- A three-digit SAP client number.
- ADT services enabled at `/sap/bc/adt`.
- A supported SAP authentication method and the required SAP authorizations.

On Windows, run npm executables as `npx.cmd`. On macOS and Linux, use `npx`.
PowerShell continues a line with a backtick (`` ` ``). Command Prompt
(`cmd.exe`) uses a caret (`^`). Bash and zsh use a backslash (`\`). The
single-line commands below work without shell-specific continuation syntax.

## Create a profile interactively

Windows:

```powershell
npx.cmd @coaspe/sap-abap-mcp@latest setup
```

macOS or Linux:

```bash
npx @coaspe/sap-abap-mcp@latest setup
```

The wizard collects and reviews these settings:

| Setting | Meaning |
|---|---|
| Server name | Local profile ID used later as `connectionId`, for example `DEV100` |
| SAP URL | HTTPS origin of the SAP system; do not include credentials |
| Client | Three-digit SAP client such as `100` |
| Username | SAP user for Basic Auth; omitted for authentication types that do not use it |
| Environment | `development`, `quality`, or `production`; production is always read-only |
| Writable packages | Optional comma-separated allowlist for writes |
| Data queries | Terminal setup offers explicit opt-in, matching published 1.6.0; production remains disabled |

Windows and macOS prompt for the secret without echoing it, verify the SAP
connection, and save only after verification succeeds. Linux saves non-secret
settings and prints the profile-specific environment variable required when the
MCP process starts.

## List, edit, and remove profiles

```bash
npx @coaspe/sap-abap-mcp@latest profile list
npx @coaspe/sap-abap-mcp@latest setup edit
npx @coaspe/sap-abap-mcp@latest setup remove
```

Omit the Server name to choose from the saved profiles, or select it directly:

```bash
npx @coaspe/sap-abap-mcp@latest setup edit DEV100
npx @coaspe/sap-abap-mcp@latest setup remove DEV100
```

For a Basic Auth profile, `setup edit` loads the current values as defaults. It
tests the updated profile and secret before replacing the saved configuration,
so a failed login does not destroy the working profile. OAuth profiles are
preserved and redirected to the explicit CLI instead of being converted
silently. `setup remove` shows the selected profile and asks for confirmation;
the default is No. Confirmed removal deletes the profile,
stored SAP secret, browser OAuth credential, and its saved abapGit credentials.

In this checkout, both `setup edit` and browser onboarding preserve the existing
Basic profile's data-query preference and classic bridge path when editing other
fields. The terminal review shows both values. Switching to `production` disables
data queries before validation, as production opt-in is forbidden. Onboarding
restores the writable-package field when editing a saved profile; a network
verification failure leaves it saved and does not force password replacement.

In 2.0.0, the next acquisition of a cached direct or HTTP
Destination connection detects saved SAP URL/client, language, classic bridge
and authentication-setting changes and opens the updated connection after
logging out the old one. Access-policy-only edits reuse the existing session.
Replacing a stored secret alone still requires credential renewal or an explicit
disconnect; the app-managed credential-save flow already disconnects that
profile. Other profiles stay connected. This behavior has local fixture evidence,
not live SAP acceptance.

After successful SAP verification, protected-store setup writes the credential
before publishing the profile. A credential-write error leaves the profile
unchanged. If the profile write fails, setup attempts to restore the prior
credential (or remove a newly created one). `PROFILE_CREDENTIAL_RECOVERY_REQUIRED`
means that restoration also failed; re-enter the credential for the saved
profile before using it. This compensates for reported write failures, not an
atomic transaction across the filesystem and OS credential store; process crashes
or concurrent edits by another process still require checking saved state.
Linux environment-based authentication does not write credentials.

For non-interactive profile removal, use `profile remove <id>` only when the
calling automation already controls the target identity.

## Verify and refresh authentication

```bash
npx @coaspe/sap-abap-mcp@latest doctor DEV100
npx @coaspe/sap-abap-mcp@latest auth status DEV100
npx @coaspe/sap-abap-mcp@latest auth login DEV100
npx @coaspe/sap-abap-mcp@latest auth logout DEV100
```

`doctor` performs a live ADT check. `/mcp` in a client proves only that the MCP
process initialized; it does not prove that the selected SAP profile can log in.

## Secret storage by platform

| Platform | Storage |
|---|---|
| Windows | DPAPI-protected file scoped to the current Windows user |
| macOS | Login Keychain |
| Linux and containers | Read-only profile-specific environment variables |

The environment variable name is derived from the profile ID. For example,
`DEV-100` uses `SAP_ABAP_MCP_PASSWORD_DEV_100`. Start the MCP client from the
same environment that defines the variable. Profile JSON never stores the SAP
password, OAuth client secret, access token, or refresh token.

## Manual Basic Auth profile

Interactive `setup` is preferred. Automation can create a profile explicitly:

```bash
npx @coaspe/sap-abap-mcp@latest profile add DEV100 \
  --url https://sap.example.com --client 100 \
  --username DEVELOPER --environment development \
  --packages ZMCP --login
```

Use `--password-stdin` with `--login` to read the password from standard input.
Never place a password directly in a command argument.

## OAuth client credentials

```bash
npx @coaspe/sap-abap-mcp@latest profile add BTP100 \
  --url https://abap.example.com --client 100 \
  --auth-type oauth-client-credentials \
  --token-url https://auth.example.com/oauth/token \
  --client-id mcp-client --scope "abap.read abap.write" --login
```

The hidden prompt requests the client secret. The token URL must use HTTPS and
must not contain embedded credentials, query parameters, or a fragment. Linux
profiles omit `--login` and receive the secret through the printed environment
variable.

## Browser Authorization Code with PKCE

```bash
npx @coaspe/sap-abap-mcp@latest profile add DEV100_SSO \
  --url https://sap.example.com --client 100 \
  --auth-type oauth-authorization-code \
  --authorization-url https://login.example.com/oauth2/authorize \
  --token-url https://login.example.com/oauth2/token \
  --client-id mcp-public-client --scope "openid abap" --login
```

The command uses a random loopback callback, validates OAuth `state`, and uses
S256 PKCE. Windows DPAPI or macOS Keychain persists the credential and refresh
rotation. Linux does not persist this profile type because its secret store is
environment-only.

## SAP BTP ABAP environment service key

```bash
npx @coaspe/sap-abap-mcp@latest profile add BTP100 --service-key ./service-key.json
```

The importer derives the ABAP and token endpoints, verifies SAP, and stores the
client secret in the protected secret store. Delete the service key file after
import because the original file contains the secret in plain text. X.509-only
keys are rejected with `SERVICE_KEY_CERTIFICATE_UNSUPPORTED`.

## Request-scoped bearer passthrough

2.0.0 compatibility change: direct forwarding of an MCP client's token as
SAP authorization is refused with `TOKEN_PASSTHROUGH_REFUSED`. Existing
`bearer_passthrough` profile files remain readable but cannot connect; `auth
status` reports `credentialAvailable: false` and `unsupported_passthrough`.
Creating this mode with `profile add` or logging in with `auth login` is refused.
No saved profile is deleted or automatically converted.

Configure Basic or OAuth SAP credentials independently of the MCP HTTP token,
or ask the administrator to configure a
[BTP Destination exchange/propagation profile](btp-destination-integration.md).
The latter requires actual BTP trust, bindings and SAP permission verification;
changing the profile's authentication type alone does not establish them.
This is local checkout behavior; the npm release has not been updated.

## Data-query permission

Caller-supplied SAP SQL is disabled by default. Enable it only for a reviewed
development or quality profile:

```bash
npx @coaspe/sap-abap-mcp@latest profile add DEV100 \
  --url https://sap.example.com --client 100 \
  --username DEVELOPER --environment development \
  --allow-data-queries
```

This beta preserves published 1.6.0 behavior: the flag enables caller-supplied
queries passing the read-only SQL validator and SAP authorization. There is no
MCP table denylist or per-call risk acknowledgement. Production profiles cannot
enable data queries; write SQL remains blocked, result bounds remain enforced,
and SQL text is redacted from audit arguments. `setup edit` can explicitly
change the opt-in; browser editing preserves it and disables it for production.

## Multiple SAP systems

Create one profile per system/client, for example `DEV100`, `QAS200`, and
`PRD100`. Register the MCP server with unscoped `serve`:

```bash
codex mcp add sap-abap -- npx -y @coaspe/sap-abap-mcp@latest serve
```

V1 SAP-facing tools identify profiles with `systemId`; the legacy API uses
`connectionId`. A production profile remains
read-only even when another profile in the same process is writable.

## MCP client configuration

This checkout's browser onboarding registers the running Node executable and
this installation's absolute `dist/src/index.js` path, with `serve --profile`
set to the selected saved profile. It also records the profile directory as
`SAP_ABAP_MCP_HOME` using the clients' `--env` option ([Claude documentation](https://code.claude.com/docs/en/mcp)).
Starting from another working directory therefore uses the same saved profiles.
Registration no longer silently switches a local build to npm `latest`.
The browser offers minimal (five tools, default), adaptive (17 tools), and single
(one tool) for new registrations. It writes the selection as `serve --preset`;
all three modes retain the same role-filtered capability catalog. Smaller fixed
schemas may require more discovery calls; the single developer/admin gateway
may trigger host approvals even for reads. Existing registrations are skipped
rather than replaced, and selecting another mode does not modify them.
Keep the Node executable and installation directory
available; moving/removing them or clearing an npx cache containing this install
requires updating the client registration. Use a persistent checkout or installed
package directory for a lasting setup.

Onboarding distinguishes a saved MCP registration from a reported MCP connection.
Only an explicit connected status on the server's listing row is shown as
connected; a Codex listing that merely says enabled remains registered with
connection unverified. Explicit connection failures and authentication-required
states show a recheck action and prevent the UI's completion button from enabling
unless another usable registration exists. Warnings that merely mention the
server name are not treated as registrations. This does not test SAP access:
the user should query the selected SAP system from the AI client after setup.

Local browser verification covered failure → recheck → connected → completion
using an isolated profile and simulated CLI/SAP responses. No real account,
credential store or client configuration was changed during that verification.

If a client UI accepts a command and argument list instead of a registration
command, configure:

- Command on Windows: `npx.cmd`
- Command on macOS or Linux: `npx`
- Arguments: `-y`, `@coaspe/sap-abap-mcp@latest`, `serve`

Do not append a sample `--profile DEV100` unless the installation deliberately
exposes only that real, existing profile.

## abapGit credentials

Credentials are scoped to the exact canonical repository URL:

```bash
npx @coaspe/sap-abap-mcp@latest abapgit auth login DEV100 \
  --repository-url https://github.com/example/repository.git \
  --username git-user
npx @coaspe/sap-abap-mcp@latest abapgit auth status DEV100 \
  --repository-url https://github.com/example/repository.git
npx @coaspe/sap-abap-mcp@latest abapgit auth logout DEV100 \
  --repository-url https://github.com/example/repository.git
```

## Troubleshooting

| Problem | Check |
|---|---|
| `node` is not found | Install the latest maintained Node.js LTS release and reopen the terminal. |
| npm cannot download the package | Check internet access, proxy configuration, and npm registry policy. |
| `PROFILE_NOT_FOUND` | Run `profile list` and verify the exact Server name. |
| SAP login fails | Verify URL, client, credentials, VPN, ADT activation, and SAP authorization; then run `doctor`. |
| Certificate failure | Configure the corporate CA used by Node.js and verify the SAP HTTPS chain. |
| `PACKAGE_NOT_ALLOWED` | Use `setup edit` to review the writable-package allowlist. |
| `TRANSPORT_REQUIRED` | Supply an open transport for writes outside `$TMP`. |

Browser SSO-only, MFA-only, certificate-only, Kerberos-only, and unsupported
OAuth grants cannot be converted into Basic Auth by this package.

### Recovering unreadable AI-client settings

The local onboarding page distinguishes an unreadable `mcp list` result from
an absent registration. It displays the CLI error and offers **다시 확인**.
Registration stops with `CLIENT_CONFIG_UNREADABLE` until the settings can be
read, preventing a blind duplicate registration. After recovery, the same
connection action resumes; an existing registration is still skipped.

Browser onboarding registers the currently running installation by absolute
path. Installing the beta archive and launching its onboarding therefore tests
the beta without switching to the public npm package.

### Concurrent OAuth renewal

For cached OAuth connections, calls arriving during token renewal now share the
same replacement promise. The old session is logged out once before the new
client is created. Previously, the cache entry was removed before awaiting
logout, allowing another call to create a competing client that could then be
overwritten and left outside manager cleanup.

A deterministic regression test holds logout open while eight calls request the
connection. It verifies one replacement, the same client for every caller, and
shared failure followed by recovery when a replacement login fails. The full
local suite passes 502 tests. This is lifecycle validation with fake SAP clients,
not verification of a live BTP token exchange. No new tools, schemas or settings
are introduced.


## Voluntary first-setup check

Version 2.0.0 includes a bounded GitHub issue form at
[`.github/ISSUE_TEMPLATE/compatibility-report.yml`](../.github/ISSUE_TEMPLATE/compatibility-report.yml).
Submission is voluntary and public under the contributor's GitHub
account; the form requests no SAP credentials, URLs, object names, code, logs or
attachments. No background telemetry is added.

Use a 30-minute session only with an approved development connection and the
participant's consent. Keep the product build and success definitions fixed:

1. Spend the first 5 minutes following the selected build's setup guidance without
   maintainer help; keep the connection read-only. Record whether this is a first
   MCP setup, a fresh SAP profile or an existing-profile repair.
2. Allow up to 10 additional minutes for setup help if needed. Start the setup
   timer at the first install/setup action, including client restart, and stop
   when the client can see the intended MCP server. Record helped completion
   separately and keep failed attempts.
3. Spend up to 5 minutes running the existing `doctor` for the selected profile
   locally. Classify failure broadly; do not copy its raw output into a public
   report. An authorization denial is not proof of a product defect.
4. Spend up to 5 minutes using the setup page's first-query prompt or a
   participant-selected, non-sensitive development read. Record its outcome
   separately from registration; do not invoke ABAP Unit, transport assessment,
   writes or transport release as part of this setup check.
5. Spend up to 5 minutes recording the bounded form fields, if the participant
   permits public reporting. A later 30-day follow-up records actual repeat use
   as yes/no/unobserved, not intended use; contact requires separate opt-in.

Maintain the [local aggregate scorecard](competitive-first-user-evidence-2026-10-02/scorecard.json)
manually after review. It starts with zero recorded participant outcomes and no
median time. Separate each build, client and starting state when interpreting
results. A contributor report does not automatically become a `live-sap`
compatibility record or a public adopter entry; those require the existing
live-evidence rules and separate exact-name/quote permission. Anonymous
aggregation does not anonymize the original public GitHub issue.

This prepares evidence collection. It does not establish novice setup success,
a ready production deployment, measured token billing or independent adoption.

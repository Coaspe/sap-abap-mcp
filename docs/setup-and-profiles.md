# Setup and profile management

This guide covers local SAP connection profiles used by the npm package,
repository plugins, and local MCP registry installs. Profiles are independent
of a particular MCP client and remain on the user's machine.

The `npx ...@latest` examples run the published npm version (1.6.0 at the
2026-09-08 audit). To exercise this checkout's changes, first build and replace
that command prefix with `node /absolute/path/to/sap-abap-mcp/dist/src/index.js`.
See [source reconciliation](reconciliation-1.7.0-beta.1.md) before
treating published behavior as local behavior.

Interactive `setup` creates and edits Basic Auth profiles. OAuth and bearer
passthrough profiles use the explicit `profile add` commands below.

## Prerequisites

- Node.js 20 or later.
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

For a governed HTTP deployment whose OIDC token is already accepted by SAP:

```bash
npx @coaspe/sap-abap-mcp@latest profile add DEV100_SSO \
  --url https://sap.example.com --client 100 \
  --auth-type bearer-passthrough
```

Only OIDC-authenticated HTTP sessions may use this profile. Static API keys do
not receive bearer passthrough. The token stays request-scoped and is never put
in the shared SAP connection cache. The server does not perform BTP user-token
exchange.

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
| `node` is not found | Install Node.js 20 or later and reopen the terminal. |
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

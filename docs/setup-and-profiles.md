# Setup and profile management

This guide covers local SAP connection profiles used by the npm package,
repository plugins, and local MCP registry installs. Profiles are independent
of a particular MCP client and remain on the user's machine.

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
| Data queries | Optional development/quality opt-in for caller-supplied read-only SAP SQL |

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

The flag enables every caller-supplied query that passes the read-only SQL
validator, including queries over sensitive business or personal data.
Production profiles cannot enable it. Write SQL remains blocked, result bounds
remain enforced, and SQL text is redacted from audit arguments.

## Multiple SAP systems

Create one profile per system/client, for example `DEV100`, `QAS200`, and
`PRD100`. Register the MCP server with unscoped `serve`:

```bash
codex mcp add sap-abap -- npx -y @coaspe/sap-abap-mcp@latest serve
```

All SAP-facing tools require a `connectionId`. A production profile remains
read-only even when another profile in the same process is writable.

## MCP client configuration

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

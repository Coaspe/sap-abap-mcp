# Claude Desktop setup without a separate Node installation

The 2.0.0 MCPB bundle includes the server and its dependencies. Claude
Desktop provides the Node runtime, so this path does not require terminal
commands, a separate Node/npm installation, Claude Code or Codex CLI.
See [Anthropic's extension guide](https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop)
for host requirements and the current installation interface. The npm/CLI paths
should use a maintained Node.js LTS release (currently 22 or 24); Node 20 is the
minimum compatible version. Only macOS and Windows are declared supported
by this bundle; organization policy can disable custom extensions.

## First setup

1. In Claude Desktop, open Settings → Extensions → Advanced settings → Install
   Extension and select the `.mcpb` file from the [2.0.0 release](https://github.com/Coaspe/sap-abap-mcp/releases/tag/v2.0.0).
   Verify its published SHA-256 checksum. The bundle is unsigned.
2. If no SAP profiles exist, the extension starts the browser setup on
   `127.0.0.1`. If the browser does not open, use the `SAP setup:` URL in the
   extension's logs. The random setup token is required; never post that URL
   into chat or share it. No npm or external CLI is launched by this setup path.
3. Connect your VPN if required and choose Basic Auth, OAuth client credentials,
   browser OAuth PKCE or a BTP ABAP service key. Enter credentials only in the
   local setup page or the configured identity provider. The server validates
   SAP before storing credentials in Keychain/DPAPI and saving the profile.
   New profiles start read-only; write access requires an explicit scope.
4. Review the selected SAP connection and finish. The installing app already
   manages this MCP registration, so no duplicate server is added and no other
   host configuration is changed. The local setup server closes; the MCP
   process stays available for the first query.
5. Paste the first-query prompt into a new Claude conversation. Confirm the
   actual SAP system identity. Extension health, registration and a saved
   profile do not establish that this first tool query succeeds.

Existing profiles suppress automatic setup. Profile storage remains separate
from the extension directory and follows `SAP_ABAP_MCP_HOME` or the ordinary
per-user profile directory. Uninstalling the extension does not delete profiles
or credentials. Existing explicit access policy remains unchanged.

In the wizard, returning to SAP setup after a save immediately shows
that connection's card. Choose **Verify connection** to reuse the saved
credential. The current step number and keyboard focus follow backward as well
as forward navigation. See the [captured local flow](competitive-onboard-flow-2026-10-01/verification.json);
its SAP validation and credential store are synthetic, not a native-host or live
SAP acceptance test.

## Sign in again or add another connection

1. Open this extension's settings, enable **Open SAP setup on startup**, save
   the setting and restart/re-enable the extension. The setting contains no
   credentials and is off by default.
2. In the local browser wizard, choose the existing profile and **Edit settings
   and authentication** (or **Reset authentication** when credentials are
   missing). Existing connection/authentication
   fields and access scope are filled; secrets are never filled or displayed.
   Enter the replacement credential locally, or complete browser OAuth.
3. Verify the connection and finish. Failed or cancelled verification preserves
   the existing profile and secret; successful renewal keeps its configured
   scope. After saving, that profile's cached SAP client is disconnected so the
   next call uses the current credentials/settings. Other profiles stay
   connected; already-running SAP operations are not cancelled. This path
   never adds a duplicate MCP registration.
4. Turn **Open SAP setup on startup** off in the extension's settings. Leaving
   it on intentionally opens the wizard on every extension restart; the server
   cannot change the host's setting for you.
5. Confirm the real SAP identity with the first-query prompt. A renewed saved
   credential alone is not evidence of a successful SAP query.

The extension maps this checkbox to `SAP_ABAP_MCP_OPEN_SETUP=true` while running
`serve --onboard-if-empty`. The ordinary default still opens setup only for
zero profiles. This explicit local stdio flow is unavailable in HTTP server
mode. Do not paste credentials or the token-bearing setup URL into chat.

The setup URL belongs to the running MCP process. Closing the app or restarting
the extension closes that URL. If setup has not saved a profile, enabling the
extension again starts a fresh wizard. A saved profile survives a restart.
Do not treat a disconnected setup page as loss of a saved credential.

## Maintainer verification

```sh
npm run build:mcpb
```

The build uses pinned esbuild 0.27.2 and MCPB 2.1.2. The standalone entry is
`dist/src/index.js`, preserving relative package-metadata lookup, and the root
includes `package.json`. Before packing, `check-mcpb-runtime.mjs` launches the
staged bundle using an absolute host Node executable and an empty PATH. It
checks an empty first run, a suppressed existing isolated read-only profile and
an explicitly reopened existing profile, five
advertised tools, gateway system-list behavior, the version, hosted setup,
unverified-finish refusal and shutdown of the local setup listener. It does
not need source/dependency files outside the bundle's stage. CI invokes the
build for Node 20, 22 and 24; remote CI has not been run for this local change.
Node 20 is retained for minimum-version compatibility checks. The latest LTS
runtime, rather than a compatibility minimum, is recommended for use.

[Local verification](competitive-mcpb-2026-10-01/verification.json) records the
initial package-metadata failure, final bundle SHA-256, clean archive launch,
source hashes and synthetic UI checks. A successful MCPB manifest validation
alone did not catch the old startup failure. Actual Claude Desktop installation,
Windows runtime/DPAPI, live SAP/IdP login, signed release and novice-user tests
remain separate acceptance gates. No user host settings, Keychain credentials
or SAP systems were changed by these verification runs.

OAuth renewal also rejects late responses from invalidated requests and
coordinates refresh/setup credential writes for each profile in the same
server process. A refresh against a replaced stored credential is rejected;
an already-running write finishes before a queued setup save, so the new login
remains last. Failed setup writes finish their rollback before a later save.
Different profiles can proceed independently. This uses the shared SecretStore
instance and does not coordinate separate CLI/server processes or undo an
operating-system credential write. Synthetic delay and failure tests, source
hashes and unchanged normal-workflow token measurements are recorded in the
[OAuth renewal verification](competitive-oauth-renewal-2026-10-01/verification.json).

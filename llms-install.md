# SAP ABAP MCP installation for coding agents

This package runs as a local `stdio` MCP server by default and connects directly from the user's machine to SAP ADT. A governed self-hosted Streamable HTTP mode is also available for operators who configure authentication, authorization, TLS termination, and audit controls. Do not ask the user to paste an SAP password or OAuth token into chat.

## Prerequisites

- Node.js 20 or later
- Network or VPN access to the SAP system
- SAP ADT HTTPS URL and client number, plus Basic Auth, OAuth client credentials, browser OAuth Authorization Code with PKCE, or an operator-managed OIDC token accepted by SAP

## Create and verify a local SAP profile

When the Claude Code plugin is installed, reload it and invoke its namespaced setup skill:

```text
/reload-plugins
/sap-abap-mcp:sap-abap-setup
```

The skill must direct the user to the interactive setup wizard, then verify the exact Server name selected by the user. `/mcp` proves that the local plugin process started; it does not prove that SAP authentication succeeded.

For manual setup, run this outside the MCP process:

```bash
npx @coaspe/sap-abap-mcp@latest setup
```

The wizard labels the local connection alias as `Server name` and the endpoint as `SAP URL`. On macOS or Windows it verifies SAP before saving and stores the hidden password in macOS Keychain or Windows DPAPI. On Windows, use `npx.cmd`. PowerShell uses a backtick for multiline commands and Command Prompt uses a caret; the one-line wizard command avoids that distinction. Keep production servers marked as `production`; the server rejects writes for those profiles.

To change or remove a saved server, use the same local wizard. Omit the Server name to choose from a list:

```text
<npx> @coaspe/sap-abap-mcp@latest setup edit [<server-name>]
<npx> @coaspe/sap-abap-mcp@latest setup remove [<server-name>]
```

Editing keeps the Server name fixed. On Windows and macOS it verifies SAP before replacing the saved values; Linux verifies when the matching password environment variable is available and otherwise prints the authentication steps again. Removal displays the selected server, defaults to `No`, and deletes its stored SAP and abapGit credentials after confirmation.

The wizard creates Basic Auth profiles. For explicit OAuth client credentials, use `profile add --auth-type oauth-client-credentials --token-url <url> --client-id <id> [--scope <scope>] --login`; enter the client secret only at the hidden local prompt. On macOS or Windows, browser SSO uses `--auth-type oauth-authorization-code --authorization-url <url> --token-url <url> --client-id <id> [--scope <scope>] --login` with a loopback redirect and S256 PKCE. Linux's environment-only secret store cannot safely persist or rotate a browser credential, so browser login is refused there; use Basic Auth or client credentials from a profile-specific environment variable instead.

In self-hosted HTTP mode, `--auth-type bearer-passthrough` creates a profile
that accepts only an OIDC-authenticated session token and forwards it to SAP in
an isolated request-scoped client. The token must already be valid for SAP;
static API keys are never forwarded and this mode does not perform BTP token
exchange.

Optional Screen/Dynpro and GUI Status access requires a reviewed SAP-side
bridge plus `--classic-bridge-path /sap/<path>`. Read
[`docs/classic-bridge.md`](docs/classic-bridge.md) before enabling it.

On Linux, the wizard saves the non-secret server settings and prints the exact `SAP_ABAP_MCP_PASSWORD_<NORMALIZED_SERVER_NAME>` commands. Set it with a hidden shell prompt and start Claude Code from the same shell. For example, `DEV-100` uses `SAP_ABAP_MCP_PASSWORD_DEV_100`:

```bash
read -rsp "SAP password: " SAP_ABAP_MCP_PASSWORD_DEV_100; echo
export SAP_ABAP_MCP_PASSWORD_DEV_100
claude
```

Linux does not persist the password. Never put it in `profiles.json` or paste it into an agent conversation.

## MCP configuration

Use `npx` on macOS/Linux and `npx.cmd` on Windows:

```json
{
  "mcpServers": {
    "sap-abap": {
      "command": "npx",
      "args": [
        "--yes",
        "--prefer-online",
        "@coaspe/sap-abap-mcp@latest",
        "serve",
        "--profile",
        "DEV100"
      ]
    }
  }
}
```

Omit `--profile DEV100` only when the user intentionally wants all locally configured profiles exposed. Every SAP-facing tool still requires an explicit `connectionId`.

Start with read-only discovery and source inspection. SAP-dependent development-parity capabilities remain `unverified` until they succeed against the selected live connection.

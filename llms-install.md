# SAP ABAP MCP installation for coding agents

This package is a local `stdio` MCP server. It connects directly from the user's machine to SAP ADT. Do not deploy it as a shared remote proxy and do not ask the user to paste an SAP password into chat.

## Prerequisites

- Node.js 20 or later
- Network or VPN access to the SAP system
- SAP ADT HTTPS URL, client number, user name, and Basic Auth permission

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

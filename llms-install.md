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

The skill must list existing profiles first, reuse the profile selected by the user, and collect only non-secret settings. `/mcp` proves that the local plugin process started; it does not prove that SAP authentication succeeded.

For manual setup on macOS or Windows, run this outside the MCP process so the password is entered through the hidden terminal prompt and stored in macOS Keychain or Windows DPAPI:

```bash
npx --yes --prefer-online @coaspe/sap-abap-mcp@latest profile add DEV100 \
  --url "https://sap-dev.company.com" \
  --client 100 \
  --username "DEV_USER" \
  --environment development \
  --login

npx --yes --prefer-online @coaspe/sap-abap-mcp@latest doctor DEV100
```

On Windows, use `npx.cmd`. PowerShell uses a backtick for multiline commands and Command Prompt uses a caret; a one-line command avoids that distinction. Keep production profiles marked as `production`; the server rejects writes for those profiles.

On Linux, create the profile without `--login`, set `SAP_ABAP_MCP_PASSWORD_<NORMALIZED_PROFILE_ID>` with a hidden shell prompt, and start Claude Code from the same shell. For example, `DEV-100` uses `SAP_ABAP_MCP_PASSWORD_DEV_100`:

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

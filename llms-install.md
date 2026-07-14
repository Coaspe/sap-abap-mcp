# SAP ABAP MCP installation for coding agents

This package is a local `stdio` MCP server. It connects directly from the user's machine to SAP ADT. Do not deploy it as a shared remote proxy and do not ask the user to paste an SAP password into chat.

## Prerequisites

- Node.js 20 or later
- Network or VPN access to the SAP system
- SAP ADT HTTPS URL, client number, user name, and Basic Auth permission

## Create and verify a local SAP profile

Run this outside the MCP process so the password is entered through the hidden terminal prompt and stored in macOS Keychain or Windows DPAPI:

```bash
npx --yes --prefer-online @coaspe/sap-abap-mcp@latest profile add DEV100 \
  --url "https://sap-dev.company.com" \
  --client 100 \
  --username "DEV_USER" \
  --environment development \
  --login

npx --yes --prefer-online @coaspe/sap-abap-mcp@latest doctor DEV100
```

On Windows, use `npx.cmd` and PowerShell line continuations instead. Keep production profiles marked as `production`; the server rejects writes for those profiles.

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

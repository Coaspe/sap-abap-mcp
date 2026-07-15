# SAP ABAP MCP plugin

This plugin starts [`@coaspe/sap-abap-mcp`](https://www.npmjs.com/package/@coaspe/sap-abap-mcp) as a local `stdio` MCP server in Claude Code or Codex. SAP profiles, credentials, and ADT traffic stay on the user's computer.

## Prerequisites

- Node.js 20 or later
- A reachable SAP system with ADT services enabled
- The SAP base URL, client number, username, environment classification, and optional package allowlist

## Claude Code

```text
/plugin marketplace add Coaspe/sap-abap-mcp
/plugin install sap-abap-mcp@coaspe-sap
/reload-plugins
```

Configure or verify the local SAP profile before the first SAP-facing request:

```text
/sap-abap-mcp:sap-abap-setup
```

The skill collects only non-secret connection settings. On Windows or macOS it asks the user to enter the SAP password at a hidden prompt in a trusted terminal. On Linux it guides the user to set a profile-specific environment variable and restart Claude Code from that environment. Never paste an SAP password into Claude.

Use `/mcp` to confirm that the plugin process is connected. That status alone does not prove that SAP authentication succeeded; the setup skill runs `doctor` for live ADT verification.

## Codex

```bash
codex plugin marketplace add Coaspe/sap-abap-mcp
```

Install **SAP ABAP MCP** from the `Coaspe SAP Developer Tools` marketplace in the Codex app, then start a new task.

Every SAP-facing tool requires an explicit `connectionId`. Live SAP behavior depends on the selected SAP release, configuration, and authorizations.

Profiles are stored in `%APPDATA%\sap-abap-mcp\profiles.json` on Windows and `$XDG_CONFIG_HOME/sap-abap-mcp/profiles.json` or `~/.config/sap-abap-mcp/profiles.json` on macOS or Linux. They are outside the plugin cache and survive plugin updates. Passwords are stored separately with Windows DPAPI or macOS Keychain; Linux reads them only from the process environment.

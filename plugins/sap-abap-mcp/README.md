# SAP ABAP MCP plugin

This plugin starts [`@coaspe/sap-abap-mcp`](https://www.npmjs.com/package/@coaspe/sap-abap-mcp) as a local `stdio` MCP server in Claude Code or Codex. SAP profiles, credentials, and ADT traffic stay on the user's computer.

## Prerequisites

- Node.js 20 or later
- A reachable SAP system with ADT services enabled
- A local SAP profile configured with the `sap-abap-setup` skill or the commands in the main [installation guide](https://github.com/Coaspe/sap-abap-mcp/blob/main/llms-install.md)

## Claude Code

```text
/plugin marketplace add Coaspe/sap-abap-mcp
/plugin install sap-abap-mcp@coaspe-sap
```

Run `/reload-plugins` after installation, then use `/mcp` to confirm that `sap-abap` is connected.

## Codex

```bash
codex plugin marketplace add Coaspe/sap-abap-mcp
```

Install **SAP ABAP MCP** from the `Coaspe SAP Developer Tools` marketplace in the Codex app, then start a new task.

Every SAP-facing tool requires an explicit `connectionId`. Live SAP behavior depends on the selected SAP release, configuration, and authorizations.

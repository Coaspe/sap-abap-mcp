# SAP ABAP MCP plugin

This plugin starts [`@coaspe/sap-abap-mcp`](https://www.npmjs.com/package/@coaspe/sap-abap-mcp) as a local `stdio` MCP server in Claude Code or Codex. SAP profiles, credentials, and ADT traffic stay on the user's computer.

## Prerequisites

- Node.js 20 or later
- A reachable SAP system with ADT services enabled
- The SAP URL, client number, username, environment classification, and optional package allowlist

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

The skill launches onboarding through the interactive `npx @coaspe/sap-abap-mcp@latest setup` wizard. The wizard calls the local connection alias `Server name`, calls the endpoint `SAP URL`, and keeps the SAP password out of chat. On Windows or macOS the user enters it at a hidden prompt in a trusted terminal. On Linux the wizard prints instructions for a server-specific environment variable and restarting Claude Code from that environment. Never paste an SAP password into Claude.

The same wizard manages saved servers. Use `setup edit [<server-name>]` to update one, or `setup remove [<server-name>]` to review and delete one with its stored credentials. Windows and macOS reverify edits before saving; Linux verifies when its server-specific password environment variable is available. On Windows, replace `npx` with `npx.cmd`:

```text
npx @coaspe/sap-abap-mcp@latest setup edit DEV100
npx @coaspe/sap-abap-mcp@latest setup remove DEV100
```

Use `/mcp` to confirm that the plugin process is connected. That status alone does not prove that SAP authentication succeeded; the setup skill runs `doctor` for live ADT verification.

OAuth client credentials and browser OAuth Authorization Code with PKCE are explicit advanced profile types; the wizard continues to create Basic Auth profiles. Ask the setup skill for the local `profile add --auth-type oauth-client-credentials|oauth-authorization-code` workflow. Browser login requires macOS Keychain or Windows DPAPI; Linux's environment-only store cannot safely persist token rotation. Client secrets or browser tokens stay in the protected local secret store, and access tokens are never placed in MCP arguments. A self-hosted OIDC HTTP deployment can instead use an explicit `bearer-passthrough` profile when SAP accepts the same user token.

## Assess a transport before release

Run the bundled change-assurance skill:

```text
/sap-abap-mcp:sap-abap-change-assurance
```

It uses the read-only `assess_transport` action to combine ATC, ABAP Unit, and optional target-system comparison without releasing the transport. CI workflows can request JSON, SARIF 2.1.0, and JUnit XML evidence. A truncated or failed check returns `incomplete`, never a pass.

## Codex

```bash
codex plugin marketplace add Coaspe/sap-abap-mcp
```

Install **SAP ABAP MCP** from the `Coaspe SAP Developer Tools` marketplace in the Codex app, then start a new task.

Every SAP-facing tool requires an explicit `connectionId`. Live SAP behavior depends on the selected SAP release, configuration, and authorizations.

The default v1 server advertises all 120 tools. For lower prompt/schema token use, launch with `serve --preset compact` (12 everyday read/inspect tools), `--preset development` (34 development tools), or `--preset assurance` (15 read-only review tools). The current surface adds typed DDIC workflows, enhancement inspection, bounded runtime feeds, confirmed executable-program profiling, and an opt-in same-origin Screen/GUI Status bridge while keeping the compact preset unchanged. See [`docs/advanced-workflows.md`](../../docs/advanced-workflows.md) and [`docs/classic-bridge.md`](../../docs/classic-bridge.md) for the composed and optional workflows.

Node.js applications can also import `createEmbeddedMcpServer` from the package root, provide their own SAP connection provider, and attach the MCP transport managed by the host application. Importing the library entry does not start the CLI.

Tool results through 40 KiB are normally returned unchanged. Larger JSON results use a `compact-v1` envelope with a structural summary, exact preview, temporary `resultId`, and `nextOffset`. Repetitive `search_abap_object_lines` results switch at 16 KiB and merge overlapping context in the summary. Use the summary first; call `read_deferred_result` only when exact omitted data is needed. The local in-memory result expires after ten minutes, is never written to disk, and does not repeat the SAP request.

Profiles are stored in `%APPDATA%\sap-abap-mcp\profiles.json` on Windows and `$XDG_CONFIG_HOME/sap-abap-mcp/profiles.json` or `~/.config/sap-abap-mcp/profiles.json` on macOS or Linux. They are outside the plugin cache and survive plugin updates. Passwords are stored separately with Windows DPAPI or macOS Keychain; Linux reads them only from the process environment.

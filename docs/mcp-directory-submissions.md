# MCP directory submission reference

Use this canonical copy for directory submissions. Do not describe the server as remotely hosted: it runs locally over `stdio` and connects from the user's machine to SAP ADT.

## Listing metadata

- Name: SAP ABAP MCP
- Official registry name: `io.github.Coaspe/sap-abap-mcp`
- Version: `0.4.5`
- Repository: `https://github.com/Coaspe/sap-abap-mcp`
- npm: `https://www.npmjs.com/package/@coaspe/sap-abap-mcp`
- License: MIT
- Category: Developer Tools
- Platforms: macOS, Windows, and Linux (environment-variable credentials only)
- Tags: MCP, SAP, ABAP, ADT, Claude, Codex, developer tools
- Logo: `https://raw.githubusercontent.com/Coaspe/sap-abap-mcp/main/assets/directory-icon.png`

Short description:

> Develop, test, analyze, and operate SAP ABAP systems through ADT from AI coding agents.

Long description:

> SAP ABAP MCP is a local Model Context Protocol server for ABAP development through SAP's ABAP Development Tools HTTP services. It supports source inspection and editing, semantic services, activation, ABAP Unit and ATC, transports, abapGit, RAP generation, runtime inspection, cross-system comparison, dependency analysis, and guarded refactoring. SAP profiles and credentials remain on the user's computer in macOS Keychain, Windows DPAPI, or profile-specific environment variables on Linux. SAP-dependent capabilities require validation against the user's own SAP release, configuration, and authorizations.

## Generic local installation

```json
{
  "mcpServers": {
    "sap-abap": {
      "command": "npx",
      "args": [
        "--yes",
        "--prefer-online",
        "@coaspe/sap-abap-mcp@latest",
        "serve"
      ]
    }
  }
}
```

On Windows, use `npx.cmd`. The user must create and verify a local SAP profile before starting the server; see [`llms-install.md`](../llms-install.md). Omit a fixed profile only when all locally configured profiles should be available. Every SAP-facing tool still requires an explicit `connectionId`.

## Data handling and verification boundary

- The server is local-only and does not send SAP credentials to an MCP directory.
- Passwords are stored in macOS Keychain or Windows DPAPI. Linux reads profile-specific password environment variables without persisting them.
- Network traffic goes directly from the user's computer to the configured SAP system and to npm when `npx` installs or updates the package.
- Automated tests use an in-memory SAP implementation. SAP-dependent capabilities remain `unverified` until they succeed against the selected live SAP connection.

## Submission status (2026-07-15)

| Target | Status | Evidence or next action |
|---|---|---|
| npm | Live | [`@coaspe/sap-abap-mcp`](https://www.npmjs.com/package/@coaspe/sap-abap-mcp), version 0.4.4 on `latest` |
| Official MCP Registry | Live | [`io.github.Coaspe/sap-abap-mcp`](https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.Coaspe/sap-abap-mcp), version 0.4.4 active and latest |
| Smithery | Live and listed | [`aspalt85/sap-abap-mcp`](https://smithery.ai/servers/aspalt85/sap-abap-mcp); expanded metadata and all 52 runtime tools are visible, with a current quality score of 78/100. The latest local MCPB release has no Smithery security-scan result and the listing is not verified |
| Glama | Live, cache stale | [`Coaspe/sap-abap-mcp`](https://glama.ai/mcp/servers/Coaspe/sap-abap-mcp); claim the listing to request a refresh |
| PulseMCP | Pending ingestion | The site imports the Official MCP Registry daily and processes new entries weekly |
| MCP Server Hub | Submitted | Awaiting directory review |
| Awesome MCP Servers | Draft PR opened | [`punkpeye/awesome-mcp-servers#10129`](https://github.com/punkpeye/awesome-mcp-servers/pull/10129) |
| Claude Code Community Marketplace | Submitted; review pending | Submitted through the Anthropic Console on 2026-07-15 as `Coaspe ABAP MCP` for Claude Code; the public GitHub plugin validates and installs as `sap-abap-mcp@coaspe-sap` |
| Claude Desktop MCPB directory | Submitted; review pending | Submitted the validated `sap-abap-mcp-0.4.4.mcpb` through Anthropic's official local-extension form on 2026-07-15; the form confirmed that the response was recorded |
| Codex repository marketplace | Live | Public GitHub marketplace installs as `sap-abap-mcp@coaspe-sap` |
| Codex universal plugin directory | Blocked by prerequisites | The official `With MCP` flow requires completed OpenAI developer identity verification and a production public HTTPS MCP endpoint; the current local `stdio` server cannot be submitted as-is |
| LobeHub | Live | [`coaspe-sap-abap-mcp`](https://lobehub.com/mcp/coaspe-sap-abap-mcp), generated from the GitHub repository on 2026-07-15 |
| mcp.so | Submitted; review queued | [Submission `cf81d7cd-ac1a-4876-b3f4-c2c7841b6a64`](https://mcp.so/settings/submissions/cf81d7cd-ac1a-4876-b3f4-c2c7841b6a64/edit); canonical metadata and the local `stdio` configuration were saved after automated extraction |
| MCP Servers | Submitted; review pending | Free submission confirmed on 2026-07-15; the confirmation page stated that review is expected within 12 hours and the result will be sent by email |
| MCP Market | Submitted; review queued | Free submission confirmed on 2026-07-15; the confirmation page reported an estimated 4–6 week queue and email notification when live |
| Cline MCP Marketplace | Submitted; review pending | [`cline/mcp-marketplace#2030`](https://github.com/cline/mcp-marketplace/issues/2030); before submission, Cline used only `README.md` and `llms-install.md` to create the configuration, complete a real MCP initialization, discover all 52 tools, and stop with exit code 0 and empty stderr |

## Distribution targets

| Target | Distribution path |
|---|---|
| Official MCP Registry | Publish `server.json` with `mcp-publisher` after npm publication |
| Glama and PulseMCP | Verify ingestion from the Official MCP Registry; submit the repository manually if absent |
| Smithery | Run `npm run publish:smithery`; it validates and builds the MCPB, refreshes listing metadata, and publishes the complete runtime tool schemas through the release API |
| Claude Code | Monitor the submitted `Coaspe ABAP MCP` listing in the Anthropic Console and respond if the review team requests more information |
| Claude Desktop | Monitor the submitted MCPB listing and respond if Anthropic requests more information |
| Codex | Distribute the repository marketplace immediately; complete developer identity verification and design a production HTTPS MCP architecture before using the universal `With MCP` submission flow |
| Cline MCP Marketplace | Monitor [`cline/mcp-marketplace#2030`](https://github.com/cline/mcp-marketplace/issues/2030) and respond if the review team requests changes |
| mcp.so, MCP Servers, MCP Market, MCP Server Hub | Monitor the submitted listings and respond to review email or requested changes |
| LobeHub | Verify that [`coaspe-sap-abap-mcp`](https://lobehub.com/mcp/coaspe-sap-abap-mcp) refreshes after each repository release |

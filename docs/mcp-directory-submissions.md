# MCP directory submission reference

Use this canonical copy for directory submissions. Do not describe the server as remotely hosted: it runs locally over `stdio` and connects from the user's machine to SAP ADT.

## Listing metadata

- Name: SAP ABAP MCP
- Official registry name: `io.github.Coaspe/sap-abap-mcp`
- Version: `0.4.3`
- Repository: `https://github.com/Coaspe/sap-abap-mcp`
- npm: `https://www.npmjs.com/package/@coaspe/sap-abap-mcp`
- License: MIT
- Category: Developer Tools
- Platforms: macOS and Windows
- Tags: MCP, SAP, ABAP, ADT, Claude, Codex, developer tools
- Logo: `https://raw.githubusercontent.com/Coaspe/sap-abap-mcp/main/assets/directory-icon.png`

Short description:

> Develop, test, analyze, and operate SAP ABAP systems through ADT from AI coding agents.

Long description:

> SAP ABAP MCP is a local Model Context Protocol server for ABAP development through SAP's ABAP Development Tools HTTP services. It supports source inspection and editing, semantic services, activation, ABAP Unit and ATC, transports, abapGit, RAP generation, runtime inspection, cross-system comparison, dependency analysis, and guarded refactoring. SAP profiles and credentials remain on the user's computer in macOS Keychain or Windows DPAPI. SAP-dependent capabilities require validation against the user's own SAP release, configuration, and authorizations.

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
- Passwords are stored in macOS Keychain or Windows DPAPI, not in the profile file.
- Network traffic goes directly from the user's computer to the configured SAP system and to npm when `npx` installs or updates the package.
- Automated tests use an in-memory SAP implementation. SAP-dependent capabilities remain `unverified` until they succeed against the selected live SAP connection.

## Submission status (2026-07-15)

| Target | Status | Evidence or next action |
|---|---|---|
| Official MCP Registry | Live | [`io.github.Coaspe/sap-abap-mcp`](https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.Coaspe/sap-abap-mcp), version 0.4.3 |
| Smithery | Live | [`aspalt85/sap-abap-mcp`](https://smithery.ai/servers/aspalt85/sap-abap-mcp); its generated description remains empty because of [smithery-ai/cli#787](https://github.com/smithery-ai/cli/issues/787) |
| Glama | Live, cache stale | [`Coaspe/sap-abap-mcp`](https://glama.ai/mcp/servers/Coaspe/sap-abap-mcp); claim the listing to request a refresh |
| PulseMCP | Pending ingestion | The site imports the Official MCP Registry daily and processes new entries weekly |
| MCP Server Hub | Submitted | Awaiting directory review |
| Awesome MCP Servers | Draft PR opened | [`punkpeye/awesome-mcp-servers#10129`](https://github.com/punkpeye/awesome-mcp-servers/pull/10129) |
| LobeHub | Authentication required | Complete the human-in-the-loop CLI authorization, connect GitHub, then submit the repository |
| mcp.so | Authentication required | Sign in before submitting the already prepared repository listing |
| MCP Servers and MCP Market | Contact email required | Submit only after the owner approves the contact email sent to both directories |
| Cline MCP Marketplace | Setup test required | Perform a real Cline installation test before checking the submission form's required verification box |

## Distribution targets

| Target | Distribution path |
|---|---|
| Official MCP Registry | Publish `server.json` with `mcp-publisher` after npm publication |
| Glama and PulseMCP | Verify ingestion from the Official MCP Registry; submit the repository manually if absent |
| Smithery | Publish the generated MCPB bundle from `artifacts/` |
| Cline MCP Marketplace | Submit the GitHub repository and 400 by 400 PNG logo through its issue form |
| mcp.so, MCP Servers, MCP Market, MCP Server Hub, LobeHub | Submit the repository URL and canonical metadata above |

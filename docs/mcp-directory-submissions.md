# MCP directory submission reference

Use this canonical copy for directory submissions. Do not describe the server as remotely hosted: it runs locally over `stdio` and connects from the user's machine to SAP ADT.

## Listing metadata

- Name: SAP ABAP MCP
- Official registry name: `io.github.Coaspe/sap-abap-mcp`
- Version: `0.4.2`
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

## Distribution targets

| Target | Distribution path |
|---|---|
| Official MCP Registry | Publish `server.json` with `mcp-publisher` after npm publication |
| Glama and PulseMCP | Verify ingestion from the Official MCP Registry; submit the repository manually if absent |
| Smithery | Publish the generated MCPB bundle from `artifacts/` |
| Cline MCP Marketplace | Submit the GitHub repository and 400 by 400 PNG logo through its issue form |
| mcp.so, MCP Servers, MCP Market, MCP Server Hub, LobeHub | Submit the repository URL and canonical metadata above |

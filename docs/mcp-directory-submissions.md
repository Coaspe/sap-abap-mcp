# MCP directory submission reference

Use this canonical copy for directory submissions. Do not describe the server as remotely hosted: it runs locally over `stdio` and connects from the user's machine to SAP ADT.

## Listing metadata

- Name: SAP ABAP MCP
- Official registry name: `io.github.Coaspe/sap-abap-mcp`
- Current source release: `1.3.1`
- Currently published version: `1.3.1`
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

> SAP ABAP MCP is a headless, client-neutral, governance-first Model Context Protocol server for ABAP development through SAP's ABAP Development Tools HTTP services. Its default v1 surface provides 120 action-specific tools and seven Resources for source and structured DDIC work, semantic and enhancement inspection, activation, ABAP Unit and ATC, transports, abapGit, RAP generation, profiled execution, runtime feeds, optional classic Screen/GUI Status access, cross-system comparison, dependency analysis, and guarded refactoring. SAP profiles and credentials remain on the user's computer in macOS Keychain, Windows DPAPI, or profile-specific environment variables on Linux. SAP-dependent capabilities require validation against the user's own SAP release, configuration, and authorizations.

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

## Submission status (2026-08-19)

| Target | Status | Evidence or next action |
|---|---|---|
| npm | Live at 1.3.1 | [`@coaspe/sap-abap-mcp`](https://www.npmjs.com/package/@coaspe/sap-abap-mcp) has version 1.3.1 on `latest`; published through the provenance-enabled [`Publish npm`](../.github/workflows/publish-npm.yml) workflow |
| Official MCP Registry | Live at 1.3.1 | [`io.github.Coaspe/sap-abap-mcp`](https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.Coaspe/sap-abap-mcp) exposes 1.3.1; published through the GitHub OIDC [`Publish MCP Registry`](../.github/workflows/publish-mcp-registry.yml) workflow |
| GitHub Release | Complete | [`v1.3.1`](https://github.com/Coaspe/sap-abap-mcp/releases/tag/v1.3.1) includes release notes, `sap-abap-mcp-1.3.1.mcpb`, and its SHA-256 checksum |
| Smithery | Live with 120 tools | [`aspalt85/sap-abap-mcp`](https://smithery.ai/servers/aspalt85/sap-abap-mcp) has the current release metadata and complete 120-tool runtime schemas |
| Glama | Live; automatic re-index pending | [`Coaspe/sap-abap-mcp`](https://glama.ai/mcp/servers/Coaspe/sap-abap-mcp) is claimed and author-verified. Glama continuously synchronizes GitHub repositories, but its public page still showed the earlier README during the 2026-07-29 verification |
| PulseMCP | Pending ingestion | The site imports the Official MCP Registry daily and processes new entries weekly |
| MCP Server Hub | Submitted | Awaiting directory review |
| Awesome MCP Servers | Ready for review | [`punkpeye/awesome-mcp-servers#10129`](https://github.com/punkpeye/awesome-mcp-servers/pull/10129) is open; the submission description references v1.3.1 and the current 120-tool catalog |
| GitHub Discussions | Live | [`SAP ABAP MCP 1.0` announcement](https://github.com/Coaspe/sap-abap-mcp/discussions/4) is published; repository Discussions and adoption feedback are enabled |
| Claude Code Community Marketplace | Submitted; review pending | Submitted through the Anthropic Console on 2026-07-15 as `Coaspe ABAP MCP` for Claude Code; the public GitHub plugin validates and installs as `sap-abap-mcp@coaspe-sap` |
| Claude Desktop MCPB directory | v1.3.1 update pending | The prior v1.0.0 update was submitted on 2026-07-29; the validated v1.3.1 MCPB is attached to GitHub Release and needs a new Anthropic directory submission |
| Codex repository marketplace | Live | Public GitHub marketplace installs as `sap-abap-mcp@coaspe-sap`; its manifests advertise 1.3.1 and resolve the npm 1.3.1 `latest` runtime |
| Codex universal plugin directory | Blocked by prerequisites | The official `With MCP` flow requires completed OpenAI developer identity verification and a production public HTTPS MCP endpoint; the current local `stdio` server cannot be submitted as-is |
| LobeHub | Live at 1.3.1 | [`coaspe-sap-abap-mcp`](https://lobehub.com/mcp/coaspe-sap-abap-mcp) was owner-updated with the official CLI and an introspected manifest containing the default 120 tools and seven Resources |
| mcp.so | v1.3.1 submitted; review pending | [`chatmcp/mcpso#3642`](https://github.com/chatmcp/mcpso/issues/3642) contains the current release, install command, 120-tool/7-Resource default, token-efficient presets, and safety boundaries; the paid immediate-publication path was not used |
| MCP Servers | Live; 1.3.1 refresh pending | [`coaspe/sap-abap-mcp`](https://mcpservers.org/servers/coaspe/sap-abap-mcp) displays repository README content; refresh its index after the 1.3.1 README reaches the default branch |
| MCP Market | Submitted; review queued | Free submission confirmed on 2026-07-15; the confirmation page reported an estimated 4–6 week queue and email notification when live |
| Cline MCP Marketplace | Submitted; review pending | [`cline/mcp-marketplace#2030`](https://github.com/cline/mcp-marketplace/issues/2030) is open with v1.3.1 release and 120-tool validation details |
| SAP Community | Submitted; awaiting review | The English article was submitted on 2026-07-29 as article `179906`. Its planned public URL is [`sap-abap-mcp-1-0-headless-abap-development-for-ai-coding-agents`](https://community.sap.com/t5/technology-blog-posts-by-members/sap-abap-mcp-1-0-headless-abap-development-for-ai-coding-agents/ba-p/14451008) |

## Distribution targets

| Target | Distribution path |
|---|---|
| npm | Run the manual [`Publish npm`](../.github/workflows/publish-npm.yml) workflow; npm Trusted Publishing uses GitHub OIDC and requires no stored npm token or OTP |
| Official MCP Registry | After npm is public, run the manual [`Publish MCP Registry`](../.github/workflows/publish-mcp-registry.yml) workflow; it validates and publishes `server.json` with GitHub OIDC |
| GitHub Release | Tag the verified release commit and attach the validated MCPB bundle |
| Glama and PulseMCP | Verify ingestion from the Official MCP Registry; submit the repository manually if absent |
| Smithery | Run `npm run publish:smithery`; it validates and builds the MCPB, refreshes listing metadata, and publishes the complete runtime tool schemas through the release API |
| Claude Code | Monitor the submitted `Coaspe ABAP MCP` listing in the Anthropic Console and respond if the review team requests more information |
| Claude Desktop | Monitor the submitted MCPB listing and respond if Anthropic requests more information |
| Codex | Distribute the repository marketplace immediately; complete developer identity verification and design a production HTTPS MCP architecture before using the universal `With MCP` submission flow |
| Cline MCP Marketplace | Monitor [`cline/mcp-marketplace#2030`](https://github.com/cline/mcp-marketplace/issues/2030) and respond if the review team requests changes |
| mcp.so, MCP Servers, MCP Market, MCP Server Hub | Monitor the submitted listings and respond to review email or requested changes |
| LobeHub | Verify that [`coaspe-sap-abap-mcp`](https://lobehub.com/mcp/coaspe-sap-abap-mcp) refreshes after each repository release |

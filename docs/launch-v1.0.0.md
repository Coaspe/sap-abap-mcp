# SAP ABAP MCP 1.0: headless ABAP development for AI coding agents

SAP ABAP MCP 1.0 is now available as a local, open-source Model Context
Protocol server for ABAP development through SAP's ABAP Development Tools
(ADT) HTTP services.

It is designed for teams that want Codex, Claude, or another local MCP host to
work across SAP systems without making an IDE process the automation runtime.
The server runs locally over `stdio`; SAP profiles, credentials, source, and
tool results are not sent to a publisher-operated service.

## What 1.0 includes

The default v1 surface exposes 115 action-specific tools and seven Resources.
The tools cover repository and semantic inspection, guarded source changes,
ABAP Unit and ATC, transport assurance, abapGit, RAP generation and service
bindings, runtime analysis, debugging, cross-system comparison, and artifact
generation. The previous 53-tool grouped surface remains available with
`--api-version v0` for compatible clients.

Installation begins with a local verification:

```bash
npx @coaspe/sap-abap-mcp@latest setup
```

The wizard verifies the selected SAP connection before saving it. Passwords are
protected by macOS Keychain or Windows DPAPI; Linux uses a profile-specific
environment variable and does not persist the secret.

## Why a headless server

SAP provides an official ADT MCP Server in its ADT clients. That is the right
starting point for SAP-supported, client-integrated workflows. SAP ABAP MCP
serves a complementary operating model: an independent local process for
client-neutral automation, multiple named SAP profiles, and explicit
governance boundaries.

The project blocks writes to profiles classified as production. Development
and quality profiles can be restricted to explicit package allowlists.
Destructive or externally visible changes use preview and confirmation
contracts. Transport assessment is read-only and can create JSON, SARIF, and
JUnit evidence without releasing the transport.

## Evidence instead of blanket compatibility claims

ADT behavior varies by SAP release, installed components, activated services,
and user authorizations. For that reason the server separates four questions:

1. Is the capability implemented locally?
2. Does the selected SAP system expose the endpoint?
3. Is the current user authorized?
4. Has the exact operation succeeded on this connection?

Automated tests prove the local MCP contract against in-memory SAP doubles.
They do not turn an untested SAP release into a supported system. Sanitized
live evidence is recorded separately.

## Toward an interoperable SAP ABAP MCP profile

The repository includes an open compatibility profile and a conformance
command that can inspect another local stdio implementation. The first profile
focuses on system discovery, repository reads, diagnostics, ABAP Unit, ATC,
transport inspection and assessment, RAP availability, and evidence Resources.
Write operations remain optional because safe mutation policies cannot be
reduced to a tool name.

This profile is a proposal, not an SAP standard. It should become neutral only
after independent implementations and organizations validate it and share
governance.

## Try it and report evidence

- Repository: https://github.com/Coaspe/sap-abap-mcp
- npm: https://www.npmjs.com/package/@coaspe/sap-abap-mcp
- Official MCP Registry identity: `io.github.Coaspe/sap-abap-mcp`
- License: MIT

Questions, reproducible defects, implementation feedback, and sanitized
adoption reports are welcome. Never include SAP credentials, proprietary
source, internal hosts, or business data in a public post.

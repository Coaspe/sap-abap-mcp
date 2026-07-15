# SAP ABAP MCP Privacy Policy

Effective date: July 15, 2026

## Scope

This policy applies to SAP ABAP MCP, including its npm package, MCP Bundle (MCPB), and Claude Code and Codex plugins. The software runs on the user's computer and connects to systems selected by the user.

## Data processed by the software

SAP ABAP MCP processes only the data needed to perform user-requested operations, which may include:

- SAP connection profile settings such as system URL, client, language, user name, environment, and allowed packages.
- SAP credentials and abapGit credentials stored in the operating system's protected credential store.
- SAP repository source, metadata, diagnostics, test results, transports, runtime information, and other ADT responses requested by the user.
- Local artifacts that the user explicitly asks the software to create.

SAP ABAP MCP does not include publisher-operated telemetry, analytics, advertising, or a hosted service that receives this data.

## How data is used

The local MCP process uses data only to execute the user's requested workflow. It communicates directly with the SAP ADT endpoint and, when requested, a selected Git remote or local file destination. MCP tool inputs and results are also provided to the MCP host selected by the user, such as Claude or Codex, and are subject to that provider's terms and privacy policy.

The npm registry may be contacted when the user installs or updates the package. Those registry requests are governed by the registry provider's privacy policy.

## Storage and retention

The publisher does not receive or retain SAP profiles, credentials, source code, tool inputs, tool results, or generated artifacts.

Profile configuration and generated files remain on the user's computer until the user removes them. Passwords and tokens are stored in macOS Keychain or Windows DPAPI and remain there until the user logs out, removes the profile, or deletes the corresponding credential. Temporary runtime data is held in process memory and is discarded when the process exits.

## Sharing

The publisher does not sell or share user data. Data is transmitted only as directed by the user to the configured SAP system, selected Git remote, package registry, local file destination, or MCP host. Those third parties process data under their own terms and privacy policies.

## User controls

Users can remove profiles and stored credentials with the SAP ABAP MCP CLI, delete generated files, revoke SAP or Git access, and uninstall the package or extension. Users control which SAP connection and operation are selected for every SAP-facing MCP request.

## Security

SAP ABAP MCP keeps credentials out of MCP tool arguments, blocks writes for profiles marked as production, supports package restrictions, and requires explicit confirmation for selected high-impact operations. Users remain responsible for securing their computer, network, SAP accounts, transports, and connected third-party services.

## Changes

Changes to this policy are published in this repository and recorded in its Git history.

## Contact

For privacy questions or requests, open an issue at <https://github.com/Coaspe/sap-abap-mcp/issues>.

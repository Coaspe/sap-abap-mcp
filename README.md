# sap-abap-mcp

A local Model Context Protocol server that lets Codex and Claude work with SAP ABAP through the official ABAP Development Tools (ADT) HTTP services.

It can inspect and edit ABAP source, run quality checks, manage transports, use abapGit and the RAP generator, inspect runtime data, compare systems, and perform repository refactorings without VS Code, SAP GUI, or an ABAP FS virtual workspace.

## Release status

- Package: `@coaspe/sap-abap-mcp`
- Current version: `0.4.5`
- Release channel: npm `latest` (resolved automatically when the MCP process starts)
- Runtime: Node.js 20 or later
- Transport: local MCP over stdio
- Authentication: SAP Basic Auth
- Secret storage: macOS Keychain or Windows DPAPI
- SAP API client: `abap-adt-api` 8.4.1
- ABAP FS compatibility baseline: 2.6.5, commit `3041418d35558e043993a4d7f9fa6b727fcf9cf1`

The automated suite validates the MCP contract, ADT argument ordering, safety policies, stale-preview protection, output bounds, and all 52 registered tools with an in-memory SAP implementation. Live SAP acceptance testing is still required because endpoint availability and authorization vary by SAP release and system configuration.

## ABAP FS parity status

The pinned ABAP FS 2.6.5 source exposes 43 MCP tools. This server provides a strict-compatible subset of 42; the omitted tool is `manage_subagents`, which depends on the VS Code agent host. With 10 headless extensions, this server advertises 52 tools in total.

The first development-parity slice implements BDEF source creation, one-request batch activation, class-runner execution, the ABAP FS REPL contract, and detailed semantic inspection. These SAP-dependent capabilities remain `unverified` until they succeed against the selected live connection; call `get_sap_capabilities` for per-connection evidence.

Snippet execution requires `ZCL_ABAP_REPL` and an active SICF service at `/sap/bc/z_abap_repl`. Generic report/program-console execution is not implemented.

## What it supports

The server provides all 42 strict-compatible headless tools from the pinned ABAP FS baseline and adds ten grouped extension tools.

| Area | Capabilities |
|---|---|
| Connections | Multiple SAP profiles, lazy login, system metadata, ADT discovery export |
| Repository reads | Search, metadata, source ranges, batch reads, URI reads, source search, enhancements |
| Semantic services | Completion details, definition lookup, documentation, type hierarchy, components, quick-fix discovery, SAP formatter preview |
| Source writes | Exact source replacement, BDEF source creation, syntax diagnostics, single- and one-request batch activation, text elements |
| Refactoring | Rename, package move, extract method, quick-fix application, formatting, deletion |
| Quality | ABAP Unit, ATC, diagnostics, test-include creation |
| Transports | List, details, objects, compare, create, release, delete, owner/user management, object resolution |
| Versions | Active revision history, revision comparison, inactive source, guarded revision restore |
| abapGit | Repository list, remote information, create, pull, unlink, stage, push, check, branch switch |
| RAP | Availability, paged schema, defaults, validation, preview, generation, service binding details and publication |
| Runtime | Guarded class-runner and fixed-contract ABAP REPL execution, debugger, breakpoints, stack, variables, dumps, traces, heartbeat checks |
| Cross-system | Source comparison across configured SAP systems |
| Dependency analysis | Bounded where-used dependency graph |
| SAP GUI integration | Validated WebGUI transaction URL generation and optional local launch |
| Data | Read-only ADT SQL queries with bounded or file-based output |
| Artifacts | Mermaid validation/viewer and DOCX test documentation |

The ten grouped extension tools are:

- `inspect_abap_code`
- `refactor_abap_code`
- `manage_abapgit`
- `manage_rap_generator`
- `manage_abap_versions`
- `compare_abap_systems`
- `get_abap_dependency_graph`
- `run_sap_transaction`
- `get_sap_capabilities`
- `run_abap_application`

Grouping related actions keeps the tool-schema footprint lower than exposing every operation as a separate MCP tool.

## MCP directories and registries

The canonical registry identity is `io.github.Coaspe/sap-abap-mcp`, defined in [`server.json`](server.json). Directory installs must run this package as a local `stdio` server; SAP profiles and credentials stay on the user's machine and are never hosted by a registry.

Before starting the MCP server from any directory or one-click installer, create and verify at least one local SAP profile using the commands in [Quick start](#quick-start-on-windows) or [`llms-install.md`](llms-install.md). A generic registry launch runs `@coaspe/sap-abap-mcp` with the `serve` argument and exposes all locally configured profiles; every SAP-facing tool still requires an explicit `connectionId`.

Registry publication does not change the live-evidence boundary. SAP-dependent development-parity capabilities remain `unverified` until they succeed against the selected live connection.

The public [Smithery listing](https://smithery.ai/servers/aspalt85/sap-abap-mcp) exposes the same 52 runtime tools and installs the validated local MCPB bundle.

## Privacy Policy

SAP ABAP MCP runs locally and does not send SAP profiles, credentials, source code, or tool results to a publisher-operated service. It communicates only with destinations selected by the user, including the configured SAP system and the user's MCP host. See the complete [`PRIVACY.md`](PRIVACY.md) and [`TERMS.md`](TERMS.md).

### Claude Code and Codex plugin marketplaces

This repository is also a dual-compatible plugin marketplace. The plugin starts the same npm `latest` package as a local `stdio` process, so SAP profiles, credentials, and ADT traffic stay on the user's computer.

Claude Code:

```text
/plugin marketplace add Coaspe/sap-abap-mcp
/plugin install sap-abap-mcp@coaspe-sap
/reload-plugins
```

Use `/mcp` to confirm that `sap-abap` is connected.

Codex:

```bash
codex plugin marketplace add Coaspe/sap-abap-mcp
```

Then install **SAP ABAP MCP** from the `Coaspe SAP Developer Tools` marketplace in the Codex app and start a new task. The plugin includes a `sap-abap-setup` skill that keeps passwords out of chat and guides profile creation, authentication, and live ADT verification.

## Prerequisites

Ask your SAP administrator for:

- The SAP HTTPS base URL, for example `https://sap-dev.company.com`
- The three-digit SAP client number
- Your SAP user name
- ADT development permissions required by the operations you intend to use
- Confirmation that `/sap/bc/adt` and Basic Auth are enabled

Your machine needs:

- Node.js 20 or later
- Codex or Claude Code
- Network or VPN access to SAP
- npm registry access to install the public package

Verify Node.js first:

```powershell
node --version
```

## Quick start on Windows

### 1. Add an SAP profile and log in

Use your real values and keep production profiles read-only. Omitting `--packages` allows writes to all packages; add it only when you want to restrict writes to specific packages.

```powershell
npx.cmd --yes --prefer-online @coaspe/sap-abap-mcp@latest profile add DEV100 `
  --url "https://sap-dev.company.com" `
  --client 100 `
  --username "DEV_USER" `
  --environment development `
  --login
```

PowerShell also accepts the command on one line. The profile ID `DEV100` is a local alias. When `SAP password:` appears, enter the password and press Enter; the input remains hidden. The profile and password are stored only after the MCP validates the credentials against SAP.

To restrict writes, add a comma-separated allowlist such as `--packages "Z_MCP_TEST,Z_MCP_TEST2"`. An empty allowlist permits every package, while production profiles still reject writes.

The password is stored with Windows DPAPI and is never written to the profile file. For non-interactive environments, pipe the password and add `--password-stdin` after `--login`.

### 2. Verify ADT connectivity

```powershell
npx.cmd --yes --prefer-online @coaspe/sap-abap-mcp@latest doctor DEV100
```

A successful response contains `"ok": true`.

### 3. Register the MCP server

Codex CLI:

```powershell
codex mcp add sap-abap -- npx.cmd --yes --prefer-online @coaspe/sap-abap-mcp@latest serve --profile DEV100
```

Claude Code:

```powershell
claude mcp add --transport stdio --scope user sap-abap -- npx.cmd --yes --prefer-online @coaspe/sap-abap-mcp@latest serve --profile DEV100
```

Restart the client after registration. Use `codex mcp list`, `claude mcp get sap-abap`, or the client's `/mcp` command to verify the connection.

The registration deliberately uses the moving npm tag `@latest` together with `--prefer-online`. Whenever Codex or Claude starts a new MCP process, npm checks which published version `latest` points to and runs that version. For example, a user who originally ran `0.4.4` will automatically run `0.4.5` after `0.4.5` is promoted to `latest` and the client is restarted. An already-running MCP process is not replaced in place. Maintainers should promote only tested releases to `latest`.

### 4. Start with read-only requests

```text
List the configured SAP systems and verify DEV100.
Find class ZCL_DEMO in DEV100 and read its RUN method.
Run syntax diagnostics and show a formatter preview without changing the source.
Build a depth-1 dependency graph for ZCL_DEMO.
```

## Quick start on macOS

Use `npx` instead of `npx.cmd`:

```bash
npx --yes --prefer-online @coaspe/sap-abap-mcp@latest profile add DEV100 \
  --url "https://sap-dev.company.com" \
  --client 100 \
  --username "DEV_USER" \
  --environment development \
  --login

npx --yes --prefer-online @coaspe/sap-abap-mcp@latest doctor DEV100
codex mcp add sap-abap -- npx --yes --prefer-online @coaspe/sap-abap-mcp@latest serve --profile DEV100
```

SAP passwords are stored in macOS Keychain.

## Codex desktop setup

If the `codex` command is not available, add a stdio MCP server in Codex settings:

- Name: `sap-abap`
- Command on Windows: `npx.cmd`
- Command on macOS: `npx`
- Arguments:

```text
--yes
--prefer-online
@coaspe/sap-abap-mcp@latest
serve
--profile
DEV100
```

## Multiple SAP systems

Create one profile per SAP client, for example `DEV100`, `QAS200`, and `PRD100`. To expose all profiles through one MCP server, register `serve` without `--profile`:

```powershell
codex mcp add sap-abap -- npx.cmd --yes --prefer-online @coaspe/sap-abap-mcp@latest serve
```

Every SAP-facing tool requires an explicit `connectionId`, which prevents accidental cross-system routing. Cross-system comparison requires the same object to exist in both selected profiles.

## abapGit credentials

Public repositories require no additional setup. Store credentials for each private repository URL separately:

```powershell
npx.cmd --yes --prefer-online @coaspe/sap-abap-mcp@latest abapgit auth login DEV100 `
  --repository-url "https://github.example.com/team/repo.git" `
  --username "GIT_USER"
```

Status and removal:

```powershell
npx.cmd --yes --prefer-online @coaspe/sap-abap-mcp@latest abapgit auth status DEV100 `
  --repository-url "https://github.example.com/team/repo.git"

npx.cmd --yes --prefer-online @coaspe/sap-abap-mcp@latest abapgit auth logout DEV100 `
  --repository-url "https://github.example.com/team/repo.git"
```

Credentials are selected by canonical repository URL so credentials for one remote cannot be sent to another. Passwords and tokens are not accepted as MCP tool arguments, and credentials embedded in a repository URL are rejected.

## Write-safety model

Repository-changing operations enforce these rules:

- Profiles marked `production` reject writes.
- A non-empty `allowedPackages` list restricts writes to those packages; an empty list allows all packages.
- Packages other than `$TMP` require a transport request.
- Exact source replacement reads the current source, obtains an SAP lock, rechecks it under the lock, writes, runs syntax diagnostics, optionally activates, and unlocks.
- Rename, package move, method extraction, quick-fix application, formatting, deletion, and revision restore use a preview plan.
- Preview plans expire after ten minutes and require the exact returned confirmation value.
- Execution re-runs the SAP preview or source-state check and rejects stale plans.
- Multi-object quick-fixes perform syntax preflight and attempt rollback if a later write fails.
- RAP generation performs initial validation, content validation, and dry-run preview immediately before generation.
- abapGit push accepts only a fresh SAP staging snapshot and requires explicit object selection or `stageAll=true`.
- SAP transaction parameters use a restricted character set and are passed to the OS launcher as argument-array values rather than shell text.
- ADT SQL accepts only `SELECT` and `WITH` statements.

Transport release and deletion can be irreversible. Use a dedicated transport and verify the exact confirmation value before executing either action.

## Token-efficient operation

The server is designed to keep model context usage bounded without removing useful data:

- Related operations are grouped into action-based tools.
- The complete 52-tool schema is kept below a 64 KiB automated guardrail.
- Source, search, SQL, ATC, dump, trace, transport, version, Git, and RAP schema responses are paged or summarized.
- Unified diffs are limited by both line count and byte size.
- Large source responses are bounded by an inline byte budget.
- Discovery data and large download manifests can be exported to local files.
- Compact JSON is returned without pretty-print whitespace.

Continue paged responses with fields such as `nextStartIndex`, `nextLine`, `nextRowStart`, and `nextContentOffset`.

Hosts without automatic tool search can register only selected toolsets:

```bash
sap-abap-mcp serve --profile DEV100 --toolsets core,write,analysis
```

Available toolsets are `core`, `write`, `analysis`, `debug`, `operations`, `artifacts`, and `all`. The default is `all`.

## Real SAP acceptance testing

Run acceptance tests first against a development system and dedicated packages, objects, transports, repositories, and RAP artifacts.

For BDEF creation, batch activation, class execution, the fixed ABAP REPL contract, and detailed semantic inspection, follow the evidence and cleanup procedure in [`docs/live-sap-acceptance.md`](docs/live-sap-acceptance.md). Until those checks succeed on a selected connection, the capabilities remain `unverified`.

Recommended order:

1. Connection, discovery, repository reads, semantic reads, versions, transports, and URL-only transaction generation.
2. Create a dedicated test class and verify source write, diagnostics, activation, formatter, quick-fix, rename, extract method, inactive source, restore, package move, and guarded deletion.
3. Test transport mutations only with a disposable transport.
4. Test abapGit only with a disposable remote repository.
5. Run RAP validation and preview before approving generation or service publication.

When reporting a failure, preserve the MCP error code, HTTP status, ADT endpoint, and SAP response text. Do not retry failed ADT operations with guessed parameter variants.

## CLI reference

```text
profile add <id> --url <url> --client <nnn> [--language EN]
    [--environment development|quality|production]
    [--username <user>] [--packages ZPKG1,ZPKG2]
    [--login [--password-stdin]]
profile list
profile remove <id>

auth login <id> [--username <user>] [--password-stdin]
auth status <id>
auth logout <id>

abapgit auth login <id> --repository-url <url> --username <user> [--password-stdin]
abapgit auth status <id> --repository-url <url>
abapgit auth logout <id> --repository-url <url>

doctor <id> [--include-components]
serve [--profile <id>] [--toolsets core,write,analysis,debug,operations,artifacts|all]
```

Removing a profile also removes its SAP password and stored abapGit credential vault.

## Troubleshooting

| Problem | Check |
|---|---|
| `node` is not found | Install Node.js 20 or later and reopen the terminal. |
| npm cannot download the package | Check internet access, proxy configuration, and npm registry policy. |
| `PROFILE_NOT_FOUND` | Run `profile add` again and verify the profile ID. |
| SAP login fails | Verify URL, client, username, password, VPN, Basic Auth, and ADT activation. |
| Certificate or connection error | Check the corporate CA, proxy, VPN, and SAP HTTPS endpoint. |
| Tools are missing | Confirm that the MCP command contains `@latest` and `--prefer-online`, restart it, and inspect `/mcp`. |
| Writes return `PACKAGE_NOT_ALLOWED` | The profile has a non-empty `--packages` restriction; add the target package or remove the restriction. |
| Writes return `TRANSPORT_REQUIRED` | Supply an open transport for non-local packages. |
| RAP generator is unavailable | The SAP release or installed components may not expose the RAP generator endpoints. |
| Private Git access fails | Store credentials for the exact canonical repository URL. |

SSO-only or MFA-only SAP systems are not supported by this release. Ask the SAP administrator whether Basic Auth can be enabled for the ADT endpoint.

## Local development

```bash
npm install
npm run check
npm audit --omit=dev
npm pack --dry-run
```

Register the current local build for pre-release testing:

```bash
npm run build
codex mcp add sap-abap-local -- node "/absolute/path/to/sap-abap-mcp/dist/src/index.js" serve --profile DEV100
```

The compatibility and toolset manifest is maintained in `src/compat/abap-fs-tools.ts`. ADT wrapper contract tests are in `test/sap-client-contract.test.ts`, and end-to-end in-memory MCP tests are in `test/integration.test.ts`.

## Detailed Windows guide

See [`docs/localhost-mcp-end-to-end.md`](docs/localhost-mcp-end-to-end.md) for the multi-system Windows setup, lifecycle, security model, and operational checklist.

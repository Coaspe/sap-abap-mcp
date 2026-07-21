# sap-abap-mcp

A local Model Context Protocol server that lets Codex and Claude work with SAP ABAP through the official ABAP Development Tools (ADT) HTTP services.

It can inspect and edit ABAP source, run quality checks, manage transports, use abapGit and the RAP generator, inspect runtime data, compare systems, and perform repository refactorings without VS Code, SAP GUI, or an ABAP FS virtual workspace.

Need help evaluating it in a controlled SAP DEV/QAS environment? See the
[professional services and five-day pilot](SERVICES.md). Do not include SAP
credentials, source code, or other confidential information in a public issue.

## Quick start

You need Node.js 20 or later, network or VPN access to SAP, and an SAP HTTPS URL, three-digit client number, username, and ADT Basic Auth permission.

### 1. Configure SAP

Windows:

```powershell
npx.cmd @coaspe/sap-abap-mcp@latest setup
```

macOS or Linux:

```bash
npx @coaspe/sap-abap-mcp@latest setup
```

The wizard calls the local connection alias `Server name` and the endpoint `SAP URL`. Windows and macOS validate SAP before saving and protect the password with DPAPI or Keychain. Linux saves only non-secret settings and prints the password environment-variable commands to run before starting the MCP client.

### 2. Register the MCP server

After setup, run the command for your client on Windows:

```powershell
codex mcp add sap-abap -- npx.cmd --yes --prefer-online @coaspe/sap-abap-mcp@latest serve --profile DEV100
claude mcp add --transport stdio --scope user sap-abap -- npx.cmd --yes --prefer-online @coaspe/sap-abap-mcp@latest serve --profile DEV100
```

On macOS or Linux, replace `npx.cmd` with `npx`:

```bash
codex mcp add sap-abap -- npx --yes --prefer-online @coaspe/sap-abap-mcp@latest serve --profile DEV100
claude mcp add --transport stdio --scope user sap-abap -- npx --yes --prefer-online @coaspe/sap-abap-mcp@latest serve --profile DEV100
```

Replace `DEV100` with the Server name selected in the wizard. Restart the client, then use `codex mcp list`, `claude mcp get sap-abap`, or `/mcp` to confirm that the process starts. The completed wizard already performs live SAP verification; `/mcp` alone does not prove that SAP authentication succeeded.

Prefer a plugin install? Follow [Claude Code and Codex plugin marketplaces](#claude-code-and-codex-plugin-marketplaces); the included setup skill guides the same local wizard without putting the SAP password in chat. See the detailed [Windows](#detailed-setup-on-windows), [macOS](#detailed-setup-on-macos), and [Linux](#linux-and-containers) sections for platform-specific behavior and server management.

### v1 opt-in surface

An explicit MCP v1 surface is available without changing the v0 default. It
maps the 53 v0 capabilities to 113 action-free tools and seven Resources,
split across bounded `core`, `write`, `analysis`, `debug`, `operations`, and
`artifacts` toolsets. Explicit v1 defaults to the 20-tool `core` surface;
`--api-version v1 --toolsets all` selects all 113 tools. See the
[v1 migration guide](docs/v1-migration.md) for contracts, Resources, and the
separate live-SAP verification boundary.

## ABAP FS parity status

The pinned ABAP FS 2.6.5 source exposes 43 MCP tools. This server provides a strict-compatible subset of 42; the omitted tool is `manage_subagents`, which depends on the VS Code agent host. With 10 headless feature extensions and `read_deferred_result`, this server advertises 53 tools in total.

The first development-parity slice implements BDEF source creation, one-request batch activation, class-runner execution, the ABAP FS REPL contract, and detailed semantic inspection. These SAP-dependent capabilities remain `unverified` until they succeed against the selected live connection; call `get_sap_capabilities` for per-connection evidence.

Snippet execution requires `ZCL_ABAP_REPL` and an active SICF service at `/sap/bc/z_abap_repl`. Generic report/program-console execution is not implemented.

## What it supports

The server provides all 42 strict-compatible headless tools from the pinned ABAP FS baseline, ten grouped feature extensions, and one infrastructure tool for continuing oversized results.

| Area | Capabilities |
|---|---|
| Connections | Multiple SAP profiles, Basic Auth, opt-in OAuth client credentials, lazy login, system metadata, ADT discovery export |
| Repository reads | Search, metadata, source ranges, batch reads, URI reads, source search, enhancements |
| Semantic services | Completion details, definition lookup, documentation, type hierarchy, components, quick-fix discovery, SAP formatter preview |
| Source writes | Exact source replacement, BDEF source creation, syntax diagnostics, single- and one-request batch activation, text elements |
| Refactoring | Rename, package move, extract method, quick-fix application, formatting, deletion |
| Quality | ABAP Unit, ATC, diagnostics, test-include creation |
| Transports | List, details, objects, read-only release assessment, JSON/SARIF/JUnit evidence, compare, create, release, delete, owner/user management, object resolution |
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
`read_deferred_result` is the additional infrastructure tool; it reads the remaining UTF-8 chunks of a large result without repeating the SAP operation.

## Transport change assurance

`manage_transport_requests` keeps transport review inside the existing grouped tool. Its read-only `assess_transport` action can run ATC and ABAP Unit for each supported transport object, optionally compare the same objects with a target connection, and emit JSON, SARIF 2.1.0, and JUnit XML reports.

The returned gate is `passed`, `failed`, or `incomplete`. Truncated object coverage, truncated ATC findings, failed check execution, empty transports, and classes without discoverable tests prevent a pass. A target-system difference is recorded as landscape evidence rather than automatically treated as a failure. Assessment never releases the transport; `release_transport` remains a separate confirmed mutation.

The plugin includes `sap-abap-change-assurance` for this workflow. In Claude Code run `/sap-abap-mcp:sap-abap-change-assurance`; in Codex ask to use `$sap-abap-change-assurance`.

## MCP directories and registries

The canonical registry identity is `io.github.Coaspe/sap-abap-mcp`, defined in [`server.json`](server.json). Directory installs must run this package as a local `stdio` server; SAP profiles and credentials stay on the user's machine and are never hosted by a registry.

Before the first SAP-facing request, create and verify at least one local SAP profile using the commands in [Quick start](#quick-start) or [`llms-install.md`](llms-install.md). The Claude plugin may start successfully without a profile; after installation, run `/sap-abap-mcp:sap-abap-setup` to complete local SAP setup. A generic registry launch runs `@coaspe/sap-abap-mcp` with the `serve` argument and exposes all locally configured profiles; every SAP-facing tool still requires an explicit `connectionId`.

Registry publication does not change the live-evidence boundary. SAP-dependent development-parity capabilities remain `unverified` until they succeed against the selected live connection.

The public [Smithery listing](https://smithery.ai/servers/aspalt85/sap-abap-mcp) installs the validated local MCPB bundle and exposes all 53 runtime tools.

## Privacy Policy

SAP ABAP MCP runs locally and does not send SAP profiles, credentials, source code, or tool results to a publisher-operated service. It communicates only with destinations selected by the user, including the configured SAP system and the user's MCP host. See the complete [`PRIVACY.md`](PRIVACY.md) and [`TERMS.md`](TERMS.md).

### Claude Code and Codex plugin marketplaces

This repository is also a dual-compatible plugin marketplace. The plugin starts the same npm `latest` package as a local `stdio` process, so SAP profiles, credentials, and ADT traffic stay on the user's computer. Profiles are user-scoped outside the plugin cache and survive plugin updates.

Claude Code:

```text
/plugin marketplace add Coaspe/sap-abap-mcp
/plugin install sap-abap-mcp@coaspe-sap
/reload-plugins
```

Run the namespaced setup skill after reloading:

```text
/sap-abap-mcp:sap-abap-setup
```

The skill reuses an existing profile or guides profile creation, local password entry, and live ADT verification. Use `/mcp` to confirm that the `sap-abap` process is connected, but do not treat that status as proof that an SAP profile is authenticated; the setup skill verifies SAP with `doctor`.

Codex:

```bash
codex plugin marketplace add Coaspe/sap-abap-mcp
```

Then install **SAP ABAP MCP** from the `Coaspe SAP Developer Tools` marketplace in the Codex app and start a new task. Ask Codex to set up SAP ABAP MCP; the included `sap-abap-setup` skill keeps passwords out of chat and guides profile creation, authentication, and live ADT verification.

The plugin also includes `sap-abap-change-assurance`, which assesses an existing transport without releasing it and returns CI-native evidence paths.

## OAuth client credentials

The interactive `setup` wizard remains the Basic Auth path. OAuth client credentials are an explicit advanced profile type and do not change the defaults for newly created profiles. Create and verify one on Windows or macOS with:

```bash
npx @coaspe/sap-abap-mcp@latest profile add BTP100 \
  --url https://abap.example.com --client 100 \
  --auth-type oauth-client-credentials \
  --token-url https://auth.example.com/oauth/token \
  --client-id mcp-client --scope "abap.read abap.write" --login
```

The hidden prompt requests the OAuth client secret. The profile file stores the token URL, client ID, and optional scope, but never the client secret or access token. The token endpoint must use HTTPS and must not contain embedded credentials, query parameters, or a fragment. The client uses HTTP Basic client authentication, requires a Bearer token with a positive `expires_in`, and recreates the ADT client before the cached token expires because `abap-adt-api` 8.4.1 memoizes a bearer fetch.

For automation, pipe the client secret and add `--password-stdin`. On Linux, create the profile without `--login`, place the client secret in the printed profile-specific `SAP_ABAP_MCP_PASSWORD_<PROFILE>` environment variable, and start the MCP process from that environment. The variable name is retained for backward compatibility even when its value is an OAuth client secret.

This mode requires explicit token URL, client ID, and client secret fields; it does not parse a BTP service-key JSON document. Browser SSO, MFA flows, client certificates, Kerberos, and direct static-bearer profiles remain unsupported. OAuth implementation is still live-unverified for a particular SAP system until `doctor` succeeds there.

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

## Detailed setup on Windows

### 1. Run interactive setup

```powershell
npx.cmd @coaspe/sap-abap-mcp@latest setup
```

The first run may ask whether npm may download the package; enter `y` to continue. The setup wizard collects the SAP URL, client, username, environment, and optional writable-package restriction. `Server name` is the local name used later as `connectionId`, for example `DEV100`. Keep production servers classified as `production`; they are read-only even if the package restriction is empty.

When `SAP password:` appears, enter the password and press Enter; the input remains hidden. The server configuration and password are stored only after the MCP validates the credentials against SAP. Windows protects the password with DPAPI and never writes it to the profile file.

The setup command is one line in both PowerShell and Command Prompt. For advanced multiline commands, PowerShell continues a line with a backtick (`` ` ``), while Command Prompt (`cmd.exe`) uses a caret (`^`); do not mix them.

### 2. Verify ADT connectivity

```powershell
npx.cmd --yes --prefer-online @coaspe/sap-abap-mcp@latest doctor DEV100
```

A completed setup already performs this live check. Run `doctor` again whenever you want to recheck ADT connectivity; a successful response contains `"ok": true`.

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

The registration deliberately uses the moving npm tag `@latest` together with `--prefer-online`. Whenever Codex or Claude starts a new MCP process, npm checks which published version `latest` points to and runs that version. For example, a user who originally ran `0.4.7` will automatically run `0.4.8` after `0.4.8` is promoted to `latest` and the client is restarted. An already-running MCP process is not replaced in place. Maintainers should promote only tested releases to `latest`.

### 4. Change or remove a saved server

Edit a server with its current values as defaults. The wizard tests the updated settings and password before replacing the saved configuration:

```powershell
npx.cmd @coaspe/sap-abap-mcp@latest setup edit DEV100
```

Remove a server and its stored SAP and abapGit credentials:

```powershell
npx.cmd @coaspe/sap-abap-mcp@latest setup remove DEV100
```

Omit `DEV100` to choose from the saved servers. Removal always shows the selected server and asks for confirmation; the default answer is `No`.

### 5. Start with read-only requests

```text
List the configured SAP systems and verify DEV100.
Find class ZCL_DEMO in DEV100 and read its RUN method.
Run syntax diagnostics and show a formatter preview without changing the source.
Build a depth-1 dependency graph for ZCL_DEMO.
```

## Detailed setup on macOS

Use `npx` instead of `npx.cmd`:

```bash
npx @coaspe/sap-abap-mcp@latest setup
npx @coaspe/sap-abap-mcp@latest setup edit DEV100
npx @coaspe/sap-abap-mcp@latest setup remove DEV100
codex mcp add sap-abap -- npx --yes --prefer-online @coaspe/sap-abap-mcp@latest serve --profile DEV100
```

The wizard tests the SAP connection and stores the password in macOS Keychain.

## Linux and containers

Linux runs the same interactive setup, but it does not persist credentials:

```bash
npx @coaspe/sap-abap-mcp@latest setup
```

The wizard saves the non-secret server configuration and prints the exact hidden-input and `export` commands for its profile-specific password variable. Run those commands in the same shell that starts the MCP client, then run the printed `doctor` command. For example, server name `DEV-100` uses `SAP_ABAP_MCP_PASSWORD_DEV_100`. The Linux environment store is read-only, so `auth login` and `auth logout` are unavailable and no plaintext credential file is created.

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
- The complete 53-tool schema is kept below a 64 KiB automated guardrail.
- Source, search, SQL, ATC, dump, trace, transport, version, Git, and RAP schema responses are paged or summarized.
- Unified diffs are limited by both line count and byte size.
- Large source responses are bounded by an inline byte budget.
- Discovery data and large download manifests can be exported to local files.
- Compact JSON is returned without pretty-print whitespace.
- Connection discovery returns only the profile ID, environment, and credential availability. Object-info reads normalize useful scalar metadata and return the raw ADT structure only when `includeStructure=true`.
- Source reads identify the resolved object by name and type without repeating its search description, package, and object URI; `sourceUri` remains available for follow-up operations.
- `search_abap_object_lines` always merges overlapping source windows into `contextBlocks` and reports matches once in `matchLineNumbers`, including enhancement source groups.
- `get_sap_capabilities` omits evidence by default; request `includeEvidence=true` only when auditing discovery or execution observations.
- Semantic, refactoring, ATC, version, activation, navigation, and download responses reuse the same compact object identity policy. Batch reads omit the parent `connectionId` from each nested result.
- ATC findings reference one response-level object catalog. Dump, trace, and heartbeat list/mutation responses omit raw details that are available through explicit detail actions or options.
- Compact JSON through 16 KiB is normally returned unchanged. Larger results return a bounded structural summary, an exact UTF-8 preview, and an in-memory `resultId` in a `compact-v1` envelope no larger than 12 KiB.
- `search_abap_object_lines` switches to its bounded summary at 16 KiB and keeps the exact compact result behind the same `resultId`.

The complete 53-tool, 150-variant review and fixture measurements are in [`docs/response-token-audit.md`](docs/response-token-audit.md). Re-run `npm run benchmark:surface` for a machine-readable schema-cost report; see [`docs/compatibility-matrix.md`](docs/compatibility-matrix.md) for the live-evidence boundary.

Continue paged responses with fields such as `nextStartIndex`, `nextLine`, `nextRowStart`, and `nextContentOffset`.
For a response with `format: "compact-v1"`, use `summary` first. Call `read_deferred_result` with its `resultId` and `nextOffset` only when omitted exact data is needed. A request may ask for up to 24 KiB, while the serialized chunk response remains within the 16 KiB inline budget; continue until `done` is true. Deferred results expire after ten minutes, are never written to disk, and reading them does not repeat the SAP request.

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
setup
setup edit [<server-name>]
setup remove [<server-name>]

profile add <id> --url <url> --client <nnn> [--language EN]
    [--environment development|quality|production]
    [--username <user>] [--packages ZPKG1,ZPKG2]
    [--auth-type basic|oauth-client-credentials]
    [--token-url <url> --client-id <id> [--scope <scope>]]
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

Removing a profile also removes its SAP password or OAuth client secret and stored abapGit credential vault.

## Troubleshooting

| Problem | Check |
|---|---|
| `node` is not found | Install Node.js 20 or later and reopen the terminal. |
| npm cannot download the package | Check internet access, proxy configuration, and npm registry policy. |
| `PROFILE_NOT_FOUND` | Run `setup` again and verify the Server name. |
| SAP login fails | For Basic Auth, verify URL, client, username, password, VPN, and ADT activation. For OAuth, verify the token URL, client ID, client secret, scope, Bearer response, and ADT authorization. |
| Certificate or connection error | Check the corporate CA, proxy, VPN, and SAP HTTPS endpoint. |
| Tools are missing | Confirm that the MCP command contains `@latest` and `--prefer-online`, restart it, and inspect `/mcp`. |
| Writes return `PACKAGE_NOT_ALLOWED` | The profile has a non-empty `--packages` restriction; add the target package or remove the restriction. |
| Writes return `TRANSPORT_REQUIRED` | Supply an open transport for non-local packages. |
| RAP generator is unavailable | The SAP release or installed components may not expose the RAP generator endpoints. |
| Private Git access fails | Store credentials for the exact canonical repository URL. |

Browser SSO-only, MFA-only, certificate-only, and Kerberos-only SAP systems are not supported by this release. Use Basic Auth or an explicitly configured OAuth client-credentials client accepted by the ADT endpoint.

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

## Release status

- Package: `@coaspe/sap-abap-mcp`
- Current source version: `0.4.15`
- Published npm version: `0.4.15`
- Release channel: npm `latest` (resolved automatically when the MCP process starts)
- Runtime: Node.js 20 or later
- Transport: local MCP over stdio
- Authentication: SAP Basic Auth by default; opt-in OAuth client credentials
- Secret storage: macOS Keychain, Windows DPAPI, or read-only environment variables on Linux
- SAP API client: `abap-adt-api` 8.4.1
- ABAP FS compatibility baseline: 2.6.5, commit `3041418d35558e043993a4d7f9fa6b727fcf9cf1`

The automated suite validates the MCP contract, ADT argument ordering, safety policies, stale-preview protection, output bounds, and all 53 registered tools with an in-memory SAP implementation. Live SAP acceptance testing is still required because endpoint availability and authorization vary by SAP release and system configuration.

## Detailed Windows guide

See [`docs/localhost-mcp-end-to-end.md`](docs/localhost-mcp-end-to-end.md) for the multi-system Windows setup, lifecycle, security model, and operational checklist.

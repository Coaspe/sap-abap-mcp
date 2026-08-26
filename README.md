# sap-abap-mcp

[![npm version](https://img.shields.io/npm/v/%40coaspe%2Fsap-abap-mcp)](https://www.npmjs.com/package/@coaspe/sap-abap-mcp)
[![npm downloads](https://img.shields.io/npm/dw/%40coaspe%2Fsap-abap-mcp)](https://www.npmjs.com/package/@coaspe/sap-abap-mcp)
[![MCP Registry](https://img.shields.io/badge/MCP_Registry-io.github.Coaspe-5A45FF)](https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.Coaspe/sap-abap-mcp)
[![license](https://img.shields.io/badge/license-MIT-0A6ED1)](LICENSE)

**A headless, client-neutral MCP server for governed SAP ABAP development.**

SAP ABAP MCP lets Codex, Claude, and other MCP hosts work with SAP through ABAP
Development Tools (ADT) HTTP services. It supports multiple named SAP profiles,
repository development, quality checks, transports, abapGit, RAP, runtime
inspection, cross-system comparison, and guarded refactoring without requiring
an IDE runtime, SAP GUI, or an ABAP FS workspace.

## Why this server

SAP also provides an [official ADT MCP Server](https://help.sap.com/docs/abap-cloud/abap-development-tools-user-guide/configuring-adt-mcp-server-ed94320814734d97801f51a5b6deb802)
inside ADT clients. This project serves a different deployment model.

| | SAP ABAP MCP | SAP ADT MCP Server |
|---|---|---|
| Runtime | Independent Node.js process over local `stdio`, or self-hosted Streamable HTTP | Local HTTP server hosted by an ADT client |
| Hosts | Codex, Claude, and other MCP clients | MCP hosts configured against the ADT client |
| SAP connections | Multiple named profiles in one process | SAP projects and sessions managed by ADT |
| Governance | Production read-only policy, package restrictions, confirmations, optional roles and audit logs | Governed by the installed ADT version and SAP authorizations |

This is a deployment-model comparison, not a capability benchmark or a claim
of SAP endorsement. Endpoint availability varies by SAP release and system.

## 90-second workflow

![Synthetic terminal walkthrough of setup, repository inspection, ABAP Unit and ATC, and transport assessment](assets/demo.gif)

The animation contains synthetic names and no live SAP data. See the
[accessible transcript](docs/demo-script.md).

## Quick start

You need Node.js 20 or later, network or VPN access to SAP, an SAP HTTPS URL,
a three-digit client number, a username, and ADT authentication permission.

### 1. Create an SAP profile

Windows:

```powershell
npx.cmd @coaspe/sap-abap-mcp@latest setup
```

macOS or Linux:

```bash
npx @coaspe/sap-abap-mcp@latest setup
```

The `Server name` is the local name used later as `connectionId`; `SAP URL` is
the SAP HTTPS endpoint. The wizard also collects the Basic Auth username,
environment, optional writable-package restriction, and optional data-query
permission. Windows and macOS verify SAP before saving and protect secrets with
DPAPI or Keychain.
Linux stores only non-secret settings and prints the environment variable to
use for the password or client secret.

### 2. List, change, or remove profiles

```bash
npx @coaspe/sap-abap-mcp@latest profile list
npx @coaspe/sap-abap-mcp@latest setup edit
npx @coaspe/sap-abap-mcp@latest setup remove
```

Pass a Server name to select it directly:

```bash
npx @coaspe/sap-abap-mcp@latest setup edit DEV100
npx @coaspe/sap-abap-mcp@latest setup remove DEV100
```

On Windows, use `npx.cmd`. Editing starts with the current values, verifies the
updated connection, and replaces the saved configuration only after validation.
Removal asks for confirmation and also removes stored SAP and abapGit credentials.
See [Setup and profile management](docs/setup-and-profiles.md) for every field,
authentication type, platform-specific secret storage, and automation examples.

### 3. Register the MCP server

Run only the command for your client.

Windows with Codex:

```powershell
codex mcp add sap-abap -- npx.cmd -y @coaspe/sap-abap-mcp@latest serve --preset adaptive
```

Windows with Claude Code:

```powershell
claude mcp add --transport stdio --scope user sap-abap -- npx.cmd -y @coaspe/sap-abap-mcp@latest serve
```

macOS or Linux with Codex:

```bash
codex mcp add sap-abap -- npx -y @coaspe/sap-abap-mcp@latest serve --preset adaptive
```

macOS or Linux with Claude Code:

```bash
claude mcp add --transport stdio --scope user sap-abap -- npx -y @coaspe/sap-abap-mcp@latest serve
```

Cursor users can add this global configuration to `~/.cursor/mcp.json` (use
`npx.cmd` on Windows):

```json
{
  "mcpServers": {
    "sap-abap": {
      "command": "npx",
      "args": ["-y", "@coaspe/sap-abap-mcp@latest", "serve", "--preset", "adaptive"]
    }
  }
}
```

The unscoped `serve` command exposes all saved profiles. Every SAP-facing tool
still requires an explicit `connectionId`, which prevents accidental routing to
another system.

### 4. Verify the connection

```bash
npx @coaspe/sap-abap-mcp@latest doctor DEV100
codex mcp list
```

Claude Code users can run `claude mcp get sap-abap`. Restart the MCP client after
registration or an npm update. `/mcp` confirms that the process started; it does
not prove SAP authentication. A completed `setup` or successful `doctor` does.

### Plugin installation

Claude Code:

```text
/plugin marketplace add Coaspe/sap-abap-mcp
/plugin install sap-abap-mcp@coaspe-sap
/reload-plugins
/sap-abap-mcp:sap-abap-setup
```

Codex users can run `codex plugin marketplace add Coaspe/sap-abap-mcp`, install
**SAP ABAP MCP** from the `Coaspe SAP Developer Tools` marketplace, and ask Codex
to use the included `sap-abap-setup` skill. Profiles live outside plugin caches
and survive updates. Both repository plugins use the shared full surface through
the `.mcp.json` manifest accepted by Codex and Claude Code. Use the direct Codex
registration command above when a smaller initial adaptive surface is preferred.

## What it supports

- Repository search, source reads and writes, object creation, activation,
  deletion, versions, package moves, and guarded batch operations.
- Classes, interfaces, programs, function groups/modules, DDIC objects, CDS,
  DCL, metadata extensions, service definitions/bindings, and BDEFs.
- ABAP Unit, ATC, syntax diagnostics, formatting, quick fixes, where-used,
  dependencies, semantic navigation, rename, and extract-method workflows.
- Transport inspection, read-only release assessment, CI evidence, comparison,
  creation, release, deletion, owner, and user management.
- Runtime dumps, traces, system feeds, debugging, class/program execution, and
  an optional fixed ABAP REPL contract.
- abapGit repository lifecycle and branch operations with per-repository secrets.
- RAP validation, preview, generation, and service publication workflows.
- Optional classic Screen/Dynpro and GUI Status access through a reviewed
  same-origin SAP bridge.

The current v1 surface contains 120 action-specific tools and seven Resources.
The legacy complete 53-tool schema remains available with `--api-version v0`.

| Launch | Advertised surface |
|---|---|
| `serve` | All 120 v1 tools and seven Resources |
| `serve --preset compact` | 12 common read and inspection tools |
| `serve --preset development` | 34 development tools |
| `serve --preset assurance` | 15 read-only review and assurance tools |
| `serve --preset adaptive` | 17 initially advertised tools; all 120 tools remain reachable on demand |
| `serve --toolsets core,analysis` | Selected v1 toolsets |

### Choosing adaptive

The unversioned `serve`, MCPB, and Codex and Claude Code repository plugins stay
on the full surface. The recommended direct Codex and Cursor configurations use
`adaptive`. No choice requires an SAP profile or credential migration.

| Host | Recommended surface | Reason |
|---|---|---|
| Codex direct registration | `adaptive` | Reduces the initial advertised schema while retaining all capabilities |
| Codex repository plugin | full `serve` | Uses the shared `.mcp.json` plugin format verified by Codex |
| Cursor | `adaptive` | Avoids preloading the complete 120-tool schema; keep gateway writes on approval |
| Current Claude Code with MCP Tool Search | full `serve` | Claude defers MCP schemas natively and can call the original tool names |
| Claude Code without Tool Search | `adaptive` | Prevents the complete schema from loading up front |
| Claude Desktop / MCPB | full `serve` | Compatibility baseline until Desktop-specific deferral is verified |

Claude Code enables MCP Tool Search by default on supported models and loads
tool schemas on demand. See the [Claude Code MCP documentation](https://code.claude.com/docs/en/mcp#scale-with-mcp-tool-search).
Use `--preset adaptive` for Claude Code only when Tool Search is disabled or
unavailable, such as an unsupported model or proxy.

The gateway preserves server-side roles, production write blocking, package and
transport policy, validation, preview/confirmation contracts, Resources, and
audit events. The MCP host nevertheless sees hidden calls through
`sap.capability.invoke_read`, `sap.capability.invoke_write`, or
`sap.capability.invoke_destructive`. Host-side per-tool allow/deny and approval
rules therefore apply to those gateway names, not to each hidden capability.
Keep the write and destructive gateways in prompt/approval mode, and use the
full or `development` surface when individual capability policy is required.

Hosts with native MCP tool deferral should normally keep the full surface. For
hosts that preload every advertised schema, adaptive trades two discovery calls
for a smaller initial schema. To roll back, remove `--preset adaptive` and
restart the MCP server; saved profiles and credentials are unchanged.

Normal clients should omit both `--api-version` and `--toolsets`. See the
[v1 migration guide](docs/v1-migration.md), [parity matrix](docs/v1-parity-matrix.md),
and [response token audit](docs/response-token-audit.md) for exact contracts and
schema budgets.

## Safety by default

- Profiles marked `production` are read-only.
- Optional package allowlists constrain writes.
- Destructive or high-impact operations require preview state and exact,
  payload-bound confirmation values.
- Non-local package writes require a transport; local package `$TMP` does not.
- Caller-supplied SAP SQL is disabled per profile by default, remains read-only,
  bounded, and redacted from audit arguments.
- Passwords and OAuth secrets are never stored in profile JSON. Windows uses
  DPAPI, macOS uses Keychain, and Linux uses environment variables.
- HTTP deployments can add API-key or OIDC roles, profile assignments, rate
  limits, session isolation, origin/host controls, and JSONL audit events.

Read [Setup and profile management](docs/setup-and-profiles.md),
[HTTP deployment and security](docs/http-deployment.md), and the optional
[classic-object bridge boundary](docs/classic-bridge.md) before enabling advanced
access.

## Transport change assurance

Run the same read-only transport gate without an MCP host:

```bash
npx @coaspe/sap-abap-mcp@latest assure DEV100 --transport DEVK900123 \
  --checks atc,unit_tests --formats json,sarif,junit \
  --report-directory ./reports
```

Exit codes are `0` for passed, `1` for failed, and `2` for incomplete evidence.
The command never releases or modifies a transport. [`action.yml`](action.yml)
wraps it for GitHub Actions and exposes JSON, SARIF, and JUnit report paths.
The included `sap-abap-change-assurance` skill guides the same workflow.

## Deployment options

| Mode | Use when | Details |
|---|---|---|
| Local `stdio` | One developer runs Codex, Claude, or another local MCP client | [Quick start](#quick-start) |
| Plugin | The client supports repository plugin marketplaces | [Plugin installation](#plugin-installation) |
| Streamable HTTP | A team operates a governed shared instance | [HTTP deployment and security](docs/http-deployment.md) |
| Embedded library | A Node.js application owns the MCP transport and SAP connections | Import `createEmbeddedMcpServer` from the package root |

The default is local `stdio`; no port, daemon, Windows service, or inbound
firewall rule is required.

## Compatibility and evidence

Automated tests validate the MCP contracts, ADT argument ordering, safety
policies, output bounds, all 120 default v1 tools, all seven Resources, and the
legacy v0 surface using in-memory SAP implementations. SAP-dependent behavior
remains `unverified` until it succeeds against the selected live connection.

Existing SAP objects may be used for reads, searches, and analysis. Live
mutation campaigns must use disposable development objects and the strict
ownership and cleanup rules in [Live SAP acceptance](docs/live-sap-acceptance.md).
The recorded system matrix is in [Live SAP evidence](docs/live-sap-evidence.md).

## Documentation

| Topic | Document |
|---|---|
| Setup, profile changes, authentication, and multiple systems | [Setup and profile management](docs/setup-and-profiles.md) |
| HTTP, OIDC, API keys, roles, audit logs, and containers | [HTTP deployment and security](docs/http-deployment.md) |
| Complete CLI command surface | [CLI reference](docs/cli-reference.md) |
| Advanced ABAP workflows | [Advanced workflows](docs/advanced-workflows.md) |
| Optional Screen/Dynpro and GUI Status bridge | [Classic bridge](docs/classic-bridge.md) |
| v1 migration and exact tool mapping | [v1 migration](docs/v1-migration.md) and [parity matrix](docs/v1-parity-matrix.md) |
| Live verification boundary | [Compatibility matrix](docs/compatibility-matrix.md) and [acceptance procedure](docs/live-sap-acceptance.md) |
| Detailed multi-system Windows operation | [Windows localhost guide](docs/localhost-mcp-end-to-end.md) |
| Registry and directory status | [Directory submission reference](docs/mcp-directory-submissions.md) |

## Troubleshooting

| Problem | Check |
|---|---|
| `PROFILE_NOT_FOUND` | Run `profile list`; create a profile with `setup` or select the correct Server name. |
| SAP login fails | Run `doctor <id>` and verify URL, client, credentials, VPN, ADT activation, and SAP authorization. |
| MCP `-32000` (`ConnectionClosed`) | Run the published package's `help`, then inspect the saved MCP command and client debug log. |
| Tools are missing after an update | Confirm the command uses `@latest`, restart the client, and inspect `/mcp`. |
| `PACKAGE_NOT_ALLOWED` | Edit the profile and include the target package, or use an unrestricted development profile deliberately. |
| `TRANSPORT_REQUIRED` | Supply an open transport for a non-local package. |

See [Setup and profile management](docs/setup-and-profiles.md#troubleshooting)
for authentication and platform-specific checks.

## MCP directories and registries

The canonical registry identity is `io.github.Coaspe/sap-abap-mcp`. Registry
and marketplace installs still run the npm package as a local `stdio` server;
SAP profiles and credentials remain on the user's machine. Publication does not
turn unverified SAP capabilities into live evidence. See the
[directory reference](docs/mcp-directory-submissions.md) for current listings.

## Privacy Policy

SAP ABAP MCP does not send SAP profiles, credentials, source code, or tool
results to a publisher-operated service. It communicates only with destinations
selected by the user, including the configured SAP system and MCP host. See
[`PRIVACY.md`](PRIVACY.md) and [`TERMS.md`](TERMS.md).

## Local development

```bash
npm install
npm run check
npm audit --omit=dev
npm pack --dry-run
```

See [CLI reference](docs/cli-reference.md) for local-build registration.

## Release status

- Package: `@coaspe/sap-abap-mcp`
- Current release version: `1.5.1`
- Runtime: Node.js 20 or later
- Default transport: local MCP over `stdio`
- SAP authentication: Basic Auth, OAuth client credentials, Authorization Code
  with PKCE, BTP service keys, or request-scoped OIDC bearer passthrough
- Secret storage: Windows DPAPI, macOS Keychain, or Linux environment variables
- Current API: v1 with 120 tools and seven Resources
- Legacy API: v0 with the complete 53-tool schema

## Known limitations

- Some systems release object-bearing transports only through a GUI background
  job. The server reports `TRANSPORT_RELEASE_UNSUPPORTED` instead of guessing an
  undocumented ADT protocol.
- abapGit tools require the abapGit `ADT_Backend`, not only the SE38 report.
- RAP generation depends on release-specific SAP services and suitable source
  objects.
- Screen/Dynpro and GUI Status access requires the optional reviewed bridge.
- Browser SSO-only, MFA-only, certificate-only, and Kerberos-only SAP systems
  require an explicitly supported OAuth flow or remain unsupported.

## Community and license

Use [GitHub Discussions](https://github.com/Coaspe/sap-abap-mcp/discussions)
for implementation questions and compatibility evidence. Never post SAP hosts,
credentials, source, transport numbers, tokens, or logs publicly. Commercial
evaluation options are described in [`SERVICES.md`](SERVICES.md).

Licensed under the [MIT License](LICENSE).

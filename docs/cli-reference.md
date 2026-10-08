# CLI reference

Run `npx @coaspe/sap-abap-mcp@latest help` for the command surface installed by
the current npm release. On Windows, use `npx.cmd`.

```text
onboard

setup
setup edit [<server-name>]
setup remove [<server-name>]

profile add <id> --url <url> --client <nnn> [--language EN]
    [--environment development|quality|production]
    [--username <user>] [--packages ZPKG1,ZPKG2] [--read-only | --allow-writes]
    [--allow-data-queries]
    [--classic-bridge-path /sap/<path>]
    [--auth-type basic|oauth-client-credentials|oauth-authorization-code|btp-destination]
    [--destination-name <name> --destination-auth OAuth2UserTokenExchange|PrincipalPropagation]
    [--authorization-url <url>]
    [--token-url <url> --client-id <id> [--scope <scope>]]
    [--login [--password-stdin]]
profile add <id> --service-key <path> [--language EN]
    [--environment development|quality|production]
    [--scope <scope>] [--packages ZPKG1,ZPKG2] [--read-only | --allow-writes]
    [--allow-data-queries]
profile list
profile remove <id>

auth login <id> [--username <user>] [--password-stdin]
auth status <id>
auth logout <id>

abapgit auth login <id> --repository-url <url> --username <user> [--password-stdin]
abapgit auth status <id> --repository-url <url>
abapgit auth logout <id> --repository-url <url>

doctor <id> [--include-components]
apikey new <id> [--role viewer|developer|admin] [--pepper-file <path>]
apikey pepper

assure <id> --transport <trkorr> [--checks atc,unit_tests,target_compare]
    [--target-system <id>] [--fail-on-atc-warnings] [--max-objects <n>]
    [--formats json,sarif,junit] [--report-directory <path>]
    [--fail-on incomplete|failed]

serve [--profile <id>] [--api-version v0|v1]
    [--onboard-if-empty]
    [--preset compact|development|assurance|adaptive|minimal|single]
    [--toolsets core,write,analysis,debug,operations,artifacts|all]
    [--audit-log none|stderr|file] [--audit-log-file <path>]
    [--audit-include-arguments]
    [--http [--api-keys-file <path>]
     [--oidc-issuer <url> --oidc-audience <aud> [--oidc-jwks-uri <url>]
      [--oidc-role-claim <claim>] [--oidc-role-map <value>=<role>,...]
      [--oidc-default-role viewer|developer|admin]]
     [--oauth-resource-url <public-https-mcp-url>]
     [--api-key-pepper-file <path>]
     [--host <host>] [--port <n>]
     [--allowed-origin <origin>] [--allowed-host <host>]
     [--rate-limit <requests-per-minute>] [--max-concurrent <n>]
     [--max-sessions <n>] [--session-timeout <seconds>]]
```

In this checkout, `serve` defaults to v1 minimal mode, every Resource, no
audit sink, and local `stdio`. Use `--toolsets all` to advertise every v1 tool
directly. HTTP mode requires API keys, OIDC, or both.
The default has five gateways and retains all 120 capabilities. The optional
`adaptive` preset advertises the 12 compact tools plus five fixed discovery
and invocation tools while keeping every v1 capability reachable on demand.
That optional preset has 17 tools while 120 capabilities remain reachable. Select
full mode explicitly when the host's discovery or per-tool policy needs original
tool names. The behavior described here is included in 2.0.0; `npx ...@latest` examples
use the registry release, and `@2.0.0` pins this version.

`--onboard-if-empty` opens local SAP setup for an app-managed stdio server with
no profiles. With this flag, `SAP_ABAP_MCP_OPEN_SETUP=true` reopens existing
setup. Saved connections can be verified without entering their credential again.
HTTP OAuth discovery uses `--oauth-resource-url` with a public HTTPS MCP URL.
Direct `bearer-passthrough` profile creation is refused in this checkout; see
the [migration guidance](setup-and-profiles.md#request-scoped-bearer-passthrough).

## Local-build registration

```bash
npm install
npm run build
codex mcp add sap-abap-local -- node "/absolute/path/to/sap-abap-mcp/dist/src/index.js" serve
```

Use a distinct MCP name so a local build does not overwrite the published
configuration. Run `npm run check` and `npm pack --dry-run` before publishing.

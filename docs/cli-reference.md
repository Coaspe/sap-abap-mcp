# CLI reference

Run `npx @coaspe/sap-abap-mcp@latest help` for the command surface installed by
the current npm release. On Windows, use `npx.cmd`.

```text
setup
setup edit [<server-name>]
setup remove [<server-name>]

profile add <id> --url <url> --client <nnn> [--language EN]
    [--environment development|quality|production]
    [--username <user>] [--packages ZPKG1,ZPKG2]
    [--allow-data-queries]
    [--classic-bridge-path /sap/<path>]
    [--auth-type basic|oauth-client-credentials|oauth-authorization-code|bearer-passthrough]
    [--authorization-url <url>]
    [--token-url <url> --client-id <id> [--scope <scope>]]
    [--login [--password-stdin]]
profile add <id> --service-key <path> [--language EN]
    [--environment development|quality|production]
    [--scope <scope>] [--packages ZPKG1,ZPKG2]
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
    [--preset compact|development|assurance]
    [--toolsets core,write,analysis,debug,operations,artifacts|all]
    [--audit-log none|stderr|file] [--audit-log-file <path>]
    [--audit-include-arguments]
    [--http [--api-keys-file <path>]
     [--oidc-issuer <url> --oidc-audience <aud> [--oidc-jwks-uri <url>]
      [--oidc-role-claim <claim>] [--oidc-role-map <value>=<role>,...]
      [--oidc-default-role viewer|developer|admin]]
     [--api-key-pepper-file <path>]
     [--host <host>] [--port <n>]
     [--allowed-origin <origin>] [--allowed-host <host>]
     [--rate-limit <requests-per-minute>] [--max-concurrent <n>]
     [--max-sessions <n>] [--session-timeout <seconds>]]
```

`serve` defaults to the current v1 API, every v1 toolset, every Resource, no
audit sink, and local `stdio`. HTTP mode requires API keys, OIDC, or both.

## Local-build registration

```bash
npm install
npm run build
codex mcp add sap-abap-local -- node "/absolute/path/to/sap-abap-mcp/dist/src/index.js" serve
```

Use a distinct MCP name so a local build does not overwrite the published
configuration. Run `npm run check` and `npm pack --dry-run` before publishing.

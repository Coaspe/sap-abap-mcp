# HTTP deployment and security

The default deployment is local MCP over `stdio`. Use Streamable HTTP only when
a team intentionally operates a shared instance and can provide authentication,
TLS termination, secret injection, monitoring, and network policy.

## Create API keys

Generate a credential and write only its digest to the key file:

```bash
npx @coaspe/sap-abap-mcp@latest apikey new operator --role developer
```

Merge the generated record into a protected file:

```json
{
  "keys": [
    {
      "id": "operator",
      "role": "developer",
      "keySha256": "<generated digest>"
    }
  ]
}
```

The generated API key is printed once. Store it in the client secret store, not
in the JSON file or repository.

For defense in depth, create a server-only pepper and generate HMAC records:

```bash
npx @coaspe/sap-abap-mcp@latest apikey pepper > /run/secrets/api-key-pepper
npx @coaspe/sap-abap-mcp@latest apikey new operator \
  --role developer --pepper-file /run/secrets/api-key-pepper
```

Keep the key file and pepper separate. A `keyHmacSha256` record refuses to start
without the matching `--api-key-pepper-file`; it never downgrades to plain SHA.

## Start the server

```bash
npx @coaspe/sap-abap-mcp@latest serve --http \
  --api-keys-file /run/secrets/api-keys.json \
  --api-key-pepper-file /run/secrets/api-key-pepper \
  --host 127.0.0.1 --port 3000
```

HTTP mode requires API keys, OIDC, or both. `GET /healthz` is unauthenticated and
does not call SAP. MCP requests use `Authorization: Bearer <credential>`.

## Roles

| Role | Advertised tools |
|---|---|
| `viewer` | Tools marked read-only |
| `developer` | Read-only tools and ordinary writes, excluding administrator-only operations |
| `admin` | The complete selected surface |

Administrator-only operations include transport release/deletion and ownership,
repository deletion execution, version restore execution, abapGit push/unlink,
branch switching, RAP binding publication changes, and local transaction launch.
Hidden tools are not advertised and cannot be called by name.

## OIDC/JWT authentication

```bash
npx @coaspe/sap-abap-mcp@latest serve --http \
  --oidc-issuer https://login.example.com/oauth2/v2.0 \
  --oidc-audience sap-abap-mcp \
  --oidc-role-map "sap.developer=developer,sap.admin=admin" \
  --host 0.0.0.0 --port 3000
```

| Control | Behavior |
|---|---|
| Algorithms | Accepts `RS256/384/512`, `PS256/384/512`, and `ES256/384/512`; rejects `HS*` and `none` |
| Keys | Uses `--oidc-jwks-uri` or `<issuer>/.well-known/jwks.json`; caches for five minutes and refreshes once for an unknown `kid` |
| Claims | Requires matching `iss`, matching `aud`, and `exp`; honors `nbf` with 60 seconds of clock skew |
| Identity | Uses `sub` as the audit principal |
| Role | Reads `--oidc-role-claim`, maps values through `--oidc-role-map`, and otherwise uses `--oidc-default-role` |

API keys and OIDC may be enabled together. OIDC verification uses Node.js
`crypto` and adds no runtime dependency.

## Restrict principals to SAP profiles

API key records can assign a principal to selected profiles:

```json
{
  "keys": [
    { "id": "alice", "role": "developer", "keySha256": "…", "systemIds": ["DEV100_ALICE"] },
    { "id": "bob", "role": "developer", "keySha256": "…", "systemIds": ["DEV100_BOB"] }
  ]
}
```

Use one SAP profile per person when SAP-side change documents and SAP
authorization objects must apply to that identity. Omitting `systemIds` keeps
all profiles reachable by that principal.

For request-scoped OIDC bearer forwarding to SAP, create an explicit
`bearer-passthrough` profile as documented in
[Setup and profile management](setup-and-profiles.md#request-scoped-bearer-passthrough).

## Transport and session controls

| Control | Default and behavior |
|---|---|
| Bind address | `127.0.0.1`; `--host 0.0.0.0` is explicit |
| TLS | The server speaks plain HTTP; terminate TLS at a reverse proxy |
| Origin | Requests with `Origin` are rejected unless allowed by `--allowed-origin` |
| Host | `--allowed-host` restricts accepted Host headers |
| Session binding | A session belongs to the principal that initialized it |
| Rate limit | 240 requests per principal per minute; configurable with `--rate-limit` |
| Concurrency | Eight in-flight SAP requests; configurable with `--max-concurrent` |
| Sessions | 64 sessions with a 1,800-second idle timeout by default |
| Body size | Requests above 4 MiB are rejected |
| Browser policy | CORS is off unless an allowed Origin is configured |

Every HTTP session gets its own tool service, preview plans, staged abapGit
snapshots, and execution plans. SAP connection pooling remains shared where the
authentication mode permits it.

## Audit log

Enable one JSONL event per tool call and Resource read:

```bash
npx @coaspe/sap-abap-mcp@latest serve --http \
  --api-keys-file /run/secrets/api-keys.json \
  --audit-log file --audit-log-file /var/log/sap-abap-mcp/audit.jsonl
```

Events include timestamp, principal, capability, mutation/destructive hints,
selected system, bounded object identity, outcome, error code, and duration.
Arguments are excluded by default. `--audit-include-arguments` includes only a
redacted and bounded form; credentials, tokens, cookies, CSRF values, and SQL
text remain redacted. Protect and rotate the file as security telemetry.

Environment variables are available for managed launchers, including
`SAP_ABAP_MCP_AUDIT_LOG`, `SAP_ABAP_MCP_AUDIT_LOG_FILE`,
`SAP_ABAP_MCP_OIDC_ISSUER`, and `SAP_ABAP_MCP_OIDC_AUDIENCE`.

## Container deployment

```bash
docker build -t sap-abap-mcp .
docker run --rm -p 3000:3000 \
  -v /etc/sap-abap-mcp/api-keys.json:/run/secrets/api-keys.json:ro \
  -e SAP_ABAP_MCP_PASSWORD_DEV100="$SAP_PASSWORD" \
  sap-abap-mcp
```

The image runs as a non-root user and contains no SAP credential or API key.
Mount key files read-only and inject Linux SAP secrets through profile-specific
environment variables.

## Production checklist

- Terminate TLS before exposing the endpoint beyond loopback.
- Require API keys, OIDC, or both; never use a shared anonymous endpoint.
- Restrict `Origin`, `Host`, inbound networks, roles, and SAP profile assignment.
- Keep API key digests, peppers, SAP credentials, and audit logs outside the
  image and source repository.
- Mark production SAP profiles as `production`; the runtime enforces read-only
  behavior independently of the HTTP role.
- Monitor `/healthz`, authentication failures, rate limits, denied operations,
  SAP failures, and session capacity.

## Current limitation: token exchange

The server can forward an OIDC user's token only when SAP accepts that same
token. Cloud Connector or BTP `OAuth2UserTokenExchange` is not implemented.

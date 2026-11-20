# SAP API policy and side-by-side deployment

This is an architecture review aid, not a finding of SAP API Policy compliance.
Check the policy version incorporated into the applicable SAP agreement and confirm
that every endpoint and intended use is published, documented or otherwise
expressly authorized. SAP's [API Policy](https://help.sap.com/doc/sap-api-policy/latest/en-US/API_Policy_latest.pdf)
v.4.2026a restricts non-published APIs and, subject to its stated exceptions,
(semi-)autonomous or generative AI systems planning or executing API calls.
Neither personal credentials, a private network, a local process nor this server's
security controls establish an SAP-endorsed pathway. Review the exact deployment,
capabilities, contract and architecture with SAP and the organization's legal and
security teams before use. SAP's official ADT MCP availability does not by itself
authorize a third-party client or every endpoint it calls.

| Deployment | Identity and security boundary | Review and evidence |
| --- | --- | --- |
| Local stdio | The host runs under the local OS user. Basic/OAuth credentials are stored using macOS Keychain or Windows DPAPI where supported; SAP applies the configured account's authorizations. Linux environment-only credentials need separate protection. | Restrict workstation and host access, review SAP permissions, endpoint publication and agent data sharing. A host can send source to its configured model provider. |
| Self-hosted HTTP | The `node:http` listener uses API-key roles or OIDC; profiles can be scoped per principal. Configure `sap-abap-mcp.audit/v1` audit events and protect their storage. SAP identity may still be a shared technical user unless per-user profiles or propagation are configured. | Use private networking/TLS termination, secrets management, rate limits and retention controls. API keys restrict MCP access; they do not independently grant SAP authorization. See [HTTP deployment](http-deployment.md). |
| BTP principal propagation | BTP Destination, Connectivity and Cloud Connector can carry the user identity to SAP when correctly configured. MCP authentication, token exchange, trust setup and SAP authorization are separate boundaries. | [Destination integration](btp-destination-integration.md) has local fixture coverage; end-to-end enterprise identity and authorization have not been established by retained live evidence. |

Caller-supplied data queries require explicit opt-in on development/quality profiles; production
profiles refuse the opt-in. This checkout additionally defaults to blocking the
`USR*`, `PA0*` and `HRP1000` identifiers even when queries are enabled. Configured
patterns replace the default and matching is conservative; it does not resolve
underlying views. SAP authorization and an approved data policy remain necessary.
System metadata inspection also uses a small set of fixed SQL queries; the
data-source blocklist applies to those queries, but the caller SQL opt-in is not
their gate.
See [profile policy](setup-and-profiles.md#access-scope-in-this-checkout).

This repository is MIT licensed and has no default remote telemetry; audit logs
are local/configured operational records, not a claim that the host or SAP sends
no telemetry. The distribution verifies the identified bundled security
backports with `npm run verify:backports`; this is not a claim that every
dependency is vulnerability-free. The measured `@mcp-abap-adt/core@23.0.2`
package states AGPL-3.0-only; licenses vary across other packages and must be
reviewed individually.

## Working alongside SAP's ADT MCP

SAP documents an [ADT MCP server built into its VS Code extension](https://developers.sap.com/tutorials/abap-dev-adt-mcp-server-tools)
and an Eclipse 3.60 setup with a local endpoint and token in its
[side-by-side example](https://community.sap.com/t5/technology-blog-posts-by-sap/s-4hana-custom-code-migration-agent-accelerating-ecc-to-sap-s-4hana/ba-p/14418929/page/2).
SAP describes object creation, transport creation, generators, activation and
ATC among its capabilities. Availability and tool names depend on installed
version and SAP system. SAP's VS Code tutorial labels that feature experimental;
check current product documentation and entitlements.

| Workflow | Official ADT MCP | This server |
| --- | --- | --- |
| Interactive ABAP development | IDE-integrated development tools including object lifecycle and ATC, subject to installed version | Headless tools and scoped gateways; capability availability depends on backend |
| CI transport assurance | Check the current official tool list for the installed version | `assure` runs without an IDE, evaluates configured checks and does not release the transport; live CI/SAP acceptance remains unverified |
| Multiple systems | Check the official version's system support | Profiles and comparison tools can target multiple configured systems; permissions remain per system |
| Runtime investigation | Check current official tool list; do not assume an absence | Dump, debugger and trace paths are implemented subject to backend capability and authorization |
| Initial tool surface | Check actual host and version | Five-tool minimal gateway measured 1,024 estimated tokens in [the 2026-11-03 offline fixture](evidence/competitive-offline-2026-11-03.json); an older fixture measured 961 |

These are workflow differences, not claims of exclusive functionality or measured
competitive task success. IDE handling of `adt://` links and profile-name to ADT
system-name mapping must be checked in the target IDE. A link is omitted if the
backend did not supply a valid ADT path; an `adt://` URI with a position is not
an MCP Resource URI accepted by this server's strict Resource parser.

For a host supporting an HTTP MCP server and a stdio MCP server, an illustrative
VS Code-style configuration is below. Use the actual endpoint and authorization
format supplied by the enabled SAP extension; keep its token in a host-supported
secret store rather than a committed file. This exact combination was not tested
against a live SAP system.

```json
{
  "servers": {
    "sap-official-adt": {
      "type": "http",
      "url": "http://localhost:2234/mcp",
      "headers": { "Authorization": "Bearer <SAP-ADT-LOCAL-TOKEN>" }
    },
    "sap-abap-mcp": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@coaspe/sap-abap-mcp@2.2.0", "serve", "--profile", "DEV100"]
    }
  }
}
```

The port above illustrates SAP's Eclipse example; SAP's VS Code tutorial shows a
different default. Host configuration syntax and token handling differ. Register
both under distinct names, verify each server independently, and select the
intended tools for the task. Existing pinned installations need an explicit
update before they pick up changes.

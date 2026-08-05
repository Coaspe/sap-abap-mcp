# SAP ABAP MCP compatibility profile

This directory contains a proposal for minimum interoperability between SAP
ABAP development MCP servers. It is not an SAP standard and does not imply SAP
endorsement.

Profile v1 intentionally starts with ten read-only tools and three evidence
Resources. Tool names alone do not make writes safe, so mutation capabilities
are optional. Implementations that expose mutations should publish accurate MCP
tool annotations, separate preview from destructive execution, and require an
explicit confirmation bound to fresh state.

## Run conformance locally

Test this repository's default v1 server:

```bash
npm run conformance:v1
```

Test another local stdio implementation:

```bash
npm run build
node scripts/check-profile-conformance.mjs \
  --command node \
  --args-json '["/absolute/path/to/server.js"]'
```

The command initializes the server and calls only MCP discovery methods. It
does not call an SAP-facing tool. It prints JSON evidence and exits with:

- `0` when every required tool and Resource name is advertised;
- `1` when a required capability is missing;
- `2` when the server cannot be launched or inspected.

Passing proves discovery compatibility only. It does not prove that a selected
SAP release exposes an endpoint, that the current user is authorized, or that
an operation has succeeded against a live system.

## Governance

Changes begin as GitHub Discussions and must include the compatibility problem,
contract impact, security impact, and evidence from at least one implementation.
The profile remains `proposal` until independent implementations and adopters
participate in governance.

[`GOVERNANCE.md`](GOVERNANCE.md) states the full process, the rules that
constrain the editor — no single-vendor requirements, no unverifiable
requirements, a read-only required core, and recorded objections — and the exact
evidence that moves `status` from `proposal` to `stable`.

The validator measures any local stdio MCP server without that server's
cooperation and without SAP credentials, so conformance is a published fact
rather than a negotiated claim.

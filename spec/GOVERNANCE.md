# Governance of the SAP ABAP MCP compatibility profile

This document describes how the profile in this directory is changed and how it
is intended to stop being owned by one project. It is not an SAP standard and
does not imply SAP endorsement.

## Why the profile is separate from the server

A profile that only one implementation can pass is a product feature, not an
interoperability standard. The profile therefore constrains **advertised MCP
capability names and evidence contracts** and never a particular runtime,
transport, deployment model, authentication method, or vendor.

The reference validator in `scripts/check-profile-conformance.mjs` accepts any
local stdio MCP command through `--command` and `--args-json`. It calls only MCP
discovery methods and never a SAP-facing tool, so an implementation can be
checked without SAP credentials.

## Current status

`status: "proposal"`. The profile stays a proposal until the conditions in
**Becoming a neutral standard** are met. Until then, it is a public, testable
proposal from a single maintainer, and readers should treat it as such.

## Roles

| Role | Who | Rights |
|---|---|---|
| Editor | The maintainer of this repository | Merges changes that follow this document; may not add a requirement only their own implementation can satisfy |
| Implementer | Anyone shipping an MCP server that targets the profile | Proposes changes, publishes conformance evidence, objects to a change |
| Adopter | An organization running a conforming server | Reports field problems; entries live in [`ADOPTERS.md`](../ADOPTERS.md) |

Editorship is not offered as a negotiating position. It follows from published
conformance evidence and adopters, per **From proposal to standard**.

## Change process

1. Open a [GitHub Discussion](https://github.com/Coaspe/sap-abap-mcp/discussions)
   describing the compatibility problem, the contract impact, the security
   impact, and evidence from at least one implementation.
2. Leave the discussion open for at least 14 days so implementers can object.
3. A change lands only with a validator update, a test, and a `CHANGELOG` entry.
4. Version the profile with semantic versioning. Adding a required capability is
   a major change. Adding an optional capability or clarifying prose is a minor
   change.

### Rules that constrain the editor

- **No single-vendor requirements.** A required capability must be implementable
  from public ADT services or a documented SAP API. If only this repository can
  satisfy it, it does not belong in the profile.
- **No unverifiable requirements.** Every requirement must be checkable by the
  reference validator without SAP credentials, or be explicitly marked as
  requiring live evidence.
- **Read-only core.** The required set stays read-only. Tool names alone do not
  make writes safe, so mutation capabilities remain optional and are described
  through the safety obligations in `optionalMutationRequirements` rather than a
  required name list.
- **Objections are recorded.** An implementer's unresolved objection is quoted in
  the discussion outcome even when the change lands.

## From proposal to standard

`status` becomes `stable` when the profile is demonstrably not a single-vendor
artifact:

1. at least two independent implementations publish passing conformance
   evidence — an implementation is independent when this repository's maintainer
   did not write it, which includes a customer's or consultancy's internal
   server;
2. at least three independent organizations appear in `ADOPTERS.md`.

The identifier `io.github.Coaspe/sap-abap-mcp/profile/v1` is retained as an alias
across any later relocation, so published evidence never expires.

## Running conformance against another implementation

The validator accepts any local stdio MCP command, so anyone can measure any
server without that server's cooperation and without SAP credentials:

```bash
node scripts/check-profile-conformance.mjs \
  --command node --args-json '["/absolute/path/to/other-server.js"]'
```

Published results, passing or failing, are the evidence that decides which
contract is real. A failing result identifies a concrete naming or contract
disagreement rather than hiding it.

## What conformance does and does not prove

Passing proves that a server advertises the required capability and Resource
names. It does not prove that a selected SAP release exposes an endpoint, that
the current user is authorized, that an operation succeeded against a live
system, or that a mutation is safe.

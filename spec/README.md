# SAP ABAP MCP compatibility profile

This directory contains a proposal for minimum interoperability between SAP
ABAP development MCP servers. It is not an SAP standard and does not imply SAP
endorsement.

Profile v1 proposes ten read-only tools and three evidence Resources. The current
proposal incorrectly includes ABAP Unit and transport assessment in that
read-only core: both can execute application tests. The corrected server marks
them as execution capabilities. The validator now rejects required tools without
an explicit `readOnlyHint: true`, including these two execution capabilities.
Its evidence
reports missing names separately from `read-only-tool-unverified` failures.
A local contract review draft and the earlier annotation audit are in
[`../docs/competitive-unit-execution-2026-10-02/contract-review.json`](../docs/competitive-unit-execution-2026-10-02/contract-review.json).
The existing profile and its identifier remain unchanged pending the documented
governance process; the corrected implementation currently fails that proposal.
Tool names alone do not make writes safe, so mutation capabilities
are optional. Implementations that expose mutations should publish accurate MCP
tool annotations, separate preview from destructive execution, and require an
explicit confirmation bound to fresh state.

## Run conformance locally

For the project release contract, which requires all ten names with accurate
read-only versus execution annotations, run `npm run conformance:release`.
[`RELEASE-PROFILE.md`](RELEASE-PROFILE.md) identifies that draft separately from
the unchanged public interoperability proposal below. CI and installed-package
validation select this release draft explicitly and do not claim the old
read-only proposal passed.

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

- `0` when every required tool and Resource name is advertised and each required
  tool explicitly advertises `readOnlyHint: true`;
- `1` when a required capability is missing or its read-only hint is absent/false;
- `2` when the server cannot be launched or inspected.

Passing proves discovery metadata compatibility only. An annotation is a claim
from the server, not proof that its implementation has no side effects. It does
not prove that a selected SAP release exposes an endpoint, that the current user
is authorized, or that an operation has succeeded against a live system.

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

The current repository returns exit code `1` for ABAP Unit and transport
assessment. Both advertise execution risk; weakening that metadata or skipping
the CI conformance check would hide the unresolved profile defect. The profile
proposal must be reviewed through governance before a release can claim conformance.


A separate, unpublished review packet contains an eight-capability candidate,
actual full/minimal/single discovery measurements and a discussion draft:
[`../docs/competitive-profile-review-2026-10-02/discussion-draft.json`](../docs/competitive-profile-review-2026-10-02/discussion-draft.json).
The candidate version is provisional. Its direct advertisement passes the local
candidate check; gateway catalog schemas match but the current direct-name
profile does not accept that discovery path. No profile has been ratified or
posted by preparing these files.

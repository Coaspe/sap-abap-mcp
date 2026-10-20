# Roadmap

Release implementation, local verification, live compatibility and independent
adoption are separate states. See the [evidence index](docs/evidence/index.json).

## Shipped in 2.0.0 / 2.0.1

Onboarding/doctor, Basic and OAuth/PKCE, BTP service-key import, DPAPI/Keychain,
read-only first-run policy, five gateways reaching 120 capabilities, batch and
conditional source reads, KTD/public contracts, workflow prompts, debugger/RAP,
HTTP roles/audit, transport assure, MCPB and registry distribution already exist.
These features are not new implementation tasks. Shipping them does not establish
successful deployment on every SAP release, native host or identity provider.

## Reliability improvements in 2.1.0

- Compatible non-interactive no-argument stdio launch and explicit setup-required discovery.
- Version-pinned npm registration, actual registration doctor and preview/apply repair.
- Native macOS credential round-trip fix, smaller runtime artifact and measured deferred Mermaid loading.
- Conservative product classification and preservation of conflicting inactive work; uncertain multi-object writes stop without automatic rollback.
- Validated evidence index, UTC download quality flags and voluntary user-outcome exports; no default telemetry.

## Acceptance gates

- Verify current 2.x workflows on an authorized SAP development fixture, retaining version/commit/component evidence.
- Retain version-bound Windows/native-host evidence. The owner reports the unchanged Windows read-only candidate passed; sanitized per-operation field records remain pending.
- Run the existing T1–T5 contract with Coaspe, ARC-1 and VSP, three fresh sessions each; compare correctness before cost.
- Observe the preregistered 10 external developers: eight first-task successes and five different-task reuses by day seven; retain failures and nonresponses.
- Collect independent adopters, conformance implementations and neutral governance evidence before making a standard or market-leading claim.

## Later

- Propose the compatibility profile through a neutral, multi-maintainer
  governance process after at least three independent organizations have
  adopted it.
- Add additional authentication and enterprise deployment models only when
  they preserve the local secret and authorization boundaries.

## How decisions are made

Open a [GitHub Discussion](https://github.com/Coaspe/sap-abap-mcp/discussions)
for proposals that change public contracts or security boundaries. Open an
issue for a reproducible defect. A roadmap entry is not a promise of SAP
backend availability or a substitute for SAP product documentation.

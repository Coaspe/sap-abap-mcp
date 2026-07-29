# Roadmap

SAP ABAP MCP follows an evidence-first roadmap. Dates are intentionally absent:
an item is complete only when its contract, automated tests, documentation, and
applicable live-SAP evidence agree.

## Now

- Keep npm, GitHub Releases, the Official MCP Registry, MCPB, Smithery, and
  directory metadata aligned with the same stable version.
- Publish the v1 compatibility profile and implementation-independent
  conformance evidence.
- Expand sanitized live-SAP evidence across ECC, S/4HANA, and ABAP Cloud
  without publishing customer systems or source.
- Recruit verified adopters and document reproducible workflows.

## Next

- Define an admin-governed Dynpro extension profile for systems where public
  ADT endpoints do not provide the required screen CRUD operations.
- Add end-to-end Fiori workflows that compose RAP/OData backend generation
  with established SAP Fiori project tooling instead of duplicating it.
- Add more conformance levels for safe writes, quality gates, transports, RAP,
  runtime analysis, and cross-system operations.
- Publish compatibility evidence produced by independent implementations.

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

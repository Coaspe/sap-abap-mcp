# Changelog

All notable changes to `@coaspe/sap-abap-mcp` are documented here. This project follows semantic versioning.

## Unreleased

### Security

- XLSX export remains supported through a dependency-light OOXML writer, replacing the vulnerable ExcelJS/archive dependency chain. Future npm releases publish with provenance, and pull requests run dependency and code-security gates.

## 1.0.0

First stable release. Consolidates the v1 MCP surface (v1 is the default tool set) with reliability and robustness fixes for RAP, transport release, and abapGit tools, verified against a live SAP system (B4D) and covered by regression tests. No tools added or removed relative to 0.4.15.

### Fixed

- **`sap.rap.generate` false negative**: the generator handler compared the objects echoed in the generate response against the preceding preview and failed the whole operation when a system returned only a subset (for example just the service binding). It now verifies each previewed object with a repository read-back and only reports `RAP_GENERATION_RESULT_MISMATCH` (with the missing set) when an object is genuinely absent, returning `readBackVerified: true` on success.
- **`sap.rap.binding.inspect` crash on V4 and unpublished bindings**: inspecting a binding with no active OData query links (unpublished or V4) crashed inside the ADT client. The service-binding read now returns metadata without service details in that case instead of throwing.
- **`sap.rap.binding.inspect` crash on V2 bindings**: mapping a V2 service dereferenced a service URL that V2 bindings leave undefined, throwing during inspection. The mapping now falls back to the populated service URL and omits the preview URL when it cannot be built.
- **`sap.rap.binding.unpublish` for OData V4**: unpublish previously supported only V2 bindings. V4 bindings are now unpublished through the OData V4 job endpoint; `serviceName` and `serviceVersion` are optional and used only for V2.
- **`sap.transport.release` on newer systems**: release now creates the ATC check worklist the ADT release gate expects and releases open, non-empty tasks before the request. When a system rejects the synchronous release of an object-bearing transport, the tool returns a clear `TRANSPORT_RELEASE_UNSUPPORTED` error pointing to SE10/SE09 instead of a raw HTTP 500.
- **abapGit tools on systems without the ADT backend**: the git tools now return `ABAPGIT_BACKEND_UNAVAILABLE` with installation guidance when `/sap/bc/adt/abapgit/*` is not present, rather than an opaque "resource does not exist" error.
- **v0 contract and distribution catalog tooling**: `scripts/update-v0-contract.mjs` pins `--api-version v0` so the committed legacy fixture remains exact. The MCPB and Smithery catalogs follow the unversioned runtime and advertise the default v1 surface.

### Known limitations

- Object-bearing transport release is unsupported on systems that only run release as a GUI background job; release such transports from SE10/SE09. A future release may add the asynchronous background-run path used by the SAP GUI.
- The abapGit tools require the abapGit ADT backend; the standalone abapGit report (SE38) does not expose the required endpoints.

## 0.4.15

Baseline for the v1 MCP surface (v1 as the default tool set) and the read-only slice. See the Git history for details.

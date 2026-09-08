# Bounded component navigation

`sap.semantic.components` lists direct children of a class or interface from SAP
ADT objectstructure metadata. Use it before choosing which source ranges to read.
In adaptive mode, discover and describe this capability, then call it through
`sap.capability.invoke_read`. No tool is added to the default 17-tool surface.

```json
{
  "systemId": "DEV100",
  "fileUri": "adt://dev100/sap/bc/adt/oo/classes/zcl_demo/source/main",
  "visibility": "public",
  "limit": 20
}
```

Each result reports `childCount`. To inspect a returned child, pass its name in
`componentPath`, for example `["/NS/IF_DEMO~RUN"]`. Append subsequent child names
to descend further. Names match case insensitively; returned paths use SAP's
spelling. Paths are arrays so namespace slashes and interface qualification do
not create ambiguous separators. The input allows at most eight path segments,
each at most 256 characters. Missing and ambiguous matches fail explicitly.

`visibility` filters the selected node's direct children **before** pagination.
`total` describes the filtered siblings, and `nextStartIndex` advances within
that set. Keep the same path and visibility when following pages. Omitting the
filter includes all visibility values. The filter is a presentation option,
not an authorization boundary or an inherited-visibility calculation.

The root summary describes the selected node. Its descendants are not expanded
recursively. An empty component list means the backend returned no children for
that node; it does not prove that a method has no parameters. `type` is an ADT
component kind, not an ABAP parameter datatype. This is not a complete public
API signature extractor or ARC-1 SAPContext equivalent.

Component inspection resolves the object URI directly and requests object metadata
followed by component metadata. It does not read source bodies or run repository
search. Other semantic operations still use source where their SAP APIs need it.
Object type validation, connection mismatch rejection and backend access failures
remain enforced. This removes two service calls from the former path; network
round trips and latency depend on the backend and have not been measured live.

Local tests cover nested namespaced paths, visibility before pagination, leaf
nodes, absent/ambiguous paths, bounded schema validation, and MCP input forwarding.
Additional tests prohibit source/search calls, check object/source/include URI
normalization and stop on metadata denial. Actual SAP metadata shapes and end-to-end usefulness remain live acceptance work.
The full schema grew by 442 bytes; the adaptive surface at that measurement was 26,457 bytes.

For exact declared public signatures, select the optional
[public API view](public-api-view.md). The default component-tree mode still
returns ADT metadata and does not invent signatures from component type labels.

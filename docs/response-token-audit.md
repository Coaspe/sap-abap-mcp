# MCP response token audit

Audit date: 2026-07-20

## Scope and method

This audit covers all 53 advertised tools and 150 response variants. A variant is an action, mode, or opt-in detail branch that can materially change the response shape. `test/response-audit.test.ts` fails if an advertised tool is missing from the catalog or the reviewed variant count changes unnoticed.

The audit used four checks for every return path:

1. repeated connection, request, or object metadata;
2. raw ADT links and transport/runtime metadata that do not support a follow-up call;
3. repeated array context and unpaged collections;
4. large detail returned by default instead of by an explicit option.

The review combined static inspection of every service return branch with sanitized fixture execution. It did not execute mutating operations against a live SAP system. Exact live payload sizes vary by SAP release and ADT implementation; mutations still require the live acceptance procedure.

## Cross-cutting decisions

- Inline JSON is capped at 16 KiB. Larger exact results are retained in the deferred-result store and represented by a bounded `compact-v1` response.
- Repeated object search metadata is reduced to `{name,type}` when the same response already contains the source URI, result data, or operation identity. Search and object-info responses keep richer metadata because it is their primary result.
- Where-used results project raw ADT references into follow-up-safe fields, flatten package metadata, and correlate snippet groups with a page-local `referenceIndex` instead of repeating long ADT object identifiers. Dependency graph traversal keeps URI and expansion metadata internally but does not serialize it into graph nodes.
- Cross-system comparisons keep one top-level object identity instead of repeating it inside both system summaries.
- Lists use pagination, summaries, or explicit detail switches. Raw source, diagnostics, activation messages, release reports, query columns/values, and debugger values remain because they are the requested result or safety evidence.
- Full ADT discovery, object structure, software components, dump HTML, trace details, unit-test successes, and download file lists require explicit options or modes.
- ATC findings use one object catalog plus `objectIndex` references instead of repeating object metadata per finding.

## Complete tool audit

Legend: **reduced** means this audit changed the default response; **bounded** means existing pagination/byte limits were sufficient; **explicit detail** means the large form is opt-in; **primary retained** means removing fields would remove the requested result or safety evidence.

| Tool | Reviewed variants | Decision |
| --- | --- | --- |
| `read_deferred_result` | read | bounded UTF-8 chunks |
| `get_connected_systems` | list | reduced connection profile repetition |
| `get_sap_system_info` | summary, components | explicit detail for components |
| `get_sap_capabilities` | summary, evidence | reduced system metadata; evidence explicit |
| `search_abap_objects` | search | primary retained; result count bounded |
| `get_abap_object_lines` | source, method | reduced object identity; line paging |
| `search_abap_object_lines` | literal, regexp | reduced merged context blocks; result paging |
| `get_abap_object_info` | summary, structure | reduced ADT metadata; structure explicit |
| `get_batch_lines` | batch | reduced nested `connectionId`; total-line cap |
| `get_object_by_uri` | source | bounded line paging |
| `get_abap_object_url` | URL | compact |
| `get_abap_object_workspace_uri` | workspace URI | reduced object identity |
| `open_object` | headless open | reduced object identity |
| `find_where_used` | references, snippets | reduced raw ADT reference metadata; references paged; snippets explicit |
| `get_abap_dependency_graph` | graph | reduced traversal-only node metadata; node cap |
| `compare_abap_systems` | diff | removed duplicate source/target object identity; patch cap |
| `create_object_programmatically` | create, source write | primary retained for follow-up and recovery |
| `replace_string_in_abap_object` | replace | reduced object identity; diagnostics capped |
| `get_abap_diagnostics` | diagnostics | reduced object identity; paged |
| `abap_activate` | single, batch | reduced object identity; safety messages retained |
| `inspect_abap_code` | 8 semantic actions | reduced object identity; collections paged and text bounded |
| `refactor_abap_code` | 6 previews, execute | reduced preview/execution object metadata; plan and safety evidence retained |
| `manage_text_elements` | read, create, update | reduced object identity; text elements retained as primary state |
| `run_unit_tests` | summary, failures, all | reduced object identity; successful details explicit |
| `create_test_include` | create, already exists | reduced object identity |
| `manage_transport_requests` | 13 actions | reduced parent object metadata; lists paged; release and assurance evidence retained |
| `manage_abapgit` | 9 actions | lists/staging paged; mutation receipts compact |
| `manage_rap_generator` | 9 actions | reduced reference metadata; schema paged; generated/preview objects retained |
| `manage_abap_versions` | 4 actions | reduced restore object metadata; inactive/source lists paged |
| `get_version_history` | list, source, compare | reduced object identity; source/diff paged |
| `run_atc_analysis` | analysis, documentation | reduced object catalog repetition; findings/content paged |
| `get_atc_decorations` | one file, all files | reduced object catalog repetition; paged |
| `analyze_abap_dumps` | list, analyze | reduced list links; content paged; HTML explicit |
| `analyze_abap_traces` | 5 actions | reduced run/configuration listings; entries paged; raw run explicit |
| `abap_debug_session` | start, stop, status | compact state retained |
| `abap_debug_breakpoint` | set, remove | primary retained for per-line result evidence |
| `abap_debug_step` | 5 step types | primary retained for debugger state |
| `abap_debug_variable` | variables | row and variable caps |
| `abap_debug_stack` | stack | primary retained; global byte cap applies |
| `abap_debug_status` | status | compact state retained |
| `execute_data_query` | internal, UI, file | rows bounded; file mode returns receipt only |
| `get_abap_sql_syntax` | syntax | bounded static reference |
| `abap_download` | summary, file list | reduced source identity; complete file list explicit |
| `manage_heartbeat` | 12 actions | reduced mutation responses; details explicit; history/tasks paged |
| `adt_discovery_export` | summary, full, file | full discovery explicit; file mode returns path |
| `run_sap_transaction` | URL, launch | compact receipt retained |
| `run_abap_application` | health, 2 previews, 2 executions | output byte cap and one-use plan receipts |
| `abap_fs_documentation` | 4 actions | line/search paging |
| `create_mermaid_diagram` | artifact | bounded artifact receipt |
| `validate_mermaid_syntax` | validation | compact |
| `get_mermaid_documentation` | documentation | bounded static reference |
| `detect_mermaid_diagram_type` | detection | compact |
| `create_test_documentation` | artifact | bounded artifact receipt |

## Measured fixture impact

Byte counts use minified UTF-8 JSON as a token proxy, not tokenizer or API billing data.

| Pattern | Before | After | Reduction |
| --- | ---: | ---: | ---: |
| Full repeated object reference | 153 B | 42 B | 72.5% |
| Capability response system metadata | 413 B | 141 B | 65.9% |
| 20 ATC findings for one object | 9,865 B | 6,810 B | 31.0% |
| 20 where-used references | 9,011 B | 3,691 B | 59.0% |
| 20 dependency graph nodes | 8,041 B | 3,311 B | 58.8% |
| One trace-run list entry with eight ADT links | 1,241 B | 208 B | 83.2% |
| Heartbeat mutation with a long query and 50 instructions | 2,064 B | 255 B | 87.6% |

Earlier representative fixtures also measured 65.5% reduction for object info and 89.4% for 20 adjacent source-search matches. A 97-line source body improved only 5.3% because the source itself is irreducible primary data.

## Tool schema cost

The serialized MCP tool definitions measure 52,259 bytes for all 53 tools and 14,313 bytes for the 18-tool `core` set. The default remains `all` because hiding write, debug, transport, Git, RAP, and operations tools would remove real functionality and break existing clients. Hosts that preload every schema and need a smaller context should launch with `--toolsets core` or another explicit combination. The full schema remains guarded below 64 KiB by tests. Re-run `npm run benchmark:surface` to reproduce the current measurements for every toolset.

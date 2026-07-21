# SAP ABAP MCP v1 parity matrix

Date: 2026-07-21

This matrix began with a runtime audit at base commit
`ae95ed7d7a8c2dad0448aa7f7903e7fffb09b188` and now records the implementation
state of this working tree. A catalog entry or toolset assignment is not counted
as an implementation. `Contract + call` means that
the MCP tool is registered, has an input and output schema, and has a test that
invokes its shared `AbapToolService` method.

## Audit summary

| Surface | Catalog | Callable now | Missing handler/schema | Runtime result |
| --- | ---: | ---: | ---: | --- |
| v0 Tools | 53 | 53 | 0 | `--api-version v0` advertises 53 |
| v1 Tools | 113 | 113 | 0 | `--api-version v1 --toolsets all` advertises 113 |
| `all` Tools | 166 | 166 | 0 | 53 v0 + 113 v1 |
| v1 Resources | 7 | 7 | 0 | One fixed Resource and six Resource Templates |

The initial baseline build and automated suite passed 260/260 tests. The current
parity gate discovers all 113 v1 handlers and all seven Resources, and the final
local automated suite passes 280/280 tests.

## Core (20 targets; 20 callable)

| v1 target | v0 source capability | Current handler | Current input/output schema | Current test state |
| --- | --- | --- | --- | --- |
| `sap.repository.inspect` | `get_abap_object_info`: summary, includeStructure | `src/mcp/v1/core-tools.ts` | Strict action-free input + v1 success envelope | Contract + one-call adapter: `test/v1-core-tools.test.ts` |
| `sap.repository.resolve` | `get_abap_object_workspace_uri`: workspaceUri; `open_object`: headless | `src/mcp/v1/core-tools.ts` | Strict action-free input + v1 success envelope | Contract + one-call adapter: `test/v1-core-tools.test.ts` |
| `sap.repository.search` | `search_abap_objects`: search | `src/mcp/v1/repository-tools.ts` | Strict `{systemId, pattern, objectTypes, limit}` + typed v1 envelope | Contract + call: `test/v1-repository-search.test.ts` |
| `sap.repository.where_used` | `find_where_used`: references, includeSnippets | `src/mcp/v1/core-tools.ts` | Strict action-free input + v1 success envelope | Contract + one-call adapter: `test/v1-core-tools.test.ts` |
| `sap.semantic.complete` | `inspect_abap_code`: completion, completion_element | `src/mcp/v1/core-tools.ts` | Strict action-free input + v1 success envelope | Contract + one-call adapter: `test/v1-core-tools.test.ts` |
| `sap.semantic.components` | `inspect_abap_code`: components | `src/mcp/v1/core-tools.ts` | Strict action-free input + v1 success envelope | Contract + one-call adapter: `test/v1-core-tools.test.ts` |
| `sap.semantic.definition` | `inspect_abap_code`: definition | `src/mcp/v1/core-tools.ts` | Strict action-free input + v1 success envelope | Contract + one-call adapter: `test/v1-core-tools.test.ts` |
| `sap.semantic.documentation` | `inspect_abap_code`: documentation | `src/mcp/v1/core-tools.ts` | Strict action-free input + v1 success envelope | Contract + one-call adapter: `test/v1-core-tools.test.ts` |
| `sap.semantic.format_preview` | `inspect_abap_code`: format_preview | `src/mcp/v1/core-tools.ts` | Strict action-free input + v1 success envelope | Contract + one-call adapter: `test/v1-core-tools.test.ts` |
| `sap.semantic.hierarchy` | `inspect_abap_code`: type_hierarchy | `src/mcp/v1/core-tools.ts` | Strict action-free input + v1 success envelope | Contract + one-call adapter: `test/v1-core-tools.test.ts` |
| `sap.semantic.quick_fixes` | `inspect_abap_code`: quick_fixes | `src/mcp/v1/core-tools.ts` | Strict action-free input + v1 success envelope | Contract + one-call adapter: `test/v1-core-tools.test.ts` |
| `sap.source.diagnose` | `get_abap_diagnostics`: diagnostics | `src/mcp/v1/core-tools.ts` | Strict action-free input + v1 success envelope | Contract + one-call adapter: `test/v1-core-tools.test.ts` |
| `sap.source.read` | `get_abap_object_lines`: source, method; `get_object_by_uri`: source | `src/mcp/v1/source-tools.ts` | Strict name/method or canonical Resource URI + typed v1 envelope | Contract + calls for both forms: `test/v1-source-read.test.ts` |
| `sap.source.read_batch` | `get_batch_lines`: batch | `src/mcp/v1/core-tools.ts` | Strict action-free input + v1 success envelope | Contract + one-call adapter: `test/v1-core-tools.test.ts` |
| `sap.source.search` | `search_abap_object_lines`: literal, regexp | `src/mcp/v1/core-tools.ts` | Strict action-free input + v1 success envelope | Contract + one-call adapter: `test/v1-core-tools.test.ts` |
| `sap.system.capabilities` | `get_sap_capabilities`: summary, includeEvidence | `src/mcp/v1/system-tools.ts` | Strict `{systemId, category?, includeEvidence}` + typed v1 envelope | Contract + call: `test/v1-capabilities.test.ts` |
| `sap.system.inspect` | `get_sap_system_info`: summary, includeComponents | `src/mcp/v1/system-tools.ts` | Strict `{systemId, includeComponents}` + typed v1 envelope | Contract + call: `test/v1-system-tools.test.ts` |
| `sap.system.list` | `get_connected_systems`: list | `src/mcp/v1/system-tools.ts` | Strict `{}` + typed v1 envelope | Contract + call: `test/v1-system-tools.test.ts` |
| `sap.text_elements.read` | `manage_text_elements`: read | `src/mcp/v1/core-tools.ts` | Strict action-free input + v1 success envelope | Contract + one-call adapter: `test/v1-core-tools.test.ts` |
| `sap.ui.object_url` | `get_abap_object_url`: url | `src/mcp/v1/core-tools.ts` | Strict action-free input + v1 success envelope | Contract + one-call adapter: `test/v1-core-tools.test.ts` |

## Write (23 targets; 23 callable)

| v1 target | v0 source capability | Current handler | Current input/output schema | Current test state |
| --- | --- | --- | --- | --- |
| `sap.execution.execute` | `run_abap_application`: executeClass, executeSnippet through confirmed execute plan | `src/mcp/v1/write-tools.ts` | Strict action-free input + v1 success envelope | Contract + one-call adapter: `test/v1-write-tools.test.ts` |
| `sap.git.branch.switch` | `manage_abapgit`: switch_branch | `src/mcp/v1/write-tools.ts` | Strict action-free input + v1 success envelope | Contract + one-call adapter: `test/v1-write-tools.test.ts` |
| `sap.git.create` | `manage_abapgit`: create_repository | `src/mcp/v1/write-tools.ts` | Strict action-free input + v1 success envelope | Contract + one-call adapter: `test/v1-write-tools.test.ts` |
| `sap.git.pull` | `manage_abapgit`: pull_repository | `src/mcp/v1/write-tools.ts` | Strict action-free input + v1 success envelope | Contract + one-call adapter: `test/v1-write-tools.test.ts` |
| `sap.git.push` | `manage_abapgit`: push_repository | `src/mcp/v1/write-tools.ts` | Strict staged push input with optional staging author defaults + v1 success envelope | Contract + one-call adapter: `test/v1-write-tools.test.ts` |
| `sap.git.stage` | `manage_abapgit`: stage_repository | `src/mcp/v1/write-tools.ts` | Strict action-free input + v1 success envelope | Contract + one-call adapter: `test/v1-write-tools.test.ts` |
| `sap.git.unlink` | `manage_abapgit`: unlink_repository | `src/mcp/v1/write-tools.ts` | Strict action-free input + v1 success envelope | Contract + one-call adapter: `test/v1-write-tools.test.ts` |
| `sap.quality.test_include.create` | `create_test_include`: create, alreadyExists | `src/mcp/v1/write-tools.ts` | Strict action-free input + v1 success envelope | Contract + one-call adapter: `test/v1-write-tools.test.ts` |
| `sap.rap.binding.publish` | `manage_rap_generator`: publish | `src/mcp/v1/write-tools.ts` | Strict action-free input + v1 success envelope | Contract + one-call adapter: `test/v1-write-tools.test.ts` |
| `sap.rap.binding.unpublish` | `manage_rap_generator`: unpublish | `src/mcp/v1/write-tools.ts` | Strict action-free input + v1 success envelope | Contract + one-call adapter: `test/v1-write-tools.test.ts` |
| `sap.rap.generate` | `manage_rap_generator`: generate | `src/mcp/v1/write-tools.ts` | Strict action-free input + v1 success envelope | Contract + one-call adapter: `test/v1-write-tools.test.ts` |
| `sap.refactor.execute` | `refactor_abap_code`: execute | `src/mcp/v1/write-tools.ts` | Strict action-free input + v1 success envelope | Contract + one-call adapter: `test/v1-write-tools.test.ts` |
| `sap.repository.create` | `create_object_programmatically`: create, createWithSource | `src/mcp/v1/write-tools.ts` | Strict action-free input + v1 success envelope | Contract + one-call adapter: `test/v1-write-tools.test.ts` |
| `sap.source.activate` | `abap_activate`: single, batch | `src/mcp/v1/write-tools.ts` | Strict action-free input + v1 success envelope | Contract + one-call adapter: `test/v1-write-tools.test.ts` |
| `sap.source.patch` | `replace_string_in_abap_object`: replace | `src/mcp/v1/write-tools.ts` | Strict action-free input + v1 success envelope | Contract + one-call adapter: `test/v1-write-tools.test.ts` |
| `sap.text_elements.write` | `manage_text_elements`: create, update | `src/mcp/v1/write-tools.ts` | Strict action-free input + v1 success envelope | Contract + one-call adapter: `test/v1-write-tools.test.ts` |
| `sap.transport.create` | `manage_transport_requests`: create_transport | `src/mcp/v1/write-tools.ts` | Strict action-free input + v1 success envelope | Contract + one-call adapter: `test/v1-write-tools.test.ts` |
| `sap.transport.delete` | `manage_transport_requests`: delete_transport | `src/mcp/v1/write-tools.ts` | Strict action-free input + v1 success envelope | Contract + one-call adapter: `test/v1-write-tools.test.ts` |
| `sap.transport.object.add` | `manage_transport_requests`: add_object | `src/mcp/v1/write-tools.ts` | Strict action-free input + v1 success envelope | Contract + one-call adapter: `test/v1-write-tools.test.ts` |
| `sap.transport.owner.set` | `manage_transport_requests`: set_owner | `src/mcp/v1/write-tools.ts` | Strict action-free input + v1 success envelope | Contract + one-call adapter: `test/v1-write-tools.test.ts` |
| `sap.transport.release` | `manage_transport_requests`: release_transport | `src/mcp/v1/write-tools.ts` | Strict confirmed release input with lock/ATC policy flags + v1 success envelope | Contract + one-call adapter: `test/v1-write-tools.test.ts` |
| `sap.transport.user.add` | `manage_transport_requests`: add_user | `src/mcp/v1/write-tools.ts` | Strict action-free input + v1 success envelope | Contract + one-call adapter: `test/v1-write-tools.test.ts` |
| `sap.version.restore.execute` | `manage_abap_versions`: execute_restore | `src/mcp/v1/write-tools.ts` | Strict action-free input + v1 success envelope | Contract + one-call adapter: `test/v1-write-tools.test.ts` |

## Analysis (29 targets; 29 callable)

| v1 target | v0 source capability | Current handler | Current input/output schema | Current test state |
| --- | --- | --- | --- | --- |
| `sap.data.query` | `execute_data_query`: internal, ui | `src/mcp/v1/analysis-tools.ts` | Strict SQL, structured-data, or cached-view input with bounded paging/sort/filter controls + v1 success envelope | Contract + variant calls: `test/v1-analysis-tools.test.ts` |
| `sap.git.check` | `manage_abapgit`: check_repository | `src/mcp/v1/analysis-tools.ts` | Strict action-free input + v1 success envelope | Contract + one-call adapter: `test/v1-analysis-tools.test.ts` |
| `sap.git.inspect` | `manage_abapgit`: remote_info | `src/mcp/v1/analysis-tools.ts` | Strict action-free input + v1 success envelope | Contract + one-call adapter: `test/v1-analysis-tools.test.ts` |
| `sap.git.list` | `manage_abapgit`: list_repositories | `src/mcp/v1/analysis-tools.ts` | Strict action-free input + v1 success envelope | Contract + one-call adapter: `test/v1-analysis-tools.test.ts` |
| `sap.quality.atc.cached` | `get_atc_decorations`: file, allFiles | `src/mcp/v1/analysis-tools.ts` | Strict action-free input + v1 success envelope | Contract + one-call adapter: `test/v1-analysis-tools.test.ts` |
| `sap.quality.atc.documentation` | `run_atc_analysis`: get_documentation | `src/mcp/v1/analysis-tools.ts` | Strict action-free input + v1 success envelope | Contract + one-call adapter: `test/v1-analysis-tools.test.ts` |
| `sap.quality.atc.run` | `run_atc_analysis`: run_analysis | `src/mcp/v1/analysis-tools.ts` | Strict action-free input + v1 success envelope | Contract + one-call adapter: `test/v1-analysis-tools.test.ts` |
| `sap.quality.unit_test` | `run_unit_tests`: summary, failures, all | `src/mcp/v1/analysis-tools.ts` | Strict action-free input + v1 success envelope | Contract + one-call adapter: `test/v1-analysis-tools.test.ts` |
| `sap.rap.availability` | `manage_rap_generator`: availability | `src/mcp/v1/analysis-tools.ts` | Strict action-free input + v1 success envelope | Contract + one-call adapter: `test/v1-analysis-tools.test.ts` |
| `sap.rap.binding.inspect` | `manage_rap_generator`: service_details | `src/mcp/v1/analysis-tools.ts` | Strict action-free input + v1 success envelope | Contract + one-call adapter: `test/v1-analysis-tools.test.ts` |
| `sap.rap.defaults` | `manage_rap_generator`: get_defaults | `src/mcp/v1/analysis-tools.ts` | Strict action-free input + v1 success envelope | Contract + one-call adapter: `test/v1-analysis-tools.test.ts` |
| `sap.rap.preview` | `manage_rap_generator`: preview | `src/mcp/v1/analysis-tools.ts` | Strict action-free input + v1 success envelope | Contract + one-call adapter: `test/v1-analysis-tools.test.ts` |
| `sap.rap.schema` | `manage_rap_generator`: get_schema | `src/mcp/v1/analysis-tools.ts` | Strict action-free input + v1 success envelope | Contract + one-call adapter: `test/v1-analysis-tools.test.ts` |
| `sap.rap.validate` | `manage_rap_generator`: validate | `src/mcp/v1/analysis-tools.ts` | Strict initial validation input with optional generated content + v1 success envelope | Contract + one-call adapter: `test/v1-analysis-tools.test.ts` |
| `sap.refactor.preview` | `refactor_abap_code`: six preview_* variants | `src/mcp/v1/analysis-tools.ts` | Strict action-free input + v1 success envelope | Contract + one-call adapter: `test/v1-analysis-tools.test.ts` |
| `sap.repository.compare` | `compare_abap_systems`: diff | `src/mcp/v1/analysis-tools.ts` | Strict action-free input + v1 success envelope | Contract + one-call adapter: `test/v1-analysis-tools.test.ts` |
| `sap.repository.dependency_graph` | `get_abap_dependency_graph`: graph | `src/mcp/v1/analysis-tools.ts` | Strict action-free input + v1 success envelope | Contract + one-call adapter: `test/v1-analysis-tools.test.ts` |
| `sap.transport.assess` | `manage_transport_requests`: assess_transport | `src/mcp/v1/analysis-tools.ts` | Strict action-free input + v1 success envelope | Contract + one-call adapter: `test/v1-analysis-tools.test.ts` |
| `sap.transport.compare` | `manage_transport_requests`: compare_transports | `src/mcp/v1/analysis-tools.ts` | Strict action-free input + v1 success envelope | Contract + one-call adapter: `test/v1-analysis-tools.test.ts` |
| `sap.transport.inspect` | `manage_transport_requests`: get_transport_details, get_transport_objects | `src/mcp/v1/analysis-tools.ts` | Strict action-free input + v1 success envelope | Contract + one-call adapter: `test/v1-analysis-tools.test.ts` |
| `sap.transport.list` | `manage_transport_requests`: get_user_transports | `src/mcp/v1/analysis-tools.ts` | Strict action-free input + v1 success envelope | Contract + one-call adapter: `test/v1-analysis-tools.test.ts` |
| `sap.transport.object.resolve` | `manage_transport_requests`: resolve_object | `src/mcp/v1/analysis-tools.ts` | Strict PGMID/type/name input with optional transport context + v1 success envelope | Contract + one-call adapter: `test/v1-analysis-tools.test.ts` |
| `sap.transport.user.list` | `manage_transport_requests`: list_system_users | `src/mcp/v1/analysis-tools.ts` | Strict action-free input + v1 success envelope | Contract + one-call adapter: `test/v1-analysis-tools.test.ts` |
| `sap.version.history.compare` | `get_version_history`: compare_versions | `src/mcp/v1/analysis-tools.ts` | Strict action-free input + v1 success envelope | Contract + one-call adapter: `test/v1-analysis-tools.test.ts` |
| `sap.version.history.list` | `get_version_history`: list_versions | `src/mcp/v1/analysis-tools.ts` | Strict action-free input + v1 success envelope | Contract + one-call adapter: `test/v1-analysis-tools.test.ts` |
| `sap.version.history.read` | `get_version_history`: get_version_source | `src/mcp/v1/analysis-tools.ts` | Strict action-free input + v1 success envelope | Contract + one-call adapter: `test/v1-analysis-tools.test.ts` |
| `sap.version.inactive.list` | `manage_abap_versions`: list_inactive | `src/mcp/v1/analysis-tools.ts` | Strict action-free input + v1 success envelope | Contract + one-call adapter: `test/v1-analysis-tools.test.ts` |
| `sap.version.inactive.read` | `manage_abap_versions`: get_inactive_source | `src/mcp/v1/analysis-tools.ts` | Strict action-free input + v1 success envelope | Contract + one-call adapter: `test/v1-analysis-tools.test.ts` |
| `sap.version.restore.preview` | `manage_abap_versions`: preview_restore | `src/mcp/v1/analysis-tools.ts` | Strict version/transport/activation preview input + v1 success envelope | Contract + one-call adapter: `test/v1-analysis-tools.test.ts` |

## Debug (10 targets; 10 callable)

| v1 target | v0 source capability | Current handler | Current input/output schema | Current test state |
| --- | --- | --- | --- | --- |
| `sap.debug.breakpoint.remove` | `abap_debug_breakpoint`: remove | `src/mcp/v1/debug-tools.ts` | Strict action-free input + v1 success envelope | Contract + one-call adapter: `test/v1-debug-tools.test.ts` |
| `sap.debug.breakpoint.set` | `abap_debug_breakpoint`: set | `src/mcp/v1/debug-tools.ts` | Strict action-free input + v1 success envelope | Contract + one-call adapter: `test/v1-debug-tools.test.ts` |
| `sap.debug.evaluate` | `abap_debug_variable`: expression evaluation | `src/mcp/v1/debug-tools.ts` | Strict action-free input + v1 success envelope | Contract + one-call adapter: `test/v1-debug-tools.test.ts` |
| `sap.debug.session.inspect` | `abap_debug_session`: status | `src/mcp/v1/debug-tools.ts` | Strict action-free input + v1 success envelope | Contract + one-call adapter: `test/v1-debug-tools.test.ts` |
| `sap.debug.session.start` | `abap_debug_session`: start | `src/mcp/v1/debug-tools.ts` | Strict action-free input + v1 success envelope | Contract + one-call adapter: `test/v1-debug-tools.test.ts` |
| `sap.debug.session.stop` | `abap_debug_session`: stop | `src/mcp/v1/debug-tools.ts` | Strict action-free input + v1 success envelope | Contract + one-call adapter: `test/v1-debug-tools.test.ts` |
| `sap.debug.stack` | `abap_debug_stack`: stack | `src/mcp/v1/debug-tools.ts` | Strict action-free input + v1 success envelope | Contract + one-call adapter: `test/v1-debug-tools.test.ts` |
| `sap.debug.status` | `abap_debug_status`: status | `src/mcp/v1/debug-tools.ts` | Strict action-free input + v1 success envelope | Contract + one-call adapter: `test/v1-debug-tools.test.ts` |
| `sap.debug.step` | `abap_debug_step`: continue, stepInto, stepOver, stepReturn, jumpToLine | `src/mcp/v1/debug-tools.ts` | Strict action-free input + v1 success envelope | Contract + one-call adapter: `test/v1-debug-tools.test.ts` |
| `sap.debug.variables` | `abap_debug_variable`: variables and scoped expansion | `src/mcp/v1/debug-tools.ts` | Strict action-free input + v1 success envelope | Contract + one-call adapter: `test/v1-debug-tools.test.ts` |

## Operations (24 targets; 24 callable)

| v1 target | v0 source capability | Current handler | Current input/output schema | Current test state |
| --- | --- | --- | --- | --- |
| `sap.execution.health` | `run_abap_application`: repl_health | `src/mcp/v1/operations-tools.ts` | Strict action-free input + v1 success envelope | Contract + one-call adapter: `test/v1-operations-tools.test.ts` |
| `sap.execution.preview` | `run_abap_application`: preview_class, preview_snippet | `src/mcp/v1/operations-tools.ts` | Strict action-free input + v1 success envelope | Contract + one-call adapter: `test/v1-operations-tools.test.ts` |
| `sap.ops.watch.history` | `manage_heartbeat`: history | `src/mcp/v1/operations-tools.ts` | Strict action-free input + v1 success envelope | Contract + one-call adapter: `test/v1-operations-tools.test.ts` |
| `sap.ops.watch.start` | `manage_heartbeat`: start | `src/mcp/v1/operations-tools.ts` | Strict action-free input + v1 success envelope | Contract + one-call adapter: `test/v1-operations-tools.test.ts` |
| `sap.ops.watch.status` | `manage_heartbeat`: status | `src/mcp/v1/operations-tools.ts` | Strict action-free input + v1 success envelope | Contract + one-call adapter: `test/v1-operations-tools.test.ts` |
| `sap.ops.watch.stop` | `manage_heartbeat`: stop | `src/mcp/v1/operations-tools.ts` | Strict action-free input + v1 success envelope | Contract + one-call adapter: `test/v1-operations-tools.test.ts` |
| `sap.ops.watch.task.add` | `manage_heartbeat`: add_task | `src/mcp/v1/operations-tools.ts` | Strict action-free input + v1 success envelope | Contract + one-call adapter: `test/v1-operations-tools.test.ts` |
| `sap.ops.watch.task.disable` | `manage_heartbeat`: disable_task | `src/mcp/v1/operations-tools.ts` | Strict action-free input + v1 success envelope | Contract + one-call adapter: `test/v1-operations-tools.test.ts` |
| `sap.ops.watch.task.enable` | `manage_heartbeat`: enable_task | `src/mcp/v1/operations-tools.ts` | Strict action-free input + v1 success envelope | Contract + one-call adapter: `test/v1-operations-tools.test.ts` |
| `sap.ops.watch.task.list` | `manage_heartbeat`: list_tasks | `src/mcp/v1/operations-tools.ts` | Strict action-free input + v1 success envelope | Contract + one-call adapter: `test/v1-operations-tools.test.ts` |
| `sap.ops.watch.task.remove` | `manage_heartbeat`: remove_task | `src/mcp/v1/operations-tools.ts` | Strict action-free input + v1 success envelope | Contract + one-call adapter: `test/v1-operations-tools.test.ts` |
| `sap.ops.watch.task.update` | `manage_heartbeat`: update_task | `src/mcp/v1/operations-tools.ts` | Strict action-free input + v1 success envelope | Contract + one-call adapter: `test/v1-operations-tools.test.ts` |
| `sap.ops.watch.trigger` | `manage_heartbeat`: trigger | `src/mcp/v1/operations-tools.ts` | Strict action-free input + v1 success envelope | Contract + one-call adapter: `test/v1-operations-tools.test.ts` |
| `sap.ops.watch.watchlist.read` | `manage_heartbeat`: get_watchlist | `src/mcp/v1/operations-tools.ts` | Strict action-free input + v1 success envelope | Contract + one-call adapter: `test/v1-operations-tools.test.ts` |
| `sap.runtime.dump.inspect` | `analyze_abap_dumps`: analyze_dump | `src/mcp/v1/operations-tools.ts` | Strict action-free input + v1 success envelope | Contract + one-call adapter: `test/v1-operations-tools.test.ts` |
| `sap.runtime.dump.list` | `analyze_abap_dumps`: list_dumps | `src/mcp/v1/operations-tools.ts` | Strict action-free input + v1 success envelope | Contract + one-call adapter: `test/v1-operations-tools.test.ts` |
| `sap.runtime.trace.configuration` | `analyze_abap_traces`: list_configurations | `src/mcp/v1/operations-tools.ts` | Strict action-free input + v1 success envelope | Contract + one-call adapter: `test/v1-operations-tools.test.ts` |
| `sap.runtime.trace.hit_list` | `analyze_abap_traces`: get_hitlist | `src/mcp/v1/operations-tools.ts` | Strict action-free input + v1 success envelope | Contract + one-call adapter: `test/v1-operations-tools.test.ts` |
| `sap.runtime.trace.inspect` | `analyze_abap_traces`: analyze_run | `src/mcp/v1/operations-tools.ts` | Strict action-free input + v1 success envelope | Contract + one-call adapter: `test/v1-operations-tools.test.ts` |
| `sap.runtime.trace.list` | `analyze_abap_traces`: list_runs | `src/mcp/v1/operations-tools.ts` | Strict action-free input + v1 success envelope | Contract + one-call adapter: `test/v1-operations-tools.test.ts` |
| `sap.runtime.trace.statements` | `analyze_abap_traces`: get_statements | `src/mcp/v1/operations-tools.ts` | Strict action-free input + v1 success envelope | Contract + one-call adapter: `test/v1-operations-tools.test.ts` |
| `sap.system.discovery` | `adt_discovery_export`: summary, full | `src/mcp/v1/operations-tools.ts` | Strict summary/full detail-level input + v1 success envelope | Contract + both variant calls: `test/v1-operations-tools.test.ts` |
| `sap.ui.transaction_launch` | `run_sap_transaction`: launch | `src/mcp/v1/operations-tools.ts` | Strict action-free input + v1 success envelope | Contract + one-call adapter: `test/v1-operations-tools.test.ts` |
| `sap.ui.transaction_url` | `run_sap_transaction`: url | `src/mcp/v1/operations-tools.ts` | Strict action-free input + v1 success envelope | Contract + one-call adapter: `test/v1-operations-tools.test.ts` |

## Artifacts (7 targets; 7 callable)

| v1 target | v0 source capability | Current handler | Current input/output schema | Current test state |
| --- | --- | --- | --- | --- |
| `sap.artifact.mermaid.create` | `create_mermaid_diagram`: artifact | `src/mcp/v1/artifact-tools.ts` | Strict action-free input + v1 success envelope | Contract + one-call adapter: `test/v1-artifact-tools.test.ts` |
| `sap.artifact.mermaid.detect` | `detect_mermaid_diagram_type`: detection | `src/mcp/v1/artifact-tools.ts` | Strict action-free input + v1 success envelope | Contract + one-call adapter: `test/v1-artifact-tools.test.ts` |
| `sap.artifact.mermaid.validate` | `validate_mermaid_syntax`: validation | `src/mcp/v1/artifact-tools.ts` | Strict action-free input + v1 success envelope | Contract + one-call adapter: `test/v1-artifact-tools.test.ts` |
| `sap.artifact.test_document.create` | `create_test_documentation`: artifact | `src/mcp/v1/artifact-tools.ts` | Strict action-free input + v1 success envelope | Contract + one-call adapter: `test/v1-artifact-tools.test.ts` |
| `sap.data.export` | `execute_data_query`: download_to_file | `src/mcp/v1/artifact-tools.ts` | Strict SQL, structured-data, or cached-view export input with sort/filter reset controls + v1 evidence envelope | Contract + cached-view call: `test/v1-artifact-tools.test.ts` |
| `sap.source.export` | `abap_download`: summary, includeFileList | `src/mcp/v1/artifact-tools.ts` | Strict action-free input + v1 success envelope | Contract + one-call adapter: `test/v1-artifact-tools.test.ts` |
| `sap.system.discovery.export` | `adt_discovery_export`: file | `src/mcp/v1/artifact-tools.ts` | Strict action-free input + v1 success envelope | Contract + one-call adapter: `test/v1-artifact-tools.test.ts` |

## Resources (7 planned; 7 implemented)

| Resource registry name | URI family | v0 parity source | Current implementation | Current test state |
| --- | --- | --- | --- | --- |
| `sap-adt-source` | `adt://{system}/{+adtPath}` | `get_object_by_uri`, complete source follow-up | `src/mcp/v1/resources.ts` | Contract + read + completion + lifecycle tests |
| `sap-capability-evidence` | `sap-capability://{system}` | `get_sap_capabilities` includeEvidence | `src/mcp/v1/resources.ts` | Contract + read + completion + lifecycle tests |
| `sap-docs-compat` | `sap-docs://compat/{document}` | `abap_fs_documentation` | `src/mcp/v1/resources.ts` | Discovery + canonical read: `test/v1-resources-complete.test.ts` |
| `sap-docs-data-query` | `sap-docs://data-query` | `get_abap_sql_syntax` | `src/mcp/v1/resources.ts` | Discovery + canonical read: `test/v1-resources-complete.test.ts` |
| `sap-docs-mermaid` | `sap-docs://mermaid/{document}` | `get_mermaid_documentation` | `src/mcp/v1/resources.ts` | Discovery + canonical read: `test/v1-resources-complete.test.ts` |
| `sap-evidence` | `sap-evidence://{runId}/{artifact}` | v0 deferred large-result follow-up and v1 evidence artifacts | `src/mcp/v1/resources.ts` | Tool-produced read: `test/v1-artifact-tools.test.ts`; redaction/isolation: `test/v1-resources-complete.test.ts` |
| `sap-transport` | `sap-transport://{system}/{transport}` | transport detail/object/assessment follow-up | `src/mcp/v1/resources.ts` | Discovery + canonical read: `test/v1-resources-complete.test.ts` |

## Completion rule

A Tool row becomes complete only after all of the following are true:

1. the actual MCP registrar advertises the target in its assigned toolset;
2. the target has a strict input schema with no inherited v0 action union;
3. the target publishes a v1 output envelope schema;
4. a valid call reaches the intended shared `AbapToolService` method exactly once;
5. success text equals `structuredContent`, and failures use the v1 error envelope;
6. focused v1 contract tests and the complete v0 regression suite pass.

A Resource row becomes complete only after discovery, canonical URI validation,
read behavior, toolset ownership, redaction, and lifecycle tests pass.

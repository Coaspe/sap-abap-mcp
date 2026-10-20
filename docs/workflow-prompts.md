# Native workflow prompts

Native prompts are included in 2.0.0. Configure your MCP host to run:

```sh
npx -y @coaspe/sap-abap-mcp@2.0.1 serve --profile DEV100 --preset development
```

`serve` speaks MCP over stdio; it is intended to be started by your MCP host,
not used as an interactive shell. Point a local MCP server configuration at
`node` with the absolute path to this checkout's `dist/src/index.js`, followed
by `serve`, `--profile`, and your configured profile ID. Reconnect the host
after rebuilding. No client settings are changed by building.

## Select a workflow

| Name | Required arguments | Goal |
|---|---|---|
| `sap-explain-object` | `systemId`, object name as `target` | Read source and callers; explain with line references |
| `sap-change-object` | `systemId`, object name as `target` | Describe desired behavior in `goal`; inspect, patch, diagnose, activate, test |
| `sap-review-transport` | `systemId`, transport number as `target` | Assess existing quality evidence without release |
| `sap-plan-rap` | `systemId`, reference object name as `target` | Supply package and service intent in `goal`; validate and preview only |

All prompts accept an optional `goal` of up to 4,000 characters. Text can be
Korean or any preferred language. System IDs and targets must be nonblank.
The host chooses how to display MCP prompts; a slash-command UI is not required
by this server, and hosts without prompt support can still call the same tools.

Example MCP `prompts/get` parameters:

```json
{
  "name": "sap-explain-object",
  "arguments": {
    "systemId": "DEV100",
    "target": "ZCL_DEMO",
    "goal": "입력값 검증과 예외 처리 흐름을 소스 줄 번호와 함께 설명해 줘"
  }
}
```

The response is a workflow instruction. It does not connect to SAP, edit source,
run tests, or approve a mutation. The host follows the instructions using tools
under the existing server policies and the user's authorization.

## Availability

| Selection | Prompts |
|---|---|
| Default CLI / `--preset adaptive` | All four, using on-demand schemas |
| `--toolsets all` | All four, using direct tools |
| `--preset compact` | Explain object |
| `--preset development` | Explain object; change object |
| `--preset assurance` | Review transport |
| `--api-version v0` | None |

Custom toolsets expose a workflow only if every tool it needs is selected.
Adaptive mode keeps all capabilities reachable and includes instructions for
describing and invoking deferred capabilities. See [adaptive mode](adaptive-mode.md).
Viewer sessions exclude the change workflow; developer/admin sessions still
respect tool selection. No workflow requires transport release, Git push or
service publication privileges.

## Dependency graph coverage

Both `get_abap_dependency_graph` and `sap.repository.dependency_graph` retain
their input contracts and existing graph fields. The result adds:

```json
{
  "coverage": {
    "direction": "where_used",
    "expandedNodes": 1,
    "depthLimited": true,
    "nodeLimited": false
  }
}
```

Edges point from a caller to the object it uses. `expandedNodes` counts ADT
where-used requests, excluding the initial object resolution/source read.
An object is scheduled once even when references contain several URI fragments
or form a cycle. These requests are bounded by `maxNodes`.

`truncated` keeps its existing meaning: objects were omitted at the node limit.
`depthLimited` identifies expandable retained objects not explored at the chosen
depth. Neither a false `truncated` value nor false coverage flags prove a complete
runtime call graph: SAP permissions, static reference availability, dynamic calls
and `customOnly` filtering still constrain the result. `customOnly` excludes
standard nodes from traversal; it does not traverse through them to find custom
callers farther upstream.

## Verification

```sh
npm test
npm run smoke:v1
npm run conformance:v1
```

The tests validate protocol discovery/retrieval, input bounds, preset and role
selection, absence of SAP calls during prompt retrieval, and graph traversal
against deterministic test doubles. They do not measure an agent's real-world
workflow success rate or establish SAP-release compatibility.

## Existing-object change acceptance (candidate)

The candidate strengthens the existing explain/change prompts; it adds no MCP
tool. Before a change, retain returned client/system identity and source revision
or content hash. A configured alias is not an independently verified SAP SID.
Resolve relevant includes/methods, DDIC and public types and direct callers;
explicitly record dynamic calls, denied reads and remaining pages/truncation.
Present the smallest patch preview and validation plan within the authorized scope.

The runtime acquires the existing ADT lock and rechecks active source and inactive
state before saving a patch. A different inactive version is a conflict, even if
active source is unchanged. Reconcile it with the owner; do not activate it or
retry the same patch. A missing inactive resource is distinguished from a denied
or failed inactive read, which prevents a write.

Multi-object quick fixes cannot provide a database-style atomic transaction.
After a failed or lost write response they retain completed changes and report
applied, uncertain and unattempted objects, without automatic rollback. Read back
active/inactive state before resuming; do not repeat an already saved write.

Keep diagnose, activate, ABAP Unit and ATC outcomes separate. A successful syntax
check is not business acceptance; zero tests, skipped/unsupported checks or partial
findings are not passes. The handoff order is diff, actual validation, uncertainty,
and one next action. Current regressions are local fixtures, not live T3 success.

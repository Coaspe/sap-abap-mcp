# Live SAP acceptance for development parity

This procedure is opt-in. Run it only in a disposable development client and never in production, a shared package, or a shared transport. The automated test suite uses in-memory SAP doubles and does not run these mutations against a live system.

## Disposable fixture

Use all of the following controls together:

- Connection: `DEV100`, configured as `development`.
- Allowed package: only `Z_MCP_ACCEPTANCE`.
- Dedicated transport: `DEVK900999` is a placeholder; replace it with a new, open transport created only for this acceptance run.
- Repository objects: root CDS data definition `ZI_MCP_ACCEPTANCE`, behavior definition `ZI_MCP_ACCEPTANCE`, and classes `ZCL_MCP_ACTIVATE_A`, `ZCL_MCP_ACTIVATE_B`, and `ZCL_MCP_RUNNER`.
- Source: use root CDS and behavior-definition source that was prepared and syntax-checked for the exact SAP release. Do not invent or adapt RAP syntax during acceptance.
- Optional snippet prerequisite: class `ZCL_ABAP_REPL` and an active SICF service at `/sap/bc/z_abap_repl`.

`get_sap_system_info.environment` is the configured MCP profile environment, not an independently detected SAP production flag. Stop before any mutation when the returned `environment` is `production`, when the resolved package is not `Z_MCP_ACCEPTANCE`, or when the transport contains unrelated objects.

Use this exact class-runner fixture source for `ZCL_MCP_RUNNER`:

```abap
CLASS zcl_mcp_runner DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_oo_adt_classrun.
ENDCLASS.

CLASS zcl_mcp_runner IMPLEMENTATION.
  METHOD if_oo_adt_classrun~main.
    out->write( `MCP_CLASS_RUNNER_OK` ).
  ENDMETHOD.
ENDCLASS.
```

## Evidence record

Store one sanitized record per step using exactly these fields:

```json
{
  "connection": "DEV100",
  "sapRelease": "<SAP_RELEASE>",
  "capability": "<CAPABILITY_ID>",
  "status": "<supported|unsupported|unverified>",
  "timestamp": "<ISO-8601_TIMESTAMP>",
  "sanitizedResult": {}
}
```

Remove SAP users, host names, cookies, authorization values, tokens, CSRF values, and session identifiers from `sanitizedResult`. Capability observations are held in process memory and belong to the selected connection, so capture evidence in the same server process in which the operation ran. Choose `supported` only after the relevant operation succeeds and a fresh `get_sap_capabilities` read for the same connection reports `supported`. Otherwise record the observed `unverified` or `unsupported` status.

## 1. Establish the system and capability baseline

Use this arguments object for `get_sap_system_info`:

```json
{
  "connectionId": "DEV100",
  "includeComponents": false
}
```

Confirm the expected development profile environment, client, and SAP release. Then use this arguments object for `get_sap_capabilities`:

```json
{
  "connectionId": "DEV100",
  "includeEvidence": true
}
```

Newly implemented SAP-dependent capabilities must be treated as `unverified` unless this same selected connection already has a successful process-memory observation. Discovery metadata alone is not live execution proof.

## 2. Create and activate the behavior definition

Use the pre-recorded, release-valid behavior source in place of the placeholder. Use the actual dedicated transport in place of `DEVK900999`. The following JSON is the arguments object for `create_object_programmatically`.

```json
{
  "objectType": "BDEF/BDO",
  "name": "ZI_MCP_ACCEPTANCE",
  "description": "MCP live acceptance behavior definition",
  "packageName": "Z_MCP_ACCEPTANCE",
  "connectionId": "DEV100",
  "source": "<PRE-RECORDED_RELEASE-VALID-BDEF-SOURCE>",
  "activate": true,
  "additionalOptions": {
    "transportRequest": {
      "type": "existing",
      "number": "DEVK900999"
    }
  }
}
```

Accept the operation result only if the returned repository object type is `BDEF/BDO`, diagnostics contain no errors, and activation succeeds. Then re-run `get_sap_capabilities` with `includeEvidence: true` for `DEV100`; accept capability support only when that fresh read reports `repository.create.bdef` as `supported`. A created object followed by a source or activation failure is not a pass; preserve the returned manual-cleanup details.

## 3. Activate two objects in one SAP request

Add a harmless inactive comment to each of `ZCL_MCP_ACTIVATE_A` and `ZCL_MCP_ACTIVATE_B`, without changing behavior. Confirm both inactive versions belong to the dedicated transport. The JSON below is the arguments object for `abap_activate`; call it once.

```json
{
  "connectionId": "DEV100",
  "urls": [
    "adt://dev100/sap/bc/adt/oo/classes/zcl_mcp_activate_a/source/main",
    "adt://dev100/sap/bc/adt/oo/classes/zcl_mcp_activate_b/source/main"
  ]
}
```

Accept the operation result only when `status` is `complete` and both object outcomes are `activated`. Then re-run `get_sap_capabilities` with `includeEvidence: true` for `DEV100`; accept capability support only when that fresh read reports `repository.activate.batch` as `supported`. Preserve all returned activation messages in the sanitized evidence. A partial or ambiguous result is not a pass.

## 4. Run the class fixture with one-use confirmation

Both JSON blocks in this step are arguments for `run_abap_application`. Preview the class execution:

```json
{
  "action": "preview_class",
  "connectionId": "DEV100",
  "className": "ZCL_MCP_RUNNER"
}
```

Copy the fresh response values into the execute request without editing them:

```json
{
  "action": "execute",
  "connectionId": "DEV100",
  "planId": "<PLAN_ID_FROM_PREVIEW>",
  "confirmation": "<EXACT_CONFIRMATION_FROM_PREVIEW>"
}
```

Accept the execution result only when output contains `MCP_CLASS_RUNNER_OK`. The execute response's `capabilityStatusAtExecution` is the pre-call status and may be `unverified` on the first successful call. After that success, call `get_sap_capabilities` with `includeEvidence: true` for `DEV100` and require the fresh result to report `execution.class_runner` as `supported`. Then send the identical execute request a second time and require it to fail because the plan was already consumed. Never create a second preview merely to make that replay check pass.

## 5. Check and run the fixed ABAP REPL contract

All three JSON blocks in this step are arguments for `run_abap_application`. Call the health action first:

```json
{
  "action": "repl_health",
  "connectionId": "DEV100"
}
```

Continue only when the response shape is valid and `health.production` is `false`. Preview this exact snippet:

```json
{
  "action": "preview_snippet",
  "connectionId": "DEV100",
  "code": "WRITE / 'MCP_REPL_OK'."
}
```

Execute it with the fresh values returned by that preview:

```json
{
  "action": "execute",
  "connectionId": "DEV100",
  "planId": "<PLAN_ID_FROM_PREVIEW>",
  "confirmation": "<EXACT_CONFIRMATION_FROM_PREVIEW>"
}
```

Accept the execution result only when `success` is `true`, `error` is empty, and output contains `MCP_REPL_OK`. Because this workflow first completes `repl_health` and execute performs another successful health check before the POST, a successful execute should report `capabilityStatusAtExecution` as `supported`. After that success, call `get_sap_capabilities` with `includeEvidence: true` for `DEV100` and require the fresh result to report `execution.abap_repl` as `supported`; this fresh `get_sap_capabilities` read remains the authoritative recorded evidence. The adapter uses only `/sap/bc/z_abap_repl`; do not substitute or probe fallback routes. Separately verify from the configured MCP profile and the recorded health response that a production profile, or a response with `health.production` equal to `true`, is blocked before any snippet POST. Do not change a live system to production to test this guard.

## 6. Inspect detailed semantic information

Use the active source of `ZCL_MCP_RUNNER`. All four JSON blocks in this step are arguments for `inspect_abap_code` and issue bounded reads:

```json
{
  "action": "completion_element",
  "fileUri": "adt://dev100/sap/bc/adt/oo/classes/zcl_mcp_runner/source/main",
  "connectionId": "DEV100",
  "line": 8,
  "column": 9,
  "startIndex": 0,
  "maxResults": 20
}
```

```json
{
  "action": "documentation",
  "fileUri": "adt://dev100/sap/bc/adt/oo/classes/zcl_mcp_runner/source/main",
  "connectionId": "DEV100",
  "line": 8,
  "column": 9,
  "startIndex": 0,
  "maxResults": 20
}
```

```json
{
  "action": "type_hierarchy",
  "fileUri": "adt://dev100/sap/bc/adt/oo/classes/zcl_mcp_runner/source/main",
  "connectionId": "DEV100",
  "line": 1,
  "column": 6,
  "superTypes": true,
  "startIndex": 0,
  "maxResults": 20
}
```

```json
{
  "action": "components",
  "fileUri": "adt://dev100/sap/bc/adt/oo/classes/zcl_mcp_runner/source/main",
  "connectionId": "DEV100",
  "line": 1,
  "column": 6,
  "startIndex": 0,
  "maxResults": 20
}
```

Accept the corresponding results only when completion and documentation use their non-fallback detailed formats, hierarchy output is bounded, and component output is structured. Re-run `get_sap_capabilities` with `includeEvidence: true` and record the statuses for all four semantic capability IDs. An empty, fallback, malformed, or unbounded response does not prove support.

## 7. Clean up only the disposable fixture

Before each deletion, re-check that the object is one of the exact named fixture objects, resolves to package `Z_MCP_ACCEPTANCE`, and is recorded in the dedicated transport without unrelated objects. Both JSON blocks below are arguments for `refactor_abap_code`. For every object handled by this tool, obtain a fresh `preview_delete` plan and execute only its exact returned confirmation:

```json
{
  "action": "preview_delete",
  "fileUri": "adt://dev100/<EXACT_DISPOSABLE_OBJECT_SOURCE_URI>",
  "connectionId": "DEV100",
  "transport": "DEVK900999"
}
```

```json
{
  "action": "execute",
  "planId": "<PLAN_ID_FROM_PREVIEW>",
  "confirmation": "<EXACT_CONFIRMATION_FROM_PREVIEW>"
}
```

Delete the three classes first. Use a separate fresh preview and confirmation for `ZCL_MCP_ACTIVATE_A`, `ZCL_MCP_ACTIVATE_B`, and `ZCL_MCP_RUNNER`.

Next, delete the `BDEF/BDO` behavior definition `ZI_MCP_ACCEPTANCE` through the release-appropriate manual ADT path before deleting its dependent data definition. Record the exact repository type, name, and result. Do not auto-delete it through an unverified generic path.

Only after the behavior definition is gone, delete the `DDLS` data definition `ZI_MCP_ACCEPTANCE` with a fresh `refactor_abap_code` preview and exact confirmation. The `DDLS` data definition and `BDEF/BDO` behavior definition share a logical name but are distinct repository object types; verify the type before every action.

Reinspect the dedicated transport at the end. Require it to contain only the fixture's creation and deletion entries and no unrelated objects, then record its final disposition. If SAP reports that it is empty and safely deletable, delete it through the confirmed transport workflow. If cleanup or deletion entries must be transported, retain or release it only through the transport owner's approved process. Never leave the transport in an unknown state, and never delete changes still needed for cleanup or transport. This acceptance cannot pass until the final transport state is recorded.

Pass this acceptance only when every required step has sanitized evidence and every disposable repository object is accounted for during cleanup. A missing prerequisite, authorization failure, absent endpoint, unexpected response shape, incomplete cleanup, or unrecorded transport disposition leaves the relevant capability `unverified` or `unsupported`; it must never be reported as live-supported.

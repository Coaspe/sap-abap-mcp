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

Stop before any mutation if SAP reports a production system, if the resolved package is not `Z_MCP_ACCEPTANCE`, or if the transport contains unrelated objects.

Use this exact class-runner fixture source for `ZCL_MCP_RUNNER`:

```abap
CLASS zcl_mcp_runner DEFINITION
  PUBLIC
  FINAL
  CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_oo_adt_classrun.
ENDCLASS.

CLASS zcl_mcp_runner IMPLEMENTATION.
  METHOD if_oo_adt_classrun~main.
    out->write( 'MCP_CLASSRUN_OK' ).
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
  "status": "supported",
  "timestamp": "<ISO-8601_TIMESTAMP>",
  "sanitizedResult": {}
}
```

Remove SAP users, host names, cookies, authorization values, tokens, CSRF values, and session identifiers from `sanitizedResult`. Capability observations are held in process memory and belong to the selected connection, so capture evidence in the same server process in which the operation ran.

## 1. Establish the system and capability baseline

Call `get_sap_system_info`:

```json
{
  "connectionId": "DEV100",
  "includeComponents": false
}
```

Confirm the expected development system, client, and SAP release. Then call `get_sap_capabilities`:

```json
{
  "connectionId": "DEV100",
  "includeEvidence": true
}
```

Newly implemented SAP-dependent capabilities must be treated as `unverified` unless this same selected connection already has a successful process-memory observation. Discovery metadata alone is not live execution proof.

## 2. Create and activate the behavior definition

Use the pre-recorded, release-valid behavior source in place of the placeholder. Use the actual dedicated transport in place of `DEVK900999`.

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

Accept this step only if the returned repository object type is `BDEF/BDO`, diagnostics contain no errors, activation succeeds, and `repository.create.bdef` becomes `supported` for `DEV100`. A created object followed by a source or activation failure is not a pass; preserve the returned manual-cleanup details.

## 3. Activate two objects in one SAP request

Add a harmless inactive comment to each of `ZCL_MCP_ACTIVATE_A` and `ZCL_MCP_ACTIVATE_B`, without changing behavior. Confirm both inactive versions belong to the dedicated transport, then call `abap_activate` once:

```json
{
  "connectionId": "DEV100",
  "urls": [
    "adt://dev100/sap/bc/adt/oo/classes/zcl_mcp_activate_a/source/main",
    "adt://dev100/sap/bc/adt/oo/classes/zcl_mcp_activate_b/source/main"
  ]
}
```

Accept this step only when `status` is `complete`, both object outcomes are `activated`, and `repository.activate.batch` becomes `supported`. Preserve all returned activation messages in the sanitized evidence. A partial or ambiguous result is not a pass.

## 4. Run the class fixture with one-use confirmation

Preview the class execution:

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

Accept only output containing `MCP_CLASSRUN_OK` and a `supported` observation for `execution.class_runner`. Send the identical execute request a second time and require it to fail because the plan was already consumed. Never create a second preview merely to make that replay check pass.

## 5. Check and run the fixed ABAP REPL contract

Call the health action first:

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

Accept only output containing `MCP_REPL_OK` and a `supported` observation for `execution.abap_repl`. The adapter uses only `/sap/bc/z_abap_repl`; do not substitute or probe fallback routes. Separately verify from configuration and the recorded health response that a production profile, or a response with `health.production` equal to `true`, is blocked before any snippet POST. Do not change a live system to production to test this guard.

## 6. Inspect detailed semantic information

Use the active source of `ZCL_MCP_RUNNER` and issue these four bounded reads:

```json
{
  "action": "completion_element",
  "fileUri": "adt://dev100/sap/bc/adt/oo/classes/zcl_mcp_runner/source/main",
  "connectionId": "DEV100",
  "line": 11,
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
  "line": 11,
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
  "column": 0,
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
  "column": 0,
  "startIndex": 0,
  "maxResults": 20
}
```

Accept the corresponding results only when completion and documentation use their non-fallback detailed formats, hierarchy output is bounded, and component output is structured. Re-run `get_sap_capabilities` with `includeEvidence: true` and record the statuses for all four semantic capability IDs. An empty, fallback, malformed, or unbounded response does not prove support.

## 7. Clean up only the disposable fixture

Before each deletion, re-check that the object resolves to `Z_MCP_ACCEPTANCE` and that the dedicated transport contains no unrelated object. For each deletable class and the root CDS data definition, obtain a fresh `preview_delete` plan, then execute only its exact returned confirmation:

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

Use a separate fresh preview for `ZCL_MCP_ACTIVATE_A`, `ZCL_MCP_ACTIVATE_B`, `ZCL_MCP_RUNNER`, and the `DDLS` data definition `ZI_MCP_ACCEPTANCE`. The `DDLS` data definition and `BDEF/BDO` behavior definition share the logical name `ZI_MCP_ACCEPTANCE` but are distinct repository object types; verify the type before every action. Clean up the `BDEF/BDO` object through the release-appropriate manual ADT path and record the result. Do not auto-delete it through an unverified generic path.

Pass this acceptance only when every required step has sanitized evidence and every disposable repository object is accounted for during cleanup. A missing prerequisite, authorization failure, absent endpoint, unexpected response shape, or incomplete cleanup leaves the relevant capability `unverified` or `unsupported`; it must never be reported as live-supported.

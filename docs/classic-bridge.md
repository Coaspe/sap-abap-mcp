# Optional classic-object bridge

SAP ABAP MCP uses ADT directly for its normal repository, quality, transport,
runtime, and debugging capabilities. Some classic repository documents are not
available through the public ADT endpoints used by this project. An optional,
same-origin bridge adds bounded Screen/Dynpro and full GUI Status access without
changing the default ADT session or storing another SAP credential.

## Support boundary

- The SAP system must already support the ADT login used by SAP ABAP MCP.
- The bridge path must be a relative `/sap/...` path on the configured SAP host.
  Absolute URLs and cross-origin bridges are rejected.
- The feature is opt-in per profile. Profiles without `classicBridgePath` do
  not advertise a usable classic backend and fail closed when called.
- The bridge extends ADT for selected classic objects. It is not a complete
  backend for systems that have no ADT service.
- ABAP Cloud systems generally do not permit these classic repository objects;
  use the bridge only on an on-premise or private-cloud development system
  where the objects and authorizations exist.

## Install a compatible bridge

The protocol is compatible with the MIT-licensed reference implementation in
`babamba2/abap-mcp-adt-powerup`:

- [`ZMCP_ADT_DISPATCH`](https://github.com/babamba2/abap-mcp-adt-powerup/blob/main/abap/zmcp_adt_dispatch.abap)
- [`ZCL_MCP_RFC_HTTP_HANDLER`](https://github.com/babamba2/abap-mcp-adt-powerup/blob/main/abap/zcl_mcp_rfc_http_handler.abap)

Review those ABAP sources under your organization's supply-chain and transport
policy, install them in a development package, and activate an ICF service such
as `/sap/bc/rest/zmcp_rfc` for the HTTP handler. The upstream source remains
under its own MIT copyright notice; it is linked rather than copied into this
package.

Configure the relative ICF path on the profile:

```bash
sap-abap-mcp profile add DEV100 \
  --url https://sap.example.test \
  --client 100 \
  --username DEVELOPER \
  --classic-bridge-path /sap/bc/rest/zmcp_rfc \
  --login
```

The setup wizard remains suitable for ordinary ADT-only profiles. Add or edit a
bridge-enabled profile through the CLI so the path is explicit and reviewable.

## MCP workflow

`sap.classic.read` supports:

- `screen`: read one program/screen number as a structured document.
- `gui_status`: read the complete GUI Status document for one program.

`sap.classic.write` supports:

- `screen_upsert`: create or replace one Screen/Dynpro document.
- `screen_delete`: delete one exact Screen/Dynpro.
- `gui_status_upsert`: replace the complete GUI Status document.

Every write requires the exact confirmation value returned by its preview. The
normal production-profile, allowed-package, transport, audit, and role policies
still apply. Before dispatching a write, the program is added to the selected
transport through ADT. The bridge request then reuses the existing SAP session
and CSRF token; no password, OAuth token, or second base URL is sent in the MCP
arguments.

## Operational checks

1. Verify the profile with `sap-abap-mcp auth status DEV100` and a normal
   `sap.system.inspect` call.
2. Read a disposable development object with `sap.classic.read`.
3. Exercise writes only on a run-owned object and disposable transport.
4. Remove or disable the ICF service when the compatibility bridge is no longer
   required.

Endpoint availability, the bridge implementation, SAP authorizations, and
classic-object semantics remain live-SAP verification boundaries.

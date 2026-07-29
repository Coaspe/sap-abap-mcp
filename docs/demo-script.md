# SAP ABAP MCP 90-second workflow

The README animation is a synthetic walkthrough. It contains no real hostname,
credential, ABAP source, business data, or transport. The same workflow can be
run from Codex, Claude, or another local MCP host after a profile passes
`doctor`.

## 1. Configure and verify a development system

```text
$ npx @coaspe/sap-abap-mcp@latest setup
Server name: DEV100
SAP URL: https://sap.example.invalid
SAP client: 100
SAP username: DEMO_USER
SAP password: ********

✓ DEV100 verified through SAP ADT
✓ password protected by the operating-system secret store
```

The `.invalid` domain is reserved for documentation and is not a real SAP
system.

## 2. Inspect an ABAP object

```text
> In DEV100, find ZCL_MCP_DEMO, read it, and explain its dependencies.

✓ sap.repository.search       1 class
✓ sap.source.read             86 lines
✓ sap.repository.dependency_graph
  ZCL_MCP_DEMO → ZIF_MCP_DEMO → ZCL_MCP_STORE
```

## 3. Run quality checks

```text
> Run ABAP Unit and ATC for ZCL_MCP_DEMO. Do not change the object.

✓ sap.quality.unit_test       4 passed, 0 failed
✓ sap.quality.atc.run         0 findings
```

## 4. Assess a transport without releasing it

```text
> Assess DEVK900123 and create CI evidence. Do not release it.

✓ sap.transport.assess
  gate: passed
  evidence: JSON · SARIF 2.1.0 · JUnit XML
  released: false
```

`sap.transport.assess` is read-only. Releasing a transport is a separate tool
with a separate explicit confirmation.

## Safety boundary

- Use development or quality systems for evaluation.
- Production profiles are read-only.
- Package allowlists can narrow permitted writes.
- Live SAP support is recorded only after the exact operation succeeds on the
  selected connection.
- Never paste credentials, proprietary source, hostnames, or business data
  into public issues or discussions.

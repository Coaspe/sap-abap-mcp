---
name: sap-abap-setup
description: Configure, re-authenticate, and verify a local SAP ABAP MCP profile. Use when no SAP connection is configured, credentials are missing or expired, or the user asks to set up or repair SAP connectivity.
---

# SAP ABAP MCP setup

1. Detect Windows, macOS, or Linux. Use `npx.cmd` on Windows and `npx` on macOS or Linux. Emit setup commands on one line so shell continuation syntax is unnecessary.
2. Run `<npx> --yes --prefer-online @coaspe/sap-abap-mcp@latest profile list` before changing anything.
3. If profiles exist, ask the user to choose one explicitly and run `<npx> --yes --prefer-online @coaspe/sap-abap-mcp@latest auth status <id>`. Do not overwrite the profile unless the user asks to change its non-secret settings. If credentials are missing or expired, re-authenticate only that profile.
4. If a profile must be created or updated, collect its ID, SAP base URL, client, language, environment classification, username, and optional package allowlist. Never ask for a password or token in chat.
5. Confirm the non-secret values with the user, then run:

   ```text
   <npx> --yes --prefer-online @coaspe/sap-abap-mcp@latest profile add <id> --url <url> --client <client> --language <language> --environment <development|quality|production> --username <username> [--packages <packages>]
   ```

## Authenticate on Windows or macOS

Ask the user to run this command themselves in a trusted terminal:

```text
<npx> --yes --prefer-online @coaspe/sap-abap-mcp@latest auth login <id> --username <username>
```

Tell the user to enter the password only at the hidden `SAP password:` prompt. Do not add `--password-stdin` unless the user already has a secure pipe that supplies standard input. Wait for the user to confirm completion; never proxy, log, or repeat the secret. Windows stores it with DPAPI and macOS stores it in Keychain.

## Authenticate on Linux

Linux reads `SAP_ABAP_MCP_PASSWORD_<NORMALIZED_ID>` and does not persist the password. Convert the profile ID to uppercase and replace each non-alphanumeric character with `_`; for example, `DEV-100` becomes `SAP_ABAP_MCP_PASSWORD_DEV_100`.

Ask the user to set the variable with a hidden shell prompt and restart Claude Code from the same shell so the plugin process inherits it:

```bash
read -rsp "SAP password: " SAP_ABAP_MCP_PASSWORD_DEV100; echo; export SAP_ABAP_MCP_PASSWORD_DEV100; claude
```

Replace `DEV100` with the normalized profile ID. Do not ask the user to paste the variable value into chat or write it to the profile file.

## Verify and use

1. Run `<npx> --yes --prefer-online @coaspe/sap-abap-mcp@latest auth status <id>`.
2. Run `<npx> --yes --prefer-online @coaspe/sap-abap-mcp@latest doctor <id> --include-components` and require a successful ADT result.
3. Call `get_connected_systems` and confirm the verified profile appears. `/mcp` showing the plugin server as connected proves only that the local MCP process started, not that SAP authentication succeeded.
4. Use the verified profile ID as `connectionId` on every SAP-facing tool call. Never infer a profile or silently switch systems.
5. Treat SAP-dependent capabilities as unverified until the selected live connection returns successful evidence. Preserve production write blocking, package allowlists, transport requirements, and mutation confirmation plans.

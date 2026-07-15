---
name: sap-abap-setup
description: Configure, authenticate, and verify a local SAP ABAP MCP profile before using SAP development tools.
---

# SAP ABAP MCP setup

Use this workflow when no SAP connection is configured, authentication has expired, or the user asks to set up SAP ABAP MCP.

1. Determine whether the user is on Windows or macOS. Use `npx.cmd` on Windows and `npx` on macOS.
2. Collect the profile ID, SAP base URL, client, language, environment classification, username, and optional package allowlist. Never ask the user to paste a password into chat.
3. Add the profile without placing a password in command history:

   ```text
   <npx> --yes --prefer-online @coaspe/sap-abap-mcp@latest profile add <id> --url <url> --client <client> --language <language> --environment <development|quality|production> --username <username> [--packages <packages>]
   ```

4. Ask the user to run the following command themselves in a trusted terminal and provide the password through standard input:

   ```text
   <npx> --yes --prefer-online @coaspe/sap-abap-mcp@latest auth login <id> --username <username> --password-stdin
   ```

5. Verify ADT connectivity:

   ```text
   <npx> --yes --prefer-online @coaspe/sap-abap-mcp@latest doctor <id> --include-components
   ```

6. Use the verified profile ID as `connectionId` on every SAP-facing MCP tool call. Do not infer a connection ID or silently switch systems.
7. Treat SAP-dependent capabilities as unverified until the selected live connection returns successful evidence. Preserve production write blocking, package allowlists, transport requirements, and mutation confirmation plans.

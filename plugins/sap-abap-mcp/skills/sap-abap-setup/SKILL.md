---
name: sap-abap-setup
description: Configure, re-authenticate, and verify a local SAP ABAP MCP profile. Use when no SAP connection is configured, credentials are missing or expired, or the user asks to set up or repair SAP connectivity.
---

# SAP ABAP MCP setup

1. Detect Windows, macOS, or Linux. Use `npx.cmd` on Windows and `npx` on macOS or Linux.
2. Tell the user to run this one-line command in a trusted terminal:

   ```text
   <npx> @coaspe/sap-abap-mcp@latest setup
   ```

3. Explain that the wizard can create a new server or update an existing one. It labels the local connection alias as `Server name` and the endpoint as `SAP URL`. The Server name becomes the `connectionId` used by SAP tools.
4. When the user asks to change or delete a saved server, direct them to the matching local command. The Server name may be omitted to choose from a list:

   ```text
   <npx> @coaspe/sap-abap-mcp@latest setup edit [<server-name>]
   <npx> @coaspe/sap-abap-mcp@latest setup remove [<server-name>]
   ```

5. Explain that edit keeps the Server name fixed. Windows and macOS verify SAP before saving; Linux verifies when the matching password environment variable is available and otherwise prints the authentication steps again. Remove shows the selected server, defaults to `No`, and deletes the saved SAP and abapGit credentials only after confirmation.
6. Never ask for a password or token in chat, append it to the command, or proxy the hidden prompt. The user must enter it only at the wizard's local `SAP password:` prompt.
7. Wait for the user to confirm that the wizard finished. Then run `<npx> --yes --prefer-online @coaspe/sap-abap-mcp@latest profile list`, and have the user select the exact Server name if more than one exists. Never infer or silently switch servers.

## Windows and macOS

The wizard collects non-secret settings, shows a summary, requests the password through a hidden terminal prompt, verifies the SAP URL and credentials, and only then saves the server. Windows stores the password with DPAPI and macOS stores it in Keychain.

## Authenticate on Linux

Linux reads `SAP_ABAP_MCP_PASSWORD_<NORMALIZED_SERVER_NAME>` and does not persist the password. The wizard saves only non-secret settings and prints the exact variable name, hidden input command, export command, and `doctor` command. For example, Server name `DEV-100` uses `SAP_ABAP_MCP_PASSWORD_DEV_100`.

Ask the user to run the printed commands and restart Claude Code from the same shell so the plugin process inherits the variable. The equivalent pattern is:

```bash
read -rsp "SAP password: " SAP_ABAP_MCP_PASSWORD_DEV100; echo; export SAP_ABAP_MCP_PASSWORD_DEV100; claude
```

Replace `DEV100` with the normalized Server name. Do not ask the user to paste the variable value into chat or write it to the profile file.

## OAuth client credentials

The interactive wizard manages Basic Auth profiles. When the user explicitly requests OAuth client credentials, do not route that profile through the wizard. Tell the user to run the explicit local CLI command with their real non-secret values:

```text
<npx> @coaspe/sap-abap-mcp@latest profile add <server-name> --url <sap-url> --client <nnn> --auth-type oauth-client-credentials --token-url <token-url> --client-id <client-id> [--scope <scope>] --login
```

The hidden prompt collects the OAuth client secret on Windows or macOS. Never request the secret in chat or append it to the command. On Linux, omit `--login`, set the profile-specific `SAP_ABAP_MCP_PASSWORD_<NORMALIZED_SERVER_NAME>` variable to the client secret in the trusted launch shell, and restart the MCP client from that environment. The legacy variable name contains `PASSWORD` for backward compatibility.

OAuth does not parse a BTP service-key JSON document and does not implement browser SSO, MFA, certificates, Kerberos, or static bearer profiles. Require `doctor` to succeed before treating the selected profile as authenticated.

## Verify and use

1. Run `<npx> --yes --prefer-online @coaspe/sap-abap-mcp@latest auth status <server-name>`.
2. Run `<npx> --yes --prefer-online @coaspe/sap-abap-mcp@latest doctor <server-name> --include-components` and require a successful ADT result.
3. Call `get_connected_systems` and confirm the verified profile appears. `/mcp` showing the plugin server as connected proves only that the local MCP process started, not that SAP authentication succeeded.
4. Use the verified Server name as `connectionId` on every SAP-facing tool call. Never infer a server or silently switch systems.
5. Treat SAP-dependent capabilities as unverified until the selected live connection returns successful evidence. Preserve production write blocking, package allowlists, transport requirements, and mutation confirmation plans.

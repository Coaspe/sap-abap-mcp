# Diagnose, repair and update a registered runtime

These commands are **unreleased candidate** commands. Use the built checkout,
not `npx ...@2.0.1`, to run them. They do not authenticate SAP or change SAP data.

```sh
node dist/src/index.js doctor DEV100 --registration --client codex
node dist/src/index.js repair DEV100 --client codex
```

Use `--client claude` for Claude Code. The selected profile must exist locally.
The default files are `$CODEX_HOME/config.toml` or `~/.codex/config.toml`, and
`$CLAUDE_CONFIG_DIR/.claude.json` or `~/.claude.json`; `--config <absolute-file>`
selects an explicit file. JSON project registrations, detected project overrides/disabled entries and
unusual TOML layouts require manual review. Run from the intended host project.
This checks the selected config file; managed settings, plugins and client approval
state still require the actual host check. No settings are rewritten by doctor or a preview.

Doctor resolves the executable, checks a direct Node entry when applicable,
actually initializes the registered MCP, lists tools, obtains its advertised
version and looks for the selected profile through existing discovery tools.
It compares the explicit profile directory with the current profile store.
`wizardVersion` and `registeredVersion` are separate; a source preview may keep
the same manifest version, so consult its commit/artifact integrity as well.
`local_ready` covers local runtime/profile discovery only: `sapAuthenticated`
is false. `setup_required`, missing executables/cache entries, disabled entries,
unknown/mismatched profile homes and failed probes do not pass this check.

Repair recognizes an ordinary package-owned Node entry or npm invocation. It
retains server arguments (including preset/audit settings), other environment
variables, other servers and host settings. It refuses custom wrappers, HTTP or
disabled entries and another selected profile. Existing matching registrations
are not rewritten automatically. TOML edits touch command/args only, preserve
comments and are parsed and compared before writing; JSON preserves other data.

After reviewing the preview, repeat the same command with its hash:

```sh
node dist/src/index.js repair DEV100 --client codex --apply --expect <planHash>
```

To update, add `--version <exact-reviewed-version>` to both commands. Moving
tags/ranges are rejected. New npm registrations use an exact version with
`npx`/`npx.cmd`; normal starts reuse cached content. Clearing the cache can
require downloading that same version again, so offline-after-deletion is not a
support promise. A persistent checkout deliberately runs its own entry using
PATH-resolved `node`; development registrations are retained for manual review.

Apply first initializes the proposed server with the selected profile. A failed
or cancelled preflight leaves the original settings unchanged. A stale preview
or concurrent edit is refused. A private recovery copy is saved before an atomic
file replacement; other processes do not observe a partly written config.
Interrupted staging can leave a `.repair-lock` and recovery file: verify no
repair process remains, inspect the current config, then remove only that stale
lock. Never blindly replace settings from an older backup after another edit.

Restart the actual host, repeat doctor, and verify one real SAP read separately.
Process relaunch in a local harness is not evidence of a native host restart.

Claude scope precedence and per-project disabling follow the [official MCP guide](https://code.claude.com/docs/en/mcp#scope-hierarchy-and-precedence).

Run package-launch repair from the intended application project. npm can resolve
this same package from its own source checkout and fail to find its bin; preflight
then refuses the edit. For developing the MCP itself, keep the stable-checkout
Node registration. A preflight failure never authorizes bypassing verification.

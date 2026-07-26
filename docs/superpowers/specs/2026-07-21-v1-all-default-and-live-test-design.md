# v1/all Default and Live Test Design

## Decision

The unversioned `serve` command is the normal current API and advertises the
complete v1 surface: 113 callable tools and seven Resources. `--toolsets`
remains an optional schema-budget control. `--api-version v0` is the explicit
legacy compatibility escape hatch, and `--api-version all` remains an explicit
migration/conformance surface containing both versions.

| Invocation | Advertised surface |
| --- | --- |
| `serve` | v1, all toolsets (113 tools, 7 Resources) |
| `serve --toolsets core,analysis` | selected v1 toolsets |
| `serve --api-version v0` | legacy v0 (53 tools) |
| `serve --api-version all` | v0 + v1 comparison (166 tools) |

The server factory uses the same default as the CLI so embedded callers cannot
silently receive v0. Explicit API and toolset selections keep their current
meaning. Existing launch manifests already end in unversioned `serve`, so no
manifest argument expansion is needed.

## Live acceptance boundary

The Windows prompt must initialize a ledger from every row of the committed
113-tool parity matrix. Reading, searching, and analysis may inspect existing
objects. A mutating call is allowed only for an object created during the same
run in package `$TMP`, with ownership proven by both the successful create
receipt and an immediate exact read-back. Names, package membership, or search
results alone never prove ownership.

Tools that cannot satisfy that boundary are still accounted for but receive an
explicit status such as `SKIP-SCOPE`, `SKIP-PREREQUISITE`, or
`EXPECTED-ERROR`; they are never reported as successful live mutations. Final
cleanup may delete only objects in the run ownership ledger, after a fresh
delete preview and exact confirmation token.

## Verification

- A failing contract test first proves the old unversioned v0/core defaults.
- The default server advertises exactly 113 v1 tools and seven Resources.
- Explicit v0 still advertises the unchanged 53-tool contract.
- Explicit toolset filtering and `all` comparison mode remain unchanged.
- Full automated tests and the stdio smoke test pass.
- Protected user-owned prompt files remain unstaged and unmodified by this
  change.

# 1.7.0-beta.1 source reconciliation

This is an unpublished company-test candidate, not npm `latest`. The public
baseline is the actual npm 1.6.0 archive, whose SHA-512 integrity was verified:

`sha512-sdpGv+ezgn4gRMfgBLNoH0LuK3ZJ4+naz5INEP3CBe4K60PtDrIH2x48V1rIWwxfHd2gilb3Zoj9Yo0SVZdDWg==`

The old main checkout was at `e93e5c6` (1.3.1); later release work existed on
other worktrees/branches. Commit `8a76a83` records the 1.5.2 source lineage,
but does not contain a committed 1.6.0 manifest. We do not invent a 1.6.0 Git
commit or tag. Published compiled code is the reference where that source
history is incomplete. The new reconciliation branch consolidates the backed-up
working source and the restored released behavior into a reviewable source tree.

## Preservation and deliberate changes

- Restored the published data policy, query/export schemas, audit denial catalog
  and SQL documentation. Queries require explicit profile opt-in; production and
  non-read-only SQL remain blocked. There is no MCP table denylist or per-call
  risk acknowledgement. This matches 1.6.0 rather than the old main behavior.
- Restored terminal setup's data-query opt-in selector while preserving the new
  credential rollback, advanced Basic settings and browser onboarding fixes.
- Retained the new source/ETag caches, public contracts/KTD, conditional reads,
  bounded recovery, gateway lifecycle fixes and experimental BTP integration.
- Deliberately default new CLI/browser registrations to minimal (five gateways).
  Use `--preset adaptive` or `--toolsets all` for other discovery needs. Native
  v0 is unchanged; library embedding retains the full direct default.
- Synchronized package/lock, registry, MCPB, Claude/Codex plugin and LobeHub
  versions to `1.7.0-beta.1`. Historical release notes are retained as history.

## Comparison against the published binary

Both packages were executed through actual stdio MCP with an empty isolated
profile directory. The reference used its own runtime dependencies.

| Check | Result |
|---|---|
| Published runtime modules | All 66 present; 45 byte-identical, 21 intentionally modified |
| v0 tools | All 53 complete tool definitions identical |
| v1 tools | All 120 retained; none missing |
| Data query/export | Complete tool definitions identical to published 1.6.0 |
| Changed v1 input schemas | Seven, listed below |

The seven changes are source.read (conditional range reads), repository.inspect
(optional KTD), semantic.components (public contracts/navigation), and four
formerly empty union schemas: ddic.update, classic.write, execution.preview,
classic.read. The last four now advertise their existing validated branches
rather than an empty object schema. New tests cover branch behavior.

The 21 modified modules cover connections/BTP, CLI/profile/setup/onboarding,
HTTP session lifecycle, MCP routing/audit/discovery, source/context service and
its schemas/results/budgets. Matching inventories and schemas are compatibility
evidence, not proof that every SAP operation is behaviorally identical.

## Backup and reproducibility

Before reconciliation, 269 tracked/untracked source files were archived and each
SHA-256 rechecked against its backup. Git history was saved in an all-refs bundle:

`/Users/coaspe/Documents/Q&A/sap-abap-mcp-backups/20260908-144653/`

The directory contains `working-tree.tar.gz`, `files.sha256.json`, `history.bundle`,
`changes.patch` and `status.txt`. Ignored dependencies, compiled output, artifacts,
SAP credential/config directories and nested worktrees are not part of this
source archive. Existing working edits are preserved in the consolidated tree.

The beta delivery's external BUILD-INFO.json records its exact source commit,
archive integrity and checksum. Build with the committed lockfile (`npm ci`),
then `npm run build` and `npm pack`. Run the packed-runtime CI gate for an
isolated runtime-only installation; do not identify the beta using `@latest`.

No npm publication, GitHub push, company SAP connection, or live BTP token
exchange is part of this reconciliation. Company Claude Code acceptance remains
separate and can use this archive without public publication.

## Local validation

- Node.js 24.11.1 and 20.20.2: all 548 tests passed on each runtime.
- Actual stdio startup: default, adaptive, full, minimal and single passed.
- Profile conformance, known-capability workflow token benchmark, public-contract
  token benchmark, batch-source benchmark and discovery token benchmark passed.
- MCPB/LobeHub generated catalogs match the five default runtime tools.
- See [company acceptance instructions](company-beta-test.md) for an isolated
  installation and the read-only Claude Code acceptance prompt. The external
  BUILD-INFO.json records verification of the final packed installation.

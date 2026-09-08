# Release source audit — 2026-09-07

Historical audit: the data-policy/source reconciliation and new beta version
are now recorded in [1.7.0-beta.1 reconciliation](reconciliation-1.7.0-beta.1.md).
The unresolved statements below describe their original checkpoints.

The local checkout is based on `e93e5c6` and its package manifest is 1.3.1. npm
`latest` is 1.6.0. A green build from this checkout does not establish that it is
a faithful successor to the published package. Do not republish it as 1.3.1 or
claim the release histories are reconciled.

## Verified artifact

The npm registry reports:

- Package: `@coaspe/sap-abap-mcp@1.6.0`
- Artifact: https://registry.npmjs.org/@coaspe/sap-abap-mcp/-/sap-abap-mcp-1.6.0.tgz
- Integrity: `sha512-sdpGv+ezgn4gRMfgBLNoH0LuK3ZJ4+naz5INEP3CBe4K60PtDrIH2x48V1rIWwxfHd2gilb3Zoj9Yo0SVZdDWg==`

The downloaded archive's SHA-512 matches that registry value. This audit compared
its `dist/src/**/*.js` files against a fresh local TypeScript build: all 66
published modules exist locally, 53 are byte-identical and 13 differ. Runtime
dependency versions match. This checks implementation presence, not behavioral
parity or source provenance; sourcemaps and declaration files are not included
in those counts. New local modules are additional to the published inventory.

## Difference disposition

| Modules under `dist/src` | Disposition |
|---|---|
| `mcp/v1/core-tools.js`, `mcp/v1/source-tools.js`, `sap-client.js` | Local component navigation, conditional source responses and ETag caching are new improvements. They have local regression coverage; actual SAP acceptance remains open. |
| `index.js`, `mcp-server.js`, `mcp/v1/result.js` | Local default adaptive startup, workflow prompt registration and error classification differ. Default and full-mode stdio checks pass. |
| `data-access-policy.js`, `setup-wizard.js`, `audit-log.js`, `mcp/v1/analysis-tools.js`, `mcp/v1/artifact-tools.js`, `mcp/v1/resources.js` | Published 1.4.0 removed the per-call acknowledgement and table denylist in favor of profile-level query opt-in. This checkout retains earlier policy. This is an unresolved behavioral release difference, not missing runtime files. This audit does not change that policy. |
| `tool-service.js` | Contains both local graph/component improvements and the data-query policy difference above. It cannot be replaced wholesale. |

`onboard.js`, `onboard-page.js`, and adaptive gateway implementation match the
published artifact byte for byte. No missing onboarding runtime needs restoring.
The 1.6.0 package includes additional setup/HTTP/CLI guides that are not in the
current checkout; publishing documentation still needs reconciliation.

## Corrections made during this audit

The published 1.5.2 source fix at `8a76a83` limits the Codex starter prompt list
to three entries. The checkout had four. The three-entry form is restored,
covered by the metadata test and checked with the plugin validator. This also
matches the bundled plugin manifest specification's three-prompt limit.

LobeHub generation previously refreshed tools but kept the old empty prompt
list. It now enumerates runtime prompts, including pagination, and writes all
four workflow descriptions and argument contracts. CI now runs both MCPB and
LobeHub manifest checks after building the runtime. Installed user plugins are
not modified by these repository changes.

## Remaining release gates

1. Resolve the published-versus-local data-query contract intentionally, including
   migration guidance and tests for whichever contract is selected.
2. Reconcile the published documentation and historical release notes while
   preserving local onboarding and service documentation edits.
3. Choose a new release version, align all distribution metadata, and build the
   package from one reviewable source commit with a matching tag.
4. Test the packed artifact, then verify the actual published artifact and
   registry/tag provenance after an authorized release.

Local verification currently passes 453 tests and the two distribution catalog
checks. The packaged 1.6.0 code was compared, not executed against SAP. This audit
does not establish global competitive superiority, live SAP success, or a
completed release.

## Follow-up reconciliation — 2026-09-08

Registry metadata still reports 1.6.0 and the same integrity. The archive's
SHA-512 was verified again. Against the current compiled runtime, all 66
published JavaScript modules remain present: 51 identical, 15 different.
The two additional differences are the intentional onboarding recovery fixes;
the earlier byte-identical onboarding statement describes the initial snapshot.
Dependency versions also now differ intentionally: the local parser dependencies
and transitive security updates are recorded in `package.json`/lockfile.

The three missing published guides (`setup-and-profiles.md`, `http-deployment.md`,
`cli-reference.md`) are restored, with current-versus-published query policy and
startup defaults identified. The container key mount now matches the actual
Dockerfile command and the example supplies a non-secret profile directory.
README links point to these guides. Published 1.4.0–1.6.0 changelog entries were
restored without replacing local Unreleased notes; an explicit compatibility
note prevents interpreting historical release notes as current implementation.

This resolves the missing guide/history inventory portion of gate 2. It does
not reconcile the data-query runtime contract, choose a release version, create
a source commit/tag, publish a package, or validate a live SAP installation.

## Installed artifact verification — 2026-09-08

A real `npm pack` archive from the current working tree was installed into a
fresh temporary prefix with `npm install --ignore-scripts --no-audit --no-fund`.
The package remains labeled 1.3.1 for this local check and is **not a release
candidate version or the registry's historical 1.3.1 artifact**.

- Archive: `coaspe-sap-abap-mcp-1.3.1.tgz`, 998,697 packed bytes,
  3,168,573 unpacked bytes, 287 entries.
- Integrity: `sha512-F5Tj7XpUxDCZ/bPYb3eFhjZYqt+VQx7oYvbBlGwhTg6dNRdDnyhZ8OvPdgeaONjPomZYlfB4e2o+ObljhWbTAA==`.
- Fresh resolved dependencies: MCP SDK 1.30.0, abaplint 2.120.43,
  fast-xml-parser 5.10.1 and abap-adt-api 8.4.1. Installed production dependency
  audit reported zero known vulnerabilities at verification time.
- From the installed package: default adaptive and full stdio smoke checks,
  direct-profile conformance, workflow payload benchmark and public-contract
  benchmark passed. Onboarding and credential-save modules imported successfully.

Raw local reports and the archive are under `/tmp/sap-packed-check-tlqjcs/`.
The temporary installation does not use the development checkout's node_modules.
No installation hooks were run, no user MCP registration was modified and no
package was published. These checks prove the tested artifact's executable
packaging, not all SAP capabilities, source/tag provenance or a completed release.
The archive predates this evidence paragraph; repacking later creates a different
integrity because documentation is part of the package.


## Runtime-only package verification after minimal preset — 2026-09-08

A fresh `npm pack` artifact was installed into an isolated temporary project
with `--omit=dev --ignore-scripts`. This checks the packaged source rather than
resolving modules from the development checkout.

- Local artifact: `/tmp/coaspe-sap-abap-mcp-1.3.1.tgz`.
- Integrity: `sha512-sSVed6K9xjNlDPfa3XyZHBykkMSZmgGo0LuzOAYrim5/WuR/h9QFb1oyPlV9BtU/sHGIXr6zzsQdLLPg/Wx02A==`.
- Size: 1,007,823 bytes packed; 3,197,860 bytes unpacked; 287 entries.
- Installed stdio checks passed for default adaptive (17 tools), full (120) and
  minimal (5), with 7 resources and 4 prompts in each mode. Deferred system
  listing and complete catalog discovery passed with no configured SAP system.
- Installed protocol conformance, source workflow and contract/KTD benchmarks
  passed. Runtime dependency audit reported zero vulnerabilities. `js-tiktoken`
  was absent from the installed runtime tree; ordinary benchmarks do not import it.

The installation was
`/var/folders/qy/779v9b217zz30l16dh2836c00000gn/T/sap-runtime-only-2bl1kf8t`.
Reports are `/tmp/sap-installed-conformance.json`,
`/tmp/sap-installed-workflow-benchmark.json`,
`/tmp/sap-installed-contract-benchmark.json` and
`/tmp/sap-installed-runtime-audit.json`. These local temporary files are not
release hosting. This artifact predates this audit paragraph itself.

The manifest still says 1.3.1: this local artifact is neither the historical
published 1.3.1 nor a publishable version selection. No npm publication, Git push,
user-client registration or live SAP acceptance was performed. Release version
and source provenance still require reconciliation before publication.

## 2026-09-08 installed verification after discovery and onboarding fixes

Packed the current built checkout with `npm pack --ignore-scripts`, then installed
the archive into `/tmp/sap-release-check.UpMTqm` using
`npm install ./coaspe-sap-abap-mcp-1.3.1.tgz --omit=dev --ignore-scripts`.
The archive contains 312 entries, 1,040,627 compressed bytes and 3,312,041 unpacked
bytes. Its integrity is
`sha512-3ZHXrlkrwU2TfBTJykFLZkDLPw7ZI1rWJwA59F3miscx/xYdJBjqWStB6Tv5uC2OjZxqvCgsMCbN7DujV0GX4g==`.
It includes the object-input adapter, discovery benchmark and benchmark guide.
This artifact predates this audit paragraph itself.

Checks used Node.js 24.11.1 against the installed package, rather than workspace imports:

- All four stdio modes passed: adaptive 17, full 120, minimal 5, single 1 tool;
  each advertised seven resources and four prompts. No SAP systems were configured.
- Discovery passed 108 query/session checks without the token dependency installed.
  The installed public-contract benchmark completed all 16 fixture runs and
  proposed v1 discovery conformance passed.
- All four formerly empty union input schemas retained JSON Schema branches and
  rejected empty arguments through AJV. The SAP Destination transport factory
  loaded using runtime dependencies; no HTTP request or token exchange was made.
- `js-tiktoken` resolution failed with `ERR_MODULE_NOT_FOUND` as expected.
  Installed runtime `npm audit --omit=dev --json` reported zero vulnerabilities.

Evidence files in the temporary installation root are `pack.json`, `stdio.log`,
`discovery.json`, `conformance.json`, `contracts.json` and `audit.json`. These are
local temporary records, not hosted release assets or live SAP evidence. The
actual user's profile list was empty when rechecked. Source tests had passed
536 cases before packaging; they are distinct from the installed-package checks.

The archive still carries the checkout's unreconciled `1.3.1` version. It is
neither an npm release nor proof of GitHub source/tag parity. No npm publication,
Git push or global client registration was performed by these checks.

## Node.js 20 compatibility verification

After the ancestry, local-contract deduplication and onboarding-mode changes,
the current checkout was compiled and tested with the npm-distributed Node.js
20.20.2 executable. Compilation and all 541 tests passed. Separate processes
using that executable passed the four-mode stdio smoke, all 108 discovery
checks and all 16 public-contract fixture runs with token measurement enabled.
The single gateway still measured 846 bytes / 209 `o200k_base` tokens.

The local logs are `/tmp/sap-node20-full.log`, `/tmp/sap-node20-stdio.log`,
`/tmp/sap-node20-discovery.log` and `/tmp/sap-node20-contracts.log`. This verifies
Node.js 20.20.2 on the current macOS host; it does not establish every older
20.x patch or a native Windows/Linux run. The preceding archive audit predates
these source changes and must not be used as their installed-package proof.

CI's Node 20 test job now also runs the four-mode stdio and discovery checks,
while the package job retains its Node 24 checks. The workflow edit was verified
locally through those commands; no new GitHub Actions run or release was made.

## Installed package after contract recovery changes

Repacked on 2026-09-08 and installed with `--omit=dev --ignore-scripts` into
`/tmp/sap-installed-check.nfOB2C`, outside the workspace. This archive includes
depth-two ancestry, local-contract deduplication, onboarding status/mode selection
and the truncated-declaration `sourceRead` recovery metadata. It contains 312
entries, 1,044,435 compressed bytes and 3,326,234 unpacked bytes. Its integrity is
`sha512-crcimj/E5j9Zqjfe7x8Y0c+Cn9XXj4RJ2HLxW9J5RwreB5lsq8BBgptgovUzYSZUrleCqJOHL52WkGtw7nxeaA==`.
It predates this audit paragraph and the CI edit described below.

Using the installed runtime dependencies, all four stdio modes, 108 discovery
checks, 16 public-contract fixture runs and proposed v1 conformance passed.
Runtime dependency audit reported zero known vulnerabilities. An additional
in-memory MCP check executed the returned `sourceRead` arguments through
adaptive, minimal and single modes. Each mode recovered both a 40,037-byte
single-line declaration and a 72,252-byte Korean ABAP Doc/method span, stopping
before the private section. These six recovery checks exercised MCP validation
and gateway dispatch, not just the service method. Evidence is in `pack.json`,
`stdio.log`, `discovery.json`, `contracts.json`, `conformance.json`, `audit.json`
and `recovery.json` under the temporary installation root.

The CI package job now packs and installs into an isolated temporary directory
and runs the four existing runtime checks there, replacing its pack dry-run.
The commands were exercised locally; a GitHub Actions run has not been made.
The recovery checks used synthetic source, and the other fixture checks made no
SAP calls. This remains an unpublished development archive labelled `1.3.1`,
not proof of npm/Git source parity or successful live SAP/BTP operations.

## Minimal default verification

The subsequent local CLI and new onboarding registrations now default to five
gateways (`minimal`); explicit adaptive remains 17 tools. Both distribution
catalogs were regenerated from actual unversioned stdio discovery. All 547
tests passed, including onboarding's captured launch command and separate
working-directory startup. Stdio passed default minimal and explicit adaptive,
full, minimal and single selections, preserving seven resources/four prompts.

The exact installed-package CI shell block was also executed locally after the
change: real pack, isolated runtime-only installation, all five stdio selections,
proposed conformance, 16 workflow runs, 108 discovery checks and 16 contract runs
passed. It cleaned its temporary installation on exit. Logs are
`/tmp/sap-minimal-default-final-tests.log` and
`/tmp/sap-minimal-default-installed.log`. The separate token measurement is in
`/tmp/sap-workflow-modes.json` and documented in
[workflow-mode-benchmark.md](workflow-mode-benchmark.md).
No GitHub CI execution, publication or live SAP verification occurred.

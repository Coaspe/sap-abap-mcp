# SAP ABAP MCP v1 Distribution and Adoption Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make v1.0.0 consistent across every controlled distribution channel, present a clear headless/governance-first product position, and publish an implementation-independent compatibility profile with repeatable conformance evidence.

**Architecture:** Keep the npm runtime at the already-published v1.0.0 and treat the repository merge commit as the canonical documentation and MCPB source. Make the MCPB and Smithery catalogs describe the same unversioned v1 surface that the bundle launches. Add a small static compatibility profile and validator that can inspect this or another stdio MCP implementation without SAP credentials.

**Tech Stack:** TypeScript/Node.js 20+, Model Context Protocol SDK, JSON Schema, MCPB, GitHub Actions, npm, Official MCP Registry, Smithery.

## Global Constraints

- Do not republish or replace npm v1.0.0; npm package versions are immutable.
- Do not expose SAP credentials, source code, hosts, tokens, or live-system evidence.
- Preserve the legacy `--api-version v0` surface at exactly 53 tools.
- Keep unversioned `serve` on v1 with exactly 115 tools and seven Resources.
- Use the repository merge commit as the source for release and directory assets.
- Public comparisons must be factual and must not claim SAP endorsement.

---

### Task 1: Align MCPB and Smithery with the v1 runtime

**Files:**
- Modify: `scripts/sync-mcpb-tools.mjs`
- Modify: `mcpb/manifest.json`
- Modify: `test/registry-metadata.test.ts`

**Interfaces:**
- Consumes: unversioned `dist/src/index.js serve`, whose default API is v1.
- Produces: a 115-tool MCPB catalog and a Smithery payload whose `serverCard.tools` matches the launched bundle.

- [ ] **Step 1: Change the registry metadata test to require 115 MCPB tools**

Replace the two assertions that require `53` with `115`, and assert that `sap.repository.search`, `sap.transport.assess`, and `sap.rap.generate` are present while `search_abap_objects` is absent.

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npm run build && node --test dist/test/registry-metadata.test.js`

Expected: FAIL because the committed MCPB manifest still contains the 53 legacy tools.

- [ ] **Step 3: Make the catalog probe launch the default v1 surface**

Remove `"--api-version", "v0"` from the `StdioClientTransport` arguments in `scripts/sync-mcpb-tools.mjs`.

- [ ] **Step 4: Regenerate and verify the MCPB catalog**

Run: `npm run sync:mcpb-tools && npm run build:mcpb`

Expected: `mcpb/manifest.json` contains 115 unique tools and `artifacts/sap-abap-mcp-1.0.0.mcpb` validates successfully.

- [ ] **Step 5: Run the focused test**

Run: `npm run build && node --test dist/test/registry-metadata.test.js`

Expected: PASS.

### Task 2: Replace the discovery funnel with current v1 positioning

**Files:**
- Modify: `README.md`
- Modify: `docs/mcp-directory-submissions.md`
- Create: `docs/demo-script.md`
- Create: `docs/launch-v1.0.0.md`
- Create: `ROADMAP.md`
- Create: `ADOPTERS.md`
- Create: `assets/demo.gif`

**Interfaces:**
- Consumes: the existing setup commands, v1 surface counts, security model, and live-SAP verification boundary.
- Produces: one canonical English positioning statement, an accessible demo transcript, directory-ready copy, and public community entry points.

- [ ] **Step 1: Add the current positioning and comparison to the README**

Place this positioning above Quick start:

`The headless, client-neutral, governance-first MCP server for SAP ABAP development across multiple systems.`

Add a factual comparison covering headless execution, host choice, multi-system profiles, production read-only policy, transport assurance, and live-evidence boundaries. Link to SAP's official ADT MCP documentation without claiming endorsement.

- [ ] **Step 2: Add the demo and move the services callout**

Add `assets/demo.gif` plus an adjacent link to `docs/demo-script.md`. The demo must show setup, system discovery, repository search, source read, ABAP Unit/ATC, and transport assessment with synthetic names only. Move the professional-services callout below the adoption/community section.

- [ ] **Step 3: Publish the launch article and community files**

Write `docs/launch-v1.0.0.md` as an English SAP Community-ready article. Create `ROADMAP.md` with Now/Next/Later milestones and `ADOPTERS.md` with an opt-in evidence template that forbids credentials and proprietary code.

- [ ] **Step 4: Update directory metadata**

Set all controlled metadata to v1.0.0, distinguish the 115-tool default from the 53-tool legacy surface, and record only externally verified directory states.

- [ ] **Step 5: Verify documentation contracts**

Run: `npm run build && node --test dist/test/registry-metadata.test.js dist/test/v1-documentation.test.js`

Expected: PASS.

### Task 3: Publish an implementation-independent compatibility profile

**Files:**
- Create: `spec/sap-abap-mcp-profile-v1.json`
- Create: `spec/sap-abap-mcp-profile-v1.schema.json`
- Create: `spec/README.md`
- Create: `scripts/check-profile-conformance.mjs`
- Create: `test/profile-conformance.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: an MCP stdio command plus the tool/resource discovery methods defined by the MCP SDK.
- Produces: JSON evidence with `profile`, `server`, `requiredTools`, `requiredResources`, `passed`, and `failures`.

- [ ] **Step 1: Write the failing conformance tests**

Test that the profile validates against its schema-level invariants, the local unversioned server passes, and a fixture missing one required tool returns `passed: false` with the exact missing tool.

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npm run build && node --test dist/test/profile-conformance.test.js`

Expected: FAIL because the profile and validator do not exist.

- [ ] **Step 3: Add the minimum interoperability profile**

Define required read capabilities (`sap.system.list`, `sap.system.inspect`, `sap.repository.search`, `sap.source.read`, `sap.source.diagnose`, `sap.quality.unit_test`, `sap.quality.atc.run`, `sap.transport.inspect`, `sap.transport.assess`, `sap.rap.availability`) and the `sap-capability-evidence`, `sap-evidence`, and `sap-transport` Resources. Keep write tools optional and explicitly require advertised side-effect annotations for implementations that expose them.

- [ ] **Step 4: Implement the validator**

Export pure `evaluateProfile(profile, discovery)` logic and make the CLI launch `node dist/src/index.js serve` by default. Accept an alternate executable through `--command <executable>` followed by `--args-json <JSON array>`. Print one JSON evidence object and exit nonzero when required capabilities are absent.

- [ ] **Step 5: Add npm scripts and run focused verification**

Add `"conformance:v1": "npm run build && node scripts/check-profile-conformance.mjs"` and `"conformance:v1:json": "node scripts/check-profile-conformance.mjs"`.

Run: `npm run conformance:v1 && npm run build && node --test dist/test/profile-conformance.test.js`

Expected: both commands pass and report profile `io.github.Coaspe/sap-abap-mcp/profile/v1`.

### Task 4: Validate and merge the repository changes

**Files:**
- Verify all files changed by Tasks 1–3.

**Interfaces:**
- Consumes: the complete changed worktree.
- Produces: one reviewed merge commit on `main`.

- [ ] **Step 1: Run complete verification**

Run: `npm run check && npm run smoke:v1 && npm run build:mcpb && npm pack --dry-run && npm audit --omit=dev`

Expected: tests and package checks pass. Any audit finding must be reported separately and must not be hidden.

- [ ] **Step 2: Inspect the diff and commit only scoped files**

Run: `git diff --check`, inspect `git diff --stat` and `git diff`, stage explicit files, then commit with `docs: align v1 distribution and adoption`.

- [ ] **Step 3: Push and open a ready PR**

Push `codex/growth-foundation`, open a ready PR against `main`, wait for required checks, and merge only after they pass.

### Task 5: Synchronize public channels and publish the launch

**Files:**
- Read: merged `server.json`
- Read: merged `artifacts/sap-abap-mcp-1.0.0.mcpb`
- Update after verification: `docs/mcp-directory-submissions.md`

**Interfaces:**
- Consumes: the merged GitHub commit and validated MCPB.
- Produces: Official MCP Registry v1.0.0, GitHub release asset, refreshed Smithery/directory listings, and public launch announcements.

- [ ] **Step 1: Attach the MCPB to GitHub v1.0.0**

Build the bundle from the merged commit, verify its checksum and manifest, upload `sap-abap-mcp-1.0.0.mcpb` to release `v1.0.0`, and verify the asset through the GitHub API.

- [ ] **Step 2: Publish the Official MCP Registry entry**

Dispatch `Publish MCP Registry` from `main`, wait for success, and verify that the Registry API marks version `1.0.0` as latest.

- [ ] **Step 3: Refresh Smithery and index-based directories**

Run `npm run publish:smithery`, verify the 115-tool deployment, request refreshes for Glama and MCP Servers, and update or comment on pending directory submissions with the v1.0.0 release URL.

- [ ] **Step 4: Publish community announcements**

Enable GitHub Discussions, post the v1.0.0 announcement using `docs/launch-v1.0.0.md`, and publish the same adapted article to SAP Community if the authenticated browser session permits. Do not submit credentials or confidential SAP evidence.

- [ ] **Step 5: Record verified public state**

Update `docs/mcp-directory-submissions.md` with the actual date, URLs, versions, tool counts, workflow run links, and any external review queues. Commit and push this evidence-only update, then recheck npm, GitHub Release, Official MCP Registry, Smithery, and the repository default branch.

# Adoption and Compatibility Evidence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace download-based adoption claims with ten moderated setup/gate attempts, sanitized compatibility records, and explicit adopter consent.

**Architecture:** Keep telemetry off. Use a public pilot playbook, structured GitHub issue form, repository validation tests, and aggregate scorecards. Evidence contributors submit only bounded metadata and outcomes; maintainers never request SAP credentials, hosts, source, transport contents, or business data.

**Tech Stack:** Markdown, GitHub issue forms and Discussions, JSON Schema, Node.js repository tests, npm downloads API as a secondary metric.

## Global Constraints

- Complete the security and transport-gate plans before starting pilots.
- Do not add anonymous or automatic telemetry.
- Do not list an adopter without explicit public-name permission.
- Do not store SAP URLs, usernames, profile IDs, object names, source, transport descriptions, finding text, credentials, or business data.
- Do not describe an automated fixture as live SAP evidence.
- Do not call the compatibility profile a standard.
- Publish aggregate failures as well as successes.

---

### Task 1: Add structured pilot and compatibility intake

**Files:**
- Create: `.github/ISSUE_TEMPLATE/compatibility-report.yml`
- Create: `.github/ISSUE_TEMPLATE/config.yml`
- Create: `docs/pilot-playbook.md`
- Modify: `ADOPTERS.md`
- Modify: `test/registry-metadata.test.ts`

**Interfaces:**
- Consumes: opt-in user reports.
- Produces: one bounded intake format with no secret-bearing fields.

- [ ] **Step 1: Write failing metadata tests**

Assert the issue form:

- asks for product version, SAP family, MCP host, operating system, setup duration band, first-read outcome, gate outcome, repeat-use intent, and public-name consent;
- contains no field named URL, host, username, password, token, source, object, transport description, screenshot, or attachment;
- includes a warning not to submit confidential SAP data.

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
npm run build && node --test dist/test/registry-metadata.test.js
```

Expected: FAIL because the issue form is absent.

- [ ] **Step 3: Create the issue form**

Use dropdowns for:

- SAP family: `ECC`, `S/4HANA`, `ABAP Cloud`, `Prefer not to say`;
- setup time: `<5 min`, `5–15 min`, `>15 min`, `did not complete`;
- first read: `passed`, `failed`, `not attempted`;
- gate: `passed`, `failed as expected`, `incomplete`, `not attempted`;
- public listing permission: `yes`, `anonymous only`, `no`.

Free text is limited to a workflow summary and a sanitized failure category.

- [ ] **Step 4: Write the moderated pilot playbook**

Define a 30-minute session:

1. Start from a machine without a configured profile.
2. Follow the published setup path without maintainer intervention for five minutes.
3. Run `doctor`.
4. Read one user-selected non-sensitive development object.
5. If a disposable transport exists, run the transport gate without release.
6. Record the bounded fields from the issue form.
7. Ask once whether the participant will repeat the workflow within 30 days.

Stop immediately if credentials or customer data appear in screen sharing or logs.

- [ ] **Step 5: Update adopter rules**

State that an issue submission is not sufficient for public listing. A maintainer must receive a separate explicit confirmation for the exact public name and quote.

- [ ] **Step 6: Run metadata tests and commit**

Run:

```bash
npm run build && node --test dist/test/registry-metadata.test.js
```

Expected: PASS.

Commit:

```bash
git add \
  .github/ISSUE_TEMPLATE/compatibility-report.yml \
  .github/ISSUE_TEMPLATE/config.yml \
  docs/pilot-playbook.md \
  ADOPTERS.md \
  test/registry-metadata.test.ts
git commit -m "docs: add bounded adoption evidence intake"
```

### Task 2: Add a transparent adoption scorecard

**Files:**
- Create: `docs/adoption-scorecard.md`
- Create: `src/adoption-snapshot.ts`
- Create: `scripts/npm-adoption-snapshot.mjs`
- Create: `test/adoption-snapshot.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: npm public download API responses and manually reviewed pilot counts.
- Produces: a reproducible JSON snapshot for secondary download metrics and a human-reviewed scorecard.

- [ ] **Step 1: Write failing snapshot tests**

Export:

```js
export function summarizeDownloads(rangeResponse) {
  return {
    package: rangeResponse.package,
    start: rangeResponse.start,
    end: rangeResponse.end,
    total: rangeResponse.downloads.reduce((sum, day) => sum + day.downloads, 0),
    activeDays: rangeResponse.downloads.filter(day => day.downloads > 0).length
  }
}
```

Test that malformed dates, negative counts, missing package names, and non-array downloads are rejected.

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
npm run build && node --test dist/test/adoption-snapshot.test.js
```

Expected: FAIL because `src/adoption-snapshot.ts` is absent.

- [ ] **Step 3: Implement the snapshot module and script**

Place the pure validator and summarizer in `src/adoption-snapshot.ts`. After `npm run build`, make the `.mjs` script import `../dist/src/adoption-snapshot.js`.

Fetch only:

```text
https://api.npmjs.org/downloads/range/last-month/@coaspe/sap-abap-mcp
```

Print JSON to stdout. Accept `--output <path>` for a local snapshot but do not commit daily snapshots. Do not fetch competitor packages in the product script.

- [ ] **Step 4: Add the scorecard**

Track:

- pilot attempts;
- completed setup;
- median setup-time band;
- successful first reads;
- gate attempts by status;
- repeat-use confirmations;
- public adopters;
- independent conformance implementations;
- four-week npm range as a secondary metric.

Initialize every human metric to zero and label the report date. Do not fabricate historical pilot data.

- [ ] **Step 5: Add and verify the npm script**

Add:

```json
"adoption:snapshot": "npm run build && node scripts/npm-adoption-snapshot.mjs"
```

Run:

```bash
npm run build && node --test dist/test/adoption-snapshot.test.js
npm run adoption:snapshot
```

Expected: PASS and one valid JSON object.

- [ ] **Step 6: Commit**

```bash
git add \
  docs/adoption-scorecard.md \
  src/adoption-snapshot.ts \
  scripts/npm-adoption-snapshot.mjs \
  test/adoption-snapshot.test.ts \
  package.json
git commit -m "docs: add reproducible adoption scorecard"
```

### Task 3: Run the ten-session pilot

**Files:**
- Modify after each reviewed session: `docs/adoption-scorecard.md`
- Modify only with consent: `ADOPTERS.md`
- Modify when sanitized live evidence is supplied: `docs/compatibility-matrix.md`

**Interfaces:**
- Consumes: ten opt-in participants and the pilot playbook.
- Produces: aggregate outcomes and consented adopter entries.

- [ ] **Step 1: Recruit the cohort**

Invite:

- four ECC/on-premise users;
- four S/4HANA users;
- two ABAP Cloud users.

Use GitHub Discussions and the pending SAP Community article. Do not purchase downloads, stars, or reviews.

- [ ] **Step 2: Run sessions 1–5**

Record only the bounded scorecard fields. After session 5, fix only blockers reproduced by at least two participants or one security-impacting blocker. Re-run the full CI and security gate for every code fix.

- [ ] **Step 3: Run sessions 6–10**

Use the same playbook so before/after results remain comparable. Do not change success definitions during the cohort.

- [ ] **Step 4: Perform the 30-day follow-up**

Ask one question: whether the participant used the server again for a real development workflow. Record yes/no/no-response only.

- [ ] **Step 5: Publish aggregate outcomes**

Report all ten attempts, including failures. Separate:

- setup failure;
- authentication/authorization denial;
- missing ADT capability;
- gate failed as designed;
- gate incomplete;
- product defect.

- [ ] **Step 6: Add consented adopters**

For each adopter, record public name or approved alias, SAP family, MCP host, read-only/write-enabled, workflow, product version, and one approved outcome sentence. Never record customer landscape identifiers.

### Task 4: Gate neutral governance and adapter work

**Files:**
- Modify only when criteria are met: `ROADMAP.md`
- Modify only when criteria are met: `spec/README.md`

**Interfaces:**
- Consumes: adoption and independent implementation evidence.
- Produces: an explicit go/no-go decision; no new adapter or organization in this task.

- [ ] **Step 1: Evaluate the neutral-governance gate**

Proceed to a separate governance design only when all are true:

- three independent organizations have opted into public adoption;
- two independent MCP implementations pass the discovery conformance profile;
- at least one non-Coaspe maintainer agrees to review RFCs;
- the profile has one demonstrated interoperability problem that naming alone does not solve.

Otherwise keep status `proposal`.

- [ ] **Step 2: Evaluate the official-adapter gate**

Proceed to a separate adapter design only when at least two organizations document that direct ADT access is prohibited but the local official SAP MCP is permitted and that they still require Coaspe transport evidence or multi-system policy.

Otherwise keep the adapter deferred.

- [ ] **Step 3: Publish the decision**

Record the evidence counts and decision in `ROADMAP.md`. Do not create a neutral organization, change namespaces, or implement an adapter inside this adoption plan.

### Task 5: Complete the adoption phase

**Files:**
- Verify all files changed by Tasks 1–4.

**Interfaces:**
- Consumes: completed pilot and scorecard.
- Produces: a factual 90-day adoption report.

- [ ] **Step 1: Verify repository contracts**

Run:

```bash
npm run check
npm run smoke:v1
npm run conformance:v1
npm run adoption:snapshot
npm audit --omit=dev
git diff --check
```

Expected: every command exits zero.

- [ ] **Step 2: Review privacy**

Run:

```bash
git diff --unified=0 | rg -n \
  'https?://|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+|password|secret|token|cookie|authorization|DEVK[0-9]+|QASK[0-9]+|PRDK[0-9]+'
```

Review every match. Repository-owned public links and deliberate documentation keywords may remain; remove participant hosts, usernames, credentials, transport identifiers, and other data not explicitly permitted.

- [ ] **Step 3: Publish the aggregate report**

Lead with setup completion, first-read completion, gate outcomes, and repeat use. Place npm downloads last and label them as an install/distribution metric rather than active users.

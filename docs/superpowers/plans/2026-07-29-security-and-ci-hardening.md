# Supply-Chain and CI Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove all current production dependency advisories, add mandatory pull-request verification, and publish future npm releases with verifiable provenance.

**Architecture:** Replace the single vulnerable `exceljs` export path with a focused OOXML writer backed by dependency-free ZIP library `fflate`. Upgrade the MCP SDK and refresh already-compatible transitive packages. Add CI, dependency review, CodeQL, a security policy, and provenance verification without changing MCP tool names or schemas.

**Tech Stack:** TypeScript 7, Node.js 20/24, `fflate` 0.8.3, MCP SDK 1.30.0, GitHub Actions, npm audit and Sigstore provenance.

## Global Constraints

- Preserve XLSX and CSV behavior for `execute_data_query` and `sap.data.export`.
- Preserve the 115-tool v1 and 53-tool v0 discovery contracts.
- Pin every direct runtime dependency to an exact version.
- Do not use `npm audit fix --force`.
- Do not silence, omit, or allowlist a high or critical production advisory.
- Do not add a second spreadsheet framework.
- Generated spreadsheets must treat strings beginning with `=`, `+`, `-`, or `@` as text, not formulas.

---

### Task 1: Add a minimal XLSX writer

**Files:**
- Create: `src/xlsx-export.ts`
- Create: `test/xlsx-export.test.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Consumes: bounded columns and rows already produced by `AbapToolService.executeDataQuery`.
- Produces:

```ts
export interface XlsxExportColumn {
  name: string
  header: string
  width: number
}

export interface XlsxExportInput {
  sheetName: string
  columns: XlsxExportColumn[]
  rows: Array<Record<string, unknown>>
}

export function createXlsx(input: XlsxExportInput): Uint8Array
export function writeXlsxFile(path: string, input: XlsxExportInput): Promise<void>
```

- [ ] **Step 1: Install the exact ZIP dependency**

Run:

```bash
npm install --save-exact fflate@0.8.3
```

Expected: `package.json` contains `"fflate": "0.8.3"` and `npm explain fflate` shows no transitive dependencies.

- [ ] **Step 2: Write failing package-structure and cell-safety tests**

Create tests that unzip the returned bytes with `unzipSync` and assert the required entries:

```ts
const archive = unzipSync(createXlsx({
  sheetName: "ABAP/Data:*?",
  columns: [
    { name: "NAME", header: "Name", width: 12 },
    { name: "COUNT", header: "Count", width: 12 }
  ],
  rows: [{ NAME: "=HYPERLINK(\"https://invalid\")", COUNT: 7 }]
}))

assert.deepEqual(
  Object.keys(archive).sort(),
  [
    "[Content_Types].xml",
    "_rels/.rels",
    "docProps/app.xml",
    "docProps/core.xml",
    "xl/_rels/workbook.xml.rels",
    "xl/styles.xml",
    "xl/workbook.xml",
    "xl/worksheets/sheet1.xml"
  ]
)
const sheet = strFromU8(archive["xl/worksheets/sheet1.xml"]!)
assert.match(sheet, /t="inlineStr"/)
assert.match(sheet, /=HYPERLINK/)
assert.doesNotMatch(sheet, /<f>/)
assert.match(sheet, /t="n"><v>7<\/v>/)
```

Also test XML escaping, `null` as a blank cell, booleans as `t="b"`, invalid sheet-name characters replaced with `_`, and a 31-character sheet-name limit.

- [ ] **Step 3: Run the focused test and verify it fails**

Run:

```bash
npm run build && node --test dist/test/xlsx-export.test.js
```

Expected: FAIL because `src/xlsx-export.ts` does not exist.

- [ ] **Step 4: Implement the OOXML package**

Implement these exact rules:

- ZIP the eight entries asserted by the test with `zipSync`.
- Use one worksheet and inline strings; do not create `sharedStrings.xml`.
- Use zero-based column indexes converted to Excel labels (`A`, `B`, ..., `AA`).
- Emit header cells as inline strings.
- Emit finite numbers with `t="n"`, booleans with `t="b"`, `null`/`undefined` as empty cells, and every other value with `t="inlineStr"`.
- Replace XML control characters with `\uFFFD`, then escape `&`, `<`, `>`, `"`, and `'`.
- Replace `\\ / ? * [ ] :` in sheet names with `_`, use `Sheet1` when empty, and truncate to 31 Unicode code points.
- Clamp column widths to the existing 12–40 range.
- Write bytes with `node:fs/promises.writeFile`.

Use the public `fflate` API:

```ts
import { strToU8, zipSync } from "fflate"
import { writeFile } from "node:fs/promises"
```

- [ ] **Step 5: Run the focused test**

Run:

```bash
npm run build && node --test dist/test/xlsx-export.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/xlsx-export.ts test/xlsx-export.test.ts
git commit -m "feat: add dependency-light xlsx export"
```

### Task 2: Remove vulnerable dependency paths

**Files:**
- Modify: `src/tool-service.ts`
- Modify: `package.json`
- Modify: `package-lock.json`
- Test: `test/integration.test.ts`

**Interfaces:**
- Consumes: `writeXlsxFile` from Task 1.
- Produces: unchanged `outputPath`, `rowCount`, and `columnCount` responses for XLSX export.

- [ ] **Step 1: Strengthen the integration assertion**

After the existing XLSX export call, unzip the file and assert the worksheet contains the selected header and first row. Keep the existing `PK` signature assertion.

- [ ] **Step 2: Replace the dynamic ExcelJS import**

Add:

```ts
import { writeXlsxFile } from "./xlsx-export.js"
```

Replace the `exceljs` block with:

```ts
await writeXlsxFile(outputPath, {
  sheetName: input.title || "ABAP Data",
  columns: raw.columns.map(column => ({
    name: column.name,
    header: column.description || column.name,
    width: Math.max(12, Math.min(40, column.name.length + 4))
  })),
  rows: selected
})
```

- [ ] **Step 3: Remove ExcelJS and upgrade fixed packages**

Run:

```bash
npm uninstall exceljs
npm install --save-exact @modelcontextprotocol/sdk@1.30.0
npm update fast-uri fast-xml-parser
```

Expected:

- `exceljs`, `archiver`, `archiver-utils`, `readdir-glob`, `zip-stream`, vulnerable `glob`, vulnerable `minimatch`, and vulnerable `rimraf` are absent from `npm ls --all`.
- `@hono/node-server` resolves to `2.0.5` or later.
- `fast-uri` resolves to `3.1.4` or later.
- `fast-xml-parser` resolves to `5.10.1` or later.

- [ ] **Step 4: Run compatibility and export tests**

Run:

```bash
npm run build
node --test \
  dist/test/xlsx-export.test.js \
  dist/test/integration.test.js \
  dist/test/v0-contract.test.js \
  dist/test/v1-artifact-tools.test.js
```

Expected: PASS with unchanged v0 fixture and unchanged v1 tool count.

- [ ] **Step 5: Run the production audit**

Run:

```bash
npm audit --omit=dev
npm audit signatures
```

Expected: zero vulnerabilities, no invalid signatures, and no invalid attestations.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/tool-service.ts test/integration.test.ts
git commit -m "fix: remove vulnerable export dependency paths"
```

### Task 3: Add mandatory CI

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: repository scripts in `package.json`.
- Produces: required `test (20)` and `test (24)` checks plus one package verification check.

- [ ] **Step 1: Add the CI workflow**

Use this workflow shape:

```yaml
name: CI

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

permissions:
  contents: read

jobs:
  test:
    strategy:
      fail-fast: false
      matrix:
        node: ["20", "24"]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-node@v6
        with:
          node-version: ${{ matrix.node }}
          package-manager-cache: false
      - run: npm ci
      - run: npm run check

  package:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-node@v6
        with:
          node-version: "24"
          package-manager-cache: false
      - run: npm ci
      - run: npm run smoke:v1
      - run: npm run conformance:v1
      - run: npm pack --dry-run
      - run: npm audit --omit=dev
      - run: npm audit signatures
```

- [ ] **Step 2: Validate workflow syntax locally**

Run:

```bash
ruby -e 'require "yaml"; YAML.load_file(".github/workflows/ci.yml", aliases: true)'
git diff --check
```

Expected: both commands exit zero.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: verify supported nodes and release package"
```

### Task 4: Add dependency and code security gates

**Files:**
- Create: `.github/workflows/security.yml`
- Create: `SECURITY.md`
- Modify: `.github/workflows/publish-npm.yml`
- Modify: `package.json`
- Test: `test/registry-metadata.test.ts`

**Interfaces:**
- Consumes: GitHub dependency review and CodeQL JavaScript/TypeScript analysis.
- Produces: blocking dependency review on pull requests, scheduled CodeQL analysis, and npm provenance.

- [ ] **Step 1: Add failing repository metadata assertions**

Assert that:

- `SECURITY.md` exists and names the private GitHub vulnerability-reporting path.
- `publish-npm.yml` contains `npm publish --provenance --access public`.
- `package.json.publishConfig.provenance` is `true`.

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
npm run build && node --test dist/test/registry-metadata.test.js
```

Expected: FAIL because the security policy and provenance configuration are absent.

- [ ] **Step 3: Add the security workflow**

Create one workflow with:

- dependency review on pull requests using `actions/dependency-review-action@v4` and `fail-on-severity: moderate`;
- CodeQL `github/codeql-action/init@v4`, `autobuild@v4`, and `analyze@v4` for `javascript-typescript`;
- push, pull-request, and weekly scheduled CodeQL triggers;
- only `contents: read` and `security-events: write` permissions.

- [ ] **Step 4: Add the security policy**

Document:

- private reports through GitHub Security Advisories;
- supported line: latest stable npm version only;
- acknowledgement target: three business days;
- no SAP credentials, URLs, source, or business data in reports;
- coordinated disclosure requested until a fix is available.

- [ ] **Step 5: Enable npm provenance**

Set:

```json
"publishConfig": {
  "access": "public",
  "registry": "https://registry.npmjs.org/",
  "provenance": true
}
```

Change the publish step to:

```yaml
- run: npm publish --provenance --access public
```

- [ ] **Step 6: Run focused verification**

Run:

```bash
npm run build
node --test dist/test/registry-metadata.test.js
ruby -e 'require "yaml"; YAML.load_file(".github/workflows/security.yml", aliases: true)'
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add \
  .github/workflows/security.yml \
  .github/workflows/publish-npm.yml \
  SECURITY.md \
  package.json \
  test/registry-metadata.test.ts
git commit -m "ci: enforce supply chain security"
```

### Task 5: Complete the hardening gate

**Files:**
- Verify all files changed by Tasks 1–4.
- Modify: `CHANGELOG.md`
- Modify: GitHub issue #3 after merge.

**Interfaces:**
- Consumes: the complete hardening branch.
- Produces: a reviewable PR with zero known production dependency findings.

- [ ] **Step 1: Run complete local verification**

Run:

```bash
npm run check
npm run smoke:v1
npm run conformance:v1
npm run build:mcpb
npm pack --dry-run
npm audit --omit=dev
npm audit signatures
git diff --check
```

Expected: every command exits zero.

- [ ] **Step 2: Inspect package contents**

Run:

```bash
npm pack --json --dry-run
npm ls --omit=dev --all
```

Expected: `exceljs` and its archive chain are absent; `dist/src/xlsx-export.js` is included.

- [ ] **Step 3: Record the user-visible change**

Add an Unreleased entry stating that XLSX export remains supported while the vulnerable ExcelJS/archive dependency chain has been removed, and that future npm releases carry provenance.

- [ ] **Step 4: Push and open a ready PR**

Require CI, package, dependency-review, and CodeQL checks. Merge only after all checks pass.

- [ ] **Step 5: Close the audit issue with evidence**

Comment on GitHub issue #3 with the merge commit and exact successful `npm audit --omit=dev` result, then close it.

### Task 6: Publish the security patch

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `server.json`
- Modify: `mcpb/manifest.json`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: the merged hardening commit.
- Produces: npm, GitHub Release, MCPB, and Official MCP Registry version `1.0.1`.

- [ ] **Step 1: Set version 1.0.1 everywhere**

Run:

```bash
npm version 1.0.1 --no-git-tag-version
```

Update `server.json` and `mcpb/manifest.json` to `1.0.1`, rebuild the MCPB, and record the security changes in `CHANGELOG.md`.

- [ ] **Step 2: Run the release gate**

Run:

```bash
npm ci
npm run check
npm run smoke:v1
npm run conformance:v1
npm run build:mcpb
npm pack --dry-run
npm audit --omit=dev
npm audit signatures
git diff --check
```

Expected: every command exits zero; v1 remains 115/7 and v0 remains 53.

- [ ] **Step 3: Commit the release metadata and open a release PR**

```bash
git add \
  package.json \
  package-lock.json \
  server.json \
  mcpb/manifest.json \
  CHANGELOG.md \
  artifacts/sap-abap-mcp-1.0.1.mcpb
git commit -m "release: publish security patch 1.0.1"
```

Open a ready PR and merge only after all required checks pass.

- [ ] **Step 4: Tag and publish the merged commit**

Fast-forward local `main` to the merged commit, create and push tag `v1.0.1`, publish npm through `publish-npm.yml`, publish the Official MCP Registry entry, attach `sap-abap-mcp-1.0.1.mcpb` to the GitHub release, and verify npm provenance.

- [ ] **Step 5: Verify public alignment**

Verify:

- npm `latest` is `1.0.1`;
- GitHub release `v1.0.1` references the same commit;
- Official MCP Registry marks `1.0.1` latest;
- the MCPB checksum matches the local artifact;
- a clean `npx @coaspe/sap-abap-mcp@1.0.1 serve` smoke test exposes 115 tools and seven Resources.

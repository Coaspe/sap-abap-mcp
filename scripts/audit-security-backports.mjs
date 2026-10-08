import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"

const manifest = JSON.parse(await readFile(new URL("../vendor/security-backports.json", import.meta.url), "utf8"))
const sources = Object.entries(manifest.sources)
const response = await fetch("https://api.osv.dev/v1/querybatch", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ queries: sources.map(([name, source]) => ({
    package: { name, ecosystem: "npm" }, version: source.version
  })) }),
  signal: AbortSignal.timeout(30000)
})
assert.ok(response.ok, `Upstream advisory inspection failed: HTTP ${response.status}`)
const { results } = await response.json()
assert.equal(results.length, sources.length)
const findings = []
for (let index = 0; index < sources.length; index++) {
  for (const finding of results[index].vulns ?? []) {
    const review = manifest.reviewedUpstreamAdvisories[finding.id]
    assert.ok(review && review.package === sources[index][0] && review.modified === finding.modified,
      `${sources[index][0]}: unreviewed or updated upstream advisory ${finding.id}`)
    findings.push({ package: sources[index][0], id: finding.id, reviewedPatch: true })
  }
}
console.log(JSON.stringify({ passed: true, originalSourceVersionsChecked: sources.length, findings }))

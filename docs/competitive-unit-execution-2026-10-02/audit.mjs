import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFile, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { resolve, join } from "node:path"
import { fileURLToPath } from "node:url"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { evaluateProfile } from "../../dist/src/profile-conformance.js"

const root = fileURLToPath(new URL("../../", import.meta.url))
const profileText = await readFile(join(root, "spec/sap-abap-mcp-profile-v1.json"), "utf8")
const profile = JSON.parse(profileText)
const draft = JSON.parse(await readFile(new URL("contract-review.json", import.meta.url), "utf8"))
const home = await mkdtemp(join(tmpdir(), "sap-unit-contract-"))
const client = new Client({ name: "unit-execution-contract-audit", version: "1" })
const transport = new StdioClientTransport({ command: process.execPath,
  args: [process.argv[3] ? resolve(process.argv[3]) : join(root, "dist/src/index.js"), "serve", "--toolsets", "all"],
  cwd: root, env: { SAP_ABAP_MCP_HOME: home }, stderr: "pipe" })
const pages = async (call, key) => {
  const items = []
  let cursor
  do { const page = await call(cursor ? { cursor } : undefined); items.push(...page[key]); cursor = page.nextCursor } while (cursor)
  return items
}
try {
  await client.connect(transport)
  const tools = await pages(input => client.listTools(input), "tools")
  const resources = [...await pages(input => client.listResources(input), "resources"),
    ...await pages(input => client.listResourceTemplates(input), "resourceTemplates")]
  const namesOnly = evaluateProfile(profile, { server: client.getServerVersion(), tools, resources })
  const annotations = names => names.map(name => {
    const tool = tools.find(tool => tool.name === name)
    return { name, advertised: Boolean(tool), annotations: tool?.annotations,
      readOnlyObligationMetByAnnotation: tool?.annotations?.readOnlyHint === true }
  })
  const required = annotations(profile.requiredTools.filter(tool => tool.readOnly).map(tool => tool.name))
  const violations = required.filter(tool => !tool.readOnlyObligationMetByAnnotation)
  assert.deepEqual(violations.map(tool => tool.name), ["sap.quality.unit_test", "sap.transport.assess"])
  const candidate = annotations(draft.proposedRequiredReadOnlyTools)
  assert.ok(candidate.every(tool => tool.readOnlyObligationMetByAnnotation))
  const report = { generatedAt: new Date().toISOString(), node: process.versions.node,
    transport: "actual stdio", discoveryOnly: true, liveSapCalls: 0, modelCalls: 0,
    profileSha256: createHash("sha256").update(profileText).digest("hex"), namesOnly,
    requiredReadOnlyAnnotationAudit: { passed: violations.length === 0, required, violations },
    candidate: { status: draft.status, changedPublishedContract: false, requiredCount: candidate.length,
      annotationAuditPassed: candidate.every(tool => tool.readOnlyObligationMetByAnnotation), tools: candidate },
    limitation: "Discovery and advertised annotations do not prove live effects, SAP authorization, safety, or independent standard adoption." }
  const output = JSON.stringify(report, null, 2) + "\n"
  if (process.argv[2]) await writeFile(resolve(process.argv[2]), output)
  else process.stdout.write(output)
} finally { await client.close(); await rm(home, { recursive: true, force: true }) }

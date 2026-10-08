import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { getEncoding } from "js-tiktoken"
import Ajv2020 from "ajv/dist/2020.js"
import { evaluateProfile } from "../../dist/src/profile-conformance.js"

const root = fileURLToPath(new URL("../../", import.meta.url))
const currentText = await readFile(join(root, "spec/sap-abap-mcp-profile-v1.json"), "utf8")
const current = JSON.parse(currentText)
const { profile: candidate } = JSON.parse(await readFile(new URL("candidate.json", import.meta.url), "utf8"))
const schema = JSON.parse(await readFile(join(root, "spec/sap-abap-mcp-profile-v1.schema.json"), "utf8"))
const validate = new Ajv2020().compile(schema)
assert.equal(validate(candidate), true, JSON.stringify(validate.errors))
const names = candidate.requiredTools.map(tool => tool.name)
const encoder = getEncoding("o200k_base")
const tokens = value => encoder.encode(JSON.stringify(value)).length
const pages = async (call, field) => {
  const items = []
  let cursor
  do {
    const page = await call(cursor ? { cursor } : undefined)
    items.push(...page[field])
    cursor = page.nextCursor
  } while (cursor)
  return items
}
const runs = []
const directSchemas = new Map()
for (const mode of ["full", "minimal", "single"]) {
  const home = await mkdtemp(join(tmpdir(), "sap-profile-review-"))
  const client = new Client({ name: "profile-review", version: "1" })
  const args = [join(root, "dist/src/index.js"), "serve",
    ...(mode === "full" ? ["--toolsets", "all"] : ["--preset", mode])]
  const transport = new StdioClientTransport({ command: process.execPath, args,
    cwd: root, env: { SAP_ABAP_MCP_HOME: home }, stderr: "pipe" })
  try {
    await client.connect(transport)
    const tools = await pages(input => client.listTools(input), "tools")
    const resources = [...await pages(input => client.listResources(input), "resources"),
      ...await pages(input => client.listResourceTemplates(input), "resourceTemplates")]
    const discovery = { server: client.getServerVersion(), tools, resources }
    const currentProfileConformance = evaluateProfile(current, discovery)
    const candidateDirectConformance = evaluateProfile(candidate, discovery)
    if (mode === "full") for (const tool of tools) directSchemas.set(tool.name, tool)
    let catalogTools = tools.filter(tool => names.includes(tool.name))
    let catalogCost
    if (mode !== "full") {
      const parameters = mode === "single"
        ? { name: "sap", arguments: { name: "describe", arguments: { names, includeOutputSchema: true } } }
        : { name: "sap.capability.describe", arguments: { names, includeOutputSchema: true } }
      const result = await client.callTool(parameters)
      assert.notEqual(result.isError, true)
      assert.equal(result.structuredContent.status, "succeeded")
      catalogTools = result.structuredContent.data.capabilities
      const normalize = value => JSON.stringify(value).replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "00000000-0000-0000-0000-000000000000")
      catalogCost = { requestTokens: encoder.encode(normalize(parameters)).length,
        responseTokens: encoder.encode(normalize(result)).length }
      assert.ok(catalogTools.every(tool => /^[0-9a-f]{64}$/.test(tool.schemaHash)))
    }
    assert.deepEqual(catalogTools.map(tool => tool.name).sort(), [...names].sort())
    assert.ok(catalogTools.every(tool => tool.annotations?.readOnlyHint === true && tool.inputSchema && tool.outputSchema))
    for (const tool of catalogTools) {
      const direct = directSchemas.get(tool.name)
      assert.deepEqual(tool.inputSchema, direct.inputSchema)
      assert.deepEqual(tool.outputSchema, direct.outputSchema)
      assert.deepEqual(tool.annotations, direct.annotations)
    }
    assert.equal(candidateDirectConformance.passed, mode === "full")
    assert.equal(currentProfileConformance.passed, false)
    runs.push({ mode, advertisedTools: tools.length, schemasTokens: tokens(tools),
      instructionsTokens: tokens({ instructions: client.getInstructions() ?? "" }),
      currentProfileConformance, candidateDirectConformance,
      catalogInspection: { capabilities: catalogTools.map(tool => ({ name: tool.name, annotations: tool.annotations })),
        complete: true, exactSchemasMatchFull: true, toolCalls: mode === "full" ? 0 : 1,
        ...(catalogCost ? { catalogCost } : {}),
        usesCurrentProfileDiscoveryMethod: mode === "full", establishesRatifiedProfile: false } })
  } finally {
    await client.close()
    await rm(home, { recursive: true, force: true })
  }
}
const report = { generatedAt: new Date().toISOString(), node: process.versions.node,
  transport: "actual stdio", currentProfileSha256: createHash("sha256").update(currentText).digest("hex"),
  freshSessions: runs.length, candidateSchemaValid: true, passedReviewChecks: true, sapFacingToolCalls: 0, modelCalls: 0,
  profileChanged: false, candidateRatified: false, runs,
  limitations: ["Annotations are server claims, not live side-effect evidence.",
    "Catalog discovery is repository-specific and is not accepted by the current direct-name profile.",
    "No independent implementation, adopter, live SAP, host billing or task-quality proof.",
    "Startup and one eight-capability catalog call are estimated, not model-selected task or provider billing costs."] }
const output = JSON.stringify(report, null, 2) + "\n"
if (process.argv[2]) await writeFile(process.argv[2], output)
else process.stdout.write(output)

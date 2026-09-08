import { writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { checkPublicContracts } from "./public-contract-evidence.mjs"

const options = new Map()
const args = process.argv.slice(2)
for (let index = 0; index < args.length; index += 2) {
  if (!["--profile", "--object", "--type", "--output"].includes(args[index]) ||
      !args[index + 1] || args[index + 1].startsWith("--") || options.has(args[index])) {
    throw new Error("Usage: live-read-context.mjs --profile ID --object NAME --type TYPE [--output path]")
  }
  options.set(args[index], args[index + 1])
}
for (const key of ["--profile", "--object", "--type"]) {
  if (!options.get(key)?.trim()) throw new Error(`Required: ${key}`)
}
const systemId = options.get("--profile").toUpperCase()
const objectName = options.get("--object")
const objectType = options.get("--type")
const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const report = {
  schemaVersion: "1.0", scenario: "live-read-context", startedAt: new Date().toISOString(),
  systemId, objectName, objectType, status: "incomplete", reason: null,
  sapFacingToolCalls: 0, backendRequestCount: null, modelCalls: 0,
  writes: 0, stages: [],
  scope: "System metadata, optional KTD, one active 50-line source range, and for CLAS/INTF the first public-contract page with up to five related types; source and contract results revalidated once. No source, document text or credentials are saved in this report."
}
const client = new Client({ name: "sap-live-read-context", version: "1.0.0" })
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(root, "dist/src/index.js"), "serve", "--preset", "adaptive"],
  cwd: root, env: Object.fromEntries(Object.entries(process.env).filter(([, value]) => value !== undefined)),
  stderr: "pipe"
})
// Drain server diagnostics without persisting potentially identifying backend text.
transport.stderr?.on("data", () => undefined)
async function call(name, arguments_, sapFacing = true) {
  const start = performance.now()
  if (sapFacing) report.sapFacingToolCalls++
  let result
  try { result = await client.callTool({ name, arguments: arguments_ }) }
  catch {
    report.stages.push({ tool: name, status: "failed", elapsedMs: Math.round(performance.now() - start), code: "MCP_REQUEST_FAILED" })
    throw new Error("MCP_REQUEST_FAILED")
  }
  const stage = {
    tool: name, status: result.isError ? "failed" : result.structuredContent?.status === "succeeded" ? "succeeded" : "incomplete",
    elapsedMs: Math.round(performance.now() - start),
    responseBytes: Buffer.byteLength(JSON.stringify(result))
  }
  report.stages.push(stage)
  if (result.isError) {
    let code = "MCP_TOOL_FAILED"
    try {
      const text = result.content.find(item => item.type === "text")?.text
      const candidate = JSON.parse(text).code
      if (typeof candidate === "string" && /^[A-Z0-9_]{1,80}$/.test(candidate)) code = candidate
    } catch { /* Keep a non-identifying fallback code. */ }
    stage.code = code
    throw new Error(code)
  }
  if (result.structuredContent?.status !== "succeeded") throw new Error("INCOMPLETE_TOOL_RESULT")
  return result.structuredContent.data
}
try {
  await client.connect(transport)
  const systems = await call("sap.system.list", {}, false)
  const profile = systems.systems.find(item => item.id.toUpperCase() === systemId)
  if (!profile || !profile.credentialAvailable) {
    report.status = "blocked"
    report.reason = profile ? "CREDENTIAL_UNAVAILABLE" : "PROFILE_NOT_CONFIGURED"
    process.exitCode = 2
  } else {
    await call("sap.system.inspect", { systemId })
    const hasPublicContracts = ["CLAS", "INTF"].includes(objectType.toUpperCase().split("/")[0])
    const inspected = await call("sap.repository.inspect", {
      systemId, objectName, objectType,
      ...(!hasPublicContracts ? { documentation: { offset: 0, maxChars: 2000 } } : {})
    })
    report.documentationStatus = inspected.documentation?.status ?? "not_reported"
    const sourceArgs = { systemId, objectName, objectType, startLine: 1, lineCount: 50 }
    const first = await call("sap.source.read", sourceArgs)
    if (typeof first.code !== "string" || !/^[a-f0-9]{64}$/.test(first.contentHash)) {
      throw new Error("INVALID_SOURCE_RESULT")
    }
    const repeated = await call("sap.source.read", { ...sourceArgs, ifNoneMatch: first.contentHash })
    if (repeated.notModified === true && repeated.contentHash === first.contentHash && repeated.code === undefined) {
      report.status = "passed"
      report.sourceRevalidation = "unchanged"
    } else if (repeated.notModified === false && repeated.contentHash !== first.contentHash && typeof repeated.code === "string") {
      report.reason = "SOURCE_CHANGED_DURING_CHECK"
      report.sourceRevalidation = "changed"
      process.exitCode = 2
    } else throw new Error("INVALID_CONDITIONAL_SOURCE_RESULT")
    if (hasPublicContracts) {
      report.publicContracts = await checkPublicContracts(call, systemId, first)
      report.documentationStatus = report.publicContracts.documentation.status
      if (report.publicContracts.revalidation === "changed") {
        report.status = "incomplete"
        report.reason = "PUBLIC_CONTRACT_CHANGED_DURING_CHECK"
        process.exitCode = 2
      }
    }
  }
} catch (error) {
  report.status = "failed"
  report.reason = /^[A-Z0-9_]{1,80}$/.test(error.message) ? error.message : "CONNECTION_OR_PROTOCOL_FAILED"
  process.exitCode = 1
} finally {
  await client.close().catch(() => undefined)
}
const json = `${JSON.stringify(report, null, 2)}\n`
if (options.has("--output")) await writeFile(options.get("--output"), json)
process.stdout.write(json)

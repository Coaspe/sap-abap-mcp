#!/usr/bin/env node
import { execFile } from "node:child_process"
import { createHash, randomBytes } from "node:crypto"
import { readFile, readdir, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { promisify } from "node:util"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { PACKAGE_VERSION } from "../dist/src/launch-contract.js"
import { ProfileStore } from "../dist/src/profile-store.js"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const entry = join(root, "dist/src/index.js")
const output = "private-cloud-evidence.sanitized.json"
const exec = promisify(execFile)
async function runtimeBuildId() {
  const hash = createHash("sha256").update(await readFile(fileURLToPath(import.meta.url)))
  async function visit(directory, relative = "") {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
      const name = relative ? `${relative}/${entry.name}` : entry.name
      const path = join(directory, entry.name)
      if (entry.isDirectory()) await visit(path, name)
      else if (entry.isFile()) hash.update(name).update(await readFile(path))
    }
  }
  await visit(join(root, "dist/src"))
  return hash.digest("hex")
}
const stageNames = new Set(["profile_lookup", "profile_development_scope", "doctor_include_components", "system_metadata", "package_search", "class_search", "class_source", "class_structure", "atc_cached", "unit_test_previous_result", "open_transport_search", "old_transport_history_complete", "known_old_transport", "dump_list", "runtime_feed", "transport_release", "rap_generation", "v4_unpublish", "transport_object_add", "dictionary_check", "top_level_package_create", "tmp_create", "tmp_ownership", "tmp_source_read", "tmp_declare_method", "tmp_add_method", "tmp_dollar_patch", "tmp_diagnose", "tmp_activate", "tmp_active_read", "dollar_literal_preserved", "tmp_workflow", "tmp_delete_preview", "tmp_delete", "tmp_delete_verify", "execution"])
const hasRunMethod = data => typeof data?.code === "string" && !data.truncated && data.nextLine == null &&
  /^[ \t]*METHODS run\.[ \t]*$/im.test(data.code) && /^[ \t]*METHOD run\.[ \t]*$/im.test(data.code)
const statuses = new Set(["passed", "failed", "incomplete", "unverified", "skipped"])

// Only fixed labels and enumerated statuses are persisted. SAP responses, error
// messages, inputs, identifiers and even hashes of predictable identifiers are
// never copied to evidence. This is safer than trying to redact arbitrary text.
export function evidence(stages, writeRequested, cleanup, buildId, activationMessages) {
  const normalizedStages = stages.map(({ stage, status }) => ({ stage: stageNames.has(stage) ? stage : "execution", status: statuses.has(status) ? status : "incomplete" }))
  const normalizedCleanup = ["not_requested", "uncertain", "receipt_only_unverified", "verified_absent"].includes(cleanup) ? cleanup : "uncertain"
  const status = normalizedStages.some(item => item.status === "failed") ? "failed"
    : normalizedStages.some(item => item.status !== "passed") || (writeRequested && normalizedCleanup !== "verified_absent") ? "incomplete" : "passed"
  return { schemaVersion: "1.0", productVersion: PACKAGE_VERSION, ...(buildId ? { buildId } : {}), ...(activationMessages ? { activationMessages } : {}), generatedAt: new Date().toISOString(), status,
    profile: "[REDACTED]", object: "[REDACTED]", customerData: "[REDACTED]",
    writeRequested: writeRequested === true,
    cleanup: normalizedCleanup, stages: normalizedStages,
    redaction: "allowlisted stage names and status values only; no SAP payloads, identifiers or errors retained" }
}

export function parseArguments(args) {
  const options = { write: false, diagnostics: false }
  for (let i = 0; i < args.length; i++) {
    const key = args[i]
    if (key === "--allow-tmp-write" && !options.write) { options.write = true; continue }
    if (key === "--activation-diagnostics" && !options.diagnostics) { options.diagnostics = true; continue }
    if (!["--profile", "--class", "--package-pattern"].includes(key) || options[key] !== undefined || !args[i + 1] || args[i + 1].startsWith("--")) throw Error("INVALID_ARGUMENTS")
    options[key] = args[++i]
  }
  if (!/^[A-Za-z0-9_-]+$/.test(options["--profile"] ?? "") ||
      !/^(?:\/[A-Za-z0-9_]+\/)?[A-Za-z][A-Za-z0-9_]*$/.test(options["--class"] ?? "") ||
      !/^[A-Za-z0-9_*$\/]+$/.test(options["--package-pattern"] ?? "Z*")) throw Error("INVALID_ARGUMENTS")
  return options
}

export async function main(args, hooks = {}) {
  const stages = []
  let writeRequested = false, cleanup = "not_requested", client, transport, activationMessages
  const record = (stage, status) => stages.push({ stage, status })
  try {
    const options = parseArguments(args)
    writeRequested = options.write
    const systemId = options["--profile"].toUpperCase()
    const className = options["--class"].toUpperCase()
    let profile
    try { profile = await (hooks.getProfile ?? (id => new ProfileStore().get(id)))(systemId); record("profile_lookup", "passed") }
    catch { record("profile_lookup", "failed"); throw Error("PROFILE_UNAVAILABLE") }
    if (profile.environment !== "development" || (writeRequested && profile.readOnly === true)) {
      record("profile_development_scope", "failed")
      throw Error("PROFILE_SCOPE")
    }
    record("profile_development_scope", "passed")
    try {
      const doctor = await (hooks.doctor ?? (() => exec(process.execPath, [entry, "doctor", systemId, "--include-components"],
        { cwd: root, maxBuffer: 8 * 1024 * 1024, timeout: 120000 })))()
      if (JSON.parse(doctor.stdout).ok !== true) throw Error("DOCTOR_INCOMPLETE")
      record("doctor_include_components", "passed")
    } catch { record("doctor_include_components", "failed") }
    client = hooks.client ?? new Client({ name: "private-cloud-acceptance", version: "1.0.0" })
    if (!hooks.client) {
      transport = new StdioClientTransport({ command: process.execPath,
        args: [entry, "serve", "--profile", systemId, "--toolsets", "all"], cwd: root,
        env: Object.fromEntries(Object.entries(process.env).filter(([, value]) => value !== undefined)), stderr: "pipe" })
      transport.stderr?.on("data", () => undefined)
      await client.connect(transport, { timeout: 30000 })
    }
    const call = async (stage, name, input) => {
      try {
        const result = await client.callTool({ name, arguments: input }, undefined, { timeout: 120000 })
        if (result.isError || result.structuredContent?.status !== "succeeded") { record(stage, "failed"); return undefined }
        const data = result.structuredContent.data
        const valid = stage === "tmp_create" ? data?.success === true
          : ["tmp_add_method", "tmp_dollar_patch"].includes(stage)
            ? data?.changed === true && Array.isArray(data.diagnostics) && !data.diagnostics.some(item => /^(E|A|X|ERROR)$/i.test(item.severity ?? ""))
            : stage === "tmp_declare_method" || stage === "tmp_active_read" ? hasRunMethod(data)
            : stage === "tmp_diagnose" ? data?.errorCount === 0
              : stage === "tmp_activate" ? data?.status === "complete" && Array.isArray(data.objectResults) && data.objectResults.length > 0 && data.objectResults.every(item => item.outcome === "activated")
                : stage === "tmp_delete" ? data?.executed === true : true
        record(stage, valid ? "passed" : "failed")
        return valid || stage === "tmp_activate" ? data : undefined
      } catch { record(stage, "failed"); return undefined }
    }
    const base = { systemId }
    await call("system_metadata", "sap.system.inspect", base)
    await call("package_search", "sap.repository.search", { ...base, pattern: options["--package-pattern"] ?? "Z*", objectTypes: ["DEVC"], limit: 10 })
    await call("class_search", "sap.repository.search", { ...base, pattern: className, objectTypes: ["CLAS"], limit: 10 })
    const source = await call("class_source", "sap.source.read", { ...base, objectName: className, objectType: "CLAS", lineCount: 50 })
    await call("class_structure", "sap.repository.inspect", { ...base, objectName: className, objectType: "CLAS", includeStructure: true })
    if (source?.resourceUri) {
      const atc = await call("atc_cached", "sap.quality.atc.cached", { fileUri: source.resourceUri })
      if (atc && !atc.count) stages[stages.length - 1].status = "unverified"
    } else record("atc_cached", "skipped")
    // This API executes ABAP Unit; there is no previous-run read endpoint here.
    record("unit_test_previous_result", "skipped")
    let transports, offset = 0, foundTransport = false, historyComplete = true
    const expectedTransport = process.env.SAP_ACCEPTANCE_OLD_TRANSPORT?.trim().toUpperCase()
    const seenOffsets = new Set()
    do {
      if (seenOffsets.has(offset)) { record("open_transport_search", "failed"); transports = undefined; break }
      seenOffsets.add(offset)
      transports = await call("open_transport_search", "sap.transport.list", { ...base, limit: 500, startIndex: offset })
      if (!transports) break
      historyComplete &&= transports.historyComplete === true
      if (expectedTransport && /^[A-Z0-9]{5,20}$/.test(expectedTransport)) {
        foundTransport ||= transports.transports?.some(item => item.number?.toUpperCase() === expectedTransport) === true
      }
      if (transports.truncated !== true) break
      if (!Number.isInteger(transports.nextStartIndex) || transports.nextStartIndex <= offset) {
        record("open_transport_search", "failed"); transports = undefined; break
      }
      offset = transports.nextStartIndex
    } while (true)
    if (transports?.historyComplete === false) record("old_transport_history_complete", "incomplete")
    else record("old_transport_history_complete", transports && historyComplete ? "passed" : "unverified")
    if (expectedTransport && /^[A-Z0-9]{5,20}$/.test(expectedTransport)) {
      record("known_old_transport", transports && foundTransport ? "passed" : "unverified")
    } else record("known_old_transport", "skipped")
    await call("dump_list", "sap.runtime.dump.list", { ...base, limit: 10 })
    await call("runtime_feed", "sap.runtime.feed.read", { ...base, kind: "catalog", limit: 10 })
    for (const stage of ["transport_release", "rap_generation", "v4_unpublish", "transport_object_add", "dictionary_check", "top_level_package_create"]) record(stage, "skipped")
    if (writeRequested) {
      const objectName = `ZCL_MCP_PC_${randomBytes(5).toString("hex").toUpperCase()}`
      let owned, sourceUri, objectUri
      cleanup = "uncertain"
      try {
        const created = await call("tmp_create", "sap.repository.create", { ...base, objectType: "CLAS/OC", name: objectName,
          description: "Private cloud acceptance temporary class", packageName: "$TMP", activate: false })
        if (!created) throw Error("CREATE_UNCERTAIN")
        const inspected = await call("tmp_ownership", "sap.repository.inspect", { ...base, objectName, objectType: "CLAS/OC" })
        const obj = inspected?.object
        if (obj?.name?.toUpperCase() !== objectName || obj?.type?.toUpperCase() !== "CLAS/OC" ||
            obj?.packageName?.toUpperCase() !== "$TMP" || typeof obj?.uri !== "string" ||
            obj.uri.toLowerCase() !== `/sap/bc/adt/oo/classes/${objectName.toLowerCase()}` ||
            typeof inspected?.sourceUri !== "string" || inspected.sourceUri.toLowerCase() !== `${obj.uri.toLowerCase()}/source/main`) throw Error("OWNERSHIP_UNCONFIRMED")
        objectUri = obj.uri; sourceUri = inspected.sourceUri; owned = true
        const skeleton = await call("tmp_source_read", "sap.source.read", { ...base, objectName, objectType: "CLAS", lineCount: 200 })
        const publicSection = /^[ \t]*PUBLIC SECTION\.[ \t]*$/gim
        const implementation = new RegExp(`^[ \\t]*CLASS[ \\t]+${objectName}[ \\t]+IMPLEMENTATION\\.[ \\t]*$`, "gim")
        if (typeof skeleton?.code !== "string" || skeleton.truncated || skeleton.nextLine != null ||
            [...skeleton.code.matchAll(publicSection)].length !== 1 || [...skeleton.code.matchAll(implementation)].length !== 1) throw Error("SKELETON_UNUSABLE")
        const stagedClass = skeleton.code
          .replace(publicSection, line => `${line}\n    METHODS run.`)
          .replace(implementation, line => `${line}\n  METHOD run.\n    \"MCP_MARKER\n  ENDMETHOD.`)
        if (!await call("tmp_add_method", "sap.source.patch", { ...base, fileUri: sourceUri, oldString: skeleton.code, newString: stagedClass, activate: false })) throw Error("PATCH_FAILED")
        const literal = "MCP_LITERAL $$ $& $1 $` $'"
        if (!await call("tmp_dollar_patch", "sap.source.patch", { ...base, fileUri: sourceUri, oldString: "MCP_MARKER", newString: literal, methodName: "RUN", activate: false })) throw Error("PATCH_FAILED")
        const stagedRead = await call("tmp_declare_method", "sap.source.read", { ...base, objectName, objectType: "CLAS", lineCount: 200 })
        if (!stagedRead) throw Error("STAGED_SOURCE_UNVERIFIED")
        if (!stagedRead.code.includes(literal)) {
          stages.findLast(item => item.stage === "tmp_dollar_patch").status = "failed"
          throw Error("STAGED_SOURCE_UNVERIFIED")
        }
        const diagnostic = await call("tmp_diagnose", "sap.source.diagnose", { ...base, fileUri: sourceUri })
        if (!diagnostic || diagnostic.errorCount !== 0) throw Error("DIAGNOSTIC_FAILED")
        const activation = await call("tmp_activate", "sap.source.activate", { ...base, resourceUris: [`adt://${systemId.toLowerCase()}${objectUri}`] })
        if (options.diagnostics && Array.isArray(activation?.messages)) {
          activationMessages = activation.messages.flatMap(message => {
            const type = message?.type, messageClass = message?.messageClass ?? message?.msgid, number = message?.messageNumber ?? message?.msgno
            return typeof type === "string" && /^[EAWXI]$/.test(type) && typeof messageClass === "string" && /^[A-Z][A-Z0-9_]{0,19}$/.test(messageClass) && typeof number === "string" && /^[0-9]{3}$/.test(number)
              ? [{ type, messageClass, number }] : []
          })
        }
        if (!activation || activation.status !== "complete" || stages.findLast(item => item.stage === "tmp_activate")?.status !== "passed") {
          const stage = stages.findLast(item => item.stage === "tmp_activate")
          if (stage) stage.status = "failed"
          throw Error("ACTIVATION_FAILED")
        }
        const verified = await call("tmp_active_read", "sap.source.read", { ...base, objectName, objectType: "CLAS", lineCount: 200, version: "active" })
        if (typeof verified?.code !== "string" || !verified.code.includes(literal)) { record("dollar_literal_preserved", "failed"); throw Error("LITERAL_MISMATCH") }
        record("dollar_literal_preserved", "passed")
      } catch { record("tmp_workflow", "incomplete") }
      finally {
        if (owned && sourceUri) {
          const plan = await call("tmp_delete_preview", "sap.repository.delete.preview", { ...base, fileUri: sourceUri })
          if (typeof plan?.planId === "string" && typeof plan?.confirmation === "string") {
            const deleted = await call("tmp_delete", "sap.repository.delete.execute", { planId: plan.planId, confirmation: plan.confirmation })
            // A successful deletion receipt is not proof of absence. Do not treat
            // arbitrary inspection errors as proof of nonexistence.
            if (deleted) {
              cleanup = "receipt_only_unverified"
              try {
                const check = await client.callTool({ name: "sap.repository.inspect", arguments: { ...base, objectName, objectType: "CLAS/OC" } }, undefined, { timeout: 120000 })
                const body = check.content?.find(item => item.type === "text")?.text
                if (check.isError && JSON.parse(body ?? "{}").code === "OBJECT_NOT_FOUND") {
                  cleanup = "verified_absent"; record("tmp_delete_verify", "passed")
                } else record("tmp_delete_verify", "unverified")
              } catch { record("tmp_delete_verify", "unverified") }
            }
          }
        }
      }
    }
  } catch { record("execution", "incomplete") }
  finally {
    await client?.close().catch(() => undefined)
    await transport?.close().catch(() => undefined)
  }
  const buildId = await runtimeBuildId()
  const report = evidence(stages, writeRequested, cleanup, buildId, activationMessages)
  await writeFile(hooks.outputFile ?? resolve(output), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600, flag: "wx" })
  return report
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const report = await main(process.argv.slice(2))
    process.exitCode = report.status === "failed" ? 1 : report.status === "incomplete" ? 2 : 0
  } catch { process.stderr.write("Acceptance could not write the sanitized evidence file.\n"); process.exitCode = 1 }
}

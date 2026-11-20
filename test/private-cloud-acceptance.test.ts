import assert from "node:assert/strict"
import test from "node:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"

const load = async () => import(pathToFileURL(resolve("scripts/run-private-cloud-acceptance.mjs")).href)
const skeleton = (name: string) => `CLASS ${name} DEFINITION PUBLIC.\n  PUBLIC SECTION.\nENDCLASS.\nCLASS ${name} IMPLEMENTATION.\nENDCLASS.`

test("private cloud evidence accepts only fixed labels, never backend text", async () => {
  const { evidence } = await load()
  const report = evidence([{ stage: "https://secret.example/user", status: "PRIVATE_SOURCE" }], true, "DEVK900123")
  const json = JSON.stringify(report)
  assert.equal(json.includes("secret.example"), false)
  assert.equal(json.includes("PRIVATE_SOURCE"), false)
  assert.equal(json.includes("DEVK900123"), false)
  assert.equal(report.status, "incomplete")
})

test("private cloud write flow targets the owned temporary class and stores no SAP data", async t => {
  const directory = await mkdtemp(join(tmpdir(), "private-cloud-test-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const { main } = await load()
  const calls: Array<{ name: string; arguments: any }> = []
  let created = "", staged = "", deleted = false, activated = false
  const client = {
    async close() {},
    async callTool(request: { name: string; arguments: any }) {
      calls.push(request)
      const a = request.arguments
      const ok = (data: any) => ({ structuredContent: { status: "succeeded", data }, content: [] })
      if (request.name === "sap.repository.create") { created = a.name; staged = skeleton(created); return ok({ success: true }) }
      if (request.name === "sap.repository.inspect" && a.objectName === created) {
        if (deleted) return { isError: true, content: [{ type: "text", text: '{"code":"OBJECT_NOT_FOUND"}' }] }
        const uri = `/sap/bc/adt/oo/classes/${created.toLowerCase()}`
        return ok({ object: { name: created, type: "CLAS/OC", packageName: "$TMP", uri }, sourceUri: `${uri}/source/main` })
      }
      if (request.name === "sap.source.read") {
        if (a.objectName === created) return ok({ code: a.version === "active" && !activated ? skeleton(created) : staged, truncated: false })
        return ok({ code: "PRIVATE_SOURCE", resourceUri: "adt://dev100/sap/bc/adt/oo/classes/private/source/main" })
      }
      if (request.name === "sap.source.diagnose") return ok({ errorCount: 0 })
      if (request.name === "sap.source.patch") {
        assert.ok(staged.includes(a.oldString))
        staged = staged.replace(a.oldString, () => a.newString)
        assert.match(staged, /METHODS run\./)
        assert.match(staged, /METHOD run\./)
        return ok({ changed: true, diagnostics: [] })
      }
      if (request.name === "sap.source.activate") { activated = true; return ok({ status: "complete", objectResults: [{ outcome: "activated" }] }) }
      if (request.name === "sap.repository.delete.preview") return ok({ planId: "SECRET_PLAN", confirmation: "SECRET_CONFIRMATION" })
      if (request.name === "sap.repository.delete.execute") { deleted = true; return ok({ executed: true }) }
      if (request.name === "sap.quality.atc.cached") return ok({ count: 0 })
      return ok({ user: "PRIVATE_USER", transport: "DEVK900123", hostname: "secret.example" })
    }
  }
  const outputFile = join(directory, "evidence.json")
  const report = await main(["--profile", "DEV100", "--class", "ZCL_PRIVATE", "--allow-tmp-write"], {
    getProfile: async () => ({ environment: "development" }), doctor: async () => ({ stdout: '{"ok":true}' }), client, outputFile
  })
  assert.equal(report.cleanup, "verified_absent")
  assert.equal(report.status, "incomplete")
  assert.equal("activationMessages" in report, false)
  assert.match(report.buildId, /^[a-f0-9]{64}$/)
  assert.ok(calls.some(call => call.name === "sap.source.patch" && call.arguments.methodName === "RUN"))
  assert.equal(calls.filter(call => call.name === "sap.source.patch").length, 2)
  assert.ok(calls.some(call => call.name === "sap.source.read" && call.arguments.version === "active"))
  assert.ok(calls.some(call => call.name === "sap.repository.delete.execute"))
  const json = await readFile(outputFile, "utf8")
  for (const secret of ["PRIVATE_SOURCE", "PRIVATE_USER", "ZCL_PRIVATE", "DEVK900123", "secret.example", created, "SECRET_PLAN", "SECRET_CONFIRMATION"]) assert.equal(json.includes(secret), false)
})

test("private cloud preflight refuses production before creating a client", async t => {
  const directory = await mkdtemp(join(tmpdir(), "private-cloud-prod-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const { main } = await load()
  let doctorCalled = false
  const report = await main(["--profile", "PROD", "--class", "ZCL_PRIVATE", "--allow-tmp-write"], {
    getProfile: async () => ({ environment: "production" }), doctor: async () => { doctorCalled = true }, outputFile: join(directory, "evidence.json")
  })
  assert.equal(doctorCalled, false)
  assert.equal(report.status, "failed")
  assert.equal(report.cleanup, "not_requested")
})

test("private cloud preflight records a profile failure without exposing its error", async t => {
  const directory = await mkdtemp(join(tmpdir(), "private-cloud-profile-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const { main } = await load()
  const outputFile = join(directory, "evidence.json")
  const report = await main(["--profile", "DEV100", "--class", "ZCL_PRIVATE"], {
    getProfile: async () => { throw new Error("https://secret.example PRIVATE_USER") }, outputFile
  })
  assert.equal(report.status, "failed")
  assert.ok(report.stages.some((stage: any) => stage.stage === "profile_lookup" && stage.status === "failed"))
  assert.doesNotMatch(await readFile(outputFile, "utf8"), /secret\.example|PRIVATE_USER|ZCL_PRIVATE/)
})

test("transport listing follows bounded pages without exposing entries", async t => {
  const directory = await mkdtemp(join(tmpdir(), "private-pages-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const { main } = await load()
  const pages: number[] = []
  const client = { async close() {}, async callTool(request: any) {
    if (request.name === "sap.transport.list") {
      assert.equal(request.arguments.limit, 500)
      pages.push(request.arguments.startIndex)
      return { structuredContent: { status: "succeeded", data: { transports: [], historyComplete: true,
        truncated: pages.length === 1, nextStartIndex: pages.length === 1 ? 500 : null } }, content: [] }
    }
    return { structuredContent: { status: "succeeded", data: {} }, content: [] }
  } }
  const report = await main(["--profile", "DEV100", "--class", "ZCL_PRIVATE"], {
    getProfile: async () => ({ environment: "development" }), doctor: async () => ({ stdout: '{"ok":true}' }), client, outputFile: join(directory, "result.json")
  })
  assert.deepEqual(pages, [0, 500])
  assert.equal(report.stages.filter((s: any) => s.stage === "open_transport_search" && s.status === "passed").length, 2)
})

test("failed activation stays failed and diagnostic output contains only allowed fields", async t => {
  const directory = await mkdtemp(join(tmpdir(), "private-activation-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const { main } = await load()
  let created = "", staged = "", deleted = false, activeReads = 0
  const client = { async close() {}, async callTool(request: any) {
    const a = request.arguments
    const ok = (data: any) => ({ structuredContent: { status: "succeeded", data }, content: [] })
    if (request.name === "sap.repository.create") { created = a.name; staged = skeleton(created); return ok({ success: true }) }
    if (request.name === "sap.repository.inspect" && a.objectName === created) {
      if (deleted) return { isError: true, content: [{ type: "text", text: '{"code":"OBJECT_NOT_FOUND"}' }] }
      const uri = `/sap/bc/adt/oo/classes/${created.toLowerCase()}`
      return ok({ object: { name: created, type: "CLAS/OC", packageName: "$TMP", uri }, sourceUri: `${uri}/source/main` })
    }
    if (request.name === "sap.source.read") {
      if (a.version === "active") activeReads++
      return ok({ code: staged, truncated: false })
    }
    if (request.name === "sap.source.patch") {
      staged = staged.replace(a.oldString, () => a.newString)
      return ok({ changed: true, diagnostics: [] })
    }
    if (request.name === "sap.source.diagnose") return ok({ errorCount: 0 })
    if (request.name === "sap.source.activate") return ok({ status: "failed", objectResults: [{ outcome: "failed" }], messages: [
      { type: "E", msgid: "AB", msgno: "123", shortText: "SECRET_SOURCE" },
      { type: "W", msgid: "PRIVATE/NAME", msgno: "999", shortText: "SECRET_USER" }
    ] })
    if (request.name === "sap.repository.delete.preview") return ok({ planId: "PLAN", confirmation: "CONFIRM" })
    if (request.name === "sap.repository.delete.execute") { deleted = true; return ok({ executed: true }) }
    return ok({})
  } }
  const file = join(directory, "result.json")
  const report = await main(["--profile", "DEV100", "--class", "ZCL_PRIVATE", "--allow-tmp-write", "--activation-diagnostics"], {
    getProfile: async () => ({ environment: "development" }), doctor: async () => ({ stdout: '{"ok":true}' }), client, outputFile: file
  })
  assert.equal(report.stages.find((s: any) => s.stage === "tmp_activate").status, "failed")
  assert.equal(activeReads, 0)
  assert.deepEqual(report.activationMessages, [{ type: "E", messageClass: "AB", number: "123" }])
  assert.doesNotMatch(await readFile(file, "utf8"), /SECRET_SOURCE|SECRET_USER|PRIVATE\/NAME/)
})

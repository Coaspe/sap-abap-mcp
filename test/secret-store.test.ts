import assert from "node:assert/strict"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { delimiter, join } from "node:path"
import test from "node:test"
import {
  EnvironmentSecretStore,
  WindowsDpapiSecretStore,
  createDefaultSecretStore,
  type WindowsDpapiOperation,
  type WindowsDpapiRunner
} from "../src/secret-store.js"

function fakeDpapiRunner(
  calls: Array<{ operation: WindowsDpapiOperation; input: string }>
): WindowsDpapiRunner {
  return async (operation, input) => {
    calls.push({ operation, input })
    if (operation === "protect") return `dpapi:${Buffer.from(input).toString("base64")}`
    return Buffer.from(input.slice("dpapi:".length), "base64").toString("utf8")
  }
}

test("WindowsDpapiSecretStore protects, isolates, and deletes profile secrets", async t => {
  const directory = await mkdtemp(join(tmpdir(), "sap-abap-mcp-dpapi-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const calls: Array<{ operation: WindowsDpapiOperation; input: string }> = []
  const store = new WindowsDpapiSecretStore(directory, fakeDpapiRunner(calls))

  await store.set("dev-100", "dev-secret")
  await store.set("QAS200", "qas-secret")

  const encryptedDev = await readFile(join(directory, "DEV-100.dpapi"), "utf8")
  assert.equal(encryptedDev.includes("dev-secret"), false)
  assert.equal(await store.get("DEV-100"), "dev-secret")
  assert.equal(await store.get("qas200"), "qas-secret")
  assert.deepEqual(
    calls.map(call => call.operation),
    ["protect", "protect", "unprotect", "unprotect"]
  )

  await store.delete("DEV-100")
  await store.delete("DEV-100")
  assert.equal(await store.get("DEV-100"), undefined)
  assert.equal(await store.get("QAS200"), "qas-secret")
})

test("WindowsDpapiSecretStore prefers a profile environment secret", async t => {
  const directory = await mkdtemp(join(tmpdir(), "sap-abap-mcp-dpapi-env-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const calls: Array<{ operation: WindowsDpapiOperation; input: string }> = []
  const store = new WindowsDpapiSecretStore(directory, fakeDpapiRunner(calls))
  const name = "SAP_ABAP_MCP_PASSWORD_DEV_100"
  const previous = process.env[name]
  process.env[name] = "environment-secret"
  t.after(() => {
    if (previous === undefined) delete process.env[name]
    else process.env[name] = previous
  })

  assert.equal(await store.get("dev-100"), "environment-secret")
  assert.deepEqual(calls, [])
})

test("createDefaultSecretStore selects DPAPI on Windows", () => {
  assert.ok(createDefaultSecretStore("win32") instanceof WindowsDpapiSecretStore)
})

test("EnvironmentSecretStore reads profile secrets without persisting them", async t => {
  const name = "SAP_ABAP_MCP_PASSWORD_DEV_100"
  const previous = process.env[name]
  process.env[name] = "environment-secret"
  t.after(() => {
    if (previous === undefined) delete process.env[name]
    else process.env[name] = previous
  })

  const store = new EnvironmentSecretStore()
  assert.equal(await store.get("dev-100"), "environment-secret")
  await assert.rejects(
    () => store.set("DEV-100", "secret"),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      (error as { code: string }).code === "SECRET_STORE_READ_ONLY"
  )
  await assert.rejects(
    () => store.delete("DEV-100"),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      (error as { code: string }).code === "SECRET_STORE_READ_ONLY"
  )
})

test("createDefaultSecretStore selects environment-only storage on Linux", () => {
  assert.ok(createDefaultSecretStore("linux") instanceof EnvironmentSecretStore)
})

test("WindowsDpapiSecretStore rejects profile IDs that could escape the secrets directory", async () => {
  const store = new WindowsDpapiSecretStore("ignored", async () => "ignored")
  await assert.rejects(
    () => store.set("../DEV100", "secret"),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      (error as { code: string }).code === "SECRET_PROFILE_ID_INVALID"
  )
})


test("native Windows DPAPI ignores an incompatible inherited PowerShell module path", { skip: process.platform !== "win32" }, async t => {
  const directory = await mkdtemp(join(tmpdir(), "sap-dpapi-module-shadow-"))
  const modules = join(directory, "modules")
  const shadow = join(modules, "Microsoft.PowerShell.Security")
  await mkdir(shadow, { recursive: true })
  await writeFile(join(shadow, "Microsoft.PowerShell.Security.psd1"),
    "@{ RootModule='shadow.psm1'; ModuleVersion='9999.0'; FunctionsToExport=@('ConvertTo-SecureString','ConvertFrom-SecureString') }")
  await writeFile(join(shadow, "shadow.psm1"), "throw 'INCOMPATIBLE_INHERITED_SECURITY_MODULE'")
  const previous = process.env.PSModulePath
  process.env.PSModulePath = modules + (previous ? delimiter + previous : "")
  const store = new WindowsDpapiSecretStore(join(directory, "secrets"))
  t.after(async () => {
    if (previous === undefined) delete process.env.PSModulePath
    else process.env.PSModulePath = previous
    await rm(directory, { recursive: true, force: true })
  })
  const value = '  public-native-fixture " 한국어\ntrailing  '
  await store.set("MODULE_SHADOW", value)
  assert.equal(await store.get("MODULE_SHADOW"), value)
  await store.delete("MODULE_SHADOW")
  assert.equal(await store.get("MODULE_SHADOW"), undefined)
})

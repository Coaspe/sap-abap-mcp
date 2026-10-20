import { randomBytes } from "node:crypto"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createDefaultSecretStore } from "../dist/src/secret-store.js"
import { execFileSync } from "node:child_process"

if (!["darwin", "win32"].includes(process.platform)) {
  console.log(JSON.stringify({ status: "not_run", reason: "Requires native macOS Keychain or Windows DPAPI" }))
} else {
  const directory = await mkdtemp(join(tmpdir(), "sap-native-store-"))
  process.env.SAP_ABAP_MCP_HOME = directory
  const store = createDefaultSecretStore(), id = `INSTALLVERIFY_${randomBytes(8).toString("hex").toUpperCase()}`
  const report = { observedAt: new Date().toISOString(), platform: process.platform, scope: "throwaway-native-store",
    cases: [], renewal: false, removed: false, sapAuthenticated: false }
  try {
    if (process.platform === "darwin") {
      // Public fixture, not a secret: prove compatibility with the old CLI-created item.
      execFileSync("/usr/bin/security", ["add-generic-password", "-a", id, "-s", "sap-abap-mcp", "-w", "public-fixture"], { stdio: "pipe" })
      report.legacyItemReadable = await store.get(id) === "public-fixture"
    }
    for (const value of [randomBytes(32).toString("hex"), '  한국어 " \\ ; $()\ntrailing  ', randomBytes(4500).toString("hex")]) {
      await store.set(id, value)
      report.cases.push({ bytes: Buffer.byteLength(value), roundtrip: await store.get(id) === value })
    }
    const renewed = randomBytes(40).toString("hex")
    await store.set(id, renewed)
    report.renewal = await store.get(id) === renewed
  } finally {
    await store.delete(id)
    report.removed = await store.get(id) === undefined
    await rm(directory, { recursive: true, force: true })
  }
  console.log(JSON.stringify(report, null, 2))
  if (!report.cases.every(value => value.roundtrip) || !report.renewal || !report.removed || report.legacyItemReadable === false) process.exitCode = 1
}

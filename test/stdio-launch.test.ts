import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { ProfileStore } from "../src/profile-store.js"

const entry = fileURLToPath(new URL("../src/index.js", import.meta.url))

for (const args of [[], ["serve"]]) {
  for (const configured of [false, true]) {
    test(`stdio ${args.join(" ") || "no arguments"}: configured=${configured}`, async t => {
      const home = await mkdtemp(join(tmpdir(), "sap MCP 한글 "))
      t.after(() => rm(home, { recursive: true, force: true }))
      if (configured) await new ProfileStore(home).upsert({
        id: "DEV100", url: "https://sap.invalid", client: "100", readOnly: true
      })
      const client = new Client({ name: "installation-contract", version: "1" })
      const transport = new StdioClientTransport({ command: process.execPath,
        args: [entry, ...args], env: { ...getDefaultEnvironment(), SAP_ABAP_MCP_HOME: home }, stderr: "pipe" })
      let stderr = ""
      transport.stderr?.on("data", chunk => { stderr += String(chunk) })
      t.after(async () => { await client.close(); await transport.close() })
      await client.connect(transport, { timeout: 5000 })
      assert.equal((await client.listTools()).tools.length, 5)
      assert.equal(client.getInstructions()?.includes("SETUP_REQUIRED"), !configured)
      assert.doesNotMatch(stderr, /password:|sap-abap-mcp\n|Commands:/i)
    })
  }
}

test("explicit help and invalid commands retain CLI behavior", () => {
  const help = spawnSync(process.execPath, [entry, "--help"], { encoding: "utf8" })
  assert.equal(help.status, 0)
  assert.match(help.stdout, /Commands:/)
  const invalid = spawnSync(process.execPath, [entry, "not-a-command"], { encoding: "utf8" })
  assert.equal(invalid.status, 1)
  assert.equal(invalid.stdout, "")
  assert.match(invalid.stderr, /UNKNOWN_COMMAND/)
})

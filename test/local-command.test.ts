import assert from "node:assert/strict"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { runLocalCommand } from "../src/onboard.js"

test("local commands preserve Unicode and shell metacharacters as arguments", async () => {
  const args = ["가 나", 'quote"value', "%PATH%", "a&b|c", "(value)", "trailing\\"]
  const result = await runLocalCommand(process.execPath, ["-e", "process.stdout.write(JSON.stringify(process.argv.slice(1)))", ...args])
  assert.equal(result.ok, true, result.stderr)
  assert.deepEqual(JSON.parse(result.stdout), args)
})

test("local commands report missing executables and excessive output", async () => {
  const missing = await runLocalCommand("sap-mcp-nonexistent-command-20261008", [])
  assert.equal(missing.ok, false)
  assert.equal(missing.missing, true)
  const excessive = await runLocalCommand(process.execPath, ["-e", "process.stdout.write('x'.repeat(2 * 1024 * 1024))"])
  assert.equal(excessive.ok, false)
  assert.ok(Buffer.byteLength(excessive.stdout) <= 1024 * 1024)
})

test("Windows npm-style command shims preserve arguments without executing operators", { skip: process.platform !== "win32" }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "sap command fixture "))
  try {
    const entry = join(dir, "echo-args.js")
    const captured = join(dir, "arguments.json")
    await writeFile(entry, "#!/usr/bin/env node\nrequire('node:fs').writeFileSync(process.argv[2], JSON.stringify(process.argv.slice(3)))")
    const shimBase = join(dir, "echo-args")
    const command = `${shimBase}.cmd`
    const cmdShim = createRequire(import.meta.url)("cmd-shim") as (source: string, target: string) => Promise<void>
    await cmdShim(entry, shimBase)
    const args = ["가 나", 'quote"value', "%PATH%", "a&b|c", "(value)", "trailing\\"]
    const result = await runLocalCommand(command, [captured, ...args])
    assert.equal(result.ok, true, result.stderr)
    assert.deepEqual(JSON.parse(await readFile(captured, "utf8")), args)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

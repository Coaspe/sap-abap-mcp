import { readFile, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const manifestPath = join(root, "lhm.plugin.json")
const packagePath = join(root, "package.json")
const mode = process.argv[2]

if (!["--check", "--write"].includes(mode)) {
  throw new Error("Usage: node scripts/sync-lobehub-manifest.mjs --check|--write")
}

const client = new Client({ name: "lobehub-manifest", version: "1.0.0" })
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(root, "dist", "src", "index.js"), "serve"],
  cwd: root,
  stderr: "pipe"
})

try {
  await client.connect(transport)
  const tools = []
  let cursor
  do {
    const result = await client.listTools(cursor ? { cursor } : undefined)
    tools.push(...result.tools)
    cursor = result.nextCursor
  } while (cursor)
  tools.sort((left, right) => left.name.localeCompare(right.name))

  const [manifest, packageJson] = await Promise.all([
    readFile(manifestPath, "utf8").then(JSON.parse),
    readFile(packagePath, "utf8").then(JSON.parse)
  ])
  const next = { ...manifest, tools, version: packageJson.version }
  const serialized = `${JSON.stringify(next, null, 2)}\n`
  const current = `${JSON.stringify(manifest, null, 2)}\n`

  if (mode === "--check") {
    if (serialized !== current) {
      throw new Error("LobeHub manifest is stale. Run: npm run sync:lobehub")
    }
    console.log(`LobeHub manifest matches ${tools.length} runtime tools.`)
  } else {
    await writeFile(manifestPath, serialized)
    console.log(`Updated LobeHub manifest with ${tools.length} runtime tools.`)
  }
} finally {
  await client.close().catch(() => undefined)
}

import { readFile, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const manifestPath = join(root, "mcpb", "manifest.json")
const mode = process.argv[2]

if (!["--check", "--write", "--smithery-payload"].includes(mode)) {
  throw new Error(
    "Usage: node scripts/sync-mcpb-tools.mjs --check|--write|--smithery-payload"
  )
}

const client = new Client({ name: "mcpb-tool-catalog", version: "1.0.0" })
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(root, "dist", "src", "index.js"), "serve"],
  cwd: root,
  stderr: "pipe"
})
let serverStderr = ""
transport.stderr?.on("data", chunk => {
  serverStderr += chunk.toString()
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

  const catalog = tools.map(tool => {
    if (!tool.name.trim()) throw new Error("MCP tools/list returned an empty tool name")
    if (!tool.description?.trim()) {
      throw new Error(`MCP tool is missing a description: ${tool.name}`)
    }
    return { name: tool.name, description: tool.description }
  }).sort((left, right) => left.name.localeCompare(right.name))

  if (new Set(catalog.map(tool => tool.name)).size !== catalog.length) {
    throw new Error("MCP tools/list returned duplicate tool names")
  }

  const manifest = JSON.parse(await readFile(manifestPath, "utf8"))
  if (mode === "--smithery-payload") {
    console.log(JSON.stringify({
      type: "stdio",
      runtime: "node",
      serverCard: {
        serverInfo: client.getServerVersion() ?? {
          name: manifest.name,
          version: manifest.version
        },
        tools
      }
    }))
  } else {
    const matches = manifest.tools_generated === false &&
      JSON.stringify(manifest.tools) === JSON.stringify(catalog)

    if (mode === "--check") {
      if (!matches) {
        throw new Error("MCPB tool catalog is stale. Run: npm run sync:mcpb-tools")
      }
      console.log(`MCPB tool catalog matches ${catalog.length} runtime tools.`)
    } else {
      manifest.tools = catalog
      manifest.tools_generated = false
      await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
      console.log(`Updated MCPB tool catalog with ${catalog.length} runtime tools.`)
    }
  }
} catch (error) {
  if (serverStderr.trim()) process.stderr.write(`${serverStderr.trim()}\n`)
  throw error
} finally {
  await client.close().catch(() => undefined)
}

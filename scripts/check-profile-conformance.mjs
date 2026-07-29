import { readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { evaluateProfile } from "../dist/src/profile-conformance.js"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const profile = JSON.parse(
  await readFile(join(root, "spec", "sap-abap-mcp-profile-v1.json"), "utf8")
)

function parseLaunchArguments(argv) {
  let command = process.execPath
  let args = [join(root, "dist", "src", "index.js"), "serve"]

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    const value = argv[index + 1]
    if (flag === "--command" && value) {
      command = value
      index += 1
    } else if (flag === "--args-json" && value) {
      const parsed = JSON.parse(value)
      if (!Array.isArray(parsed) || parsed.some(item => typeof item !== "string")) {
        throw new Error("--args-json must be a JSON array of strings")
      }
      args = parsed
      index += 1
    } else {
      throw new Error(`Unknown or incomplete argument: ${flag}`)
    }
  }
  return { command, args }
}

async function collectPages(call) {
  const items = []
  let cursor
  do {
    const result = await call(cursor)
    items.push(...result.items)
    cursor = result.nextCursor
  } while (cursor)
  return items
}

let client
try {
  const launch = parseLaunchArguments(process.argv.slice(2))
  client = new Client({
    name: "sap-abap-mcp-profile-conformance",
    version: profile.version
  })
  const transport = new StdioClientTransport({
    ...launch,
    cwd: process.cwd(),
    stderr: "pipe"
  })
  await client.connect(transport)

  const tools = await collectPages(async cursor => {
    const result = await client.listTools(cursor ? { cursor } : undefined)
    return { items: result.tools, nextCursor: result.nextCursor }
  })
  const resources = await collectPages(async cursor => {
    const result = await client.listResources(cursor ? { cursor } : undefined)
    return { items: result.resources, nextCursor: result.nextCursor }
  })
  const resourceTemplates = await collectPages(async cursor => {
    const result = await client.listResourceTemplates(
      cursor ? { cursor } : undefined
    )
    return { items: result.resourceTemplates, nextCursor: result.nextCursor }
  })
  const result = evaluateProfile(profile, {
    server: client.getServerVersion() ?? {
      name: "unknown",
      version: "unknown"
    },
    tools,
    resources: [...resources, ...resourceTemplates]
  })

  console.log(JSON.stringify({
    generatedAt: new Date().toISOString(),
    discoveryOnly: true,
    ...result
  }, null, 2))
  if (!result.passed) process.exitCode = 1
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  console.error(JSON.stringify({
    passed: false,
    error: "CONFORMANCE_INSPECTION_FAILED",
    message
  }, null, 2))
  process.exitCode = 2
} finally {
  await client?.close().catch(() => undefined)
}

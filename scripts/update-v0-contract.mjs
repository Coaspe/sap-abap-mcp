import { writeFile } from "node:fs/promises"
import {
  advertisedTools,
  stableToolSurface
} from "../dist/test/helpers/mcp-surface.js"

const tools = await advertisedTools({ apiVersion: "v0" })

await writeFile(
  "test/fixtures/v0-tool-surface.json",
  `${JSON.stringify(stableToolSurface(tools), null, 2)}\n`,
  "utf8"
)

await writeFile(
  "test/fixtures/v0-tool-order.json",
  `${JSON.stringify(tools.map(tool => tool.name), null, 2)}\n`,
  "utf8"
)

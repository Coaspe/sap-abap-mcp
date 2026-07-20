import { writeFile } from "node:fs/promises"
import {
  advertisedTools,
  stableToolSurface
} from "../dist/test/helpers/mcp-surface.js"

await writeFile(
  "test/fixtures/v0-tool-surface.json",
  `${JSON.stringify(stableToolSurface(await advertisedTools()), null, 2)}\n`,
  "utf8"
)

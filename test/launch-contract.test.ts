import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { onboardLaunch, packageLaunch, PACKAGE_NAME, PACKAGE_VERSION, STDIO_COMMAND } from "../src/launch-contract.js"

test("registry, repository plugin and Windows use the canonical stdio contract", () => {
  const registry = JSON.parse(readFileSync("server.json", "utf8"))
  assert.equal(registry.packages[0].identifier, PACKAGE_NAME)
  assert.equal(registry.packages[0].version, PACKAGE_VERSION)
  assert.equal(registry.packages[0].packageArguments[0].value, STDIO_COMMAND)
  const plugin = JSON.parse(readFileSync("plugins/sap-abap-mcp/.mcp.json", "utf8"))
  assert.deepEqual(plugin.mcpServers["sap-abap"], packageLaunch("darwin"))
  assert.deepEqual(packageLaunch("win32"), { ...packageLaunch("darwin"), command: "npx.cmd" })
  assert.throws(() => packageLaunch("darwin", "latest"), /exact package version/)
  const desktop = JSON.parse(readFileSync("mcpb/manifest.json", "utf8"))
  assert.equal(desktop.server.mcp_config.args[1], STDIO_COMMAND)
})

test("npm-cache onboarding pins the package while a stable checkout keeps its actual preview", () => {
  assert.deepEqual(onboardLaunch("/cache/_npx/x/node_modules/@coaspe/sap-abap-mcp/dist/src/index.js", "darwin", ["serve"]), packageLaunch("darwin"))
  assert.deepEqual(onboardLaunch("C:\\cache\\node_modules\\@coaspe\\sap-abap-mcp\\dist\\src\\index.js", "win32", ["serve"]), packageLaunch("win32"))
  assert.deepEqual(onboardLaunch("/workspace 한글/dist/src/index.js", "darwin", ["serve", "--profile", "DEV"]),
    { command: "node", args: ["/workspace 한글/dist/src/index.js", "serve", "--profile", "DEV"] })
})

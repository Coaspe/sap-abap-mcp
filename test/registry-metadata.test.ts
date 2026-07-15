import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const registryName = "io.github.Coaspe/sap-abap-mcp"

test("distribution metadata stays consistent across npm and the official MCP Registry", () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"))
  const serverJson = JSON.parse(readFileSync("server.json", "utf8"))

  assert.equal(packageJson.version, "0.4.4")
  assert.equal(packageJson.mcpName, registryName)
  assert.equal(packageJson.license, "MIT")
  assert.deepEqual(packageJson.repository, {
    type: "git",
    url: "git+https://github.com/Coaspe/sap-abap-mcp.git"
  })
  assert.equal(packageJson.homepage, "https://github.com/Coaspe/sap-abap-mcp#readme")
  assert.equal(packageJson.bugs.url, "https://github.com/Coaspe/sap-abap-mcp/issues")
  for (const keyword of ["mcp", "sap", "abap", "adt", "claude", "codex"]) {
    assert.ok(packageJson.keywords.includes(keyword), `missing npm keyword: ${keyword}`)
  }
  for (const packagedFile of [
    "LICENSE",
    "PRIVACY.md",
    "TERMS.md",
    "server.json",
    "llms-install.md",
    "assets"
  ]) {
    assert.ok(packageJson.files.includes(packagedFile), `missing packaged file: ${packagedFile}`)
  }

  assert.equal(
    serverJson.$schema,
    "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json"
  )
  assert.equal(serverJson.name, registryName)
  assert.equal(serverJson.title, "SAP ABAP MCP")
  assert.equal(serverJson.version, packageJson.version)
  assert.ok(serverJson.description.length <= 100)
  assert.equal(serverJson.websiteUrl, "https://github.com/Coaspe/sap-abap-mcp")
  assert.deepEqual(serverJson.repository, {
    url: "https://github.com/Coaspe/sap-abap-mcp",
    source: "github",
    id: "1298968443"
  })
  assert.deepEqual(serverJson.icons, [{
    src: "https://raw.githubusercontent.com/Coaspe/sap-abap-mcp/main/assets/directory-icon.png",
    mimeType: "image/png",
    sizes: ["400x400"]
  }])
  assert.deepEqual(serverJson.packages, [{
    registryType: "npm",
    identifier: packageJson.name,
    version: packageJson.version,
    transport: { type: "stdio" },
    packageArguments: [{ type: "positional", value: "serve" }]
  }])
})

test("distribution assets contain the selected license and a 400 by 400 PNG icon", () => {
  const license = readFileSync("LICENSE", "utf8")
  assert.match(license, /^MIT License\n/)
  assert.match(license, /Copyright \(c\) 2026 Coaspe/)
  assert.match(license, /Permission is hereby granted, free of charge/)

  const icon = readFileSync("assets/directory-icon.png")
  assert.deepEqual([...icon.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10])
  assert.equal(icon.readUInt32BE(16), 400)
  assert.equal(icon.readUInt32BE(20), 400)
})

test("MCPB metadata launches the bundled local server on supported secret-store platforms", () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"))
  const manifest = JSON.parse(readFileSync("mcpb/manifest.json", "utf8"))

  assert.equal(manifest.manifest_version, "0.4")
  assert.equal(manifest.name, "sap-abap-mcp")
  assert.equal(manifest.display_name, "SAP ABAP MCP")
  assert.equal(manifest.version, packageJson.version)
  assert.equal(manifest.license, "MIT")
  assert.equal(manifest.icon, "icon.png")
  assert.equal(manifest.server.type, "node")
  assert.equal(manifest.server.entry_point, "server/index.mjs")
  assert.deepEqual(manifest.server.mcp_config, {
    command: "node",
    args: ["${__dirname}/server/index.mjs", "serve"]
  })
  assert.deepEqual(manifest.compatibility.platforms, ["darwin", "win32"])
  assert.equal(manifest.compatibility.runtimes.node, ">=20")
  assert.equal(manifest.tools_generated, true)
  assert.deepEqual(manifest.tools, [])
  assert.deepEqual(manifest.privacy_policies, [
    "https://github.com/Coaspe/sap-abap-mcp/blob/main/PRIVACY.md"
  ])
  const readme = readFileSync("README.md", "utf8")
  assert.match(readme, /^## Privacy Policy$/m)
  const privacy = readFileSync("PRIVACY.md", "utf8")
  for (const heading of [
    "Data processed by the software",
    "How data is used",
    "Storage and retention",
    "Sharing",
    "Contact"
  ]) {
    assert.match(privacy, new RegExp(`^## ${heading}$`, "m"))
  }
  const mcpbIcon = readFileSync("mcpb/icon.png")
  assert.equal(mcpbIcon.readUInt32BE(16), 512)
  assert.equal(mcpbIcon.readUInt32BE(20), 512)
})

test("Claude Code and Codex plugins launch the same published local MCP package", () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"))
  const codexManifest = JSON.parse(
    readFileSync("plugins/sap-abap-mcp/.codex-plugin/plugin.json", "utf8")
  )
  const claudeManifest = JSON.parse(
    readFileSync("plugins/sap-abap-mcp/.claude-plugin/plugin.json", "utf8")
  )
  const mcpConfig = JSON.parse(readFileSync("plugins/sap-abap-mcp/.mcp.json", "utf8"))
  const codexMarketplace = JSON.parse(readFileSync(".agents/plugins/marketplace.json", "utf8"))
  const claudeMarketplace = JSON.parse(readFileSync(".claude-plugin/marketplace.json", "utf8"))

  assert.equal(codexManifest.name, "sap-abap-mcp")
  assert.equal(codexManifest.version, packageJson.version)
  assert.equal(codexManifest.license, "MIT")
  assert.equal(codexManifest.mcpServers, "./.mcp.json")
  assert.equal(
    codexManifest.interface.privacyPolicyURL,
    "https://github.com/Coaspe/sap-abap-mcp/blob/main/PRIVACY.md"
  )
  assert.equal(
    codexManifest.interface.termsOfServiceURL,
    "https://github.com/Coaspe/sap-abap-mcp/blob/main/TERMS.md"
  )
  assert.equal(claudeManifest.name, codexManifest.name)
  assert.equal(claudeManifest.version, packageJson.version)
  assert.equal(claudeManifest.license, "MIT")
  assert.deepEqual(mcpConfig, {
    mcpServers: {
      "sap-abap": {
        command: "npx",
        args: [
          "--yes",
          "--prefer-online",
          "@coaspe/sap-abap-mcp@latest",
          "serve"
        ]
      }
    }
  })

  assert.equal(codexMarketplace.name, "coaspe-sap")
  assert.deepEqual(codexMarketplace.plugins[0], {
    name: "sap-abap-mcp",
    source: { source: "local", path: "./plugins/sap-abap-mcp" },
    policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
    category: "Developer Tools"
  })
  assert.equal(claudeMarketplace.name, codexMarketplace.name)
  assert.equal(claudeMarketplace.plugins[0].name, codexManifest.name)
  assert.equal(claudeMarketplace.plugins[0].source, "./plugins/sap-abap-mcp")

  const pluginIcon = readFileSync("plugins/sap-abap-mcp/assets/icon.png")
  assert.equal(pluginIcon.readUInt32BE(16), 400)
  assert.equal(pluginIcon.readUInt32BE(20), 400)
  assert.deepEqual(pluginIcon, readFileSync("assets/directory-icon.png"))
})

test("README explains registry installation without claiming live SAP verification", () => {
  const readme = readFileSync("README.md", "utf8")
  assert.match(readme, /## MCP directories and registries/)
  assert.match(readme, /io\.github\.Coaspe\/sap-abap-mcp/)
  assert.match(readme, /local `stdio` server/)
  assert.match(readme, /remain `unverified`/)
  assert.match(readme, /### Claude Code and Codex plugin marketplaces/)
  assert.match(readme, /plugin marketplace add Coaspe\/sap-abap-mcp/)
})

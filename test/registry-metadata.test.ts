import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import test from "node:test"
import { readText } from "./helpers/read-text.js"

const registryName = "io.github.Coaspe/sap-abap-mcp"

test("supply-chain metadata enables private reporting and npm provenance", () => {
  assert.ok(existsSync("SECURITY.md"), "missing SECURITY.md")
  const securityPolicy = readText("SECURITY.md")
  assert.match(
    securityPolicy,
    /https:\/\/github\.com\/Coaspe\/sap-abap-mcp\/security\/advisories\/new/
  )

  const publishWorkflow = readText(".github/workflows/publish-npm.yml")
  assert.match(publishWorkflow, /npm publish --provenance --access public/)

  const packageJson = JSON.parse(readText("package.json"))
  assert.equal(packageJson.publishConfig.provenance, true)
  assert.equal(packageJson.main, "dist/src/library.js")
  assert.equal(packageJson.types, "dist/src/library.d.ts")
})

test("distribution metadata stays consistent across npm and the official MCP Registry", () => {
  const packageJson = JSON.parse(readText("package.json"))
  const serverJson = JSON.parse(readText("server.json"))

  assert.equal(packageJson.version, "1.2.0")
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
    "spec",
    "llms-install.md",
    "scripts/benchmark-mcp-surface.mjs",
    "scripts/check-profile-conformance.mjs",
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
  const license = readText("LICENSE")
  assert.match(license, /^MIT License\n/)
  assert.match(license, /Copyright \(c\) 2026 Coaspe/)
  assert.match(license, /Permission is hereby granted, free of charge/)

  const icon = readFileSync("assets/directory-icon.png")
  assert.deepEqual([...icon.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10])
  assert.equal(icon.readUInt32BE(16), 400)
  assert.equal(icon.readUInt32BE(20), 400)
})

test("README demo is a bounded 1200 by 675 GIF built from synthetic content", () => {
  const demo = readFileSync("assets/demo.gif")
  assert.equal(demo.subarray(0, 6).toString("ascii"), "GIF89a")
  assert.equal(demo.readUInt16LE(6), 1200)
  assert.equal(demo.readUInt16LE(8), 675)
  assert.ok(demo.length < 5_000_000)

  const transcript = readText("docs/demo-script.md")
  assert.match(transcript, /sap\.repository\.search/)
  assert.match(transcript, /sap\.quality\.unit_test/)
  assert.match(transcript, /sap\.transport\.assess/)
  assert.match(transcript, /Synthetic|synthetic/)
})

test("MCPB metadata launches the bundled local server on supported secret-store platforms", () => {
  const packageJson = JSON.parse(readText("package.json"))
  const manifest = JSON.parse(readText("mcpb/manifest.json"))

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
  assert.equal(manifest.tools_generated, false)
  assert.equal(manifest.tools.length, 115)
  assert.equal(new Set(manifest.tools.map((tool: { name: string }) => tool.name)).size, 115)
  const toolNames = new Set(manifest.tools.map((tool: { name: string }) => tool.name))
  for (const toolName of [
    "sap.repository.search",
    "sap.transport.assess",
    "sap.rap.generate"
  ]) {
    assert.ok(toolNames.has(toolName), `missing current v1 MCPB tool: ${toolName}`)
  }
  assert.ok(!toolNames.has("search_abap_objects"), "legacy v0 tool leaked into MCPB catalog")
  for (const tool of manifest.tools) {
    assert.ok(tool.name.trim(), "MCPB tool name must not be empty")
    assert.ok(tool.description.trim(), `MCPB tool description must not be empty: ${tool.name}`)
  }
  assert.deepEqual(manifest.privacy_policies, [
    "https://github.com/Coaspe/sap-abap-mcp/blob/main/PRIVACY.md"
  ])
  const readme = readText("README.md")
  assert.match(readme, /^## Privacy Policy$/m)
  const privacy = readText("PRIVACY.md")
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
  const packageJson = JSON.parse(readText("package.json"))
  const codexManifest = JSON.parse(
    readText("plugins/sap-abap-mcp/.codex-plugin/plugin.json")
  )
  const claudeManifest = JSON.parse(
    readText("plugins/sap-abap-mcp/.claude-plugin/plugin.json")
  )
  const mcpConfig = JSON.parse(readText("plugins/sap-abap-mcp/.mcp.json"))
  const codexMarketplace = JSON.parse(readText(".agents/plugins/marketplace.json"))
  const claudeMarketplace = JSON.parse(readText(".claude-plugin/marketplace.json"))

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
  const readme = readText("README.md")
  const quickStartIndex = readme.indexOf("## Quick start\n")
  const releaseStatusIndex = readme.indexOf("## Release status\n")
  assert.notEqual(quickStartIndex, -1)
  assert.notEqual(releaseStatusIndex, -1)
  assert.ok(quickStartIndex < releaseStatusIndex)
  assert.match(readme, /PowerShell continues a line with a backtick/)
  assert.match(readme, /Command Prompt \(`cmd\.exe`\) uses a caret \(`\^`\)/)
  assert.match(readme, /npx\.cmd @coaspe\/sap-abap-mcp@latest setup/)
  assert.match(readme, /npx @coaspe\/sap-abap-mcp@latest setup/)
  assert.match(readme, /setup edit DEV100/)
  assert.match(readme, /setup remove DEV100/)
  assert.match(readme, /`Server name` is the local name used later as `connectionId`/)
  assert.match(readme, /SAP URL/)
  assert.match(readme, /## MCP directories and registries/)
  assert.match(readme, /io\.github\.Coaspe\/sap-abap-mcp/)
  assert.match(readme, /local `stdio` server/)
  assert.match(readme, /remain `unverified`/)
  assert.match(readme, /### Claude Code and Codex plugin marketplaces/)
  assert.match(readme, /plugin marketplace add Coaspe\/sap-abap-mcp/)
  assert.match(readme, /\/sap-abap-mcp:sap-abap-setup/)
})

test("plugin onboarding keeps credentials local and verifies SAP explicitly", () => {
  const pluginReadme = readText("plugins/sap-abap-mcp/README.md")
  const setupSkill = readText(
    "plugins/sap-abap-mcp/skills/sap-abap-setup/SKILL.md")
  const agentInstall = readText("llms-install.md")
  const assuranceSkill = readText(
    "plugins/sap-abap-mcp/skills/sap-abap-change-assurance/SKILL.md")
  const assuranceAgent = readText(
    "plugins/sap-abap-mcp/skills/sap-abap-change-assurance/agents/openai.yaml")

  for (const document of [pluginReadme, agentInstall]) {
    assert.match(document, /\/sap-abap-mcp:sap-abap-setup/)
    assert.match(document, /\/mcp[^\n]+does not prove/)
  }
  assert.match(setupSkill, /Windows, macOS, or Linux/)
  assert.match(setupSkill, /profile list/)
  assert.match(setupSkill, /@coaspe\/sap-abap-mcp@latest setup/)
  assert.match(setupSkill, /setup edit \[<server-name>\]/)
  assert.match(setupSkill, /setup remove \[<server-name>\]/)
  assert.match(setupSkill, /`Server name`/)
  assert.match(setupSkill, /`SAP URL`/)
  assert.match(setupSkill, /hidden terminal prompt/)
  assert.match(setupSkill, /SAP_ABAP_MCP_PASSWORD_<NORMALIZED_SERVER_NAME>/)
  assert.match(setupSkill, /SAP_ABAP_MCP_PASSWORD_DEV100/)
  assert.match(setupSkill, /get_connected_systems/)
  assert.match(setupSkill, /oauth-client-credentials/)
  assert.match(pluginReadme, /\/sap-abap-mcp:sap-abap-change-assurance/)
  assert.match(assuranceSkill, /action: "assess_transport"/)
  assert.match(assuranceSkill, /Do not call `release_transport`/)
  assert.match(assuranceSkill, /JSON, SARIF, and JUnit/)
  assert.match(assuranceAgent, /\$sap-abap-change-assurance/)
})

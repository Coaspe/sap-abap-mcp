import { execFileSync, spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdtemp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { resolveLocalCommand } from "../dist/src/local-command.js"

const tarball = resolve(process.argv[2] ?? "")
if (!process.argv[2]) throw new Error("Usage: node scripts/verify-installation.mjs <tarball> [report.json]")
const temporary = await mkdtemp(join(tmpdir(), "sap install 한글 space "))
const prefix = join(temporary, "consumer")
const cache = join(temporary, "empty-cache")
const npm = await resolveLocalCommand(process.platform === "win32" ? "npm.cmd" : "npm", [])

async function session(launch, profileHome, cwd, terminate = false) {
  const executable = await resolveLocalCommand(launch.command, launch.args)
  const started = performance.now()
  const child = spawn(executable.command, executable.args, { cwd,
    env: { ...process.env, SAP_ABAP_MCP_HOME: profileHome }, stdio: ["pipe", "pipe", "pipe"] })
  let pending, buffer = "", protocolOnly = true, stderr = ""
  let closed = false, exitSignal = null
  const exited = new Promise(resolve => {
    child.on("error", () => { closed = true; pending?.reject(new Error("EXECUTABLE_FAILED")); resolve(null) })
    child.on("exit", (code, signal) => { closed = true; exitSignal = signal; pending?.reject(new Error("PROCESS_CLOSED")); resolve(code) })
  })
  child.stderr.on("data", chunk => { stderr += String(chunk).slice(0, 2048) })
  child.stdout.on("data", chunk => {
    buffer += String(chunk)
    while (buffer.includes("\n")) {
      const index = buffer.indexOf("\n"), line = buffer.slice(0, index); buffer = buffer.slice(index + 1)
      if (!line.trim()) continue
      try { const message = JSON.parse(line); if (message.id === pending?.id) pending.resolve(message) }
      catch { protocolOnly = false; pending?.reject(new Error("NON_PROTOCOL_STDOUT")) }
    }
  })
  const request = (id, method, params = {}) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("MCP_TIMEOUT")), 15000)
    pending = { id, resolve: value => { clearTimeout(timer); resolve(value) }, reject: error => { clearTimeout(timer); reject(error) } }
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`)
  })
  const result = { protocolInitialized: false, toolsListed: false, setupRequired: null,
    installationAccepted: false, sapAuthenticated: false, protocolOnly: true, exitCode: null, error: null }
  try {
    const initialized = await request(1, "initialize", { protocolVersion: "2025-11-25", capabilities: {},
      clientInfo: { name: "clean-install-verifier", version: "1" } })
    if (!initialized.result) throw new Error("INITIALIZE_REJECTED")
    result.protocolInitialized = true
    result.serverVersion = initialized.result.serverInfo.version
    result.setupRequired = /SETUP_REQUIRED/.test(initialized.result.instructions ?? "")
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`)
    const listed = await request(2, "tools/list")
    result.toolsListed = listed.result?.tools?.length === 5
    if (terminate) child.kill("SIGTERM")
    else child.stdin.end()
    result.exitCode = await Promise.race([exited, new Promise(resolve => setTimeout(() => resolve("timeout"), 3000).unref())])
  } catch (error) { result.error = error.message }
  finally {
    result.exitSignal = exitSignal
    result.protocolOnly = protocolOnly
    result.noCredentialPrompt = !/password:|client secret:/i.test(stderr)
    result.milliseconds = Math.round((performance.now() - started) * 1000) / 1000
    if (!closed) child.kill("SIGTERM")
  }
  return result
}

async function diskUsage(path) {
  let bytes = 0, files = 0
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const file = join(path, entry.name)
    if (entry.isDirectory()) { const nested = await diskUsage(file); bytes += nested.bytes; files += nested.files }
    else if (entry.isFile()) { bytes += (await stat(file)).size; files++ }
  }
  return { bytes, files }
}

try {
  const started = performance.now()
  execFileSync(npm.command, [...npm.args, "install", "--prefix", prefix, "--cache", cache,
    "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund", tarball], { stdio: ["ignore", "pipe", "pipe"] })
  const coldInstallSeconds = (performance.now() - started) / 1000
  const packageRoot = join(prefix, "node_modules", "@coaspe", "sap-abap-mcp")
  const entry = join(packageRoot, "dist", "src", "index.js")
  const matrix = []
  for (const configured of [false, true]) {
    const home = join(temporary, configured ? "configured" : "empty")
    await mkdir(home)
    if (configured) await writeFile(join(home, "profiles.json"), JSON.stringify({ version: 2, profiles: [{
      id: "INSTALLFIXTURE", url: "https://sap.invalid", client: "100", language: "EN",
      environment: "development", authType: "basic", readOnly: true, allowedPackages: [], allowDataQueries: false
    }] }))
    for (const viaNpx of [false, true]) for (const args of [[], ["serve"]]) {
      const launch = viaNpx ? { command: process.platform === "win32" ? "npx.cmd" : "npx",
        args: ["--offline", "--yes", "@coaspe/sap-abap-mcp", ...args] }
        : { command: process.execPath, args: [entry, ...args] }
      matrix.push({ configured, viaNpx, args, ...await session(launch, home, prefix) })
    }
  }
  const warmStartupMilliseconds = []
  for (let i = 0; i < 3; i++) warmStartupMilliseconds.push((await session({ command: process.execPath,
    args: [entry, "serve"] }, join(temporary, "empty"), prefix)).milliseconds)
  const termination = await session({ command: process.execPath, args: [entry, "serve"] }, join(temporary, "empty"), prefix, true)
  const backports = JSON.parse(execFileSync(process.execPath, ["scripts/verify-security-backports.mjs"], { cwd: packageRoot, encoding: "utf8" }))
  execFileSync(process.execPath, ["--input-type=module", "-e",
    'import { validateMermaidSyntax } from "./dist/src/mermaid-tools.js"; if (!(await validateMermaidSyntax("flowchart TD\\n A-->B")).isValid) process.exit(1)'], { cwd: packageRoot, stdio: "pipe" })
  const help = execFileSync(process.execPath, [entry, "--help"], { encoding: "utf8" })
  let invalidCommand = false
  try { execFileSync(process.execPath, [entry, "not-a-command"], { stdio: "pipe" }) }
  catch (error) { invalidCommand = error.status === 1 && error.stdout.length === 0 && /UNKNOWN_COMMAND/.test(String(error.stderr)) }
  const report = { scope: "clean-installed-tarball-protocol-fixture", observedAt: new Date().toISOString(),
    platform: process.platform, nodeVersion: process.version, tarballBytes: (await stat(tarball)).size,
    tarballIntegrity: `sha512-${createHash("sha512").update(await readFile(tarball)).digest("base64")}`,
    packageVersion: JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8")).version,
    build: JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8")).sapAbapMcpBuild ?? null,
    coldCacheInitiallyEmpty: true, coldInstallSeconds, fullInstalledDisk: await diskUsage(join(prefix, "node_modules")),
    matrix, warmStartupMilliseconds, runtimeBackportsVerified: backports.passed, mermaidParser: "passed",
    explicitHelp: /Commands:/.test(help), invalidCommand, termination,
    windowsNpxCmd: process.platform === "win32" ? "executed" : "not_run: requires Windows",
    actualHostRestart: "not_run", liveSapFirstRead: "not_run", userInstallationSuccesses: 0 }
  if (process.argv[3]) await writeFile(resolve(process.argv[3]), `${JSON.stringify(report, null, 2)}\n`)
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  if (matrix.some(row => !row.protocolInitialized || !row.toolsListed || !row.protocolOnly || row.exitCode !== 0 || !row.noCredentialPrompt || row.setupRequired !== !row.configured) ||
      !report.explicitHelp || !invalidCommand || (process.platform === "win32" ? termination.exitCode === "timeout" || (!termination.exitSignal && termination.exitCode !== 0) : termination.exitCode !== 0)) process.exitCode = 1
} finally { await rm(temporary, { recursive: true, force: true }) }

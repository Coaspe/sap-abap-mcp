import { FILE_HOSTS, isFileHost, serversKey, fileHostConfigPath, parseFileHostConfig, type FileHostId } from "./host-config.js"
import { open, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises"
import { realpathSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { isDeepStrictEqual } from "node:util"
import { parse as parseToml } from "smol-toml"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { AppError } from "./errors.js"
import { packageLaunch, PACKAGE_NAME, PACKAGE_VERSION, type StdioLaunch } from "./launch-contract.js"
import { resolveLocalCommand } from "./local-command.js"

export const REGISTRATION_CLIENTS = ["codex", "claude", ...FILE_HOSTS.map(host => host.id)] as const
export type RegistrationClient = typeof REGISTRATION_CLIENTS[number]
interface RegisteredLaunch extends StdioLaunch { env: Record<string, string>; enabled?: boolean; cwd?: string }
interface RegistrationFile {
  path: string
  text: string
  launch: RegisteredLaunch
}

function parseConfig(text: string, client: RegistrationClient): any {
  try { return client === "codex" ? parseToml(text, { integersAsBigInt: "asNeeded" }) : JSON.parse(text) }
  catch { throw new AppError("REGISTRATION_INVALID", "Client settings could not be parsed; edit them in the client first") }
}

export function registrationFile(client: RegistrationClient): string {
  if (isFileHost(client)) return fileHostConfigPath(client)
  return client === "codex"
    ? join(process.env.CODEX_HOME ?? join(homedir(), ".codex"), "config.toml")
    : join(process.env.CLAUDE_CONFIG_DIR ?? homedir(), ".claude.json")
}

export async function readRegistration(client: RegistrationClient, path = registrationFile(client)): Promise<RegistrationFile> {
  const actualPath = await realpath(path)
  const text = await readFile(actualPath, "utf8")
  const document = parseConfig(text, client)
  if (isFileHost(client)) await checkFileHostScope(client)
  const project = client === "claude" ? Object.entries(document.projects ?? {}).find(
    ([path]) => canonicalPath(path) === canonicalPath(process.cwd()))?.[1] as any : undefined
  if (project?.mcpServers?.["sap-abap"]) {
    throw new AppError("REGISTRATION_SCOPE_CONFLICT", "This project overrides the user registration; inspect it with the client first")
  }
  const projectFile = client === "claude" ? await readFile(join(process.cwd(), ".mcp.json"), "utf8").catch(() => undefined) : undefined
  if (projectFile && parseConfig(projectFile, "claude").mcpServers?.["sap-abap"]) {
    throw new AppError("REGISTRATION_SCOPE_CONFLICT", "A project registration may override the user entry; inspect it with the client first")
  }
  const disabled = project?.disabledMcpServers?.includes("sap-abap") === true
  const entry = document[serversKey(client)]?.["sap-abap"]
  if (!entry || typeof entry.command !== "string" || !Array.isArray(entry.args) ||
      !entry.args.every((arg: unknown) => typeof arg === "string") || entry.url) {
    throw new AppError("REGISTRATION_NOT_STDIO", "Select an existing local sap-abap registration; remote servers are not repaired")
  }
  const env = entry.env ?? {}
  if (!env || Array.isArray(env) || typeof env !== "object" || Object.values(env).some(value => typeof value !== "string")) {
    throw new AppError("REGISTRATION_INVALID", "Registration environment must contain string values")
  }
  return { path: actualPath, text, launch: { command: entry.command,
    args: [...entry.args], env: { ...env }, ...(entry.enabled === false || disabled ? { enabled: false } : {}),
    ...(typeof entry.cwd === "string" ? { cwd: entry.cwd } : {}) } }
}

function canonicalPath(path: string): string {
  try { return realpathSync(path) } catch { return resolve(path) }
}

function serverArguments(launch: StdioLaunch): string[] | undefined {
  if (/(?:^|[\\/])npx(?:\.cmd)?$/i.test(launch.command)) {
    const index = launch.args.findIndex(arg => arg === PACKAGE_NAME || arg.startsWith(`${PACKAGE_NAME}@`))
    if (index < 0 || launch.args.slice(0, index).some(arg => !["-y", "--yes", "--prefer-online"].includes(arg))) return undefined
    return launch.args.slice(index + 1)
  }
  if (/(?:^|[\\/])node(?:\.exe)?$/i.test(launch.command) &&
      /(?:^|[\\/])node_modules[\\/]@coaspe[\\/]sap-abap-mcp[\\/]dist[\\/]src[\\/]index\.js$/.test(launch.args[0] ?? "")) {
    return launch.args.slice(1)
  }
  return undefined
}

export async function probeRegistration(launch: RegisteredLaunch, profileId: string, profileHome: string) {
  const summary = { wizardVersion: PACKAGE_VERSION, registeredVersion: null as string | null,
    registeredCommand: launch.command,
    registeredEntryPoint: /(?:^|[\\/])node(?:\.exe)?$/i.test(launch.command) ? launch.args[0] ?? null : null,
    resolvedExecutable: null as string | null,
    executableExists: false, entryExists: null as boolean | null, initialized: false,
    toolsListed: false, selectedProfileFound: false, profileHomeMatches:
      launch.env.SAP_ABAP_MCP_HOME ? canonicalPath(launch.env.SAP_ABAP_MCP_HOME) === canonicalPath(profileHome) : null,
    sapAuthenticated: false, status: "failed", errorCode: null as string | null }
  if (launch.enabled === false) return { ...summary, status: "disabled" }
  const client = new Client({ name: "sap-abap-registration-doctor", version: "1" })
  let transport: StdioClientTransport | undefined
  try {
    const resolved = await resolveLocalCommand(launch.command, launch.args)
    summary.resolvedExecutable = resolved.command
    summary.executableExists = true
    if (/(?:^|[\\/])node(?:\.exe)?$/i.test(launch.command) && launch.args[0]) {
      summary.entryExists = await stat(resolve(launch.cwd ?? process.cwd(), launch.args[0])).then(value => value.isFile()).catch(() => false)
      if (!summary.entryExists) return { ...summary, errorCode: "ENTRY_MISSING" }
    }
    transport = new StdioClientTransport({ ...resolved, ...(launch.cwd ? { cwd: launch.cwd } : {}), env: { ...getDefaultEnvironment(), ...launch.env }, stderr: "pipe" })
    // Drain, but never echo credential-bearing host or SAP diagnostics.
    transport.stderr?.on("data", () => undefined)
    await client.connect(transport, { timeout: 30_000 })
    summary.initialized = true
    summary.registeredVersion = client.getServerVersion()?.version ?? null
    const tools = (await client.listTools({}, { timeout: 5000 })).tools
    summary.toolsListed = tools.length > 0
    const names = tools.map(tool => tool.name)
    let result: any
    if (names.includes("sap.system.list")) result = await client.callTool({ name: "sap.system.list", arguments: {} })
    else if (names.includes("sap.capability.describe") || names.includes("sap")) {
      const single = names.includes("sap")
      const described: any = await client.callTool({ name: single ? "sap" : "sap.capability.describe",
        arguments: single ? { name: "describe", arguments: { name: "sap.system.list" } } : { name: "sap.system.list" } })
      const schemaHash = described.structuredContent?.data?.capability?.schemaHash
      if (schemaHash) result = await client.callTool({ name: single ? "sap" : "sap.capability.invoke_read",
        arguments: { name: "sap.system.list", schemaHash, ...(single ? { risk: "read" } : {}) } })
    }
    const systems = result?.structuredContent?.data?.systems
    summary.selectedProfileFound = Array.isArray(systems) && systems.some((value: any) => value.id === profileId.toUpperCase())
    summary.status = !Array.isArray(systems) ? "profile_discovery_failed"
      : systems.length === 0 ? "setup_required"
      : !summary.selectedProfileFound || summary.profileHomeMatches !== true ? "profile_mismatch" : "local_ready"
    return summary
  } catch {
    return { ...summary, errorCode: summary.executableExists ? "MCP_PROBE_FAILED" : "EXECUTABLE_MISSING" }
  } finally {
    await client.close().catch(() => undefined)
    await transport?.close().catch(() => undefined)
  }
}

export function planRegistrationRepair(file: RegistrationFile, client: RegistrationClient,
  profileId: string, profileHome: string, version = PACKAGE_VERSION) {
  const args = serverArguments(file.launch)
  if (!args || file.launch.enabled === false || args.includes("--http")) {
    throw new AppError("CUSTOM_REGISTRATION", "Custom wrappers, disabled registrations and HTTP settings require manual review")
  }
  const selected = args.flatMap((arg, index) => arg === "--profile" ? [args[index + 1]] :
    arg.startsWith("--profile=") ? [arg.slice(10)] : [])
  if (selected.length > 1 || selected.some(id => id?.toUpperCase() !== profileId.toUpperCase()) ||
      !file.launch.env.SAP_ABAP_MCP_HOME || canonicalPath(file.launch.env.SAP_ABAP_MCP_HOME) !== canonicalPath(profileHome)) {
    throw new AppError("REGISTRATION_PROFILE_MISMATCH", "Keep this registration unchanged: select its actual profile and explicit profile home")
  }
  const serverArgs = args.length ? args : ["serve"]
  if (serverArgs[0] !== "serve") throw new AppError("CUSTOM_REGISTRATION", "The registered command is not stdio serve")
  const launch = { ...file.launch, ...packageLaunch(process.platform, version, serverArgs) }
  let text: string
  const key = serversKey(client)
  const expected = parseConfig(file.text, client)
  expected[key]["sap-abap"].command = launch.command
  expected[key]["sap-abap"].args = launch.args
  if (client !== "codex") text = `${JSON.stringify(expected, null, 2)}\n`
  else {
    // Edit only these two values. The parse-and-compare guard refuses exotic TOML
    // layouts instead of reserializing unrelated settings or dropping comments.
    const section = /(^\s*\[mcp_servers\.(?:sap-abap|"sap-abap"|'sap-abap')\][^\n]*\n)([\s\S]*?)(?=^\s*\[|$(?![\s\S]))/m
    const match = section.exec(file.text)
    if (!match) throw new AppError("CUSTOM_REGISTRATION", "Review this TOML layout manually")
    const body = match[2]!.replace(/^(\s*command\s*=\s*)(?:"(?:[^"\\]|\\.)*"|'[^']*')/m,
      (_all, prefix: string) => `${prefix}${JSON.stringify(launch.command)}`)
      .replace(/^(\s*args\s*=\s*)\[[\s\S]*?\]/m, (_all, prefix: string) => `${prefix}${JSON.stringify(launch.args)}`)
    text = file.text.slice(0, match.index) + match[1] + body + file.text.slice(match.index + match[0].length)
  }
  if (!isDeepStrictEqual(parseConfig(text, client), expected)) {
    throw new AppError("CUSTOM_REGISTRATION", "The proposed edit could affect other settings; review it manually")
  }
  return { launch, text, changed: text !== file.text, diff: {
    before: { command: file.launch.command, args: file.launch.args },
    after: { command: launch.command, args: launch.args }
  } }
}

export async function applyRegistrationRepair(file: RegistrationFile, text: string,
  preflight: () => Promise<{ status: string }>): Promise<{ applied: boolean; backup?: string }> {
  if (text === file.text) return { applied: false }
  if ((await preflight()).status !== "local_ready") {
    throw new AppError("REPAIR_PREFLIGHT_FAILED", "The proposed server did not initialize with the selected profile; original settings are unchanged")
  }
  const lock = await open(`${file.path}.repair-lock`, "wx", 0o600)
  const temporary = `${file.path}.repair-${process.pid}`
  try {
    if (await readFile(file.path, "utf8") !== file.text) throw new AppError("REGISTRATION_CHANGED", "Settings changed after preview; inspect them again")
    const backup = `${file.path}.before-repair-${Date.now()}`
    await writeFile(backup, file.text, { flag: "wx", mode: 0o600 })
    const mode = (await stat(file.path)).mode & 0o777
    await writeFile(temporary, text, { flag: "wx", mode })
    if (await readFile(file.path, "utf8") !== file.text) throw new AppError("REGISTRATION_CHANGED", "Settings changed during repair; original settings are unchanged")
    await rename(temporary, file.path)
    return { applied: true, backup }
  } finally {
    await rm(temporary, { force: true })
    await lock.close()
    await rm(`${file.path}.repair-lock`, { force: true })
  }
}

export function profileHomeForFile(filePath: string): string { return dirname(resolve(filePath)) }

export async function checkFileHostScope(client: FileHostId, cwd = process.cwd()): Promise<void> {
  const paths = client === "vscode" ? [join(cwd, ".vscode", "mcp.json"), join(cwd, ".mcp.json")]
    : client === "cursor" ? [join(cwd, ".cursor", "mcp.json")]
    : client === "gemini" ? [join(cwd, ".gemini", "settings.json")] : []
  for (const path of paths) {
    const text = await readFile(path, "utf8").catch(error => { if (error.code === "ENOENT") return undefined; throw error })
    if (text === undefined) continue
    const document = parseFileHostConfig(text)
    if (document[serversKey(client)]?.["sap-abap"] !== undefined || document.mcpServers?.["sap-abap"] !== undefined) {
      throw new AppError("REGISTRATION_SCOPE_CONFLICT", "A workspace sap-abap registration may override the user entry. Review it in the host first.")
    }
  }
}

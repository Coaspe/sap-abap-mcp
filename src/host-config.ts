import { mkdir, open, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { isDeepStrictEqual } from "node:util"
import { AppError } from "./errors.js"
import type { StdioLaunch } from "./launch-contract.js"

export const FILE_HOSTS = [
  { id: "vscode", label: "VS Code", serversKey: "servers", stdioType: true, docsUrl: "https://code.visualstudio.com/docs/agents/reference/mcp-configuration" },
  { id: "cursor", label: "Cursor", serversKey: "mcpServers", stdioType: true, docsUrl: "https://cursor.com/docs/context/mcp" },
  { id: "gemini", label: "Gemini CLI", serversKey: "mcpServers", stdioType: false, docsUrl: "https://geminicli.com/docs/tools/mcp-server/" },
  { id: "claude-desktop", label: "Claude Desktop", serversKey: "mcpServers", stdioType: false, docsUrl: "https://modelcontextprotocol.io/quickstart/user" }
] as const
export type FileHostId = typeof FILE_HOSTS[number]["id"]
export interface FileHostEnvironment { platform?: NodeJS.Platform; homeDirectory?: string; workingDirectory?: string }
export function isFileHost(client: string): client is FileHostId { return FILE_HOSTS.some(host => host.id === client) }
export function serversKey(client: string): string { return FILE_HOSTS.find(host => host.id === client)?.serversKey ?? (client === "codex" ? "mcp_servers" : "mcpServers") }

export function fileHostConfigPath(client: FileHostId, environment: FileHostEnvironment = {}): string {
  const home = environment.homeDirectory ?? homedir()
  const platform = environment.platform ?? process.platform
  // A supplied home is an isolated environment, including on Windows.
  const appData = environment.homeDirectory ? join(home, "AppData", "Roaming") : process.env.APPDATA ?? join(home, "AppData", "Roaming")
  if (client === "cursor") return join(home, ".cursor", "mcp.json")
  if (client === "gemini") return join(home, ".gemini", "settings.json")
  if (client === "vscode") return platform === "win32" ? join(appData, "Code", "User", "mcp.json")
    : platform === "darwin" ? join(home, "Library", "Application Support", "Code", "User", "mcp.json")
    : join(home, ".config", "Code", "User", "mcp.json")
  if (platform === "linux") throw new AppError("HOST_UNSUPPORTED", "Claude Desktop registration is supported on Windows and macOS")
  return platform === "win32" ? join(appData, "Claude", "claude_desktop_config.json")
    : join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json")
}

export function parseFileHostConfig(text: string): Record<string, any> {
  try {
    const value = JSON.parse(text)
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error()
    return value
  } catch { throw new AppError("REGISTRATION_INVALID", "Settings must be a JSON object. Resolve comments, trailing commas or invalid JSON in the host first.") }
}

export async function inspectFileHost(client: FileHostId, environment: FileHostEnvironment = {}, path = fileHostConfigPath(client, environment)) {
  const definition = FILE_HOSTS.find(host => host.id === client)!
  const installed = await stat(dirname(path)).then(value => value.isDirectory()).catch(() => false)
  try {
    const document = parseFileHostConfig(await readFile(path, "utf8"))
    const servers = document[definition.serversKey]
    if (servers !== undefined && (!servers || typeof servers !== "object" || Array.isArray(servers))) throw new AppError("REGISTRATION_INVALID", "The server map must be a JSON object")
    return { installed, configured: servers?.["sap-abap"] !== undefined, configPath: path, entry: servers?.["sap-abap"] }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { installed, configured: false, configPath: path }
    return { installed, configured: false, configPath: path, issue: error instanceof Error ? error.message : "Could not read settings" }
  }
}

export interface FileHostPlan { path: string; before: string | undefined; text: string; entry: Record<string, unknown> }
export async function planFileHostRegistration(client: FileHostId, launch: StdioLaunch, env: Record<string, string>, environment: FileHostEnvironment = {}, configPath?: string): Promise<FileHostPlan> {
  const requested = resolve(configPath ?? fileHostConfigPath(client, environment))
  const path = await realpath(requested).catch(error => { if (error.code === "ENOENT") return requested; throw error })
  const before = await readFile(path, "utf8").catch(error => { if (error.code === "ENOENT") return undefined; throw error })
  const document = before === undefined ? {} : parseFileHostConfig(before)
  const key = serversKey(client)
  if (document[key] !== undefined && (!document[key] || typeof document[key] !== "object" || Array.isArray(document[key]))) throw new AppError("REGISTRATION_INVALID", "The server map must be a JSON object")
  if (document[key]?.["sap-abap"] !== undefined) throw new AppError("REGISTRATION_EXISTS", "sap-abap is already registered. Use doctor and reviewed repair instead.")
  const entry = { ...(FILE_HOSTS.find(host => host.id === client)!.stdioType ? { type: "stdio" } : {}), ...launch, env }
  const expected = structuredClone(document)
  expected[key] = { ...expected[key], "sap-abap": entry }
  const text = `${JSON.stringify(expected, null, 2)}\n`
  const parsed = parseFileHostConfig(text)
  delete parsed[key]["sap-abap"]
  if (document[key] === undefined) delete parsed[key]
  if (!isDeepStrictEqual(parsed, document)) throw new AppError("REGISTRATION_INVALID", "The proposed edit would change other settings")
  return { path, before, text, entry }
}

export async function applyFileHostRegistration(plan: FileHostPlan): Promise<{ applied: true; backup?: string }> {
  await mkdir(dirname(plan.path), { recursive: true })
  const lockPath = `${plan.path}.sap-abap-lock`
  const lock = await open(lockPath, "wx", 0o600)
  const temporary = `${plan.path}.sap-abap-${process.pid}`
  const current = () => readFile(plan.path, "utf8").catch(error => { if (error.code === "ENOENT") return undefined; throw error })
  try {
    if (await current() !== plan.before) throw new AppError("REGISTRATION_CHANGED", "Settings changed after preview. Preview again.")
    const backup = plan.before === undefined ? undefined : `${plan.path}.before-sap-abap-${Date.now()}`
    if (backup) await writeFile(backup, plan.before!, { flag: "wx", mode: 0o600 })
    const mode = plan.before === undefined ? 0o600 : (await stat(plan.path)).mode & 0o777
    await writeFile(temporary, plan.text, { flag: "wx", mode })
    if (await current() !== plan.before) throw new AppError("REGISTRATION_CHANGED", "Settings changed during registration. Preview again.")
    await rename(temporary, plan.path)
    return { applied: true, ...(backup ? { backup } : {}) }
  } finally {
    await rm(temporary, { force: true })
    await lock.close()
    await rm(lockPath, { force: true })
  }
}

import { execFile, spawn } from "node:child_process"
import { randomBytes } from "node:crypto"
import { stat } from "node:fs/promises"
import {
  createServer,
  type IncomingMessage,
  type ServerResponse
} from "node:http"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { stderr, stdout } from "node:process"
import { z } from "zod"
import { AppError, errorPayload } from "./errors.js"
import { onboardPage } from "./onboard-page.js"
import { saveProfileCredential } from "./save-profile-credential.js"
import {
  normalizeProfile,
  type ProfileStore,
  type SapProfile,
  type SapProfileInput
} from "./profile-store.js"
import type { SecretStore } from "./secret-store.js"

const HOST = "127.0.0.1"
const MAX_BODY_BYTES = 32 * 1024
const MCP_SERVER_NAME = "sap-abap"

const profileRequestSchema = z.object({
  id: z.string().trim().min(1).max(32).regex(/^[A-Za-z0-9_-]+$/),
  url: z.string().trim().max(2048).refine(value => {
    try {
      const url = new URL(value)
      return url.protocol === "https:" && !url.username && !url.password &&
        !url.search && !url.hash
    } catch {
      return false
    }
  }, "SAP URL must be a complete HTTPS URL without credentials, a query, or a fragment"),
  client: z.string().trim().regex(/^\d{1,3}$/),
  username: z.string().trim().min(1).max(256),
  password: z.string().min(1).max(4096),
  language: z.string().trim().regex(/^[A-Za-z]{2}$/),
  environment: z.enum(["development", "quality", "production"]),
  allowedPackages: z.string().max(4096).optional()
}).strict()

const verifyRequestSchema = z.object({
  profileId: z.string().trim().min(1).max(32).regex(/^[A-Za-z0-9_-]+$/)
}).strict()

const configureRequestSchema = z.object({
  clientId: z.enum(["claude", "codex"]),
  profileId: z.string().trim().min(1).max(32).regex(/^[A-Za-z0-9_-]+$/),
  preset: z.enum(["adaptive", "minimal", "single"]).default("minimal")
}).strict()

export interface CommandResult {
  ok: boolean
  stdout: string
  stderr: string
  missing: boolean
}

export type CommandRunner = (
  command: string,
  args: readonly string[]
) => Promise<CommandResult>

export type OnboardClientId = "claude" | "codex"

export interface OnboardClientStatus {
  id: OnboardClientId
  label: string
  installed: boolean
  configured: boolean
  mcpConnectionStatus: "connected" | "failed" | "authentication-required" | "unknown"
  installUrl: string
  version?: string
  issue?: string
}

export interface OnboardFileStatus {
  path: string
  exists: boolean
}

export interface OnboardProfileStatus {
  id: string
  url: string
  client: string
  language: string
  environment: SapProfile["environment"]
  authType: SapProfile["authType"]
  credentialAvailable: boolean
  username?: string
  allowedPackages: string[]
}

export interface OnboardStatus {
  environment: {
    platform: NodeJS.Platform
    nodeVersion: string
    cwd: string
    credentialStorageSupported: boolean
    npm: { installed: boolean; version?: string }
  }
  clients: OnboardClientStatus[]
  files: OnboardFileStatus[]
  profiles: OnboardProfileStatus[]
}

interface OnboardServices {
  profiles: ProfileStore
  secrets: SecretStore
  validateCredentials(profile: SapProfile, password: string): Promise<void>
  runner?: CommandRunner
  platform?: NodeJS.Platform
  homeDirectory?: string
  workingDirectory?: string
}

export interface StartOnboardServerOptions extends OnboardServices {
  port?: number
}

export interface RunningOnboardServer {
  url: string
  finished: Promise<void>
  close(): Promise<void>
}

export interface RunOnboardOptions extends OnboardServices {
  openBrowser?: (url: string) => void
  log?: (message: string) => void
}

const CLIENTS: ReadonlyArray<{
  id: OnboardClientId
  label: string
  command: string
  installUrl: string
}> = [
  {
    id: "claude",
    label: "Claude Code",
    command: "claude",
    installUrl: "https://code.claude.com/docs/en/setup"
  },
  {
    id: "codex",
    label: "Codex",
    command: "codex",
    installUrl: "https://learn.chatgpt.com/docs/codex/cli"
  }
]

function oneLine(value: string): string | undefined {
  const line = value.split(/\r?\n/).map(item => item.trim()).find(Boolean)
  return line?.slice(0, 200)
}

function windowsCommandLine(command: string, args: readonly string[]): string {
  const quote = (value: string): string => {
    if (/[\r\n]/.test(value)) throw new AppError("COMMAND_ARGUMENT_INVALID", "Command arguments cannot contain line breaks")
    return `"${value.replaceAll("%", "%%").replaceAll('"', '""')}"`
  }
  return [command, ...args].map(quote).join(" ")
}

export const runLocalCommand: CommandRunner = async (command, args) =>
  new Promise(resolve => {
    const platform = process.platform
    const executable = platform === "win32" ? process.env.ComSpec ?? "cmd.exe" : command
    const executableArgs = platform === "win32"
      ? ["/d", "/s", "/c", windowsCommandLine(command, args)]
      : [...args]
    execFile(
      executable,
      executableArgs,
      { encoding: "utf8", timeout: 30_000, maxBuffer: 1024 * 1024, windowsHide: true },
      (error, commandStdout, commandStderr) => {
        const output = String(commandStdout ?? "")
        const errorOutput = String(commandStderr ?? "")
        const missing = (error as NodeJS.ErrnoException | null)?.code === "ENOENT" ||
          /not recognized as an internal or external command|command not found/i.test(errorOutput)
        resolve({
          ok: !error,
          stdout: output,
          stderr: errorOutput,
          missing
        })
      }
    )
  })

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false
    throw error
  }
}

function clientRegistration(output: string): Pick<OnboardClientStatus, "configured" | "mcpConnectionStatus"> {
  const row = output.replace(/\u001b\[[0-9;]*m/g, "").split(/\r?\n/)
    .find(line => new RegExp(`^\\s*${MCP_SERVER_NAME}(?=[\\s:]|$)`, "i").test(line))
  if (!row) return { configured: false, mcpConnectionStatus: "unknown" }
  const status = row.match(/(?:\s+-\s+|:\s*)(?:[✓✗⚠]\s*)?(connected|failed(?: to connect)?|needs authentication|requires authentication)\s*$/i)?.[1]?.toLowerCase()
  return { configured: true, mcpConnectionStatus: status === "connected" ? "connected"
    : status?.startsWith("failed") ? "failed"
    : status?.includes("authentication") ? "authentication-required" : "unknown" }
}

async function inspectClient(
  definition: typeof CLIENTS[number],
  runner: CommandRunner
): Promise<OnboardClientStatus> {
  const versionResult = await runner(definition.command, ["--version"])
  if (!versionResult.ok) {
    return {
      id: definition.id,
      label: definition.label,
      installed: false,
      configured: false,
      mcpConnectionStatus: "unknown",
      installUrl: definition.installUrl,
      ...(!versionResult.missing
        ? { issue: oneLine(versionResult.stderr) ?? "The command could not be started" }
        : {})
    }
  }

  const listResult = await runner(definition.command, ["mcp", "list"])
  const version = oneLine(versionResult.stdout || versionResult.stderr)
  return {
    id: definition.id,
    label: definition.label,
    installed: true,
    ...(listResult.ok ? clientRegistration(`${listResult.stdout}\n${listResult.stderr}`)
      : { configured: false, mcpConnectionStatus: "unknown" as const }),
    installUrl: definition.installUrl,
    ...(version ? { version } : {}),
    ...(!listResult.ok
      ? { issue: oneLine(listResult.stderr) ?? "MCP settings could not be read" }
      : {})
  }
}

function expectedFiles(home: string, cwd: string): string[] {
  return [
    join(home, ".claude", "settings.json"),
    join(home, ".claude.json"),
    join(home, ".codex", "config.toml"),
    join(cwd, ".claude"),
    join(cwd, ".mcp.json"),
    join(cwd, ".codex", "config.toml"),
    join(cwd, "CLAUDE.md"),
    join(cwd, "AGENTS.md")
  ]
}

export async function inspectOnboardStatus(options: OnboardServices): Promise<OnboardStatus> {
  const runner = options.runner ?? runLocalCommand
  const platform = options.platform ?? process.platform
  const home = options.homeDirectory ?? homedir()
  const cwd = options.workingDirectory ?? process.cwd()
  const [npm, clients, files, profiles] = await Promise.all([
    runner("npm", ["--version"]),
    Promise.all(CLIENTS.map(client => inspectClient(client, runner))),
    Promise.all(expectedFiles(home, cwd).map(async path => ({ path, exists: await pathExists(path) }))),
    options.profiles.list().then(items => Promise.all(items.map(async profile => ({
      id: profile.id,
      url: profile.url,
      client: profile.client,
      language: profile.language,
      environment: profile.environment,
      authType: profile.authType,
      allowedPackages: profile.allowedPackages,
      ...(profile.username ? { username: profile.username } : {}),
      credentialAvailable: await options.secrets.get(profile.id).then(Boolean).catch(() => false)
    }))))
  ])
  const npmVersion = oneLine(npm.stdout || npm.stderr)

  return {
    environment: {
      platform,
      nodeVersion: process.version,
      cwd,
      credentialStorageSupported: platform === "win32" || platform === "darwin",
      npm: {
        installed: npm.ok,
        ...(npmVersion ? { version: npmVersion } : {})
      }
    },
    clients,
    files,
    profiles
  }
}

async function saveAndVerifyProfile(
  raw: unknown,
  options: OnboardServices
): Promise<OnboardProfileStatus> {
  const platform = options.platform ?? process.platform
  if (platform !== "win32" && platform !== "darwin") {
    throw new AppError(
      "ONBOARD_SECRET_STORE_UNSUPPORTED",
      "Web onboarding stores credentials only with Windows DPAPI or macOS Keychain"
    )
  }
  const request = parse(profileRequestSchema, raw)
  const existing = (await options.profiles.list()).find(
    profile => profile.id === request.id.toUpperCase()
  )
  if (existing && existing.authType !== "basic") {
    throw new AppError(
      "PROFILE_AUTH_TYPE_UNSUPPORTED",
      `Profile ${existing.id} uses advanced authentication and cannot be replaced by Basic Auth onboarding`
    )
  }
  const input: SapProfileInput = {
    ...existing,
    id: request.id,
    url: request.url,
    client: request.client,
    username: request.username,
    language: request.language,
    environment: request.environment,
    allowDataQueries: request.environment === "production" ? false : existing?.allowDataQueries ?? false,
    allowedPackages: request.allowedPackages === undefined ? existing?.allowedPackages ?? []
      : request.allowedPackages.split(",").map(value => value.trim()).filter(Boolean)
  }
  const profile = normalizeProfile(input)
  await options.validateCredentials(profile, request.password)
  await saveProfileCredential(options.profiles, options.secrets, input, request.password)
  return {
    id: profile.id,
    url: profile.url,
    client: profile.client,
    language: profile.language,
    environment: profile.environment,
    authType: profile.authType,
    username: request.username,
    credentialAvailable: true,
    allowedPackages: profile.allowedPackages
  }
}

async function verifySavedProfile(raw: unknown, options: OnboardServices): Promise<void> {
  const request = parse(verifyRequestSchema, raw)
  const profile = await options.profiles.get(request.profileId)
  const password = await options.secrets.get(profile.id)
  if (!password) {
    throw new AppError("AUTH_REQUIRED", `No saved SAP credential was found for ${profile.id}`)
  }
  await options.validateCredentials(profile, password)
}

async function configureClient(raw: unknown, options: OnboardServices): Promise<OnboardClientStatus> {
  const request = parse(configureRequestSchema, raw)
  await options.profiles.get(request.profileId)
  const runner = options.runner ?? runLocalCommand
  const definition = CLIENTS.find(client => client.id === request.clientId)
  if (!definition) throw new AppError("CLIENT_UNKNOWN", "Unknown AI client")
  const current = await inspectClient(definition, runner)
  if (!current.installed) {
    throw new AppError("CLIENT_NOT_INSTALLED", `${definition.label} is not installed`)
  }
  if (current.issue) {
    throw new AppError("CLIENT_CONFIG_UNREADABLE", current.issue)
  }
  if (current.configured) return current

  const serverArgs = [
    process.execPath,
    fileURLToPath(new URL("./index.js", import.meta.url)),
    "serve",
    "--profile",
    request.profileId,
    "--preset",
    request.preset
  ]
  const profileEnvironment = `SAP_ABAP_MCP_HOME=${dirname(resolve(options.profiles.filePath))}`
  const args = definition.id === "claude"
    ? ["mcp", "add", "--transport", "stdio", "--scope", "user", "--env", profileEnvironment, MCP_SERVER_NAME, "--", ...serverArgs]
    : ["mcp", "add", "--env", profileEnvironment, MCP_SERVER_NAME, "--", ...serverArgs]
  const result = await runner(definition.command, args)
  if (!result.ok) {
    throw new AppError(
      "CLIENT_CONFIG_FAILED",
      oneLine(result.stderr || result.stdout) ?? `${definition.label} MCP configuration failed`
    )
  }
  const configured = await inspectClient(definition, runner)
  if (!configured.configured) {
    throw new AppError(
      "CLIENT_CONFIG_NOT_FOUND",
      `${definition.label} did not report the new MCP configuration`
    )
  }
  return configured
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (!result.success) {
    throw new AppError("INPUT_INVALID", result.error.issues[0]?.message ?? "Invalid input")
  }
  return result.data
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  if (!request.headers["content-type"]?.toLowerCase().startsWith("application/json")) {
    throw new AppError("CONTENT_TYPE_REQUIRED", "Content-Type must be application/json")
  }
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string)
    size += buffer.length
    if (size > MAX_BODY_BYTES) throw new AppError("REQUEST_TOO_LARGE", "Request body is too large")
    chunks.push(buffer)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")
  } catch {
    throw new AppError("JSON_INVALID", "Request body must contain valid JSON")
  }
}

function applySecurityHeaders(response: ServerResponse, nonce: string): void {
  response.setHeader("cache-control", "no-store")
  response.setHeader("content-security-policy", [
    "default-src 'none'",
    `script-src 'nonce-${nonce}'`,
    `style-src 'nonce-${nonce}'`,
    "connect-src 'self'",
    "img-src 'self' data:",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'"
  ].join("; "))
  response.setHeader("cross-origin-resource-policy", "same-origin")
  response.setHeader("referrer-policy", "no-referrer")
  response.setHeader("x-content-type-options", "nosniff")
  response.setHeader("x-frame-options", "DENY")
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" })
  response.end(`${JSON.stringify(value)}\n`)
}

function errorStatus(error: unknown): number {
  if (!(error instanceof AppError)) return 500
  if (error.code === "ONBOARD_BUSY") return 409
  if (error.code === "PROFILE_NOT_FOUND") return 404
  return 400
}

export async function startOnboardServer(
  options: StartOnboardServerOptions
): Promise<RunningOnboardServer> {
  const token = randomBytes(32).toString("base64url")
  const nonce = randomBytes(18).toString("base64url")
  let port = 0
  let writing = false
  let finish: (() => void) | undefined
  const finished = new Promise<void>(resolve => { finish = resolve })

  const withWriteLock = async <T>(work: () => Promise<T>): Promise<T> => {
    if (writing) throw new AppError("ONBOARD_BUSY", "Another setup action is still running")
    writing = true
    try {
      return await work()
    } finally {
      writing = false
    }
  }

  const server = createServer(async (request, response) => {
    applySecurityHeaders(response, nonce)
    const expectedHost = `${HOST}:${port}`
    if (request.headers.host !== expectedHost) {
      sendJson(response, 403, { code: "HOST_REJECTED", message: "Unexpected request host" })
      return
    }

    let url: URL
    try {
      url = new URL(request.url ?? "/", `http://${expectedHost}`)
    } catch {
      sendJson(response, 400, { code: "URL_INVALID", message: "Invalid request URL" })
      return
    }

    if (request.method === "GET" && url.pathname === "/favicon.ico") {
      response.writeHead(204)
      response.end()
      return
    }
    if (request.method === "GET" && url.pathname === "/") {
      if (url.searchParams.get("token") !== token) {
        sendJson(response, 403, { code: "TOKEN_REQUIRED", message: "Open the URL printed by the onboard command" })
        return
      }
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" })
      response.end(onboardPage(token, nonce))
      return
    }

    const suppliedToken = request.headers["x-onboard-token"]
    if (suppliedToken !== token) {
      sendJson(response, 403, { code: "TOKEN_REQUIRED", message: "Onboarding token is missing or invalid" })
      return
    }
    const origin = request.headers.origin
    if (origin && origin !== `http://${expectedHost}`) {
      sendJson(response, 403, { code: "ORIGIN_REJECTED", message: "Cross-origin requests are not allowed" })
      return
    }

    try {
      if (request.method === "GET" && url.pathname === "/api/status") {
        sendJson(response, 200, await inspectOnboardStatus(options))
        return
      }
      if (request.method === "POST" && url.pathname === "/api/profile") {
        const profile = await withWriteLock(() => readJson(request).then(body => saveAndVerifyProfile(body, options)))
        sendJson(response, 200, { profile })
        return
      }
      if (request.method === "POST" && url.pathname === "/api/profile/verify") {
        await withWriteLock(() => readJson(request).then(body => verifySavedProfile(body, options)))
        sendJson(response, 200, { ok: true })
        return
      }
      if (request.method === "POST" && url.pathname === "/api/client/configure") {
        const client = await withWriteLock(() => readJson(request).then(body => configureClient(body, options)))
        sendJson(response, 200, { client })
        return
      }
      if (request.method === "POST" && url.pathname === "/api/finish") {
        await readJson(request)
        response.once("finish", () => finish?.())
        sendJson(response, 200, { ok: true })
        return
      }
      sendJson(response, 404, { code: "NOT_FOUND", message: "Onboarding route was not found" })
    } catch (error) {
      sendJson(response, errorStatus(error), errorPayload(error))
    }
  })

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(options.port ?? 0, HOST, resolve)
  })
  const address = server.address()
  if (!address || typeof address === "string") {
    await new Promise<void>(resolve => server.close(() => resolve()))
    throw new AppError("ONBOARD_LISTEN_FAILED", "Could not determine the onboarding port")
  }
  port = address.port
  let closed = false
  return {
    url: `http://${HOST}:${port}/?token=${encodeURIComponent(token)}`,
    finished,
    close: async () => {
      if (closed) return
      closed = true
      await new Promise<void>((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve())
      })
    }
  }
}

function defaultOpenBrowser(url: string): void {
  const command = process.platform === "darwin"
    ? "open"
    : process.platform === "win32"
      ? "rundll32"
      : "xdg-open"
  const args = process.platform === "win32"
    ? ["url.dll,FileProtocolHandler", url]
    : [url]
  const child = spawn(command, args, { detached: true, stdio: "ignore", windowsHide: true })
  child.once("error", () => undefined)
  child.unref()
}

export async function runOnboard(options: RunOnboardOptions): Promise<void> {
  const running = await startOnboardServer(options)
  const log = options.log ?? (message => stdout.write(`${message}\n`))
  log("SAP ABAP MCP onboarding is ready.")
  log(`If the browser does not open, visit: ${running.url}`)
  ;(options.openBrowser ?? defaultOpenBrowser)(running.url)

  let interrupt: (() => void) | undefined
  const interrupted = new Promise<void>(resolve => { interrupt = resolve })
  const handleSignal = () => interrupt?.()
  process.once("SIGINT", handleSignal)
  process.once("SIGTERM", handleSignal)
  try {
    await Promise.race([running.finished, interrupted])
  } finally {
    process.off("SIGINT", handleSignal)
    process.off("SIGTERM", handleSignal)
    await running.close().catch(error => {
      stderr.write(`Could not close onboarding server: ${error instanceof Error ? error.message : String(error)}\n`)
    })
  }
}

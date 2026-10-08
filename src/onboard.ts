import { spawn } from "node:child_process"
import { createRequire } from "node:module"
import which from "which"
import { randomBytes } from "node:crypto"
import { realpath, stat } from "node:fs/promises"
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
import { AppError } from "./errors.js"
import { parseBtpServiceKey } from "./btp-service-key.js"
import { browserOAuthLogin } from "./oauth-authorization-code.js"
import { V1_ERROR_SCHEMA } from "./mcp/v1/contracts.js"
import { v1Failure } from "./mcp/v1/result.js"
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

const httpsEndpoint = z.string().trim().max(2048).refine(value => {
  try {
    const url = new URL(value)
    return url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash
  } catch {
    return false
  }
}, "Use a complete HTTPS URL without credentials, a query, or a fragment")

const profileFields = {
  id: z.string().trim().min(1).max(32).regex(/^[A-Za-z0-9_-]+$/),
  language: z.string().trim().regex(/^[A-Za-z]{2}$/),
  environment: z.enum(["development", "quality", "production"]),
  allowedPackages: z.string().max(4096).optional(),
  accessMode: z.enum(["read_only", "packages", "unrestricted"]).optional()
}
const connectionFields = {
  ...profileFields,
  url: httpsEndpoint,
  client: z.string().trim().regex(/^\d{1,3}$/)
}
const oauthFields = {
  ...connectionFields,
  tokenUrl: httpsEndpoint,
  clientId: z.string().trim().min(1).max(256),
  scope: z.string().trim().max(2048).optional()
}
const profileRequestSchema = z.preprocess(raw => {
  if (raw && typeof raw === "object" && !("authType" in raw)) return { ...raw, authType: "basic" }
  return raw
}, z.discriminatedUnion("authType", [
  z.object({ ...connectionFields, authType: z.literal("basic"),
    username: z.string().trim().min(1).max(256), password: z.string().min(1).max(4096) }).strict(),
  z.object({ ...oauthFields, authType: z.literal("oauth_client_credentials"),
    clientSecret: z.string().min(1).max(4096) }).strict(),
  z.object({ ...oauthFields, authType: z.literal("oauth_authorization_code"),
    authorizationUrl: httpsEndpoint }).strict(),
  z.object({ ...profileFields, authType: z.literal("btp_service_key"),
    serviceKey: z.string().min(1).max(24 * 1024) }).strict()
]))

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

interface RegistrationTarget {
  command: string
  serverFile: string
  profileId: string
  profileHome: string
}

export interface OnboardClientStatus {
  id: OnboardClientId
  label: string
  installed: boolean
  configured: boolean
  mcpConnectionStatus: "connected" | "failed" | "authentication-required" | "unknown"
  installUrl: string
  version?: string
  issue?: string
  registration?: {
    state: "matches" | "different" | "unknown"
    differences: Array<"runtime" | "profile" | "profile-home" | "disabled">
    expected: RegistrationTarget
  }
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
  tokenUrl?: string
  authorizationUrl?: string
  clientId?: string
  scope?: string
  allowedPackages: string[]
  readOnly: boolean
}

export interface OnboardStatus {
  hostManaged?: boolean
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
  validateCredentials(profile: SapProfile, password: string): Promise<void | string>
  disconnectProfile?: (profileId: string) => Promise<void>
  browserLogin?: typeof browserOAuthLogin
  runner?: CommandRunner
  platform?: NodeJS.Platform
  homeDirectory?: string
  workingDirectory?: string
  hostManaged?: boolean
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

const readCmdShim = createRequire(import.meta.url)("read-cmd-shim") as (path: string) => Promise<string>

export const runLocalCommand: CommandRunner = async (command, args) => {
  let executable = command
  let executableArgs = [...args]
  if (process.platform === "win32") {
    try {
      executable = await which(command)
      if (/\.cmd$/i.test(executable)) {
        const target = resolve(dirname(executable), await readCmdShim(executable))
        if (/\.[cm]?js$/i.test(target)) {
          executable = process.execPath
          executableArgs = [target, ...args]
        } else if (/\.(?:exe|com)$/i.test(target)) {
          executable = target
        } else {
          return { ok: false, stdout: "", stderr: "Unsupported Windows command shim target", missing: false }
        }
      }
    } catch (error) {
      return {
        ok: false, stdout: "", stderr: error instanceof Error ? error.message : String(error),
        missing: (error as NodeJS.ErrnoException).code === "ENOENT"
      }
    }
  }
  return new Promise(resolve => {
    const child = spawn(executable, executableArgs, {
      windowsHide: true, stdio: ["ignore", "pipe", "pipe"]
    })
    const timeout = setTimeout(() => child.kill(), 30_000)
    const output: Buffer[] = []
    const errorOutput: Buffer[] = []
    let outputBytes = 0
    let errorBytes = 0
    let overflow = false
    const collect = (chunk: Buffer, stderr: boolean) => {
      if (stderr) errorBytes += chunk.length
      else outputBytes += chunk.length
      if (outputBytes > 1024 * 1024 || errorBytes > 1024 * 1024) {
        overflow = true
        child.kill()
        return
      }
      const chunks = stderr ? errorOutput : output
      chunks.push(chunk)
    }
    child.stdout?.on("data", chunk => collect(chunk, false))
    child.stderr?.on("data", chunk => collect(chunk, true))
    child.on("error", error => {
      clearTimeout(timeout)
      resolve({
        ok: false, stdout: "", stderr: error.message,
        missing: (error as NodeJS.ErrnoException).code === "ENOENT"
      })
    })
    child.on("close", (code, signal) => {
      clearTimeout(timeout)
      const stderr = Buffer.concat(errorOutput).toString("utf8")
      resolve({
        ok: code === 0 && signal === null && !overflow,
        stdout: Buffer.concat(output).toString("utf8"), stderr,
        missing: /not recognized as an internal or external command|command not found/i.test(stderr)
      })
    })
  })
}

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
  const separator = row.lastIndexOf(" - ")
  const statusText = separator >= 0 ? row.slice(separator + 3) : row.replace(/^\s*sap-abap:\s*/i, "")
  const status = statusText.match(/^(?:[✓✔✗✘⚠!]\s*)?(connected|failed(?: to connect)?|needs authentication|requires authentication)(?=\s|$)/i)?.[1]?.toLowerCase()
  return { configured: true, mcpConnectionStatus: status === "connected" ? "connected"
    : status?.startsWith("failed") ? "failed"
    : status?.includes("authentication") ? "authentication-required" : "unknown" }
}

async function inspectClient(
  definition: typeof CLIENTS[number],
  runner: CommandRunner,
  target?: RegistrationTarget
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
  const registration = listResult.ok ? clientRegistration(`${listResult.stdout}\n${listResult.stderr}`)
    : { configured: false, mcpConnectionStatus: "unknown" as const }
  return {
    id: definition.id,
    label: definition.label,
    installed: true,
    ...registration,
    ...(registration.configured && target
      ? { registration: await inspectRegistration(definition, runner, target) } : {}),
    installUrl: definition.installUrl,
    ...(version ? { version } : {}),
    ...(!listResult.ok
      ? { issue: oneLine(listResult.stderr) ?? "MCP settings could not be read" }
      : {})
  }
}

function registrationTarget(options: OnboardServices, profileId: string): RegistrationTarget {
  return {
    command: process.execPath,
    serverFile: fileURLToPath(new URL("./index.js", import.meta.url)),
    profileId,
    profileHome: dirname(resolve(options.profiles.filePath))
  }
}

async function sameFile(left: string, right: string): Promise<boolean> {
  try { return await realpath(left) === await realpath(right) }
  catch { return left === right }
}

async function inspectRegistration(
  definition: typeof CLIENTS[number],
  runner: CommandRunner,
  expected: RegistrationTarget
): Promise<NonNullable<OnboardClientStatus["registration"]>> {
  const unknown = { state: "unknown" as const, differences: [], expected }
  const details = await runner(definition.command, ["mcp", "get", MCP_SERVER_NAME,
    ...(definition.id === "codex" ? ["--json"] : [])])
  if (!details.ok) return unknown
  let command: string, args: string[], profileHome: string | undefined, enabled = true
  if (definition.id === "codex") {
    const schema = z.object({ enabled: z.boolean().optional(), transport: z.object({
      type: z.string(), command: z.string().optional(), args: z.array(z.string()).optional(),
      env: z.record(z.string(), z.string()).nullable().optional()
    }) })
    let parsed: z.infer<typeof schema>
    try { parsed = schema.parse(JSON.parse(details.stdout)) } catch { return unknown }
    if (parsed.transport.type !== "stdio") return { state: "different", differences: ["runtime"], expected }
    if (!parsed.transport.command || !parsed.transport.args?.length) return unknown
    command = parsed.transport.command
    args = parsed.transport.args
    profileHome = parsed.transport.env?.SAP_ABAP_MCP_HOME
    enabled = parsed.enabled !== false
  } else {
    const output = details.stdout.replace(/\u001b\[[0-9;]*m/g, "")
    const field = (name: string) => output.match(new RegExp(`^\\s*${name}:\\s*(.*)$`, "m"))?.[1]?.trim()
    if (field("Type") !== "stdio") return field("Type")
      ? { state: "different", differences: ["runtime"], expected } : unknown
    const displayedCommand = field("Command"), displayedArgs = field("Args")
    if (!displayedCommand || !displayedArgs) return unknown
    const serve = displayedArgs.indexOf(" serve")
    if (serve < 0) return { state: "different", differences: ["runtime"], expected }
    command = displayedCommand
    args = [displayedArgs.slice(0, serve), ...displayedArgs.slice(serve + 1).split(/\s+/)]
    profileHome = output.match(/^\s+SAP_ABAP_MCP_HOME=(.*)$/m)?.[1]?.trim()
    enabled = !/disabled|rejected|pending approval/i.test(field("Status") ?? "")
  }
  if ([command, ...args, profileHome ?? ""].some(value => /\$\{|%[^%]+%/.test(value))) return unknown
  args = args.flatMap(value => value.startsWith("--") && value.includes("=")
    ? [value.slice(0, value.indexOf("=")), value.slice(value.indexOf("=") + 1)] : [value])
  const differences: NonNullable<OnboardClientStatus["registration"]>["differences"] = []
  if (!await sameFile(command, expected.command) || !await sameFile(args[0]!, expected.serverFile) ||
      args[1] !== "serve" || args.includes("--http") || (args.includes("--api-version") && args[args.lastIndexOf("--api-version") + 1] !== "v1")) {
    differences.push("runtime")
  }
  const profiles = args.flatMap((value, index) => value === "--profile" ? [args[index + 1] ?? ""] : [])
  if (profiles.length > 1 || (profiles.length === 1 && profiles[0]!.toUpperCase() !== expected.profileId)) differences.push("profile")
  if (profileHome && !await sameFile(profileHome, expected.profileHome)) differences.push("profile-home")
  if (!enabled) differences.push("disabled")
  return { state: differences.length ? "different" : profileHome ? "matches" : "unknown", differences, expected }
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

export async function inspectOnboardStatus(options: OnboardServices, profileId?: string): Promise<OnboardStatus> {
  const runner = options.runner ?? runLocalCommand
  const platform = options.platform ?? process.platform
  const home = options.homeDirectory ?? homedir()
  const cwd = options.workingDirectory ?? process.cwd()
  const target = profileId ? registrationTarget(options, (await options.profiles.get(profileId)).id) : undefined
  const [npm, clients, files, profiles] = await Promise.all([
    options.hostManaged ? Promise.resolve({ ok: false, stdout: "", stderr: "" }) : runner("npm", ["--version"]),
    options.hostManaged ? Promise.resolve([]) : Promise.all(CLIENTS.map(client => inspectClient(client, runner, target))),
    options.hostManaged ? Promise.resolve([]) : Promise.all(expectedFiles(home, cwd).map(async path => ({ path, exists: await pathExists(path) }))),
    options.profiles.list().then(items => Promise.all(items.map(async profile => ({
      id: profile.id,
      url: profile.url,
      client: profile.client,
      language: profile.language,
      environment: profile.environment,
      authType: profile.authType,
      allowedPackages: profile.allowedPackages,
      readOnly: Boolean(profile.readOnly || profile.environment === "production"),
      ...(profile.username ? { username: profile.username } : {}),
      ...(profile.authType === "oauth_client_credentials" || profile.authType === "oauth_authorization_code"
        ? { tokenUrl: profile.tokenUrl, clientId: profile.clientId, ...(profile.scope ? { scope: profile.scope } : {}),
            ...(profile.authType === "oauth_authorization_code" ? { authorizationUrl: profile.authorizationUrl } : {}) }
        : {}),
      credentialAvailable: await options.secrets.get(profile.id).then(Boolean).catch(() => false)
    }))))
  ])
  const npmVersion = oneLine(npm.stdout || npm.stderr)

  return {
    ...(options.hostManaged ? { hostManaged: true } : {}),
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
  options: OnboardServices,
  signal: AbortSignal
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
  const authType = request.authType === "btp_service_key" ? "oauth_client_credentials" : request.authType
  if (existing && existing.authType !== authType) {
    throw new AppError("PROFILE_AUTH_TYPE_UNSUPPORTED", `Profile ${existing.id} uses a different authentication type. Use a new connection name.`)
  }
  const requestedPackages = request.allowedPackages?.split(",").map(value => value.trim()).filter(Boolean)
  if ((request.accessMode === "packages" && !requestedPackages?.length) ||
      (request.environment === "production" && request.accessMode !== undefined && request.accessMode !== "read_only")) {
    throw new AppError("PROFILE_WRITE_POLICY_INVALID", "Choose read-only access or specify packages for changes on a development or quality system")
  }
  const input: SapProfileInput = {
    ...existing,
    id: request.id,
    url: request.authType === "btp_service_key" ? "" : request.url,
    client: request.authType === "btp_service_key" ? "" : request.client,
    language: request.language,
    environment: request.environment,
    authType,
    readOnly: request.accessMode === undefined ? existing ? existing.readOnly : true : request.accessMode === "read_only",
    allowDataQueries: request.environment === "production" ? false : existing?.allowDataQueries ?? false,
    allowedPackages: request.accessMode === "unrestricted" ? [] : requestedPackages ?? existing?.allowedPackages ?? []
  }
  let credential: string
  if (request.authType === "btp_service_key") {
    const key = parseBtpServiceKey(request.serviceKey)
    Object.assign(input, { url: key.url, client: key.client, tokenUrl: key.tokenUrl, clientId: key.clientId })
    credential = key.clientSecret
  } else if (request.authType === "basic") {
    input.username = request.username
    credential = request.password
  } else {
    Object.assign(input, { tokenUrl: request.tokenUrl, clientId: request.clientId, scope: request.scope || undefined })
    if (request.authType === "oauth_authorization_code") input.authorizationUrl = request.authorizationUrl
    credential = request.authType === "oauth_client_credentials" ? request.clientSecret : ""
  }
  const profile = normalizeProfile(input)
  if (signal.aborted) throw new AppError("CANCELLED", "SAP setup was cancelled before authentication")
  if (profile.authType === "oauth_authorization_code") {
    credential = await (options.browserLogin ?? browserOAuthLogin)({
      authorizationUrl: profile.authorizationUrl, tokenUrl: profile.tokenUrl,
      clientId: profile.clientId, ...(profile.scope ? { scope: profile.scope } : {})
    }, { signal })
  }
  credential = await options.validateCredentials(profile, credential) ?? credential
  if (signal.aborted) throw new AppError("CANCELLED", "SAP setup was cancelled before saving")
  await saveProfileCredential(options.profiles, options.secrets, input, credential)
  await options.disconnectProfile?.(profile.id)
  return {
    id: profile.id,
    url: profile.url,
    client: profile.client,
    language: profile.language,
    environment: profile.environment,
    authType: profile.authType,
    ...(profile.username ? { username: profile.username } : {}),
    credentialAvailable: true,
    allowedPackages: profile.allowedPackages,
    readOnly: Boolean(profile.readOnly || profile.environment === "production")
  }
}

async function verifySavedProfile(raw: unknown, options: OnboardServices): Promise<void> {
  const request = parse(verifyRequestSchema, raw)
  const profile = await options.profiles.get(request.profileId)
  const password = await options.secrets.get(profile.id)
  if (!password) {
    throw new AppError("AUTH_REQUIRED", `No saved SAP credential was found for ${profile.id}`)
  }
  const verifiedCredential = await options.validateCredentials(profile, password)
  if (verifiedCredential !== undefined && verifiedCredential !== password) {
    await options.secrets.set(profile.id, verifiedCredential)
  }
}

async function configureClient(raw: unknown, options: OnboardServices): Promise<OnboardClientStatus> {
  const request = parse(configureRequestSchema, raw)
  const profile = await options.profiles.get(request.profileId)
  const runner = options.runner ?? runLocalCommand
  const definition = CLIENTS.find(client => client.id === request.clientId)
  if (!definition) throw new AppError("CLIENT_UNKNOWN", "Unknown AI client")
  const target = registrationTarget(options, profile.id)
  const current = await inspectClient(definition, runner, target)
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
    profile.id,
    "--preset",
    request.preset
  ]
  const profileEnvironment = `SAP_ABAP_MCP_HOME=${dirname(resolve(options.profiles.filePath))}`
  const args = definition.id === "claude"
    ? ["mcp", "add", "--transport", "stdio", "--scope", "user", MCP_SERVER_NAME, "--env", profileEnvironment, "--", ...serverArgs]
    : ["mcp", "add", "--env", profileEnvironment, MCP_SERVER_NAME, "--", ...serverArgs]
  const result = await runner(definition.command, args)
  if (!result.ok) {
    throw new AppError(
      "CLIENT_CONFIG_FAILED",
      oneLine(result.stderr || result.stdout) ?? `${definition.label} MCP configuration failed`
    )
  }
  const configured = await inspectClient(definition, runner, target)
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

function errorStatus(code: string): number {
  if (code === "INTERNAL_ERROR") return 500
  if (code === "ONBOARD_BUSY") return 409
  if (code === "PROFILE_NOT_FOUND") return 404
  return 400
}

export async function startOnboardServer(
  options: StartOnboardServerOptions
): Promise<RunningOnboardServer> {
  const token = randomBytes(32).toString("base64url")
  const nonce = randomBytes(18).toString("base64url")
  let port = 0
  let writing = false
  const verifiedProfiles = new Set<string>()
  let activeProfile: AbortController | undefined
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
      const requestedLocale = url.searchParams.get("lang")
      const preferredLanguage = request.headers["accept-language"]?.split(",")[0]?.trim().toLowerCase()
      const locale = requestedLocale === "ko" || requestedLocale === "en" ? requestedLocale
        : !preferredLanguage || preferredLanguage === "*" || /^ko(?:-|;|$)/.test(preferredLanguage) ? "ko" : "en"
      response.end(onboardPage(token, nonce, locale, options.hostManaged))
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
        const profileId = url.searchParams.get("profileId")
        if (profileId !== null) parse(verifyRequestSchema, { profileId })
        sendJson(response, 200, await inspectOnboardStatus(options, profileId ?? undefined))
        return
      }
      if (request.method === "POST" && url.pathname === "/api/profile") {
        const profile = await withWriteLock(async () => {
          const controller = new AbortController()
          activeProfile = controller
          const disconnected = () => { if (!response.writableEnded) controller.abort() }
          response.once("close", disconnected)
          try {
            return await saveAndVerifyProfile(await readJson(request), options, controller.signal)
          } finally {
            response.off("close", disconnected)
            activeProfile = undefined
          }
        })
        verifiedProfiles.add(profile.id)
        sendJson(response, 200, { profile })
        return
      }
      if (request.method === "POST" && url.pathname === "/api/profile/cancel") {
        await readJson(request)
        activeProfile?.abort()
        sendJson(response, 200, { ok: true })
        return
      }
      if (request.method === "POST" && url.pathname === "/api/profile/verify") {
        await withWriteLock(async () => {
          const body = await readJson(request)
          const { profileId } = parse(verifyRequestSchema, body)
          verifiedProfiles.delete(profileId.toUpperCase())
          await verifySavedProfile(body, options)
          verifiedProfiles.add(profileId.toUpperCase())
        })
        sendJson(response, 200, { ok: true })
        return
      }
      if (request.method === "POST" && url.pathname === "/api/client/configure") {
        if (options.hostManaged) {
          sendJson(response, 409, { code: "ONBOARD_HOST_MANAGED", message: "The installing app manages this MCP registration" })
          return
        }
        const client = await withWriteLock(() => readJson(request).then(body => configureClient(body, options)))
        sendJson(response, 200, { client })
        return
      }
      if (request.method === "POST" && url.pathname === "/api/finish") {
        const body = await readJson(request)
        if (options.hostManaged) {
          const { profileId } = parse(verifyRequestSchema, body)
          if (!verifiedProfiles.has(profileId.toUpperCase())) {
            sendJson(response, 409, { code: "ONBOARD_PROFILE_UNVERIFIED", message: "Verify this SAP profile before finishing setup" })
            return
          }
        }
        response.once("finish", () => finish?.())
        sendJson(response, 200, { ok: true })
        return
      }
      sendJson(response, 404, { code: "NOT_FOUND", message: "Onboarding route was not found" })
    } catch (error) {
      const failure = v1Failure(error).content[0]
      const payload = V1_ERROR_SCHEMA.parse(JSON.parse(failure?.type === "text" ? failure.text : "{}"))
      sendJson(response, errorStatus(payload.code), { code: payload.code, message: payload.message })
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
      activeProfile?.abort()
      await new Promise<void>((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve())
      })
    }
  }
}

export function defaultOpenBrowser(url: string): void {
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

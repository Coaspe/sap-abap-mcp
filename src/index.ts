#!/usr/bin/env node

import { stdin, stderr, stdout } from "node:process"
import { realpathSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { AppError, errorPayload } from "./errors.js"
import { ConnectionManager } from "./connection-manager.js"
import { createMcpServer, startStdioServer } from "./mcp-server.js"
import { parseMcpApiVersion } from "./mcp/api-version.js"
import { resolveServeToolSelection } from "./mcp/tool-selection.js"
import { V1_IMPLEMENTED_TOOL_NAMES } from "./mcp/v1/migration-catalog.js"
import {
  TOOLSET_NAMES,
  type ToolsetName
} from "./compat/abap-fs-tools.js"
import {
  normalizeProfile,
  ProfileStore,
  type SapProfile,
  type SapProfileInput
} from "./profile-store.js"
import { createDefaultSecretStore, type SecretStore } from "./secret-store.js"
import { AbapToolService } from "./tool-service.js"
import {
  abapGitCredentialKey,
  decodeAbapGitCredentials,
  encodeAbapGitCredentials,
  normalizeAbapGitRepositoryUrl
} from "./abapgit-credentials.js"
import {
  createTerminalSetupPrompter,
  runSetupRemoval,
  runSetupWizard
} from "./setup-wizard.js"

const HELP = `sap-abap-mcp

Commands:
  setup
  setup edit [<server-name>]
  setup remove [<server-name>]
  profile add <id> --url <url> --client <nnn> [--language EN]
      [--environment development|quality|production] [--username <user>]
      [--auth-type basic|oauth-client-credentials]
      [--token-url <url> --client-id <id> [--scope <scope>]]
      [--packages ZPKG1,ZPKG2] [--login [--password-stdin]]
  profile list
  profile remove <id>
  auth login <id> [--username <user>] [--password-stdin]
  auth status <id>
  auth logout <id>
  abapgit auth login <id> --repository-url <url> --username <user> [--password-stdin]
  abapgit auth status <id> --repository-url <url>
  abapgit auth logout <id> --repository-url <url>
  doctor <id> [--include-components]
  serve [--profile <id>] [--api-version v0|v1|all] [--toolsets core,write,analysis,debug,operations,artifacts|all]
`

interface ParsedArguments {
  positionals: string[]
  options: Map<string, string | true>
}

function parseArguments(args: string[]): ParsedArguments {
  const positionals: string[] = []
  const options = new Map<string, string | true>()

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index] ?? ""
    if (!argument.startsWith("--")) {
      positionals.push(argument)
      continue
    }

    const equalsIndex = argument.indexOf("=")
    if (equalsIndex >= 0) {
      options.set(argument.slice(2, equalsIndex), argument.slice(equalsIndex + 1))
      continue
    }

    const name = argument.slice(2)
    const next = args[index + 1]
    if (next && !next.startsWith("--")) {
      options.set(name, next)
      index += 1
    } else {
      options.set(name, true)
    }
  }

  return { positionals, options }
}

function option(parsed: ParsedArguments, name: string): string | undefined {
  const value = parsed.options.get(name)
  return typeof value === "string" ? value : undefined
}

function requiredOption(parsed: ParsedArguments, name: string): string {
  const value = option(parsed, name)
  if (!value) throw new AppError("OPTION_REQUIRED", `--${name} is required`)
  return value
}

function requiredPosition(parsed: ParsedArguments, index: number, label: string): string {
  const value = parsed.positionals[index]
  if (!value) throw new AppError("ARGUMENT_REQUIRED", `${label} is required`)
  return value
}

function writeJson(value: unknown): void {
  stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

async function readAllStdin(): Promise<string> {
  let value = ""
  stdin.setEncoding("utf8")
  for await (const chunk of stdin) value += chunk
  return value.replace(/[\r\n]+$/, "")
}

async function promptSecret(prompt: string): Promise<string> {
  if (!stdin.isTTY || typeof stdin.setRawMode !== "function") {
    throw new AppError(
      "PASSWORD_INPUT_REQUIRED",
      "Interactive password input needs a TTY. Pipe the password and add --password-stdin."
    )
  }

  return new Promise((resolve, reject) => {
    let password = ""
    const previousRawMode = stdin.isRaw

    const cleanup = () => {
      stdin.off("data", onData)
      stdin.setRawMode(previousRawMode)
      stdin.pause()
    }

    const onData = (chunk: Buffer | string) => {
      for (const character of String(chunk)) {
        if (character === "\u0003") {
          cleanup()
          stderr.write("\n")
          reject(new AppError("CANCELLED", "Login was cancelled"))
          return
        }
        if (character === "\r" || character === "\n") {
          cleanup()
          stderr.write("\n")
          resolve(password)
          return
        }
        if (character === "\u007f" || character === "\u0008") {
          password = password.slice(0, -1)
          continue
        }
        if (character >= " ") password += character
      }
    }

    stderr.write(prompt)
    stdin.setRawMode(true)
    stdin.resume()
    stdin.on("data", onData)
  })
}

function withUsername(profile: SapProfile, username: string): SapProfile & { username: string } {
  return { ...profile, username: username.trim() }
}

export interface ProfileLoginOptions {
  password: string
  validateCredentials: (profile: SapProfile, password: string) => Promise<void>
}

export async function addProfile(
  input: SapProfileInput,
  profiles: ProfileStore,
  secrets: SecretStore,
  login?: ProfileLoginOptions
): Promise<{ profile: SapProfile; credentialStored?: true }> {
  const profile = normalizeProfile(input)
  if (!login) {
    await profiles.upsert(input)
    return { profile }
  }
  if (profile.authType === "basic" && !profile.username) {
    throw new AppError("USERNAME_REQUIRED", "Provide --username when using --login")
  }
  if (!login.password) {
    throw new AppError(
      profile.authType === "basic" ? "PASSWORD_REQUIRED" : "CLIENT_SECRET_REQUIRED",
      profile.authType === "basic"
        ? "SAP password cannot be empty"
        : "OAuth client secret cannot be empty"
    )
  }
  await login.validateCredentials(profile, login.password)
  await profiles.upsert(input)
  await secrets.set(profile.id, login.password)
  return { profile, credentialStored: true }
}

async function profileCommand(parsed: ParsedArguments, profiles: ProfileStore, secrets: SecretStore) {
  const action = requiredPosition(parsed, 1, "profile action")

  if (action === "list") {
    const items = await profiles.list()
    writeJson({ profiles: items })
    return
  }

  if (action === "add") {
    const id = requiredPosition(parsed, 2, "profile id")
    const language = option(parsed, "language")
    const environment = option(parsed, "environment")
    const username = option(parsed, "username")
    const packages = option(parsed, "packages")
    const authTypeOption = option(parsed, "auth-type") ?? "basic"
    if (authTypeOption !== "basic" && authTypeOption !== "oauth-client-credentials") {
      throw new AppError(
        "AUTH_TYPE_INVALID",
        "--auth-type must be basic or oauth-client-credentials"
      )
    }
    const authType = authTypeOption === "oauth-client-credentials"
      ? "oauth_client_credentials" as const
      : "basic" as const
    const input: SapProfileInput = {
      id,
      url: requiredOption(parsed, "url"),
      client: requiredOption(parsed, "client"),
      ...(language ? { language } : {}),
      ...(environment ? { environment: environment as SapProfile["environment"] } : {}),
      ...(username ? { username } : {}),
      authType,
      ...(authType === "oauth_client_credentials"
        ? {
            tokenUrl: requiredOption(parsed, "token-url"),
            clientId: requiredOption(parsed, "client-id"),
            ...(option(parsed, "scope") ? { scope: option(parsed, "scope") } : {})
          }
        : {}),
      ...(packages ? { allowedPackages: packages.split(",") } : {})
    }
    if (!parsed.options.has("login")) {
      writeJson(await addProfile(input, profiles, secrets))
      return
    }

    const candidate = normalizeProfile(input)
    if (candidate.authType === "basic" && !candidate.username) {
      throw new AppError("USERNAME_REQUIRED", "Provide --username when using --login")
    }
    const password = parsed.options.has("password-stdin")
      ? await readAllStdin()
      : await promptSecret(
          candidate.authType === "basic" ? "SAP password: " : "OAuth client secret: "
        )
    const manager = new ConnectionManager(profiles, secrets)
    writeJson(await addProfile(input, profiles, secrets, {
      password,
      validateCredentials: (profile, value) => manager.validateCredentials(profile, value)
    }))
    return
  }

  if (action === "remove") {
    const id = requiredPosition(parsed, 2, "profile id")
    const removed = await profiles.remove(id)
    await secrets.delete(id)
    await secrets.delete(abapGitCredentialKey(id))
    writeJson({ id: id.toUpperCase(), removed })
    return
  }

  throw new AppError("UNKNOWN_COMMAND", `Unknown profile action: ${action}`)
}

async function authCommand(parsed: ParsedArguments, profiles: ProfileStore, secrets: SecretStore) {
  const action = requiredPosition(parsed, 1, "auth action")
  const id = requiredPosition(parsed, 2, "profile id")

  if (action === "status") {
    const profile = await profiles.get(id)
    writeJson({
      profileId: profile.id,
      authType: profile.authType,
      username: profile.username ?? null,
      credentialAvailable: Boolean(await secrets.get(profile.id))
    })
    return
  }

  if (action === "logout") {
    await profiles.get(id)
    await secrets.delete(id)
    writeJson({ profileId: id.toUpperCase(), credentialAvailable: false })
    return
  }

  if (action === "login") {
    const storedProfile = await profiles.get(id)
    const username = option(parsed, "username") ?? storedProfile.username
    if (storedProfile.authType === "basic" && !username) {
      throw new AppError("USERNAME_REQUIRED", "Provide --username or store it in the profile")
    }

    const profile = username ? withUsername(storedProfile, username) : storedProfile
    const password = parsed.options.has("password-stdin")
      ? await readAllStdin()
      : await promptSecret(
          profile.authType === "basic" ? "SAP password: " : "OAuth client secret: "
        )
    if (!password) {
      throw new AppError(
        profile.authType === "basic" ? "PASSWORD_REQUIRED" : "CLIENT_SECRET_REQUIRED",
        profile.authType === "basic"
          ? "SAP password cannot be empty"
          : "OAuth client secret cannot be empty"
      )
    }

    const manager = new ConnectionManager(profiles, secrets)
    await manager.validateCredentials(profile, password)
    await profiles.upsert(profile)
    await secrets.set(profile.id, password)
    writeJson({
      profileId: profile.id,
      authType: profile.authType,
      username: profile.username ?? null,
      credentialStored: true
    })
    return
  }

  throw new AppError("UNKNOWN_COMMAND", `Unknown auth action: ${action}`)
}

async function abapGitCommand(
  parsed: ParsedArguments,
  profiles: ProfileStore,
  secrets: SecretStore
) {
  const group = requiredPosition(parsed, 1, "abapgit command")
  if (group !== "auth") {
    throw new AppError("UNKNOWN_COMMAND", `Unknown abapgit command: ${group}`)
  }
  const action = requiredPosition(parsed, 2, "abapgit auth action")
  const id = requiredPosition(parsed, 3, "profile id")
  const profile = await profiles.get(id)
  const repositoryUrl = normalizeAbapGitRepositoryUrl(
    requiredOption(parsed, "repository-url")
  )
  const key = abapGitCredentialKey(profile.id)
  const stored = await secrets.get(key)
  const credentials = stored ? decodeAbapGitCredentials(stored) : []
  const existing = credentials.find(item => item.repositoryUrl === repositoryUrl)
  if (action === "status") {
    writeJson({
      profileId: profile.id,
      repositoryUrl,
      username: existing?.username ?? null,
      credentialAvailable: Boolean(existing)
    })
    return
  }
  if (action === "logout") {
    const remaining = credentials.filter(item => item.repositoryUrl !== repositoryUrl)
    if (remaining.length > 0) await secrets.set(key, encodeAbapGitCredentials(remaining))
    else await secrets.delete(key)
    writeJson({ profileId: profile.id, repositoryUrl, credentialAvailable: false })
    return
  }
  if (action === "login") {
    const username = requiredOption(parsed, "username").trim()
    const password = parsed.options.has("password-stdin")
      ? await readAllStdin()
      : await promptSecret("abapGit password or token: ")
    if (!password) {
      throw new AppError("PASSWORD_REQUIRED", "abapGit password or token cannot be empty")
    }
    const next = credentials.filter(item => item.repositoryUrl !== repositoryUrl)
    next.push({ repositoryUrl, username, password })
    await secrets.set(key, encodeAbapGitCredentials(next))
    writeJson({ profileId: profile.id, repositoryUrl, username, credentialStored: true })
    return
  }
  throw new AppError("UNKNOWN_COMMAND", `Unknown abapgit auth action: ${action}`)
}

async function doctorCommand(parsed: ParsedArguments, profiles: ProfileStore, secrets: SecretStore) {
  const id = requiredPosition(parsed, 1, "profile id")
  const manager = new ConnectionManager(profiles, secrets, undefined, id)
  try {
    const client = await manager.getClient(id)
    const system = await client.getSystemInfo(parsed.options.has("include-components"))
    writeJson({ ok: true, system })
  } finally {
    await manager.close()
  }
}

async function setupCommand(
  parsed: ParsedArguments,
  profiles: ProfileStore,
  secrets: SecretStore
) {
  const action = parsed.positionals[1]
  const serverName = parsed.positionals[2]
  if (action === "remove") {
    await runSetupRemoval({
      profiles,
      secrets,
      prompter: createTerminalSetupPrompter(promptSecret),
      ...(serverName ? { serverName } : {})
    })
    return
  }
  if (action && action !== "edit") {
    throw new AppError("UNKNOWN_COMMAND", `Unknown setup action: ${action}`)
  }

  const manager = new ConnectionManager(profiles, secrets)
  try {
    await runSetupWizard({
      profiles,
      secrets,
      prompter: createTerminalSetupPrompter(promptSecret),
      platform: process.platform,
      ...(action === "edit" ? { mode: "edit" as const } : {}),
      ...(serverName ? { serverName } : {}),
      validateCredentials: (profile, password) => manager.validateCredentials(profile, password)
    })
  } finally {
    await manager.close()
  }
}

async function serveCommand(parsed: ParsedArguments, profiles: ProfileStore, secrets: SecretStore) {
  const rawApiVersion = parsed.options.get("api-version")
  if (rawApiVersion === true) {
    throw new AppError("OPTION_REQUIRED", "--api-version requires a value")
  }
  const apiVersion = parseMcpApiVersion(rawApiVersion)
  const profileId = option(parsed, "profile")
  if (profileId) await profiles.get(profileId)
  const toolsetsValue = option(parsed, "toolsets")
  let selectedToolsets: ToolsetName[] | undefined
  if (toolsetsValue) {
    const toolsets = toolsetsValue.split(",").map(value => value.trim()).filter(Boolean)
    const invalid = toolsets.filter(value =>
      !TOOLSET_NAMES.includes(value as ToolsetName)
    )
    if (invalid.length > 0) {
      throw new AppError(
        "INVALID_TOOLSET",
        `Unknown toolsets: ${invalid.join(", ")}`,
        { available: TOOLSET_NAMES }
      )
    }
    selectedToolsets = toolsets as ToolsetName[]
  }

  const selection = resolveServeToolSelection(apiVersion, selectedToolsets)
  if (apiVersion === "v1" && selection.enabledV1Tools &&
    !V1_IMPLEMENTED_TOOL_NAMES.some(name => selection.enabledV1Tools!.has(name))) {
    throw new AppError(
      "V1_TOOLSET_EMPTY",
      "The selected toolsets contain no implemented v1 tools",
      { available: ["core", "all"] }
    )
  }

  const manager = new ConnectionManager(profiles, secrets, undefined, profileId)
  const server = createMcpServer(
    new AbapToolService(manager, secrets),
    { apiVersion, ...selection }
  )
  let closing = false
  const close = async () => {
    if (closing) return
    closing = true
    await server.close().catch(() => undefined)
    await manager.close()
  }
  process.once("SIGINT", () => void close().finally(() => process.exit(0)))
  process.once("SIGTERM", () => void close().finally(() => process.exit(0)))
  process.once("beforeExit", () => void close())
  await startStdioServer(server)
}

export async function runCli(args = process.argv.slice(2)): Promise<void> {
  const parsed = parseArguments(args)
  const command = parsed.positionals[0]
  if (!command || command === "help" || parsed.options.has("help")) {
    stdout.write(HELP)
    return
  }

  const profiles = new ProfileStore()
  const secrets = createDefaultSecretStore()
  if (command === "setup") return setupCommand(parsed, profiles, secrets)
  if (command === "profile") return profileCommand(parsed, profiles, secrets)
  if (command === "auth") return authCommand(parsed, profiles, secrets)
  if (command === "abapgit") return abapGitCommand(parsed, profiles, secrets)
  if (command === "doctor") return doctorCommand(parsed, profiles, secrets)
  if (command === "serve") return serveCommand(parsed, profiles, secrets)
  throw new AppError("UNKNOWN_COMMAND", `Unknown command: ${command}`)
}

function isMainModule(): boolean {
  if (!process.argv[1]) return false
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
}

if (isMainModule()) {
  runCli().catch(error => {
    stderr.write(`${JSON.stringify(errorPayload(error), null, 2)}\n`)
    process.exitCode = 1
  })
}

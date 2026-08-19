#!/usr/bin/env node

import { stdin, stderr, stdout } from "node:process"
import { realpathSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { AppError, errorPayload } from "./errors.js"
import {
  AuditRecorder,
  createAuditSink,
  parseAuditSinkName
} from "./audit-log.js"
import { loadBtpServiceKey } from "./btp-service-key.js"
import {
  changeAssuranceExitCode,
  type ChangeAssuranceCheck,
  type ChangeAssuranceFormat,
  type ChangeAssuranceGateStatus
} from "./change-assurance.js"
import { ConnectionManager } from "./connection-manager.js"
import { browserOAuthLogin } from "./oauth-authorization-code.js"
import {
  generateApiKey,
  generateApiKeyPepper,
  hashApiKey,
  hmacApiKey,
  loadApiKeyPepper,
  loadApiKeyRecords,
  parseHttpRole
} from "./http/auth.js"
import {
  createOidcAuthenticator,
  parseOidcRoleMap,
  type OidcAuthenticator
} from "./http/oidc.js"
import { ScopedConnectionProvider } from "./http/scoped-connections.js"
import { RequestScopedConnectionProvider } from "./http/request-scoped-connections.js"
import { startHttpMcpServer } from "./http/server.js"
import { createMcpServer, startStdioServer } from "./mcp-server.js"
import { parseMcpApiVersion } from "./mcp/api-version.js"
import { resolveServeToolSelection } from "./mcp/tool-selection.js"
import { V1_IMPLEMENTED_TOOL_NAMES } from "./mcp/v1/migration-catalog.js"
import { V1_PRESET_NAMES, type V1PresetName } from "./mcp/v1/presets.js"
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
import { trimTrailingLineBreaks, trimTrailingSlashes } from "./text.js"
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
      [--auth-type basic|oauth-client-credentials|oauth-authorization-code|bearer-passthrough]
      [--authorization-url <url>] [--token-url <url> --client-id <id> [--scope <scope>]]
      [--classic-bridge-path /sap/bc/rest/zmcp_rfc]
      [--packages ZPKG1,ZPKG2] [--allow-data-queries] [--login [--password-stdin]]
  profile add <id> --service-key <path> [--language EN]
      [--environment development|quality|production] [--scope <scope>]
      [--packages ZPKG1,ZPKG2] [--allow-data-queries]
      Imports an SAP BTP ABAP environment service key, verifies it live, and
      stores the client secret in the protected credential store.
  profile list
  profile remove <id>
  auth login <id> [--username <user>] [--password-stdin]
  auth status <id>
  auth logout <id>
  abapgit auth login <id> --repository-url <url> --username <user> [--password-stdin]
  abapgit auth status <id> --repository-url <url>
  abapgit auth logout <id> --repository-url <url>
  doctor <id> [--include-components]
  apikey new <id> [--role viewer|developer|admin] [--pepper-file <path>]
  apikey pepper
  assure <id> --transport <trkorr> [--checks atc,unit_tests,target_compare]
      [--target-system <id>] [--fail-on-atc-warnings] [--max-objects <n>]
      [--formats json,sarif,junit] [--report-directory <path>]
      [--fail-on incomplete|failed]
      Read-only transport change assurance for CI. Exit 0 passed, 1 failed,
      2 incomplete. Never releases or modifies the transport.
  serve [--profile <id>] [--api-version v0|v1]
      [--preset compact|development|assurance]
      [--toolsets core,write,analysis,debug,operations,artifacts|all]
      [--audit-log none|stderr|file] [--audit-log-file <path>] [--audit-include-arguments]
      [--http [--api-keys-file <path>]
       [--oidc-issuer <url> --oidc-audience <aud> [--oidc-jwks-uri <url>]
        [--oidc-role-claim <claim>] [--oidc-role-map <value>=<role>,...]
        [--oidc-default-role viewer|developer|admin]]
       [--api-key-pepper-file <path>]
       [--host <host>] [--port <n>]
       [--allowed-origin <origin>] [--allowed-host <host>]
       [--rate-limit <requests-per-minute>] [--max-concurrent <n>]
       [--max-sessions <n>] [--session-timeout <seconds>]]
       Requires --api-keys-file, --oidc-issuer, or both.
      Defaults: api-version v1, all tools, audit-log none, stdio transport
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
  return trimTrailingLineBreaks(value)
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
    if (profile.authType === "bearer_passthrough") {
      throw new AppError(
        "AUTH_PASSTHROUGH_REQUIRED",
        "bearer-passthrough profiles receive credentials from OIDC-authenticated HTTP sessions"
      )
    }
    throw new AppError(
      profile.authType === "basic" ? "PASSWORD_REQUIRED" : "OAUTH_CREDENTIAL_REQUIRED",
      profile.authType === "basic"
        ? "SAP password cannot be empty"
        : "OAuth credential cannot be empty"
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
    const serviceKeyPath = option(parsed, "service-key")
    const classicBridgePath = option(parsed, "classic-bridge-path")

    if (serviceKeyPath) {
      // A BTP service key already carries the endpoint, client id, and client
      // secret, so it supplies every OAuth field and the secret is never typed
      // into a terminal or passed as an argument.
      const key = loadBtpServiceKey(serviceKeyPath)
      const serviceKeyInput: SapProfileInput = {
        id,
        url: key.url,
        client: key.client,
        ...(language ? { language } : {}),
        ...(environment ? { environment: environment as SapProfile["environment"] } : {}),
        ...(username ? { username } : {}),
        ...(classicBridgePath ? { classicBridgePath } : {}),
        allowDataQueries: parsed.options.has("allow-data-queries"),
        authType: "oauth_client_credentials",
        tokenUrl: key.tokenUrl,
        clientId: key.clientId,
        ...(option(parsed, "scope") ? { scope: option(parsed, "scope") } : {}),
        ...(packages ? { allowedPackages: packages.split(",") } : {})
      }
      const manager = new ConnectionManager(profiles, secrets)
      const result = await addProfile(serviceKeyInput, profiles, secrets, {
        password: key.clientSecret,
        validateCredentials: (profile, value) =>
          manager.validateCredentials(profile, value)
      })
      writeJson({
        ...result,
        ...(key.systemId ? { serviceKeySystemId: key.systemId } : {}),
        note: `The client secret was stored in the protected credential store. Delete ${serviceKeyPath} now; it still contains the secret in plain text.`
      })
      return
    }

    const authTypeOption = option(parsed, "auth-type") ?? "basic"
    if (!["basic", "oauth-client-credentials", "oauth-authorization-code", "bearer-passthrough"]
      .includes(authTypeOption)) {
      throw new AppError(
        "AUTH_TYPE_INVALID",
        "--auth-type must be basic, oauth-client-credentials, oauth-authorization-code, or bearer-passthrough"
      )
    }
    const authType = authTypeOption.replaceAll("-", "_") as SapProfile["authType"]
    const input: SapProfileInput = {
      id,
      url: requiredOption(parsed, "url"),
      client: requiredOption(parsed, "client"),
      ...(language ? { language } : {}),
      ...(environment ? { environment: environment as SapProfile["environment"] } : {}),
      ...(username ? { username } : {}),
      ...(classicBridgePath ? { classicBridgePath } : {}),
      allowDataQueries: parsed.options.has("allow-data-queries"),
      authType,
      ...(authType === "oauth_client_credentials" || authType === "oauth_authorization_code"
        ? {
            tokenUrl: requiredOption(parsed, "token-url"),
            clientId: requiredOption(parsed, "client-id"),
            ...(authType === "oauth_authorization_code"
              ? { authorizationUrl: requiredOption(parsed, "authorization-url") }
              : {}),
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
    if (candidate.authType === "bearer_passthrough") {
      throw new AppError(
        "AUTH_PASSTHROUGH_REQUIRED",
        "bearer-passthrough profiles do not use profile add --login"
      )
    }
    if (candidate.authType === "basic" && !candidate.username) {
      throw new AppError("USERNAME_REQUIRED", "Provide --username when using --login")
    }
    if (candidate.authType === "oauth_authorization_code" && process.platform === "linux") {
      throw new AppError(
        "SECRET_STORE_READ_ONLY",
        "Browser OAuth login requires macOS Keychain or Windows DPAPI; Linux credentials are environment-only"
      )
    }
    const password = candidate.authType === "oauth_authorization_code"
      ? await browserOAuthLogin({
          authorizationUrl: candidate.authorizationUrl,
          tokenUrl: candidate.tokenUrl,
          clientId: candidate.clientId,
          ...(candidate.scope ? { scope: candidate.scope } : {})
        })
      : parsed.options.has("password-stdin")
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
    if (storedProfile.authType === "bearer_passthrough") {
      throw new AppError(
        "AUTH_PASSTHROUGH_REQUIRED",
        "bearer-passthrough profiles receive credentials from OIDC-authenticated HTTP sessions"
      )
    }
    const username = option(parsed, "username") ?? storedProfile.username
    if (storedProfile.authType === "basic" && !username) {
      throw new AppError("USERNAME_REQUIRED", "Provide --username or store it in the profile")
    }
    if (storedProfile.authType === "oauth_authorization_code" && process.platform === "linux") {
      throw new AppError(
        "SECRET_STORE_READ_ONLY",
        "Browser OAuth login requires macOS Keychain or Windows DPAPI; Linux credentials are environment-only"
      )
    }

    const profile = username ? withUsername(storedProfile, username) : storedProfile
    const password = profile.authType === "oauth_authorization_code"
      ? await browserOAuthLogin({
          authorizationUrl: profile.authorizationUrl,
          tokenUrl: profile.tokenUrl,
          clientId: profile.clientId,
          ...(profile.scope ? { scope: profile.scope } : {})
        })
      : parsed.options.has("password-stdin")
        ? await readAllStdin()
        : await promptSecret(
            profile.authType === "basic" ? "SAP password: " : "OAuth client secret: "
          )
    if (!password) {
      throw new AppError(
        profile.authType === "basic" ? "PASSWORD_REQUIRED" : "OAUTH_CREDENTIAL_REQUIRED",
        profile.authType === "basic"
          ? "SAP password cannot be empty"
          : "OAuth credential cannot be empty"
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

function commaList(parsed: ParsedArguments, name: string): string[] {
  const value = option(parsed, name)
  if (!value) return []
  return value.split(",").map(entry => entry.trim()).filter(Boolean)
}

function numericOption(
  parsed: ParsedArguments,
  name: string,
  minimum: number
): number | undefined {
  const value = option(parsed, name)
  if (value === undefined) return undefined
  const parsedValue = Number(value)
  if (!Number.isInteger(parsedValue) || parsedValue < minimum) {
    throw new AppError(
      "INVALID_OPTION",
      `--${name} must be an integer of at least ${minimum}`
    )
  }
  return parsedValue
}

/**
 * Run transport change assurance from a pipeline without an MCP host.
 *
 * This is the CI entry point: it reaches the same read-only assessment the
 * `sap.transport.assess` tool uses, writes JSON/SARIF/JUnit artifacts, and turns
 * the gate into a process exit code so a pipeline can block on it. It never
 * releases or modifies the transport.
 */
async function assureCommand(
  parsed: ParsedArguments,
  profiles: ProfileStore,
  secrets: SecretStore
): Promise<void> {
  const connectionId = requiredPosition(parsed, 1, "SAP profile id")
  const transportNumber = requiredOption(parsed, "transport")
  const rawChecks = commaList(parsed, "checks")
  const validChecks: ChangeAssuranceCheck[] = ["atc", "unit_tests", "target_compare"]
  const invalidChecks = rawChecks.filter(
    value => !(validChecks as string[]).includes(value)
  )
  if (invalidChecks.length > 0) {
    throw new AppError(
      "INVALID_CHECK",
      `Unknown checks: ${invalidChecks.join(", ")}`,
      { available: validChecks }
    )
  }
  const rawFormats = commaList(parsed, "formats")
  const validFormats: ChangeAssuranceFormat[] = ["json", "sarif", "junit"]
  const invalidFormats = rawFormats.filter(
    value => !(validFormats as string[]).includes(value)
  )
  if (invalidFormats.length > 0) {
    throw new AppError(
      "INVALID_FORMAT",
      `Unknown report formats: ${invalidFormats.join(", ")}`,
      { available: validFormats }
    )
  }
  const failOn = option(parsed, "fail-on") ?? "incomplete"
  if (failOn !== "incomplete" && failOn !== "failed") {
    throw new AppError(
      "INVALID_FAIL_ON",
      "--fail-on must be incomplete or failed"
    )
  }
  const targetSystem = option(parsed, "target-system")
  const maxObjects = numericOption(parsed, "max-objects", 1)
  const reportDirectory = option(parsed, "report-directory")

  const manager = new ConnectionManager(profiles, secrets)
  const service = new AbapToolService(manager, secrets)
  try {
    const report = await service.manageTransportRequests({
      action: "assess_transport",
      connectionId,
      transportNumber,
      ...(rawChecks.length > 0
        ? { checks: rawChecks as ChangeAssuranceCheck[] }
        : {}),
      ...(targetSystem ? { targetConnectionId: targetSystem } : {}),
      ...(maxObjects !== undefined ? { maxObjects } : {}),
      failOnAtcWarnings: parsed.options.has("fail-on-atc-warnings"),
      reportFormats: (rawFormats.length > 0
        ? rawFormats
        : ["json", "sarif", "junit"]) as ChangeAssuranceFormat[],
      ...(reportDirectory ? { reportDirectory } : {}),
      startIndex: 0,
      maxResults: 20,
      includeObjects: false
    }) as {
      gate: { status: ChangeAssuranceGateStatus; reasons: string[] }
      reports: Array<{ format: string; outputPath: string }>
    }
    writeJson(report)
    process.exitCode = changeAssuranceExitCode(report.gate.status, failOn)
  } finally {
    service.dispose()
    await manager.close().catch(() => undefined)
  }
}

async function apikeyCommand(parsed: ParsedArguments): Promise<void> {
  const action = parsed.positionals[1]
  if (action === "pepper") return apikeyPepperCommand()
  if (action !== "new") {
    throw new AppError(
      "UNKNOWN_ACTION",
      "Usage: apikey new <id> [--role viewer|developer|admin] [--pepper-file <path>] | apikey pepper"
    )
  }
  const id = requiredPosition(parsed, 2, "API key id")
  const role = parseHttpRole(option(parsed, "role") ?? "viewer")
  const pepperFile = option(parsed, "pepper-file")
  const key = generateApiKey()
  // With a server-side secret the stored digest is an HMAC, so a disclosed key
  // file cannot be attacked offline at all. Without one it is a plain SHA-256 of
  // a 256-bit key, which is still infeasible to search but offers no defence if
  // the key was not actually random.
  const record = pepperFile
    ? { id, role, keyHmacSha256: hmacApiKey(key, loadApiKeyPepper(pepperFile)) }
    : { id, role, keySha256: hashApiKey(key) }
  writeJson({
    key,
    record,
    note: "Store `key` in the client's Authorization: Bearer header. Add `record` to the keys array of the --api-keys-file. The key itself is not recoverable from the file."
  })
}

async function apikeyPepperCommand(): Promise<void> {
  writeJson({
    pepper: generateApiKeyPepper(),
    note: "Write this to a file outside the API key file's directory, pass it to `apikey new --pepper-file` and to `serve --http --api-key-pepper-file`. Storing it beside the key file defeats its purpose, because one disclosure would yield both."
  })
}

/**
 * Build an OIDC authenticator when an issuer is configured. The JWKS URI
 * defaults to the standard discovery location so a typical deployment only needs
 * the issuer and the audience.
 */
function resolveOidcAuthenticator(
  parsed: ParsedArguments
): OidcAuthenticator | undefined {
  const issuer = option(parsed, "oidc-issuer") ?? process.env.SAP_ABAP_MCP_OIDC_ISSUER
  if (!issuer) return undefined
  const audience = option(parsed, "oidc-audience") ??
    process.env.SAP_ABAP_MCP_OIDC_AUDIENCE
  if (!audience) {
    throw new AppError(
      "OPTION_REQUIRED",
      "--oidc-issuer requires --oidc-audience"
    )
  }
  const jwksUri = option(parsed, "oidc-jwks-uri") ??
    process.env.SAP_ABAP_MCP_OIDC_JWKS_URI ??
    `${trimTrailingSlashes(issuer)}/.well-known/jwks.json`
  const roleClaim = option(parsed, "oidc-role-claim")
  const defaultRole = option(parsed, "oidc-default-role")
  return createOidcAuthenticator({
    issuer,
    audience,
    jwksUri,
    roleMap: parseOidcRoleMap(
      option(parsed, "oidc-role-map") ?? process.env.SAP_ABAP_MCP_OIDC_ROLE_MAP
    ),
    ...(roleClaim ? { roleClaim } : {}),
    ...(defaultRole ? { defaultRole: parseHttpRole(defaultRole) } : {})
  })
}

/**
 * Resolve audit-log settings from CLI flags, falling back to environment
 * variables so that a centrally managed launcher can enable auditing without
 * changing the registered MCP command. Returns undefined when auditing is off.
 *
 * HTTP mode defaults to the `stderr` sink: a shared, centrally operated server
 * should not run unaudited, and container runtimes already collect stderr.
 */
function resolveAuditRecorder(
  parsed: ParsedArguments,
  apiVersion: string,
  defaultSink: "none" | "stderr" = "none"
): AuditRecorder | undefined {
  const rawSink = parsed.options.get("audit-log")
  if (rawSink === true) {
    throw new AppError("OPTION_REQUIRED", "--audit-log requires a value")
  }
  const sink = parseAuditSinkName(
    rawSink ?? process.env.SAP_ABAP_MCP_AUDIT_LOG ?? defaultSink
  )
  if (sink === "none") return undefined
  const file = option(parsed, "audit-log-file") ??
    process.env.SAP_ABAP_MCP_AUDIT_LOG_FILE
  const includeArguments = parsed.options.has("audit-include-arguments") ||
    process.env.SAP_ABAP_MCP_AUDIT_INCLUDE_ARGUMENTS === "1"
  return new AuditRecorder({
    sink: createAuditSink({ sink, includeArguments, ...(file ? { file } : {}) }),
    apiVersion,
    includeArguments
  })
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
  const rawPreset = parsed.options.get("preset")
  if (rawPreset === true) {
    throw new AppError("OPTION_REQUIRED", "--preset requires a value")
  }
  const preset = rawPreset as V1PresetName | undefined
  if (preset && !V1_PRESET_NAMES.includes(preset)) {
    throw new AppError(
      "INVALID_PRESET",
      `Unknown preset: ${preset}`,
      { available: V1_PRESET_NAMES }
    )
  }
  if (preset && toolsetsValue) {
    throw new AppError(
      "TOOL_SELECTION_CONFLICT",
      "Use either --preset or --toolsets, not both"
    )
  }
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

  const selection = resolveServeToolSelection(apiVersion, selectedToolsets, preset)
  if (apiVersion === "v1" && selection.enabledV1Tools &&
    !V1_IMPLEMENTED_TOOL_NAMES.some(name => selection.enabledV1Tools!.has(name))) {
    throw new AppError(
      "V1_TOOLSET_EMPTY",
      "The selected toolsets contain no implemented v1 tools",
      { available: ["core", "all"] }
    )
  }

  const http = parsed.options.has("http")
  const auditRecorder = resolveAuditRecorder(
    parsed,
    apiVersion,
    http ? "stderr" : "none"
  )
  const manager = new ConnectionManager(profiles, secrets, undefined, profileId)

  if (http) {
    const apiKeysFile = option(parsed, "api-keys-file")
    const apiKeys = apiKeysFile ? loadApiKeyRecords(apiKeysFile) : []
    const oidc = resolveOidcAuthenticator(parsed)
    const pepperFile = option(parsed, "api-key-pepper-file") ??
      process.env.SAP_ABAP_MCP_API_KEY_PEPPER_FILE
    const apiKeyPepper = pepperFile ? loadApiKeyPepper(pepperFile) : undefined
    if (!apiKeyPepper && apiKeys.some(record => record.keyHmacSha256 !== undefined)) {
      throw new AppError(
        "API_KEY_PEPPER_REQUIRED",
        "The API key file contains keyHmacSha256 records, which need --api-key-pepper-file"
      )
    }
    if (apiKeys.length === 0 && !oidc) {
      throw new AppError(
        "CLIENT_AUTH_REQUIRED",
        "--http requires --api-keys-file, --oidc-issuer, or both"
      )
    }
    const rateLimitPerPrincipal = numericOption(parsed, "rate-limit", 1)
    const maxConcurrentRequests = numericOption(parsed, "max-concurrent", 1)
    const maxSessions = numericOption(parsed, "max-sessions", 1)
    const sessionTimeoutSeconds = numericOption(parsed, "session-timeout", 30)
    const running = await startHttpMcpServer({
      apiKeys,
      ...(option(parsed, "host") ? { host: option(parsed, "host")! } : {}),
      ...(numericOption(parsed, "port", 1) !== undefined
        ? { port: numericOption(parsed, "port", 1)! }
        : {}),
      allowedOrigins: commaList(parsed, "allowed-origin"),
      allowedHosts: commaList(parsed, "allowed-host"),
      ...(rateLimitPerPrincipal !== undefined ? { rateLimitPerPrincipal } : {}),
      ...(maxConcurrentRequests !== undefined ? { maxConcurrentRequests } : {}),
      ...(maxSessions !== undefined ? { maxSessions } : {}),
      ...(sessionTimeoutSeconds !== undefined
        ? { sessionIdleTimeoutMs: sessionTimeoutSeconds * 1000 }
        : {}),
      ...(auditRecorder ? { auditRecorder } : {}),
      ...(oidc ? { oidc } : {}),
      ...(apiKeyPepper ? { apiKeyPepper } : {}),
      // One service and one MCP server per session, so preview plans, staged Git
      // snapshots, and execution plans are never shared between principals. The
      // ConnectionManager stays shared so SAP logins are pooled, while the
      // scoping provider limits each principal to its own SAP profiles.
      createMcpServerForSession: ({
        principal,
        auditRecorder: sessionRecorder,
        sapBearerToken
      }) => {
        const requestConnections = sapBearerToken
          ? new RequestScopedConnectionProvider(manager, sapBearerToken, principal.systemIds)
          : undefined
        const service = new AbapToolService(
          requestConnections ?? new ScopedConnectionProvider(manager, principal.systemIds),
          secrets
        )
        return {
          server: createMcpServer(service, {
            apiVersion,
            ...selection,
            role: principal.role,
            ...(sessionRecorder ? { auditRecorder: sessionRecorder } : {})
          }),
          dispose: async () => {
            service.dispose()
            await requestConnections?.close()
          }
        }
      }
    })
    let closingHttp = false
    const closeHttp = async () => {
      if (closingHttp) return
      closingHttp = true
      await running.close().catch(() => undefined)
      await manager.close()
      if (auditRecorder) await auditRecorder.close().catch(() => undefined)
    }
    process.once("SIGINT", () => void closeHttp().finally(() => process.exit(0)))
    process.once("SIGTERM", () => void closeHttp().finally(() => process.exit(0)))
    return
  }

  const server = createMcpServer(
    new AbapToolService(manager, secrets),
    {
      apiVersion,
      ...selection,
      ...(auditRecorder ? { auditRecorder } : {})
    }
  )
  let closing = false
  const close = async () => {
    if (closing) return
    closing = true
    await server.close().catch(() => undefined)
    await manager.close()
    if (auditRecorder) await auditRecorder.close().catch(() => undefined)
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
  if (command === "apikey") return apikeyCommand(parsed)
  if (command === "assure") return assureCommand(parsed, profiles, secrets)
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

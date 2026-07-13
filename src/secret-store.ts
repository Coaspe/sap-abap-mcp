import { execFile, spawn } from "node:child_process"
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import { AppError } from "./errors.js"

const execFileAsync = promisify(execFile)
const KEYCHAIN_SERVICE = "sap-abap-mcp"
const WINDOWS_DPAPI_TIMEOUT_MS = 15_000

const WINDOWS_DPAPI_SCRIPTS = {
  protect: [
    "$ErrorActionPreference = 'Stop'",
    "$utf8 = [Text.UTF8Encoding]::new($false)",
    "[Console]::InputEncoding = $utf8",
    "[Console]::OutputEncoding = $utf8",
    "$plain = [Console]::In.ReadToEnd()",
    "$secure = ConvertTo-SecureString -String $plain -AsPlainText -Force",
    "$encrypted = ConvertFrom-SecureString -SecureString $secure",
    "[Console]::Out.Write($encrypted)"
  ].join("; "),
  unprotect: [
    "$ErrorActionPreference = 'Stop'",
    "$utf8 = [Text.UTF8Encoding]::new($false)",
    "[Console]::InputEncoding = $utf8",
    "[Console]::OutputEncoding = $utf8",
    "$encrypted = [Console]::In.ReadToEnd()",
    "$secure = ConvertTo-SecureString -String $encrypted",
    "$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)",
    "try { [Console]::Out.Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }"
  ].join("; ")
} as const

async function runSecurityWithInput(args: string[], input: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("/usr/bin/security", args, { stdio: ["pipe", "ignore", "pipe"] })
    let errorText = ""
    child.stderr.setEncoding("utf8")
    child.stderr.on("data", chunk => {
      errorText += String(chunk)
    })
    child.once("error", reject)
    child.once("close", code => {
      if (code === 0) resolve()
      else reject(new Error(errorText.trim() || `security exited with code ${code}`))
    })
    child.stdin.end(`${input}\n`)
  })
}

export interface SecretStore {
  get(profileId: string): Promise<string | undefined>
  set(profileId: string, secret: string): Promise<void>
  delete(profileId: string): Promise<void>
}

function environmentVariableName(profileId: string): string {
  const suffix = profileId.toUpperCase().replace(/[^A-Z0-9]/g, "_")
  return `SAP_ABAP_MCP_PASSWORD_${suffix}`
}

function environmentSecret(profileId: string): string | undefined {
  return process.env[environmentVariableName(profileId)] || undefined
}

function normalizeProfileId(profileId: string): string {
  const normalized = profileId.trim().toUpperCase()
  if (!/^[A-Z0-9_-]+$/.test(normalized)) {
    throw new AppError("SECRET_PROFILE_ID_INVALID", `Invalid SAP profile ID: ${profileId}`)
  }
  return normalized
}

function defaultWindowsSecretsDirectory(): string {
  const configDirectory =
    process.env.SAP_ABAP_MCP_HOME ??
    join(process.env.APPDATA ?? homedir(), "sap-abap-mcp")
  return join(configDirectory, "secrets")
}

export type WindowsDpapiOperation = keyof typeof WINDOWS_DPAPI_SCRIPTS
export type WindowsDpapiRunner = (
  operation: WindowsDpapiOperation,
  input: string
) => Promise<string>

const runWindowsDpapi: WindowsDpapiRunner = async (operation, input) =>
  new Promise<string>((resolve, reject) => {
    const child = spawn(
      "powershell.exe",
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", WINDOWS_DPAPI_SCRIPTS[operation]],
      {
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
        timeout: WINDOWS_DPAPI_TIMEOUT_MS
      }
    )
    let stdoutText = ""
    let stderrText = ""
    let settled = false
    child.stdout.setEncoding("utf8")
    child.stderr.setEncoding("utf8")
    child.stdout.on("data", chunk => {
      stdoutText += String(chunk)
    })
    child.stderr.on("data", chunk => {
      stderrText += String(chunk)
    })
    child.once("error", error => {
      if (settled) return
      settled = true
      reject(error)
    })
    child.stdin.once("error", error => {
      if (settled) return
      settled = true
      reject(error)
    })
    child.once("close", (code, signal) => {
      if (settled) return
      settled = true
      if (code === 0) resolve(stdoutText)
      else {
        const reason = stderrText.trim() || `PowerShell exited with ${code ?? signal ?? "unknown"}`
        reject(new Error(reason))
      }
    })
    child.stdin.end(input)
  })

export class MacOsKeychainSecretStore implements SecretStore {
  async get(profileId: string): Promise<string | undefined> {
    const configuredSecret = environmentSecret(profileId)
    if (configuredSecret) return configuredSecret

    try {
      const result = await execFileAsync("/usr/bin/security", [
        "find-generic-password",
        "-a",
        profileId.toUpperCase(),
        "-s",
        KEYCHAIN_SERVICE,
        "-w"
      ])
      return result.stdout.trim()
    } catch (error) {
      const stderr = (error as { stderr?: string }).stderr ?? ""
      if (stderr.includes("could not be found")) return undefined
      throw new AppError("KEYCHAIN_READ_FAILED", "Could not read SAP credentials from Keychain")
    }
  }

  async set(profileId: string, secret: string): Promise<void> {
    try {
      await runSecurityWithInput(
        [
          "add-generic-password",
          "-a",
          profileId.toUpperCase(),
          "-s",
          KEYCHAIN_SERVICE,
          "-U",
          "-w"
        ],
        secret
      )
    } catch {
      throw new AppError("KEYCHAIN_WRITE_FAILED", "Could not store SAP credentials in Keychain")
    }
  }

  async delete(profileId: string): Promise<void> {
    try {
      await execFileAsync("/usr/bin/security", [
        "delete-generic-password",
        "-a",
        profileId.toUpperCase(),
        "-s",
        KEYCHAIN_SERVICE
      ])
    } catch (error) {
      const stderr = (error as { stderr?: string }).stderr ?? ""
      if (!stderr.includes("could not be found")) throw error
    }
  }
}

export class WindowsDpapiSecretStore implements SecretStore {
  constructor(
    private readonly secretsDirectory = defaultWindowsSecretsDirectory(),
    private readonly runner: WindowsDpapiRunner = runWindowsDpapi
  ) {}

  async get(profileId: string): Promise<string | undefined> {
    const configuredSecret = environmentSecret(profileId)
    if (configuredSecret) return configuredSecret

    const path = this.secretPath(profileId)
    let encrypted: string
    try {
      encrypted = (await readFile(path, "utf8")).trim()
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
      throw new AppError("WINDOWS_SECRET_READ_FAILED", "Could not read encrypted SAP credentials")
    }
    if (!encrypted) {
      throw new AppError("WINDOWS_SECRET_READ_FAILED", "Encrypted SAP credentials are empty")
    }

    try {
      return await this.runner("unprotect", encrypted)
    } catch {
      throw new AppError(
        "WINDOWS_SECRET_READ_FAILED",
        "Could not decrypt SAP credentials for the current Windows user"
      )
    }
  }

  async set(profileId: string, secret: string): Promise<void> {
    const path = this.secretPath(profileId)
    const temporaryPath = `${path}.tmp-${process.pid}`
    try {
      const encrypted = (await this.runner("protect", secret)).trim()
      if (!encrypted) throw new Error("DPAPI returned an empty value")
      await mkdir(this.secretsDirectory, { recursive: true, mode: 0o700 })
      await writeFile(temporaryPath, `${encrypted}\n`, { mode: 0o600 })
      await rename(temporaryPath, path)
    } catch {
      await unlink(temporaryPath).catch(() => undefined)
      throw new AppError(
        "WINDOWS_SECRET_WRITE_FAILED",
        "Could not encrypt SAP credentials for the current Windows user"
      )
    }
  }

  async delete(profileId: string): Promise<void> {
    try {
      await unlink(this.secretPath(profileId))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return
      throw new AppError("WINDOWS_SECRET_DELETE_FAILED", "Could not delete encrypted SAP credentials")
    }
  }

  private secretPath(profileId: string): string {
    return join(this.secretsDirectory, `${normalizeProfileId(profileId)}.dpapi`)
  }
}

export class MemorySecretStore implements SecretStore {
  private readonly values = new Map<string, string>()

  async get(profileId: string): Promise<string | undefined> {
    return this.values.get(profileId.toUpperCase())
  }

  async set(profileId: string, secret: string): Promise<void> {
    this.values.set(profileId.toUpperCase(), secret)
  }

  async delete(profileId: string): Promise<void> {
    this.values.delete(profileId.toUpperCase())
  }
}

export function createDefaultSecretStore(platform: NodeJS.Platform = process.platform): SecretStore {
  if (platform === "darwin") return new MacOsKeychainSecretStore()
  if (platform === "win32") return new WindowsDpapiSecretStore()
  throw new AppError(
    "SECRET_STORE_UNSUPPORTED",
    "This build supports macOS Keychain and Windows DPAPI. Linux keyring support is not implemented yet."
  )
}

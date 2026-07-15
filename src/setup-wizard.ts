import { createInterface } from "node:readline/promises"
import { stdin, stdout } from "node:process"
import { abapGitCredentialKey } from "./abapgit-credentials.js"
import { AppError } from "./errors.js"
import {
  normalizeProfile,
  type ProfileStore,
  type SapProfile,
  type SapProfileInput
} from "./profile-store.js"
import type { SecretStore } from "./secret-store.js"

export interface SetupChoice {
  value: string
  label: string
}

export interface SetupPrompter {
  input(label: string, defaultValue?: string): Promise<string>
  select(
    label: string,
    choices: readonly SetupChoice[],
    defaultValue: string
  ): Promise<string>
  confirm(label: string, defaultValue: boolean): Promise<boolean>
  secret(label: string): Promise<string>
  write(message: string): void
  close(): void
}

export type SetupWizardResult =
  | { status: "ready"; serverName: string; sapUrl: string }
  | { status: "authentication-required"; serverName: string; environmentVariable: string }
  | { status: "cancelled" }

export interface SetupWizardOptions {
  profiles: ProfileStore
  secrets: SecretStore
  prompter: SetupPrompter
  platform: NodeJS.Platform
  mode?: "configure" | "edit"
  serverName?: string
  validateCredentials(profile: SapProfile, password: string): Promise<void>
}

export type SetupRemovalResult =
  | { status: "removed"; serverName: string }
  | { status: "cancelled" }

export interface SetupRemovalOptions {
  profiles: ProfileStore
  secrets: SecretStore
  prompter: SetupPrompter
  serverName?: string
}

function environmentVariableName(serverName: string): string {
  return `SAP_ABAP_MCP_PASSWORD_${serverName.replace(/[^A-Z0-9]/g, "_")}`
}

function validationMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function requiredInput(
  prompter: SetupPrompter,
  label: string,
  defaultValue: string | undefined,
  validate: (value: string) => string | undefined
): Promise<string> {
  while (true) {
    const value = defaultValue === undefined
      ? await prompter.input(label)
      : await prompter.input(label, defaultValue)
    const error = validate(value)
    if (!error) return value.trim()
    prompter.write(`! ${error}`)
  }
}

function validateServerName(value: string): string | undefined {
  if (!value.trim()) return "Server name is required."
  if (!/^[A-Z0-9_-]+$/i.test(value.trim())) {
    return "Use only letters, numbers, underscores, or hyphens."
  }
  return undefined
}

function validateSapUrl(value: string): string | undefined {
  if (!value.trim()) return "SAP URL is required."
  try {
    new URL(value.trim())
    return undefined
  } catch (error) {
    return `Enter a complete SAP URL such as https://sap.example.com (${validationMessage(error)}).`
  }
}

function validateClient(value: string): string | undefined {
  return /^\d{1,3}$/.test(value.trim())
    ? undefined
    : "SAP client must contain one to three digits."
}

function validateUsername(value: string): string | undefined {
  return value.trim() ? undefined : "Username is required."
}

function validateLanguage(value: string): string | undefined {
  return /^[A-Z]{2}$/i.test(value.trim())
    ? undefined
    : "Language must contain two letters."
}

function environmentLabel(environment: SapProfile["environment"]): string {
  return environment[0]?.toUpperCase() + environment.slice(1)
}

function packageList(value: string): string[] {
  if (value.trim() === "-") return []
  return value.split(",").map(item => item.trim()).filter(Boolean)
}

async function requiredSecret(prompter: SetupPrompter): Promise<string> {
  while (true) {
    const password = await prompter.secret("SAP password")
    if (password) return password
    prompter.write("! SAP password cannot be empty.")
  }
}

export async function runSetupWizard(options: SetupWizardOptions): Promise<SetupWizardResult> {
  const {
    profiles,
    secrets,
    prompter,
    platform,
    mode = "configure",
    serverName: targetServerName,
    validateCredentials
  } = options

  try {
    prompter.write("SAP ABAP MCP setup\n")
    const savedProfiles = await profiles.list()
    let existing: SapProfile | undefined
    if (mode === "edit") {
      if (targetServerName) {
        existing = await profiles.get(targetServerName)
      } else {
        if (savedProfiles.length === 0) {
          throw new AppError("PROFILE_NOT_FOUND", "No saved servers were found.")
        }
        const selected = await prompter.select(
          "Choose a server to edit",
          savedProfiles.map(profile => ({
            value: profile.id,
            label: `${profile.id} — ${profile.url}`
          })),
          savedProfiles[0]?.id ?? ""
        )
        existing = savedProfiles.find(profile => profile.id === selected)
        if (!existing) {
          throw new AppError("PROFILE_NOT_FOUND", `SAP profile ${selected} was not found`)
        }
      }
    } else if (savedProfiles.length > 0) {
      const choices: SetupChoice[] = [
        ...savedProfiles.map(profile => ({
          value: profile.id,
          label: `${profile.id} — ${profile.url}`
        })),
        { value: "__NEW__", label: "Create a new server" }
      ]
      const selected = await prompter.select(
        "Choose a server to configure",
        choices,
        choices[0]?.value ?? "__NEW__"
      )
      existing = savedProfiles.find(profile => profile.id === selected)
    } else {
      prompter.write("No saved servers found. Let's add one.")
    }

    const serverName = mode === "edit" && existing
      ? existing.id
      : await requiredInput(
        prompter,
        "Server name",
        existing?.id,
        validateServerName
      )
    const sapUrl = await requiredInput(
      prompter,
      "SAP URL",
      existing?.url,
      validateSapUrl
    )
    const client = await requiredInput(
      prompter,
      "SAP client",
      existing?.client,
      validateClient
    )
    const username = await requiredInput(
      prompter,
      "Username",
      existing?.username,
      validateUsername
    )
    const language = await requiredInput(
      prompter,
      "Language",
      existing?.language ?? "EN",
      validateLanguage
    )
    const environment = await prompter.select(
      "Environment",
      [
        { value: "development", label: "Development — writes allowed" },
        { value: "quality", label: "Quality — writes allowed" },
        { value: "production", label: "Production — read only" }
      ],
      existing?.environment ?? "development"
    ) as SapProfile["environment"]
    const packagesDefault = existing?.allowedPackages.join(",")
    const packagesText = packagesDefault
      ? await prompter.input("Writable packages (comma-separated; use - to allow all)", packagesDefault)
      : await prompter.input("Writable packages (comma-separated; blank allows all)")

    const input: SapProfileInput = {
      id: serverName,
      url: sapUrl,
      client,
      username,
      language,
      environment,
      allowedPackages: packageList(packagesText)
    }
    const profile = normalizeProfile(input)
    const linuxPassword = platform === "linux" ? await secrets.get(profile.id) : undefined
    const willVerify = platform !== "linux" || Boolean(linuxPassword)

    prompter.write([
      "\nReview",
      `  Server name: ${profile.id}`,
      `  SAP URL: ${profile.url}`,
      `  SAP client: ${profile.client}`,
      `  Username: ${profile.username}`,
      `  Language: ${profile.language}`,
      `  Environment: ${environmentLabel(profile.environment)}`,
      `  Writable packages: ${profile.allowedPackages.length > 0 ? profile.allowedPackages.join(", ") : "All packages"}`
    ].join("\n"))

    const confirmed = await prompter.confirm(
      willVerify ? "Save and test this server?" : "Save this server?",
      true
    )
    if (!confirmed) {
      prompter.write("Setup cancelled. No changes were saved.")
      return { status: "cancelled" }
    }

    if (platform === "linux" && !linuxPassword) {
      await profiles.upsert(input)
      const variable = environmentVariableName(profile.id)
      prompter.write([
        `\n✓ Server ${profile.id} saved.`,
        "Linux does not persist SAP passwords. Set the password in the same shell that starts your MCP client:",
        `read -rsp \"SAP password: \" ${variable}; echo`,
        `export ${variable}`,
        `npx @coaspe/sap-abap-mcp@latest doctor ${profile.id}`
      ].join("\n"))
      return {
        status: "authentication-required",
        serverName: profile.id,
        environmentVariable: variable
      }
    }

    const password = linuxPassword ?? await requiredSecret(prompter)
    prompter.write("\nTesting SAP connection...")
    await validateCredentials(profile, password)
    await profiles.upsert(input)
    if (platform !== "linux") await secrets.set(profile.id, password)
    prompter.write([
      "✓ SAP connection verified.",
      `✓ Server ${profile.id} is ready.`,
      `Use ${profile.id} as connectionId in SAP tools.`
    ].join("\n"))
    return { status: "ready", serverName: profile.id, sapUrl: profile.url }
  } finally {
    prompter.close()
  }
}

export async function runSetupRemoval(
  options: SetupRemovalOptions
): Promise<SetupRemovalResult> {
  const { profiles, secrets, prompter, serverName: targetServerName } = options

  try {
    prompter.write("SAP ABAP MCP setup\n")
    const savedProfiles = await profiles.list()
    if (savedProfiles.length === 0) {
      throw new AppError("PROFILE_NOT_FOUND", "No saved servers were found.")
    }

    let profile: SapProfile
    if (targetServerName) {
      profile = await profiles.get(targetServerName)
    } else {
      const selected = await prompter.select(
        "Choose a server to remove",
        savedProfiles.map(item => ({
          value: item.id,
          label: `${item.id} — ${item.url}`
        })),
        savedProfiles[0]?.id ?? ""
      )
      const selectedProfile = savedProfiles.find(item => item.id === selected)
      if (!selectedProfile) {
        throw new AppError("PROFILE_NOT_FOUND", `SAP profile ${selected} was not found`)
      }
      profile = selectedProfile
    }

    prompter.write([
      "\nRemove server",
      `  Server name: ${profile.id}`,
      `  SAP URL: ${profile.url}`,
      `  SAP client: ${profile.client}`,
      `  Username: ${profile.username ?? "Not set"}`
    ].join("\n"))

    const confirmed = await prompter.confirm(
      `Remove ${profile.id} and its stored credentials?`,
      false
    )
    if (!confirmed) {
      prompter.write("Removal cancelled. No changes were made.")
      return { status: "cancelled" }
    }

    await profiles.remove(profile.id)
    await secrets.delete(profile.id)
    await secrets.delete(abapGitCredentialKey(profile.id))
    prompter.write(`✓ Server ${profile.id} and its stored credentials were removed.`)
    return { status: "removed", serverName: profile.id }
  } finally {
    prompter.close()
  }
}

export function createTerminalSetupPrompter(
  promptSecret: (prompt: string) => Promise<string>
): SetupPrompter {
  if (!stdin.isTTY) {
    throw new AppError(
      "SETUP_TTY_REQUIRED",
      "Interactive setup needs a terminal. Use the profile and auth commands for automation."
    )
  }

  const readline = createInterface({ input: stdin, output: stdout })
  let closed = false
  const close = () => {
    if (closed) return
    closed = true
    readline.close()
  }
  const question = async (prompt: string) => {
    try {
      return await readline.question(prompt)
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new AppError("CANCELLED", "Setup was cancelled")
      }
      throw error
    }
  }

  return {
    async input(label, defaultValue) {
      const suffix = defaultValue === undefined ? "" : ` [${defaultValue}]`
      const answer = (await question(`${label}${suffix}: `)).trim()
      return answer || defaultValue || ""
    },
    async select(label, choices, defaultValue) {
      const defaultIndex = Math.max(0, choices.findIndex(choice => choice.value === defaultValue))
      while (true) {
        stdout.write(`${label}:\n`)
        choices.forEach((choice, index) => stdout.write(`  ${index + 1}) ${choice.label}\n`))
        const answer = (await question(`Select [${defaultIndex + 1}]: `)).trim()
        const index = answer ? Number(answer) - 1 : defaultIndex
        const choice = Number.isInteger(index) ? choices[index] : undefined
        if (choice) return choice.value
        stdout.write("! Choose one of the listed numbers.\n")
      }
    },
    async confirm(label, defaultValue) {
      const hint = defaultValue ? "Y/n" : "y/N"
      while (true) {
        const answer = (await question(`${label} [${hint}]: `)).trim().toLowerCase()
        if (!answer) return defaultValue
        if (answer === "y" || answer === "yes") return true
        if (answer === "n" || answer === "no") return false
        stdout.write("! Enter y or n.\n")
      }
    },
    async secret(label) {
      close()
      return promptSecret(`${label}: `)
    },
    write(message) {
      stdout.write(`${message}\n`)
    },
    close
  }
}

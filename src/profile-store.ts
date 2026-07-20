import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { z } from "zod"
import { AppError } from "./errors.js"

const baseProfileSchema = z.object({
  id: z.string().regex(/^[A-Z0-9_-]+$/),
  url: z.url(),
  client: z.string().regex(/^\d{3}$/),
  language: z.string().regex(/^[A-Z]{2}$/),
  environment: z.enum(["development", "quality", "production"]),
  allowedPackages: z.array(z.string().min(1)).default([])
})

const oauthTokenUrlSchema = z.url().refine(value => {
  const url = new URL(value)
  return url.protocol === "https:" &&
    !url.username && !url.password && !url.search && !url.hash
}, "OAuth token URL must use HTTPS and must not contain credentials, query parameters, or a fragment")

const profileSchema = z.discriminatedUnion("authType", [
  baseProfileSchema.extend({
    authType: z.literal("basic"),
    username: z.string().min(1).optional()
  }),
  baseProfileSchema.extend({
    authType: z.literal("oauth_client_credentials"),
    tokenUrl: oauthTokenUrlSchema,
    clientId: z.string().min(1),
    scope: z.string().min(1).optional(),
    username: z.string().min(1).optional()
  })
])

const profileFileSchema = z.object({
  version: z.literal(1),
  profiles: z.array(profileSchema)
})

export type SapProfile = z.infer<typeof profileSchema>

export interface SapProfileInput {
  id: string
  url: string
  client: string
  language?: string
  environment?: SapProfile["environment"]
  authType?: SapProfile["authType"]
  username?: string | undefined
  allowedPackages?: string[]
  tokenUrl?: string
  clientId?: string
  scope?: string | undefined
}

function defaultConfigDirectory(): string {
  if (process.env.SAP_ABAP_MCP_HOME) return process.env.SAP_ABAP_MCP_HOME
  if (process.platform === "win32") {
    return join(process.env.APPDATA ?? homedir(), "sap-abap-mcp")
  }
  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "sap-abap-mcp")
}

export function normalizeProfile(input: SapProfileInput): SapProfile {
  const authType = input.authType ?? "basic"
  return profileSchema.parse({
    id: input.id.trim().toUpperCase(),
    url: input.url.trim().replace(/\/+$/, ""),
    client: input.client.trim().padStart(3, "0"),
    language: (input.language ?? "EN").trim().toUpperCase(),
    environment: input.environment ?? "development",
    authType,
    ...(input.username ? { username: input.username.trim() } : {}),
    ...(authType === "oauth_client_credentials"
      ? {
          tokenUrl: input.tokenUrl?.trim(),
          clientId: input.clientId?.trim(),
          ...(input.scope?.trim() ? { scope: input.scope.trim() } : {})
        }
      : {}),
    allowedPackages: (input.allowedPackages ?? []).map(value => value.trim().toUpperCase())
  })
}

export class ProfileStore {
  readonly filePath: string

  constructor(configDirectory = defaultConfigDirectory()) {
    this.filePath = join(configDirectory, "profiles.json")
  }

  async list(): Promise<SapProfile[]> {
    const data = await this.readAll()
    return [...data.profiles].sort((a, b) => a.id.localeCompare(b.id))
  }

  async get(id: string): Promise<SapProfile> {
    const normalizedId = id.trim().toUpperCase()
    const profile = (await this.list()).find(item => item.id === normalizedId)
    if (!profile) {
      throw new AppError("PROFILE_NOT_FOUND", `SAP profile ${normalizedId} was not found`)
    }
    return profile
  }

  async upsert(input: SapProfileInput): Promise<SapProfile> {
    const profile = normalizeProfile(input)
    const data = await this.readAll()
    const nextProfiles = data.profiles.filter(item => item.id !== profile.id)
    nextProfiles.push(profile)
    await this.writeAll({ version: 1, profiles: nextProfiles })
    return profile
  }

  async remove(id: string): Promise<boolean> {
    const normalizedId = id.trim().toUpperCase()
    const data = await this.readAll()
    const profiles = data.profiles.filter(item => item.id !== normalizedId)
    if (profiles.length === data.profiles.length) return false
    await this.writeAll({ version: 1, profiles })
    return true
  }

  private async readAll(): Promise<z.infer<typeof profileFileSchema>> {
    try {
      const text = await readFile(this.filePath, "utf8")
      return profileFileSchema.parse(JSON.parse(text))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { version: 1, profiles: [] }
      }
      if (error instanceof z.ZodError || error instanceof SyntaxError) {
        throw new AppError("PROFILE_FILE_INVALID", `Invalid profile file: ${this.filePath}`)
      }
      throw error
    }
  }

  private async writeAll(data: z.infer<typeof profileFileSchema>): Promise<void> {
    const parsed = profileFileSchema.parse(data)
    const directory = dirname(this.filePath)
    const temporaryPath = `${this.filePath}.tmp-${process.pid}`
    await mkdir(directory, { recursive: true, mode: 0o700 })
    await writeFile(temporaryPath, `${JSON.stringify(parsed, null, 2)}\n`, { mode: 0o600 })
    await rename(temporaryPath, this.filePath)
  }
}

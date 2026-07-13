import { AppError } from "./errors.js"
import { ProfileStore, type SapProfile } from "./profile-store.js"
import type { SecretStore } from "./secret-store.js"
import {
  defaultSapClientFactory,
  type SapClient,
  type SapClientFactory
} from "./sap-client.js"

export interface ConnectionSummary {
  id: string
  url: string
  client: string
  language: string
  environment: SapProfile["environment"]
  username?: string
  credentialAvailable: boolean
}

export class ConnectionManager {
  private readonly clients = new Map<string, Promise<SapClient>>()

  constructor(
    private readonly profiles: ProfileStore,
    private readonly secrets: SecretStore,
    private readonly factory: SapClientFactory = defaultSapClientFactory,
    private readonly allowedProfileId?: string
  ) {}

  async listConnections(): Promise<ConnectionSummary[]> {
    const profiles = await this.profiles.list()
    const allowed = this.allowedProfileId?.toUpperCase()
    const visible = allowed ? profiles.filter(profile => profile.id === allowed) : profiles
    return Promise.all(
      visible.map(async profile => ({
        id: profile.id,
        url: profile.url,
        client: profile.client,
        language: profile.language,
        environment: profile.environment,
        ...(profile.username ? { username: profile.username } : {}),
        credentialAvailable: Boolean(await this.secrets.get(profile.id))
      }))
    )
  }

  async getClient(connectionId: string): Promise<SapClient> {
    const profile = await this.getAllowedProfile(connectionId)
    let pending = this.clients.get(profile.id)
    if (!pending) {
      pending = this.connect(profile)
      this.clients.set(profile.id, pending)
      pending.catch(() => this.clients.delete(profile.id))
    }
    return pending
  }

  async validateCredentials(profile: SapProfile, password: string): Promise<void> {
    const client = this.factory(profile, password)
    await client.login()
    try {
      await client.getSystemInfo(false)
    } finally {
      await client.logout().catch(() => undefined)
    }
  }

  async close(): Promise<void> {
    const clients = await Promise.allSettled(this.clients.values())
    await Promise.all(
      clients
        .filter((result): result is PromiseFulfilledResult<SapClient> => result.status === "fulfilled")
        .map(result => result.value.logout().catch(() => undefined))
    )
    this.clients.clear()
  }

  private async getAllowedProfile(connectionId: string): Promise<SapProfile> {
    const normalizedId = connectionId.trim().toUpperCase()
    if (this.allowedProfileId && normalizedId !== this.allowedProfileId.toUpperCase()) {
      throw new AppError(
        "PROFILE_NOT_ALLOWED",
        `This MCP server is restricted to SAP profile ${this.allowedProfileId.toUpperCase()}`
      )
    }
    return this.profiles.get(normalizedId)
  }

  private async connect(profile: SapProfile): Promise<SapClient> {
    const password = await this.secrets.get(profile.id)
    if (!password) {
      throw new AppError(
        "AUTH_REQUIRED",
        `No credential is stored for ${profile.id}. Run: sap-abap-mcp auth login ${profile.id}`
      )
    }
    const client = this.factory(profile, password)
    await client.login()
    return client
  }
}

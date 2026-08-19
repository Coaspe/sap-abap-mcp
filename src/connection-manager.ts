import { AppError } from "./errors.js"
import {
  OAuthClientCredentialsProvider,
  type OAuthAccessTokenProvider
} from "./oauth-client-credentials.js"
import { OAuthAuthorizationCodeProvider } from "./oauth-authorization-code.js"
import { ProfileStore, type SapProfile } from "./profile-store.js"
import type { SecretStore } from "./secret-store.js"
import {
  defaultSapClientFactory,
  type SapClient,
  type SapCredential,
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

type OAuthProfile = Extract<SapProfile, { authType: "oauth_client_credentials" }>
type AuthorizationCodeProfile = Extract<SapProfile, { authType: "oauth_authorization_code" }>
export type OAuthProviderFactory = (
  profile: OAuthProfile,
  clientSecret: string
) => OAuthAccessTokenProvider
export type AuthorizationCodeProviderFactory = (
  profile: AuthorizationCodeProfile,
  credential: string,
  persistCredential: (credential: string) => Promise<void>
) => OAuthAccessTokenProvider

interface CachedClient {
  pending: Promise<SapClient>
  tokenProvider?: OAuthAccessTokenProvider
}

const defaultOAuthProviderFactory: OAuthProviderFactory = (profile, clientSecret) =>
  new OAuthClientCredentialsProvider({
    tokenUrl: profile.tokenUrl,
    clientId: profile.clientId,
    clientSecret,
    ...(profile.scope ? { scope: profile.scope } : {})
  })

const defaultAuthorizationCodeProviderFactory: AuthorizationCodeProviderFactory = (
  profile,
  credential,
  persistCredential
) => new OAuthAuthorizationCodeProvider(
  {
    authorizationUrl: profile.authorizationUrl,
    tokenUrl: profile.tokenUrl,
    clientId: profile.clientId,
    ...(profile.scope ? { scope: profile.scope } : {})
  },
  credential,
  { persistCredential }
)

export class ConnectionManager {
  private readonly clients = new Map<string, CachedClient>()

  constructor(
    private readonly profiles: ProfileStore,
    private readonly secrets: SecretStore,
    private readonly factory: SapClientFactory = defaultSapClientFactory,
    private readonly allowedProfileId?: string,
    private readonly oauthProviderFactory: OAuthProviderFactory = defaultOAuthProviderFactory,
    private readonly authorizationCodeProviderFactory: AuthorizationCodeProviderFactory =
      defaultAuthorizationCodeProviderFactory
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
    let cached = this.clients.get(profile.id)
    if (cached?.tokenProvider?.refreshRequired()) {
      this.clients.delete(profile.id)
      cached.tokenProvider.invalidate()
      await cached.pending
        .then(client => client.logout())
        .catch(() => undefined)
      cached = undefined
    }
    if (!cached) {
      const created: CachedClient = {
        pending: this.connect(profile, provider => {
          created.tokenProvider = provider
        })
      }
      cached = created
      this.clients.set(profile.id, created)
      created.pending.catch(() => {
        if (this.clients.get(profile.id) === created) this.clients.delete(profile.id)
      })
    }
    return cached.pending
  }

  async validateCredentials(profile: SapProfile, secret: string): Promise<void> {
    if (profile.authType === "bearer_passthrough") {
      throw new AppError(
        "AUTH_PASSTHROUGH_REQUIRED",
        "bearer_passthrough profiles are validated from an authenticated HTTP session"
      )
    }
    const client = this.factory(profile, this.credential(profile, secret))
    await client.login()
    try {
      await client.getSystemInfo(false)
    } finally {
      await client.logout().catch(() => undefined)
    }
  }

  async close(): Promise<void> {
    const clients = await Promise.allSettled(
      [...this.clients.values()].map(item => item.pending)
    )
    await Promise.all(
      clients
        .filter((result): result is PromiseFulfilledResult<SapClient> => result.status === "fulfilled")
        .map(result => result.value.logout().catch(() => undefined))
    )
    this.clients.clear()
  }

  async createBearerClient(connectionId: string, token: string): Promise<SapClient> {
    const profile = await this.getAllowedProfile(connectionId)
    if (profile.authType !== "bearer_passthrough") {
      throw new AppError(
        "AUTH_PASSTHROUGH_NOT_CONFIGURED",
        `Profile ${profile.id} does not accept request-scoped bearer credentials`
      )
    }
    if (!token) throw new AppError("AUTH_REQUIRED", "A SAP bearer token is required")
    const client = this.factory(profile, { type: "bearer", fetchToken: async () => token })
    await client.login()
    return client
  }

  async usesBearerPassthrough(connectionId: string): Promise<boolean> {
    return (await this.getAllowedProfile(connectionId)).authType === "bearer_passthrough"
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

  private async connect(
    profile: SapProfile,
    setTokenProvider: (provider: OAuthAccessTokenProvider) => void
  ): Promise<SapClient> {
    const secret = await this.secrets.get(profile.id)
    if (profile.authType === "bearer_passthrough") {
      throw new AppError(
        "AUTH_PASSTHROUGH_REQUIRED",
        `Profile ${profile.id} requires an OIDC-authenticated HTTP session`
      )
    }
    if (!secret) {
      throw new AppError(
        "AUTH_REQUIRED",
        `No credential is stored for ${profile.id}. Run: sap-abap-mcp auth login ${profile.id}`
      )
    }
    const credential = this.credential(profile, secret, setTokenProvider)
    const client = this.factory(profile, credential)
    await client.login()
    return client
  }

  private credential(
    profile: SapProfile,
    secret: string,
    setTokenProvider?: (provider: OAuthAccessTokenProvider) => void
  ): SapCredential {
    if (profile.authType === "basic") return { type: "basic", password: secret }
    if (profile.authType === "bearer_passthrough") {
      throw new AppError("AUTH_PASSTHROUGH_REQUIRED", "A request-scoped SAP token is required")
    }
    const tokenProvider = profile.authType === "oauth_client_credentials"
      ? this.oauthProviderFactory(profile, secret)
      : this.authorizationCodeProviderFactory(
          profile,
          secret,
          credential => this.secrets.set(profile.id, credential)
        )
    setTokenProvider?.(tokenProvider)
    return { type: "bearer", fetchToken: () => tokenProvider.getAccessToken() }
  }
}

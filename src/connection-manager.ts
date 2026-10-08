import { AppError, tokenPassthroughRefused } from "./errors.js"
import {
  OAuthClientCredentialsProvider,
  type OAuthAccessTokenProvider
} from "./oauth-client-credentials.js"
import { OAuthAuthorizationCodeProvider } from "./oauth-authorization-code.js"
import { applyProfileAccessPolicy, profileConnectionKey, ProfileStore, type SapProfile } from "./profile-store.js"
import type { SecretStore } from "./secret-store.js"
import { withProfileCredentialUpdate } from "./save-profile-credential.js"
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
  readOnly?: boolean
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
  connectionKey: string
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

  async listConnections(requestScopedCredentialsAvailable = false): Promise<ConnectionSummary[]> {
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
        ...(profile.readOnly || profile.environment === "production" ? { readOnly: true } : {}),
        credentialAvailable: profile.authType === "bearer_passthrough" ? false
          : profile.authType === "btp_destination" ? requestScopedCredentialsAvailable
          : Boolean(await this.secrets.get(profile.id))
      }))
    )
  }

  async getClient(connectionId: string): Promise<SapClient> {
    const profile = await this.getProfile(connectionId)
    if (profile.authType === "bearer_passthrough") throw tokenPassthroughRefused()
    let cached = this.clients.get(profile.id)
    const connectionKey = profileConnectionKey(profile)
    const previous = cached && (cached.connectionKey !== connectionKey || cached.tokenProvider?.refreshRequired())
      ? cached : undefined
    if (!cached || previous) {
      const created: CachedClient = {
        connectionKey,
        pending: (async () => {
          if (previous) {
            previous.tokenProvider?.invalidate()
            await previous.pending
              .then(client => client.logout())
              .catch(() => undefined)
          }
          return this.connect(profile, provider => {
            created.tokenProvider = provider
          })
        })()
      }
      cached = created
      this.clients.set(profile.id, created)
      created.pending.catch(() => {
        if (this.clients.get(profile.id) === created) this.clients.delete(profile.id)
      })
    }
    const client = await cached.pending
    applyProfileAccessPolicy(client.profile, profile)
    return client
  }

  async validateCredentials(
    profile: SapProfile,
    secret: string,
    onVerifiedCredential?: (credential: string) => void
  ): Promise<void> {
    if (profile.authType === "bearer_passthrough") throw tokenPassthroughRefused()
    if (profile.authType === "btp_destination") {
      throw new AppError(
        "AUTH_PASSTHROUGH_REQUIRED",
        "Request-scoped profiles are validated from an authenticated HTTP session"
      )
    }
    let verifiedCredential = secret
    const client = this.factory(profile, this.credential(profile, secret, undefined, async credential => {
      verifiedCredential = credential
    }))
    try {
      await client.login()
      await client.getSystemInfo(false)
      onVerifiedCredential?.(verifiedCredential)
    } finally {
      await client.logout().catch(() => undefined)
    }
  }

  async disconnectProfile(connectionId: string): Promise<void> {
    const id = connectionId.trim().toUpperCase()
    const cached = this.clients.get(id)
    if (!cached) return
    this.clients.delete(id)
    cached.tokenProvider?.invalidate()
    await cached.pending.then(client => client.logout()).catch(() => undefined)
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
    const profile = await this.getProfile(connectionId)
    if (profile.authType === "bearer_passthrough") throw tokenPassthroughRefused()
    if (profile.authType !== "btp_destination") {
      throw new AppError(
        "AUTH_PASSTHROUGH_NOT_CONFIGURED",
        `Profile ${profile.id} does not accept request-scoped bearer credentials`
      )
    }
    if (!token) throw new AppError("AUTH_REQUIRED", "A SAP bearer token is required")
    const transport = (await import("./user-destination.js")).createUserDestinationTransportFactory({
      destinationName: profile.destinationName, expectedUrl: profile.url, sapClient: profile.client,
      authentication: profile.destinationAuthentication, userJwt: token
    })
    const client = this.factory(profile, { type: "bearer", fetchToken: async () => token }, transport)
    try {
      await client.login()
      return client
    } catch (error) {
      await client.logout().catch(() => undefined)
      throw error
    }
  }

  async usesBearerPassthrough(connectionId: string): Promise<boolean> {
    return (await this.getProfile(connectionId)).authType === "bearer_passthrough"
  }

  async usesRequestScopedCredentials(connectionId: string): Promise<boolean> {
    const type = (await this.getProfile(connectionId)).authType
    return type === "bearer_passthrough" || type === "btp_destination"
  }

  async getProfile(connectionId: string): Promise<SapProfile> {
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
    if (profile.authType === "bearer_passthrough") throw tokenPassthroughRefused()
    if (profile.authType === "btp_destination") {
      throw new AppError(
        "AUTH_PASSTHROUGH_REQUIRED",
        `Profile ${profile.id} requires an OIDC-authenticated HTTP session`
      )
    }
    const secret = await this.secrets.get(profile.id)
    if (!secret) {
      throw new AppError(
        "AUTH_REQUIRED",
        `No credential is stored for ${profile.id}. Sign in locally using the setup wizard or auth login.`
      )
    }
    let storedCredential = secret
    const credential = this.credential(profile, secret, setTokenProvider, nextCredential =>
      withProfileCredentialUpdate(this.secrets, profile.id, async () => {
        if (await this.secrets.get(profile.id) !== storedCredential) {
          throw new AppError("CANCELLED", "Stored credential changed while OAuth refresh was pending")
        }
        await this.secrets.set(profile.id, nextCredential)
        storedCredential = nextCredential
      }))
    const client = this.factory(profile, credential)
    await client.login()
    return client
  }

  private credential(
    profile: SapProfile,
    secret: string,
    setTokenProvider: ((provider: OAuthAccessTokenProvider) => void) | undefined,
    persistCredential: (credential: string) => Promise<void>
  ): SapCredential {
    if (profile.authType === "basic") return { type: "basic", password: secret }
    if (profile.authType === "bearer_passthrough" || profile.authType === "btp_destination") {
      throw new AppError("AUTH_PASSTHROUGH_REQUIRED", "A request-scoped SAP token is required")
    }
    const tokenProvider = profile.authType === "oauth_client_credentials"
      ? this.oauthProviderFactory(profile, secret)
      : this.authorizationCodeProviderFactory(
          profile,
          secret,
          persistCredential
        )
    setTokenProvider?.(tokenProvider)
    return { type: "bearer", fetchToken: () => tokenProvider.getAccessToken() }
  }
}

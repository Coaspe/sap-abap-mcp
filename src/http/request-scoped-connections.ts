import { applyProfileAccessPolicy, profileConnectionKey } from "../profile-store.js"
import { AppError, tokenPassthroughRefused } from "../errors.js"
import type { ConnectionManager, ConnectionSummary } from "../connection-manager.js"
import type { SapClient } from "../sap-client.js"
import type { ConnectionProvider } from "../tool-service.js"

export class RequestScopedConnectionProvider implements ConnectionProvider {
  private readonly allowed: ReadonlySet<string> | undefined
  private readonly clients = new Map<string, { connectionKey: string; pending: Promise<SapClient> }>()
  private closing: Promise<void> | undefined

  private assertOpen(): void {
    if (this.closing) throw new AppError("SESSION_CLOSED", "The authenticated SAP connection session is closed")
  }

  constructor(
    private readonly inner: ConnectionManager,
    private readonly bearerToken: string,
    systemIds?: readonly string[]
  ) {
    const normalized = (systemIds ?? [])
      .map(value => value.trim().toUpperCase())
      .filter(Boolean)
    this.allowed = normalized.length > 0 ? new Set(normalized) : undefined
  }

  async listConnections(): Promise<ConnectionSummary[]> {
    this.assertOpen()
    const connections = await this.inner.listConnections(Boolean(this.bearerToken))
    this.assertOpen()
    if (!this.allowed) return connections
    return connections.filter(connection => this.allowed!.has(connection.id.toUpperCase()))
  }

  async getClient(connectionId: string): Promise<SapClient> {
    this.assertOpen()
    const normalized = connectionId.trim().toUpperCase()
    if (this.allowed && !this.allowed.has(normalized)) {
      throw new AppError(
        "PROFILE_NOT_ALLOWED",
        `This identity is not authorized for SAP profile ${normalized}`
      )
    }
    const profile = await this.inner.getProfile(normalized)
    this.assertOpen()
    if (profile.authType === "bearer_passthrough") throw tokenPassthroughRefused()
    if (profile.authType !== "btp_destination") {
      const shared = await this.inner.getClient(normalized)
      this.assertOpen()
      return shared
    }
    let cached = this.clients.get(normalized)
    const connectionKey = profileConnectionKey(profile)
    if (!cached || cached.connectionKey !== connectionKey) {
      const previous = cached
      const created = {
        connectionKey,
        pending: (async () => {
          if (previous) await previous.pending.then(client => client.logout()).catch(() => undefined)
          this.assertOpen()
          return this.inner.createBearerClient(normalized, this.bearerToken)
        })()
      }
      cached = created
      this.clients.set(normalized, created)
      created.pending.catch(() => {
        if (this.clients.get(normalized) === created) this.clients.delete(normalized)
      })
    }
    const connected = await cached.pending
    this.assertOpen()
    applyProfileAccessPolicy(connected.profile, profile)
    return connected
  }

  close(): Promise<void> {
    if (!this.closing) {
      this.closing = Promise.allSettled([...this.clients.values()].map(client => client.pending)).then(async clients => {
        await Promise.all(clients
          .filter((result): result is PromiseFulfilledResult<SapClient> => result.status === "fulfilled")
          .map(result => result.value.logout().catch(() => undefined)))
        this.clients.clear()
      })
    }
    return this.closing
  }
}

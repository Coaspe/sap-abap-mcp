import { AppError } from "../errors.js"
import type { ConnectionManager, ConnectionSummary } from "../connection-manager.js"
import type { SapClient } from "../sap-client.js"
import type { ConnectionProvider } from "../tool-service.js"

export class RequestScopedConnectionProvider implements ConnectionProvider {
  private readonly allowed: ReadonlySet<string> | undefined
  private readonly clients = new Map<string, Promise<SapClient>>()
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
    const connections = await this.inner.listConnections()
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
    const passthrough = await this.inner.usesRequestScopedCredentials(normalized)
    this.assertOpen()
    if (!passthrough) {
      const shared = await this.inner.getClient(normalized)
      this.assertOpen()
      return shared
    }
    let client = this.clients.get(normalized)
    if (!client) {
      client = this.inner.createBearerClient(normalized, this.bearerToken)
      this.clients.set(normalized, client)
      client.catch(() => {
        if (this.clients.get(normalized) === client) this.clients.delete(normalized)
      })
    }
    const connected = await client
    this.assertOpen()
    return connected
  }

  close(): Promise<void> {
    if (!this.closing) {
      this.closing = Promise.allSettled(this.clients.values()).then(async clients => {
        await Promise.all(clients
          .filter((result): result is PromiseFulfilledResult<SapClient> => result.status === "fulfilled")
          .map(result => result.value.logout().catch(() => undefined)))
        this.clients.clear()
      })
    }
    return this.closing
  }
}

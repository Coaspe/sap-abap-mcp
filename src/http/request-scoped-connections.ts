import { AppError } from "../errors.js"
import type { ConnectionManager, ConnectionSummary } from "../connection-manager.js"
import type { SapClient } from "../sap-client.js"
import type { ConnectionProvider } from "../tool-service.js"

export class RequestScopedConnectionProvider implements ConnectionProvider {
  private readonly allowed: ReadonlySet<string> | undefined
  private readonly clients = new Map<string, Promise<SapClient>>()

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
    const connections = await this.inner.listConnections()
    if (!this.allowed) return connections
    return connections.filter(connection => this.allowed!.has(connection.id.toUpperCase()))
  }

  async getClient(connectionId: string): Promise<SapClient> {
    const normalized = connectionId.trim().toUpperCase()
    if (this.allowed && !this.allowed.has(normalized)) {
      throw new AppError(
        "PROFILE_NOT_ALLOWED",
        `This identity is not authorized for SAP profile ${normalized}`
      )
    }
    if (!await this.inner.usesBearerPassthrough(normalized)) {
      return this.inner.getClient(normalized)
    }
    let client = this.clients.get(normalized)
    if (!client) {
      client = this.inner.createBearerClient(normalized, this.bearerToken)
      this.clients.set(normalized, client)
      client.catch(() => {
        if (this.clients.get(normalized) === client) this.clients.delete(normalized)
      })
    }
    return client
  }

  async close(): Promise<void> {
    const clients = await Promise.allSettled(this.clients.values())
    await Promise.all(clients
      .filter((result): result is PromiseFulfilledResult<SapClient> => result.status === "fulfilled")
      .map(result => result.value.logout().catch(() => undefined)))
    this.clients.clear()
  }
}

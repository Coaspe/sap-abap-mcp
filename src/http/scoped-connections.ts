import { AppError } from "../errors.js"
import type { ConnectionProvider } from "../tool-service.js"
import type { ConnectionSummary } from "../connection-manager.js"

/**
 * Restrict one session to the SAP profiles its principal may use.
 *
 * Assigning a separate SAP profile per person is how a shared deployment gets
 * per-user SAP identity: each session logs in as that person's own SAP user, so
 * SAP change documents attribute the work to them and SAP authorization objects
 * gate what they can do. Without this, every session reaches SAP through one
 * profile and SAP-side attribution collapses to a single technical user.
 *
 * The underlying provider is shared, so SAP logins stay pooled across sessions.
 * An empty or absent allowlist means every configured profile is reachable,
 * which preserves the single-identity default.
 */
export class ScopedConnectionProvider implements ConnectionProvider {
  private readonly allowed: ReadonlySet<string> | undefined

  constructor(
    private readonly inner: ConnectionProvider,
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
    return connections.filter(connection =>
      this.allowed!.has(connection.id.toUpperCase())
    )
  }

  async getClient(connectionId: string) {
    const normalized = connectionId.trim().toUpperCase()
    if (this.allowed && !this.allowed.has(normalized)) {
      // Report only that this identity may not use the profile. Listing the
      // profiles it may use would disclose other people's system assignments.
      throw new AppError(
        "PROFILE_NOT_ALLOWED",
        `This identity is not authorized for SAP profile ${normalized}`
      )
    }
    return this.inner.getClient(connectionId)
  }
}

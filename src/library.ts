import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import {
  createMcpServer,
  type McpServerOptions
} from "./mcp-server.js"
import type { SecretStore } from "./secret-store.js"
import {
  AbapToolService,
  type ConnectionProvider
} from "./tool-service.js"

export { createMcpServer, type McpServerOptions } from "./mcp-server.js"
export { AbapToolService, type ConnectionProvider } from "./tool-service.js"
export type {
  SapClient,
  SapClientFactory,
  SapCredential,
  SapObjectReference,
  SapProfiledClassRunResult
} from "./sap-client.js"
export type { SecretStore } from "./secret-store.js"

export interface EmbeddedMcpServerOptions {
  connectionProvider: ConnectionProvider
  secretStore?: SecretStore
  serverOptions?: McpServerOptions
}

export interface EmbeddedMcpServer {
  server: McpServer
  service: AbapToolService
  close(): Promise<void>
}

/**
 * Build a transport-neutral MCP runtime for an existing application. The host
 * owns the connection provider and chooses which MCP transport to connect.
 */
export function createEmbeddedMcpServer(
  options: EmbeddedMcpServerOptions
): EmbeddedMcpServer {
  const service = new AbapToolService(options.connectionProvider, options.secretStore)
  const server = createMcpServer(service, options.serverOptions)
  let closePromise: Promise<void> | undefined
  return {
    server,
    service,
    close() {
      closePromise ??= (async () => {
        service.dispose()
        await server.close()
      })()
      return closePromise
    }
  }
}

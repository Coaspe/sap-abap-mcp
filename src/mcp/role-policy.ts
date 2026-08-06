import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js"
import type { HttpRole } from "../http/auth.js"

/**
 * v1 capabilities that change a transport, a Git remote, a published service, a
 * released revision, or the operator's own workstation. These are irreversible
 * or landscape-wide, so they are reserved for the `admin` role even though a
 * `developer` may freely change and activate source.
 *
 * This list is an explicit governance contract, not a derived set: adding a tool
 * here is a deliberate decision that must be documented.
 */
export const ADMIN_ONLY_V1_TOOLS: readonly string[] = [
  "sap.git.branch.switch",
  "sap.git.push",
  "sap.git.unlink",
  "sap.rap.binding.publish",
  "sap.rap.binding.unpublish",
  "sap.repository.delete.execute",
  "sap.transport.delete",
  "sap.transport.owner.set",
  "sap.transport.release",
  "sap.transport.user.add",
  "sap.ui.transaction_launch",
  "sap.version.restore.execute"
]

const ADMIN_ONLY_LOOKUP = new Set(ADMIN_ONLY_V1_TOOLS)

/**
 * Decide whether a role may see and call one capability.
 *
 * - `viewer` gets only capabilities advertised with `readOnlyHint: true`.
 * - `developer` gets everything except {@link ADMIN_ONLY_V1_TOOLS}.
 * - `admin` gets everything.
 *
 * Grouped v0 tools carry many actions behind one name, so on the legacy
 * `--api-version v0` surface only the `viewer` restriction is meaningful.
 */
export function isToolAllowedForRole(
  role: HttpRole,
  name: string,
  annotations?: ToolAnnotations
): boolean {
  if (annotations?.readOnlyHint === true) return true
  if (role === "viewer") return false
  if (role === "admin") return true
  return !ADMIN_ONLY_LOOKUP.has(name)
}

interface RoleFilterableServer {
  registerTool: (name: string, config: unknown, callback: unknown) => unknown
}

/**
 * Wrap `registerTool` on one `McpServer` instance so that capabilities the role
 * may not use are never registered, and therefore never advertised by
 * `tools/list`. Because every v0 and v1 tool registers through this method, a
 * `viewer` session cannot reach a mutation even if a client guesses its name.
 *
 * Call this before registering capabilities. Resources stay available because
 * every advertised Resource in this server is a read.
 */
export function applyRolePolicy(server: McpServer, role: HttpRole): void {
  if (role === "admin") return
  const target = server as unknown as RoleFilterableServer
  const originalRegisterTool = target.registerTool.bind(target)
  target.registerTool = (name, config, callback) => {
    const annotations = (config as { annotations?: ToolAnnotations } | undefined)
      ?.annotations
    if (!isToolAllowedForRole(role, name, annotations)) return undefined
    return originalRegisterTool(name, config, callback)
  }
}

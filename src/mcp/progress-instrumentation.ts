import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js"
import type { ServerNotification, ServerRequest } from "@modelcontextprotocol/sdk/types.js"

type Callback = (...args: unknown[]) => unknown
type Extra = RequestHandlerExtra<ServerRequest, ServerNotification>

/** Report request lifetime and elapsed time, never estimated SAP completion. */
export function instrumentProgress(server: McpServer): void {
  const target = server as unknown as {
    registerTool(name: string, config: { inputSchema?: unknown }, callback: Callback): unknown
  }
  const register = target.registerTool.bind(target)
  target.registerTool = (name, config, callback) => register(name, config, async (...args) => {
    const extra = (config.inputSchema !== undefined ? args[1] : args[0]) as Extra
    const token = extra._meta?.progressToken
    if (token === undefined || extra.signal.aborted) return callback(...args)
    let progress = 0
    let pending = Promise.resolve()
    const started = performance.now()
    const notify = (message: string): Promise<void> => {
      const value = progress++
      pending = pending.then(async () => {
        if (extra.signal.aborted) return
        await extra.sendNotification({ method: "notifications/progress",
          params: { progressToken: token, progress: value, message } }).catch(() => undefined)
      })
      return pending
    }
    await notify(`${name}: started`)
    if (extra.signal.aborted) return callback(...args)
    const timer = setInterval(() => {
      void notify(`${name}: still running (${Math.floor((performance.now() - started) / 1000)}s elapsed)`)
    }, 5000)
    timer.unref()
    const stop = () => clearInterval(timer)
    extra.signal.addEventListener("abort", stop, { once: true })
    let outcome = "failed"
    try {
      const result = await callback(...args)
      outcome = result && typeof result === "object" && (result as { isError?: boolean }).isError
        ? "failed" : "finished"
      return result
    } finally {
      stop()
      extra.signal.removeEventListener("abort", stop)
      await notify(`${name}: ${outcome}`)
    }
  })
}

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import {
  CompleteRequestSchema,
  ErrorCode,
  McpError,
  assertCompleteRequestPrompt,
  assertCompleteRequestResourceTemplate,
  type CompleteRequestPrompt,
  type CompleteRequestResourceTemplate
} from "@modelcontextprotocol/sdk/types.js"
import { toV1ProtocolError } from "./result.js"

export type V1ResourceCompletionProvider = (
  request: CompleteRequestResourceTemplate
) => string[] | Promise<string[]>

export type V1PromptCompletionProvider = (
  request: CompleteRequestPrompt
) => string[] | Promise<string[]>

export interface V1CompletionRouter {
  setResourceProvider(provider: V1ResourceCompletionProvider): void
  setPromptProvider(provider: V1PromptCompletionProvider): void
}

function completionResult(suggestions: string[]) {
  return {
    completion: {
      values: suggestions.slice(0, 100),
      total: suggestions.length,
      hasMore: suggestions.length > 100
    }
  }
}

export function installV1CompletionRouter(
  server: McpServer
): V1CompletionRouter {
  let resourceProvider: V1ResourceCompletionProvider | undefined
  let promptProvider: V1PromptCompletionProvider | undefined

  server.server.registerCapabilities({ completions: {} })
  server.server.setRequestHandler(CompleteRequestSchema, async request => {
    try {
      if (request.params.ref.type === "ref/resource") {
        assertCompleteRequestResourceTemplate(request)
        if (resourceProvider === undefined) {
          throw new McpError(
            ErrorCode.InvalidParams,
            "Resource completion provider is not registered"
          )
        }
        return completionResult(await resourceProvider(request))
      }

      assertCompleteRequestPrompt(request)
      if (promptProvider === undefined) {
        throw new McpError(
          ErrorCode.InvalidParams,
          "Prompt completion provider is not registered"
        )
      }
      return completionResult(await promptProvider(request))
    } catch (error) {
      throw toV1ProtocolError(error)
    }
  })

  return {
    setResourceProvider(provider) {
      if (resourceProvider !== undefined) {
        throw new McpError(
          ErrorCode.InvalidParams,
          "Resource completion provider is already registered"
        )
      }
      resourceProvider = provider
    },
    setPromptProvider(provider) {
      if (promptProvider !== undefined) {
        throw new McpError(
          ErrorCode.InvalidParams,
          "Prompt completion provider is already registered"
        )
      }
      promptProvider = provider
    }
  }
}

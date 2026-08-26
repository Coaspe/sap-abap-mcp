import { createHash } from "node:crypto"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type {
  CallToolResult,
  Tool,
  ToolAnnotations
} from "@modelcontextprotocol/sdk/types.js"
import { z } from "zod"
import { AppError } from "../../errors.js"
import { ADAPTIVE_AUDIT_META_KEY } from "../audit-instrumentation.js"
import { ADMIN_ONLY_V1_TOOLS } from "../role-policy.js"
import { runV1Tool, v1Success } from "./result.js"
import { V1_READ_ONLY_ANNOTATIONS } from "./system-tools.js"

export const ADAPTIVE_V1_TOOL_NAMES = [
  "sap.capability.search",
  "sap.capability.describe",
  "sap.capability.invoke_read",
  "sap.capability.invoke_write",
  "sap.capability.invoke_destructive"
] as const

export type AdaptiveCapabilityRisk = "read" | "write" | "destructive"

const ADMIN_ONLY_TOOLS = new Set<string>(ADMIN_ONLY_V1_TOOLS)
const CURSOR = z.string().regex(/^\d+$/)
const TOOL_NAME = z.string().min(1)
const SCHEMA_HASH = z.string().regex(/^[0-9a-f]{64}$/)
const TOOL_ARGUMENTS = z.record(z.string(), z.unknown())

const WRITE_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true
} satisfies ToolAnnotations

const DESTRUCTIVE_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: true
} satisfies ToolAnnotations

interface AdaptiveGatewayOptions {
  createInternalServer: () => McpServer
}

export interface AdaptiveGatewayHandle {
  close(): Promise<void>
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue)
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableValue(item)])
    )
  }
  return value
}

function schemaHash(tool: Tool): string {
  return createHash("sha256")
    .update(JSON.stringify(stableValue({
      name: tool.name,
      inputSchema: tool.inputSchema
    })), "utf8")
    .digest("hex")
}

function riskOf(tool: Tool): AdaptiveCapabilityRisk {
  if (tool.annotations?.readOnlyHint === true) return "read"
  return tool.annotations?.destructiveHint === true ? "destructive" : "write"
}

function categoryOf(name: string): string {
  const segments = name.split(".")
  return segments.slice(1, -1).join(".")
}

function minimumRoleOf(tool: Tool): "viewer" | "developer" | "admin" {
  if (ADMIN_ONLY_TOOLS.has(tool.name)) return "admin"
  return riskOf(tool) === "read" ? "viewer" : "developer"
}

function normalizedTokens(value: string): string[] {
  return value.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
}

function relevance(tool: Tool, query: string): number {
  const normalized = query.trim().toLowerCase()
  if (normalized.length === 0) return 1
  if (tool.name.toLowerCase() === normalized) return 10_000

  const name = tool.name.toLowerCase()
  const title = tool.title?.toLowerCase() ?? ""
  const description = tool.description?.toLowerCase() ?? ""
  let score = name.includes(normalized) ? 100 : 0
  score += title.includes(normalized) ? 50 : 0
  score += description.includes(normalized) ? 20 : 0
  for (const token of normalizedTokens(normalized)) {
    score += name.includes(token) ? 10 : 0
    score += title.includes(token) ? 5 : 0
    score += description.includes(token) ? 2 : 0
  }
  return score
}

function capabilitySummary(tool: Tool, score?: number) {
  return {
    name: tool.name,
    ...(tool.title ? { title: tool.title } : {}),
    ...(tool.description ? { summary: tool.description } : {}),
    category: categoryOf(tool.name),
    risk: riskOf(tool),
    minimumRole: minimumRoleOf(tool),
    ...(score === undefined ? {} : { score })
  }
}

class AdaptiveCapabilityGateway {
  private client?: Client
  private internalServer?: McpServer
  private initialization?: Promise<void>
  private catalog?: Map<string, Tool>
  private closePromise?: Promise<void>

  constructor(private readonly options: AdaptiveGatewayOptions) {}

  private async initialize(): Promise<void> {
    if (this.catalog) return
    if (!this.initialization) {
      this.initialization = (async () => {
        const internalServer = this.options.createInternalServer()
        const client = new Client({
          name: "sap-abap-mcp-adaptive-gateway",
          version: "1.0.0"
        })
        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
        try {
          await internalServer.connect(serverTransport)
          await client.connect(clientTransport)
          const tools: Tool[] = []
          let cursor: string | undefined
          do {
            const page = await client.listTools(
              cursor === undefined ? undefined : { cursor }
            )
            tools.push(...page.tools)
            cursor = page.nextCursor
          } while (cursor !== undefined)
          this.internalServer = internalServer
          this.client = client
          this.catalog = new Map(tools.map(tool => [tool.name, tool]))
        } catch (error) {
          await client.close().catch(() => undefined)
          await internalServer.close().catch(() => undefined)
          throw error
        }
      })()
    }
    await this.initialization
  }

  private async tool(name: string): Promise<Tool> {
    await this.initialize()
    const tool = this.catalog?.get(name)
    if (!tool) {
      throw new AppError(
        "CAPABILITY_NOT_FOUND",
        `Capability is unavailable in this session: ${name}`
      )
    }
    return tool
  }

  async search(input: {
    query?: string | undefined
    name?: string | undefined
    category?: string | undefined
    risk?: AdaptiveCapabilityRisk | undefined
    cursor?: string | undefined
    limit: number
  }): Promise<CallToolResult> {
    await this.initialize()
    const query = input.query?.trim() ?? ""
    const category = input.category?.trim().toLowerCase()
    const candidates = [...(this.catalog?.values() ?? [])]
      .map(tool => ({ tool, score: relevance(tool, query) }))
      .filter(({ tool, score }) =>
        (input.name === undefined || tool.name === input.name) &&
        (category === undefined || categoryOf(tool.name).toLowerCase() === category ||
          categoryOf(tool.name).toLowerCase().startsWith(`${category}.`)) &&
        (input.risk === undefined || riskOf(tool) === input.risk) &&
        (query.length === 0 || score > 0)
      )
      .sort((left, right) => query.length > 0
        ? right.score - left.score || left.tool.name.localeCompare(right.tool.name)
        : left.tool.name.localeCompare(right.tool.name))
    const start = Number(input.cursor ?? "0")
    const page = candidates.slice(start, start + input.limit)
    const nextCursor = start + page.length < candidates.length
      ? String(start + page.length)
      : undefined
    const includeCategories = input.query === undefined &&
      input.name === undefined &&
      input.category === undefined &&
      input.cursor === undefined
    const categories = new Map<string, number>()
    if (includeCategories) {
      for (const tool of this.catalog?.values() ?? []) {
        const toolCategory = categoryOf(tool.name)
        categories.set(toolCategory, (categories.get(toolCategory) ?? 0) + 1)
      }
    }
    return v1Success({
      tools: page.map(({ tool, score }) => capabilitySummary(
        tool,
        query.length > 0 ? score : undefined
      )),
      ...(includeCategories
        ? {
            categories: [...categories]
              .sort(([left], [right]) => left.localeCompare(right))
              .map(([name, count]) => ({ name, count }))
          }
        : {}),
      ...(nextCursor === undefined ? {} : { nextCursor })
    }, {
      page: {
        returned: page.length,
        total: candidates.length,
        ...(nextCursor === undefined ? {} : { nextCursor })
      }
    })
  }

  async describe(
    name: string,
    includeOutputSchema: boolean
  ): Promise<CallToolResult> {
    const tool = await this.tool(name)
    return v1Success({
      capability: {
        ...capabilitySummary(tool),
        schemaHash: schemaHash(tool),
        inputSchema: tool.inputSchema,
        ...(includeOutputSchema && tool.outputSchema
          ? { outputSchema: tool.outputSchema }
          : {}),
        ...(tool.annotations ? { annotations: tool.annotations } : {})
      }
    })
  }

  async invoke(
    expectedRisk: AdaptiveCapabilityRisk,
    name: string,
    expectedSchemaHash: string,
    args: Record<string, unknown>
  ): Promise<CallToolResult> {
    const tool = await this.tool(name)
    const actualRisk = riskOf(tool)
    if (actualRisk !== expectedRisk) {
      throw new AppError(
        "CAPABILITY_RISK_MISMATCH",
        `Use sap.capability.invoke_${actualRisk} for ${name}`,
        { expectedRisk, actualRisk, name }
      )
    }
    const actualSchemaHash = schemaHash(tool)
    if (actualSchemaHash !== expectedSchemaHash) {
      throw new AppError(
        "CAPABILITY_SCHEMA_CHANGED",
        `Describe ${name} again before invoking it`,
        { name, actualSchemaHash }
      )
    }
    return await this.client!.callTool({ name, arguments: args }) as CallToolResult
  }

  close(): Promise<void> {
    this.closePromise ??= (async () => {
      await this.initialization?.catch(() => undefined)
      await this.client?.close().catch(() => undefined)
      await this.internalServer?.close().catch(() => undefined)
    })()
    return this.closePromise
  }
}

export function registerAdaptiveV1Tools(
  server: McpServer,
  options: AdaptiveGatewayOptions
): AdaptiveGatewayHandle {
  const gateway = new AdaptiveCapabilityGateway(options)
  server.registerTool(
    "sap.capability.search",
    {
      title: "Search SAP Capabilities",
      description:
        "Search or page through the complete SAP tool catalog. Use category browsing when keyword search misses.",
      inputSchema: z.object({
        query: z.string().optional(),
        name: TOOL_NAME.optional(),
        category: z.string().min(1).optional(),
        risk: z.enum(["read", "write", "destructive"]).optional(),
        cursor: CURSOR.optional(),
        limit: z.number().int().min(1).max(50).default(10)
      }).strict(),
      annotations: V1_READ_ONLY_ANNOTATIONS
    },
    input => runV1Tool(() => gateway.search(input))
  )
  server.registerTool(
    "sap.capability.describe",
    {
      title: "Describe SAP Capability",
      description:
        "Return the exact input schema and schema hash for one capability before invoking it.",
      inputSchema: z.object({
        name: TOOL_NAME,
        includeOutputSchema: z.boolean().default(false)
      }).strict(),
      annotations: V1_READ_ONLY_ANNOTATIONS
    },
    ({ name, includeOutputSchema }) => runV1Tool(
      () => gateway.describe(name, includeOutputSchema)
    )
  )

  const registerInvoke = (
    name: typeof ADAPTIVE_V1_TOOL_NAMES[2 | 3 | 4],
    risk: AdaptiveCapabilityRisk,
    annotations: ToolAnnotations
  ) => server.registerTool(
    name,
    {
      title: `Invoke ${risk[0]?.toUpperCase()}${risk.slice(1)} SAP Capability`,
      description:
        `Invoke a ${risk} capability after sap.capability.describe. The original tool validation and result are preserved.`,
      inputSchema: z.object({
        name: TOOL_NAME,
        schemaHash: SCHEMA_HASH,
        arguments: TOOL_ARGUMENTS.default({})
      }).strict(),
      annotations,
      _meta: {
        [ADAPTIVE_AUDIT_META_KEY]: {
          nameArgument: "name",
          argumentsArgument: "arguments"
        }
      }
    },
    ({ name: target, schemaHash: expectedSchemaHash, arguments: args }) =>
      runV1Tool(() => gateway.invoke(risk, target, expectedSchemaHash, args))
  )

  registerInvoke(
    "sap.capability.invoke_read",
    "read",
    V1_READ_ONLY_ANNOTATIONS
  )
  registerInvoke(
    "sap.capability.invoke_write",
    "write",
    WRITE_ANNOTATIONS
  )
  registerInvoke(
    "sap.capability.invoke_destructive",
    "destructive",
    DESTRUCTIVE_ANNOTATIONS
  )
  return gateway
}

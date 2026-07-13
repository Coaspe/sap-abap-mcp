import { AppError } from "./errors.js"
import type { ConnectionSummary } from "./connection-manager.js"
import type { SapClient } from "./sap-client.js"
import type { SapObjectReference } from "./sap-client.js"

export interface ConnectionProvider {
  listConnections(): Promise<ConnectionSummary[]>
  getClient(connectionId: string): Promise<SapClient>
}

export interface SearchObjectsInput {
  pattern: string
  types: string[]
  maxResults: number
  connectionId: string
}

export interface GetObjectLinesInput {
  objectName: string
  objectType?: string
  methodName?: string
  startLine: number
  lineCount: number
  connectionId: string
}

export function extractAbapMethod(
  source: string,
  methodName: string
): { code: string; startLine: number; endLine: number } | undefined {
  const lines = source.split(/\r?\n/)
  const escapedName = methodName.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const startPattern = new RegExp(`^\\s*METHOD\\s+(?:\\w+~)?${escapedName}\\s*\\.`, "i")
  let startIndex = -1

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ""
    const trimmed = line.trim()
    if (trimmed.startsWith("*") || trimmed.startsWith('"')) continue
    if (startIndex < 0 && startPattern.test(line)) {
      startIndex = index
      continue
    }
    if (startIndex >= 0 && /^\s*ENDMETHOD\s*\./i.test(line)) {
      return {
        code: lines.slice(startIndex, index + 1).join("\n"),
        startLine: startIndex + 1,
        endLine: index + 1
      }
    }
  }
  return undefined
}

function sameType(actual: string, expected?: string): boolean {
  if (!expected) return true
  const normalizedExpected = expected.toUpperCase().replace(/\/.*$/, "")
  return actual.toUpperCase().replace(/\/.*$/, "") === normalizedExpected
}

export class AbapToolService {
  constructor(private readonly connections: ConnectionProvider) {}

  async getConnectedSystems() {
    return { systems: await this.connections.listConnections() }
  }

  async getSapSystemInfo(connectionId: string, includeComponents: boolean) {
    const client = await this.connections.getClient(connectionId)
    return client.getSystemInfo(includeComponents)
  }

  async searchObjects(input: SearchObjectsInput) {
    const client = await this.connections.getClient(input.connectionId)
    const results: SapObjectReference[] = []
    const seen = new Set<string>()

    for (const type of input.types) {
      const remaining = input.maxResults - results.length
      if (remaining <= 0) break
      const matches = await client.searchObjects(input.pattern, type, remaining)
      for (const match of matches) {
        if (seen.has(match.uri)) continue
        seen.add(match.uri)
        results.push(match)
        if (results.length >= input.maxResults) break
      }
    }

    return {
      connectionId: input.connectionId.toUpperCase(),
      pattern: input.pattern,
      count: results.length,
      objects: results
    }
  }

  async getObjectLines(input: GetObjectLinesInput) {
    const client = await this.connections.getClient(input.connectionId)
    const candidates = await client.searchObjects(input.objectName, input.objectType, 50)
    const object = candidates.find(
      candidate =>
        candidate.name.toUpperCase() === input.objectName.toUpperCase() &&
        sameType(candidate.type, input.objectType)
    )

    if (!object) {
      throw new AppError("OBJECT_NOT_FOUND", `ABAP object ${input.objectName} was not found`, {
        ...(input.objectType ? { objectType: input.objectType } : {})
      })
    }

    const result = await client.readObject(object)
    if (input.methodName) {
      const method = extractAbapMethod(result.source, input.methodName)
      if (!method) {
        throw new AppError(
          "METHOD_NOT_FOUND",
          `Method ${input.methodName} was not found in ${object.name}`
        )
      }
      return {
        connectionId: input.connectionId.toUpperCase(),
        object,
        sourceUri: result.sourceUri,
        methodName: input.methodName,
        startLine: method.startLine,
        endLine: method.endLine,
        code: method.code
      }
    }

    const lines = result.source.split(/\r?\n/)
    const startIndex = Math.max(0, input.startLine - 1)
    const selected = lines.slice(startIndex, startIndex + input.lineCount)
    return {
      connectionId: input.connectionId.toUpperCase(),
      object,
      sourceUri: result.sourceUri,
      startLine: startIndex + 1,
      endLine: startIndex + selected.length,
      totalLines: lines.length,
      code: selected.join("\n")
    }
  }
}

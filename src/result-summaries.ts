export const SEARCH_RESULT_COMPACT_BYTE_THRESHOLD = 16 * 1024
export const DEFERRED_RESULT_SUMMARY_BYTE_LIMIT = 4 * 1024
export const SEARCH_RESULT_SUMMARY_BYTE_LIMIT = 8 * 1024

type JsonRecord = Record<string, unknown>

function record(value: unknown): JsonRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : undefined
}

function boundText(value: string, byteLimit: number): string {
  if (Buffer.byteLength(value, "utf8") <= byteLimit) return value
  let result = ""
  let bytes = 0
  for (const character of value) {
    const characterBytes = Buffer.byteLength(character, "utf8")
    if (bytes + characterBytes > byteLimit - 3) break
    result += character
    bytes += characterBytes
  }
  return `${result}...`
}

function primitive(value: unknown, stringByteLimit = 160): unknown {
  return typeof value === "string" ? boundText(value, stringByteLimit) : value
}

function sampleItem(value: unknown): unknown {
  const item = record(value)
  if (!item) {
    if (Array.isArray(value)) return { type: "array", count: value.length }
    return primitive(value)
  }

  const result: JsonRecord = {}
  for (const [key, child] of Object.entries(item).slice(0, 8)) {
    if (Array.isArray(child)) {
      result[key] = { type: "array", count: child.length }
    } else {
      const childRecord = record(child)
      result[key] = childRecord
        ? { type: "object", keys: Object.keys(childRecord).slice(0, 8) }
        : primitive(child)
    }
  }
  return result
}

function categoricalCounts(values: unknown[]) {
  for (const key of ["severity", "status", "category", "kind", "type"]) {
    const counts: Record<string, number> = {}
    let matched = 0
    for (const value of values) {
      const item = record(value)
      const category = item?.[key]
      if (typeof category !== "string" && typeof category !== "number") continue
      matched += 1
      const normalized = String(category)
      counts[normalized] = (counts[normalized] ?? 0) + 1
      if (Object.keys(counts).length > 20) break
    }
    if (matched > 0 && Object.keys(counts).length <= 20) {
      return { groupedBy: key, counts }
    }
  }
  return undefined
}

function structuralSummary(value: unknown, includeSamples: boolean): unknown {
  if (Array.isArray(value)) {
    return {
      type: "array",
      count: value.length,
      ...(includeSamples ? { sample: value.slice(0, 2).map(sampleItem) } : {})
    }
  }
  const source = record(value)
  if (!source) return primitive(value, 256)

  const scalars: JsonRecord = {}
  const collections: JsonRecord = {}
  const objects: JsonRecord = {}
  const entries = Object.entries(source)
  for (const [key, child] of entries.slice(0, 20)) {
    if (Array.isArray(child)) {
      const grouped = categoricalCounts(child)
      collections[key] = {
        count: child.length,
        ...(grouped ?? {}),
        ...(includeSamples ? { sample: child.slice(0, 2).map(sampleItem) } : {})
      }
    } else {
      const childRecord = record(child)
      if (childRecord) {
        objects[key] = { keys: Object.keys(childRecord).slice(0, 12) }
      } else {
        scalars[key] = primitive(child, includeSamples ? 256 : 96)
      }
    }
  }
  return {
    type: "object",
    scalars,
    collections,
    objects,
    omittedTopLevelFields: Math.max(0, entries.length - 20)
  }
}

export function summarizeDeferredResult(value: unknown): unknown {
  const detailed = structuralSummary(value, true)
  if (
    Buffer.byteLength(JSON.stringify(detailed), "utf8") <=
      DEFERRED_RESULT_SUMMARY_BYTE_LIMIT
  ) {
    return detailed
  }
  return structuralSummary(value, false)
}

interface SearchContextLine {
  lineNumber: number
  text: string
}

interface SearchHit {
  lineNumber: number
  line: string
  context: SearchContextLine[]
}

function searchHits(value: unknown): SearchHit[] {
  if (!Array.isArray(value)) return []
  return value.flatMap(item => {
    const hit = record(item)
    if (!hit || typeof hit.lineNumber !== "number" || typeof hit.line !== "string") return []
    const context = Array.isArray(hit.context)
      ? hit.context.flatMap(contextItem => {
          const contextLine = record(contextItem)
          return contextLine &&
            typeof contextLine.lineNumber === "number" &&
            typeof contextLine.text === "string"
            ? [{ lineNumber: contextLine.lineNumber, text: contextLine.text }]
            : []
        })
      : []
    return [{ lineNumber: hit.lineNumber, line: hit.line, context }]
  })
}

function contextBlocks(hits: SearchHit[]) {
  const uniqueLines = new Map<number, string>()
  for (const hit of hits) {
    if (hit.context.length === 0) uniqueLines.set(hit.lineNumber, hit.line)
    for (const line of hit.context) {
      if (!uniqueLines.has(line.lineNumber)) uniqueLines.set(line.lineNumber, line.text)
    }
  }
  const ordered = [...uniqueLines].sort(([left], [right]) => left - right)
  const blocks: Array<{ startLine: number; lines: string[]; matchLineNumbers: number[] }> = []
  for (const [lineNumber, text] of ordered) {
    const previous = blocks.at(-1)
    if (previous && previous.startLine + previous.lines.length === lineNumber) {
      previous.lines.push(text)
    } else {
      blocks.push({ startLine: lineNumber, lines: [text], matchLineNumbers: [] })
    }
  }
  const matchLineNumbers = new Set(hits.map(hit => hit.lineNumber))
  for (const block of blocks) {
    const endLine = block.startLine + block.lines.length - 1
    block.matchLineNumbers = [...matchLineNumbers]
      .filter(lineNumber => lineNumber >= block.startLine && lineNumber <= endLine)
      .sort((left, right) => left - right)
  }
  return blocks
}

function compactBlocks(
  blocks: Array<{ startLine: number; lines: string[]; matchLineNumbers: number[] }>,
  maxBlocks: number
) {
  return blocks.slice(0, maxBlocks).map(block => ({
    startLine: block.startLine,
    totalLines: block.lines.length,
    lines: block.lines.map(line => boundText(line, 160)),
    lineTextTruncated: block.lines.some(
      line => Buffer.byteLength(line, "utf8") > 160
    ),
    matchLineNumbers: block.matchLineNumbers
  }))
}

function compactHitGroup(hits: SearchHit[], maxBlocks: number) {
  const blocks = contextBlocks(hits)
  return {
    matchCount: hits.length,
    matchLineNumbers: hits.map(hit => hit.lineNumber),
    hitSamples: hits.slice(0, 5).map(hit => ({
      lineNumber: hit.lineNumber,
      line: boundText(hit.line, 160)
    })),
    contextBlocks: compactBlocks(blocks, maxBlocks),
    contextBlocksTruncated: blocks.length > maxBlocks
  }
}

function compactSearchResultEntry(value: unknown) {
  const result = record(value) ?? {}
  const matches = searchHits(result.matches)
  const enhancementGroups = new Map<string, {
    enhancementName: string
    enhancementType: string
    elementUri: string
    hits: SearchHit[]
  }>()
  if (Array.isArray(result.enhancementMatches)) {
    for (const item of result.enhancementMatches) {
      const enhancement = record(item)
      if (!enhancement ||
        typeof enhancement.elementUri !== "string" ||
        typeof enhancement.lineNumber !== "number" ||
        typeof enhancement.line !== "string") continue
      const key = enhancement.elementUri
      const group = enhancementGroups.get(key) ?? {
        enhancementName: typeof enhancement.enhancementName === "string"
          ? enhancement.enhancementName
          : "",
        enhancementType: typeof enhancement.enhancementType === "string"
          ? enhancement.enhancementType
          : "",
        elementUri: key,
        hits: []
      }
      group.hits.push(...searchHits([enhancement]))
      enhancementGroups.set(key, group)
    }
  }

  return {
    object: result.object,
    sourceUri: result.sourceUri,
    totalLines: result.totalLines,
    ...compactHitGroup(matches, 2),
    enhancements: [...enhancementGroups.values()].map(group => ({
      enhancementName: group.enhancementName,
      enhancementType: group.enhancementType,
      elementUri: group.elementUri,
      ...compactHitGroup(group.hits, 1)
    }))
  }
}

function withoutSearchContexts(summary: JsonRecord): JsonRecord {
  return {
    ...summary,
    summaryTruncated: true,
    results: Array.isArray(summary.results)
      ? summary.results.map(item => {
          const result = record(item) ?? {}
          return {
            ...result,
            hitSamples: Array.isArray(result.hitSamples) ? result.hitSamples.slice(0, 3) : [],
            contextBlocks: [],
            contextBlocksTruncated: true,
            enhancements: Array.isArray(result.enhancements)
              ? result.enhancements.map(value => {
                  const enhancement = record(value) ?? {}
                  return {
                    ...enhancement,
                    hitSamples: Array.isArray(enhancement.hitSamples)
                      ? enhancement.hitSamples.slice(0, 2)
                      : [],
                    contextBlocks: [],
                    contextBlocksTruncated: true
                  }
                })
              : []
          }
        })
      : []
  }
}

export function summarizeSearchObjectLinesResult(value: unknown): unknown {
  const source = record(value)
  if (!source) return summarizeDeferredResult(value)
  const summary: JsonRecord = {
    kind: "search_abap_object_lines",
    connectionId: source.connectionId,
    objectPattern: source.objectPattern,
    searchTerm: source.searchTerm,
    isRegexp: source.isRegexp,
    objectsSearched: source.objectsSearched,
    matchCount: source.matchCount,
    startIndex: source.startIndex,
    returnedMatches: source.returnedMatches,
    truncated: source.truncated,
    nextStartIndex: source.nextStartIndex,
    summaryTruncated: false,
    results: Array.isArray(source.results)
      ? source.results.map(compactSearchResultEntry)
      : []
  }
  if (
    Buffer.byteLength(JSON.stringify(summary), "utf8") <=
      SEARCH_RESULT_SUMMARY_BYTE_LIMIT
  ) {
    return summary
  }
  const bounded = withoutSearchContexts(summary)
  if (
    Buffer.byteLength(JSON.stringify(bounded), "utf8") <=
      SEARCH_RESULT_SUMMARY_BYTE_LIMIT
  ) {
    return bounded
  }
  return {
    kind: "search_abap_object_lines",
    connectionId: source.connectionId,
    objectPattern: source.objectPattern,
    searchTerm: source.searchTerm,
    matchCount: source.matchCount,
    returnedMatches: source.returnedMatches,
    truncated: source.truncated,
    nextStartIndex: source.nextStartIndex,
    summaryTruncated: true,
    results: Array.isArray(bounded.results)
      ? bounded.results.slice(0, 10).map(item => {
          const result = record(item) ?? {}
          const object = record(result.object)
          return {
            object: object
              ? { name: object.name, type: object.type, uri: object.uri }
              : result.object,
            sourceUri: result.sourceUri,
            totalLines: result.totalLines,
            matchCount: result.matchCount,
            matchLineNumbers: Array.isArray(result.matchLineNumbers)
              ? result.matchLineNumbers.slice(0, 100)
              : [],
            lineNumbersTruncated: Array.isArray(result.matchLineNumbers) &&
              result.matchLineNumbers.length > 100
          }
        })
      : []
  }
}

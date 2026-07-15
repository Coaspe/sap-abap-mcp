import assert from "node:assert/strict"
import test from "node:test"
import {
  DEFERRED_RESULT_SUMMARY_BYTE_LIMIT,
  SEARCH_RESULT_SUMMARY_BYTE_LIMIT,
  summarizeDeferredResult,
  summarizeSearchObjectLinesResult
} from "../src/result-summaries.js"

function searchResult(matchLines: number[], lineLength = 40) {
  const lines = Array.from(
    { length: Math.max(...matchLines) + 5 },
    (_, index) => `${index + 1} ${"X".repeat(lineLength)}`
  )
  return {
    connectionId: "DEV100",
    objectPattern: "ZCL_BANK",
    searchTerm: "BANK",
    isRegexp: false,
    objectsSearched: 1,
    matchCount: matchLines.length,
    startIndex: 0,
    returnedMatches: matchLines.length,
    truncated: false,
    nextStartIndex: null,
    results: [{
      object: {
        name: "ZCL_BANK",
        type: "CLAS/OC",
        uri: "/sap/bc/adt/oo/classes/zcl_bank"
      },
      sourceUri: "/sap/bc/adt/oo/classes/zcl_bank/source/main",
      totalLines: lines.length,
      matches: matchLines.map(lineNumber => ({
        lineNumber,
        line: lines[lineNumber - 1],
        context: lines
          .slice(Math.max(0, lineNumber - 4), lineNumber + 3)
          .map((text, index) => ({
            lineNumber: Math.max(1, lineNumber - 3) + index,
            text,
            isMatch: Math.max(1, lineNumber - 3) + index === lineNumber
          }))
      })),
      enhancementMatches: []
    }]
  }
}

test("generic deferred summaries stay bounded and preserve collection counts", () => {
  const value = {
    connectionId: "DEV100",
    findings: Array.from({ length: 500 }, (_, index) => ({
      line: index + 1,
      severity: index % 2 === 0 ? "error" : "warning",
      message: "M".repeat(500),
      details: { endpoint: "/sap/bc/adt/check", raw: "R".repeat(500) }
    }))
  }
  const summary = summarizeDeferredResult(value) as {
    collections: {
      findings: {
        count: number
        groupedBy: string
        counts: Record<string, number>
      }
    }
  }
  assert.ok(
    Buffer.byteLength(JSON.stringify(summary), "utf8") <=
      DEFERRED_RESULT_SUMMARY_BYTE_LIMIT
  )
  assert.equal(summary.collections.findings.count, 500)
  assert.equal(summary.collections.findings.groupedBy, "severity")
  assert.deepEqual(summary.collections.findings.counts, { error: 250, warning: 250 })
})

test("search summaries merge overlapping context without losing match locations", () => {
  const value = searchResult([10, 12])
  const summary = summarizeSearchObjectLinesResult(value) as {
    results: Array<{
      matchLineNumbers: number[]
      contextBlocks: Array<{
        startLine: number
        totalLines: number
        lines: string[]
        lineTextTruncated: boolean
        matchLineNumbers: number[]
      }>
    }>
  }
  const result = summary.results[0]!
  assert.deepEqual(result.matchLineNumbers, [10, 12])
  assert.equal(result.contextBlocks.length, 1)
  assert.deepEqual(result.contextBlocks[0]?.matchLineNumbers, [10, 12])
  assert.equal(result.contextBlocks[0]?.startLine, 7)
  assert.equal(result.contextBlocks[0]?.totalLines, 9)
  assert.equal(result.contextBlocks[0]?.lines.length, 9)
  assert.equal(result.contextBlocks[0]?.lineTextTruncated, false)
})

test("search summaries substantially reduce dense repeated contexts", () => {
  const value = searchResult(Array.from({ length: 50 }, (_, index) => index + 10), 120)
  const summary = summarizeSearchObjectLinesResult(value)
  const rawBytes = Buffer.byteLength(JSON.stringify(value), "utf8")
  const summaryBytes = Buffer.byteLength(JSON.stringify(summary), "utf8")
  assert.ok(summaryBytes <= SEARCH_RESULT_SUMMARY_BYTE_LIMIT)
  assert.ok(summaryBytes < rawBytes / 3)
})

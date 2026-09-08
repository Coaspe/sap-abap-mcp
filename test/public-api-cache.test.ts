import assert from "node:assert/strict"
import test from "node:test"
import { PublicApiCache } from "../src/public-api-cache.js"

const declaration = (code: string) => [{ code, startLine: 1, startColumn: 1, endLine: 1, endColumn: code.length + 1 }]

test("public API cache reuses exact source/name and cannot be poisoned through returned objects", () => {
  let calls = 0
  const cache = new PublicApiCache((source, name) => { calls++; return declaration(source + name.toUpperCase()) })
  const first = cache.read("source", "zcl_demo")
  first[0]!.code = "mutated"
  assert.equal(cache.read("source", "ZCL_DEMO")[0]!.code, "sourceZCL_DEMO")
  assert.equal(calls, 1)
  cache.read("changed", "ZCL_DEMO")
  cache.read("source", "LCL_OTHER")
  assert.equal(calls, 3)
  cache.clear()
  cache.read("source", "ZCL_DEMO")
  assert.equal(calls, 4)
})

test("public API cache bounds retention, skips oversized results and does not cache failures", () => {
  let calls = 0
  const cache = new PublicApiCache(source => { calls++; if (source === "bad") throw new Error("parse failed"); return declaration(source) })
  for (let i = 0; i < 33; i++) cache.read(String(i), "NAME")
  cache.read("0", "NAME")
  assert.equal(calls, 34)
  const large = "x".repeat(128 * 1024)
  cache.read(large, "NAME")
  cache.read(large, "NAME")
  assert.equal(calls, 36)
  assert.throws(() => cache.read("bad", "NAME"), /parse failed/)
  assert.throws(() => cache.read("bad", "NAME"), /parse failed/)
  assert.equal(calls, 38)
  // Byte budget must evict before the entry-count limit when results are larger.
  for (let i = 0; i < 12; i++) cache.read(String(i) + "y".repeat(100000), "NAME")
  const before = calls
  cache.read("0" + "y".repeat(100000), "NAME")
  assert.equal(calls, before + 1)
})

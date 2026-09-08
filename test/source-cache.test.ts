import assert from "node:assert/strict"
import test from "node:test"
import { createServer } from "node:http"
import { ADTClient, AdtErrorException, fromResponse } from "abap-adt-api"
import { SourceCache } from "../src/source-cache.js"

const uri = "/sap/bc/adt/programs/programs/z_demo/source/main"
const response = (body = "REPORT z_demo.", etag: string | null = '"v1"', status = 200) => ({
  body, status, statusText: "test", headers: etag ? { ETag: etag } : {}
})

test("real ADT HTTP transport normalizes 304 without losing cached source", async t => {
  const headers: Array<string | undefined> = []
  const server = createServer((request, reply) => {
    if (request.url?.startsWith("/sap/bc/adt/compatibility/graph")) {
      reply.setHeader("x-csrf-token", "test-token")
      reply.end("<graph/>")
      return
    }
    headers.push(request.headers["if-none-match"])
    reply.setHeader("ETag", '"real-v1"')
    if (request.headers["if-none-match"]) {
      reply.setHeader("Cache-Control", "no-store")
      reply.writeHead(304)
      reply.end()
    } else reply.end("REPORT real_http.")
  })
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve))
  t.after(() => new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve())
    server.closeAllConnections()
  }))
  const address = server.address()
  assert.ok(address && typeof address !== "string")
  const adt = new ADTClient(`http://127.0.0.1:${address.port}`, "test", "test")
  const cache = new SourceCache((path, options) => adt.httpClient.request(path, options))
  assert.equal(await cache.read(uri), "REPORT real_http.")
  assert.equal(await cache.read(uri), "REPORT real_http.")
  assert.equal(await cache.read(uri), "REPORT real_http.")
  assert.deepEqual(headers, [undefined, '"real-v1"', undefined])
})

test("source hits are revalidated and normalized ADT 304 exceptions reuse the body", async () => {
  const calls: unknown[] = []
  const cache = new SourceCache(async (_, options) => {
    calls.push(options)
    if (calls.length === 1) return response()
    throw fromResponse("", response("", null, 304))
  })
  assert.equal(await cache.read(uri), "REPORT z_demo.")
  assert.equal(await cache.read(uri), "REPORT z_demo.")
  assert.deepEqual(calls, [{}, { headers: { "If-None-Match": '"v1"' } }])
})

test("external changes replace cached content and validator", async () => {
  let call = 0
  const cache = new SourceCache(async (_, options) => {
    call += 1
    if (call === 1) return response()
    if (call === 2) {
      assert.equal(options.headers?.["If-None-Match"], '"v1"')
      return response("REPORT changed.", '"v2"')
    }
    assert.equal(options.headers?.["If-None-Match"], '"v2"')
    return response("", null, 304)
  })
  await cache.read(uri)
  assert.equal(await cache.read(uri), "REPORT changed.")
  assert.equal(await cache.read(uri), "REPORT changed.")
})

test("active, inactive and unspecified source versions have distinct validators", async () => {
  const cache = new SourceCache(async (_, options) => {
    const version = options.qs?.version ?? "unspecified"
    if (options.headers) {
      assert.equal(options.headers["If-None-Match"], `"${version}"`)
      return response("", null, 304)
    }
    return response(version, `"${version}"`)
  })
  for (const version of [undefined, "active", "inactive"] as const) {
    assert.equal(await cache.read(uri, version), version ?? "unspecified")
  }
  for (const version of [undefined, "active", "inactive"] as const) {
    assert.equal(await cache.read(uri, version), version ?? "unspecified")
  }
})

test("errors never serve stale source and evict the old validator", async () => {
  for (const status of [401, 403, 404, 410, 500]) {
    let call = 0
    const cache = new SourceCache(async (_, options) => {
      call += 1
      if (call === 2) throw fromResponse("", response("", undefined, status))
      assert.equal(options.headers, undefined)
      return response()
    })
    await cache.read(uri)
    await assert.rejects(cache.read(uri))
    await cache.read(uri)
  }
})

test("no validator, no-store, invalid validators and oversized sources are not retained", async () => {
  for (const value of [
    response("source", null),
    { ...response(), headers: { etag: '"v1"', "Cache-Control": "private, no-store" } },
    response("source", 'bad\r\nheader'),
    response("x".repeat(512 * 1024 + 1))
  ]) {
    const cache = new SourceCache(async (_, options) => {
      assert.equal(options.headers, undefined)
      return value
    })
    await cache.read(uri)
    await cache.read(uri)
  }
})

test("clear invalidates validators and an in-flight 304 cannot return pre-mutation source", async () => {
  let finish!: (value: ReturnType<typeof response>) => void
  let call = 0
  const cache = new SourceCache(async (_, options) => {
    call += 1
    if (call === 2) return new Promise(resolve => { finish = resolve })
    assert.equal(options.headers, undefined)
    return response()
  })
  await cache.read(uri)
  const pending = cache.read(uri)
  cache.clear()
  finish(response("", null, 304))
  await assert.rejects(pending, { code: "SOURCE_CHANGED" })
  await cache.read(uri)
})

test("entry and byte budgets evict old sources without changing returned content", async () => {
  for (const body of ["small", "x".repeat(512 * 1024)]) {
    let hadValidator = false
    const cache = new SourceCache(async (_, options) => {
      hadValidator = Boolean(options.headers)
      return response(body)
    })
    for (let index = 0; index < 65; index += 1) {
      assert.equal(await cache.read(`${uri}?object=${index}`), body)
    }
    await cache.read(`${uri}?object=0`)
    assert.equal(hadValidator, false)
    await cache.read(`${uri}?object=64`)
    assert.equal(hadValidator, true)
  }
})

test("separate connections cannot reuse source cached by another principal", async () => {
  const first = new SourceCache(async () => response("first user's source"))
  const second = new SourceCache(async (_, options) => {
    assert.equal(options.headers, undefined)
    return response("second user's source")
  })
  await first.read(uri)
  assert.equal(await second.read(uri), "second user's source")
})

test("source cache isolates content-negotiated representations at the same URI", async () => {
  const seen: unknown[] = []
  const cache = new SourceCache(async (_, options) => {
    seen.push(options.headers)
    const accept = options.headers?.Accept
    if (options.headers?.["If-None-Match"]) return response("", null, 304)
    return response(accept === "application/xml" ? "<docu/>" : "REPORT plain.",
      accept === "application/xml" ? '"xml"' : '"plain"')
  })
  assert.equal(await cache.read(uri, "active"), "REPORT plain.")
  assert.equal(await cache.read(uri, "active", "application/xml"), "<docu/>")
  assert.equal(await cache.read(uri, "active"), "REPORT plain.")
  assert.equal(await cache.read(uri, "active", "application/xml"), "<docu/>")
  assert.deepEqual(seen, [undefined, { Accept: "application/xml" },
    { "If-None-Match": '"plain"' }, { Accept: "application/xml", "If-None-Match": '"xml"' }])
})

test("304 policy updates evict stored bodies for direct and normalized ADT responses", async () => {
  for (const policy of [{ "Cache-Control": "private, no-store" }, { Vary: "Accept, *" }]) {
    for (const mode of ["direct", "retained-headers", "stripped-headers"]) {
      let calls = 0
      const cache = new SourceCache(async (_, options) => {
        calls++
        if (calls === 2) {
          const validated = { ...response("", '"v1"', 304), headers: { ETag: '"v1"', ...policy } }
          if (mode === "retained-headers") throw AdtErrorException.create(validated, {})
          if (mode === "stripped-headers") throw fromResponse("", validated)
          return validated
        }
        assert.equal(options.headers, undefined)
        return response()
      })
      await cache.read(uri)
      assert.equal(await cache.read(uri), "REPORT z_demo.")
      await cache.read(uri)
    }
  }
})

test("304 mismatched validators reject old content and weak-equivalent validators remain usable", async () => {
  let calls = 0
  const cache = new SourceCache(async (_, options) => {
    calls++
    if (calls === 2) return response("", 'W/"v1"', 304)
    if (calls === 3) {
      assert.equal(options.headers?.["If-None-Match"], 'W/"v1"')
      return response("", '"different"', 304)
    }
    assert.equal(options.headers, undefined)
    return response()
  })
  await cache.read(uri)
  assert.equal(await cache.read(uri), "REPORT z_demo.")
  await assert.rejects(cache.read(uri), { code: "SOURCE_CHANGED" })
  await cache.read(uri)
})

test("simultaneous identical source reads share one SAP request but later reads revalidate", async () => {
  let finish!: (value: ReturnType<typeof response>) => void
  let calls = 0
  const cache = new SourceCache(async (_, options) => {
    calls++
    if (calls === 1) return new Promise<ReturnType<typeof response>>(resolve => { finish = resolve })
    assert.equal(options.headers?.["If-None-Match"], '"v1"')
    return response("", '"v1"', 304)
  })
  const reads = Array.from({ length: 8 }, () => cache.read(uri, "active"))
  assert.equal(calls, 1)
  finish(response())
  assert.deepEqual(await Promise.all(reads), Array(8).fill("REPORT z_demo."))
  assert.equal(await cache.read(uri, "active"), "REPORT z_demo.")
  assert.equal(calls, 2)
})

test("collapsed reads forward non-storable responses separately and isolate variants", async () => {
  for (const policy of [{ "Cache-Control": "no-store" }, { Vary: "*" }]) {
    let finish!: () => void
    let calls = 0
    const gate = new Promise<void>(resolve => { finish = resolve })
    const cache = new SourceCache(async () => {
      calls++
      await gate
      return { ...response(), headers: { ETag: '"v1"', ...policy } }
    })
    const first = cache.read(uri)
    const second = cache.read(uri)
    assert.equal(calls, 1)
    finish()
    await Promise.all([first, second])
    assert.equal(calls, 2)
  }
  let calls = 0
  const cache = new SourceCache(async () => { calls++; return response() })
  await Promise.all([cache.read(uri, "active"), cache.read(uri, "inactive"), cache.read(uri, "active", "text/plain")])
  assert.equal(calls, 3)
})

test("old failed reads cannot evict a post-mutation validator and all waiters see the failure", async () => {
  let fail!: (error: Error) => void
  let calls = 0
  const failure = new Error("old request failed")
  const cache = new SourceCache(async (_, options) => {
    calls++
    if (calls === 1) return new Promise<ReturnType<typeof response>>((_, reject) => { fail = reject })
    if (calls === 2) return response("REPORT new.", '"v2"')
    assert.equal(options.headers?.["If-None-Match"], '"v2"')
    return response("", '"v2"', 304)
  })
  const first = assert.rejects(cache.read(uri), error => error === failure)
  const waiter = assert.rejects(cache.read(uri), error => error === failure)
  cache.clear()
  assert.equal(await cache.read(uri), "REPORT new.")
  fail(failure)
  await Promise.all([first, waiter])
  assert.equal(await cache.read(uri), "REPORT new.")
  assert.equal(calls, 3)
})

test("invalidation between transport completion and shared-result delivery rejects the source", async () => {
  let finish!: (value: ReturnType<typeof response>) => void
  const cache = new SourceCache(() => new Promise<ReturnType<typeof response>>(resolve => { finish = resolve }))
  const read = cache.read(uri)
  const rejected = assert.rejects(read, { code: "SOURCE_CHANGED" })
  finish(response())
  queueMicrotask(() => cache.clear())
  await rejected
})

test("non-storable follower rechecks invalidation after its separate request completes", async () => {
  const finish: Array<(value: ReturnType<typeof response>) => void> = []
  const cache = new SourceCache(() => new Promise<ReturnType<typeof response>>(resolve => { finish.push(resolve) }))
  const first = cache.read(uri)
  const follower = cache.read(uri)
  const rejected = assert.rejects(follower, { code: "SOURCE_CHANGED" })
  finish[0]!(response("uncached", null))
  assert.equal(await first, "uncached")
  assert.equal(finish.length, 2)
  finish[1]!(response("uncached", null))
  queueMicrotask(() => cache.clear())
  await rejected
})

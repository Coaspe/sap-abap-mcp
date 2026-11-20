import assert from "node:assert/strict"
import test from "node:test"
import { discoverAdtBackground, parseHttpResult, runAdtBackground } from "../src/adt-background.js"
import type { HttpClientResponse, RequestOptions } from "abap-adt-api/build/AdtHTTP.js"

const response = (body = "", status = 200, headers = {}): HttpClientResponse => ({ body, status, statusText: "OK", headers })
const statusXml = (status: string, href = "/sap/bc/adt/communication/bgruns/runs/1/result") => `<runs:run xmlns:runs="http://www.sap.com/adt/runs" xmlns:atom="http://www.w3.org/2005/Atom" runs:status="${status}"><atom:link href="${href}" rel="http://www.sap.com/adt/relations/runs/result" type="application/http"/></runs:run>`

test("core discovery selects only the unambiguous application/http background collection", async () => {
  const service = (collections: string) => `<s:service xmlns:s="http://www.w3.org/2007/app" xmlns:a="http://www.w3.org/2005/Atom"><s:workspace>${collections}</s:workspace></s:service>`
  const collection = (uri: string, term = "backgroundruns", accept = "application/http") => `<s:collection href="${uri}"><a:category scheme="http://www.sap.com/adt/categories/system/communication/services" term="${term}"/><s:accept>${accept}</s:accept></s:collection>`
  const advertised = "/sap/bc/adt/communication/bgruns/runs"
  const discover = (body: string) => discoverAdtBackground(async (path, request) => {
    assert.equal(path, "/sap/bc/adt/core/discovery")
    assert.deepEqual(request, { method: "GET" })
    return response(body)
  }, "https://sap.example.test")
  assert.equal(await discover(service(collection("/sap/bc/adt/other", "different") + collection(advertised))), advertised)
  assert.equal(await discover(service(collection(advertised, "backgroundruns", "application/xml"))), undefined)
  for (const body of ["<broken>", service(collection(advertised) + collection("/sap/bc/adt/other")), service(collection("https://other.example.test/sap/bc/adt/runs"))]) {
    await assert.rejects(discover(body), { code: "ADT_BACKGROUND_INVALID" })
  }
})

test("advertised collection bounds relative run locations and rejects an unrelated result", async () => {
  const collection = "/sap/bc/adt/communication/alternate/runs"
  for (const unrelated of [false, true]) {
    const calls: string[] = []
    const run = runAdtBackground(async (uri, options) => {
      calls.push(`${options.method} ${uri}`)
      if (options.method === "POST") return response("", 202, { location: "123" })
      if (options.method === "DELETE") return response()
      if (uri.endsWith("/result")) return response("HTTP/1.1 200 OK\r\n\r\n<ok/>")
      return response(statusXml("finished", unrelated ? `${collection}/456/result` : "result"))
    }, "https://sap.example.test", "/sap/bc/adt/cts/sample", { method: "GET" }, undefined, collection)
    if (unrelated) await assert.rejects(run, { code: "ADT_BACKGROUND_INVALID" })
    else assert.equal((await run).body, "<ok/>")
    assert.deepEqual(calls, [`POST ${collection}`, `GET ${collection}/123`, ...(!unrelated ? [`GET ${collection}/123/result`] : []), `DELETE ${collection}/123`])
  }
})

test("ADT background runs encapsulate the mutation once, poll and read the HTTP result", async () => {
  const requests: Array<{ uri: string; options: RequestOptions }> = []
  let polls = 0
  const result = await runAdtBackground(async (uri, options) => {
    requests.push({ uri, options })
    if (options.method === "POST") return response("", 202, { location: "/sap/bc/adt/communication/bgruns/runs/1" })
    if (options.method === "DELETE") return response()
    if (uri.endsWith("/result")) return response("HTTP/1.1 200 OK\r\nContent-Type: application/xml\r\n\r\n<released/>")
    return response(++polls === 1 ? statusXml("running") : statusXml("finished", "result"))
  }, "https://sap.example.test", "/sap/bc/adt/cts/transportrequests/DEVK900123/newreleasejobs", { method: "POST", headers: { Accept: "application/xml" } }, { timeoutMs: 500, pollMs: 1 })
  assert.equal(result.body, "<released/>")
  assert.equal(requests.filter(item => item.options.method === "POST").length, 1)
  assert.equal(requests[0]?.uri, "/sap/bc/adt/communication/bgruns/runs")
  assert.equal(requests[0]?.options.headers?.["Content-Type"], "application/http")
  assert.match(requests[0]?.options.body ?? "", /^POST \/sap\/bc\/adt\/cts\/transportrequests\/DEVK900123\/newreleasejobs HTTP\/1.1\r\n/)
  assert.equal(requests.at(-1)?.options.method, "DELETE")
})

test("failed, malformed, foreign and timed-out background runs never resubmit a mutation", async () => {
  for (const scenario of ["failed", "foreign-location", "foreign-result", "missing-location", "unknown", "timeout", "http-error"]) {
    const calls: string[] = []
    await assert.rejects(runAdtBackground(async (uri, options) => {
      calls.push(`${options.method} ${uri}`)
      if (options.method === "POST") return response("", 202, scenario === "missing-location" ? {} : { location: scenario === "foreign-location" ? "https://other.example.test/run" : "/sap/bc/adt/communication/bgruns/runs/1" })
      if (options.method === "DELETE") return response()
      if (uri.endsWith("/result")) return response("HTTP/1.1 500 Error\r\nContent-Type: application/xml\r\n\r\n<failed/>")
      return response(statusXml(scenario === "timeout" ? "running" : scenario === "failed" ? "failed" : scenario === "unknown" ? "unexpected" : "finished", scenario === "foreign-result" ? "https://other.example.test/result" : "/sap/bc/adt/communication/bgruns/runs/1/result"))
    }, "https://sap.example.test", "/sap/bc/adt/cts/transportrequests/DEVK900123/newreleasejobs", { method: "POST" }, { timeoutMs: 10, pollMs: 1 }))
    assert.equal(calls.filter(item => item.startsWith("POST ")).length, 1, scenario)
    assert.ok(calls.every(item => !item.includes("other.example.test")), scenario)
    if (scenario === "timeout") assert.ok(calls.every(item => !item.startsWith("DELETE")), "Pending run retained for inspection")
  }
})

test("encapsulated HTTP results preserve headers and reject HTTP failures or invalid bodies", () => {
  assert.deepEqual(parseHttpResult("HTTP/1.1 201 Created\r\nContent-Type: application/xml\r\n\r\n<ok/>"), { body: "<ok/>", status: 201, statusText: "Created", headers: { "content-type": "application/xml" } })
  assert.throws(() => parseHttpResult("<ok/>"), /invalid encapsulated/)
  assert.throws(() => parseHttpResult("HTTP/1.1 500 Error\r\n\r\n<failed/>"), /unsuccessful HTTP/)
})

test("background release identifies which layer returned a 404 without retrying", async () => {
  for (const phase of ["submission", "polling", "result_fetch", "operation_result"]) {
    let submissions = 0
    const missing = Object.assign(new Error("Not found"), { status: 404 })
    await assert.rejects(runAdtBackground(async (uri, options) => {
      if (options.method === "POST") {
        submissions++
        if (phase === "submission") throw missing
        return response("", 202, { location: "/sap/bc/adt/communication/bgruns/runs/1" })
      }
      if (options.method === "DELETE") return response()
      if (uri.endsWith("/result")) {
        if (phase === "result_fetch") throw missing
        return response("HTTP/1.1 404 Not Found\r\n\r\n<error/>")
      }
      if (phase === "polling") throw missing
      return response(statusXml("finished"))
    }, "https://sap.example.test", "/sap/bc/adt/cts/transportrequests/DEVK900123/newreleasejobs", { method: "POST" }), {
      details: phase === "operation_result" ? { backgroundPhase: phase, httpStatus: 404, sapResponseText: "<error/>" } : { backgroundPhase: phase, httpStatus: 404 }
    })
    assert.equal(submissions, 1)
  }
})

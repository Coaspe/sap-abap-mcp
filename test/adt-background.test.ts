import assert from "node:assert/strict"
import test from "node:test"
import { parseHttpResult, runAdtBackground } from "../src/adt-background.js"
import type { HttpClientResponse, RequestOptions } from "abap-adt-api/build/AdtHTTP.js"

const response = (body = "", status = 200, headers = {}): HttpClientResponse => ({ body, status, statusText: "OK", headers })
const statusXml = (status: string, href = "/sap/bc/adt/communication/bgruns/1/result") => `<runs:run xmlns:runs="http://www.sap.com/adt/runs" xmlns:atom="http://www.w3.org/2005/Atom" runs:status="${status}"><atom:link href="${href}" rel="http://www.sap.com/adt/relations/runs/result" type="application/http"/></runs:run>`

test("ADT background runs encapsulate the mutation once, poll and read the HTTP result", async () => {
  const requests: Array<{ uri: string; options: RequestOptions }> = []
  let polls = 0
  const result = await runAdtBackground(async (uri, options) => {
    requests.push({ uri, options })
    if (options.method === "POST") return response("", 202, { location: "/sap/bc/adt/communication/bgruns/1" })
    if (options.method === "DELETE") return response()
    if (uri.endsWith("/result")) return response("HTTP/1.1 200 OK\r\nContent-Type: application/xml\r\n\r\n<released/>")
    return response(++polls === 1 ? statusXml("running") : statusXml("finished", "result"))
  }, "https://sap.example.test", "/sap/bc/adt/cts/transportrequests/DEVK900123/newreleasejobs", { method: "POST", headers: { Accept: "application/xml" } }, { timeoutMs: 500, pollMs: 1 })
  assert.equal(result.body, "<released/>")
  assert.equal(requests.filter(item => item.options.method === "POST").length, 1)
  assert.equal(requests[0]?.uri, "/sap/bc/adt/communication/bgruns")
  assert.equal(requests[0]?.options.headers?.["Content-Type"], "application/http")
  assert.match(requests[0]?.options.body ?? "", /^POST \/sap\/bc\/adt\/cts\/transportrequests\/DEVK900123\/newreleasejobs HTTP\/1.1\r\n/)
  assert.equal(requests.at(-1)?.options.method, "DELETE")
})

test("failed, malformed, foreign and timed-out background runs never resubmit a mutation", async () => {
  for (const scenario of ["failed", "foreign-location", "foreign-result", "missing-location", "unknown", "timeout", "http-error"]) {
    const calls: string[] = []
    await assert.rejects(runAdtBackground(async (uri, options) => {
      calls.push(`${options.method} ${uri}`)
      if (options.method === "POST") return response("", 202, scenario === "missing-location" ? {} : { location: scenario === "foreign-location" ? "https://other.example.test/run" : "/sap/bc/adt/communication/bgruns/1" })
      if (options.method === "DELETE") return response()
      if (uri.endsWith("/result")) return response("HTTP/1.1 500 Error\r\nContent-Type: application/xml\r\n\r\n<failed/>")
      return response(statusXml(scenario === "timeout" ? "running" : scenario === "failed" ? "failed" : scenario === "unknown" ? "unexpected" : "finished", scenario === "foreign-result" ? "https://other.example.test/result" : "/sap/bc/adt/communication/bgruns/1/result"))
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

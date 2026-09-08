import assert from "node:assert/strict"
import { once } from "node:events"
import { createServer } from "node:http"
import test from "node:test"
import { createDestinationTransportFactory } from "../src/destination-transport.js"

test("real SAP SDK preserves raw ADT requests and destination authentication", async t => {
  const seen: Array<{ url: string; headers: import("node:http").IncomingHttpHeaders; body: string }> = []
  const server = createServer(async (request, response) => {
    let body = ""
    for await (const chunk of request) body += chunk
    seen.push({ url: request.url!, headers: request.headers, body })
    if (request.url?.includes("/disconnect")) {
      response.destroy()
      return
    }
    response.setHeader("set-cookie", ["SESSION=one; Path=/", "OTHER=two; Path=/"])
    response.setHeader("x-csrf-token", "fixture-csrf")
    response.setHeader("etag", '"v1"')
    if (request.url?.includes("/not-modified")) {
      response.statusCode = 304
      response.setHeader("cache-control", "no-store")
      response.end()
    } else if (request.url?.includes("/failure")) {
      response.statusCode = 403
      response.end("<error>fixture denial</error>")
    } else if (request.url?.includes("/redirect")) {
      response.statusCode = 302
      response.setHeader("location", "/sap/followed")
      response.end()
    } else {
      response.setHeader("content-type", "application/json")
      response.end('{"raw":"한글"}')
    }
  })
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  t.after(() => new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve())
    server.closeAllConnections()
  }))
  const address = server.address()
  assert.ok(address && typeof address !== "string")
  const factory = await createDestinationTransportFactory({
    url: `http://127.0.0.1:${address.port}`, authentication: "BasicAuthentication",
    username: "destination-user", password: "destination-password", proxyType: "Internet"
  })
  const transport = factory()
  const result = await transport.request({
    url: "/sap/bc/adt/oo/classes/%2FTEST%2FCL/source/main", method: "POST",
    body: "<source>한글 &amp; XML</source>", qs: { uri: "/source#start=2,3", enabled: false },
    auth: { username: "wrong-user", password: "wrong-password" },
    baseURL: "https://unused.invalid", httpsAgent: {} as import("node:https").Agent,
    headers: {
      AUTHORIZATION: "Bearer wrong-token", "Proxy-Authorization": "wrong-proxy",
      "SAP-Connectivity-Authentication": "wrong-identity", Host: "unused.invalid",
      "SAP-Connectivity-SCC-Location_ID": "wrong-location",
      Cookie: "ADT_COOKIE=session", "x-csrf-token": "adt-csrf", "content-type": "application/xml"
    }
  })
  assert.equal(result.body, '{"raw":"한글"}')
  assert.deepEqual(result.headers["set-cookie"], ["SESSION=one; Path=/", "OTHER=two; Path=/"])
  assert.equal(result.headers["x-csrf-token"], "fixture-csrf")
  assert.equal(seen.length, 1, "ADT must own CSRF, without an extra SDK fetch")
  const request = seen[0]!
  assert.equal(request.body, "<source>한글 &amp; XML</source>")
  assert.equal(request.headers.authorization, `Basic ${Buffer.from("destination-user:destination-password").toString("base64")}`)
  assert.equal(request.headers["proxy-authorization"], undefined)
  assert.equal(request.headers["sap-connectivity-authentication"], undefined)
  assert.equal(request.headers["sap-connectivity-scc-location_id"], undefined)
  assert.equal(request.headers.cookie, "ADT_COOKIE=session")
  assert.equal(request.headers["x-csrf-token"], "adt-csrf")
  const url = new URL(request.url, "http://localhost")
  assert.equal(url.pathname, "/sap/bc/adt/oo/classes/%2FTEST%2FCL/source/main")
  assert.equal(url.searchParams.get("uri"), "/source#start=2,3")
  assert.equal(url.searchParams.get("enabled"), "false")
  const unchanged = await transport.request({ url: "/sap/not-modified", headers: { "If-None-Match": '"v1"' } })
  assert.equal(unchanged.status, 304)
  assert.equal(unchanged.headers["cache-control"], "no-store")
  const failure = await transport.request({ url: "/sap/failure" })
  assert.equal(failure.status, 403)
  assert.equal(failure.body, "<error>fixture denial</error>")
  await assert.rejects(transport.request({ url: "/sap/redirect" }), /redirects are not allowed/)
  assert.equal(seen.some(request => request.url === "/sap/followed"), false)
  const beforeInvalid = seen.length
  for (const path of ["https://elsewhere.test/sap", "//elsewhere.test/sap", "/sap/../admin", "/sap/%2e%2e/admin", "/sap/a%2f..%2fadmin", "/sap/\\elsewhere", "/sap/%5c..%5cadmin", "/sap/%ZZ"]) {
    await assert.rejects(transport.request({ url: path }), /relative SAP path/)
  }
  assert.equal(seen.length, beforeInvalid)
  const proxyTransport = (await createDestinationTransportFactory({
    url: "http://virtual-sap.invalid:8000", authentication: "PrincipalPropagation", proxyType: "OnPremise",
    proxyConfiguration: { host: "127.0.0.1", port: address.port, protocol: "http", headers: {
      "Proxy-Authorization": "Bearer fixture-proxy", "SAP-Connectivity-Authentication": "Bearer fixture-user"
    } }
  }))()
  await proxyTransport.request({ url: "/sap/proxy", timeout: 1000, headers: {
    "Proxy-Authorization": "wrong-proxy", "SAP-Connectivity-Authentication": "wrong-user"
  } })
  const proxyRequest = seen.at(-1)!
  assert.equal(proxyRequest.headers["proxy-authorization"], "Bearer fixture-proxy")
  assert.equal(proxyRequest.headers["sap-connectivity-authentication"], "Bearer fixture-user")
  assert.equal(proxyRequest.headers.host, "virtual-sap.invalid:8000")
  await assert.rejects(transport.request({ url: "/sap/disconnect" }), error => {
    assert.ok(error instanceof Error)
    assert.equal(error.message, "SAP Destination request failed before receiving an HTTP response")
    assert.doesNotMatch(JSON.stringify(error), /destination-password|destination-user|Authorization|axios|socket hang up/i)
    return true
  })
})

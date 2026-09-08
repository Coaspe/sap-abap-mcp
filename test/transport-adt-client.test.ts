import assert from "node:assert/strict"
import { createServer } from "node:http"
import { once } from "node:events"
import test from "node:test"
import { session_types, type HttpClient } from "abap-adt-api"
import { AdtSapClient } from "../src/sap-client.js"
import { TransportAdtClient, type AdtTransportFactory } from "../src/transport-adt-client.js"

test("custom ADT transport preserves source, navigation, cookies and CSRF across independent sessions", async t => {
  const requests: Array<{ path: string; cookie: string; csrf: string; body: string }> = []
  let sessions = 0
  const server = createServer(async (request, response) => {
    const url = new URL(request.url!, "http://localhost")
    let body = ""
    for await (const chunk of request) body += chunk
    const cookie = String(request.headers.cookie ?? "")
    const csrf = String(request.headers["x-csrf-token"] ?? "")
    requests.push({ path: url.pathname, cookie, csrf, body })
    if (url.pathname.endsWith("/compatibility/graph")) {
      assert.equal(url.searchParams.get("sap-client"), "100")
      assert.equal(url.searchParams.get("sap-language"), "EN")
      const session = ++sessions
      response.setHeader("set-cookie", [`SAP_SESSIONID_TEST=${session}; Path=/; HttpOnly`])
      response.setHeader("x-csrf-token", `csrf-${session}`)
      response.end("<graph/>")
      return
    }
    assert.match(cookie, /^SAP_SESSIONID_TEST=\d+$/)
    assert.equal(csrf, `csrf-${cookie.split("=")[1]}`)
    if (url.pathname.endsWith("/navigation/target")) {
      assert.equal(request.method, "POST")
      assert.equal(url.searchParams.get("uri"), "/sap/bc/adt/oo/classes/%2FTEST%2FCL/includes/main#start=2,3;end=2,6")
      assert.equal(body, "DATA lv_text TYPE string.")
      response.end('<adtcore:objectReference xmlns:adtcore="http://www.sap.com/adt/core" adtcore:uri="/target#start=4,5"/>')
    } else if (url.pathname.endsWith("/source/main")) {
      response.setHeader("etag", '"fixture-v1"')
      if (request.headers["if-none-match"] === '"fixture-v1"') response.statusCode = 304
      response.end(response.statusCode === 304 ? undefined : "REPORT ztest.\nWRITE '한글'.")
    } else {
      assert.equal(url.pathname, "/sap/public/bc/icf/logoff")
      response.end("")
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
  let transports = 0
  const transport: AdtTransportFactory = () => {
    transports++
    return {
      async request(options: Parameters<HttpClient["request"]>[0]) {
        const url = new URL(options.url, `http://127.0.0.1:${address.port}`)
        for (const [key, value] of Object.entries(options.qs ?? {})) url.searchParams.set(key, String(value))
        const result = await fetch(url, {
          method: options.method ?? "GET",
          headers: options.headers ?? {},
          ...(options.body === undefined ? {} : { body: options.body })
        })
        return {
          status: result.status, statusText: result.statusText, body: await result.text(),
          headers: { ...Object.fromEntries(result.headers), "set-cookie": result.headers.getSetCookie() }
        }
      }
    }
  }
  const client = new AdtSapClient({
    id: "fixture", url: "https://unused.invalid", client: "100", language: "EN",
    authType: "basic", username: "TEST", environment: "development", allowedPackages: []
  }, "fixture-only", transport)
  await client.login()
  const first = await client.readSourceByUri("/sap/bc/adt/programs/programs/ztest/source/main")
  const repeated = await client.readSourceByUri("/sap/bc/adt/programs/programs/ztest/source/main")
  assert.equal(first.source, "REPORT ztest.\nWRITE '한글'.")
  assert.equal(repeated.source, first.source)
  assert.deepEqual(await client.findDefinition(
    "/sap/bc/adt/oo/classes/%2FTEST%2FCL/includes/main", "DATA lv_text TYPE string.", 2, 3, 6
  ), { url: "/target", line: 4, column: 5 })
  assert.equal(transports, 2)
  assert.equal(sessions, 2)
  const sourceRequest = requests.find(request => request.path.endsWith("/source/main"))!
  const navigationRequest = requests.find(request => request.path.endsWith("/navigation/target"))!
  assert.notEqual(sourceRequest.cookie, navigationRequest.cookie)
  await client.logout()
  assert.deepEqual(requests.filter(request => request.path.endsWith("/logoff")).map(request => request.cookie).sort(),
    [sourceRequest.cookie, navigationRequest.cookie].sort())
})

test("custom transport clones stay stateless and both sessions log out if one logout fails", async () => {
  const logouts: number[] = []
  let transports = 0
  const client = new TransportAdtClient(() => {
    const id = ++transports
    return { async request(options) {
      if (options.url.endsWith("/logoff")) {
        logouts.push(id)
        if (id === 1) throw new Error("fixture logoff failure")
      }
      return { body: "", status: 200, statusText: "OK", headers: { "x-csrf-token": `csrf-${id}` } }
    } }
  }, "TEST", "fixture-only")
  const clone = client.statelessClone
  assert.equal(client.statelessClone, clone)
  assert.equal(clone.statelessClone, clone)
  assert.throws(() => { clone.stateful = session_types.stateful }, /Stateful sessions not allowed/)
  client.stateful = session_types.stateful
  assert.equal(clone.stateful, session_types.stateless)
  await Promise.all([client.login(), clone.login()])
  await assert.rejects(client.logout(), /fixture logoff failure/)
  assert.deepEqual(logouts.sort(), [1, 2])
  assert.equal(clone.loggedin, false)
})

test("debug listener and execution retain the custom bearer transport with separate sessions", async t => {
  const requests: Array<{ id: number; options: Parameters<HttpClient["request"]>[0] }> = []
  let transports = 0
  const client = new AdtSapClient({
    id: "fixture", url: "https://unused.invalid", client: "100", language: "EN",
    authType: "bearer_passthrough", environment: "development", allowedPackages: []
  }, { type: "bearer", fetchToken: async () => "fixture-user-token" }, () => {
    const id = ++transports
    return { async request(options) {
      requests.push({ id, options })
      let body = "<graph/>"
      if (options.url.endsWith("/listeners") && options.method === "POST") {
        body = '<abap><values><DATA><STPDA_DEBUGGEE><CLIENT>100</CLIENT><DEBUGGEE_ID>fixture</DEBUGGEE_ID><TERMINAL_ID>T</TERMINAL_ID><IDE_ID>I</IDE_ID><DEBUGGEE_USER>TEST</DEBUGGEE_USER><URI>/source#start=1,0</URI></STPDA_DEBUGGEE></DATA></values></abap>'
      } else if (options.qs?.method === "attach") {
        body = "<attach/>"
      }
      return { status: 200, statusText: "OK", body, headers: {
        "x-csrf-token": `csrf-${id}`, "set-cookie": [`SAP_SESSIONID_TEST=${id}; Path=/`]
      } }
    } }
  })
  t.after(() => client.logout())
  await client.login()
  await client.startDebugSession("TEST")
  for (let attempt = 0; attempt < 50 && client.getDebugStatus().state === "listening"; attempt++) {
    await new Promise<void>(resolve => setImmediate(resolve))
  }
  assert.equal(client.getDebugStatus().state, "paused", JSON.stringify(client.getDebugStatus()))
  assert.equal(transports, 3)
  const listener = requests.find(request => request.options.url.endsWith("/listeners"))!
  const attach = requests.find(request => request.options.qs?.method === "attach")!
  assert.notEqual(listener.id, attach.id)
  assert.equal(listener.options.headers?.["X-sap-adt-sessiontype"], "stateless")
  assert.equal(attach.options.headers?.["X-sap-adt-sessiontype"], "stateful")
  assert.equal(attach.options.headers?.Cookie, `SAP_SESSIONID_TEST=${attach.id}`)
  for (const request of requests) assert.equal(request.options.headers?.Authorization, "bearer fixture-user-token")
})

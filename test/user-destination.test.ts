import assert from "node:assert/strict"
import test from "node:test"
import { createServer } from "node:http"
import { once } from "node:events"
import { alwaysSubscriber, type Destination } from "@sap-cloud-sdk/connectivity"
import { AppError } from "../src/errors.js"
import { createUserDestinationTransportFactory, resolveUserDestination, type UserDestinationRequest } from "../src/user-destination.js"

const request: UserDestinationRequest = {
  destinationName: "SAP_DEV", expectedUrl: "https://sap.example.test", sapClient: "100",
  authentication: "OAuth2UserTokenExchange", userJwt: "fixture-user-token"
}
function destination(): Destination {
  return { url: request.expectedUrl, authentication: request.authentication, sapClient: "100", authTokens: [{
    type: "Bearer", value: "fixture-exchanged", error: null, expiresIn: "300",
    http_header: { key: "Authorization", value: "Bearer fixture-exchanged" }
  }] }
}
function sdk(value: Destination | null) {
  return { alwaysSubscriber, getDestinationFromDestinationService: async () => value }
}
const hasCode = (code: string) => (error: unknown) => error instanceof AppError && error.code === code

test("user destinations use service-only subscriber lookup without cross-call caching", async () => {
  const calls: Array<{ jwt?: string; useCache?: boolean }> = []
  const injected = { alwaysSubscriber, getDestinationFromDestinationService: async (options: Parameters<typeof import("@sap-cloud-sdk/connectivity").getDestinationFromDestinationService>[0]) => {
    assert.equal(options.destinationName, "SAP_DEV")
    assert.equal(options.selectionStrategy, alwaysSubscriber)
    calls.push(options)
    return destination()
  } }
  await resolveUserDestination(request, injected)
  await resolveUserDestination({ ...request, userJwt: "second-user-token" }, injected)
  await resolveUserDestination(request, injected)
  assert.deepEqual(calls.map(call => [call.jwt, call.useCache]), [
    ["fixture-user-token", false], ["second-user-token", false], ["fixture-user-token", false]
  ])
})

test("destination validation rejects endpoint and user-authentication policy mismatches", async () => {
  const mismatches: Partial<Destination>[] = [
    { url: "https://other.example.test" }, { url: "http://sap.example.test" },
    { url: "https://user:secret@sap.example.test" }, { url: "https://sap.example.test?secret=value" },
    { authentication: "BasicAuthentication" }, { authentication: "OAuth2ClientCredentials" },
    { sapClient: "200" }, { proxyType: "OnPremise" }, { isTrustingAllCertificates: true },
    { forwardAuthToken: true }, { headers: { AUTHORIZATION: "technical-user" } },
    { queryParameters: { "sap-client": "200" } },
    { originalProperties: { destinationConfiguration: { "URL.headers.Authorization": "technical-user" } } },
    { originalProperties: { "URL.queries.sap-client": "200" } },
    { originalProperties: { SystemUser: "TECHNICAL" } },
    { authTokens: [] }, { authTokens: [{ ...destination().authTokens![0]!, error: "secret failure" }] },
    { authTokens: [{ ...destination().authTokens![0]!, expiresIn: "0" }] }
  ]
  for (const mismatch of mismatches) {
    await assert.rejects(resolveUserDestination(request, sdk({ ...destination(), ...mismatch })), hasCode("DESTINATION_MISMATCH"))
  }
  assert.equal((await resolveUserDestination(request, sdk({ ...destination(), url: `${request.expectedUrl}/` }))).url, `${request.expectedUrl}/`)
})

test("principal propagation requires on-premise proxy user and service credentials", async () => {
  const input: UserDestinationRequest = { ...request, expectedUrl: "http://virtual-sap:8000", authentication: "PrincipalPropagation" }
  const resolved: Destination = {
    url: input.expectedUrl, authentication: input.authentication, proxyType: "OnPremise",
    proxyConfiguration: { host: "proxy", port: 20003, protocol: "http", headers: {
      "Proxy-Authorization": "Bearer fixture-proxy", "SAP-Connectivity-Authentication": "Bearer fixture-user"
    } }
  }
  assert.equal(await resolveUserDestination(input, sdk(resolved)), resolved)
  await assert.rejects(resolveUserDestination(input, sdk({ ...resolved, proxyType: "Internet" })), hasCode("DESTINATION_MISMATCH"))
  await assert.rejects(resolveUserDestination(input, sdk({ ...resolved, proxyConfiguration: {
    host: "proxy", port: 20003, protocol: "http", headers: { "Proxy-Authorization": "Bearer fixture-proxy" }
  } })), hasCode("DESTINATION_MISMATCH"))
})

test("missing caller token fails before lookup and SDK failures do not expose secrets", async () => {
  let calls = 0
  const injected = { alwaysSubscriber, getDestinationFromDestinationService: async () => {
    calls++
    throw new Error("secret-token with secret-service-binding")
  } }
  await assert.rejects(resolveUserDestination({ ...request, userJwt: "" }, injected), hasCode("AUTH_REQUIRED"))
  assert.equal(calls, 0)
  await assert.rejects(resolveUserDestination(request, injected), error => {
    assert.ok(error instanceof AppError)
    assert.equal(error.code, "DESTINATION_UNAVAILABLE")
    assert.doesNotMatch(JSON.stringify(error), /secret-token|secret-service-binding/)
    return true
  })
  await assert.rejects(resolveUserDestination(request, sdk(null)), hasCode("DESTINATION_NOT_FOUND"))
})

test("user transport refreshes proxy credentials per request and fails closed without stale fallback", async t => {
  const seen: Array<{ user: string; proxy: string; cookie: string }> = []
  const server = createServer((req, res) => {
    seen.push({ user: String(req.headers["sap-connectivity-authentication"]),
      proxy: String(req.headers["proxy-authorization"]), cookie: String(req.headers.cookie) })
    res.end("fixture source")
  })
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  t.after(() => new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve())
    server.closeAllConnections()
  }))
  const address = server.address()
  assert.ok(address && typeof address !== "string")
  let lookups = 0
  let fail = false
  const injected = { alwaysSubscriber, getDestinationFromDestinationService: async (options: Parameters<typeof import("@sap-cloud-sdk/connectivity").getDestinationFromDestinationService>[0]) => {
    lookups++
    if (fail) throw new Error("fixture exchange failure")
    return {
      name: "SAP_DEV", url: "http://virtual-sap:8000", authentication: "PrincipalPropagation" as const,
      proxyType: "OnPremise" as const, proxyConfiguration: { host: "127.0.0.1", port: address.port,
        protocol: "http" as const, headers: { "Proxy-Authorization": `Bearer service-${lookups}`,
          "SAP-Connectivity-Authentication": `Bearer ${options.jwt}-${lookups}` }
      }
    }
  } }
  const input: UserDestinationRequest = { ...request, expectedUrl: "http://virtual-sap:8000", authentication: "PrincipalPropagation" }
  const firstFactory = createUserDestinationTransportFactory(input, injected)
  input.userJwt = "changed-after-binding"
  const first = firstFactory()
  await first.request({ url: "/sap/source", headers: { Cookie: "session=first" } })
  await first.request({ url: "/sap/source", headers: { Cookie: "session=first" } })
  assert.deepEqual(seen.map(item => item.user), ["Bearer fixture-user-token-1", "Bearer fixture-user-token-2"])
  assert.deepEqual(seen.map(item => item.proxy), ["Bearer service-1", "Bearer service-2"])
  assert.deepEqual(seen.map(item => item.cookie), ["session=first", "session=first"])
  fail = true
  await assert.rejects(first.request({ url: "/sap/source" }), hasCode("DESTINATION_UNAVAILABLE"))
  assert.equal(seen.length, 2)
  fail = false
  const second = createUserDestinationTransportFactory({ ...input, userJwt: "second-user" }, injected)()
  await second.request({ url: "/sap/source", headers: { Cookie: "session=second" } })
  await firstFactory().request({ url: "/sap/source", headers: { Cookie: "session=clone" } })
  assert.equal(seen[2]!.user, "Bearer second-user-4")
  assert.equal(seen[3]!.user, "Bearer fixture-user-token-5")
  assert.equal(lookups, 5)
})

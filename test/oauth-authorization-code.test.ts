import assert from "node:assert/strict"
import test from "node:test"
import {
  browserOAuthLogin,
  OAuthAuthorizationCodeProvider
} from "../src/oauth-authorization-code.js"
import { normalizeProfile } from "../src/profile-store.js"

const config = {
  authorizationUrl: "https://login.example.test/oauth/authorize",
  tokenUrl: "https://login.example.test/oauth/token",
  clientId: "desktop-client",
  scope: "openid sap"
}

test("invalidated browser OAuth refresh cannot overwrite or return a newer token", async () => {
  let release!: (response: Response) => void
  const late = new Promise<Response>(resolve => { release = resolve })
  let calls = 0
  const stored: string[] = []
  const response = (name: string) => new Response(JSON.stringify({ access_token: name,
    refresh_token: name + "-refresh", expires_in: 3600, token_type: "Bearer" }))
  const provider = new OAuthAuthorizationCodeProvider(config,
    JSON.stringify({ version: 1, accessToken: "expired", refreshToken: "original-refresh", expiresAt: 1 }), {
      now: () => 10000,
      fetch: async () => ++calls === 1 ? late : response("current"),
      persistCredential: async value => { stored.push(value) }
    })
  const obsolete = provider.getAccessToken().then(token => ({ token }), error => ({ error }))
  provider.invalidate()
  assert.equal(await provider.getAccessToken(), "current")
  release(response("obsolete"))
  const outcome = await obsolete
  assert.ok("error" in outcome)
  assert.equal(outcome.error.code, "CANCELLED")
  assert.equal(stored.length, 1)
  assert.equal(JSON.parse(stored[0]!).accessToken, "current")
  assert.equal(await provider.getAccessToken(), "current")
  assert.equal(calls, 2)
})

test("browser OAuth does not cache a token whose persistence failed", async () => {
  let calls = 0
  let writes = 0
  const provider = new OAuthAuthorizationCodeProvider(config,
    JSON.stringify({ version: 1, accessToken: "expired", refreshToken: "refresh", expiresAt: 1 }), {
      now: () => 10000,
      fetch: async () => new Response(JSON.stringify({ access_token: `token-${++calls}`, expires_in: 3600 })),
      persistCredential: async () => { if (++writes === 1) throw new Error("Store unavailable") }
    })
  await assert.rejects(provider.getAccessToken(), /Store unavailable/)
  assert.equal(provider.refreshRequired(), true)
  assert.equal(await provider.getAccessToken(), "token-2")
  assert.equal(calls, 2)
  assert.equal(writes, 2)
})

test("browser OAuth rejects invalidation during persistence and still allows a fresh request", async () => {
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  let started!: () => void
  const waiting = new Promise<void>(resolve => { started = resolve })
  let calls = 0
  let writes = 0
  const provider = new OAuthAuthorizationCodeProvider(config,
    JSON.stringify({ version: 1, accessToken: "expired", refreshToken: "refresh", expiresAt: 1 }), {
      now: () => 10000,
      fetch: async () => new Response(JSON.stringify({ access_token: `token-${++calls}`, expires_in: 3600 })),
      persistCredential: async () => { if (++writes === 1) { started(); await gate } }
    })
  const obsolete = assert.rejects(provider.getAccessToken(), { code: "CANCELLED" })
  await waiting
  provider.invalidate()
  release()
  await obsolete
  assert.equal(provider.refreshRequired(), true)
  assert.equal(await provider.getAccessToken(), "token-2")
})

test("browser OAuth profiles and same-origin classic bridge paths normalize strictly", () => {
  const profile = normalizeProfile({
    id: "dev",
    url: "https://sap.example.test/",
    client: "100",
    authType: "oauth_authorization_code",
    ...config,
    classicBridgePath: "/sap/bc/rest/zmcp_rfc/"
  })
  assert.equal(profile.authType, "oauth_authorization_code")
  assert.equal(profile.classicBridgePath, "/sap/bc/rest/zmcp_rfc")
  assert.throws(() => normalizeProfile({
    id: "dev",
    url: "https://sap.example.test",
    client: "100",
    authType: "bearer_passthrough",
    classicBridgePath: "https://attacker.example/bridge"
  }))
  assert.throws(() => normalizeProfile({
    id: "dev",
    url: "https://sap.example.test",
    client: "100",
    authType: "bearer_passthrough",
    classicBridgePath: "/sap/../private/bridge"
  }))
})

test("authorization-code provider refreshes and persists rotated credentials", async () => {
  let persisted = ""
  let requestBody = ""
  const provider = new OAuthAuthorizationCodeProvider(
    config,
    JSON.stringify({
      version: 1,
      accessToken: "expired-access",
      refreshToken: "refresh-1",
      expiresAt: 1
    }),
    {
      now: () => 10_000,
      fetch: async (_input, init) => {
        requestBody = String(init?.body)
        return new Response(JSON.stringify({
          access_token: "fresh-access",
          refresh_token: "refresh-2",
          expires_in: 3600,
          token_type: "Bearer"
        }), { status: 200, headers: { "content-type": "application/json" } })
      },
      persistCredential: async credential => {
        persisted = credential
      }
    }
  )

  assert.equal(await provider.getAccessToken(), "fresh-access")
  assert.match(requestBody, /grant_type=refresh_token/)
  assert.match(requestBody, /refresh_token=refresh-1/)
  assert.doesNotMatch(requestBody, /expired-access/)
  assert.equal(JSON.parse(persisted).refreshToken, "refresh-2")
})

test("browser OAuth login uses a loopback callback and PKCE", async () => {
  let authorizationRequest: URL | undefined
  let tokenRequestBody = ""
  const credential = await browserOAuthLogin(config, {
    timeoutMs: 5_000,
    openBrowser: value => {
      authorizationRequest = new URL(value)
      const redirect = authorizationRequest.searchParams.get("redirect_uri")!
      const state = authorizationRequest.searchParams.get("state")!
      queueMicrotask(() => {
        void fetch(`${redirect}?code=authorization-code&state=${encodeURIComponent(state)}`)
      })
    },
    fetch: async (_input, init) => {
      tokenRequestBody = String(init?.body)
      return new Response(JSON.stringify({
        access_token: "browser-access",
        refresh_token: "browser-refresh",
        expires_in: 3600,
        token_type: "Bearer"
      }), { status: 200, headers: { "content-type": "application/json" } })
    }
  })

  assert.equal(authorizationRequest?.searchParams.get("code_challenge_method"), "S256")
  assert.ok(authorizationRequest?.searchParams.get("code_challenge"))
  assert.match(tokenRequestBody, /grant_type=authorization_code/)
  assert.match(tokenRequestBody, /code_verifier=/)
  assert.equal(JSON.parse(credential).refreshToken, "browser-refresh")
})

test("browser OAuth cancellation closes its callback and makes no token request", async () => {
  const controller = new AbortController()
  let callback = ""
  let tokenRequests = 0
  await assert.rejects(browserOAuthLogin(config, {
    signal: controller.signal,
    openBrowser: url => { callback = new URL(url).searchParams.get("redirect_uri")!; controller.abort() },
    fetch: async () => { tokenRequests++; throw new Error("Unexpected token request") }
  }), { code: "CANCELLED" })
  assert.equal(tokenRequests, 0)
  await assert.rejects(fetch(callback))
})

test("browser OAuth timeout closes its callback and pre-cancellation opens no browser", async () => {
  let callback = ""
  await assert.rejects(browserOAuthLogin(config, {
    timeoutMs: 10, openBrowser: url => { callback = new URL(url).searchParams.get("redirect_uri")! }
  }), { code: "OAUTH_CALLBACK_TIMEOUT" })
  await assert.rejects(fetch(callback))
  await assert.rejects(browserOAuthLogin(config, {
    signal: AbortSignal.abort(), openBrowser: () => assert.fail("Cancelled login opened a browser")
  }), { code: "CANCELLED" })
})

test("browser OAuth cancellation aborts a pending token exchange and closes the callback", async () => {
  const controller = new AbortController()
  let callback = ""
  let callbackSent!: Promise<Response>
  await assert.rejects(browserOAuthLogin(config, {
    signal: controller.signal,
    openBrowser: url => {
      const authorization = new URL(url)
      callback = authorization.searchParams.get("redirect_uri")!
      callbackSent = fetch(`${callback}?code=demo-code&state=${authorization.searchParams.get("state")}`)
    },
    fetch: async (_input, init) => {
      assert.ok(init?.signal)
      queueMicrotask(() => controller.abort())
      return new Promise((_resolve, reject) => init!.signal!.addEventListener("abort", () => reject(new Error("aborted")), { once: true }))
    }
  }), { code: "CANCELLED" })
  assert.equal((await callbackSent).status, 200)
  await assert.rejects(fetch(callback))
})

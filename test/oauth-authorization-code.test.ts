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

import assert from "node:assert/strict"
import test from "node:test"
import { AppError } from "../src/errors.js"
import { OAuthClientCredentialsProvider } from "../src/oauth-client-credentials.js"

test("OAuth client credentials uses Basic client authentication and refreshes before expiry", async () => {
  let now = 1_000
  let calls = 0
  const provider = new OAuthClientCredentialsProvider(
    {
      tokenUrl: "https://auth.example.test/oauth/token",
      clientId: "client-id",
      clientSecret: "client-secret",
      scope: "abap.read abap.write"
    },
    {
      now: () => now,
      fetch: async (_input, init) => {
        calls += 1
        assert.equal(init?.method, "POST")
        assert.equal(
          new Headers(init?.headers).get("authorization"),
          `Basic ${Buffer.from("client-id:client-secret").toString("base64")}`
        )
        assert.equal(
          String(init?.body),
          "grant_type=client_credentials&scope=abap.read+abap.write"
        )
        return new Response(JSON.stringify({
          access_token: `token-${calls}`,
          token_type: "Bearer",
          expires_in: 100
        }), { status: 200, headers: { "content-type": "application/json" } })
      }
    }
  )

  assert.equal(await provider.getAccessToken(), "token-1")
  assert.equal(await provider.getAccessToken(), "token-1")
  assert.equal(calls, 1)
  assert.equal(provider.refreshRequired(), false)

  now += 90_001
  assert.equal(provider.refreshRequired(), true)
  assert.equal(await provider.getAccessToken(), "token-2")
  assert.equal(calls, 2)
})

test("OAuth token failures expose status without echoing a sensitive response body", async () => {
  const secretBody = "client_secret=do-not-print"
  const provider = new OAuthClientCredentialsProvider(
    {
      tokenUrl: "https://auth.example.test/oauth/token",
      clientId: "client-id",
      clientSecret: "client-secret"
    },
    {
      fetch: async () => new Response(secretBody, { status: 401 })
    }
  )

  await assert.rejects(
    provider.getAccessToken(),
    error => error instanceof AppError &&
      error.code === "OAUTH_TOKEN_REQUEST_FAILED" &&
      error.details?.httpStatus === 401 &&
      !error.message.includes(secretBody) &&
      !JSON.stringify(error.details).includes(secretBody)
  )
})

import assert from "node:assert/strict"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import {
  BTP_ABAP_CLIENT,
  loadBtpServiceKey,
  parseBtpServiceKey
} from "../src/btp-service-key.js"
import { normalizeProfile } from "../src/profile-store.js"

function serviceKey(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    url: "https://abc123.abap.eu10.hana.ondemand.com",
    systemid: "ABC",
    "sap.cloud.service": "com.sap.cloud.abap",
    uaa: {
      clientid: "sb-abc!b1234|abap-cloud!b42",
      clientsecret: "top-secret-value",
      url: "https://mytenant.authentication.eu10.hana.ondemand.com",
      identityzone: "mytenant"
    },
    ...overrides
  })
}

test("a BTP ABAP service key yields complete OAuth client-credentials settings", () => {
  const credentials = parseBtpServiceKey(serviceKey())

  assert.deepEqual(credentials, {
    url: "https://abc123.abap.eu10.hana.ondemand.com",
    tokenUrl: "https://mytenant.authentication.eu10.hana.ondemand.com/oauth/token",
    clientId: "sb-abc!b1234|abap-cloud!b42",
    clientSecret: "top-secret-value",
    client: BTP_ABAP_CLIENT,
    systemId: "ABC"
  })
})

test("an explicit token URL in the service key is preferred over the UAA base URL", () => {
  const credentials = parseBtpServiceKey(serviceKey({
    uaa: {
      clientid: "client",
      clientsecret: "secret",
      url: "https://mytenant.authentication.eu10.hana.ondemand.com",
      tokenurl: "https://mytenant.authentication.eu10.hana.ondemand.com/oauth/token"
    }
  }))

  assert.equal(
    credentials.tokenUrl,
    "https://mytenant.authentication.eu10.hana.ondemand.com/oauth/token"
  )
})

test("trailing slashes are removed so the composed token URL stays canonical", () => {
  const credentials = parseBtpServiceKey(serviceKey({
    url: "https://abc123.abap.eu10.hana.ondemand.com/",
    uaa: {
      clientid: "client",
      clientsecret: "secret",
      url: "https://mytenant.authentication.eu10.hana.ondemand.com/"
    }
  }))

  assert.equal(credentials.url, "https://abc123.abap.eu10.hana.ondemand.com")
  assert.equal(
    credentials.tokenUrl,
    "https://mytenant.authentication.eu10.hana.ondemand.com/oauth/token"
  )
})

test("the derived settings satisfy the stored profile schema", () => {
  const credentials = parseBtpServiceKey(serviceKey())
  const profile = normalizeProfile({
    id: "BTP100",
    url: credentials.url,
    client: credentials.client,
    authType: "oauth_client_credentials",
    tokenUrl: credentials.tokenUrl,
    clientId: credentials.clientId
  })

  assert.equal(profile.authType, "oauth_client_credentials")
  assert.equal(profile.client, "100")
  assert.equal(profile.environment, "development")
  if (profile.authType === "oauth_client_credentials") {
    assert.equal(profile.tokenUrl, credentials.tokenUrl)
    assert.equal(profile.clientId, credentials.clientId)
  }
})

test("a certificate-only service key is rejected instead of producing a dead profile", () => {
  assert.throws(
    () => parseBtpServiceKey(JSON.stringify({
      url: "https://abc123.abap.eu10.hana.ondemand.com",
      uaa: {
        clientid: "client",
        certificate: "-----BEGIN CERTIFICATE-----",
        certurl: "https://mytenant.authentication.cert.eu10.hana.ondemand.com",
        url: "https://mytenant.authentication.eu10.hana.ondemand.com"
      }
    })),
    /SERVICE_KEY_CERTIFICATE_UNSUPPORTED|X\.509/
  )
})

test("malformed and incomplete service keys are rejected with the missing path", () => {
  assert.throws(() => parseBtpServiceKey("{"), /not valid JSON/)
  assert.throws(() => parseBtpServiceKey("[]"), /must be a JSON object/)
  assert.throws(() => parseBtpServiceKey("{}"), /"uaa" object/)
  assert.throws(
    () => parseBtpServiceKey(serviceKey({ url: undefined })),
    /"url"/
  )
  assert.throws(
    () => parseBtpServiceKey(serviceKey({
      uaa: { clientsecret: "secret", url: "https://a.example.com" }
    })),
    /uaa\.clientid/
  )
  assert.throws(
    () => parseBtpServiceKey(serviceKey({
      uaa: { clientid: "client", clientsecret: "secret" }
    })),
    /uaa\.url/
  )
})

test("non-HTTPS and credential-bearing URLs are rejected", () => {
  assert.throws(
    () => parseBtpServiceKey(serviceKey({ url: "http://abc.example.com" })),
    /must use HTTPS/
  )
  assert.throws(
    () => parseBtpServiceKey(serviceKey({ url: "not a url" })),
    /not a valid URL/
  )
  assert.throws(
    () => parseBtpServiceKey(serviceKey({
      uaa: {
        clientid: "client",
        clientsecret: "secret",
        url: "https://user:pass@mytenant.authentication.eu10.hana.ondemand.com"
      }
    })),
    /must not embed credentials/
  )
})

test("a service key is loaded from disk and an unreadable path is reported", async () => {
  const directory = await mkdtemp(join(tmpdir(), "sap-abap-mcp-key-"))
  try {
    const path = join(directory, "service-key.json")
    await writeFile(path, serviceKey())
    assert.equal(
      loadBtpServiceKey(path).clientId,
      "sb-abc!b1234|abap-cloud!b42"
    )
    assert.throws(
      () => loadBtpServiceKey(join(directory, "absent.json")),
      /SERVICE_KEY_UNREADABLE|could not be read/
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

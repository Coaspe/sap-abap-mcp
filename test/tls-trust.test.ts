import assert from "node:assert/strict"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { createServer } from "node:https"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { profileHttpsAgent, readCaFile, certificateFailure, certificateErrorCode, globalTlsVerificationDisabled, systemCaHint } from "../src/tls-trust.js"
import { ProfileStore, profileConnectionKey } from "../src/profile-store.js"
import { v1Failure } from "../src/mcp/v1/result.js"
import { probeAdtCandidate } from "../src/saplogon-import.js"
import { testCertificate } from "./helpers/certificates.js"

test("local HTTPS requires the CA, retains hostname checks and rejects expired certificates", async t => {
  const directory = await mkdtemp(join(tmpdir(), "sap-tls-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const original = process.env.NODE_TLS_REJECT_UNAUTHORIZED
  delete process.env.NODE_TLS_REJECT_UNAUTHORIZED
  t.after(() => { if (original === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED; else process.env.NODE_TLS_REJECT_UNAUTHORIZED = original })
  const fixture = testCertificate()
  const path = join(directory, "ca.pem")
  await writeFile(path, fixture.cert)
  const requests: Array<{ url: string | undefined; authorization: string | undefined; cookie: string | undefined }> = []
  let responseStatus = 200, contentType = "application/atomsvc+xml", redirectedRequests = 0
  const server = createServer(fixture, (req, res) => {
    if (req.url === "/redirected") redirectedRequests++
    requests.push({ url: req.url, authorization: req.headers.authorization, cookie: req.headers.cookie })
    res.writeHead(responseStatus, { "content-type": contentType, location: "/redirected", "set-cookie": "secret=fixture" }); res.end("<service/>")
  })
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve))
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())))
  const port = (server.address() as { port: number }).port
  const url = `https://localhost:${port}`
  assert.equal((await probeAdtCandidate(url)).code, "SAP_TLS_CERTIFICATE_UNTRUSTED")
  assert.equal((await probeAdtCandidate(url, path)).adt, true)
  assert.equal((await probeAdtCandidate(`https://127.0.0.1:${port}`, path)).code, "SAP_TLS_HOSTNAME_MISMATCH")
  responseStatus = 302
  assert.equal((await probeAdtCandidate(url, path)).adt, false)
  assert.equal(redirectedRequests, 0)
  responseStatus = 401; contentType = "text/html"
  assert.equal((await probeAdtCandidate(url, path)).adt, true)
  assert.ok(requests.every(req => req.url === "/sap/bc/adt/discovery" && req.authorization === undefined && req.cookie === undefined))
  const agent = profileHttpsAgent(path)
  assert.equal(agent.options.rejectUnauthorized, true)
  assert.ok((agent.options.ca as string[]).length > 1)
  agent.destroy()
  const expired = testCertificate(true)
  await writeFile(path, expired.cert)
  const oldServer = createServer(expired, (_req, res) => res.end())
  await new Promise<void>(resolve => oldServer.listen(0, "127.0.0.1", resolve))
  t.after(() => new Promise<void>(resolve => oldServer.close(() => resolve())))
  assert.equal((await probeAdtCandidate(`https://localhost:${(oldServer.address() as { port: number }).port}`, path)).code, "SAP_TLS_CERTIFICATE_EXPIRED")
})

test("PEM validation rejects relative paths, keys, malformed certificates and oversized files", async t => {
  const directory = await mkdtemp(join(tmpdir(), "sap-pem-")); t.after(() => rm(directory, { recursive: true, force: true }))
  const fixture = testCertificate(), path = join(directory, "ca.pem")
  assert.throws(() => readCaFile("relative.pem"), /absolute path/)
  for (const invalid of [fixture.key, fixture.cert + fixture.key, "-----BEGIN CERTIFICATE-----\ninvalid\n-----END CERTIFICATE-----", " ".repeat(1024 * 1024 + 1)]) {
    await writeFile(path, invalid); assert.throws(() => readCaFile(path), /PEM certificate/)
  }
  await writeFile(path, fixture.cert + fixture.cert)
  assert.equal(readCaFile(path), fixture.cert + fixture.cert)
})

test("nested TLS errors become recoverable transport failures without leaking diagnostics", () => {
  const error: any = { parent: { cause: { code: "SELF_SIGNED_CERT_IN_CHAIN", message: "password=secret" } } }
  error.cause = error
  assert.equal(certificateErrorCode(error), "SELF_SIGNED_CERT_IN_CHAIN")
  assert.equal(certificateFailure(error)?.code, "SAP_TLS_CERTIFICATE_UNTRUSTED")
  const failure = v1Failure(error).content[0] as { text: string }
  const envelope = JSON.parse(failure.text)
  assert.equal(envelope.category, "transport")
  assert.equal(envelope.recovery.action, "fix_tls_trust")
  assert.doesNotMatch(failure.text, /password=secret/)
  assert.equal(certificateFailure({ code: "ECONNREFUSED" }), undefined)
  assert.equal(globalTlsVerificationDisabled(), process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0")
  assert.ok(systemCaHint().includes("--ca-file"))
})

test("CA paths require profile version 3 and changing the CA invalidates connection identity", async t => {
  const directory = await mkdtemp(join(tmpdir(), "sap-profile-ca-")); t.after(() => rm(directory, { recursive: true, force: true }))
  const profiles = new ProfileStore(directory)
  const input = { id: "DEV", url: "https://sap.example.test", client: "100" }
  const original = await profiles.upsert(input)
  assert.equal(JSON.parse(await readFile(profiles.filePath, "utf8")).version, 1)
  await profiles.upsert({ ...input, readOnly: true })
  assert.equal(JSON.parse(await readFile(profiles.filePath, "utf8")).version, 2)
  const changed = await profiles.upsert({ ...input, caFile: join(directory, "ca.pem") })
  assert.equal(JSON.parse(await readFile(profiles.filePath, "utf8")).version, 3)
  assert.notEqual(profileConnectionKey(original), profileConnectionKey(changed))
  await writeFile(profiles.filePath, JSON.stringify({ version: 2, profiles: [changed] }))
  await assert.rejects(profiles.list(), /Invalid profile file/)
})

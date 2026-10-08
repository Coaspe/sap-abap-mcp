import assert from "node:assert/strict"
import { generateKeyPairSync, sign } from "node:crypto"
import { createRequire } from "node:module"
import test from "node:test"

const require = createRequire(import.meta.url)
const forge = require("node-forge")
const { sprintf } = require("sprintf-js")
const katex = require("katex")

test("RSA backport rejects nested DigestAlgorithm padding while preserving signatures and PKCS12", () => {
  const keys = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs1", format: "pem" },
    publicKeyEncoding: { type: "pkcs1", format: "pem" }
  })
  const privateKey = forge.pki.privateKeyFromPem(keys.privateKey)
  const publicKey = forge.pki.publicKeyFromPem(keys.publicKey)
  const message = "SAP certificate compatibility fixture"
  const md = forge.md.sha256.create().update(message)
  const digest = md.digest().getBytes()
  const asn1 = forge.asn1
  const makeSignature = (parameters?: string, extraChild = false) => {
    const algorithm = [asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false,
      asn1.oidToDer("2.16.840.1.101.3.4.2.1").getBytes())]
    if (parameters !== undefined) algorithm.push(asn1.create(asn1.Class.UNIVERSAL, asn1.Type.NULL, false, parameters))
    if (extraChild) algorithm.push(asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OCTETSTRING, false, "unconsumed padding"))
    const info = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, algorithm),
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OCTETSTRING, false, digest)
    ])
    return forge.pki.rsa.encrypt(asn1.toDer(info).getBytes(), privateKey, 0x01)
  }
  assert.equal(publicKey.verify(digest, makeSignature()), true)
  assert.equal(publicKey.verify(digest, makeSignature("")), true)
  assert.throws(() => publicKey.verify(digest, makeSignature("", true)), /DigestInfo/)
  assert.throws(() => publicKey.verify(digest, makeSignature("invalid NULL")), /DigestInfo/)
  assert.equal(publicKey.verify(digest, sign("RSA-SHA256", Buffer.from(message), keys.privateKey).toString("binary")), true)
  assert.equal(publicKey.verify("\0".repeat(32), makeSignature("")), false)
  const pss = forge.pss.create({ md: forge.md.sha256.create(), mgf: forge.mgf.mgf1.create(forge.md.sha256.create()), saltLength: 20 })
  assert.equal(publicKey.verify(digest, privateKey.sign(forge.md.sha256.create().update(message), pss), pss), true)
  assert.equal(publicKey.verify(digest, privateKey.sign(digest, "NONE"), "NONE"), true)

  const certificate = forge.pki.createCertificate()
  certificate.publicKey = publicKey
  certificate.serialNumber = "01"
  certificate.validity.notBefore = new Date("2026-01-01T00:00:00Z")
  certificate.validity.notAfter = new Date("2027-01-01T00:00:00Z")
  certificate.setSubject([{ name: "commonName", value: "localhost" }])
  certificate.setIssuer(certificate.subject.attributes)
  certificate.sign(privateKey, forge.md.sha256.create())
  const p12 = forge.pkcs12.toPkcs12Asn1(privateKey, [certificate], "fixture-password", { algorithm: "3des", friendlyName: "fixture" })
  const converted = require("jks-js").toPem(Buffer.from(asn1.toDer(p12).getBytes(), "binary"), "fixture-password")
  const entry = Object.values(converted)[0] as { key: string; cert: string }
  assert.match(entry.key, /PRIVATE KEY/)
  assert.match(entry.cert, /CERTIFICATE/)
  assert.equal(forge.pki.certificateFromPem(entry.cert).verify(certificate), true)
})

test("numeric sprintf precision stays bounded without changing SAP URI substitution", () => {
  for (const type of ["e", "f", "g"]) {
    for (const precision of ["101", "999999999999999999999999999999", "0"]) {
      const result = sprintf(`%.${precision}${type}`, 1.25)
      assert.equal(typeof result, "string")
      assert.ok(result.length <= 110)
    }
  }
  assert.equal(sprintf("/sap/bc/adt/packages/%s", encodeURIComponent("/TEST/PKG")), "/sap/bc/adt/packages/%2FTEST%2FPKG")
  assert.equal(sprintf("%.2f", 1.25), "1.25")
  assert.equal(sprintf("%.0f", 1.25), "1")
  assert.equal(sprintf("%.0e", 1.25), "1e+0")
  assert.equal(sprintf("%s %d", "SAP", 42), "SAP 42")
})

test("KaTeX ignores inherited trust and polluted settings processors", () => {
  const input = String.raw`\href{javascript:alert(1)}{x}`
  assert.doesNotMatch(katex.renderToString(input, Object.create({ trust: true })), /<a href=/)
  const saved = Object.getOwnPropertyDescriptors(Object.prototype)
  try {
    for (const [name, value] of [["trust", true], ["default", true], ["processor", () => true]] as const) {
      Object.defineProperty(Object.prototype, name, { value, configurable: true, writable: true })
      assert.doesNotMatch(katex.renderToString(input, { trust: false, strict: "ignore" }), /<a href=/)
      delete (Object.prototype as Record<string, unknown>)[name]
    }
  } finally {
    for (const name of ["trust", "default", "processor"]) {
      const previous = saved[name]
      if (previous) Object.defineProperty(Object.prototype, name, previous)
      else delete (Object.prototype as Record<string, unknown>)[name]
    }
  }
})

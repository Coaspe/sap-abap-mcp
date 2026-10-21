import { generateKeyPairSync } from "node:crypto"
import { createRequire } from "node:module"
const forge = createRequire(import.meta.url)("node-forge")
export function testCertificate(expired = false): { key: string; cert: string } {
  const keys = generateKeyPairSync("rsa", { modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } })
  const certificate = forge.pki.createCertificate()
  certificate.publicKey = forge.pki.publicKeyFromPem(keys.publicKey)
  certificate.serialNumber = "01"
  certificate.validity.notBefore = new Date(Date.now() - 86400_000)
  certificate.validity.notAfter = new Date(Date.now() + (expired ? -3600_000 : 86400_000))
  certificate.setSubject([{ name: "commonName", value: "localhost" }])
  certificate.setIssuer(certificate.subject.attributes)
  certificate.setExtensions([{ name: "basicConstraints", cA: true },
    { name: "keyUsage", keyCertSign: true, digitalSignature: true, keyEncipherment: true },
    { name: "subjectAltName", altNames: [{ type: 2, value: "localhost" }] }])
  certificate.sign(forge.pki.privateKeyFromPem(keys.privateKey), forge.md.sha256.create())
  return { key: keys.privateKey, cert: forge.pki.certificateToPem(certificate) }
}

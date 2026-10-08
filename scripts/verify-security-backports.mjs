import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const require = createRequire(import.meta.url)
const expected = JSON.parse(await readFile(join(root, "vendor", "security-backports.json"), "utf8"))
const targets = [
  ["rsa", require.resolve("node-forge/lib/rsa.js", { paths: [dirname(require.resolve("jks-js"))] })],
  ["pem", require.resolve("node-forge/lib/pem.js", { paths: [dirname(require.resolve("jks-js"))] })],
  ["forgeHttp", require.resolve("node-forge/lib/http.js", { paths: [dirname(require.resolve("jks-js"))] })],
  ["sprintf", require.resolve("sprintf-js", { paths: [dirname(require.resolve("abap-adt-api"))] })],
  ["mermaidBrowser", join(root, "assets", "mermaid.min.js")]
]
for (const [key, path] of targets) {
  const hash = createHash("sha256").update(await readFile(path)).digest("hex")
  assert.equal(hash, expected.runtimeHashes[key], `${key}: installed runtime does not contain the reviewed backport`)
}
const katexPath = require.resolve("katex/package.json", { paths: [dirname(require.resolve("mermaid"))] })
assert.equal(JSON.parse(await readFile(katexPath, "utf8")).version, "0.18.2")
console.log(JSON.stringify({ passed: true, runtimeHashesVerified: targets.length, katex: "0.18.2", upstreamReleaseClaimed: false }))

import assert from "node:assert/strict"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import test from "node:test"
import { importSapLogon, classifyDiscoveryResponse, probeAdtCandidate } from "../src/saplogon-import.js"

test("landscape import reads local/global includes and strips credentials and memo fields", async t => {
  const root = await mkdtemp(join(tmpdir(), "sap-logon-")); t.after(() => rm(root, { recursive: true, force: true }))
  const local = join(root, "local.xml"), path = join(root, "SAPUILandscape.xml")
  await writeFile(path, `<Landscape><Includes><Include url="${pathToFileURL(local).href}"/><Include url="https://SECRET-remote.example.test/config.xml"/><Include url="file://SECRET-server/share/config.xml"/><Include url="file://[invalid"/></Includes><Services>
    <Service type="SAPGUI" mode="0" name="Balanced" systemid="DEV" server="PUBLIC" msid="ms1" routerid="r1" user="SECRET-user" client="SECRET-client" sncname="SECRET-snc" sso2="SECRET-sso"><Memo>SECRET-memo</Memo></Service>
    <Service type="SAPGUI" mode="1" name="Direct" systemid="QA1" server="app.example.test:sapdp12"/>
    <Service type="SAPGUI" mode="1" name="Numeric" systemid="QA2" server="app2.example.test:3203"/>
    <Service type="SAPGUI" mode="2" name="Unsupported" systemid="OLD" guiparam="SECRET-param"/>
    <Service type="NWBC" name="Not GUI"/>
  </Services><Routers><Router uuid="r1" router="SECRET-route"/></Routers></Landscape>`)
  await writeFile(local, '<Landscape><Messageservers><Messageserver uuid="ms1" host="message.example.test" port="3607"/></Messageservers></Landscape>')
  await writeFile(join(root, "SAPUILandscapeGlobal.xml"), '<Landscape><Webdispatchers><Webdispatcher msid="ms1" url="https://web.example.test"/><Webdispatcher msid="different" url="https://wrong.example.test"/></Webdispatchers></Landscape>')
  const imported = await importSapLogon(path)
  assert.equal(imported.entries.length, 4)
  assert.deepEqual(imported.entries[0]?.candidates, ["https://web.example.test", "https://message.example.test:44307", "https://message.example.test:44300"])
  assert.equal(imported.entries[0]?.instance, "07")
  assert.deepEqual(imported.entries[1]?.candidates, ["https://app.example.test:44312", "https://app.example.test:44300"])
  assert.equal(imported.entries[2]?.instance, "03")
  assert.match(imported.entries[3]?.issue ?? "", /Unsupported/)
  assert.equal(imported.skipped.length, 3)
  assert.doesNotMatch(JSON.stringify(imported), /SECRET|wrong\.example|Not GUI/)
})

test("malformed and entity-bearing XML are refused; cyclic local includes stop", async t => {
  const root = await mkdtemp(join(tmpdir(), "sap-logon-invalid-")); t.after(() => rm(root, { recursive: true, force: true }))
  const path = join(root, "SAPUILandscape.xml")
  for (const xml of ['<!DOCTYPE a [<!ENTITY secret SYSTEM "file:///etc/passwd">]><Landscape/>', '<Landscape>', 'x'.repeat(2 * 1024 * 1024 + 1)]) {
    await writeFile(path, xml); await assert.rejects(importSapLogon(path), /Invalid SAP landscape/)
  }
  await writeFile(path, '<Landscape><Includes><Include url="SAPUILandscape.xml"/></Includes></Landscape>')
  assert.deepEqual((await importSapLogon(path)).entries, [])
})

test("ADT candidate classification excludes redirects, HTML and non-HTTPS URLs", async () => {
  for (const type of ["application/atomsvc+xml; charset=utf-8", "application/xml", "text/xml"]) assert.equal(classifyDiscoveryResponse(200, type), true)
  assert.equal(classifyDiscoveryResponse(401, "text/html"), true)
  for (const status of [201, 301, 302, 403, 404, 500]) assert.equal(classifyDiscoveryResponse(status, "application/xml"), false)
  assert.equal(classifyDiscoveryResponse(200, "text/html"), false)
  for (const url of ["http://example.test", "https://user:pass@example.test", "https://example.test/?token=secret"]) await assert.rejects(probeAdtCandidate(url), /HTTPS without credentials/)
})

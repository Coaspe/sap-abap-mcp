import assert from "node:assert/strict"
import test from "node:test"
import { AbapToolService } from "../src/tool-service.js"

test("a lost second write response does not trigger rollback or repeat completed writes", async () => {
  const names = ["Z_FIRST", "Z_SECOND", "Z_THIRD"]
  const uri = (name: string) => `/sap/bc/adt/programs/programs/${name.toLowerCase()}`
  const source = new Map(names.map(name => [`${uri(name)}/source/main`, "REPORT original."]))
  const attempts: string[] = []
  const client: any = {
    profile: { id: "FIXTURE", environment: "development", allowedPackages: ["$TMP"] },
    async readSourceByUri(path: string) { return { sourceUri: path, source: source.get(path) } },
    async getObjectStructure(path: string) { return { metaData: {
      "adtcore:name": path.split("/").at(-1)!.toUpperCase(), "adtcore:type": "PROG/P"
    } } },
    async searchObjects(name: string) { return [{ name, type: "PROG/P", uri: uri(name), packageName: "$TMP" }] },
    async checkSyntax() { return [] },
    async replaceSource(name: string, _object: string, path: string, _expected: string, after: string) {
      attempts.push(name)
      source.set(path, after)
      if (name === "Z_SECOND") throw new Error("Response lost after the server saved the change")
    }
  }
  const service = new AbapToolService({ async getClient() { return client }, async listConnections() { return [] } })
  try {
    await assert.rejects((service as any).applySourceDeltas("FIXTURE", names.map(name => ({
      uri: `${uri(name)}/source/main`, range: { start: { line: 1, column: 7 }, end: { line: 1, column: 15 } }, content: "changed"
    })), undefined, false), (error: any) => {
      assert.equal(error.code, "MULTI_OBJECT_WRITE_FAILED")
      assert.equal(error.details.rollbackAttempted, false)
      assert.deepEqual(error.details.appliedObjects, ["Z_FIRST"])
      assert.equal(error.details.uncertainObject, "Z_SECOND")
      assert.deepEqual(error.details.notAttemptedObjects, ["Z_THIRD"])
      return true
    })
    assert.deepEqual(attempts, ["Z_FIRST", "Z_SECOND"])
    assert.equal(source.get(`${uri("Z_FIRST")}/source/main`), "REPORT changed.")
    assert.equal(source.get(`${uri("Z_THIRD")}/source/main`), "REPORT original.")
  } finally { service.dispose() }
})

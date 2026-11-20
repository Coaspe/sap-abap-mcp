import assert from "node:assert/strict"
import test from "node:test"
import { normalizeAtcTransportTarget } from "../src/atc-transport-target.js"

const target = (pgmid: string, type: string, name: string) => normalizeAtcTransportTarget({ "tm:pgmid": pgmid, "tm:type": type, "tm:name": name })

test("CTS ATC targets map function includes, screen owners and Dictionary objects", () => {
  for (const type of ["DYNP", "REPT", "CUAD"]) assert.deepEqual(target("LIMU", type, `${"ZREPORT".padEnd(40)}0100`), { kind: "target", type: "PROG", name: "ZREPORT" })
  for (const name of ["LZGROUPTOP", "LZGROUPUXX", "LZGROUPU01"]) assert.deepEqual(target("LIMU", "REPS", name), { kind: "target", type: "FUGR", name: "ZGROUP" })
  assert.deepEqual(target("LIMU", "REPS", "/TEST/LGROUPU01"), { kind: "target", type: "FUGR", name: "/TEST/GROUP" })
  for (const [source, expected] of [["DTED", "DTEL"], ["TABD", "TABL"], ["DOMD", "DOMA"], ["TTYD", "TTYP"]]) assert.deepEqual(target("LIMU", source!, "ZOBJ"), { kind: "target", type: expected, name: "ZOBJ" })
  assert.deepEqual(target("LIMU", "FUNC", "ZFUNC"), { kind: "function", name: "ZFUNC" })
  assert.deepEqual(target("LIMU", "REPS", "ZINCLUDE"), { kind: "include", name: "ZINCLUDE" })
  assert.equal(target("CORR", "MERG", "X").kind, "skipped")
  assert.equal(target("R3TR", "IOBJ", "X").kind, "skipped")
})

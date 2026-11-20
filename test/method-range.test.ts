import assert from "node:assert/strict"
import test from "node:test"
import { findMethodRange, validateMethodPatch } from "../src/method-range.js"

const source = [
  "CLASS zcl_demo IMPLEMENTATION.",
  "  METHOD if_demo~run.",
  "    DATA(text) = 'ENDMETHOD.'.",
  '    " METHOD fake.',
  "    result = 42.",
  "  ENDMETHOD.",
  "  METHOD other.",
  "    result = 42.",
  "  ENDMETHOD.",
  "ENDCLASS."
].join("\n")

test("method ranges use parsed ABAP statements rather than strings or comments", () => {
  const method = findMethodRange(source, "if_demo~run")!
  assert.equal(method.startLine, 2)
  assert.equal(method.endLine, 6)
  assert.equal(findMethodRange(source, "fake"), undefined)
})

test("method patch rejects edits outside the body or changes to boundaries", () => {
  const oldText = "DATA(text) = 'ENDMETHOD.'."
  validateMethodPatch(source, source.replace(oldText, "DATA(text) = '$1'."), oldText, "if_demo~run")
  assert.throws(() => validateMethodPatch(source, source.replace("METHOD if_demo~run.", "METHOD other."), "METHOD if_demo~run.", "if_demo~run"), /inside/)
  assert.throws(() => validateMethodPatch(source, source.replace(oldText, "ENDMETHOD. METHOD injected."), oldText, "if_demo~run"), /boundar|parse/i)
  assert.throws(() => validateMethodPatch(source, source.replace("result = 42.", "result = 43."), "result = 42.", "other"), /inside/)
  const declaration = `CLASS zcl_demo DEFINITION.\n  PUBLIC SECTION.\n    METHODS run.\nENDCLASS.\n${source}`
  assert.throws(() => validateMethodPatch(declaration, declaration.replace("METHODS run.", "METHODS other."),
    "METHODS run.", "if_demo~run"), /inside/)
})

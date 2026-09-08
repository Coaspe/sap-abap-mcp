import assert from "node:assert/strict"
import test from "node:test"
import { extractPublicApi } from "../src/public-api.js"

test("public API spans preserve signatures and exclude private declarations and implementation", () => {
  const source = `CLASS zcl_demo DEFINITION PUBLIC.
PUBLIC SECTION.
METHODS run IMPORTING iv_value TYPE string RETURNING VALUE(rv_result) TYPE i.
METHODS: first, second.
TYPES: BEGIN OF ty_data, name TYPE string, END OF ty_data.
PROTECTED SECTION.
METHODS hidden.
PRIVATE SECTION.
DATA password TYPE string.
ENDCLASS.
CLASS zcl_demo IMPLEMENTATION.
METHOD run.
rv_result = 1.
ENDMETHOD.
ENDCLASS.`
  const declarations = extractPublicApi(source, "ZCL_DEMO")
  assert.equal(declarations.length, 4)
  assert.equal(declarations[1]!.code, source.split("\n")[2])
  assert.equal(declarations[2]!.code, "METHODS: first, second.")
  assert.equal(declarations[3]!.code, "TYPES: BEGIN OF ty_data, name TYPE string, END OF ty_data.")
  assert.equal(declarations[1]!.startLine, 3)
  assert.equal(declarations[1]!.startColumn, 1)
  assert.equal(declarations[1]!.endColumn, declarations[1]!.code.length + 1)
  assert.doesNotMatch(JSON.stringify(declarations), /hidden|password|rv_result =/)
})

test("interfaces, namespaced names, CRLF, strings and multiline declarations keep exact source", () => {
  const source = "INTERFACE /abc/if_demo PUBLIC.\r\n  METHODS run\r\n    IMPORTING value TYPE string.\r\n  CONSTANTS text TYPE string VALUE 'PRIVATE SECTION.'.\r\nENDINTERFACE."
  const result = extractPublicApi(source, "/ABC/IF_DEMO")
  assert.equal(result.length, 3)
  assert.equal(result[1]!.code, "METHODS run\r\n    IMPORTING value TYPE string.")
  assert.equal(result[1]!.startLine, 2)
  assert.equal(result[1]!.endLine, 3)
  assert.match(result[2]!.code, /'PRIVATE SECTION\.'/)
})

test("missing, duplicate, unclosed or unparsed public declarations do not yield a complete API", () => {
  for (const source of [
    "REPORT z_demo.",
    "CLASS zcl_demo DEFINITION PUBLIC. PUBLIC SECTION. METHODS run.",
    "CLASS zcl_demo DEFINITION PUBLIC. PUBLIC SECTION. INVALID DECLARATION. ENDCLASS.",
    "INTERFACE zcl_demo. ENDINTERFACE. INTERFACE zcl_demo. ENDINTERFACE.",
    "x".repeat(1024 * 1024 + 1)
  ]) assert.throws(() => extractPublicApi(source, "ZCL_DEMO"), /could not be parsed completely/)
})

test("public ABAP Doc retains exact CRLF spans and chained declarations", () => {
  const lines = [
    '"! 서비스 계약',
    'INTERFACE zif_demo PUBLIC.',
    '  "! Run safely.',
    '  "! @parameter value | 사용자 입력',
    '  METHODS run IMPORTING value TYPE string.',
    '  "! Two operations.',
    '  METHODS: first, second.',
    'ENDINTERFACE.'
  ]
  const result = extractPublicApi(lines.join("\r\n"), "ZIF_DEMO")
  assert.equal(result.length, 3)
  assert.equal(result[0]!.code, lines.slice(0, 2).join("\r\n"))
  assert.equal(result[1]!.code, lines.slice(2, 5).join("\r\n").slice(2))
  assert.equal(result[1]!.startLine, 3)
  assert.equal(result[1]!.startColumn, 3)
  assert.equal(result[1]!.endLine, 5)
  assert.equal(result[2]!.code, lines.slice(5, 7).join("\r\n").slice(2))
})

test("orphan, trailing, ordinary and nonpublic comments do not attach to public API", () => {
  const source = `CLASS zcl_demo DEFINITION PUBLIC.
PUBLIC SECTION.
"! orphan

METHODS first. "! trailing
METHODS second.
"! interrupted
" ordinary
METHODS third.
"! visibility marker
PRIVATE SECTION.
"! secret documentation
METHODS secret.
PUBLIC SECTION.
METHODS fourth.
ENDCLASS.`
  const result = extractPublicApi(source, "ZCL_DEMO")
  assert.equal(result.length, 5)
  assert.doesNotMatch(JSON.stringify(result), /orphan|trailing|interrupted|ordinary|visibility marker|secret/)
})

test("related types identify only explicit public inheritance targets with navigation positions", () => {
  const source = `CLASS zcl_demo DEFINITION PUBLIC INHERITING FROM /abc/cl_base.
PUBLIC SECTION.
"! INTERFACES fake.
INTERFACES: /abc/if_first, zif_second.
CONSTANTS misleading TYPE string VALUE 'INHERITING FROM fake'.
PRIVATE SECTION.
INTERFACES zif_private.
ENDCLASS.`
  const result = extractPublicApi(source, "ZCL_DEMO")
  const refs = result.flatMap(item => item.relatedTypes ?? [])
  assert.deepEqual(refs.map(item => [item.relation, item.name]), [
    ["superclass", "/ABC/CL_BASE"], ["interface", "/ABC/IF_FIRST"], ["interface", "ZIF_SECOND"]
  ])
  for (const ref of refs) assert.equal(source.split("\n")[ref.line - 1]!.slice(ref.column, ref.column + ref.name.length).toUpperCase(), ref.name)
  assert.equal(result[1]!.relatedTypes?.length, 2)
})

test("public reference parameter, return, attribute and alias types retain exact target positions", () => {
  const source = `CLASS zcl_demo DEFINITION PUBLIC.
PUBLIC SECTION.
"! TYPE REF TO zif_comment
METHODS run IMPORTING a TYPE REF TO zif_dep b TYPE string RETURNING VALUE(c) TYPE REF TO /abc/cl_dep.
TYPES ty_ref TYPE REF TO zif_dep.
DATA value TYPE REF TO zif_attribute.
DATA generic TYPE REF TO object.
DATA generic_data TYPE REF TO data.
CONSTANTS text TYPE string VALUE 'TYPE REF TO zif_literal'.
PRIVATE SECTION.
DATA secret TYPE REF TO zif_secret.
ENDCLASS.`
  const refs = extractPublicApi(source, "ZCL_DEMO").flatMap(item => item.relatedTypes ?? [])
  assert.deepEqual(refs.map(item => item.name), ["ZIF_DEP", "/ABC/CL_DEP", "ZIF_DEP", "ZIF_ATTRIBUTE"])
  assert.ok(refs.every(item => item.relation === "reference_type"))
  for (const ref of refs) assert.equal(source.split("\n")[ref.line - 1]!.slice(ref.column, ref.column + ref.name.length).toUpperCase(), ref.name)
})

test("public RAISING contracts include exception classes, excluding legacy exceptions and private methods", () => {
  const source = `CLASS zcl_demo DEFINITION PUBLIC.
PUBLIC SECTION.
"! RAISING zcx_comment
METHODS run RAISING zcx_error /abc/cx_error.
CLASS-METHODS retry RAISING RESUMABLE(zcx_retry).
METHODS old EXCEPTIONS failed.
PRIVATE SECTION.
METHODS secret RAISING zcx_private.
ENDCLASS.`
  const refs = extractPublicApi(source, "ZCL_DEMO").flatMap(item => item.relatedTypes ?? [])
  assert.deepEqual(refs.map(item => item.name), ["ZCX_ERROR", "/ABC/CX_ERROR", "ZCX_RETRY"])
  assert.ok(refs.every(item => item.relation === "exception_class"))
  for (const ref of refs) assert.equal(source.split("\n")[ref.line - 1]!.slice(ref.column, ref.column + ref.name.length).toUpperCase(), ref.name)
})

test("qualified public types reference their OO owner including table row types", () => {
  const source = `CLASS zcl_demo DEFINITION PUBLIC.
PUBLIC SECTION.
METHODS run IMPORTING value TYPE zif_dep=>ty_input.
TYPES ty_rows TYPE STANDARD TABLE OF /abc/if_dep=>ty_row WITH EMPTY KEY.
DATA alias_ref TYPE REF TO zcl_types=>ty_reference.
DATA ddic_field TYPE ztable-field.
CONSTANTS literal TYPE string VALUE 'zif_fake=>ty_fake'.
PRIVATE SECTION.
DATA hidden TYPE zif_private=>ty_secret.
ENDCLASS.`
  const refs = extractPublicApi(source, "ZCL_DEMO").flatMap(item => item.relatedTypes ?? [])
  assert.deepEqual(refs.map(item => [item.relation, item.name]), [
    ["qualified_type", "ZIF_DEP"], ["qualified_type", "/ABC/IF_DEP"], ["qualified_type", "ZCL_TYPES"]
  ])
  for (const ref of refs) assert.equal(source.split("\n")[ref.line - 1]!.slice(ref.column, ref.column + ref.name.length).toUpperCase(), ref.name)
})

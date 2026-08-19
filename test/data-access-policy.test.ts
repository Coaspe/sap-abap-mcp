import assert from "node:assert/strict"
import test from "node:test"
import {
  enforceDataAccessPolicy,
  extractSqlDataSources
} from "../src/data-access-policy.js"

function rejectsCode(operation: () => unknown, code: string): void {
  assert.throws(operation, error =>
    typeof error === "object" && error !== null && "code" in error && error.code === code
  )
}

test("SQL data sources are extracted from FROM and JOIN clauses", () => {
  assert.deepEqual(
    extractSqlDataSources(`
      SELECT a~matnr, b~vbeln
        FROM mara AS a
        INNER JOIN "VBAP" AS b ON b~matnr = a~matnr
        LEFT OUTER JOIN zsafe AS c ON c~matnr = a~matnr
    `),
    ["MARA", "VBAP", "ZSAFE"]
  )
})

test("ordinary technical tables are allowed without confirmation", () => {
  assert.deepEqual(enforceDataAccessPolicy("SELECT MATNR FROM MARA", false), {
    tables: ["MARA"],
    confirmationRequired: false
  })
})

test("business-document tables require an explicit risk acknowledgement", () => {
  rejectsCode(
    () => enforceDataAccessPolicy("SELECT VBELN FROM VBAK", false),
    "DATA_QUERY_CONFIRMATION_REQUIRED"
  )
  assert.deepEqual(enforceDataAccessPolicy("SELECT VBELN FROM VBAK", true), {
    tables: ["VBAK"],
    confirmationRequired: true
  })
})

test("credential, banking, identity, payroll, and tax tables stay blocked", () => {
  for (const table of ["USR02", "KNBK", "ADRC", "PA0002", "HRP1000", "PCL2", "DFKKBPTAXNUM"]) {
    rejectsCode(
      () => enforceDataAccessPolicy(`SELECT * FROM ${table}`, true),
      "DATA_QUERY_TABLE_DENIED"
    )
  }
})

test("dynamic table sources are rejected when the policy cannot inspect them", () => {
  rejectsCode(
    () => enforceDataAccessPolicy("SELECT * FROM (lv_table)", true),
    "DATA_QUERY_SOURCE_UNRESOLVED"
  )
})

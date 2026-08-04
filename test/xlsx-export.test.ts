import assert from "node:assert/strict"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { strFromU8, unzipSync } from "fflate"
import { createXlsx, writeXlsxFile } from "../src/xlsx-export.js"

test("creates a minimal safe XLSX package", () => {
  const archive = unzipSync(createXlsx({
    sheetName: "ABAP/Data:*?",
    columns: [
      { name: "NAME", header: "Name & Description", width: 8 },
      { name: "COUNT", header: "Count", width: 50 },
      { name: "ACTIVE", header: "Active", width: 12 },
      { name: "EMPTY", header: "Empty", width: 12 }
    ],
    rows: [
      { NAME: "=HYPERLINK(\"https://invalid\")", COUNT: 7, ACTIVE: true, EMPTY: null },
      { NAME: "A&B<C>\u0001", COUNT: Number.POSITIVE_INFINITY, ACTIVE: false }
    ]
  }))

  assert.deepEqual(
    Object.keys(archive).sort(),
    [
      "[Content_Types].xml",
      "_rels/.rels",
      "docProps/app.xml",
      "docProps/core.xml",
      "xl/_rels/workbook.xml.rels",
      "xl/styles.xml",
      "xl/workbook.xml",
      "xl/worksheets/sheet1.xml"
    ]
  )

  const workbook = strFromU8(archive["xl/workbook.xml"]!)
  assert.match(workbook, /name="ABAP_Data___"/)

  const sheet = strFromU8(archive["xl/worksheets/sheet1.xml"]!)
  assert.match(sheet, /min="1" max="1" width="12"/)
  assert.match(sheet, /min="2" max="2" width="40"/)
  assert.match(sheet, /Name &amp; Description/)
  assert.match(sheet, /r="A2" t="inlineStr"/)
  assert.match(sheet, /=HYPERLINK\(&quot;https:\/\/invalid&quot;\)/)
  assert.doesNotMatch(sheet, /<f>/)
  assert.match(sheet, /r="B2" t="n"><v>7<\/v>/)
  assert.match(sheet, /r="C2" t="b"><v>1<\/v>/)
  assert.match(sheet, /<c r="D2"\/>/)
  assert.match(sheet, /A&amp;B&lt;C&gt;�/)
  assert.match(sheet, /r="B3" t="inlineStr"/)
  assert.match(sheet, /r="C3" t="b"><v>0<\/v>/)
})

test("limits sheet names by Unicode code point and writes the same package to disk", async t => {
  const directory = await mkdtemp(join(tmpdir(), "sap-abap-mcp-xlsx-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const outputPath = join(directory, "result.xlsx")

  await writeXlsxFile(outputPath, {
    sheetName: "😀".repeat(32),
    columns: [{ name: "VALUE", header: "Value", width: 12 }],
    rows: [{ VALUE: "@SUM(A1:A2)" }]
  })

  const archive = unzipSync(await readFile(outputPath))
  const workbook = strFromU8(archive["xl/workbook.xml"]!)
  assert.match(workbook, new RegExp(`name="${"😀".repeat(31)}"`))
  const sheet = strFromU8(archive["xl/worksheets/sheet1.xml"]!)
  assert.match(sheet, /@SUM\(A1:A2\)/)
  assert.doesNotMatch(sheet, /<f>/)
})

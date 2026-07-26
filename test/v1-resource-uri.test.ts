import assert from "node:assert/strict"
import test from "node:test"
import { AppError } from "../src/errors.js"
import {
  normalizeV1SystemId,
  parseAdtResourceUri,
  parseCapabilityResourceUri,
  parseDocsResourceUri,
  parseEvidenceResourceUri,
  parseTransportResourceUri,
  toAdtResourceUri,
  toCapabilityResourceUri
} from "../src/mcp/v1/resource-uri.js"

function assertInvalid(operation: () => unknown): void {
  assert.throws(
    operation,
    (error: unknown) => error instanceof AppError && error.code === "INVALID_ADT_URI"
  )
}

test("profile IDs are trimmed and normalized to uppercase", () => {
  assert.equal(normalizeV1SystemId(" dev_100-a "), "DEV_100-A")
})

test("profile IDs reject characters outside the canonical alphabet", () => {
  for (const value of ["", "   ", "dev.100", "dev/100", "dev 100"]) {
    assertInvalid(() => normalizeV1SystemId(value))
  }
})

test("ADT URI builder normalizes the authority", () => {
  assert.equal(
    toAdtResourceUri(" dev100 ", "/sap/bc/adt/oo/classes/zcl_demo/source/main"),
    "adt://dev100/sap/bc/adt/oo/classes/zcl_demo/source/main"
  )
})

test("ADT URI builder uses WHATWG path canonicalization without decoding encoded slashes", () => {
  assert.equal(
    toAdtResourceUri("DEV100", "/sap/bc/adt/oo/classes/%2Fns%2Fzcl demo"),
    "adt://dev100/sap/bc/adt/oo/classes/%2Fns%2Fzcl%20demo"
  )
})

test("ADT URI builder rejects path input that changes the authority", () => {
  assertInvalid(() => toAdtResourceUri(
    "DEV100",
    "evil/sap/bc/adt/oo/classes/zcl_demo"
  ))
})

test("ADT URI parser preserves encoded ABAP path segment boundaries", () => {
  assert.deepEqual(
    parseAdtResourceUri("adt://dev100/sap/bc/adt/oo/classes/%2Fns%2Fzcl_demo"),
    {
      systemId: "DEV100",
      adtPath: "/sap/bc/adt/oo/classes/%2Fns%2Fzcl_demo",
      canonicalUri: "adt://dev100/sap/bc/adt/oo/classes/%2Fns%2Fzcl_demo"
    }
  )
})

test("ADT URI parser canonicalizes scheme, authority, and spaces", () => {
  assert.deepEqual(
    parseAdtResourceUri("ADT://DEV100/sap/bc/adt/oo/classes/zcl demo"),
    {
      systemId: "DEV100",
      adtPath: "/sap/bc/adt/oo/classes/zcl%20demo",
      canonicalUri: "adt://dev100/sap/bc/adt/oo/classes/zcl%20demo"
    }
  )
})

test("ADT URI functions preserve trailing path spaces as encoded data", () => {
  const canonicalUri = "adt://dev100/sap/bc/adt/oo/classes/zcl_demo%20"

  assert.equal(
    toAdtResourceUri("DEV100", "/sap/bc/adt/oo/classes/zcl_demo "),
    canonicalUri
  )
  assert.deepEqual(
    parseAdtResourceUri("adt://dev100/sap/bc/adt/oo/classes/zcl_demo "),
    {
      systemId: "DEV100",
      adtPath: "/sap/bc/adt/oo/classes/zcl_demo%20",
      canonicalUri
    }
  )
})

test("URI parsers reject raw WHATWG preprocessing characters", () => {
  for (const character of ["\t", "\n", "\r"]) {
    assertInvalid(() => parseAdtResourceUri(
      `adt://dev${character}100/sap/bc/adt/oo/classes/zcl_demo`
    ))
    assertInvalid(() => parseCapabilityResourceUri(
      `sap-capability://dev${character}100`
    ))
  }
})

test("ADT URI parser rejects a leading NUL", () => {
  assertInvalid(() => parseAdtResourceUri(
    "\u0000adt://dev100/sap/bc/adt/oo/classes/zcl_demo"
  ))
})

test("ADT URI parser rejects a trailing form feed", () => {
  assertInvalid(() => parseAdtResourceUri(
    "adt://dev100/sap/bc/adt/oo/classes/zcl_demo\u000c"
  ))
})

test("ADT URI builder rejects a trailing form feed", () => {
  assertInvalid(() => toAdtResourceUri(
    "DEV100",
    "/sap/bc/adt/oo/classes/zcl_demo\u000c"
  ))
})

test("capability URI parser rejects the upper C0 control boundary", () => {
  assertInvalid(() => parseCapabilityResourceUri(
    "sap-capability://dev100\u001f"
  ))
})

test("ADT URI functions reject non-ADT paths and malformed percent escapes", () => {
  for (const path of ["/not/adt", "/sap/bc/adt/oo/classes/%ZZ"]) {
    assertInvalid(() => toAdtResourceUri("DEV100", path))
  }

  for (const uri of [
    "adt://dev100/not/adt",
    "adt://dev100/sap/bc/adt/oo/classes/%ZZ"
  ]) {
    assertInvalid(() => parseAdtResourceUri(uri))
  }
})

test("ADT URI parser rejects query, fragment, credentials, port, and wrong scheme", () => {
  for (const uri of [
    "adt://dev100/sap/bc/adt/oo/classes/zcl_demo?version=active",
    "adt://dev100/sap/bc/adt/oo/classes/zcl_demo#source",
    "adt://user@dev100/sap/bc/adt/oo/classes/zcl_demo",
    "adt://user:secret@dev100/sap/bc/adt/oo/classes/zcl_demo",
    "adt://dev100:443/sap/bc/adt/oo/classes/zcl_demo",
    "https://dev100/sap/bc/adt/oo/classes/zcl_demo"
  ]) {
    assertInvalid(() => parseAdtResourceUri(uri))
  }
})

test("ADT URI parser rejects a non-canonical profile authority", () => {
  assertInvalid(() => parseAdtResourceUri(
    "adt://dev.100/sap/bc/adt/oo/classes/zcl_demo"
  ))
})

test("ADT URI parser rejects explicit empty userinfo and port syntax", () => {
  for (const uri of [
    "adt://@dev100/sap/bc/adt/oo/classes/zcl_demo",
    "adt://:@dev100/sap/bc/adt/oo/classes/zcl_demo",
    "adt://dev100:/sap/bc/adt/oo/classes/zcl_demo"
  ]) {
    assertInvalid(() => parseAdtResourceUri(uri))
  }
})

test("capability URI builder and parser use canonical system identities", () => {
  assert.equal(toCapabilityResourceUri("DEV100"), "sap-capability://dev100")
  assert.deepEqual(parseCapabilityResourceUri("SAP-CAPABILITY://DEV100"), {
    systemId: "DEV100",
    canonicalUri: "sap-capability://dev100"
  })
})

test("capability URI parser rejects authority-changing and extra components", () => {
  for (const uri of [
    "sap-capability://dev.100",
    "sap-capability://user@dev100",
    "sap-capability://user:secret@dev100",
    "sap-capability://dev100:443",
    "sap-capability://dev100/path",
    "sap-capability://dev100?detail=true",
    "sap-capability://dev100#detail",
    "sap-capability://dev%ZZ",
    "adt://dev100"
  ]) {
    assertInvalid(() => parseCapabilityResourceUri(uri))
  }
})

test("capability URI parser rejects explicit empty userinfo and port syntax", () => {
  for (const uri of [
    "sap-capability://@dev100",
    "sap-capability://:@dev100",
    "sap-capability://dev100:"
  ]) {
    assertInvalid(() => parseCapabilityResourceUri(uri))
  }
})

test("transport, evidence, and documentation URIs canonicalize exact identities", () => {
  assert.deepEqual(
    parseTransportResourceUri("SAP-TRANSPORT://DEV100/devk900001"),
    {
      systemId: "DEV100",
      transport: "DEVK900001",
      canonicalUri: "sap-transport://dev100/DEVK900001"
    }
  )
  assert.deepEqual(
    parseEvidenceResourceUri("SAP-EVIDENCE://RUN-1/Artifact-2"),
    {
      runId: "run-1",
      artifact: "artifact-2",
      canonicalUri: "sap-evidence://run-1/artifact-2"
    }
  )
  assert.deepEqual(parseDocsResourceUri("SAP-DOCS://DATA-QUERY"), {
    family: "data-query",
    canonicalUri: "sap-docs://data-query"
  })
  assert.deepEqual(parseDocsResourceUri("SAP-DOCS://MERMAID/Flowchart"), {
    family: "mermaid",
    document: "flowchart",
    canonicalUri: "sap-docs://mermaid/flowchart"
  })
})

test("new v1 Resource URI families reject ambiguous or extra components", () => {
  for (const uri of [
    "sap-transport://dev100/a/b",
    "sap-transport://user@dev100/DEVK900001",
    "sap-evidence://run-1/artifact?raw=true",
    "sap-evidence://run.1/artifact",
    "sap-docs://data-query/extra",
    "sap-docs://unknown/document"
  ]) {
    assertInvalid(() => {
      if (uri.startsWith("sap-transport:")) return parseTransportResourceUri(uri)
      if (uri.startsWith("sap-evidence:")) return parseEvidenceResourceUri(uri)
      return parseDocsResourceUri(uri)
    })
  }
})

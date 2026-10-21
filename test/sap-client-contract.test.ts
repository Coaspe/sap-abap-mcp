import assert from "node:assert/strict"
import test from "node:test"
import { AdtErrorException } from "abap-adt-api"
import {
  createObject as upstreamCreateObject,
  validateNewObject as upstreamValidateNewObject
} from "abap-adt-api/build/api/objectcreator.js"
import { XMLParser } from "fast-xml-parser"
import { AppError } from "../src/errors.js"
import {
  ADT_FAILURE_EVIDENCE_BYTE_LIMIT,
  AdtSapClient,
  adtFailureEvidence
} from "../src/sap-client.js"
import type { SapProfile } from "../src/profile-store.js"

const profile: SapProfile = {
  id: "DEV100",
  url: "https://sap.example.test",
  client: "100",
  language: "EN",
  environment: "development",
  authType: "basic",
  username: "DEVELOPER",
  allowedPackages: ["Z_DEMO"]
}

test("platform components alone do not identify ECC", async () => {
  for (const [components, expected] of [
    [["SAP_BASIS"], "Unknown"], [[], "Unknown"],
    [["SAP_BASIS", "SAP_ABA"], "Unknown"], [["SAP_APPL", "SAP_BASIS"], "ECC"],
    [["S4CORE", "SAP_BASIS"], "S/4HANA"], [["S4COREOP", "SAP_APPL"], "S/4HANA"]
  ] as const) {
    const client = clientWithAdt({ async runQuery(sql: string) {
      return { values: sql.includes("FROM CVERS") ? components.map(COMPONENT => ({ COMPONENT })) : [] }
    } })
    const system = await client.getSystemInfo(true, 0)
    assert.equal(system.systemType, expected, components.join(","))
  }
})

test("source patch refuses a changed current version under the acquired lock", async () => {
  const calls: string[] = []
  const client = clientWithAdt({ stateful: "stateless",
    lock: async () => { calls.push("lock"); return { LOCK_HANDLE: "LOCK" } },
    getObjectSource: async (_uri: string, options?: { version?: string }) => {
      const version = options?.version ?? "current"
      calls.push(version)
      return version === "active" ? "REPORT original." : "REPORT other_work."
    },
    setObjectSource: async () => { calls.push("write") },
    statelessClone: { syntaxCheck: async () => [] },
    unLock: async () => { calls.push("unlock") }
  })
  await assert.rejects(client.replaceSource("Z_DEMO", "/object", "/object/source/main",
    "REPORT original.", "REPORT changed."), { code: "SOURCE_CHANGED" })
  assert.deepEqual(calls, ["lock", "current", "unlock"])
})

test("two source patches without activation continue from the current inactive source", async () => {
  const uri = "/sap/bc/adt/programs/programs/z_demo/source/main"
  const active = "REPORT original."
  let inactive: string | undefined
  const versions: Array<string | undefined> = []
  const read = (version?: string) => {
    versions.push(version)
    return version === "active" ? active : inactive ?? active
  }
  const client = clientWithAdt({
    stateful: "stateless",
    httpClient: { request: async (_uri: string, options?: { qs?: { version?: string } }) =>
      ({ body: read(options?.qs?.version), status: 200, headers: {} }) },
    lock: async () => ({ LOCK_HANDLE: "LOCK" }),
    getObjectSource: async (_uri: string, options?: { version?: string }) => read(options?.version),
    setObjectSource: async (_uri: string, source: string) => { inactive = source },
    statelessClone: { syntaxCheck: async () => [] },
    unLock: async () => undefined
  })
  const first = await client.readSourceByUri(uri)
  await client.replaceSource("Z_DEMO", "/object", uri, first.source, "REPORT first_patch.")
  const second = await client.readSourceByUri(uri)
  assert.equal(second.source, "REPORT first_patch.")
  await client.replaceSource("Z_DEMO", "/object", uri, second.source, "REPORT second_patch.")
  assert.equal(inactive, "REPORT second_patch.")
  assert.equal(active, "REPORT original.")
  assert.deepEqual(versions, [undefined, undefined, undefined, undefined])
})

test("function-module patch does not probe missing inactive source and invalidate its lock", async () => {
  const calls: string[] = []
  let locked = false
  const client = clientWithAdt({
    stateful: "stateless",
    lock: async () => { locked = true; calls.push("lock"); return { LOCK_HANDLE: "LOCK" } },
    getObjectSource: async (_uri: string, options?: { version?: string }) => {
      calls.push(`read:${options?.version ?? "current"}`)
      // Model the reported backend's 200 response that also drops the FM lock.
      if (options?.version === "inactive") locked = false
      return "FUNCTION z_demo. ENDFUNCTION."
    },
    setObjectSource: async () => { assert.equal(locked, true, "invalid lock handle"); calls.push("write") },
    statelessClone: { syntaxCheck: async () => { calls.push("syntax"); return [] } },
    unLock: async () => { locked = false; calls.push("unlock") }
  })
  await client.replaceSource("Z_DEMO", "/sap/bc/adt/functions/groups/zgroup/fmodules/z_demo",
    "/sap/bc/adt/functions/groups/zgroup/fmodules/z_demo/source/main",
    "FUNCTION z_demo. ENDFUNCTION.", "FUNCTION z_demo. RETURN. ENDFUNCTION.")
  assert.deepEqual(calls, ["lock", "read:current", "write", "syntax", "unlock"])
})

test("source patch releases its edit lock before activation", async () => {
  const calls: string[] = []
  let locked = false
  const adt = {
    stateful: "stateless",
    lock: async () => { locked = true; calls.push("lock"); return { LOCK_HANDLE: "LOCK" } },
    getObjectSource: async () => "REPORT original.",
    setObjectSource: async () => { calls.push("write") },
    statelessClone: { syntaxCheck: async () => { calls.push("syntax"); return [] } },
    unLock: async () => { locked = false; calls.push("unlock") },
    activate: async () => {
      assert.equal(locked, false, "object is currently editing")
      calls.push("activate")
      return activationResult
    }
  }
  const result = await clientWithAdt(adt).replaceSource("Z_DEMO", "/object", "/object/source/main",
    "REPORT original.", "REPORT edited.", undefined, true)
  assert.deepEqual(calls, ["lock", "write", "syntax", "unlock", "activate"])
  assert.deepEqual(result, { diagnostics: [], activation: activationResult, activationSkipped: false })
  assert.equal(adt.stateful, "stateless")
})

test("source patch with syntax errors unlocks and skips activation", async () => {
  const calls: string[] = []
  const diagnostics = [{ severity: "E", text: "Syntax error" }]
  const client = clientWithAdt({
    stateful: "stateless",
    lock: async () => ({ LOCK_HANDLE: "LOCK" }),
    getObjectSource: async () => "REPORT original.",
    setObjectSource: async () => { calls.push("write") },
    statelessClone: { syntaxCheck: async () => diagnostics },
    unLock: async () => { calls.push("unlock") },
    activate: async () => { calls.push("activate"); return activationResult }
  })
  const result = await client.replaceSource("Z_DEMO", "/object", "/object/source/main",
    "REPORT original.", "invalid ABAP", undefined, true)
  assert.deepEqual(calls, ["write", "unlock"])
  assert.deepEqual(result, { diagnostics, activationSkipped: true })
})

test("source patch never activates when releasing the edit lock fails", async () => {
  const failure = new Error("Unlock failed")
  let activations = 0
  const adt = {
    stateful: "stateless",
    lock: async () => ({ LOCK_HANDLE: "LOCK" }),
    getObjectSource: async () => "REPORT original.",
    setObjectSource: async () => undefined,
    statelessClone: { syntaxCheck: async () => [] },
    unLock: async () => { throw failure },
    activate: async () => { activations++; return activationResult }
  }
  await assert.rejects(clientWithAdt(adt).replaceSource("Z_DEMO", "/object", "/object/source/main",
    "REPORT original.", "REPORT edited.", undefined, true), error => error === failure)
  assert.equal(activations, 0)
  assert.equal(adt.stateful, "stateless")
})

for (const version of ["V2", "V4"] as const) {
  for (const category of ["0", "1"] as const) {
    test(`binding creation sends ${version} category ${category} in the actual XML`, async () => {
      const requests: Array<{ url: string; config: any }> = []
      const httpClient = {
        username: "DEVELOPER",
        async request(url: string, config: any) {
          requests.push({ url, config })
          return { body: "", status: 201, statusText: "Created", headers: {} }
        }
      }
      const client = clientWithAdt({
        httpClient,
        // Exercise the real dependency if the wrapper accidentally delegates again.
        createObject: (options: any) => upstreamCreateObject(httpClient as any, options)
      })
      await client.createObject({
        objtype: "SRVB/SVB", name: "ZUI_TEST", parentName: "Z_DEMO",
        parentPath: "/sap/bc/adt/packages/z_demo", description: 'UI & API "test" <safe>',
        service: "Z_TEST", bindingtype: "ODATA", category, bindingVersion: version,
        transport: "DEVK900123", language: "EN"
      })
      assert.equal(requests.length, 1)
      const { url, config } = requests[0]!
      assert.equal(url, "/sap/bc/adt/businessservices/bindings")
      assert.equal(config.method, "POST")
      assert.deepEqual(config.qs, { corrNr: "DEVK900123" })
      const root = new XMLParser({ ignoreAttributes: false }).parse(config.body)["srvb:serviceBinding"]
      assert.equal(root["@_adtcore:description"], 'UI & API "test" <safe>')
      assert.equal(root["@_adtcore:responsible"], "DEVELOPER")
      assert.equal(root["adtcore:packageRef"]["@_adtcore:name"], "Z_DEMO")
      assert.equal(root["srvb:services"]["srvb:content"]["srvb:serviceDefinition"]["@_adtcore:name"], "Z_TEST")
      assert.equal(root["srvb:binding"]["@_srvb:type"], "ODATA")
      assert.equal(root["srvb:binding"]["@_srvb:category"], category)
      assert.equal(root["srvb:binding"]["@_srvb:version"], version)
    })
  }
}

test("binding creation defaults to V2 and propagates rejection without retrying or falling back", async () => {
  let calls = 0
  const client = clientWithAdt({ httpClient: { async request(_url: string, config: any) {
    calls += 1
    assert.match(config.body, /srvb:version="V2"/)
    assert.match(config.body, /srvb:category="1"/)
    assert.deepEqual(config.qs, {})
    throw new Error("SAP rejected binding")
  } } })
  await assert.rejects(client.createObject({
    objtype: "SRVB/SVB", name: "Z_TEST", parentName: "$TMP", parentPath: "/package",
    description: "Test", service: "Z_TEST", bindingtype: "ODATA", category: "1"
  }), /SAP rejected binding/)
  assert.equal(calls, 1)
})

test("V4 validation reaches the dependency HTTP query without being rewritten to V2", async () => {
  const requests: Array<{ url: string; config: any }> = []
  const http = { async request(url: string, config: any) {
    requests.push({ url, config })
    return { body: '<asx:abap xmlns:asx="http://www.sap.com/abapxml"><asx:values><DATA><SEVERITY>S</SEVERITY><CHECK_RESULT>X</CHECK_RESULT></DATA></asx:values></asx:abap>' }
  } }
  const client = clientWithAdt({
    validateNewObject: (options: any) => upstreamValidateNewObject(http as any, options)
  })
  const result = await client.validateNewObject({
    objtype: "SRVB/SVB", objname: "ZUI_TEST", description: "Test", package: "$TMP",
    serviceDefinition: "Z_TEST", serviceBindingVersion: "ODATA\\V4"
  })
  assert.equal(result.success, true)
  assert.equal(requests.length, 1)
  assert.equal(requests[0]!.url, "/sap/bc/adt/businessservices/bindings/validation")
  assert.equal(requests[0]!.config.qs.serviceBindingVersion, "ODATA\\V4")
})

function clientWithAdt(
  fakeAdt: Record<string, unknown>,
  clientProfile: SapProfile = profile
): AdtSapClient {
  const client = new AdtSapClient(clientProfile, "secret")
  Object.defineProperty(client, "client", { value: fakeAdt })
  return client
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

const firstInactiveObject: import("abap-adt-api").InactiveObject = {
  "adtcore:uri": "/first",
  "adtcore:type": "CLAS/OC",
  "adtcore:name": "ZCL_FIRST",
  "adtcore:parentUri": ""
}

const secondInactiveObject: import("abap-adt-api").InactiveObject = {
  "adtcore:uri": "/second",
  "adtcore:type": "CLAS/OC",
  "adtcore:name": "ZCL_SECOND",
  "adtcore:parentUri": ""
}

const activationResult: import("abap-adt-api").ActivationResult = {
  success: true,
  messages: [],
  inactive: []
}

test("semantic and refactoring wrappers preserve ADT 1-based line and 0-based columns", async () => {
  const calls: Array<{ method: string; args: unknown[] }> = []
  const fakeAdt: any = {
    codeCompletion: async (...args: unknown[]) => {
      calls.push({ method: "codeCompletion", args })
      return []
    },
    findDefinition: async (...args: unknown[]) => {
      calls.push({ method: "findDefinition", args })
      return { url: "/definition", line: 9, column: 2 }
    },
    fixProposals: async (...args: unknown[]) => {
      calls.push({ method: "fixProposals", args })
      return []
    },
    renameEvaluate: async (...args: unknown[]) => {
      calls.push({ method: "renameEvaluate", args })
      return { oldName: "OLD" }
    },
    extractMethodEvaluate: async (...args: unknown[]) => {
      calls.push({ method: "extractMethodEvaluate", args })
      return { name: "" }
    }
  }
  fakeAdt.statelessClone = fakeAdt
  const client = clientWithAdt(fakeAdt)

  await client.getCodeCompletions("/source", "WRITE x.", 7, 3)
  await client.findDefinition("/source", "WRITE x.", 7, 3, 8, true, "/main")
  await client.getQuickFixes("/source", "WRITE x.", 7, 3)
  await client.evaluateRename("/source", 7, 3, 8)
  await client.evaluateExtractMethod("/source", {
    start: { line: 7, column: 3 },
    end: { line: 9, column: 1 }
  })

  assert.deepEqual(calls, [
    { method: "codeCompletion", args: ["/source", "WRITE x.", 7, 3] },
    { method: "findDefinition", args: ["/source", "WRITE x.", 7, 3, 8, true, "/main"] },
    { method: "fixProposals", args: ["/source", "WRITE x.", 7, 3] },
    { method: "renameEvaluate", args: ["/source", 7, 3, 8] },
    {
      method: "extractMethodEvaluate",
      args: ["/source", { start: { line: 7, column: 3 }, end: { line: 9, column: 1 } }]
    }
  ])
})

test("inactive source reads pass the inactive version to both ADT structure and source calls", async () => {
  const calls: Array<{ method: string; args: unknown[] }> = []
  const fakeAdt: any = {
    objectStructure: async (...args: unknown[]) => {
      calls.push({ method: "objectStructure", args })
      return {
        objectUrl: "/sap/bc/adt/programs/programs/z_demo",
        metaData: {
          "adtcore:type": "PROG/P",
          "abapsource:sourceUri": "source/main"
        },
        links: []
      }
    },
    httpClient: { request: async (...args: unknown[]) => {
      calls.push({ method: "request", args })
      return { body: "REPORT z_demo.", status: 200, headers: {} }
    } }
  }
  const client = clientWithAdt(fakeAdt)
  const result = await client.readSourceByUri(
    "/sap/bc/adt/programs/programs/z_demo",
    "inactive"
  )

  assert.equal(result.source, "REPORT z_demo.")
  assert.deepEqual(calls, [
    {
      method: "objectStructure",
      args: ["/sap/bc/adt/programs/programs/z_demo", "inactive"]
    },
    {
      method: "request",
      args: [
        "/sap/bc/adt/programs/programs/z_demo/source/main",
        { qs: { version: "inactive" } }
      ]
    }
  ])
})

test("explicit class include reads never redirect through object structure and still revalidate ETags", async () => {
  for (const suffix of ["source/main", "includes/definitions", "includes/implementations", "includes/testclasses"]) {
    const uri = `/sap/bc/adt/oo/classes/%2Fabc%2Fcl_demo/${suffix}`
    const calls: Array<{ uri: string; options: any }> = []
    const client = clientWithAdt({
      objectStructure: async () => { throw new Error("Explicit source must not perform structure discovery") },
      httpClient: { request: async (uri: string, options: any) => {
        calls.push({ uri, options })
        return calls.length === 1
          ? { body: "CLASS lcl_demo DEFINITION. ENDCLASS.", status: 200, headers: { etag: '"v1"' } }
          : { body: "", status: 304, headers: { etag: '"v1"' } }
      } }
    })
    const first = await client.readSourceByUri(uri, "inactive")
    const second = await client.readSourceByUri(uri, "inactive")
    assert.deepEqual(second, first)
    assert.equal(first.sourceUri, uri)
    assert.equal(calls.length, 2)
    assert.ok(calls.every(call => call.uri === uri && call.options.qs.version === "inactive"))
    assert.equal(calls[1]!.options.headers["If-None-Match"], '"v1"')
  }
})

test("explicit include failures propagate without falling back to main source", async () => {
  for (const status of [401, 403, 404, 429, 500]) {
    const error = AdtErrorException.create(status, {}, "", "Source unavailable")
    let calls = 0
    const client = clientWithAdt({
      objectStructure: async () => { throw new Error("Unexpected structure discovery") },
      httpClient: { request: async () => { calls++; throw error } }
    })
    await assert.rejects(client.readSourceByUri("/sap/bc/adt/oo/classes/zcl_demo/includes/definitions"), actual => actual === error)
    assert.equal(calls, 1)
  }
})

test("source mutation rechecks under lock without cache and clears cached source on failure", async () => {
  const uri = "/sap/bc/adt/programs/programs/z_demo/source/main"
  const readHeaders: unknown[] = []
  let lockedReads = 0
  let writes = 0
  const client = clientWithAdt({
    stateful: "stateless",
    objectStructure: async () => { throw new Error("use source URI") },
    httpClient: { request: async (_uri: string, options: { headers?: unknown }) => {
      readHeaders.push(options.headers)
      return { body: "REPORT original.", status: 200, headers: { etag: '"v1"' } }
    } },
    lock: async () => ({ LOCK_HANDLE: "LOCK" }),
    getObjectSource: async () => { lockedReads += 1; return "REPORT another_user_edit." },
    setObjectSource: async () => { writes += 1 },
    unLock: async () => undefined
  })
  await client.readSourceByUri(uri)
  await assert.rejects(client.replaceSource("Z_DEMO", uri.replace("/source/main", ""), uri,
    "REPORT original.", "REPORT edited."), { code: "SOURCE_CHANGED" })
  await client.readSourceByUri(uri)
  assert.equal(lockedReads, 1)
  assert.equal(writes, 0)
  assert.deepEqual(readHeaders, [undefined, undefined])
})

test("activation invalidates both source versions", async () => {
  const headers: unknown[] = []
  const client = clientWithAdt({
    objectStructure: async () => { throw new Error("use source URI") },
    httpClient: { request: async (_uri: string, options: { headers?: unknown }) => {
      headers.push(options.headers)
      return { body: "REPORT demo.", status: 200, headers: { etag: '"v1"' } }
    } },
    activate: async () => activationResult
  })
  const uri = "/sap/bc/adt/programs/programs/z_demo/source/main"
  await client.readSourceByUri(uri, "active")
  await client.readSourceByUri(uri, "inactive")
  await client.activateObject("Z_DEMO", uri)
  await client.readSourceByUri(uri, "active")
  await client.readSourceByUri(uri, "inactive")
  assert.deepEqual(headers, [undefined, undefined, undefined, undefined])
})

test("delete uses stateful lock, rechecks the preview fingerprint, deletes, and unlocks", async () => {
  const calls: Array<{ method: string; args: unknown[] }> = []
  const fakeAdt: any = {
    stateful: "stateless",
    lock: async (...args: unknown[]) => {
      calls.push({ method: "lock", args })
      return { LOCK_HANDLE: "LOCK-1" }
    },
    deleteObject: async (...args: unknown[]) => {
      calls.push({ method: "deleteObject", args })
    },
    unLock: async (...args: unknown[]) => {
      calls.push({ method: "unLock", args })
    }
  }
  const client = clientWithAdt(fakeAdt)
  Object.defineProperty(client, "getObjectFingerprint", {
    value: async (...args: unknown[]) => {
      calls.push({ method: "getObjectFingerprint", args })
      return { fingerprint: "EXPECTED" }
    }
  })

  await client.deleteObject("/object", "EXPECTED", "DEVK900123")
  assert.deepEqual(calls, [
    { method: "lock", args: ["/object"] },
    { method: "getObjectFingerprint", args: ["/object"] },
    { method: "deleteObject", args: ["/object", "LOCK-1", "DEVK900123"] },
    { method: "unLock", args: ["/object", "LOCK-1"] }
  ])
  assert.equal(fakeAdt.stateful, "stateless")
})

test("delete refuses a stale preview and still unlocks without issuing DELETE", async () => {
  const calls: string[] = []
  const fakeAdt: any = {
    stateful: "stateless",
    lock: async () => {
      calls.push("lock")
      return { LOCK_HANDLE: "LOCK-1" }
    },
    deleteObject: async () => calls.push("delete"),
    unLock: async () => calls.push("unlock")
  }
  const client = clientWithAdt(fakeAdt)
  Object.defineProperty(client, "getObjectFingerprint", {
    value: async () => ({ fingerprint: "CHANGED" })
  })

  await assert.rejects(client.deleteObject("/object", "EXPECTED"), error =>
    typeof error === "object" && error !== null && "code" in error && error.code === "OBJECT_CHANGED"
  )
  assert.deepEqual(calls, ["lock", "unlock"])
  assert.equal(fakeAdt.stateful, "stateless")
})

test("transport, abapGit, and RAP wrappers preserve upstream argument order", async () => {
  const calls: Array<{ method: string; args: unknown[] }> = []
  const fakeAdt: any = {
    transportDelete: async (...args: unknown[]) => calls.push({ method: "transportDelete", args }),
    transportSetOwner: async (...args: unknown[]) => {
      calls.push({ method: "transportSetOwner", args })
      return {}
    },
    transportAddUser: async (...args: unknown[]) => {
      calls.push({ method: "transportAddUser", args })
      return {}
    },
    transportReference: async (...args: unknown[]) => {
      calls.push({ method: "transportReference", args })
      return "/object"
    },
    gitCreateRepo: async (...args: unknown[]) => {
      calls.push({ method: "gitCreateRepo", args })
      return []
    },
    gitPullRepo: async (...args: unknown[]) => {
      calls.push({ method: "gitPullRepo", args })
      return []
    },
    gitUnlinkRepo: async (...args: unknown[]) => calls.push({ method: "gitUnlinkRepo", args }),
    stageRepo: async (...args: unknown[]) => {
      calls.push({ method: "stageRepo", args })
      return { staged: [], unstaged: [], ignored: [] }
    },
    pushRepo: async (...args: unknown[]) => calls.push({ method: "pushRepo", args }),
    checkRepo: async (...args: unknown[]) => calls.push({ method: "checkRepo", args }),
    switchRepoBranch: async (...args: unknown[]) => calls.push({ method: "switchRepoBranch", args }),
    rapGenValidateInitial: async (...args: unknown[]) => {
      calls.push({ method: "rapGenValidateInitial", args })
      return { severity: "ok", shortText: "OK" }
    },
    rapGenValidateContent: async (...args: unknown[]) => {
      calls.push({ method: "rapGenValidateContent", args })
      return { severity: "ok", shortText: "OK" }
    },
    rapGenPreview: async (...args: unknown[]) => {
      calls.push({ method: "rapGenPreview", args })
      return []
    },
    rapGenGenerate: async (...args: unknown[]) => {
      calls.push({ method: "rapGenGenerate", args })
      return []
    },
    rapGenPublishService: async (...args: unknown[]) => {
      calls.push({ method: "rapGenPublishService", args })
      return { severity: "ok", shortText: "OK" }
    },
    unPublishServiceBinding: async (...args: unknown[]) => {
      calls.push({ method: "unPublishServiceBinding", args })
      return { severity: "I", shortText: "OK", longText: "" }
    }
  }
  const client = clientWithAdt(fakeAdt)
  const content: any = {
    general: { description: "Demo" },
    businessObject: {
      dataModelEntity: { cdsName: "ZI_DEMO" },
      behavior: { implementationType: "managed", implementationClass: "ZBP_I_DEMO", draftTable: "" }
    },
    serviceProjection: { name: "ZC_DEMO" },
    businessService: {
      serviceDefinition: { name: "ZUI_DEMO" },
      serviceBinding: { name: "ZUI_DEMO_O4", bindingType: "OData V4 - UI" }
    }
  }
  const repository: any = { key: "REPO-1", url: "https://example.test/repo.git" }
  const staging: any = { staged: [], unstaged: [], ignored: [] }

  await client.deleteTransport("DEVK900123")
  await client.setTransportOwner("DEVK900123", "OWNER")
  await client.addTransportUser("DEVK900123", "USER")
  await client.resolveTransportObject("R3TR", "CLAS", "ZCL_DEMO", "DEVK900123")
  await client.createGitRepository(
    "Z_DEMO", "https://example.test/repo.git", "main", "DEVK900123", "git-user", "token"
  )
  await client.pullGitRepository("REPO-1", "main", "DEVK900123", "git-user", "token")
  await client.unlinkGitRepository("REPO-1")
  await client.stageGitRepository(repository, "git-user", "token")
  await client.pushGitRepository(repository, staging, "git-user", "token")
  await client.checkGitRepository(repository, "git-user", "token")
  await client.switchGitBranch(repository, "feature", true, "git-user", "token")
  await client.validateRapGeneratorInitial("uiservice", "/reference", "Z_DEMO")
  await client.validateRapGeneratorContent("uiservice", "/reference", content)
  await client.previewRapGenerator("uiservice", "/reference", content)
  await client.generateRapObjects("uiservice", "/reference", "DEVK900123", content)
  await client.publishRapService("ZUI_DEMO_O4")
  await client.unpublishServiceBinding("ZUI_DEMO", "1")

  assert.deepEqual(calls, [
    { method: "transportDelete", args: ["DEVK900123"] },
    { method: "transportSetOwner", args: ["DEVK900123", "OWNER"] },
    { method: "transportAddUser", args: ["DEVK900123", "USER"] },
    { method: "transportReference", args: ["R3TR", "CLAS", "ZCL_DEMO", "DEVK900123"] },
    {
      method: "gitCreateRepo",
      args: ["Z_DEMO", "https://example.test/repo.git", "main", "DEVK900123", "git-user", "token"]
    },
    {
      method: "gitPullRepo",
      args: ["REPO-1", "main", "DEVK900123", "git-user", "token"]
    },
    { method: "gitUnlinkRepo", args: ["REPO-1"] },
    { method: "stageRepo", args: [repository, "git-user", "token"] },
    { method: "pushRepo", args: [repository, staging, "git-user", "token"] },
    { method: "checkRepo", args: [repository, "git-user", "token"] },
    { method: "switchRepoBranch", args: [repository, "feature", true, "git-user", "token"] },
    { method: "rapGenValidateInitial", args: ["uiservice", "/reference", "Z_DEMO"] },
    { method: "rapGenValidateContent", args: ["uiservice", "/reference", content] },
    { method: "rapGenPreview", args: ["uiservice", "/reference", content] },
    {
      method: "rapGenGenerate",
      args: ["uiservice", "/reference", "DEVK900123", content]
    },
    { method: "rapGenPublishService", args: ["ZUI_DEMO_O4"] },
    { method: "unPublishServiceBinding", args: ["ZUI_DEMO", "1"] }
  ])
})

const releasedReport = (transportNumber: string) =>
  `<?xml version="1.0" encoding="utf-8"?>` +
  `<tm:root xmlns:tm="http://www.sap.com/cts/adt/tm" xmlns:chkrun="http://www.sap.com/adt/checkrun" ` +
  `tm:number="${transportNumber}" tm:useraction="newreleasejobs">` +
  `<tm:releasereports>` +
  `<chkrun:checkReport chkrun:reporter="transportrelease" chkrun:status="released" chkrun:statusText="Released">` +
  `<chkrun:checkMessageList/>` +
  `</chkrun:checkReport>` +
  `</tm:releasereports>` +
  `</tm:root>`

test("releasing a transport creates an ATC worklist and releases open non-empty tasks first", async () => {
  const requests: Array<{ url: string; config: any }> = []
  const atcCalls: string[] = []
  const fakeAdt: any = {
    transportDetails: async (transportNumber: string) => ({
      "tm:number": transportNumber,
      "tm:status": "D",
      objects: [],
      tasks: [
        { "tm:number": "DEVK900124", "tm:status": "D", objects: [{ "tm:pgmid": "R3TR" }] },
        { "tm:number": "DEVK900125", "tm:status": "D", objects: [] },
        { "tm:number": "DEVK900126", "tm:status": "R", objects: [{ "tm:pgmid": "R3TR" }] }
      ]
    }),
    atcCustomizing: async () => ({
      properties: [{ name: "systemCheckVariant", value: "ZLGE_CTS" }],
      excemptions: []
    }),
    atcCheckVariant: async (variant: string) => {
      atcCalls.push(variant)
      return "WORKLIST123"
    },
    httpClient: {
      request: async (url: string, config: any) => {
        requests.push({ url, config })
        const transportNumber = config.method === "POST" ? /transportrequests\/([A-Z0-9]+)\//.exec(config.body)![1]!
          : /bgruns\/([A-Z0-9]+)/.exec(url)![1]!
        if (config.method === "POST") return { body: "", status: 202, statusText: "Accepted", headers: { location: `/sap/bc/adt/communication/bgruns/${transportNumber}` } }
        if (config.method === "DELETE") return { body: "", status: 204, statusText: "", headers: {} }
        if (url.endsWith("/result")) return { body: `HTTP/1.1 200 OK\r\nContent-Type: application/xml\r\n\r\n${releasedReport(transportNumber)}`, status: 200, statusText: "OK", headers: {} }
        return { body: `<runs:run xmlns:runs="http://www.sap.com/adt/runs" xmlns:atom="http://www.w3.org/2005/Atom" runs:status="finished"><atom:link href="${url}/result" rel="http://www.sap.com/adt/relations/runs/result" type="application/http"/></runs:run>`, status: 200, statusText: "OK", headers: {} }
      }
    }
  }
  const client = clientWithAdt(fakeAdt)

  const reports = await client.releaseTransport("DEVK900123")

  assert.deepEqual(atcCalls, ["ZLGE_CTS"])
  const submissions = requests.filter(request => request.config.method === "POST")
  assert.equal(submissions.length, 2)
  assert.ok(submissions.every(request => request.url === "/sap/bc/adt/communication/bgruns"))
  assert.match(submissions[0]!.config.body, /DEVK900124\/newreleasejobs\?worklistId=WORKLIST123 HTTP/)
  assert.match(submissions[1]!.config.body, /DEVK900123\/newreleasejobs\?worklistId=WORKLIST123 HTTP/)
  assert.equal(submissions[0]!.config.headers["Content-Type"], "application/http")
  assert.equal(reports.length, 2)
  assert.equal(reports[0]!["chkrun:status"], "released")
})

test("releasing with ignoreLocks confirms the follow-up action by echoing the tm:root attributes", async () => {
  const requests: Array<{ url: string; config: any }> = []
  const lockQuestion =
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<tm:root xmlns:tm="http://www.sap.com/cts/adt/tm" xmlns:chkrun="http://www.sap.com/adt/checkrun" ` +
    `tm:useraction="newreleasejobs" tm:releasetimestamp="20260724101525" tm:releaseobjlock="yes" tm:number="DEVK900123">` +
    `<tm:releasereports>` +
    `<chkrun:checkReport chkrun:reporter="transportrelease" chkrun:status="relwithignlock" ` +
    `chkrun:statusText="Not all objects in the request could be locked">` +
    `<chkrun:checkMessageList/>` +
    `</chkrun:checkReport>` +
    `</tm:releasereports>` +
    `</tm:root>`
  const fakeAdt: any = {
    transportDetails: async () => ({ "tm:number": "DEVK900123", "tm:status": "D", objects: [], tasks: [] }),
    atcCustomizing: async () => {
      throw new Error("no ATC release gate on this system")
    },
    httpClient: {
      request: async (url: string, config: unknown) => {
        requests.push({ url, config })
        return {
          body: url.includes("relwithignlock") ? releasedReport("DEVK900123") : lockQuestion,
          status: 200,
          statusText: "OK",
          headers: {}
        }
      }
    }
  }
  const client = clientWithAdt(fakeAdt)

  const reports = await client.releaseTransport("DEVK900123", true, false)

  assert.deepEqual(requests.map(request => request.url), [
    "/sap/bc/adt/cts/transportrequests/DEVK900123/newreleasejobs",
    "/sap/bc/adt/cts/transportrequests/DEVK900123/relwithignlock"
  ])
  assert.equal(requests[1]!.config.headers["Content-Type"], "text/plain")
  assert.match(requests[1]!.config.body, /tm:useraction="release"/)
  assert.match(requests[1]!.config.body, /tm:releasetimestamp="20260724101525"/)
  assert.match(requests[1]!.config.body, /tm:releaseobjlock="yes"/)
  assert.equal(reports.length, 1)
  assert.equal(reports[0]!["chkrun:status"], "released")
})

test("release follow-up actions are not confirmed without the matching ignore flag", async () => {
  const requests: string[] = []
  const atcQuestion =
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<tm:root xmlns:tm="http://www.sap.com/cts/adt/tm" xmlns:chkrun="http://www.sap.com/adt/checkrun" ` +
    `tm:useraction="newreleasejobs" tm:number="DEVK900123">` +
    `<tm:releasereports>` +
    `<chkrun:checkReport chkrun:reporter="transportrelease" chkrun:status="relObjigchkatc" ` +
    `chkrun:statusText="ATC findings exist">` +
    `<chkrun:checkMessageList/>` +
    `</chkrun:checkReport>` +
    `</tm:releasereports>` +
    `</tm:root>`
  const fakeAdt: any = {
    transportDetails: async () => ({ "tm:number": "DEVK900123", "tm:status": "D", objects: [], tasks: [] }),
    atcCustomizing: async () => {
      throw new Error("no ATC release gate on this system")
    },
    httpClient: {
      request: async (url: string) => {
        requests.push(url)
        return { body: atcQuestion, status: 200, statusText: "OK", headers: {} }
      }
    }
  }
  const client = clientWithAdt(fakeAdt)

  const reports = await client.releaseTransport("DEVK900123")

  assert.deepEqual(requests, ["/sap/bc/adt/cts/transportrequests/DEVK900123/newreleasejobs"])
  assert.equal(reports.length, 1)
  assert.equal(reports[0]!["chkrun:status"], "relObjigchkatc")
})

test("git operations surface an actionable message when the abapGit ADT backend is absent", async () => {
  const missing = () =>
    Promise.reject(new Error("Resource /sap/bc/adt/abapgit/repos does not exist."))
  const fakeAdt: any = {
    gitRepos: missing,
    gitPullRepo: missing,
    gitCreateRepo: missing
  }
  const client = clientWithAdt(fakeAdt)

  for (const call of [
    () => client.listGitRepositories(),
    () => client.pullGitRepository("REPO-1"),
    () => client.createGitRepository("Z_DEMO", "https://example.test/repo.git")
  ]) {
    await assert.rejects(call, (error: any) =>
      error?.code === "ABAPGIT_BACKEND_UNAVAILABLE" && /ADT_Backend/.test(error?.message ?? ""))
  }
})

test("object-bearing release submits only the background request and never retries synchronously after failure", async () => {
  const failure = Object.assign(new Error("Background submission failed"), { status: 500 })
  const requests: string[] = []
  const client = clientWithAdt({
    transportDetails: async () => ({ "tm:number": "DEVK900123", "tm:status": "D", objects: [{}], tasks: [] }),
    atcCustomizing: async () => { throw new Error("No ATC release gate") },
    httpClient: { request: async (url: string) => { requests.push(url); throw failure } }
  })
  await assert.rejects(client.releaseTransport("DEVK900123"), error => error === failure)
  assert.deepEqual(requests, ["/sap/bc/adt/communication/bgruns"])
})

test("ADT failure evidence is bounded and omits absent fields", () => {
  assert.deepEqual(adtFailureEvidence(undefined), {})
  assert.deepEqual(adtFailureEvidence({ response: { body: "   " } }), {})
  assert.deepEqual(adtFailureEvidence({ type: "", message: "" }), {})

  const long = adtFailureEvidence({
    response: { body: "x".repeat(ADT_FAILURE_EVIDENCE_BYTE_LIMIT + 500) },
    message: "y".repeat(2000)
  })
  assert.equal(long.sapResponseText?.length, ADT_FAILURE_EVIDENCE_BYTE_LIMIT)
  assert.equal(long.adtErrorMessage?.length, 1024)
  assert.equal(long.adtErrorType, undefined)
})

test("unpublishing a V4 binding posts its SCGR reference to the odatav4 unpublish jobs endpoint", async () => {
  const requests: Array<{ url: string; config: any }> = []
  const fakeAdt: any = {
    httpClient: {
      request: async (url: string, config: unknown) => {
        requests.push({ url, config })
        return {
          body:
            `<?xml version="1.0" encoding="utf-8"?>` +
            `<asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0"><asx:values><DATA>` +
            `<SEVERITY>S</SEVERITY><SHORT_TEXT>Unpublished</SHORT_TEXT>` +
            `</DATA></asx:values></asx:abap>`,
          status: 200,
          statusText: "OK",
          headers: {}
        }
      }
    }
  }
  const client = clientWithAdt(fakeAdt)

  const result = await client.unpublishRapService("ZUI_DEMO_O4")

  assert.equal(requests[0]!.url, "/sap/bc/adt/businessservices/odatav4/unpublishjobs")
  assert.equal(requests[0]!.config.method, "POST")
  assert.match(requests[0]!.config.body, /adtcore:objectReference adtcore:type="SCGR" adtcore:name="ZUI_DEMO_O4"/)
  assert.equal(result.severity, "s")
  assert.equal(result.shortText, "Unpublished")
})

test("inspecting an unpublished binding returns metadata without crashing on missing query links", async () => {
  const bindingXml =
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<srvb:serviceBinding xmlns:srvb="http://www.sap.com/adt/ddic/ServiceBindings" ` +
    `xmlns:adtcore="http://www.sap.com/adt/core" xmlns:atom="http://www.w3.org/2005/Atom" ` +
    `adtcore:name="ZUI_DEMO_O4" adtcore:type="SRVB/SVB" adtcore:description="Demo" ` +
    `adtcore:responsible="DEVELOPER" srvb:published="false" srvb:releaseSupported="false" srvb:repair="false" ` +
    `srvb:category="0">` +
    `<atom:link href="./zui_demo_o4/publishjobs" rel="http://www.sap.com/categories/publishjobs" title="Publish"/>` +
    `<atom:link href="./zui_demo_o4/unpublishjobs" rel="http://www.sap.com/categories/unpublishjobs" title="Unpublish"/>` +
    `<adtcore:packageRef adtcore:name="$TMP"/>` +
    `<srvb:services srvb:name="ZUI_DEMO">` +
    `<srvb:content srvb:version="0001" srvb:releaseState="">` +
    `<srvb:serviceDefinition adtcore:name="ZUI_DEMO"/>` +
    `</srvb:content>` +
    `</srvb:services>` +
    `<srvb:binding srvb:type="ODATA" srvb:version="V4" srvb:category="1">` +
    `<srvb:implementation adtcore:name="ZUI_DEMO"/>` +
    `</srvb:binding>` +
    `</srvb:serviceBinding>`
  const fakeAdt: any = {
    bindingDetails: async () => {
      throw new Error("bindingDetails must not be called for bindings without query links")
    },
    httpClient: {
      request: async () => ({ body: bindingXml, status: 200, statusText: "OK", headers: {} })
    }
  }
  const client = clientWithAdt(fakeAdt)

  const details = await client.getServiceBindingDetails("ZUI_DEMO_O4")

  assert.equal(details.binding.name, "ZUI_DEMO_O4")
  assert.equal(details.details, undefined)
})

test("adding an object by URI resolves its CTS key and uses the organizer PUT", async () => {
  const calls: Array<{ url: string; config: any }> = []
  const uri = "/sap/bc/adt/oo/classes/zcl_demo"
  const client = clientWithAdt({
    transportInfo: async (objectUri: string) => { assert.equal(objectUri, uri); return { PGMID: "R3TR", OBJECT: "CLAS", OBJECTNAME: "ZCL_DEMO" } },
    httpClient: { request: async (url: string, config: any) => { calls.push({ url, config }); return {} } }
  })
  await client.addTransportObject("DEVK900123", uri)
  assert.equal(calls.length, 1)
  assert.equal(calls[0]!.url, "/sap/bc/adt/cts/transportrequests/DEVK900123")
  assert.equal(calls[0]!.config.method, "PUT")
  assert.match(calls[0]!.config.body, /tm:pgmid="R3TR" tm:type="CLAS"/)
  assert.doesNotMatch(calls[0]!.url, /abaptransportcomponents/)
})

test("adding a transport subobject posts its CTS key to the organizer endpoint", async () => {
  const calls: Array<{ url: string; config: unknown }> = []
  const fakeAdt: any = {
    httpClient: {
      request: async (url: string, config: unknown) => {
        calls.push({ url, config })
        return { body: "", status: 200, statusText: "OK", headers: {} }
      }
    }
  }
  const client = clientWithAdt(fakeAdt)

  await client.addTransportObjectByKey(
    "DEVK900123",
    "LIMU",
    "DYNP",
    "ZDEMO_SCREEN 0100"
  )

  const mediaType = "application/vnd.sap.adt.transportorganizer.v1+xml"
  assert.deepEqual(calls, [{
    url: "/sap/bc/adt/cts/transportrequests/DEVK900123",
    config: {
      method: "PUT",
      headers: { Accept: mediaType, "Content-Type": mediaType },
      body:
        "<tm:root xmlns:tm=\"http://www.sap.com/cts/adt/tm\" " +
        "tm:number=\"DEVK900123\" tm:useraction=\"addobject\">" +
        "<tm:request><tm:abap_object tm:name=\"ZDEMO_SCREEN 0100\" " +
        "tm:pgmid=\"LIMU\" tm:type=\"DYNP\"/></tm:request></tm:root>"
    }
  }])
})

test("activation, semantic detail, and class execution wrappers preserve ADT contracts", async () => {
  const calls: Array<{ method: string; args: unknown[] }> = []
  const statelessAdt: any = {
    codeCompletionElement: async (...args: unknown[]) => {
      calls.push({ method: "codeCompletionElement", args })
      return ""
    },
    abapDocumentation: async (...args: unknown[]) => {
      calls.push({ method: "abapDocumentation", args })
      return ""
    },
    typeHierarchy: async (...args: unknown[]) => {
      calls.push({ method: "typeHierarchy", args })
      return []
    },
    classComponents: async (...args: unknown[]) => {
      calls.push({ method: "classComponents", args })
      return {
        "adtcore:name": "ZCL_RUNNER",
        "adtcore:type": "CLAS/OC",
        links: [],
        visibility: "public",
        "xml:base": "",
        components: []
      }
    }
  }
  const fakeAdt: any = {
    activate: async (...args: unknown[]) => {
      calls.push({ method: "activate", args })
      return { success: true, messages: [], inactive: [] }
    },
    runClass: async (...args: unknown[]) => {
      calls.push({ method: "runClass", args })
      return ""
    },
    statelessClone: statelessAdt
  }
  const client = clientWithAdt(fakeAdt)
  const inactiveObject = {
    "adtcore:uri": "/object",
    "adtcore:type": "CLAS/OC",
    "adtcore:name": "ZCL_RUNNER",
    "adtcore:parentUri": ""
  }

  await client.activateObjects([inactiveObject])
  await client.getCodeCompletionElement("/source", "WRITE x.", 7, 3)
  await client.getAbapDocumentation("/object", "WRITE x.", 7, 3)
  await client.getTypeHierarchy("/source", "WRITE x.", 7, 3, true)
  await client.getClassComponents("/object")
  await client.runClass("zcl_runner")

  assert.deepEqual(calls, [
    { method: "activate", args: [[inactiveObject], true] },
    { method: "codeCompletionElement", args: ["/source", "WRITE x.", 7, 3] },
    { method: "abapDocumentation", args: ["/object", "WRITE x.", 7, 3, "EN"] },
    { method: "typeHierarchy", args: ["/source", "WRITE x.", 7, 3, true] },
    { method: "classComponents", args: ["/object"] },
    { method: "runClass", args: ["ZCL_RUNNER"] }
  ])
})

test("profiled class execution configures a bounded trace and returns the new trace id", async () => {
  const calls: Array<{ method: string; args: unknown[] }> = []
  let traceListCall = 0
  const traceRun = {
    id: "TRACE-NEW",
    title: "MCP profiled class ZCL_PROFILED",
    published: new Date("2026-08-19T00:00:01.000Z"),
    extendedData: { objectName: "ZCL_PROFILED" }
  }
  const fakeAdt: any = {
    tracesList: async () => {
      calls.push({ method: "tracesList", args: [] })
      traceListCall += 1
      return { runs: traceListCall === 1 ? [] : [traceRun] }
    },
    tracesSetParameters: async (...args: unknown[]) => {
      calls.push({ method: "tracesSetParameters", args })
      return "/sap/bc/adt/runtime/traces/abaptraces/parameters/PROFILE-1"
    },
    httpClient: {
      request: async (...args: unknown[]) => {
        calls.push({ method: "request", args })
        return { body: "profiled output", status: 200, statusText: "OK", headers: {} }
      }
    }
  }
  const client = clientWithAdt(fakeAdt)

  const result = await client.runClassWithProfiling("zcl_profiled")

  assert.deepEqual(result, {
    output: "profiled output",
    profilerId: "/sap/bc/adt/runtime/traces/abaptraces/parameters/PROFILE-1",
    traceId: "TRACE-NEW"
  })
  assert.equal(calls[0]?.method, "tracesList")
  assert.equal(calls[1]?.method, "tracesSetParameters")
  assert.deepEqual(calls[2], {
    method: "request",
    args: [
      "/sap/bc/adt/oo/classrun/ZCL_PROFILED",
      {
        method: "POST",
        qs: {
          profilerId: "/sap/bc/adt/runtime/traces/abaptraces/parameters/PROFILE-1"
        },
        headers: {
          Accept: "text/plain",
          "X-sap-adt-profiling": "server-time"
        }
      }
    ]
  })
  const parameters = calls[1]?.args[0] as import("abap-adt-api").TraceParameters
  assert.equal(parameters.aggregate, true)
  assert.equal(parameters.sqlTrace, false)
  assert.equal(parameters.allDbEvents, false)
  assert.equal(parameters.maxTimeForTracing, 300)
  assert.equal(calls[3]?.method, "tracesList")
})

test("profiled class execution preserves output when trace lookup fails", async () => {
  let traceListCall = 0
  const fakeAdt: any = {
    tracesList: async () => {
      traceListCall += 1
      if (traceListCall > 1) throw new Error("trace feed unavailable")
      return { runs: [] }
    },
    tracesSetParameters: async () => "/sap/bc/adt/runtime/traces/parameters/PROFILE-2",
    httpClient: {
      request: async () => ({
        body: "completed output",
        status: 200,
        statusText: "OK",
        headers: {}
      })
    }
  }

  const result = await clientWithAdt(fakeAdt).runClassWithProfiling("ZCL_PROFILED")

  assert.deepEqual(result, {
    output: "completed output",
    profilerId: "/sap/bc/adt/runtime/traces/parameters/PROFILE-2",
    traceId: null,
    traceLookupWarning: "TRACE_LOOKUP_FAILED"
  })
})

test("profiled program execution uses the ADT program-run endpoint", async () => {
  const requests: Array<{ url: string; config: unknown }> = []
  const fakeAdt: any = {
    tracesList: async () => ({ runs: [] }),
    tracesSetParameters: async () => "/sap/bc/adt/runtime/traces/parameters/PROFILE-3",
    httpClient: {
      request: async (url: string, config: unknown) => {
        requests.push({ url, config })
        return { body: "program output", status: 200, statusText: "OK", headers: {} }
      }
    }
  }

  const result = await clientWithAdt(fakeAdt).runProgramWithProfiling("ZREPORT")

  assert.equal(result.output, "program output")
  assert.equal(requests[0]?.url, "/sap/bc/adt/programs/programrun/ZREPORT")
})

test("structured DDIC updates lock, compare, write, unlock, and read back", async () => {
  const calls: string[] = []
  const current = {
    metaData: {
      name: "ZDOMAIN",
      description: "Before",
      language: "EN",
      masterLanguage: "EN",
      masterSystem: "DEV",
      responsible: "DEVELOPER",
      packageName: "Z_DEMO"
    },
    properties: {
      typeInformation: { datatype: "CHAR", length: 10, decimals: 0 },
      outputInformation: {
        length: 10,
        signExists: false,
        lowercase: false,
        ampmFormat: false
      }
    }
  }
  let stored = structuredClone(current)
  const fakeAdt: any = {
    stateful: "",
    getDomainProperties: async () => {
      calls.push("read")
      return structuredClone(stored)
    },
    lock: async () => {
      calls.push("lock")
      return { LOCK_HANDLE: "LOCK-1" }
    },
    setDomainProperties: async (_uri: string, properties: any, metaData: any) => {
      calls.push("write")
      stored = { properties: structuredClone(properties), metaData: structuredClone(metaData) }
    },
    unLock: async () => {
      calls.push("unlock")
    }
  }
  const client = clientWithAdt(fakeAdt)
  const before = await client.getDdicDefinition("domain", "ZDOMAIN")
  const result = await client.updateDdicDefinition(
    "domain",
    "ZDOMAIN",
    before.fingerprint,
    {
      typeInformation: { datatype: "CHAR", length: 20, decimals: 0 },
      outputInformation: {
        length: 20,
        signExists: false,
        lowercase: true,
        ampmFormat: false
      }
    },
    "After"
  )

  assert.equal(result.definition.metaData.description, "After")
  assert.equal(result.definition.kind, "domain")
  assert.deepEqual(calls, ["read", "lock", "read", "write", "unlock", "read"])
})

test("runtime feeds are queried with bounded filters and parsed without XML namespaces", async () => {
  const requests: Array<{ url: string; config: any }> = []
  const fakeAdt: any = {
    httpClient: {
      request: async (url: string, config: any) => {
        requests.push({ url, config })
        return {
          body: `<?xml version="1.0"?><atom:feed xmlns:atom="http://www.w3.org/2005/Atom"><atom:entry><atom:id>MSG-1</atom:id><atom:title>System message</atom:title><atom:updated>2026-08-19T00:00:00Z</atom:updated><atom:author><atom:name>DEVELOPER</atom:name></atom:author><atom:content>Maintenance</atom:content></atom:entry></atom:feed>`,
          status: 200,
          statusText: "OK",
          headers: {}
        }
      }
    }
  }

  const result = await clientWithAdt(fakeAdt).getRuntimeFeed("system_messages", {
    user: "DEVELOPER",
    maxResults: 20
  })

  assert.equal(result.entries[0]?.title, "System message")
  assert.equal(result.entries[0]?.author, "DEVELOPER")
  assert.equal(requests[0]?.url, "/sap/bc/adt/runtime/systemmessages")
  assert.equal(requests[0]?.config.qs.$top, 20)
  assert.match(requests[0]?.config.qs.$query, /user , DEVELOPER/)
})

test("classic bridge reuses the SAP session and sends a CSRF-protected dispatch", async () => {
  const requests: Array<{ url: string; config: any }> = []
  const fakeAdt: any = {
    httpClient: {
      request: async (url: string, config: any) => {
        requests.push({ url, config })
        if (config.method === "GET") {
          return {
            body: "",
            status: 200,
            statusText: "OK",
            headers: { "x-csrf-token": "CSRF-1" }
          }
        }
        return {
          body: JSON.stringify({ subrc: 0, message: "OK", result: "{\"HEADER\":{}}" }),
          status: 200,
          statusText: "OK",
          headers: {}
        }
      }
    }
  }
  const bridgeProfile: SapProfile = {
    ...profile,
    classicBridgePath: "/sap/bc/rest/zmcp_rfc"
  }

  const result = await clientWithAdt(fakeAdt, bridgeProfile).callClassicBridge(
    "DYNPRO_READ",
    { program: "ZREPORT", dynpro: "0100" }
  )

  assert.deepEqual(result.result, { HEADER: {} })
  assert.deepEqual(requests.map(request => request.url), [
    "/sap/bc/rest/zmcp_rfc/dispatch",
    "/sap/bc/rest/zmcp_rfc/dispatch"
  ])
  assert.equal(requests[1]?.config.headers["X-CSRF-Token"], "CSRF-1")
  assert.deepEqual(JSON.parse(requests[1]?.config.body), {
    action: "DYNPRO_READ",
    params: JSON.stringify({ program: "ZREPORT", dynpro: "0100" })
  })
})

test("batch activations execute one at a time", async () => {
  const firstActivation = deferred<import("abap-adt-api").ActivationResult>()
  const secondActivation = deferred<import("abap-adt-api").ActivationResult>()
  const calls: unknown[][] = []
  const fakeAdt: any = {
    activate: async (...args: unknown[]) => {
      calls.push(args)
      return calls.length === 1 ? firstActivation.promise : secondActivation.promise
    }
  }
  const client = clientWithAdt(fakeAdt)

  const firstCall = client.activateObjects([firstInactiveObject])
  const secondCall = client.activateObjects([secondInactiveObject])
  await Promise.resolve()
  const callsBeforeFirstSettles = calls.slice()

  firstActivation.resolve(activationResult)
  await firstCall
  await Promise.resolve()
  const callsAfterFirstSettles = calls.slice()

  secondActivation.resolve(activationResult)
  await secondCall

  assert.deepEqual(callsBeforeFirstSettles, [[[firstInactiveObject], true]])
  assert.deepEqual(callsAfterFirstSettles, [
    [[firstInactiveObject], true],
    [[secondInactiveObject], true]
  ])
})

test("a rejected batch activation releases the queue", async () => {
  const firstActivation = deferred<import("abap-adt-api").ActivationResult>()
  const calls: unknown[][] = []
  const fakeAdt: any = {
    activate: async (...args: unknown[]) => {
      calls.push(args)
      if (calls.length === 1) return firstActivation.promise
      return activationResult
    }
  }
  const client = clientWithAdt(fakeAdt)

  const firstCall = client.activateObjects([firstInactiveObject])
  const firstRejection = assert.rejects(firstCall, { message: "first activation failed" })
  const secondCall = client.activateObjects([secondInactiveObject])
  await Promise.resolve()
  const callsBeforeRejection = calls.slice()

  firstActivation.reject(new Error("first activation failed"))
  await firstRejection
  const result = await secondCall

  assert.deepEqual(callsBeforeRejection, [[[firstInactiveObject], true]])
  assert.deepEqual(calls, [
    [[firstInactiveObject], true],
    [[secondInactiveObject], true]
  ])
  assert.strictEqual(result, activationResult)
})

test("source URI probing preserves terminal HTTP failures without extra requests", async () => {
  const uri = "/sap/bc/adt/programs/programs/z_demo"
  for (const status of [401, 403, 429, 500, 502, 503]) {
    for (const stage of ["structure", "source"]) {
      const error = AdtErrorException.create(status, {}, "", "SAP rejected request")
      let requests = 0
      const client = clientWithAdt({
        objectStructure: async () => {
          if (stage === "structure") throw error
          throw Object.assign(new Error("No structure"), { status: 404 })
        },
        httpClient: { request: async () => { requests++; throw error } }
      })
      await assert.rejects(client.readSourceByUri(uri), actual => actual === error)
      assert.equal(requests, stage === "structure" ? 0 : 1)
    }
  }
})

test("source URI probing keeps endpoint compatibility fallback but stops on transport errors", async () => {
  const uri = "/sap/bc/adt/programs/programs/z_demo"
  for (const status of [404, 405, 501]) {
    const paths: string[] = []
    const client = clientWithAdt({
      objectStructure: async () => { throw Object.assign(new Error("Unsupported"), { response: { status } }) },
      httpClient: { request: async (path: string) => {
        paths.push(path)
        if (path.endsWith("/source/main")) throw Object.assign(new Error("Unsupported"), { status })
        return { status: 200, body: "REPORT z_demo.", headers: {} }
      } }
    })
    assert.deepEqual(await client.readSourceByUri(uri), { source: "REPORT z_demo.", sourceUri: uri })
    assert.deepEqual(paths, [`${uri}/source/main`, uri])
  }
  for (const stage of ["structure", "source"]) {
    const failure = Object.assign(new Error("Connection reset"), { code: "ECONNRESET" })
    let requests = 0
    const client = clientWithAdt({
      objectStructure: async () => {
        if (stage === "structure") throw failure
        throw new Error("Legacy structure parser")
      },
      httpClient: { request: async () => { requests++; throw failure } }
    })
    await assert.rejects(client.readSourceByUri(uri), error => error === failure)
    assert.equal(requests, stage === "structure" ? 0 : 1)
  }
})

test("non-success source responses stop probing instead of falling back to object metadata", async () => {
  let requests = 0
  const client = clientWithAdt({
    objectStructure: async () => { throw new Error("Legacy structure parser") },
    httpClient: { request: async () => { requests++; return { status: 403, body: "Forbidden", headers: {} } } }
  })
  await assert.rejects(client.readSourceByUri("/sap/bc/adt/programs/programs/z_demo"),
    (error: any) => error.details?.httpStatus === 403)
  assert.equal(requests, 1)
})

test("source consistency conflicts are terminal during URI probing", async () => {
  const conflict = new AppError("SOURCE_CHANGED", "Source overlapped a local mutation")
  let requests = 0
  const client = clientWithAdt({
    objectStructure: async () => { throw new Error("Legacy structure parser") },
    httpClient: { request: async () => { requests++; throw conflict } }
  })
  await assert.rejects(client.readSourceByUri("/sap/bc/adt/programs/programs/z_demo"),
    error => error === conflict)
  assert.equal(requests, 1)
})

test("KTD reads use the active XML representation and preserve permission errors", async () => {
  const calls: unknown[] = []
  let status = 200
  const client = clientWithAdt({ httpClient: { request: async (...args: unknown[]) => {
    calls.push(args)
    if (status === 403) throw AdtErrorException.create(403, {}, "", "Denied")
    return { status, headers: {}, body: `<docu><text>${Buffer.from("Design").toString("base64")}</text></docu>` }
  } } })
  assert.deepEqual(await client.getKnowledgeTransferDocument("/NS/ZCL_DEMO"), {
    uri: "/sap/bc/adt/documentation/ktd/documents/%2Fns%2Fzcl_demo", markdown: "Design"
  })
  assert.deepEqual(calls[0], ["/sap/bc/adt/documentation/ktd/documents/%2Fns%2Fzcl_demo", {
    headers: { Accept: "application/vnd.sap.adt.sktdv2+xml" }, qs: { version: "active" }
  }])
  status = 404
  assert.equal(await client.getKnowledgeTransferDocument("ZCL_DEMO"), null)
  status = 403
  await assert.rejects(client.getKnowledgeTransferDocument("ZCL_DEMO"), (error: any) => error.err === 403)
})

test("KTD pages revalidate cached XML and evict on denied or missing documents", async () => {
  let phase: "initial" | "unchanged" | "edited" | "missing" | "denied" = "initial"
  const headers: Array<Record<string, string>> = []
  const client = clientWithAdt({
    httpClient: { request: async (_uri: string, options: { headers: Record<string, string> }) => {
      headers.push(options.headers)
      assert.equal(options.headers.Accept, "application/vnd.sap.adt.sktdv2+xml")
      if (phase === "unchanged") throw AdtErrorException.create(304, {}, "", "Not modified")
      if (phase === "denied") throw AdtErrorException.create(403, {}, "", "Denied")
      if (phase === "missing") return { status: 404, body: "Missing", headers: {} }
      const text = phase === "edited" ? "Changed design" : "Original design"
      return { status: 200, body: `<docu><text>${Buffer.from(text).toString("base64")}</text></docu>`,
        headers: { etag: phase === "edited" ? '"v2"' : '"v1"' } }
    } },
    logout: async () => undefined
  })
  assert.equal((await client.getKnowledgeTransferDocument("ZCL_DEMO"))?.markdown, "Original design")
  phase = "unchanged"
  assert.equal((await client.getKnowledgeTransferDocument("ZCL_DEMO"))?.markdown, "Original design")
  assert.equal(headers.at(-1)?.["If-None-Match"], '"v1"')
  phase = "edited"
  assert.equal((await client.getKnowledgeTransferDocument("ZCL_DEMO"))?.markdown, "Changed design")
  phase = "missing"
  assert.equal(await client.getKnowledgeTransferDocument("ZCL_DEMO"), null)
  assert.equal(headers.at(-1)?.["If-None-Match"], '"v2"')
  phase = "initial"
  await client.getKnowledgeTransferDocument("ZCL_DEMO")
  assert.equal(headers.at(-1)?.["If-None-Match"], undefined)
  phase = "denied"
  await assert.rejects(client.getKnowledgeTransferDocument("ZCL_DEMO"), (error: any) => error.err === 403)
  phase = "initial"
  await client.getKnowledgeTransferDocument("ZCL_DEMO")
  assert.equal(headers.at(-1)?.["If-None-Match"], undefined)
  await client.logout()
  await client.getKnowledgeTransferDocument("ZCL_DEMO")
  assert.equal(headers.at(-1)?.["If-None-Match"], undefined)
})

test("package creation emits the requested package properties without a hardcoded superpackage", async () => {
  const requests: Array<{ uri: string; options: any }> = []
  const client = clientWithAdt({ httpClient: { request: async (uri: string, options: any) => { requests.push({ uri, options }); return {} } } })
  for (const parentName of ["", "Z_PARENT"]) {
    await client.createObject({ objtype: "DEVC/K", name: "Z_NEW", parentName, parentPath: "", description: 'A & "B"', responsible: "DEVELOPER", swcomp: "HOME", packagetype: "development", transportLayer: "ZDEV", transport: "DEVK900123" })
    const request = requests.at(-1)!
    assert.equal(request.uri, "/sap/bc/adt/packages")
    assert.equal(request.options.qs.corrNr, "DEVK900123")
    const parsed = new XMLParser({ ignoreAttributes: false }).parse(request.options.body)["pak:package"]
    assert.equal(parsed["@_adtcore:name"], "Z_NEW")
    assert.equal(parsed["@_adtcore:description"], 'A & "B"')
    assert.equal(parsed["pak:superPackage"]["@_adtcore:name"], parentName || undefined)
    assert.doesNotMatch(request.options.body, /YMU_RAP/)
  }
})

test("DOMA and DTEL patches use object consistency checks without ABAP text artifacts", async () => {
  for (const [type, uri] of [["DOMA/DD", "/sap/bc/adt/ddic/domains/z_domain"], ["DTEL/DE", "/sap/bc/adt/ddic/dataelements/z_element"]]) {
    const calls: string[] = []
    const client = clientWithAdt({ stateful: "stateless", lock: async () => ({ LOCK_HANDLE: "LOCK" }),
      getObjectSource: async () => "old", setObjectSource: async () => { calls.push("write") }, unLock: async () => { calls.push("unlock") },
      syntaxCheckTypes: async () => new Map([["dictionaryReporter", [{ "@_chkrun:type": type }]]]),
      httpClient: { request: async (_uri: string, options: any) => { calls.push("check"); assert.equal(options.qs.reporters, "dictionaryReporter"); assert.match(options.body, /chkrun:version="inactive"/); assert.doesNotMatch(options.body, /artifact|text\/plain/); return { body: '<chkrun:checkRunReports xmlns:chkrun="http://www.sap.com/adt/checkrun"/>' } } },
      activate: async () => { calls.push("activate"); return activationResult }
    })
    const result = await client.replaceSource("Z_DICTIONARY", uri!, `${uri}/source/main`, "old", "new", undefined, true)
    assert.equal(result.activationSkipped, false)
    assert.deepEqual(calls, ["write", "check", "unlock", "activate"])
  }
})

test("unavailable Dictionary reporter is explicit and requested activation still performs backend validation", async () => {
  let activated = false
  const client = clientWithAdt({ stateful: "stateless", lock: async () => ({ LOCK_HANDLE: "LOCK" }), getObjectSource: async () => "old", setObjectSource: async () => undefined,
    unLock: async () => undefined, syntaxCheckTypes: async () => new Map(), activate: async () => { activated = true; return activationResult } })
  const result = await client.replaceSource("Z_DOMAIN", "/sap/bc/adt/ddic/domains/z_domain", "/source", "old", "new", undefined, true)
  assert.equal(result.diagnostics[0]?.severity, "W")
  assert.match(result.diagnostics[0]?.text ?? "", /unavailable/)
  assert.equal(activated, true)
})

test("all-date transport search includes old open requests and preserves their task owners", async () => {
  const requests: string[] = []
  const client = clientWithAdt({ userTransports: async () => ({ workbench: [], customizing: [] }),
    adtDiscovery: async () => [{ collection: [{ templateLinks: [{ rel: "http://www.sap.com/adt/categories/cts/transports/search", template: "/sap/bc/adt/cts/transports{?owner,searchFor,requestStatus*,fromDate,toDate}" }] }] }],
    httpClient: { request: async (uri: string) => { requests.push(uri); return { body: '<ts:searchResults xmlns:ts="http://www.sap.com/adt/cts/transports/search"><ts:requests><ts:request ts:number="DEVK900001" ts:type="K"/></ts:requests></ts:searchResults>' } } },
    transportDetails: async (number: string) => ({ "tm:number": number, "tm:owner": "OLD_OWNER", objects: [{}], tasks: [{ "tm:number": "DEVK900002", "tm:owner": "TASK_OWNER", "tm:status": "D", objects: [] }] }) })
  const result = await client.getUserTransports("DEVELOPER")
  assert.equal(result.historyComplete, true)
  assert.equal(result.workbench[0]?.modifiable[0]?.["tm:number"], "DEVK900001")
  assert.equal(result.workbench[0]?.modifiable[0]?.tasks[0]?.["tm:owner"], "TASK_OWNER")
  assert.match(requests[0]!, /fromDate=19500101/)
  assert.match(requests[0]!, /searchFor=requestWithTask/)
})

test("a transport list without all-date search support explicitly remains incomplete", async () => {
  const client = clientWithAdt({ userTransports: async () => ({ workbench: [], customizing: [] }), adtDiscovery: async () => [] })
  const result = await client.getUserTransports("DEVELOPER")
  assert.equal(result.historyComplete, false)
  assert.match(result.historyIssue ?? "", /older locks/)
})


test("V4 unpublish preserves a status message wrapped in the ADT HTTP exception's parent", async () => {
  const failure = { typeID: Symbol.for("HTTP EXCEPTION"), parent: { response: { body: "<DATA><SEVERITY>E</SEVERITY><SHORT_TEXT>Service still in use</SHORT_TEXT></DATA>" } } }
  const client = clientWithAdt({ httpClient: { request: async () => { throw failure } } })
  const result = await client.unpublishRapService("ZUI_DEMO_O4")
  assert.equal(result.severity, "e")
  assert.equal(result.shortText, "Service still in use")
})

test("Dictionary consistency errors remain blocking and are never downgraded to warnings", async () => {
  let activations = 0
  const client = clientWithAdt({ stateful: "stateless", lock: async () => ({ LOCK_HANDLE: "LOCK" }), getObjectSource: async () => "old", setObjectSource: async () => undefined,
    unLock: async () => undefined, syntaxCheckTypes: async () => new Map([["ddicCheck", ["DOMA/DD"]]]),
    httpClient: { request: async () => ({ body: '<chkrun:checkRunReports xmlns:chkrun="http://www.sap.com/adt/checkrun"><chkrun:checkReport><chkrun:checkMessageList><chkrun:checkMessage chkrun:type="E" chkrun:shortText="Invalid domain length"/></chkrun:checkMessageList></chkrun:checkReport></chkrun:checkRunReports>' }) },
    activate: async () => { activations++; return activationResult } })
  const result = await client.replaceSource("Z_DOMAIN", "/sap/bc/adt/ddic/domains/z_domain", "/source", "old", "new", undefined, true)
  assert.equal(result.activationSkipped, true)
  assert.equal(result.diagnostics[0]?.severity, "E")
  assert.equal(activations, 0)
})

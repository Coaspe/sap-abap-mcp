import assert from "node:assert/strict"
import test from "node:test"
import { AdtSapClient } from "../src/sap-client.js"
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

function clientWithAdt(fakeAdt: Record<string, unknown>): AdtSapClient {
  const client = new AdtSapClient(profile, "secret")
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
    getObjectSource: async (...args: unknown[]) => {
      calls.push({ method: "getObjectSource", args })
      return "REPORT z_demo."
    }
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
      method: "getObjectSource",
      args: [
        "/sap/bc/adt/programs/programs/z_demo/source/main",
        { version: "inactive" }
      ]
    }
  ])
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
      request: async (url: string, config: unknown) => {
        requests.push({ url, config })
        const transportNumber = /transportrequests\/([A-Z0-9]+)\//.exec(url)![1]!
        return { body: releasedReport(transportNumber), status: 200, statusText: "OK", headers: {} }
      }
    }
  }
  const client = clientWithAdt(fakeAdt)

  const reports = await client.releaseTransport("DEVK900123")

  assert.deepEqual(atcCalls, ["ZLGE_CTS"])
  assert.deepEqual(requests.map(request => request.url), [
    "/sap/bc/adt/cts/transportrequests/DEVK900124/newreleasejobs?worklistId=WORKLIST123",
    "/sap/bc/adt/cts/transportrequests/DEVK900123/newreleasejobs?worklistId=WORKLIST123"
  ])
  assert.deepEqual(requests[0]!.config, {
    method: "POST",
    headers: { Accept: "application/vnd.sap.adt.transportorganizer.v1+xml" }
  })
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

test("a synchronous release rejected with 500 for an object-bearing request raises an actionable hint", async () => {
  const httpError = Object.assign(new Error("Request failed with status code 500"), { status: 500 })
  const fakeAdt: any = {
    transportDetails: async () => ({
      "tm:number": "DEVK900123",
      "tm:status": "D",
      objects: [{ "tm:pgmid": "R3TR" }],
      tasks: []
    }),
    atcCustomizing: async () => { throw new Error("no ATC release gate") },
    httpClient: {
      request: async () => { throw httpError }
    }
  }
  const client = clientWithAdt(fakeAdt)

  await assert.rejects(
    () => client.releaseTransport("DEVK900123"),
    (error: any) =>
      error?.code === "TRANSPORT_RELEASE_UNSUPPORTED" &&
      /SE10/.test(error?.message ?? "")
  )
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

test("adding an object to a transport posts an escaped ADT object reference", async () => {
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

  await client.addTransportObject(
    "DEVK900123",
    "/sap/bc/adt/programs/programs/z_demo?foo=1&bar=\"two\""
  )

  assert.deepEqual(calls, [{
    url: "/sap/bc/adt/cts/transportrequests/DEVK900123/abaptransportcomponents",
    config: {
      method: "POST",
      headers: { "Content-Type": "application/xml" },
      body:
        "<adtcore:objectReference xmlns:adtcore=\"http://www.sap.com/adt/core\" " +
        "adtcore:uri=\"/sap/bc/adt/programs/programs/z_demo?foo=1&amp;bar=&quot;two&quot;\"/>"
    }
  }])
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

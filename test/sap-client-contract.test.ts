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
    transportRelease: async (...args: unknown[]) => {
      calls.push({ method: "transportRelease", args })
      return []
    },
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

  await client.releaseTransport("DEVK900123", true, true)
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
    { method: "transportRelease", args: ["DEVK900123", true, true] },
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

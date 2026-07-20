import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import test from "node:test"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { ConnectionManager, type ConnectionSummary } from "../src/connection-manager.js"
import {
  IMPLEMENTED_TOOL_NAMES,
  toolsForToolsets
} from "../src/compat/abap-fs-tools.js"
import {
  DEFERRED_RESULT_TOOL_NAME,
  type DeferredResultEnvelope
} from "../src/deferred-results.js"
import { createMcpServer, type McpServerOptions } from "../src/mcp-server.js"
import { AppError } from "../src/errors.js"
import { ProfileStore, type SapProfile } from "../src/profile-store.js"
import { SapCapabilityRegistry } from "../src/sap-capabilities.js"
import { MemorySecretStore } from "../src/secret-store.js"
import {
  abapGitCredentialKey,
  encodeAbapGitCredentials,
  normalizeAbapGitRepositoryUrl
} from "../src/abapgit-credentials.js"
import type {
  SapClient,
  SapObjectReference,
  SapObjectSource,
  SapSystemInfo
} from "../src/sap-client.js"
import {
  AbapToolService,
  extractAbapMethod,
  replaceExactlyOnce,
  type ActivateObjectInput
} from "../src/tool-service.js"
import { DEVELOPMENT_PARITY_FIXTURES } from "./fixtures/development-parity.js"
import { advertisedTools } from "./helpers/mcp-surface.js"

async function toolNames(options?: McpServerOptions): Promise<string[]> {
  return (await advertisedTools(options)).map(tool => tool.name)
}

const object: SapObjectReference = {
  name: "ZCL_DEMO",
  type: "CLAS/OC",
  uri: "/sap/bc/adt/oo/classes/zcl_demo",
  description: "Demo class",
  packageName: "Z_DEMO"
}

const screenProgram: SapObjectReference = {
  name: "ZDEMO_SCREEN",
  type: "PROG/P",
  uri: "/sap/bc/adt/programs/programs/zdemo_screen",
  description: "Demo screen program",
  packageName: "Z_DEMO"
}

const source = [
  "CLASS zcl_demo IMPLEMENTATION.",
  "  METHOD run.",
  "    result = 42.",
  "  ENDMETHOD.",
  "ENDCLASS."
].join("\n")

function inactiveClass(name: string): import("abap-adt-api").InactiveObjectRecord {
  return { object: {
    "adtcore:uri": `/sap/bc/adt/oo/classes/${name.toLowerCase()}`,
    "adtcore:type": "CLAS/OC",
    "adtcore:name": name,
    "adtcore:parentUri": "",
    user: "DEVELOPER",
    deleted: false
  } }
}

function systemInfo(profile: SapProfile): SapSystemInfo {
  return {
    profileId: profile.id,
    url: profile.url,
    client: profile.client,
    language: profile.language,
    environment: profile.environment,
    username: profile.username ?? "",
    sapRelease: "758",
    systemType: "S/4HANA",
    logicalSystem: "DEVCLNT100",
    clientName: "Development",
    timezone: { name: "KOREA", description: "Korea", utcOffset: "UTC+9" },
    softwareComponents: [],
    discoveryCollections: 12,
    warnings: [],
    queryTimestamp: "2026-07-13T00:00:00.000Z"
  }
}

class FakeSapClient implements SapClient {
  loginCount = 0
  logoutCount = 0
  currentSource = source
  createdObject: unknown
  createObjectCalls = 0
  validateNewObjectCalls = 0
  createTransportCalls = 0
  readSourceCalls: string[] = []
  replaceSourceCalls: Array<{
    objectName: string
    objectUri: string
    sourceUri: string
    expectedSource: string
    nextSource: string
    transport?: string
    activate: boolean
    syntaxObjectUri?: string
  }> = []
  syntaxCheckArgs: Array<{
    objectUri: string
    sourceUri: string
    sourceText: string
    mainProgram: string | undefined
  }> = []
  deleteObjectCalls = 0
  objectCreationOperations: string[] = []
  validationResult: any = { success: true }
  validationError?: Error
  createObjectError?: Error
  readSourceError?: Error
  replaceSourceError?: Error
  debugActive = false
  deletedObject = false
  transportMutations: string[] = []
  gitAuthCalls: Array<{ url: string; user?: string; password?: string }> = []
  serviceBindingProtocol = "V4"
  batchActivationCalls = 0
  lastBatchActivation: import("abap-adt-api").InactiveObject[] = []
  batchActivationResult: import("abap-adt-api").ActivationResult = {
    success: true,
    messages: [],
    inactive: []
  }
  batchActivationError?: Error
  usageReferencesResult?: any[]
  objectPackages = new Map([
    ["ZCL_FIRST", "Z_DEMO"],
    ["ZCL_SECOND", "Z_DEMO"],
    ["ZCL_A", "Z_DEMO"],
    ["ZCL_AB", "Z_DEMO"]
  ])
  inactiveObjects: import("abap-adt-api").InactiveObjectRecord[] = [
    inactiveClass("ZCL_FIRST"),
    inactiveClass("ZCL_SECOND")
  ]
  inactiveObjectCalls = 0
  classRunCalls = 0
  classRunResult?: string
  classRunError?: Error
  replHealthCalls = 0
  replProduction = false
  replHealthResult?: Awaited<ReturnType<SapClient["checkReplAvailability"]>>
  replHealthError?: Error
  replExecuteCalls = 0
  replExecutionResult?: Awaited<ReturnType<SapClient["executeAbapCode"]>>
  replExecutionError?: Error
  codeCompletionCalls = 0
  completionElementCalls = 0
  completionElementArgs: Array<{
    sourceUri: string
    source: string
    line: number
    column: number
  }> = []
  completionElementResult: string | import("abap-adt-api").CompletionElementInfo =
    structuredClone(DEVELOPMENT_PARITY_FIXTURES.completionElement)
  completionElementError?: Error
  documentationCalls = 0
  documentationArgs: Array<{
    objectUri: string
    source: string
    line: number
    column: number
  }> = []
  documentationResult = DEVELOPMENT_PARITY_FIXTURES.documentation
  documentationError?: Error
  typeHierarchyCalls = 0
  typeHierarchyArgs: Array<{
    sourceUri: string
    source: string
    line: number
    column: number
    superTypes: boolean
  }> = []
  typeHierarchyResult: import("abap-adt-api").HierarchyNode[] =
    structuredClone(DEVELOPMENT_PARITY_FIXTURES.typeHierarchy)
  typeHierarchyError?: Error
  classComponentsCalls = 0
  classComponentsArgs: string[] = []
  classComponentsResult: import("abap-adt-api").ClassComponent =
    structuredClone(DEVELOPMENT_PARITY_FIXTURES.components)
  classComponentsError?: Error
  definitionArgs: Array<{
    sourceUri: string
    source: string
    line: number
    startColumn: number
    endColumn: number
    implementation: boolean
    mainProgram: string | undefined
  }> = []
  objectStructureType = object.type

  constructor(readonly profile: SapProfile) {}

  async login(): Promise<void> {
    this.loginCount += 1
  }

  async logout(): Promise<void> {
    this.logoutCount += 1
  }

  async searchObjects(
    query: string,
    objectType?: string,
    _maxResults?: number
  ): Promise<SapObjectReference[]> {
    const normalizedQuery = query.trim().toUpperCase()
    if (normalizedQuery === "Z_DEMO" && (!objectType || objectType.startsWith("DEVC"))) {
      return [{
        name: "Z_DEMO",
        type: "DEVC/K",
        uri: "/sap/bc/adt/packages/z_demo",
        description: "Demo package",
        packageName: "Z_DEMO"
      }]
    }
    if (this.objectPackages.has(normalizedQuery)) {
      if (objectType && objectType.replace(/\/.*$/, "") !== "CLAS") return []
      return [{
        name: normalizedQuery,
        type: "CLAS/OC",
        uri: `/sap/bc/adt/oo/classes/${normalizedQuery.toLowerCase()}`,
        description: normalizedQuery,
        packageName: this.objectPackages.get(normalizedQuery)!
      }]
    }
    if (normalizedQuery === screenProgram.name) {
      if (objectType && objectType.replace(/\/.*$/, "") !== "PROG") return []
      return [screenProgram]
    }
    if (!normalizedQuery.includes("ZCL_DEMO")) return []
    if (objectType && objectType.replace(/\/.*$/, "") !== "CLAS") return []
    return [object]
  }

  async readObject(reference: SapObjectReference): Promise<SapObjectSource> {
    return { source: this.currentSource, sourceUri: `${reference.uri}/source/main`, object: reference }
  }

  async readSourceByUri(uri: string) {
    this.readSourceCalls.push(uri)
    this.objectCreationOperations.push("read_source")
    if (this.readSourceError) throw this.readSourceError
    if (uri.endsWith("/revisions/1")) {
      return { source: this.currentSource, sourceUri: uri }
    }
    if (uri.endsWith("/revisions/2")) {
      return { source: source.replace("result = 42", "result = 41"), sourceUri: uri }
    }
    return {
      source: this.currentSource,
      sourceUri: uri.endsWith("/source/main") || /\/includes\/[^/]+$/i.test(uri)
        ? uri
        : `${uri}/source/main`
    }
  }

  async getObjectStructure(uri: string): Promise<any> {
    const className = uri.match(/\/sap\/bc\/adt\/oo\/classes\/([^/]+)$/i)?.[1]
    const name = className?.toUpperCase() ?? object.name
    return {
      objectUrl: uri,
      metaData: {
        "adtcore:name": name,
        "adtcore:type": className ? "CLAS/OC" : this.objectStructureType,
        "adtcore:changedAt": 0,
        "adtcore:changedBy": "DEVELOPER",
        "adtcore:createdAt": 0,
        "adtcore:language": "EN",
        "adtcore:responsible": "DEVELOPER",
        "adtcore:version": "active"
      },
      links: []
    }
  }

  async getObjectFingerprint(): Promise<any> {
    return {
      fingerprint: `fingerprint:${this.currentSource}`,
      name: object.name,
      type: object.type,
      version: "active",
      changedAt: 0,
      sourceUri: `${object.uri}/source/main`
    }
  }

  async getObjectEnhancements(): Promise<any> {
    return { implementations: [] }
  }

  async findUsageReferences(): Promise<any[]> {
    return this.usageReferencesResult ?? [
      {
        uri: "/sap/bc/adt/programs/programs/zrep_caller",
        objectIdentifier: "ABAPFullName;ZREP_CALLER",
        parentUri: "/sap/bc/adt/programs/programs/zrep_caller",
        isResult: true,
        canHaveChildren: false,
        usageInformation: "method call",
        "adtcore:responsible": "DEVELOPER",
        "adtcore:name": "ZREP_CALLER",
        "adtcore:type": "PROG/P",
        packageRef: {
          "adtcore:uri": "/sap/bc/adt/packages/z_demo",
          "adtcore:name": "Z_DEMO"
        }
      }
    ]
  }

  async getUsageReferenceSnippets(): Promise<any[]> {
    return [
      {
        objectIdentifier: "ABAPFullName;ZREP_CALLER",
        snippets: [
          {
            uri: { uri: "/sap/bc/adt/programs/programs/zrep_caller", start: { line: 7, column: 2 } },
            matches: "zcl_demo=>run( )",
            content: "zcl_demo=>run( ).",
            description: "method call"
          }
        ]
      }
    ]
  }

  async getMainPrograms(): Promise<any[]> {
    return []
  }

  async checkSyntax(
    objectUri: string,
    sourceUri: string,
    sourceText: string,
    mainProgram?: string
  ): Promise<any[]> {
    this.syntaxCheckArgs.push({ objectUri, sourceUri, sourceText, mainProgram })
    return sourceText.includes("SYNTAX_ERROR")
      ? [{ uri: sourceUri, line: 3, offset: 4, severity: "E", text: "Syntax error" }]
      : []
  }

  async replaceSource(
    objectName: string,
    objectUri: string,
    sourceUri: string,
    expectedSource: string,
    nextSource: string,
    _transport?: string,
    activate = false,
    _mainProgram?: string,
    syntaxObjectUri?: string
  ): Promise<any> {
    this.replaceSourceCalls.push({
      objectName,
      objectUri,
      sourceUri,
      expectedSource,
      nextSource,
      ...(_transport === undefined ? {} : { transport: _transport }),
      activate,
      ...(syntaxObjectUri ? { syntaxObjectUri } : {})
    })
    this.objectCreationOperations.push("replace_source")
    if (this.replaceSourceError) throw this.replaceSourceError
    assert.equal(this.currentSource, expectedSource)
    this.currentSource = nextSource
    const diagnostics = await this.checkSyntax(
      syntaxObjectUri ?? objectUri,
      sourceUri,
      nextSource,
      _mainProgram
    )
    return {
      diagnostics,
      ...(activate && diagnostics.length === 0
        ? { activation: { success: true, messages: [], inactive: [] } }
        : {}),
      activationSkipped: activate && diagnostics.length > 0
    }
  }

  async activateObject(): Promise<any> {
    return { success: true, messages: [], inactive: [] }
  }

  async activateObjects(
    objects: import("abap-adt-api").InactiveObject[]
  ): Promise<import("abap-adt-api").ActivationResult> {
    this.batchActivationCalls += 1
    this.lastBatchActivation = objects
    if (this.batchActivationError) throw this.batchActivationError
    return this.batchActivationResult
  }

  async validateNewObject(): Promise<any> {
    this.validateNewObjectCalls += 1
    this.objectCreationOperations.push("validate")
    if (this.validationError) throw this.validationError
    return this.validationResult
  }

  async createObject(options: unknown): Promise<void> {
    this.createObjectCalls += 1
    this.objectCreationOperations.push("create")
    if (this.createObjectError) throw this.createObjectError
    this.createdObject = options
  }

  async createTransport(): Promise<string> {
    this.createTransportCalls += 1
    this.objectCreationOperations.push("create_transport")
    return "DEVK900001"
  }

  async runQuery(sql: string): Promise<any> {
    if (sql.includes("Z_TOKEN_BUDGET")) {
      return {
        columns: [{ name: "ROW_ID", type: "I", description: "Row" }],
        values: Array.from({ length: 250 }, (_, index) => ({ ROW_ID: index + 1 }))
      }
    }
    return {
      columns: [
        {
          name: "MATNR",
          type: "C",
          description: "Material",
          keyAttribute: true,
          colType: "",
          isKeyFigure: false,
          length: 18
        }
      ],
      values: [{ MATNR: "MAT-002" }, { MATNR: "MAT-001" }]
    }
  }

  async runUnitTests(): Promise<any[]> {
    return [
      {
        "adtcore:uri": `${object.uri}/testclasses/ltcl_demo`,
        "adtcore:type": "CLAS/OL",
        "adtcore:name": "LTCL_DEMO",
        uriType: "",
        durationCategory: "short",
        riskLevel: "harmless",
        alerts: [],
        testmethods: [
          {
            "adtcore:uri": `${object.uri}/testclasses/ltcl_demo/methods/test_run`,
            "adtcore:type": "CLAS/OM",
            "adtcore:name": "TEST_RUN",
            executionTime: 0.01,
            uriType: "",
            unit: "s",
            alerts: []
          }
        ]
      }
    ]
  }

  async createTestInclude(): Promise<void> {}

  async getAtcCustomizing(): Promise<any> {
    return { properties: [{ name: "systemCheckVariant", value: "DEFAULT" }], excemptions: [] }
  }

  async checkAtcVariant(): Promise<string> {
    return "DEFAULT"
  }

  async runAtc(): Promise<any> {
    return { id: "ATC-1", timestamp: 1, infos: [] }
  }

  async getAtcWorklist(): Promise<any> {
    return {
      id: "ATC-1",
      timestamp: 1,
      usedObjectSet: "LAST",
      objectSetIsComplete: true,
      objectSets: [],
      objects: [
        {
          uri: object.uri,
          type: object.type,
          name: object.name,
          packageName: "Z_DEMO",
          author: "DEVELOPER",
          findings: [
            {
              uri: `${object.uri}/atc/1`,
              location: {
                uri: `${object.uri}/source/main`,
                range: {
                  start: { line: 2, column: 2 },
                  end: { line: 2, column: 8 }
                }
              },
              priority: 2,
              checkId: "CHECK",
              checkTitle: "Demo check",
              messageId: "MSG",
              messageTitle: "Demo warning",
              exemptionApproval: "",
              exemptionKind: "",
              link: { href: "/sap/bc/adt/atc/doc/1", rel: "doc", type: "text/html" }
            }
          ]
        }
      ]
    }
  }

  async getAtcDocumentation(): Promise<string> {
    return "<h1>Demo check</h1><p>Fix the warning.</p>"
  }

  async getTextElements(): Promise<any> {
    return {
      programName: object.name,
      textElements: [{ id: "001", text: "Old text", maxLength: 20 }]
    }
  }

  async updateTextElements(): Promise<any> {
    return { success: true, messages: [], inactive: [] }
  }

  async getUserTransports(): Promise<any> {
    return { workbench: [], customizing: [] }
  }

  async getTransportDetails(transportNumber: string): Promise<any> {
    return {
      "tm:number": transportNumber,
      "tm:owner": "DEVELOPER",
      "tm:desc": "Demo transport",
      "tm:status": "D",
      "tm:uri": `/sap/bc/adt/cts/transportrequests/${transportNumber}`,
      links: [],
      objects: [
        {
          "tm:pgmid": "R3TR",
          "tm:type": "CLAS",
          "tm:name": object.name,
          "tm:dummy_uri": object.uri,
          "tm:obj_info": "Demo class"
        }
      ],
      tasks: []
    }
  }

  async releaseTransport(transportNumber: string): Promise<any[]> {
    this.transportMutations.push(`release:${transportNumber}`)
    return [{ "chkrun:status": "released", "chkrun:statusText": "Released", messages: [] }]
  }

  async deleteTransport(transportNumber: string): Promise<void> {
    this.transportMutations.push(`delete:${transportNumber}`)
  }

  async setTransportOwner(transportNumber: string, user: string): Promise<any> {
    this.transportMutations.push(`owner:${transportNumber}:${user}`)
    return { "tm:number": transportNumber, "tm:targetuser": user }
  }

  async addTransportUser(transportNumber: string, user: string): Promise<any> {
    this.transportMutations.push(`user:${transportNumber}:${user}`)
    return { "tm:number": transportNumber, "tm:targetuser": user, "tm:uri": "", "tm:useraction": "ADD" }
  }

  async addTransportObject(transportNumber: string, objectUri: string): Promise<void> {
    this.transportMutations.push(`object:${transportNumber}:${objectUri}`)
  }

  async addTransportObjectByKey(
    transportNumber: string,
    pgmid: string,
    objectType: string,
    objectName: string
  ): Promise<void> {
    this.transportMutations.push(
      `object-key:${transportNumber}:${pgmid}:${objectType}:${objectName}`
    )
  }

  async listSystemUsers(): Promise<any[]> {
    return [{ id: "DEVELOPER", title: "Developer" }]
  }

  async resolveTransportObject(_pgmid: string, _type: string, name: string): Promise<string> {
    return name === object.name ? object.uri : ""
  }

  async getRevisions(): Promise<any[]> {
    return [
      {
        uri: `${object.uri}/revisions/1`,
        date: "2026-07-13T00:00:00Z",
        author: "DEVELOPER",
        version: "DEVK900123",
        versionTitle: "Latest"
      },
      {
        uri: `${object.uri}/revisions/2`,
        date: "2026-07-12T00:00:00Z",
        author: "DEVELOPER",
        version: "DEVK900122",
        versionTitle: "Previous"
      }
    ]
  }

  async getInactiveObjects(): Promise<any[]> {
    this.inactiveObjectCalls += 1
    return this.inactiveObjects
  }

  async getCodeCompletions(): Promise<any[]> {
    this.codeCompletionCalls += 1
    return [{ IDENTIFIER: "WRITE", KIND: 1, ICON: 0, SUBICON: 0, BOLD: 0, COLOR: 0,
      QUICKINFO_EVENT: 0, INSERT_EVENT: 0, IS_META: 0, PREFIXLENGTH: 0, ROLE: 0,
      LOCATION: 0, GRADE: 1, VISIBILITY: 0, IS_INHERITED: 0, PROP1: 0, PROP2: 0,
      PROP3: 0, SYNTCNTXT: 0 }]
  }

  async getCodeCompletionElement(
    sourceUri: string,
    sourceText: string,
    line: number,
    column: number
  ): Promise<string | import("abap-adt-api").CompletionElementInfo> {
    this.completionElementCalls += 1
    this.completionElementArgs.push({ sourceUri, source: sourceText, line, column })
    if (this.completionElementError) throw this.completionElementError
    return structuredClone(this.completionElementResult)
  }

  async getAbapDocumentation(
    objectUri: string,
    sourceText: string,
    line: number,
    column: number
  ): Promise<string> {
    this.documentationCalls += 1
    this.documentationArgs.push({ objectUri, source: sourceText, line, column })
    if (this.documentationError) throw this.documentationError
    return this.documentationResult
  }

  async getTypeHierarchy(
    sourceUri: string,
    sourceText: string,
    line: number,
    column: number,
    superTypes: boolean
  ): Promise<import("abap-adt-api").HierarchyNode[]> {
    this.typeHierarchyCalls += 1
    this.typeHierarchyArgs.push({ sourceUri, source: sourceText, line, column, superTypes })
    if (this.typeHierarchyError) throw this.typeHierarchyError
    return structuredClone(this.typeHierarchyResult)
  }

  async getClassComponents(objectUri: string): Promise<import("abap-adt-api").ClassComponent> {
    this.classComponentsCalls += 1
    this.classComponentsArgs.push(objectUri)
    if (this.classComponentsError) throw this.classComponentsError
    return structuredClone(this.classComponentsResult)
  }

  async runClass(className: string): Promise<string> {
    this.classRunCalls += 1
    if (this.classRunError) throw this.classRunError
    return this.classRunResult ?? `runner output: ${className}`
  }

  async checkReplAvailability() {
    this.replHealthCalls += 1
    if (this.replHealthError) throw this.replHealthError
    return this.replHealthResult ?? {
      status: "ok",
      version: "1",
      user: "DEVELOPER",
      system: "DEV",
      client: "100",
      production: this.replProduction
    }
  }

  async executeAbapCode(code: string) {
    this.replExecuteCalls += 1
    if (this.replExecutionError) throw this.replExecutionError
    return this.replExecutionResult ?? { success: true, output: code, error: "", runtime_ms: 1 }
  }

  async findDefinition(
    sourceUri: string,
    sourceText: string,
    line: number,
    startColumn: number,
    endColumn: number,
    implementation = false,
    mainProgram?: string
  ): Promise<any> {
    this.definitionArgs.push({
      sourceUri,
      source: sourceText,
      line,
      startColumn,
      endColumn,
      implementation,
      mainProgram
    })
    return { url: object.uri, line: 1, column: 6 }
  }

  async getQuickFixes(): Promise<any[]> {
    return [{
      "adtcore:uri": "quickfix:1",
      "adtcore:type": "quickfix",
      "adtcore:name": "Replace 42 with 43",
      "adtcore:description": "",
      uri: `${object.uri}/source/main`,
      line: "3",
      column: "13",
      userContent: ""
    }]
  }

  async getQuickFixEdits(): Promise<any[]> {
    return [{
      uri: `${object.uri}/source/main`,
      range: { start: { line: 3, column: 13 }, end: { line: 3, column: 15 } },
      name: object.name,
      type: object.type,
      content: "43"
    }]
  }

  async formatSource(text: string): Promise<string> {
    return text.replace(/result = (\d+)\./, "result = $1. ")
  }

  async evaluateRename(_uri: string, line: number, column: number): Promise<any> {
    return {
      oldName: "result",
      newName: "",
      ignoreSyntaxErrorsAllowed: false,
      ignoreSyntaxErrors: false,
      adtObjectUri: {
        uri: object.uri,
        query: undefined,
        range: { start: { line, column }, end: { line, column } }
      },
      affectedObjects: [{
        uri: object.uri,
        type: object.type,
        name: object.name,
        parentUri: "",
        userContent: "",
        textReplaceDeltas: [{
          rangeFragment: { start: { line: 3, column: 4 }, end: { line: 3, column: 10 } },
          contentOld: "result",
          contentNew: "renamed_result"
        }]
      }],
      userContent: ""
    }
  }

  async previewRename(proposal: any, transport = ""): Promise<any> {
    return { ...proposal, transport }
  }

  async executeRename(refactoring: any): Promise<any> {
    this.currentSource = this.currentSource.replaceAll(refactoring.oldName, refactoring.newName)
    return refactoring
  }

  async previewPackageChange(refactoring: any, transport = ""): Promise<any> {
    return { ...refactoring, transport: refactoring.transport || transport }
  }

  async executePackageChange(refactoring: any): Promise<any> {
    object.packageName = refactoring.newPackage
    return refactoring
  }

  async evaluateExtractMethod(_uri: string, range: any): Promise<any> {
    return {
      name: "",
      isStatic: false,
      isForTesting: false,
      visibility: "private",
      classBasedExceptions: true,
      genericRefactoring: {
        title: "Extract Method",
        adtObjectUri: { uri: object.uri, query: undefined, range },
        transport: "",
        ignoreSyntaxErrorsAllowed: false,
        ignoreSyntaxErrors: false,
        userContent: "",
        affectedObjects: []
      },
      content: "result = 42.",
      className: object.name,
      isEventAllowed: false,
      isEvent: false,
      userContent: "",
      parameters: [],
      exceptions: []
    }
  }

  async previewExtractMethod(proposal: any): Promise<any> {
    return {
      ...proposal.genericRefactoring,
      affectedObjects: [{
        uri: object.uri,
        type: object.type,
        name: object.name,
        parentUri: "",
        userContent: "",
        textReplaceDeltas: [{
          rangeFragment: proposal.genericRefactoring.adtObjectUri.range,
          contentOld: proposal.content,
          contentNew: `${proposal.name}( ).`
        }]
      }]
    }
  }

  async executeExtractMethod(refactoring: any): Promise<any> {
    return refactoring
  }

  async deleteObject(_uri: string, expectedFingerprint: string): Promise<void> {
    this.deleteObjectCalls += 1
    assert.equal(expectedFingerprint, `fingerprint:${this.currentSource}`)
    this.deletedObject = true
  }

  private gitRepository() {
    return {
      key: "REPO-1", sapPackage: "Z_DEMO", url: "https://example.test/repo.git",
      branch_name: "main", created_by: "DEVELOPER", created_at: new Date(),
      links: []
    }
  }

  async listGitRepositories(): Promise<any[]> { return [this.gitRepository()] }
  async getGitRemoteInfo(url: string, user?: string, password?: string): Promise<any> {
    this.gitAuthCalls.push({ url, ...(user ? { user } : {}), ...(password ? { password } : {}) })
    return { access_mode: "PUBLIC", branches: [{ sha1: "abc", name: "main", type: "branch", is_head: true, display_name: "main" }] }
  }
  async createGitRepository(): Promise<void[]> { return [] }
  async pullGitRepository(): Promise<void[]> { return [] }
  async unlinkGitRepository(): Promise<void> {}
  async stageGitRepository(): Promise<any> {
    return {
      staged: [],
      unstaged: [{ wbkey: "R3TR CLAS ZCL_DEMO", uri: object.uri, type: object.type,
        name: object.name, abapGitFiles: [] }],
      ignored: [], comment: "",
      author: { name: "Developer", email: "dev@example.test" },
      committer: { name: "Developer", email: "dev@example.test" }
    }
  }
  async pushGitRepository(): Promise<void> {}
  async checkGitRepository(): Promise<void> {}
  async switchGitBranch(): Promise<void> {}

  async isRapGeneratorAvailable(): Promise<boolean> { return true }
  async validateRapGeneratorInitial(): Promise<any> { return { severity: "ok", shortText: "OK" } }
  async getRapGeneratorSchema(): Promise<string> { return JSON.stringify({ type: "object" }) }
  async getRapGeneratorContent(): Promise<any> {
    return {
      metadata: { package: "Z_DEMO" }, general: { description: "Demo" },
      businessObject: {
        dataModelEntity: { cdsName: "ZI_DEMO" },
        behavior: { implementationType: "managed", implementationClass: "ZBP_I_DEMO", draftTable: "ZDEMO_D" }
      },
      serviceProjection: { name: "ZC_DEMO" },
      businessService: {
        serviceDefinition: { name: "ZUI_DEMO" },
        serviceBinding: { name: "ZUI_DEMO_O4", bindingType: "OData V4 - UI" }
      }
    }
  }
  async validateRapGeneratorContent(): Promise<any> { return { severity: "ok", shortText: "OK" } }
  async previewRapGenerator(): Promise<any[]> {
    return [{ uri: "/sap/bc/adt/ddic/ddl/sources/zi_demo", type: "DDLS/DF", name: "ZI_DEMO", description: "CREATE" }]
  }
  async generateRapObjects(): Promise<any[]> { return this.previewRapGenerator() }
  async publishRapService(): Promise<any> { return { severity: "ok", shortText: "Published" } }
  async unpublishServiceBinding(): Promise<any> { return { severity: "I", shortText: "Unpublished", longText: "" } }
  async getServiceBindingDetails(): Promise<any> {
    return {
      binding: {
        releaseSupported: true,
        published: true,
        repair: false,
        bindingCreated: true,
        responsible: "DEVELOPER",
        masterLanguage: "EN",
        masterSystem: "DEV",
        name: "ZUI_DEMO_O4",
        type: "SRVB/SVB",
        changedAt: "2026-07-13T00:00:00Z",
        version: "active",
        createdAt: "2026-07-13T00:00:00Z",
        changedBy: "DEVELOPER",
        createdBy: "DEVELOPER",
        description: "Demo service",
        language: "EN",
        packageRef: { uri: "/sap/bc/adt/packages/z_demo", type: "DEVC/K", name: "Z_DEMO" },
        links: [],
        services: [{
          name: "ZUI_DEMO",
          version: 1,
          releaseState: "released",
          serviceDefinition: { uri: "/service", type: "SRVD/SRV", name: "ZUI_DEMO" }
        }],
        binding: { type: "ODATA", version: this.serviceBindingProtocol, category: 0,
          implementation: { name: "" } }
      }
    }
  }

  async getNodeContents(): Promise<any> {
    return { nodes: [], categories: [], objectTypes: [] }
  }

  async startDebugSession(): Promise<any> {
    this.debugActive = true
    return {
      active: true,
      state: "paused",
      mode: "user",
      debugUser: "DEVELOPER",
      breakpointCount: 0
    }
  }

  async stopDebugSession(): Promise<any> {
    this.debugActive = false
    return { active: false, state: "stopped", breakpointCount: 0 }
  }

  getDebugStatus(): any {
    return {
      active: this.debugActive,
      state: this.debugActive ? "paused" : "stopped",
      breakpointCount: 0
    }
  }

  async setDebugBreakpoints(sourceUri: string, lines: number[]): Promise<any[]> {
    return lines.map(line => ({
      kind: "line",
      clientId: "client",
      id: `bp-${line}`,
      nonAbapFlavour: "",
      uri: {
        uri: sourceUri,
        range: {
          start: { line, column: 0 },
          end: { line, column: 0 }
        }
      },
      type: object.type,
      name: object.name
    }))
  }

  async debugStep(): Promise<any> {
    return { result: { isDebuggeeChanged: false }, stack: await this.getDebugStack() }
  }

  async getDebugStack(): Promise<any> {
    return {
      isRfc: false,
      isSameSystem: true,
      serverName: "appserver",
      stack: [
        {
          stackPosition: 0,
          programName: object.name,
          includeName: object.name,
          line: 3,
          eventType: "METHOD",
          eventName: "RUN",
          systemProgram: false,
          uri: { uri: `${object.uri}/source/main` }
        }
      ]
    }
  }

  async getDebugVariables(): Promise<any> {
    return {
      variables: [
        {
          ID: "LV_RESULT",
          NAME: "LV_RESULT",
          DECLARED_TYPE_NAME: "I",
          ACTUAL_TYPE_NAME: "I",
          KIND: "",
          INSTANTIATION_KIND: "",
          ACCESS_KIND: "",
          META_TYPE: "simple",
          PARAMETER_KIND: "",
          VALUE: "43",
          HEX_VALUE: "",
          READ_ONLY: "",
          TECHNICAL_TYPE: "I",
          LENGTH: 4,
          TABLE_BODY: "",
          TABLE_LINES: 0,
          IS_VALUE_INCOMPLETE: "",
          IS_EXCEPTION: "",
          INHERITANCE_LEVEL: 0,
          INHERITANCE_CLASS: ""
        }
      ]
    }
  }

  async getDumps(): Promise<any> {
    return {
      href: "/sap/bc/adt/runtime/dumps",
      title: "Dumps",
      updated: new Date("2026-07-13T00:00:00Z"),
      dumps: [
        {
          id: "DUMP-1",
          author: "DEVELOPER",
          text: "<h1>MESSAGE_TYPE_X</h1><p>Demo dump</p>",
          type: "text/html",
          categories: [{ term: "MESSAGE_TYPE_X", label: "ABAP runtime error" }],
          links: []
        }
      ]
    }
  }

  async getTraceRuns(): Promise<any> {
    return {
      author: "DEVELOPER",
      contributor: "",
      title: "Traces",
      updated: new Date("2026-07-13T00:00:00Z"),
      runs: [
        {
          id: "/sap/bc/adt/runtime/traces/run-1",
          author: "DEVELOPER",
          title: "Demo trace",
          published: new Date("2026-07-13T00:00:00Z"),
          updated: new Date("2026-07-13T00:00:00Z"),
          authorUri: "",
          type: "",
          src: "",
          lang: "EN",
          links: [],
          extendedData: {
            host: "appserver",
            size: 1,
            runtime: 100,
            runtimeABAP: 60,
            runtimeSystem: 10,
            runtimeDatabase: 30,
            expiration: new Date("2026-07-20T00:00:00Z"),
            system: "DEV",
            client: 100,
            isAggregated: false,
            objectName: object.name,
            state: { value: "F", text: "Finished" }
          }
        }
      ]
    }
  }

  async getTraceConfigurations(): Promise<any> {
    return { title: "Configurations", contributorName: "", contributorRole: "", requests: [] }
  }

  async getTraceHitList(): Promise<any> {
    return { parentLink: "", entries: [] }
  }

  async getTraceStatements(): Promise<any> {
    return {
      withDetails: true,
      withSysEvents: true,
      count: 1,
      parentLink: "",
      statements: [
        {
          index: 1,
          id: 1,
          description: "SELECT",
          hitCount: 1,
          hasDetailSubnodes: false,
          hasProcedureLikeSubnodes: false,
          callerId: 0,
          callLevel: 1,
          subnodeCount: 0,
          directSubnodeCount: 0,
          directSubnodeCountProcedureLike: 0,
          hitlistAnchor: 1,
          callingProgram: { context: "", byteCodeOffset: 0, name: object.name },
          grossTime: { time: 30, percentage: 30 },
          traceEventNetTime: { time: 30, percentage: 30 },
          proceduralNetTime: { time: 30, percentage: 30 }
        }
      ]
    }
  }

  async getAdtDiscovery(): Promise<any> {
    return {
      discovery: [
        {
          title: "Repository",
          collection: [
            { href: "/sap/bc/adt/repository", templateLinks: [] },
            { href: "/sap/bc/adt/activation", templateLinks: [] }
          ]
        }
      ],
      core: [
        {
          title: "Repository",
          collection: { href: "/sap/bc/adt/repository", title: "Repository", category: "repo" }
        }
      ]
    }
  }

  async ping(): Promise<any> {
    return { collections: 1, timestamp: "2026-07-13T00:00:00.000Z" }
  }

  async getSystemInfo(): Promise<SapSystemInfo> {
    return systemInfo(this.profile)
  }
}

function createBdefHarness() {
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
  const fake = new FakeSapClient(profile)
  const service = new AbapToolService({
    async listConnections() { return [] },
    async getClient() { return fake }
  })
  return { fake, service }
}

function createActivationHarness() {
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
  const fake = new FakeSapClient(profile)
  let getClientCalls = 0
  const service = new AbapToolService({
    async listConnections() { return [] },
    async getClient() {
      getClientCalls += 1
      return fake
    }
  })
  return { fake, service, getClientCalls: () => getClientCalls }
}

function createApplicationHarness() {
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
  const fake = new FakeSapClient(profile)
  const other = new FakeSapClient({ ...profile, id: "QAS200", client: "200" })
  const clients = new Map<string, FakeSapClient>([
    [profile.id, fake],
    [other.profile.id, other]
  ])
  const service = new AbapToolService({
    async listConnections() { return [] },
    async getClient(connectionId) {
      const client = clients.get(connectionId.trim().toUpperCase())
      if (!client) throw new Error(`Unknown test connection ${connectionId}`)
      return client
    }
  })
  return { fake, other, service }
}

function expectApplicationValidation(reason: string, message?: string) {
  return (error: unknown) => {
    assert.ok(error instanceof AppError)
    assert.equal(error.code, "SAP_VALIDATION_FAILED")
    assert.equal(error.details?.reason, reason)
    if (message !== undefined) assert.equal(error.message, message)
    return true
  }
}

test("ABAP application plans enforce exact confirmations, connection binding, expiry, and validation", {
  concurrency: false
}, async () => {
  const harness = createApplicationHarness()
  const classPreview = await harness.service.runAbapApplication({
    action: "preview_class",
    connectionId: " dev100 ",
    className: " ZCL_RUNNER "
  }) as Record<string, any>
  assert.equal(classPreview.confirmation, "RUN_CLASS:DEV100:ZCL_RUNNER")
  assert.equal(classPreview.action, "preview_class")
  assert.equal(classPreview.capabilityStatusAtExecution, "unverified")
  assert.equal("capabilityStatus" in classPreview, false)
  assert.equal("connectionId" in classPreview, false)
  const planMaps = harness.service as unknown as {
    executionPlans: Map<string, unknown>
    refactorPlans: Map<string, unknown>
  }
  assert.equal(planMaps.executionPlans.has(classPreview.planId), true)
  assert.equal(planMaps.refactorPlans.has(classPreview.planId), false)

  await assert.rejects(
    harness.service.runAbapApplication({
      action: "execute",
      connectionId: "DEV100",
      planId: classPreview.planId,
      confirmation: `${classPreview.confirmation}:WRONG`
    }),
    expectApplicationValidation("CONFIRMATION_MISMATCH", "Execution confirmation does not match")
  )
  assert.equal(harness.fake.classRunCalls, 0)
  const classResult = await harness.service.runAbapApplication({
    action: "execute",
    connectionId: " dev100 ",
    planId: classPreview.planId,
    confirmation: classPreview.confirmation
  }) as Record<string, any>
  assert.equal(classResult.kind, "class")
  assert.match(classResult.output, /runner output: ZCL_RUNNER/)
  assert.equal("className" in classResult, false)
  assert.equal(harness.fake.classRunCalls, 1)
  assert.equal(harness.fake.replHealthCalls, 0)
  assert.equal(harness.fake.replExecuteCalls, 0)
  await assert.rejects(
    harness.service.runAbapApplication({
      action: "execute",
      connectionId: "DEV100",
      planId: classPreview.planId,
      confirmation: classPreview.confirmation
    }),
    expectApplicationValidation("EXECUTION_PLAN_EXPIRED", "Execution plan is missing or expired")
  )

  const connectionPreview = await harness.service.runAbapApplication({
    action: "preview_class",
    connectionId: "DEV100",
    className: "/ACME/Z_RUN"
  }) as Record<string, any>
  await assert.rejects(
    harness.service.runAbapApplication({
      action: "execute",
      connectionId: " qas200 ",
      planId: connectionPreview.planId,
      confirmation: connectionPreview.confirmation
    }),
    expectApplicationValidation(
      "EXECUTION_PLAN_CONNECTION_MISMATCH",
      "Execution plan belongs to another connection"
    )
  )
  await harness.service.runAbapApplication({
    action: "execute",
    connectionId: " dev100 ",
    planId: connectionPreview.planId,
    confirmation: connectionPreview.confirmation
  })
  assert.equal(harness.fake.classRunCalls, 2)
  assert.equal(harness.other.classRunCalls, 0)

  const code = "WRITE 42."
  const snippetPreview = await harness.service.runAbapApplication({
    action: "preview_snippet",
    connectionId: "DEV100",
    code
  }) as Record<string, any>
  const digest = createHash("sha256").update(code).digest("hex").slice(0, 12)
  assert.equal(snippetPreview.confirmation, `RUN_SNIPPET:DEV100:${digest}`)
  assert.equal(snippetPreview.confirmation.includes(code), false)
  assert.equal(snippetPreview.codeBytes, Buffer.byteLength(code, "utf8"))
  assert.equal(snippetPreview.capabilityStatusAtExecution, "unverified")
  assert.equal("capabilityStatus" in snippetPreview, false)
  assert.equal("connectionId" in snippetPreview, false)

  for (const className of ["zcl_lower", "ZCL-BAD", `Z${"A".repeat(30)}`]) {
    await assert.rejects(
      harness.service.runAbapApplication({
        action: "preview_class",
        connectionId: "DEV100",
        className
      }),
      (error: unknown) => {
        assert.ok(error instanceof AppError)
        assert.equal(error.code, "SAP_VALIDATION_FAILED")
        assert.equal(error.message, "className must be an uppercase ABAP class name")
        assert.deepEqual(error.details, { reason: "CLASS_NAME_INVALID" })
        return true
      }
    )
  }
  for (const invalidCode of [" \t ", "한".repeat(32_769)]) {
    await assert.rejects(
      harness.service.runAbapApplication({
        action: "preview_snippet",
        connectionId: "DEV100",
        code: invalidCode
      }),
      (error: unknown) => {
        assert.ok(error instanceof AppError)
        assert.equal(error.code, "SAP_VALIDATION_FAILED")
        assert.equal(error.message, "code must contain 1 through 98304 UTF-8 bytes")
        assert.deepEqual(error.details, {
          reason: "SNIPPET_SIZE_INVALID",
          bytes: Buffer.byteLength(invalidCode, "utf8")
        })
        return true
      }
    )
  }
  const boundary = "한".repeat(32_768)
  const boundaryPreview = await harness.service.runAbapApplication({
    action: "preview_snippet",
    connectionId: "DEV100",
    code: boundary
  }) as Record<string, any>
  assert.equal(boundaryPreview.codeBytes, 98_304)

  const originalNow = Date.now
  let now = originalNow()
  Date.now = () => now
  try {
    const expiring = await harness.service.runAbapApplication({
      action: "preview_class",
      connectionId: "DEV100",
      className: "ZCL_EXPIRES"
    }) as Record<string, any>
    now += 10 * 60 * 1000 + 1
    await assert.rejects(
      harness.service.runAbapApplication({
        action: "execute",
        connectionId: "DEV100",
        planId: expiring.planId,
        confirmation: expiring.confirmation
      }),
      expectApplicationValidation("EXECUTION_PLAN_EXPIRED", "Execution plan is missing or expired")
    )
  } finally {
    Date.now = originalNow
  }
})

test("ABAP application execution blocks production and consumes each execution attempt once", async () => {
  const production = createApplicationHarness()
  production.fake.profile.environment = "production"
  for (const input of [
    { action: "preview_class" as const, connectionId: "DEV100", className: "ZCL_RUNNER" },
    { action: "preview_snippet" as const, connectionId: "DEV100", code: "WRITE 42." }
  ]) {
    await assert.rejects(
      production.service.runAbapApplication(input),
      (error: unknown) => {
        assert.ok(error instanceof AppError)
        assert.equal(error.code, "SAP_CAPABILITY_UNAVAILABLE")
        assert.equal(error.message, "ABAP execution is disabled on production")
        assert.deepEqual(error.details, {
          reason: "PRODUCTION_EXECUTION_BLOCKED",
          connectionId: "DEV100"
        })
        return true
      }
    )
  }
  assert.deepEqual({
    class: production.fake.classRunCalls,
    health: production.fake.replHealthCalls,
    execute: production.fake.replExecuteCalls
  }, { class: 0, health: 0, execute: 0 })
  const productionHealth = await production.service.runAbapApplication({
    action: "repl_health",
    connectionId: "DEV100"
  }) as Record<string, any>
  assert.equal(productionHealth.health.production, false)
  assert.equal(production.fake.replHealthCalls, 1)

  const rechecked = createApplicationHarness()
  const preview = await rechecked.service.runAbapApplication({
    action: "preview_class",
    connectionId: "DEV100",
    className: "ZCL_RECHECK"
  }) as Record<string, any>
  rechecked.fake.profile.environment = "production"
  await assert.rejects(
    rechecked.service.runAbapApplication({
      action: "execute",
      connectionId: "DEV100",
      planId: preview.planId,
      confirmation: preview.confirmation
    }),
    (error: unknown) => error instanceof AppError &&
      error.details?.reason === "PRODUCTION_EXECUTION_BLOCKED"
  )
  assert.equal(rechecked.fake.classRunCalls, 0)
  rechecked.fake.profile.environment = "development"
  await assert.rejects(
    rechecked.service.runAbapApplication({
      action: "execute",
      connectionId: "DEV100",
      planId: preview.planId,
      confirmation: preview.confirmation
    }),
    expectApplicationValidation("EXECUTION_PLAN_EXPIRED", "Execution plan is missing or expired")
  )

  const replProduction = createApplicationHarness()
  replProduction.fake.replProduction = true
  const snippet = await replProduction.service.runAbapApplication({
    action: "preview_snippet",
    connectionId: "DEV100",
    code: "WRITE 42."
  }) as Record<string, any>
  await assert.rejects(
    replProduction.service.runAbapApplication({
      action: "execute",
      connectionId: "DEV100",
      planId: snippet.planId,
      confirmation: snippet.confirmation
    }),
    (error: unknown) => {
      assert.ok(error instanceof AppError)
      assert.equal(error.code, "SAP_CAPABILITY_UNAVAILABLE")
      assert.equal(error.message, "ABAP REPL is disabled on production")
      return true
    }
  )
  assert.equal(replProduction.fake.replHealthCalls, 1)
  assert.equal(replProduction.fake.replExecuteCalls, 0)
  assert.equal(replProduction.fake.classRunCalls, 0)
  await assert.rejects(
    replProduction.service.runAbapApplication({
      action: "execute",
      connectionId: "DEV100",
      planId: snippet.planId,
      confirmation: snippet.confirmation
    }),
    expectApplicationValidation("EXECUTION_PLAN_EXPIRED", "Execution plan is missing or expired")
  )
  assert.equal(replProduction.fake.replHealthCalls, 1)
  assert.equal(replProduction.fake.replExecuteCalls, 0)
})

test("ABAP application execution normalizes one SAP attempt and bounds Unicode output", async () => {
  const inlineLimit = 96 * 1024
  const bounded = createApplicationHarness()
  bounded.fake.classRunResult = `${"C".repeat(inlineLimit - 1)}😀TAIL`
  const classPreview = await bounded.service.runAbapApplication({
    action: "preview_class",
    connectionId: "DEV100",
    className: "ZCL_BOUNDED"
  }) as Record<string, any>
  const classResult = await bounded.service.runAbapApplication({
    action: "execute",
    connectionId: "DEV100",
    planId: classPreview.planId,
    confirmation: classPreview.confirmation
  }) as Record<string, any>
  assert.equal(classResult.truncated, true)
  assert.equal(classResult.originalBytes, inlineLimit + 7)
  assert.ok(classResult.returnedBytes <= inlineLimit)
  assert.equal(Buffer.byteLength(classResult.output, "utf8"), classResult.returnedBytes)
  assert.equal(classResult.output.includes("�"), false)

  bounded.fake.replExecutionResult = {
    success: false,
    output: `${"O".repeat(inlineLimit - 1)}😀`,
    error: "ERROR-TEXT",
    runtime_ms: 7
  }
  const snippetPreview = await bounded.service.runAbapApplication({
    action: "preview_snippet",
    connectionId: "DEV100",
    code: "WRITE 42."
  }) as Record<string, any>
  const snippetResult = await bounded.service.runAbapApplication({
    action: "execute",
    connectionId: "DEV100",
    planId: snippetPreview.planId,
    confirmation: snippetPreview.confirmation
  }) as Record<string, any>
  assert.equal(snippetResult.output, "O".repeat(inlineLimit - 1))
  assert.equal(snippetResult.error, "E")
  assert.equal(snippetResult.originalBytes, inlineLimit + 3 + 10)
  assert.equal(snippetResult.returnedBytes, inlineLimit)
  assert.equal(snippetResult.truncated, true)
  assert.ok(
    Buffer.byteLength(snippetResult.output + snippetResult.error, "utf8") <= inlineLimit
  )
  assert.equal(snippetResult.output.includes("�"), false)
  assert.equal(bounded.fake.replHealthCalls, 1)
  assert.equal(bounded.fake.replExecuteCalls, 1)

  const operationCases = [
    {
      capabilityId: "execution.class_runner",
      endpoint: "/sap/bc/adt/oo/classrun/ZCL_FAIL",
      counter: (fake: FakeSapClient) => fake.classRunCalls,
      prepare(fake: FakeSapClient) {
        fake.classRunError = Object.assign(new Error("Authorization: Bearer class-secret"), {
          status: 503
        })
      },
      async invoke(service: AbapToolService) {
        const plan = await service.runAbapApplication({
          action: "preview_class", connectionId: "DEV100", className: "ZCL_FAIL"
        }) as Record<string, any>
        return service.runAbapApplication({
          action: "execute", connectionId: "DEV100",
          planId: plan.planId, confirmation: plan.confirmation
        })
      }
    },
    {
      capabilityId: "execution.abap_repl",
      endpoint: "/sap/bc/z_abap_repl",
      counter: (fake: FakeSapClient) => fake.replHealthCalls,
      prepare(fake: FakeSapClient) {
        fake.replHealthError = Object.assign(new Error("Cookie: health-secret"), { status: 503 })
      },
      async invoke(service: AbapToolService) {
        return service.runAbapApplication({ action: "repl_health", connectionId: "DEV100" })
      }
    },
    {
      capabilityId: "execution.abap_repl",
      endpoint: "/sap/bc/z_abap_repl",
      counter: (fake: FakeSapClient) => fake.replExecuteCalls,
      prepare(fake: FakeSapClient) {
        fake.replExecutionError = Object.assign(
          new Error("X-CSRF-Token: execute-secret"),
          { status: 503 }
        )
      },
      async invoke(service: AbapToolService) {
        const plan = await service.runAbapApplication({
          action: "preview_snippet", connectionId: "DEV100", code: "WRITE 42."
        }) as Record<string, any>
        return service.runAbapApplication({
          action: "execute", connectionId: "DEV100",
          planId: plan.planId, confirmation: plan.confirmation
        })
      }
    }
  ]
  for (const operationCase of operationCases) {
    const failed = createApplicationHarness()
    operationCase.prepare(failed.fake)
    await assert.rejects(operationCase.invoke(failed.service), (error: unknown) => {
      assert.ok(error instanceof AppError)
      assert.equal(error.code, "SAP_OPERATION_FAILED")
      assert.deepEqual(error.details, {
        capabilityId: operationCase.capabilityId,
        endpoint: operationCase.endpoint,
        httpStatus: 503
      })
      assert.equal(/class-secret|health-secret|execute-secret/.test(error.message), false)
      return true
    })
    assert.equal(operationCase.counter(failed.fake), 1)
    const capability = (
      failed.service as unknown as { capabilities: SapCapabilityRegistry }
    ).capabilities.list("DEV100", "", "execution").find(
      item => item.id === operationCase.capabilityId
    )
    assert.ok(capability?.evidence.includes(`http:503:${operationCase.endpoint}`))
  }
})

test("ABAP application execution plans stay one-use across concurrency and operation failures", async () => {
  const concurrent = createApplicationHarness()
  const concurrentPlan = await concurrent.service.runAbapApplication({
    action: "preview_class",
    connectionId: "DEV100",
    className: "ZCL_CONCURRENT"
  }) as Record<string, any>
  const concurrentExecutions = await Promise.allSettled([
    concurrent.service.runAbapApplication({
      action: "execute",
      connectionId: "DEV100",
      planId: concurrentPlan.planId,
      confirmation: concurrentPlan.confirmation
    }),
    concurrent.service.runAbapApplication({
      action: "execute",
      connectionId: "DEV100",
      planId: concurrentPlan.planId,
      confirmation: concurrentPlan.confirmation
    })
  ])
  const fulfilled = concurrentExecutions.filter(result => result.status === "fulfilled")
  const rejected = concurrentExecutions.filter(result => result.status === "rejected")
  assert.equal(fulfilled.length, 1)
  assert.equal(rejected.length, 1)
  assert.equal(
    (fulfilled[0] as PromiseFulfilledResult<Record<string, any>>).value
      .capabilityStatusAtExecution,
    "unverified"
  )
  assert.ok((rejected[0] as PromiseRejectedResult).reason instanceof AppError)
  assert.equal(
    (rejected[0] as PromiseRejectedResult).reason.details?.reason,
    "EXECUTION_PLAN_EXPIRED"
  )
  assert.equal(concurrent.fake.classRunCalls, 1)

  const failedClass = createApplicationHarness()
  const failedClassPlan = await failedClass.service.runAbapApplication({
    action: "preview_class",
    connectionId: "DEV100",
    className: "ZCL_FAIL_ONCE"
  }) as Record<string, any>
  failedClass.fake.classRunError = Object.assign(new Error("class failed"), { status: 503 })
  await assert.rejects(
    failedClass.service.runAbapApplication({
      action: "execute",
      connectionId: "DEV100",
      planId: failedClassPlan.planId,
      confirmation: failedClassPlan.confirmation
    }),
    (error: unknown) => error instanceof AppError && error.code === "SAP_OPERATION_FAILED"
  )
  await assert.rejects(
    failedClass.service.runAbapApplication({
      action: "execute",
      connectionId: "DEV100",
      planId: failedClassPlan.planId,
      confirmation: failedClassPlan.confirmation
    }),
    expectApplicationValidation("EXECUTION_PLAN_EXPIRED", "Execution plan is missing or expired")
  )
  assert.equal(failedClass.fake.classRunCalls, 1)

  const failedSnippet = createApplicationHarness()
  const failedSnippetPlan = await failedSnippet.service.runAbapApplication({
    action: "preview_snippet",
    connectionId: "DEV100",
    code: "WRITE 'FAIL ONCE'."
  }) as Record<string, any>
  failedSnippet.fake.replExecutionError = Object.assign(new Error("snippet failed"), {
    status: 503
  })
  await assert.rejects(
    failedSnippet.service.runAbapApplication({
      action: "execute",
      connectionId: "DEV100",
      planId: failedSnippetPlan.planId,
      confirmation: failedSnippetPlan.confirmation
    }),
    (error: unknown) => error instanceof AppError && error.code === "SAP_OPERATION_FAILED"
  )
  assert.equal(failedSnippet.fake.replHealthCalls, 1)
  assert.equal(failedSnippet.fake.replExecuteCalls, 1)
  await assert.rejects(
    failedSnippet.service.runAbapApplication({
      action: "execute",
      connectionId: "DEV100",
      planId: failedSnippetPlan.planId,
      confirmation: failedSnippetPlan.confirmation
    }),
    expectApplicationValidation("EXECUTION_PLAN_EXPIRED", "Execution plan is missing or expired")
  )
  assert.equal(failedSnippet.fake.replHealthCalls, 1)
  assert.equal(failedSnippet.fake.replExecuteCalls, 1)
})

test("ABAP application execution plan cache evicts and purges bounded entries", async () => {
  const bounded = createApplicationHarness()
  const previews: Array<Record<string, any>> = []
  for (let index = 0; index < 101; index += 1) {
    previews.push(await bounded.service.runAbapApplication({
      action: "preview_class",
      connectionId: "DEV100",
      className: `ZCL_CACHE_${String(index).padStart(3, "0")}`
    }) as Record<string, any>)
  }
  const boundedPlans = (
    bounded.service as unknown as { executionPlans: Map<string, { expiresAt: number }> }
  ).executionPlans
  assert.equal(boundedPlans.size, 100)
  const oldest = previews[0]!
  await assert.rejects(
    bounded.service.runAbapApplication({
      action: "execute",
      connectionId: "DEV100",
      planId: oldest.planId,
      confirmation: oldest.confirmation
    }),
    expectApplicationValidation("EXECUTION_PLAN_EXPIRED", "Execution plan is missing or expired")
  )
  const latest = previews.at(-1)!
  const latestResult = await bounded.service.runAbapApplication({
    action: "execute",
    connectionId: "DEV100",
    planId: latest.planId,
    confirmation: latest.confirmation
  }) as Record<string, any>
  assert.equal(latestResult.kind, "class")
  assert.equal(bounded.fake.classRunCalls, 1)

  const purged = createApplicationHarness()
  const expired = await purged.service.runAbapApplication({
    action: "preview_class",
    connectionId: "DEV100",
    className: "ZCL_PURGE_OLD"
  }) as Record<string, any>
  const purgedPlans = (
    purged.service as unknown as { executionPlans: Map<string, { expiresAt: number }> }
  ).executionPlans
  purgedPlans.get(expired.planId)!.expiresAt = 0
  const live = await purged.service.runAbapApplication({
    action: "preview_class",
    connectionId: "DEV100",
    className: "ZCL_PURGE_LIVE"
  }) as Record<string, any>
  assert.equal(purgedPlans.size, 1)
  assert.equal(purgedPlans.has(expired.planId), false)
  assert.equal(purgedPlans.has(live.planId), true)
  await assert.rejects(
    purged.service.runAbapApplication({
      action: "execute",
      connectionId: "DEV100",
      planId: expired.planId,
      confirmation: expired.confirmation
    }),
    expectApplicationValidation("EXECUTION_PLAN_EXPIRED", "Execution plan is missing or expired")
  )
})

test("ABAP application capability guards preserve status, privacy, and zero-call rejection", async () => {
  const snippet = createApplicationHarness()
  const rawCode = "WRITE 'UNIQUE_RAW_SNIPPET_MARKER_8173'."
  const snippetPlan = await snippet.service.runAbapApplication({
    action: "preview_snippet",
    connectionId: "DEV100",
    code: rawCode
  }) as Record<string, any>
  assert.equal(JSON.stringify(snippetPlan).includes(rawCode), false)
  assert.match(snippetPlan.confirmation, /^RUN_SNIPPET:DEV100:[0-9a-f]{12}$/)
  const snippetResult = await snippet.service.runAbapApplication({
    action: "execute",
    connectionId: "DEV100",
    planId: snippetPlan.planId,
    confirmation: snippetPlan.confirmation
  }) as Record<string, any>
  assert.equal(snippetResult.capabilityStatusAtExecution, "supported")
  assert.equal(snippet.fake.replHealthCalls, 1)
  assert.equal(snippet.fake.replExecuteCalls, 1)

  const unsupportedClass = createApplicationHarness()
  const unsupportedClassPlan = await unsupportedClass.service.runAbapApplication({
    action: "preview_class",
    connectionId: "DEV100",
    className: "ZCL_UNSUPPORTED"
  }) as Record<string, any>
  ;(
    unsupportedClass.service as unknown as { capabilities: SapCapabilityRegistry }
  ).capabilities.observeHttpFailure(
    "DEV100",
    "execution.class_runner",
    404,
    "/sap/bc/adt/oo/classrun/ZCL_UNSUPPORTED"
  )
  await assert.rejects(
    unsupportedClass.service.runAbapApplication({
      action: "execute",
      connectionId: "DEV100",
      planId: unsupportedClassPlan.planId,
      confirmation: unsupportedClassPlan.confirmation
    }),
    (error: unknown) => error instanceof AppError && error.code === "SAP_CAPABILITY_UNAVAILABLE"
  )
  assert.equal(unsupportedClass.fake.classRunCalls, 0)
  await assert.rejects(
    unsupportedClass.service.runAbapApplication({
      action: "execute",
      connectionId: "DEV100",
      planId: unsupportedClassPlan.planId,
      confirmation: unsupportedClassPlan.confirmation
    }),
    expectApplicationValidation("EXECUTION_PLAN_EXPIRED", "Execution plan is missing or expired")
  )
  assert.equal(unsupportedClass.fake.classRunCalls, 0)

  const unsupportedRepl = createApplicationHarness()
  const unsupportedReplPlan = await unsupportedRepl.service.runAbapApplication({
    action: "preview_snippet",
    connectionId: "DEV100",
    code: "WRITE 'UNSUPPORTED'."
  }) as Record<string, any>
  ;(
    unsupportedRepl.service as unknown as { capabilities: SapCapabilityRegistry }
  ).capabilities.observeHttpFailure(
    "DEV100",
    "execution.abap_repl",
    404,
    "/sap/bc/z_abap_repl"
  )
  await assert.rejects(
    unsupportedRepl.service.runAbapApplication({
      action: "execute",
      connectionId: "DEV100",
      planId: unsupportedReplPlan.planId,
      confirmation: unsupportedReplPlan.confirmation
    }),
    (error: unknown) => error instanceof AppError && error.code === "SAP_CAPABILITY_UNAVAILABLE"
  )
  assert.equal(unsupportedRepl.fake.replHealthCalls, 0)
  assert.equal(unsupportedRepl.fake.replExecuteCalls, 0)
})

test("activateObject validates batches and classifies one SAP activation response conservatively", async () => {
  const firstUrl = "adt://dev100/sap/bc/adt/oo/classes/zcl_first/source/main"
  const secondUrl = "adt://dev100/sap/bc/adt/oo/classes/zcl_second/source/main"
  const expectValidation = async (
    operation: Promise<unknown>,
    message: string,
    reason: string
  ) => assert.rejects(operation, (error: unknown) => {
    assert.ok(error instanceof AppError)
    assert.equal(error.code, "SAP_VALIDATION_FAILED")
    assert.equal(error.message, message)
    assert.deepEqual(error.details, { reason })
    return true
  })

  const ambiguous = createActivationHarness()
  await expectValidation(
    ambiguous.service.activateObject({
      url: firstUrl,
      urls: [firstUrl]
    } as unknown as ActivateObjectInput),
    "Provide exactly one of url or urls",
    "ACTIVATION_INPUT_AMBIGUOUS"
  )
  assert.equal(ambiguous.getClientCalls(), 0)
  assert.equal(ambiguous.fake.batchActivationCalls, 0)

  const empty = createActivationHarness()
  await expectValidation(
    empty.service.activateObject({ urls: [] }),
    "Batch activation requires 1 through 100 URLs",
    "ACTIVATION_CARDINALITY_INVALID"
  )
  assert.equal(empty.fake.batchActivationCalls, 0)
  assert.equal(empty.getClientCalls(), 0)

  const oversized = createActivationHarness()
  await expectValidation(
    oversized.service.activateObject({ urls: Array.from({ length: 101 }, () => firstUrl) }),
    "Batch activation requires 1 through 100 URLs",
    "ACTIVATION_CARDINALITY_INVALID"
  )
  assert.equal(oversized.fake.batchActivationCalls, 0)
  assert.equal(oversized.getClientCalls(), 0)

  const crossConnection = createActivationHarness()
  await expectValidation(
    crossConnection.service.activateObject({
      urls: [firstUrl, "adt://qas200/sap/bc/adt/oo/classes/zcl_second/source/main"]
    }),
    "Batch activation requires exactly one connection",
    "CROSS_CONNECTION_BATCH"
  )
  assert.equal(crossConnection.getClientCalls(), 0)
  assert.equal(crossConnection.fake.batchActivationCalls, 0)

  const legacy = createActivationHarness()
  assert.deepEqual(
    await legacy.service.activateObject({
      url: `adt://dev100${object.uri}/source/main`
    }),
    {
      connectionId: "DEV100",
      object: { name: object.name, type: object.type },
      success: true,
      messages: [],
      inactive: []
    }
  )
  assert.equal(legacy.fake.batchActivationCalls, 0)

  const complete = createActivationHarness()
  const completeResult = await complete.service.activateObject({
    urls: [firstUrl, secondUrl]
  }) as unknown as {
    status: string
    requested: SapObjectReference[]
    objectResults: Array<{ outcome: string }>
  }
  assert.equal(completeResult.status, "complete")
  assert.deepEqual(completeResult.requested.map(item => item.name), ["ZCL_FIRST", "ZCL_SECOND"])
  assert.deepEqual(completeResult.objectResults.map(item => item.outcome), ["activated", "activated"])
  assert.equal(complete.getClientCalls(), 1)
  assert.equal(complete.fake.inactiveObjectCalls, 1)
  assert.equal(complete.fake.batchActivationCalls, 1)
  assert.deepEqual(
    complete.fake.lastBatchActivation.map(item => item["adtcore:name"]),
    ["ZCL_FIRST", "ZCL_SECOND"]
  )

  const noInactive = createActivationHarness()
  noInactive.fake.inactiveObjects = []
  const noInactiveResult = await noInactive.service.activateObject({ urls: [firstUrl] }) as unknown as {
    status: string
    objectResults: Array<{ outcome: string }>
  }
  assert.equal(noInactiveResult.status, "partial")
  assert.deepEqual(noInactiveResult.objectResults.map(item => item.outcome), ["unknown"])
  assert.equal(noInactive.fake.batchActivationCalls, 0)

  const partial = createActivationHarness()
  partial.fake.batchActivationResult = {
    ...structuredClone(DEVELOPMENT_PARITY_FIXTURES.activationPartial),
    inactive: [inactiveClass("ZCL_SECOND")]
  }
  const partialResult = await partial.service.activateObject({
    urls: [firstUrl, secondUrl]
  }) as unknown as {
    status: string
    objectResults: Array<{ outcome: string }>
  }
  assert.equal(partialResult.status, "partial")
  assert.deepEqual(partialResult.objectResults.map(item => item.outcome), ["unknown", "failed"])
  assert.equal(partial.fake.batchActivationCalls, 1)

  const executionFailure = createActivationHarness()
  executionFailure.fake.batchActivationError = new Error("SAP activation failed")
  await assert.rejects(
    executionFailure.service.activateObject({ urls: [firstUrl, secondUrl] }),
    (error: unknown) => {
      assert.ok(error instanceof AppError)
      assert.equal(error.code, "SAP_OPERATION_FAILED")
      return true
    }
  )
  assert.equal(executionFailure.fake.batchActivationCalls, 1)
})

test("activateObject canonicalizes SAP evidence and tolerates malformed result fields", async () => {
  const firstUrl = "adt://dev100/sap/bc/adt/oo/classes/zcl_first/source/main"
  const shortNameUrl = "adt://dev100/sap/bc/adt/oo/classes/zcl_a/source/main"

  const caseDifferent = createActivationHarness()
  const uppercaseInactive = inactiveClass("ZCL_FIRST")
  uppercaseInactive.object!["adtcore:uri"] =
    "/SAP/BC/ADT/OO/CLASSES/ZCL_FIRST/SOURCE/MAIN?version=inactive#result"
  const uppercaseRemaining = inactiveClass("ZCL_FIRST")
  uppercaseRemaining.object!["adtcore:uri"] = "/SAP/BC/ADT/OO/CLASSES/ZCL_FIRST/"
  caseDifferent.fake.inactiveObjects = [uppercaseInactive]
  caseDifferent.fake.batchActivationResult = {
    success: false,
    messages: [],
    inactive: [uppercaseRemaining]
  }
  const caseResult = await caseDifferent.service.activateObject({
    urls: [firstUrl]
  }) as unknown as { objectResults: Array<{ outcome: string }> }
  assert.equal(caseDifferent.fake.batchActivationCalls, 1)
  assert.deepEqual(caseResult.objectResults.map(item => item.outcome), ["failed"])

  const boundary = createActivationHarness()
  boundary.fake.inactiveObjects = [inactiveClass("ZCL_A")]
  boundary.fake.batchActivationResult = {
    success: false,
    messages: [{
      objDescr: "Activation failed for ZCL_AB",
      type: "E",
      line: 1,
      href: "",
      forceSupported: false,
      shortText: "Wrong object"
    }],
    inactive: []
  }
  const boundaryResult = await boundary.service.activateObject({
    urls: [shortNameUrl]
  }) as unknown as {
    objectResults: Array<{ outcome: string; messages: unknown[] }>
  }
  assert.deepEqual(boundaryResult.objectResults, [{
    object: {
      name: "ZCL_A",
      type: "CLAS/OC"
    },
    outcome: "unknown",
    messages: []
  }])

  const exactFallback = createActivationHarness()
  exactFallback.fake.inactiveObjects = [inactiveClass("ZCL_A")]
  exactFallback.fake.batchActivationResult = {
    success: false,
    messages: [{
      objDescr: "Activation failed for ZCL_A",
      type: "E",
      line: 1,
      href: "",
      forceSupported: false,
      shortText: "Exact object"
    }],
    inactive: []
  }
  const exactFallbackResult = await exactFallback.service.activateObject({
    urls: [shortNameUrl]
  }) as unknown as { objectResults: Array<{ outcome: string }> }
  assert.deepEqual(exactFallbackResult.objectResults.map(item => item.outcome), ["failed"])

  const malformed = createActivationHarness()
  malformed.fake.inactiveObjects = [
    null as any,
    { object: { ...inactiveClass("ZCL_A").object!, "adtcore:uri": undefined } } as any,
    inactiveClass("ZCL_A")
  ]
  const malformedMessage = {
    line: 1,
    forceSupported: false,
    shortText: "Malformed SAP message"
  }
  malformed.fake.batchActivationResult = {
    success: false,
    messages: [null as any, malformedMessage as any],
    inactive: [
      null as any,
      { object: { ...inactiveClass("ZCL_AB").object!, "adtcore:uri": null } } as any
    ]
  }
  const malformedResult = await malformed.service.activateObject({
    urls: [shortNameUrl]
  }) as unknown as {
    objectResults: Array<{ outcome: string; messages: unknown[] }>
    messages: unknown[]
  }
  assert.equal(malformed.fake.batchActivationCalls, 1)
  assert.deepEqual(malformedResult.objectResults.map(item => item.outcome), ["unknown"])
  assert.deepEqual(malformedResult.objectResults[0]!.messages, [])
  assert.equal(malformedResult.messages[1], malformedMessage)

  const hrefPrecedence = createActivationHarness()
  hrefPrecedence.fake.inactiveObjects = [inactiveClass("ZCL_A")]
  hrefPrecedence.fake.batchActivationResult = {
    success: false,
    messages: [{
      objDescr: "Activation failed for ZCL_A",
      type: "E",
      line: 1,
      href: "/sap/bc/adt/oo/classes/zcl_ab",
      forceSupported: false,
      shortText: "Different href"
    }],
    inactive: []
  }
  const precedenceResult = await hrefPrecedence.service.activateObject({
    urls: [shortNameUrl]
  }) as unknown as { objectResults: Array<{ outcome: string; messages: unknown[] }> }
  assert.deepEqual(precedenceResult.objectResults.map(item => item.outcome), ["unknown"])
  assert.deepEqual(precedenceResult.objectResults[0]!.messages, [])

  const invalidPrefix = createActivationHarness()
  invalidPrefix.fake.inactiveObjects = [inactiveClass("ZCL_FIRST")]
  invalidPrefix.fake.batchActivationResult = {
    success: false,
    messages: [{
      objDescr: "Unrelated object",
      type: "E",
      line: 1,
      href: "garbage/sap/bc/adt/oo/classes/zcl_first",
      forceSupported: false,
      shortText: "Malformed href"
    }],
    inactive: []
  }
  const invalidPrefixResult = await invalidPrefix.service.activateObject({
    urls: [firstUrl]
  }) as unknown as { objectResults: Array<{ outcome: string; messages: unknown[] }> }
  assert.deepEqual(invalidPrefixResult.objectResults.map(item => item.outcome), ["unknown"])
  assert.deepEqual(invalidPrefixResult.objectResults[0]!.messages, [])

  const absoluteHttp = createActivationHarness()
  absoluteHttp.fake.inactiveObjects = [inactiveClass("ZCL_FIRST")]
  absoluteHttp.fake.batchActivationResult = {
    success: false,
    messages: [{
      objDescr: "Unrelated object",
      type: "E",
      line: 1,
      href: "https://sap.example.test/sap/bc/adt/oo/classes/zcl_first/source/main?x=1#fragment",
      forceSupported: false,
      shortText: "Absolute href"
    }],
    inactive: []
  }
  const absoluteHttpResult = await absoluteHttp.service.activateObject({
    urls: [firstUrl]
  }) as unknown as { objectResults: Array<{ outcome: string; messages: unknown[] }> }
  assert.deepEqual(absoluteHttpResult.objectResults.map(item => item.outcome), ["failed"])
  assert.equal(absoluteHttpResult.objectResults[0]!.messages.length, 1)
})

test("activateObject deduplicates SAP submission without dropping requested results", async () => {
  const duplicate = createActivationHarness()
  const result = await duplicate.service.activateObject({
    urls: [
      "adt://dev100/sap/bc/adt/oo/classes/zcl_first",
      "adt://dev100/sap/bc/adt/oo/classes/zcl_first/source/main"
    ]
  }) as unknown as {
    requested: SapObjectReference[]
    objectResults: Array<{ outcome: string }>
  }

  assert.equal(duplicate.fake.batchActivationCalls, 1)
  assert.equal(duplicate.fake.lastBatchActivation.length, 1)
  assert.equal(result.requested.length, 2)
  assert.equal(result.objectResults.length, 2)
  assert.deepEqual(result.objectResults.map(item => item.outcome), ["activated", "activated"])
})

test("activateObject rejects malformed unions and enforces package and capability safety", async () => {
  const firstUrl = "adt://dev100/sap/bc/adt/oo/classes/zcl_first/source/main"
  const secondUrl = "adt://dev100/sap/bc/adt/oo/classes/zcl_second/source/main"
  const expectAmbiguous = async (harness: ReturnType<typeof createActivationHarness>, input: unknown) => {
    await assert.rejects(
      harness.service.activateObject(input as ActivateObjectInput),
      (error: unknown) => {
        assert.ok(error instanceof AppError)
        assert.equal(error.code, "SAP_VALIDATION_FAILED")
        assert.equal(error.message, "Provide exactly one of url or urls")
        assert.deepEqual(error.details, { reason: "ACTIVATION_INPUT_AMBIGUOUS" })
        return true
      }
    )
    assert.equal(harness.getClientCalls(), 0)
    assert.equal(harness.fake.batchActivationCalls, 0)
  }
  await expectAmbiguous(createActivationHarness(), { url: 123 })
  await expectAmbiguous(createActivationHarness(), { url: 123, urls: [firstUrl] })
  await expectAmbiguous(createActivationHarness(), { urls: [123] })
  await expectAmbiguous(createActivationHarness(), { url: firstUrl, connectionId: 123 })

  const packageBlocked = createActivationHarness()
  packageBlocked.fake.objectPackages.set("ZCL_SECOND", "Z_OTHER")
  await assert.rejects(
    packageBlocked.service.activateObject({ urls: [firstUrl, secondUrl] }),
    (error: unknown) => {
      assert.ok(error instanceof AppError)
      assert.equal(error.code, "PACKAGE_NOT_ALLOWED")
      return true
    }
  )
  assert.equal(packageBlocked.fake.inactiveObjectCalls, 0)
  assert.equal(packageBlocked.fake.batchActivationCalls, 0)

  const unsupported = createActivationHarness()
  const unsupportedRegistry = (unsupported.service as unknown as {
    capabilities: SapCapabilityRegistry
  }).capabilities
  unsupportedRegistry.observeHttpFailure(
    "DEV100",
    "repository.activate.batch",
    404,
    "/sap/bc/adt/activation"
  )
  await assert.rejects(
    unsupported.service.activateObject({ urls: [firstUrl] }),
    (error: unknown) => {
      assert.ok(error instanceof AppError)
      assert.equal(error.code, "SAP_CAPABILITY_UNAVAILABLE")
      return true
    }
  )
  assert.equal(unsupported.fake.batchActivationCalls, 0)

  const success = createActivationHarness()
  const successRegistry = (success.service as unknown as {
    capabilities: SapCapabilityRegistry
  }).capabilities
  const successResult = await success.service.activateObject({
    urls: [firstUrl]
  }) as unknown as { capabilityStatusAtExecution: string }
  assert.equal(successResult.capabilityStatusAtExecution, "unverified")
  assert.equal(success.fake.batchActivationCalls, 1)
  const successCapability = successRegistry.list("DEV100", "").find(
    item => item.id === "repository.activate.batch"
  )!
  assert.equal(successCapability.status, "supported")
  assert.equal(successCapability.authorization, "allowed")
  assert.ok(successCapability.evidence.includes("success:/sap/bc/adt/activation"))

  const missingEndpoint = createActivationHarness()
  const secret = "activation-secret"
  missingEndpoint.fake.batchActivationError = Object.assign(
    new Error(`Authorization: Bearer ${secret}`),
    { response: { status: 404 } }
  )
  await assert.rejects(
    missingEndpoint.service.activateObject({ urls: [firstUrl] }),
    (error: unknown) => {
      assert.ok(error instanceof AppError)
      assert.equal(error.code, "SAP_CAPABILITY_UNAVAILABLE")
      assert.deepEqual(error.details, {
        capabilityId: "repository.activate.batch",
        endpoint: "/sap/bc/adt/activation",
        httpStatus: 404
      })
      assert.equal(error.message.includes(secret), false)
      return true
    }
  )
  assert.equal(missingEndpoint.fake.batchActivationCalls, 1)
  const missingRegistry = (missingEndpoint.service as unknown as {
    capabilities: SapCapabilityRegistry
  }).capabilities
  const missingCapability = missingRegistry.list("DEV100", "").find(
    item => item.id === "repository.activate.batch"
  )!
  assert.equal(missingCapability.system, "not_advertised")
  assert.equal(missingCapability.status, "unsupported")
  assert.ok(missingCapability.evidence.includes("http:404:/sap/bc/adt/activation"))
})

test("ConnectionManager logs in once, caches the client, and logs out", async t => {
  const directory = await mkdtemp(join(tmpdir(), "sap-abap-mcp-connection-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const profiles = new ProfileStore(directory)
  const profile = await profiles.upsert({
    id: "DEV100",
    url: "https://sap.example.test",
    client: "100",
    username: "DEVELOPER"
  })
  const secrets = new MemorySecretStore()
  await secrets.set(profile.id, "secret")
  const fake = new FakeSapClient(profile)
  const manager = new ConnectionManager(profiles, secrets, () => fake, profile.id)

  assert.equal(await manager.getClient("dev100"), fake)
  assert.equal(await manager.getClient("DEV100"), fake)
  assert.equal(fake.loginCount, 1)
  await manager.close()
  assert.equal(fake.logoutCount, 1)
})

test("ConnectionManager keeps multiple SAP profiles and clients isolated", async t => {
  const directory = await mkdtemp(join(tmpdir(), "sap-abap-mcp-multi-profile-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const profiles = new ProfileStore(directory)
  const dev = await profiles.upsert({
    id: "DEV100",
    url: "https://sap-dev.example.test",
    client: "100",
    username: "DEV_USER"
  })
  const quality = await profiles.upsert({
    id: "QAS200",
    url: "https://sap-qas.example.test",
    client: "200",
    environment: "quality",
    username: "QAS_USER"
  })
  const secrets = new MemorySecretStore()
  await secrets.set(dev.id, "dev-secret")
  await secrets.set(quality.id, "qas-secret")

  const clients = new Map<string, FakeSapClient>()
  const manager = new ConnectionManager(profiles, secrets, profile => {
    const client = new FakeSapClient(profile)
    clients.set(profile.id, client)
    return client
  })

  assert.deepEqual(
    (await manager.listConnections()).map(connection => connection.id),
    ["DEV100", "QAS200"]
  )
  assert.equal((await manager.getClient("DEV100")).profile.url, dev.url)
  assert.equal((await manager.getClient("QAS200")).profile.url, quality.url)
  assert.notEqual(clients.get("DEV100"), clients.get("QAS200"))
  assert.equal(clients.get("DEV100")?.loginCount, 1)
  assert.equal(clients.get("QAS200")?.loginCount, 1)

  await manager.close()
  assert.equal(clients.get("DEV100")?.logoutCount, 1)
  assert.equal(clients.get("QAS200")?.logoutCount, 1)
})

test("ABAP method extraction returns exact 1-based source lines", () => {
  assert.deepEqual(extractAbapMethod(source, "RUN"), {
    code: ["  METHOD run.", "    result = 42.", "  ENDMETHOD."].join("\n"),
    startLine: 2,
    endLine: 4
  })
})

test("ABAP source replacement requires one exact match", () => {
  assert.match(replaceExactlyOnce(source, "result = 42", "result = 43"), /result = 43/)
  assert.throws(
    () => replaceExactlyOnce("WRITE x.\nWRITE x.", "WRITE x.", "WRITE y."),
    /matched 2 locations/
  )
})

test("class include diagnostics preserve the include syntax URI", async () => {
  const { fake, service } = createBdefHarness()
  const testIncludeUri = `${object.uri}/includes/testclasses`
  fake.currentSource = [
    "CLASS ltc_demo DEFINITION FOR TESTING.",
    "ENDCLASS."
  ].join("\n")

  await service.getAbapDiagnostics({
    fileUri: `adt://dev100${testIncludeUri}`,
    connectionId: "DEV100",
    startIndex: 0,
    maxResults: 100
  })

  assert.deepEqual(fake.syntaxCheckArgs.at(-1), {
    objectUri: testIncludeUri,
    sourceUri: testIncludeUri,
    sourceText: fake.currentSource,
    mainProgram: undefined
  })

  await service.replaceStringInObject({
    fileUri: `adt://dev100${testIncludeUri}`,
    oldString: "ltc_demo",
    newString: "ltc_demo_changed",
    connectionId: "DEV100",
    transport: "DEVK900123",
    activate: false
  })

  assert.equal(fake.replaceSourceCalls.at(-1)?.objectUri, object.uri)
  assert.equal(fake.replaceSourceCalls.at(-1)?.sourceUri, testIncludeUri)
  assert.equal(fake.replaceSourceCalls.at(-1)?.syntaxObjectUri, testIncludeUri)
})

test("dependency graph normalizes method owners and class pools", async () => {
  const { fake, service } = createBdefHarness()
  const usageReference = (
    owner: string,
    type: "CLAS/OM" | "PROG/P",
    name: string
  ) => ({
    uri: type === "CLAS/OM"
      ? `/sap/bc/adt/oo/classes/${owner.toLowerCase()}/source/main#type=CLAS/OM;name=${name}`
      : `/sap/bc/adt/programs/programs/${name.toLowerCase()}`,
    objectIdentifier: `ABAPFullName;${owner}=========CP`,
    parentUri: `/sap/bc/adt/oo/classes/${owner.toLowerCase()}`,
    isResult: true,
    canHaveChildren: false,
    usageInformation: "method call",
    "adtcore:responsible": "DEVELOPER",
    "adtcore:name": name,
    "adtcore:type": type,
    packageRef: {
      "adtcore:uri": "/sap/bc/adt/packages/z_demo",
      "adtcore:name": "Z_DEMO"
    }
  })
  fake.usageReferencesResult = [
    usageReference("ZCL_FIRST", "CLAS/OM", "PING"),
    usageReference("ZCL_SECOND", "CLAS/OM", "PING"),
    usageReference("ZCL_FIRST", "PROG/P", "ZCL_FIRST=========CP")
  ]

  const graph = await service.dependencyGraph({
    objectName: object.name,
    objectType: object.type,
    connectionId: "DEV100",
    depth: 1,
    maxNodes: 20,
    customOnly: true
  })

  assert.deepEqual(
    graph.nodes.map(node => String(node.id)).sort(),
    ["ZCL_DEMO::CLAS/OC", "ZCL_FIRST::CLAS/OC", "ZCL_SECOND::CLAS/OC"].sort()
  )
  assert.equal(graph.nodes.some(node => node.id === "PING::CLAS/OM"), false)
  assert.equal(graph.nodes.some(node => /=========CP/.test(String(node.name))), false)
  assert.equal(graph.edges.some(edge => edge.member === "PING"), true)
})

test("BDEF create object writes exact source and activates after creation", async () => {
  const { fake, service } = createBdefHarness()
  const bdefSource = "managed implementation in class zbp_i_demo unique;"
  const objectUri = "/sap/bc/adt/bo/behaviordefinitions/ZI_DEMO"

  const created = await service.createObjectProgrammatically({
    objectType: "BDEF/BDO",
    name: "ZI_DEMO",
    description: "Demo behavior",
    packageName: "Z_DEMO",
    connectionId: "DEV100",
    source: bdefSource,
    activate: true,
    additionalOptions: {
      transportRequest: { type: "existing", number: "DEVK900123" }
    }
  }) as Record<string, any>

  assert.deepEqual(created, {
    connectionId: "DEV100",
    success: true,
    object: {
      name: "ZI_DEMO",
      type: "BDEF/BDO",
      uri: objectUri,
      packageName: "Z_DEMO"
    },
    transport: "DEVK900123",
    capabilityStatusAtExecution: "unverified",
    sourceUri: `${objectUri}/source/main`,
    diagnostics: [],
    activation: { success: true, messages: [], inactive: [] },
    activationSkipped: false
  })
  assert.equal(fake.createObjectCalls, 1)
  assert.equal(fake.createdObject && (fake.createdObject as { objtype: string }).objtype, "BDEF/BDO")
  assert.equal((fake.createdObject as { transport: string }).transport, "DEVK900123")
  assert.deepEqual(fake.objectCreationOperations, [
    "validate",
    "create",
    "read_source",
    "replace_source"
  ])
  assert.deepEqual(fake.replaceSourceCalls, [{
    objectName: "ZI_DEMO",
    objectUri,
    sourceUri: `${objectUri}/source/main`,
    expectedSource: source,
    nextSource: bdefSource,
    transport: "DEVK900123",
    activate: true
  }])
  assert.equal(fake.deleteObjectCalls, 0)
})

test("BDEF create object rejects known unsupported capability before SAP calls", async () => {
  const { fake, service } = createBdefHarness()
  const capabilities = (
    service as unknown as { capabilities: SapCapabilityRegistry }
  ).capabilities
  capabilities.observeHttpFailure(
    "DEV100",
    "repository.create.bdef",
    404,
    "bo/behaviordefinitions"
  )

  await assert.rejects(
    service.createObjectProgrammatically({
      objectType: "BDEF/BDO",
      name: "ZI_UNSUPPORTED",
      description: "Unsupported behavior",
      packageName: "Z_DEMO",
      connectionId: "DEV100",
      activate: false,
      additionalOptions: {
        transportRequest: { type: "new", description: "Must not be created" }
      }
    }),
    (error: unknown) => {
      assert.ok(error instanceof AppError)
      assert.equal(error.code, "SAP_CAPABILITY_UNAVAILABLE")
      assert.equal(error.message, "BDEF creation is unavailable")
      assert.deepEqual(error.details, {
        capabilityId: "repository.create.bdef",
        endpoint: "bo/behaviordefinitions"
      })
      return true
    }
  )
  assert.equal(fake.validateNewObjectCalls, 0)
  assert.equal(fake.createTransportCalls, 0)
  assert.equal(fake.createObjectCalls, 0)
  assert.deepEqual(fake.readSourceCalls, [])
  assert.deepEqual(fake.replaceSourceCalls, [])
  assert.equal(fake.deleteObjectCalls, 0)
})

test("create object direct callers may omit source and activate", async () => {
  const { fake, service } = createBdefHarness()

  const created = await service.createObjectProgrammatically({
    objectType: "CLAS/OC",
    name: "ZCL_LEGACY",
    description: "Legacy direct caller",
    packageName: "Z_DEMO",
    connectionId: "DEV100",
    additionalOptions: {
      transportRequest: { type: "existing", number: "DEVK900123" }
    }
  })

  assert.deepEqual(created, {
    connectionId: "DEV100",
    success: true,
    object: {
      name: "ZCL_LEGACY",
      type: "CLAS/OC",
      uri: "/sap/bc/adt/oo/classes/ZCL_LEGACY",
      packageName: "Z_DEMO"
    },
    transport: "DEVK900123"
  })
  assert.deepEqual(fake.objectCreationOperations, ["validate", "create"])
  assert.equal((fake.createdObject as { transport: string }).transport, "DEVK900123")
  assert.deepEqual(fake.readSourceCalls, [])
  assert.deepEqual(fake.replaceSourceCalls, [])
  assert.equal(fake.deleteObjectCalls, 0)
})

test("BDEF create object validation rejects invalid source combinations before SAP mutation", async () => {
  const missingSource = createBdefHarness()
  await assert.rejects(
    missingSource.service.createObjectProgrammatically({
      objectType: "BDEF/BDO",
      name: "ZI_DEMO",
      description: "Demo behavior",
      packageName: "Z_DEMO",
      connectionId: "DEV100",
      activate: true,
      additionalOptions: {
        transportRequest: { type: "existing", number: "DEVK900123" }
      }
    }),
    (error: unknown) => {
      assert.ok(error instanceof AppError)
      assert.equal(error.code, "SAP_VALIDATION_FAILED")
      assert.equal(error.message, "activate=true requires source")
      assert.deepEqual(error.details, { reason: "SOURCE_REQUIRED_FOR_ACTIVATION" })
      return true
    }
  )
  assert.equal(missingSource.fake.validateNewObjectCalls, 0)
  assert.equal(missingSource.fake.createObjectCalls, 0)
  assert.equal(missingSource.fake.createTransportCalls, 0)
  assert.deepEqual(missingSource.fake.readSourceCalls, [])
  assert.deepEqual(missingSource.fake.replaceSourceCalls, [])

  const unsupportedSource = createBdefHarness()
  await assert.rejects(
    unsupportedSource.service.createObjectProgrammatically({
      objectType: "CLAS/OC",
      name: "ZCL_DEMO",
      description: "Demo class",
      packageName: "Z_DEMO",
      connectionId: "DEV100",
      source: "CLASS zcl_demo DEFINITION PUBLIC FINAL CREATE PUBLIC. ENDCLASS.",
      activate: false,
      additionalOptions: {
        transportRequest: { type: "existing", number: "DEVK900123" }
      }
    }),
    (error: unknown) => {
      assert.ok(error instanceof AppError)
      assert.equal(error.code, "SAP_VALIDATION_FAILED")
      assert.deepEqual(error.details, { reason: "CREATE_SOURCE_UNSUPPORTED" })
      return true
    }
  )
  assert.equal(unsupportedSource.fake.validateNewObjectCalls, 0)
  assert.equal(unsupportedSource.fake.createObjectCalls, 0)
  assert.equal(unsupportedSource.fake.createTransportCalls, 0)
  assert.deepEqual(unsupportedSource.fake.readSourceCalls, [])
  assert.deepEqual(unsupportedSource.fake.replaceSourceCalls, [])
})

test("BDEF create object normalizes thrown validation and create failures", async () => {
  const validationFailure = createBdefHarness()
  validationFailure.fake.validationError = Object.assign(
    new Error("Authorization: Bearer validation-secret"),
    { response: { status: 403 } }
  )
  await assert.rejects(
    validationFailure.service.createObjectProgrammatically({
      objectType: "BDEF/BDO",
      name: "ZI_VALIDATION_FAILURE",
      description: "Validation failure",
      packageName: "Z_DEMO",
      connectionId: "DEV100",
      activate: false,
      additionalOptions: {
        transportRequest: { type: "existing", number: "DEVK900123" }
      }
    }),
    (error: unknown) => {
      assert.ok(error instanceof AppError)
      assert.equal(error.code, "SAP_AUTHORIZATION_DENIED")
      assert.equal(
        error.message,
        "SAP capability repository.create.bdef failed: Authorization: [REDACTED]"
      )
      assert.deepEqual(error.details, {
        capabilityId: "repository.create.bdef",
        endpoint: "bo/behaviordefinitions/validation",
        httpStatus: 403
      })
      return true
    }
  )
  assert.equal(validationFailure.fake.validateNewObjectCalls, 1)
  assert.equal(validationFailure.fake.createTransportCalls, 0)
  assert.equal(validationFailure.fake.createObjectCalls, 0)
  assert.deepEqual(validationFailure.fake.readSourceCalls, [])
  assert.deepEqual(validationFailure.fake.replaceSourceCalls, [])
  const validationCapability = (
    validationFailure.service as unknown as { capabilities: SapCapabilityRegistry }
  ).capabilities.list("DEV100", "").find(item => item.id === "repository.create.bdef")
  assert.equal(validationCapability?.authorization, "denied")
  assert.deepEqual(validationCapability?.evidence, [
    "http:403:bo/behaviordefinitions/validation"
  ])

  const negativeValidation = createBdefHarness()
  negativeValidation.fake.validationResult = {
    success: false,
    SHORT_TEXT: "Behavior definition rejected"
  }
  await assert.rejects(
    negativeValidation.service.createObjectProgrammatically({
      objectType: "BDEF/BDO",
      name: "ZI_REJECTED",
      description: "Rejected behavior",
      packageName: "Z_DEMO",
      connectionId: "DEV100",
      activate: false,
      additionalOptions: {
        transportRequest: { type: "existing", number: "DEVK900123" }
      }
    }),
    (error: unknown) => {
      assert.ok(error instanceof AppError)
      assert.equal(error.code, "SAP_VALIDATION_FAILED")
      assert.equal(error.message, "Behavior definition rejected")
      assert.deepEqual(error.details, {
        validation: {
          success: false,
          SHORT_TEXT: "Behavior definition rejected"
        }
      })
      return true
    }
  )
  assert.equal(negativeValidation.fake.createObjectCalls, 0)
  assert.deepEqual(negativeValidation.fake.readSourceCalls, [])

  const createFailure = createBdefHarness()
  createFailure.fake.createObjectError = Object.assign(
    new Error("missing BDEF endpoint token=create-secret"),
    { status: 404 }
  )
  await assert.rejects(
    createFailure.service.createObjectProgrammatically({
      objectType: "BDEF/BDO",
      name: "ZI_CREATE_FAILURE",
      description: "Create failure",
      packageName: "Z_DEMO",
      connectionId: "DEV100",
      source: "managed implementation in class zbp_i_create_failure unique;",
      activate: true,
      additionalOptions: {
        transportRequest: { type: "existing", number: "DEVK900123" }
      }
    }),
    (error: unknown) => {
      assert.ok(error instanceof AppError)
      assert.equal(error.code, "SAP_CAPABILITY_UNAVAILABLE")
      assert.ok(!error.message.includes("create-secret"))
      assert.deepEqual(error.details, {
        capabilityId: "repository.create.bdef",
        endpoint: "bo/behaviordefinitions",
        httpStatus: 404
      })
      return true
    }
  )
  assert.equal(createFailure.fake.createObjectCalls, 1)
  assert.deepEqual(createFailure.fake.readSourceCalls, [])
  assert.deepEqual(createFailure.fake.replaceSourceCalls, [])
  assert.equal(createFailure.fake.deleteObjectCalls, 0)
  const createCapability = (
    createFailure.service as unknown as { capabilities: SapCapabilityRegistry }
  ).capabilities.list("DEV100", "").find(item => item.id === "repository.create.bdef")
  assert.equal(createCapability?.system, "not_advertised")
  assert.equal(createCapability?.status, "unsupported")
  assert.deepEqual(createCapability?.evidence, [
    "http:404:bo/behaviordefinitions"
  ])
})

test("BDEF create object reports manual cleanup after post-create source failure", async () => {
  const { fake, service } = createBdefHarness()
  const objectUri = "/sap/bc/adt/bo/behaviordefinitions/ZI_DEMO"
  fake.replaceSourceError = new Error("source write failed")

  await assert.rejects(
    service.createObjectProgrammatically({
      objectType: "BDEF/BDO",
      name: "ZI_DEMO",
      description: "Demo behavior",
      packageName: "Z_DEMO",
      connectionId: "DEV100",
      source: "managed implementation in class zbp_i_demo unique;",
      activate: true,
      additionalOptions: {
        transportRequest: { type: "existing", number: "DEVK900123" }
      }
    }),
    (error: unknown) => {
      assert.ok(error instanceof AppError)
      assert.equal(error.code, "SAP_OPERATION_FAILED")
      assert.deepEqual(error.details, {
        capabilityId: "repository.create.bdef",
        endpoint: "write_source",
        stage: "write_source",
        created: true,
        objectUri,
        transport: "DEVK900123",
        manualCleanupRequired: true
      })
      return true
    }
  )
  assert.equal(fake.createObjectCalls, 1)
  assert.deepEqual(fake.objectCreationOperations, [
    "validate",
    "create",
    "read_source",
    "replace_source"
  ])
  assert.equal(fake.deleteObjectCalls, 0)
  assert.equal(fake.deletedObject, false)
})

test("BDEF create object preserves source safety codes with normalized recovery details", async () => {
  const { fake, service } = createBdefHarness()
  const objectUri = "/sap/bc/adt/bo/behaviordefinitions/ZI_SOURCE_CHANGED"
  fake.replaceSourceError = new AppError(
    "SOURCE_CHANGED",
    "Authorization: Bearer source-secret",
    {
      password: "details-secret",
      nested: { authorization: "Bearer nested-secret" },
      capabilityId: "spoofed.capability",
      endpoint: "spoofed_endpoint",
      httpStatus: 200
    }
  )

  await assert.rejects(
    service.createObjectProgrammatically({
      objectType: "BDEF/BDO",
      name: "ZI_SOURCE_CHANGED",
      description: "Changed behavior",
      packageName: "Z_DEMO",
      connectionId: "DEV100",
      source: "managed implementation in class zbp_i_source_changed unique;",
      activate: true,
      additionalOptions: {
        transportRequest: { type: "existing", number: "DEVK900123" }
      }
    }),
    (error: unknown) => {
      assert.ok(error instanceof AppError)
      assert.equal(error.code, "SOURCE_CHANGED")
      assert.equal(
        error.message,
        "SAP capability repository.create.bdef failed: Authorization: [REDACTED]"
      )
      assert.ok(error.details)
      assert.equal("password" in error.details, false)
      assert.equal("nested" in error.details, false)
      assert.equal("httpStatus" in error.details, false)
      assert.deepEqual(error.details, {
        capabilityId: "repository.create.bdef",
        endpoint: "write_source",
        stage: "write_source",
        created: true,
        objectUri,
        transport: "DEVK900123",
        manualCleanupRequired: true
      })
      return true
    }
  )
  assert.equal(fake.createObjectCalls, 1)
  assert.equal(fake.replaceSourceCalls.length, 1)
  assert.equal(fake.deleteObjectCalls, 0)
})

test("BDEF create object observes authorization failures at read and write stages", async () => {
  const readFailure = createBdefHarness()
  readFailure.fake.readSourceError = Object.assign(
    new Error("Authorization: Bearer read-secret"),
    { response: { status: 403 } }
  )
  await assert.rejects(
    readFailure.service.createObjectProgrammatically({
      objectType: "BDEF/BDO",
      name: "ZI_READ_FAILURE",
      description: "Read failure",
      packageName: "Z_DEMO",
      connectionId: "DEV100",
      source: "managed implementation in class zbp_i_read_failure unique;",
      activate: true,
      additionalOptions: {
        transportRequest: { type: "existing", number: "DEVK900123" }
      }
    }),
    (error: unknown) => {
      assert.ok(error instanceof AppError)
      assert.equal(error.code, "SAP_AUTHORIZATION_DENIED")
      assert.equal(
        error.message,
        "SAP capability repository.create.bdef failed: Authorization: [REDACTED]"
      )
      assert.deepEqual(error.details, {
        capabilityId: "repository.create.bdef",
        endpoint: "read_source",
        httpStatus: 403,
        stage: "read_source",
        created: true,
        objectUri: "/sap/bc/adt/bo/behaviordefinitions/ZI_READ_FAILURE",
        transport: "DEVK900123",
        manualCleanupRequired: true
      })
      return true
    }
  )
  assert.equal(readFailure.fake.readSourceCalls.length, 1)
  assert.equal(readFailure.fake.replaceSourceCalls.length, 0)
  assert.equal(readFailure.fake.deleteObjectCalls, 0)
  const readCapability = (
    readFailure.service as unknown as { capabilities: SapCapabilityRegistry }
  ).capabilities.list("DEV100", "").find(item => item.id === "repository.create.bdef")
  assert.equal(readCapability?.status, "supported")
  assert.equal(readCapability?.authorization, "denied")
  assert.deepEqual(readCapability?.evidence, [
    "success:bo/behaviordefinitions",
    "http:403:read_source"
  ])

  const writeFailure = createBdefHarness()
  writeFailure.fake.replaceSourceError = Object.assign(
    new Error("Authorization: Bearer write-secret"),
    { status: 403 }
  )
  await assert.rejects(
    writeFailure.service.createObjectProgrammatically({
      objectType: "BDEF/BDO",
      name: "ZI_WRITE_FAILURE",
      description: "Write failure",
      packageName: "Z_DEMO",
      connectionId: "DEV100",
      source: "managed implementation in class zbp_i_write_failure unique;",
      activate: true,
      additionalOptions: {
        transportRequest: { type: "existing", number: "DEVK900123" }
      }
    }),
    (error: unknown) => {
      assert.ok(error instanceof AppError)
      assert.equal(error.code, "SAP_AUTHORIZATION_DENIED")
      assert.equal(
        error.message,
        "SAP capability repository.create.bdef failed: Authorization: [REDACTED]"
      )
      assert.deepEqual(error.details, {
        capabilityId: "repository.create.bdef",
        endpoint: "write_source",
        httpStatus: 403,
        stage: "write_source",
        created: true,
        objectUri: "/sap/bc/adt/bo/behaviordefinitions/ZI_WRITE_FAILURE",
        transport: "DEVK900123",
        manualCleanupRequired: true
      })
      return true
    }
  )
  assert.equal(writeFailure.fake.readSourceCalls.length, 1)
  assert.equal(writeFailure.fake.replaceSourceCalls.length, 1)
  assert.equal(writeFailure.fake.deleteObjectCalls, 0)
  const writeCapability = (
    writeFailure.service as unknown as { capabilities: SapCapabilityRegistry }
  ).capabilities.list("DEV100", "").find(item => item.id === "repository.create.bdef")
  assert.equal(writeCapability?.status, "supported")
  assert.equal(writeCapability?.authorization, "denied")
  assert.deepEqual(writeCapability?.evidence, [
    "success:bo/behaviordefinitions",
    "http:403:write_source"
  ])
})

test("BDEF create object returns syntax diagnostics and skips activation", async () => {
  const { fake, service } = createBdefHarness()
  const objectUri = "/sap/bc/adt/bo/behaviordefinitions/ZI_SYNTAX_ERROR"

  const created = await service.createObjectProgrammatically({
    objectType: "BDEF/BDO",
    name: "ZI_SYNTAX_ERROR",
    description: "Syntax error behavior",
    packageName: "Z_DEMO",
    connectionId: "DEV100",
    source: "SYNTAX_ERROR",
    activate: true,
    additionalOptions: {
      transportRequest: { type: "existing", number: "DEVK900123" }
    }
  }) as Record<string, any>

  assert.deepEqual(created.diagnostics, [{
    uri: `${objectUri}/source/main`,
    line: 3,
    offset: 4,
    severity: "E",
    text: "Syntax error"
  }])
  assert.equal(created.activation, null)
  assert.equal(created.activationSkipped, true)
  assert.equal(fake.createObjectCalls, 1)
  assert.equal(fake.replaceSourceCalls.length, 1)
  assert.equal(fake.deleteObjectCalls, 0)
})

test("write allowlists, production blocking, transports, and read-only SQL are enforced", async () => {
  const makeService = (profile: SapProfile) => {
    const fake = new FakeSapClient(profile)
    return new AbapToolService({
      async listConnections() { return [] },
      async getClient() { return fake }
    })
  }
  const rejectsCode = async (operation: Promise<unknown>, code: string) => {
    await assert.rejects(operation, error =>
      typeof error === "object" && error !== null && "code" in error && error.code === code
    )
  }
  const objectInput = {
    objectType: "CLAS/OC",
    name: "ZCL_SAFE_TEST",
    description: "Safety policy test",
    packageName: "Z_DEMO",
    connectionId: "DEV100"
  }

  await rejectsCode(
    makeService({
      id: "PRD100", url: "https://sap.example.test", client: "100", language: "EN",
      environment: "production", authType: "basic", username: "DEVELOPER",
      allowedPackages: ["Z_DEMO"]
    }).createObjectProgrammatically({ ...objectInput, connectionId: "PRD100" }),
    "PRODUCTION_WRITE_BLOCKED"
  )
  await rejectsCode(
    makeService({
      id: "DEV100", url: "https://sap.example.test", client: "100", language: "EN",
      environment: "development", authType: "basic", username: "DEVELOPER",
      allowedPackages: []
    }).createObjectProgrammatically(objectInput),
    "TRANSPORT_REQUIRED"
  )
  await rejectsCode(
    makeService({
      id: "DEV100", url: "https://sap.example.test", client: "100", language: "EN",
      environment: "development", authType: "basic", username: "DEVELOPER",
      allowedPackages: ["Z_OTHER"]
    }).createObjectProgrammatically(objectInput),
    "PACKAGE_NOT_ALLOWED"
  )
  const developmentService = makeService({
    id: "DEV100", url: "https://sap.example.test", client: "100", language: "EN",
    environment: "development", authType: "basic", username: "DEVELOPER",
    allowedPackages: ["Z_DEMO"]
  })
  await rejectsCode(
    developmentService.createObjectProgrammatically(objectInput),
    "TRANSPORT_REQUIRED"
  )
  await rejectsCode(
    developmentService.executeDataQuery({
      sql: "DELETE FROM MARA",
      displayMode: "internal",
      connectionId: "DEV100",
      maxRows: 10,
      rowRange: { start: 0, end: 10 }
    }),
    "QUERY_NOT_READ_ONLY"
  )
})

test("mutation plans reject stale SAP state and transport writes reject production", async () => {
  object.packageName = "Z_DEMO"
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
  const fake = new FakeSapClient(profile)
  const service = new AbapToolService({
    async listConnections() { return [] },
    async getClient() { return fake }
  })
  const preview = await service.refactorCode({
    action: "preview_format",
    fileUri: `adt://dev100${object.uri}/source/main`,
    transport: "DEVK900123",
    activate: false
  }) as { planId: string; confirmation: string }
  fake.currentSource = `${source}\n" changed after preview`
  await assert.rejects(
    service.refactorCode({
      action: "execute",
      planId: preview.planId,
      confirmation: preview.confirmation
    }),
    error => typeof error === "object" && error !== null &&
      "code" in error && error.code === "REFACTORING_CHANGED"
  )

  fake.currentSource = source.replace("result = 42", "result = 43")
  const restore = await service.manageVersions({
    action: "preview_restore",
    connectionId: "DEV100",
    objectName: object.name,
    objectType: object.type,
    versionNumber: 2,
    transport: "DEVK900123",
    activate: false,
    startIndex: 0,
    maxResults: 20,
    startLine: 1,
    lineCount: 100
  }) as { planId: string; confirmation: string }
  fake.currentSource = `${fake.currentSource}\n" changed after restore preview`
  await assert.rejects(
    service.manageVersions({
      action: "execute_restore",
      connectionId: "DEV100",
      planId: restore.planId,
      confirmation: restore.confirmation,
      activate: false,
      startIndex: 0,
      maxResults: 20,
      startLine: 1,
      lineCount: 100
    }),
    error => typeof error === "object" && error !== null &&
      "code" in error && error.code === "RESTORE_STATE_CHANGED"
  )

  const productionFake = new FakeSapClient({ ...profile, id: "PRD100", environment: "production" })
  const productionService = new AbapToolService({
    async listConnections() { return [] },
    async getClient() { return productionFake }
  })
  await assert.rejects(
    productionService.manageTransportRequests({
      action: "release_transport",
      connectionId: "PRD100",
      transportNumber: "PRDK900123",
      confirmation: "PRDK900123",
      startIndex: 0,
      maxResults: 20,
      includeObjects: false
    }),
    error => typeof error === "object" && error !== null &&
      "code" in error && error.code === "PRODUCTION_WRITE_BLOCKED"
  )

  const addObjectInput = {
    action: "add_object" as const,
    connectionId: "DEV100",
    transportNumber: "DEVK900123",
    pgmid: "R3TR",
    objectType: "CLAS",
    objectName: object.name,
    confirmation: "DEVK900123:R3TR:CLAS:ZCL_DEMO",
    startIndex: 0,
    maxResults: 20,
    includeObjects: false
  }
  await assert.rejects(
    service.manageTransportRequests({ ...addObjectInput, confirmation: "wrong" }),
    error => typeof error === "object" && error !== null &&
      "code" in error && error.code === "CONFIRMATION_MISMATCH"
  )
  await assert.rejects(
    service.manageTransportRequests({
      ...addObjectInput,
      pgmid: "LIMU",
      objectType: "DYNP",
      objectName: screenProgram.name,
      confirmation: `DEVK900123:LIMU:DYNP:${screenProgram.name}`
    }),
    error => typeof error === "object" && error !== null &&
      "code" in error && error.code === "TRANSPORT_DYNP_KEY_INVALID"
  )
  await assert.rejects(
    productionService.manageTransportRequests({
      ...addObjectInput,
      connectionId: "PRD100",
      transportNumber: "PRDK900123",
      confirmation: "PRDK900123:R3TR:CLAS:ZCL_DEMO"
    }),
    error => typeof error === "object" && error !== null &&
      "code" in error && error.code === "PRODUCTION_WRITE_BLOCKED"
  )
  const disallowedFake = new FakeSapClient({ ...profile, allowedPackages: ["Z_OTHER"] })
  const disallowedService = new AbapToolService({
    async listConnections() { return [] },
    async getClient() { return disallowedFake }
  })
  await assert.rejects(
    disallowedService.manageTransportRequests(addObjectInput),
    error => typeof error === "object" && error !== null &&
      "code" in error && error.code === "PACKAGE_NOT_ALLOWED"
  )
  assert.deepEqual(fake.transportMutations, [])
  assert.deepEqual(productionFake.transportMutations, [])
  assert.deepEqual(disallowedFake.transportMutations, [])

  await assert.rejects(
    service.runSapTransaction({
      connectionId: "DEV100",
      transactionCode: "SE38",
      parameters: { "RS38M-PROGRAMM": "ZSAFE;DYNP_OKCODE=DELETE" },
      mode: "url"
    }),
    error => typeof error === "object" && error !== null &&
      "code" in error && error.code === "INVALID_TRANSACTION_PARAMETER"
  )
})

test("abapGit credentials are selected by repository URL and never cross repositories", async () => {
  assert.throws(
    () => normalizeAbapGitRepositoryUrl("https://user:token@example.test/repo.git"),
    /Do not embed credentials/
  )
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
  const fake = new FakeSapClient(profile)
  const secrets = new MemorySecretStore()
  await secrets.set(abapGitCredentialKey(profile.id), encodeAbapGitCredentials([
    {
      repositoryUrl: "https://example.test/repo.git",
      username: "repo-user",
      password: "repo-token"
    },
    {
      repositoryUrl: "https://other.example.test/repo.git",
      username: "other-user",
      password: "other-token"
    }
  ]))
  const service = new AbapToolService({
    async listConnections() { return [] },
    async getClient() { return fake }
  }, secrets)

  await service.manageAbapGit({
    action: "remote_info",
    connectionId: profile.id,
    repositoryUrl: "https://example.test/repo.git",
    startIndex: 0,
    maxResults: 20
  })
  assert.deepEqual(fake.gitAuthCalls, [{
    url: "https://example.test/repo.git",
    user: "repo-user",
    password: "repo-token"
  }])
})

test("capability execution preserves pre-call status and normalizes observations and errors", async () => {
  const service = new AbapToolService({
    async listConnections() { return [] },
    async getClient() { throw new Error("not used") }
  })
  const harness = service as unknown as {
    capabilities: SapCapabilityRegistry
    executeCapability<T>(
      connectionId: string,
      capabilityId: string,
      endpoint: string,
      operation: () => Promise<T>
    ): Promise<{ result: T; capabilityStatusAtExecution: string }>
  }

  harness.capabilities.observeHttpFailure(
    "UNSUPPORTED100",
    "semantic.documentation",
    404,
    "/documentation"
  )
  let unsupportedCalls = 0
  await assert.rejects(
    harness.executeCapability(
      "UNSUPPORTED100",
      "semantic.documentation",
      "/documentation",
      async () => {
        unsupportedCalls += 1
        return "never"
      }
    ),
    (error: unknown) => {
      assert.ok(error instanceof AppError)
      assert.equal(error.code, "SAP_CAPABILITY_UNAVAILABLE")
      assert.deepEqual(error.details, {
        capabilityId: "semantic.documentation",
        endpoint: "/documentation"
      })
      return true
    }
  )
  assert.equal(unsupportedCalls, 0)

  let unverifiedCalls = 0
  const unverified = await harness.executeCapability(
    "UNVERIFIED100",
    "semantic.completion_element",
    "/completion",
    async () => {
      unverifiedCalls += 1
      return "completion"
    }
  )
  assert.deepEqual(unverified, {
    result: "completion",
    capabilityStatusAtExecution: "unverified"
  })
  assert.equal(unverifiedCalls, 1)
  assert.equal(
    harness.capabilities.status("UNVERIFIED100", "semantic.completion_element"),
    "supported"
  )

  harness.capabilities.observeSuccess(
    "SUPPORTED100",
    "semantic.type_hierarchy",
    "/hierarchy"
  )
  let supportedCalls = 0
  const supported = await harness.executeCapability(
    "SUPPORTED100",
    "semantic.type_hierarchy",
    "/hierarchy",
    async () => {
      supportedCalls += 1
      return ["parent"]
    }
  )
  assert.deepEqual(supported, {
    result: ["parent"],
    capabilityStatusAtExecution: "supported"
  })
  assert.equal(supportedCalls, 1)

  let normalizedCalls = 0
  const normalized = await harness.executeCapability(
    " dev100 ",
    "semantic.components",
    "/components",
    async () => {
      normalizedCalls += 1
      return "components"
    }
  )
  assert.equal(normalized.capabilityStatusAtExecution, "unverified")
  assert.equal(normalizedCalls, 1)
  assert.equal(harness.capabilities.status("DEV100", "semantic.components"), "supported")
  assert.equal(harness.capabilities.status("QAS100", "semantic.components"), "unverified")

  const secret = "super-secret"
  const endpoint = `/sap/bc/adt/oo/classrun?token=${secret}`
  let failureCalls = 0
  const authFailure = Object.assign(new Error(`Authorization: Bearer ${secret}`), {
    response: { status: 403 }
  })
  await assert.rejects(
    harness.executeCapability(
      "AUTH100",
      "execution.class_runner",
      endpoint,
      async () => {
        failureCalls += 1
        throw authFailure
      }
    ),
    (error: unknown) => {
      assert.ok(error instanceof AppError)
      assert.equal(error.code, "SAP_AUTHORIZATION_DENIED")
      assert.deepEqual(error.details, {
        capabilityId: "execution.class_runner",
        endpoint: "/sap/bc/adt/oo/classrun?token=[REDACTED]",
        httpStatus: 403
      })
      assert.equal(error.message.includes(secret), false)
      assert.equal(
        (error.message.match(/SAP capability execution\.class_runner failed:/g) ?? []).length,
        1
      )
      return true
    }
  )
  assert.equal(failureCalls, 1)
  const failureRecord = harness.capabilities
    .list("AUTH100", "", "execution")
    .find(item => item.id === "execution.class_runner")
  assert.equal(failureRecord?.authorization, "denied")
  assert.deepEqual(failureRecord?.evidence, [
    "http:403:/sap/bc/adt/oo/classrun?token=[REDACTED]"
  ])
})

test("definition expands the identifier range under the cursor", async () => {
  const { fake, service } = createBdefHarness()
  const fileUri = `adt://dev100${object.uri}/source/main`
  const inspect = async (sourceText: string, column: number, endColumn?: number) => {
    fake.currentSource = sourceText
    await service.inspectCode({
      action: "definition",
      fileUri,
      connectionId: "DEV100",
      line: 1,
      column,
      ...(endColumn === undefined ? {} : { endColumn }),
      implementation: false,
      startIndex: 0,
      maxResults: 20
    })
    return fake.definitionArgs.at(-1)!
  }

  const classReference = "  result = zcl_target=>ping( )."
  assert.deepEqual(
    (({ startColumn, endColumn }) => ({ startColumn, endColumn }))(
      await inspect(classReference, 15)
    ),
    { startColumn: 11, endColumn: 21 }
  )

  const fieldSymbol = "<field_symbol> = value."
  assert.deepEqual(
    (({ startColumn, endColumn }) => ({ startColumn, endColumn }))(
      await inspect(fieldSymbol, 5)
    ),
    { startColumn: 0, endColumn: 14 }
  )

  const namespaced = "  DATA value TYPE /NS/ZCL_TARGET."
  const namespaceStart = namespaced.indexOf("/NS/ZCL_TARGET")
  assert.deepEqual(
    (({ startColumn, endColumn }) => ({ startColumn, endColumn }))(
      await inspect(namespaced, namespaceStart + 4)
    ),
    { startColumn: namespaceStart, endColumn: namespaceStart + "/NS/ZCL_TARGET".length }
  )

  assert.deepEqual(
    (({ startColumn, endColumn }) => ({ startColumn, endColumn }))(
      await inspect(classReference, 13, 18)
    ),
    { startColumn: 13, endColumn: 18 }
  )
})

test("semantic inspect actions use one SapClient call, paginate, and bound inline text", async () => {
  const harness = createBdefHarness()
  const fileUri = "adt://dev100/sap/bc/adt/oo/classes/zcl_demo/source/main"
  const baseInput = {
    fileUri,
    line: 3,
    column: 8,
    implementation: false,
    startIndex: 0,
    maxResults: 10,
    superTypes: false
  }
  const semanticCallCounts = () => ({
    completion: harness.fake.codeCompletionCalls,
    completionElement: harness.fake.completionElementCalls,
    documentation: harness.fake.documentationCalls,
    typeHierarchy: harness.fake.typeHierarchyCalls,
    components: harness.fake.classComponentsCalls
  })

  const existingAction = createBdefHarness()
  const existingCompletion = await existingAction.service.inspectCode({
    action: "completion",
    fileUri,
    line: 3,
    column: 8,
    implementation: false,
    startIndex: 0,
    maxResults: 10
  }) as any
  assert.equal(existingCompletion.proposals[0].identifier, "WRITE")

  const omittedHierarchy = createBdefHarness()
  await omittedHierarchy.service.inspectCode({
    action: "type_hierarchy",
    fileUri,
    line: 1,
    column: 0,
    implementation: false,
    startIndex: 0,
    maxResults: 10
  })
  assert.deepEqual(
    omittedHierarchy.fake.typeHierarchyArgs.map(call => call.superTypes),
    [false]
  )

  harness.fake.completionElementResult = {
    ...structuredClone(DEVELOPMENT_PARITY_FIXTURES.completionElement),
    components: [
      { "adtcore:type": "CLAS/OM", "adtcore:name": "FIRST", entries: [] },
      { "adtcore:type": "CLAS/OM", "adtcore:name": "SECOND", entries: [] },
      { "adtcore:type": "CLAS/OM", "adtcore:name": "THIRD", entries: [] }
    ]
  }
  const completionElement = await harness.service.inspectCode({
    ...baseInput,
    action: "completion_element",
    startIndex: 1,
    maxResults: 1
  }) as any
  assert.equal(completionElement.format, "structured")
  assert.equal(completionElement.element.name, "WRITE")
  assert.equal(completionElement.element.doc, "Writes output")
  assert.equal(completionElement.element.docTruncated, false)
  assert.equal(completionElement.element.componentTotal, 3)
  assert.equal(completionElement.element.componentStartIndex, 1)
  assert.equal(completionElement.element.componentsReturned, 1)
  assert.equal(completionElement.element.componentsTruncated, true)
  assert.equal(completionElement.element.componentsNextStartIndex, 2)
  assert.equal(completionElement.element.components[0]["adtcore:name"], "SECOND")
  assert.equal(completionElement.capabilityStatusAtExecution, "unverified")
  assert.deepEqual(semanticCallCounts(), {
    completion: 0,
    completionElement: 1,
    documentation: 0,
    typeHierarchy: 0,
    components: 0
  })
  assert.deepEqual(harness.fake.completionElementArgs, [{
    sourceUri: "/sap/bc/adt/oo/classes/zcl_demo/source/main",
    source,
    line: 3,
    column: 8
  }])

  const documentation = await harness.service.inspectCode({
    ...baseInput,
    action: "documentation"
  }) as any
  assert.equal(documentation.format, "html")
  assert.match(documentation.content, /WRITE documentation/)
  assert.equal(documentation.truncated, false)
  assert.equal(documentation.capabilityStatusAtExecution, "unverified")
  assert.deepEqual(harness.fake.documentationArgs, [{
    objectUri: object.uri,
    source,
    line: 3,
    column: 8
  }])
  assert.deepEqual(semanticCallCounts(), {
    completion: 0,
    completionElement: 1,
    documentation: 1,
    typeHierarchy: 0,
    components: 0
  })

  harness.fake.typeHierarchyResult = [
    ...structuredClone(DEVELOPMENT_PARITY_FIXTURES.typeHierarchy),
    { ...structuredClone(DEVELOPMENT_PARITY_FIXTURES.typeHierarchy[0]!), name: "ZCL_SECOND" },
    { ...structuredClone(DEVELOPMENT_PARITY_FIXTURES.typeHierarchy[0]!), name: "ZCL_THIRD" }
  ]
  const hierarchy = await harness.service.inspectCode({
    ...baseInput,
    action: "type_hierarchy",
    line: 1,
    column: 0,
    superTypes: true,
    startIndex: 1,
    maxResults: 1
  }) as any
  assert.equal(hierarchy.total, 3)
  assert.equal(hierarchy.startIndex, 1)
  assert.equal(hierarchy.returned, 1)
  assert.equal(hierarchy.truncated, true)
  assert.equal(hierarchy.nextStartIndex, 2)
  assert.equal(hierarchy.nodes[0].name, "ZCL_SECOND")
  assert.equal(hierarchy.capabilityStatusAtExecution, "unverified")
  assert.deepEqual(harness.fake.typeHierarchyArgs, [{
    sourceUri: "/sap/bc/adt/oo/classes/zcl_demo/source/main",
    source,
    line: 1,
    column: 0,
    superTypes: true
  }])
  assert.deepEqual(semanticCallCounts(), {
    completion: 0,
    completionElement: 1,
    documentation: 1,
    typeHierarchy: 1,
    components: 0
  })

  harness.fake.classComponentsResult = {
    ...structuredClone(DEVELOPMENT_PARITY_FIXTURES.components),
    components: [
      ...structuredClone(DEVELOPMENT_PARITY_FIXTURES.components.components),
      {
        ...structuredClone(DEVELOPMENT_PARITY_FIXTURES.components.components[0]!),
        "adtcore:name": "SECOND",
        constant: true,
        readOnly: true,
        components: [structuredClone(DEVELOPMENT_PARITY_FIXTURES.components.components[0]!)]
      },
      {
        ...structuredClone(DEVELOPMENT_PARITY_FIXTURES.components.components[0]!),
        "adtcore:name": "THIRD"
      }
    ]
  }
  const components = await harness.service.inspectCode({
    ...baseInput,
    action: "components",
    startIndex: 1,
    maxResults: 1
  }) as any
  assert.equal(components.root.name, "ZCL_DEMO")
  assert.equal(components.total, 3)
  assert.equal(components.startIndex, 1)
  assert.equal(components.returned, 1)
  assert.equal(components.truncated, true)
  assert.equal(components.nextStartIndex, 2)
  assert.deepEqual(components.components[0], {
    name: "SECOND",
    type: "CLAS/OM",
    visibility: "public",
    constant: true,
    readOnly: true,
    childCount: 1
  })
  assert.equal(components.capabilityStatusAtExecution, "unverified")
  assert.deepEqual(harness.fake.classComponentsArgs, [object.uri])
  assert.deepEqual(semanticCallCounts(), {
    completion: 0,
    completionElement: 1,
    documentation: 1,
    typeHierarchy: 1,
    components: 1
  })

  const inlineLimit = 96 * 1024
  harness.fake.completionElementResult = {
    ...structuredClone(DEVELOPMENT_PARITY_FIXTURES.completionElement),
    doc: "🙂".repeat(inlineLimit / 4 + 1)
  }
  const boundedStructured = await harness.service.inspectCode({
    ...baseInput,
    action: "completion_element"
  }) as any
  assert.equal(boundedStructured.format, "structured")
  assert.equal(boundedStructured.element.docTruncated, true)
  assert.ok(Buffer.byteLength(boundedStructured.element.doc, "utf8") <= inlineLimit)
  assert.equal(boundedStructured.element.doc.includes("�"), false)
  assert.equal(boundedStructured.element.doc.endsWith("🙂"), true)
  assert.equal(/[\uD800-\uDBFF]$/.test(boundedStructured.element.doc), false)

  harness.fake.completionElementResult = "legacy completion"
  const legacy = await harness.service.inspectCode({
    ...baseInput,
    action: "completion_element"
  }) as any
  assert.equal(legacy.format, "legacy")
  assert.equal(legacy.content, "legacy completion")
  assert.equal(legacy.originalBytes, Buffer.byteLength("legacy completion", "utf8"))
  assert.equal(legacy.returnedBytes, legacy.originalBytes)
  assert.equal(legacy.truncated, false)

  harness.fake.completionElementResult = "🙂".repeat(inlineLimit / 4 + 1)
  const bounded = await harness.service.inspectCode({
    ...baseInput,
    action: "completion_element"
  }) as any
  assert.equal(bounded.format, "legacy")
  assert.equal(bounded.originalBytes, inlineLimit + 4)
  assert.ok(bounded.returnedBytes <= inlineLimit)
  assert.equal(bounded.returnedBytes, Buffer.byteLength(bounded.content, "utf8"))
  assert.equal(bounded.truncated, true)
  assert.equal(bounded.content.includes("�"), false)
  assert.equal(bounded.content.endsWith("🙂"), true)
  assert.equal(/[\uD800-\uDBFF]$/.test(bounded.content), false)

  harness.fake.documentationResult = "Plain documentation"
  const plainDocumentation = await harness.service.inspectCode({
    ...baseInput,
    action: "documentation"
  }) as any
  assert.equal(plainDocumentation.format, "text")

  const invalidComponents = createBdefHarness()
  invalidComponents.fake.objectStructureType = "PROG/P"
  await assert.rejects(
    invalidComponents.service.inspectCode({
      ...baseInput,
      fileUri: "adt://dev100/sap/bc/adt/programs/programs/zrep/source/main",
      action: "components"
    }),
    (error: unknown) => {
      assert.ok(error instanceof AppError)
      assert.equal(error.code, "SAP_VALIDATION_FAILED")
      assert.equal(error.message, "components requires a class or interface")
      assert.deepEqual(error.details, {
        reason: "COMPONENTS_OBJECT_TYPE_INVALID",
        objectType: "PROG/P"
      })
      return true
    }
  )
  assert.equal(invalidComponents.fake.classComponentsCalls, 0)

  const failed = createBdefHarness()
  const secret = "semantic-secret"
  failed.fake.documentationError = Object.assign(
    new Error(`Authorization: Bearer ${secret}`),
    { response: { status: 403 } }
  )
  await assert.rejects(
    failed.service.inspectCode({ ...baseInput, action: "documentation" }),
    (error: unknown) => {
      assert.ok(error instanceof AppError)
      assert.equal(error.code, "SAP_AUTHORIZATION_DENIED")
      assert.equal(error.message.includes(secret), false)
      assert.deepEqual(error.details, {
        capabilityId: "semantic.documentation",
        endpoint: "/sap/bc/adt/docu/abap/langu",
        httpStatus: 403
      })
      return true
    }
  )
  assert.equal(failed.fake.documentationCalls, 1)
  assert.equal(failed.fake.completionElementCalls, 0)
  assert.equal(failed.fake.typeHierarchyCalls, 0)
  assert.equal(failed.fake.classComponentsCalls, 0)
  const failedCapability = (failed.service as unknown as {
    capabilities: SapCapabilityRegistry
  }).capabilities.list("DEV100", "", "semantic").find(
    item => item.id === "semantic.documentation"
  )
  assert.equal(failedCapability?.authorization, "denied")
  assert.equal(failedCapability?.status, "unverified")
  assert.deepEqual(failedCapability?.evidence, [
    "http:403:/sap/bc/adt/docu/abap/langu"
  ])
})

test("MCP semantic inspect actions expose fixtures and default superTypes to false", async t => {
  const harness = createBdefHarness()
  const server = createMcpServer(harness.service)
  const client = new Client({ name: "semantic-test-client", version: "1.0.0" })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  t.after(async () => {
    await client.close()
    await server.close()
  })
  await server.connect(serverTransport)
  await client.connect(clientTransport)
  const callJson = async (args: Record<string, unknown>) => {
    const response = await client.callTool({ name: "inspect_abap_code", arguments: args })
    const text = (
      (response as { content: Array<{ type: "text"; text: string }> }).content[0] as {
        type: "text"
        text: string
      }
    ).text
    return JSON.parse(text)
  }
  const fileUri = "adt://dev100/sap/bc/adt/oo/classes/zcl_demo/source/main"

  const completion = await callJson({
    action: "completion_element",
    fileUri,
    line: 3,
    column: 8
  })
  assert.equal(completion.format, "structured")
  assert.equal(completion.element.name, "WRITE")

  const documentation = await callJson({
    action: "documentation",
    fileUri,
    line: 3,
    column: 8
  })
  assert.equal(documentation.format, "html")
  assert.match(documentation.content, /WRITE documentation/)
  assert.equal(documentation.truncated, false)

  const hierarchy = await callJson({
    action: "type_hierarchy",
    fileUri,
    line: 1,
    column: 0,
    superTypes: true,
    startIndex: 0,
    maxResults: 10
  })
  assert.equal(hierarchy.nodes[0].name, "ZCL_PARENT")

  const components = await callJson({
    action: "components",
    fileUri,
    startIndex: 0,
    maxResults: 10
  })
  assert.equal(components.components[0].name, "RUN")

  await callJson({
    action: "type_hierarchy",
    fileUri,
    line: 1,
    column: 0
  })
  assert.deepEqual(
    harness.fake.typeHierarchyArgs.map(call => call.superTypes),
    [true, false]
  )
})

test("MCP initialize reports the npm package version", async t => {
  const harness = createApplicationHarness()
  const server = createMcpServer(harness.service)
  const client = new Client({ name: "version-test-client", version: "1.0.0" })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  t.after(async () => {
    await client.close()
    await server.close()
  })
  await server.connect(serverTransport)
  await client.connect(clientTransport)

  const packageJson = JSON.parse(await readFile("package.json", "utf8")) as {
    version: string
  }
  assert.deepEqual(client.getServerVersion(), {
    name: "sap-abap-mcp",
    version: packageJson.version,
    title: "SAP ABAP MCP",
    description:
      "Develop, test, analyze, and operate SAP ABAP systems through ADT from AI coding agents.",
    websiteUrl: "https://github.com/Coaspe/sap-abap-mcp",
    icons: [{
      src: "https://raw.githubusercontent.com/Coaspe/sap-abap-mcp/main/assets/directory-icon.png",
      mimeType: "image/png",
      sizes: ["400x400"]
    }]
  })
})

test("API version modes preserve v0 and expose the first v1 system tools", async () => {
  const v1Names = [
    "sap.system.list",
    "sap.system.inspect",
    "sap.system.capabilities",
    "sap.repository.search",
    "sap.source.read"
  ]
  assert.deepEqual((await toolNames()).sort(), [...IMPLEMENTED_TOOL_NAMES].sort())
  assert.deepEqual(
    (await toolNames({ apiVersion: "v0" })).sort(),
    [...IMPLEMENTED_TOOL_NAMES].sort()
  )
  assert.deepEqual(await toolNames({ apiVersion: "v1" }), v1Names)
  assert.deepEqual(
    (await toolNames({ apiVersion: "all" })).sort(),
    [...IMPLEMENTED_TOOL_NAMES, ...v1Names].sort()
  )
  assert.deepEqual(
    await toolNames({
      apiVersion: "v1",
      enabledTools: toolsForToolsets(["core"])
    }),
    v1Names
  )
})

test("MCP run_abap_application exposes strict health, class, and snippet actions", async t => {
  const harness = createApplicationHarness()
  const server = createMcpServer(harness.service)
  const client = new Client({ name: "application-test-client", version: "1.0.0" })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  t.after(async () => {
    await client.close()
    await server.close()
  })
  await server.connect(serverTransport)
  await client.connect(clientTransport)

  const listed = await client.listTools()
  const applicationTool = listed.tools.find(tool => tool.name === "run_abap_application")
  assert.equal(applicationTool?.title, "Run ABAP Application")
  assert.equal(
    applicationTool?.description,
    "Check the audited ABAP FS REPL or preview and execute a confirmed class/snippet plan."
  )
  assert.deepEqual(applicationTool?.annotations, {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true
  })
  assert.deepEqual(applicationTool?.inputSchema.required, ["action", "connectionId"])
  assert.deepEqual(
    (applicationTool?.inputSchema.properties?.action as { enum?: string[] } | undefined)?.enum,
    ["repl_health", "preview_class", "preview_snippet", "execute"]
  )
  assert.deepEqual(
    Object.keys(applicationTool?.inputSchema.properties ?? {}),
    ["action", "connectionId", "className", "code", "planId", "confirmation"]
  )

  const callRaw = (arguments_: Record<string, unknown>) => client.callTool({
    name: "run_abap_application",
    arguments: arguments_
  })
  const callJson = async (arguments_: Record<string, unknown>) => {
    const response = await callRaw(arguments_)
    const text = (
      (response as { content: Array<{ type: "text"; text: string }> }).content[0] as {
        type: "text"
        text: string
      }
    ).text
    return JSON.parse(text)
  }

  const health = await callJson({ action: "repl_health", connectionId: "DEV100" })
  assert.equal(health.health.status, "ok")
  assert.equal(harness.fake.replHealthCalls, 1)
  assert.equal(harness.fake.replExecuteCalls, 0)

  const classPreview = await callJson({
    action: "preview_class",
    connectionId: "DEV100",
    className: "ZCL_RUNNER"
  })
  const classResult = await callJson({
    action: "execute",
    connectionId: "DEV100",
    planId: classPreview.planId,
    confirmation: classPreview.confirmation
  })
  assert.equal(classResult.kind, "class")
  assert.match(classResult.output, /runner output: ZCL_RUNNER/)
  assert.equal(harness.fake.classRunCalls, 1)

  harness.fake.replHealthCalls = 0
  const snippetPreview = await callJson({
    action: "preview_snippet",
    connectionId: "DEV100",
    code: "WRITE 42."
  })
  const snippetResult = await callJson({
    action: "execute",
    connectionId: "DEV100",
    planId: snippetPreview.planId,
    confirmation: snippetPreview.confirmation
  })
  assert.equal(snippetResult.kind, "snippet")
  assert.match(snippetResult.output, /WRITE 42\./)
  assert.equal(harness.fake.replHealthCalls, 1)
  assert.equal(harness.fake.replExecuteCalls, 1)
  assert.equal(harness.fake.classRunCalls, 1)

  const mixedAction = await callRaw({
    action: "preview_class",
    connectionId: "DEV100",
    className: "ZCL_RUNNER",
    code: "WRITE 42."
  }) as { isError?: boolean }
  assert.equal(mixedAction.isError, true)
})

test("MCP exposes and executes the ABAP FS-compatible tool surface", async t => {
  const profile: SapProfile = {
    id: "DEV100",
    url: "https://sap.example.test",
    client: "100",
    language: "EN",
    environment: "development",
    authType: "basic",
    username: "DEVELOPER",
    allowedPackages: ["Z_DEMO", "Z_OTHER"]
  }
  const fake = new FakeSapClient(profile)
  const summary: ConnectionSummary = {
    id: profile.id,
    url: profile.url,
    client: profile.client,
    language: profile.language,
    environment: profile.environment,
    username: "DEVELOPER",
    credentialAvailable: true
  }
  const gitSecrets = new MemorySecretStore()
  await gitSecrets.set(abapGitCredentialKey(profile.id), encodeAbapGitCredentials([{
    repositoryUrl: "https://example.test/repo.git",
    username: "repo-user",
    password: "repo-token"
  }]))
  const service = new AbapToolService({
    async listConnections() {
      return [summary]
    },
    async getClient() {
      return fake
    }
  }, gitSecrets)
  const server = createMcpServer(service)
  const client = new Client({ name: "test-client", version: "1.0.0" })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  t.after(async () => {
    await client.close()
    await server.close()
  })
  await server.connect(serverTransport)
  await client.connect(clientTransport)

  const listed = await client.listTools()
  assert.deepEqual(
    listed.tools.map(tool => tool.name).sort(),
    [...IMPLEMENTED_TOOL_NAMES].sort()
  )
  const createTool = listed.tools.find(tool => tool.name === "create_object_programmatically")
  const createProperties = createTool?.inputSchema.properties as Record<
    string,
    { description?: string }
  > | undefined
  assert.match(createProperties?.source?.description ?? "", /BDEF\/BDO/)
  assert.match(createProperties?.activate?.description ?? "", /BDEF\/BDO/)
  const manifest = JSON.parse(await readFile("mcpb/manifest.json", "utf8")) as {
    tools_generated: boolean
    tools: Array<{ name: string; description: string }>
  }
  assert.equal(manifest.tools_generated, false)
  assert.deepEqual(
    manifest.tools,
    listed.tools.map(tool => ({
      name: tool.name,
      description: tool.description
    })).sort((left, right) => left.name.localeCompare(right.name))
  )
  for (const tool of listed.tools) {
    assert.ok(tool.title?.trim(), `missing MCP directory title: ${tool.name}`)
    assert.equal(
      typeof tool.annotations?.readOnlyHint,
      "boolean",
      `missing readOnlyHint: ${tool.name}`
    )
    assert.equal(
      typeof tool.annotations?.destructiveHint,
      "boolean",
      `missing destructiveHint: ${tool.name}`
    )
  }
  assert.ok(
    Buffer.byteLength(JSON.stringify(listed.tools), "utf8") < 64 * 1024,
    "full MCP tool schemas must stay below the 64 KiB token-budget guardrail"
  )
  assert.deepEqual(
    listed.tools
      .filter(tool => Object.keys(tool.inputSchema.properties ?? {}).length === 0)
      .map(tool => tool.name)
      .sort(),
    ["get_abap_sql_syntax", "get_connected_systems"],
    "only intentional no-argument tools may advertise an empty input schema"
  )
  const capabilityTool = listed.tools.find(tool => tool.name === "get_sap_capabilities")
  assert.ok(capabilityTool)
  assert.equal(
    (capabilityTool.inputSchema.properties?.includeEvidence as { default?: boolean }).default,
    false
  )
  assert.deepEqual(capabilityTool.annotations, {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true
  })
  const activationTool = listed.tools.find(tool => tool.name === "abap_activate")
  assert.equal(activationTool?.title, "Activate ABAP Object(s)")
  assert.equal(
    activationTool?.description,
    "Activate one legacy object or one same-connection batch of 1 through 100 ABAP objects."
  )
  assert.deepEqual(
    Object.keys(activationTool?.inputSchema.properties ?? {}),
    ["url", "urls", "connectionId"]
  )
  assert.equal(
    (activationTool?.inputSchema.properties?.urls as { type?: string } | undefined)?.type,
    "array"
  )
  const filteredServer = createMcpServer(service, {
    enabledTools: new Set(["get_connected_systems"])
  })
  const filteredClient = new Client({ name: "filtered-test-client", version: "1.0.0" })
  const [filteredClientTransport, filteredServerTransport] =
    InMemoryTransport.createLinkedPair()
  await filteredServer.connect(filteredServerTransport)
  await filteredClient.connect(filteredClientTransport)
  assert.deepEqual(
    (await filteredClient.listTools()).tools.map(tool => tool.name),
    ["get_connected_systems"]
  )
  await filteredClient.close()
  await filteredServer.close()

  const callJson = async (name: string, args: Record<string, unknown>) => {
    const response = await client.callTool({ name, arguments: args })
    const text = (
      (response as { content: Array<{ type: "text"; text: string }> }).content[0] as {
        type: "text"
        text: string
      }
    ).text
    return JSON.parse(text)
  }

  const systems = await callJson("get_connected_systems", {})
  assert.equal(systems.systems[0].id, "DEV100")
  const sapInfo = await callJson("get_sap_system_info", {
    connectionId: "DEV100",
    includeComponents: false
  })
  assert.equal(sapInfo.sapRelease, "758")
  const serviceCapabilities = (
    service as unknown as { capabilities: SapCapabilityRegistry }
  ).capabilities
  serviceCapabilities.observeSuccess(
    "DEV100",
    "repository.activate.batch",
    "batch-activation-observed"
  )
  const mutationsBeforeCapabilities = {
    batchActivationCalls: fake.batchActivationCalls,
    classRunCalls: fake.classRunCalls,
    createdObject: fake.createdObject,
    currentSource: fake.currentSource,
    debugActive: fake.debugActive,
    deletedObject: fake.deletedObject,
    replExecuteCalls: fake.replExecuteCalls,
    transportMutations: [...fake.transportMutations]
  }
  const capabilities = await callJson("get_sap_capabilities", {
    connectionId: "DEV100",
    category: "repository",
    includeEvidence: true
  })
  assert.equal(capabilities.connectionId, "DEV100")
  const repositoryCapabilities = capabilities.capabilities as Array<{
    id: string
    category: string
    evidence: string[]
    status: string
    system: string
  }>
  assert.equal(
    repositoryCapabilities.find(item => item.id === "repository.create.bdef")?.status,
    "unverified"
  )
  assert.ok(repositoryCapabilities.every(item => item.category === "repository"))
  const activationCapability = repositoryCapabilities.find(
    item => item.id === "repository.activate.batch"
  )
  assert.equal(activationCapability?.system, "advertised")
  assert.equal(activationCapability?.status, "supported")
  assert.ok(
    activationCapability?.evidence.includes("discovery:/sap/bc/adt/activation")
  )
  const activationEvidence = [...(activationCapability?.evidence ?? [])]
  const compactCapabilities = await callJson("get_sap_capabilities", {
    connectionId: " dev100 ",
    category: "repository",
    includeEvidence: false
  })
  assert.equal(compactCapabilities.connectionId, "DEV100")
  assert.equal("evidence" in compactCapabilities.capabilities[0], false)
  const capabilitiesAfterCompact = await callJson("get_sap_capabilities", {
    connectionId: "DEV100",
    category: "repository",
    includeEvidence: true
  })
  const activationAfterCompact = capabilitiesAfterCompact.capabilities.find(
    (item: { id: string }) => item.id === "repository.activate.batch"
  )
  assert.deepEqual(activationAfterCompact.evidence, activationEvidence)
  assert.deepEqual(
    {
      batchActivationCalls: fake.batchActivationCalls,
      classRunCalls: fake.classRunCalls,
      createdObject: fake.createdObject,
      currentSource: fake.currentSource,
      debugActive: fake.debugActive,
      deletedObject: fake.deletedObject,
      replExecuteCalls: fake.replExecuteCalls,
      transportMutations: fake.transportMutations
    },
    mutationsBeforeCapabilities
  )

  const search = await client.callTool({
    name: "search_abap_objects",
    arguments: {
      pattern: "ZCL_DEMO",
      types: ["CLAS"],
      connectionId: "DEV100"
    }
  })
  const searchText = (
    (search as { content: Array<{ type: "text"; text: string }> }).content[0] as {
      type: "text"
      text: string
    }
  ).text
  assert.equal(JSON.parse(searchText).objects[0].name, "ZCL_DEMO")
  assert.equal(searchText.includes("\n"), false)

  const method = await client.callTool({
    name: "get_abap_object_lines",
    arguments: {
      objectName: "ZCL_DEMO",
      objectType: "CLAS",
      methodName: "RUN",
      connectionId: "DEV100"
    }
  })
  const methodText = (
    (method as { content: Array<{ type: "text"; text: string }> }).content[0] as {
      type: "text"
      text: string
    }
  ).text
  assert.match(JSON.parse(methodText).code, /result = 42/)

  const sourceSearch = await callJson("search_abap_object_lines", {
    objectName: "ZCL_DEMO",
    searchTerm: "result = 42",
    connectionId: "DEV100"
  })
  assert.equal(sourceSearch.matchCount, 1)
  assert.deepEqual(sourceSearch.results[0].matchLineNumbers, [3])
  assert.equal(sourceSearch.results[0].contextBlocks[0].startLine, 1)

  fake.currentSource = Array.from(
    { length: 1000 },
    (_, index) => `result = 42. " ${index} ${"X".repeat(180)}`
  ).join("\n")
  const pagedSearch = await callJson("search_abap_object_lines", {
    objectName: "ZCL_DEMO",
    searchTerm: "result = 42",
    connectionId: "DEV100",
    contextLines: 0,
    startIndex: 10,
    maxResults: 10
  })
  assert.equal(pagedSearch.matchCount, 1000)
  assert.equal(pagedSearch.returnedMatches, 10)
  assert.equal(pagedSearch.nextStartIndex, 20)
  const boundedEnvelope = await callJson("get_abap_object_lines", {
    objectName: "ZCL_DEMO",
    objectType: "CLAS",
    connectionId: "DEV100",
    lineCount: 5000
  }) as DeferredResultEnvelope
  assert.equal(boundedEnvelope.deferred, true)
  let boundedSourceText = boundedEnvelope.previewText
  let boundedSourceOffset: number | null = boundedEnvelope.nextOffset
  while (boundedSourceOffset !== null) {
    const chunk = await callJson(DEFERRED_RESULT_TOOL_NAME, {
      resultId: boundedEnvelope.resultId,
      offset: boundedSourceOffset
    }) as { content: string; nextOffset: number | null }
    boundedSourceText += chunk.content
    boundedSourceOffset = chunk.nextOffset
  }
  const boundedSource = JSON.parse(boundedSourceText)
  assert.equal(boundedSource.truncated, true)
  assert.ok(Buffer.byteLength(JSON.stringify(boundedSource), "utf8") < 100 * 1024)
  fake.currentSource = source

  const info = await callJson("get_abap_object_info", {
    objectName: "ZCL_DEMO",
    objectType: "CLAS",
    connectionId: "DEV100",
    includeStructure: true
  })
  assert.equal(info.totalLines, 5)
  assert.equal(info.structure.metaData["adtcore:name"], "ZCL_DEMO")
  const compactInfo = await callJson("get_abap_object_info", {
    objectName: "ZCL_DEMO",
    objectType: "CLAS",
    connectionId: "DEV100"
  })
  assert.equal(compactInfo.structure, undefined)
  assert.equal(compactInfo.structureSummary.responsible, "DEVELOPER")
  assert.equal(compactInfo.structureSummary.version, "active")

  const batch = await callJson("get_batch_lines", {
    requests: [{ objectName: "ZCL_DEMO", startLine: 1, lineCount: 2 }],
    connectionId: "DEV100"
  })
  assert.equal(batch.results[0].ok, true)
  assert.match(batch.results[0].result.code, /METHOD run/)
  const oversizedBatch = await callJson("get_batch_lines", {
    requests: Array.from(
      { length: 6 },
      () => ({ objectName: "ZCL_DEMO", startLine: 0, lineCount: 1000 })
    ),
    connectionId: "DEV100"
  })
  assert.equal(oversizedBatch.code, "BATCH_LINE_LIMIT")

  const byUri = await callJson("get_object_by_uri", {
    uri: object.uri,
    startLine: 2,
    lineCount: 1,
    connectionId: "DEV100"
  })
  assert.equal(byUri.startLine, 2)
  assert.match(byUri.code, /result = 42/)

  const mermaidValid = await callJson("validate_mermaid_syntax", {
    code: "flowchart TD\n    A[Client] --> B[SAP ADT]"
  })
  assert.equal(mermaidValid.isValid, true)
  assert.equal(mermaidValid.diagramType, "flowchart")
  const mermaidInvalid = await callJson("validate_mermaid_syntax", {
    code: "flowchart TD\n    A -->"
  })
  assert.equal(mermaidInvalid.isValid, false)
  const mermaidStrictError = await callJson("validate_mermaid_syntax", {
    code: "flowchart TD\n    A -->",
    suppressErrors: false
  })
  assert.equal(mermaidStrictError.code, "MERMAID_SYNTAX_INVALID")
  const mermaidType = await callJson("detect_mermaid_diagram_type", {
    code: "sequenceDiagram\n    Client->>SAP: Read"
  })
  assert.equal(mermaidType.detectedType, "sequence")
  const mermaidDocs = await callJson("get_mermaid_documentation", {
    diagramType: "flowchart",
    includeExamples: true
  })
  assert.match(mermaidDocs.documentation.flowchart.syntax, /flowchart TD/)
  const mermaid = await callJson("create_mermaid_diagram", {
    code: "flowchart TD\n    A[Client] --> B[SAP ADT]",
    theme: "neutral"
  })
  t.after(() => rm(dirname(mermaid.htmlPath), { recursive: true, force: true }))
  assert.equal(mermaid.mode, "headless_interactive_html")
  assert.match(await readFile(mermaid.htmlPath, "utf8"), /mermaid\.render/)

  const screenshotDirectory = await mkdtemp(join(tmpdir(), "sap-abap-mcp-screenshot-"))
  t.after(() => rm(screenshotDirectory, { recursive: true, force: true }))
  const screenshotPath = join(screenshotDirectory, "result.png")
  await writeFile(
    screenshotPath,
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64"
    )
  )
  const testDocument = await callJson("create_test_documentation", {
    reportTitle: "Integration Test Report",
    testDate: "13-07-2026",
    scenarios: [{
      scenarioId: 1,
      scenarioName: "Read class",
      scenarioDescription: "Confirms that the class source is readable.",
      screenshots: [{ filePath: screenshotPath, description: "Successful source read" }]
    }]
  })
  t.after(() => rm(dirname(testDocument.outputPath), { recursive: true, force: true }))
  assert.equal(testDocument.embeddedScreenshots, 1)
  assert.ok((await stat(testDocument.outputPath)).size > 1000)
  assert.equal((await readFile(testDocument.outputPath)).subarray(0, 2).toString(), "PK")

  const compatibilityDocs = await callJson("abap_fs_documentation", {
    action: "search_documentation",
    searchQuery: "production writes",
    lineCount: 2
  })
  assert.ok(compatibilityDocs.matchCount >= 1)

  const usages = await callJson("find_where_used", {
    objectName: "ZCL_DEMO",
    objectType: "CLAS",
    connectionId: "DEV100",
    includeSnippets: true,
    filter: { excludeSystemObjects: true }
  })
  assert.equal(usages.count, 1)
  assert.deepEqual(usages.references[0], {
    name: "ZREP_CALLER",
    type: "PROG/P",
    uri: "/sap/bc/adt/programs/programs/zrep_caller",
    usageInformation: "method call",
    packageName: "Z_DEMO"
  })
  assert.equal(usages.snippets[0].referenceIndex, 0)
  assert.equal("objectIdentifier" in usages.snippets[0], false)
  assert.equal(usages.snippets[0].snippets[0].uri.start.line, 7)

  const objectUrl = await callJson("get_abap_object_url", {
    objectName: "ZCL_DEMO",
    objectType: "CLAS/OC",
    connectionId: "DEV100"
  })
  assert.equal(objectUrl.transaction, "SE24")
  assert.match(objectUrl.url, /\/sap\/bc\/gui\/sap\/its\/webgui/)

  const workspace = await callJson("get_abap_object_workspace_uri", {
    objectName: "ZCL_DEMO",
    objectType: "CLAS/OC",
    connectionId: "DEV100"
  })
  assert.equal(workspace.workspaceUri, `adt://dev100${object.uri}/source/main`)

  const opened = await callJson("open_object", {
    objectName: "ZCL_DEMO",
    objectType: "CLAS",
    connectionId: "DEV100"
  })
  assert.equal(opened.mode, "headless")
  assert.equal(opened.object.name, "ZCL_DEMO")

  const diagnostics = await callJson("get_abap_diagnostics", {
    fileUri: `adt://dev100${object.uri}/source/main`
  })
  assert.equal(diagnostics.errorCount, 0)

  const replaced = await callJson("replace_string_in_abap_object", {
    fileUri: `adt://dev100${object.uri}/source/main`,
    oldString: "result = 42",
    newString: "result = 43",
    transport: "DEVK900123",
    activate: true
  })
  assert.equal(replaced.changed, true)
  assert.equal(replaced.activation.success, true)
  assert.match(fake.currentSource, /result = 43/)

  const activated = await callJson("abap_activate", {
    url: `adt://dev100${object.uri}/source/main`
  })
  assert.equal(activated.success, true)
  assert.equal(fake.batchActivationCalls, 0)
  const batchActivated = await callJson("abap_activate", {
    urls: [
      "adt://dev100/sap/bc/adt/oo/classes/zcl_first/source/main",
      "adt://dev100/sap/bc/adt/oo/classes/zcl_second/source/main"
    ]
  })
  assert.equal(batchActivated.status, "complete")
  assert.deepEqual(
    batchActivated.objectResults.map((item: { outcome: string }) => item.outcome),
    ["activated", "activated"]
  )
  assert.equal(fake.batchActivationCalls, 1)
  const ambiguousActivation = await client.callTool({
    name: "abap_activate",
    arguments: {
      url: `adt://dev100${object.uri}/source/main`,
      urls: [`adt://dev100${object.uri}/source/main`]
    }
  })
  assert.equal(ambiguousActivation.isError, true)
  assert.match(
    ((ambiguousActivation as { content: Array<{ type: "text"; text: string }> })
      .content[0] as { type: "text"; text: string }).text,
    /Invalid arguments/
  )
  const emptyActivation = await client.callTool({
    name: "abap_activate",
    arguments: { urls: [] }
  })
  assert.equal(emptyActivation.isError, true)
  assert.match(
    ((emptyActivation as { content: Array<{ type: "text"; text: string }> })
      .content[0] as { type: "text"; text: string }).text,
    /Invalid arguments/
  )
  assert.equal(fake.batchActivationCalls, 1)

  const created = await callJson("create_object_programmatically", {
    objectType: "CLAS/OC",
    name: "ZCL_CREATED",
    description: "Created by integration test",
    packageName: "Z_DEMO",
    connectionId: "DEV100",
    additionalOptions: {
      transportRequest: { type: "existing", number: "DEVK900123" }
    }
  })
  assert.equal(created.success, true)
  assert.equal(created.object.name, "ZCL_CREATED")
  assert.equal((fake.createdObject as { transport: string }).transport, "DEVK900123")

  const sourceBeforeBdefCreate = fake.currentSource
  const bdefCreated = await callJson("create_object_programmatically", {
    objectType: "BDEF/BDO",
    name: "ZI_MCP_DEMO",
    description: "MCP behavior definition",
    packageName: "Z_DEMO",
    connectionId: "DEV100",
    source: "managed implementation in class zbp_i_mcp_demo unique;",
    activate: true,
    additionalOptions: {
      transportRequest: { type: "existing", number: "DEVK900123" }
    }
  })
  assert.equal(bdefCreated.success, true)
  assert.equal(bdefCreated.object.type, "BDEF/BDO")
  assert.equal(bdefCreated.activation.success, true)
  assert.deepEqual(fake.replaceSourceCalls.at(-1), {
    objectName: "ZI_MCP_DEMO",
    objectUri: "/sap/bc/adt/bo/behaviordefinitions/ZI_MCP_DEMO",
    sourceUri: "/sap/bc/adt/bo/behaviordefinitions/ZI_MCP_DEMO/source/main",
    expectedSource: sourceBeforeBdefCreate,
    nextSource: "managed implementation in class zbp_i_mcp_demo unique;",
    transport: "DEVK900123",
    activate: true
  })
  fake.currentSource = sourceBeforeBdefCreate

  const query = await callJson("execute_data_query", {
    sql: "SELECT MATNR FROM MARA",
    displayMode: "internal",
    connectionId: "DEV100",
    rowRange: { start: 0, end: 1 },
    sortColumns: [{ column: "MATNR", direction: "asc" }]
  })
  assert.equal(query.returnedRows, 1)
  assert.equal(query.values[0].MATNR, "MAT-001")
  const pagedQuery = await callJson("execute_data_query", {
    sql: "SELECT ROW_ID FROM Z_TOKEN_BUDGET",
    displayMode: "ui",
    connectionId: "DEV100",
    maxRows: 250
  })
  assert.equal(pagedQuery.returnedRows, 100)
  assert.equal(pagedQuery.nextRowStart, 100)
  assert.equal(pagedQuery.truncated, true)
  const secondQueryPage = await callJson("execute_data_query", {
    webviewId: pagedQuery.webviewId,
    displayMode: "internal",
    connectionId: "DEV100",
    rowRange: { start: 100, end: 200 }
  })
  assert.equal(secondQueryPage.values[0].ROW_ID, 101)
  const cachedQuery = await callJson("execute_data_query", {
    webviewId: query.webviewId,
    displayMode: "internal",
    connectionId: "DEV100",
    rowRange: { start: 0, end: 10 },
    resetSorting: true,
    resetFilters: true,
    filters: [{ column: "MATNR", value: "MAT-001" }]
  })
  assert.equal(cachedQuery.webviewId, query.webviewId)
  assert.equal(cachedQuery.returnedRows, 1)
  const queryExportDirectory = await mkdtemp(join(tmpdir(), "sap-abap-mcp-query-export-"))
  t.after(() => rm(queryExportDirectory, { recursive: true, force: true }))
  const csvExport = await callJson("execute_data_query", {
    sql: "SELECT MATNR FROM MARA",
    displayMode: "download_to_file",
    connectionId: "DEV100",
    filePath: join(queryExportDirectory, "materials"),
    fileType: "csv"
  })
  assert.match(await readFile(csvExport.outputPath, "utf8"), /MAT-001/)
  const xlsxExport = await callJson("execute_data_query", {
    sql: "SELECT MATNR FROM MARA",
    displayMode: "download_to_file",
    connectionId: "DEV100",
    filePath: join(queryExportDirectory, "materials"),
    fileType: "xlsx"
  })
  assert.equal((await readFile(xlsxExport.outputPath)).subarray(0, 2).toString(), "PK")

  const sqlSyntax = await callJson("get_abap_sql_syntax", {})
  assert.match(sqlSyntax.rules[0], /SELECT/)

  const atc = await callJson("run_atc_analysis", {
    objectName: "ZCL_DEMO",
    objectType: "CLAS/OC",
    connectionId: "DEV100"
  })
  assert.equal(atc.summary.warnings, 1)
  const decorations = await callJson("get_atc_decorations", {
    fileUri: `adt://dev100${object.uri}/source/main`
  })
  assert.equal(decorations.count, 1)

  const textRead = await callJson("manage_text_elements", {
    objectName: "ZCL_DEMO",
    objectType: "CLASS",
    action: "read",
    connectionId: "DEV100"
  })
  assert.equal(textRead.textElements[0].id, "001")
  const textUpdate = await callJson("manage_text_elements", {
    objectName: "ZCL_DEMO",
    objectType: "CLASS",
    action: "update",
    connectionId: "DEV100",
    transport: "DEVK900123",
    textElements: [{ id: "001", text: "New text", maxLength: 20 }]
  })
  assert.equal(textUpdate.activation.success, true)

  const unit = await callJson("run_unit_tests", {
    objectName: "ZCL_DEMO",
    connectionId: "DEV100"
  })
  assert.equal(unit.allPassed, true)
  assert.equal(unit.classes.length, 0)

  const testInclude = await callJson("create_test_include", {
    className: "ZCL_DEMO",
    connectionId: "DEV100",
    transport: "DEVK900123"
  })
  assert.equal(testInclude.created, true)

  const transport = await callJson("manage_transport_requests", {
    action: "get_transport_objects",
    connectionId: "DEV100",
    transportNumber: "DEVK900123"
  })
  assert.equal(transport.objects[0]["tm:name"], "ZCL_DEMO")

  const transportAssessment = await callJson("manage_transport_requests", {
    action: "assess_transport",
    connectionId: "DEV100",
    transportNumber: "DEVK900123",
    checks: ["atc", "unit_tests", "target_compare"],
    targetConnectionId: "QAS100",
    reportFormats: ["json", "sarif", "junit"],
    maxObjects: 10
  })
  assert.equal(transportAssessment.gate.status, "passed")
  assert.equal(transportAssessment.summary.atcWarnings, 1)
  assert.equal(transportAssessment.summary.unitTests, 1)
  assert.equal(transportAssessment.objects[0].targetComparison.status, "identical")
  assert.deepEqual(
    transportAssessment.reports.map((report: any) => report.format),
    ["json", "sarif", "junit"]
  )
  t.after(() => rm(dirname(transportAssessment.reports[0].outputPath), {
    recursive: true,
    force: true
  }))
  assert.equal(
    JSON.parse(await readFile(transportAssessment.reports[0].outputPath, "utf8")).gate.status,
    "passed"
  )
  assert.equal(
    JSON.parse(await readFile(transportAssessment.reports[1].outputPath, "utf8")).version,
    "2.1.0"
  )
  assert.match(
    await readFile(transportAssessment.reports[2].outputPath, "utf8"),
    /<testsuite/
  )

  const versions = await callJson("get_version_history", {
    objectName: "ZCL_DEMO",
    objectType: "CLAS/OC",
    connectionId: "DEV100"
  })
  assert.equal(versions.totalVersions, 2)
  const comparison = await callJson("get_version_history", {
    objectName: "ZCL_DEMO",
    objectType: "CLAS/OC",
    connectionId: "DEV100",
    action: "compare_versions",
    version1: 1,
    version2: 2
  })
  assert.match(comparison.added.join("\n"), /result = 43/)

  const downloadDirectory = await mkdtemp(join(tmpdir(), "sap-abap-mcp-download-"))
  t.after(() => rm(downloadDirectory, { recursive: true, force: true }))
  const download = await callJson("abap_download", {
    source: "ZCL_DEMO",
    target: downloadDirectory,
    connectionId: "DEV100"
  })
  assert.equal(download.files, 1)

  const debugStarted = await callJson("abap_debug_session", {
    connectionId: "DEV100",
    action: "start"
  })
  assert.equal(debugStarted.active, true)
  const breakpoint = await callJson("abap_debug_breakpoint", {
    connectionId: "DEV100",
    filePath: `adt://dev100${object.uri}/source/main`,
    lineNumbers: [3]
  })
  assert.equal(breakpoint.results[0].uri.range.start.line, 3)
  const stack = await callJson("abap_debug_stack", {
    connectionId: "DEV100"
  })
  assert.equal(stack.frames[0].frameId, 1_000_000_000_000)
  const variable = await callJson("abap_debug_variable", {
    connectionId: "DEV100",
    frameId: 1_000_000_000_000,
    variableName: "LV_RESULT"
  })
  assert.equal(variable.variables[0].VALUE, "43")
  const stepped = await callJson("abap_debug_step", {
    connectionId: "DEV100",
    stepType: "stepOver"
  })
  assert.equal(stepped.stack.stack[0].line, 3)
  const debugStatus = await callJson("abap_debug_status", { connectionId: "DEV100" })
  assert.equal(debugStatus.state, "paused")

  const dumps = await callJson("analyze_abap_dumps", {
    action: "list_dumps",
    connectionId: "DEV100"
  })
  assert.equal(dumps.dumps[0].id, "DUMP-1")
  const dump = await callJson("analyze_abap_dumps", {
    action: "analyze_dump",
    connectionId: "DEV100",
    dumpId: "DUMP-1"
  })
  assert.match(dump.dump.plainText, /MESSAGE_TYPE_X/)

  const traces = await callJson("analyze_abap_traces", {
    action: "list_runs",
    connectionId: "DEV100"
  })
  assert.equal(traces.total, 1)
  const statements = await callJson("analyze_abap_traces", {
    action: "get_statements",
    connectionId: "DEV100",
    traceId: "/sap/bc/adt/runtime/traces/run-1"
  })
  assert.equal(statements.statements[0].description, "SELECT")

  const heartbeatTask = await callJson("manage_heartbeat", {
    action: "add_task",
    description: "Watch materials",
    connectionId: "DEV100",
    sampleQuery: "SELECT MATNR FROM MARA",
    alertThreshold: 1,
    maxChecks: 2
  })
  assert.equal(heartbeatTask.task.enabled, true)
  const heartbeat = await callJson("manage_heartbeat", {
    action: "trigger",
    reason: "integration test"
  })
  assert.equal(heartbeat.results[0].status, "threshold_exceeded")
  const heartbeatHistory = await callJson("manage_heartbeat", {
    action: "history",
    count: 1
  })
  assert.equal(heartbeatHistory.entries.length, 1)
  const reminder = await callJson("manage_heartbeat", {
    action: "add_task",
    description: "Review transport",
    reminderOnly: true,
    startAt: "2026-07-13T00:00:00.000Z"
  })
  assert.equal(reminder.task.removeWhenDone, true)
  await callJson("manage_heartbeat", { action: "trigger", reason: "reminder test" })
  const tasksAfterReminder = await callJson("manage_heartbeat", { action: "list_tasks" })
  assert.equal(tasksAfterReminder.tasks.some((task: any) => task.id === reminder.task.id), false)

  const discovery = await callJson("adt_discovery_export", { connectionId: "DEV100" })
  assert.equal(discovery.summary.services, 1)
  assert.equal(discovery.discovery, undefined)

  const completion = await callJson("inspect_abap_code", {
    action: "completion",
    fileUri: `adt://dev100${object.uri}/source/main`,
    line: 3,
    column: 4
  })
  assert.equal(completion.proposals[0].identifier, "WRITE")

  const transportRelease = await callJson("manage_transport_requests", {
    action: "release_transport",
    connectionId: "DEV100",
    transportNumber: "DEVK900123",
    confirmation: "DEVK900123"
  })
  assert.equal(transportRelease.released, true)
  const createdTransport = await callJson("manage_transport_requests", {
    action: "create_transport",
    connectionId: "DEV100",
    packageName: "Z_DEMO",
    description: "Integration transport"
  })
  assert.equal(createdTransport.transportNumber, "DEVK900001")
  const transportUsers = await callJson("manage_transport_requests", {
    action: "list_system_users",
    connectionId: "DEV100"
  })
  assert.equal(transportUsers.users[0].id, "DEVELOPER")
  const transportReference = await callJson("manage_transport_requests", {
    action: "resolve_object",
    connectionId: "DEV100",
    pgmid: "R3TR",
    objectType: "CLAS",
    objectName: "ZCL_DEMO",
    transportNumber: "DEVK900123"
  })
  assert.equal(transportReference.transportReference, object.uri)
  const objectAdded = await callJson("manage_transport_requests", {
    action: "add_object",
    connectionId: "DEV100",
    transportNumber: "DEVK900123",
    pgmid: "R3TR",
    objectType: "CLAS",
    objectName: "ZCL_DEMO",
    confirmation: "DEVK900123:R3TR:CLAS:ZCL_DEMO"
  })
  assert.equal(objectAdded.added, true)
  assert.deepEqual(objectAdded.object, {
    pgmid: "R3TR",
    type: "CLAS",
    name: "ZCL_DEMO",
    uri: object.uri
  })
  assert.ok(fake.transportMutations.includes(`object:DEVK900123:${object.uri}`))
  const dynproAdded = await callJson("manage_transport_requests", {
    action: "add_object",
    connectionId: "DEV100",
    transportNumber: "DEVK900123",
    pgmid: "LIMU",
    objectType: "DYNP",
    objectName: "ZDEMO_SCREEN 0100",
    confirmation: "DEVK900123:LIMU:DYNP:ZDEMO_SCREEN 0100"
  })
  assert.equal(dynproAdded.added, true)
  assert.equal(dynproAdded.object.uri, null)
  assert.equal(dynproAdded.parentObject.name, screenProgram.name)
  const textPoolAdded = await callJson("manage_transport_requests", {
    action: "add_object",
    connectionId: "DEV100",
    transportNumber: "DEVK900123",
    pgmid: "LIMU",
    objectType: "REPT",
    objectName: "ZDEMO_SCREEN",
    confirmation: "DEVK900123:LIMU:REPT:ZDEMO_SCREEN"
  })
  assert.equal(textPoolAdded.added, true)
  assert.equal(textPoolAdded.parentObject.name, screenProgram.name)
  assert.ok(fake.transportMutations.includes(
    "object-key:DEVK900123:LIMU:DYNP:ZDEMO_SCREEN 0100"
  ))
  assert.ok(fake.transportMutations.includes(
    "object-key:DEVK900123:LIMU:REPT:ZDEMO_SCREEN"
  ))
  const ownerChanged = await callJson("manage_transport_requests", {
    action: "set_owner",
    connectionId: "DEV100",
    transportNumber: "DEVK900123",
    targetUser: "OTHER_USER",
    confirmation: "DEVK900123:OTHER_USER"
  })
  assert.equal(ownerChanged.targetUser, "OTHER_USER")
  const userAdded = await callJson("manage_transport_requests", {
    action: "add_user",
    connectionId: "DEV100",
    transportNumber: "DEVK900123",
    targetUser: "OTHER_USER",
    confirmation: "DEVK900123:OTHER_USER"
  })
  assert.equal(userAdded.result["tm:useraction"], "ADD")

  const gitCreated = await callJson("manage_abapgit", {
    action: "create_repository",
    connectionId: "DEV100",
    repositoryUrl: "https://public.example.test/repo.git",
    packageName: "Z_DEMO",
    branch: "main",
    transport: "DEVK900123",
    confirmation: "Z_DEMO:https://public.example.test/repo.git"
  })
  assert.equal(gitCreated.created, true)
  const repositories = await callJson("manage_abapgit", {
    action: "list_repositories",
    connectionId: "DEV100"
  })
  assert.equal(repositories.repositories[0].id, "REPO-1")
  const staging = await callJson("manage_abapgit", {
    action: "stage_repository",
    connectionId: "DEV100",
    repositoryId: "REPO-1"
  })
  const pushed = await callJson("manage_abapgit", {
    action: "push_repository",
    connectionId: "DEV100",
    repositoryId: "REPO-1",
    stageId: staging.stageId,
    objectKeys: ["R3TR CLAS ZCL_DEMO"],
    comment: "Integration test",
    confirmation: "REPO-1"
  })
  assert.equal(pushed.pushed, true)
  const pulled = await callJson("manage_abapgit", {
    action: "pull_repository",
    connectionId: "DEV100",
    repositoryId: "REPO-1",
    transport: "DEVK900123",
    confirmation: "REPO-1"
  })
  assert.equal(pulled.pulled, true)
  const checked = await callJson("manage_abapgit", {
    action: "check_repository",
    connectionId: "DEV100",
    repositoryId: "REPO-1"
  })
  assert.equal(checked.checked, true)
  const switched = await callJson("manage_abapgit", {
    action: "switch_branch",
    connectionId: "DEV100",
    repositoryId: "REPO-1",
    branch: "feature/integration",
    createBranch: true,
    confirmation: "REPO-1"
  })
  assert.equal(switched.switched, true)
  const unlinked = await callJson("manage_abapgit", {
    action: "unlink_repository",
    connectionId: "DEV100",
    repositoryId: "REPO-1",
    confirmation: "REPO-1"
  })
  assert.equal(unlinked.unlinked, true)

  fake.getRapGeneratorSchema = async () => "X".repeat(30_000)
  const rapSchema = await callJson("manage_rap_generator", {
    action: "get_schema",
    connectionId: "DEV100",
    generatorId: "uiservice",
    referenceObjectName: "ZCL_DEMO",
    referenceObjectType: "CLAS/OC",
    packageName: "Z_DEMO",
    contentLength: 1000
  })
  assert.equal(rapSchema.returnedCharacters, 1000)
  assert.equal(rapSchema.truncated, true)
  assert.equal(rapSchema.nextContentOffset, 1000)
  const rapDefaults = await callJson("manage_rap_generator", {
    action: "get_defaults",
    connectionId: "DEV100",
    generatorId: "uiservice",
    referenceObjectName: "ZCL_DEMO",
    referenceObjectType: "CLAS/OC",
    packageName: "Z_DEMO"
  })
  assert.equal(rapDefaults.content.businessService.serviceBinding.name, "ZUI_DEMO_O4")
  const rapPreview = await callJson("manage_rap_generator", {
    action: "preview",
    connectionId: "DEV100",
    generatorId: "uiservice",
    referenceObjectName: "ZCL_DEMO",
    referenceObjectType: "CLAS/OC",
    packageName: "Z_DEMO",
    content: rapDefaults.content
  })
  assert.equal(rapPreview.objectCount, 1)
  const rapGenerated = await callJson("manage_rap_generator", {
    action: "generate",
    connectionId: "DEV100",
    generatorId: "uiservice",
    referenceObjectName: "ZCL_DEMO",
    referenceObjectType: "CLAS/OC",
    packageName: "Z_DEMO",
    transport: "DEVK900123",
    confirmation: "uiservice:ZUI_DEMO_O4",
    content: rapDefaults.content
  })
  assert.equal(rapGenerated.generated, true)
  const published = await callJson("manage_rap_generator", {
    action: "publish",
    connectionId: "DEV100",
    serviceBindingName: "ZUI_DEMO_O4",
    confirmation: "ZUI_DEMO_O4"
  })
  assert.equal(published.published, true)
  fake.serviceBindingProtocol = "V2"
  const unpublished = await callJson("manage_rap_generator", {
    action: "unpublish",
    connectionId: "DEV100",
    serviceBindingName: "ZUI_DEMO_O4",
    serviceName: "ZUI_DEMO",
    serviceVersion: "1",
    confirmation: "ZUI_DEMO_O4:ZUI_DEMO:1"
  })
  assert.equal(unpublished.published, false)
  fake.serviceBindingProtocol = "V4"

  const inactive = await callJson("manage_abap_versions", {
    action: "get_inactive_source",
    connectionId: "DEV100",
    objectName: "ZCL_FIRST",
    objectType: "CLAS/OC",
    lineCount: 2
  })
  assert.equal(inactive.object.name, "ZCL_FIRST")
  const restorePreview = await callJson("manage_abap_versions", {
    action: "preview_restore",
    connectionId: "DEV100",
    objectName: "ZCL_DEMO",
    objectType: "CLAS/OC",
    versionNumber: 2,
    transport: "DEVK900123"
  })
  const restored = await callJson("manage_abap_versions", {
    action: "execute_restore",
    connectionId: "DEV100",
    planId: restorePreview.planId,
    confirmation: restorePreview.confirmation
  })
  assert.equal(restored.restored, true)
  assert.match(fake.currentSource, /result = 41/)

  const formatPreview = await callJson("refactor_abap_code", {
    action: "preview_format",
    fileUri: `adt://dev100${object.uri}/source/main`,
    transport: "DEVK900123"
  })
  const formatted = await callJson("refactor_abap_code", {
    action: "execute",
    planId: formatPreview.planId,
    confirmation: formatPreview.confirmation
  })
  assert.equal(formatted.executed, true)
  assert.match(fake.currentSource, /result = 41\. /)

  const quickFixPreview = await callJson("refactor_abap_code", {
    action: "preview_quick_fix",
    fileUri: `adt://dev100${object.uri}/source/main`,
    line: 3,
    column: 13,
    proposalIndex: 0,
    transport: "DEVK900123"
  })
  const quickFixed = await callJson("refactor_abap_code", {
    action: "execute",
    planId: quickFixPreview.planId,
    confirmation: quickFixPreview.confirmation
  })
  assert.equal(quickFixed.executed, true)
  assert.match(fake.currentSource, /result = 43/)

  const extractPreview = await callJson("refactor_abap_code", {
    action: "preview_extract_method",
    fileUri: `adt://dev100${object.uri}/source/main`,
    line: 3,
    column: 4,
    endLine: 3,
    endColumn: 16,
    methodName: "CALCULATE_RESULT",
    transport: "DEVK900123"
  })
  const extracted = await callJson("refactor_abap_code", {
    action: "execute",
    planId: extractPreview.planId,
    confirmation: extractPreview.confirmation
  })
  assert.equal(extracted.executed, true)

  const renamePreview = await callJson("refactor_abap_code", {
    action: "preview_rename",
    fileUri: `adt://dev100${object.uri}/source/main`,
    line: 3,
    column: 4,
    newName: "renamed_result",
    transport: "DEVK900123"
  })
  const renamed = await callJson("refactor_abap_code", {
    action: "execute",
    planId: renamePreview.planId,
    confirmation: renamePreview.confirmation
  })
  assert.equal(renamed.executed, true)
  assert.match(fake.currentSource, /renamed_result = 43/)

  const packagePreview = await callJson("refactor_abap_code", {
    action: "preview_change_package",
    fileUri: `adt://dev100${object.uri}/source/main`,
    newPackage: "Z_OTHER",
    transport: "DEVK900123"
  })
  const packageChanged = await callJson("refactor_abap_code", {
    action: "execute",
    planId: packagePreview.planId,
    confirmation: packagePreview.confirmation
  })
  assert.equal(packageChanged.executed, true)
  assert.equal(object.packageName, "Z_OTHER")

  const systemComparison = await callJson("compare_abap_systems", {
    objectName: "ZCL_DEMO",
    objectType: "CLAS/OC",
    sourceConnectionId: "DEV100",
    targetConnectionId: "QAS200"
  })
  assert.equal(systemComparison.changed, false)
  assert.equal("object" in systemComparison.source, false)
  assert.equal("object" in systemComparison.target, false)
  const graph = await callJson("get_abap_dependency_graph", {
    objectName: "ZCL_DEMO",
    objectType: "CLAS/OC",
    connectionId: "DEV100"
  })
  assert.equal(graph.nodeCount, 2)
  assert.deepEqual(graph.edges[0], {
    source: "ZREP_CALLER::PROG/P",
    target: "ZCL_DEMO::CLAS/OC",
    usageType: "method call"
  })
  for (const node of graph.nodes) {
    assert.equal("uri" in node, false)
    assert.equal("parentUri" in node, false)
    assert.equal("objectIdentifier" in node, false)
    assert.equal("canExpand" in node, false)
    assert.equal("responsible" in node, false)
    assert.equal("usageInformation" in node, false)
  }
  const transaction = await callJson("run_sap_transaction", {
    connectionId: "DEV100",
    transactionCode: "SE38",
    parameters: { "RS38M-PROGRAMM": "ZREP_DEMO" }
  })
  assert.equal(transaction.launched, false)
  assert.match(transaction.url, /webgui/)

  const deletePreview = await callJson("refactor_abap_code", {
    action: "preview_delete",
    fileUri: `adt://dev100${object.uri}/source/main`,
    transport: "DEVK900123"
  })
  const deleted = await callJson("refactor_abap_code", {
    action: "execute",
    planId: deletePreview.planId,
    confirmation: deletePreview.confirmation
  })
  assert.equal(deleted.executed, true)
  assert.equal(fake.deletedObject, true)

  const debugStopped = await callJson("abap_debug_session", {
    connectionId: "DEV100",
    action: "stop"
  })
  assert.equal(debugStopped.active, false)
})

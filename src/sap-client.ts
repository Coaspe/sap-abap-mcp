import { createHash, randomUUID } from "node:crypto"
import {
  ADTClient,
  isDebuggee,
  isDebuggerBreakpoint,
  isDebugListenerError,
  parseServiceBinding,
  session_types,
  type AbapObjectStructure,
  type ActivationResult,
  type AtcCustomizing,
  type AtcRunResult,
  type AtcWorkList,
  type DebugBreakpoint,
  type DebugBreakpointError,
  type DebugChildVariablesInfo,
  type Debuggee,
  type DebuggingMode,
  type DebugStackInfo,
  type DebugStep,
  type DebugVariable,
  type DefinitionLocation,
  type Delta,
  type DumpsFeed,
  type ExtractMethodProposal,
  type FixProposal,
  type GenericRefactoring,
  type GitExternalInfo,
  type GitRepo,
  type GitStaging,
  type InactiveObjectRecord,
  type MainInclude,
  type NewBindingOptions,
  type NewObjectOptions,
  type NewPackageOptions,
  type NodeParents,
  type NodeStructure,
  type ObjectVersion,
  type QueryResult,
  type Range,
  type RapGeneratorContent,
  type RapGeneratorId,
  type RapGeneratorPreviewObject,
  type RapGeneratorValidationResult,
  type RenameRefactoring,
  type RenameRefactoringProposal,
  type Revision,
  type SearchResult,
  type ServiceBinding,
  type BindingServiceResult,
  type SyntaxCheckResult,
  type TextElement,
  type TextElementCategory,
  type TextElementsResult,
  type TraceHitList,
  type TraceRequestList,
  type TraceResults,
  type TraceStatementResponse,
  type TransportAddUserResponse,
  type TransportOwnerResponse,
  type TransportReleaseReport,
  type TransportRequest,
  type TransportsOfUser,
  type UnitTestClass,
  type UsageReference,
  type UsageReferenceSnippet,
  type ValidateOptions,
  type ValidationResult
} from "abap-adt-api"
import type { ChangePackageRefactoring } from "abap-adt-api/build/api/refactor.js"
import { AppError } from "./errors.js"
import type { SapProfile } from "./profile-store.js"

export interface SapObjectReference {
  name: string
  type: string
  uri: string
  description?: string
  packageName?: string
}

export interface SapObjectSource {
  source: string
  sourceUri: string
  object: SapObjectReference
}

export interface SapSourceByUri {
  source: string
  sourceUri: string
}

export interface SapObjectFingerprint {
  fingerprint: string
  name: string
  type: string
  version: string
  changedAt: number
  sourceUri?: string
}

export interface SapServiceBindingDetails {
  binding: ServiceBinding
  details?: BindingServiceResult
}

export interface SapSourceMutationResult {
  diagnostics: SyntaxCheckResult[]
  activation?: ActivationResult
  activationSkipped: boolean
}

export type SapNewObjectOptions = NewObjectOptions | NewPackageOptions | NewBindingOptions

export interface SapDebugStatus {
  active: boolean
  state: "stopped" | "listening" | "paused" | "stepping" | "error"
  mode?: DebuggingMode
  debugUser?: string
  terminalId?: string
  ideId?: string
  debuggee?: Debuggee
  breakpointCount: number
  lastError?: string
}

interface DebugRuntime {
  generation: number
  mode: DebuggingMode
  debugUser: string
  terminalId: string
  ideId: string
  state: SapDebugStatus["state"]
  executionClient?: ADTClient
  debuggee?: Debuggee
  breakpoints: Map<string, DebugBreakpoint[]>
  lastError?: string
}

export type SapObjectEnhancements = Awaited<ReturnType<ADTClient["objectEnhancements"]>>

export interface SapSoftwareComponent {
  component: string
  release: string
  extRelease: string
  componentType: string
}

export interface SapSystemInfo {
  profileId: string
  url: string
  client: string
  language: string
  environment: SapProfile["environment"]
  username: string
  sapRelease: string
  systemType: "S/4HANA" | "ECC" | "Unknown"
  logicalSystem: string
  clientName: string
  timezone: {
    name: string
    description: string
    utcOffset: string
  } | null
  softwareComponents: SapSoftwareComponent[]
  discoveryCollections: number
  warnings: string[]
  queryTimestamp: string
}

export interface SapClient {
  readonly profile: SapProfile
  login(): Promise<void>
  logout(): Promise<void>
  searchObjects(query: string, objectType?: string, maxResults?: number): Promise<SapObjectReference[]>
  readObject(object: SapObjectReference): Promise<SapObjectSource>
  readSourceByUri(uri: string, version?: ObjectVersion): Promise<SapSourceByUri>
  getObjectStructure(uri: string, version?: ObjectVersion): Promise<AbapObjectStructure>
  getObjectFingerprint(uri: string): Promise<SapObjectFingerprint>
  getObjectEnhancements(uri: string, includeSource?: boolean): Promise<SapObjectEnhancements>
  findUsageReferences(uri: string, line?: number, column?: number): Promise<UsageReference[]>
  getUsageReferenceSnippets(references: UsageReference[]): Promise<UsageReferenceSnippet[]>
  getMainPrograms(includeUri: string): Promise<MainInclude[]>
  checkSyntax(
    objectUri: string,
    sourceUri: string,
    source: string,
    mainProgram?: string
  ): Promise<SyntaxCheckResult[]>
  replaceSource(
    objectName: string,
    objectUri: string,
    sourceUri: string,
    expectedSource: string,
    source: string,
    transport?: string,
    activate?: boolean,
    mainProgram?: string
  ): Promise<SapSourceMutationResult>
  activateObject(
    objectName: string,
    objectUri: string,
    mainProgram?: string
  ): Promise<ActivationResult>
  validateNewObject(options: ValidateOptions): Promise<ValidationResult>
  createObject(options: SapNewObjectOptions): Promise<void>
  createTransport(
    objectUri: string,
    description: string,
    packageName: string,
    transportLayer?: string
  ): Promise<string>
  runQuery(sql: string, maxRows: number): Promise<QueryResult>
  runUnitTests(objectUri: string): Promise<UnitTestClass[]>
  createTestInclude(className: string, classUri: string, transport?: string): Promise<void>
  getAtcCustomizing(): Promise<AtcCustomizing>
  checkAtcVariant(variant: string): Promise<string>
  runAtc(variant: string, objectUri: string, maxResults?: number): Promise<AtcRunResult>
  getAtcWorklist(run: AtcRunResult): Promise<AtcWorkList>
  getAtcDocumentation(docUri: string): Promise<string>
  getTextElements(
    objectType: string,
    objectName: string,
    category?: TextElementCategory
  ): Promise<TextElementsResult>
  updateTextElements(
    objectType: string,
    objectName: string,
    category: TextElementCategory,
    elements: TextElement[],
    transport?: string
  ): Promise<ActivationResult>
  getUserTransports(user: string): Promise<TransportsOfUser>
  getTransportDetails(transportNumber: string): Promise<TransportRequest>
  releaseTransport(
    transportNumber: string,
    ignoreLocks?: boolean,
    ignoreAtc?: boolean
  ): Promise<TransportReleaseReport[]>
  deleteTransport(transportNumber: string): Promise<void>
  setTransportOwner(transportNumber: string, user: string): Promise<TransportOwnerResponse>
  addTransportUser(transportNumber: string, user: string): Promise<TransportAddUserResponse>
  listSystemUsers(): Promise<Array<{ id: string; title: string }>>
  resolveTransportObject(
    pgmid: string,
    objectType: string,
    objectName: string,
    transportNumber?: string
  ): Promise<string>
  getRevisions(objectUri: string): Promise<Revision[]>
  getInactiveObjects(): Promise<InactiveObjectRecord[]>
  getCodeCompletions(
    sourceUri: string,
    source: string,
    line: number,
    column: number
  ): Promise<import("abap-adt-api").CompletionProposal[]>
  findDefinition(
    sourceUri: string,
    source: string,
    line: number,
    startColumn: number,
    endColumn: number,
    implementation?: boolean,
    mainProgram?: string
  ): Promise<DefinitionLocation>
  getQuickFixes(
    sourceUri: string,
    source: string,
    line: number,
    column: number
  ): Promise<FixProposal[]>
  getQuickFixEdits(proposal: FixProposal, source: string): Promise<Delta[]>
  formatSource(source: string): Promise<string>
  evaluateRename(
    sourceUri: string,
    line: number,
    startColumn: number,
    endColumn: number
  ): Promise<RenameRefactoringProposal>
  previewRename(
    proposal: RenameRefactoringProposal,
    transport?: string
  ): Promise<RenameRefactoring>
  executeRename(refactoring: RenameRefactoring): Promise<RenameRefactoring>
  previewPackageChange(
    refactoring: ChangePackageRefactoring,
    transport?: string
  ): Promise<ChangePackageRefactoring>
  executePackageChange(
    refactoring: ChangePackageRefactoring
  ): Promise<ChangePackageRefactoring>
  evaluateExtractMethod(sourceUri: string, range: Range): Promise<ExtractMethodProposal>
  previewExtractMethod(proposal: ExtractMethodProposal): Promise<GenericRefactoring>
  executeExtractMethod(refactoring: GenericRefactoring): Promise<GenericRefactoring>
  deleteObject(objectUri: string, expectedFingerprint: string, transport?: string): Promise<void>
  listGitRepositories(): Promise<GitRepo[]>
  getGitRemoteInfo(url: string, user?: string, password?: string): Promise<GitExternalInfo>
  createGitRepository(
    packageName: string,
    url: string,
    branch?: string,
    transport?: string,
    user?: string,
    password?: string
  ): Promise<void[]>
  pullGitRepository(
    repositoryId: string,
    branch?: string,
    transport?: string,
    user?: string,
    password?: string
  ): Promise<void[]>
  unlinkGitRepository(repositoryId: string): Promise<void>
  stageGitRepository(repository: GitRepo, user?: string, password?: string): Promise<GitStaging>
  pushGitRepository(
    repository: GitRepo,
    staging: GitStaging,
    user?: string,
    password?: string
  ): Promise<void>
  checkGitRepository(repository: GitRepo, user?: string, password?: string): Promise<void>
  switchGitBranch(
    repository: GitRepo,
    branch: string,
    create?: boolean,
    user?: string,
    password?: string
  ): Promise<void>
  isRapGeneratorAvailable(generatorId?: RapGeneratorId): Promise<boolean>
  validateRapGeneratorInitial(
    generatorId: RapGeneratorId,
    referenceObjectUri: string,
    packageName: string
  ): Promise<RapGeneratorValidationResult>
  getRapGeneratorSchema(
    generatorId: RapGeneratorId,
    referenceObjectUri: string,
    packageName: string
  ): Promise<string>
  getRapGeneratorContent(
    generatorId: RapGeneratorId,
    referenceObjectUri: string,
    packageName: string
  ): Promise<RapGeneratorContent>
  validateRapGeneratorContent(
    generatorId: RapGeneratorId,
    referenceObjectUri: string,
    content: RapGeneratorContent
  ): Promise<RapGeneratorValidationResult>
  previewRapGenerator(
    generatorId: RapGeneratorId,
    referenceObjectUri: string,
    content: RapGeneratorContent
  ): Promise<RapGeneratorPreviewObject[]>
  generateRapObjects(
    generatorId: RapGeneratorId,
    referenceObjectUri: string,
    transport: string,
    content: RapGeneratorContent
  ): Promise<RapGeneratorPreviewObject[]>
  publishRapService(serviceBindingName: string): Promise<RapGeneratorValidationResult>
  unpublishServiceBinding(name: string, version: string): Promise<{
    severity: string
    shortText: string
    longText: string
  }>
  getServiceBindingDetails(name: string): Promise<SapServiceBindingDetails>
  getNodeContents(parentType: NodeParents, parentName: string): Promise<NodeStructure>
  startDebugSession(debugUser?: string, terminalMode?: boolean): Promise<SapDebugStatus>
  stopDebugSession(): Promise<SapDebugStatus>
  getDebugStatus(): SapDebugStatus
  setDebugBreakpoints(
    sourceUri: string,
    lineNumbers: number[],
    condition?: string,
    remove?: boolean
  ): Promise<Array<DebugBreakpoint | DebugBreakpointError>>
  debugStep(stepType: string, targetLine?: number): Promise<{
    result: DebugStep
    stack: DebugStackInfo
  }>
  getDebugStack(): Promise<DebugStackInfo>
  getDebugVariables(frameId: number, variableName?: string, expression?: string): Promise<{
    variables: DebugVariable[]
    children?: DebugChildVariablesInfo
  }>
  getDumps(): Promise<DumpsFeed>
  getTraceRuns(): Promise<TraceResults>
  getTraceConfigurations(): Promise<TraceRequestList>
  getTraceHitList(id: string): Promise<TraceHitList>
  getTraceStatements(id: string): Promise<TraceStatementResponse>
  getAdtDiscovery(): Promise<{
    discovery: Awaited<ReturnType<ADTClient["adtDiscovery"]>>
    core: Awaited<ReturnType<ADTClient["adtCoreDiscovery"]>>
  }>
  ping(): Promise<{ collections: number; timestamp: string }>
  getSystemInfo(includeComponents?: boolean): Promise<SapSystemInfo>
}

export type SapClientFactory = (profile: SapProfile, password: string) => SapClient

function mapSearchResult(result: SearchResult): SapObjectReference {
  return {
    name: result["adtcore:name"],
    type: result["adtcore:type"],
    uri: result["adtcore:uri"],
    ...(result["adtcore:description"]
      ? { description: result["adtcore:description"] }
      : {}),
    ...(result["adtcore:packageName"] ? { packageName: result["adtcore:packageName"] } : {})
  }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`
  }
  return JSON.stringify(value)
}

function detectSystemType(components: SapSoftwareComponent[]): SapSystemInfo["systemType"] {
  const names = new Set(components.map(item => item.component.toUpperCase()))
  if (names.has("S4CORE") || names.has("S4COREOP")) return "S/4HANA"
  if (names.has("SAP_APPL") || names.has("SAP_BASIS")) return "ECC"
  return "Unknown"
}

function parseUtcOffset(rawOffset: string): string {
  if (!/^[PM]\d{4}$/.test(rawOffset)) return rawOffset
  const sign = rawOffset.startsWith("P") ? "+" : "-"
  const hours = Number.parseInt(rawOffset.slice(1, 3), 10)
  const minutes = Number.parseInt(rawOffset.slice(3, 5), 10)
  return `UTC${sign}${hours}${minutes ? `:${String(minutes).padStart(2, "0")}` : ""}`
}

export class AdtSapClient implements SapClient {
  private readonly client: ADTClient
  private mutationQueue: Promise<void> = Promise.resolve()
  private debugRuntime: DebugRuntime | undefined
  private debugGeneration = 0

  constructor(
    readonly profile: SapProfile,
    private readonly password: string
  ) {
    if (!profile.username) {
      throw new AppError("USERNAME_REQUIRED", `SAP profile ${profile.id} has no username`)
    }
    this.client = new ADTClient(
      profile.url,
      profile.username,
      password,
      profile.client,
      profile.language
    )
  }

  async login(): Promise<void> {
    await this.client.login()
  }

  async logout(): Promise<void> {
    await this.stopDebugSession().catch(() => undefined)
    await this.client.logout()
  }

  async searchObjects(
    query: string,
    objectType?: string,
    maxResults = 100
  ): Promise<SapObjectReference[]> {
    return (await this.client.searchObject(query, objectType, maxResults)).map(mapSearchResult)
  }

  async readObject(object: SapObjectReference): Promise<SapObjectSource> {
    const result = await this.readSourceByUri(object.uri)
    return { ...result, object }
  }

  async readSourceByUri(uri: string, version?: ObjectVersion): Promise<SapSourceByUri> {
    const candidates: string[] = []

    try {
      const structure = await this.client.objectStructure(uri, version)
      candidates.push(ADTClient.mainInclude(structure))
    } catch {
      // Older backends can reject object structure for some object types.
    }

    if (ADTClient.isMainInclude(uri)) candidates.push(uri)
    else candidates.push(`${uri.replace(/\/+$/, "")}/source/main`, uri)

    let lastError: unknown
    for (const sourceUri of [...new Set(candidates)]) {
      try {
        const source = await this.client.getObjectSource(
          sourceUri,
          version ? { version } : undefined
        )
        return { source, sourceUri }
      } catch (error) {
        lastError = error
      }
    }

    throw new AppError("SOURCE_READ_FAILED", `Could not read source for ${uri}`, {
      objectUri: uri,
      cause: lastError instanceof Error ? lastError.message : String(lastError)
    })
  }

  async getObjectStructure(uri: string, version?: ObjectVersion): Promise<AbapObjectStructure> {
    return this.client.objectStructure(uri, version)
  }

  async getObjectFingerprint(uri: string): Promise<SapObjectFingerprint> {
    const structure = await this.client.objectStructure(uri)
    let source = ""
    let sourceUri: string | undefined
    try {
      const result = await this.readSourceByUri(uri)
      source = result.source
      sourceUri = result.sourceUri
    } catch {
      // Some repository objects have structured metadata but no text source.
    }
    const fingerprint = createHash("sha256")
      .update(stableJson({ metaData: structure.metaData, links: structure.links ?? [], source }))
      .digest("hex")
    return {
      fingerprint,
      name: structure.metaData["adtcore:name"],
      type: structure.metaData["adtcore:type"],
      version: structure.metaData["adtcore:version"],
      changedAt: structure.metaData["adtcore:changedAt"],
      ...(sourceUri ? { sourceUri } : {})
    }
  }

  async getObjectEnhancements(
    uri: string,
    includeSource = false
  ): Promise<SapObjectEnhancements> {
    return this.client.objectEnhancements(uri, undefined, includeSource)
  }

  async findUsageReferences(
    uri: string,
    line?: number,
    column?: number
  ): Promise<UsageReference[]> {
    return this.client.usageReferences(uri, line, column)
  }

  async getUsageReferenceSnippets(
    references: UsageReference[]
  ): Promise<UsageReferenceSnippet[]> {
    return this.client.usageReferenceSnippets(references)
  }

  async getMainPrograms(includeUri: string): Promise<MainInclude[]> {
    return this.client.mainPrograms(includeUri)
  }

  async checkSyntax(
    objectUri: string,
    sourceUri: string,
    source: string,
    mainProgram?: string
  ): Promise<SyntaxCheckResult[]> {
    return this.client.statelessClone.syntaxCheck(
      objectUri,
      sourceUri,
      source,
      mainProgram
    )
  }

  async replaceSource(
    objectName: string,
    objectUri: string,
    sourceUri: string,
    expectedSource: string,
    source: string,
    transport?: string,
    activate = false,
    mainProgram?: string
  ): Promise<SapSourceMutationResult> {
    return this.serializeMutation(async () => {
      const previousSessionType = this.client.stateful
      this.client.stateful = session_types.stateful
      let lockHandle: string | undefined
      try {
        const lock = await this.client.lock(objectUri)
        lockHandle = lock.LOCK_HANDLE
        const lockedSource = await this.client.getObjectSource(sourceUri)
        if (lockedSource !== expectedSource) {
          throw new AppError(
            "SOURCE_CHANGED",
            `ABAP source changed after it was read; refusing to overwrite ${sourceUri}`
          )
        }
        await this.client.setObjectSource(sourceUri, source, lockHandle, transport)
        const diagnostics = await this.checkSyntax(objectUri, sourceUri, source, mainProgram)
        const hasSyntaxErrors = diagnostics.some(item =>
          /^(E|ERROR)$/i.test(item.severity.trim())
        )
        const activation = activate && !hasSyntaxErrors
          ? await this.client.activate(objectName, objectUri, mainProgram, true)
          : undefined
        return {
          diagnostics,
          ...(activation ? { activation } : {}),
          activationSkipped: activate && hasSyntaxErrors
        }
      } finally {
        try {
          if (lockHandle) await this.client.unLock(objectUri, lockHandle)
        } finally {
          this.client.stateful = previousSessionType
        }
      }
    })
  }

  async activateObject(
    objectName: string,
    objectUri: string,
    mainProgram?: string
  ): Promise<ActivationResult> {
    return this.serializeMutation(() =>
      this.client.activate(objectName, objectUri, mainProgram, true)
    )
  }

  async validateNewObject(options: ValidateOptions): Promise<ValidationResult> {
    return this.client.validateNewObject(options)
  }

  async createObject(options: SapNewObjectOptions): Promise<void> {
    await this.serializeMutation(() => this.client.createObject(options))
  }

  async createTransport(
    objectUri: string,
    description: string,
    packageName: string,
    transportLayer?: string
  ): Promise<string> {
    return this.serializeMutation(() =>
      this.client.createTransport(objectUri, description, packageName, transportLayer)
    )
  }

  async runQuery(sql: string, maxRows: number): Promise<QueryResult> {
    return this.client.runQuery(sql, maxRows, true)
  }

  async runUnitTests(objectUri: string): Promise<UnitTestClass[]> {
    return this.client.unitTestRun(objectUri)
  }

  async createTestInclude(
    className: string,
    classUri: string,
    transport?: string
  ): Promise<void> {
    await this.serializeMutation(async () => {
      const previousSessionType = this.client.stateful
      this.client.stateful = session_types.stateful
      let lockHandle: string | undefined
      try {
        const lock = await this.client.lock(classUri)
        lockHandle = lock.LOCK_HANDLE
        await this.client.createTestInclude(className, lockHandle, transport)
      } finally {
        try {
          if (lockHandle) await this.client.unLock(classUri, lockHandle)
        } finally {
          this.client.stateful = previousSessionType
        }
      }
    })
  }

  async getAtcCustomizing(): Promise<AtcCustomizing> {
    return this.client.atcCustomizing()
  }

  async checkAtcVariant(variant: string): Promise<string> {
    return this.client.atcCheckVariant(variant)
  }

  async runAtc(
    variant: string,
    objectUri: string,
    maxResults?: number
  ): Promise<AtcRunResult> {
    return this.client.createAtcRun(variant, objectUri, maxResults)
  }

  async getAtcWorklist(run: AtcRunResult): Promise<AtcWorkList> {
    return this.client.atcWorklists(
      run.id,
      run.timestamp,
      "99999999999999999999999999999999"
    )
  }

  async getAtcDocumentation(docUri: string): Promise<string> {
    return (await this.client.atcDocumentation(docUri)).body
  }

  async getTextElements(
    objectType: string,
    objectName: string,
    category: TextElementCategory = "symbols"
  ): Promise<TextElementsResult> {
    return this.client.getTextElements(
      ADTClient.textElementsUrl(objectType, objectName),
      category
    )
  }

  async updateTextElements(
    objectType: string,
    objectName: string,
    category: TextElementCategory,
    elements: TextElement[],
    transport?: string
  ): Promise<ActivationResult> {
    return this.serializeMutation(async () => {
      const url = ADTClient.textElementsUrl(objectType, objectName)
      const previousSessionType = this.client.stateful
      this.client.stateful = session_types.stateful
      let lockHandle: string | undefined
      try {
        const lock = await this.client.lock(url, "MODIFY")
        lockHandle = lock.LOCK_HANDLE
        await this.client.setTextElements(url, category, elements, lockHandle, transport)
      } finally {
        try {
          if (lockHandle) await this.client.unLock(url, lockHandle)
        } finally {
          this.client.stateful = previousSessionType
        }
      }
      return this.client.activate(objectName, url)
    })
  }

  async getUserTransports(user: string): Promise<TransportsOfUser> {
    return this.client.userTransports(user, true)
  }

  async getTransportDetails(transportNumber: string): Promise<TransportRequest> {
    return this.client.transportDetails(transportNumber)
  }

  async releaseTransport(
    transportNumber: string,
    ignoreLocks = false,
    ignoreAtc = false
  ): Promise<TransportReleaseReport[]> {
    return this.serializeMutation(() =>
      this.client.transportRelease(transportNumber, ignoreLocks, ignoreAtc)
    )
  }

  async deleteTransport(transportNumber: string): Promise<void> {
    await this.serializeMutation(() => this.client.transportDelete(transportNumber))
  }

  async setTransportOwner(transportNumber: string, user: string): Promise<TransportOwnerResponse> {
    return this.serializeMutation(() => this.client.transportSetOwner(transportNumber, user))
  }

  async addTransportUser(transportNumber: string, user: string): Promise<TransportAddUserResponse> {
    return this.serializeMutation(() => this.client.transportAddUser(transportNumber, user))
  }

  async listSystemUsers(): Promise<Array<{ id: string; title: string }>> {
    return this.client.systemUsers()
  }

  async resolveTransportObject(
    pgmid: string,
    objectType: string,
    objectName: string,
    transportNumber?: string
  ): Promise<string> {
    return this.client.transportReference(pgmid, objectType, objectName, transportNumber)
  }

  async getRevisions(objectUri: string): Promise<Revision[]> {
    return this.client.revisions(objectUri)
  }

  async getInactiveObjects(): Promise<InactiveObjectRecord[]> {
    return this.client.inactiveObjects()
  }

  async getCodeCompletions(
    sourceUri: string,
    source: string,
    line: number,
    column: number
  ) {
    return this.client.statelessClone.codeCompletion(sourceUri, source, line, column)
  }

  async findDefinition(
    sourceUri: string,
    source: string,
    line: number,
    startColumn: number,
    endColumn: number,
    implementation = false,
    mainProgram = ""
  ): Promise<DefinitionLocation> {
    return this.client.statelessClone.findDefinition(
      sourceUri,
      source,
      line,
      startColumn,
      endColumn,
      implementation,
      mainProgram
    )
  }

  async getQuickFixes(
    sourceUri: string,
    source: string,
    line: number,
    column: number
  ): Promise<FixProposal[]> {
    return this.client.statelessClone.fixProposals(sourceUri, source, line, column)
  }

  async getQuickFixEdits(proposal: FixProposal, source: string): Promise<Delta[]> {
    return this.client.statelessClone.fixEdits(proposal, source)
  }

  async formatSource(source: string): Promise<string> {
    return this.client.statelessClone.prettyPrinter(source)
  }

  async evaluateRename(
    sourceUri: string,
    line: number,
    startColumn: number,
    endColumn: number
  ): Promise<RenameRefactoringProposal> {
    return this.client.statelessClone.renameEvaluate(sourceUri, line, startColumn, endColumn)
  }

  async previewRename(
    proposal: RenameRefactoringProposal,
    transport?: string
  ): Promise<RenameRefactoring> {
    return this.client.statelessClone.renamePreview(proposal, transport)
  }

  async executeRename(refactoring: RenameRefactoring): Promise<RenameRefactoring> {
    return this.serializeMutation(() => this.client.statelessClone.renameExecute(refactoring))
  }

  async previewPackageChange(
    refactoring: ChangePackageRefactoring,
    transport?: string
  ): Promise<ChangePackageRefactoring> {
    return this.client.statelessClone.changePackagePreview(refactoring, transport)
  }

  async executePackageChange(
    refactoring: ChangePackageRefactoring
  ): Promise<ChangePackageRefactoring> {
    return this.serializeMutation(() =>
      this.client.statelessClone.changePackageExecute(refactoring)
    )
  }

  async evaluateExtractMethod(sourceUri: string, range: Range): Promise<ExtractMethodProposal> {
    return this.client.statelessClone.extractMethodEvaluate(sourceUri, range)
  }

  async previewExtractMethod(proposal: ExtractMethodProposal): Promise<GenericRefactoring> {
    return this.client.statelessClone.extractMethodPreview(proposal)
  }

  async executeExtractMethod(refactoring: GenericRefactoring): Promise<GenericRefactoring> {
    return this.serializeMutation(() =>
      this.client.statelessClone.extractMethodExecute(refactoring)
    )
  }

  async deleteObject(
    objectUri: string,
    expectedFingerprint: string,
    transport?: string
  ): Promise<void> {
    await this.serializeMutation(async () => {
      const previousSessionType = this.client.stateful
      this.client.stateful = session_types.stateful
      let lockHandle: string | undefined
      let deleted = false
      try {
        const lock = await this.client.lock(objectUri)
        lockHandle = lock.LOCK_HANDLE
        const current = await this.getObjectFingerprint(objectUri)
        if (current.fingerprint !== expectedFingerprint) {
          throw new AppError(
            "OBJECT_CHANGED",
            `ABAP object changed after delete preview; refusing to delete ${objectUri}`
          )
        }
        await this.client.deleteObject(objectUri, lockHandle, transport)
        deleted = true
      } finally {
        try {
          if (lockHandle) {
            const unlock = this.client.unLock(objectUri, lockHandle)
            if (deleted) await unlock.catch(() => undefined)
            else await unlock
          }
        } finally {
          this.client.stateful = previousSessionType
        }
      }
    })
  }

  async listGitRepositories(): Promise<GitRepo[]> {
    return this.client.gitRepos()
  }

  async getGitRemoteInfo(url: string, user?: string, password?: string): Promise<GitExternalInfo> {
    return this.client.gitExternalRepoInfo(url, user, password)
  }

  async createGitRepository(
    packageName: string,
    url: string,
    branch?: string,
    transport?: string,
    user?: string,
    password?: string
  ): Promise<void[]> {
    return this.serializeMutation(() =>
      this.client.gitCreateRepo(packageName, url, branch, transport, user, password)
    )
  }

  async pullGitRepository(
    repositoryId: string,
    branch?: string,
    transport?: string,
    user?: string,
    password?: string
  ): Promise<void[]> {
    return this.serializeMutation(() =>
      this.client.gitPullRepo(repositoryId, branch, transport, user, password)
    )
  }

  async unlinkGitRepository(repositoryId: string): Promise<void> {
    await this.serializeMutation(() => this.client.gitUnlinkRepo(repositoryId))
  }

  async stageGitRepository(
    repository: GitRepo,
    user?: string,
    password?: string
  ): Promise<GitStaging> {
    return this.client.stageRepo(repository, user, password)
  }

  async pushGitRepository(
    repository: GitRepo,
    staging: GitStaging,
    user?: string,
    password?: string
  ): Promise<void> {
    await this.serializeMutation(() => this.client.pushRepo(repository, staging, user, password))
  }

  async checkGitRepository(
    repository: GitRepo,
    user?: string,
    password?: string
  ): Promise<void> {
    await this.client.checkRepo(repository, user, password)
  }

  async switchGitBranch(
    repository: GitRepo,
    branch: string,
    create = false,
    user?: string,
    password?: string
  ): Promise<void> {
    await this.serializeMutation(() =>
      this.client.switchRepoBranch(repository, branch, create, user, password)
    )
  }

  async isRapGeneratorAvailable(generatorId?: RapGeneratorId): Promise<boolean> {
    return this.client.rapGenIsAvailable(generatorId)
  }

  async validateRapGeneratorInitial(
    generatorId: RapGeneratorId,
    referenceObjectUri: string,
    packageName: string
  ): Promise<RapGeneratorValidationResult> {
    return this.client.rapGenValidateInitial(generatorId, referenceObjectUri, packageName)
  }

  async getRapGeneratorSchema(
    generatorId: RapGeneratorId,
    referenceObjectUri: string,
    packageName: string
  ): Promise<string> {
    return this.client.rapGenGetSchema(generatorId, referenceObjectUri, packageName)
  }

  async getRapGeneratorContent(
    generatorId: RapGeneratorId,
    referenceObjectUri: string,
    packageName: string
  ): Promise<RapGeneratorContent> {
    return this.client.rapGenGetContent(generatorId, referenceObjectUri, packageName)
  }

  async validateRapGeneratorContent(
    generatorId: RapGeneratorId,
    referenceObjectUri: string,
    content: RapGeneratorContent
  ): Promise<RapGeneratorValidationResult> {
    return this.client.rapGenValidateContent(generatorId, referenceObjectUri, content)
  }

  async previewRapGenerator(
    generatorId: RapGeneratorId,
    referenceObjectUri: string,
    content: RapGeneratorContent
  ): Promise<RapGeneratorPreviewObject[]> {
    return this.client.rapGenPreview(generatorId, referenceObjectUri, content)
  }

  async generateRapObjects(
    generatorId: RapGeneratorId,
    referenceObjectUri: string,
    transport: string,
    content: RapGeneratorContent
  ): Promise<RapGeneratorPreviewObject[]> {
    return this.serializeMutation(() =>
      this.client.rapGenGenerate(generatorId, referenceObjectUri, transport, content)
    )
  }

  async publishRapService(serviceBindingName: string): Promise<RapGeneratorValidationResult> {
    return this.serializeMutation(() => this.client.rapGenPublishService(serviceBindingName))
  }

  async unpublishServiceBinding(name: string, version: string) {
    return this.serializeMutation(() => this.client.unPublishServiceBinding(name, version))
  }

  async getServiceBindingDetails(name: string): Promise<SapServiceBindingDetails> {
    const bindingUrl = `/sap/bc/adt/businessservices/bindings/${encodeURIComponent(name.toLowerCase())}`
    const response = await this.client.httpClient.request(bindingUrl, {
      method: "GET",
      headers: { Accept: "application/*" }
    })
    const binding = parseServiceBinding(response.body)
    if (binding.services.length === 0) return { binding }
    return { binding, details: await this.client.bindingDetails(binding) }
  }

  async getNodeContents(parentType: NodeParents, parentName: string): Promise<NodeStructure> {
    return this.client.nodeContents(parentType, parentName, undefined, undefined, true)
  }

  async startDebugSession(
    debugUser = this.profile.username?.toUpperCase() ?? "",
    terminalMode = false
  ): Promise<SapDebugStatus> {
    if (!debugUser) {
      throw new AppError("DEBUG_USER_REQUIRED", "A SAP debug user is required")
    }
    await this.stopDebugSession()
    const runtime: DebugRuntime = {
      generation: ++this.debugGeneration,
      mode: terminalMode ? "terminal" : "user",
      debugUser,
      terminalId: randomUUID().replace(/-/g, "").toUpperCase(),
      ideId: randomUUID().replace(/-/g, "").toUpperCase(),
      state: "listening",
      breakpoints: new Map()
    }
    this.debugRuntime = runtime
    void this.listenForDebuggee(runtime)
    return this.getDebugStatus()
  }

  async stopDebugSession(): Promise<SapDebugStatus> {
    const runtime = this.debugRuntime
    if (!runtime) return this.getDebugStatus()
    this.debugRuntime = undefined
    this.debugGeneration += 1
    await this.client.statelessClone.debuggerDeleteListener(
      runtime.mode,
      runtime.terminalId,
      runtime.ideId,
      runtime.debugUser
    ).catch(() => undefined)
    if (runtime.executionClient) {
      await runtime.executionClient.debuggerStep("terminateDebuggee").catch(() => undefined)
      await runtime.executionClient.logout().catch(() => undefined)
    }
    return this.getDebugStatus()
  }

  getDebugStatus(): SapDebugStatus {
    const runtime = this.debugRuntime
    if (!runtime) return { active: false, state: "stopped", breakpointCount: 0 }
    return {
      active: true,
      state: runtime.state,
      mode: runtime.mode,
      debugUser: runtime.debugUser,
      terminalId: runtime.terminalId,
      ideId: runtime.ideId,
      ...(runtime.debuggee ? { debuggee: runtime.debuggee } : {}),
      breakpointCount: [...runtime.breakpoints.values()].reduce(
        (sum, breakpoints) => sum + breakpoints.length,
        0
      ),
      ...(runtime.lastError ? { lastError: runtime.lastError } : {})
    }
  }

  async setDebugBreakpoints(
    sourceUri: string,
    lineNumbers: number[],
    condition?: string,
    remove = false
  ): Promise<Array<DebugBreakpoint | DebugBreakpointError>> {
    const runtime = this.requireDebugRuntime(false)
    const existing = runtime.breakpoints.get(sourceUri) ?? []
    if (remove) {
      const lines = new Set(lineNumbers)
      const removed = existing.filter(item => lines.has(item.uri.range.start.line))
      for (const breakpoint of removed) {
        const deleteExternal = runtime.mode === "user"
          ? this.client.statelessClone.debuggerDeleteBreakpoints(
              breakpoint,
              "user",
              runtime.terminalId,
              runtime.ideId,
              runtime.debugUser,
              "external"
            )
          : this.client.statelessClone.debuggerDeleteBreakpoints(
              breakpoint,
              runtime.mode,
              runtime.terminalId,
              runtime.ideId,
              runtime.debugUser
            )
        await deleteExternal.catch(() => undefined)
        if (runtime.executionClient) {
          const deleteRuntime = runtime.mode === "user"
            ? runtime.executionClient.debuggerDeleteBreakpoints(
                breakpoint,
                "user",
                runtime.terminalId,
                runtime.ideId,
                runtime.debugUser,
                "debugger"
              )
            : runtime.executionClient.debuggerDeleteBreakpoints(
                breakpoint,
                runtime.mode,
                runtime.terminalId,
                runtime.ideId,
                runtime.debugUser
              )
          await deleteRuntime.catch(() => undefined)
        }
      }
      runtime.breakpoints.set(
        sourceUri,
        existing.filter(item => !lines.has(item.uri.range.start.line))
      )
      return removed
    }

    const clientId = `24:${this.profile.id}${sourceUri}`
    const requested = lineNumbers.map(line => `${sourceUri}#start=${line}`)
    let results = await this.client.statelessClone.debuggerSetBreakpoints(
      runtime.mode,
      runtime.terminalId,
      runtime.ideId,
      clientId,
      requested,
      runtime.debugUser,
      "external",
      false,
      false,
      sourceUri
    )
    let confirmed = results.filter(isDebuggerBreakpoint)
    if (condition) {
      const conditional = confirmed.map(item => ({ ...item, condition }))
      results = await this.client.statelessClone.debuggerSetBreakpoints(
        runtime.mode,
        runtime.terminalId,
        runtime.ideId,
        clientId,
        conditional,
        runtime.debugUser,
        "external",
        false,
        false,
        sourceUri
      )
      confirmed = results.filter(isDebuggerBreakpoint)
    }
    runtime.breakpoints.set(sourceUri, [
      ...existing.filter(item => !lineNumbers.includes(item.uri.range.start.line)),
      ...confirmed
    ])
    if (runtime.executionClient && confirmed.length > 0) {
      await runtime.executionClient.debuggerSetBreakpoints(
        runtime.mode,
        runtime.terminalId,
        runtime.ideId,
        clientId,
        confirmed,
        runtime.debugUser,
        "debugger",
        false,
        false,
        sourceUri
      )
    }
    return results
  }

  async debugStep(stepType: string, targetLine?: number): Promise<{
    result: DebugStep
    stack: DebugStackInfo
  }> {
    const runtime = this.requireDebugRuntime(true)
    const client = runtime.executionClient as ADTClient
    runtime.state = "stepping"
    const map = {
      continue: "stepContinue",
      stepInto: "stepInto",
      stepOver: "stepOver",
      stepReturn: "stepReturn"
    } as const
    let result: DebugStep
    try {
      if (stepType === "jumpToLine") {
        if (!targetLine) {
          throw new AppError("TARGET_LINE_REQUIRED", "jumpToLine requires targetLine")
        }
        const current = (await client.debuggerStackTrace(false)).stack[0]
        if (!current) throw new AppError("DEBUG_STACK_EMPTY", "No current stack frame")
        result = await client.debuggerStep(
          "stepJumpToLine",
          `${current.uri.uri}#start=${targetLine}`
        )
      } else {
        const method = map[stepType as keyof typeof map]
        if (!method) throw new AppError("DEBUG_STEP_INVALID", `Unknown step type ${stepType}`)
        result = await client.debuggerStep(method)
      }
      runtime.state = "paused"
      return { result, stack: await client.debuggerStackTrace(false) }
    } catch (error) {
      runtime.state = "error"
      runtime.lastError = error instanceof Error ? error.message : String(error)
      throw error
    }
  }

  async getDebugStack(): Promise<DebugStackInfo> {
    const runtime = this.requireDebugRuntime(true)
    return (runtime.executionClient as ADTClient).debuggerStackTrace(false)
  }

  async getDebugVariables(
    frameId: number,
    variableName?: string,
    expression?: string
  ): Promise<{ variables: DebugVariable[]; children?: DebugChildVariablesInfo }> {
    const runtime = this.requireDebugRuntime(true)
    const client = runtime.executionClient as ADTClient
    const stack = await client.debuggerStackTrace(false)
    const frameIndex = frameId % 1_000_000_000_000
    const frame = stack.stack[frameIndex]
    if (!frame) {
      throw new AppError("DEBUG_FRAME_NOT_FOUND", `No stack frame for frameId ${frameId}`)
    }
    await client.debuggerGoToStack("stackUri" in frame ? frame.stackUri : frame.stackPosition)
    const target = expression || variableName
    if (target) {
      const variables = await client.debuggerVariables([target])
      const first = variables[0]
      const children = first && ["structure", "object", "objectref", "table"].includes(first.META_TYPE)
        ? await client.debuggerChildVariables([first.ID])
        : undefined
      return { variables, ...(children ? { children } : {}) }
    }
    const children = await client.debuggerChildVariables(["@ROOT"])
    return { variables: children.variables, children }
  }

  async getDumps(): Promise<DumpsFeed> {
    return this.client.dumps()
  }

  async getTraceRuns(): Promise<TraceResults> {
    return this.client.tracesList()
  }

  async getTraceConfigurations(): Promise<TraceRequestList> {
    return this.client.tracesListRequests()
  }

  async getTraceHitList(id: string): Promise<TraceHitList> {
    return this.client.tracesHitList(id, true)
  }

  async getTraceStatements(id: string): Promise<TraceStatementResponse> {
    return this.client.tracesStatements(id, { withSystemEvents: true, withDetails: true })
  }

  async getAdtDiscovery() {
    const [discovery, core] = await Promise.all([
      this.client.adtDiscovery(),
      this.client.adtCoreDiscovery()
    ])
    return { discovery, core }
  }

  async ping(): Promise<{ collections: number; timestamp: string }> {
    return {
      collections: (await this.client.adtCoreDiscovery()).length,
      timestamp: new Date().toISOString()
    }
  }

  private requireDebugRuntime(requireExecution: boolean): DebugRuntime {
    const runtime = this.debugRuntime
    if (!runtime) throw new AppError("DEBUG_SESSION_NOT_ACTIVE", "Start a debug session first")
    if (requireExecution && !runtime.executionClient) {
      throw new AppError(
        "DEBUGGEE_NOT_ATTACHED",
        "The listener is active but no program has reached a breakpoint"
      )
    }
    return runtime
  }

  private async listenForDebuggee(runtime: DebugRuntime): Promise<void> {
    while (
      this.debugRuntime?.generation === runtime.generation &&
      runtime.state === "listening"
    ) {
      try {
        const event = await this.client.statelessClone.debuggerListen(
          runtime.mode,
          runtime.terminalId,
          runtime.ideId,
          runtime.debugUser
        )
        if (this.debugRuntime?.generation !== runtime.generation) return
        if (!event) {
          await new Promise(resolve => setTimeout(resolve, 100))
          continue
        }
        if (isDebugListenerError(event)) {
          runtime.state = "error"
          runtime.lastError = event.localizedMessage?.text || event.message?.text || event.conflictText
          return
        }
        if (!isDebuggee(event)) continue

        const executionClient = new ADTClient(
          this.profile.url,
          this.profile.username as string,
          this.password,
          this.profile.client,
          this.profile.language
        )
        await executionClient.login()
        executionClient.stateful = session_types.stateful
        await executionClient.adtCoreDiscovery()
        await executionClient.debuggerAttach(runtime.mode, event.DEBUGGEE_ID, runtime.debugUser, true)
        if (this.debugRuntime?.generation !== runtime.generation) {
          await executionClient.logout().catch(() => undefined)
          return
        }
        runtime.executionClient = executionClient
        runtime.debuggee = event
        runtime.state = "paused"
        return
      } catch (error) {
        if (this.debugRuntime?.generation !== runtime.generation) return
        runtime.state = "error"
        runtime.lastError = error instanceof Error ? error.message : String(error)
        return
      }
    }
  }

  private serializeMutation<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationQueue.then(operation, operation)
    this.mutationQueue = result.then(() => undefined, () => undefined)
    return result
  }

  async getSystemInfo(includeComponents = false): Promise<SapSystemInfo> {
    const warnings: string[] = []
    let discoveryCollections = 0
    let sapRelease = ""
    let logicalSystem = ""
    let clientName = ""
    let timezone: SapSystemInfo["timezone"] = null
    let softwareComponents: SapSoftwareComponent[] = []

    try {
      discoveryCollections = (await this.client.adtCoreDiscovery()).length
    } catch (error) {
      warnings.push(`ADT core discovery failed: ${error instanceof Error ? error.message : String(error)}`)
    }

    try {
      const result = await this.client.runQuery(
        `SELECT MANDT, MTEXT, LOGSYS FROM T000 WHERE MANDT = '${this.profile.client}'`,
        1,
        true
      )
      const row = result.values[0] as Record<string, unknown> | undefined
      clientName = String(row?.MTEXT ?? "")
      logicalSystem = String(row?.LOGSYS ?? "")
    } catch (error) {
      warnings.push(`Client information query failed: ${error instanceof Error ? error.message : String(error)}`)
    }

    try {
      const result = await this.client.runQuery("SELECT VERSION FROM SVERS", 10, true)
      const row = result.values[0] as Record<string, unknown> | undefined
      sapRelease = String(row?.VERSION ?? "")
    } catch (error) {
      warnings.push(`Release query failed: ${error instanceof Error ? error.message : String(error)}`)
    }

    try {
      const result = await this.client.runQuery(
        "SELECT COMPONENT, RELEASE, EXTRELEASE, COMP_TYPE FROM CVERS",
        500,
        true
      )
      softwareComponents = result.values.map(value => {
        const row = value as Record<string, unknown>
        return {
          component: String(row.COMPONENT ?? ""),
          release: String(row.RELEASE ?? ""),
          extRelease: String(row.EXTRELEASE ?? ""),
          componentType: String(row.COMP_TYPE ?? "")
        }
      })
    } catch (error) {
      warnings.push(`Software component query failed: ${error instanceof Error ? error.message : String(error)}`)
    }

    try {
      const result = await this.client.runQuery(
        "SELECT cu~TZONESYS, z~ZONERULE, t~DESCRIPT FROM TTZCU AS cu INNER JOIN TTZZ AS z ON cu~TZONESYS = z~TZONE INNER JOIN TTZZT AS t ON z~TZONE = t~TZONE WHERE cu~FLAGACTIVE = 'X' AND t~LANGU = 'E'",
        1,
        true
      )
      const row = result.values[0] as Record<string, unknown> | undefined
      if (row) {
        timezone = {
          name: String(row.TZONESYS ?? ""),
          description: String(row.DESCRIPT ?? ""),
          utcOffset: parseUtcOffset(String(row.ZONERULE ?? ""))
        }
      }
    } catch (error) {
      warnings.push(`Timezone query failed: ${error instanceof Error ? error.message : String(error)}`)
    }

    const systemType = detectSystemType(softwareComponents)
    return {
      profileId: this.profile.id,
      url: this.profile.url,
      client: this.profile.client,
      language: this.profile.language,
      environment: this.profile.environment,
      username: this.profile.username ?? "",
      sapRelease,
      systemType,
      logicalSystem,
      clientName,
      timezone,
      softwareComponents: includeComponents ? softwareComponents : [],
      discoveryCollections,
      warnings,
      queryTimestamp: new Date().toISOString()
    }
  }
}

export const defaultSapClientFactory: SapClientFactory = (profile, password) =>
  new AdtSapClient(profile, password)

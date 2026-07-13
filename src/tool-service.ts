import { randomUUID } from "node:crypto"
import { mkdir, mkdtemp, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, isAbsolute, join } from "node:path"
import { fileURLToPath } from "node:url"
import { AppError } from "./errors.js"
import {
  isCreatableTypeId,
  isGroupType,
  objectPath,
  parentTypeId,
  type NewBindingOptions,
  type NewObjectOptions,
  type NewPackageOptions,
  type NonGroupTypeIds,
  type PackageTypes,
  type TextElement,
  type TextElementCategory,
  type TransportObject,
  type TransportRequest,
  type ValidateOptions,
  type UsageReference
} from "abap-adt-api"
import type { ConnectionSummary } from "./connection-manager.js"
import {
  readAbapFsDocumentation,
  type DocumentationAction
} from "./compat/abap-fs-documentation.js"
import {
  createMermaidDiagram as createMermaidArtifact,
  detectMermaidDiagramType,
  getMermaidDocumentation,
  validateMermaidSyntax,
  type MermaidDiagramType,
  type MermaidTheme
} from "./mermaid-tools.js"
import type { SapClient } from "./sap-client.js"
import type { SapNewObjectOptions, SapObjectReference } from "./sap-client.js"
import {
  createTestDocumentation as createTestDocumentationArtifact,
  type TestDocumentationInput
} from "./test-documentation.js"

type BindingCategory = "0" | "1"

export interface ConnectionProvider {
  listConnections(): Promise<ConnectionSummary[]>
  getClient(connectionId: string): Promise<SapClient>
}

export interface SearchObjectsInput {
  pattern: string
  types: string[]
  maxResults: number
  connectionId: string
}

export interface GetObjectLinesInput {
  objectName: string
  objectType?: string
  methodName?: string
  startLine: number
  lineCount: number
  connectionId: string
}

export interface SearchObjectLinesInput {
  objectName: string
  searchTerm: string
  contextLines: number
  connectionId: string
  isRegexp: boolean
  maxObjects: number
  startIndex: number
  maxResults: number
}

export interface GetObjectInfoInput {
  objectName: string
  objectType?: string
  connectionId: string
  includeStructure: boolean
}

export interface GetBatchLinesInput {
  requests: Array<{ objectName: string; startLine: number; lineCount: number }>
  connectionId: string
}

export interface GetObjectByUriInput {
  uri: string
  startLine: number
  lineCount: number
  connectionId: string
}

export interface WhereUsedFilter {
  objectNamePattern?: string
  objectTypes?: string[]
  excludeSystemObjects?: boolean
}

export interface FindWhereUsedInput {
  objectName: string
  objectType?: string
  searchTerm?: string
  line?: number
  character?: number
  connectionId: string
  maxResults: number
  includeSnippets: boolean
  startIndex: number
  filter?: WhereUsedFilter
}

export interface ObjectLocatorInput {
  objectName: string
  objectType?: string
  connectionId: string
}

export interface CreateObjectInput {
  objectType: string
  name: string
  description: string
  packageName: string
  parentName?: string
  connectionId: string
  additionalOptions?: {
    serviceDefinition?: string
    bindingType?: "ODATA"
    bindingCategory?: BindingCategory
    softwareComponent?: string
    packageType?: PackageTypes
    transportLayer?: string
    transportRequest?:
      | { type: "existing"; number: string }
      | { type: "new"; description: string }
  }
}

export interface WorkspaceFileInput {
  fileUri: string
  connectionId?: string
}

export interface DiagnosticsInput extends WorkspaceFileInput {
  startIndex: number
  maxResults: number
  severity?: string
}

export interface ReplaceStringInput extends WorkspaceFileInput {
  oldString: string
  newString: string
  transport?: string
  activate: boolean
}

export interface ActivateObjectInput {
  url: string
  connectionId?: string
}

export interface ExecuteDataQueryInput {
  sql?: string
  data?: {
    columns: Array<{ name: string; type: string; description?: string }>
    values: Array<Record<string, unknown>>
  }
  displayMode: "internal" | "ui" | "download_to_file"
  webviewId?: string
  connectionId: string
  title?: string
  maxRows: number
  rowRange?: { start: number; end: number }
  sortColumns?: Array<{ column: string; direction: "asc" | "desc" }>
  filters?: Array<{ column: string; value: string }>
  resetSorting?: boolean
  resetFilters?: boolean
  filePath?: string
  fileType?: "xlsx" | "csv"
}

export interface RunAtcInput {
  action: "run_analysis" | "get_documentation"
  objectName?: string
  objectType?: string
  objectUri?: string
  connectionId?: string
  docUri?: string
  startIndex: number
  maxResults: number
  documentationOffset: number
  documentationLength: number
}

export interface ManageTextElementsInput {
  objectName: string
  objectType: "PROGRAM" | "CLASS" | "FUNCTION_GROUP"
  action: "read" | "create" | "update"
  textElements?: TextElement[]
  category: TextElementCategory
  connectionId: string
  transport?: string
}

export interface ManageTransportsInput {
  action:
    | "get_user_transports"
    | "get_transport_details"
    | "get_transport_objects"
    | "compare_transports"
  connectionId: string
  user?: string
  transportNumber?: string
  transportNumbers?: string[]
  startIndex: number
  maxResults: number
  includeObjects: boolean
}

export interface VersionHistoryInput extends ObjectLocatorInput {
  action: "list_versions" | "get_version_source" | "compare_versions"
  versionNumber?: number
  version1?: number
  version2?: number
  maxVersions: number
  startIndex: number
  maxResults: number
  startLine: number
  lineCount: number
}

export interface DownloadInput {
  source: string
  target: string
  connectionId?: string
  objectType?: string
  overwrite: boolean
  includeFileList: boolean
}

export interface DebugVariableInput {
  connectionId: string
  frameId: number
  variableName?: string
  expression?: string
  rowStart: number
  rowCount: number
  filter?: string
  scopeName?: string
  maxVariables: number
  filterPattern?: string
  expandStructures: boolean
  expandTables: boolean
}

export interface DumpAnalysisInput {
  action: "list_dumps" | "analyze_dump"
  connectionId: string
  dumpId?: string
  maxResults: number
  includeFullContent: boolean
  contentOffset: number
  contentLength: number
  startIndex: number
}

export interface TraceAnalysisInput {
  action:
    | "list_runs"
    | "list_configurations"
    | "analyze_run"
    | "get_statements"
    | "get_hitlist"
  connectionId: string
  traceId?: string
  maxResults: number
  includeDetails: boolean
  startIndex: number
}

export interface HeartbeatInput {
  action:
    | "status"
    | "start"
    | "stop"
    | "trigger"
    | "history"
    | "add_task"
    | "remove_task"
    | "update_task"
    | "enable_task"
    | "disable_task"
    | "list_tasks"
    | "get_watchlist"
  reason?: string
  count?: number
  description?: string
  condition?: string
  connectionId?: string
  removeWhenDone?: boolean
  sampleQuery?: string
  checkInstructions?: string[]
  priority?: "high" | "medium" | "low"
  category?: "transport" | "dump" | "job" | "idoc" | "performance" | "reminder" | "custom"
  alertThreshold?: number
  cooldownMinutes?: number
  expiresAt?: string
  maxChecks?: number
  startAt?: string
  reminderOnly?: boolean
  taskId?: string
  result?: string
  lastNotifiedAt?: string
  lastNotifiedFindings?: string
  modifiedBy?: "user" | "heartbeat" | "agent"
  startIndex: number
  maxResults: number
  includeDetails: boolean
}

export interface DocumentationInput {
  action: DocumentationAction
  searchQuery?: string
  startLine: number
  lineCount: number
}

interface HeartbeatTask {
  id: string
  description: string
  enabled: boolean
  checks: number
  createdAt: string
  updatedAt: string
  lastResult?: string
  lastNotifiedAt?: string
  lastNotifiedFindings?: string
  condition?: string
  connectionId?: string
  removeWhenDone: boolean
  sampleQuery?: string
  checkInstructions: string[]
  priority: "high" | "medium" | "low"
  category: "transport" | "dump" | "job" | "idoc" | "performance" | "reminder" | "custom"
  alertThreshold?: number
  cooldownMinutes?: number
  expiresAt?: string
  maxChecks?: number
  startAt?: string
  reminderOnly: boolean
  modifiedBy: "user" | "heartbeat" | "agent"
}

interface EditableTarget {
  connectionId: string
  client: SapClient
  object: SapObjectReference
  objectUri: string
  sourceUri: string
  source: string
  mainProgram?: string
}

interface DataViewState {
  connectionId: string
  columns: NonNullable<ExecuteDataQueryInput["data"]>["columns"]
  values: NonNullable<ExecuteDataQueryInput["data"]>["values"]
  title: string | undefined
  sortColumns: NonNullable<ExecuteDataQueryInput["sortColumns"]>
  filters: NonNullable<ExecuteDataQueryInput["filters"]>
}

const INLINE_TEXT_BYTE_LIMIT = 96 * 1024
const MAX_BATCH_LINES = 5000

function pageItems<T>(items: T[], startIndex: number, maxResults: number) {
  const page = items.slice(startIndex, startIndex + maxResults)
  const nextStartIndex = startIndex + page.length < items.length
    ? startIndex + page.length
    : null
  return {
    total: items.length,
    startIndex,
    returned: page.length,
    truncated: nextStartIndex !== null,
    nextStartIndex,
    items: page
  }
}

function selectLines(
  lines: string[],
  startIndex: number,
  lineCount: number,
  byteLimit = INLINE_TEXT_BYTE_LIMIT
) {
  const selected: string[] = []
  let bytes = 0
  const requestedEnd = Math.min(lines.length, startIndex + lineCount)
  for (let index = startIndex; index < requestedEnd; index += 1) {
    const line = lines[index] ?? ""
    const lineBytes = Buffer.byteLength(line, "utf8") + (selected.length > 0 ? 1 : 0)
    if (selected.length > 0 && bytes + lineBytes > byteLimit) break
    selected.push(line)
    bytes += lineBytes
  }
  const endIndex = startIndex + selected.length
  return {
    selected,
    endIndex,
    truncated: endIndex < requestedEnd,
    nextIndex: endIndex < lines.length ? endIndex : null
  }
}

export function extractAbapMethod(
  source: string,
  methodName: string
): { code: string; startLine: number; endLine: number } | undefined {
  const lines = source.split(/\r?\n/)
  const escapedName = methodName.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const startPattern = new RegExp(`^\\s*METHOD\\s+(?:\\w+~)?${escapedName}\\s*\\.`, "i")
  let startIndex = -1

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ""
    const trimmed = line.trim()
    if (trimmed.startsWith("*") || trimmed.startsWith('"')) continue
    if (startIndex < 0 && startPattern.test(line)) {
      startIndex = index
      continue
    }
    if (startIndex >= 0 && /^\s*ENDMETHOD\s*\./i.test(line)) {
      return {
        code: lines.slice(startIndex, index + 1).join("\n"),
        startLine: startIndex + 1,
        endLine: index + 1
      }
    }
  }
  return undefined
}

function sameType(actual: string, expected?: string): boolean {
  if (!expected) return true
  const normalizedActual = actual.toUpperCase()
  const normalizedExpected = expected.toUpperCase()
  if (normalizedExpected.includes("/")) return normalizedActual === normalizedExpected
  return normalizedActual.replace(/\/.*$/, "") === normalizedExpected
}

async function resolveObject(
  client: SapClient,
  objectName: string,
  objectType?: string
): Promise<SapObjectReference> {
  const candidates = await client.searchObjects(objectName, objectType, 50)
  const exact = candidates.filter(
    candidate =>
      candidate.name.toUpperCase() === objectName.toUpperCase() &&
      sameType(candidate.type, objectType)
  )

  if (exact.length === 0) {
    throw new AppError("OBJECT_NOT_FOUND", `ABAP object ${objectName} was not found`, {
      ...(objectType ? { objectType } : {})
    })
  }
  if (exact.length > 1 && !objectType) {
    throw new AppError(
      "OBJECT_AMBIGUOUS",
      `Multiple ABAP objects named ${objectName} were found; provide objectType`,
      { candidates: exact.map(item => ({ type: item.type, uri: item.uri })) }
    )
  }
  return exact[0] as SapObjectReference
}

function wildcardRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&")
  return new RegExp(`^${escaped.replace(/\*/g, ".*").replace(/\?/g, ".")}$`, "i")
}

function referenceName(reference: UsageReference): string {
  const parts = reference.objectIdentifier?.split(";") ?? []
  return parts[0] === "ABAPFullName" && parts[1]
    ? parts[1]
    : reference["adtcore:name"] || reference.objectIdentifier || ""
}

function parseAdtLocation(value: string, explicitConnectionId?: string) {
  if (value.startsWith("adt://")) {
    const uri = new URL(value)
    if (!uri.hostname || !uri.pathname.startsWith("/sap/bc/adt/")) {
      throw new AppError("INVALID_ADT_URI", `Invalid ABAP workspace URI: ${value}`)
    }
    if (
      explicitConnectionId &&
      explicitConnectionId.toUpperCase() !== uri.hostname.toUpperCase()
    ) {
      throw new AppError(
        "CONNECTION_MISMATCH",
        `URI connection ${uri.hostname} does not match ${explicitConnectionId}`
      )
    }
    return {
      connectionId: uri.hostname.toUpperCase(),
      path: decodeURIComponent(uri.pathname)
    }
  }

  if (value.startsWith("/sap/bc/adt/") && explicitConnectionId) {
    return { connectionId: explicitConnectionId.toUpperCase(), path: value }
  }
  throw new AppError(
    "INVALID_ADT_URI",
    "Use an adt:// workspace URI, or provide connectionId with an absolute /sap/bc/adt/ path"
  )
}

function objectUriFromSourceUri(sourceUri: string): string {
  const withoutQuery = sourceUri.replace(/[?#].*$/, "").replace(/\/+$/, "")
  const classInclude = withoutQuery.match(
    /^(\/sap\/bc\/adt\/oo\/(?:classes|interfaces)\/[^/]+)\/includes\/[^/]+$/i
  )
  if (classInclude?.[1]) return classInclude[1]
  return withoutQuery.replace(/\/source\/[^/]+$/i, "")
}

export function replaceExactlyOnce(content: string, oldString: string, newString: string): string {
  if (!oldString) {
    if (content.length === 0) return newString
    throw new AppError(
      "EMPTY_MATCH_NOT_ALLOWED",
      "oldString can only be empty when the current ABAP source is blank"
    )
  }
  if (oldString === newString) {
    throw new AppError("NO_SOURCE_CHANGE", "oldString and newString are identical")
  }

  let count = 0
  let offset = 0
  while (true) {
    const index = content.indexOf(oldString, offset)
    if (index < 0) break
    count += 1
    offset = index + oldString.length
  }
  if (count === 1) return content.replace(oldString, newString)
  if (count > 1) {
    throw new AppError(
      "SOURCE_MATCH_AMBIGUOUS",
      `oldString matched ${count} locations; include more surrounding source context`
    )
  }

  const normalizedContent = content.replace(/\r\n/g, "\n")
  const normalizedOld = oldString.replace(/\r\n/g, "\n")
  const first = normalizedContent.indexOf(normalizedOld)
  const second = first < 0 ? -1 : normalizedContent.indexOf(normalizedOld, first + normalizedOld.length)
  if (first >= 0 && second < 0) {
    const updated = normalizedContent.replace(normalizedOld, newString.replace(/\r\n/g, "\n"))
    return content.includes("\r\n") ? updated.replace(/(?<!\r)\n/g, "\r\n") : updated
  }
  throw new AppError(
    "SOURCE_MATCH_NOT_FOUND",
    "oldString was not found exactly; read the current source and preserve whitespace"
  )
}

function requireWritablePackage(client: SapClient, packageName?: string): string {
  if (client.profile.environment === "production") {
    throw new AppError(
      "PRODUCTION_WRITE_BLOCKED",
      `Writes are disabled for production profile ${client.profile.id}`
    )
  }
  const normalizedPackage = packageName?.trim().toUpperCase()
  if (!normalizedPackage) {
    throw new AppError(
      "PACKAGE_UNKNOWN",
      "The target package could not be determined, so the write was refused"
    )
  }
  if (!client.profile.allowedPackages.includes(normalizedPackage)) {
    throw new AppError(
      "PACKAGE_NOT_ALLOWED",
      `Package ${normalizedPackage} is not in the ${client.profile.id} write allowlist`,
      { allowedPackages: client.profile.allowedPackages }
    )
  }
  return normalizedPackage
}

function requireTransport(packageName: string, transport?: string): string | undefined {
  const normalizedTransport = transport?.trim().toUpperCase()
  if (packageName !== "$TMP" && !normalizedTransport) {
    throw new AppError(
      "TRANSPORT_REQUIRED",
      `A transport request is required for package ${packageName}`
    )
  }
  return normalizedTransport || undefined
}

function validateReadOnlySql(sql: string): void {
  const normalized = sql.trim()
  if (!/^(SELECT|WITH)\b/i.test(normalized)) {
    throw new AppError("QUERY_NOT_READ_ONLY", "Only SELECT and WITH queries are allowed")
  }
  if (
    /\b(INSERT|UPDATE|DELETE|MODIFY|DROP|ALTER|CREATE|TRUNCATE)\b/i.test(normalized) ||
    /;\s*\S/.test(normalized) ||
    /--|\/\*/.test(normalized)
  ) {
    throw new AppError("QUERY_NOT_READ_ONLY", "The query contains a disallowed operation")
  }
}

function filterAndSortRows(
  values: Record<string, unknown>[],
  filters: ExecuteDataQueryInput["filters"],
  sorts: ExecuteDataQueryInput["sortColumns"]
): Record<string, unknown>[] {
  let result = [...values]
  for (const filter of filters ?? []) {
    const expression = wildcardRegex(filter.value)
    result = result.filter(row => expression.test(String(row[filter.column] ?? "")))
  }
  if (sorts?.length) {
    result.sort((left, right) => {
      for (const sort of sorts) {
        const comparison = String(left[sort.column] ?? "").localeCompare(
          String(right[sort.column] ?? ""),
          undefined,
          { numeric: true }
        )
        if (comparison !== 0) return sort.direction === "asc" ? comparison : -comparison
      }
      return 0
    })
  }
  return result
}

function transportObjects(transport: TransportRequest): TransportObject[] {
  return [
    ...transport.objects,
    ...transport.tasks.flatMap(task => task.objects)
  ]
}

function transportObjectKey(object: TransportObject): string {
  return `${object["tm:pgmid"]}.${object["tm:type"]}.${object["tm:name"]}`
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>|<\/div>|<\/li>|<\/h[1-6]>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

export class AbapToolService {
  private readonly atcDecorations = new Map<string, unknown[]>()
  private readonly dataViews = new Map<string, DataViewState>()
  private readonly heartbeatTasks = new Map<string, HeartbeatTask>()
  private readonly heartbeatHistory: Array<Record<string, unknown>> = []
  private heartbeatActive = false
  private heartbeatTimer: NodeJS.Timeout | undefined
  private heartbeatLastRun?: string

  constructor(private readonly connections: ConnectionProvider) {}

  private async resolveEditableTarget(input: WorkspaceFileInput): Promise<EditableTarget> {
    const location = parseAdtLocation(input.fileUri, input.connectionId)
    const client = await this.connections.getClient(location.connectionId)
    const source = await client.readSourceByUri(location.path)
    const objectUri = objectUriFromSourceUri(source.sourceUri)
    const structure = await client.getObjectStructure(objectUri)
    const name = structure.metaData["adtcore:name"]
    const type = structure.metaData["adtcore:type"]
    const candidates = await client.searchObjects(name, type, 50)
    const object = candidates.find(candidate =>
      candidate.name.toUpperCase() === name.toUpperCase() &&
      sameType(candidate.type, type) &&
      candidate.uri.replace(/\/+$/, "") === objectUri.replace(/\/+$/, "")
    ) ?? candidates.find(candidate =>
      candidate.name.toUpperCase() === name.toUpperCase() && sameType(candidate.type, type)
    ) ?? { name, type, uri: objectUri }

    let mainProgram: string | undefined
    if (type.toUpperCase() === "PROG/I") {
      try {
        mainProgram = (await client.getMainPrograms(objectUri))[0]?.["adtcore:uri"]
      } catch {
        // Some backends can syntax-check includes without an explicit main program.
      }
    }

    return {
      connectionId: location.connectionId,
      client,
      object,
      objectUri,
      sourceUri: source.sourceUri,
      source: source.source,
      ...(mainProgram ? { mainProgram } : {})
    }
  }

  async getConnectedSystems() {
    return { systems: await this.connections.listConnections() }
  }

  async createMermaidDiagram(
    code: string,
    diagramType: MermaidDiagramType | "auto",
    theme: MermaidTheme
  ) {
    return createMermaidArtifact(code, diagramType, theme)
  }

  async validateMermaidSyntax(code: string, suppressErrors: boolean) {
    return validateMermaidSyntax(code, suppressErrors)
  }

  getMermaidDocumentation(diagramType: MermaidDiagramType | "all", includeExamples: boolean) {
    return getMermaidDocumentation(diagramType, includeExamples)
  }

  async detectMermaidDiagramType(code: string) {
    return detectMermaidDiagramType(code)
  }

  async createTestDocumentation(input: TestDocumentationInput) {
    return createTestDocumentationArtifact(input)
  }

  getAbapFsDocumentation(input: DocumentationInput) {
    return readAbapFsDocumentation(input)
  }

  async getSapSystemInfo(connectionId: string, includeComponents: boolean) {
    const client = await this.connections.getClient(connectionId)
    return client.getSystemInfo(includeComponents)
  }

  async createObjectProgrammatically(input: CreateObjectInput) {
    const client = await this.connections.getClient(input.connectionId)
    const objectType = input.objectType.trim().toUpperCase()
    if (!isCreatableTypeId(objectType)) {
      throw new AppError(
        "OBJECT_TYPE_NOT_CREATABLE",
        `${input.objectType} is not a creatable object type supported by the installed ADT API`
      )
    }

    const rawName = input.name.trim().toUpperCase()
    const packageName = input.packageName.trim().toUpperCase()
    const parentName = isGroupType(objectType)
      ? input.parentName?.trim().toUpperCase()
      : packageName
    if (isGroupType(objectType) && !parentName) {
      throw new AppError(
        "PARENT_REQUIRED",
        `${objectType} requires parentName with the parent function group`
      )
    }

    const name = objectType === "FUGR/I"
      ? parentName?.split("/").filter(Boolean).length === 2
        ? `/${parentName.split("/").filter(Boolean)[0]}/L${parentName.split("/").filter(Boolean)[1]}${rawName}`
        : `L${parentName}${rawName}`
      : rawName
    const writePackage = requireWritablePackage(
      client,
      objectType === "DEVC/K" ? name : packageName
    )
    const additional = input.additionalOptions

    let validateOptions: ValidateOptions
    if (isGroupType(objectType)) {
      validateOptions = {
        objtype: objectType,
        objname: name,
        description: input.description,
        fugrname: parentName as string
      }
    } else if (objectType === "DEVC/K") {
      if (!additional?.softwareComponent || !additional.packageType || additional.transportLayer === undefined) {
        throw new AppError(
          "PACKAGE_OPTIONS_REQUIRED",
          "Package creation requires softwareComponent, packageType, and transportLayer"
        )
      }
      validateOptions = {
        objtype: objectType,
        objname: name,
        description: input.description,
        packagename: packageName,
        swcomp: additional.softwareComponent,
        packagetype: additional.packageType,
        transportLayer: additional.transportLayer
      }
    } else if (objectType === "SRVB/SVB") {
      if (
        !additional?.serviceDefinition ||
        additional.bindingType !== "ODATA" ||
        !additional.bindingCategory
      ) {
        throw new AppError(
          "SERVICE_BINDING_OPTIONS_REQUIRED",
          "Service binding creation requires serviceDefinition, bindingType=ODATA, and bindingCategory"
        )
      }
      validateOptions = {
        objtype: objectType,
        objname: name,
        description: input.description,
        package: packageName,
        serviceBindingVersion: "ODATA\\V2",
        serviceDefinition: additional.serviceDefinition.toUpperCase()
      }
    } else {
      validateOptions = {
        objtype: objectType as NonGroupTypeIds,
        objname: name,
        description: input.description,
        packagename: packageName
      }
    }

    const validation = await client.validateNewObject(validateOptions)
    if (!validation.success) {
      throw new AppError(
        "OBJECT_VALIDATION_FAILED",
        validation.SHORT_TEXT || `SAP rejected ${objectType} ${name}`,
        { validation }
      )
    }

    const normalizedParent = parentName ?? ""
    const targetUri = objectPath(objectType, name, normalizedParent)
    let transport: string | undefined
    const request = additional?.transportRequest
    if (request?.type === "existing") {
      transport = request.number.trim().toUpperCase()
    } else if (request?.type === "new") {
      transport = await client.createTransport(
        targetUri,
        request.description,
        packageName,
        additional?.transportLayer
      )
    }
    transport = requireTransport(writePackage, transport)

    const baseOptions: NewObjectOptions = {
      objtype: objectType,
      name,
      parentName: normalizedParent,
      description: input.description,
      parentPath: objectPath(parentTypeId(objectType), normalizedParent, ""),
      language: client.profile.language,
      ...(client.profile.username
        ? { responsible: client.profile.username.toUpperCase() }
        : {}),
      ...(transport ? { transport } : {})
    }
    let createOptions: SapNewObjectOptions
    if (objectType === "DEVC/K") {
      createOptions = {
        ...baseOptions,
        objtype: objectType,
        swcomp: additional?.softwareComponent as string,
        packagetype: additional?.packageType as PackageTypes,
        transportLayer: additional?.transportLayer as string
      } satisfies NewPackageOptions
    } else if (objectType === "SRVB/SVB") {
      createOptions = {
        ...baseOptions,
        objtype: objectType,
        service: additional?.serviceDefinition?.toUpperCase() as string,
        bindingtype: "ODATA",
        category: additional?.bindingCategory as BindingCategory
      } satisfies NewBindingOptions
    } else {
      createOptions = baseOptions
    }
    await client.createObject(createOptions)
    return {
      connectionId: input.connectionId.toUpperCase(),
      success: true,
      object: { name, type: objectType, uri: targetUri, packageName: writePackage },
      transport: transport ?? null
    }
  }

  async executeDataQuery(input: ExecuteDataQueryInput) {
    const sourceCount = Number(Boolean(input.sql)) + Number(Boolean(input.data))
    if (sourceCount > 1 || (sourceCount === 0 && !input.webviewId)) {
      throw new AppError(
        "QUERY_INPUT_INVALID",
        "Provide exactly one of sql or data, or webviewId for a cached result"
      )
    }
    const client = await this.connections.getClient(input.connectionId)
    if (client.profile.environment === "production" && input.displayMode !== "download_to_file") {
      throw new AppError(
        "PRODUCTION_DATA_BLOCKED",
        "Headless query results are blocked for production profiles; use download_to_file"
      )
    }
    if (input.sql) validateReadOnlySql(input.sql)
    if (input.displayMode === "internal") {
      if (!input.rowRange) {
        throw new AppError("ROW_RANGE_REQUIRED", "Internal mode requires rowRange")
      }
    }
    if (
      input.displayMode !== "download_to_file" &&
      input.rowRange &&
      input.rowRange.end - input.rowRange.start > 1000
    ) {
      throw new AppError("ROW_RANGE_TOO_LARGE", "Inline query results are limited to 1000 rows")
    }

    const cached = input.webviewId ? this.dataViews.get(input.webviewId) : undefined
    if (input.webviewId && !cached && sourceCount === 0) {
      throw new AppError("DATA_VIEW_NOT_FOUND", `No cached data view ${input.webviewId}`)
    }
    if (cached && cached.connectionId !== input.connectionId.toUpperCase()) {
      throw new AppError(
        "CONNECTION_MISMATCH",
        `Data view ${input.webviewId} belongs to ${cached.connectionId}`
      )
    }
    const raw = input.sql
      ? await client.runQuery(input.sql, input.maxRows)
      : input.data ?? cached as DataViewState
    const webviewId = input.webviewId ?? randomUUID()
    const filters = input.resetFilters
      ? input.filters ?? []
      : input.filters ?? cached?.filters ?? []
    const sortColumns = input.resetSorting
      ? input.sortColumns ?? []
      : input.sortColumns ?? cached?.sortColumns ?? []
    const state: DataViewState = {
      connectionId: input.connectionId.toUpperCase(),
      columns: raw.columns,
      values: (raw.values as Record<string, unknown>[]).slice(0, input.maxRows),
      title: input.title ?? cached?.title,
      filters,
      sortColumns
    }
    this.dataViews.set(webviewId, state)
    if (this.dataViews.size > 20) {
      const oldest = this.dataViews.keys().next().value as string | undefined
      if (oldest) this.dataViews.delete(oldest)
    }
    const rows = filterAndSortRows(
      state.values,
      state.filters,
      state.sortColumns
    )
    const responseRange = input.rowRange ?? (
      input.displayMode === "ui" ? { start: 0, end: Math.min(100, input.maxRows) } : undefined
    )
    const selected = responseRange
      ? rows.slice(responseRange.start, responseRange.end)
      : rows.slice(0, input.maxRows)

    if (input.displayMode === "download_to_file") {
      if (!input.filePath || !input.fileType) {
        throw new AppError(
          "DOWNLOAD_OPTIONS_REQUIRED",
          "download_to_file requires filePath and fileType"
        )
      }
      const basePath = input.filePath.startsWith("file://")
        ? fileURLToPath(input.filePath)
        : input.filePath
      if (!isAbsolute(basePath)) {
        throw new AppError("TARGET_NOT_ABSOLUTE", "filePath must be absolute")
      }
      const outputPath = `${basePath}.${input.fileType}`
      await mkdir(dirname(outputPath), { recursive: true })
      if (input.fileType === "csv") {
        const columnNames = raw.columns.map(column => column.name)
        const escape = (value: unknown) => {
          const text = String(value ?? "")
          return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
        }
        const csv = [
          columnNames.map(escape).join(","),
          ...selected.map(row => columnNames.map(name => escape(row[name])).join(","))
        ].join("\r\n")
        await writeFile(outputPath, `\ufeff${csv}`, "utf8")
      } else {
        const ExcelJS = (await import("exceljs")).default
        const workbook = new ExcelJS.Workbook()
        const sheet = workbook.addWorksheet((input.title || "ABAP Data").slice(0, 31))
        sheet.columns = raw.columns.map(column => ({
          header: column.description || column.name,
          key: column.name,
          width: Math.max(12, Math.min(40, column.name.length + 4))
        }))
        sheet.addRows(selected)
        await workbook.xlsx.writeFile(outputPath)
      }
      return {
        connectionId: input.connectionId.toUpperCase(),
        displayMode: input.displayMode,
        webviewId,
        outputPath,
        rowCount: selected.length,
        columnCount: raw.columns.length
      }
    }

    return {
      connectionId: input.connectionId.toUpperCase(),
      displayMode: input.displayMode === "ui" ? "headless" : input.displayMode,
      webviewId,
      title: state.title ?? null,
      filters: state.filters,
      sortColumns: state.sortColumns,
      totalRows: rows.length,
      returnedRows: selected.length,
      rowRange: responseRange ?? { start: 0, end: selected.length },
      truncated: (responseRange?.end ?? selected.length) < rows.length,
      nextRowStart:
        (responseRange?.end ?? selected.length) < rows.length
          ? responseRange?.end ?? selected.length
          : null,
      columns: raw.columns,
      values: selected
    }
  }

  getAbapSqlSyntax() {
    return {
      dialect: "SAP ADT data preview SQL",
      rules: [
        "Only SELECT and WITH statements are accepted by this MCP tool.",
        "Use ABAP Dictionary table/view names and ABAP field names, not CDS SQL-view aliases unless the backend exposes them.",
        "Use single quotes for character literals and double single-quotes to escape an apostrophe.",
        "Prefer explicit field lists. Do not send INSERT, UPDATE, DELETE, MODIFY, DDL, comments, or multiple statements.",
        "Row limits are supplied through execute_data_query.maxRows; do not rely on database-specific LIMIT syntax.",
        "Open SQL host-variable syntax (@variable) is for ABAP source and is not available in a standalone ADT data-preview query."
      ],
      examples: [
        "SELECT MATNR, MTART FROM MARA WHERE MTART = 'FERT'",
        "SELECT MANDT, MTEXT, LOGSYS FROM T000 WHERE MANDT = '100'"
      ]
    }
  }

  async runAtcAnalysis(input: RunAtcInput) {
    if (input.action === "get_documentation") {
      if (!input.connectionId || !input.docUri) {
        throw new AppError(
          "ATC_DOCUMENTATION_INPUT_REQUIRED",
          "get_documentation requires connectionId and docUri"
        )
      }
      const client = await this.connections.getClient(input.connectionId)
      const documentation = stripHtml(await client.getAtcDocumentation(input.docUri))
      const end = Math.min(
        documentation.length,
        input.documentationOffset + input.documentationLength
      )
      return {
        connectionId: input.connectionId.toUpperCase(),
        docUri: input.docUri,
        documentation: documentation.slice(input.documentationOffset, end),
        totalCharacters: documentation.length,
        contentOffset: input.documentationOffset,
        returnedCharacters: end - input.documentationOffset,
        truncated: end < documentation.length,
        nextContentOffset: end < documentation.length ? end : null
      }
    }

    let target: EditableTarget
    if (input.objectUri) {
      target = await this.resolveEditableTarget({
        fileUri: input.objectUri,
        ...(input.connectionId ? { connectionId: input.connectionId } : {})
      })
    } else if (input.objectName && input.connectionId) {
      const client = await this.connections.getClient(input.connectionId)
      const object = await resolveObject(client, input.objectName, input.objectType)
      const source = await client.readObject(object)
      target = await this.resolveEditableTarget({
        fileUri: source.sourceUri,
        connectionId: input.connectionId
      })
    } else {
      throw new AppError(
        "ATC_TARGET_REQUIRED",
        "Headless ATC requires objectUri or objectName with connectionId"
      )
    }

    const customizing = await target.client.getAtcCustomizing()
    const variantProperty = customizing.properties.find(
      property => property.name === "systemCheckVariant"
    )
    const variant = String(variantProperty?.value ?? "")
    if (!variant || !(await target.client.checkAtcVariant(variant))) {
      throw new AppError("ATC_VARIANT_NOT_FOUND", "No system ATC check variant is available")
    }
    const run = await target.client.runAtc(variant, target.sourceUri, 1000)
    const worklist = await target.client.getAtcWorklist(run)
    const findings = worklist.objects.flatMap(object =>
      object.findings.map(finding => ({
        object: {
          name: object.name,
          type: object.type,
          packageName: object.packageName,
          uri: object.uri
        },
        finding: {
          uri: finding.uri,
          priority: finding.priority,
          priorityText: finding.priority === 1 ? "Error" : finding.priority === 2 ? "Warning" : "Info",
          checkId: finding.checkId,
          checkTitle: finding.checkTitle,
          messageId: finding.messageId,
          messageTitle: finding.messageTitle,
          location: finding.location,
          exemptionApproval: finding.exemptionApproval || null,
          docUri: finding.link?.href || null
        }
      }))
    )
    const workspaceUri = `adt://${target.connectionId.toLowerCase()}${target.sourceUri}`
    this.atcDecorations.set(workspaceUri, findings)
    const page = pageItems(findings, input.startIndex, input.maxResults)
    return {
      connectionId: target.connectionId,
      target: target.object,
      variant,
      run,
      summary: {
        total: findings.length,
        errors: findings.filter(item => item.finding.priority === 1).length,
        warnings: findings.filter(item => item.finding.priority === 2).length,
        infos: findings.filter(item => item.finding.priority >= 3).length
      },
      findings: page.items,
      startIndex: page.startIndex,
      returned: page.returned,
      truncated: page.truncated,
      nextStartIndex: page.nextStartIndex
    }
  }

  getAtcDecorations(fileUri = "", startIndex = 0, maxResults = 50) {
    if (fileUri) {
      const decorations = this.atcDecorations.get(fileUri) ?? []
      const page = pageItems(decorations, startIndex, maxResults)
      return {
        fileUri,
        count: page.total,
        startIndex: page.startIndex,
        returned: page.returned,
        truncated: page.truncated,
        nextStartIndex: page.nextStartIndex,
        decorations: page.items
      }
    }
    const allDecorations = [...this.atcDecorations.entries()].flatMap(([uri, findings]) =>
      findings.map(finding => ({ fileUri: uri, finding }))
    )
    const page = pageItems(allDecorations, startIndex, maxResults)
    return {
      totalFiles: this.atcDecorations.size,
      totalFindings: page.total,
      startIndex: page.startIndex,
      returned: page.returned,
      truncated: page.truncated,
      nextStartIndex: page.nextStartIndex,
      decorations: page.items
    }
  }

  async manageTextElements(input: ManageTextElementsInput) {
    const client = await this.connections.getClient(input.connectionId)
    const typeMap = {
      PROGRAM: "PROG/P",
      CLASS: "CLAS/OC",
      FUNCTION_GROUP: "FUGR/F"
    } as const
    const adtType = typeMap[input.objectType]
    const object = await resolveObject(client, input.objectName, adtType)
    const current = await client.getTextElements(adtType, object.name, input.category)
    if (input.action === "read") {
      return {
        connectionId: input.connectionId.toUpperCase(),
        object,
        category: input.category,
        programName: current.programName,
        textElements: current.textElements
      }
    }
    if (!input.textElements?.length) {
      throw new AppError(
        "TEXT_ELEMENTS_REQUIRED",
        `${input.action} requires at least one text element`
      )
    }

    const packageName = requireWritablePackage(client, object.packageName)
    const transport = requireTransport(packageName, input.transport)
    const updates = new Map(
      input.textElements.map(element => [element.id.toUpperCase(), {
        ...element,
        id: element.id.toUpperCase(),
        maxLength: element.maxLength ?? Math.max(10, element.text.length)
      }])
    )
    for (const element of updates.values()) {
      if ((element.maxLength ?? 0) < element.text.length) {
        throw new AppError(
          "TEXT_ELEMENT_TOO_LONG",
          `${element.id} text length exceeds maxLength ${element.maxLength}`
        )
      }
    }
    const merged = [
      ...current.textElements.map(element => updates.get(element.id.toUpperCase()) ?? element),
      ...[...updates.values()].filter(
        element => !current.textElements.some(currentElement =>
          currentElement.id.toUpperCase() === element.id
        )
      )
    ]
    const activation = await client.updateTextElements(
      adtType,
      object.name,
      input.category,
      merged,
      transport
    )
    return {
      connectionId: input.connectionId.toUpperCase(),
      object,
      action: input.action,
      category: input.category,
      changedIds: [...updates.keys()],
      textElements: merged,
      activation
    }
  }

  async runUnitTests(
    objectName: string,
    connectionId: string,
    detailLevel: "summary" | "failures" | "all" = "failures"
  ) {
    const client = await this.connections.getClient(connectionId)
    const object = await resolveObject(client, objectName)
    const classes = await client.runUnitTests(object.uri)
    const results = classes.map(testClass => {
      const methods = testClass.testmethods.map(method => ({
        name: method["adtcore:name"],
        executionTime: method.executionTime,
        unit: method.unit,
        passed: method.alerts.filter(alert => alert.kind !== "warning").length === 0,
        alerts: method.alerts
      }))
      return {
        name: testClass["adtcore:name"],
        passed:
          testClass.alerts.filter(alert => alert.kind !== "warning").length === 0 &&
          methods.length > 0 &&
          methods.every(method => method.passed),
        alerts: testClass.alerts,
        methods
      }
    })
    const total = results.reduce((sum, item) => sum + item.methods.length, 0)
    const passed = results.reduce(
      (sum, item) => sum + item.methods.filter(method => method.passed).length,
      0
    )
    const selectedClasses = detailLevel === "all"
      ? results
      : detailLevel === "summary"
        ? []
        : results.flatMap(testClass => {
            const failedMethods = testClass.methods.filter(method => !method.passed)
            if (testClass.passed && failedMethods.length === 0) return []
            return [{ ...testClass, methods: failedMethods }]
          })
    return {
      connectionId: connectionId.toUpperCase(),
      object,
      detailLevel,
      total,
      passed,
      failed: total - passed,
      allPassed: total > 0 && passed === total,
      classCount: results.length,
      classes: selectedClasses
    }
  }

  async createTestInclude(className: string, connectionId: string, transport?: string) {
    const client = await this.connections.getClient(connectionId)
    const object = await resolveObject(client, className, "CLAS/OC")
    const structure = await client.getObjectStructure(object.uri)
    if (
      "includes" in structure &&
      structure.includes.some(item => item["class:includeType"] === "testclasses")
    ) {
      return {
        connectionId: connectionId.toUpperCase(),
        object,
        created: false,
        alreadyExists: true
      }
    }
    const packageName = requireWritablePackage(client, object.packageName)
    const normalizedTransport = requireTransport(packageName, transport)
    await client.createTestInclude(object.name, object.uri, normalizedTransport)
    return {
      connectionId: connectionId.toUpperCase(),
      object,
      created: true,
      alreadyExists: false,
      transport: normalizedTransport ?? null
    }
  }

  async manageTransportRequests(input: ManageTransportsInput) {
    const client = await this.connections.getClient(input.connectionId)
    if (input.action === "get_user_transports") {
      const user = (input.user || client.profile.username || "").toUpperCase()
      if (!user) throw new AppError("USER_REQUIRED", "No SAP user was provided")
      return {
        connectionId: input.connectionId.toUpperCase(),
        user,
        transports: await client.getUserTransports(user)
      }
    }
    if (input.action === "get_transport_details" || input.action === "get_transport_objects") {
      if (!input.transportNumber) {
        throw new AppError("TRANSPORT_NUMBER_REQUIRED", `${input.action} requires transportNumber`)
      }
      const transport = await client.getTransportDetails(input.transportNumber.toUpperCase())
      if (input.action === "get_transport_details") {
        const { objects: _objects, tasks, ...transportSummary } = transport
        return {
          connectionId: input.connectionId.toUpperCase(),
          transport: input.includeObjects
            ? transport
            : {
                ...transportSummary,
                objectCount: transportObjects(transport).length,
                taskCount: tasks.length
              }
        }
      }
      const page = pageItems(
        transportObjects(transport),
        input.startIndex,
        input.maxResults
      )
      return {
        connectionId: input.connectionId.toUpperCase(),
        transportNumber: transport["tm:number"],
        total: page.total,
        startIndex: page.startIndex,
        returned: page.returned,
        truncated: page.truncated,
        nextStartIndex: page.nextStartIndex,
        objects: page.items
      }
    }
    if (!input.transportNumbers || input.transportNumbers.length < 2) {
      throw new AppError(
        "TRANSPORT_NUMBERS_REQUIRED",
        "compare_transports requires at least two transport numbers"
      )
    }
    const transports = await Promise.all(
      input.transportNumbers.map(number => client.getTransportDetails(number.toUpperCase()))
    )
    const objectSets = transports.map(transport =>
      new Set(transportObjects(transport).map(transportObjectKey))
    )
    const allKeys = new Set(objectSets.flatMap(set => [...set]))
    const common = [...allKeys].filter(key => objectSets.every(set => set.has(key)))
    const commonPage = pageItems(common, input.startIndex, input.maxResults)
    return {
      connectionId: input.connectionId.toUpperCase(),
      transports: transports.map((transport, index) => ({
        number: transport["tm:number"],
        owner: transport["tm:owner"],
        description: transport["tm:desc"],
        objectCount: objectSets[index]?.size ?? 0
      })),
      commonObjectCount: common.length,
      startIndex: commonPage.startIndex,
      returned: commonPage.returned,
      truncated: commonPage.truncated,
      nextStartIndex: commonPage.nextStartIndex,
      commonObjects: commonPage.items,
      uniqueObjects: Object.fromEntries(
        transports.map((transport, index) => [
          transport["tm:number"],
          [...(objectSets[index] ?? [])].filter(key =>
            objectSets.every((set, otherIndex) => otherIndex === index || !set.has(key))
          ).slice(input.startIndex, input.startIndex + input.maxResults)
        ])
      )
    }
  }

  async getVersionHistory(input: VersionHistoryInput) {
    const client = await this.connections.getClient(input.connectionId)
    const object = await resolveObject(client, input.objectName, input.objectType)
    const revisions = await client.getRevisions(object.uri)
    const getRevision = (number: number | undefined) => {
      if (!number || number < 1 || number > revisions.length) {
        throw new AppError(
          "VERSION_NOT_FOUND",
          `Version ${number ?? ""} is outside the available range 1-${revisions.length}`
        )
      }
      return revisions[number - 1]!
    }
    if (input.action === "list_versions") {
      return {
        connectionId: input.connectionId.toUpperCase(),
        object,
        totalVersions: revisions.length,
        versions: revisions.slice(0, input.maxVersions).map((revision, index) => ({
          number: index + 1,
          ...revision
        }))
      }
    }
    if (input.action === "get_version_source") {
      const revision = getRevision(input.versionNumber)
      const source = await client.readSourceByUri(revision.uri)
      const lines = source.source.split(/\r?\n/)
      const startIndex = input.startLine - 1
      const selected = selectLines(lines, startIndex, input.lineCount)
      return {
        connectionId: input.connectionId.toUpperCase(),
        object,
        versionNumber: input.versionNumber,
        revision,
        startLine: input.startLine,
        endLine: selected.endIndex,
        totalLines: lines.length,
        truncated: selected.truncated,
        nextLine: selected.nextIndex === null ? null : selected.nextIndex + 1,
        source: selected.selected.join("\n")
      }
    }
    if (input.version1 === input.version2) {
      throw new AppError("SAME_VERSION", "Choose two different versions")
    }
    const leftRevision = getRevision(input.version1)
    const rightRevision = getRevision(input.version2)
    const [left, right] = await Promise.all([
      client.readSourceByUri(leftRevision.uri),
      client.readSourceByUri(rightRevision.uri)
    ])
    const leftLines = left.source.split(/\r?\n/)
    const rightLines = right.source.split(/\r?\n/)
    const leftSet = new Set(leftLines)
    const rightSet = new Set(rightLines)
    const added = leftLines.filter(line => !rightSet.has(line))
    const removed = rightLines.filter(line => !leftSet.has(line))
    const addedPage = pageItems(added, input.startIndex, input.maxResults)
    const removedPage = pageItems(removed, input.startIndex, input.maxResults)
    return {
      connectionId: input.connectionId.toUpperCase(),
      object,
      versions: {
        left: { number: input.version1, revision: leftRevision },
        right: { number: input.version2, revision: rightRevision }
      },
      addedCount: added.length,
      removedCount: removed.length,
      startIndex: input.startIndex,
      returned: Math.max(addedPage.returned, removedPage.returned),
      truncated: addedPage.truncated || removedPage.truncated,
      nextStartIndex:
        addedPage.nextStartIndex ?? removedPage.nextStartIndex,
      added: addedPage.items,
      removed: removedPage.items
    }
  }

  async downloadAbap(input: DownloadInput) {
    let client: SapClient
    let object: SapObjectReference
    if (input.source.startsWith("adt://") || input.source.startsWith("/sap/bc/adt/")) {
      const location = parseAdtLocation(input.source, input.connectionId)
      client = await this.connections.getClient(location.connectionId)
      const objectUri = objectUriFromSourceUri(location.path)
      const structure = await client.getObjectStructure(objectUri)
      const candidates = await client.searchObjects(
        structure.metaData["adtcore:name"],
        structure.metaData["adtcore:type"],
        50
      )
      object = candidates.find(candidate =>
        candidate.uri.replace(/\/+$/, "") === objectUri.replace(/\/+$/, "")
      ) ?? {
        name: structure.metaData["adtcore:name"],
        type: structure.metaData["adtcore:type"],
        uri: objectUri
      }
    } else {
      if (!input.connectionId) {
        throw new AppError(
          "CONNECTION_REQUIRED",
          "Bare object downloads require connectionId"
        )
      }
      client = await this.connections.getClient(input.connectionId)
      object = await resolveObject(client, input.source, input.objectType)
    }

    const targetDirectory = input.target.startsWith("file://")
      ? fileURLToPath(input.target)
      : input.target
    if (!isAbsolute(targetDirectory)) {
      throw new AppError("TARGET_NOT_ABSOLUTE", "Download target must be an absolute folder")
    }
    await mkdir(targetDirectory, { recursive: true })

    const candidates = object.type === "DEVC/K"
      ? (await client.getNodeContents("DEVC/K", object.name)).nodes.map(node => ({
          name: node.OBJECT_NAME,
          type: node.OBJECT_TYPE,
          uri: node.OBJECT_URI
        }))
      : [object]
    const unique = [...new Map(
      candidates
        .filter(candidate => candidate.uri.startsWith("/sap/bc/adt/"))
        .map(candidate => [candidate.uri, candidate])
    ).values()]
    const extensions: Record<string, string> = {
      CLAS: "clas.abap",
      INTF: "intf.abap",
      PROG: "prog.abap",
      FUGR: "fugr.abap",
      FUNC: "func.abap",
      DDLS: "ddls.asddls",
      DCLS: "dcls.asdcls",
      BDEF: "bdef.asbdef"
    }
    const downloaded: string[] = []
    const skipped: string[] = []
    const failed: Array<{ uri: string; error: string }> = []
    for (const candidate of unique) {
      try {
        const source = await client.readSourceByUri(candidate.uri)
        const baseType = candidate.type.replace(/\/.*$/, "").toUpperCase()
        const extension = extensions[baseType] ?? `${baseType.toLowerCase()}.abap`
        const safeName = candidate.name.replace(/[\\/:*?"<>|]/g, "_")
        const outputPath = join(targetDirectory, `${safeName}.${extension}`)
        if (!input.overwrite) {
          try {
            await stat(outputPath)
            skipped.push(outputPath)
            continue
          } catch {
            // Missing target is expected.
          }
        }
        await writeFile(outputPath, source.source, "utf8")
        downloaded.push(outputPath)
      } catch (error) {
        failed.push({
          uri: candidate.uri,
          error: error instanceof Error ? error.message : String(error)
        })
      }
    }
    const manifestPath = join(
      targetDirectory,
      `.sap-abap-download-manifest-${randomUUID()}.json`
    )
    await writeFile(manifestPath, JSON.stringify({
      connectionId: client.profile.id,
      source: object,
      downloaded,
      skippedFiles: skipped,
      failures: failed
    }), "utf8")
    const previewLimit = 20
    return {
      connectionId: client.profile.id,
      source: object,
      target: targetDirectory,
      files: downloaded.length,
      skipped: skipped.length,
      failed: failed.length,
      manifestPath,
      fileListsComplete: input.includeFileList || unique.length <= previewLimit,
      downloaded: input.includeFileList ? downloaded : downloaded.slice(0, previewLimit),
      skippedFiles: input.includeFileList ? skipped : skipped.slice(0, previewLimit),
      failures: input.includeFileList ? failed : failed.slice(0, previewLimit)
    }
  }

  async manageDebugSession(
    connectionId: string,
    action: "start" | "stop" | "status",
    debugUser?: string,
    terminalMode = false
  ) {
    const client = await this.connections.getClient(connectionId)
    const status = action === "start"
      ? await client.startDebugSession(debugUser, terminalMode)
      : action === "stop"
        ? await client.stopDebugSession()
        : client.getDebugStatus()
    return { connectionId: connectionId.toUpperCase(), ...status }
  }

  async manageDebugBreakpoint(input: {
    connectionId: string
    filePath: string
    lineNumbers: number[]
    condition?: string
    action: "set" | "remove"
  }) {
    const location = parseAdtLocation(input.filePath, input.connectionId)
    const client = await this.connections.getClient(location.connectionId)
    const results = await client.setDebugBreakpoints(
      location.path,
      input.lineNumbers,
      input.condition,
      input.action === "remove"
    )
    return {
      connectionId: location.connectionId,
      filePath: input.filePath,
      action: input.action,
      requestedLines: input.lineNumbers,
      results
    }
  }

  async debugStep(input: {
    connectionId: string
    stepType: "continue" | "stepInto" | "stepOver" | "stepReturn" | "jumpToLine"
    threadId: number
    targetLine?: number
  }) {
    const client = await this.connections.getClient(input.connectionId)
    const result = await client.debugStep(input.stepType, input.targetLine)
    return {
      connectionId: input.connectionId.toUpperCase(),
      threadId: input.threadId,
      stepType: input.stepType,
      ...result
    }
  }

  async getDebugStack(connectionId: string, threadId: number) {
    const client = await this.connections.getClient(connectionId)
    const stack = await client.getDebugStack()
    return {
      connectionId: connectionId.toUpperCase(),
      threadId,
      isRfc: stack.isRfc,
      serverName: stack.serverName,
      frames: stack.stack.map((frame, index) => ({
        frameId: threadId * 1_000_000_000_000 + index,
        ...frame
      }))
    }
  }

  async getDebugVariables(input: DebugVariableInput) {
    const client = await this.connections.getClient(input.connectionId)
    const result = await client.getDebugVariables(
      input.frameId,
      input.variableName,
      input.expression
    )
    let variables = result.children?.variables ?? result.variables
    if (input.filter) {
      const term = input.filter.toLowerCase()
      variables = variables.filter(variable =>
        `${variable.NAME} ${String(variable.VALUE ?? "")}`.toLowerCase().includes(term)
      )
    }
    if (input.filterPattern) {
      const expression = wildcardRegex(input.filterPattern)
      variables = variables.filter(variable => expression.test(variable.NAME))
    }
    if (input.scopeName && result.children) {
      const scope = result.children.hierarchies.find(item =>
        (item.CHILD_NAME || item.CHILD_ID).toUpperCase() === input.scopeName?.toUpperCase()
      )
      if (scope) {
        variables = variables.filter(variable =>
          variable.ID === scope.CHILD_ID || variable.ID.startsWith(`${scope.CHILD_ID}-`)
        )
      }
    }
    variables = variables.slice(input.rowStart, input.rowStart + Math.min(
      input.rowCount,
      input.maxVariables
    ))
    return {
      connectionId: input.connectionId.toUpperCase(),
      frameId: input.frameId,
      variableName: input.variableName ?? null,
      expression: input.expression ?? null,
      filter: input.filter ?? null,
      variables,
      scopes: result.children?.hierarchies ?? [],
      expandStructures: input.expandStructures,
      expandTables: input.expandTables
    }
  }

  async getDebugStatus(connectionId: string) {
    const client = await this.connections.getClient(connectionId)
    return { connectionId: connectionId.toUpperCase(), ...client.getDebugStatus() }
  }

  async analyzeDumps(input: DumpAnalysisInput) {
    const client = await this.connections.getClient(input.connectionId)
    const feed = await client.getDumps()
    if (input.action === "list_dumps") {
      const page = pageItems(feed.dumps, input.startIndex, input.maxResults)
      return {
        connectionId: input.connectionId.toUpperCase(),
        total: feed.dumps.length,
        startIndex: page.startIndex,
        returned: page.returned,
        truncated: page.truncated,
        nextStartIndex: page.nextStartIndex,
        dumps: page.items.map(dump => ({
          id: dump.id,
          author: dump.author ?? null,
          type: dump.type,
          categories: dump.categories,
          links: dump.links,
          contentLength: dump.text.length
        }))
      }
    }
    if (!input.dumpId) {
      throw new AppError("DUMP_ID_REQUIRED", "analyze_dump requires dumpId")
    }
    const dump = feed.dumps.find(item => item.id === input.dumpId)
    if (!dump) throw new AppError("DUMP_NOT_FOUND", `Dump ${input.dumpId} was not found`)
    const plainText = stripHtml(dump.text)
    const contentStart = input.includeFullContent
      ? 0
      : Math.min(input.contentOffset, plainText.length)
    const contentEnd = input.includeFullContent
      ? plainText.length
      : Math.min(plainText.length, contentStart + input.contentLength)
    return {
      connectionId: input.connectionId.toUpperCase(),
      dump: {
        id: dump.id,
        author: dump.author ?? null,
        type: dump.type,
        categories: dump.categories,
        links: dump.links,
        contentLength: dump.text.length,
        plainText: plainText.slice(contentStart, contentEnd),
        totalPlainTextCharacters: plainText.length,
        contentOffset: contentStart,
        returnedCharacters: contentEnd - contentStart,
        truncated: contentEnd < plainText.length,
        nextContentOffset: contentEnd < plainText.length ? contentEnd : null,
        ...(input.includeFullContent ? { html: dump.text } : {})
      }
    }
  }

  async analyzeTraces(input: TraceAnalysisInput) {
    const client = await this.connections.getClient(input.connectionId)
    if (input.action === "list_configurations") {
      const configurations = await client.getTraceConfigurations()
      const page = pageItems(
        configurations.requests,
        input.startIndex,
        input.maxResults
      )
      return {
        connectionId: input.connectionId.toUpperCase(),
        total: page.total,
        startIndex: page.startIndex,
        returned: page.returned,
        truncated: page.truncated,
        nextStartIndex: page.nextStartIndex,
        configurations: page.items
      }
    }
    const runs = await client.getTraceRuns()
    const sortedRuns = [...runs.runs].sort(
      (left, right) => right.published.getTime() - left.published.getTime()
    )
    if (input.action === "list_runs") {
      const page = pageItems(sortedRuns, input.startIndex, input.maxResults)
      return {
        connectionId: input.connectionId.toUpperCase(),
        total: page.total,
        startIndex: page.startIndex,
        returned: page.returned,
        truncated: page.truncated,
        nextStartIndex: page.nextStartIndex,
        runs: page.items
      }
    }
    if (!input.traceId) {
      throw new AppError("TRACE_ID_REQUIRED", `${input.action} requires traceId`)
    }
    const run = runs.runs.find(item => item.id === input.traceId)
    if (!run) throw new AppError("TRACE_NOT_FOUND", `Trace ${input.traceId} was not found`)
    if (input.action === "analyze_run") {
      const data = run.extendedData
      const total = data.runtimeABAP + data.runtimeDatabase + data.runtimeSystem || 1
      return {
        connectionId: input.connectionId.toUpperCase(),
        run: input.includeDetails ? run : {
          id: run.id,
          title: run.title,
          author: run.author,
          published: run.published,
          objectName: data.objectName,
          host: data.host,
          state: data.state,
          isAggregated: data.isAggregated
        },
        performance: {
          runtime: data.runtime,
          abap: { time: data.runtimeABAP, percentage: Math.round(data.runtimeABAP / total * 100) },
          database: {
            time: data.runtimeDatabase,
            percentage: Math.round(data.runtimeDatabase / total * 100)
          },
          system: {
            time: data.runtimeSystem,
            percentage: Math.round(data.runtimeSystem / total * 100)
          }
        }
      }
    }
    if (input.action === "get_hitlist" || run.extendedData.isAggregated) {
      const hitlist = await client.getTraceHitList(input.traceId)
      const sorted = [...hitlist.entries]
        .sort((left, right) => right.traceEventNetTime.time - left.traceEventNetTime.time)
      const page = pageItems(sorted, input.startIndex, input.maxResults)
      return {
        connectionId: input.connectionId.toUpperCase(),
        traceId: input.traceId,
        mode: "hitlist",
        total: page.total,
        startIndex: page.startIndex,
        returned: page.returned,
        truncated: page.truncated,
        nextStartIndex: page.nextStartIndex,
        entries: page.items
      }
    }
    const statements = await client.getTraceStatements(input.traceId)
    const sortedStatements = [...statements.statements]
      .sort((left, right) => right.traceEventNetTime.time - left.traceEventNetTime.time)
    const page = pageItems(sortedStatements, input.startIndex, input.maxResults)
    return {
      connectionId: input.connectionId.toUpperCase(),
      traceId: input.traceId,
      mode: "statements",
      total: page.total,
      startIndex: page.startIndex,
      returned: page.returned,
      truncated: page.truncated,
      nextStartIndex: page.nextStartIndex,
      statements: page.items
    }
  }

  async exportAdtDiscovery(
    connectionId: string,
    mode: "summary" | "full" | "file" = "summary"
  ) {
    const client = await this.connections.getClient(connectionId)
    const discovery = await client.getAdtDiscovery()
    const base = {
      connectionId: connectionId.toUpperCase(),
      mode,
      exportedAt: new Date().toISOString(),
      summary: {
        services: discovery.discovery.length,
        coreCollections: discovery.core.length,
        templateLinks: discovery.discovery.reduce(
          (sum, service) => sum + service.collection.reduce(
            (collectionSum, collection) => collectionSum + collection.templateLinks.length,
            0
          ),
          0
        )
      }
    }
    if (mode === "summary") return base
    if (mode === "full") return { ...base, ...discovery }
    const outputDirectory = await mkdtemp(join(tmpdir(), "sap-abap-mcp-discovery-"))
    const outputPath = join(outputDirectory, `${connectionId.toLowerCase()}-adt-discovery.json`)
    await writeFile(outputPath, JSON.stringify({ ...base, ...discovery }), "utf8")
    return { ...base, outputPath }
  }

  async manageHeartbeat(input: HeartbeatInput) {
    const presentTask = (task: HeartbeatTask) => input.includeDetails
      ? task
      : {
          id: task.id,
          description: task.description,
          enabled: task.enabled,
          checks: task.checks,
          createdAt: task.createdAt,
          updatedAt: task.updatedAt,
          priority: task.priority,
          category: task.category,
          connectionId: task.connectionId ?? null,
          removeWhenDone: task.removeWhenDone,
          reminderOnly: task.reminderOnly
        }
    switch (input.action) {
      case "status":
        return this.heartbeatStatus()
      case "start":
        if (!this.heartbeatActive) {
          this.heartbeatActive = true
          this.heartbeatTimer = setInterval(() => {
            void this.runHeartbeat("scheduled").catch(error => {
              this.heartbeatHistory.push({
                timestamp: new Date().toISOString(),
                reason: "scheduled",
                error: error instanceof Error ? error.message : String(error)
              })
            })
          }, 15 * 60 * 1000)
          this.heartbeatTimer.unref()
        }
        return this.heartbeatStatus()
      case "stop":
        this.heartbeatActive = false
        if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
        this.heartbeatTimer = undefined
        return this.heartbeatStatus()
      case "trigger":
        {
          const entry = await this.runHeartbeat(input.reason || "manual")
          const page = pageItems(entry.results, input.startIndex, input.maxResults)
          return {
            ...entry,
            total: page.total,
            startIndex: page.startIndex,
            returned: page.returned,
            truncated: page.truncated,
            nextStartIndex: page.nextStartIndex,
            results: page.items
          }
        }
      case "history":
        {
          const history = this.heartbeatHistory
            .slice(-(input.count ?? this.heartbeatHistory.length))
            .reverse()
            .map(entry => input.includeDetails ? entry : {
              timestamp: entry.timestamp,
              reason: entry.reason,
              taskCount: entry.taskCount,
              ...(entry.error ? { error: entry.error } : {})
            })
          const page = pageItems(history, input.startIndex, input.maxResults)
          return { ...page, entries: page.items, items: undefined }
        }
      case "list_tasks": {
        const page = pageItems(
          [...this.heartbeatTasks.values()].map(presentTask),
          input.startIndex,
          input.maxResults
        )
        return { ...page, tasks: page.items, items: undefined }
      }
      case "get_watchlist": {
        const page = pageItems(
          this.heartbeatWatchlist().map(presentTask),
          input.startIndex,
          input.maxResults
        )
        return { ...page, tasks: page.items, items: undefined }
      }
      case "add_task": {
        if (!input.description) {
          throw new AppError("HEARTBEAT_DESCRIPTION_REQUIRED", "add_task requires description")
        }
        if (input.sampleQuery) validateReadOnlySql(input.sampleQuery)
        const now = new Date().toISOString()
        const task: HeartbeatTask = {
          id: randomUUID(),
          description: input.description,
          enabled: true,
          checks: 0,
          createdAt: now,
          updatedAt: now,
          removeWhenDone: input.removeWhenDone ?? input.reminderOnly ?? false,
          checkInstructions: input.checkInstructions ?? [],
          priority: input.priority ?? "medium",
          category: input.reminderOnly ? "reminder" : input.category ?? "custom",
          reminderOnly: input.reminderOnly ?? false,
          modifiedBy: input.modifiedBy ?? "user",
          ...(input.condition ? { condition: input.condition } : {}),
          ...(input.connectionId ? { connectionId: input.connectionId.toUpperCase() } : {}),
          ...(input.sampleQuery ? { sampleQuery: input.sampleQuery } : {}),
          ...(input.alertThreshold !== undefined ? { alertThreshold: input.alertThreshold } : {}),
          ...(input.cooldownMinutes !== undefined
            ? { cooldownMinutes: input.cooldownMinutes }
            : {}),
          ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
          ...(input.maxChecks !== undefined ? { maxChecks: input.maxChecks } : {}),
          ...(input.startAt ? { startAt: input.startAt } : {})
        }
        this.heartbeatTasks.set(task.id, task)
        return { task }
      }
      case "remove_task": {
        const task = this.findHeartbeatTask(input.taskId)
        this.heartbeatTasks.delete(task.id)
        return { removed: task }
      }
      case "enable_task":
      case "disable_task": {
        const task = this.findHeartbeatTask(input.taskId)
        task.enabled = input.action === "enable_task"
        task.updatedAt = new Date().toISOString()
        return { task }
      }
      case "update_task": {
        const task = this.findHeartbeatTask(input.taskId)
        if (input.sampleQuery) validateReadOnlySql(input.sampleQuery)
        task.updatedAt = new Date().toISOString()
        if (input.description !== undefined) task.description = input.description
        if (input.condition !== undefined) task.condition = input.condition
        if (input.connectionId !== undefined) task.connectionId = input.connectionId.toUpperCase()
        if (input.removeWhenDone !== undefined) task.removeWhenDone = input.removeWhenDone
        if (input.sampleQuery !== undefined) task.sampleQuery = input.sampleQuery
        if (input.checkInstructions !== undefined) task.checkInstructions = input.checkInstructions
        if (input.priority !== undefined) task.priority = input.priority
        if (input.category !== undefined) task.category = input.category
        if (input.alertThreshold !== undefined) task.alertThreshold = input.alertThreshold
        if (input.cooldownMinutes !== undefined) task.cooldownMinutes = input.cooldownMinutes
        if (input.expiresAt !== undefined) task.expiresAt = input.expiresAt
        if (input.maxChecks !== undefined) task.maxChecks = input.maxChecks
        if (input.startAt !== undefined) task.startAt = input.startAt
        if (input.reminderOnly !== undefined) {
          task.reminderOnly = input.reminderOnly
          if (input.reminderOnly) {
            task.category = "reminder"
            task.removeWhenDone = true
          }
        }
        if (input.result !== undefined) task.lastResult = input.result
        if (input.lastNotifiedAt !== undefined) task.lastNotifiedAt = input.lastNotifiedAt
        if (input.lastNotifiedFindings !== undefined) {
          task.lastNotifiedFindings = input.lastNotifiedFindings
        }
        if (input.modifiedBy) task.modifiedBy = input.modifiedBy
        return { task }
      }
    }
  }

  private heartbeatStatus() {
    return {
      active: this.heartbeatActive,
      intervalMinutes: 15,
      taskCount: this.heartbeatTasks.size,
      enabledTasks: [...this.heartbeatTasks.values()].filter(task => task.enabled).length,
      lastRun: this.heartbeatLastRun ?? null,
      historyCount: this.heartbeatHistory.length
    }
  }

  private heartbeatWatchlist(): HeartbeatTask[] {
    const now = Date.now()
    const priority = { high: 0, medium: 1, low: 2 }
    return [...this.heartbeatTasks.values()]
      .filter(task =>
        task.enabled &&
        (!task.startAt || Date.parse(task.startAt) <= now) &&
        (!task.expiresAt || Date.parse(task.expiresAt) > now)
      )
      .sort((left, right) => priority[left.priority] - priority[right.priority])
  }

  private findHeartbeatTask(identifier?: string): HeartbeatTask {
    const normalized = identifier?.trim().toLowerCase()
    const task = [...this.heartbeatTasks.values()].find(item =>
      item.id.toLowerCase() === normalized || item.description.toLowerCase() === normalized
    )
    if (!task) throw new AppError("HEARTBEAT_TASK_NOT_FOUND", `Task ${identifier ?? ""} not found`)
    return task
  }

  private async runHeartbeat(reason: string) {
    const timestamp = new Date().toISOString()
    const results: Array<Record<string, unknown>> = []
    for (const task of this.heartbeatWatchlist()) {
      task.checks += 1
      task.updatedAt = timestamp
      let result: Record<string, unknown>
      if (task.reminderOnly) {
        result = { status: "reminder_due", description: task.description }
      } else if (task.connectionId) {
        const client = await this.connections.getClient(task.connectionId)
        const ping = await client.ping()
        if (task.sampleQuery) {
          validateReadOnlySql(task.sampleQuery)
          const query = await client.runQuery(task.sampleQuery, 1000)
          const count = query.values.length
          result = {
            status:
              task.alertThreshold !== undefined && count > task.alertThreshold
                ? "threshold_exceeded"
                : "checked",
            count,
            alertThreshold: task.alertThreshold ?? null,
            ping
          }
        } else {
          result = { status: "connected", ping, condition: task.condition ?? null }
        }
      } else {
        result = {
          status: "agent_evaluation_required",
          condition: task.condition ?? null,
          instructions: task.checkInstructions
        }
      }
      const status = String(result.status)
      const conditionMet = status === "reminder_due" || status === "threshold_exceeded"
      const cooldownActive = conditionMet && task.cooldownMinutes !== undefined && task.lastNotifiedAt
        ? Date.parse(task.lastNotifiedAt) + task.cooldownMinutes * 60_000 > Date.parse(timestamp)
        : false
      if (cooldownActive) {
        result.notificationSuppressed = true
        result.suppressionReason = "cooldown"
      } else if (conditionMet) {
        task.lastNotifiedAt = timestamp
      }
      task.lastResult = JSON.stringify(result)
      results.push({ taskId: task.id, description: task.description, ...result })
      if (
        task.reminderOnly ||
        (task.removeWhenDone && conditionMet && !cooldownActive) ||
        (task.maxChecks !== undefined && task.checks >= task.maxChecks)
      ) {
        this.heartbeatTasks.delete(task.id)
      }
    }
    this.heartbeatLastRun = timestamp
    const entry = { timestamp, reason, taskCount: results.length, results }
    this.heartbeatHistory.push(entry)
    if (this.heartbeatHistory.length > 500) this.heartbeatHistory.shift()
    return entry
  }

  async replaceStringInObject(input: ReplaceStringInput) {
    const target = await this.resolveEditableTarget(input)
    const packageName = requireWritablePackage(target.client, target.object.packageName)
    const transport = requireTransport(packageName, input.transport)
    const updated = replaceExactlyOnce(target.source, input.oldString, input.newString)
    const result = await target.client.replaceSource(
      target.object.name,
      target.objectUri,
      target.sourceUri,
      target.source,
      updated,
      transport,
      input.activate,
      target.mainProgram
    )
    const diagnostics = result.diagnostics.slice(0, 100)
    return {
      connectionId: target.connectionId,
      object: target.object,
      sourceUri: target.sourceUri,
      workspaceUri: `adt://${target.connectionId.toLowerCase()}${target.sourceUri}`,
      changed: true,
      oldLineCount: input.oldString.split(/\r?\n/).length,
      newLineCount: input.newString.split(/\r?\n/).length,
      diagnosticCount: result.diagnostics.length,
      diagnosticsTruncated: diagnostics.length < result.diagnostics.length,
      diagnostics,
      activation: result.activation ?? null,
      activationSkipped: result.activationSkipped
    }
  }

  async getAbapDiagnostics(input: DiagnosticsInput) {
    const target = await this.resolveEditableTarget(input)
    const diagnostics = await target.client.checkSyntax(
      target.objectUri,
      target.sourceUri,
      target.source,
      target.mainProgram
    )
    const filtered = input.severity
      ? diagnostics.filter(item => item.severity.toUpperCase() === input.severity?.toUpperCase())
      : diagnostics
    const page = pageItems(filtered, input.startIndex, input.maxResults)
    return {
      connectionId: target.connectionId,
      object: target.object,
      sourceUri: target.sourceUri,
      count: diagnostics.length,
      errorCount: diagnostics.filter(item => /^(E|ERROR)$/i.test(item.severity.trim())).length,
      filteredCount: filtered.length,
      startIndex: page.startIndex,
      returned: page.returned,
      truncated: page.truncated,
      nextStartIndex: page.nextStartIndex,
      diagnostics: page.items
    }
  }

  async activateObject(input: ActivateObjectInput) {
    const target = await this.resolveEditableTarget({
      fileUri: input.url,
      ...(input.connectionId ? { connectionId: input.connectionId } : {})
    })
    requireWritablePackage(target.client, target.object.packageName)
    const result = await target.client.activateObject(
      target.object.name,
      target.objectUri,
      target.mainProgram
    )
    return {
      connectionId: target.connectionId,
      object: target.object,
      success: result.success,
      messages: result.messages,
      inactive: result.inactive
    }
  }

  async searchObjects(input: SearchObjectsInput) {
    const client = await this.connections.getClient(input.connectionId)
    const results: SapObjectReference[] = []
    const seen = new Set<string>()

    for (const type of input.types) {
      const remaining = input.maxResults - results.length
      if (remaining <= 0) break
      const matches = await client.searchObjects(input.pattern, type, remaining)
      for (const match of matches) {
        if (seen.has(match.uri)) continue
        seen.add(match.uri)
        results.push(match)
        if (results.length >= input.maxResults) break
      }
    }

    return {
      connectionId: input.connectionId.toUpperCase(),
      pattern: input.pattern,
      count: results.length,
      objects: results
    }
  }

  async getObjectLines(input: GetObjectLinesInput) {
    const client = await this.connections.getClient(input.connectionId)
    const object = await resolveObject(client, input.objectName, input.objectType)

    const result = await client.readObject(object)
    if (input.methodName) {
      const method = extractAbapMethod(result.source, input.methodName)
      if (!method) {
        throw new AppError(
          "METHOD_NOT_FOUND",
          `Method ${input.methodName} was not found in ${object.name}`
        )
      }
      const methodLines = method.code.split(/\r?\n/)
      const selected = selectLines(methodLines, 0, methodLines.length)
      return {
        connectionId: input.connectionId.toUpperCase(),
        object,
        sourceUri: result.sourceUri,
        methodName: input.methodName,
        startLine: method.startLine,
        endLine: method.startLine + selected.selected.length - 1,
        methodEndLine: method.endLine,
        truncated: selected.truncated,
        nextLine: selected.nextIndex === null ? null : method.startLine + selected.nextIndex,
        code: selected.selected.join("\n")
      }
    }

    const lines = result.source.split(/\r?\n/)
    const startIndex = Math.max(0, input.startLine - 1)
    const selected = selectLines(lines, startIndex, input.lineCount)
    return {
      connectionId: input.connectionId.toUpperCase(),
      object,
      sourceUri: result.sourceUri,
      startLine: startIndex + 1,
      endLine: selected.endIndex,
      totalLines: lines.length,
      truncated: selected.truncated,
      nextLine: selected.nextIndex === null ? null : selected.nextIndex + 1,
      code: selected.selected.join("\n")
    }
  }

  async searchObjectLines(input: SearchObjectLinesInput) {
    const client = await this.connections.getClient(input.connectionId)
    let matcher: (line: string) => boolean
    if (input.isRegexp) {
      let expression: RegExp
      try {
        expression = new RegExp(input.searchTerm, "i")
      } catch (error) {
        throw new AppError("INVALID_REGEX", `Invalid regular expression: ${input.searchTerm}`, {
          cause: error instanceof Error ? error.message : String(error)
        })
      }
      matcher = line => expression.test(line)
    } else {
      const term = input.searchTerm.toUpperCase()
      matcher = line => line.toUpperCase().includes(term)
    }

    const objects = await client.searchObjects(input.objectName, undefined, input.maxObjects)
    const selected = input.objectName.includes("*") || input.objectName.includes("?")
      ? objects.slice(0, input.maxObjects)
      : objects
          .filter(item => item.name.toUpperCase() === input.objectName.toUpperCase())
          .slice(0, input.maxObjects)

    if (selected.length === 0) {
      throw new AppError("OBJECT_NOT_FOUND", `No ABAP objects matched ${input.objectName}`)
    }

    const results: Array<{
      object: SapObjectReference
      sourceUri: string
      totalLines: number
      matches: Array<{
        lineNumber: number
        line: string
        context: Array<{ lineNumber: number; text: string; isMatch: boolean }>
      }>
      enhancementMatches: Array<{
        enhancementName: string
        enhancementType: string
        elementUri: string
        lineNumber: number
        line: string
        context: Array<{ lineNumber: number; text: string; isMatch: boolean }>
      }>
    }> = []
    let matchCount = 0
    let returnedMatches = 0
    for (const object of selected) {
      const source = await client.readObject(object)
      const lines = source.source.split(/\r?\n/)
      const matches = []
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index] ?? ""
        if (!matcher(line)) continue
        const matchIndex = matchCount
        matchCount += 1
        if (matchIndex < input.startIndex || returnedMatches >= input.maxResults) continue
        const start = Math.max(0, index - input.contextLines)
        const end = Math.min(lines.length - 1, index + input.contextLines)
        matches.push({
          lineNumber: index + 1,
          line,
          context: lines.slice(start, end + 1).map((text, contextIndex) => ({
            lineNumber: start + contextIndex + 1,
            text,
            isMatch: start + contextIndex === index
          }))
        })
        returnedMatches += 1
      }

      const enhancementMatches: Array<{
        enhancementName: string
        enhancementType: string
        elementUri: string
        lineNumber: number
        line: string
        context: Array<{ lineNumber: number; text: string; isMatch: boolean }>
      }> = []
      try {
        const enhancements = await client.getObjectEnhancements(source.sourceUri, true)
        for (const implementation of enhancements.implementations) {
          for (const element of implementation.elements) {
            if (!element.source) continue
            const enhancementLines = element.source.split(/\r?\n/)
            for (let index = 0; index < enhancementLines.length; index += 1) {
              const line = enhancementLines[index] ?? ""
              if (!matcher(line)) continue
              const matchIndex = matchCount
              matchCount += 1
              if (matchIndex < input.startIndex || returnedMatches >= input.maxResults) continue
              const start = Math.max(0, index - input.contextLines)
              const end = Math.min(enhancementLines.length - 1, index + input.contextLines)
              enhancementMatches.push({
                enhancementName: implementation.name,
                enhancementType: implementation.type,
                elementUri: element.uri,
                lineNumber: index + 1,
                line,
                context: enhancementLines.slice(start, end + 1).map((text, contextIndex) => ({
                  lineNumber: start + contextIndex + 1,
                  text,
                  isMatch: start + contextIndex === index
                }))
              })
              returnedMatches += 1
            }
          }
        }
      } catch {
        // Enhancement discovery is not available on every backend release.
      }

      if (matches.length > 0 || enhancementMatches.length > 0) {
        results.push({
          object,
          sourceUri: source.sourceUri,
          totalLines: lines.length,
          matches,
          enhancementMatches
        })
      }
    }
    const nextStartIndex = input.startIndex + returnedMatches < matchCount
      ? input.startIndex + returnedMatches
      : null

    return {
      connectionId: input.connectionId.toUpperCase(),
      objectPattern: input.objectName,
      searchTerm: input.searchTerm,
      isRegexp: input.isRegexp,
      objectsSearched: selected.length,
      matchCount,
      startIndex: input.startIndex,
      returnedMatches,
      truncated: nextStartIndex !== null,
      nextStartIndex,
      results
    }
  }

  async getObjectInfo(input: GetObjectInfoInput) {
    const client = await this.connections.getClient(input.connectionId)
    const object = await resolveObject(client, input.objectName, input.objectType)
    const source = await client.readObject(object)
    const structure = await client.getObjectStructure(object.uri)
    const structureRecord = structure as unknown as Record<string, unknown>
    return {
      connectionId: input.connectionId.toUpperCase(),
      object,
      sourceUri: source.sourceUri,
      totalLines: source.source.split(/\r?\n/).length,
      structureSummary: {
        metaData: structure.metaData,
        sections: Object.keys(structureRecord),
        linkCount: Array.isArray(structureRecord.links) ? structureRecord.links.length : 0,
        includeCount: Array.isArray(structureRecord.includes)
          ? structureRecord.includes.length
          : 0
      },
      ...(input.includeStructure ? { structure } : {})
    }
  }

  async getBatchLines(input: GetBatchLinesInput) {
    const requestedLines = input.requests.reduce((sum, request) => sum + request.lineCount, 0)
    if (requestedLines > MAX_BATCH_LINES) {
      throw new AppError(
        "BATCH_LINE_LIMIT",
        `Batch requests are limited to ${MAX_BATCH_LINES} total lines; split this request`,
        { requestedLines, maxLines: MAX_BATCH_LINES }
      )
    }
    const results = await Promise.allSettled(
      input.requests.map(request =>
        this.getObjectLines({
          objectName: request.objectName,
          startLine: request.startLine + 1,
          lineCount: request.lineCount,
          connectionId: input.connectionId
        })
      )
    )
    return {
      connectionId: input.connectionId.toUpperCase(),
      count: results.length,
      requestedLines,
      results: results.map((result, index) =>
        result.status === "fulfilled"
          ? { request: input.requests[index], ok: true, result: result.value }
          : {
              request: input.requests[index],
              ok: false,
              error: result.reason instanceof Error ? result.reason.message : String(result.reason)
            }
      )
    }
  }

  async getObjectByUri(input: GetObjectByUriInput) {
    const client = await this.connections.getClient(input.connectionId)
    const result = await client.readSourceByUri(input.uri)
    const lines = result.source.split(/\r?\n/)
    const selected = selectLines(lines, input.startLine, input.lineCount)
    return {
      connectionId: input.connectionId.toUpperCase(),
      requestedUri: input.uri,
      sourceUri: result.sourceUri,
      startLine: input.startLine,
      endLine: selected.endIndex,
      totalLines: lines.length,
      truncated: selected.truncated,
      nextLine: selected.nextIndex,
      code: selected.selected.join("\n")
    }
  }

  async findWhereUsed(input: FindWhereUsedInput) {
    const client = await this.connections.getClient(input.connectionId)
    const object = await resolveObject(client, input.objectName, input.objectType)
    let sourceUri = object.uri
    let source = ""
    try {
      const objectSource = await client.readObject(object)
      sourceUri = objectSource.sourceUri
      source = objectSource.source
    } catch (error) {
      if (input.searchTerm) throw error
    }

    let line = input.line ?? 1
    let character = input.character ?? 0
    if (input.searchTerm) {
      const sourceLines = source.split(/\r?\n/)
      const term = input.searchTerm.toUpperCase()
      const foundLine = sourceLines.findIndex(item => item.toUpperCase().includes(term))
      if (foundLine < 0) {
        throw new AppError(
          "SEARCH_TERM_NOT_FOUND",
          `Search term ${input.searchTerm} was not found in ${object.name}`
        )
      }
      line = foundLine + 1
      character = (sourceLines[foundLine] ?? "").toUpperCase().indexOf(term)
    }

    const references = await client.findUsageReferences(sourceUri, line, character)
    let filtered = references
    if (input.filter?.objectNamePattern) {
      const expression = wildcardRegex(input.filter.objectNamePattern)
      filtered = filtered.filter(reference => expression.test(referenceName(reference)))
    }
    if (input.filter?.objectTypes?.length) {
      const allowedTypes = new Set(input.filter.objectTypes.map(item => item.toUpperCase()))
      filtered = filtered.filter(reference =>
        reference["adtcore:type"]
          ? allowedTypes.has(reference["adtcore:type"].toUpperCase())
          : false
      )
    }
    if (input.filter?.excludeSystemObjects) {
      filtered = filtered.filter(reference => /^[ZY]/i.test(referenceName(reference)))
    }

    const page = filtered.slice(input.startIndex, input.startIndex + input.maxResults)
    const snippets = input.includeSnippets && page.length > 0
      ? await client.getUsageReferenceSnippets(page)
      : []

    return {
      connectionId: input.connectionId.toUpperCase(),
      object,
      sourceUri,
      position: { line, character },
      searchTerm: input.searchTerm ?? null,
      totalReferences: references.length,
      filteredReferences: filtered.length,
      startIndex: input.startIndex,
      count: page.length,
      nextStartIndex:
        input.startIndex + page.length < filtered.length
          ? input.startIndex + page.length
          : null,
      references: page,
      snippets
    }
  }

  async getObjectWorkspaceUri(input: ObjectLocatorInput & { objectType: string }) {
    const client = await this.connections.getClient(input.connectionId)
    const object = await resolveObject(client, input.objectName, input.objectType)
    const source = await client.readObject(object)
    return {
      connectionId: input.connectionId.toUpperCase(),
      object,
      sourceUri: source.sourceUri,
      workspaceUri: `adt://${input.connectionId.toLowerCase()}${source.sourceUri}`
    }
  }

  async openObject(input: ObjectLocatorInput) {
    const client = await this.connections.getClient(input.connectionId)
    const object = await resolveObject(client, input.objectName, input.objectType)
    const source = await client.readObject(object)
    return {
      connectionId: input.connectionId.toUpperCase(),
      mode: "headless",
      object,
      sourceUri: source.sourceUri,
      workspaceUri: `adt://${input.connectionId.toLowerCase()}${source.sourceUri}`,
      totalLines: source.source.split(/\r?\n/).length,
      message: "Object resolved. Use get_abap_object_lines or get_object_by_uri to read source."
    }
  }

  async getObjectUrl(input: ObjectLocatorInput) {
    const client = await this.connections.getClient(input.connectionId)
    const objectType = input.objectType ?? "PROG/P"
    const normalizedType = objectType.toUpperCase()
    const transaction = normalizedType === "CLAS/OC" || normalizedType === "CLAS/I"
      ? { code: "SE24", field: "SEOCLASS-CLSNAME", okCode: "WB_EXEC" }
      : normalizedType === "FUGR/FF" || normalizedType === "FUNC/FM"
        ? { code: "SE37", field: "RS38L-NAME", okCode: "WB_EXEC" }
        : { code: "SE38", field: "RS38M-PROGRAMM", okCode: "STRT" }
    const baseUrl = client.profile.url.replace(/\/sap\/bc\/adt.*$/i, "")
    const command = `*${transaction.code} ${transaction.field}=${input.objectName};DYNP_OKCODE=${transaction.okCode}`
    const url = new URL(`${baseUrl}/sap/bc/gui/sap/its/webgui`)
    url.searchParams.set("~transaction", command)
    url.searchParams.set("sap-client", client.profile.client)
    url.searchParams.set("sap-language", client.profile.language)
    url.searchParams.set("saml2", "disabled")
    return {
      connectionId: input.connectionId.toUpperCase(),
      objectName: input.objectName,
      objectType,
      transaction: transaction.code,
      url: url.toString()
    }
  }
}

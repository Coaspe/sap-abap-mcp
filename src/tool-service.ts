import { createHash, randomUUID } from "node:crypto"
import { execFile } from "node:child_process"
import { mkdir, mkdtemp, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, isAbsolute, join } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { createTwoFilesPatch, diffLines } from "diff"
import { AppError } from "./errors.js"
import {
  isCreatableTypeId,
  isGroupType,
  objectPath,
  parentTypeId,
  servicePreviewUrl,
  type NewBindingOptions,
  type NewObjectOptions,
  type NewPackageOptions,
  type NonGroupTypeIds,
  type PackageTypes,
  type Delta,
  type FixProposal,
  type GenericRefactoring,
  type GitRepo,
  type GitStaging,
  type RapGeneratorContent,
  type RapGeneratorId,
  type RenameRefactoring,
  type TextElement,
  type TextElementCategory,
  type TransportObject,
  type TransportRequest,
  type ValidateOptions,
  type ValidationResult,
  type UsageReference
} from "abap-adt-api"
import type { ChangePackageRefactoring } from "abap-adt-api/build/api/refactor.js"
import {
  abapGitCredentialKey,
  decodeAbapGitCredentials,
  normalizeAbapGitRepositoryUrl,
  type AbapGitCredentials
} from "./abapgit-credentials.js"
import { registerBdefType } from "./bdef-creator.js"
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
import {
  normalizeCapabilityError,
  SapCapabilityRegistry,
  type SapCapabilityCategory,
  type SapCapabilityStatus
} from "./sap-capabilities.js"
import type { SapClient } from "./sap-client.js"
import type { SapNewObjectOptions, SapObjectReference } from "./sap-client.js"
import type { SecretStore } from "./secret-store.js"
import {
  createTestDocumentation as createTestDocumentationArtifact,
  type TestDocumentationInput
} from "./test-documentation.js"

type BindingCategory = "0" | "1"
const execFileAsync = promisify(execFile)

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
  source?: string
  activate?: boolean
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

export type ActivateObjectInput =
  | { url: string; connectionId?: string }
  | { urls: string[]; connectionId?: string }

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
    | "create_transport"
    | "release_transport"
    | "delete_transport"
    | "set_owner"
    | "add_user"
    | "list_system_users"
    | "resolve_object"
  connectionId: string
  user?: string
  targetUser?: string
  transportNumber?: string
  transportNumbers?: string[]
  description?: string
  packageName?: string
  transportLayer?: string
  pgmid?: string
  objectType?: string
  objectName?: string
  ignoreLocks?: boolean
  ignoreAtc?: boolean
  confirmation?: string
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

export interface InspectCodeInput extends WorkspaceFileInput {
  action:
    | "completion"
    | "definition"
    | "quick_fixes"
    | "format_preview"
    | "completion_element"
    | "documentation"
    | "type_hierarchy"
    | "components"
  line: number
  column: number
  endColumn?: number
  implementation: boolean
  superTypes?: boolean
  startIndex: number
  maxResults: number
}

export interface PreviewRefactoringInput extends WorkspaceFileInput {
  action:
    | "preview_rename"
    | "preview_change_package"
    | "preview_extract_method"
    | "preview_quick_fix"
    | "preview_format"
    | "preview_delete"
  line?: number
  column?: number
  endColumn?: number
  endLine?: number
  newName?: string
  newPackage?: string
  methodName?: string
  proposalIndex?: number
  transport?: string
  activate: boolean
}

export interface ExecuteRefactoringInput {
  action: "execute"
  planId: string
  confirmation: string
}

export type RefactorCodeInput = PreviewRefactoringInput | ExecuteRefactoringInput

export interface ManageAbapGitInput {
  action:
    | "list_repositories"
    | "remote_info"
    | "create_repository"
    | "pull_repository"
    | "unlink_repository"
    | "stage_repository"
    | "push_repository"
    | "check_repository"
    | "switch_branch"
  connectionId: string
  repositoryId?: string
  repositoryUrl?: string
  packageName?: string
  branch?: string
  createBranch?: boolean
  transport?: string
  stageId?: string
  objectKeys?: string[]
  stageAll?: boolean
  comment?: string
  authorName?: string
  authorEmail?: string
  committerName?: string
  committerEmail?: string
  confirmation?: string
  startIndex: number
  maxResults: number
}

export interface ManageRapInput {
  action:
    | "availability"
    | "get_schema"
    | "get_defaults"
    | "validate"
    | "preview"
    | "generate"
    | "publish"
    | "unpublish"
    | "service_details"
  connectionId: string
  generatorId?: RapGeneratorId
  referenceObjectName?: string
  referenceObjectType?: string
  packageName?: string
  content?: RapGeneratorContent
  transport?: string
  serviceBindingName?: string
  serviceName?: string
  serviceVersion?: string
  confirmation?: string
  contentOffset: number
  contentLength: number
}

export interface ManageVersionsInput {
  action: "list_inactive" | "get_inactive_source" | "preview_restore" | "execute_restore"
  connectionId: string
  objectName?: string
  objectType?: string
  versionNumber?: number
  planId?: string
  confirmation?: string
  transport?: string
  activate: boolean
  startIndex: number
  maxResults: number
  startLine: number
  lineCount: number
}

export interface CompareSystemsInput {
  objectName: string
  objectType?: string
  sourceConnectionId: string
  targetConnectionId: string
  ignoreWhitespace: boolean
  maxPatchLines: number
}

export interface DependencyGraphInput extends ObjectLocatorInput {
  line?: number
  column?: number
  depth: number
  maxNodes: number
  customOnly: boolean
}

export interface RunSapTransactionInput {
  connectionId: string
  transactionCode: string
  parameters?: Record<string, string>
  mode: "url" | "launch"
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

type RefactorPlanKind =
  | "rename"
  | "change_package"
  | "extract_method"
  | "quick_fix"
  | "format"
  | "delete"
  | "restore_version"

interface RefactorPlan {
  id: string
  kind: RefactorPlanKind
  connectionId: string
  confirmation: string
  fingerprint: string
  expiresAt: number
  request: Record<string, unknown>
  payload: unknown
}

export type RunAbapApplicationInput =
  | { action: "repl_health"; connectionId: string }
  | { action: "preview_class"; connectionId: string; className: string }
  | { action: "preview_snippet"; connectionId: string; code: string }
  | { action: "execute"; connectionId: string; planId: string; confirmation: string }

type ExecutionPlanPayload =
  | { kind: "class"; className: string; code?: never }
  | { kind: "snippet"; code: string; className?: never }

type ExecutionPlan = {
  id: string
  connectionId: string
  confirmation: string
  expiresAt: number
} & ExecutionPlanPayload

type ExecutionPlanDraft = {
  connectionId: string
  confirmation: string
} & ExecutionPlanPayload

interface GitStageState {
  connectionId: string
  repository: GitRepo
  staging: GitStaging
  expiresAt: number
}

const INLINE_TEXT_BYTE_LIMIT = 96 * 1024
const DIFF_PATCH_BYTE_LIMIT = 64 * 1024
const MAX_BATCH_LINES = 5000
const PLAN_TTL_MS = 10 * 60 * 1000
const MAX_CACHED_PLANS = 100

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

function payloadFingerprint(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex")
}

function sourceOffset(source: string, line: number, column: number): number {
  const lines = source.split(/\r?\n/)
  if (line < 1 || line > lines.length) {
    throw new AppError("SOURCE_RANGE_INVALID", `Line ${line} is outside 1-${lines.length}`)
  }
  const current = lines[line - 1] ?? ""
  if (column < 0 || column > current.length) {
    throw new AppError(
      "SOURCE_RANGE_INVALID",
      `Column ${column} is outside line ${line} length ${current.length}`
    )
  }
  let offset = 0
  for (let index = 0; index < line - 1; index += 1) {
    offset += (lines[index] ?? "").length + 1
  }
  return offset + column
}

function applyDeltas(source: string, deltas: Delta[]): string {
  const ordered = [...deltas].sort((left, right) => {
    const line = right.range.start.line - left.range.start.line
    return line || right.range.start.column - left.range.start.column
  })
  let result = source.replace(/\r\n/g, "\n")
  let previousStart = Number.POSITIVE_INFINITY
  for (const delta of ordered) {
    const start = sourceOffset(result, delta.range.start.line, delta.range.start.column)
    const end = sourceOffset(result, delta.range.end.line, delta.range.end.column)
    if (start > end || end > previousStart) {
      throw new AppError("SOURCE_EDIT_OVERLAP", "SAP quick-fix returned overlapping edits")
    }
    result = `${result.slice(0, start)}${delta.content}${result.slice(end)}`
    previousStart = start
  }
  return source.includes("\r\n") ? result.replace(/(?<!\r)\n/g, "\r\n") : result
}

function summarizeDiff(before: string, after: string, maxPatchLines = 200) {
  const changes = diffLines(before, after)
  const addedLines = changes
    .filter(change => change.added)
    .reduce((sum, change) => sum + (change.count ?? 0), 0)
  const removedLines = changes
    .filter(change => change.removed)
    .reduce((sum, change) => sum + (change.count ?? 0), 0)
  const patchLines = createTwoFilesPatch("before", "after", before, after, "", "", {
    context: 3
  }).split("\n")
  const selectedLines: string[] = []
  let selectedBytes = 0
  for (const line of patchLines.slice(0, maxPatchLines)) {
    const lineBytes = Buffer.byteLength(line, "utf8") + (selectedLines.length > 0 ? 1 : 0)
    if (selectedBytes + lineBytes > DIFF_PATCH_BYTE_LIMIT) break
    selectedLines.push(line)
    selectedBytes += lineBytes
  }
  return {
    changed: before !== after,
    addedLines,
    removedLines,
    patchTruncated: selectedLines.length < patchLines.length,
    patch: selectedLines.join("\n")
  }
}

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

function boundInlineText(value: string, byteLimit = INLINE_TEXT_BYTE_LIMIT) {
  const originalBytes = Buffer.byteLength(value, "utf8")
  if (originalBytes <= byteLimit) {
    return { content: value, originalBytes, returnedBytes: originalBytes, truncated: false }
  }
  let content = ""
  let returnedBytes = 0
  for (const character of value) {
    const characterBytes = Buffer.byteLength(character, "utf8")
    if (returnedBytes + characterBytes > byteLimit) break
    content += character
    returnedBytes += characterBytes
  }
  return {
    content,
    originalBytes,
    returnedBytes,
    truncated: true
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

function dependencyReference(reference: UsageReference) {
  const parts = reference.objectIdentifier?.split(";")
  if (!parts || parts[0] !== "ABAPFullName" || !parts[1]) return undefined
  let type = reference["adtcore:type"] || ""
  if (!type) {
    type = reference.uri.includes("/oo/classes/") ? "CLAS/OC" : "UNKNOWN"
  }
  let name = parts[1]
  let parentClass: string | undefined
  if (type === "PROG/I" && parts[2]) name = parts[2]
  if ((type === "FUGR/FF" || type === "CLAS/OM") && reference["adtcore:name"]) {
    name = reference["adtcore:name"]
    if (type === "CLAS/OM") parentClass = parts[1].split("=")[0]
  }
  const packageName = reference.packageRef?.["adtcore:name"] || ""
  return {
    id: `${name}::${type}`,
    name,
    type,
    description: reference["adtcore:description"] || null,
    responsible: reference["adtcore:responsible"] || null,
    packageName: packageName || null,
    custom: /^[ZY]/i.test(parentClass || name) || /^[ZY]/i.test(packageName),
    canExpand: reference.canHaveChildren,
    uri: reference.uri,
    parentUri: reference.parentUri,
    objectIdentifier: reference.objectIdentifier,
    usageInformation: reference.usageInformation || null
  }
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

function canonicalActivationUri(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined
  const candidate = value.trim()
  let encodedPath: string

  if (candidate.startsWith("/")) {
    if (candidate.startsWith("//")) return undefined
    encodedPath = candidate.replace(/[?#].*$/, "")
  } else {
    let parsed: URL
    try {
      parsed = new URL(candidate)
    } catch {
      return undefined
    }
    if (!["adt:", "http:", "https:"].includes(parsed.protocol)) return undefined
    if (!parsed.hostname) return undefined
    encodedPath = parsed.pathname
  }

  let pathname: string
  try {
    pathname = decodeURIComponent(encodedPath)
  } catch {
    return undefined
  }
  if (!/^\/sap\/bc\/adt\//i.test(pathname)) return undefined
  const normalized = objectUriFromSourceUri(pathname).replace(/\/+$/, "")
  if (normalized.toLowerCase() === "/sap/bc/adt") return undefined
  return normalized.toLowerCase()
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
  if (
    client.profile.allowedPackages.length > 0 &&
    !client.profile.allowedPackages.includes(normalizedPackage)
  ) {
    throw new AppError(
      "PACKAGE_NOT_ALLOWED",
      `Package ${normalizedPackage} is not in the ${client.profile.id} write allowlist`,
      { allowedPackages: client.profile.allowedPackages }
    )
  }
  return normalizedPackage
}

function requireNonProduction(client: SapClient): void {
  if (client.profile.environment === "production") {
    throw new AppError(
      "PRODUCTION_WRITE_BLOCKED",
      `Writes are disabled for production profile ${client.profile.id}`
    )
  }
}

function requireExecutableProfile(client: SapClient): void {
  if (client.profile.environment === "production") {
    throw new AppError(
      "SAP_CAPABILITY_UNAVAILABLE",
      "ABAP execution is disabled on production",
      { reason: "PRODUCTION_EXECUTION_BLOCKED", profileId: client.profile.id }
    )
  }
}

function requireExactConfirmation(actual: string | undefined, expected: string): void {
  if (actual !== expected) {
    throw new AppError("CONFIRMATION_MISMATCH", `Confirmation must exactly equal ${expected}`)
  }
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
  private readonly capabilities = new SapCapabilityRegistry()
  private readonly dataViews = new Map<string, DataViewState>()
  private readonly refactorPlans = new Map<string, RefactorPlan>()
  private readonly executionPlans = new Map<string, ExecutionPlan>()
  private readonly gitStages = new Map<string, GitStageState>()
  private readonly heartbeatTasks = new Map<string, HeartbeatTask>()
  private readonly heartbeatHistory: Array<Record<string, unknown>> = []
  private heartbeatActive = false
  private heartbeatTimer: NodeJS.Timeout | undefined
  private heartbeatLastRun?: string

  constructor(
    private readonly connections: ConnectionProvider,
    private readonly secrets?: SecretStore
  ) {
    registerBdefType()
  }

  private async executeCapability<T>(
    connectionId: string,
    capabilityId: string,
    endpoint: string,
    operation: () => Promise<T>
  ): Promise<{ result: T; capabilityStatusAtExecution: SapCapabilityStatus }> {
    const capabilityStatusAtExecution = this.capabilities.status(connectionId, capabilityId)
    if (capabilityStatusAtExecution === "unsupported") {
      throw new AppError("SAP_CAPABILITY_UNAVAILABLE", `Capability ${capabilityId} is unavailable`, {
        capabilityId,
        endpoint
      })
    }
    try {
      const result = await operation()
      this.capabilities.observeSuccess(connectionId, capabilityId, endpoint)
      return { result, capabilityStatusAtExecution }
    } catch (error) {
      this.capabilities.observeFailure(connectionId, capabilityId, error, endpoint)
      throw normalizeCapabilityError(error, capabilityId, endpoint)
    }
  }

  private cachePlan(plan: Omit<RefactorPlan, "id" | "expiresAt">): RefactorPlan {
    const now = Date.now()
    for (const [id, cached] of this.refactorPlans) {
      if (cached.expiresAt <= now) this.refactorPlans.delete(id)
    }
    while (this.refactorPlans.size >= MAX_CACHED_PLANS) {
      const oldest = this.refactorPlans.keys().next().value as string | undefined
      if (!oldest) break
      this.refactorPlans.delete(oldest)
    }
    const cached: RefactorPlan = {
      ...plan,
      id: randomUUID(),
      expiresAt: now + PLAN_TTL_MS
    }
    this.refactorPlans.set(cached.id, cached)
    return cached
  }

  private takePlan(planId: string, confirmation: string): RefactorPlan {
    const plan = this.refactorPlans.get(planId)
    if (!plan || plan.expiresAt <= Date.now()) {
      this.refactorPlans.delete(planId)
      throw new AppError("PLAN_EXPIRED", "The preview plan is missing or expired; create a new preview")
    }
    if (confirmation !== plan.confirmation) {
      throw new AppError(
        "CONFIRMATION_MISMATCH",
        `Confirmation must exactly equal ${plan.confirmation}`
      )
    }
    this.refactorPlans.delete(planId)
    return plan
  }

  private cacheExecutionPlan(plan: ExecutionPlanDraft): ExecutionPlan {
    const now = Date.now()
    for (const [id, cached] of this.executionPlans) {
      if (cached.expiresAt <= now) this.executionPlans.delete(id)
    }
    while (this.executionPlans.size >= MAX_CACHED_PLANS) {
      const oldest = this.executionPlans.keys().next().value as string | undefined
      if (!oldest) break
      this.executionPlans.delete(oldest)
    }
    const cached: ExecutionPlan = {
      ...plan,
      id: randomUUID(),
      expiresAt: now + PLAN_TTL_MS
    }
    this.executionPlans.set(cached.id, cached)
    return cached
  }

  private takeExecutionPlan(
    planId: string,
    connectionId: string,
    confirmation: string
  ): ExecutionPlan {
    const plan = this.executionPlans.get(planId)
    if (!plan || plan.expiresAt <= Date.now()) {
      this.executionPlans.delete(planId)
      throw new AppError(
        "SAP_VALIDATION_FAILED",
        "The execution plan is missing or expired; create a new preview",
        { reason: "EXECUTION_PLAN_EXPIRED" }
      )
    }
    if (connectionId !== plan.connectionId) {
      throw new AppError(
        "SAP_VALIDATION_FAILED",
        "The execution plan belongs to a different SAP connection",
        { reason: "EXECUTION_PLAN_CONNECTION_MISMATCH" }
      )
    }
    if (confirmation !== plan.confirmation) {
      throw new AppError(
        "SAP_VALIDATION_FAILED",
        `Confirmation must exactly equal ${plan.confirmation}`,
        { reason: "CONFIRMATION_MISMATCH" }
      )
    }
    this.executionPlans.delete(planId)
    return plan
  }

  private async gitCredentials(
    connectionId: string,
    repositoryUrl: string
  ): Promise<AbapGitCredentials | undefined> {
    const normalizedUrl = normalizeAbapGitRepositoryUrl(repositoryUrl)
    const stored = await this.secrets?.get(abapGitCredentialKey(connectionId))
    return stored
      ? decodeAbapGitCredentials(stored).find(item => item.repositoryUrl === normalizedUrl)
      : undefined
  }

  private async findGitRepository(client: SapClient, repositoryId?: string): Promise<GitRepo> {
    if (!repositoryId?.trim()) {
      throw new AppError("GIT_REPOSITORY_REQUIRED", "This action requires repositoryId")
    }
    const normalized = repositoryId.trim()
    const repositories = await client.listGitRepositories()
    const matches = repositories.filter(repository => repository.key === normalized)
    if (matches.length !== 1) {
      throw new AppError(
        "GIT_REPOSITORY_NOT_FOUND",
        `abapGit repository ${normalized} was not found`
      )
    }
    return matches[0]!
  }

  private async resolveEditableTarget(
    input: WorkspaceFileInput,
    existingClient?: SapClient
  ): Promise<EditableTarget> {
    const location = parseAdtLocation(input.fileUri, input.connectionId)
    const client = existingClient ?? await this.connections.getClient(location.connectionId)
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

  private async packageForReference(
    client: SapClient,
    reference: { name: string; type: string; uri: string; parentUri?: string }
  ): Promise<string> {
    const candidates = await client.searchObjects(reference.name, reference.type, 50)
    const exact = candidates.find(candidate =>
      candidate.uri.replace(/\/+$/, "") === objectUriFromSourceUri(reference.uri).replace(/\/+$/, "")
    ) ?? candidates.find(candidate =>
      candidate.name.toUpperCase() === reference.name.toUpperCase() &&
      sameType(candidate.type, reference.type)
    )
    if (exact?.packageName) return exact.packageName.toUpperCase()

    if (reference.parentUri) {
      try {
        const structure = await client.getObjectStructure(reference.parentUri)
        const parentCandidates = await client.searchObjects(
          structure.metaData["adtcore:name"],
          structure.metaData["adtcore:type"],
          50
        )
        const parent = parentCandidates.find(candidate =>
          candidate.uri.replace(/\/+$/, "") === reference.parentUri?.replace(/\/+$/, "")
        )
        if (parent?.packageName) return parent.packageName.toUpperCase()
      } catch {
        // The caller rejects unknown packages below.
      }
    }
    throw new AppError(
      "AFFECTED_PACKAGE_UNKNOWN",
      `Could not determine the package for affected object ${reference.type} ${reference.name}`,
      { uri: reference.uri }
    )
  }

  private async enforceAffectedPackages(
    client: SapClient,
    references: Array<{ name: string; type: string; uri: string; parentUri?: string }>
  ): Promise<string[]> {
    const packages = new Set<string>()
    for (const reference of references) {
      packages.add(requireWritablePackage(client, await this.packageForReference(client, reference)))
    }
    return [...packages]
  }

  private planResponse(
    plan: RefactorPlan,
    summary: Record<string, unknown>
  ): Record<string, unknown> {
    return {
      planId: plan.id,
      operation: plan.kind,
      confirmation: plan.confirmation,
      expiresAt: new Date(plan.expiresAt).toISOString(),
      ...summary
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

  async getSapCapabilities(
    connectionId: string,
    category?: SapCapabilityCategory,
    includeEvidence = true
  ) {
    const client = await this.connections.getClient(connectionId)
    const discovery = await client.getAdtDiscovery()
    const capabilities = this.capabilities.list(connectionId, JSON.stringify(discovery), category)
    return {
      connectionId: connectionId.trim().toUpperCase(),
      generatedAt: new Date().toISOString(),
      adapterVersion: "abap-adt-api@8.4.1",
      systemMetadata: await client.getSystemInfo(false),
      capabilities: includeEvidence
        ? capabilities
        : capabilities.map(({ evidence, ...item }) => item)
    }
  }

  async inspectCode(input: InspectCodeInput) {
    const target = await this.resolveEditableTarget(input)
    if (input.action === "completion") {
      const proposals = await target.client.getCodeCompletions(
        target.sourceUri,
        target.source,
        input.line,
        input.column
      )
      const unique = [...new Map(proposals.map(proposal => [proposal.IDENTIFIER, proposal])).values()]
      const page = pageItems(unique, input.startIndex, input.maxResults)
      return {
        connectionId: target.connectionId,
        object: target.object,
        line: input.line,
        column: input.column,
        total: page.total,
        startIndex: page.startIndex,
        returned: page.returned,
        truncated: page.truncated,
        nextStartIndex: page.nextStartIndex,
        proposals: page.items.map(proposal => ({
          identifier: proposal.IDENTIFIER,
          kind: proposal.KIND,
          prefixLength: proposal.PREFIXLENGTH,
          grade: proposal.GRADE,
          inherited: Boolean(proposal.IS_INHERITED)
        }))
      }
    }

    if (input.action === "completion_element") {
      const { result, capabilityStatusAtExecution } = await this.executeCapability(
        target.connectionId,
        "semantic.completion_element",
        "/sap/bc/adt/abapsource/codecompletion/elementinfo",
        () => target.client.getCodeCompletionElement(
          target.sourceUri,
          target.source,
          input.line,
          input.column
        )
      )
      if (typeof result === "string") {
        return {
          connectionId: target.connectionId,
          object: target.object,
          format: "legacy",
          ...boundInlineText(result),
          capabilityStatusAtExecution
        }
      }
      const doc = boundInlineText(result.doc)
      const components = pageItems(result.components, input.startIndex, input.maxResults)
      return {
        connectionId: target.connectionId,
        object: target.object,
        format: "structured",
        element: {
          name: result.name,
          type: result.type,
          href: result.href,
          doc: doc.content,
          docTruncated: doc.truncated,
          componentTotal: components.total,
          componentStartIndex: components.startIndex,
          componentsReturned: components.returned,
          componentsTruncated: components.truncated,
          componentsNextStartIndex: components.nextStartIndex,
          components: components.items
        },
        capabilityStatusAtExecution
      }
    }

    if (input.action === "documentation") {
      const { result, capabilityStatusAtExecution } = await this.executeCapability(
        target.connectionId,
        "semantic.documentation",
        "/sap/bc/adt/docu/abap/langu",
        () => target.client.getAbapDocumentation(
          target.objectUri,
          target.source,
          input.line,
          input.column
        )
      )
      return {
        connectionId: target.connectionId,
        object: target.object,
        format: /<[^>]+>/.test(result) ? "html" : "text",
        ...boundInlineText(result),
        capabilityStatusAtExecution
      }
    }

    if (input.action === "type_hierarchy") {
      const { result, capabilityStatusAtExecution } = await this.executeCapability(
        target.connectionId,
        "semantic.type_hierarchy",
        "/sap/bc/adt/abapsource/typehierarchy",
        () => target.client.getTypeHierarchy(
          target.sourceUri,
          target.source,
          input.line,
          input.column,
          input.superTypes ?? false
        )
      )
      const page = pageItems(result, input.startIndex, input.maxResults)
      return {
        connectionId: target.connectionId,
        object: target.object,
        total: page.total,
        startIndex: page.startIndex,
        returned: page.returned,
        truncated: page.truncated,
        nextStartIndex: page.nextStartIndex,
        nodes: page.items,
        capabilityStatusAtExecution
      }
    }

    if (input.action === "components") {
      const objectType = target.object.type.toUpperCase()
      const baseObjectType = objectType.split("/")[0]
      if (baseObjectType !== "CLAS" && baseObjectType !== "INTF") {
        throw new AppError(
          "SAP_VALIDATION_FAILED",
          "components requires a class or interface",
          { reason: "COMPONENTS_OBJECT_TYPE_INVALID", objectType: target.object.type }
        )
      }
      const { result, capabilityStatusAtExecution } = await this.executeCapability(
        target.connectionId,
        "semantic.components",
        `${target.objectUri}/objectstructure`,
        () => target.client.getClassComponents(target.objectUri)
      )
      const page = pageItems(result.components, input.startIndex, input.maxResults)
      return {
        connectionId: target.connectionId,
        object: target.object,
        root: {
          name: result["adtcore:name"],
          type: result["adtcore:type"],
          visibility: result.visibility
        },
        total: page.total,
        startIndex: page.startIndex,
        returned: page.returned,
        truncated: page.truncated,
        nextStartIndex: page.nextStartIndex,
        components: page.items.map(item => ({
          name: item["adtcore:name"],
          type: item["adtcore:type"],
          visibility: item.visibility,
          constant: item.constant ?? false,
          readOnly: item.readOnly ?? false,
          childCount: item.components.length
        })),
        capabilityStatusAtExecution
      }
    }

    if (input.action === "definition") {
      const definition = await target.client.findDefinition(
        target.sourceUri,
        target.source,
        input.line,
        input.column,
        input.endColumn ?? input.column,
        input.implementation,
        target.mainProgram
      )
      return {
        connectionId: target.connectionId,
        object: target.object,
        definition: definition.url
          ? {
              uri: definition.url,
              workspaceUri: `adt://${target.connectionId.toLowerCase()}${definition.url}`,
              line: definition.line,
              column: definition.column
            }
          : null
      }
    }

    if (input.action === "quick_fixes") {
      const proposals = (await target.client.getQuickFixes(
        target.sourceUri,
        target.source,
        input.line,
        input.column
      )).filter(proposal => !proposal["adtcore:type"].match(/dialog|rename_quickfix/i))
      const page = pageItems(proposals, input.startIndex, input.maxResults)
      return {
        connectionId: target.connectionId,
        object: target.object,
        total: page.total,
        startIndex: page.startIndex,
        returned: page.returned,
        truncated: page.truncated,
        nextStartIndex: page.nextStartIndex,
        proposals: page.items.map((proposal, pageIndex) => ({
          proposalIndex: input.startIndex + pageIndex,
          name: proposal["adtcore:name"],
          type: proposal["adtcore:type"],
          description: proposal["adtcore:description"]
        }))
      }
    }

    const formatted = await target.client.formatSource(target.source)
    if (!formatted) throw new AppError("FORMATTER_EMPTY", "SAP formatter returned empty source")
    const ratio = Math.abs(formatted.length - target.source.length) / Math.max(formatted.length, 1)
    if (ratio > 0.2) {
      throw new AppError(
        "FORMATTER_SANITY_CHECK_FAILED",
        "SAP formatter changed source length by more than 20%; refusing the result"
      )
    }
    return {
      connectionId: target.connectionId,
      object: target.object,
      ...summarizeDiff(target.source, formatted)
    }
  }

  private async buildRefactorPreview(input: PreviewRefactoringInput): Promise<{
    kind: RefactorPlanKind
    connectionId: string
    confirmation: string
    fingerprint: string
    request: Record<string, unknown>
    payload: unknown
    summary: Record<string, unknown>
  }> {
    const target = await this.resolveEditableTarget(input)
    const sourcePackage = requireWritablePackage(target.client, target.object.packageName)
    const request = { ...input } as unknown as Record<string, unknown>

    if (input.action === "preview_rename") {
      if (input.line === undefined || input.column === undefined || !input.newName?.trim()) {
        throw new AppError("RENAME_INPUT_REQUIRED", "Rename preview requires line, column, and newName")
      }
      const transport = requireTransport(sourcePackage, input.transport)
      const proposal = await target.client.evaluateRename(
        target.sourceUri,
        input.line,
        input.column,
        input.endColumn ?? input.column
      )
      proposal.newName = input.newName.trim()
      proposal.ignoreSyntaxErrors = false
      const preview = await target.client.previewRename(proposal, transport)
      preview.ignoreSyntaxErrors = false
      if (preview.affectedObjects.length === 0) {
        throw new AppError("REFACTORING_EMPTY", "SAP rename preview returned no affected objects")
      }
      const packages = await this.enforceAffectedPackages(target.client, preview.affectedObjects)
      const confirmation = `${preview.oldName}->${preview.newName}`
      return {
        kind: "rename",
        connectionId: target.connectionId,
        confirmation,
        fingerprint: payloadFingerprint(preview),
        request,
        payload: preview,
        summary: {
          object: target.object,
          oldName: preview.oldName,
          newName: preview.newName,
          transport: preview.transport || null,
          affectedObjectCount: preview.affectedObjects.length,
          affectedPackages: packages,
          affectedObjects: preview.affectedObjects.slice(0, 50).map(item => ({
            name: item.name,
            type: item.type,
            uri: item.uri,
            editCount: item.textReplaceDeltas.length
          })),
          affectedObjectsTruncated: preview.affectedObjects.length > 50
        }
      }
    }

    if (input.action === "preview_change_package") {
      const newPackage = requireWritablePackage(target.client, input.newPackage)
      if (newPackage === sourcePackage) {
        throw new AppError("NO_PACKAGE_CHANGE", `Object is already in package ${newPackage}`)
      }
      const transport = requireTransport(sourcePackage === "$TMP" ? newPackage : sourcePackage, input.transport)
      const proposal: ChangePackageRefactoring = {
        oldPackage: sourcePackage,
        newPackage,
        transport: transport ?? "",
        ignoreSyntaxErrorsAllowed: false,
        ignoreSyntaxErrors: false,
        adtObjectUri: target.objectUri,
        affectedObjects: {
          uri: target.objectUri,
          type: target.object.type,
          name: target.object.name,
          oldPackage: sourcePackage,
          newPackage,
          parentUri: ""
        },
        userContent: ""
      }
      const preview = await target.client.previewPackageChange(proposal, transport)
      preview.ignoreSyntaxErrors = false
      const confirmation = `${sourcePackage}->${newPackage}`
      return {
        kind: "change_package",
        connectionId: target.connectionId,
        confirmation,
        fingerprint: payloadFingerprint(preview),
        request,
        payload: preview,
        summary: {
          object: target.object,
          oldPackage: sourcePackage,
          newPackage,
          transport: preview.transport || null,
          affectedObject: preview.affectedObjects
        }
      }
    }

    if (input.action === "preview_extract_method") {
      if (
        input.line === undefined ||
        input.column === undefined ||
        input.endLine === undefined ||
        input.endColumn === undefined ||
        !input.methodName?.trim()
      ) {
        throw new AppError(
          "EXTRACT_INPUT_REQUIRED",
          "Extract preview requires line, column, endLine, endColumn, and methodName"
        )
      }
      const transport = requireTransport(sourcePackage, input.transport)
      const proposal = await target.client.evaluateExtractMethod(target.sourceUri, {
        start: { line: input.line, column: input.column },
        end: { line: input.endLine, column: input.endColumn }
      })
      proposal.name = input.methodName.trim().toUpperCase()
      proposal.genericRefactoring.transport = transport ?? ""
      proposal.genericRefactoring.ignoreSyntaxErrors = false
      const preview = await target.client.previewExtractMethod(proposal)
      preview.ignoreSyntaxErrors = false
      if (preview.affectedObjects.length === 0) {
        throw new AppError("REFACTORING_EMPTY", "SAP extract-method preview returned no affected objects")
      }
      const packages = await this.enforceAffectedPackages(target.client, preview.affectedObjects)
      return {
        kind: "extract_method",
        connectionId: target.connectionId,
        confirmation: proposal.name,
        fingerprint: payloadFingerprint({ proposal, preview }),
        request,
        payload: { proposal, preview },
        summary: {
          object: target.object,
          methodName: proposal.name,
          transport: preview.transport || null,
          affectedObjectCount: preview.affectedObjects.length,
          affectedPackages: packages
        }
      }
    }

    if (input.action === "preview_quick_fix") {
      if (input.line === undefined || input.column === undefined || input.proposalIndex === undefined) {
        throw new AppError(
          "QUICK_FIX_INPUT_REQUIRED",
          "Quick-fix preview requires line, column, and proposalIndex"
        )
      }
      const transport = requireTransport(sourcePackage, input.transport)
      const proposals = (await target.client.getQuickFixes(
        target.sourceUri,
        target.source,
        input.line,
        input.column
      )).filter(proposal => !proposal["adtcore:type"].match(/dialog|rename_quickfix/i))
      const proposal = proposals[input.proposalIndex]
      if (!proposal) {
        throw new AppError(
          "QUICK_FIX_NOT_FOUND",
          `proposalIndex ${input.proposalIndex} is outside 0-${Math.max(proposals.length - 1, 0)}`
        )
      }
      const edits = await target.client.getQuickFixEdits(proposal, target.source)
      if (edits.length === 0) throw new AppError("QUICK_FIX_EMPTY", "SAP quick-fix returned no edits")
      const packages = await this.enforceAffectedPackages(
        target.client,
        edits.map(edit => ({ name: edit.name, type: edit.type, uri: edit.uri }))
      )
      const payload = { proposal, edits, transport: transport ?? "", activate: input.activate }
      return {
        kind: "quick_fix",
        connectionId: target.connectionId,
        confirmation: proposal["adtcore:name"],
        fingerprint: payloadFingerprint(payload),
        request,
        payload,
        summary: {
          object: target.object,
          proposal: proposal["adtcore:name"],
          editCount: edits.length,
          affectedObjectCount: new Set(edits.map(edit => edit.uri)).size,
          affectedPackages: packages,
          activate: input.activate
        }
      }
    }

    if (input.action === "preview_format") {
      const transport = requireTransport(sourcePackage, input.transport)
      const formatted = await target.client.formatSource(target.source)
      if (!formatted) throw new AppError("FORMATTER_EMPTY", "SAP formatter returned empty source")
      const ratio = Math.abs(formatted.length - target.source.length) / Math.max(formatted.length, 1)
      if (ratio > 0.2) {
        throw new AppError(
          "FORMATTER_SANITY_CHECK_FAILED",
          "SAP formatter changed source length by more than 20%; refusing the result"
        )
      }
      if (formatted === target.source) throw new AppError("NO_SOURCE_CHANGE", "Source is already formatted")
      const payload = {
        object: target.object,
        objectUri: target.objectUri,
        sourceUri: target.sourceUri,
        before: target.source,
        after: formatted,
        transport: transport ?? "",
        activate: input.activate,
        mainProgram: target.mainProgram
      }
      return {
        kind: "format",
        connectionId: target.connectionId,
        confirmation: target.object.name,
        fingerprint: payloadFingerprint(payload),
        request,
        payload,
        summary: {
          object: target.object,
          ...summarizeDiff(target.source, formatted),
          activate: input.activate
        }
      }
    }

    const transport = requireTransport(sourcePackage, input.transport)
    if (!isCreatableTypeId(target.object.type)) {
      throw new AppError(
        "OBJECT_DELETE_UNSUPPORTED",
        `ADT only allows deletion of creatable object types; ${target.object.type} is not eligible`
      )
    }
    const state = await target.client.getObjectFingerprint(target.objectUri)
    const payload = {
      object: target.object,
      objectUri: target.objectUri,
      state,
      transport: transport ?? ""
    }
    return {
      kind: "delete",
      connectionId: target.connectionId,
      confirmation: target.object.name,
      fingerprint: payloadFingerprint(payload),
      request,
      payload,
      summary: {
        object: target.object,
        packageName: sourcePackage,
        transport: transport ?? null,
        state: {
          fingerprint: state.fingerprint,
          version: state.version,
          changedAt: state.changedAt
        }
      }
    }
  }

  async refactorCode(input: RefactorCodeInput) {
    if (input.action !== "execute") {
      const built = await this.buildRefactorPreview(input)
      const plan = this.cachePlan({
        kind: built.kind,
        connectionId: built.connectionId,
        confirmation: built.confirmation,
        fingerprint: built.fingerprint,
        request: built.request,
        payload: built.payload
      })
      return this.planResponse(plan, built.summary)
    }

    const plan = this.takePlan(input.planId, input.confirmation)
    if (plan.kind === "restore_version") {
      throw new AppError(
        "PLAN_TOOL_MISMATCH",
        "Restore plans must be executed through manage_abap_versions"
      )
    }
    const rebuilt = await this.buildRefactorPreview(plan.request as unknown as PreviewRefactoringInput)
    if (rebuilt.fingerprint !== plan.fingerprint) {
      throw new AppError(
        "REFACTORING_CHANGED",
        "SAP returned a different preview because source or repository state changed; review a new preview"
      )
    }
    const client = await this.connections.getClient(plan.connectionId)

    if (plan.kind === "rename") {
      const result = await client.executeRename(rebuilt.payload as RenameRefactoring)
      return { executed: true, operation: plan.kind, result }
    }
    if (plan.kind === "change_package") {
      const result = await client.executePackageChange(rebuilt.payload as ChangePackageRefactoring)
      return { executed: true, operation: plan.kind, result }
    }
    if (plan.kind === "extract_method") {
      const result = await client.executeExtractMethod(
        (rebuilt.payload as { preview: GenericRefactoring }).preview
      )
      return { executed: true, operation: plan.kind, result }
    }
    if (plan.kind === "quick_fix") {
      const payload = rebuilt.payload as {
        edits: Delta[]
        transport: string
        activate: boolean
      }
      const result = await this.applySourceDeltas(
        plan.connectionId,
        payload.edits,
        payload.transport || undefined,
        payload.activate
      )
      return { executed: true, operation: plan.kind, ...result }
    }
    if (plan.kind === "format") {
      const payload = rebuilt.payload as {
        object: SapObjectReference
        objectUri: string
        sourceUri: string
        before: string
        after: string
        transport: string
        activate: boolean
        mainProgram?: string
      }
      const result = await client.replaceSource(
        payload.object.name,
        payload.objectUri,
        payload.sourceUri,
        payload.before,
        payload.after,
        payload.transport || undefined,
        payload.activate,
        payload.mainProgram
      )
      return { executed: true, operation: plan.kind, diagnostics: result.diagnostics,
        activation: result.activation ?? null, activationSkipped: result.activationSkipped }
    }
    const payload = rebuilt.payload as {
      object: SapObjectReference
      objectUri: string
      state: { fingerprint: string }
      transport: string
    }
    await client.deleteObject(payload.objectUri, payload.state.fingerprint, payload.transport || undefined)
    return { executed: true, operation: plan.kind, object: payload.object }
  }

  private async applySourceDeltas(
    connectionId: string,
    deltas: Delta[],
    transport: string | undefined,
    activate: boolean
  ) {
    const client = await this.connections.getClient(connectionId)
    const grouped = new Map<string, Delta[]>()
    for (const delta of deltas) {
      grouped.set(delta.uri, [...(grouped.get(delta.uri) ?? []), delta])
    }
    const changes: Array<{
      object: SapObjectReference
      objectUri: string
      sourceUri: string
      before: string
      after: string
    }> = []
    for (const [uri, edits] of grouped) {
      const source = await client.readSourceByUri(uri)
      const objectUri = objectUriFromSourceUri(source.sourceUri)
      const structure = await client.getObjectStructure(objectUri)
      const object: SapObjectReference = {
        name: structure.metaData["adtcore:name"],
        type: structure.metaData["adtcore:type"],
        uri: objectUri,
        packageName: await this.packageForReference(client, {
          name: structure.metaData["adtcore:name"],
          type: structure.metaData["adtcore:type"],
          uri: objectUri
        })
      }
      const packageName = requireWritablePackage(client, object.packageName)
      requireTransport(packageName, transport)
      const after = applyDeltas(source.source, edits)
      const diagnostics = await client.checkSyntax(objectUri, source.sourceUri, after)
      if (diagnostics.some(item => /^(E|ERROR)$/i.test(item.severity.trim()))) {
        throw new AppError(
          "QUICK_FIX_SYNTAX_ERROR",
          `Quick-fix would introduce syntax errors in ${object.name}`,
          { diagnostics: diagnostics.slice(0, 100) }
        )
      }
      changes.push({ object, objectUri, sourceUri: source.sourceUri, before: source.source, after })
    }

    const applied: typeof changes = []
    try {
      for (const change of changes) {
        await client.replaceSource(
          change.object.name,
          change.objectUri,
          change.sourceUri,
          change.before,
          change.after,
          transport,
          false
        )
        applied.push(change)
      }
    } catch (error) {
      const rollbackFailures: string[] = []
      for (const change of [...applied].reverse()) {
        try {
          await client.replaceSource(
            change.object.name,
            change.objectUri,
            change.sourceUri,
            change.after,
            change.before,
            transport,
            false
          )
        } catch {
          rollbackFailures.push(change.object.name)
        }
      }
      throw new AppError(
        "MULTI_OBJECT_WRITE_FAILED",
        "Quick-fix failed while writing affected objects",
        {
          cause: error instanceof Error ? error.message : String(error),
          rolledBack: applied.length - rollbackFailures.length,
          rollbackFailures
        }
      )
    }

    const activations = []
    if (activate) {
      for (const change of changes) {
        activations.push({
          object: change.object.name,
          result: await client.activateObject(change.object.name, change.objectUri)
        })
      }
    }
    return { changedObjects: changes.map(change => change.object), activations }
  }

  async createObjectProgrammatically(input: CreateObjectInput) {
    const client = await this.connections.getClient(input.connectionId)
    const objectType = input.objectType.trim().toUpperCase()
    const isBdef = objectType === "BDEF/BDO"
    const activate = input.activate ?? false
    if (!isCreatableTypeId(objectType)) {
      throw new AppError(
        "OBJECT_TYPE_NOT_CREATABLE",
        `${input.objectType} is not a creatable object type supported by the installed ADT API`
      )
    }
    if (activate && input.source === undefined) {
      throw new AppError(
        "SAP_VALIDATION_FAILED",
        "activate=true requires source",
        { reason: "SOURCE_REQUIRED_FOR_ACTIVATION" }
      )
    }
    if (input.source !== undefined && !isBdef) {
      throw new AppError(
        "SAP_VALIDATION_FAILED",
        "Create-time source is supported only for BDEF/BDO in this delivery",
        { reason: "CREATE_SOURCE_UNSUPPORTED" }
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

    const capabilityStatusAtExecution = isBdef
      ? this.capabilities.status(input.connectionId, "repository.create.bdef")
      : undefined
    if (capabilityStatusAtExecution === "unsupported") {
      throw new AppError("SAP_CAPABILITY_UNAVAILABLE", "BDEF creation is unavailable", {
        capabilityId: "repository.create.bdef",
        endpoint: "bo/behaviordefinitions"
      })
    }

    let validation: ValidationResult
    try {
      validation = await client.validateNewObject(validateOptions)
    } catch (error) {
      if (!isBdef) throw error
      this.capabilities.observeFailure(
        input.connectionId,
        "repository.create.bdef",
        error,
        "bo/behaviordefinitions/validation"
      )
      throw normalizeCapabilityError(
        error,
        "repository.create.bdef",
        "bo/behaviordefinitions/validation",
        true
      )
    }
    if (!validation.success) {
      throw new AppError(
        isBdef ? "SAP_VALIDATION_FAILED" : "OBJECT_VALIDATION_FAILED",
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
    try {
      await client.createObject(createOptions)
      if (isBdef) {
        this.capabilities.observeSuccess(
          input.connectionId,
          "repository.create.bdef",
          "bo/behaviordefinitions"
        )
      }
    } catch (error) {
      if (!isBdef) throw error
      this.capabilities.observeFailure(
        input.connectionId,
        "repository.create.bdef",
        error,
        "bo/behaviordefinitions"
      )
      throw normalizeCapabilityError(
        error,
        "repository.create.bdef",
        "bo/behaviordefinitions"
      )
    }
    const created = {
      connectionId: input.connectionId.toUpperCase(),
      success: true,
      object: { name, type: objectType, uri: targetUri, packageName: writePackage },
      transport: transport ?? null,
      ...(capabilityStatusAtExecution === undefined
        ? {}
        : { capabilityStatusAtExecution })
    }
    if (input.source === undefined) return created

    let stage: "read_source" | "write_source" = "read_source"
    try {
      const current = await client.readSourceByUri(targetUri)
      stage = "write_source"
      const result = await client.replaceSource(
        name,
        targetUri,
        current.sourceUri,
        current.source,
        input.source,
        transport,
        activate
      )
      return {
        ...created,
        sourceUri: current.sourceUri,
        diagnostics: result.diagnostics,
        activation: result.activation ?? null,
        activationSkipped: result.activationSkipped
      }
    } catch (error) {
      this.capabilities.observeFailure(
        input.connectionId,
        "repository.create.bdef",
        error,
        stage
      )
      const normalized = normalizeCapabilityError(
        error,
        "repository.create.bdef",
        stage
      )
      throw new AppError(
        error instanceof AppError ? error.code : normalized.code,
        normalized.message,
        {
          ...normalized.details,
          stage,
          created: true,
          objectUri: targetUri,
          transport: transport ?? null,
          manualCleanupRequired: true
        }
      )
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
      const results = await client.getUserTransports(user)
      const transports = [
        ...results.workbench.flatMap(target => [
          ...target.modifiable.map(transport => ({ category: "workbench", state: "modifiable", target, transport })),
          ...target.released.map(transport => ({ category: "workbench", state: "released", target, transport }))
        ]),
        ...results.customizing.flatMap(target => [
          ...target.modifiable.map(transport => ({ category: "customizing", state: "modifiable", target, transport })),
          ...target.released.map(transport => ({ category: "customizing", state: "released", target, transport }))
        ])
      ]
      const page = pageItems(transports, input.startIndex, input.maxResults)
      return {
        connectionId: input.connectionId.toUpperCase(),
        user,
        total: page.total,
        startIndex: page.startIndex,
        returned: page.returned,
        truncated: page.truncated,
        nextStartIndex: page.nextStartIndex,
        transports: page.items.map(({ category, state, target, transport }) => ({
          category,
          state,
          target: target["tm:name"],
          targetDescription: target["tm:desc"],
          number: transport["tm:number"],
          owner: transport["tm:owner"],
          description: transport["tm:desc"],
          status: transport["tm:status"],
          taskCount: transport.tasks.length,
          objectCount: transportObjects(transport).length
        }))
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
    if (input.action === "list_system_users") {
      const users = await client.listSystemUsers()
      const page = pageItems(users, input.startIndex, input.maxResults)
      return {
        connectionId: input.connectionId.toUpperCase(),
        total: page.total,
        startIndex: page.startIndex,
        returned: page.returned,
        truncated: page.truncated,
        nextStartIndex: page.nextStartIndex,
        users: page.items
      }
    }
    if (input.action === "create_transport") {
      if (!input.description?.trim() || !input.packageName?.trim()) {
        throw new AppError(
          "TRANSPORT_CREATE_INPUT_REQUIRED",
          "create_transport requires description and packageName"
        )
      }
      const packageName = requireWritablePackage(client, input.packageName)
      const packageObject = await resolveObject(client, packageName, "DEVC/K")
      const transportNumber = await client.createTransport(
        packageObject.uri,
        input.description.trim(),
        packageName,
        input.transportLayer?.trim()
      )
      return {
        connectionId: input.connectionId.toUpperCase(),
        created: true,
        transportNumber,
        packageName,
        description: input.description.trim()
      }
    }
    if (input.action === "resolve_object") {
      if (!input.pgmid?.trim() || !input.objectType?.trim() || !input.objectName?.trim()) {
        throw new AppError(
          "TRANSPORT_OBJECT_INPUT_REQUIRED",
          "resolve_object requires pgmid, objectType, and objectName"
        )
      }
      return {
        connectionId: input.connectionId.toUpperCase(),
        transportReference: await client.resolveTransportObject(
          input.pgmid.trim().toUpperCase(),
          input.objectType.trim().toUpperCase(),
          input.objectName.trim().toUpperCase(),
          input.transportNumber?.trim().toUpperCase()
        )
      }
    }
    if (
      input.action === "release_transport" ||
      input.action === "delete_transport" ||
      input.action === "set_owner" ||
      input.action === "add_user"
    ) {
      requireNonProduction(client)
      const transportNumber = input.transportNumber?.trim().toUpperCase()
      if (!transportNumber) {
        throw new AppError("TRANSPORT_NUMBER_REQUIRED", `${input.action} requires transportNumber`)
      }
      const targetUser = input.targetUser?.trim().toUpperCase()
      const confirmation = input.action === "set_owner" || input.action === "add_user"
        ? `${transportNumber}:${targetUser ?? ""}`
        : transportNumber
      if (!targetUser && (input.action === "set_owner" || input.action === "add_user")) {
        throw new AppError("TARGET_USER_REQUIRED", `${input.action} requires targetUser`)
      }
      requireExactConfirmation(input.confirmation, confirmation)
      if (input.action === "release_transport") {
        const reports = await client.releaseTransport(
          transportNumber,
          input.ignoreLocks ?? false,
          input.ignoreAtc ?? false
        )
        const released = reports.length > 0 && reports.every(
          report => report["chkrun:status"] === "released"
        )
        return { connectionId: input.connectionId.toUpperCase(), transportNumber, released, reports }
      }
      if (input.action === "delete_transport") {
        await client.deleteTransport(transportNumber)
        return { connectionId: input.connectionId.toUpperCase(), transportNumber, deleted: true }
      }
      const result = input.action === "set_owner"
        ? await client.setTransportOwner(transportNumber, targetUser!)
        : await client.addTransportUser(transportNumber, targetUser!)
      return {
        connectionId: input.connectionId.toUpperCase(),
        transportNumber,
        targetUser,
        action: input.action,
        result
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

  async manageAbapGit(input: ManageAbapGitInput) {
    const client = await this.connections.getClient(input.connectionId)

    if (input.action === "list_repositories") {
      const repositories = await client.listGitRepositories()
      const page = pageItems(repositories, input.startIndex, input.maxResults)
      return {
        connectionId: input.connectionId.toUpperCase(),
        total: page.total,
        startIndex: page.startIndex,
        returned: page.returned,
        truncated: page.truncated,
        nextStartIndex: page.nextStartIndex,
        repositories: page.items.map(repository => ({
          id: repository.key,
          packageName: repository.sapPackage,
          url: repository.url,
          branch: repository.branch_name,
          status: repository.status ?? null,
          statusText: repository.status_text ?? null,
          createdBy: repository.created_by,
          createdAt: repository.created_at
        }))
      }
    }

    if (input.action === "remote_info") {
      if (!input.repositoryUrl?.trim()) {
        throw new AppError("GIT_URL_REQUIRED", "remote_info requires repositoryUrl")
      }
      const credentials = await this.gitCredentials(input.connectionId, input.repositoryUrl)
      const auth = credentials ? [credentials.username, credentials.password] as const : [] as const
      const remote = await client.getGitRemoteInfo(input.repositoryUrl.trim(), ...auth)
      if (remote.access_mode === "PRIVATE" && !credentials) {
        throw new AppError(
          "ABAPGIT_CREDENTIAL_REQUIRED",
          "Private repository credentials are not configured; use the abapgit auth login CLI command"
        )
      }
      const page = pageItems(remote.branches, input.startIndex, input.maxResults)
      return {
        connectionId: input.connectionId.toUpperCase(),
        repositoryUrl: input.repositoryUrl.trim(),
        accessMode: remote.access_mode,
        credentialAvailable: Boolean(credentials),
        totalBranches: page.total,
        startIndex: page.startIndex,
        returned: page.returned,
        truncated: page.truncated,
        nextStartIndex: page.nextStartIndex,
        branches: page.items.map(branch => ({
          name: branch.name,
          displayName: branch.display_name,
          head: branch.is_head,
          type: branch.type,
          sha1: branch.sha1
        }))
      }
    }

    if (input.action === "create_repository") {
      if (!input.repositoryUrl?.trim() || !input.packageName?.trim()) {
        throw new AppError(
          "GIT_CREATE_INPUT_REQUIRED",
          "create_repository requires repositoryUrl and packageName"
        )
      }
      const packageName = requireWritablePackage(client, input.packageName)
      const transport = requireTransport(packageName, input.transport)
      requireExactConfirmation(
        input.confirmation,
        `${packageName}:${normalizeAbapGitRepositoryUrl(input.repositoryUrl)}`
      )
      const credentials = await this.gitCredentials(input.connectionId, input.repositoryUrl)
      const auth = credentials ? [credentials.username, credentials.password] as const : [] as const
      const remote = await client.getGitRemoteInfo(input.repositoryUrl.trim(), ...auth)
      if (remote.access_mode === "PRIVATE" && !credentials) {
        throw new AppError(
          "ABAPGIT_CREDENTIAL_REQUIRED",
          "Private repository credentials are not configured; use the abapgit auth login CLI command"
        )
      }
      const branch = input.branch?.trim()
      if (branch && !remote.branches.some(item => item.name === branch)) {
        throw new AppError("GIT_BRANCH_NOT_FOUND", `Remote branch ${branch} was not found`)
      }
      await client.createGitRepository(
        packageName,
        input.repositoryUrl.trim(),
        branch,
        transport,
        ...auth
      )
      return { connectionId: input.connectionId.toUpperCase(), created: true, packageName,
        repositoryUrl: input.repositoryUrl.trim(), branch: branch ?? null, transport: transport ?? null }
    }

    const repository = await this.findGitRepository(client, input.repositoryId)
    const credentials = await this.gitCredentials(input.connectionId, repository.url)
    const auth = credentials ? [credentials.username, credentials.password] as const : [] as const
    if (
      input.action !== "unlink_repository" &&
      input.action !== "push_repository"
    ) {
      const remote = await client.getGitRemoteInfo(repository.url, ...auth)
      if (remote.access_mode === "PRIVATE" && !credentials) {
        throw new AppError(
          "ABAPGIT_CREDENTIAL_REQUIRED",
          "Private repository credentials are not configured; use the abapgit auth login CLI command"
        )
      }
    }
    if (input.action === "stage_repository") {
      const staging = await client.stageGitRepository(repository, ...auth)
      const stageId = randomUUID()
      const now = Date.now()
      for (const [id, stage] of this.gitStages) {
        if (stage.expiresAt <= now) this.gitStages.delete(id)
      }
      this.gitStages.set(stageId, {
        connectionId: input.connectionId.toUpperCase(),
        repository,
        staging,
        expiresAt: now + PLAN_TTL_MS
      })
      const changes = [...staging.staged, ...staging.unstaged]
      const page = pageItems(changes, input.startIndex, input.maxResults)
      return {
        connectionId: input.connectionId.toUpperCase(),
        repositoryId: repository.key,
        stageId,
        expiresAt: new Date(now + PLAN_TTL_MS).toISOString(),
        totalChanges: page.total,
        startIndex: page.startIndex,
        returned: page.returned,
        truncated: page.truncated,
        nextStartIndex: page.nextStartIndex,
        changes: page.items.map(change => ({
          key: change.wbkey,
          name: change.name,
          type: change.type,
          fileCount: change.abapGitFiles.length,
          states: [...new Set(change.abapGitFiles.map(file => file.localState))]
        }))
      }
    }

    if (input.action === "push_repository") {
      requireWritablePackage(client, repository.sapPackage)
      if (!credentials) {
        throw new AppError(
          "ABAPGIT_CREDENTIAL_REQUIRED",
          "Push credentials are not configured; use the abapgit auth login CLI command"
        )
      }
      if (!input.stageId?.trim()) {
        throw new AppError("GIT_STAGE_REQUIRED", "push_repository requires a fresh stageId")
      }
      const cached = this.gitStages.get(input.stageId)
      this.gitStages.delete(input.stageId)
      if (
        !cached || cached.expiresAt <= Date.now() ||
        cached.connectionId !== input.connectionId.toUpperCase() ||
        cached.repository.key !== repository.key
      ) {
        throw new AppError("GIT_STAGE_EXPIRED", "The staged snapshot is missing, expired, or belongs to another repository")
      }
      requireExactConfirmation(input.confirmation, repository.key)
      const all = [...cached.staging.staged, ...cached.staging.unstaged]
      const requested = new Set(input.objectKeys ?? [])
      const selected = input.stageAll
        ? all
        : all.filter(item => requested.has(item.wbkey))
      if (selected.length === 0) {
        throw new AppError(
          "GIT_SELECTION_REQUIRED",
          "Select changed object wbkeys with objectKeys, or set stageAll=true"
        )
      }
      const comment = input.comment?.trim()
      const authorName = input.authorName?.trim() || cached.staging.author.name
      const authorEmail = input.authorEmail?.trim() || cached.staging.author.email
      const committerName = input.committerName?.trim() || cached.staging.committer.name || authorName
      const committerEmail = input.committerEmail?.trim() || cached.staging.committer.email || authorEmail
      if (!comment || !authorName || !authorEmail || !committerName || !committerEmail) {
        throw new AppError(
          "GIT_COMMIT_DETAILS_REQUIRED",
          "push_repository requires comment, authorName, authorEmail, committerName, and committerEmail"
        )
      }
      const staging: GitStaging = {
        ...cached.staging,
        staged: selected,
        unstaged: all.filter(item => !selected.includes(item)),
        comment,
        author: { name: authorName, email: authorEmail },
        committer: { name: committerName, email: committerEmail }
      }
      await client.pushGitRepository(repository, staging, ...auth)
      return {
        connectionId: input.connectionId.toUpperCase(),
        repositoryId: repository.key,
        pushed: true,
        objectCount: selected.length,
        fileCount: selected.reduce((sum, item) => sum + item.abapGitFiles.length, 0)
      }
    }

    if (input.action === "check_repository") {
      await client.checkGitRepository(repository, ...auth)
      return { connectionId: input.connectionId.toUpperCase(), repositoryId: repository.key, checked: true }
    }

    requireWritablePackage(client, repository.sapPackage)
    requireExactConfirmation(input.confirmation, repository.key)
    if (input.action === "pull_repository") {
      const transport = requireTransport(repository.sapPackage.toUpperCase(), input.transport)
      await client.pullGitRepository(repository.key, input.branch?.trim(), transport, ...auth)
      return { connectionId: input.connectionId.toUpperCase(), repositoryId: repository.key,
        pulled: true, branch: input.branch?.trim() ?? repository.branch_name, transport: transport ?? null }
    }
    if (input.action === "unlink_repository") {
      await client.unlinkGitRepository(repository.key)
      return { connectionId: input.connectionId.toUpperCase(), repositoryId: repository.key, unlinked: true }
    }
    if (input.action === "switch_branch") {
      if (!input.branch?.trim()) {
        throw new AppError("GIT_BRANCH_REQUIRED", "switch_branch requires branch")
      }
      await client.switchGitBranch(repository, input.branch.trim(), input.createBranch ?? false, ...auth)
      return { connectionId: input.connectionId.toUpperCase(), repositoryId: repository.key,
        switched: true, branch: input.branch.trim(), created: input.createBranch ?? false }
    }
    throw new AppError("UNKNOWN_ACTION", `Unknown abapGit action: ${input.action}`)
  }

  async manageRap(input: ManageRapInput) {
    const client = await this.connections.getClient(input.connectionId)
    if (input.action === "availability") {
      return {
        connectionId: input.connectionId.toUpperCase(),
        generatorId: input.generatorId ?? null,
        available: await client.isRapGeneratorAvailable(input.generatorId)
      }
    }

    if (
      input.action === "publish" ||
      input.action === "unpublish" ||
      input.action === "service_details"
    ) {
      if (!input.serviceBindingName?.trim()) {
        throw new AppError("SERVICE_BINDING_REQUIRED", `${input.action} requires serviceBindingName`)
      }
      const name = input.serviceBindingName.trim().toUpperCase()
      const details = await client.getServiceBindingDetails(name)
      if (input.action === "service_details") {
        const baseUrl = client.profile.url.replace(/\/$/, "")
        return {
          connectionId: input.connectionId.toUpperCase(),
          binding: {
            name: details.binding.name,
            description: details.binding.description,
            type: details.binding.type,
            version: details.binding.version,
            published: details.binding.published,
            packageName: details.binding.packageRef.name,
            responsible: details.binding.responsible,
            changedAt: details.binding.changedAt
          },
          services: (details.details?.services ?? []).map(service => {
            const rawServiceUrl = service.serviceUrl || service.serviceInformation.url
            const serviceUrl = rawServiceUrl.startsWith("http")
              ? rawServiceUrl
              : `${baseUrl}${rawServiceUrl.startsWith("/") ? "" : "/"}${rawServiceUrl}`
            const preview = service.serviceInformation.collection[0]
              ? servicePreviewUrl(service, service.serviceInformation.collection[0].name)
              : undefined
            return {
              repositoryId: service.repositoryId,
              serviceId: service.serviceId,
              serviceVersion: service.serviceVersion,
              published: service.published,
              serviceUrl,
              metadataUrl: `${serviceUrl.replace(/\/?$/, "/")}$metadata`,
              ...(preview ? {
                previewUrl: preview.startsWith("http")
                  ? preview
                  : `${baseUrl}${preview.startsWith("/") ? "" : "/"}${preview}`
              } : {}),
              collections: service.serviceInformation.collection.map(collection => collection.name)
            }
          })
        }
      }

      requireWritablePackage(client, details.binding.packageRef.name)
      if (input.action === "publish") {
        requireExactConfirmation(input.confirmation, name)
        const result = await client.publishRapService(name)
        if (result.severity === "error") {
          throw new AppError("SERVICE_BINDING_OPERATION_FAILED", result.shortText, {
            longText: result.longText
          })
        }
        return {
          connectionId: input.connectionId.toUpperCase(),
          serviceBindingName: name,
          published: true,
          result
        }
      }
      if (details.binding.binding.version.toUpperCase() !== "V2") {
        throw new AppError(
          "SERVICE_UNPUBLISH_UNSUPPORTED",
          "The available ADT unpublish endpoint only supports OData V2 service bindings"
        )
      }
      const serviceName = input.serviceName?.trim().toUpperCase()
      const serviceVersion = input.serviceVersion?.trim()
      const candidates = details.binding.services.filter(service =>
        (!serviceName || service.name.toUpperCase() === serviceName) &&
        (!serviceVersion || String(service.version) === serviceVersion)
      )
      if (candidates.length !== 1) {
        throw new AppError(
          "SERVICE_SELECTION_REQUIRED",
          "unpublish requires serviceName and serviceVersion when the binding does not resolve to exactly one service",
          { services: details.binding.services.map(service => ({ name: service.name, version: service.version })) }
        )
      }
      const service = candidates[0]!
      const version = String(service.version)
      requireExactConfirmation(input.confirmation, `${name}:${service.name}:${version}`)
      const result = await client.unpublishServiceBinding(service.name, version)
      if (/^(error|e)$/i.test(result.severity)) {
        throw new AppError("SERVICE_BINDING_OPERATION_FAILED", result.shortText, {
          longText: result.longText
        })
      }
      return {
        connectionId: input.connectionId.toUpperCase(),
        serviceBindingName: name,
        serviceName: service.name,
        serviceVersion: version,
        published: false,
        result
      }
    }

    if (!input.generatorId || !input.referenceObjectName?.trim() || !input.packageName?.trim()) {
      throw new AppError(
        "RAP_INPUT_REQUIRED",
        `${input.action} requires generatorId, referenceObjectName, and packageName`
      )
    }
    const generatorId = input.generatorId
    if (!await client.isRapGeneratorAvailable(generatorId)) {
      throw new AppError("RAP_GENERATOR_UNAVAILABLE", `RAP generator ${generatorId} is not available`)
    }
    const reference = await resolveObject(
      client,
      input.referenceObjectName,
      input.referenceObjectType
    )
    const packageName = input.packageName.trim().toUpperCase()
    const initial = await client.validateRapGeneratorInitial(generatorId, reference.uri, packageName)
    if (initial.severity === "error") {
      throw new AppError("RAP_INITIAL_VALIDATION_FAILED", initial.shortText, {
        longText: initial.longText
      })
    }

    if (input.action === "get_schema") {
      const schema = await client.getRapGeneratorSchema(generatorId, reference.uri, packageName)
      const offset = Math.min(input.contentOffset, schema.length)
      const end = Math.min(schema.length, offset + input.contentLength)
      return {
        connectionId: input.connectionId.toUpperCase(),
        generatorId,
        reference,
        packageName,
        initialValidation: initial,
        totalCharacters: schema.length,
        contentOffset: offset,
        returnedCharacters: end - offset,
        truncated: end < schema.length,
        nextContentOffset: end < schema.length ? end : null,
        schema: schema.slice(offset, end)
      }
    }
    if (input.action === "get_defaults") {
      return {
        connectionId: input.connectionId.toUpperCase(),
        generatorId,
        reference,
        packageName,
        initialValidation: initial,
        content: await client.getRapGeneratorContent(generatorId, reference.uri, packageName)
      }
    }
    if (input.action === "validate" && !input.content) {
      return {
        connectionId: input.connectionId.toUpperCase(),
        generatorId,
        reference,
        packageName,
        validation: initial
      }
    }
    if (!input.content) {
      throw new AppError("RAP_CONTENT_REQUIRED", `${input.action} requires content`)
    }
    const contentPackage = input.content.metadata?.package?.trim().toUpperCase()
    if (contentPackage && contentPackage !== packageName) {
      throw new AppError(
        "RAP_PACKAGE_MISMATCH",
        `content.metadata.package ${contentPackage} does not match packageName ${packageName}`
      )
    }
    const validation = await client.validateRapGeneratorContent(
      generatorId,
      reference.uri,
      input.content
    )
    if (input.action === "validate") {
      return { connectionId: input.connectionId.toUpperCase(), generatorId, reference,
        packageName, validation }
    }
    if (validation.severity === "error") {
      throw new AppError("RAP_CONTENT_VALIDATION_FAILED", validation.shortText, {
        longText: validation.longText
      })
    }
    const preview = await client.previewRapGenerator(generatorId, reference.uri, input.content)
    if (preview.length === 0) {
      throw new AppError("RAP_PREVIEW_EMPTY", "SAP RAP generator returned no objects")
    }
    if (input.action === "preview") {
      return {
        connectionId: input.connectionId.toUpperCase(),
        generatorId,
        reference,
        packageName,
        validation,
        objectCount: preview.length,
        objects: preview
      }
    }

    const writablePackage = requireWritablePackage(client, packageName)
    const transport = requireTransport(writablePackage, input.transport)
    const bindingName = input.content.businessService.serviceBinding.name.trim().toUpperCase()
    requireExactConfirmation(input.confirmation, `${generatorId}:${bindingName}`)
    const generated = await client.generateRapObjects(
      generatorId,
      reference.uri,
      transport ?? "",
      input.content
    )
    const expected = preview.map(item => `${item.type}:${item.name}`).sort()
    const actual = generated.map(item => `${item.type}:${item.name}`).sort()
    if (stableJson(expected) !== stableJson(actual)) {
      throw new AppError(
        "RAP_GENERATION_RESULT_MISMATCH",
        "SAP created a different object set than the immediately preceding preview",
        { expected, actual }
      )
    }
    return {
      connectionId: input.connectionId.toUpperCase(),
      generatorId,
      reference,
      packageName,
      transport: transport ?? null,
      generated: true,
      objectCount: generated.length,
      objects: generated
    }
  }

  private async buildRestorePreview(input: ManageVersionsInput) {
    if (!input.objectName?.trim() || !input.versionNumber) {
      throw new AppError(
        "VERSION_RESTORE_INPUT_REQUIRED",
        "preview_restore requires objectName and versionNumber"
      )
    }
    const client = await this.connections.getClient(input.connectionId)
    const object = await resolveObject(client, input.objectName, input.objectType)
    const packageName = requireWritablePackage(client, object.packageName)
    const transport = requireTransport(packageName, input.transport)
    const revisions = await client.getRevisions(object.uri)
    if (input.versionNumber < 1 || input.versionNumber > revisions.length) {
      throw new AppError(
        "VERSION_NOT_FOUND",
        `Version ${input.versionNumber} is outside the available range 1-${revisions.length}`
      )
    }
    const revision = revisions[input.versionNumber - 1]!
    const [current, historical, state] = await Promise.all([
      client.readObject(object),
      client.readSourceByUri(revision.uri),
      client.getObjectFingerprint(object.uri)
    ])
    if (current.source === historical.source) {
      throw new AppError("NO_SOURCE_CHANGE", `Version ${input.versionNumber} already matches current source`)
    }
    const payload = {
      object,
      sourceUri: current.sourceUri,
      before: current.source,
      after: historical.source,
      revision,
      versionNumber: input.versionNumber,
      state,
      transport: transport ?? "",
      activate: input.activate
    }
    return {
      client,
      payload,
      fingerprint: payloadFingerprint(payload),
      summary: {
        object,
        versionNumber: input.versionNumber,
        revision,
        transport: transport ?? null,
        activate: input.activate,
        ...summarizeDiff(current.source, historical.source)
      }
    }
  }

  async manageVersions(input: ManageVersionsInput) {
    const client = await this.connections.getClient(input.connectionId)
    if (input.action === "list_inactive") {
      const records = await client.getInactiveObjects()
      const page = pageItems(records, input.startIndex, input.maxResults)
      return {
        connectionId: input.connectionId.toUpperCase(),
        total: page.total,
        startIndex: page.startIndex,
        returned: page.returned,
        truncated: page.truncated,
        nextStartIndex: page.nextStartIndex,
        inactive: page.items.map(record => ({
          object: record.object ? {
            name: record.object["adtcore:name"],
            type: record.object["adtcore:type"],
            uri: record.object["adtcore:uri"],
            parentUri: record.object["adtcore:parentUri"],
            user: record.object.user,
            deleted: record.object.deleted,
            description: record.object["adtcore:description"] ?? null
          } : null,
          transport: record.transport ? {
            name: record.transport["adtcore:name"],
            type: record.transport["adtcore:type"],
            uri: record.transport["adtcore:uri"],
            user: record.transport.user,
            deleted: record.transport.deleted
          } : null
        }))
      }
    }
    if (input.action === "get_inactive_source") {
      if (!input.objectName?.trim()) {
        throw new AppError("OBJECT_NAME_REQUIRED", "get_inactive_source requires objectName")
      }
      const records = await client.getInactiveObjects()
      const matches = records
        .map(record => record.object)
        .filter(item => item &&
          item["adtcore:name"].toUpperCase() === input.objectName!.trim().toUpperCase() &&
          sameType(item["adtcore:type"], input.objectType))
      if (matches.length === 0) {
        throw new AppError("INACTIVE_OBJECT_NOT_FOUND", `No inactive object matched ${input.objectName}`)
      }
      if (matches.length > 1 && !input.objectType) {
        throw new AppError(
          "OBJECT_AMBIGUOUS",
          `Multiple inactive objects named ${input.objectName} were found; provide objectType`
        )
      }
      const object = matches[0]!
      const source = await client.readSourceByUri(object["adtcore:uri"], "inactive")
      const lines = source.source.split(/\r?\n/)
      const selected = selectLines(lines, Math.max(0, input.startLine - 1), input.lineCount)
      return {
        connectionId: input.connectionId.toUpperCase(),
        object: {
          name: object["adtcore:name"],
          type: object["adtcore:type"],
          uri: object["adtcore:uri"],
          user: object.user,
          deleted: object.deleted
        },
        sourceUri: source.sourceUri,
        startLine: input.startLine,
        endLine: selected.endIndex,
        totalLines: lines.length,
        truncated: selected.truncated,
        nextLine: selected.nextIndex === null ? null : selected.nextIndex + 1,
        source: selected.selected.join("\n")
      }
    }
    if (input.action === "preview_restore") {
      const built = await this.buildRestorePreview(input)
      const plan = this.cachePlan({
        kind: "restore_version",
        connectionId: input.connectionId.toUpperCase(),
        confirmation: `${input.objectName!.trim().toUpperCase()}:VERSION:${input.versionNumber}`,
        fingerprint: built.fingerprint,
        request: { ...input },
        payload: built.payload
      })
      return this.planResponse(plan, built.summary)
    }
    if (!input.planId?.trim() || input.confirmation === undefined) {
      throw new AppError(
        "RESTORE_PLAN_REQUIRED",
        "execute_restore requires planId and confirmation from preview_restore"
      )
    }
    const plan = this.takePlan(input.planId, input.confirmation)
    if (plan.kind !== "restore_version") {
      throw new AppError(
        "PLAN_TOOL_MISMATCH",
        "Only restore plans can be executed through manage_abap_versions"
      )
    }
    const rebuilt = await this.buildRestorePreview(plan.request as unknown as ManageVersionsInput)
    if (rebuilt.fingerprint !== plan.fingerprint) {
      throw new AppError(
        "RESTORE_STATE_CHANGED",
        "Current source or version history changed after preview; review a new restore preview"
      )
    }
    const payload = rebuilt.payload
    const result = await rebuilt.client.replaceSource(
      payload.object.name,
      payload.object.uri,
      payload.sourceUri,
      payload.before,
      payload.after,
      payload.transport || undefined,
      payload.activate
    )
    return {
      connectionId: plan.connectionId,
      restored: true,
      object: payload.object,
      versionNumber: payload.versionNumber,
      diagnostics: result.diagnostics,
      activation: result.activation ?? null,
      activationSkipped: result.activationSkipped
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
    const candidate = typeof input === "object" && input !== null
      ? input as { url?: unknown; urls?: unknown; connectionId?: unknown }
      : {}
    const urlPresent = Object.prototype.hasOwnProperty.call(candidate, "url")
    const urlsPresent = Object.prototype.hasOwnProperty.call(candidate, "urls")
    const connectionIdPresent = Object.prototype.hasOwnProperty.call(candidate, "connectionId")
    const hasUrl = urlPresent && typeof candidate.url === "string"
    const hasUrls = urlsPresent && Array.isArray(candidate.urls) &&
      candidate.urls.every(url => typeof url === "string")
    const connectionIdValid = !connectionIdPresent || typeof candidate.connectionId === "string"
    if (!connectionIdValid || urlPresent !== hasUrl || urlsPresent !== hasUrls || hasUrl === hasUrls) {
      throw new AppError(
        "SAP_VALIDATION_FAILED",
        "Provide exactly one of url or urls",
        { reason: "ACTIVATION_INPUT_AMBIGUOUS" }
      )
    }

    const explicitConnectionId = candidate.connectionId as string | undefined
    if (hasUrl) {
      const target = await this.resolveEditableTarget({
        fileUri: candidate.url as string,
        ...(explicitConnectionId ? { connectionId: explicitConnectionId } : {})
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

    const urls = candidate.urls as string[]
    if (urls.length < 1 || urls.length > 100) {
      throw new AppError(
        "SAP_VALIDATION_FAILED",
        "Batch activation requires 1 through 100 URLs",
        { reason: "ACTIVATION_CARDINALITY_INVALID" }
      )
    }

    const locations = urls.map(url => parseAdtLocation(url, explicitConnectionId))
    const connectionIds = new Set(locations.map(location => location.connectionId))
    if (connectionIds.size !== 1) {
      throw new AppError(
        "SAP_VALIDATION_FAILED",
        "Batch activation requires exactly one connection",
        { reason: "CROSS_CONNECTION_BATCH" }
      )
    }

    const connectionId = locations[0]!.connectionId
    const client = await this.connections.getClient(connectionId)
    const targets: EditableTarget[] = []
    for (const location of locations) {
      const target = await this.resolveEditableTarget(
        { fileUri: location.path, connectionId },
        client
      )
      requireWritablePackage(client, target.object.packageName)
      targets.push(target)
    }

    const inactiveRecords = await client.getInactiveObjects()
    const inactiveByUri = new Map(inactiveRecords.flatMap(record => {
      const inactive = record?.object
      const uri = canonicalActivationUri(inactive?.["adtcore:uri"])
      return inactive && uri ? [[uri, inactive] as const] : []
    }))
    const submittedByUri = new Map<string, {
      target: EditableTarget
      inactive: NonNullable<(typeof inactiveRecords)[number]["object"]>
    }>()
    for (const target of targets) {
      const uri = canonicalActivationUri(target.objectUri)
      const inactive = uri ? inactiveByUri.get(uri) : undefined
      if (uri && inactive && !submittedByUri.has(uri)) {
        submittedByUri.set(uri, { target, inactive })
      }
    }
    const submitted = [...submittedByUri.values()]
    const submittedUris = new Set(submittedByUri.keys())

    let capabilityStatusAtExecution = this.capabilities.status(
      connectionId,
      "repository.activate.batch"
    )
    let activation = { success: false, messages: [], inactive: [] } as Awaited<
      ReturnType<SapClient["activateObjects"]>
    >
    if (submitted.length > 0) {
      const executed = await this.executeCapability(
        connectionId,
        "repository.activate.batch",
        "/sap/bc/adt/activation",
        () => client.activateObjects(submitted.map(item => item.inactive))
      )
      activation = executed.result
      capabilityStatusAtExecution = executed.capabilityStatusAtExecution
    }

    const remainingUris = new Set(activation.inactive.flatMap(record => {
      const uri = canonicalActivationUri(record?.object?.["adtcore:uri"])
      return uri ? [uri] : []
    }))
    const objectResults = targets.map(target => {
      const uri = canonicalActivationUri(target.objectUri)
      const escapedName = target.object.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      const namePattern = new RegExp(
        `(?<![A-Z0-9_/])${escapedName}(?![A-Z0-9_/])`,
        "i"
      )
      const messages = uri === undefined ? [] : activation.messages.filter(message => {
        const href = canonicalActivationUri(message?.href)
        if (href !== undefined) return href === uri
        return typeof message?.objDescr === "string" && namePattern.test(message.objDescr)
      })
      const failed = (uri !== undefined && remainingUris.has(uri)) || messages.some(message =>
        typeof message?.type === "string" && /^(E|A|X|ERROR)$/i.test(message.type.trim())
      )
      return {
        object: target.object,
        outcome: failed
          ? "failed"
          : uri !== undefined && submittedUris.has(uri) && activation.success
            ? "activated"
            : "unknown",
        messages
      }
    })
    const status = objectResults.every(item => item.outcome === "activated")
      ? "complete"
      : objectResults.every(item => item.outcome === "failed")
        ? "failed"
        : "partial"

    return {
      connectionId,
      status,
      requested: targets.map(target => target.object),
      objectResults,
      messages: activation.messages,
      remainingInactive: activation.inactive,
      capabilityStatusAtExecution
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

  async compareSystems(input: CompareSystemsInput) {
    if (input.sourceConnectionId.toUpperCase() === input.targetConnectionId.toUpperCase()) {
      throw new AppError("SAME_CONNECTION", "Choose two different SAP connections")
    }
    const [sourceClient, targetClient] = await Promise.all([
      this.connections.getClient(input.sourceConnectionId),
      this.connections.getClient(input.targetConnectionId)
    ])
    const [sourceObject, targetObject] = await Promise.all([
      resolveObject(sourceClient, input.objectName, input.objectType),
      resolveObject(targetClient, input.objectName, input.objectType)
    ])
    const [source, target] = await Promise.all([
      sourceClient.readObject(sourceObject),
      targetClient.readObject(targetObject)
    ])
    const normalize = (value: string) => input.ignoreWhitespace
      ? value.split(/\r?\n/).map(line => line.trim().replace(/\s+/g, " ")).join("\n")
      : value.replace(/\r\n/g, "\n")
    const normalizedSource = normalize(source.source)
    const normalizedTarget = normalize(target.source)
    return {
      objectName: input.objectName.toUpperCase(),
      objectType: sourceObject.type,
      source: {
        connectionId: input.sourceConnectionId.toUpperCase(),
        object: sourceObject,
        sourceUri: source.sourceUri,
        sha256: createHash("sha256").update(source.source).digest("hex"),
        lines: source.source.split(/\r?\n/).length
      },
      target: {
        connectionId: input.targetConnectionId.toUpperCase(),
        object: targetObject,
        sourceUri: target.sourceUri,
        sha256: createHash("sha256").update(target.source).digest("hex"),
        lines: target.source.split(/\r?\n/).length
      },
      ignoreWhitespace: input.ignoreWhitespace,
      ...summarizeDiff(normalizedSource, normalizedTarget, input.maxPatchLines)
    }
  }

  async dependencyGraph(input: DependencyGraphInput) {
    const client = await this.connections.getClient(input.connectionId)
    const object = await resolveObject(client, input.objectName, input.objectType)
    const source = await client.readObject(object)
    const rootId = `${object.name}::${object.type}`
    const nodes = new Map<string, Record<string, unknown>>([
      [rootId, {
        id: rootId,
        name: object.name,
        type: object.type,
        packageName: object.packageName ?? null,
        custom: /^[ZY]/i.test(object.name) || /^[ZY]/i.test(object.packageName ?? ""),
        root: true,
        uri: source.sourceUri
      }]
    ])
    const edges = new Map<string, Record<string, unknown>>()
    const queue: Array<{ id: string; uri: string; level: number; line?: number; column?: number }> = [{
      id: rootId,
      uri: source.sourceUri,
      level: 0,
      ...(input.line !== undefined ? { line: input.line } : {}),
      ...(input.column !== undefined ? { column: input.column } : {})
    }]
    const expanded = new Set<string>()
    let limited = false
    while (queue.length > 0) {
      const current = queue.shift()!
      const expansionKey = `${current.id}:${current.uri}`
      if (expanded.has(expansionKey) || current.level >= input.depth) continue
      expanded.add(expansionKey)
      const references = await client.findUsageReferences(
        current.uri,
        current.line ?? 1,
        current.column ?? 0
      )
      for (const reference of references) {
        const parsed = dependencyReference(reference)
        if (!parsed || parsed.id === current.id) continue
        if (input.customOnly && !parsed.custom) continue
        if (!nodes.has(parsed.id)) {
          if (nodes.size >= input.maxNodes) {
            limited = true
            continue
          }
          nodes.set(parsed.id, { ...parsed, root: false, depth: current.level + 1 })
        }
        const edgeKey = `${parsed.id}->${current.id}`
        if (!edges.has(edgeKey)) {
          edges.set(edgeKey, {
            source: parsed.id,
            target: current.id,
            usageType: parsed.usageInformation
          })
        }
        if (parsed.canExpand && current.level + 1 < input.depth) {
          queue.push({ id: parsed.id, uri: parsed.uri, level: current.level + 1 })
        }
      }
    }
    return {
      connectionId: input.connectionId.toUpperCase(),
      object,
      depth: input.depth,
      customOnly: input.customOnly,
      nodeCount: nodes.size,
      edgeCount: edges.size,
      truncated: limited,
      nodes: [...nodes.values()],
      edges: [...edges.values()]
    }
  }

  async runAbapApplication(input: RunAbapApplicationInput) {
    const connectionId = input.connectionId.trim().toUpperCase()
    const client = await this.connections.getClient(connectionId)
    const replEndpoint = "/sap/bc/z_abap_repl"

    if (input.action === "repl_health") {
      const { result, capabilityStatusAtExecution } = await this.executeCapability(
        connectionId,
        "execution.abap_repl",
        replEndpoint,
        () => client.checkReplAvailability()
      )
      return {
        connectionId,
        health: result,
        capabilityStatusAtExecution
      }
    }

    if (input.action === "preview_class") {
      requireExecutableProfile(client)
      const className = input.className.trim()
      if (
        className !== className.toUpperCase() ||
        className.length > 30 ||
        !/^(?:\/[A-Z0-9_]+\/)?[A-Z][A-Z0-9_]*$/.test(className)
      ) {
        throw new AppError(
          "SAP_VALIDATION_FAILED",
          "Class name must be an uppercase ABAP identifier of at most 30 characters",
          { reason: "CLASS_NAME_INVALID", className }
        )
      }
      const plan = this.cacheExecutionPlan({
        kind: "class",
        connectionId,
        className,
        confirmation: `RUN_CLASS:${connectionId}:${className}`
      })
      return {
        action: input.action,
        connectionId,
        planId: plan.id,
        confirmation: plan.confirmation,
        expiresAt: new Date(plan.expiresAt).toISOString(),
        capabilityStatus: this.capabilities.status(connectionId, "execution.class_runner")
      }
    }

    if (input.action === "preview_snippet") {
      requireExecutableProfile(client)
      const codeBytes = Buffer.byteLength(input.code, "utf8")
      if (!input.code.trim() || codeBytes < 1 || codeBytes > INLINE_TEXT_BYTE_LIMIT) {
        throw new AppError(
          "SAP_VALIDATION_FAILED",
          `ABAP snippet must contain 1 through ${INLINE_TEXT_BYTE_LIMIT} UTF-8 bytes`,
          { reason: "SNIPPET_SIZE_INVALID", bytes: codeBytes }
        )
      }
      const digest = createHash("sha256").update(input.code).digest("hex").slice(0, 12)
      const plan = this.cacheExecutionPlan({
        kind: "snippet",
        connectionId,
        code: input.code,
        confirmation: `RUN_SNIPPET:${connectionId}:${digest}`
      })
      return {
        action: input.action,
        connectionId,
        planId: plan.id,
        confirmation: plan.confirmation,
        expiresAt: new Date(plan.expiresAt).toISOString(),
        codeBytes,
        capabilityStatus: this.capabilities.status(connectionId, "execution.abap_repl")
      }
    }

    const plan = this.takeExecutionPlan(input.planId, connectionId, input.confirmation)
    requireExecutableProfile(client)
    if (plan.kind === "class") {
      const { result, capabilityStatusAtExecution } = await this.executeCapability(
        connectionId,
        "execution.class_runner",
        `/sap/bc/adt/oo/classrun/${plan.className}`,
        () => client.runClass(plan.className)
      )
      const output = boundInlineText(result)
      return {
        connectionId,
        kind: plan.kind,
        className: plan.className,
        output: output.content,
        originalBytes: output.originalBytes,
        returnedBytes: output.returnedBytes,
        truncated: output.truncated,
        capabilityStatusAtExecution
      }
    }

    const health = await this.executeCapability(
      connectionId,
      "execution.abap_repl",
      replEndpoint,
      () => client.checkReplAvailability()
    )
    if (health.result.production) {
      throw new AppError(
        "SAP_CAPABILITY_UNAVAILABLE",
        "ABAP REPL is disabled on production",
        { capabilityId: "execution.abap_repl", endpoint: replEndpoint }
      )
    }
    const { result, capabilityStatusAtExecution } = await this.executeCapability(
      connectionId,
      "execution.abap_repl",
      replEndpoint,
      () => client.executeAbapCode(plan.code)
    )
    const output = boundInlineText(result.output)
    const error = boundInlineText(result.error, INLINE_TEXT_BYTE_LIMIT - output.returnedBytes)
    return {
      connectionId,
      kind: plan.kind,
      success: result.success,
      output: output.content,
      error: error.content,
      runtime_ms: result.runtime_ms,
      originalBytes: output.originalBytes + error.originalBytes,
      returnedBytes: output.returnedBytes + error.returnedBytes,
      truncated: output.truncated || error.truncated,
      capabilityStatusAtExecution
    }
  }

  async runSapTransaction(input: RunSapTransactionInput) {
    const transactionCode = input.transactionCode.trim().toUpperCase()
    if (!/^(?:\/[A-Z0-9_]+\/)?[A-Z0-9_]{2,20}$/.test(transactionCode)) {
      throw new AppError("INVALID_TRANSACTION_CODE", `Invalid SAP transaction code: ${transactionCode}`)
    }
    const parameters = Object.entries(input.parameters ?? {}).map(([rawName, rawValue]) => {
      const name = rawName.trim().toUpperCase()
      if (!/^[A-Z0-9_-]{1,40}$/.test(name)) {
        throw new AppError("INVALID_TRANSACTION_PARAMETER", `Invalid parameter name: ${rawName}`)
      }
      if (!/^[A-Za-z0-9_./:+@-]{0,120}$/.test(rawValue)) {
        throw new AppError(
          "INVALID_TRANSACTION_PARAMETER",
          `Parameter ${name} contains characters that are unsafe in an ITS transaction command`
        )
      }
      return `${name}=${rawValue}`
    })
    const client = await this.connections.getClient(input.connectionId)
    const baseUrl = client.profile.url.replace(/\/sap\/bc\/adt.*$/i, "").replace(/\/$/, "")
    const url = new URL(`${baseUrl}/sap/bc/gui/sap/its/webgui`)
    const command = `*${transactionCode}${parameters.length ? ` ${parameters.join(";")}` : ""}`
    url.searchParams.set("~transaction", command)
    url.searchParams.set("sap-client", client.profile.client)
    url.searchParams.set("sap-language", client.profile.language)
    url.searchParams.set("saml2", "disabled")
    const target = url.toString()
    if (input.mode === "launch") {
      if (process.platform === "darwin") {
        await execFileAsync("/usr/bin/open", [target], { timeout: 10_000 })
      } else if (process.platform === "win32") {
        await execFileAsync("rundll32.exe", ["url.dll,FileProtocolHandler", target], {
          timeout: 10_000
        })
      } else {
        await execFileAsync("xdg-open", [target], { timeout: 10_000 })
      }
    }
    return {
      connectionId: input.connectionId.toUpperCase(),
      transactionCode,
      mode: input.mode,
      launched: input.mode === "launch",
      url: target
    }
  }
}

import { parseAdtResourceUri } from "../dist/src/mcp/v1/resource-uri.js"

// Consume the v1 source-read result, not the internal service's sourceUri field.
// Shared by the live runner and offline evidence-contract tests. Never return source bodies.
export async function checkPublicContracts(call, systemId, sourceResult) {
  let resource
  try { resource = parseAdtResourceUri(sourceResult?.resourceUri) }
  catch { throw new Error("INVALID_SOURCE_URI") }
  if (resource.systemId !== systemId.toUpperCase()) throw new Error("SOURCE_SYSTEM_MISMATCH")
  const fileUri = resource.adtPath
  const name = "sap.semantic.components"
  const described = await call("sap.capability.describe", { name }, false)
  const schemaHash = described.capability?.schemaHash
  if (!/^[a-f0-9]{64}$/.test(schemaHash ?? "")) throw new Error("INVALID_CAPABILITY_DESCRIPTION")
  const args = { systemId, fileUri, publicApi: true, includeRelated: true, documentation: { offset: 0, maxChars: 2000 }, startIndex: 0, limit: 20 }
  const invoke = arguments_ => call("sap.capability.invoke_read", { name, schemaHash, arguments: arguments_ })
  const validDocumentation = page => page?.version === "active" && typeof page.objectName === "string" && (
    page.status === "not_found_or_unsupported" ||
    (page.status === "available" && typeof page.content === "string" &&
      /^[a-f0-9]{64}$/.test(page.documentHash ?? "") && page.offset === 0 &&
      Number.isInteger(page.returned) && page.returned === Array.from(page.content).length && page.returned <= 2000 &&
      Number.isInteger(page.totalChars) && page.totalChars >= page.returned &&
      page.truncated === (page.returned < page.totalChars) &&
      page.nextOffset === (page.truncated ? page.returned : null)))
  const validFull = value => value?.view === "public_api" && value.notModified === false && /^[a-f0-9]{64}$/.test(value.contentHash ?? "") &&
    validDocumentation(value.documentation) && Array.isArray(value.declarations) && value.declarations.every(item => typeof item.code === "string") &&
    Array.isArray(value.relatedContracts) && value.relatedContracts.every(item =>
      ["included", "unresolved", "already_included"].includes(item.status) &&
      (item.status !== "included" || typeof item.code === "string")) &&
    typeof value.truncated === "boolean" && typeof value.relatedCoverage?.truncated === "boolean" &&
    Number.isInteger(value.relatedCoverage.attempted) && value.relatedCoverage.attempted >= 0 && value.relatedCoverage.attempted <= 5
  const first = await invoke(args)
  if (!validFull(first)) throw new Error("INVALID_PUBLIC_CONTRACT_RESULT")
  const repeated = await invoke({ ...args, ifNoneMatch: first.contentHash })
  let revalidation
  if (repeated.view === "public_api" && repeated.notModified === true && repeated.contentHash === first.contentHash &&
      repeated.declarations === undefined && repeated.relatedContracts === undefined && repeated.documentation === undefined) revalidation = "unchanged"
  else if (validFull(repeated) && repeated.contentHash !== first.contentHash) revalidation = "changed"
  else throw new Error("INVALID_CONDITIONAL_PUBLIC_CONTRACT_RESULT")
  return {
    documentation: { status: first.documentation.status,
      ...(first.documentation.status === "available" ? { returned: first.documentation.returned,
        truncated: first.documentation.truncated } : {}) },
    revalidation, declarations: first.declarations.length, rootTruncated: first.truncated,
    relatedAttempted: first.relatedCoverage.attempted, relatedTruncated: first.relatedCoverage.truncated,
    relatedIncluded: first.relatedContracts.filter(item => item.status === "included").length,
    relatedUnresolved: first.relatedContracts.filter(item => item.status === "unresolved").length,
    scope: "first_public_page_up_to_five_explicit_related_types_and_first_ktd_page"
  }
}

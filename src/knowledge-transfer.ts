import { XMLParser, XMLValidator } from "fast-xml-parser"
import { AppError } from "./errors.js"

const MAX_DOCUMENT_BYTES = 1024 * 1024

/** Decode the read-only KTD XML representation; never interpret Markdown as instructions. */
export function decodeKnowledgeTransferDocument(xml: string): string {
  const invalid = () => new AppError("SAP_VALIDATION_FAILED", "Invalid knowledge transfer document representation")
  if (Buffer.byteLength(xml) > MAX_DOCUMENT_BYTES) {
    throw new AppError("SAP_VALIDATION_FAILED", "Knowledge transfer document exceeds 1 MiB")
  }
  if (/<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true) throw invalid()
  const parsed = new XMLParser({ removeNSPrefix: true, parseTagValue: false, processEntities: false }).parse(xml)
  const root = parsed.docu
  if (!root || typeof root !== "object" || Array.isArray(root)) throw invalid()
  const sections: string[] = []
  let hasTextField = false
  const decode = (value: unknown): string => {
    if (typeof value !== "string") throw invalid()
    const encoded = value.replace(/\s/g, "")
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) throw invalid()
    const data = Buffer.from(encoded, "base64")
    if (data.toString("base64") !== encoded) throw invalid()
    try { return new TextDecoder("utf-8", { fatal: true }).decode(data) }
    catch { throw invalid() }
  }
  const visit = (node: unknown, depth: number): void => {
    if (depth > 64) throw invalid()
    if (Array.isArray(node)) { for (const item of node) visit(item, depth + 1); return }
    if (!node || typeof node !== "object") return
    const record = node as Record<string, unknown>
    if ("text" in record) {
      hasTextField = true
      const text = decode(record.text)
      if (text) {
        const id = typeof record.id === "string" ? record.id : ""
        sections.push(id ? `## ${id}\n\n${text}` : text)
      }
    }
    for (const [key, value] of Object.entries(record)) {
      if (key !== "text") visit(value, depth + 1)
    }
  }
  visit(root, 0)
  if (!hasTextField) throw invalid()
  return sections.join("\n\n")
}

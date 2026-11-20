import type { TransportRequest, TransportTask } from "abap-adt-api"
import { fullParse, xmlArray, xmlNode, xmlNodeAttr } from "abap-adt-api/build/utilities.js"
import { XMLValidator } from "fast-xml-parser"
import { AppError } from "./errors.js"

export type SapTransportDetails = TransportRequest & {
  entityKind?: "request" | "task"
  parentNumber?: string
}

export function parseCtsTransportDetails(body: string, number: string): SapTransportDetails {
  if (XMLValidator.validate(body) !== true) throw new AppError("TRANSPORT_TARGET_UNVERIFIED", "Invalid CTS detail XML")
  const root = xmlNode(fullParse(body, { parseAttributeValue: false }), "tm:root")
  type Entry = Record<string, unknown>
  const requests = xmlArray<Entry>(root, "tm:request")
  const candidates = [
    ...requests.map(node => ({ node, kind: "request" as const, parent: undefined })),
    ...xmlArray<Entry>(root, "tm:task").map(node => ({ node, kind: "task" as const, parent: requests.length === 1 ? requests[0] : undefined })),
    ...requests.flatMap(parent => xmlArray<Entry>(parent, "tm:task").map(node => ({ node, kind: "task" as const, parent })))
  ]
  const matches = candidates.filter(candidate => candidate.node?.["@_tm:number"] === number)
  if (matches.length !== 1) throw new AppError("TRANSPORT_TARGET_UNVERIFIED", "CTS details did not identify exactly one requested transport", {
    reason: matches.length === 0 ? "TARGET_ABSENT" : "TARGET_AMBIGUOUS"
  })
  const { node, kind, parent } = matches[0]!
  const parseEntry = (entry: typeof node) => ({
    ...xmlNodeAttr(entry),
    links: xmlArray(entry, "atom:link").map(xmlNodeAttr),
    objects: xmlArray(entry, "tm:abap_object").map(xmlNodeAttr)
  }) as TransportTask
  const parentNumber = parent?.["@_tm:number"]
  return {
    ...parseEntry(node),
    entityKind: kind,
    ...(typeof parentNumber === "string" ? { parentNumber } : {}),
    tasks: kind === "request" ? xmlArray<Entry>(node, "tm:task").map(parseEntry) : []
  }
}

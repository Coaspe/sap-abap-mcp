import type { TransportObject } from "abap-adt-api"

export type AtcTransportTarget =
  | { kind: "target"; type: string; name: string }
  | { kind: "include" | "function"; name: string }
  | { kind: "skipped"; reason: string }

const dictionaryTransportTypes = new Map([["DTED", "DTEL"], ["TABD", "TABL"], ["DOMD", "DOMA"], ["TTYD", "TTYP"]])

export function dictionaryTransportOwnerType(pgmid: string, type: string): string | undefined {
  return pgmid === "LIMU" ? dictionaryTransportTypes.get(type) : undefined
}

/** Map CTS object keys without making SAP calls. Ownership lookups happen separately. */
export function normalizeAtcTransportTarget(object: Pick<TransportObject, "tm:pgmid" | "tm:type" | "tm:name">): AtcTransportTarget {
  const pgmid = object["tm:pgmid"].trim().toUpperCase()
  const type = object["tm:type"].trim().toUpperCase()
  const rawName = object["tm:name"].toUpperCase()
  const name = rawName.trim()
  if (pgmid === "CORR") return { kind: "skipped", reason: "Correction entries are not ATC targets" }
  if (pgmid === "LIMU" && ["DYNP", "REPT", "CUAD"].includes(type)) return { kind: "target", type: "PROG", name: rawName.slice(0, 40).trimEnd() }
  const dictionaryOwner = dictionaryTransportOwnerType(pgmid, type)
  if (dictionaryOwner) return { kind: "target", type: dictionaryOwner, name }
  if (pgmid === "LIMU" && type === "FUNC") return { kind: "function", name }
  if ((pgmid === "LIMU" && type === "REPS") || (pgmid === "R3TR" && type === "PROG")) {
    const group = name.match(/^(\/[A-Z0-9_]+\/)?L([^/]+?)(?:TOP|UXX|U\d{2})$/)
    if (group) return { kind: "target", type: "FUGR", name: `${group[1] ?? ""}${group[2]}` }
    return { kind: "include", name }
  }
  if (pgmid === "R3TR" && ["CLAS", "INTF", "FUGR", "DTEL", "TABL", "TTYP", "DOMA", "DDLS", "DCLS", "DDLX", "DDLA", "BDEF", "SRVD", "SRVB", "PROG"].includes(type)) return { kind: "target", type, name }
  return { kind: "skipped", reason: `CTS object type ${pgmid}/${type} is not an ATC target` }
}

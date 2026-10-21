import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { Agent, request } from "node:https"
import { XMLParser, XMLValidator } from "fast-xml-parser"
import { AppError } from "./errors.js"
import { certificateFailure, profileHttpsAgent } from "./tls-trust.js"

export interface SapLogonEntry {
  name: string
  sid: string
  host?: string
  instance?: string
  candidates: string[]
  issue?: string
}
export interface SapLogonImport { entries: SapLogonEntry[]; skipped: string[] }
export function defaultSapLogonFile(): string {
  return join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "SAP", "Common", "SAPUILandscape.xml")
}
function httpsUrl(value: string): string | undefined {
  try {
    const url = new URL(value)
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return undefined
    return url.href.replace(/\/$/, "")
  } catch { return undefined }
}
function hostInstance(server: string, messageServer: boolean): { host?: string; instance?: string } {
  const match = /^([a-zA-Z0-9_.-]+)(?::(\d+|sapdp\d{2}|sapms\w+))?$/.exec(server)
  if (!match) return {}
  const port = match[2] ?? ""
  const instance = (messageServer ? /^36(\d{2})$/ : /^(?:32|sapdp)(\d{2})$/).exec(port)?.[1]
  return { host: match[1]!, ...(instance ? { instance } : {}) }
}

export async function importSapLogon(file = defaultSapLogonFile()): Promise<SapLogonImport> {
  const services: any[] = [], messages: any[] = [], dispatchers: any[] = []
  const skipped: string[] = []
  const visited = new Set<string>()
  async function load(path: string, optional = false): Promise<void> {
    path = resolve(path)
    if (visited.has(path)) return
    if (visited.size >= 32) throw new AppError("SAPLOGON_INVALID", "Too many SAP landscape includes")
    visited.add(path)
    let xml: string
    try { xml = await readFile(path, "utf8") } catch (error) {
      if (optional && (error as NodeJS.ErrnoException).code === "ENOENT") return
      throw new AppError("SAPLOGON_FILE_UNREADABLE", "Cannot read the local SAP UI Landscape file")
    }
    if (Buffer.byteLength(xml) > 2 * 1024 * 1024 || /<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true) throw new AppError("SAPLOGON_INVALID", "Invalid SAP landscape XML (maximum 2 MiB, no DTD or entities)")
    const document = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "", parseAttributeValue: false, processEntities: false }).parse(xml)
    const includes: string[] = []
    function walk(value: any): void {
      if (!value || typeof value !== "object") return
      for (const [key, child] of Object.entries(value)) {
        const items = Array.isArray(child) ? child : [child]
        if (key === "Service") services.push(...items)
        else if (key === "Messageserver") messages.push(...items)
        else if (key === "Webdispatcher") dispatchers.push(...items)
        else if (key === "Include") {
          for (const item of items) if (item && typeof item === "object" && typeof (item as any).url === "string") includes.push((item as any).url)
        } else if (!["Memo", "Router"].includes(key)) walk(child)
      }
    }
    walk(document)
    for (const include of includes) {
      if (/^[a-z][a-z0-9+.-]*:/i.test(include) && !/^file:/i.test(include)) { skipped.push("Remote include skipped"); continue }
      if (/^[\\]{2}|^\/\//.test(include)) { skipped.push("Remote include skipped"); continue }
      let local: string
      try {
        if (/^file:/i.test(include) && !["", "localhost"].includes(new URL(include).hostname)) { skipped.push("Remote include skipped"); continue }
        local = /^file:/i.test(include) ? fileURLToPath(include) : resolve(dirname(path), include)
      }
      catch { skipped.push("Invalid local include skipped"); continue }
      await load(local)
    }
  }
  await load(file)
  await load(join(dirname(resolve(file)), "SAPUILandscapeGlobal.xml"), true)
  const entries = services.filter(service => service.type === "SAPGUI").map(service => {
    const sid = typeof service.systemid === "string" ? service.systemid : ""
    const name = typeof service.name === "string" ? service.name : sid
    const mode = String(service.mode ?? (service.msid ? "0" : "1"))
    if (mode === "2" || !["0", "1"].includes(mode)) return { name, sid, candidates: [], issue: "Unsupported SAP GUI mode" }
    const message = messages.find(item => item.uuid === service.msid)
    const server = mode === "0" ? message ? `${message.host}${message.port ? `:${message.port}` : ""}` : "" : String(service.server ?? "")
    const target = hostInstance(server, mode === "0")
    const candidates: string[] = []
    if (service.msid) for (const dispatcher of dispatchers.filter(item => item.msid === service.msid)) {
      const url = typeof dispatcher.url === "string" ? httpsUrl(dispatcher.url) : undefined
      if (url) candidates.push(url)
    }
    if (target.host) {
      if (target.instance) candidates.push(`https://${target.host}:443${target.instance}`)
      candidates.push(`https://${target.host}:44300`)
    }
    return { name, sid, ...target, candidates: [...new Set(candidates)],
      ...(service.routerid ? { issue: "SAP Router routes are not HTTPS endpoints; confirm the ADT URL with your administrator" } : {}) }
  })
  return { entries, skipped }
}

export function classifyDiscoveryResponse(status: number, contentType: string): boolean {
  return status === 401 || status === 200 && ["application/atomsvc+xml", "application/xml", "text/xml"].includes(contentType.split(";")[0]!.trim().toLowerCase())
}
export async function probeAdtCandidate(candidate: string, caFile?: string): Promise<{ url: string; adt: boolean; status?: number; code?: string }> {
  const base = httpsUrl(candidate)
  if (!base) throw new AppError("SAPLOGON_URL_INVALID", "SAP ADT candidates must use HTTPS without credentials, query or fragment")
  const agent = caFile ? profileHttpsAgent(caFile) : new Agent({ rejectUnauthorized: true })
  return new Promise(resolve => {
    let finished = false
    const finish = (value: { url: string; adt: boolean; status?: number; code?: string }) => {
      if (finished) return
      finished = true
      clearTimeout(timeout)
      agent.destroy()
      resolve(value)
    }
    const req = request(new URL("/sap/bc/adt/discovery", base), { agent, method: "GET", headers: { Accept: "application/atomsvc+xml, application/xml" } }, response => {
      const status = response.statusCode ?? 0
      response.destroy()
      finish({ url: base, adt: classifyDiscoveryResponse(status, response.headers["content-type"] ?? ""), status })
    })
    const timeout = setTimeout(() => { finish({ url: base, adt: false, code: "SAPLOGON_PROBE_TIMEOUT" }); req.destroy() }, 5000)
    req.on("error", error => finish({ url: base, adt: false, code: certificateFailure(error)?.code ?? "SAPLOGON_PROBE_FAILED" }))
    req.end()
  })
}

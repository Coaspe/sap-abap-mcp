import { ADTClient, type SearchResult } from "abap-adt-api"
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

  constructor(
    readonly profile: SapProfile,
    password: string
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
    const candidates: string[] = []

    try {
      const structure = await this.client.objectStructure(object.uri)
      candidates.push(ADTClient.mainInclude(structure))
    } catch {
      // Older backends can reject object structure for some object types.
    }

    if (ADTClient.isMainInclude(object.uri)) candidates.push(object.uri)
    else candidates.push(`${object.uri.replace(/\/+$/, "")}/source/main`, object.uri)

    let lastError: unknown
    for (const sourceUri of [...new Set(candidates)]) {
      try {
        const source = await this.client.getObjectSource(sourceUri)
        return { source, sourceUri, object }
      } catch (error) {
        lastError = error
      }
    }

    throw new AppError("SOURCE_READ_FAILED", `Could not read source for ${object.name}`, {
      objectType: object.type,
      objectUri: object.uri,
      cause: lastError instanceof Error ? lastError.message : String(lastError)
    })
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

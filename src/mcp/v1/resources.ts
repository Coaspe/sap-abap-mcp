import {
  McpServer,
  ResourceTemplate,
  type ReadResourceCallback,
  type ReadResourceTemplateCallback,
  type RegisteredResource,
  type RegisteredResourceTemplate,
  type ResourceMetadata
} from "@modelcontextprotocol/sdk/server/mcp.js"
import {
  ErrorCode,
  McpError,
  ReadResourceRequestSchema,
  type ReadResourceResult
} from "@modelcontextprotocol/sdk/types.js"
import { AppError } from "../../errors.js"
import {
  assertRawV1ResourceUri,
  parseAdtResourceUri,
  parseCapabilityResourceUri
} from "./resource-uri.js"
import { sanitizeV1Message } from "./result.js"
import type { V1ReadService } from "./service.js"

interface RegisterResource {
  (
    name: string,
    uri: string,
    config: ResourceMetadata,
    callback: ReadResourceCallback
  ): RegisteredResource
  (
    name: string,
    template: ResourceTemplate,
    config: ResourceMetadata,
    callback: ReadResourceTemplateCallback
  ): RegisteredResourceTemplate
}

interface FixedResourceEntry {
  uri: () => string | null
  resource: RegisteredResource
}

interface TemplateResourceEntry {
  active: () => boolean
  resource: RegisteredResourceTemplate
  rawUriResolver?: (value: string) => string | undefined
}

interface V1ResourceDispatcher {
  installReadHandler(): void
  setRawUriResolver(
    resource: RegisteredResourceTemplate,
    resolver: (value: string) => string | undefined
  ): void
}

async function readCapabilityResource(
  value: string,
  service: V1ReadService
): Promise<ReadResourceResult> {
  const { systemId, canonicalUri } = parseCapabilityResourceUri(value)
  const result = await service.getSapCapabilities(systemId, undefined, true)
  const { connectionId: _connectionId, ...data } = result
  const sanitizedData = {
    ...data,
    systemMetadata: {
      ...data.systemMetadata,
      warnings: data.systemMetadata.warnings.map(sanitizeV1Message)
    },
    capabilities: data.capabilities.map(capability => {
      const evidence = (capability as typeof capability & {
        evidence?: string[]
      }).evidence
      return {
        ...capability,
        ...(evidence === undefined
          ? {}
          : { evidence: evidence.map(sanitizeV1Message) })
      }
    })
  }
  return {
    contents: [{
      uri: canonicalUri,
      mimeType: "application/json",
      text: JSON.stringify(sanitizedData)
    }]
  }
}

async function readAdtResource(
  value: string,
  service: V1ReadService
): Promise<ReadResourceResult> {
  const { systemId, adtPath, canonicalUri } = parseAdtResourceUri(value)
  const result = await service.getObjectByUri({
    connectionId: systemId,
    uri: adtPath,
    startLine: 0,
    lineCount: Number.MAX_SAFE_INTEGER
  })
  return {
    contents: [{
      uri: canonicalUri,
      mimeType: "text/x-abap",
      text: result.code,
      _meta: {
        startLine: result.startLine,
        endLine: result.endLine,
        totalLines: result.totalLines,
        truncated: result.truncated,
        nextLine: result.nextLine
      }
    }]
  }
}

function protocolError(code: number, message: string): McpError {
  const error = new McpError(code, message)
  error.message = message
  return error
}

function unprefixedMcpMessage(error: McpError): string {
  const prefix = `MCP error ${error.code}: `
  let message = error.message
  while (message.startsWith(prefix)) message = message.slice(prefix.length)
  return message
}

function resourceError(error: unknown): McpError {
  const message = sanitizeV1Message(
    error instanceof McpError
      ? unprefixedMcpMessage(error)
      : error instanceof Error
        ? error.message
        : String(error)
  ) || "Resource read failed"
  if (error instanceof McpError) return protocolError(error.code, message)
  if (error instanceof AppError && error.code === "INVALID_ADT_URI") {
    return protocolError(ErrorCode.InvalidParams, message)
  }
  return protocolError(ErrorCode.InternalError, message)
}

function rawScheme(value: string): string {
  const separator = value.indexOf(":")
  return separator < 0 ? "" : value.slice(0, separator).toLowerCase()
}

function installV1ResourceDispatcher(server: McpServer): V1ResourceDispatcher {
  const fixedResources: FixedResourceEntry[] = []
  const templateResources: TemplateResourceEntry[] = []
  const sdkRegisterResource = server.registerResource.bind(server) as RegisterResource

  const registerFixed = (
    name: string,
    initialUri: string,
    config: ResourceMetadata,
    callback: ReadResourceCallback
  ): RegisteredResource => {
    let currentUri: string | null = initialUri
    const resource = sdkRegisterResource(name, initialUri, config, callback)
    const sdkUpdate = resource.update.bind(resource)
    resource.update = updates => {
      sdkUpdate(updates)
      if (updates.uri !== undefined) currentUri = updates.uri
    }
    fixedResources.push({ uri: () => currentUri, resource })
    return resource
  }

  const registerTemplate = (
    initialName: string,
    template: ResourceTemplate,
    config: ResourceMetadata,
    callback: ReadResourceTemplateCallback
  ): RegisteredResourceTemplate => {
    let active = true
    const resource = sdkRegisterResource(initialName, template, config, callback)
    const sdkUpdate = resource.update.bind(resource)
    resource.update = updates => {
      sdkUpdate(updates)
      if (updates.name !== undefined) active = updates.name !== null
    }
    templateResources.push({ active: () => active, resource })
    return resource
  }

  server.registerResource = ((
    name: string,
    uriOrTemplate: string | ResourceTemplate,
    config: ResourceMetadata,
    callback: ReadResourceCallback | ReadResourceTemplateCallback
  ) => typeof uriOrTemplate === "string"
    ? registerFixed(name, uriOrTemplate, config, callback as ReadResourceCallback)
    : registerTemplate(
        name,
        uriOrTemplate,
        config,
        callback as ReadResourceTemplateCallback
      )) as McpServer["registerResource"]

  const readTemplate = async (
    entry: TemplateResourceEntry,
    uri: URL,
    extra: Parameters<ReadResourceTemplateCallback>[2]
  ): Promise<ReadResourceResult | undefined> => {
    const canonicalUri = uri.toString()
    const variables = entry.resource.resourceTemplate.uriTemplate.match(canonicalUri)
    if (!variables) return undefined
    if (!entry.resource.enabled) {
      throw new AppError("INVALID_ADT_URI", `Resource ${canonicalUri} disabled`)
    }
    return await entry.resource.readCallback(uri, variables, extra)
  }

  return {
    setRawUriResolver(resource, resolver) {
      const entry = templateResources.find(candidate => candidate.resource === resource)
      if (!entry) throw new Error("Resource template is not registered")
      entry.rawUriResolver = resolver
    },
    installReadHandler() {
      server.server.setRequestHandler(
        ReadResourceRequestSchema,
        async (request, extra) => {
          try {
            const value = request.params.uri
            assertRawV1ResourceUri(value)

            for (const entry of templateResources) {
              if (!entry.active() || !entry.rawUriResolver) continue
              const canonical = entry.rawUriResolver(value)
              if (canonical === undefined) continue
              const result = await readTemplate(entry, new URL(canonical), extra)
              if (result !== undefined) return result
            }

            let uri: URL
            try {
              uri = new URL(value)
            } catch {
              throw new AppError("INVALID_ADT_URI", "Resource URI is malformed")
            }
            const canonicalUri = uri.toString()
            const fixed = fixedResources.find(entry => entry.uri() === canonicalUri)
            if (fixed) {
              if (!fixed.resource.enabled) {
                throw new AppError(
                  "INVALID_ADT_URI",
                  `Resource ${canonicalUri} disabled`
                )
              }
              return await fixed.resource.readCallback(uri, extra)
            }

            for (const entry of templateResources) {
              if (!entry.active() || entry.rawUriResolver) continue
              const result = await readTemplate(entry, uri, extra)
              if (result !== undefined) return result
            }

            throw new AppError(
              "INVALID_ADT_URI",
              "Resource URI does not match a registered v1 template"
            )
          } catch (error) {
            throw resourceError(error)
          }
        }
      )
    }
  }
}

export function registerV1Resources(
  server: McpServer,
  service: V1ReadService
): void {
  const dispatcher = installV1ResourceDispatcher(server)

  const capabilityResource = server.registerResource(
    "sap-capability-evidence",
    new ResourceTemplate("sap-capability://{system}", { list: undefined }),
    {
      title: "SAP Capability Evidence",
      description: "Complete capability discovery evidence for one SAP system.",
      mimeType: "application/json"
    },
    uri => readCapabilityResource(uri.toString(), service)
  )
  dispatcher.setRawUriResolver(
    capabilityResource,
    value => rawScheme(value) === "sap-capability"
      ? parseCapabilityResourceUri(value).canonicalUri
      : undefined
  )

  const adtResource = server.registerResource(
    "sap-adt-source",
    new ResourceTemplate("adt://{system}/{+adtPath}", { list: undefined }),
    {
      title: "SAP ABAP Source",
      description: "Complete active ABAP source for one canonical ADT resource.",
      mimeType: "text/x-abap"
    },
    uri => readAdtResource(uri.toString(), service)
  )
  dispatcher.setRawUriResolver(
    adtResource,
    value => rawScheme(value) === "adt"
      ? parseAdtResourceUri(value).canonicalUri
      : undefined
  )

  dispatcher.installReadHandler()
}

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
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
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
  uri: string | null
  readUri: string | null
  resource: RegisteredResource
}

interface TemplateResourceEntry {
  name: string | null
  resource: RegisteredResourceTemplate
}

interface V1ResourceDispatcher {
  installRequestHandlers(): void
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

function canonicalResourceUrl(value: string): URL {
  assertRawV1ResourceUri(value)
  const scheme = rawScheme(value)
  if (scheme === "adt") return new URL(parseAdtResourceUri(value).canonicalUri)
  if (scheme === "sap-capability") {
    return new URL(parseCapabilityResourceUri(value).canonicalUri)
  }
  try {
    return new URL(value)
  } catch {
    throw new AppError("INVALID_ADT_URI", "Resource URI is malformed")
  }
}

function fixedReadUri(value: string): string {
  const scheme = rawScheme(value)
  if (scheme !== "adt" && scheme !== "sap-capability") return value
  try {
    return canonicalResourceUrl(value).toString()
  } catch {
    return value
  }
}

function currentMetadata(resource: {
  title?: string
  metadata?: ResourceMetadata
}): ResourceMetadata {
  return {
    ...(resource.metadata ?? {}),
    ...(resource.title === undefined ? {} : { title: resource.title })
  }
}

function installV1ResourceDispatcher(server: McpServer): V1ResourceDispatcher {
  const fixedResources: FixedResourceEntry[] = []
  const templateResources: TemplateResourceEntry[] = []
  const sdkRegisterResource = server.registerResource.bind(server) as RegisterResource

  const assertFixedUriAvailable = (
    uri: string,
    excluded?: FixedResourceEntry
  ): void => {
    const readUri = fixedReadUri(uri)
    if (fixedResources.some(entry =>
      entry !== excluded && entry.uri !== null && entry.readUri === readUri
    )) {
      throw new Error(`Resource ${uri} is already registered`)
    }
  }

  const assertTemplateNameAvailable = (
    name: string,
    excluded?: TemplateResourceEntry
  ): void => {
    if (templateResources.some(entry =>
      entry !== excluded && entry.name === name
    )) {
      throw new Error(`Resource template ${name} is already registered`)
    }
  }

  const registerFixed = (
    name: string,
    initialUri: string,
    config: ResourceMetadata,
    callback: ReadResourceCallback
  ): RegisteredResource => {
    assertFixedUriAvailable(initialUri)
    const resource = sdkRegisterResource(name, initialUri, config, callback)
    const entry: FixedResourceEntry = {
      uri: initialUri,
      readUri: fixedReadUri(initialUri),
      resource
    }
    let attachedToSdkRegistry = true
    const sdkUpdate = resource.update.bind(resource)
    resource.update = updates => {
      const { uri, ...surfaceUpdates } = updates
      if (uri !== undefined && uri !== null) {
        assertFixedUriAvailable(uri, entry)
      }
      if (Object.keys(surfaceUpdates).length > 0) sdkUpdate(surfaceUpdates)
      if (uri !== undefined && uri !== entry.uri) {
        if (attachedToSdkRegistry) {
          sdkUpdate({ uri: null })
          attachedToSdkRegistry = false
        }
        entry.uri = uri
        entry.readUri = uri === null ? null : fixedReadUri(uri)
        server.sendResourceListChanged()
      }
    }
    fixedResources.push(entry)
    return resource
  }

  const registerTemplate = (
    initialName: string,
    template: ResourceTemplate,
    config: ResourceMetadata,
    callback: ReadResourceTemplateCallback
  ): RegisteredResourceTemplate => {
    assertTemplateNameAvailable(initialName)
    const resource = sdkRegisterResource(initialName, template, config, callback)
    const entry: TemplateResourceEntry = { name: initialName, resource }
    let attachedToSdkRegistry = true
    const sdkUpdate = resource.update.bind(resource)
    resource.update = updates => {
      const { name, ...surfaceUpdates } = updates
      if (name !== undefined && name !== null) {
        assertTemplateNameAvailable(name, entry)
      }
      if (Object.keys(surfaceUpdates).length > 0) sdkUpdate(surfaceUpdates)
      if (name !== undefined && name !== entry.name) {
        if (attachedToSdkRegistry) {
          sdkUpdate({ name: null })
          attachedToSdkRegistry = false
        }
        entry.name = name
        server.sendResourceListChanged()
      }
    }
    templateResources.push(entry)
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
    installRequestHandlers() {
      server.server.setRequestHandler(
        ListResourcesRequestSchema,
        async (_request, extra) => {
          const resources = fixedResources
            .filter(entry => entry.uri !== null && entry.resource.enabled)
            .map(entry => ({
              uri: entry.uri as string,
              name: entry.resource.name,
              ...currentMetadata(entry.resource)
            }))

          for (const entry of templateResources) {
            if (entry.name === null) continue
            const list = entry.resource.resourceTemplate.listCallback
            if (!list) continue
            const result = await list(extra)
            const metadata = currentMetadata(entry.resource)
            for (const resource of result.resources) {
              resources.push({ ...metadata, ...resource })
            }
          }
          return { resources }
        }
      )

      server.server.setRequestHandler(
        ListResourceTemplatesRequestSchema,
        async () => ({
          resourceTemplates: templateResources
            .filter(entry => entry.name !== null)
            .map(entry => ({
              name: entry.name as string,
              uriTemplate: entry.resource.resourceTemplate.uriTemplate.toString(),
              ...currentMetadata(entry.resource)
            }))
        })
      )

      server.server.setRequestHandler(
        ReadResourceRequestSchema,
        async (request, extra) => {
          try {
            const uri = canonicalResourceUrl(request.params.uri)
            const canonicalUri = uri.toString()
            const fixed = fixedResources.find(entry =>
              entry.uri !== null && entry.readUri === canonicalUri
            )
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
              if (entry.name === null) continue
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

  server.registerResource(
    "sap-capability-evidence",
    new ResourceTemplate("sap-capability://{system}", { list: undefined }),
    {
      title: "SAP Capability Evidence",
      description: "Complete capability discovery evidence for one SAP system.",
      mimeType: "application/json"
    },
    uri => readCapabilityResource(uri.toString(), service)
  )

  server.registerResource(
    "sap-adt-source",
    new ResourceTemplate("adt://{system}/{+adtPath}", { list: undefined }),
    {
      title: "SAP ABAP Source",
      description: "Complete active ABAP source for one canonical ADT resource.",
      mimeType: "text/x-abap"
    },
    uri => readAdtResource(uri.toString(), service)
  )

  dispatcher.installRequestHandlers()
}

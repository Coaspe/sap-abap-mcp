import {
  ResourceTemplate,
  type McpServer,
  type ReadResourceCallback,
  type ReadResourceTemplateCallback,
  type RegisteredResource,
  type RegisteredResourceTemplate,
  type ResourceMetadata
} from "@modelcontextprotocol/sdk/server/mcp.js"
import { UriTemplate } from "@modelcontextprotocol/sdk/shared/uriTemplate.js"
import {
  ErrorCode,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  McpError,
  ReadResourceRequestSchema
} from "@modelcontextprotocol/sdk/types.js"
import { AppError } from "../../errors.js"
import type {
  V1CompletionRouter,
  V1ResourceCompletionProvider
} from "./completion-router.js"
import {
  assertRawV1ResourceUri,
  parseAdtResourceUri,
  parseCapabilityResourceUri,
  parseDocsResourceUri,
  parseEvidenceResourceUri,
  parseTransportResourceUri
} from "./resource-uri.js"
import { toV1ProtocolError } from "./result.js"

interface FixedEntry {
  displayUri: string | null
  canonicalUri: string | null
  resource: RegisteredResource
}

interface TemplateEntry {
  name: string | null
  resource: RegisteredResourceTemplate
}

export interface V1ResourceRegistry {
  registerFixed(
    name: string,
    uri: string,
    metadata: ResourceMetadata,
    callback: ReadResourceCallback
  ): RegisteredResource
  registerTemplate(
    name: string,
    template: ResourceTemplate,
    metadata: ResourceMetadata,
    callback: ReadResourceTemplateCallback
  ): RegisteredResourceTemplate
}

interface RegisterResourceAdapter {
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
  if (scheme === "sap-docs") {
    return new URL(parseDocsResourceUri(value).canonicalUri)
  }
  if (scheme === "sap-evidence") {
    return new URL(parseEvidenceResourceUri(value).canonicalUri)
  }
  if (scheme === "sap-transport") {
    return new URL(parseTransportResourceUri(value).canonicalUri)
  }
  try {
    return new URL(value)
  } catch {
    throw new AppError("INVALID_ADT_URI", "Resource URI is malformed")
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

function invalidParams(message: string): McpError {
  return new McpError(ErrorCode.InvalidParams, message)
}

export function installV1ResourceRegistry(
  server: McpServer,
  router: V1CompletionRouter
): V1ResourceRegistry {
  server.server.assertCanSetRequestHandler("resources/list")
  server.server.assertCanSetRequestHandler("resources/templates/list")
  server.server.assertCanSetRequestHandler("resources/read")

  const fixedEntries: FixedEntry[] = []
  const templateEntries: TemplateEntry[] = []

  const assertFixedUriAvailable = (
    canonicalUri: string,
    excluded?: FixedEntry
  ): void => {
    if (fixedEntries.some(entry =>
      entry !== excluded && entry.canonicalUri === canonicalUri
    )) {
      throw invalidParams(`Resource ${canonicalUri} is already registered`)
    }
  }

  const assertTemplateNameAvailable = (
    name: string,
    excluded?: TemplateEntry
  ): void => {
    if (templateEntries.some(entry =>
      entry !== excluded && entry.name === name
    )) {
      throw invalidParams(`Resource template ${name} is already registered`)
    }
  }

  const updateFixed = (
    entry: FixedEntry,
    updates: Parameters<RegisteredResource["update"]>[0]
  ): void => {
    const nextDisplayUri = updates.uri === undefined
      ? entry.displayUri
      : updates.uri
    const nextCanonicalUri = nextDisplayUri === null
      ? null
      : canonicalResourceUrl(nextDisplayUri).toString()
    if (nextCanonicalUri !== null) {
      assertFixedUriAvailable(nextCanonicalUri, entry)
    }

    const resource = entry.resource
    const changed =
      nextDisplayUri !== entry.displayUri ||
      (updates.name !== undefined && updates.name !== resource.name) ||
      (updates.title !== undefined && updates.title !== resource.title) ||
      (updates.metadata !== undefined && updates.metadata !== resource.metadata) ||
      (updates.callback !== undefined && updates.callback !== resource.readCallback) ||
      (updates.enabled !== undefined && updates.enabled !== resource.enabled)
    if (!changed) return

    entry.displayUri = nextDisplayUri
    entry.canonicalUri = nextCanonicalUri
    if (updates.name !== undefined) resource.name = updates.name
    if (updates.title !== undefined) resource.title = updates.title
    if (updates.metadata !== undefined) resource.metadata = updates.metadata
    if (updates.callback !== undefined) resource.readCallback = updates.callback
    if (updates.enabled !== undefined) resource.enabled = updates.enabled
    server.sendResourceListChanged()
  }

  const registerFixed = (
    name: string,
    displayUri: string,
    metadata: ResourceMetadata,
    callback: ReadResourceCallback
  ): RegisteredResource => {
    const canonicalUri = canonicalResourceUrl(displayUri).toString()
    assertFixedUriAvailable(canonicalUri)

    let entry: FixedEntry
    const resource: RegisteredResource = {
      name,
      ...(metadata.title === undefined ? {} : { title: metadata.title }),
      metadata,
      readCallback: callback,
      enabled: true,
      enable() {
        updateFixed(entry, { enabled: true })
      },
      disable() {
        updateFixed(entry, { enabled: false })
      },
      update(updates) {
        updateFixed(entry, updates)
      },
      remove() {
        updateFixed(entry, { uri: null })
      }
    }
    entry = { displayUri, canonicalUri, resource }
    fixedEntries.push(entry)
    server.sendResourceListChanged()
    return resource
  }

  const updateTemplate = (
    entry: TemplateEntry,
    updates: Parameters<RegisteredResourceTemplate["update"]>[0]
  ): void => {
    const nextName = updates.name === undefined ? entry.name : updates.name
    if (nextName !== null) assertTemplateNameAvailable(nextName, entry)

    const resource = entry.resource
    const changed =
      nextName !== entry.name ||
      (updates.title !== undefined && updates.title !== resource.title) ||
      (updates.template !== undefined &&
        updates.template !== resource.resourceTemplate) ||
      (updates.metadata !== undefined && updates.metadata !== resource.metadata) ||
      (updates.callback !== undefined && updates.callback !== resource.readCallback) ||
      (updates.enabled !== undefined && updates.enabled !== resource.enabled)
    if (!changed) return

    entry.name = nextName
    if (updates.title !== undefined) resource.title = updates.title
    if (updates.template !== undefined) resource.resourceTemplate = updates.template
    if (updates.metadata !== undefined) resource.metadata = updates.metadata
    if (updates.callback !== undefined) resource.readCallback = updates.callback
    if (updates.enabled !== undefined) resource.enabled = updates.enabled
    server.sendResourceListChanged()
  }

  const registerTemplate = (
    name: string,
    template: ResourceTemplate,
    metadata: ResourceMetadata,
    callback: ReadResourceTemplateCallback
  ): RegisteredResourceTemplate => {
    assertTemplateNameAvailable(name)

    let entry: TemplateEntry
    const resource: RegisteredResourceTemplate = {
      resourceTemplate: template,
      ...(metadata.title === undefined ? {} : { title: metadata.title }),
      metadata,
      readCallback: callback,
      enabled: true,
      enable() {
        updateTemplate(entry, { enabled: true })
      },
      disable() {
        updateTemplate(entry, { enabled: false })
      },
      update(updates) {
        updateTemplate(entry, updates)
      },
      remove() {
        updateTemplate(entry, { name: null })
      }
    }
    entry = { name, resource }
    templateEntries.push(entry)
    server.sendResourceListChanged()
    return resource
  }

  const registry: V1ResourceRegistry = { registerFixed, registerTemplate }

  server.registerResource = ((
    name: string,
    uriOrTemplate: string | ResourceTemplate,
    metadata: ResourceMetadata,
    callback: ReadResourceCallback | ReadResourceTemplateCallback
  ) => typeof uriOrTemplate === "string"
    ? registry.registerFixed(
        name,
        uriOrTemplate,
        metadata,
        callback as ReadResourceCallback
      )
    : registry.registerTemplate(
        name,
        uriOrTemplate,
        metadata,
        callback as ReadResourceTemplateCallback
      )) as RegisterResourceAdapter

  server.resource = ((
    name: string,
    uriOrTemplate: string | ResourceTemplate,
    metadataOrCallback:
      | ResourceMetadata
      | ReadResourceCallback
      | ReadResourceTemplateCallback,
    optionalCallback?: ReadResourceCallback | ReadResourceTemplateCallback
  ) => {
    const hasMetadata = typeof metadataOrCallback !== "function"
    const metadata = hasMetadata ? metadataOrCallback : {}
    const callback = hasMetadata ? optionalCallback : metadataOrCallback
    if (callback === undefined) {
      throw invalidParams("Resource read callback is required")
    }
    return typeof uriOrTemplate === "string"
      ? registry.registerFixed(
          name,
          uriOrTemplate,
          metadata,
          callback as ReadResourceCallback
        )
      : registry.registerTemplate(
          name,
          uriOrTemplate,
          metadata,
          callback as ReadResourceTemplateCallback
        )
  }) as McpServer["resource"]

  server.server.registerCapabilities({ resources: { listChanged: true } })
  server.server.setRequestHandler(
    ListResourcesRequestSchema,
    async (_request, extra) => {
      try {
        const resources = fixedEntries
          .filter(entry => entry.displayUri !== null && entry.resource.enabled)
          .map(entry => ({
            uri: entry.displayUri as string,
            name: entry.resource.name,
            ...currentMetadata(entry.resource)
          }))

        for (const entry of templateEntries) {
          if (entry.name === null || !entry.resource.enabled) continue
          const list = entry.resource.resourceTemplate.listCallback
          if (list === undefined) continue
          const result = await list(extra)
          const metadata = currentMetadata(entry.resource)
          for (const listed of result.resources) {
            resources.push({ ...metadata, ...listed })
          }
        }
        return { resources }
      } catch (error) {
        throw toV1ProtocolError(error, "Resource list failed")
      }
    }
  )

  server.server.setRequestHandler(
    ListResourceTemplatesRequestSchema,
    async () => ({
      resourceTemplates: templateEntries
        .filter(entry => entry.name !== null && entry.resource.enabled)
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
        const fixed = fixedEntries.find(entry =>
          entry.canonicalUri === canonicalUri
        )
        if (fixed !== undefined) {
          if (!fixed.resource.enabled) {
            throw invalidParams(`Resource ${canonicalUri} is disabled`)
          }
          return await fixed.resource.readCallback(uri, extra)
        }

        for (const entry of templateEntries) {
          if (entry.name === null || !entry.resource.enabled) continue
          const variables = entry.resource.resourceTemplate.uriTemplate.match(
            canonicalUri
          )
          if (variables === null) continue
          return await entry.resource.readCallback(uri, variables, extra)
        }
        throw invalidParams("Resource URI is not registered")
      } catch (error) {
        throw toV1ProtocolError(error, "Resource read failed")
      }
    }
  )

  const completeResource: V1ResourceCompletionProvider = async request => {
    const reference = request.params.ref.uri
    assertRawV1ResourceUri(reference)
    let canonicalUri: string | undefined
    try {
      canonicalUri = canonicalResourceUrl(reference).toString()
    } catch (error) {
      if (!UriTemplate.isTemplate(reference)) throw error
    }

    const fixed = canonicalUri === undefined
      ? undefined
      : fixedEntries.find(entry => entry.canonicalUri === canonicalUri)
    if (fixed !== undefined) {
      if (!fixed.resource.enabled) {
        throw invalidParams(`Resource ${canonicalUri} is disabled`)
      }
      return []
    }

    for (const entry of templateEntries) {
      if (entry.name === null || !entry.resource.enabled) continue
      if (entry.resource.resourceTemplate.uriTemplate.toString() !== reference) {
        continue
      }
      const callback = entry.resource.resourceTemplate.completeCallback(
        request.params.argument.name
      )
      if (callback === undefined) return []
      const templateArguments = request.params.context?.arguments
      const context = templateArguments === undefined
        ? undefined
        : { arguments: templateArguments }
      return await callback(request.params.argument.value, context)
    }

    const kind = UriTemplate.isTemplate(reference) ? "template" : "URI"
    throw invalidParams(`Resource ${kind} ${reference} is not registered`)
  }
  router.setResourceProvider(completeResource)

  return registry
}

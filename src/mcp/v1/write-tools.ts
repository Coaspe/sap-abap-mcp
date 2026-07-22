import {
  McpServer,
  type ToolCallback
} from "@modelcontextprotocol/sdk/server/mcp.js"
import type {
  AnySchema,
  ZodRawShapeCompat
} from "@modelcontextprotocol/sdk/server/zod-compat.js"
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js"
import { z } from "zod"
import type { RapGeneratorContent } from "abap-adt-api"
import type { AbapToolService } from "../../tool-service.js"
import { V1_SCHEMA_VERSION } from "./contracts.js"
import { normalizeV1SystemId, parseAdtResourceUri } from "./resource-uri.js"
import { runV1Tool, v1Success } from "./result.js"

const SYSTEM_ID = z.string().min(1)
const NON_EMPTY = z.string().min(1)
const START_INDEX = z.number().int().min(0).default(0)
const MAX_RESULTS = z.number().int().min(1).max(500).default(50)

const writeOutputSchema = z.object({
  schemaVersion: z.literal(V1_SCHEMA_VERSION),
  requestId: z.string().min(1),
  status: z.literal("succeeded"),
  systemId: z.string().min(1).optional(),
  data: z.looseObject({}),
  warnings: z.array(z.never()).max(0)
})

const MUTATION_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: true
} satisfies ToolAnnotations

const CREATE_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true
} satisfies ToolAnnotations

const IDEMPOTENT_WRITE_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true
} satisfies ToolAnnotations

const rapContentSchema = z.object({
  metadata: z.object({
    package: NON_EMPTY,
    masterLanguage: NON_EMPTY.optional()
  }).strict().optional(),
  general: z.object({
    referenceObjectName: NON_EMPTY.optional(),
    description: z.string()
  }).strict(),
  businessObject: z.object({
    dataModelEntity: z.object({
      cdsName: NON_EMPTY,
      entityName: NON_EMPTY.optional()
    }).strict(),
    behavior: z.object({
      implementationType: NON_EMPTY,
      implementationClass: NON_EMPTY,
      draftTable: z.string()
    }).strict()
  }).strict(),
  serviceProjection: z.object({ name: NON_EMPTY }).strict(),
  businessService: z.object({
    serviceDefinition: z.object({ name: NON_EMPTY }).strict(),
    serviceBinding: z.object({
      name: NON_EMPTY,
      bindingType: NON_EMPTY
    }).strict()
  }).strict()
}).strict()

function resultData(result: unknown): {
  data: Record<string, unknown>
  systemId?: string
} {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new TypeError("The shared service returned a non-object result")
  }
  const { connectionId, ...data } = result as Record<string, unknown>
  return {
    data,
    ...(typeof connectionId === "string" && connectionId.length > 0
      ? { systemId: connectionId.toUpperCase() }
      : {})
  }
}

async function serviceResult(
  systemId: string | undefined,
  operation: (normalizedSystemId: string | undefined) => Promise<unknown>
) {
  return runV1Tool(async () => {
    const normalized = systemId === undefined
      ? undefined
      : normalizeV1SystemId(systemId)
    const result = resultData(await operation(normalized))
    const envelopeSystemId = normalized ?? result.systemId
    return v1Success(result.data, {
      ...(envelopeSystemId ? { systemId: envelopeSystemId } : {})
    })
  })
}

export function registerV1WriteTools(
  server: McpServer,
  service: AbapToolService,
  selected?: ReadonlySet<string>
): void {
  const registerTool = <InputArgs extends ZodRawShapeCompat | AnySchema>(
    name: string,
    title: string,
    description: string,
    inputSchema: InputArgs,
    annotations: ToolAnnotations,
    callback: ToolCallback<InputArgs>
  ) => {
    if (selected && !selected.has(name)) return
    server.registerTool(name, {
      title,
      description,
      inputSchema,
      outputSchema: writeOutputSchema,
      annotations
    }, callback)
  }

  registerTool(
    "sap.execution.execute",
    "Execute ABAP Application",
    "Execute one confirmed ABAP application plan.",
    z.object({
      systemId: SYSTEM_ID,
      planId: z.string().uuid(),
      confirmation: NON_EMPTY
    }).strict(),
    MUTATION_ANNOTATIONS,
    input => serviceResult(input.systemId, systemId => service.runAbapApplication({
      action: "execute",
      connectionId: systemId!,
      planId: input.planId,
      confirmation: input.confirmation
    }))
  )

  registerTool(
    "sap.git.branch.switch",
    "Switch abapGit Branch",
    "Switch or create one confirmed abapGit branch.",
    z.object({
      systemId: SYSTEM_ID,
      repositoryId: NON_EMPTY,
      branch: NON_EMPTY,
      createBranch: z.boolean().default(false),
      confirmation: NON_EMPTY
    }).strict(),
    MUTATION_ANNOTATIONS,
    input => serviceResult(input.systemId, systemId => service.manageAbapGit({
      action: "switch_branch",
      connectionId: systemId!,
      repositoryId: input.repositoryId,
      branch: input.branch,
      createBranch: input.createBranch,
      confirmation: input.confirmation,
      startIndex: 0,
      maxResults: 50
    }))
  )

  registerTool(
    "sap.git.create",
    "Create abapGit Repository",
    "Create one confirmed abapGit repository binding.",
    z.object({
      systemId: SYSTEM_ID,
      repositoryUrl: z.url(),
      packageName: NON_EMPTY,
      branch: NON_EMPTY.optional(),
      transport: NON_EMPTY.optional(),
      confirmation: NON_EMPTY
    }).strict(),
    CREATE_ANNOTATIONS,
    input => serviceResult(input.systemId, systemId => service.manageAbapGit({
      action: "create_repository",
      connectionId: systemId!,
      repositoryUrl: input.repositoryUrl,
      packageName: input.packageName,
      confirmation: input.confirmation,
      startIndex: 0,
      maxResults: 50,
      ...(input.branch ? { branch: input.branch } : {}),
      ...(input.transport ? { transport: input.transport } : {})
    }))
  )

  registerTool(
    "sap.git.pull",
    "Pull abapGit Repository",
    "Pull one confirmed abapGit repository.",
    z.object({
      systemId: SYSTEM_ID,
      repositoryId: NON_EMPTY,
      branch: NON_EMPTY.optional(),
      transport: NON_EMPTY.optional(),
      confirmation: NON_EMPTY
    }).strict(),
    MUTATION_ANNOTATIONS,
    input => serviceResult(input.systemId, systemId => service.manageAbapGit({
      action: "pull_repository",
      connectionId: systemId!,
      repositoryId: input.repositoryId,
      confirmation: input.confirmation,
      startIndex: 0,
      maxResults: 50,
      ...(input.branch ? { branch: input.branch } : {}),
      ...(input.transport ? { transport: input.transport } : {})
    }))
  )

  registerTool(
    "sap.git.push",
    "Push abapGit Repository",
    "Push a confirmed staged abapGit snapshot.",
    z.object({
      systemId: SYSTEM_ID,
      repositoryId: NON_EMPTY,
      stageId: NON_EMPTY,
      objectKeys: z.array(NON_EMPTY).max(1000).optional(),
      stageAll: z.boolean().default(false),
      comment: NON_EMPTY,
      authorName: NON_EMPTY.optional(),
      authorEmail: z.email().optional(),
      committerName: NON_EMPTY.optional(),
      committerEmail: z.email().optional(),
      confirmation: NON_EMPTY
    }).strict(),
    MUTATION_ANNOTATIONS,
    input => serviceResult(input.systemId, systemId => service.manageAbapGit({
      action: "push_repository",
      connectionId: systemId!,
      repositoryId: input.repositoryId,
      stageId: input.stageId,
      stageAll: input.stageAll,
      comment: input.comment,
      confirmation: input.confirmation,
      startIndex: 0,
      maxResults: 50,
      ...(input.objectKeys ? { objectKeys: input.objectKeys } : {}),
      ...(input.authorName ? { authorName: input.authorName } : {}),
      ...(input.authorEmail ? { authorEmail: input.authorEmail } : {}),
      ...(input.committerName ? { committerName: input.committerName } : {}),
      ...(input.committerEmail ? { committerEmail: input.committerEmail } : {})
    }))
  )

  registerTool(
    "sap.git.stage",
    "Stage abapGit Repository",
    "Create a bounded abapGit staging snapshot.",
    z.object({
      systemId: SYSTEM_ID,
      repositoryId: NON_EMPTY,
      startIndex: START_INDEX,
      limit: MAX_RESULTS
    }).strict(),
    CREATE_ANNOTATIONS,
    input => serviceResult(input.systemId, systemId => service.manageAbapGit({
      action: "stage_repository",
      connectionId: systemId!,
      repositoryId: input.repositoryId,
      startIndex: input.startIndex,
      maxResults: input.limit
    }))
  )

  registerTool(
    "sap.git.unlink",
    "Unlink abapGit Repository",
    "Unlink one confirmed abapGit repository.",
    z.object({
      systemId: SYSTEM_ID,
      repositoryId: NON_EMPTY,
      confirmation: NON_EMPTY
    }).strict(),
    MUTATION_ANNOTATIONS,
    input => serviceResult(input.systemId, systemId => service.manageAbapGit({
      action: "unlink_repository",
      connectionId: systemId!,
      repositoryId: input.repositoryId,
      confirmation: input.confirmation,
      startIndex: 0,
      maxResults: 50
    }))
  )

  registerTool(
    "sap.quality.test_include.create",
    "Create ABAP Test Include",
    "Create a class test include under existing write policy.",
    z.object({
      systemId: SYSTEM_ID,
      className: NON_EMPTY,
      transport: NON_EMPTY.optional()
    }).strict(),
    CREATE_ANNOTATIONS,
    input => serviceResult(input.systemId, systemId => service.createTestInclude(
      input.className,
      systemId!,
      input.transport
    ))
  )

  registerTool(
    "sap.rap.binding.publish",
    "Publish RAP Binding",
    "Publish one confirmed RAP service binding.",
    z.object({
      systemId: SYSTEM_ID,
      serviceBindingName: NON_EMPTY,
      confirmation: NON_EMPTY
    }).strict(),
    MUTATION_ANNOTATIONS,
    input => serviceResult(input.systemId, systemId => service.manageRap({
      action: "publish",
      connectionId: systemId!,
      serviceBindingName: input.serviceBindingName,
      confirmation: input.confirmation,
      contentOffset: 0,
      contentLength: 10000
    }))
  )

  registerTool(
    "sap.rap.binding.unpublish",
    "Unpublish RAP Binding",
    "Unpublish one confirmed RAP V2 service.",
    z.object({
      systemId: SYSTEM_ID,
      serviceBindingName: NON_EMPTY,
      serviceName: NON_EMPTY,
      serviceVersion: NON_EMPTY,
      confirmation: NON_EMPTY
    }).strict(),
    MUTATION_ANNOTATIONS,
    input => serviceResult(input.systemId, systemId => service.manageRap({
      action: "unpublish",
      connectionId: systemId!,
      serviceBindingName: input.serviceBindingName,
      serviceName: input.serviceName,
      serviceVersion: input.serviceVersion,
      confirmation: input.confirmation,
      contentOffset: 0,
      contentLength: 10000
    }))
  )

  registerTool(
    "sap.rap.generate",
    "Generate RAP Objects",
    "Generate the confirmed RAP preview object set.",
    z.object({
      systemId: SYSTEM_ID,
      generatorId: z.enum(["uiservice", "webapiservice"]),
      referenceObjectName: NON_EMPTY,
      referenceObjectType: NON_EMPTY.optional(),
      packageName: NON_EMPTY,
      content: rapContentSchema,
      transport: NON_EMPTY.optional(),
      confirmation: NON_EMPTY
    }).strict(),
    MUTATION_ANNOTATIONS,
    input => serviceResult(input.systemId, systemId => service.manageRap({
      action: "generate",
      connectionId: systemId!,
      generatorId: input.generatorId,
      referenceObjectName: input.referenceObjectName,
      packageName: input.packageName,
      content: input.content as RapGeneratorContent,
      confirmation: input.confirmation,
      contentOffset: 0,
      contentLength: 10000,
      ...(input.referenceObjectType
        ? { referenceObjectType: input.referenceObjectType }
        : {}),
      ...(input.transport ? { transport: input.transport } : {})
    }))
  )

  registerTool(
    "sap.refactor.execute",
    "Execute ABAP Refactoring",
    "Execute one confirmed fresh refactoring plan.",
    z.object({ planId: NON_EMPTY, confirmation: NON_EMPTY }).strict(),
    MUTATION_ANNOTATIONS,
    input => serviceResult(undefined, () => service.refactorCode({
      action: "execute",
      planId: input.planId,
      confirmation: input.confirmation,
      expectedPlanKind: "refactor"
    }))
  )

  registerTool(
    "sap.repository.delete.execute",
    "Delete SAP Repository Object",
    "Execute one confirmed fresh object-deletion plan from sap.repository.delete.preview.",
    z.object({ planId: NON_EMPTY, confirmation: NON_EMPTY }).strict(),
    MUTATION_ANNOTATIONS,
    input => serviceResult(undefined, () => service.refactorCode({
      action: "execute",
      planId: input.planId,
      confirmation: input.confirmation,
      expectedPlanKind: "delete"
    }))
  )

  registerTool(
    "sap.repository.create",
    "Create SAP Repository Object",
    "Create one ABAP repository object under existing policy.",
    z.object({
      systemId: SYSTEM_ID,
      objectType: NON_EMPTY,
      name: NON_EMPTY,
      description: z.string().min(1).max(60),
      packageName: NON_EMPTY.default("$TMP"),
      parentName: NON_EMPTY.optional(),
      source: z.string().optional(),
      activate: z.boolean().default(false),
      additionalOptions: z.object({
        serviceDefinition: NON_EMPTY.optional(),
        bindingType: z.literal("ODATA").optional(),
        bindingCategory: z.enum(["0", "1"]).optional(),
        softwareComponent: NON_EMPTY.optional(),
        packageType: z.enum(["development", "structure", "main"]).optional(),
        transportLayer: z.string().optional(),
        transportRequest: z.discriminatedUnion("type", [
          z.object({ type: z.literal("existing"), number: NON_EMPTY }).strict(),
          z.object({ type: z.literal("new"), description: NON_EMPTY }).strict()
        ]).optional()
      }).strict().optional()
    }).strict(),
    CREATE_ANNOTATIONS,
    input => serviceResult(input.systemId, systemId => service.createObjectProgrammatically({
      connectionId: systemId!,
      objectType: input.objectType,
      name: input.name,
      description: input.description,
      packageName: input.packageName,
      activate: input.activate,
      ...(input.parentName ? { parentName: input.parentName } : {}),
      ...(input.source !== undefined ? { source: input.source } : {}),
      ...(input.additionalOptions ? {
        additionalOptions: {
          ...(input.additionalOptions.serviceDefinition
            ? { serviceDefinition: input.additionalOptions.serviceDefinition }
            : {}),
          ...(input.additionalOptions.bindingType
            ? { bindingType: input.additionalOptions.bindingType }
            : {}),
          ...(input.additionalOptions.bindingCategory
            ? { bindingCategory: input.additionalOptions.bindingCategory }
            : {}),
          ...(input.additionalOptions.softwareComponent
            ? { softwareComponent: input.additionalOptions.softwareComponent }
            : {}),
          ...(input.additionalOptions.packageType
            ? { packageType: input.additionalOptions.packageType }
            : {}),
          ...(input.additionalOptions.transportLayer !== undefined
            ? { transportLayer: input.additionalOptions.transportLayer }
            : {}),
          ...(input.additionalOptions.transportRequest
            ? { transportRequest: input.additionalOptions.transportRequest }
            : {})
        }
      } : {})
    }))
  )

  registerTool(
    "sap.source.activate",
    "Activate ABAP Source",
    "Activate one or up to 100 same-system ABAP Resources.",
    z.object({
      systemId: SYSTEM_ID,
      resourceUris: z.array(NON_EMPTY).min(1).max(100)
    }).strict(),
    IDEMPOTENT_WRITE_ANNOTATIONS,
    input => serviceResult(input.systemId, async systemId => {
      const connectionId = systemId!
      const uris = input.resourceUris.map(value => {
        const parsed = parseAdtResourceUri(value)
        if (parsed.systemId !== connectionId) {
          throw new TypeError("Every Resource system must match systemId")
        }
        return parsed.canonicalUri
      })
      return service.activateObject(uris.length === 1
        ? { url: uris[0]!, connectionId }
        : { urls: uris, connectionId })
    })
  )

  registerTool(
    "sap.source.patch",
    "Patch ABAP Source",
    "Replace exactly one source fragment under existing write policy.",
    z.object({
      systemId: SYSTEM_ID,
      fileUri: NON_EMPTY,
      oldString: z.string(),
      newString: z.string(),
      transport: NON_EMPTY.optional(),
      activate: z.boolean().default(false)
    }).strict(),
    MUTATION_ANNOTATIONS,
    input => serviceResult(input.systemId, systemId => service.replaceStringInObject({
      connectionId: systemId!,
      fileUri: input.fileUri,
      oldString: input.oldString,
      newString: input.newString,
      activate: input.activate,
      ...(input.transport ? { transport: input.transport } : {})
    }))
  )

  registerTool(
    "sap.text_elements.write",
    "Write ABAP Text Elements",
    "Create or update one ABAP text-pool category.",
    z.object({
      systemId: SYSTEM_ID,
      objectName: NON_EMPTY,
      objectType: z.enum(["PROGRAM", "CLASS", "FUNCTION_GROUP"]),
      writeMode: z.enum(["create", "update"]),
      textElements: z.array(z.object({
        id: z.string().regex(/^[A-Z0-9_]{1,8}$/i),
        text: z.string().max(255),
        maxLength: z.number().int().min(1).max(255).optional()
      }).strict()).min(1),
      category: z.enum(["symbols", "selections", "headings"]).default("symbols"),
      transport: NON_EMPTY.optional()
    }).strict(),
    CREATE_ANNOTATIONS,
    input => serviceResult(input.systemId, systemId => service.manageTextElements({
      action: input.writeMode,
      connectionId: systemId!,
      objectName: input.objectName,
      objectType: input.objectType,
      textElements: input.textElements.map(item => ({
        id: item.id,
        text: item.text,
        ...(item.maxLength !== undefined ? { maxLength: item.maxLength } : {})
      })),
      category: input.category,
      ...(input.transport ? { transport: input.transport } : {})
    }))
  )

  registerTool(
    "sap.transport.create",
    "Create SAP Transport",
    "Create one SAP transport request.",
    z.object({
      systemId: SYSTEM_ID,
      description: NON_EMPTY,
      packageName: NON_EMPTY,
      transportLayer: z.string().optional()
    }).strict(),
    CREATE_ANNOTATIONS,
    input => serviceResult(input.systemId, systemId => service.manageTransportRequests({
      action: "create_transport",
      connectionId: systemId!,
      description: input.description,
      startIndex: 0,
      maxResults: 50,
      includeObjects: false,
      packageName: input.packageName,
      ...(input.transportLayer !== undefined
        ? { transportLayer: input.transportLayer }
        : {})
    }))
  )

  const registerTransportConfirmation = (
    name: string,
    title: string,
    action: "release_transport" | "delete_transport",
    releaseOptions = false
  ) => registerTool(
    name,
    title,
    `${title} after exact confirmation.`,
    z.object({
      systemId: SYSTEM_ID,
      transportNumber: NON_EMPTY,
      confirmation: NON_EMPTY,
      ...(releaseOptions ? {
        ignoreLocks: z.boolean().default(false),
        ignoreAtc: z.boolean().default(false)
      } : {})
    }).strict(),
    MUTATION_ANNOTATIONS,
    input => {
      const values = input as Record<string, unknown>
      return serviceResult(values.systemId as string, systemId => service.manageTransportRequests({
      action,
      connectionId: systemId!,
      transportNumber: values.transportNumber as string,
      confirmation: values.confirmation as string,
      startIndex: 0,
      maxResults: 50,
      includeObjects: false,
      ...(typeof values.ignoreLocks === "boolean"
        ? { ignoreLocks: values.ignoreLocks }
        : {}),
      ...(typeof values.ignoreAtc === "boolean" ? { ignoreAtc: values.ignoreAtc } : {})
      }))
    }
  )

  registerTransportConfirmation(
    "sap.transport.delete",
    "Delete SAP Transport",
    "delete_transport"
  )

  registerTool(
    "sap.transport.object.add",
    "Add SAP Transport Object",
    "Add one confirmed repository or subobject key to a transport.",
    z.object({
      systemId: SYSTEM_ID,
      transportNumber: NON_EMPTY,
      pgmid: NON_EMPTY,
      objectType: NON_EMPTY,
      objectName: NON_EMPTY,
      confirmation: NON_EMPTY
    }).strict(),
    CREATE_ANNOTATIONS,
    input => serviceResult(input.systemId, systemId => service.manageTransportRequests({
      action: "add_object",
      connectionId: systemId!,
      transportNumber: input.transportNumber,
      pgmid: input.pgmid,
      objectType: input.objectType,
      objectName: input.objectName,
      confirmation: input.confirmation,
      startIndex: 0,
      maxResults: 50,
      includeObjects: false
    }))
  )

  const registerTransportUser = (
    name: string,
    title: string,
    action: "set_owner" | "add_user"
  ) => registerTool(
    name,
    title,
    `${title} after exact confirmation.`,
    z.object({
      systemId: SYSTEM_ID,
      transportNumber: NON_EMPTY,
      targetUser: NON_EMPTY,
      confirmation: NON_EMPTY
    }).strict(),
    CREATE_ANNOTATIONS,
    input => serviceResult(input.systemId, systemId => service.manageTransportRequests({
      action,
      connectionId: systemId!,
      transportNumber: input.transportNumber,
      targetUser: input.targetUser,
      confirmation: input.confirmation,
      startIndex: 0,
      maxResults: 50,
      includeObjects: false
    }))
  )

  registerTransportUser(
    "sap.transport.owner.set",
    "Set SAP Transport Owner",
    "set_owner"
  )
  registerTransportConfirmation(
    "sap.transport.release",
    "Release SAP Transport",
    "release_transport",
    true
  )
  registerTransportUser(
    "sap.transport.user.add",
    "Add SAP Transport User",
    "add_user"
  )

  registerTool(
    "sap.version.restore.execute",
    "Execute ABAP Version Restore",
    "Execute one confirmed fresh version-restore plan.",
    z.object({
      systemId: SYSTEM_ID,
      planId: NON_EMPTY,
      confirmation: NON_EMPTY
    }).strict(),
    MUTATION_ANNOTATIONS,
    input => serviceResult(input.systemId, systemId => service.manageVersions({
      action: "execute_restore",
      connectionId: systemId!,
      planId: input.planId,
      confirmation: input.confirmation,
      activate: false,
      startIndex: 0,
      maxResults: 50,
      startLine: 1,
      lineCount: 200
    }))
  )
}

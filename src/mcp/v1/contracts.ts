import { z } from "zod"

export const V1_SCHEMA_VERSION = "1.0" as const

export const V1_WARNING_SCHEMA = z.object({
  code: z.string().min(1),
  message: z.string().min(1)
})

export const V1_PAGE_SCHEMA = z.object({
  nextCursor: z.string().min(1).optional(),
  returned: z.number().int().nonnegative(),
  total: z.number().int().nonnegative().optional()
})

export const V1_SUCCESS_SHAPE = {
  schemaVersion: z.literal(V1_SCHEMA_VERSION),
  requestId: z.string().min(1),
  status: z.enum(["succeeded", "partial"]),
  systemId: z.string().min(1).optional(),
  warnings: z.array(V1_WARNING_SCHEMA),
  evidence: z.record(z.string(), z.unknown()).optional(),
  page: V1_PAGE_SCHEMA.optional()
}

export const V1_ERROR_SCHEMA = z.object({
  schemaVersion: z.literal(V1_SCHEMA_VERSION),
  requestId: z.string().min(1),
  code: z.string().min(1),
  category: z.enum([
    "validation",
    "authentication",
    "authorization",
    "policy",
    "conflict",
    "capability",
    "sap",
    "transport",
    "internal"
  ]),
  message: z.string().min(1),
  retryable: z.boolean(),
  details: z.record(z.string(), z.unknown()).optional()
})

export type V1ErrorCategory = z.infer<typeof V1_ERROR_SCHEMA>["category"]

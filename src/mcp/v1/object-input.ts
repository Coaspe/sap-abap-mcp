import { z } from "zod"

/** SDK 1.x only advertises object roots; keep union validation and JSON branches. */
export function objectInput<T extends z.ZodType<Record<string, unknown>>>(schema: T): z.ZodType<z.output<T>, z.input<T>> {
  return z.looseObject({})
    .superRefine((value, context) => {
      const parsed = schema.safeParse(value)
      if (!parsed.success) {
        for (const issue of parsed.error.issues) context.addIssue({ ...issue })
      }
    })
    .overwrite(value => {
      const parsed = schema.safeParse(value)
      return parsed.success ? parsed.data : value
    })
    .meta(z.toJSONSchema(schema, { target: "draft-7", io: "input" })) as unknown as z.ZodType<z.output<T>, z.input<T>>
}

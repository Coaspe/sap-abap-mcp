import { z } from "zod"

const NON_EMPTY = z.string().min(1)

export const domainPropertiesSchema = z.object({
  typeInformation: z.object({
    datatype: NON_EMPTY,
    length: z.number().int().min(0),
    decimals: z.number().int().min(0)
  }).strict(),
  outputInformation: z.object({
    length: z.number().int().min(0),
    style: z.string().optional(),
    conversionExit: z.string().optional(),
    signExists: z.boolean(),
    lowercase: z.boolean(),
    ampmFormat: z.boolean()
  }).strict(),
  valueInformation: z.object({
    valueTableRef: z.string(),
    appendExists: z.boolean(),
    fixValues: z.array(z.object({
      low: z.string(),
      high: z.string().optional(),
      text: z.string().optional()
    }).strict()).max(1000).optional()
  }).strict().optional()
}).strict()

export const dataElementPropertiesSchema = z.object({
  typeName: z.string(),
  dataType: NON_EMPTY,
  dataTypeLength: z.number().int().min(0),
  dataTypeDecimals: z.number().int().min(0).optional(),
  fieldLabels: z.object({
    shortFieldLabel: z.string(),
    shortFieldLength: z.number().int().min(0).optional(),
    mediumFieldLabel: z.string(),
    mediumFieldLength: z.number().int().min(0).optional(),
    longFieldLabel: z.string(),
    longFieldLength: z.number().int().min(0).optional(),
    headingFieldLabel: z.string(),
    headingFieldLength: z.number().int().min(0).optional()
  }).strict(),
  searchHelp: z.string().optional(),
  searchHelpParameter: z.string().optional(),
  setGetParameter: z.string().optional(),
  defaultComponentName: z.string().optional(),
  deactivateInputHistory: z.boolean().optional(),
  changeDocument: z.boolean().optional(),
  leftToRightDirection: z.boolean().optional(),
  deactivateBIDIFiltering: z.boolean().optional()
}).strict()

import { ABAPObject, MemoryFile, Registry, Statements, Unknown } from "@abaplint/core"
import { AppError } from "./errors.js"

interface MethodRange {
  name: string
  startLine: number
  endLine: number
  start: number
  bodyStart: number
  bodyEnd: number
  end: number
}

export function findMethodRange(source: string, name: string): MethodRange | undefined {
  const offsets = [0]
  for (let i = 0; i < source.length; i++) if (source[i] === "\n") offsets.push(i + 1)
  const offset = (position: { getRow(): number; getCol(): number }) => offsets[position.getRow() - 1]! + position.getCol() - 1
  const registry = new Registry().addFile(new MemoryFile("zmethod.prog.abap", source)).parse()
  const methods: MethodRange[] = []
  let current: Omit<MethodRange, "bodyEnd" | "end" | "endLine"> | undefined
  let invalid = false
  for (const object of registry.getObjects()) {
    if (!(object instanceof ABAPObject)) continue
    for (const file of object.getABAPFiles()) for (const node of file.getStatements()) {
      const statement = node.get()
      if (statement instanceof Statements.MethodImplementation) {
        if (current) invalid = true
        const start = node.getFirstToken().getStart()
        current = { name: node.getTokens()[1]?.getStr().toUpperCase() ?? "", startLine: start.getRow(),
          start: offset(start), bodyStart: offset(node.getLastToken().getEnd()) }
      } else if (statement instanceof Statements.EndMethod) {
        if (!current) { invalid = true; continue }
        methods.push({ ...current, bodyEnd: offset(node.getFirstToken().getStart()),
          end: offset(node.getLastToken().getEnd()), endLine: node.getLastToken().getEnd().getRow() })
        current = undefined
      } else if (current && statement instanceof Unknown) invalid = true
    }
  }
  if (current || invalid) throw new AppError("SAP_VALIDATION_FAILED", "Method boundaries could not be parsed safely")
  const requested = name.trim().toUpperCase()
  const matches = methods.filter(method => method.name === requested || (!requested.includes("~") && method.name.endsWith(`~${requested}`)))
  if (matches.length > 1) throw new AppError("SAP_VALIDATION_FAILED", "Method name is ambiguous; specify its interface")
  return matches[0]
}

export function validateMethodPatch(source: string, updated: string, oldString: string, methodName: string): void {
  const before = findMethodRange(source, methodName)
  if (!before) throw new AppError("METHOD_NOT_FOUND", `Method ${methodName} was not found`)
  const start = source.indexOf(oldString)
  if (start < before.bodyStart || start + oldString.length > before.bodyEnd) {
    throw new AppError("SAP_VALIDATION_FAILED", "Patch must stay inside the selected method body")
  }
  const after = findMethodRange(updated, methodName)
  const delta = updated.length - source.length
  if (!after || after.name !== before.name || after.bodyStart !== before.bodyStart ||
      after.bodyEnd !== before.bodyEnd + delta || after.end !== before.end + delta) {
    throw new AppError("SAP_VALIDATION_FAILED", "Patch changes the selected method boundary or signature")
  }
}

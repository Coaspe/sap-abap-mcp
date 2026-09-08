import { ABAPObject, Comment, Expressions, MemoryFile, Registry, Statements, Unknown } from "@abaplint/core"
import { AppError } from "./errors.js"

export interface PublicDeclaration {
  code: string
  startLine: number
  startColumn: number
  endLine: number
  endColumn: number
  relatedTypes?: Array<{ relation: "superclass" | "interface" | "reference_type" | "qualified_type" | "exception_class"; name: string; line: number; column: number }>
}

/** Exact source spans of locally declared public API, not a semantic type model. */
export function extractPublicApi(source: string, name: string): PublicDeclaration[] {
  const unavailable = () => new AppError("SAP_VALIDATION_FAILED", "Public API could not be parsed completely; read the source instead", {
    reason: "PUBLIC_API_PARSE_FAILED"
  })
  if (Buffer.byteLength(source) > 1024 * 1024) throw unavailable()
  const registry = new Registry().addFile(new MemoryFile("zcontext.prog.abap", source)).parse()
  const offsets = [0]
  for (let index = 0; index < source.length; index++) if (source[index] === "\n") offsets.push(index + 1)
  const spans: Array<PublicDeclaration & { from: number; to: number }> = []
  let matched = 0
  let active = false
  let visible = false
  let closed = false
  for (const object of registry.getObjects()) {
    if (!(object instanceof ABAPObject)) continue
    for (const file of object.getABAPFiles()) {
      const docLines = new Map<number, number>()
      for (const node of file.getStatements()) {
        if (!(node.get() instanceof Comment)) continue
        const token = node.getFirstToken()
        const start = token.getStart()
        const prefix = source.slice(offsets[start.getRow() - 1], offsets[start.getRow() - 1]! + start.getCol() - 1)
        if (token.getStr().startsWith('"!') && /^[\t ]*$/.test(prefix)) docLines.set(start.getRow(), start.getCol())
      }
      for (const node of file.getStatements()) {
        const statement = node.get()
        const definition = statement instanceof Statements.ClassDefinition || statement instanceof Statements.Interface
        if (definition) {
          active = node.getTokens()[1]?.getStr().toUpperCase() === name.toUpperCase()
          visible = active && statement instanceof Statements.Interface
          if (active) matched++
        } else if (statement instanceof Statements.EndClass || statement instanceof Statements.EndInterface) {
          if (active) closed = true
          active = false
          visible = false
          continue
        } else if (statement instanceof Statements.Public) { visible = active; continue }
        else if (statement instanceof Statements.Private || statement instanceof Statements.Protected) { visible = false; continue }
        if (!active || (!visible && !definition) || statement instanceof Comment) continue
        if (statement instanceof Unknown) throw unavailable()
        const related = statement instanceof Statements.ClassDefinition
          ? node.findDirectExpression(Expressions.SuperClassName)
          : statement instanceof Statements.InterfaceDef ? node.findDirectExpression(Expressions.InterfaceName) : undefined
        const relatedToken = related?.getFirstToken()
        const relatedTypes: NonNullable<PublicDeclaration["relatedTypes"]> = relatedToken ? [{
          relation: statement instanceof Statements.ClassDefinition ? "superclass" : "interface",
          name: relatedToken.getStr().toUpperCase(),
          line: relatedToken.getStart().getRow(), column: relatedToken.getStart().getCol() - 1
        }] : []
        for (const target of node.findAllExpressions(Expressions.TypeName)) {
          const tokens = target.getTokens()
          if (tokens.length < 3 || tokens[1]?.getStr() !== "=>") continue
          const token = tokens[0]!
          relatedTypes.push({ relation: "qualified_type", name: token.getStr().toUpperCase(),
            line: token.getStart().getRow(), column: token.getStart().getCol() - 1 })
        }
        for (const type of [...node.findAllExpressions(Expressions.Type), ...node.findAllExpressions(Expressions.TypeParam)]) {
          const tokens = type.getTokens()
          if (tokens.slice(0, 3).map(token => token.getStr().toUpperCase()).join(" ") !== "TYPE REF TO") continue
          const target = type.findFirstExpression(Expressions.TypeName)
          if (!target || target.getTokens().length !== 1) continue
          const token = target.getFirstToken()
          const name = token.getStr().toUpperCase()
          if (name === "DATA" || name === "OBJECT") continue
          relatedTypes.push({ relation: "reference_type", name,
            line: token.getStart().getRow(), column: token.getStart().getCol() - 1 })
        }
        for (const raising of node.findAllExpressions(Expressions.MethodDefRaising)) {
          for (const exception of raising.findAllExpressions(Expressions.ClassName)) {
            const token = exception.getFirstToken()
            relatedTypes.push({ relation: "exception_class", name: token.getStr().toUpperCase(),
              line: token.getStart().getRow(), column: token.getStart().getCol() - 1 })
          }
        }
        const start = node.getFirstToken().getStart()
        const end = node.getLastToken().getEnd()
        let startLine = start.getRow()
        let startColumn = start.getCol()
        // Attach only contiguous, standalone ABAP Doc immediately above this declaration.
        const prefix = source.slice(offsets[startLine - 1], offsets[startLine - 1]! + startColumn - 1)
        if (/^[\t ]*$/.test(prefix)) {
          while (docLines.has(startLine - 1)) {
            startLine--
            startColumn = docLines.get(startLine)!
          }
        }
        const from = offsets[startLine - 1]! + startColumn - 1
        const to = offsets[end.getRow() - 1]! + end.getCol() - 1
        const previous = spans.at(-1)
        // The parser expands chained declarations into overlapping source spans.
        if (previous && from < previous.to) {
          previous.to = Math.max(previous.to, to)
          previous.endLine = end.getRow()
          previous.endColumn = end.getCol()
          previous.code = source.slice(previous.from, previous.to)
          if (relatedTypes.length) previous.relatedTypes = [...(previous.relatedTypes ?? []), ...relatedTypes]
        } else spans.push({ from, to, code: source.slice(from, to),
          startLine, startColumn, endLine: end.getRow(), endColumn: end.getCol(),
          ...(relatedTypes.length ? { relatedTypes } : {}) })
      }
    }
  }
  if (matched !== 1 || !closed) throw unavailable()
  return spans.map(({ from: _from, to: _to, ...declaration }) => declaration)
}

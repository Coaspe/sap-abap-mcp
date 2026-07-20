# Live SAP Acceptance Fixes Design

## Goal

Resolve the four actionable defects found by the S4D acceptance run and repeat the same disposable `$TMP` fixture acceptance against the locally built MCP server.

## Scope

This change covers only:

- class-include syntax-check URI handling;
- dependency-graph class-method ownership and compiler-pool normalization;
- automatic ABAP identifier range expansion for definition lookup;
- accurate create-time source documentation and acceptance instructions;
- automated verification followed by one live S4D acceptance run.

It does not add generic create-time source support, install the optional ABAP REPL service, invent a release-specific BDEF fixture, or refactor unrelated MCP tools.

## Design

### 1. Separate repository and syntax-check URIs

An editable class include has three distinct locations:

- `objectUri`: the parent class repository URI used for package resolution, locking, unlocking, deletion, and activation;
- `sourceUri`: the concrete include URI used to read and write source;
- `syntaxObjectUri`: the ADT artifact URI submitted as the first syntax-check argument.

For `/sap/bc/adt/oo/classes/.../includes/<include>` and interface equivalents, `syntaxObjectUri` is the include URI. For main sources and all existing object types, it remains `objectUri`.

`resolveEditableTarget` will compute and return `syntaxObjectUri`. `get_abap_diagnostics` will pass it to `checkSyntax`. `replaceSource` will accept it separately, while continuing to lock and activate `objectUri`. This prevents a valid local test class from being checked as though it were the global parent class.

### 2. Produce an object-level dependency graph

The graph is advertised as an ABAP object graph, so class-method usage references will be normalized to their owning class rather than emitted as unqualified `PING::CLAS/OM` nodes.

- Parse the owning class from `ABAPFullName` for `CLAS/OM` references.
- Emit the owner as a `CLAS/OC` node with ID `<OWNER>::CLAS/OC`.
- Normalize class-pool program names ending in `=...CP` to the same owning class node when the owner can be derived safely.
- Preserve the referenced member name on the edge as optional `member`, so useful method-level evidence is not lost.
- If ownership cannot be derived, retain the existing reference rather than guessing.

This removes collisions between identically named methods in different classes and reduces graph nodes and tokens.

### 3. Expand definition lookup to the identifier under the cursor

`inspect_abap_code(action="definition")` will preserve an explicit `endColumn`. When it is omitted, the service will derive the full ABAP identifier range surrounding `column` on the requested line and pass that non-empty range to ADT navigation.

The range helper will support ordinary identifiers, underscores, digits, field symbols, and `/NAMESPACE/NAME` identifiers. Invalid lines and whitespace positions retain a one-character bounded range rather than scanning across unrelated tokens.

Other semantic actions are unchanged. The acceptance prompt will target `completion_element` at the method token or method-call position, not at an arbitrary class-name character.

### 4. Make create-time source limits explicit

`create_object_programmatically.source` and `activate` descriptions will state that create-time source and create-time activation are currently supported only for `BDEF/BDO`. Runtime validation remains unchanged.

The live acceptance instructions will create `CLAS/OC` objects without `source`, read their generated skeletons, and replace those skeletons with the exact fixture source. Batch-activation comments will be inserted inside method bodies because SAP structured class source rejects unattached comments immediately after `CLASS ... IMPLEMENTATION.` on the tested system.

### 5. Verification

Automated tests will be written before production changes and must demonstrate:

- class includes use the include URI for syntax checks but the parent URI for lock and activation;
- main-source behavior is unchanged;
- two `PING` methods in different classes cannot collapse into one graph node;
- class-method and class-pool references normalize to class objects with bounded output;
- definition lookup expands an omitted `endColumn` to the full identifier and preserves an explicit range;
- MCP tool descriptions accurately disclose the BDEF-only source limitation;
- the revised acceptance documentation contains no class create-time source and uses a method-body batch comment.

After the focused tests pass, run the complete repository checks, security audit, package dry run, and an isolated packaged MCP schema smoke test.

Finally, start the locally built MCP server and repeat the S4D `$TMP` fixture using a new six-character RUN_ID and object names containing `MCP_TEST`. Require zero testclasses false-positive diagnostics, distinct object-level dependency edges, successful cross-class definition lookup, successful batch activation, passing Unit and ATC results, class-runner one-use protection, and complete fixture deletion with zero search results. REPL 404 and an unavailable validated BDEF fixture remain optional capability outcomes and do not reduce the core verdict.

## Error Handling and Safety

- Never mutate a production profile.
- Never mutate an existing object or an object lacking both `MCP_TEST` and the current RUN_ID.
- Use only `$TMP`; do not create or modify transports.
- Do not retry batch activation with alternate serialization shapes.
- If a live step fails, record the exact sanitized evidence and continue directly to cleanup where safe.
- A live PASS requires confirmed cleanup; otherwise report `FAIL-SAFETY` with exact remaining objects.

## Success Criteria

1. Focused regression tests fail before each implementation and pass afterward.
2. The full automated suite passes without new warnings or vulnerabilities.
3. Existing user changes in the dirty worktree remain intact.
4. The S4D testclasses include reports zero false-positive E diagnostics.
5. The graph returns direct class-object relationships without unqualified method-node collisions.
6. Cross-class definition lookup succeeds when only `column` is supplied.
7. The revised source contract and acceptance prompt match runtime behavior.
8. All live fixture objects are deleted and exact-name plus RUN_ID wildcard searches return zero results.

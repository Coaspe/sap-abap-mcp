# Advanced ABAP workflows

These workflows compose the small, action-specific v1 tools instead of adding a
large schema for every repository subtype. This keeps tool discovery bounded
while preserving exact ADT operations and safety checks.

## Enhancement implementations

Call `sap.repository.inspect` with `includeEnhancements: true` to list bounded
enhancement implementations and elements for an object. Add
`includeEnhancementSource: true` only when source is needed; source payloads use
the same inline-byte and deferred-result limits as other repository reads.

Use the returned canonical source URI with `sap.source.read` or the normal
source patch/write workflow. Do not infer an enhancement source path from its
name.

## Behavior implementation classes

Create the behavior pool through `sap.repository.create.preview` and
`sap.repository.create.execute` with object type `CLAS/OC`. Resolve or inspect
the created class, then use its implementation include URI with
`sap.source.read`, `sap.source.patch.preview`, and `sap.source.patch.execute`.
Run diagnostics, activation, ABAP Unit, and ATC through the existing quality
tools.

This is a composed workflow rather than a separate behavior-pool tool: SAP
remains the authority for whether the class is a valid implementation for the
selected behavior definition.

## CDS Unit

Resolve the CDS data definition and pass its canonical URI to
`sap.quality.unit_test`. Use `sap.quality.test_include.create` only for classic
ABAP test includes; CDS test doubles and CDS test-class semantics remain
governed by the backend release and ADT service.

## Local test includes

Use `sap.quality.test_include.create` to create the local test include for a
class, then resolve/read the returned URI and edit it through the normal source
preview/execute workflow. This avoids guessing include names and preserves
fingerprint checks.

## Program profiling

Create an execution plan with `sap.execution.preview`, `kind: "program"`, and
the executable program name. Execute the returned one-use plan unchanged with
`sap.execution.execute`. Program runs request a server-time profile and return a
bounded aggregate trace; they do not collect SQL or database detail by default.

Class execution continues to use `kind: "class"`. Snippet execution continues
to use `kind: "snippet"` and cannot enable profiling.

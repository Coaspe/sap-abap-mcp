# Live SAP evidence

Reproducible evidence from live SAP systems for the `$TMP`-scoped portion of the
v1 tool surface, the self-hosted HTTP transport, and the CI assurance gate.

These records contain no credentials, no customer source, and no host names
beyond the system identifier used by each run.

## Systems covered

| System identifier | SAP release | Detected type | Environment | Date |
|---|---|---|---|---|
| `B4D` | 758 | ECC | development | 2026-08-05 |
| `S4D` | 758 | S/4HANA | development | 2026-08-05 |

## Summary

| Area | `B4D` (ECC) | `S4D` (S/4HANA) |
|---|---|---|
| `$TMP`-scoped v1 surface | 87 passed, 11 unsupported, 1 skipped, 0 failed | **93 passed**, 2 unsupported, 1 skipped, 0 failed |
| Self-hosted HTTP mode, roles, audit | 13 of 13 passed | not run |
| CI assurance gate and artifacts | 7 of 7 passed | not run |

**200 live checks in total: 180 tool-surface checks across two systems, plus 20
transport and CI checks on one.** The tool-surface count deliberately counts the
same capability once per system, because release coverage is the claim being
made; it is not 180 distinct capabilities.

The nine-check difference between the two systems is a single real
release-dependent finding, not flakiness. See **Class runner and debugger**.

## Self-hosted HTTP mode (`B4D`)

| Field | Value |
|---|---|
| Client authentication | Bearer API keys, `viewer` and `developer` |
| Transport | MCP Streamable HTTP on loopback |
| Audit sink | file (JSON Lines) |
| SAP-facing calls | Read-only only |

### Result: 13 of 13 checks passed

| Check | Result | Evidence |
|---|---|---|
| `GET /healthz` answers without a credential | pass | `{"status":"ok","sessions":0,"inFlight":0}` |
| Unauthenticated MCP request rejected | pass | HTTP 401 |
| `viewer` advertises only `readOnlyHint: true` tools | pass | 71 tools, all read-only |
| `viewer` cannot see `sap.source.patch` | pass | absent from `tools/list` |
| Live SAP read over HTTP (`sap.system.inspect`) | pass | release 758, ECC |
| Live SAP search over HTTP (`sap.repository.search`) | pass | 3 objects returned |
| `viewer` mutation blocked when called by exact name | pass | error result |
| `developer` sees `sap.source.patch` | pass | present |
| `developer` cannot see `sap.transport.release` | pass | admin-only |
| `developer` surface larger than `viewer` | pass | 103 vs 71 tools |
| Session id replayed under a different key rejected | pass | HTTP 403 |
| Audit records the live read with principal and system | pass | `principal=live-viewer/api-key`, `systemId=B4D`, `outcome=succeeded`, `durationMs=1815` |
| Audit records the session-bind rejection | pass | `errorCode=SESSION_PRINCIPAL_MISMATCH` |

## Advertised surface per role

| Role | Tools advertised |
|---|---|
| `viewer` | 71 |
| `developer` | 103 |
| `admin` | 115 |

The `viewer` count equals the number of v1 tools advertised with
`readOnlyHint: true`. The 12 tools withheld from `developer` are the admin-only
set listed in the README.

## Audit stream produced by the run

Seven events across three kinds:

```
session:http.authenticate      (denied, API_KEY_INVALID)
session:http.session.open      (succeeded)
tool:sap.system.inspect        (succeeded, systemId=B4D)
tool:sap.repository.search     (succeeded, systemId=B4D)
session:http.session.bind      (denied, SESSION_PRINCIPAL_MISMATCH)
```

## CI assurance gate (`assure`, on `B4D`)

Verified with a disposable, empty transport created and deleted by the run. No existing object was read-locked, modified, or created.

| Check | Result | Evidence |
|---|---|---|
| Live assessment without an MCP host | pass | gate `incomplete`, reason `The transport contains no objects` |
| Exit code blocks the pipeline | pass | exit `2` for `incomplete` |
| `--fail-on failed` downgrades unproven coverage | pass | exit `0` |
| All three artifacts written with the names the Action reads | pass | `<transport>-change-assurance.{json,sarif,xml}` |
| SARIF is well formed for GitHub code scanning | pass | version `2.1.0`, driver `sap-abap-mcp change assurance`, rule `TRANSPORT_ASSESSMENT_INCOMPLETE`, `level: error`, `executionSuccessful: false`, invocation properties carry connection, transport, and gate status |
| JUnit is well formed | pass | one `testsuite`, one `testcase`, `errors="1"` |
| Invalid transport, invalid checks, missing arguments | pass | exit `1` with an actionable SAP or validation message |

A `passed` and a `failed` gate were not exercised live, because both require a
transport that contains objects. See below.

## `$TMP`-scoped v1 surface (`B4D` and `S4D`)

Reproduce with `npm run evidence:live -- <systemId>`. The harness is
[`scripts/live-evidence-tmp.mjs`](../scripts/live-evidence-tmp.mjs).

**S/4HANA: 93 passed, 2 unsupported, 1 skipped, 0 failed.
ECC: 87 passed, 11 unsupported, 1 skipped, 0 failed.**

The run creates two classes in `$TMP`: one exercised for source, semantic,
quality, version, and refactoring capabilities, and one implementing
`if_oo_adt_classrun` so that execution and the debugger have something to run.

Safety is enforced in code, not by convention. The run creates exactly one class
in the local package `$TMP` under a run-unique name, and that object becomes
`RUN_OWNED` only after a create receipt and an immediate exact read-back agree on
system, package, type, name, and source URI. Every mutation calls `assertOwned()`
first, which throws unless the target resolves to that ledger entry. Existing
objects are only ever read. The run deletes its object and verifies it is gone.

| Phase | Verified capabilities |
|---|---|
| Baseline reads | `sap.system.list`, `sap.system.inspect`, `sap.system.capabilities`, `sap.system.discovery`, `sap.repository.search`, `sap.transport.list`, `sap.transport.user.list`, `sap.runtime.dump.list`, `sap.runtime.trace.list`, `sap.runtime.trace.configuration`, `sap.rap.availability`, `sap.ui.transaction_url`, `sap.data.query`, `sap.artifact.mermaid.validate`, `sap.artifact.mermaid.detect`, `sap.ops.watch.status`, `sap.ops.watch.task.list`, `sap.ops.watch.watchlist.read`, `sap.ops.watch.history` |
| Owned-object creation | `sap.repository.create`, `sap.repository.inspect` |
| Owned-object reads | `sap.source.read` (by name and by `adt://` Resource URI), `sap.repository.resolve`, `sap.source.search`, `sap.source.read_batch`, `sap.repository.where_used`, `sap.repository.dependency_graph`, `sap.text_elements.read`, `sap.ui.object_url`, `sap.version.history.list`, `sap.version.inactive.list`, `sap.transport.object.resolve`, `sap.semantic.format_preview`, `sap.semantic.components`, `sap.semantic.quick_fixes`, `sap.semantic.complete`, `sap.semantic.definition`, `sap.semantic.documentation`, `sap.semantic.hierarchy`, `sap.source.diagnose` |
| Owned-object writes | `sap.source.patch` (twice), `sap.source.diagnose`, `sap.version.inactive.read`, `sap.source.activate`, `sap.refactor.preview` (rename and format), `sap.refactor.execute`, `sap.quality.test_include.create`, `sap.quality.unit_test`, `sap.quality.atc.run`, `sap.quality.atc.cached`, `sap.version.history.read`, `sap.version.restore.preview`, `sap.execution.preview` |
| Class runner and debugger | `sap.execution.preview`, `sap.execution.execute`, `sap.debug.status`, `sap.debug.session.start`, `sap.debug.breakpoint.set`, `sap.debug.stack`, `sap.debug.variables`, `sap.debug.evaluate`, `sap.debug.session.inspect`, `sap.debug.step`, `sap.debug.breakpoint.remove`, `sap.debug.session.stop` — all passed on S/4HANA |
| Artifacts | `sap.source.export`, `sap.system.discovery.export`, `sap.artifact.test_document.create` |
| Cleanup | `sap.repository.delete.preview`, `sap.repository.delete.execute` for each created object, plus a read-back confirming each one is gone |

### Class runner and debugger

On **S/4HANA 758** the whole chain works. The `$TMP` class runner wrote its
marker, a breakpoint on its own source suspended the execution, the listener
reported `paused`, and the attached debugger returned a 13-frame stack, variables,
an evaluated expression, session detail, and a completed step.

On **ECC 758** the same class is rejected by the ADT class-run endpoint with
`Class does not implement if_oo_adt_classrun~main method!`, even though its active
source declares `INTERFACES if_oo_adt_classrun` and implements `~main`,
diagnostics report no errors, activation succeeds, and re-activation does not
change the answer. Because the class runner is the only safe source of a
debuggee — executing an existing object would have effects this run must not
cause — the attached debugger capabilities are unreachable there and are recorded
as `unsupported` with that exact reason rather than omitted.

This is an unresolved SAP-side difference, not a defect in this server: the same
code path passes on S/4HANA. The debug **session** capabilities — status, session
start and stop, breakpoint set and remove — pass on both systems.

Two mechanics are worth recording for anyone reproducing this:

- A debug session must be started **before** a breakpoint can be set;
  `sap.debug.session.start` registers a background listener and returns
  immediately rather than blocking.
- `sap.debug.step` is verified with `stepOver`. Issuing `continue` at the
  runner's last statement raises on both systems, because the debuggee terminates
  while the step response is still being read. The debuggee is released by
  `sap.debug.session.stop`, which terminates it explicitly.
- The execution that is suspended at the breakpoint is deliberately abandoned, so
  its `sap.execution.execute` call is recorded as skipped rather than failed.

`sap.refactor.execute` is verified with a **method** rename rather than a class
rename, so the object's own name — and therefore the ownership ledger — stays
valid and the run can still delete exactly what it created. The renamed method is
then confirmed present in the activated source.

`sap.refactor.preview` with `kind: "format"` returned `NO_SOURCE_CHANGE` on
already-formatted source. That is the specified answer for that input, so the
harness records it as a pass rather than a failure, and says so in its output.

### Unsupported

Recorded as `unsupported`, not as a defect, because the SAP-side prerequisite is
absent. This matches what `sap.system.capabilities` reports for the same
connection.

| Capability | Missing prerequisite | `B4D` (ECC) | `S4D` (S/4HANA) |
|---|---|---|---|
| `sap.execution.health` | `ZCL_ABAP_REPL` and its SICF service at `/sap/bc/z_abap_repl` | malformed JSON | HTTP 404 |
| `sap.git.list` | abapGit ADT backend at `/sap/bc/adt/abapgit/*` | endpoint absent | endpoint absent |
| `sap.execution.execute` and the attached debugger | a class the ADT class-run endpoint accepts | rejected, see above | **passes** |

The RAP generator is available on both systems: `sap.rap.availability` passed.

An MCP input-validation rejection is never recorded as `unsupported`; that would
overstate what a system cannot do. The harness classifies it as a harness defect.

### Behaviour confirmed by deliberate rejection

Two guardrails were observed refusing an operation on live SAP, which is the
intended behaviour rather than a failure:

- `sap.source.patch` with `oldString: "ENDCLASS."` returned
  `SOURCE_MATCH_AMBIGUOUS`, because a generated class closes both its definition
  and its implementation part with that exact text.
- SAP rejected a comment placed between class sections with "The class contains
  unknown comments which can't be stored", so the harness declares a method and
  writes the marker inside its body, as
  [`live-sap-acceptance.md`](live-sap-acceptance.md) prescribes.

## Not covered by this run

- **ABAP Cloud and SAP BTP ABAP environment.** Both systems covered here are
  on-premise at release 758 using Basic authentication. No BTP ABAP environment
  is configured on this machine, so the service key import and the ABAP Cloud
  release line remain live-unverified. The parser and CLI path are covered by automated
  tests, and the composed token endpoint was confirmed against a synthetic key,
  but the OAuth client-credentials flow remains live-unverified for a BTP
  instance.
- **A `passed` or `failed` assurance gate, and asynchronous transport release.**
  Both need a transport that contains objects. On this system the only
  write-allowed packages are real development packages, so a throwaway object
  would leave residue in one of them and, if a release succeeded, would be
  transported downstream. That is a different risk than assessing a disposable
  empty transport, so it was not performed.
- **Writes over HTTP.** The HTTP run intentionally issued read-only SAP calls
  only. Role filtering for write tools was verified through the advertised
  surface and a blocked call, not by performing a write.
- **The RAP generation path.** `sap.rap.defaults`, `sap.rap.schema`,
  `sap.rap.preview`, `sap.rap.validate`, and `sap.rap.generate` require a
  prepared CDS root entity and a transportable package, so they are out of scope
  for a `$TMP` run and are covered separately by
  [`live-sap-acceptance.md`](live-sap-acceptance.md). Only
  `sap.rap.availability` is exercised here, and it passed on both systems.
- **`sap.execution.execute` for an ABAP snippet.** Snippet execution needs
  `ZCL_ABAP_REPL`, which neither system has. Only class execution is covered.
- **abapGit and transport mutations.** `$TMP` ownership does not establish
  ownership of a Git remote or a transport, so those stay out of scope, as the
  acceptance procedure requires.
- **TLS.** The listener speaks plain HTTP and was reached over loopback.

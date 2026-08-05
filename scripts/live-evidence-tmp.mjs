#!/usr/bin/env node
// Live evidence harness for the $TMP-scoped portion of the v1 surface.
//
// Safety contract, enforced in code rather than by convention:
//   * Existing SAP objects are only ever read. No lock, write, or delete
//     targets anything this run did not create.
//   * Exactly one object is created, in the local package $TMP, under a
//     run-unique name. It becomes RUN_OWNED only after a create receipt and an
//     immediate exact read-back agree on system, package, type, name, and URI.
//   * Every mutation calls assertOwned() first, which throws unless the target
//     resolves to that ledger entry.
//   * The run deletes the object it created before exiting.
//
// Usage: node scripts/live-evidence-tmp.mjs <systemId> [--keep]
import { randomBytes } from "node:crypto"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { ConnectionManager } from "../dist/src/connection-manager.js"
import { createMcpServer } from "../dist/src/mcp-server.js"
import { ProfileStore } from "../dist/src/profile-store.js"
import { createDefaultSecretStore } from "../dist/src/secret-store.js"
import { AbapToolService } from "../dist/src/tool-service.js"

const SYSTEM_ID = (process.argv[2] ?? "").trim().toUpperCase()
const KEEP = process.argv.includes("--keep")
if (!SYSTEM_ID) {
  console.error("usage: node scripts/live-evidence-tmp.mjs <systemId> [--keep]")
  process.exit(2)
}

const RUN_SUFFIX = randomBytes(3).toString("hex").toUpperCase()
const OBJECT_NAME = `ZCL_MCP_EV_${RUN_SUFFIX}`
const OWNED_PACKAGE = "$TMP"
const OWNED_TYPE = "CLAS/OC"
const outputDirectory = mkdtempSync(join(tmpdir(), "sap-abap-mcp-evidence-"))

/** RUN_OWNED ledger. Empty until a create receipt and read-back agree. */
const ledger = { name: undefined, uri: undefined, sourceUri: undefined }

function assertOwned(target) {
  if (!ledger.name) {
    throw new Error("refusing to mutate: no RUN_OWNED ledger entry exists")
  }
  const values = Array.isArray(target) ? target : [target]
  for (const entry of values) {
    const value = String(entry ?? "")
    if (!value.toUpperCase().includes(ledger.name)) {
      throw new Error(
        `refusing to mutate ${value}: not the RUN_OWNED object ${ledger.name}`
      )
    }
  }
}

const results = []
let client

const STATUS_MARKS = {
  pass: "PASS",
  fail: "FAIL",
  skip: "SKIP",
  unsupported: "UNSUP"
}

function record(tool, status, detail) {
  results.push({ tool, status, detail: detail ?? "" })
  console.log(
    `${(STATUS_MARKS[status] ?? status).padEnd(5)} ${tool}${detail ? `  — ${detail}` : ""}`
  )
}

/**
 * Call a tool and record the outcome.
 *
 * `owns` names arguments that must resolve to the RUN_OWNED object.
 * `requires` names an external SAP prerequisite — the ABAP REPL, the abapGit ADT
 * backend. When such a capability fails, the result is `unsupported` for this
 * system rather than a defect, which is the same distinction
 * `sap.system.capabilities` reports.
 * `acceptCodes` lists error codes that are the correct answer for this input,
 * such as refusing to format source that is already formatted. Those count as a
 * pass, because the capability behaved as specified.
 */
async function call(tool, args, { owns = [], summarize, requires, acceptCodes = [] } = {}) {
  for (const key of owns) assertOwned(args[key])
  try {
    const response = await client.callTool({ name: tool, arguments: args })
    const text = response.content?.[0]?.text ?? ""
    let payload
    try { payload = JSON.parse(text) } catch { payload = undefined }
    if (response.isError === true) {
      const message = String(payload?.message ?? text).slice(0, 140)
      const code = payload?.code
      if (typeof code === "string" && acceptCodes.includes(code)) {
        record(tool, "pass", `${code} is the specified response here`)
        return { ok: false, payload, accepted: true }
      }
      // An input-validation rejection is always a harness defect. Never let it
      // be recorded as a missing SAP prerequisite, which would overstate what
      // this system does not support.
      const harnessDefect = /Input validation error/i.test(message)
      record(
        tool,
        requires && !harnessDefect ? "unsupported" : "fail",
        requires && !harnessDefect
          ? `${requires} unavailable on this system: ${message}`
          : `${code ?? "ERROR"}: ${message}`
      )
      return { ok: false, payload }
    }
    record(tool, "pass", summarize ? summarize(payload) : "")
    return { ok: true, payload }
  } catch (error) {
    record(tool, "fail", String(error?.message ?? error).slice(0, 160))
    return { ok: false }
  }
}

const profiles = new ProfileStore()
const secrets = createDefaultSecretStore()
const manager = new ConnectionManager(profiles, secrets)
const service = new AbapToolService(manager, secrets)
const server = createMcpServer(service, { apiVersion: "v1" })

try {
  client = new Client({ name: "live-evidence", version: "1.0.0" })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  await client.connect(clientTransport)

  console.log(`\n=== phase 1: baseline reads (no mutation) ===`)
  await call("sap.system.list", {}, {
    summarize: p => `${p.data.systems.length} systems`
  })
  const inspect = await call("sap.system.inspect", { systemId: SYSTEM_ID }, {
    summarize: p => `release ${p.data.sapRelease}, ${p.data.systemType}`
  })
  await call("sap.system.capabilities", { systemId: SYSTEM_ID }, {
    summarize: p => `${p.data.capabilities.length} capabilities`
  })
  await call("sap.system.discovery", { systemId: SYSTEM_ID, detailLevel: "summary" }, {
    summarize: p => `${p.data.collections?.length ?? "?"} collections`
  })
  await call("sap.repository.search", {
    systemId: SYSTEM_ID, pattern: "ZCL_*", objectTypes: ["CLAS"], limit: 5
  }, { summarize: p => `${p.data.objects.length} objects` })
  await call("sap.transport.list", { systemId: SYSTEM_ID, limit: 5 }, {
    summarize: p => `${p.data.transports.length} transports`
  })
  await call("sap.transport.user.list", { systemId: SYSTEM_ID }, {
    summarize: p => `${p.data.users?.length ?? "?"} users`
  })
  await call("sap.runtime.dump.list", { systemId: SYSTEM_ID, limit: 3 })
  await call("sap.runtime.trace.list", { systemId: SYSTEM_ID, limit: 3 })
  await call("sap.execution.health", { systemId: SYSTEM_ID },
    { requires: "ABAP REPL (ZCL_ABAP_REPL and its SICF service)" })
  await call("sap.git.list", { systemId: SYSTEM_ID },
    { requires: "abapGit ADT backend" })
  await call("sap.rap.availability", { systemId: SYSTEM_ID, generatorId: "uiservice" },
    { requires: "RAP generator" })
  await call("sap.ui.transaction_url", { systemId: SYSTEM_ID, transactionCode: "SE80" })
  await call("sap.data.query", {
    systemId: SYSTEM_ID,
    // System client configuration only; no business or personal data.
    sql: "SELECT mandt FROM t000 ORDER BY mandt",
    maxRows: 3
  }, { summarize: p => `${p.data.rows?.length ?? p.data.rowCount ?? "?"} rows` })
  await call("sap.artifact.mermaid.validate", { code: "graph TD;A-->B;" })
  await call("sap.artifact.mermaid.detect", { code: "graph TD;A-->B;" })
  await call("sap.runtime.trace.configuration", { systemId: SYSTEM_ID })
  // sap.rap.{defaults,schema,preview,validate,generate} require a prepared CDS
  // root entity and a transportable package, so they are out of scope for a
  // $TMP run. docs/live-sap-acceptance.md covers them with a dedicated fixture.

  // Heartbeat state is process-local, so these never touch SAP configuration.
  await call("sap.ops.watch.status", {})
  await call("sap.ops.watch.task.list", {})
  await call("sap.ops.watch.watchlist.read", {})
  await call("sap.ops.watch.history", {})

  console.log(`\n=== phase 2: create the RUN_OWNED $TMP object ===`)
  const created = await call("sap.repository.create", {
    systemId: SYSTEM_ID,
    objectType: OWNED_TYPE,
    name: OBJECT_NAME,
    description: `MCP live evidence ${RUN_SUFFIX}`,
    packageName: OWNED_PACKAGE,
    activate: false
  }, { summarize: () => OBJECT_NAME })
  if (!created.ok) throw new Error("cannot continue without a created object")

  // Ownership requires an immediate exact read-back, not a create receipt alone.
  const readBack = await call("sap.repository.inspect", {
    systemId: SYSTEM_ID, objectName: OBJECT_NAME, objectType: OWNED_TYPE
  }, { summarize: p => `${p.data.object?.name} in ${p.data.object?.packageName ?? "?"}` })
  const info = readBack.payload?.data
  const readObject = info?.object
  if (
    !readBack.ok ||
    readObject?.name?.toUpperCase() !== OBJECT_NAME ||
    readObject?.type?.toUpperCase() !== OWNED_TYPE ||
    (readObject?.packageName ?? "").toUpperCase() !== OWNED_PACKAGE ||
    typeof info?.sourceUri !== "string"
  ) {
    throw new Error("read-back did not confirm ownership; refusing every mutation")
  }
  ledger.name = OBJECT_NAME
  ledger.uri = readObject.uri
  ledger.sourceUri = info.sourceUri
  console.log(`RUN_OWNED: ${ledger.name} (${OWNED_PACKAGE}) ${ledger.sourceUri}`)

  console.log(`\n=== phase 3: reads scoped to the owned object ===`)
  const sourceRead = await call("sap.source.read", {
    systemId: SYSTEM_ID, objectName: OBJECT_NAME, lineCount: 200
  }, { summarize: p => `${p.data.code?.split("\n").length ?? 0} lines` })
  const sourceUri = ledger.sourceUri
  const skeleton = sourceRead.payload?.data?.code ?? ""

  // The canonical Resource form of the same read.
  await call("sap.source.read", {
    systemId: SYSTEM_ID,
    resourceUri: `adt://${SYSTEM_ID}${ledger.sourceUri}`,
    lineCount: 200
  }, { summarize: p => `${p.data.code?.split("\n").length ?? 0} lines via adt:// URI` })

  await call("sap.repository.resolve", {
    systemId: SYSTEM_ID, objectName: OBJECT_NAME, objectType: OWNED_TYPE
  })
  await call("sap.source.search", {
    systemId: SYSTEM_ID, objectName: OBJECT_NAME, searchTerm: "CLASS"
  })
  await call("sap.source.read_batch", {
    systemId: SYSTEM_ID,
    requests: [{ objectName: OBJECT_NAME, startLine: 1, lineCount: 20 }]
  })
  await call("sap.repository.where_used", {
    systemId: SYSTEM_ID, objectName: OBJECT_NAME, objectType: OWNED_TYPE
  })
  await call("sap.repository.dependency_graph", {
    systemId: SYSTEM_ID, objectName: OBJECT_NAME, objectType: OWNED_TYPE, depth: 1
  })
  await call("sap.text_elements.read", {
    systemId: SYSTEM_ID, objectName: OBJECT_NAME, objectType: "CLASS"
  })
  await call("sap.ui.object_url", {
    systemId: SYSTEM_ID, objectName: OBJECT_NAME, objectType: OWNED_TYPE
  })
  await call("sap.version.history.list", {
    systemId: SYSTEM_ID, objectName: OBJECT_NAME, objectType: OWNED_TYPE
  })
  await call("sap.version.inactive.list", { systemId: SYSTEM_ID })
  await call("sap.transport.object.resolve", {
    systemId: SYSTEM_ID, pgmid: "R3TR", objectType: "CLAS", objectName: OBJECT_NAME
  })
  if (sourceUri) {
    await call("sap.semantic.format_preview", { systemId: SYSTEM_ID, fileUri: sourceUri })
    await call("sap.semantic.components", { systemId: SYSTEM_ID, fileUri: sourceUri })
    await call("sap.semantic.quick_fixes", {
      systemId: SYSTEM_ID, fileUri: sourceUri, line: 1, column: 1
    })
    await call("sap.source.diagnose", { systemId: SYSTEM_ID, fileUri: sourceUri })
    // Position the cursor on the class name in `CLASS <name> DEFINITION`.
    await call("sap.semantic.complete", {
      systemId: SYSTEM_ID, fileUri: sourceUri, line: 1, column: 6
    })
    await call("sap.semantic.definition", {
      systemId: SYSTEM_ID, fileUri: sourceUri, line: 1, column: 6
    })
    await call("sap.semantic.documentation", {
      systemId: SYSTEM_ID, fileUri: sourceUri, line: 1, column: 6
    })
    await call("sap.semantic.hierarchy", {
      systemId: SYSTEM_ID, fileUri: sourceUri, line: 1, column: 6, superTypes: true
    })
  } else {
    record("sap.semantic.*", "skip", "no sourceUri returned")
  }

  console.log(`\n=== phase 4: writes on the owned object only ===`)
  // "PUBLIC SECTION." and "IMPLEMENTATION." each occur exactly once in a
  // generated class skeleton, unlike "ENDCLASS." which closes both parts.
  const patchable = (skeleton.match(/IMPLEMENTATION\./gi) ?? []).length === 1 &&
    (skeleton.match(/PUBLIC SECTION\./gi) ?? []).length === 1
  if (sourceUri && patchable) {
    // A comment may only live inside a method body: SAP rejects "unknown
    // comments" placed between class sections. So declare a method first.
    await call("sap.source.patch", {
      systemId: SYSTEM_ID,
      fileUri: sourceUri,
      oldString: "PUBLIC SECTION.",
      newString: "PUBLIC SECTION.\n    METHODS run.",
      activate: false
    }, { owns: ["fileUri"] })
    await call("sap.source.patch", {
      systemId: SYSTEM_ID,
      fileUri: sourceUri,
      oldString: "IMPLEMENTATION.",
      newString:
        "IMPLEMENTATION.\n  METHOD run.\n" +
        `    "MCP_LIVE_EVIDENCE_${RUN_SUFFIX}\n  ENDMETHOD.`,
      activate: false
    }, { owns: ["fileUri"] })
    await call("sap.source.diagnose", { systemId: SYSTEM_ID, fileUri: sourceUri },
      { owns: ["fileUri"] })
    await call("sap.version.inactive.read", {
      systemId: SYSTEM_ID, objectName: OBJECT_NAME, objectType: OWNED_TYPE
    })
    // activate takes canonical adt:// Resource URIs, not raw ADT paths.
    await call("sap.source.activate", {
      systemId: SYSTEM_ID, resourceUris: [`adt://${SYSTEM_ID}${ledger.uri}`]
    }, { owns: ["resourceUris"] })

    // Locate the declared method token in the activated source rather than
    // guessing a position, then preview renaming it.
    const activeRead = await call("sap.source.read", {
      systemId: SYSTEM_ID, objectName: OBJECT_NAME, lineCount: 200
    }, { summarize: p => `${p.data.code?.split("\n").length ?? 0} active lines` })
    const activeLines = (activeRead.payload?.data?.code ?? "").split("\n")
    const declarationIndex = activeLines.findIndex(line => /METHODS\s+run\./i.test(line))
    if (declarationIndex >= 0) {
      const column = activeLines[declarationIndex].toLowerCase().indexOf("run")
      await call("sap.refactor.preview", {
        systemId: SYSTEM_ID, fileUri: sourceUri, kind: "rename",
        line: declarationIndex + 1, column, newName: "RUN_RENAMED"
      }, { owns: ["fileUri"] })
    } else {
      record("sap.refactor.preview", "skip", "method declaration not found")
    }
    await call("sap.quality.test_include.create", {
      systemId: SYSTEM_ID, className: OBJECT_NAME
    }, { owns: ["className"] })
    await call("sap.quality.unit_test", {
      systemId: SYSTEM_ID, objectName: OBJECT_NAME, detailLevel: "summary"
    }, { owns: ["objectName"] })
    await call("sap.quality.atc.run", {
      systemId: SYSTEM_ID, objectName: OBJECT_NAME, objectType: OWNED_TYPE
    }, { owns: ["objectName"] })
    await call("sap.quality.atc.cached", { fileUri: sourceUri }, { owns: ["fileUri"] })

    // After activation the object has a revision history, so exercise the
    // version reads and the guarded restore preview against its own revision.
    const history = await call("sap.version.history.list", {
      systemId: SYSTEM_ID, objectName: OBJECT_NAME, objectType: OWNED_TYPE
    }, { summarize: p => `${p.data?.versions?.length ?? 0} versions` })
    const version = history.payload?.data?.versions?.[0]
    const versionNumber = typeof version?.versionNumber === "number"
      ? version.versionNumber
      : typeof version?.number === "number" ? version.number : undefined
    if (versionNumber !== undefined) {
      await call("sap.version.history.read", {
        systemId: SYSTEM_ID, objectName: OBJECT_NAME, versionNumber
      }, { owns: ["objectName"] })
      // Preview only. Executing a restore is not part of the evidence run.
      await call("sap.version.restore.preview", {
        systemId: SYSTEM_ID, objectName: OBJECT_NAME, versionNumber
      }, { owns: ["objectName"] })
    } else {
      record("sap.version.history.read", "skip", "no revision recorded yet")
      record("sap.version.restore.preview", "skip", "no revision recorded yet")
    }

    // A plain class is not a class runner, so preview is expected to be refused
    // by SAP; that refusal still exercises the guarded execution path.
    await call("sap.execution.preview", {
      systemId: SYSTEM_ID, kind: "class", className: OBJECT_NAME
    }, { owns: ["className"], requires: "if_oo_adt_classrun implementation" })

    // Refusing to format already-formatted source is the specified answer.
    await call("sap.refactor.preview", {
      systemId: SYSTEM_ID, fileUri: sourceUri, kind: "format"
    }, { owns: ["fileUri"], acceptCodes: ["NO_SOURCE_CHANGE", "REFACTORING_EMPTY"] })

    // Execute a refactoring on the owned object. A method rename is used because
    // it leaves the object's own name — and therefore the ownership ledger —
    // unchanged, so the run can still verify and delete exactly what it created.
    if (declarationIndex >= 0) {
      const renamePlan = await call("sap.refactor.preview", {
        systemId: SYSTEM_ID, fileUri: sourceUri, kind: "rename",
        line: declarationIndex + 1,
        column: activeLines[declarationIndex].toLowerCase().indexOf("run"),
        newName: "RUN_EVIDENCE"
      }, { owns: ["fileUri"] })
      const plan = renamePlan.payload?.data
      if (plan?.planId && plan?.confirmation) {
        await call("sap.refactor.execute", {
          planId: plan.planId, confirmation: plan.confirmation
        })
        const renamed = await call("sap.source.read", {
          systemId: SYSTEM_ID, objectName: OBJECT_NAME, lineCount: 200
        }, { summarize: () => "read back after rename" })
        record(
          "refactor rename verification",
          /RUN_EVIDENCE/i.test(renamed.payload?.data?.code ?? "") ? "pass" : "fail",
          "renamed method present in active source"
        )
      } else {
        record("sap.refactor.execute", "skip", "no fresh rename plan returned")
      }
    } else {
      record("sap.refactor.execute", "skip", "method declaration not found")
    }
  } else {
    record("sap.source.patch", "skip", "no usable skeleton source")
  }

  console.log(`\n=== phase 5: artifacts ===`)
  await call("sap.source.export", {
    systemId: SYSTEM_ID,
    source: OBJECT_NAME,
    objectType: OWNED_TYPE,
    target: outputDirectory,
    overwrite: true,
    includeFileList: true
  }, { owns: ["source"], summarize: p => `${p.data?.fileCount ?? "?"} files` })
  await call("sap.system.discovery.export", { systemId: SYSTEM_ID })
  await call("sap.artifact.test_document.create", {
    reportTitle: `Live evidence ${RUN_SUFFIX}`,
    scenarios: [{
      scenarioId: 1,
      scenarioName: "live evidence",
      scenarioDescription: "create a $TMP class, patch, activate, then delete it",
      screenshots: []
    }]
  })
} catch (error) {
  record("harness", "fail", String(error?.message ?? error))
} finally {
  console.log(`\n=== phase 6: cleanup ===`)
  if (ledger.name && !KEEP && client) {
    try {
      assertOwned(ledger.sourceUri ?? ledger.uri ?? ledger.name)
      const preview = await call("sap.repository.delete.preview", {
        systemId: SYSTEM_ID,
        fileUri: ledger.sourceUri ?? ledger.uri
      }, { owns: ["fileUri"] })
      const plan = preview.payload?.data
      if (plan?.planId && plan?.confirmation) {
        await call("sap.repository.delete.execute", {
          planId: plan.planId, confirmation: plan.confirmation
        })
        const gone = await client.callTool({
          name: "sap.repository.inspect",
          arguments: { systemId: SYSTEM_ID, objectName: OBJECT_NAME, objectType: OWNED_TYPE }
        })
        record(
          "cleanup verification",
          gone.isError === true ? "pass" : "fail",
          gone.isError === true ? `${OBJECT_NAME} is gone` : `${OBJECT_NAME} still exists`
        )
      }
    } catch (error) {
      record("cleanup", "fail", String(error?.message ?? error))
    }
  } else if (ledger.name) {
    record("cleanup", "skip", `--keep retained ${ledger.name}`)
  }

  await client?.close().catch(() => undefined)
  await server.close().catch(() => undefined)
  service.dispose()
  await manager.close().catch(() => undefined)

  const counts = results.reduce((totals, item) => {
    totals[item.status] = (totals[item.status] ?? 0) + 1
    return totals
  }, {})
  const summary = {
    system: SYSTEM_ID,
    runSuffix: RUN_SUFFIX,
    ownedObject: ledger.name ?? null,
    ownedPackage: OWNED_PACKAGE,
    counts,
    results
  }
  const summaryPath = join(outputDirectory, "live-evidence-summary.json")
  writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`)
  console.log(`\n=== summary ===`)
  console.log(
    `pass ${counts.pass ?? 0}  unsupported ${counts.unsupported ?? 0}  ` +
    `skip ${counts.skip ?? 0}  fail ${counts.fail ?? 0}`
  )
  console.log(`summary: ${summaryPath}`)
  // `unsupported` reflects a missing SAP-side prerequisite, not a defect.
  process.exitCode = (counts.fail ?? 0) > 0 ? 1 : 0
}

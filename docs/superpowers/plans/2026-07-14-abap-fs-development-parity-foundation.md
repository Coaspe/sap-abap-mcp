# ABAP FS Development Parity Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a truthful SAP capability catalog, BDEF creation, batch activation, ABAP class/REPL execution, and richer semantic inspection without claiming live SAP support that has not been observed.

**Architecture:** Keep the existing MCP -> AbapToolService -> SapClient layering. Add three focused modules for capability state, BDEF type registration, and the fixed ABAP FS REPL HTTP contract; extend existing service and MCP files surgically. Every SAP operation uses one audited route, records capability evidence, preserves existing safety policies, and returns bounded structured data.

**Tech Stack:** TypeScript 7, Node.js 20+ test runner, Zod 4, MCP SDK 1.29, abap-adt-api 8.4.1.

---

## Execution constraints

- The starting worktree has unrelated uncommitted changes. Never reset, discard, overwrite, or attribute them to this plan.
- Before each commit, inspect git diff --cached --name-only and git diff --cached. Use hunk staging for already-dirty files.
- If a plan hunk cannot be isolated safely, leave it uncommitted and report that fact.
- Do not run live SAP mutations without a separately authorized disposable target.

## File map

Create:

- src/sap-capabilities.ts — capability definitions, observations, and status derivation.
- src/bdef-creator.ts — idempotent BDEF/BDO registration.
- src/repl-client.ts — fixed /sap/bc/z_abap_repl contract.
- test/sap-capabilities.test.ts — pure capability tests.
- test/bdef-creator.test.ts — BDEF descriptor tests.
- test/repl-client.test.ts — REPL request and parsing tests.
- test/fixtures/development-parity.ts — sanitized audited response shapes shared by contract tests.
- docs/live-sap-acceptance.md — opt-in live verification procedure.

Modify:

- src/sap-client.ts — explicit batch, semantic, class-runner, and REPL wrappers.
- src/tool-service.ts — capability observation, BDEF pipeline, batch activation, semantic actions, and execution plans.
- src/mcp-server.ts — new tools and schema extensions.
- src/compat/abap-fs-tools.ts — upstream truth, new tools, and toolsets.
- src/compat/abap-fs-documentation.ts — truthful built-in documentation.
- test/sap-client-contract.test.ts — exact wrapper call contracts.
- test/compatibility.test.ts — 43 upstream, 42 compatibility, 52 total.
- test/integration.test.ts — fake client and MCP behavior.
- README.md — status and usage documentation.

### Task 1: Verify the starting baseline

**Files:**

- Inspect: package.json
- Inspect: test/*.test.ts

- [ ] **Step 1: Capture existing changes**

Run:

~~~bash
git status --short
git diff --stat
~~~

Expected: pre-existing user changes remain visible.

- [ ] **Step 2: Run the current suite**

Run:

~~~bash
npm test
~~~

Expected: build succeeds and all existing tests pass. If it fails, stop and report the exact pre-existing failure before touching production code.

- [ ] **Step 3: Record evidence**

Run:

~~~bash
git rev-parse --short HEAD
npm test 2>&1 | tail -20
~~~

Expected: HEAD contains the approved specification and plan; test summary reports zero failures.

### Task 2: Add the pure capability registry

**Files:**

- Create: src/sap-capabilities.ts
- Create: test/sap-capabilities.test.ts

- [ ] **Step 1: Write failing tests**

Create test/sap-capabilities.test.ts:

~~~typescript
import assert from "node:assert/strict"
import test from "node:test"
import {
  normalizeCapabilityError,
  SapCapabilityRegistry
} from "../src/sap-capabilities.js"

test("capabilities separate implementation, system, authorization, and overall status", () => {
  const registry = new SapCapabilityRegistry()
  const find = (connectionId: string) =>
    registry.list(connectionId, "", "repository")
      .find(item => item.id === "repository.create.bdef")!

  assert.equal(find("DEV100").status, "unverified")
  registry.observeAdvertised("DEV100", "repository.create.bdef", "bo/behaviordefinitions")
  assert.equal(find("DEV100").system, "advertised")
  assert.equal(find("DEV100").status, "unverified")
  registry.observeSuccess("DEV100", "repository.create.bdef", "create")
  assert.equal(find("DEV100").status, "supported")
  assert.equal(find("DEV100").authorization, "allowed")

  registry.observeHttpFailure("QAS200", "repository.create.bdef", 404, "bo/behaviordefinitions")
  assert.equal(find("QAS200").status, "unsupported")
  assert.equal(find("DEV100").status, "supported")
})

test("missing backlog capabilities never claim support", () => {
  const registry = new SapCapabilityRegistry()
  const cleaner = registry.list("DEV100", "", "quality")
    .find(item => item.id === "quality.abap_cleaner")!
  assert.equal(cleaner.implementation, "missing")
  assert.equal(cleaner.status, "unsupported")
})

test("capability failures normalize authorization and redact secrets", () => {
  const failure = Object.assign(new Error("token=secret-value"), {
    response: { status: 403 }
  })
  const normalized = normalizeCapabilityError(
    failure,
    "semantic.documentation",
    "/sap/bc/adt/docu/abap/langu"
  )
  assert.equal(normalized.code, "SAP_AUTHORIZATION_DENIED")
  assert.equal(normalized.details?.httpStatus, 403)
  assert.doesNotMatch(normalized.message, /secret-value/)
})
~~~

- [ ] **Step 2: Verify RED**

Run npm run build.

Expected: FAIL because src/sap-capabilities.ts does not exist.

- [ ] **Step 3: Implement the registry**

Create src/sap-capabilities.ts with these exact public contracts:

~~~typescript
import { AppError } from "./errors.js"

export type SapCapabilityCategory =
  | "connection"
  | "repository"
  | "execution"
  | "semantic"
  | "quality"
  | "debugging"
  | "insight"

export type SapCapabilityStatus = "supported" | "unsupported" | "unverified"

interface Definition {
  id: string
  category: SapCapabilityCategory
  implementation: "implemented" | "missing"
  discoveryNeedles: string[]
}

interface Observation {
  system?: "advertised" | "not_advertised"
  authorization?: "allowed" | "denied"
  evidence: string[]
  lastObservedAt?: string
  succeeded: boolean
}

export interface SapCapabilityRecord {
  id: string
  category: SapCapabilityCategory
  implementation: "implemented" | "missing"
  system: "advertised" | "not_advertised" | "unknown"
  authorization: "allowed" | "denied" | "unknown"
  status: SapCapabilityStatus
  evidence: string[]
  lastObservedAt: string | null
}

const DEFINITIONS: Definition[] = [
  { id: "repository.create.bdef", category: "repository", implementation: "implemented", discoveryNeedles: ["bo/behaviordefinitions"] },
  { id: "repository.activate.batch", category: "repository", implementation: "implemented", discoveryNeedles: ["/sap/bc/adt/activation"] },
  { id: "execution.class_runner", category: "execution", implementation: "implemented", discoveryNeedles: ["/sap/bc/adt/oo/classrun"] },
  { id: "execution.abap_repl", category: "execution", implementation: "implemented", discoveryNeedles: [] },
  { id: "semantic.completion_element", category: "semantic", implementation: "implemented", discoveryNeedles: ["codecompletion/elementinfo"] },
  { id: "semantic.documentation", category: "semantic", implementation: "implemented", discoveryNeedles: ["docu/abap/langu"] },
  { id: "semantic.type_hierarchy", category: "semantic", implementation: "implemented", discoveryNeedles: ["abapsource/typehierarchy"] },
  { id: "semantic.components", category: "semantic", implementation: "implemented", discoveryNeedles: ["objectstructure"] },
  { id: "connection.auth.bearer", category: "connection", implementation: "missing", discoveryNeedles: [] },
  { id: "connection.auth.certificate", category: "connection", implementation: "missing", discoveryNeedles: [] },
  { id: "connection.auth.kerberos", category: "connection", implementation: "missing", discoveryNeedles: [] },
  { id: "connection.auth.browser_sso", category: "connection", implementation: "missing", discoveryNeedles: [] },
  { id: "connection.auth.oauth", category: "connection", implementation: "missing", discoveryNeedles: [] },
  { id: "connection.auth.btp_cloud", category: "connection", implementation: "missing", discoveryNeedles: [] },
  { id: "quality.abap_cleaner", category: "quality", implementation: "missing", discoveryNeedles: [] },
  { id: "quality.atc_exemptions", category: "quality", implementation: "missing", discoveryNeedles: [] },
  { id: "quality.package_tests", category: "quality", implementation: "missing", discoveryNeedles: [] },
  { id: "quality.coverage", category: "quality", implementation: "missing", discoveryNeedles: [] },
  { id: "debugging.trace_configuration", category: "debugging", implementation: "missing", discoveryNeedles: [] },
  { id: "debugging.watchpoints", category: "debugging", implementation: "missing", discoveryNeedles: [] },
  { id: "debugging.message_breakpoints", category: "debugging", implementation: "missing", discoveryNeedles: [] },
  { id: "debugging.exception_breakpoints", category: "debugging", implementation: "missing", discoveryNeedles: [] },
  { id: "debugging.record_replay", category: "debugging", implementation: "missing", discoveryNeedles: [] },
  { id: "insight.blame", category: "insight", implementation: "missing", discoveryNeedles: [] },
  { id: "insight.s4hana_readiness", category: "insight", implementation: "missing", discoveryNeedles: [] },
  { id: "insight.adt_communication_logs", category: "insight", implementation: "missing", discoveryNeedles: [] },
  { id: "insight.feeds", category: "insight", implementation: "missing", discoveryNeedles: [] }
]

function httpStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined
  const value = error as {
    status?: unknown
    response?: { status?: unknown }
  }
  const candidate = value.response?.status ?? value.status
  return typeof candidate === "number" ? candidate : undefined
}

function sanitizeSapMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(
    /((?:password|authorization|token|cookie|csrf|session)["']?\s*[:=]\s*)(["'][^"']*["']|[^,;\s}\]]+)/gi,
    "$1[REDACTED]"
  )
}

export function normalizeCapabilityError(
  error: unknown,
  capabilityId: string,
  endpoint: string,
  validationFailure = false
): AppError {
  const status = httpStatus(error)
  const code = status === 401 || status === 403
    ? "SAP_AUTHORIZATION_DENIED"
    : status === 404 || status === 405
      ? "SAP_CAPABILITY_UNAVAILABLE"
      : validationFailure
        ? "SAP_VALIDATION_FAILED"
        : "SAP_OPERATION_FAILED"
  return new AppError(code, sanitizeSapMessage(error), {
    capabilityId,
    endpoint,
    ...(status !== undefined ? { httpStatus: status } : {})
  })
}

export class SapCapabilityRegistry {
  private readonly observations = new Map<string, Map<string, Observation>>()

  private addEvidence(observation: Observation, evidence: string): void {
    if (!observation.evidence.includes(evidence)) observation.evidence.push(evidence)
    while (observation.evidence.length > 20) observation.evidence.shift()
  }

  private get(connectionId: string, capabilityId: string): Observation {
    const key = connectionId.trim().toUpperCase()
    let connection = this.observations.get(key)
    if (!connection) {
      connection = new Map()
      this.observations.set(key, connection)
    }
    let observation = connection.get(capabilityId)
    if (!observation) {
      observation = { evidence: [], succeeded: false }
      connection.set(capabilityId, observation)
    }
    return observation
  }

  observeAdvertised(connectionId: string, capabilityId: string, evidence: string): void {
    const observation = this.get(connectionId, capabilityId)
    observation.system = "advertised"
    this.addEvidence(observation, "discovery:" + evidence)
    observation.lastObservedAt = new Date().toISOString()
  }

  observeSuccess(connectionId: string, capabilityId: string, evidence: string): void {
    const observation = this.get(connectionId, capabilityId)
    observation.succeeded = true
    observation.authorization = "allowed"
    this.addEvidence(observation, "success:" + evidence)
    observation.lastObservedAt = new Date().toISOString()
  }

  observeHttpFailure(
    connectionId: string,
    capabilityId: string,
    status: number,
    endpoint: string
  ): void {
    const observation = this.get(connectionId, capabilityId)
    if (status === 401 || status === 403) observation.authorization = "denied"
    if (status === 404 || status === 405) observation.system = "not_advertised"
    this.addEvidence(observation, "http:" + status + ":" + endpoint)
    observation.lastObservedAt = new Date().toISOString()
  }

  observeFailure(connectionId: string, capabilityId: string, error: unknown, endpoint: string): void {
    const status = httpStatus(error)
    const observation = this.get(connectionId, capabilityId)
    if (status !== undefined) this.observeHttpFailure(connectionId, capabilityId, status, endpoint)
    else {
      this.addEvidence(observation, "failure:" + endpoint)
      observation.lastObservedAt = new Date().toISOString()
    }
  }

  status(connectionId: string, capabilityId: string): SapCapabilityStatus {
    const record = this.list(connectionId, "").find(item => item.id === capabilityId)
    if (!record) throw new AppError("SAP_CAPABILITY_UNAVAILABLE", `Unknown capability ${capabilityId}`)
    return record.status
  }

  observeDiscovery(connectionId: string, discoveryText: string): void {
    const normalized = discoveryText.toLowerCase()
    for (const definition of DEFINITIONS) {
      const needle = definition.discoveryNeedles.find(item =>
        normalized.includes(item.toLowerCase())
      )
      if (needle) this.observeAdvertised(connectionId, definition.id, needle)
    }
  }

  list(
    connectionId: string,
    discoveryText: string,
    category?: SapCapabilityCategory
  ): SapCapabilityRecord[] {
    this.observeDiscovery(connectionId, discoveryText)
    const connection = this.observations.get(connectionId.trim().toUpperCase())
    return DEFINITIONS.filter(item => !category || item.category === category)
      .map(definition => {
        const observation = connection?.get(definition.id)
        const system = observation?.system ?? "unknown"
        const authorization = observation?.authorization ?? "unknown"
        const status: SapCapabilityStatus =
          definition.implementation === "missing" || system === "not_advertised"
            ? "unsupported"
            : observation?.succeeded
              ? "supported"
              : "unverified"
        return {
          id: definition.id,
          category: definition.category,
          implementation: definition.implementation,
          system,
          authorization,
          status,
          evidence: [...(observation?.evidence ?? [])],
          lastObservedAt: observation?.lastObservedAt ?? null
        }
      })
  }
}
~~~

- [ ] **Step 4: Verify GREEN**

Run:

~~~bash
npm run build && node --test dist/test/sap-capabilities.test.js
~~~

Expected: three pass, zero fail.

- [ ] **Step 5: Commit**

~~~bash
git add src/sap-capabilities.ts test/sap-capabilities.test.ts
git diff --cached --check
git commit -m "feat: add SAP capability registry"
~~~

### Task 3: Register BDEF as a creatable type

**Files:**

- Create: src/bdef-creator.ts
- Create: test/bdef-creator.test.ts
- Modify: src/tool-service.ts constructor

- [ ] **Step 1: Write the failing test**

~~~typescript
import assert from "node:assert/strict"
import test from "node:test"
import { CreatableTypes, isCreatableTypeId } from "abap-adt-api"
import { BDEF_TYPE_ID, registerBdefType } from "../src/bdef-creator.js"

test("BDEF registration matches ABAP FS and is idempotent", () => {
  CreatableTypes.delete(BDEF_TYPE_ID)
  registerBdefType()
  registerBdefType()
  assert.equal(isCreatableTypeId(BDEF_TYPE_ID), true)
  assert.deepEqual(CreatableTypes.get(BDEF_TYPE_ID), {
    creationPath: "bo/behaviordefinitions",
    validationPath: "bo/behaviordefinitions/validation",
    rootName: "blue:blueSource",
    nameSpace: 'xmlns:blue="http://www.sap.com/wbobj/blue"',
    label: "Behavior Definition",
    typeId: BDEF_TYPE_ID,
    maxLen: 30
  })
})
~~~

- [ ] **Step 2: Verify RED**

Run npm run build.

Expected: FAIL because src/bdef-creator.ts does not exist.

- [ ] **Step 3: Implement registration**

~~~typescript
import {
  CreatableTypes,
  type CreatableType,
  type CreatableTypeIds
} from "abap-adt-api"

export const BDEF_TYPE_ID = "BDEF/BDO" as CreatableTypeIds

const BDEF_TYPE: CreatableType = {
  creationPath: "bo/behaviordefinitions",
  validationPath: "bo/behaviordefinitions/validation",
  rootName: "blue:blueSource",
  nameSpace: 'xmlns:blue="http://www.sap.com/wbobj/blue"',
  label: "Behavior Definition",
  typeId: BDEF_TYPE_ID,
  maxLen: 30
}

export function registerBdefType(): void {
  if (!CreatableTypes.has(BDEF_TYPE_ID)) CreatableTypes.set(BDEF_TYPE_ID, BDEF_TYPE)
}
~~~

Import and call registration in the existing constructor:

~~~typescript
import { registerBdefType } from "./bdef-creator.js"

constructor(
  private readonly connections: ConnectionProvider,
  private readonly secrets?: SecretStore
) {
  registerBdefType()
}
~~~

- [ ] **Step 4: Verify GREEN**

~~~bash
npm run build && node --test dist/test/bdef-creator.test.js
~~~

Expected: one pass, zero fail.

- [ ] **Step 5: Commit isolated hunks**

Stage both new files and only the constructor/import hunks. Inspect the cached diff, then commit:

~~~bash
git diff --cached --check
git commit -m "feat: register BDEF creation type"
~~~

### Task 4: Add exact SapClient and REPL contracts

**Files:**

- Create: src/repl-client.ts
- Create: test/repl-client.test.ts
- Create: test/fixtures/development-parity.ts
- Modify: src/sap-client.ts
- Modify: test/sap-client-contract.test.ts
- Modify: test/integration.test.ts FakeSapClient

- [ ] **Step 1: Write failing contract tests**

Create the sanitized fixture module first:

~~~typescript
export const DEVELOPMENT_PARITY_FIXTURES = {
  replHealth: {
    status: "ok",
    version: "1",
    user: "SANITIZED_USER",
    system: "D01",
    client: "100",
    production: false
  },
  replExecution: {
    success: true,
    output: "42\n",
    error: "",
    runtime_ms: 5
  },
  completionElement: {
    name: "WRITE",
    type: "KEYWORD",
    href: "",
    doc: "Writes output",
    components: []
  },
  documentation: "<p>WRITE documentation</p>",
  typeHierarchy: [{
    hasDefOrImpl: true,
    uri: "/sap/bc/adt/oo/classes/zcl_parent",
    line: 1,
    character: 0,
    type: "CLAS/OC",
    name: "ZCL_PARENT",
    parentUri: "",
    description: "Parent"
  }],
  components: {
    "adtcore:name": "ZCL_DEMO",
    "adtcore:type": "CLAS/OC",
    links: [],
    visibility: "public",
    "xml:base": "",
    components: [{
      "adtcore:name": "RUN",
      "adtcore:type": "CLAS/OM",
      links: [],
      visibility: "public",
      "xml:base": "",
      components: []
    }]
  },
  activationPartial: {
    success: false,
    messages: [{
      objDescr: "ZCL_SECOND",
      type: "E",
      line: 1,
      href: "/sap/bc/adt/oo/classes/zcl_second",
      forceSupported: false,
      shortText: "Activation failed"
    }]
  }
}
~~~

Import it in the REPL and integration tests:

~~~typescript
import { DEVELOPMENT_PARITY_FIXTURES } from "./fixtures/development-parity.js"
~~~

Append this complete wrapper-contract test to `test/sap-client-contract.test.ts`:

~~~typescript
test("batch, semantic detail, and class runner wrappers preserve exact ADT contracts", async () => {
  const calls: Array<{ method: string; args: unknown[] }> = []
  const record = (method: string, value: unknown) => async (...args: unknown[]) => {
    calls.push({ method, args })
    return value
  }
  const fakeAdt: Record<string, unknown> & { statelessClone?: unknown } = {
    activate: record("activate", { success: true, messages: [], inactive: [] }),
    codeCompletionElement: record("codeCompletionElement", "legacy"),
    abapDocumentation: record("abapDocumentation", "documentation"),
    typeHierarchy: record("typeHierarchy", []),
    classComponents: record("classComponents", {
      "adtcore:name": "ZCL_RUNNER",
      "adtcore:type": "CLAS/OC",
      links: [],
      visibility: "public",
      "xml:base": "",
      components: []
    }),
    runClass: record("runClass", "output")
  }
  fakeAdt.statelessClone = fakeAdt
  const client = clientWithAdt(fakeAdt)
  const inactiveObject = {
    "adtcore:uri": "/object",
    "adtcore:type": "CLAS/OC",
    "adtcore:name": "ZCL_RUNNER",
    "adtcore:parentUri": ""
  }

  await client.activateObjects([inactiveObject])
  await client.getCodeCompletionElement("/source", "WRITE x.", 7, 3)
  await client.getAbapDocumentation("/object", "WRITE x.", 7, 3)
  await client.getTypeHierarchy("/source", "WRITE x.", 7, 3, true)
  await client.getClassComponents("/object")
  await client.runClass("zcl_runner")

  assert.deepEqual(calls, [
    { method: "activate", args: [[inactiveObject], true] },
    { method: "codeCompletionElement", args: ["/source", "WRITE x.", 7, 3] },
    { method: "abapDocumentation", args: ["/object", "WRITE x.", 7, 3, "EN"] },
    { method: "typeHierarchy", args: ["/source", "WRITE x.", 7, 3, true] },
    { method: "classComponents", args: ["/object"] },
    { method: "runClass", args: ["ZCL_RUNNER"] }
  ])
})
~~~

Create test/repl-client.test.ts:

~~~typescript
import assert from "node:assert/strict"
import test from "node:test"
import { checkReplAvailability, executeAbapCode } from "../src/repl-client.js"

test("REPL uses only the audited route and request shapes", async () => {
  const calls: unknown[] = []
  const http = {
    async request(path: string, options: Record<string, unknown>) {
      calls.push({ path, options })
      return options.method === "GET"
        ? { status: 200, body: JSON.stringify(DEVELOPMENT_PARITY_FIXTURES.replHealth) }
        : { status: 200, body: JSON.stringify(DEVELOPMENT_PARITY_FIXTURES.replExecution) }
    }
  }
  const health = await checkReplAvailability(http)
  const result = await executeAbapCode(http, "WRITE 42.")
  assert.equal(health.production, false)
  assert.equal(result.output, "42\n")
  assert.deepEqual(calls, [
    { path: "/sap/bc/z_abap_repl", options: { method: "GET", timeout: 10_000 } },
    {
      path: "/sap/bc/z_abap_repl",
      options: {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: '{"code":"WRITE 42."}',
        timeout: 60_000
      }
    }
  ])
})

test("REPL sanitizes ABAP control characters and rejects malformed shapes without fallback", async () => {
  let calls = 0
  const rawControlHttp = {
    async request() {
      calls += 1
      return {
        status: 200,
        body: '{"success":true,"output":"first' + "\n" + 'second' + "\t" +
          'value","error":"","runtime_ms":1}'
      }
    }
  }
  assert.equal((await executeAbapCode(rawControlHttp, "WRITE 1.")).output, "first\nsecond\tvalue")
  assert.equal(calls, 1)

  const malformedHttp = {
    async request() {
      calls += 1
      return { status: 200, body: '{"success":"yes"}' }
    }
  }
  await assert.rejects(
    executeAbapCode(malformedHttp, "WRITE 1."),
    (error: unknown) =>
      error instanceof Error && error.message === "ABAP REPL field success must be boolean"
  )
  assert.equal(calls, 2)

  const missingHttp = {
    async request() {
      calls += 1
      return { status: 404, body: JSON.stringify(DEVELOPMENT_PARITY_FIXTURES.replHealth) }
    }
  }
  await assert.rejects(
    checkReplAvailability(missingHttp),
    (error: unknown) =>
      error instanceof Error && error.message === "ABAP REPL returned HTTP 404"
  )
  assert.equal(calls, 3)
})
~~~

- [ ] **Step 2: Verify RED**

Run npm run build.

Expected: missing methods and missing src/repl-client.ts.

- [ ] **Step 3: Implement the REPL adapter**

~~~typescript
import { AppError } from "./errors.js"

const REPL_PATH = "/sap/bc/z_abap_repl"

export interface ReplHttpClient {
  request(
    path: string,
    options: {
      method: "GET" | "POST"
      headers?: Record<string, string>
      body?: string
      timeout: number
    }
  ): Promise<{ status: number; body: string }>
}

export interface ReplResponse {
  success: boolean
  output: string
  error: string
  runtime_ms: number
}

export interface ReplHealthCheck {
  status: string
  version: string
  user: string
  system: string
  client: string
  production: boolean
}

function sanitizeJsonBody(body: string): string {
  let result = ""
  let inString = false
  let escaped = false
  for (const ch of body) {
    if (escaped) {
      result += ch
      escaped = false
      continue
    }
    if (ch === "\\" && inString) {
      result += ch
      escaped = true
      continue
    }
    if (ch === '"') {
      inString = !inString
      result += ch
      continue
    }
    if (inString && ch.charCodeAt(0) < 0x20) {
      if (ch === "\n") result += "\\n"
      else if (ch === "\r") result += "\\r"
      else if (ch === "\t") result += "\\t"
      else result += `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`
      continue
    }
    result += ch
  }
  return result
}

function parseRecord(body: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(sanitizeJsonBody(body))
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("object expected")
    return value as Record<string, unknown>
  } catch (error) {
    throw new AppError("SAP_OPERATION_FAILED", "ABAP REPL returned malformed JSON", {
      endpoint: REPL_PATH,
      cause: error instanceof Error ? error.message : String(error)
    })
  }
}

function requireHttpSuccess(response: { status: number; body: string }): void {
  if (response.status >= 200 && response.status < 300) return
  throw Object.assign(new Error(`ABAP REPL returned HTTP ${response.status}`), {
    status: response.status
  })
}

function requireFields<T extends Record<string, "string" | "number" | "boolean">>(
  value: Record<string, unknown>,
  fields: T
): asserts value is Record<string, unknown> & { [K in keyof T]:
  T[K] extends "string" ? string : T[K] extends "number" ? number : boolean
} {
  for (const [key, type] of Object.entries(fields)) {
    if (typeof value[key] !== type) {
      throw new AppError("SAP_OPERATION_FAILED", `ABAP REPL field ${key} must be ${type}`, {
        endpoint: REPL_PATH
      })
    }
  }
}

export async function checkReplAvailability(
  http: ReplHttpClient
): Promise<ReplHealthCheck> {
  const response = await http.request(REPL_PATH, { method: "GET", timeout: 10_000 })
  requireHttpSuccess(response)
  const value = parseRecord(response.body)
  requireFields(value, {
    status: "string",
    version: "string",
    user: "string",
    system: "string",
    client: "string",
    production: "boolean"
  })
  return value
}

export async function executeAbapCode(
  http: ReplHttpClient,
  code: string
): Promise<ReplResponse> {
  const response = await http.request(REPL_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
    timeout: 60_000
  })
  requireHttpSuccess(response)
  const value = parseRecord(response.body)
  requireFields(value, {
    success: "boolean",
    output: "string",
    error: "string",
    runtime_ms: "number"
  })
  return value
}
~~~

This is the audited ABAP FS sanitizer and request shape. Both functions parse only the sanitized body and never try another route.

- [ ] **Step 4: Extend SapClient**

Add `InactiveObject`, `CompletionElementInfo`, `HierarchyNode`, and `ClassComponent` to the existing `abap-adt-api` type imports. Import the REPL types/functions with aliases:

~~~typescript
import {
  checkReplAvailability as checkReplService,
  executeAbapCode as executeReplCode,
  type ReplHealthCheck,
  type ReplResponse
} from "./repl-client.js"
~~~

Add these exact interface methods:

~~~typescript
activateObjects(objects: InactiveObject[]): Promise<ActivationResult>
getCodeCompletionElement(sourceUri: string, source: string, line: number, column: number): Promise<string | CompletionElementInfo>
getAbapDocumentation(objectUri: string, source: string, line: number, column: number): Promise<string>
getTypeHierarchy(sourceUri: string, source: string, line: number, column: number, superTypes: boolean): Promise<HierarchyNode[]>
getClassComponents(objectUri: string): Promise<ClassComponent>
runClass(className: string): Promise<string>
checkReplAvailability(): Promise<ReplHealthCheck>
executeAbapCode(code: string): Promise<ReplResponse>
~~~

Add these direct `AdtSapClient` methods beside the existing activation and semantic methods:

~~~typescript
async activateObjects(objects: InactiveObject[]): Promise<ActivationResult> {
  return this.serializeMutation(() => this.client.activate(objects, true))
}

async getCodeCompletionElement(
  sourceUri: string,
  source: string,
  line: number,
  column: number
): Promise<string | CompletionElementInfo> {
  return this.client.statelessClone.codeCompletionElement(sourceUri, source, line, column)
}

async getAbapDocumentation(
  objectUri: string,
  source: string,
  line: number,
  column: number
): Promise<string> {
  return this.client.statelessClone.abapDocumentation(
    objectUri,
    source,
    line,
    column,
    this.profile.language
  )
}

async getTypeHierarchy(
  sourceUri: string,
  source: string,
  line: number,
  column: number,
  superTypes: boolean
): Promise<HierarchyNode[]> {
  return this.client.statelessClone.typeHierarchy(sourceUri, source, line, column, superTypes)
}

async getClassComponents(objectUri: string): Promise<ClassComponent> {
  return this.client.statelessClone.classComponents(objectUri)
}

async runClass(className: string): Promise<string> {
  return this.client.runClass(className.trim().toUpperCase())
}

async checkReplAvailability(): Promise<ReplHealthCheck> {
  return checkReplService(this.client.httpClient)
}

async executeAbapCode(code: string): Promise<ReplResponse> {
  return executeReplCode(this.client.httpClient, code)
}
~~~

Extend `FakeSapClient` with these deterministic members; the integration tests in Tasks 7–9 assert the counters so no alternate client route can pass unnoticed:

~~~typescript
batchActivationCalls = 0
lastBatchActivation: import("abap-adt-api").InactiveObject[] = []
batchActivationResult: import("abap-adt-api").ActivationResult = {
  success: true,
  messages: [],
  inactive: []
}
classRunCalls = 0
replHealthCalls = 0
replExecuteCalls = 0

async activateObjects(objects: import("abap-adt-api").InactiveObject[]) {
  this.batchActivationCalls += 1
  this.lastBatchActivation = objects
  return this.batchActivationResult
}

async getCodeCompletionElement() {
  return structuredClone(DEVELOPMENT_PARITY_FIXTURES.completionElement)
}

async getAbapDocumentation() {
  return DEVELOPMENT_PARITY_FIXTURES.documentation
}

async getTypeHierarchy() {
  return structuredClone(DEVELOPMENT_PARITY_FIXTURES.typeHierarchy)
}

async getClassComponents() {
  return structuredClone(DEVELOPMENT_PARITY_FIXTURES.components)
}

async runClass(className: string) {
  this.classRunCalls += 1
  return `runner output: ${className}`
}

async checkReplAvailability() {
  this.replHealthCalls += 1
  return {
    status: "ok",
    version: "1",
    user: "DEVELOPER",
    system: "DEV",
    client: "100",
    production: false
  }
}

async executeAbapCode(code: string) {
  this.replExecuteCalls += 1
  return { success: true, output: code, error: "", runtime_ms: 1 }
}
~~~

- [ ] **Step 5: Verify GREEN**

~~~bash
npm run build && node --test dist/test/sap-client-contract.test.js dist/test/repl-client.test.js
~~~

Expected: all selected tests pass.

- [ ] **Step 6: Commit isolated client hunks**

~~~bash
git diff --cached --check
git commit -m "feat: add ADT parity client contracts"
~~~

### Task 5: Expose get_sap_capabilities

**Files:**

- Modify: src/tool-service.ts
- Modify: src/mcp-server.ts
- Modify: src/compat/abap-fs-tools.ts
- Modify: test/integration.test.ts
- Modify: test/compatibility.test.ts

- [ ] **Step 1: Write the failing integration test**

~~~typescript
const capabilities = await callJson("get_sap_capabilities", {
  connectionId: "DEV100",
  category: "repository",
  includeEvidence: true
})
assert.equal(capabilities.connectionId, "DEV100")
const repositoryCapabilities = capabilities.capabilities as Array<{ id: string; status: string }>
assert.equal(
  repositoryCapabilities.find(item => item.id === "repository.create.bdef")?.status,
  "unverified"
)
~~~

Set the intermediate expected total to 51 after adding the new name to EXTENDED_TOOL_NAMES and core.

- [ ] **Step 2: Verify RED**

~~~bash
npm run build && node --test dist/test/compatibility.test.js dist/test/integration.test.js
~~~

Expected: get_sap_capabilities is not registered.

- [ ] **Step 3: Implement ToolService listing**

Import `normalizeCapabilityError`, `SapCapabilityRegistry`, `SapCapabilityCategory`, and `SapCapabilityStatus`. Add a private registry and the one audited-call helper:

~~~typescript
private readonly capabilities = new SapCapabilityRegistry()

private async executeCapability<T>(
  connectionId: string,
  capabilityId: string,
  endpoint: string,
  operation: () => Promise<T>
): Promise<{ result: T; capabilityStatusAtExecution: SapCapabilityStatus }> {
  const capabilityStatusAtExecution = this.capabilities.status(connectionId, capabilityId)
  if (capabilityStatusAtExecution === "unsupported") {
    throw new AppError("SAP_CAPABILITY_UNAVAILABLE", `Capability ${capabilityId} is unavailable`, {
      capabilityId,
      endpoint
    })
  }
  try {
    const result = await operation()
    this.capabilities.observeSuccess(connectionId, capabilityId, endpoint)
    return { result, capabilityStatusAtExecution }
  } catch (error) {
    this.capabilities.observeFailure(connectionId, capabilityId, error, endpoint)
    throw normalizeCapabilityError(error, capabilityId, endpoint)
  }
}
~~~

Add the read-only listing method:

~~~typescript
async getSapCapabilities(
  connectionId: string,
  category?: SapCapabilityCategory,
  includeEvidence = true
) {
  const client = await this.connections.getClient(connectionId)
  const discovery = await client.getAdtDiscovery()
  const capabilities = this.capabilities.list(
    connectionId,
    JSON.stringify(discovery),
    category
  )
  return {
    connectionId: connectionId.trim().toUpperCase(),
    generatedAt: new Date().toISOString(),
    adapterVersion: "abap-adt-api@8.4.1",
    systemMetadata: await client.getSystemInfo(false),
    capabilities: includeEvidence
      ? capabilities
      : capabilities.map(({ evidence, ...item }) => item)
  }
}
~~~

No mutation probe is allowed.

- [ ] **Step 4: Register the MCP tool**

Register beside `get_sap_system_info`:

~~~typescript
registerTool(
  "get_sap_capabilities",
  {
    title: "Get SAP Capabilities",
    description:
      "Report implemented, missing, supported, unsupported, and live-unverified SAP development capabilities for one connection.",
    inputSchema: {
      connectionId: z.string().min(1),
      category: z.enum([
        "connection", "repository", "execution", "semantic", "quality", "debugging", "insight"
      ]).optional(),
      includeEvidence: z.boolean().default(true)
    },
    annotations: readOnlyAnnotations
  },
  async input => runTool(() => tools.getSapCapabilities(
    input.connectionId,
    input.category,
    input.includeEvidence
  ))
)
~~~

Append the name to `EXTENDED_TOOL_NAMES` and add it to the `core` toolset exactly once:

~~~typescript
export const EXTENDED_TOOL_NAMES = [
  "inspect_abap_code",
  "refactor_abap_code",
  "manage_abapgit",
  "manage_rap_generator",
  "manage_abap_versions",
  "compare_abap_systems",
  "get_abap_dependency_graph",
  "run_sap_transaction",
  "get_sap_capabilities"
] as const

core: [
  "get_connected_systems",
  "get_sap_system_info",
  "search_abap_objects",
  "get_abap_object_lines",
  "search_abap_object_lines",
  "get_abap_object_info",
  "get_batch_lines",
  "get_object_by_uri",
  "find_where_used",
  "get_abap_object_url",
  "get_abap_object_workspace_uri",
  "open_object",
  "abap_fs_documentation",
  "get_abap_sql_syntax",
  "get_abap_diagnostics",
  "inspect_abap_code",
  "get_sap_capabilities"
]
~~~

- [ ] **Step 5: Verify GREEN**

~~~bash
npm run build && node --test dist/test/compatibility.test.js dist/test/integration.test.js
~~~

Expected: capability call passes and intermediate total is 51.

- [ ] **Step 6: Commit isolated capability-tool hunks**

~~~bash
git diff --cached --check
git commit -m "feat: expose SAP capability status"
~~~

### Task 6: Complete BDEF source creation

**Files:**

- Modify: src/tool-service.ts
- Modify: src/mcp-server.ts
- Modify: test/integration.test.ts

- [ ] **Step 1: Write failing BDEF pipeline tests**

Test successful BDEF source write/activation, activate without source, and post-create write failure:

~~~typescript
const created = await service.createObjectProgrammatically({
  objectType: "BDEF/BDO",
  name: "ZI_DEMO",
  description: "Demo behavior",
  packageName: "Z_DEMO",
  connectionId: "DEV100",
  source: "managed implementation in class zbp_i_demo unique;",
  activate: true,
  additionalOptions: {
    transportRequest: { type: "existing", number: "DEVK900123" }
  }
}) as {
  object: { type: string }
  activation: { success: boolean } | null
}
assert.equal(created.object.type, "BDEF/BDO")
assert.equal(created.activation.success, true)
~~~

The invalid case must reject with `SAP_VALIDATION_FAILED` and `details.reason === "SOURCE_REQUIRED_FOR_ACTIVATION"`. A forced `replaceSource` failure must return `SAP_OPERATION_FAILED` details containing `created: true`, `stage: "write_source"`, `objectUri`, `transport`, and `manualCleanupRequired: true`.

- [ ] **Step 2: Verify RED**

~~~bash
npm run build && node --test --test-name-pattern="BDEF|create object" dist/test/integration.test.js
~~~

Expected: source and activate are not accepted.

- [ ] **Step 3: Add pre-mutation validation**

Extend `CreateObjectInput`:

~~~typescript
export interface CreateObjectInput {
  objectType: string
  name: string
  description: string
  packageName: string
  parentName?: string
  connectionId: string
  source?: string
  activate: boolean
  additionalOptions?: {
    serviceDefinition?: string
    bindingType?: "ODATA"
    bindingCategory?: BindingCategory
    softwareComponent?: string
    packageType?: PackageTypes
    transportLayer?: string
    transportRequest?:
      | { type: "existing"; number: string }
      | { type: "new"; description: string }
  }
}
~~~

Add these MCP fields and forward both values:

~~~typescript
source: z.string().optional(),
activate: z.boolean().default(false),

activate: input.activate,
...(input.source !== undefined ? { source: input.source } : {}),
~~~

Place this validation before `validateNewObject`:

~~~typescript
if (input.activate && input.source === undefined) {
  throw new AppError(
    "SAP_VALIDATION_FAILED",
    "activate=true requires source",
    { reason: "SOURCE_REQUIRED_FOR_ACTIVATION" }
  )
}
if (input.source !== undefined && objectType !== "BDEF/BDO") {
  throw new AppError(
    "SAP_VALIDATION_FAILED",
    "Create-time source is supported only for BDEF/BDO in this delivery",
    { reason: "CREATE_SOURCE_UNSUPPORTED" }
  )
}
~~~

For BDEF, wrap `validateNewObject` and normalize a negative validation result; retain the existing error code for every pre-existing object type:

~~~typescript
let validation: ValidationResult
try {
  validation = await client.validateNewObject(validateOptions)
} catch (error) {
  if (objectType !== "BDEF/BDO") throw error
  this.capabilities.observeFailure(
    input.connectionId,
    "repository.create.bdef",
    error,
    "bo/behaviordefinitions/validation"
  )
  throw normalizeCapabilityError(
    error,
    "repository.create.bdef",
    "bo/behaviordefinitions/validation",
    true
  )
}
if (!validation.success) {
  throw new AppError(
    objectType === "BDEF/BDO" ? "SAP_VALIDATION_FAILED" : "OBJECT_VALIDATION_FAILED",
    validation.SHORT_TEXT || `SAP rejected ${objectType} ${name}`,
    { validation }
  )
}
~~~

- [ ] **Step 4: Add staged post-create handling**

Capture `capabilityStatusAtExecution` before `createObject`. Replace the existing create-and-return tail with:

~~~typescript
const capabilityStatusAtExecution = objectType === "BDEF/BDO"
  ? this.capabilities.status(input.connectionId, "repository.create.bdef")
  : undefined
if (capabilityStatusAtExecution === "unsupported") {
  throw new AppError("SAP_CAPABILITY_UNAVAILABLE", "BDEF creation is unavailable", {
    capabilityId: "repository.create.bdef",
    endpoint: "bo/behaviordefinitions"
  })
}

try {
  await client.createObject(createOptions)
  if (objectType === "BDEF/BDO") {
    this.capabilities.observeSuccess(
      input.connectionId,
      "repository.create.bdef",
      "bo/behaviordefinitions"
    )
  }
} catch (error) {
  if (objectType !== "BDEF/BDO") throw error
  this.capabilities.observeFailure(
    input.connectionId,
    "repository.create.bdef",
    error,
    "bo/behaviordefinitions"
  )
  throw normalizeCapabilityError(
    error,
    "repository.create.bdef",
    "bo/behaviordefinitions"
  )
}

const created = {
  connectionId: input.connectionId.toUpperCase(),
  success: true,
  object: { name, type: objectType, uri: targetUri, packageName: writePackage },
  transport: transport ?? null,
  ...(capabilityStatusAtExecution ? { capabilityStatusAtExecution } : {})
}
if (input.source === undefined) return created

let stage = "read_source"
try {
  const current = await client.readSourceByUri(targetUri)
  stage = "write_source"
  const mutation = await client.replaceSource(
    name,
    targetUri,
    current.sourceUri,
    current.source,
    input.source,
    transport,
    input.activate
  )
  return {
    ...created,
    sourceUri: current.sourceUri,
    diagnostics: mutation.diagnostics,
    activation: mutation.activation ?? null,
    activationSkipped: mutation.activationSkipped
  }
} catch (error) {
  const normalized = normalizeCapabilityError(
    error,
    "repository.create.bdef",
    stage
  )
  throw new AppError(normalized.code, normalized.message, {
    ...normalized.details,
    stage,
    created: true,
    objectUri: targetUri,
    transport: transport ?? null,
    manualCleanupRequired: true
  })
}
~~~

There is deliberately no delete call in this branch.

- [ ] **Step 5: Verify GREEN**

~~~bash
npm run build && node --test --test-name-pattern="BDEF|create object" dist/test/integration.test.js dist/test/bdef-creator.test.js
~~~

Expected: all selected tests pass.

- [ ] **Step 6: Commit isolated BDEF pipeline hunks**

~~~bash
git diff --cached --check
git commit -m "feat: create and activate BDEF source"
~~~

### Task 7: Add one-request batch activation

**Files:**

- Modify: src/tool-service.ts
- Modify: src/mcp-server.ts
- Modify: test/integration.test.ts

- [ ] **Step 1: Write failing tests**

Replace `ActivateObjectInput` with the discriminated-by-property union before writing the tests:

~~~typescript
export type ActivateObjectInput =
  | { url: string; connectionId?: string }
  | { urls: string[]; connectionId?: string }
~~~

Extend `FakeSapClient.searchObjects` and `getObjectStructure` so the two fixtures resolve to distinct objects in `Z_DEMO`:

~~~typescript
const normalizedQuery = query.trim().toUpperCase()
if (["ZCL_FIRST", "ZCL_SECOND"].includes(normalizedQuery)) {
  return [{
    name: normalizedQuery,
    type: "CLAS/OC",
    uri: `/sap/bc/adt/oo/classes/${normalizedQuery.toLowerCase()}`,
    description: normalizedQuery,
    packageName: "Z_DEMO"
  }]
}

const uriName = /\/classes\/([^/]+)/i.exec(uri)?.[1]?.toUpperCase()
const structureName = uriName ?? object.name
return {
  objectUrl: uri,
  metaData: {
    "adtcore:name": structureName,
    "adtcore:type": "CLAS/OC",
    "adtcore:changedAt": 0,
    "adtcore:changedBy": "DEVELOPER",
    "adtcore:createdAt": 0,
    "adtcore:language": "EN",
    "adtcore:responsible": "DEVELOPER",
    "adtcore:version": "active"
  },
  links: []
}
~~~

Make `getInactiveObjects` return both exact inactive objects, then test two URLs, both `url` and `urls`, empty `urls`, cross-connection URLs, partial SAP response, and legacy `url`:

~~~typescript
async getInactiveObjects() {
  return ["ZCL_FIRST", "ZCL_SECOND"].map(name => ({
    object: {
      "adtcore:name": name,
      "adtcore:type": "CLAS/OC",
      "adtcore:uri": `/sap/bc/adt/oo/classes/${name.toLowerCase()}`,
      "adtcore:parentUri": "",
      user: "DEVELOPER",
      deleted: false
    }
  }))
}

await assert.rejects(
  service.activateObject(
    { url: object.uri, urls: [object.uri] } as unknown as
      Parameters<typeof service.activateObject>[0]
  ),
  (error: unknown) => error instanceof Error && error.message.includes("exactly one")
)
await assert.rejects(
  service.activateObject({ urls: [] }),
  (error: unknown) => error instanceof Error && error.message.includes("1 through 100")
)
await assert.rejects(
  service.activateObject({
    urls: [
      "adt://dev100/sap/bc/adt/oo/classes/zcl_first/source/main",
      "adt://qas200/sap/bc/adt/oo/classes/zcl_second/source/main"
    ]
  }),
  (error: unknown) => error instanceof Error && error.message.includes("one connection")
)
~~~

The batch success assertion is:

~~~typescript
const activated = await callJson("abap_activate", {
  urls: [
    "adt://dev100/sap/bc/adt/oo/classes/zcl_first/source/main",
    "adt://dev100/sap/bc/adt/oo/classes/zcl_second/source/main"
  ]
})
assert.equal(activated.status, "complete")
assert.equal(fake.batchActivationCalls, 1)
assert.equal(fake.lastBatchActivation.length, 2)
~~~

Force an object-specific partial response and assert SAP evidence controls the classification:

~~~typescript
fake.batchActivationResult = {
  ...structuredClone(DEVELOPMENT_PARITY_FIXTURES.activationPartial),
  inactive: [(await fake.getInactiveObjects())[1]!]
}
const partial = await callJson("abap_activate", {
  urls: [
    "adt://dev100/sap/bc/adt/oo/classes/zcl_first/source/main",
    "adt://dev100/sap/bc/adt/oo/classes/zcl_second/source/main"
  ]
})
assert.equal(partial.status, "partial")
assert.deepEqual(
  (partial.objectResults as Array<{ outcome: string }>).map(item => item.outcome),
  ["unknown", "failed"]
)
~~~

- [ ] **Step 2: Verify RED**

~~~bash
npm run build && node --test --test-name-pattern="activate" dist/test/integration.test.js dist/test/sap-client-contract.test.js
~~~

Expected: schema rejects urls.

- [ ] **Step 3: Extend schema**

Declare this schema next to the registrations and use it as `abap_activate.inputSchema`:

~~~typescript
const activationInputSchema = z.union([
  z.object({
    url: z.string().min(1),
    connectionId: z.string().min(1).optional()
  }).strict(),
  z.object({
    urls: z.array(z.string().min(1)).min(1).max(100),
    connectionId: z.string().min(1).optional()
  }).strict()
])

registerTool(
  "abap_activate",
  {
    title: "Activate ABAP Object(s)",
    description:
      "Activate one legacy object or one same-connection batch of 1 through 100 ABAP objects.",
    inputSchema: activationInputSchema,
    annotations: writeAnnotations
  },
  async input => runTool(() => tools.activateObject(input))
)
~~~

- [ ] **Step 4: Implement batch behavior**

Keep the existing legacy body under `if ("url" in input)`. For the batch branch, add this exact implementation; `objectUriFromSourceUri` is the existing normalizer:

~~~typescript
const hasUrl = typeof (input as { url?: unknown }).url === "string"
const hasUrls = Array.isArray((input as { urls?: unknown }).urls)
if (hasUrl === hasUrls) {
  throw new AppError("SAP_VALIDATION_FAILED", "Provide exactly one of url or urls", {
    reason: "ACTIVATION_INPUT_AMBIGUOUS"
  })
}
if ("url" in input) {
  const target = await this.resolveEditableTarget({
    fileUri: input.url,
    ...(input.connectionId ? { connectionId: input.connectionId } : {})
  })
  requireWritablePackage(target.client, target.object.packageName)
  const result = await target.client.activateObject(
    target.object.name,
    target.objectUri,
    target.mainProgram
  )
  return {
    connectionId: target.connectionId,
    object: target.object,
    success: result.success,
    messages: result.messages,
    inactive: result.inactive
  }
}

const urls = input.urls
if (urls.length < 1 || urls.length > 100) {
  throw new AppError("SAP_VALIDATION_FAILED", "Batch activation requires 1 through 100 URLs", {
    reason: "ACTIVATION_CARDINALITY_INVALID"
  })
}

const locations = urls.map(url => parseAdtLocation(url, input.connectionId))
const connectionIds = [...new Set(locations.map(item => item.connectionId))]
if (connectionIds.length !== 1) {
  throw new AppError("SAP_VALIDATION_FAILED", "Batch activation requires exactly one connection", {
    reason: "CROSS_CONNECTION_BATCH"
  })
}
const connectionId = connectionIds[0]!
const client = await this.connections.getClient(connectionId)
const targets: EditableTarget[] = []
for (const location of locations) {
  const target = await this.resolveEditableTarget({
    fileUri: location.path,
    connectionId
  })
  requireWritablePackage(client, target.object.packageName)
  targets.push(target)
}

const inactiveRecords = await client.getInactiveObjects()
const inactiveObjects = inactiveRecords.flatMap(record => record.object ? [record.object] : [])
const inactiveByUri = new Map(inactiveObjects.map(item => [
  objectUriFromSourceUri(item["adtcore:uri"]).replace(/\/+$/, ""),
  item
]))
const selected = targets.flatMap(target => {
  const item = inactiveByUri.get(target.objectUri.replace(/\/+$/, ""))
  return item ? [item] : []
})

const capabilityStatusAtExecution = this.capabilities.status(
  connectionId,
  "repository.activate.batch"
)
const activation = selected.length > 0
  ? (await this.executeCapability(
      connectionId,
      "repository.activate.batch",
      "/sap/bc/adt/activation",
      () => client.activateObjects(selected)
    )).result
  : { success: false, messages: [], inactive: [] }

const remainingUris = new Set(
  activation.inactive.flatMap(record => record.object ? [
    objectUriFromSourceUri(record.object["adtcore:uri"]).replace(/\/+$/, "")
  ] : [])
)
const isError = (type: string) => /^(E|A|X|ERROR)$/i.test(type.trim())
const objectResults = targets.map(target => {
  const uri = target.objectUri.replace(/\/+$/, "")
  const wasSubmitted = selected.some(item =>
    objectUriFromSourceUri(item["adtcore:uri"]).replace(/\/+$/, "") === uri
  )
  const messages = activation.messages.filter(message =>
    objectUriFromSourceUri(message.href || "").replace(/\/+$/, "") === uri ||
    message.objDescr.toUpperCase().includes(target.object.name.toUpperCase())
  )
  const outcome = remainingUris.has(uri) || messages.some(message => isError(message.type))
    ? "failed"
    : wasSubmitted && activation.success
      ? "activated"
      : "unknown"
  return { object: target.object, outcome, messages }
})
const status = objectResults.every(item => item.outcome === "activated")
  ? "complete"
  : objectResults.every(item => item.outcome === "failed")
    ? "failed"
    : "partial"

return {
  connectionId,
  status,
  requested: targets.map(target => target.object),
  objectResults,
  messages: activation.messages,
  remainingInactive: activation.inactive,
  capabilityStatusAtExecution
}
~~~

No code in this branch sorts dependencies, retries another endpoint, or rolls back.

- [ ] **Step 5: Verify GREEN**

~~~bash
npm run build && node --test --test-name-pattern="activate" dist/test/integration.test.js dist/test/sap-client-contract.test.js
~~~

Expected: legacy, complete, partial, and unknown activation tests pass.

- [ ] **Step 6: Commit isolated activation hunks**

~~~bash
git diff --cached --check
git commit -m "feat: activate ABAP objects in one batch"
~~~

### Task 8: Extend semantic inspection

**Files:**

- Modify: src/tool-service.ts
- Modify: src/mcp-server.ts
- Modify: test/integration.test.ts

- [ ] **Step 1: Write failing MCP tests**

Add these calls and assertions:

~~~typescript
const semanticFile = "adt://dev100/sap/bc/adt/oo/classes/zcl_demo/source/main"
const element = await callJson("inspect_abap_code", {
  action: "completion_element",
  fileUri: semanticFile,
  line: 3,
  column: 8
})
assert.equal(element.format, "structured")
assert.equal((element.element as { name: string }).name, "WRITE")

const documentation = await callJson("inspect_abap_code", {
  action: "documentation",
  fileUri: semanticFile,
  line: 3,
  column: 8
})
assert.equal(documentation.format, "html")
assert.match((documentation.content as string), /WRITE documentation/)
assert.equal(documentation.truncated, false)

const hierarchy = await callJson("inspect_abap_code", {
  action: "type_hierarchy",
  fileUri: semanticFile,
  line: 1,
  column: 0,
  superTypes: true,
  startIndex: 0,
  maxResults: 10
})
assert.equal((hierarchy.nodes as Array<{ name: string }>)[0]?.name, "ZCL_PARENT")

const components = await callJson("inspect_abap_code", {
  action: "components",
  fileUri: semanticFile,
  startIndex: 0,
  maxResults: 10
})
assert.equal((components.components as Array<{ name: string }>)[0]?.name, "RUN")
~~~

- [ ] **Step 2: Verify RED**

~~~bash
npm run build && node --test --test-name-pattern="semantic|inspect" dist/test/integration.test.js dist/test/sap-client-contract.test.js
~~~

Expected: new enum values are rejected.

- [ ] **Step 3: Extend types and schema**

Replace the action union and add `superTypes`:

~~~typescript
export interface InspectCodeInput extends WorkspaceFileInput {
  action:
    | "completion"
    | "definition"
    | "quick_fixes"
    | "format_preview"
    | "completion_element"
    | "documentation"
    | "type_hierarchy"
    | "components"
  line: number
  column: number
  endColumn?: number
  implementation: boolean
  superTypes: boolean
  startIndex: number
  maxResults: number
}
~~~

Replace the MCP action property, add the input property, and add the forwarded property:

~~~typescript
action: z.enum([
  "completion",
  "definition",
  "quick_fixes",
  "format_preview",
  "completion_element",
  "documentation",
  "type_hierarchy",
  "components"
]),
superTypes: z.boolean().default(false),

superTypes: input.superTypes,
~~~

- [ ] **Step 4: Implement exact branches**

Add this UTF-8-safe helper beside `selectLines`:

~~~typescript
function boundInlineText(value: string, byteLimit = INLINE_TEXT_BYTE_LIMIT) {
  const originalBytes = Buffer.byteLength(value, "utf8")
  if (originalBytes <= byteLimit) {
    return { content: value, originalBytes, returnedBytes: originalBytes, truncated: false }
  }
  const characters = [...value]
  let low = 0
  let high = characters.length
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (Buffer.byteLength(characters.slice(0, middle).join(""), "utf8") <= byteLimit) low = middle
    else high = middle - 1
  }
  const content = characters.slice(0, low).join("")
  return {
    content,
    originalBytes,
    returnedBytes: Buffer.byteLength(content, "utf8"),
    truncated: true
  }
}
~~~

Insert these branches after existing completion and before the formatter fallback:

~~~typescript
if (input.action === "completion_element") {
  const { result, capabilityStatusAtExecution } = await this.executeCapability(
    target.connectionId,
    "semantic.completion_element",
    "/sap/bc/adt/abapsource/codecompletion/elementinfo",
    () => target.client.getCodeCompletionElement(
      target.sourceUri,
      target.source,
      input.line,
      input.column
    )
  )
  if (typeof result === "string") {
    return {
      connectionId: target.connectionId,
      object: target.object,
      format: "legacy",
      ...boundInlineText(result),
      capabilityStatusAtExecution
    }
  }
  const doc = boundInlineText(result.doc)
  const componentPage = pageItems(result.components, input.startIndex, input.maxResults)
  return {
    connectionId: target.connectionId,
    object: target.object,
    format: "structured",
    element: {
      name: result.name,
      type: result.type,
      href: result.href,
      doc: doc.content,
      docTruncated: doc.truncated,
      componentTotal: componentPage.total,
      componentStartIndex: componentPage.startIndex,
      componentsReturned: componentPage.returned,
      componentsTruncated: componentPage.truncated,
      componentsNextStartIndex: componentPage.nextStartIndex,
      components: componentPage.items
    },
    capabilityStatusAtExecution
  }
}

if (input.action === "documentation") {
  const { result, capabilityStatusAtExecution } = await this.executeCapability(
    target.connectionId,
    "semantic.documentation",
    "/sap/bc/adt/docu/abap/langu",
    () => target.client.getAbapDocumentation(
      target.objectUri,
      target.source,
      input.line,
      input.column
    )
  )
  return {
    connectionId: target.connectionId,
    object: target.object,
    format: /<[^>]+>/.test(result) ? "html" : "text",
    ...boundInlineText(result),
    capabilityStatusAtExecution
  }
}

if (input.action === "type_hierarchy") {
  const { result, capabilityStatusAtExecution } = await this.executeCapability(
    target.connectionId,
    "semantic.type_hierarchy",
    "/sap/bc/adt/abapsource/typehierarchy",
    () => target.client.getTypeHierarchy(
      target.sourceUri,
      target.source,
      input.line,
      input.column,
      input.superTypes
    )
  )
  const page = pageItems(result, input.startIndex, input.maxResults)
  return {
    connectionId: target.connectionId,
    object: target.object,
    total: page.total,
    startIndex: page.startIndex,
    returned: page.returned,
    truncated: page.truncated,
    nextStartIndex: page.nextStartIndex,
    nodes: page.items,
    capabilityStatusAtExecution
  }
}

if (input.action === "components") {
  const baseType = target.object.type.toUpperCase().split("/", 1)[0]
  if (baseType !== "CLAS" && baseType !== "INTF") {
    throw new AppError("SAP_VALIDATION_FAILED", "components requires a class or interface", {
      reason: "COMPONENTS_OBJECT_TYPE_INVALID",
      objectType: target.object.type
    })
  }
  const endpoint = `${target.objectUri}/objectstructure`
  const { result, capabilityStatusAtExecution } = await this.executeCapability(
    target.connectionId,
    "semantic.components",
    endpoint,
    () => target.client.getClassComponents(target.objectUri)
  )
  const page = pageItems(result.components, input.startIndex, input.maxResults)
  return {
    connectionId: target.connectionId,
    object: target.object,
    root: {
      name: result["adtcore:name"],
      type: result["adtcore:type"],
      visibility: result.visibility
    },
    total: page.total,
    startIndex: page.startIndex,
    returned: page.returned,
    truncated: page.truncated,
    nextStartIndex: page.nextStartIndex,
    components: page.items.map(item => ({
      name: item["adtcore:name"],
      type: item["adtcore:type"],
      visibility: item.visibility,
      constant: item.constant ?? false,
      readOnly: item.readOnly ?? false,
      childCount: item.components.length
    })),
    capabilityStatusAtExecution
  }
}
~~~

Every branch makes one public `SapClient` call through `executeCapability`; an error is observed, normalized, and rethrown without a second route.

- [ ] **Step 5: Verify GREEN**

~~~bash
npm run build && node --test --test-name-pattern="semantic|inspect" dist/test/integration.test.js dist/test/sap-client-contract.test.js
~~~

Expected: existing and new inspect actions pass.

- [ ] **Step 6: Commit isolated semantic hunks**

~~~bash
git diff --cached --check
git commit -m "feat: expose detailed ABAP semantic services"
~~~

### Task 9: Add guarded class and REPL execution

**Files:**

- Modify: src/tool-service.ts
- Modify: src/mcp-server.ts
- Modify: src/compat/abap-fs-tools.ts
- Modify: test/integration.test.ts
- Modify: test/compatibility.test.ts

- [ ] **Step 1: Write failing execution tests**

Add the class happy path:

~~~typescript
const preview = await callJson("run_abap_application", {
  action: "preview_class",
  connectionId: "DEV100",
  className: "ZCL_RUNNER"
})
const executed = await callJson("run_abap_application", {
  action: "execute",
  connectionId: "DEV100",
  planId: preview.planId,
  confirmation: preview.confirmation
})
assert.equal(executed.kind, "class")
assert.match(executed.output, /runner output/)
~~~

Repeat it for `preview_snippet` with `code: "WRITE 42."`, then assert `fake.replHealthCalls === 1`, `fake.replExecuteCalls === 1`, and returned output contains `WRITE 42.`. Add these exact plan-safety assertions:

~~~typescript
const mismatch = await service.runAbapApplication({
  action: "preview_class",
  connectionId: "DEV100",
  className: "ZCL_RUNNER"
}) as { planId: string; confirmation: string }
await assert.rejects(
  service.runAbapApplication({
    action: "execute",
    connectionId: "DEV100",
    planId: mismatch.planId,
    confirmation: "WRONG"
  }),
  (error: unknown) => error instanceof Error && error.message.includes("confirmation")
)
await service.runAbapApplication({
  action: "execute",
  connectionId: "DEV100",
  planId: mismatch.planId,
  confirmation: mismatch.confirmation
})
await assert.rejects(
  service.runAbapApplication({
    action: "execute",
    connectionId: "DEV100",
    planId: mismatch.planId,
    confirmation: mismatch.confirmation
  }),
  (error: unknown) => error instanceof Error && error.message.includes("missing or expired")
)

fake.replProduction = true
const blockedSnippet = await service.runAbapApplication({
  action: "preview_snippet",
  connectionId: "DEV100",
  code: "WRITE 42."
}) as { planId: string; confirmation: string }
await assert.rejects(
  service.runAbapApplication({
    action: "execute",
    connectionId: "DEV100",
    planId: blockedSnippet.planId,
    confirmation: blockedSnippet.confirmation
  }),
  (error: unknown) => error instanceof Error && error.message.includes("production")
)
~~~

Add the configurable fake field and return it from health:

~~~typescript
replProduction = false

async checkReplAvailability() {
  this.replHealthCalls += 1
  return {
    status: "ok",
    version: "1",
    user: "DEVELOPER",
    system: "DEV",
    client: "100",
    production: this.replProduction
  }
}
~~~

Use the existing production-profile fixture for this assertion:

~~~typescript
await assert.rejects(
  productionService.runAbapApplication({
    action: "preview_class",
    connectionId: "PRD100",
    className: "ZCL_RUNNER"
  }),
  (error: unknown) => error instanceof Error && error.message.includes("production")
)
await assert.rejects(
  productionService.runAbapApplication({
    action: "preview_snippet",
    connectionId: "PRD100",
    code: "WRITE 42."
  }),
  (error: unknown) => error instanceof Error && error.message.includes("production")
)
assert.equal(productionFake.classRunCalls, 0)
assert.equal(productionFake.replExecuteCalls, 0)
~~~

Test expiry without sleeping and restore the global clock in `finally`:

~~~typescript
const realNow = Date.now
let now = realNow()
Date.now = () => now
try {
  const expiring = await service.runAbapApplication({
    action: "preview_class",
    connectionId: "DEV100",
    className: "ZCL_RUNNER"
  }) as { planId: string; confirmation: string }
  now += 10 * 60 * 1000 + 1
  await assert.rejects(
    service.runAbapApplication({
      action: "execute",
      connectionId: "DEV100",
      planId: expiring.planId,
      confirmation: expiring.confirmation
    }),
    (error: unknown) => error instanceof Error && error.message.includes("missing or expired")
  )
} finally {
  Date.now = realNow
}
~~~

- [ ] **Step 2: Verify RED**

~~~bash
npm run build && node --test --test-name-pattern="application|REPL|class runner" dist/test/integration.test.js dist/test/repl-client.test.js
~~~

Expected: run_abap_application is absent.

- [ ] **Step 3: Add isolated execution-plan storage**

Define the input and plan types next to `RefactorPlan`:

~~~typescript
export type RunAbapApplicationInput =
  | { action: "repl_health"; connectionId: string }
  | { action: "preview_class"; connectionId: string; className: string }
  | { action: "preview_snippet"; connectionId: string; code: string }
  | {
      action: "execute"
      connectionId: string
      planId: string
      confirmation: string
    }

type ExecutionPlanPayload =
  | { kind: "class"; className: string; code?: never }
  | { kind: "snippet"; code: string; className?: never }

type ExecutionPlan = {
  id: string
  connectionId: string
  confirmation: string
  expiresAt: number
} & ExecutionPlanPayload

type ExecutionPlanDraft = {
  connectionId: string
  confirmation: string
} & ExecutionPlanPayload
~~~

Add a separate map and exact cache/take methods; do not widen `RefactorPlan`:

~~~typescript
private readonly executionPlans = new Map<string, ExecutionPlan>()

private cacheExecutionPlan(plan: ExecutionPlanDraft): ExecutionPlan {
  const now = Date.now()
  for (const [id, cached] of this.executionPlans) {
    if (cached.expiresAt <= now) this.executionPlans.delete(id)
  }
  while (this.executionPlans.size >= MAX_CACHED_PLANS) {
    const oldest = this.executionPlans.keys().next().value as string | undefined
    if (!oldest) break
    this.executionPlans.delete(oldest)
  }
  const cached = { ...plan, id: randomUUID(), expiresAt: now + PLAN_TTL_MS }
  this.executionPlans.set(cached.id, cached)
  return cached
}

private takeExecutionPlan(
  planId: string,
  confirmation: string,
  connectionId: string
): ExecutionPlan {
  const plan = this.executionPlans.get(planId)
  if (!plan || plan.expiresAt <= Date.now()) {
    this.executionPlans.delete(planId)
    throw new AppError("SAP_VALIDATION_FAILED", "Execution plan is missing or expired", {
      reason: "EXECUTION_PLAN_EXPIRED"
    })
  }
  if (plan.connectionId !== connectionId.trim().toUpperCase()) {
    throw new AppError("SAP_VALIDATION_FAILED", "Execution plan belongs to another connection", {
      reason: "EXECUTION_PLAN_CONNECTION_MISMATCH"
    })
  }
  if (plan.confirmation !== confirmation) {
    throw new AppError("SAP_VALIDATION_FAILED", "Execution confirmation does not match", {
      reason: "CONFIRMATION_MISMATCH"
    })
  }
  this.executionPlans.delete(planId)
  return plan
}
~~~

Generate confirmations with these exact expressions:

~~~typescript
const classConfirmation = `RUN_CLASS:${connectionId}:${className}`
const snippetDigest = createHash("sha256").update(code).digest("hex").slice(0, 12)
const snippetConfirmation = `RUN_SNIPPET:${connectionId}:${snippetDigest}`
~~~

Plans are one-use and deleted on successful take or expiry.

- [ ] **Step 4: Implement actions**

Add the execution-specific production guard, then implement `runAbapApplication`:

~~~typescript
function requireExecutableProfile(client: SapClient): void {
  if (client.profile.environment === "production") {
    throw new AppError("SAP_CAPABILITY_UNAVAILABLE", "ABAP execution is disabled on production", {
      reason: "PRODUCTION_EXECUTION_BLOCKED",
      connectionId: client.profile.id
    })
  }
}

async runAbapApplication(input: RunAbapApplicationInput) {
  const connectionId = input.connectionId.trim().toUpperCase()
  const client = await this.connections.getClient(connectionId)

  if (input.action === "repl_health") {
    const { result, capabilityStatusAtExecution } = await this.executeCapability(
      connectionId,
      "execution.abap_repl",
      "/sap/bc/z_abap_repl",
      () => client.checkReplAvailability()
    )
    return { connectionId, health: result, capabilityStatusAtExecution }
  }

  if (input.action === "preview_class") {
    requireExecutableProfile(client)
    const className = input.className.trim()
    if (
      className !== className.toUpperCase() ||
      className.length > 30 ||
      !/^(?:\/[A-Z0-9_]+\/)?[A-Z][A-Z0-9_]*$/.test(className)
    ) {
      throw new AppError("SAP_VALIDATION_FAILED", "className must be an uppercase ABAP class name", {
        reason: "CLASS_NAME_INVALID"
      })
    }
    const confirmation = `RUN_CLASS:${connectionId}:${className}`
    const plan = this.cacheExecutionPlan({
      kind: "class",
      connectionId,
      className,
      confirmation
    })
    return {
      action: input.action,
      planId: plan.id,
      confirmation,
      expiresAt: new Date(plan.expiresAt).toISOString(),
      capabilityStatusAtExecution: this.capabilities.status(connectionId, "execution.class_runner")
    }
  }

  if (input.action === "preview_snippet") {
    requireExecutableProfile(client)
    const bytes = Buffer.byteLength(input.code, "utf8")
    if (!input.code.trim() || bytes > INLINE_TEXT_BYTE_LIMIT) {
      throw new AppError("SAP_VALIDATION_FAILED", "code must contain 1 through 98304 UTF-8 bytes", {
        reason: "SNIPPET_SIZE_INVALID",
        bytes
      })
    }
    const digest = createHash("sha256").update(input.code).digest("hex").slice(0, 12)
    const confirmation = `RUN_SNIPPET:${connectionId}:${digest}`
    const plan = this.cacheExecutionPlan({
      kind: "snippet",
      connectionId,
      code: input.code,
      confirmation
    })
    return {
      action: input.action,
      planId: plan.id,
      confirmation,
      expiresAt: new Date(plan.expiresAt).toISOString(),
      codeBytes: bytes,
      capabilityStatusAtExecution: this.capabilities.status(connectionId, "execution.abap_repl")
    }
  }

  const plan = this.takeExecutionPlan(input.planId, input.confirmation, connectionId)
  requireExecutableProfile(client)
  if (plan.kind === "class") {
    const className = plan.className
    const { result, capabilityStatusAtExecution } = await this.executeCapability(
      connectionId,
      "execution.class_runner",
      `/sap/bc/adt/oo/classrun/${className}`,
      () => client.runClass(className)
    )
    const bounded = boundInlineText(result)
    return {
      connectionId,
      kind: plan.kind,
      output: bounded.content,
      originalBytes: bounded.originalBytes,
      returnedBytes: bounded.returnedBytes,
      truncated: bounded.truncated,
      capabilityStatusAtExecution
    }
  }

  const health = await this.executeCapability(
    connectionId,
    "execution.abap_repl",
    "/sap/bc/z_abap_repl",
    () => client.checkReplAvailability()
  )
  if (health.result.production) {
    throw new AppError("SAP_CAPABILITY_UNAVAILABLE", "ABAP REPL is disabled on production", {
      capabilityId: "execution.abap_repl",
      endpoint: "/sap/bc/z_abap_repl"
    })
  }
  const executed = await this.executeCapability(
    connectionId,
    "execution.abap_repl",
    "/sap/bc/z_abap_repl",
    () => client.executeAbapCode(plan.code)
  )
  const output = boundInlineText(executed.result.output)
  const error = boundInlineText(
    executed.result.error,
    Math.max(0, INLINE_TEXT_BYTE_LIMIT - output.returnedBytes)
  )
  return {
    connectionId,
    kind: plan.kind,
    success: executed.result.success,
    output: output.content,
    error: error.content,
    runtime_ms: executed.result.runtime_ms,
    originalBytes: output.originalBytes + error.originalBytes,
    returnedBytes: output.returnedBytes + error.returnedBytes,
    truncated: output.truncated || error.truncated,
    capabilityStatusAtExecution: executed.capabilityStatusAtExecution
  }
}
~~~

- [ ] **Step 5: Register and count**

Declare the action-dependent schema and register the tool:

~~~typescript
const runAbapApplicationInputSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("repl_health"), connectionId: z.string().min(1) }).strict(),
  z.object({
    action: z.literal("preview_class"),
    connectionId: z.string().min(1),
    className: z.string().min(1)
  }).strict(),
  z.object({
    action: z.literal("preview_snippet"),
    connectionId: z.string().min(1),
    code: z.string().min(1).max(98_304)
  }).strict(),
  z.object({
    action: z.literal("execute"),
    connectionId: z.string().min(1),
    planId: z.string().uuid(),
    confirmation: z.string().min(1)
  }).strict()
])

registerTool(
  "run_abap_application",
  {
    title: "Run ABAP Application",
    description:
      "Check the audited ABAP FS REPL or preview and execute a confirmed class/snippet plan.",
    inputSchema: runAbapApplicationInputSchema,
    annotations: writeAnnotations
  },
  async input => runTool(() => tools.runAbapApplication(input))
)
~~~

Use this final extended list and add the execution tool to `write`:

~~~typescript
export const EXTENDED_TOOL_NAMES = [
  "inspect_abap_code",
  "refactor_abap_code",
  "manage_abapgit",
  "manage_rap_generator",
  "manage_abap_versions",
  "compare_abap_systems",
  "get_abap_dependency_graph",
  "run_sap_transaction",
  "get_sap_capabilities",
  "run_abap_application"
] as const

write: [
  "create_object_programmatically",
  "manage_text_elements",
  "create_test_include",
  "abap_activate",
  "replace_string_in_abap_object",
  "refactor_abap_code",
  "manage_abapgit",
  "manage_rap_generator",
  "manage_abap_versions",
  "run_abap_application"
]
~~~

The final total is 52.

- [ ] **Step 6: Verify GREEN**

~~~bash
npm run build && node --test dist/test/repl-client.test.js dist/test/compatibility.test.js dist/test/integration.test.js
~~~

Expected: execution safety passes, total is 52, and schema is below 64 KiB.

- [ ] **Step 7: Commit isolated execution hunks**

~~~bash
git diff --cached --check
git commit -m "feat: run ABAP classes and REPL snippets safely"
~~~

### Task 10: Correct compatibility truth and document live acceptance

**Files:**

- Modify: src/compat/abap-fs-tools.ts
- Modify: src/compat/abap-fs-documentation.ts
- Modify: test/compatibility.test.ts
- Modify: README.md
- Create: docs/live-sap-acceptance.md

- [ ] **Step 1: Write failing truth assertions**

Export ABAP_FS_UPSTREAM_MCP_TOOL_NAMES and assert:

~~~typescript
assert.equal(ABAP_FS_UPSTREAM_MCP_TOOL_NAMES.length, 43)
assert.equal(ABAP_FS_MCP_TOOL_NAMES.length, 42)
assert.deepEqual(
  ABAP_FS_UPSTREAM_MCP_TOOL_NAMES.filter(
    name => !ABAP_FS_MCP_TOOL_NAMES.includes(
      name as typeof ABAP_FS_MCP_TOOL_NAMES[number]
    )
  ),
  ["manage_subagents"]
)
assert.equal(IMPLEMENTED_TOOL_NAMES.length, 52)
assert.equal(toolsForToolsets(["all"]).size, 52)
~~~

- [ ] **Step 2: Verify RED**

~~~bash
npm run build && node --test dist/test/compatibility.test.js
~~~

Expected: upstream export is absent.

- [ ] **Step 3: Add explicit upstream truth**

Define the upstream array immediately after the local strict-compatible array:

~~~typescript
export const ABAP_FS_UPSTREAM_MCP_TOOL_NAMES = [
  ...ABAP_FS_MCP_TOOL_NAMES,
  "manage_subagents"
] as const
~~~

Keep `IMPLEMENTED_TOOL_NAMES` unchanged structurally:

~~~typescript
export const IMPLEMENTED_TOOL_NAMES = [
  ...ABAP_FS_MCP_TOOL_NAMES,
  ...EXTENDED_TOOL_NAMES
] as const
~~~

This advertises the local 42 plus 10 local extensions, never the VS Code-specific missing tool.

- [ ] **Step 4: Update README and built-in docs**

Add this status section to `README.md` and the same factual lines to the built-in compatibility documentation array:

~~~markdown
## ABAP FS parity status

The pinned ABAP FS 2.6.5 source exposes 43 MCP tools. This server provides a strict-compatible subset of 42; the omitted tool is `manage_subagents`, which depends on the VS Code agent host. With 10 headless extensions, this server advertises 52 tools in total.

The first development-parity slice implements BDEF source creation, one-request batch activation, class-runner execution, the ABAP FS REPL contract, and detailed semantic inspection. These SAP-dependent capabilities remain `unverified` until they succeed against the selected live connection; call `get_sap_capabilities` for per-connection evidence.

Snippet execution requires `ZCL_ABAP_REPL` and an active SICF service at `/sap/bc/z_abap_repl`. Generic report/program-console execution is not implemented.
~~~

In `src/compat/abap-fs-documentation.ts`, import the two additional arrays and replace the compatibility count line with these exact entries:

~~~typescript
import {
  ABAP_FS_BASELINE,
  ABAP_FS_MCP_TOOL_NAMES,
  ABAP_FS_UPSTREAM_MCP_TOOL_NAMES,
  IMPLEMENTED_TOOL_NAMES
} from "./abap-fs-tools.js"

`Pinned upstream MCP tools: ${ABAP_FS_UPSTREAM_MCP_TOOL_NAMES.length}`,
`Strict-compatible local tools: ${ABAP_FS_MCP_TOOL_NAMES.length}`,
"Omitted upstream tool: manage_subagents (requires the VS Code agent host)",
`Total locally advertised tools: ${IMPLEMENTED_TOOL_NAMES.length}`,
"SAP-dependent parity features are implemented but remain live-unverified until a selected connection succeeds.",
"ABAP REPL requires ZCL_ABAP_REPL and SICF /sap/bc/z_abap_repl.",
"Generic report/program-console execution is not implemented.",
~~~

Also add the new headless tools to the existing groups:

~~~typescript
"Connection and discovery": [
  "get_connected_systems", "get_sap_system_info", "get_sap_capabilities", "adt_discovery_export"
],
"Repository read and navigation": [
  "search_abap_objects", "get_abap_object_lines", "search_abap_object_lines",
  "get_abap_object_info", "get_batch_lines", "get_object_by_uri", "find_where_used",
  "get_abap_object_url", "get_abap_object_workspace_uri", "open_object", "inspect_abap_code"
],
"Runtime operations": [
  "run_abap_application", "abap_debug_session", "abap_debug_breakpoint", "abap_debug_step",
  "abap_debug_variable", "abap_debug_stack", "abap_debug_status", "analyze_abap_dumps",
  "analyze_abap_traces", "manage_heartbeat"
],
~~~

- [ ] **Step 5: Create the acceptance guide**

Create `docs/live-sap-acceptance.md` with this content:

~~~markdown
# Live SAP acceptance for development parity

This procedure is opt-in. Do not run it against a production client or a package/transport containing shared work. Automated tests do not run these mutations.

## Required disposable fixture

- MCP profile: `DEV100`, marked `development`.
- Allowed package: `Z_MCP_ACCEPTANCE` only.
- Open workbench transport used only for this run; examples below show `DEVK900999`, which must be replaced with the dedicated transport created in the target system.
- Objects: `ZI_MCP_ACCEPTANCE`, `ZCL_MCP_ACTIVATE_A`, `ZCL_MCP_ACTIVATE_B`, and `ZCL_MCP_RUNNER`.
- A disposable root CDS entity named `ZI_MCP_ACCEPTANCE` whose behavior source is already known to activate on the target SAP release. Record that exact source before the run; RAP syntax is release-dependent and this guide does not invent it.
- For snippet execution only: installed `ZCL_ABAP_REPL` and active SICF service `/sap/bc/z_abap_repl`.

Stop immediately if `get_sap_system_info` reports `environment: production`, if the package differs, or if the transport contains unrelated objects.

## Evidence record

For every operation, store one sanitized JSON record with:

```json
{
  "connection": "DEV100",
  "sapRelease": "record get_sap_system_info.sapRelease",
  "capability": "stable capability id",
  "status": "supported|unsupported|unverified",
  "timestamp": "ISO-8601 UTC",
  "sanitizedResult": "remove users, hostnames, cookies, tokens, CSRF values, and session ids"
}
```

## 1. Capability baseline

Call `get_sap_system_info` for `DEV100`, then:

```json
{
  "tool": "get_sap_capabilities",
  "arguments": {
    "connectionId": "DEV100",
    "includeEvidence": true
  }
}
```

Expected before mutations: each newly implemented SAP-dependent capability is `unverified` unless this MCP process has already observed a success.

## 2. BDEF create, source write, and activation

Use the recorded, release-valid behavior source for `ZI_MCP_ACCEPTANCE` in `source`:

```json
{
  "tool": "create_object_programmatically",
  "arguments": {
    "objectType": "BDEF/BDO",
    "name": "ZI_MCP_ACCEPTANCE",
    "description": "MCP acceptance behavior",
    "packageName": "Z_MCP_ACCEPTANCE",
    "connectionId": "DEV100",
    "source": "paste the pre-recorded release-valid behavior source verbatim",
    "activate": true,
    "additionalOptions": {
      "transportRequest": {
        "type": "existing",
        "number": "DEVK900999"
      }
    }
  }
}
```

Accept only when `object.type` is `BDEF/BDO`, diagnostics contain no error severity, activation succeeds, and a fresh `get_sap_capabilities` reports `repository.create.bdef` as `supported` for `DEV100`.

## 3. One-request batch activation

Make one harmless inactive comment change in each disposable class, then call:

```json
{
  "tool": "abap_activate",
  "arguments": {
    "urls": [
      "adt://dev100/sap/bc/adt/oo/classes/zcl_mcp_activate_a/source/main",
      "adt://dev100/sap/bc/adt/oo/classes/zcl_mcp_activate_b/source/main"
    ]
  }
}
```

Accept only when `status` is `complete`, both object outcomes are `activated`, and `repository.activate.batch` becomes `supported`. Preserve any SAP messages in the sanitized evidence.

## 4. Class runner

Install and activate this disposable class:

```abap
CLASS zcl_mcp_runner DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_oo_adt_classrun.
ENDCLASS.

CLASS zcl_mcp_runner IMPLEMENTATION.
  METHOD if_oo_adt_classrun~main.
    out->write( `MCP_CLASS_RUNNER_OK` ).
  ENDMETHOD.
ENDCLASS.
```

Call `run_abap_application` with `preview_class`, copy its exact `planId` and `confirmation` into `execute`, and accept only when output contains `MCP_CLASS_RUNNER_OK`. The plan must fail on a second execute attempt.

## 5. ABAP FS REPL

Call `run_abap_application` with `action: repl_health`. Continue only when the response is valid and `health.production` is `false`. Then preview this exact snippet:

```abap
WRITE / 'MCP_REPL_OK'.
```

Copy the returned plan ID and confirmation into `execute`. Accept only when output contains `MCP_REPL_OK`. Also verify a profile marked `production` is rejected before POST, and a health response with `production: true` is rejected before POST.

## 6. Semantic services

Against `adt://dev100/sap/bc/adt/oo/classes/zcl_mcp_runner/source/main`, call `inspect_abap_code` once for each action:

- `completion_element` at the `out->write` call;
- `documentation` at the same cursor;
- `type_hierarchy` with `superTypes: true` on the class name;
- `components` with `startIndex: 0` and `maxResults: 100`.

Accept only non-fallback responses from the expected action, bounded text metadata for documentation, and stable structured nodes/components. Re-run `get_sap_capabilities` and record the four semantic statuses.

## 7. Cleanup

Delete only the four named disposable objects through a fresh `refactor_abap_code` `preview_delete` followed by its exact confirmation. Confirm the dedicated transport contains no unrelated objects before releasing or deleting it. If BDEF creation returned `manualCleanupRequired: true`, inspect the object in ADT and delete it manually; the MCP intentionally does not auto-delete after a staged failure.

The live run passes only when every expected result above is recorded. Any missing prerequisite, authorization denial, endpoint absence, unexpected response shape, or cleanup uncertainty keeps the affected capability `unverified` or `unsupported`; it must not be reported as live-supported.
~~~

- [ ] **Step 6: Verify docs and compatibility**

~~~bash
npm run build && node --test dist/test/compatibility.test.js dist/test/integration.test.js
~~~

Expected: truth assertions, documentation search, tool count, and schema guard pass.

- [ ] **Step 7: Commit isolated documentation hunks**

~~~bash
git diff --cached --check
git commit -m "docs: publish ABAP FS parity status"
~~~

### Task 11: Full verification and handoff

**Files:**

- Verify: every file in this plan

- [ ] **Step 1: Run the full suite**

~~~bash
npm test
~~~

Expected: build succeeds; all tests pass with zero failures.

- [ ] **Step 2: Re-run contract-critical suites**

~~~bash
npm run build
node --test dist/test/sap-capabilities.test.js dist/test/bdef-creator.test.js dist/test/repl-client.test.js dist/test/sap-client-contract.test.js dist/test/compatibility.test.js dist/test/integration.test.js
~~~

Expected: all pass; counts are 43 upstream, 42 strict-compatible, 52 local; schema is below 64 KiB.

- [ ] **Step 3: Check placeholders and whitespace**

~~~bash
! rg -n 'T[B]D|T[O]DO|F[I]XME|X[X]X' src test README.md docs/live-sap-acceptance.md
git diff --check
~~~

Expected: exit 0 with no output.

- [ ] **Step 4: Check scope and preserved user changes**

~~~bash
git diff --stat 20ef832..HEAD
git status --short
~~~

Expected: every plan-owned hunk maps to the approved spec. Pre-existing user changes remain present and are not mislabeled.

- [ ] **Step 5: Report evidence honestly**

Report automated evidence separately from live SAP evidence. Without an authorized live target, every new SAP-dependent capability is implemented and unverified, never described as live-supported.

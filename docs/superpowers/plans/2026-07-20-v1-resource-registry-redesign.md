# SAP ABAP MCP v1 Resource Registry Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the non-mergeable hybrid v1 Resource dispatcher with one project-owned registry and completion router that preserve dynamic Resource lifecycle behavior, canonical identities, and fail-closed protocol errors without changing v0.

**Architecture:** `V1ResourceRegistry` owns all v1 Resource state and the three Resource request handlers. `V1CompletionRouter` owns `completion/complete` and delegates Resource and future Prompt references to explicit providers. The MCP SDK Resource registry and all SDK private fields are outside the v1 path; successful SAP Resource content remains untouched.

**Tech Stack:** TypeScript, Node.js test runner, MCP TypeScript SDK 1.29.0, `uri-templates`, Zod, in-memory MCP transports.

## Global Constraints

- Work only in `/Users/coaspe/Documents/Q&A/sap-abap-mcp/.worktrees/v1-read-only-slice` on `codex/v1-read-only-slice`.
- Treat commit `5a3e1a3` and `docs/superpowers/specs/2026-07-20-v1-resource-registry-redesign.md` as the approved baseline.
- Do not call or inspect MCP SDK private Resource or Prompt registry fields.
- Do not add another SDK/project registry mirror or conditional Resource dispatcher.
- Install the new registry and router only in `v1` and `all`; unversioned `serve` and pure `v0` remain v0.
- Preserve the exact v0 53-tool fixture, v1 five-tool/two-Template contract, manifests, SAP adapters, write policy, and package version `0.4.15`.
- Support dynamic fixed and Template registration through both `registerResource` and deprecated `resource`.
- Sanitize only failures; successful Resource results, especially `text/x-abap`, remain byte-for-byte unchanged.
- Use TDD for every production change and make one task-scoped commit only after focused and full relevant tests pass.
- Use `env PATH="/Users/coaspe/.nvm/versions/node/v24.11.1/bin:$PATH"` for every Node/npm command.

## File Structure

- Create `src/mcp/v1/completion-router.ts`: sole owner of `completion/complete`, provider routing, completion result bounds, and completion error conversion.
- Create `src/mcp/v1/resource-registry.ts`: canonical identities, dynamic registration adapters, lifecycle state, discovery, reads, and Resource completion provider.
- Modify `src/mcp/v1/result.ts`: state-based diagnostic scanner and shared sanitized `McpError` conversion.
- Modify `src/mcp/v1/resources.ts`: keep only SAP Capability/ADT callbacks and register them through the new registry.
- Create `test/v1-completion-router.test.ts`: provider routing, limits, missing providers, and error sanitization.
- Create `test/v1-resource-registry.test.ts`: both public registration APIs, fixed/Template lifecycle, canonical identity, discovery, read precedence, and completion.
- Modify `test/v1-result.test.ts`: adversarial scanner and protocol-error unit regressions.
- Modify `test/v1-final-hardening.test.ts`: real MCP boundary regressions and v0/raw-ABAP compatibility.

---

### Task 1: Replace the diagnostic assignment regex with a fail-closed scanner

**Files:**
- Modify: `src/mcp/v1/result.ts`
- Modify: `test/v1-result.test.ts`

**Interfaces:**
- Consumes: existing `sanitizeV1Message(value: string): string`, `AppError`, `McpError`, and `ErrorCode`.
- Produces: unchanged `sanitizeV1Message` plus `toV1ProtocolError(error: unknown, fallbackMessage?: string): McpError` for Tasks 2–4.

- [ ] **Step 1: Extend direct sanitizer tests with the review reproductions**

Add cases to `the shared sanitizer redacts adversarial sensitive key spellings` that assert every named secret is absent:

```ts
const multilineCases = [
  [
    "Authorization:\n  Basic\n  first-secret\n  second-secret",
    ["first-secret", "second-secret"]
  ],
  [
    "client_secret=\n  first-secret\n  second-secret",
    ["first-secret", "second-secret"]
  ],
  [
    "{\n  \"client_secret\"\n  :\n  \"json-secret\"\n}",
    ["json-secret"]
  ],
  [
    "client_secret:\n  \"unterminated-secret\n  continuation-secret",
    ["unterminated-secret", "continuation-secret"]
  ]
] as const

for (const [diagnostic, secrets] of multilineCases) {
  const sanitized = sanitizeV1Message(diagnostic)
  for (const secret of secrets) assert.equal(sanitized.includes(secret), false)
}
```

Add a protocol conversion test that preserves `InvalidParams`, emits one MCP prefix when serialized by the client, and redacts a multiline secret:

```ts
const converted = toV1ProtocolError(
  new McpError(ErrorCode.InvalidParams, "client_secret:\n  protocol-secret")
)
assert.equal(converted.code, ErrorCode.InvalidParams)
assert.equal(converted.message.includes("protocol-secret"), false)
assert.equal(converted.message.startsWith("MCP error"), false)
```

- [ ] **Step 2: Run the focused test and record meaningful RED**

Run:

```bash
env PATH="/Users/coaspe/.nvm/versions/node/v24.11.1/bin:$PATH" npm run build
env PATH="/Users/coaspe/.nvm/versions/node/v24.11.1/bin:$PATH" node --test dist/test/v1-result.test.js
```

Expected: the new multiline cases expose `second-secret`/`json-secret`, and the new export is initially missing. Compiler failure is acceptable only for the missing test-imported symbol; record the exact RED in `.superpowers/sdd/resource-redesign-task-1-report.md`.

- [ ] **Step 3: Implement the scanner and shared protocol converter**

Replace `redactSensitiveAssignments` and its value-boundary helpers with a character scanner that performs these exact transitions:

```ts
interface SensitiveAssignment {
  valueStart: number
  valueEnd: number
  replacement: string
}

// Scan from a token boundary. Accept an optional matching quote around the key,
// [A-Za-z0-9_-] key characters, CR/LF whitespace before and after ':' or '=',
// and test the normalized key with isSensitiveKey.
//
// A closed same-line quoted value ends after its matching escape-aware quote.
// A same-line '=' unquoted value ends at whitespace or , ; & # } ].
// A same-line ':' value ends at CR/LF.
// If whitespace around the delimiter contains CR/LF, a quote is unterminated,
// or Basic/Bearer is folded across lines, set valueEnd to value.length. This is
// the approved fail-closed rule for an ambiguous multiline diagnostic.
function findSensitiveAssignment(
  value: string,
  start: number
): SensitiveAssignment | undefined
```

Keep URL-userinfo and standalone Bearer redaction before the scanner. Add:

```ts
export function toV1ProtocolError(
  error: unknown,
  fallbackMessage = "Operation failed"
): McpError {
  const raw = error instanceof McpError
    ? stripRepeatedMcpPrefix(error.message, error.code)
    : error instanceof Error
      ? error.message
      : String(error)
  const message = sanitizeV1Message(raw) || fallbackMessage
  const code = error instanceof McpError
    ? error.code
    : error instanceof AppError && error.code === "INVALID_ADT_URI"
      ? ErrorCode.InvalidParams
      : ErrorCode.InternalError
  const converted = new McpError(code, message)
  converted.message = message
  return converted
}
```

Import `ErrorCode`, `McpError` from the SDK types. `stripRepeatedMcpPrefix` must remove only repeated `MCP error <same-code>: ` prefixes.

- [ ] **Step 4: Run focused and existing hardening tests**

Run:

```bash
env PATH="/Users/coaspe/.nvm/versions/node/v24.11.1/bin:$PATH" npm run build
env PATH="/Users/coaspe/.nvm/versions/node/v24.11.1/bin:$PATH" node --test dist/test/v1-result.test.js dist/test/v1-final-hardening.test.js
```

Expected: all tests pass; the raw ABAP preservation test remains green.

- [ ] **Step 5: Commit Task 1**

```bash
git add src/mcp/v1/result.ts test/v1-result.test.ts
git commit -m "fix: make v1 diagnostic redaction fail closed"
```

`.superpowers/sdd` is locally ignored, so the report is evidence only and must not enter the commit.

---

### Task 2: Add the single Completion Router

**Files:**
- Create: `src/mcp/v1/completion-router.ts`
- Create: `test/v1-completion-router.test.ts`

**Interfaces:**
- Consumes: `toV1ProtocolError` from Task 1 and MCP `CompleteRequestSchema` types.
- Produces: `installV1CompletionRouter(server: McpServer): V1CompletionRouter`; provider setters for Resource and Prompt references.

- [ ] **Step 1: Write provider-routing and bound tests**

Use an `McpServer`, linked `InMemoryTransport`, and real `Client.complete()` calls. Cover:

```ts
router.setResourceProvider(async request => {
  assert.equal(request.params.ref.type, "ref/resource")
  return Array.from({ length: 105 }, (_, index) => `value-${index}`)
})

const result = await client.complete({
  ref: { type: "ref/resource", uri: "memo://{name}" },
  argument: { name: "name", value: "v" }
})
assert.equal(result.completion.values.length, 100)
assert.equal(result.completion.total, 105)
assert.equal(result.completion.hasMore, true)
```

Also assert:

- Resource and Prompt references reach only their matching provider.
- A missing provider is `McpError(ErrorCode.InvalidParams)`.
- A provider throwing `client_secret:\n  completion-secret` returns a sanitized, single-prefix protocol error.
- Installing a second provider for the same reference type is rejected before state changes.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
env PATH="/Users/coaspe/.nvm/versions/node/v24.11.1/bin:$PATH" npm run build
env PATH="/Users/coaspe/.nvm/versions/node/v24.11.1/bin:$PATH" node --test dist/test/v1-completion-router.test.js
```

Expected: compile/test failure because `completion-router.ts` does not exist. Record RED in `.superpowers/sdd/resource-redesign-task-2-report.md`.

- [ ] **Step 3: Implement the router with no Resource or Prompt registry knowledge**

Use these public contracts:

```ts
export type V1ResourceCompletionProvider = (
  request: CompleteRequestResourceTemplate
) => string[] | Promise<string[]>

export type V1PromptCompletionProvider = (
  request: CompleteRequestPrompt
) => string[] | Promise<string[]>

export interface V1CompletionRouter {
  setResourceProvider(provider: V1ResourceCompletionProvider): void
  setPromptProvider(provider: V1PromptCompletionProvider): void
}

export function installV1CompletionRouter(
  server: McpServer
): V1CompletionRouter
```

The installer registers `{ completions: {} }`, installs exactly one
`CompleteRequestSchema` handler, narrows the request with the SDK assertion
helpers, and wraps every provider failure with `toV1ProtocolError`. Convert
suggestions with exactly:

```ts
return {
  completion: {
    values: suggestions.slice(0, 100),
    total: suggestions.length,
    hasMore: suggestions.length > 100
  }
}
```

- [ ] **Step 4: Run focused tests and TypeScript build**

Run:

```bash
env PATH="/Users/coaspe/.nvm/versions/node/v24.11.1/bin:$PATH" npm run build
env PATH="/Users/coaspe/.nvm/versions/node/v24.11.1/bin:$PATH" node --test dist/test/v1-completion-router.test.js dist/test/v1-result.test.js
```

Expected: all tests pass.

- [ ] **Step 5: Commit Task 2**

```bash
git add src/mcp/v1/completion-router.ts test/v1-completion-router.test.ts
git commit -m "feat: add v1 completion router"
```

---

### Task 3: Build the project-owned Resource Registry

**Files:**
- Create: `src/mcp/v1/resource-registry.ts`
- Create: `test/v1-resource-registry.test.ts`

**Interfaces:**
- Consumes: `V1CompletionRouter`, `ResourceTemplate`, registered Resource public types, v1 URI parsers, and `toV1ProtocolError`.
- Produces: `installV1ResourceRegistry(server: McpServer, router: V1CompletionRouter): V1ResourceRegistry` and SDK-compatible `registerResource`/`resource` adapters.

- [ ] **Step 1: Write the fixed-Resource lifecycle matrix**

Install the router and registry on a fresh server, then use both public APIs to register fixed Resources. Through a real client, assert:

```ts
function resourceText(
  result: { contents: Array<{ text: string } | { blob: string }> }
): string {
  const content = result.contents[0]
  return content && "text" in content ? content.text : ""
}

const fixed = server.registerResource(
  "memo-fixed",
  "HTTP://EXAMPLE.com:80/item",
  { title: "Before", mimeType: "text/plain" },
  async uri => ({ contents: [{ uri: uri.href, text: "before" }] })
)

assert.equal(
  resourceText(await client.readResource({ uri: "http://example.com/item" })),
  "before"
)
assert.throws(() => server.registerResource(
  "duplicate",
  "http://example.com/item",
  { mimeType: "text/plain" },
  async uri => ({ contents: [{ uri: uri.href, text: "duplicate" }] })
))
```

Continue with one atomic update containing `name`, `title`, `uri`, `metadata`,
and `callback`; verify the old canonical URI is absent and unreadable, the new
entry is listed with current metadata, disable hides and rejects it, enable
restores it, remove hides it, and both the old and new identities can be reused.
Repeat registration/read/removal through deprecated `server.resource` with and
without metadata.

- [ ] **Step 2: Write the Template lifecycle and completion matrix**

Register a Template with a list callback and two completers:

```ts
const template = server.registerResource(
  "memo-template",
  new ResourceTemplate("memo://{name}", {
    list: async () => ({
      resources: [{ uri: "memo://one", name: "one", mimeType: "text/plain" }]
    }),
    complete: {
      name: async value => [`${value}-one`, `${value}-two`]
    }
  }),
  { title: "Template", description: "template metadata" },
  async (uri, variables) => ({
    contents: [{ uri: uri.href, text: String(variables.name) }]
  })
)
```

Assert metadata merge, read, and completion. Update `name`, `title`, `template`,
`metadata`, and `callback` atomically; completion must follow the current URI
template. Disable must hide both the Template and its listed Resources, skip
the list callback, and reject read/completion. Enable restores them. Remove
frees the current name for immediate reuse. Duplicate active names are rejected.
Repeat Template registration through deprecated `server.resource`.

- [ ] **Step 3: Write raw URI, precedence, atomicity, and error-boundary tests**

Cover these exact cases:

- raw C0 and malformed percent escapes fail as `InvalidParams` before callbacks;
- reserved ADT/capability fixed Resources use their canonical identities;
- an exact fixed ADT/capability Resource wins before a broad Template;
- a failed duplicate URI/name update leaves the old Resource fully functional;
- list callback and read callback multiline secrets are absent from real client errors;
- successful content containing `client_secret`, Basic/Bearer text, and raw ABAP is unchanged.

- [ ] **Step 4: Run the focused test and verify RED**

Run:

```bash
env PATH="/Users/coaspe/.nvm/versions/node/v24.11.1/bin:$PATH" npm run build
env PATH="/Users/coaspe/.nvm/versions/node/v24.11.1/bin:$PATH" node --test dist/test/v1-resource-registry.test.js
```

Expected: compile/test failure because the registry module does not exist. Record RED in `.superpowers/sdd/resource-redesign-task-3-report.md`.

- [ ] **Step 5: Implement one state table and the public adapters**

Use these entry shapes; no SDK registry entry may be created:

```ts
interface FixedEntry {
  displayUri: string | null
  canonicalUri: string | null
  resource: RegisteredResource
}

interface TemplateEntry {
  name: string | null
  resource: RegisteredResourceTemplate
}

export interface V1ResourceRegistry {
  registerFixed(
    name: string,
    uri: string,
    metadata: ResourceMetadata,
    callback: ReadResourceCallback
  ): RegisteredResource
  registerTemplate(
    name: string,
    template: ResourceTemplate,
    metadata: ResourceMetadata,
    callback: ReadResourceTemplateCallback
  ): RegisteredResourceTemplate
}
```

Canonicalization must call `assertRawV1ResourceUri`, route reserved schemes to
their existing parsers, and use `new URL(value).toString()` for every generic
absolute URI. Registration and update validate the complete proposed identity
before mutating fields. `enable`, `disable`, and `remove` call the same atomic
update path. Send one Resource-list-changed notification after a successful
state change.

Override `server.registerResource` and all four deprecated `server.resource`
overload forms with adapters that call only this registry. Preserve config
title separately so a later title update is reflected even when metadata still
contains the original title.

- [ ] **Step 6: Install discovery, read, and completion-provider behavior**

Register `{ resources: { listChanged: true } }` and install exactly one handler
for each Resource request schema. All three handlers read the same arrays/maps:

```ts
// resources/list: enabled fixed entries, then enabled Template list callbacks
// resources/templates/list: enabled active Template entries
// resources/read: raw validation -> canonical URL -> exact fixed -> Templates
// completion provider: exact active fixed => []; matching enabled Template => completer
```

Wrap list callbacks and reads with `toV1ProtocolError`; the completion router
already wraps completion failures. The listed Resource metadata overrides
Template metadata. Match Templates in registration order and never execute a
disabled or removed callback.

- [ ] **Step 7: Run focused tests plus prior Resource hardening tests**

Run:

```bash
env PATH="/Users/coaspe/.nvm/versions/node/v24.11.1/bin:$PATH" npm run build
env PATH="/Users/coaspe/.nvm/versions/node/v24.11.1/bin:$PATH" node --test dist/test/v1-resource-registry.test.js dist/test/v1-completion-router.test.js dist/test/v1-final-hardening.test.js
```

Expected: new registry tests pass; existing hardening tests remain green because
the production v1 registrar is not switched until Task 4.

- [ ] **Step 8: Commit Task 3**

```bash
git add src/mcp/v1/resource-registry.ts test/v1-resource-registry.test.ts
git commit -m "feat: add single-owner v1 resource registry"
```

---

### Task 4: Replace the hybrid dispatcher and prove the complete boundary

**Files:**
- Modify: `src/mcp/v1/resources.ts`
- Modify: `test/v1-final-hardening.test.ts`
- Modify: `docs/superpowers/plans/2026-07-20-v1-read-only-vertical-slice.md`

**Interfaces:**
- Consumes: `installV1CompletionRouter`, `installV1ResourceRegistry`, and the existing `V1ReadService` callbacks.
- Produces: the final five-tool/two-Template v1 server with one Resource owner and no hybrid dispatcher.

- [ ] **Step 1: Add real-server RED tests for every final-review finding**

Using `createMcpServer(..., { apiVersion: "v1" })` and `connectedClient`, assert:

- multi-continuation and newline-before-colon secrets are absent from tool, Resource list, Resource read, and Resource completion errors;
- disabled Templates are absent from `listResources` and `listResourceTemplates`, their list callback count does not increase, and read/completion reject them;
- `HTTP://EXAMPLE.com:80/item` is readable canonically and conflicts with `http://example.com/item`;
- exact fixed ADT/capability Resources still beat built-in Templates without a SAP call;
- Template rename and Template replacement preserve completion, while removal deletes it and permits reuse;
- dynamic fixed and Template Resources registered after `createMcpServer` work through both registration APIs;
- `RAW_ABAP_SOURCE` is returned exactly, including every secret-like literal.

- [ ] **Step 2: Run the focused real-server tests and record RED**

Run:

```bash
env PATH="/Users/coaspe/.nvm/versions/node/v24.11.1/bin:$PATH" npm run build
env PATH="/Users/coaspe/.nvm/versions/node/v24.11.1/bin:$PATH" node --test dist/test/v1-final-hardening.test.js
```

Expected: failures from the still-active hybrid dispatcher. Record exact failure
names in `.superpowers/sdd/resource-redesign-task-4-report.md`.

- [ ] **Step 3: Switch `registerV1Resources` to the new owner**

Delete `installV1ResourceDispatcher`, its entry types, canonicalization helpers,
and local protocol-error conversion from `resources.ts`. Keep only
`readCapabilityResource`, `readAdtResource`, and their response sanitization.
Install and wire the new components before the two built-in registrations:

```ts
const completionRouter = installV1CompletionRouter(server)
installV1ResourceRegistry(server, completionRouter)

server.registerResource(
  "sap-capability-evidence",
  new ResourceTemplate("sap-capability://{system}", { list: undefined }),
  {
    title: "SAP Capability Evidence",
    description: "Complete capability discovery evidence for one SAP system.",
    mimeType: "application/json"
  },
  uri => readCapabilityResource(uri.toString(), service)
)

server.registerResource(
  "sap-adt-source",
  new ResourceTemplate("adt://{system}/{+adtPath}", { list: undefined }),
  {
    title: "SAP ABAP Source",
    description: "Complete active ABAP source for one canonical ADT resource.",
    mimeType: "text/x-abap"
  },
  uri => readAdtResource(uri.toString(), service)
)
```

Update the original vertical-slice plan's implementation note to link to the
approved redesign spec and state that the hybrid dispatcher was replaced; do
not rewrite historical RED/GREEN evidence.

- [ ] **Step 4: Run focused and full verification**

Run:

```bash
env PATH="/Users/coaspe/.nvm/versions/node/v24.11.1/bin:$PATH" npm run check
env PATH="/Users/coaspe/.nvm/versions/node/v24.11.1/bin:$PATH" npm run smoke:v1
env PATH="/Users/coaspe/.nvm/versions/node/v24.11.1/bin:$PATH" npm run benchmark:surface
env PATH="/Users/coaspe/.nvm/versions/node/v24.11.1/bin:$PATH" npm pack --dry-run --json
env PATH="/Users/coaspe/.nvm/versions/node/v24.11.1/bin:$PATH" npm audit --omit=dev
git diff --check
```

Expected:

- all tests pass;
- real stdio smoke reports five v1 tools and two Resource Templates;
- an additional unversioned/v0 stdio probe reports exactly 53 tools;
- benchmark performs zero live SAP calls and retains the established v0/v1/all schema accounting;
- package dry run includes `scripts/smoke-v1-stdio.mjs` and all new v1 runtime modules;
- audit reports zero production vulnerabilities;
- `test/fixtures/v0-tool-surface.json` is byte-identical to commit `0e51782`;
- the three default manifests still end in exact unversioned `serve` with no `--api-version`.

- [ ] **Step 5: Commit Task 4**

```bash
git add src/mcp/v1/resources.ts test/v1-final-hardening.test.ts docs/superpowers/plans/2026-07-20-v1-read-only-vertical-slice.md
git commit -m "fix: replace hybrid v1 resource ownership"
```

After the commit, generate one merge-base review package from `aaf9e0d` through
the new `HEAD` and require the original final branch reviewer to issue a clean
merge-readiness decision before completion is claimed.

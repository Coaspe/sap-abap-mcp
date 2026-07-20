# SAP ABAP MCP v1 Resource Registry Redesign

Date: 2026-07-20

Status: Approved for implementation planning

## Objective

Replace the split Resource ownership introduced during the v1 read-only slice
with one v1-only registry. The registry must preserve the public MCP SDK
Resource registration contract while enforcing the stricter URI, lifecycle,
and error-sanitization boundaries required by SAP ABAP MCP v1.

This redesign is required because three review cycles found recurring defects
where the MCP SDK registry and a project-owned dispatcher disagreed about
identity, discovery, removal, completion, or error handling. The current hybrid
implementation at `0d12c17` is not mergeable and will be replaced rather than
patched again.

## Approved Decisions

- Use one project-owned Resource registry in `v1` and `all` modes.
- Support dynamic third-party Resource registration through both the current
  `registerResource` API and the deprecated `resource` compatibility API.
- Route Resource and future Prompt completion requests through one completion
  router.
- Do not call or inspect the MCP SDK's private Resource registry.
- Keep v0 registration and all unversioned launch paths unchanged.
- Sanitize failures at a shared protocol boundary without modifying successful
  Resource content, including ABAP source.

## Alternatives Considered

### Project-owned registry and completion router — selected

One registry owns Resource state and all Resource protocol handlers. This adds
a small compatibility layer, but every operation observes the same state and
the behavior can be tested without SDK private fields.

### Mirrored SDK and project registries — rejected

Re-registering or mirroring SDK entries would reduce the initial rewrite, but
identity changes, removal, completion, and duplicate checks would still depend
on synchronizing two authorities. That is the failure mode this redesign must
remove.

### MCP SDK fork or patch — rejected

Changing the SDK could provide an upstream middleware or public registry API,
but it would couple this package to a fork and move the compatibility burden
outside the approved v1 slice.

## Architecture

### `V1ResourceRegistry`

The registry is the only source of truth for v1 Resources. It owns:

- fixed Resource canonical identity and current display URI;
- Resource Template current name and URI template;
- title, metadata, callback, active state, and enabled state;
- Template list callbacks and completion callbacks;
- registration order for deterministic Template matching;
- atomic duplicate validation, update, removal, and identity reuse.

The registry replaces `McpServer.registerResource` and the deprecated
`McpServer.resource` only after v1 registration begins. It returns objects that
implement the public `RegisteredResource` and `RegisteredResourceTemplate`
contracts: `update`, `enable`, `disable`, and `remove` remain available to the
caller. The registry does not call the original SDK Resource registration
methods.

The registry installs and owns these low-level handlers:

- `resources/list`;
- `resources/templates/list`;
- `resources/read`.

`resources/list` merges Template metadata first and listed Resource metadata
second, so the listed Resource wins on conflicts. Disabled or removed entries
are not returned and disabled Template list callbacks are not executed.

### `V1CompletionRouter`

One router owns `completion/complete` and dispatches by reference type:

- Resource references use the current `V1ResourceRegistry` state.
- Prompt references use an optional Prompt completion provider.

The current read-only slice registers no Prompts, so a Prompt completion request
without a provider fails with `InvalidParams`. A future Prompt slice must attach
its provider to this router instead of installing a second completion handler.
Ad-hoc Prompt completion registration is not part of this Resource redesign;
the router interface prevents the future Prompt implementation from replacing
the Resource handler.

Resource completion observes the same enabled, removed, renamed, and updated
Template state as discovery and reads. A missing fixed Resource completion is
an empty result, matching the MCP SDK behavior. A missing or disabled Template
is `InvalidParams`. Completion values keep the SDK's 100-value limit and
`total`/`hasMore` semantics.

### Built-in SAP Resources

`resources.ts` contains only the two first-slice registrations and their SAP
callbacks:

- `sap-capability://{system}`;
- `adt://{system}/{+adtPath}`.

Registry mechanics live in `resource-registry.ts`; completion dispatch lives in
`completion-router.ts`; diagnostic sanitization remains in `result.ts`. No SAP
service call or successful response transformation moves into the registry.

## URI and Dispatch Rules

Registration and identity updates validate the proposed next state before
changing live state.

1. Reject raw C0 characters and malformed percent escapes.
2. Canonicalize `adt:` and `sap-capability:` with their v1 parsers.
3. Canonicalize every other absolute URI with `new URL(value).toString()`.
4. Reject an active fixed Resource with the same canonical identity.
5. Reject an active Template with the same current name.

The original display URI may be listed, but reads and duplicate checks use the
canonical identity. Reads apply the same raw validation and canonicalization,
then dispatch in this order:

1. exact fixed Resource;
2. enabled Resource Templates in registration order;
3. sanitized `InvalidParams` failure.

An update is atomic: the complete proposed state is validated first, then
committed, followed by one Resource-list-changed notification. A failed update
leaves the old state intact. Removal frees the canonical URI or Template name
for immediate reuse.

## Error and Secret Boundary

The following callback paths share one error converter:

- Template list callbacks;
- fixed and Template read callbacks;
- Resource completion callbacks;
- Prompt completion providers when one is installed.

Existing `McpError` codes are preserved. Invalid Resource syntax and missing,
disabled, or removed Resources use `InvalidParams`; unexpected callback errors
use `InternalError`. The outgoing message is sanitized once so it has a single
MCP error prefix.

The diagnostic sanitizer uses a state-based scanner rather than extending the
current assignment regular expression. It:

- uses the shared normalized sensitive-key matcher;
- accepts whitespace and line breaks around a key delimiter;
- parses quoted values with escape awareness;
- consumes folded Basic and Bearer credentials;
- redacts the remainder of an ambiguous multiline diagnostic when a safe value
  boundary cannot be proven;
- bounds the final diagnostic size.

Sanitization applies only to failure diagnostics. Successful Resource content
and metadata are returned unchanged, including `text/x-abap` source that may
legitimately contain credential-like examples.

## Compatibility Boundary

The registry and completion router are installed only when v1 registration is
active. Pure v0 mode continues to use the existing SDK Resource behavior and
the existing 53-tool presenter. Unversioned `serve` remains v0 for the entire
1.x line.

This redesign does not add new SAP calls, Tools, Prompts, transports,
authentication methods, subscriptions, or write operations. It does not change
the five-tool/two-Template v1 surface, the v0 compatibility fixture, package
manifests, SAP adapters, or write policy.

## Verification Criteria

Implementation is complete only when all of these pass:

1. Both `registerResource` and `resource` cover fixed and Template registration,
   listing, reading, every supported update field, disable, enable, removal,
   duplicate rejection, and identity reuse.
2. Reserved and generic canonical fixed identities reject duplicates and remain
   readable through their canonical form.
3. Exact fixed Resources win before broad Templates.
4. Disabled and removed Templates disappear from both discovery paths, do not
   execute list callbacks, and reject read and completion requests.
5. Rename and Template updates preserve Resource completion; removal deletes it
   and permits name reuse.
6. List, read, and completion callback failures redact direct, folded,
   multi-continuation, escaped, and unterminated credential values in both unit
   and real MCP client tests.
7. Successful ABAP Resource text is byte-for-byte unchanged.
8. Focused registry tests, the full test suite, `git diff --check`, v0 and v1
   stdio smoke tests, the exact 53/5 tool and 2-Template contracts, package dry
   run, production dependency audit, and schema benchmark all pass.

## Implementation Constraint

The redesign replaces the hybrid registry code as one coherent change. It must
not add another conditional dispatcher or SDK-registry mirror. If a required
public behavior cannot be implemented without SDK private fields, implementation
stops and the approved contract is revised rather than adding a second owner.

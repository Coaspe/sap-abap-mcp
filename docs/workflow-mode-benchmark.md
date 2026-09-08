# Default mode and workflow token costs

The unreleased local CLI and new browser registrations default to `minimal`:
five gateways and 883 fixed tool-schema tokens with `o200k_base`. Explicit
`--preset adaptive` keeps 12 common direct tools plus those gateways (6,583
tokens). Both expose the same role-filtered capabilities, prompts and resources.
Library embedding retains its full direct default. Existing registrations with
an explicit preset keep it; an unversioned local `serve` command uses the new
default on restart. The published npm package has not changed.

## Measured workflow

Run from the built checkout with development dependencies installed:

```sh
npm run build
node scripts/benchmark-mcp-workflow.mjs --tokens --output /tmp/sap-workflow.json
```

The script uses real in-memory MCP calls and a synthetic SAP service. Each
session reads component metadata, reads 200 source lines, rechecks the unchanged
range once or 20 times, reads an externally changed range, and runs diagnostics.
Deferred capabilities are searched and described once per session; the exact
schema hash is reused. Directly advertised tools are called directly. Assertions
verify source bodies, conditional hashes, diagnostics and service-call counts.
There are 16 runs: four modes, two repeat counts, conditional reads on/off.

Measured on 2026-09-08 with conditional reads enabled:

| Mode | Fixed schema tokens | Total, 1 recheck | Calls | Total, 20 rechecks | Calls |
|---|---:|---:|---:|---:|---:|
| full | 44,098 | 56,931 | 5 | 64,227 | 24 |
| adaptive | 6,583 | 20,974 | 7 | 28,270 | 26 |
| minimal | 883 | 17,526 | 11 | 25,829 | 30 |
| single | 209 | 16,876 | 11 | 25,179 | 30 |

Minimal reduced the fixed schema by 86.6% and the complete short fixture by
16.4% relative to adaptive, while adding four discovery calls. With 20 rechecks,
the total reduction was 8.6%. Repeated gateway arguments cost more than direct
calls, so adaptive may cost less in sufficiently long, repetitive sessions.
This fixture does not establish a universal winner for other task mixes.

Minimal is the default because it reduces initial context while preserving
separate read/write/destructive tool annotations. Single saves more schema
tokens, but its developer/admin tool may trigger host approvals for reads.
Use adaptive when immediate common-tool access or fewer tool-call round trips
matters more. Use full when a host requires original tool names for policy or
discovery compatibility.

Totals count schemas once, minified request parameters, and complete results
(including both text and structured bodies). Generated UUIDs are normalized.
They exclude initialization, JSON-RPC framing, cumulative conversation replay,
model billing/caching, host-native discovery, approval interactions and SAP
latency. No LLM task-success or live SAP claim follows from these measurements.
The default fixture conservatively includes search. For a workflow whose exact
capability names are already known (for example, from a workflow prompt), run:

```sh
node scripts/benchmark-mcp-workflow.mjs --tokens --known-capabilities
```

This still describes every deferred schema before invoking it; it only omits
search. On the short conditional fixture, minimal used 8 calls / 16,788 tokens
instead of 11 calls / 17,526 tokens. The 738-token difference is removed search
traffic, with identical source/diagnostic assertions and service-call counts.
Adaptive used 6 calls / 20,712 tokens; single used 8 calls / 16,126 tokens.
The initial adaptive/minimal guidance now explicitly tells clients to skip
search for known names, and to describe `sap.system.list` when the system ID is
unknown. Whether an actual model follows that guidance remains unmeasured.

Report schema 2.1 additionally measures the initialization `instructions` field,
without assuming that a client requests every prompt or resource. Its minified
field costs 75 tokens in minimal/adaptive, 55 in single and 53 in full. Thus the
minimal tools-plus-instructions startup portion is 958 tokens, and its short
known-name workflow totals 16,863 including instructions. The corresponding
adaptive total is 20,787. The older table's `totalTokens` intentionally retains
its instructions-excluded meaning; use `totalWithInstructionsTokens` and
`totalWithInstructionsBytes` for the expanded scope. Other initialization fields
and prompt/resource requests remain excluded. Each run rejects instructions
larger than 1 KiB, so catalog-sized startup guidance cannot grow unnoticed.

Omit `--tokens` to run the correctness/byte checks using runtime dependencies
only; the published benchmark does not require the tokenizer at runtime.

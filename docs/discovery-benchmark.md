# Capability discovery benchmark

Build this checkout, then run:

```sh
npm run build
npm run benchmark:discovery -- --tokens --output /tmp/sap-discovery.json
```

The optional `--tokens` flag requires development dependencies (`js-tiktoken`).
Without it, the installed package can report bytes using runtime dependencies.
The script opens real in-memory MCP sessions for adaptive, minimal and single
presets, each with viewer, developer and admin roles. Eighteen authored English
queries per session cover exact names, task phrases, parameter names, declared
options, restricted capabilities and an unrecognizable query. No profiles, SAP
connections or model calls are used. A failed expected discovery or role check
sets a nonzero exit code; CI runs the benchmark after building.

The initial corpus exposed a ranking problem: `syntax check` did not return
`sap.source.diagnose` in the first five results because generic `check` names
dominated. Search now adds an inverse-document-frequency bonus for matched
terms, using only the session's allowed catalog. Scores remain integers to avoid
long decimal values in responses. Both `syntax check` and `check syntax` now
rank the expected tool second. Existing phrase and exact-name preferences remain.

On 2026-10-01 the extended benchmark passed all 162 query/session checks.
Six full task phrases now cover system discovery, callers, dependencies,
transport review, dumps and traces, with the expected tool required in the top
three. Before the fix, callers ranked fifth and dependency/transport review
were missing from the first five: 27 checks failed across nine sessions.
Search now matches complete normalized words and phrases, so `review` no
longer matches inside `preview` and short words do not match inside unrelated
words. Repeated terms count once. Exact names, parameter names, declared
choices, role/category/risk filtering and integer relevance scores remain.
Three concise descriptions expose callers, dependencies and transport review.
Arbitrary word fragments and punctuation-only queries do not match; synonyms,
negation and Korean intent parsing are not implemented.

The 162 checks repeat 18 authored fixtures across modes/roles, not 162
independent tasks or an unbiased search-quality estimate. The benchmark does
not measure LLM selection accuracy or real SAP completion. See the
[identical-task acceptance contract](abap-task-comparison.md) for those gates.

Developer/admin fixed schema costs:

| Preset | Tools | Bytes | `o200k_base` tokens |
| --- | ---: | ---: | ---: |
| adaptive | 17 | 26,728 | 6,585 |
| minimal | 5 | 3,667 | 880 |
| single | 1 | 863 | 215 |

Minimal and single are unchanged from the previous local stage; the shorter
where-used description saves three tokens in adaptive. The fixed schema array
is counted once, independently of search requests/results and instructions.
[Before/after and published competitor evidence](competitive-task-discovery-2026-10-01/verification.json)
records the exact measurement limits.

Each report includes per-query result names, expected rank, request and complete
response sizes. Generated request UUIDs are normalized before serialization,
including copies in text and structured content. Fixed schemas are measured
once per session, not added to every query. Counts exclude initialization,
JSON-RPC framing, model message framing, conversation replay and model billing.
This benchmark establishes a reproducible local regression gate; it does not
establish superiority over another MCP server or reductions in actual LLM retries.

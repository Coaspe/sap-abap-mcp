# Capability discovery benchmark

Build this checkout, then run:

```sh
npm run build
npm run benchmark:discovery -- --tokens --output /tmp/sap-discovery.json
```

The optional `--tokens` flag requires development dependencies (`js-tiktoken`).
Without it, the installed package can report bytes using runtime dependencies.
The script opens real in-memory MCP sessions for adaptive, minimal and single
presets, each with viewer, developer and admin roles. Twelve authored English
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

On 2026-09-08 the local benchmark passed all 108 query/session checks. Of the
87 cases expecting a visible capability, 60 ranked it first and all 87 found it
within five results. These are repeated authored fixtures across modes/roles,
not 87 independent tasks or an unbiased search-quality estimate. The remaining
21 checks cover restricted or absent results. Korean queries, synonyms outside
the corpus, LLM selection accuracy and real SAP task completion remain unmeasured.

Developer/admin fixed schema costs remained unchanged:

| Preset | Tools | Bytes | `o200k_base` tokens |
| --- | ---: | ---: | ---: |
| adaptive | 17 | 26,821 | 6,583 |
| minimal | 5 | 3,782 | 883 |
| single | 1 | 846 | 209 |

Each report includes per-query result names, expected rank, request and complete
response sizes. Generated request UUIDs are normalized before serialization,
including copies in text and structured content. Fixed schemas are measured
once per session, not added to every query. Counts exclude initialization,
JSON-RPC framing, model message framing, conversation replay and model billing.
This benchmark establishes a reproducible local regression gate; it does not
establish superiority over another MCP server or reductions in actual LLM retries.

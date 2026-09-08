# Workflow payload benchmark

```sh
npm run build
npm run benchmark:workflow -- --output /tmp/mcp-workflow.json
```

The script executes real in-memory MCP clients and servers against a synthetic
service. No SAP credentials, customer code or model calls are used. It runs four
combinations of full/adaptive discovery and ordinary/conditional source reads.
Each run lists tools, reads component metadata, then reads a 200-line source
range three times: initially, unchanged, and after a simulated external edit.
Adaptive runs first discover and describe the deferred component capability.
The already-advertised source tool is called directly in both modes.

## Current results

Measured 2026-09-07, UTF-8 bytes of minified JSON:

| Mode | Conditional source | Schemas | Requests | Results | Combined |
|---|---|---:|---:|---:|---:|
| Full | No | 168,227 | 435 | 65,361 | 234,023 |
| Full | Yes | 168,227 | 597 | 44,762 | 213,586 |
| Adaptive | No | 26,821 | 735 | 69,617 | 97,173 |
| Adaptive | Yes | 26,821 | 897 | 49,018 | 76,736 |

The last row is 67.2% smaller than the first **in this fixed payload fixture**.
Conditional reads alone save 20,437 combined request/result bytes in either
mode. An unchanged response omits source, but every read still reaches the
service; source freshness and access checks are not skipped.

Adaptive has a real cost: six client tool calls versus four for full mode.
Discovery and schema retrieval consume 4,426 request/result bytes, and the
component invocation wrapper adds another 130 bytes. Thus the task adds 4,556
bytes of gateway traffic while reducing the initial schema array by 141,406
bytes. More deferred capabilities or repeated schema retrieval can change the
tradeoff. These measurements do not show that adaptive always wins.

## What the benchmark proves

Assertions require successful MCP envelopes, exact component output, correct
first and changed source, matching unchanged hashes, code omission only on a
conditional hit, and three source service calls in every run. The script exits
nonzero on semantic failure or loss of conditional-read payload savings. CI
runs it after building. JSON output gives per-stage request and result bytes
so increases can be located rather than hidden in a single percentage.

## Measurement limits

This adds the advertised tool array once and each tool request and result once.
It includes both text and structured content where the server returns both.
It excludes JSON-RPC framing, initialization, model prompts, hidden host
instructions, conversation replay, provider caching, retries, native host tool
search, and tokenizer behavior. A client that already defers tool schemas may
see a different tradeoff from a host that loads the entire array.

Do not call these numbers billed tokens, total task tokens, real SAP latency,
actual development-task success rates, or a competitor benchmark. The next
acceptance experiment needs an identified host/model, identical real tasks,
usage telemetry, correctness grading and explicit failed/skipped outcomes.

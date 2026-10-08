# Release CodeQL triage, 2026-10-08

PR #29 scans project and vendored sources without excluding either. Actual findings are fixed in source: HTML uses the WHATWG parse5 parser with scripts/styles omitted and entities decoded once; URI and filename suffix cleanup is linear; Windows commands use cross-spawn argument arrays; forge PEM framing/header parsing no longer backtracks; cookie and restored cookie-path maps have null prototypes; Mermaid CSS marker URLs escape backslashes before parentheses.

## Six false positives: Mermaid diagram arrow lexers

Alerts 27–32 use `js/bad-tag-filter` and claim the regex should recognize HTML's `--!>` comment terminator. Their exact locations are Jison lexer `rules` arrays, whose actions produce Mermaid link/axis/transition tokens. They do not recognize `<!--`, strip HTML comments, sanitize markup or define any HTML trust boundary. Changing these expressions to accept `--!>` would change the diagram language rather than fix an HTML filter.

| Alert | Core chunk | Expression | Purpose |
| --- | --- | --- | --- |
| 27 | chunk-5RXB4S5H.mjs:926 | `^(?:-->)` | State transition arrow |
| 28 | blockDiagram-VBNYF7ZC.mjs:1065 | `^(?:\s*[xo<]?--+[-xo>]\s*)` | Block link arrow |
| 29 | blockDiagram-VBNYF7ZC.mjs:1065 | `^(?:\s*[xo<]?--+[-xo>]\s*)` | Block link arrow |
| 30 | chunk-JQJVKLGR.mjs:2311 | `^(?:\s*[xo<]?--+[-xo>]\s*)` | Flowchart link arrow |
| 31 | sequenceDiagram-SI44F4Z6.mjs:1155 | `^(?:-->)` | Sequence dashed arrow |
| 32 | xychartDiagram-ELKLHX3M.mjs:728 | `^(?:-->)` | X-axis numeric range |

The [official CodeQL query](https://github.com/github/codeql/blob/main/javascript/ql/src/Security/CWE-116/BadTagFilter.ql) selects syntactic `HtmlMatchingRegExp` instances; it does not establish that these diagram lexers filter HTML. These six alerts are triaged individually as false positives with this explanation. The query, CI and all other alerts remain enabled; no runtime or lexer rewrite is used to evade the query.

The rebuilt browser asset was tested with securityLevel `strict`: all five affected diagram families parse (`flowchart`, `sequenceDiagram`, `stateDiagram-v2`, `block-beta`, `xychart-beta`), three diagrams render including KaTeX, and no javascript links occur. This is bounded fixture evidence, not a general security audit. Forge's full upstream suite and project regressions separately verify the changed parser/crypto behavior.

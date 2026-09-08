# ARC-1 published schema comparison

Measured on 2026-09-08 with `js-tiktoken`'s `o200k_base` encoding. These are
serialized tool-array tokens, not billed model tokens or full task costs.

| Surface | Tools | Tool array bytes | Tool array tokens |
|---|---:|---:|---:|
| ARC-1 1.2.0 standard, default restrictions | 9 | 45,820 | 10,756 |
| ARC-1 1.2.0 standard, writes/data/SQL/transport/Git enabled | 12 | 70,442 | 16,714 |
| ARC-1 1.2.0 hyperfocused, default restrictions | 1 | 917 | 209 |
| This checkout, adaptive | 17 | 26,821 | 6,583 |
| This checkout, minimal | 5 | 3,782 | 883 |
| This checkout, single (subsequent implementation) | 1 | 846 | 209 |

Our adaptive surface is smaller than ARC-1's standard default in this measurement,
despite advertising more tools. ARC-1's hyperfocused surface is substantially
smaller than our minimal surface. A subsequent opt-in [single mode](single-tool-mode.md)
matches its measured tool-schema token count. We cannot claim overall leadership
from this equality. The modes differ in default permissions and supported operations;
these numbers are not proof of equivalent capability or task success.

## Method and provenance

The comparator imports `getToolDefinitions` and `DEFAULT_CONFIG` from the
published [ARC-1 npm package](https://www.npmjs.com/package/arc-1/v/1.2.0), using
unknown SAP capabilities, no plugins, no HTTP scope filtering and
`nullableOptionals: false`. Inspection of the packaged `server/server.js`
confirmed this is its ordinary schema-generation path before runtime filtering.
This is schema-factory output, not an independently started ARC-1 MCP server.
Our results come from actual in-memory MCP `tools/list` calls.

The npm artifact was downloaded with lifecycle scripts disabled. It was inspected
and unpacked into an isolated temporary directory; its dependency installation
also disabled lifecycle scripts. No SAP operation, startup feature probe or
customer profile was run. The comparison does not install ARC-1 into this project.

- Package: `arc-1@1.2.0`
- Archive integrity: `sha512-FepbyUXc2KAMaS/KPhx91EpLi5P9Edlbjj4to9FCarz1xpEMsGotAXgakGw3hDatbgD6MquDeVh6bGKkqUmOVQ==`
- Packaged `dist/handlers/tools.js` SHA-256: `f051302102ed260018518173344797c8e02b7145a3d8041cfe9245915cd4b806`
- Our manifest still identifies the development checkout as `1.3.1`; these changes
  have not been published. This is not a comparison against our npm release.

To reproduce with an inspected ARC-1 package and its dependencies already present:

```sh
npm run build
node scripts/benchmark-competitor-surface.mjs --arc-path /path/to/arc-1/package --output /tmp/arc-schema-comparison.json
```

Run from this development checkout with dev dependencies installed. The script
imports code from the supplied path; inspect that package first. It records the
package version and schema-module hash so later package changes are visible.

## Decision and next evidence

The subsequent [workflow comparison](workflow-mode-benchmark.md) informed the
new minimal default; this fixed-schema table alone did not establish it. A single
universal gateway can reduce schema size, while hiding read/write distinctions
from tool-level annotations and adding argument-discovery work. Our five gateways
currently preserve separate read, write and destructive annotations, plus search
and schema description. A proposed smaller mode must retain server-side role,
schema-hash and action checks and be evaluated on complete tasks.

This measurement excludes initialization instructions, prompts, discovery calls,
tool arguments, returned source, retries, model caching and task success. ARC-1's
single-tool mode may need additional schema discovery; our minimal mode does too.
Neither a one-tool count nor this table proves the cheaper complete workflow.

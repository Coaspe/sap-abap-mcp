# Read-only live context evidence

Build the checkout, configure a SAP development profile with access to an
existing object, then run:

```sh
npm run build
npm run evidence:read -- --profile DEV100 --object ZCL_DEMO --type CLAS --output /tmp/sap-read-evidence.json
```

The IDs above are examples. Use an actual existing object and exact type in
your system. On Windows, choose a writable output path such as
`C:\temp\sap-read-evidence.json`. No objects are created or modified. The runner
uses the locally built server in adaptive mode and the current profile/secret
store, including `SAP_ABAP_MCP_HOME` and environment-based credentials.

The scenario checks configured credential availability, reads system metadata,
inspects the target metadata, then reads the first 50
active source lines twice. The second read passes the first content hash and
checks that an unchanged result omits repeated code. A concurrent source edit
is reported as incomplete rather than a broken cache or a successful unchanged
read. KTD absence/unsupported status is recorded separately; a passed source
scenario does not prove KTD support. Errors such as denied documentation reads
stop the scenario.

For `CLAS` and `INTF` (including subtypes such as `CLAS/OC`), it also describes
the deferred components capability and invokes the public API view with
`includeRelated=true` and `documentation={offset:0,maxChars:2000}`, then repeats
it with `ifNoneMatch`. KTD is requested here instead of in the earlier repository
inspection. Other object types still read their KTD in repository inspection.
This checks the first
20 declarations and up to five explicit related types within the shared text
budget. The report records root/related truncation, included/unresolved counts
and combined contract/document revalidation. Documentation status, returned
character count and truncation are recorded without the document body, object
name or hash. The validator checks Unicode page counts and continuation state;
it rejects missing/malformed documentation and retained bodies on an unchanged
response. It stores neither code nor dependency names/hashes.
A changed contract or KTD is incomplete with `PUBLIC_CONTRACT_CHANGED_DURING_CHECK`.
Malformed conditional results fail. No contract step runs for other object types.
Passing this bounded scenario does not prove complete dependency coverage:
review its truncation and unresolved counts separately.

| Exit | Report status | Meaning |
|---|---|---|
| 0 | `passed` | Source revalidation and, for CLAS/INTF, bounded public-contract revalidation completed. |
| 1 | `failed` | A protocol, SAP operation, or result-contract check failed. |
| 2 | `blocked` / `incomplete` | Missing profile/credential, or source/public contracts changed during verification. |

Reports contain identifiers, stage outcome/error code, elapsed milliseconds,
response bytes, and attempted SAP-facing tool calls. They omit source,
document text and credential values. Reports still contain system/object IDs;
review before sharing. Backend HTTP request count is null because the runner
does not instrument that layer. No model is used, so this does not measure
model tokens, semantic explanation quality or comparative developer success.

On 2026-09-08 the current local profile list was empty. Running the preflight
produced `PROFILE_NOT_CONFIGURED`, exit 2 and zero SAP-facing calls. Automated
tests exercise that actual child-process behavior and required input checks.
Offline contract-step tests verify schema discovery, invocation arguments,
unchanged/changed/malformed responses, missing KTD, document page validation,
and omission of source/document text from the report.
The successful live branch still requires a configured SAP system and has not
been represented as verified. This runner does not cover writes, activation,
ABAP Unit, transports, BTP user-token exchange or all 120 capabilities.

The source-to-contract handoff now consumes the actual v1 `resourceUri`, parses
its ADT path, and verifies its system against the selected profile. The earlier
runner incorrectly expected the internal service's `sourceUri`, which the v1
source tool does not return; a configured class/interface run would have failed
before public-contract validation. An in-memory MCP regression uses the actual
source tool and deferred components gateway, including an encoded namespace,
and verifies unchanged-contract completion without recording source bodies.
Missing, malformed and cross-system Resources fail before contract discovery.
This fixes the runner contract; it is not live SAP evidence.

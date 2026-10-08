# Project release discovery contract

`sap-abap-mcp-release-profile-draft.json` is an implementation release check, with status `proposal`. It requires the same ten tool names and three evidence Resources as the original public profile, while classifying eight tools as read-only and ABAP Unit plus transport assessment as execution capabilities.

The validator rejects missing capabilities, read-only tools without `readOnlyHint: true`, and either execution capability without `readOnlyHint: false`. Execution tools are not made optional to obtain a passing result. Discovery checks do not run SAP tools and do not prove live authorization or absence of side effects.

```sh
npm run conformance:release
```

The public `sap-abap-mcp-profile-v1.json` remains unchanged under its governance process. Its strict read-only claim for application tests still fails; this release does not claim conformance to it. The historical check and default validator behavior remain available:

```sh
npm run conformance:v1
node scripts/check-profile-conformance.mjs --profile spec/sap-abap-mcp-profile-v1.json
```

CI and package validation explicitly select the release contract. Passing that check neither ratifies a neutral standard nor changes the published interoperability proposal. Community review of the latter proceeds under `GOVERNANCE.md`; product release validation is identified separately.

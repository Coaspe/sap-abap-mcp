# Directory corrections and user evidence — prepared, not sent

No public message, submission, recording, recruitment or adopter entry was made.
The official MCP Registry is already registered; it is not a new submission task.

## 1. Correct the broken external launch examples

Sources checked: [MCPBeat](https://mcpbeat.com/mcp-servers/coaspe/sap-abap-mcp/)
and [MCPNav](https://mcpnav.net/server/sap-abap-mcp/). The observed examples omit
`serve` and display 1.7.0-era metadata. npm 2.0.1 reproduces help on stdout and
termination for that command. The candidate compatibility fix is unreleased.

Draft to each maintainer:

> Please append `serve` to the npm invocation for `@coaspe/sap-abap-mcp`.
> Published 2.0.1 requires `npx -y @coaspe/sap-abap-mcp@2.0.1 serve`;
> Windows uses `npx.cmd`. Without the subcommand it prints CLI help and closes
> the MCP connection. Please generate client configs from the package identifier
> plus the positional package argument in server.json. SAP profiles must be
> configured locally before a first SAP read. A patch that accepts noninteractive
> no-argument startup is under review, not yet the npm release.

External reflection: **not applied**. Recheck the served examples after the owner
sends the request; a prepared draft is not evidence that a directory changed.

## 2. Refresh only observed stale descriptions

MCPBeat and MCPNav should re-read the registry's 2.0.1 metadata and explicit stdio
argument. Do not describe npm download events as verified users, successful
installs, actual SAP access or retention. The release-time spikes and common
zero dates in the public data prevent that inference. Current LobeHub/Smithery
public descriptions were not independently revalidated in this review; inspect
them before claiming they are stale or reflected. Existing submission history
remains in [directory submissions](mcp-directory-submissions.md).

## 3. Missing SAP specialist list draft

The fetched README of [marianfoo/sap-ai-mcp-servers](https://github.com/marianfoo/sap-ai-mcp-servers)
contains neither `Coaspe` nor `sap-abap-mcp` on 2026-10-20. This observation covers
that README, not every SAP catalogue or another branch.

Proposed entry, after the owner reviews the list's current contribution format:

| Project | Description | License |
|---|---|---|
| [SAP ABAP MCP](https://github.com/Coaspe/sap-abap-mcp) | Headless local ADT MCP for existing-object source/impact review, guarded changes and quality evidence; multi-system profiles, five gateways and on-demand capabilities. npm setup is local; SAP compatibility is verified per operation/system. | MIT |

No superiority or independent adoption claim accompanies the entry. Submission
status: **draft only**, not sent.

## 4. English existing-object case and demo script

**Script only: not recorded, not a customer case, no claimed live success.**
Use the existing [demo transcript](demo-script.md) and replace its broad tour
with one approved existing-object change. Do not publish SAP identifiers or code.

At 0–15 seconds, the developer asks: “Explain this existing object's current
behavior and the direct impact of my requested validation change. Use current
source evidence.” Show a redacted revision and coverage summary, or an explicit
blocked result when access is absent.

At 15–40 seconds, show the relevant include/method/public contract and callers,
plus dynamic-call, authorization and paging limits. Present the minimal patch
preview and the user's validation criteria. Keep system, object, account and
transport identifiers out of the public recording.

At 40–70 seconds, after fixture-write authorization, show actual conflict
protection and the resulting diff. Keep diagnostics, activation, nonzero Unit
results and ATC findings separate. Insert real measured results only; otherwise
label the step `not_run`. An animation cannot substitute for SAP execution.

At 70–90 seconds, finish with the actual diff, actual checks, unresolved scope
and next action. Suggested caption: “One scoped ABAP change with inspectable
evidence. Results depend on your SAP release, permissions and host.”

## 5. Owner-run ten-person experiment and consent

Preregister ten external ABAP developers before recruiting. Observe an attempted
install, MCP ready/setup-required state, SAP authentication, first useful read,
one accepted existing-object task and different-task reuse by day seven as
separate stages. Initial decision criteria are eight first-task successes and
five different-task reuses, not a market average or guarantee. Keep failed,
blocked and nonresponding members in the denominator; do not invent observations.

Reuse the existing feedback form and scorecard. `scripts/user-outcomes.mjs`
validates bounded voluntary records and emits only consented aggregate counts;
it has no network path. Keep private session material outside the repository.
Consent for aggregate statistics is separate from consent to publish an exact
organization/alias and quotation. Only the latter permits an ADOPTERS entry.
The current scorecard still has zero people and zero recorded outcomes.

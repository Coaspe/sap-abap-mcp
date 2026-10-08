# Identical ABAP task comparison

This is the version 1 acceptance contract for the five tasks in the
[competitive review](competitive-research-2026-10-01.ko.md). It is ready to use
with an authorized development SAP target. No live task results exist yet.
Capability discovery and schema payload measurements are reported separately;
a searchable tool is not proof that the task works.

## Freeze the environment before running

Record the SAP release/system type, client, ADT discovery capabilities, account
permissions, fixture revision, allowed package/transport and source hashes.
Use the same host build, model/provider/version, reasoning settings, prompt,
context limit and budgets for each implementation. Record each server's exact
package integrity or commit, preset, transport, role, write policy and cache
configuration. A latest-branch document is not a deployed-package version.

Use an isolated host configuration with one tested MCP at a time. Keep ordinary
client setup paths: setup comparison must include each product's prerequisites,
including an existing ADT installation or Node when required. Also report an
existing-user setup run separately. Do not equate these starting conditions.
A tool-search-capable host and a host that preloads all schemas are separate
experiments. Pin the discovery and provider-cache settings for both.

The SAP owner chooses and authorizes the fixture package, test objects and
transport. An independent grader freezes expected source references, related
types/callers, test counts/findings and incident cause before the assistant sees
the task. Reset only authorized fixtures between runs; verify hashes and lock
state. Never overwrite another developer's inactive work. A supplied replay of
ADT responses is an offline experiment, not live SAP acceptance.

## The five tasks

| ID | Same input given to every product | Acceptance evidence |
| --- | --- | --- |
| T1 setup and first read | Start from the declared installation state. Configure the test SAP, interrupt once, resume, and read its system identity. Include one invalid client or permission case. | Registration points to the selected runtime/profile; interrupted setup preserves settings; the first actual SAP read returns the expected SID/client and ADT evidence. A CLI health badge or saved profile alone does not pass. Record required inputs, manual edits and active/wall time. |
| T2 explain an object | Explain the selected class method, its direct callers and referenced public types using current source. | Assertions reference exact source/method/type locations; expected callers and public contracts are covered; paging/truncation is resolved or marked incomplete. Read access does not change source, locks or transports. Fabricated signatures fail. |
| T3 change and verify | Make one specified behavior change in the authorized development object. Inject an external edit after the initial read, then finish diagnostics, activation, ABAP Unit and ATC. | Stale-source refusal triggers a fresh read and reassessment; the independent edit survives; only authorized lines change; activation succeeds; expected nonzero tests pass; ATC findings and all pages are evaluated. An unsupported, skipped, empty or truncated quality check cannot pass. |
| T4 review a transport | Review the selected transport's objects, source changes, ATC/tests and target differences. Do not release it. | Grader compares the object/change inventory and seeded risks. Every requested check has a finding or an explicit unavailable result; unresolved risks prevent a ready-to-release claim. The transport remains unreleased. |
| T5 investigate an incident | Investigate the same dump and trace, correlate the implicated source, and propose a checkable fix. Do not apply it. | Root-cause claims cite dump/trace/source evidence and match the frozen incident facts. Missing evidence is explicit. The proposed reproduction or verification discriminates the cause; no source/system change occurs. |

T3 needs explicit fixture-write authorization. The comparison contract does not
itself authorize SAP writes. T4 quality checks can execute application tests;
its scope must cover them too. Start with read tasks when only read access is
available, and retain unexecuted tasks in the report.

## Record each run

Use three fresh sessions per task per product. Keep all 15 planned task-runs in
the denominator; report repetition and avoid treating repeated fixtures as
independent users. Save sanitized prompts, full MCP requests/results, paging,
errors/recovery, final answer, SAP verification evidence and grader decisions.
Never save credentials, bearer tokens, cookies or unrelated customer code.
Local test evidence is kept private unless its disclosure has been authorized.

The outcome is one of `success`, `partial`, `failed`, `unsupported`, `blocked`
or `not_run`. Only a fully evidenced success counts as a success. A missing
model/SAP connection is blocked or not_run, not unsupported. A model time or
context limit is a failed attempt. Report the reason and failed criterion.
Unauthorized changes, wrong-target writes or secret disclosure fail the run
regardless of its functional output. Verify final SAP state after a timed-out
write; do not infer rollback from transport cancellation.

For every run record MCP tool calls, retries, discovery/describe calls, SAP
HTTP round trips (from equivalent network instrumentation), wall time, human
interventions, and provider-reported input/output/cache token usage. If a host
cannot expose a metric, record null and why. Do not substitute a tokenizer
estimate or service-double call count for billed tokens or SAP round trips.
Report fixed-schema tokens separately, counted once, using the same tokenizer.
Include setup time and server instructions/prompt/resource consumption where
applicable. Capture provider usage for each request rather than summing
visible tool JSON and calling it a bill.

Compare success and quality gates before cost. Report totals and per-task
medians/ranges over all attempted runs, plus cost for successful runs. Show
partial/failed/unsupported/blocked counts alongside success. A cheap failure
is not a better product; omitting failures from the denominator is invalid.
Publish no overall "best" ranking while the identical-task evidence is absent.

## Current reproducible evidence

[Discovery results](competitive-task-discovery-2026-10-01/verification.json)
cover authored English query recall, role isolation, schema sizes and a local
regression fix. They include an ARC-1 1.4.0 published-schema comparison.
The ARC schema factory is invoked without live capabilities/plugins/auth
filtering; our schemas come from real in-memory MCP tools/list. Policy and
functionality differ, so these figures do not establish task equivalence.
ARC's hyperfocused schema is slightly smaller than our single-tool schema;
our default minimal schema is smaller than ARC's standard default.

Live SAP tasks, model correctness/billing, real novice setup success and
independent adoption are unverified. The compatibility profile and local
conformance gate are a proposal; standard status requires independent
implementations, adopters and governance evidence.


The [2026-10-02 offline read replay](competitive-read-workflow-2026-10-02/verification.json)
adds actual released competitor tool calls against one synthetic ADT source
fixture. It checks full-body reads, unchanged/changed refreshes and denied
refreshes, and reports a native Resource alternative. It covers only a source
read subtask, with scripted operation selection and no model or live SAP call;
it does not change any T1-T5 acceptance status above.

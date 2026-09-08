# Transport release evidence pilot

`sap-abap-mcp` is free and open-source software. The paid offer below is for
SAP teams whose existing ATC and ABAP Unit results are not yet preserved as a
transport-specific release decision and CI-ready evidence bundle.

This is not a new static-analysis engine, a replacement for SAP Cloud ALM,
ChaRM, ActiveControl, Rev-Trac, or Project "Piper", or a claim that a transport
is defect-free. If your current workflow already records the transport, check
results, approval decision, and evidence in one place, this pilot is probably
not useful.

## Who it is for

- Small or midsize SAP implementation and AMS partners.
- ECC or SAP S/4HANA on-premise/private-cloud projects using classic
  transports.
- Teams that run ATC or ABAP Unit manually or partially, but keep the result
  and release decision in separate screens, files, or messages.
- Teams able to run a read-only CLI from a customer-controlled DEV/QAS runner.

## Paid compatibility diagnostic

Pilot-validation price: **KRW 390,000** for up to two hours. Before payment,
the order form states whether this is a VAT-exclusive supply amount or gross
compensation subject to a confirmed withholding route. The fee is credited
toward the pilot when it proceeds.

The diagnostic checks only the prerequisites needed to decide whether the
pilot can run:

- SAP release, ADT availability, authentication method, and authorizations.
- Transport visibility and object coverage.
- ATC and discoverable ABAP Unit execution.
- Customer-controlled runner and report-retention constraints.

The deliverable is a one-page `ready / prerequisites needed / not suitable`
decision. A `not suitable` result is a valid outcome; it does not become an
open-ended integration project.

## Three-business-day pilot

Pilot-validation price: **KRW 1,800,000** for one unreleased transport with up
to 50 supported objects. The order form confirms the applicable tax and
payment-evidence treatment before work starts.

The pilot:

1. Runs the agreed ATC and discoverable ABAP Unit checks from a
   customer-controlled runner.
2. Optionally compares the same objects with a configured target system when
   that evidence is needed.
3. Returns `passed`, `failed`, or `incomplete`; missing or truncated evidence
   never becomes a pass.
4. Produces JSON, SARIF 2.1.0, and JUnit XML artifacts plus a concise release
   evidence memo.

The raw reports remain on the customer's runner. The pilot does not release a
transport, change production, modify ABAP source, provide an audit opinion, or
send SAP credentials or source code to a publisher-operated service.

## Lower-friction workshop

When security policy prevents an external tool evaluation, a **KRW 490,000,
90-minute team workshop** can map the existing release flow and adapt one
original evidence checklist or CI template without logging in to SAP. This is
an alternative to the pilot, not an additional prerequisite. Its order form
also states the applicable tax and payment-evidence treatment.

## Public evidence and its limit

- The current release is `1.7.0`, exposing 120 v1 tools and seven
  Resources by default.
- The TypeScript build and all 399 automated tests pass as of August 20, 2026.
- The sanitized live-SAP record contains 200 checks across ECC and S/4HANA
  development systems.
- The implementation, tests, and safety controls are reviewable in the public
  repository before a paid engagement.

These facts validate the software and its existing test environments. They do
not prove compatibility with a prospective customer's SAP release,
authorizations, policies, or transport contents. That is why the diagnostic
comes before the pilot.

## Fit questions

Before requesting a conversation, check four points:

1. Is ATC enforced before transport release, and is ABAP Unit included?
2. Are the results stored with the transport number and release decision?
3. Is Cloud ALM, ChaRM, ActiveControl, Rev-Trac, Project "Piper", or an
   equivalent flow already complete?
4. Can a customer-controlled runner execute a read-only CLI and retain JSON,
   SARIF, and JUnit files locally?

If the evidence flow is already complete, there is no reason to buy this
service.

## Request a fit conversation

Open a [transport release evidence pilot
inquiry](https://github.com/Coaspe/sap-abap-mcp/issues/new?template=professional-services.yml)
with non-confidential background only. The public issue is the initial contact
channel, so no email address is required.

Do not post company or customer names, SAP host names, transport numbers,
credentials, source code, logs, tokens, internal architecture, or other
confidential information. If the request appears suitable, the next step is a
20-minute fit conversation before any paid work or system access.

# SAP ABAP MCP Competitive Priority Roadmap

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the existing v1 transport-assessment capability into a trusted CI product while removing the security and adoption gaps that currently prevent enterprise credibility.

**Architecture:** Keep the current direct, headless ADT architecture and the full 115-tool v1 surface. Execute four independently reviewable projects in order: supply-chain hardening, default-deny data policy, transport-gate productization, and verified adoption evidence. Do not add an official SAP MCP adapter until a real customer requires an official-only backend.

**Tech Stack:** TypeScript 7, Node.js 20/24, Model Context Protocol SDK, SAP ADT, GitHub Actions, npm trusted publishing, JSON/SARIF/JUnit.

## Global Constraints

- Preserve unversioned `serve` as v1 with exactly 115 tools and seven Resources.
- Preserve `--api-version v0` at exactly 53 tools.
- Keep SAP credentials, hosts, usernames, source, transport contents, and business data out of public artifacts.
- Do not add Streamable HTTP, remote hosting, an official SAP MCP adapter, or new SAP-side Z components in this program.
- Keep transport assessment read-only; transport release remains a separate confirmed mutation.
- Do not claim SAP endorsement or call the compatibility profile a standard before independent adoption.
- Do not publish a new npm version until all release checks in this roadmap pass.

---

## Priority and dependency order

| Priority | Project | Why it is ordered here | Completion gate |
| --- | --- | --- | --- |
| P0 | [Supply-chain and CI hardening](2026-07-29-security-and-ci-hardening.md) | The current package has 11 high and two moderate production-path advisories and no normal pull-request CI workflow. | Zero production audit findings, required CI checks, provenance-enabled publish workflow |
| P1 | [Data access policy hardening](2026-07-29-data-access-policy-hardening.md) | User-defined SQL is currently available on ordinary profiles; development operations and application-data access need separate permission boundaries. | Default profiles deny user SQL and query-backed monitors without changing discovery |
| P1 | [Transport Change Gate](2026-07-29-transport-change-gate.md) | The assessment engine already exists; a CLI, compact MCP preset, and composite Action turn it into a repeatable product without a new SAP backend. | Local CLI and Action emit JSON/SARIF/JUnit and fail closed on failed or incomplete evidence |
| P2 | [Adoption and compatibility evidence](2026-07-29-adoption-and-evidence.md) | Downloads cannot prove human adoption; verified pilots and sanitized evidence can. | Ten pilot attempts, at least three repeat users, and three opt-in adopter reports |
| Deferred | Official SAP MCP backend adapter | It adds an IDE dependency and two protocol/version boundaries without a current customer requirement. | Re-plan only after two organizations require official-only SAP access |
| Deferred | Neutral standards organization | A maintainer-owned proposal is not a standard. | Re-plan only after three organizations and two independent implementations participate |

## Milestones

### Milestone 1: Trusted build baseline

- [ ] Complete every task in `2026-07-29-security-and-ci-hardening.md`.
- [ ] Verify `npm audit --omit=dev` reports zero vulnerabilities.
- [ ] Verify `npm run check`, `npm run smoke:v1`, `npm run conformance:v1`, and `npm pack --dry-run` pass on Node.js 20 and 24 where applicable.
- [ ] Make CI and dependency review required on `main`.
- [ ] Release the security-only patch as npm, GitHub Release, MCPB, and Official MCP Registry version `1.0.1` from one commit.

### Milestone 2: Change Gate release candidate

- [ ] Complete every task in `2026-07-29-data-access-policy-hardening.md`.
- [ ] Complete every task in `2026-07-29-transport-change-gate.md`.
- [ ] Exercise the gate against the existing in-memory SAP double.
- [ ] Exercise the gate once against a disposable live development transport without releasing it.
- [ ] Confirm CI logs contain no profile URL, username, source, object names, or finding excerpts.
- [ ] Build the MCPB and npm tarball from the same commit.

### Milestone 3: Controlled release

- [ ] Release the additive `gate` command and `--preset assurance` as version `1.1.0`.
- [ ] Update `CHANGELOG.md`, `package.json`, `package-lock.json`, `server.json`, and MCPB metadata to the same version.
- [ ] Run the complete release gate from the security plan.
- [ ] Publish npm with provenance, then publish the Official MCP Registry entry and GitHub release from the same commit.
- [ ] Verify the installed npm tarball exposes 115 v1 tools, seven Resources, and the new gate command.

### Milestone 4: Human adoption proof

- [ ] Complete the ten-session pilot in `2026-07-29-adoption-and-evidence.md`.
- [ ] Record setup time, first successful read, gate result, repeat use, and sanitized failure category.
- [ ] List an adopter only after explicit permission.
- [ ] Publish aggregate results even if the target metrics are missed.

## Ninety-day success metrics

| Metric | Target | Measurement |
| --- | ---: | --- |
| Production audit | 0 high, 0 moderate, 0 critical | `npm audit --omit=dev` |
| Fresh-machine setup | 9 of 10 succeed | Moderated pilot record |
| Time to first SAP read | Median at or below 5 minutes | Moderated pilot record |
| Transport gate completion | At least 8 of 10 eligible pilots | JSON gate status; no transport contents retained |
| Repeat use within 30 days | At least 3 users | Opt-in follow-up |
| Public adopters | At least 3 | `ADOPTERS.md` with explicit permission |
| Sustained npm usage | Four consecutive weeks above 1,000 | npm downloads API; secondary metric only |
| Independent profile implementations | At least 2 before neutralization work begins | Public conformance evidence |

## Explicit non-goals

- Do not compete on raw tool count.
- Do not build Fiori frontend generation already covered by SAP Fiori/UI5 tooling.
- Do not expand Dynpro backend installation in this program.
- Do not add anonymous telemetry.
- Do not use download spikes, automated clones, or directory crawlers as adoption evidence.
- Do not weaken a failing or incomplete gate to make demonstrations pass.

## Program completion

The program is complete only when P0, both P1 projects, and P2 gates pass. If P0 cannot reach a clean production audit without breaking the v0/v1 contracts, stop before P1 release work and document the exact upstream blocker in GitHub issue #3. An adapter or standards-governance project must not be used to distract from a failed security or adoption gate.

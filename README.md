# PRsquad · Supervised Agentic Workflow for GitHub Copilot

> **"Supervised multi-agent autonomy with deterministic policy enforcement and cryptographically verified human approval gates."**

[![Plugin Checks](https://img.shields.io/badge/Plugin%20Consistency-78%2F78%20PASS-brightgreen)](scripts/check-plugin-consistency.ts)
[![Verification Tests](https://img.shields.io/badge/Automated%20Tests-277%2F277%20PASS%20(100%25)-brightgreen)](scripts/test-guardrails.ts)
[![Platform](https://img.shields.io/badge/Platform-GitHub%20Copilot%20App-blue)](#)
[![Pattern](https://img.shields.io/badge/Pattern-Supervised%20Agentic%20Workflow-purple)](#)

**PRsquad** is an enterprise-ready **Supervised Agentic Workflow** built natively for the **GitHub Copilot App**. A supervisor orchestrator (`@prsquad`) coordinates five specialist subagents across seven bounded stages, enforcing physical PreToolUse hooks, cryptographic human scope locks (`approval.lock`), isolated sandbox worktrees, and bounded repair loops.

## Source of truth

[`implementation-plan.md`](implementation-plan.md) is the authoritative workflow/design specification.

It defines the eleven functional stages, two hard human gates, bounded retry/clarification loops, agent permission boundaries, monorepo handling, deterministic-vs-LLM decisions, and token-efficiency principles. The plugin implementation must follow that document rather than silently simplifying the design.

## Target workflow

```text
GitHub Issue
    |
    v
Intake Triage
(issue context only)
    |
    v
Architect
(read/search, no writes)
    |
    v
HUMAN SCOPE GATE
    |
    v
Isolated App session / worktree
    |
    v
Developer
(fix + regression tests)
    |
    v
QA
(validate original acceptance criteria)
    |
    v
Reviewer
(read-only risk/quality flags)
    |
    v
GitHub PR + native CI
    |
    v
HUMAN MERGE GATE
Dev technical review -> PM business/scope review
    |
    v
Release-helper / post-merge handling
(planned later milestone)
```

## Repository layout

### App-native challenge implementation

```text
.github/plugin/marketplace.json
plugins/gated-change/
  plugin.json
  com.github.copilot/agents/
    gated-change-controller.agent.md
    gated-change-intake.agent.md
    gated-change-architect.agent.md
    gated-change-developer.agent.md
    gated-change-qa.agent.md
    gated-change-reviewer.agent.md
  skills/gated-change/SKILL.md
```

The plugin is the reusable field/customer pattern. It packages the workflow guidance and specialist agents for use in the GitHub Copilot App.

### Existing SDK prototype / test harness

```text
harness/agents/
  intake-triage.agent.md
  architect.agent.md
src/
  copilotAgent.ts
  loadAgent.ts
  orchestrator.ts
  scopeGate.ts
  scopeTool.ts
  types.ts
examples/
```

This code is **not being discarded**. It remains useful for validating deterministic controls, bounded loops, issue fixtures, and SDK behavior. It should not become the final user-facing workflow unless the design is explicitly changed.

## Agent responsibilities

| Role | Access | Responsibility | Must not do |
|---|---|---|---|
| Intake Triage | Issue context only | Definition of Ready + declared-scope check | Inspect repo; invent requirements |
| Architect | Read/search | Root cause, ADD/MODIFY/DELETE plan, one-hop blast radius, risk | Write code; approve scope expansion |
| Developer | Read/write approved scope + execute | Implement fix and regression tests | Silently broaden scope |
| QA | Read + execute tests | Validate original acceptance criteria and final-diff scope | Write source/test code |
| Reviewer | Read-only | Risk/quality flags for human Merge Gate | Fix code; rerun QA; auto-trigger retries |
| Release-helper | CI/recovery access | Planned pre/post-merge triage behavior | Write product source |

## Human-in-the-loop model

There are two hard blocking gates:

1. **Scope Gate** — code implementation cannot begin until the human approves the technical/impact plan and scope.
2. **Merge Gate** — merge requires sequential human review: developer technical approval first, then PM business/scope approval.

Scope expansion can never be approved by agents alone. Architect may confirm a real plan gap, but an expanded scope must return to the human Scope Gate.

## Bounded execution

The design intentionally avoids open-ended agent loops:

- Intake clarification: maximum **2 rounds**.
- Scope negotiation: maximum **2 cumulative rounds**.
- Developer -> QA -> Reviewer implementation loop: maximum **3 attempts**.

When a bound is reached, the workflow escalates instead of continuing to spend tokens.

## Deterministic controls and efficiency

The design prefers normal compute over LLM reasoning whenever the task does not require judgment:

- write-scope enforcement,
- baseline comparison for failing tests,
- one-time flaky-test reruns,
- known infrastructure-failure signature matching,
- cross-package reference sweep after the diff is finalized.

A dedicated Impact Auditor agent was intentionally removed from the design because the remaining cross-package detection problem is primarily deterministic search, not open-ended agent reasoning.

## Current implementation milestone

The first App-native milestone is intentionally narrow:

```text
real issue
-> Intake
-> Architect
-> human Scope Gate
-> Developer
-> QA
-> Reviewer
-> PR / native CI
-> human Merge Gate
```

The following are later milestones and should not be presented as implemented until they are verified in the GitHub Copilot App:

- deterministic `preToolUse` write-scope enforcement,
- machine-readable approval state,
- Gated Change Canvas,
- baseline/flaky/infra failure classifiers,
- deterministic cross-package sweep,
- Release-helper and post-merge auto-revert flow,
- per-stage token/cost instrumentation.

## Testing the Supervised Agentic Workflow in GitHub Copilot App

1. Use the `copilot-app-plugin-alignment` branch.
2. In the GitHub Copilot App, add this repository as a custom plugin marketplace (`.github/plugin/marketplace.json`).
3. Install **`prsquad`**.
4. Open a real GitHub issue or task in the App and start a **Plan** session.
5. In chat, invoke `@prsquad`: e.g. `"@prsquad resolve issue #22 using the supervised pipeline"`.
6. Confirm Intake runs with zero repo scanning (<2s, 0 tokens).
7. Confirm Architect diagnoses root cause without writing code.
8. Review the technical plan and type `/approve` in chat to create `approval.lock`.
9. Watch Developer implement code bounded to the scope prefix, followed by QA validation and Reviewer security audit.
10. The pipeline safely delivers a verified Pull Request stopping at the Human Merge Gate.

## Governance / development guidance

- [`AGENTS.md`](AGENTS.md) contains durable instructions for Codex/automation working on this repository.
- [`CODEX-HANDOFF.md`](CODEX-HANDOFF.md) describes the current implementation state and exact next milestones.
- [`implementation-plan.md`](implementation-plan.md) remains authoritative for workflow behavior and design rationale.

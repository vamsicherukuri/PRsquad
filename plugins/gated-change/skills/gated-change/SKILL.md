---
name: gated-change
description: Run the repository's governed issue-to-PR workflow with specialist agents, bounded retries, explicit human scope approval, independent validation, and human merge review.
---

# Gated Change

Use this skill when a user wants to take a real GitHub issue through the governed change workflow implemented by this plugin's agents (design captured in this repository's `implementation-plan.md`, a maintainer-facing planning document).

## Workflow contract

1. The Controller receives the user's issue reference and delegates it to Intake. The Controller orchestrates only; it does not fetch or evaluate issue content.
2. Intake uses its read-only GitHub issue tools to fetch the title, body, metadata, and comments, then returns `FETCH_FAILED`, `EMPTY`, `NOT_READY`, or `READY`. It never reconstructs issue content from memory or inference.
3. For `EMPTY` or `NOT_READY`, the Controller asks the user to update the issue and confirm ("done", "updated", or equivalent — chat text alone never substitutes for an actual issue update). Intake check `0` is initial; clarification rounds `1` and `2` provide two human update/re-check opportunities. If round `2` remains insufficient, stop and escalate.
4. For `READY`, the Controller passes Intake's complete structured result to Architect. Architect returns `PLAN_READY` or `BLOCKED` (it could not produce a confident plan); scope-amendment reviews return `SCOPE_AMENDMENT_CONFIRMED` or `SCOPE_AMENDMENT_REJECTED`.
5. Stop at the human Scope Gate. No code changes before explicit approval. Approval is a two-part act: the human switches the session from Plan mode to Agent mode (the environment-enforced control — Developer's write tools stay inert in Plan mode no matter what is typed) AND explicitly confirms both the mode switch and approval in their reply. Do not delegate to Developer speculatively to test whether the mode switch happened — that wastes a full Developer turn on a foregone conclusion; wait for the human's confirming reply instead.
6. After approval, implement in the Copilot App session's isolated workspace/worktree through the Developer agent.
7. Developer writes the fix and regression tests.
8. QA independently validates the original acceptance criteria and final-diff scope compliance.
9. Reviewer performs independent read-only risk/quality review.
10. Open a pull request and let the repository's native CI run.
11. Stop at the human Merge Gate: human developer technical approval first, then PM business/scope approval.
12. Post-merge Release-helper behavior is added only when that planned stage is implemented and tested.

## Human-control rules

- Scope approval is a hard control boundary.
- Merge approval is a hard control boundary.
- A scope expansion always returns to the human Scope Gate.
- Architect may confirm that expansion is technically justified, but cannot authorize it.
- Reviewer findings inform human decisions and never automatically consume retry budget.
- Never substitute a generic/general-purpose agent for a named specialist, even as a fallback when routing to the named agent fails — a generic agent has none of the specialist's tool restrictions, and inline prompt instructions are not a substitute for enforced tool boundaries. A failed invocation (the agent never started) costs little and is not a failed implementation attempt, so retry the same named agent up to 4 times; if it still won't start, stop and put the decision to the human — never substitute another agent.

## Bounded-loop rules

- Intake clarification: <= 2 rounds.
- Scope negotiation: <= 2 cumulative rounds.
- Developer -> QA -> Reviewer implementation attempts: <= 3.
- A Developer invocation that never started (routing/tool-level failure, no side effects) does not consume an implementation attempt \u2014 retry it directly. A Developer stall mid-task (real edits may already exist) does consume one attempt, and must resume by first checking the actual git state rather than assuming a clean worktree.
- Escalate rather than loop beyond a bound.

## Handoff rules

- Controller validates every specialist return for schema, required fields, allowed enum, status-specific fields, and internal consistency before routing it.
- A malformed handoff gets one same-agent correction attempt limited to formatting/data repair. A second invalid result stops the workflow; Controller never invents missing values.
- Architect status: `PLAN_READY` -> Human Scope Gate; `BLOCKED` -> pause and report `blockedReason` to the human, do not proceed to the Scope Gate.
- Developer status: `IMPLEMENTED` -> QA; `BLOCKED` -> pause; `SCOPE_AMENDMENT_REQUIRED` -> Architect confirmation and, if confirmed, Human Scope Gate.
- QA verdict: `PASS` -> Reviewer; `FAIL` -> Developer retry for scope or genuine fix-caused failure; `BLOCKED` -> pause without retry consumption.
- Reviewer assessment `CLEAR` or `CONCERNS` always goes to the Human Merge Gate; concerns remain informational.
- Developer captures `baseRef` before editing and returns `headRef: WORKTREE`. QA and Reviewer inspect unstaged, staged, and untracked changes relative to that base.

## Efficiency rules

- Carry structured outputs forward instead of asking later agents to re-discover prior-stage context.
- Developer returns changed files, regression tests and criterion coverage, validation results, and a base/head diff reference. Controller combines that handoff with the approved plan, original criteria, scope, and risk context for QA.
- QA independently executes validation and returns criterion evidence, scope compliance, test results, and failure classifications. Controller combines that result with the final Developer handoff and actual diff reference for Reviewer.
- Prefer deterministic compute over LLM reasoning for baseline failure comparison, flaky reruns, infrastructure signature detection, and monorepo reference sweeps.
- Intake is the single issue-retrieval boundary. It uses real tool results on every invocation and returns `FETCH_FAILED` instead of remembered, paraphrased, or inferred content.
- Intake classifies blank body + no comments as `EMPTY`; incomplete non-empty content is `NOT_READY`. The fix in either case is updating the GitHub issue itself, never inventing values in-session.
- Do not add an Impact Auditor agent; the design intentionally removed it.
- Do not spend extra reasoning on incidental observations merely to make them loggable.

## Current implementation boundary

The first App-native vertical slice covers:

Issue -> Intake -> Architect -> Scope Gate -> Developer -> QA -> Reviewer -> PR/CI -> Merge Gate.

The Controller restates a compact `WorkflowState` block (runId, phase, round/attempt counters, approval flags) at the top of each reply, recomputed only from its last stated state, validated specialist handoffs, and explicit human messages. This state currently lives only in the conversation thread; it is not durable across a lost or restarted session.

The following are planned subsequent milestones and must not be represented as implemented until verified in the GitHub Copilot App:

- durable workflow-state persistence (`WorkflowState` moved from conversation-only to a policy hook or Canvas-backed store, revisit after end-to-end testing of the current vertical slice),
- deterministic write-scope enforcement hook,
- machine-readable approval state,
- Canvas control surface,
- baseline/flaky/infra classifiers,
- deterministic cross-package sweep,
- Release-helper and post-merge auto-revert flow,
- token/cost instrumentation.
- deterministic JSON Schema enforcement for specialist handoffs.

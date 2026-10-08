# CODEX-HANDOFF.md — Gated Change

## Current objective

Continue this repository as **Gated Change**, a governed, reusable workflow that runs inside the **GitHub Copilot App** for the GitHub Copilot App Enterprise Challenge.

The existing SDK/terminal code under `src/` is a prototype/test harness and reference implementation for some deterministic controls. It is not the final customer-facing workflow.

## Read first

1. `AGENTS.md`
2. `implementation-plan.md`
3. `README.md`
4. `plugins/prsquad/`
5. Existing prototype code under `src/`

Treat `implementation-plan.md` as the authoritative design source.

## Decisions already made

- Scenario: generic software-delivery bug fix.
- User experience: GitHub Copilot App.
- Distribution: Agent Plugin (`plugins/prsquad`).
- Two hard human gates: Scope Gate and Merge Gate.
- Keep Intake, Architect, Developer, QA, Reviewer, and Release-helper distinct.
- Intake must not inspect the repository.
- Architect is read/search only and produces a technical + impact spec, not code.
- Developer is the only source/test-writing agent.
- QA validates original acceptance criteria and executes tests; it does not write code.
- Reviewer is read-only, does not rerun QA tests, does not fix code, and does not automatically consume retries.
- Developer -> QA -> Reviewer implementation attempts are bounded to 3.
- Scope negotiation is bounded to 2 cumulative rounds.
- Intake clarification is bounded to 2 rounds.
- Scope expansion requires human re-approval; Architect may confirm a plan gap but cannot authorize expansion.
- Do not add an Impact Auditor agent; deterministic cross-package reference sweep replaces it.
- Prefer deterministic compute over LLM reasoning for baseline comparison, flaky reruns, infrastructure signatures, and cross-package reference discovery.
- Existing repository CI remains authoritative.

## Current implementation state

On branch `copilot-app-plugin-alignment` the repository now contains:

- `.github/plugin/marketplace.json`
- `plugins/prsquad/plugin.json`
- App-native controller agent
- App-native Intake agent
- App-native Architect agent
- App-native Developer agent
- App-native QA agent
- App-native Reviewer agent
- Gated Change skill
- `AGENTS.md`

The old `harness/agents/*` and `src/*` remain intentionally as the existing SDK prototype/harness (moved out of `.github/agents/` so they can't be auto-discovered as selectable agents).

## First milestone

Prove the following end-to-end **inside the GitHub Copilot App**:

1. Add this repository as a custom plugin marketplace and install `gated-change`.
2. Start from a real GitHub issue.
3. Select the Gated Change controller in a Plan-mode session. In Copilot CLI, use the qualified identifier `gated-change:gated-change-controller`.
4. Intake evaluates Definition of Ready without repo access.
5. Architect produces the technical + one-hop blast-radius plan.
6. Human explicitly approves scope before any source edit occurs.
7. Only then does Developer implement the fix + regression tests.
8. QA independently validates original acceptance criteria.
9. Reviewer performs read-only risk/quality review.
10. Create a pull request in the App and show native CI.
11. Stop before merge for the human Merge Gate.

Do not implement Canvas, Release-helper, post-merge automation, or elaborate telemetry in this same milestone.

## Second milestone

Add deterministic write-scope enforcement via a supported policy/hook mechanism.

Requirements:
- canonical path comparison,
- deny Developer writes outside human-approved scope,
- protect approval/scope state itself from agent edits,
- allow in-scope edits,
- visibly deny an intentional out-of-scope edit,
- legitimate scope expansion returns to the human Scope Gate.

Do not rely on prompt text as the hard enforcement control.

## Third milestone

Create the Gated Change Canvas in the GitHub Copilot App and use it as the human control surface for plan visibility and structured approval decisions.

Canvas should display:
- issue/readiness,
- original acceptance criteria,
- root cause,
- proposed ADD/MODIFY/DELETE plan,
- approved scope,
- blast-radius/risk,
- validation plan,
- current workflow stage,
- QA result,
- Reviewer flags,
- CI/PR state.

Human actions should include:
- Approve plan,
- Reject — request revision,
- Reject — send back entirely.

Only human actions may change the approval decision or broaden approved scope.

## Exact next action for Codex

Run the first milestone from a real GitHub issue in the GitHub Copilot App. Confirm the Intake clarification bound, Intake-to-Architect structured handoff, and visible Scope Gate before allowing a real Developer implementation.

Do not redesign the workflow and do not begin Canvas/post-merge work in the same change.

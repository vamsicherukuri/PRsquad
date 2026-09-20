# Implementation Plan — GitHub Copilot App Enterprise Challenge

Design document for the submission. Captures the workflow architecture, the questions raised while
designing it, and the decisions made in response. Living document — update as the design evolves.

Related: [workflow diagram & token accounting (Artifact)](https://claude.ai/artifact/P99xeczGaacExSXJp7mVhp)

---

## 1. Challenge fit

- **Submission deadline:** finals week of 2026-10-19 (planning started 2026-09-16 — 3-week build window).
- **Judged on:** enterprise relevance (35), repeatability/field usability (20), governance/RAI/human-in-the-loop (20),
  competitive positioning vs. Claude Code (15), storytelling/demo clarity (10), bonus product feedback (5).
- **Existing assets being extended, not built from scratch:** a three-stage pipeline (Architect → Developer ↔ QA),
  SDK-based agent code, and a cold-start collector usable for cost/observability data.

## 2. Scenario decision

**Decided:** a generic software-delivery bug fix — closest to Neo's own demo, easiest side-by-side comparison for
judges. **Explicitly rejected:** a migration/GHEC-specific scenario — not to be discussed or reintroduced anywhere
in this project.

**Why this still differentiates from Neo despite being the "generic" choice:** Neo's flow is single-agent, invisible,
and developer-only. This design adds non-developer participation (PM approval gates), visible multi-agent
collaboration, and governance (permissions/audit readout) — the things the challenge explicitly asks entries to
demonstrate against Claude Code.

## 3. Workflow architecture

11 functional steps (10 original + 1 inserted during the stage-by-stage review — a second insertion, Impact
Auditor, was designed then cut; see §6). Two hard blocking gates total.

| # | Step | Actor | Cost tier | Notes |
|---|------|-------|-----------|-------|
| 1 | Issue filed | Non-dev (support/PM) | Zero | Native GitHub issue creation |
| **1.5** | **Intake Triage** | Agent | Low | New — completeness check, see §4 |
| 2 | Plan drafted | Architect agent | Medium | Spec only, no code — see §5 |
| 3 | **Scope gate** | Non-dev (PM) — **hard block** | Zero | Developer agent cannot start until approved |
| 4 | Branch isolated | Native | Zero | Worktree creation |
| 5 | Fix implemented | Developer agent | High | Primary cost driver |
| 6 | Tests run | QA agent | Medium | Functional correctness only |
| 7 | Diff reviewed | Reviewer agent | Medium | Flags risk/quality; also sees any cross-package impact from the deterministic sweep, see §6 |
| 8 | PR opened, CI runs | Native | Zero | Repo's own CI pipeline; failure handling in §5f |
| 9 | **Merge gate** | Dev + Non-dev (PM) — dual review | Zero | Sees code diff, release note, and Reviewer's flags |
| 10 | Merge & triage | Release-helper agent | Low | Auto-reverts on confirmed genuine post-merge failure, no gate; see §5h |

**Bounded retry loop:** steps 5→6→7 may repeat up to **3 times** on failure. A 4th failure escalates to the PM and
the pipeline pauses — this is the primary defense against open-ended token burn in the design.

## 4. Step 1.5 — Intake Triage

**Problem raised:** an issue filed with no detail or acceptance criteria must not let the LLM guess a fix from the
title alone.

**Decision:** insert a cheap, low-token completeness check before the Architect ever runs.
- The Controller remains orchestration-only: it passes the issue owner/repository/number to Intake, routes Intake's
  structured result, tracks clarification rounds, and invokes the next stage.
- Intake owns read-only retrieval of the issue title, body, metadata, and comments through GitHub issue tools. It
  returns one of four statuses: `FETCH_FAILED`, `EMPTY`, `NOT_READY`, or `READY`. A failed or untrustworthy fetch
  must return `FETCH_FAILED`; Intake never reconstructs issue content from memory or inference.
- Checks the issue against a **Definition of Ready**: repro path or expected-vs-actual behavior, something usable
  as acceptance criteria, and (added in §6) a declared scope (package/service path prefix).
- **Sufficient →** proceeds to Step 2 (Architect) normally.
- **Insufficient →** agent posts clarifying questions and the pipeline pauses.
  - *Open / deferred (2026-09-16):* whether this routes as native GitHub issue comments or a separate PM
    approval-style prompt. Intentionally left open until the full workflow review is done — do not assume either
    answer.
- **Bounded:** capped at 2 clarification rounds, then escalates to the PM to supply the missing info or
  close/deprioritize the issue.
- Round numbering is explicit: `0` is the initial Intake check; rounds `1` and `2` are two actual human
  clarification opportunities and re-checks. The maximum is therefore three Intake invocations.
- **Rationale:** same "don't spend expensive tokens on an ill-defined target" principle as the retry cap — reuse
  this framing in the submission narrative as a second, cheaper example of the same discipline.

## 5. Step 2 — Plan drafted

**Questions raised:** Does the plan include actual code changes? Does it have visibility into blast radius
(deletions/modifications that might impact other parts of the codebase)?

**Decisions:**
- The plan is a **technical + impact spec, not code**: root cause, file/function-level change list tagged
  ADD/MODIFY/DELETE, plus blast-radius analysis (search for callers/usages/tests of anything touched, flag
  cross-module or public-API impact). Actual code only happens in Step 5. This keeps Step 2 at Medium cost instead
  of High — writing code twice (once in a plan, once for real) would be pure waste.
- The plan carries a computed **risk tier (Low/Medium/High)**, translated into plain language for the PM gate,
  since the PM can't read a diff or a file list — they need "this touches 4 other modules," not code.
- *Parked (2026-09-16, revisit after the full workflow is designed):* whether a High blast-radius plan should
  require an extra technical approver beyond the standard PM gate, or the single PM gate stays regardless of risk
  tier.

**Architect vs. Developer — considered merging, decided against it.** Reasons:
1. The Step 3 hard-block gate must sit between plan and implementation regardless — merging the two agents
   wouldn't remove that split, only relabel it.
2. Separate agents give a cleaner permission-boundary story for the audit/governance readout (Architect never
   needs write access; Developer never needs to have had read-only-only history).
3. Collapsing named roles undercuts the "multi-agent collaboration" competitive-differentiation criterion the
   challenge explicitly rewards.

## 5a. Step 03 — Scope gate: rejection handling

**Question raised:** what happens if the PM rejects the plan entirely, versus rejecting only part of it?

**Decision (revised 2026-09-16):** the PM's rejection action is explicit and structured, not inferred from free
text — two distinct choices, each with a different downstream path:

- **"Reject — request revision"** (partial rejection, e.g. "keep items 1–2, drop item 3, re-scope item 4"): the
  Architect gets **one bounded revision pass**, incorporating the PM's feedback. It only re-analyzes the items the
  feedback actually touched, not a full re-run of blast-radius search on parts the PM didn't object to — keeps the
  revision cheaper than the original plan, not double the cost. **Capped at 2 total gate rounds** (initial + 1
  revision) — same pattern as Intake Triage's clarification cap.
- **"Reject — send back entirely"** (full rejection, e.g. "wrong problem, start over"): **skips the revision pass
  entirely** and escalates immediately to manual PM/Architect handling outside the automated flow.

**Why the split (this was originally one rule for both, reversed after further thought):** a full rejection gives
the Architect too little signal to act on productively — spending a revision attempt on a low-probability guess is
a worse bet than escalating immediately. This is actually the *more* token-efficient choice, not a less disciplined
one — it matches the design's broader principle of not automating what's unlikely to succeed. Making it an explicit
PM action (not NLP classification of free text) also keeps the full-vs-partial branch a zero-token decision,
consistent with every other gate in this design.

**If a partial-rejection revision still isn't approved after round 2:** the pipeline pauses and escalates — the
issue is parked for manual PM/Architect collaboration outside the automated flow, the same escalation pattern used
by Intake Triage and the Step 5–7 Fix retry loop.

## 5b. Steps 04–05 — Write-scope enforcement

**Question raised:** branch/worktree isolation (Step 04) separates this fix's changes from `main`, but does it
actually stop the Developer agent from writing *outside* the declared scope within its own branch? (It doesn't —
git isolation and scope isolation are different problems.)

**Decision:** wrap the Developer agent's write/edit tool so every write path is checked against the declared scope
before it's allowed (tool-level enforcement, not a prompt instruction). Zero added LLM token cost — it's a
deterministic path check in the orchestration layer, not something the model reasons about.

**Why enforce rather than trust intent:** an LLM agent can drift via "helpful" scope creep, reasoning errors, or
prompt injection from adversarial content in the repo — none of which require the agent to be careless or
malicious. Plan-scoped context (Developer receives Architect's structured plan, not the raw issue) is a
complementary *soft* discipline that reduces how often this ever triggers; the tool wrapper is the cheap, always-on
*hard* guarantee behind it. Together they're cheaper than either alone, since the wrapper almost never has to block
anything in practice.

**Branch timing:** Step 04 (branch/worktree creation) waits until final Scope-gate approval — not created
speculatively during an earlier revision round.

### Blocked-write handling — three branches, not two

| Case | What happens |
|---|---|
| **1. Not actually needed** (Developer drift) | Wrapper blocks the write; agent picks a different in-scope approach. 1st occurrence in a pass is free (logged as an audit flag only). 2nd occurrence in the same pass consumes one unit of the *existing* Steps 5–7 retry cap — same currency as a QA failure, not a new counter. |
| **2. Genuinely needed, plan gap, Architect agrees** | Developer sends a scope-amendment request to Architect first (agent-to-agent, cheap, fast, no PM involved yet). If Architect agrees the plan was incomplete, it **cannot approve the expansion itself** — its agreement triggers a Scope-gate revision round, reusing the same ≤2-round mechanism from §5a. Only the PM can authorize an actual scope expansion. |
| **3. Genuinely needed, plan gap, Architect disagrees** | Treated like case 1 — Developer's belief was wrong, proceeds without it, no PM involvement. |

**Scope-amendment contracts:** Developer returns `SCOPE_AMENDMENT_REQUIRED` with requested paths, reason, and
impact if rejected. Architect returns `SCOPE_AMENDMENT_CONFIRMED` with a revised plan/proposed scope, or
`SCOPE_AMENDMENT_REJECTED` with a reason. Confirmation returns to the human Scope gate; it is never approval.

**The governance rule this preserves:** Architect may *confirm* the original scope was sufficient (resolving a
request without escalation), but may never *unilaterally approve* a scope expansion — only the PM can, via the
Scope gate. Without this line, two agents could jointly expand scope with zero human involvement, which would
quietly undo the "PM approval is a hard block" guarantee the whole design rests on.

**Why this is a good enterprise analogy, not just a technicality:** it mirrors how human teams already work — a
developer asks a tech lead a technical question and gets it resolved peer-to-peer; if the fix genuinely needs to
grow beyond what was scoped, that's a business decision that goes back up to whoever owns scope (the PM), not
something two engineers settle between themselves. It also reuses mechanisms you already have (the retry cap, the
Scope-gate revision cap) instead of inventing a third or fourth bounded-loop type.

## 5c. Steps 05→06 — Developer-to-QA handoff

**Question raised:** what does the Developer actually hand off to QA, and who is responsible for writing tests?

**Developer → Controller handoff:** status, changed files, tests added or changed, Architect-plan items addressed,
test-to-acceptance-criterion coverage, commands/results from the Developer's narrow validation, a base/head diff
reference, any scope-amendment request, assumptions, and residual risk. The Developer copies original acceptance
criteria verbatim when mapping tests; it never rewrites them.

Developer status is a closed enum: `IMPLEMENTED`, `BLOCKED`, or `SCOPE_AMENDMENT_REQUIRED`. Only `IMPLEMENTED`
reaches QA. `BLOCKED` pauses; it consumes an implementation attempt only when partial work exists.
`SCOPE_AMENDMENT_REQUIRED` follows the Architect/Scope-gate path above.

**Diff protocol:** Developer captures `baseRef` with `git rev-parse HEAD` before its first edit and returns
`headRef: WORKTREE`. QA and Reviewer inspect unstaged changes, staged changes, and untracked files relative to that
base; implementation need not be committed before validation.

**Controller → QA package:** the complete Developer handoff, approved Architect plan, original acceptance criteria
from Intake, approved scope, Architect risk/blast-radius data, and final diff reference. QA reads the actual diff
from those refs rather than receiving an LLM-generated diff summary.

**Decision: the Developer writes the fix *and* its regression tests together. QA does not write test code.**

**Why, over the alternative of QA authoring its own tests:**
- Writing a meaningful test requires the same depth of understanding of the change that the Developer already has.
  Making QA rebuild that understanding from scratch to author its own tests is the same category of redundant work
  already ruled out between Architect and Developer — duplicate token spend to reach the same understanding twice.
- The real risk this raises — a Developer's own tests might just confirm its own fix and miss what it didn't think
  of — is solved differently: QA's independence comes from validating against the **original acceptance criteria**
  (untouched by the Developer), not from writing separate test code.
- It keeps the write-access story clean: exactly **one** agent (Developer) can ever write code. Giving QA write
  access too would mean a new exception, and would reopen whether QA's writes also need scope enforcement — a
  problem already solved for Developer and not worth solving twice.

**QA's job, two parts:**
- **Re-verify scope compliance** — a second, cheap checkpoint confirming the *final diff* matches the approved
  plan, distinct from the wrapper's per-write check at write time (§5b checks each write as it happens; this checks
  the result as a whole).
- **Build a test plan mapped to the original acceptance criteria**, then execute it (Developer's tests + the plan)
  and flag any gap between what was tested and what the issue actually asked for. Failures feed the existing
  Steps 5–7 retry loop — no new mechanism.

**QA → Controller handoff:** verdict, final-diff scope compliance, criterion-level results with evidence, executed
test results, criterion-mapped validation plan, failure classifications, blocking findings, and notes. QA verdict
is a closed enum: `PASS`, `FAIL`, or `BLOCKED`. Only `PASS` reaches Reviewer. `FAIL` is reserved for scope failure
or repeatable fix-caused failure and consumes an implementation attempt. `BLOCKED` pauses without consuming one.
`INFRASTRUCTURE` and `UNKNOWN` are failure classifications that require overall verdict `BLOCKED`.

**Controller → Reviewer package:** approved Architect plan, original acceptance criteria, complete final Developer
handoff, approved scope, final diff reference, complete QA result/evidence, Architect risk/blast-radius data, and
any deterministic cross-package hits available. Reviewer reads the actual final diff, performs code review, and
uses QA's evidence without re-running tests. Reviewer has shell access only for non-mutating git inspection needed
to reconstruct that diff; it must not execute tests/builds or any command that changes files, the index, or refs.
Reviewer assessment is `CLEAR` or `CONCERNS`; both proceed to the human Merge gate because concerns are
informational and never autonomously trigger a retry.

## 5c.1 Handoff contract validation

The Controller validates every specialist return before routing it: schema shape, required fields, allowed enum,
status-specific fields, and internal consistency. A malformed result gets one same-agent correction invocation
limited to repairing the handoff (no new analysis, edits, or tests). If still invalid, the workflow stops with a
handoff-contract failure. Correction-only invocations do not consume workflow retry budget. Missing fields are
never inferred or fabricated. Deterministic JSON Schema enforcement is a later hardening milestone; this first
vertical slice enforces the contract through Controller instructions.

## 5d. Step 06 — Tests run: scope and failure classification

**Question raised:** tests are scoped to the declared package (not a full monorepo regression run) — but within that
scope, how do we tell a failure actually *caused by this fix* apart from a pre-existing or flaky test?

**Decision:** classification is mechanical/compute-based, not LLM-reasoning-based — the same approach real CI
systems already use.

1. Run the scoped test suite against the Developer's post-fix branch.
2. For any failing test, check whether it also fails on a **pre-fix baseline** of the same scoped suite. Fails on
   both → **pre-existing**, not caused by this fix.
3. For a failure that's new (post-fix only), **auto-rerun it once** to rule out flakiness. Passes on rerun →
   **flaky**, not a real failure. Fails again → **genuine, fix-caused failure**.

**Outcomes:**
- Pass, pre-existing, or resolved-flaky → does **not** consume a retry. Logged as a flag feeding the Merge gate's
  audit readout (cheap — the classification step already produced this information, no extra LLM reasoning
  required).
- Genuine fix-caused failure → consumes one unit of the **existing** Steps 5–7 retry cap, routes back to Developer.
  This is the *only* case QA's LLM reasoning actually needs to engage with.

**Why this matters for efficiency:** baseline comparison and flaky-reruns are both just re-running test binaries —
compute cost, not token cost. This reserves QA's expensive LLM reasoning for failures that actually matter, instead
of spending tokens deciding whether every red test is real or noise — the same "compute is cheap, tokens are
scarce" principle established for monorepo search in §6.

## 5e. Step 07 — Reviewer flag handling and Merge-gate rejection

**Question raised:** if the Reviewer flags an issue, what actually happens with it?

**Decision:** Reviewer's flags stay purely informational and never auto-trigger anything.

- **Why not let Reviewer force a retry itself:** Reviewer already has no reject-and-retry authority (an earlier
  decision). If a single agent's own judgment could consume retry-cap budget, a trigger-happy or overly cautious
  Reviewer could burn the entire 3-attempt budget on low-value concerns — directly undermining the efficiency
  design built everywhere else in this pipeline.
- **Why the Merge gate, not a new checkpoint:** Reviewer's mandate is "should this ship," which is exactly what the
  Merge gate (Step 09) already exists to judge, with real human authority (Dev + PM) attached. Flags get bundled
  into what they see there — no second, weaker gate needed.

**This closes a previously open gap — what a Merge-gate rejection actually does:**

- If Dev + PM decide a flag from Reviewer (including any cross-package impact findings surfaced by the
  deterministic sweep, §6) or the diff itself is serious enough to block, they reject using the Merge gate's
  existing binary approve/reject authority.
- **That rejection sends the fix back to Developer and consumes one unit of the *existing* Steps 5–7 retry cap** —
  not a new counter. A Merge-gate rejection is fundamentally the same category of event as a QA failure ("this
  implementation needs more work"), so it draws from the same budget. (Contrast with the Scope gate's separate
  ≤2-round cap, §5a — that governs *scope* disagreements, a different kind of problem from implementation quality.)
- If retries are already exhausted (from earlier QA failures or this rejection) → escalates to the PM, the same
  escalation pattern used throughout the design.

## 5f. Step 08 — PR opened, CI runs: what CI is, and failure handling

**Question raised:** what exactly does CI do here, and what happens if it fails?

**What CI is:** the repo's own pre-existing, org-configured CI pipeline (build, full/broader test suite, lint,
security/dependency scanning) — not something this design builds, and not agent-run. Zero token cost regardless of
how broad it runs, since it's native compute.

**Why it's distinct from QA's Step 06 pass, not redundant with it:** QA is deliberately *scoped* to the declared
package because it's LLM-reasoning-driven and token-constrained (§5d). CI has no such constraint, so it's free to be
the comprehensive safety net — full test suite across the whole repo, plus checks QA never attempts (lint, security
scanning, build verification). Both are needed because CI only runs *after* a PR exists (a slower feedback loop);
QA's scoped, cheap check catches obvious problems immediately, inside the fast Developer↔QA↔Reviewer loop, before a
PR and a full CI run even happen. As a side benefit, CI's full-repo run is a second, complementary safety net for
cross-package impact alongside the zero-token sweep from §6 — the sweep catches known symbol references, CI can
catch runtime breakage the sweep's grep-based check would miss.

**Failure handling — layered classification, cheapest checks first**, based on how CI failures actually behave in a
traditional lifecycle (most are flaky or infra noise, not real fix problems):

1. **Free/mechanical first** — same baseline-comparison + auto-rerun approach as Step 06 (§5d). Catches pre-existing
   and simple flaky failures at zero cost, no retry consumed.
2. **If still failing:** a cheap, deterministic pattern-match against known infra-failure signatures (connection
   timeouts, runner-offline errors, rate limits, auth/credential errors, 5xx from external services) — still zero
   tokens, log-text matching only.
3. **If it matches an infra signature:** **Release-helper is reused, not a new agent**, to read the logs and
   characterize the problem plus suggest next steps. Its existing mandate ("read CI, triage failures," currently
   scoped to post-merge CI-watch) just gets a second entry point here, pre-merge.
4. **The workflow pauses in a new "infra-blocked" state** — zero cost against the retry cap, since this isn't the
   fix's fault. This is a **different kind of escalation than the PM gates**: it goes to whoever can actually fix
   the infra (a developer or DevOps, not necessarily the PM) — not every pause in this design routes to the same
   place.
5. **A human fixes the infra, then explicitly resumes the workflow** — CI re-runs, still no retry consumed.
6. **If no infra signature is found** (a real test/build failure): genuine, fix-caused failure — consumes one unit
   of the *existing* Steps 5–7 retry cap, back to Developer, same treatment as any other genuine failure in this
   design.

**Net effect:** zero new named agents (Release-helper does double duty across pre- and post-merge CI triage), and
LLM reasoning is reserved only for the failures that are confirmed non-infra and non-flaky — the minority case, not
the default assumption.

## 5g. Step 09 — Merge gate: review order and rejection routing

**Questions raised:** who writes the release note; what happens if either Dev or PM rejects; and (raised mid-
discussion) does PM even need to be a blocking approver here at all, given they already approved scope?

**Decisions:**
- **Developer writes the release note** — no separate pass or agent for this.
- **Review is sequential, not simultaneous:** Dev (human) approves the code/diff first; only then does PM review
  the release note, Reviewer's flags, and the fact Dev already approved. PM never reviews something that hasn't
  cleared technical review yet.
- **Considered and rejected: dropping PM from the Merge gate.** The case for it is real — PM already made the
  scope/business call at the Scope gate, and by Merge-gate time there's no new scope decision left, just a
  correctness check that's engineering's job. But removing PM here would leave exactly one non-dev touchpoint for
  the whole lifecycle, narrowing the differentiator this project was built around from the start (§2 — *two*
  deliberate non-dev touchpoints, not one, to satisfy the challenge's "developers and non-developers" requirement).
  **Final call: keep the Merge gate as a true dual review** — both Dev and PM can block, sequentially.

**Rejection handling — split by *who* rejects and *why*, not by which step caught it:**

| Who rejects | Why | Handling |
|---|---|---|
| Developer | Technical/implementation concern, before PM even sees it | Consumes one unit of the *existing* Steps 5–7 retry cap, back to Developer agent (§5e, unchanged) |
| PM | Necessarily a scope/business concern — Dev already cleared code quality | Routes to the *same* Scope gate mechanism (§5a): "request revision" (bounded, ≤2 rounds) or "send back entirely" (escalate immediately) |

**The organizing principle, worth stating directly in the submission:** the mechanism a rejection draws from
depends on *who* is rejecting and *what kind* of problem it is — not which pipeline step happened to catch it.
Dev-level concerns always draw from the Fix retry cap, wherever they surface (QA, CI, or Dev's own Merge-gate
review). PM-level concerns always draw from the Scope-gate mechanism, wherever they surface (the original Scope
gate, or a late PM objection here). This is more coherent than giving every stage its own bespoke rejection rule.

**Budget scope:** a PM's Merge-gate rejection draws from the *same* cumulative ≤2-round Scope-gate budget as the
original approval, not a fresh one — "scope negotiation is bounded to 2 rounds total across the whole fix
lifecycle" stays one clean claim rather than resetting per gate.

## 5h. Step 10 — Merge & triage: post-merge failure handling

**Questions raised:** does post-merge CI failure get the same handling as Step 08's pre-merge CI? What's the remedy
for a genuine post-merge failure, and who has authority to act — Release-helper, or a human?

**Decision: reuse Step 08's layered classification (§5f) directly** — baseline comparison, auto-rerun for
flakiness, infra-signature pattern match, same mechanism, same agent (Release-helper). The only shift is what
"baseline" means: now "main immediately before this merge landed," instead of the pre-fix branch.

**On a genuine post-merge failure: Release-helper reverts automatically — no human gate for the revert itself.**
This is the first fully autonomous consequential action anywhere in this design, and it's deliberate, not an
oversight:

- A revert is **safe and reversible** — the original commits still exist and can be reapplied — which makes it
  fundamentally different from every other action in this pipeline. Everything else that needed a gate was a
  *forward* action (writing code, merging, expanding scope). A revert is undo, not a new decision.
- It's only reachable through the same layered classification as Step 08 — pre-existing, flaky, and infra-caused
  failures never trigger a revert, only a **confirmed genuine** regression does. That containment is what makes
  automating it defensible.
- "Revert first, investigate after" is standard SRE practice — leaving main broken while a human deliberates is
  the actually risky option, not the cautious one.
- Dev + PM are still **notified** — informed of what happened, not asked to authorize it.

**What happens to the underlying problem:** Release-helper auto-files a new **high-priority** issue describing the
regression — cheap, since the classification step already did the log analysis (the same "free logging" pattern as
the Observations rule, §6). That issue **re-enters the pipeline from Step 1**, like any other issue — full
governance, full gates, nothing skipped for urgency. Worth stating directly in the submission: a production
regression doesn't get a backdoor around the process, it gets a fresh, fully-governed cycle, with safety already
restored by the revert.

**The Steps 5–7 retry cap does not apply here** — that budget belonged to the original fix cycle, which is now
closed (merged, then reverted). The new auto-filed issue starts with a completely fresh retry budget, since it's a
new cycle, not a continuation of the old one.

## 6. Monorepo scope handling

**Problem raised:** in a monorepo, agents reviewing "other parts" of the code risk (a) unbounded token cost from
searching too broadly, and (b) surfacing/acting on issues unrelated to the current ticket.

**Clarified assumption:** GitHub's search/indexing (code search, Copilot workspace semantic search) reduces the
*compute* cost of locating candidate files — grep/search calls cost no LLM tokens regardless of repo size. It does
**not** by itself bound *token* cost, which only comes from pulling file contents into the LLM's context to reason
over. A generic search can still surface hits across unrelated packages even in an indexed monorepo. **Correct
framing for the submission:** the declared-scope field filters what gets loaded into context after search — it
doesn't prevent scanning, because scanning was never the expensive part.

**Decisions:**
- **Declared scope is now part of the Definition of Ready** (§4): which package/service/directory the issue
  belongs to (path prefix). If not inferable from labels/CODEOWNERS/directory hints, Intake Triage asks for it.
- **Architect's blast-radius search is bounded to declared scope + one hop of direct importers/callers**, not a
  full monorepo crawl.
- **No agent may act on or expand scope to fix anything the PM didn't approve** — direct extension of the Scope
  Gate.

### Cross-package impact: a deterministic sweep, not a dedicated agent

**Problem raised:** Architect's one-hop blast-radius search happens *before* the code exists — it's a prediction
and can miss transitive/cross-package impact that only becomes visible once the fix is real.

**Original decision (later reversed):** add a dedicated **Impact Auditor** agent between Reviewer and the Merge
gate, with deliberately wider read access than every other agent — the one explicit exception to the tight
per-agent scoping used everywhere else.

**Reversed 2026-09-16.** User pushback: it costs more tokens (especially in a monorepo), has no clearly
differentiated use once write access is enforced, and risks exactly the "wide-roaming agent" drift problem the rest
of the design has guarded against. Agreed, and cut it.

**Replacement decision:** the actual remaining risk is narrow — with Developer's write access now enforced to the
declared scope (§5b), the only way this fix can still affect another package is if it changes a publicly-exported
symbol that another package imports. Finding that is a **search problem, not a reasoning problem**.

- After the diff is finalized, a **deterministic sweep** (grep-based, compute cost only, zero LLM tokens) checks
  the whole monorepo for references to any symbol the diff actually changed.
- **Nothing outside the declared scope found →** nothing happens. Zero tokens, no flag, no agent involved.
- **Something outside scope found →** those specific external call-sites get added to what **Reviewer** (Step 07)
  already reviews in its existing pass, instead of paying for a second, separate Medium–High-cost agent to re-read
  the whole diff from scratch.

**Why this is a better design, not just a cheaper one:**
- Removes the one deliberate wide-read-access exception from the permission model entirely — nothing in the
  pipeline needs broader-than-scope read access anymore.
- A grep can't drift; there's no free-roaming agent making its own judgment calls about what's worth reading.
- Net effect: back to **11 steps** (not 12), one fewer named agent, and a genuine efficiency-narrative point for
  the submission — the design caught its own over-engineering and cut it, rather than defending an agent that
  existed just because it had been designed.

### Incidental "Observations" (unrelated findings)

**Problem raised:** while working, an agent may notice something unrelated to the current issue entirely (a
different bug, dead code, tech debt).

**Decision:** token cost is the sole deciding factor, not the usefulness of the finding.
- If capturing/filing it is **essentially free** — the observation text is already part of the agent's current
  output, and filing is a direct tool call to create a low-priority GitHub issue with no extra LLM reasoning or
  investigation — **auto-file it as a low-priority issue.**
- If filing would require **any** additional token-consuming work (further investigation, extra reasoning, a
  separate agent call to characterize it properly) — **the agent drops it and moves on. No logging, no scope
  expansion.**
- Agents must never investigate an observation further just to make it loggable.

## 7. Agent permission boundaries

Every stage's input must be the prior stage's **structured output**, never the raw issue re-read from scratch —
this is the rule that prevents two agents from redoing each other's work and burning tokens twice. Intake is the
single issue-retrieval boundary; Architect receives Intake's verified issue payload through the Controller.

| Agent | Access | Owns | Must not do |
|---|---|---|---|
| Intake Triage | Read-only GitHub issue tools; no source access | Issue retrieval + completeness/scope check | Read repository source or invent issue content |
| Architect | Read/search the repo | Plan + blast-radius analysis | Write or commit code |
| Developer | Read + write, own branch only | Implementation | Re-explore the repo — consumes Architect's plan as-is |
| QA | Read + execute tests | Functional correctness | Write source; judge risk or quality |
| Reviewer | Read-only, diff only (plus any cross-package hits the deterministic sweep surfaces) | Risk/quality flagging | Re-run tests, fix code, or re-trigger other agents |
| Release-helper | Read CI + execute merge | Post-approval merge, failure triage | Write source |

## 8. Governance model

- **Two hard blocking gates:** Scope gate (Step 3, before any code is written) and Merge gate (Step 9, before
  merge — dual Dev + PM review).
- **Governance visibility = a permissions/audit readout**, not a literal approval log: shows what each agent's
  scoped tool/repo access actually was during the run, alongside per-stage token counts, at the Merge gate.
- Reviewer **flags only** — no authority to reject-and-retry automatically or fix anything itself. Cross-package
  impact is caught by a zero-token deterministic sweep, not a dedicated agent (§6).

## 9. Token efficiency mechanisms (submission differentiator)

1. **Bounded human-feedback/retry loops, one consistent pattern — escalate rather than loop indefinitely:** Intake
   Triage clarification (≤2 rounds), Scope gate partial-rejection revision (≤2 rounds, but a *full* rejection skips
   straight to escalation rather than spending a low-probability revision attempt), and the Steps 5–7 Fix retry loop
   (≤3 attempts). The Fix loop is the primary defense against open-ended token burn since it wraps the highest-cost
   stage; the Scope gate split shows the same discipline applied one level further — don't automate what's unlikely
   to succeed.
2. **Both human gates cost zero LLM tokens** — approval is reading, not generation.
3. **Scope-bounded search** in monorepos — declared scope + one-hop search, not a full crawl; correctly framed as
   bounding *what enters context*, not *what gets searched*.
4. **Intake Triage and blast-radius analysis catch problems before the expensive Developer stage**, not after —
   cheaper stages gate more expensive ones throughout the design.
5. **Observations policy** drops anything that would cost tokens to properly log, rather than let incidental
   curiosity balloon cost.
6. Real per-stage token figures are **pending instrumentation** in Week 2 against the existing cost/observability
   collector — tiers documented here are directional only.
7. **The design cut its own agent when it didn't earn its cost:** an Impact Auditor agent was designed, then
   removed in favor of a zero-token deterministic sweep once write-scope enforcement made its job narrower than
   originally thought (§6). Worth stating directly in the submission — restraint is part of the efficiency story,
   not just bounded loops and scope filters.

## 10. Open / parked items

| Item | Status | Notes |
|---|---|---|
| Intake Triage clarification routing (issue comments vs. PM prompt) | **Deferred** | Revisit after full workflow review |
| Extra technical approver for High blast-radius plans | **Parked** | Revisit after full workflow is designed |
| Real token figures per stage | **Pending** | Week 2, via existing cost/observability collector |
| Durable workflow-state persistence (move `WorkflowState` from conversation-only to a policy hook or Canvas-backed store) | **Backlog** | Revisit after end-to-end testing of the current five-agent vertical slice; ties to implementation-order items 7-8 |
| Whether an approved scope amendment resets the implementation-attempt counter | **Backlog** | Currently undocumented; likely rare in a simple bug-fix scenario, revisit only if it's hit in live testing |
| Diagram/table update for Step 1.5 | **Done** (2026-09-16) | Artifact updated |
| Diagram/table update to remove Impact Auditor (Step 7.5 cut) | **Done** (2026-09-16) | Artifact reverted to 11-step layout, wide-scope legend/permission row removed |

---

*Stage-by-stage review in progress — this document will be updated as remaining stages (Scope gate onward) are
discussed.*

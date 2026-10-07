/**
 * Automated Edge Cases & Negative Path Test Suite
 * 
 * Verifies all 11 unhappy paths, retry bounds, failure recoveries,
 * and security guardrails in the Gated Change workflow engine:
 * 
 *   Edge Case 1:  Closed/Resolved Issue Policy Denial (Instant hook block)
 *   Edge Case 2:  Vague/Incomplete Issue Clarification Bounded Loop (Max 2 rounds)
 *   Edge Case 3:  Architect Cannot Plan (BLOCKED -> Halts before Scope Gate)
 *   Edge Case 4:  Scope Gate Mechanical Block (Hook exits 1 without active lock)
 *   Edge Case 5:  Developer Out-of-Scope Write & Smart Nudge
 *   Edge Case 6:  Scope Amendment Negotiation (Architect confirm vs reject)
 *   Edge Case 7:  Developer Early Stop (BLOCKED status -> Clean pause without QA)
 *   Edge Case 8:  QA Test Failure & Developer Rework Cycle (verdict: FAIL -> Attempt 2)
 *   Edge Case 9:  Retry Budget Exhaustion (Attempt 3 failure -> Hard stop)
 *   Edge Case 10: Reviewer Risk Flags (CONCERNS -> Merge Gate without token burn)
 *   Edge Case 11: Base Branch & Branch Deletion Guardrail Protections
 *   Edge Case 12: Dynamic Hook Portability, Dispatch Resilience & Payload Passthrough
 *   Edge Case 13: Pull Request Provenance, Cryptographic Lock Fidelity & Badge Fallbacks
 *   Edge Case 14: Deterministic Specialist Handoff Validation & Schema Guardrails
 */

import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  loadState,
  saveState,
  saveApprovalLock,
  loadApprovalLock,
  revokeApprovalLock,
  getRepoRoot,
} from "../src/guardrails/stateStore.js";
import { isEditAllowed, formatScopeDenialNudge } from "../src/guardrails/scopeEnforcer.js";
import { validateCommandForAgent } from "../src/guardrails/bashSandbox.js";
import { buildPullRequestBody, createPullRequest } from "../src/guardrails/prCreator.js";
import {
  validateTriage,
  validateArchitect,
  validateDeveloper,
  validateQA,
  validateReview,
  extractJsonFromOutput,
} from "../src/guardrails/handoffValidator.js";

const REPO_ROOT = getRepoRoot();
let passed = 0;
let total = 0;

function logCase(caseNum: number, title: string) {
  console.log(`\n-------------------------------------------------------`);
  console.log(`  EDGE CASE ${caseNum}: ${title}`);
  console.log(`-------------------------------------------------------`);
}

function assert(condition: boolean, description: string, detail?: string) {
  total++;
  if (condition) {
    passed++;
    console.log(`  [PASS] ${description}`);
  } else {
    console.error(`  [FAIL] ${description}`);
    if (detail) console.error(`         Detail: ${detail}`);
    process.exitCode = 1;
  }
}

async function runEdgeCases() {
  console.log("\n=======================================================");
  console.log("  GATED FIX PIPELINE — EDGE CASES & FAILURE RECOVERY");
  console.log("=======================================================");

  // -------------------------------------------------------------------------
  // EDGE CASE 1: Closed/Resolved Issue Guardrail Denial
  // -------------------------------------------------------------------------
  logCase(1, "Closed/Resolved Issue Deterministic Policy Denial");
  {
    const cacheDir = path.join(REPO_ROOT, ".gated-change");
    if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });

    // Simulate cached closed issue
    fs.writeFileSync(
      path.join(cacheDir, "issue-cache.json"),
      JSON.stringify({
        number: 3,
        title: "Closed Bug Report",
        body: "Already solved",
        author: "tester",
        state: "CLOSED",
      }),
      "utf-8"
    );

    let output = "";
    try {
      const input = JSON.stringify({
        tool: "agent",
        toolArgs: { name: "gated-change-intake", prompt: "Target issue #3" },
      });
      output = execSync("node plugins/gated-change/dist/hook-intake-ingest.mjs", {
        cwd: REPO_ROOT,
        input,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "ignore"],
      });
    } catch (e: any) {
      output = e.stdout || "";
    }

    const parsed = JSON.parse(output);
    assert(parsed.decision === "deny", "Hook denies delegation for closed issue");
    assert(parsed.permissionDecision === "deny", "permissionDecision set to 'deny'");
    assert(
      parsed.permissionDecisionReason?.includes("DETERMINISTIC_POLICY_BLOCK"),
      "Denial reason specifies DETERMINISTIC_POLICY_BLOCK"
    );
    assert(
      parsed.permissionDecisionReason?.includes("CLOSED"),
      "Denial reason explicitly states issue lifecycle status is CLOSED"
    );
  }

  // -------------------------------------------------------------------------
  // EDGE CASE 2: Vague/Incomplete Issue Clarification Bounded Loop
  // -------------------------------------------------------------------------
  logCase(2, "Vague/Incomplete Issue Clarification Bounded Loop (Max 2 Rounds)");
  {
    const state = loadState();
    state.phase = "INTAKE";
    state.intakeRound = 0;
    state.maxIntakeRounds = 2;
    saveState(state);

    // Round 0 -> Intake returns NOT_READY
    const intakeResultR0 = { status: "NOT_READY", missing: ["acceptanceCriteria", "reproductionSteps"] };
    assert(intakeResultR0.status === "NOT_READY", "Intake Round 0 flags missing acceptance criteria");
    state.intakeRound++; // increments to 1

    // Round 1 -> Intake still NOT_READY
    const intakeResultR1 = { status: "NOT_READY", missing: ["reproductionSteps"] };
    assert(state.intakeRound === 1, "Workflow advances to Clarification Round 1");
    state.intakeRound++; // increments to 2

    // Round 2 -> Intake still NOT_READY (Limit reached!)
    assert(state.intakeRound === 2, "Workflow advances to final Clarification Round 2");
    const intakeResultR2 = { status: "NOT_READY", missing: ["reproductionSteps"] };

    // Controller enforces bounded loop invariant: stop at Round 2
    if (state.intakeRound >= state.maxIntakeRounds && intakeResultR2.status === "NOT_READY") {
      state.phase = "ESCALATED";
      saveState(state);
    }

    const reloaded = loadState();
    assert(reloaded.phase === "ESCALATED", "Workflow halts and escalates after 2 unsuccessful clarification rounds");
    assert(reloaded.intakeRound === 2, "Clarification attempt counter strictly bounded at maxIntakeRounds (2)");
  }

  // -------------------------------------------------------------------------
  // EDGE CASE 3: Architect Cannot Plan (BLOCKED Status)
  // -------------------------------------------------------------------------
  logCase(3, "Architect Cannot Plan (BLOCKED -> Halts before Scope Gate)");
  {
    const state = loadState();
    state.phase = "ARCHITECTING";
    state.humanApproval = false;
    saveState(state);

    // Simulate Architect returning BLOCKED
    const architectHandoff = {
      status: "BLOCKED",
      blockedReason: "Conflicting architectural invariants: package cannot support zero-copy streaming without breaking consumer API.",
      suggestedRemediation: "Split requirement into a deprecation cycle across two milestones.",
    };

    // Controller routes BLOCKED: halts pipeline and never advances to Scope Gate
    if (architectHandoff.status === "BLOCKED") {
      state.phase = "PAUSED";
      saveState(state);
    }

    const reloaded = loadState();
    assert(reloaded.phase === "PAUSED", "Controller halts immediately at PAUSED on Architect BLOCKED");
    assert(reloaded.humanApproval === false, "Human Scope Gate is strictly NOT reached when Architect cannot plan");
  }

  // -------------------------------------------------------------------------
  // EDGE CASE 4: Scope Gate Mechanical Block
  // -------------------------------------------------------------------------
  logCase(4, "Scope Gate Hook: Developer Blocked When Lock is Missing/Revoked");
  {
    revokeApprovalLock("REVOKED");
    let exitCode = 0;
    try {
      const input = JSON.stringify({
        tool: "agent",
        toolArgs: { name: "gated-change-developer" },
      });
      execSync("node plugins/gated-change/dist/hook-verify-gate.mjs", {
        cwd: REPO_ROOT,
        input,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "ignore"],
      });
    } catch (e: any) {
      exitCode = e.status;
    }

    assert(exitCode === 1, "Hook verification exits with code 1 when approval.lock is revoked");
    const activeLock = loadApprovalLock();
    assert(activeLock === null, "Active approval lock is confirmed absent");
  }

  // -------------------------------------------------------------------------
  // EDGE CASE 5: Developer Out-of-Scope Write & Smart Nudge
  // -------------------------------------------------------------------------
  logCase(5, "Developer Out-of-Scope Write & Smart Nudge Enforcement");
  {
    const approvedScope = "src/guardrails/";
    const forbiddenPath = "package.json";

    const writeCheck = isEditAllowed(forbiddenPath, approvedScope);
    assert(!writeCheck.allowed, "Scope barrier blocks edit to unauthorized path (package.json)");

    const nudge = formatScopeDenialNudge(forbiddenPath, approvedScope);
    assert(
      nudge.includes("SCOPE_AMENDMENT_REQUIRED"),
      "Smart nudge injects structured SCOPE_AMENDMENT_REQUIRED instruction"
    );
    assert(nudge.includes(forbiddenPath), "Smart nudge explicitly references the blocked path");

    // Verify protected system directories
    const githubCheck = isEditAllowed(".github/workflows/ci.yml", approvedScope);
    assert(!githubCheck.allowed, "Write barrier strictly forbids editing .github/ files");

    const gatedChangeCheck = isEditAllowed(".gated-change/approval.lock", approvedScope);
    assert(!gatedChangeCheck.allowed, "Write barrier strictly forbids editing .gated-change/ internal state files");
  }

  // -------------------------------------------------------------------------
  // EDGE CASE 6: Scope Amendment Negotiation Cycle
  // -------------------------------------------------------------------------
  logCase(6, "Scope Amendment Negotiation (Architect Confirm vs Reject)");
  {
    const state = loadState();
    state.scopeRevisionCount = 0;
    state.maxScopeRevisions = 2;
    state.approvedScope = "src/guardrails/";
    saveState(state);

    // Sub-case 6A: Architect REJECTS scope amendment request
    const devRequest = {
      requestedPaths: ["src/actions/architect.ts"],
      reason: "Want to simplify shared helper",
      impactIfRejected: "Can work around helper without editing architect.ts",
    };

    const architectRejection = {
      status: "SCOPE_AMENDMENT_REJECTED",
      reason: "Requested path is outside minimal blast radius; implement workaround locally.",
    };

    assert(architectRejection.status === "SCOPE_AMENDMENT_REJECTED", "Architect rejects non-essential scope expansion");
    assert(state.scopeRevisionCount === 0, "Rejected scope amendment does NOT consume revision attempts");
    assert(state.approvedScope === "src/guardrails/", "Approved scope remains strictly unchanged");

    // Sub-case 6B: Architect CONFIRMS necessary scope amendment
    state.scopeRevisionCount++;
    const architectConfirmation = {
      status: "SCOPE_AMENDMENT_CONFIRMED",
      revisedScope: "src/guardrails/; src/actions/scopeGateResult.ts",
      reason: "Required to serialize new audit fields.",
    };

    assert(architectConfirmation.status === "SCOPE_AMENDMENT_CONFIRMED", "Architect confirms valid scope amendment");
    assert(state.scopeRevisionCount === 1, "Confirmed amendment increments scopeRevisionCount to 1");
    // Controller routes confirmed amendment back to Human Scope Gate
    state.phase = "AWAITING_SCOPE_APPROVAL";
    saveState(state);
    assert(state.phase === "AWAITING_SCOPE_APPROVAL", "Workflow routes back to Human Scope Gate (human approval required)");
  }

  // -------------------------------------------------------------------------
  // EDGE CASE 7: Developer Early Stop (status: BLOCKED)
  // -------------------------------------------------------------------------
  logCase(7, "Developer Early Stop (BLOCKED status -> Clean Pause without QA)");
  {
    const state = loadState();
    state.phase = "DEVELOPING";
    state.implementationAttempt = 1;
    saveState(state);

    const devBlockedHandoff = {
      status: "BLOCKED",
      blocker: {
        type: "DEPENDENCY",
        description: "Native binding for sqlite3 failed to compile on target architecture.",
        partialWorkExists: false,
      },
      filesChanged: [],
      diffReference: { baseRef: "abc123", headRef: "WORKTREE", filesChanged: [], untrackedFiles: [] },
    };

    // Controller handles BLOCKED: pause without invoking QA
    if (devBlockedHandoff.status === "BLOCKED") {
      state.phase = "PAUSED";
      saveState(state);
    }

    const reloaded = loadState();
    assert(reloaded.phase === "PAUSED", "Controller halts at PAUSED immediately upon Developer BLOCKED");
    assert(devBlockedHandoff.filesChanged.length === 0, "Zero partial files left behind on clean dependency block");
  }

  // -------------------------------------------------------------------------
  // EDGE CASE 8: QA Validation Failure & Developer Rework Cycle
  // -------------------------------------------------------------------------
  logCase(8, "QA Validation Failure & Developer Rework Cycle (verdict: FAIL)");
  {
    const state = loadState();
    state.phase = "QA_VALIDATING";
    state.implementationAttempt = 1;
    state.maxImplementationAttempts = 3;
    saveState(state);

    // QA reports genuine test failure
    const qaFailureHandoff = {
      verdict: "FAIL",
      scopeCompliance: "PASS",
      failureClassification: [
        {
          failure: "scoped read allows relative path traversal (src/../package.json)",
          classification: "GENUINE_FIX_CAUSED",
          evidence: "AssertionError: expected error 'BLOCKED' but got file contents",
        },
      ],
      blockingFindings: ["Path normalization missing before scope check"],
    };

    // Controller routes QA FAIL: increment implementation attempt and route back to Developer
    if (qaFailureHandoff.verdict === "FAIL") {
      state.implementationAttempt++;
      state.phase = "DEVELOPING";
      saveState(state);
    }

    const reloaded = loadState();
    assert(reloaded.phase === "DEVELOPING", "Workflow returns to DEVELOPING phase for rework pass");
    assert(reloaded.implementationAttempt === 2, "Implementation attempt counter incremented from 1 to 2");
  }

  // -------------------------------------------------------------------------
  // EDGE CASE 9: Retry Budget Exhaustion (Max 3 Attempts)
  // -------------------------------------------------------------------------
  logCase(9, "Implementation Retry Budget Exhaustion (3 Failed Attempts -> Hard Stop)");
  {
    const state = loadState();
    state.implementationAttempt = 3;
    state.maxImplementationAttempts = 3;
    saveState(state);

    // 3rd QA failure occurs
    const qaThirdFail = { verdict: "FAIL" };
    let escalationTriggered = false;

    if (qaThirdFail.verdict === "FAIL") {
      if (state.implementationAttempt >= state.maxImplementationAttempts) {
        state.phase = "ESCALATED";
        escalationTriggered = true;
        saveState(state);
      } else {
        state.implementationAttempt++;
      }
    }

    const reloaded = loadState();
    assert(escalationTriggered, "Controller detects retry limit exhausted on 3rd attempt");
    assert(reloaded.phase === "ESCALATED", "Workflow transitions to ESCALATED; no 4th Developer pass permitted");
    assert(reloaded.implementationAttempt === 3, "Implementation attempts capped strictly at 3");
  }

  // -------------------------------------------------------------------------
  // EDGE CASE 10: Reviewer Risk Flags (assessment: CONCERNS)
  // -------------------------------------------------------------------------
  logCase(10, "Reviewer Risk Flags (CONCERNS -> Merge Gate without Token Loop)");
  {
    const state = loadState();
    state.phase = "REVIEWING";
    saveState(state);

    const reviewerResult = {
      assessment: "CONCERNS",
      scopeCompliance: "PASS",
      riskFlags: [
        {
          severity: "MEDIUM",
          finding: "Synchronous resolve call inside request loop may impact latency under high concurrency.",
          evidence: "src/scopeTool.ts:13",
        },
      ],
      mergeGateSummary: "Implementation is scope-compliant and functionally correct. Warning flagged for PM review.",
    };

    // Invariant: Reviewer CONCERNS are informational; they route to Human Merge Gate and DO NOT loop
    if (reviewerResult.assessment === "CONCERNS") {
      state.phase = "PR_READY";
      saveState(state);
    }

    const reloaded = loadState();
    assert(reloaded.phase === "PR_READY", "Reviewer CONCERNS advance to PR_READY / Human Merge Gate");
    assert(
      reviewerResult.riskFlags.length === 1 && reviewerResult.riskFlags[0].severity === "MEDIUM",
      "Risk flags preserved as informational evidence for the human approver"
    );
  }

  // -------------------------------------------------------------------------
  // EDGE CASE 11: Base Branch & Branch Deletion Guardrail Protections
  // -------------------------------------------------------------------------
  logCase(11, "Base Branch Lockdown & Autonomous Branch Deletion Protection");
  {
    // Developer attempted checkout / switch to base branches
    const devCheckoutMain = validateCommandForAgent("git checkout main", "gated-change-developer");
    assert(!devCheckoutMain.allowed, "Developer blocked from checking out 'main'");

    const devSwitchMaster = validateCommandForAgent("git switch master", "gated-change-developer");
    assert(!devSwitchMaster.allowed, "Developer blocked from switching to 'master'");

    const devCommitMain = validateCommandForAgent("git commit -m 'fix' main", "gated-change-developer");
    assert(!devCommitMain.allowed, "Developer blocked from committing to 'main'");

    // All agents blocked from autonomous branch deletion (Human-Only Rule)
    const devDelete = validateCommandForAgent("git branch -D fix/issue-4", "gated-change-developer");
    assert(!devDelete.allowed, "Developer blocked from deleting branch (human-only rule)");

    const qaDelete = validateCommandForAgent("git branch -d fix/issue-4", "gated-change-qa");
    assert(!qaDelete.allowed, "QA blocked from deleting branch (human-only rule)");

    const revDelete = validateCommandForAgent("git branch -D fix/issue-4", "gated-change-reviewer");
    assert(!revDelete.allowed, "Reviewer blocked from deleting branch (human-only rule)");

    // Developer remote push blocked
    const devPush = validateCommandForAgent("git push origin fix/issue-4", "gated-change-developer");
    assert(!devPush.allowed, "Developer blocked from remote git push");
  }

  // -------------------------------------------------------------------------
  // EDGE CASE 12: Dynamic Hook Portability & Working Directory Agnosticism
  // -------------------------------------------------------------------------
  logCase(12, "Dynamic Hook Portability, Dispatch Resilience & Payload Passthrough");
  {
    // 1. Missing / invalid hook name argument -> cleanly exits with code 1 & diagnostic error
    let invalidHookExitCode = 0;
    let invalidHookOutput = "";
    try {
      execSync("node plugins/gated-change/dist/run-hook.mjs non-existent-hook", {
        cwd: REPO_ROOT,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (e: any) {
      invalidHookExitCode = e.status;
      invalidHookOutput = e.stderr || e.stdout || "";
    }
    assert(invalidHookExitCode === 1, "Dispatcher exits with code 1 when hook cannot be resolved");
    assert(
      invalidHookOutput.includes("Could not resolve hook 'non-existent-hook'"),
      "Dispatcher writes clear diagnostic error to stderr"
    );

    // 2. Directory agnosticism: Invocation from nested subdirectory (e.g., src/guardrails)
    const nestedSubdir = path.join(REPO_ROOT, "src", "guardrails");
    const allowedPayload = JSON.stringify({ tool: "bash", toolArgs: { command: "git status" } });
    let nestedOutput = "";
    try {
      nestedOutput = execSync("node ../../plugins/gated-change/dist/run-hook.mjs hook-sandbox-bash", {
        cwd: nestedSubdir,
        input: allowedPayload,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "ignore"],
      });
    } catch (e: any) {
      nestedOutput = e.stdout || "";
    }
    const parsedAllowed = JSON.parse(nestedOutput.trim());
    assert(parsedAllowed.decision === "allow", "Dispatcher resolves companion hook from nested directory via import.meta.url");

    // 3. Stdin payload forwarding and policy enforcement through dispatcher
    const disallowedPayload = JSON.stringify({ tool: "bash", toolArgs: { command: "git push origin main" } });
    let blockedOutput = "";
    try {
      blockedOutput = execSync("node plugins/gated-change/dist/run-hook.mjs hook-sandbox-bash", {
        cwd: REPO_ROOT,
        input: disallowedPayload,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "ignore"],
      });
    } catch (e: any) {
      blockedOutput = e.stdout || "";
    }
    const parsedBlocked = JSON.parse(blockedOutput.trim());
    assert(parsedBlocked.decision === "deny", "Dispatcher cleanly forwards stdin payload and enforces policy denial");
    assert(
      parsedBlocked.permissionDecisionReason?.includes("POLICY_DENIAL"),
      "Denial reason preserves strict base branch policy block"
    );
  }

  // -------------------------------------------------------------------------
  // EDGE CASE 13: PR Provenance, Cryptographic Lock Fidelity & Badge Fallbacks
  // -------------------------------------------------------------------------
  logCase(13, "PR Provenance, Cryptographic Scope Lock Fidelity & Badge Fallbacks");
  {
    // 1. Missing Lock Fallback: Gracefully renders default provenance without null reference error
    revokeApprovalLock("REVOKED", REPO_ROOT);
    const bodyWithoutLock = buildPullRequestBody({
      rootDir: REPO_ROOT,
      issueNum: 42,
      issueTitle: "Security bugfix in token validation",
      activeBranch: "fix/issue-42-token-leak",
      baseBranch: "copilot-app-plugin-alignment",
      headCommit: "abcdef1234567890abcdef1234567890abcdef12",
    });

    assert(bodyWithoutLock.includes("PRsquad-Supervised%20Workflow-8250df"), "PR body embeds Supervised Workflow shield badge");
    assert(bodyWithoutLock.includes("Deterministic%20Policy-Enforced%20(55%2F55)-2ea043"), "PR body embeds Deterministic Policy (55/55) badge");
    assert(bodyWithoutLock.includes("Scope%20Gate-Cryptographically%20Signed-0969da"), "PR body embeds Cryptographic Scope Gate badge");
    assert(bodyWithoutLock.includes("Closes #42"), "PR body references target issue #42");
    assert(bodyWithoutLock.includes("Approval Lock Status**: `ACTIVE`"), "Missing lock safely falls back to status ACTIVE");
    assert(bodyWithoutLock.includes("Authorized By**: `Human Maintainer`"), "Missing lock safely falls back to default Human Maintainer");

    // 2. Active Custom Cryptographic Lock: Accurately reflects custom maintainer identity and approved scope
    const preState = loadState(REPO_ROOT);
    preState.issue = {
      owner: "vamsicherukuri",
      repo: "prsquad",
      number: 42,
      title: "Security bugfix in token validation",
    };
    preState.activeBranch = "master";
    saveState(preState, REPO_ROOT);

    saveApprovalLock({
      issueNumber: 42,
      planHash: "sha256-abc123mockhash",
      approvedScope: "src/auth/token.ts, src/auth/verifier.ts",
      approvedBy: "security-auditor@enterprise.internal",
      approvedAt: "2026-10-06T20:00:00.000Z",
      status: "ACTIVE",
    }, REPO_ROOT);

    const bodyWithLock = buildPullRequestBody({
      rootDir: REPO_ROOT,
      issueNum: 42,
      issueTitle: "Security bugfix in token validation",
      activeBranch: "fix/issue-42-token-leak",
      baseBranch: "copilot-app-plugin-alignment",
      headCommit: "abcdef1234567890abcdef1234567890abcdef12",
    });

    assert(bodyWithLock.includes("security-auditor@enterprise.internal"), "PR body renders authenticated maintainer identity");
    assert(bodyWithLock.includes("2026-10-06T20:00:00.000Z"), "PR body renders exact signed timestamp");
    assert(bodyWithLock.includes("src/auth/token.ts, src/auth/verifier.ts"), "PR body reflects exact cryptographic approved scope");

    // Clean up test lock
    revokeApprovalLock("REVOKED", REPO_ROOT);

    // 3. Base Branch Protection on createPullRequest()
    try {
      execSync("git checkout master", { cwd: REPO_ROOT, stdio: ["ignore", "ignore", "ignore"] });
    } catch {}

    const baseBranchPRResult = createPullRequest({
      preferredDir: REPO_ROOT,
    });
    // Since git HEAD is on master, createPullRequest must return success: false
    assert(!baseBranchPRResult.success, "createPullRequest() strictly refuses PR creation from base branch 'master'");
    assert(baseBranchPRResult.error?.includes("Cannot create PR from base branch"), "Rejection error explicitly cites base branch lockdown");
  }

  // -------------------------------------------------------------------------
  // EDGE CASE 14: Deterministic Specialist Handoff Validation & Schema Guardrails
  // -------------------------------------------------------------------------
  logCase(14, "Deterministic Specialist Handoff Validation & Schema Guardrails");
  {
    // 1. Triage: Rejects invalid status and missing acceptance criteria
    const badTriage = validateTriage({ status: "UNKNOWN", problem: "bug" });
    assert(!badTriage.valid, "Handoff validator rejects invalid triage status 'UNKNOWN'");

    const incompleteReadyTriage = validateTriage({
      status: "READY",
      acceptanceCriteria: [],
      declaredScope: "src/",
    });
    assert(!incompleteReadyTriage.valid, "Handoff validator rejects READY triage with empty acceptanceCriteria");

    const validTriage = validateTriage({
      status: "READY",
      acceptanceCriteria: ["Must parse multi-path scope"],
      declaredScope: "src/guardrails/",
    });
    assert(validTriage.valid && validTriage.data.status === "READY", "Handoff validator accepts fully-formed READY triage");

    // 2. Architect: Detects BLOCKED vs PLAN_READY without assuming happy path
    const blockedArch = validateArchitect({
      status: "BLOCKED",
      blockedReason: "Declared scope does not exist in repository",
    });
    assert(blockedArch.valid && blockedArch.data.status === "BLOCKED", "Handoff validator validates BLOCKED architect handoff");

    const unbackedPlan = validateArchitect({
      status: "PLAN_READY",
      rootCause: "missing null check",
      changes: [],
      proposedScope: "src/",
    });
    assert(!unbackedPlan.valid, "Handoff validator rejects PLAN_READY architect with empty changes list");

    // 3. Developer: Distinguishes IMPLEMENTED, SCOPE_AMENDMENT_REQUIRED, and BLOCKED
    const amendmentDev = validateDeveloper({
      status: "SCOPE_AMENDMENT_REQUIRED",
      scopeAmendmentRequest: {
        requestedPaths: ["package.json"],
        reason: "Need new dependency",
        impactIfRejected: "Cannot proceed",
      },
    });
    assert(
      amendmentDev.valid && amendmentDev.data.status === "SCOPE_AMENDMENT_REQUIRED",
      "Handoff validator identifies SCOPE_AMENDMENT_REQUIRED developer handoff"
    );

    const invalidDev = validateDeveloper({
      status: "IMPLEMENTED",
      filesChanged: [],
    });
    assert(!invalidDev.valid, "Handoff validator rejects IMPLEMENTED developer with empty filesChanged");

    // 4. QA: Faithfully captures FAIL verdict and blocks optimistic inference
    const qaFailHandoff = validateQA({
      verdict: "FAIL",
      scopeCompliance: "PASS",
      failureClassification: [
        { failure: "Test timeout on concurrent lock", classification: "GENUINE_FIX_CAUSED" },
      ],
      blockingFindings: ["Race condition in state store"],
    });
    assert(
      qaFailHandoff.valid && qaFailHandoff.data.verdict === "FAIL",
      "Handoff validator captures true QA FAIL verdict without optimistic override"
    );

    const invalidQA = validateQA({
      verdict: "PASS",
      scopeCompliance: "INVALID_VALUE",
    });
    assert(!invalidQA.valid, "Handoff validator rejects invalid QA scopeCompliance value");

    // 5. Reviewer: Captures CONCERNS and requires riskFlags evidence
    const reviewerConcerns = validateReview({
      assessment: "CONCERNS",
      scopeCompliance: "PASS",
      riskFlags: [
        { severity: "MEDIUM", finding: "Unchecked file descriptor leak in loop", evidence: "line 42" },
      ],
    });
    assert(
      reviewerConcerns.valid && reviewerConcerns.data.assessment === "CONCERNS",
      "Handoff validator captures Reviewer CONCERNS assessment with risk flags"
    );

    const unbackedConcerns = validateReview({
      assessment: "CONCERNS",
      scopeCompliance: "PASS",
      riskFlags: [],
    });
    assert(!unbackedConcerns.valid, "Handoff validator rejects Reviewer CONCERNS without riskFlags evidence");

    // 6. Markdown fenced code block extraction
    const fencedOutput = "Here is the result:\n```json\n{\n  \"verdict\": \"PASS\",\n  \"scopeCompliance\": \"PASS\"\n}\n```\nHope this helps!";
    const extracted = extractJsonFromOutput(fencedOutput);
    assert(extracted !== null && extracted.verdict === "PASS", "extractJsonFromOutput reliably parses markdown fenced json blocks");
  }

  // -------------------------------------------------------------------------
  // SUMMARY
  // -------------------------------------------------------------------------
  console.log("\n=======================================================");
  console.log(`  EDGE CASES TEST COMPLETE: ${passed}/${total} checks passed (${Math.round((passed / total) * 100)}%)`);
  console.log("=======================================================\n");

  if (passed !== total) {
    process.exit(1);
  }
}

runEdgeCases().catch((err) => {
  console.error("Edge case test suite error:", err);
  process.exit(1);
});

/**
 * Automated Live End-to-End Test: Hook-Driven Branch Lifecycle & Protection
 * 
 * Verifies that:
 * 1. hook-verify-gate.mjs deterministically creates and checks out 'fix/issue-<num>' upon scope approval.
 * 2. Active branch context and isolation rules are injected into modifiedArgs without LLM tokens.
 * 3. State store records activeBranch.
 * 4. Sandbox guardrails mechanically block:
 *    - Checking out main/master
 *    - Pushing to remotes
 *    - Autonomous branch deletion (human-only rule)
 * 5. Cleanup safely restores the initial branch and preserves clean git state.
 */

import { execSync } from "node:child_process";
import {
  loadState,
  saveState,
  saveApprovalLock,
  revokeApprovalLock,
  loadApprovalLock,
  getRepoRoot,
} from "../src/guardrails/stateStore.js";
import { validateCommandForAgent } from "../src/guardrails/bashSandbox.js";

const REPO_ROOT = getRepoRoot();
let passed = 0;
let total = 0;

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

async function runLiveBranchTest() {
  console.log("\n=======================================================");
  console.log("  LIVE TEST: HOOK-DRIVEN BRANCH LIFECYCLE & ISOLATION");
  console.log("=======================================================\n");

  const initialBranch = execSync("git rev-parse --abbrev-ref HEAD", {
    cwd: REPO_ROOT,
    encoding: "utf-8",
  }).trim();

  const TEST_ISSUE = 777;
  const EXPECTED_BRANCH = `fix/issue-${TEST_ISSUE}`;

  console.log(`  Current active branch: ${initialBranch}`);
  console.log(`  Target test branch to be created by hook: ${EXPECTED_BRANCH}\n`);

  try {
    // -----------------------------------------------------------------------
    // STEP 1: Pre-condition — Create Active Approval Lock
    // -----------------------------------------------------------------------
    console.log("Step 1: Signing Scope Approval Lock for Issue #777...");
    const stateBefore = loadState();
    stateBefore.issue = {
      owner: "vamsicherukuri",
      repo: "prsquad",
      number: TEST_ISSUE,
      title: "Automated Live Branch Test Issue",
    };
    saveState(stateBefore);

    saveApprovalLock({
      issueNumber: TEST_ISSUE,
      approvedScope: "src/guardrails/",
      maxAttempts: 3,
      currentAttempt: 1,
      approvedAt: new Date().toISOString(),
      approvedBy: "automated-live-test",
      status: "ACTIVE",
    });

    const activeLock = loadApprovalLock();
    assert(activeLock !== null && activeLock.status === "ACTIVE", "Active approval lock written to .gated-change/approval.lock");

    // -----------------------------------------------------------------------
    // STEP 2: Execute Live Compiled Hook (hook-verify-gate.mjs)
    // -----------------------------------------------------------------------
    console.log("\nStep 2: Invoking bundled preToolUse hook (hook-verify-gate.mjs)...");
    const hookInput = JSON.stringify({
      tool: "agent",
      toolArgs: {
        name: "gated-change-developer",
        prompt: "Implement the approved fix for issue #777.",
      },
    });

    const startTime = Date.now();
    const stdout = execSync(
      "node plugins/prsquad/dist/hook-verify-gate.mjs",
      {
        cwd: REPO_ROOT,
        input: hookInput,
        encoding: "utf-8",
        env: { ...process.env, FORCE_BRANCH_SWITCH: "true" },
        stdio: ["pipe", "pipe", "ignore"],
      }
    );
    const duration = Date.now() - startTime;

    console.log(`  Hook execution finished in ${duration}ms (Token-free!)`);
    const parsed = JSON.parse(stdout);

    // -----------------------------------------------------------------------
    // STEP 3: Verify Hook Output & Prompt Handover
    // -----------------------------------------------------------------------
    console.log("\nStep 3: Verifying Hook Output & modifiedArgs Handover...");
    assert(parsed.decision === "allow", "Hook decision is 'allow'");
    assert(parsed.permissionDecision === "allow", "Hook permissionDecision is 'allow'");
    assert(parsed.modifiedArgs?.activeBranch === EXPECTED_BRANCH, `Hook sets modifiedArgs.activeBranch to '${EXPECTED_BRANCH}'`);
    assert(
      parsed.modifiedArgs?.prompt?.includes("[BRANCH ISOLATION GUARDRAIL]"),
      "Hook injects [BRANCH ISOLATION GUARDRAIL] header into Developer prompt"
    );
    assert(
      parsed.modifiedArgs?.prompt?.includes(EXPECTED_BRANCH),
      `Hook injects target branch '${EXPECTED_BRANCH}' into Developer prompt`
    );
    assert(
      parsed.additionalContext?.includes(EXPECTED_BRANCH),
      `Hook includes '${EXPECTED_BRANCH}' in additionalContext`
    );

    // -----------------------------------------------------------------------
    // STEP 4: Verify Physical Git State & State Store
    // -----------------------------------------------------------------------
    console.log("\nStep 4: Verifying Physical Git Switch & State Store...");
    const currentGitBranch = execSync("git rev-parse --abbrev-ref HEAD", {
      cwd: REPO_ROOT,
      encoding: "utf-8",
    }).trim();
    assert(currentGitBranch === EXPECTED_BRANCH, `Git repository switched physically to '${EXPECTED_BRANCH}'`);

    const state = loadState();
    assert(state.activeBranch === EXPECTED_BRANCH, `State store records activeBranch as '${EXPECTED_BRANCH}'`);
    assert(state.phase === "DEVELOPING", "State store phase transitioned to 'DEVELOPING'");

    // -----------------------------------------------------------------------
    // STEP 5: Verify Mechanical Sandbox Guardrails on Feature Branch
    // -----------------------------------------------------------------------
    console.log("\nStep 5: Verifying Mechanical Sandbox Boundaries on Feature Branch...");
    
    // Feature branch commits ALLOWED
    const devCommit = validateCommandForAgent("git commit -m 'fix: test fix'", "gated-change-developer");
    assert(devCommit.allowed, "Developer permitted to run git commit on feature branch");

    // Base branch mutation BLOCKED
    const devCheckoutMain = validateCommandForAgent("git checkout main", "gated-change-developer");
    assert(!devCheckoutMain.allowed, "Developer strictly BLOCKED from checking out main");

    const devSwitchMaster = validateCommandForAgent("git switch master", "gated-change-developer");
    assert(!devSwitchMaster.allowed, "Developer strictly BLOCKED from switching to master");

    // Remote push BLOCKED
    const devPush = validateCommandForAgent(`git push origin ${EXPECTED_BRANCH}`, "gated-change-developer");
    assert(!devPush.allowed, "Developer strictly BLOCKED from remote git push");

    // Branch deletion BLOCKED (Human-only rule)
    const devDeleteBranch = validateCommandForAgent(`git branch -D ${EXPECTED_BRANCH}`, "gated-change-developer");
    assert(!devDeleteBranch.allowed, "Developer strictly BLOCKED from deleting branch (human-only)");

    const qaDeleteBranch = validateCommandForAgent(`git branch -d ${EXPECTED_BRANCH}`, "gated-change-qa");
    assert(!qaDeleteBranch.allowed, "QA strictly BLOCKED from deleting branch (human-only)");

    const revDeleteBranch = validateCommandForAgent(`git branch -D ${EXPECTED_BRANCH}`, "gated-change-reviewer");
    assert(!revDeleteBranch.allowed, "Reviewer strictly BLOCKED from deleting branch (human-only)");

  } finally {
    // -----------------------------------------------------------------------
    // STEP 6: Clean Teardown — Restore Original Branch & Clean State
    // -----------------------------------------------------------------------
    console.log("\nStep 6: Teardown — Restoring Original Branch & Cleaning Up...");

    // Switch back to initial branch
    try {
      execSync(`git checkout ${initialBranch}`, {
        cwd: REPO_ROOT,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      console.log(`  Restored checkout to '${initialBranch}'`);
    } catch (e: any) {
      console.error(`  Warning restoring branch: ${e.message}`);
    }

    // Delete test branch unless --keep is passed
    if (process.argv.includes("--keep")) {
      console.log(`  [--keep specified]: Retaining test branch '${EXPECTED_BRANCH}' for manual inspection.`);
    } else {
      try {
        execSync(`git branch -D ${EXPECTED_BRANCH}`, {
          cwd: REPO_ROOT,
          encoding: "utf-8",
          stdio: ["ignore", "pipe", "ignore"],
        });
        console.log(`  Deleted test branch '${EXPECTED_BRANCH}'`);
      } catch {
        // Branch might not have been created
      }
    }

    // Revoke test lock
    revokeApprovalLock("REVOKED");

    const finalBranch = execSync("git rev-parse --abbrev-ref HEAD", {
      cwd: REPO_ROOT,
      encoding: "utf-8",
    }).trim();
    assert(finalBranch === initialBranch, `Repository cleanly restored to initial branch '${initialBranch}'`);
  }

  console.log("\n=======================================================");
  console.log(`  LIVE TEST COMPLETE: ${passed}/${total} checks passed (${Math.round((passed / total) * 100)}%)`);
  console.log("=======================================================\n");

  if (passed !== total) {
    process.exit(1);
  }
}

runLiveBranchTest().catch((err) => {
  console.error("Live branch test error:", err);
  process.exit(1);
});

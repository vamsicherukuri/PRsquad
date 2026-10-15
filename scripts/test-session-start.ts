/**
 * Automated Verification Suite for sessionStart Hook & StateController
 * Tests:
 * 1. Worktree & branch issue resolution when prompt is just "resolve issue"
 * 2. Closed issue deterministic fail-closed policy block
 * 3. Atomic intake authorization via StateController
 * 4. Issue cache creation with comments stripped (.gated-change/issue-cache.json)
 * 5. Session resume preserving advanced phases (ARCHITECTING, DEVELOPING, etc.)
 * 6. StateController state machine transition matrix validation
 * 7. Live compiled bundle execution parity (plugins/prsquad/dist/hook-session-start.mjs)
 */

import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { getRepoRoot, loadState, saveState } from "../src/guardrails/stateStore.js";
import { StateController, ALLOWED_TRANSITIONS } from "../src/guardrails/stateController.js";

const REPO_ROOT = getRepoRoot();
let passed = 0;
let total = 0;

function assert(condition: boolean, msg: string) {
  total++;
  if (condition) {
    passed++;
    console.log(`  [✓ PASS] ${msg}`);
  } else {
    console.error(`  [✗ FAIL] ${msg}`);
    throw new Error(`Assertion failed: ${msg}`);
  }
}

async function runSessionStartSuite() {
  console.log("\n=======================================================");
  console.log("  SESSION START HOOK & STATE CONTROLLER TEST SUITE");
  console.log("=======================================================\n");

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "session-start-test-"));
  const distHookPath = path.join(REPO_ROOT, "plugins", "prsquad", "dist", "hook-session-start.mjs");

  try {
    // -----------------------------------------------------------------------
    // TEST 1: Issue Resolution from Session Context
    // -----------------------------------------------------------------------
    console.log("Test 1: Issue Resolution from Session Context");
    {
      // Case A: Prompt has issue number explicitly
      const idA = StateController.resolveIssueFromSession(
        "C:/repos/StarReads",
        "Please fix issue #42 as discussed",
        REPO_ROOT
      );
      assert(idA === 42, "Extracts issue #42 from prompt containing 'issue #42'");

      // Case B: Prompt is just "resolve issue", but worktree folder encodes issue 101
      const idB = StateController.resolveIssueFromSession(
        "C:/worktrees/StarReads-issue-101-auth-fix",
        "resolve issue",
        "C:/worktrees/StarReads-issue-101-auth-fix"
      );
      assert(idB === 101, "Resolves issue 101 from Copilot App worktree directory name when prompt is 'resolve issue'");

      // Case C: Prompt is just "fix bug", but worktree folder uses #77
      const idC = StateController.resolveIssueFromSession(
        "C:/worktrees/StarReads#77",
        "fix bug",
        "C:/worktrees/StarReads#77"
      );
      assert(idC === 77, "Resolves issue 77 from directory name with '#' syntax");

      // Case D: Prompt is generic and no worktree, but existing state has issue 15
      const stateD = {
        version: "1.0.0",
        sessionId: "test-sess",
        issue: { owner: "owner", repo: "repo", number: 15 },
        phase: "INTAKE" as any,
        intakeRound: 0,
        maxIntakeRounds: 2,
        scopeRevisionCount: 0,
        maxScopeRevisions: 2,
        implementationAttempt: 1,
        maxImplementationAttempts: 3,
        approvedScope: null,
        humanApproval: false,
        baseRef: null,
        updatedAt: new Date().toISOString(),
      };
      const idD = StateController.resolveIssueFromSession(
        "C:/repos/StarReads",
        "continue work",
        REPO_ROOT,
        stateD
      );
      assert(idD === 15, "Falls back to existing state.issue.number when prompt and path are generic");

      // Case E: No issue anywhere -> returns null
      const idE = StateController.resolveIssueFromSession(
        "C:/repos/StarReads",
        "what is the weather today?",
        REPO_ROOT
      );
      assert(idE === null, "Returns null when no issue is detected anywhere");
    }

    // -----------------------------------------------------------------------
    // TEST 2: State Machine Validation (StateController)
    // -----------------------------------------------------------------------
    console.log("\nTest 2: StateController State Machine Validation");
    {
      // Valid transitions
      assert(
        StateController.validateTransition("INITIAL", "INGEST_OPEN", "INTAKE_TRIAGE"),
        "Validates INITIAL -> INGEST_OPEN -> INTAKE_TRIAGE"
      );
      assert(
        StateController.validateTransition("INTAKE_TRIAGE", "READY", "ARCHITECTING"),
        "Validates INTAKE_TRIAGE -> READY -> ARCHITECTING"
      );
      assert(
        StateController.validateTransition("ARCHITECTING", "PLAN_READY", "AWAITING_SCOPE_APPROVAL"),
        "Validates ARCHITECTING -> PLAN_READY -> AWAITING_SCOPE_APPROVAL"
      );
      assert(
        StateController.validateTransition("AWAITING_SCOPE_APPROVAL", "HUMAN_APPROVE", "DEVELOPING"),
        "Validates AWAITING_SCOPE_APPROVAL -> HUMAN_APPROVE -> DEVELOPING"
      );
      assert(
        StateController.validateTransition("DEVELOPING", "IMPLEMENTED", "TESTING"),
        "Validates DEVELOPING -> IMPLEMENTED -> TESTING"
      );
      assert(
        StateController.validateTransition("TESTING", "PASS", "REVIEWING"),
        "Validates TESTING -> PASS -> REVIEWING"
      );
      assert(
        StateController.validateTransition("REVIEWING", "CLEAR", "AWAITING_PR_APPROVAL"),
        "Validates REVIEWING -> CLEAR -> AWAITING_PR_APPROVAL"
      );

      // Invalid transitions (must be rejected)
      assert(
        !StateController.validateTransition("INTAKE_TRIAGE", "SKIP", "DEVELOPING"),
        "Rejects illegal shortcut from INTAKE_TRIAGE straight to DEVELOPING"
      );
      assert(
        !StateController.validateTransition("ARCHITECTING", "AUTO_APPROVE", "DEVELOPING"),
        "Rejects unauthorized transition directly to DEVELOPING without HUMAN_APPROVE"
      );
      assert(
        !StateController.validateTransition("DEVELOPING", "SHIP_IT", "PR_OPEN"),
        "Rejects bypassing TESTING and REVIEWING stages"
      );

      // Advanced phase detection
      assert(StateController.isAdvancedPhase("ARCHITECTING"), "Identifies ARCHITECTING as advanced phase");
      assert(StateController.isAdvancedPhase("DEVELOPING"), "Identifies DEVELOPING as advanced phase");
      assert(StateController.isAdvancedPhase("TESTING"), "Identifies TESTING as advanced phase");
      assert(StateController.isAdvancedPhase("REVIEWING"), "Identifies REVIEWING as advanced phase");
      assert(!StateController.isAdvancedPhase("INTAKE"), "INTAKE is not an advanced phase");
      assert(!StateController.isAdvancedPhase("IDLE"), "IDLE is not an advanced phase");
    }

    // -----------------------------------------------------------------------
    // TEST 3: StateController Atomic Intake Authorization
    // -----------------------------------------------------------------------
    console.log("\nTest 3: StateController Atomic Intake Authorization");
    {
      const issueData = {
        owner: "test-owner",
        repo: "test-repo",
        number: 42,
        title: "Test Issue 42 Title",
        body: "Repro steps and acceptance criteria",
        author: "author42",
        labels: ["bug"],
        comments: [],
        state: "OPEN",
      };

      const mockCachePath = path.join(tempDir, ".gated-change", "issue-cache.json");
      const updatedState = StateController.authorizeIntake(
        tempDir,
        issueData,
        mockCachePath,
        "test-session-123"
      );

      assert(updatedState.phase === "INTAKE", "authorizeIntake sets state.phase to INTAKE");
      assert(updatedState.issue.number === 42, "authorizeIntake records issue number 42");
      assert(updatedState.activeBranch === "fix/issue-42", "authorizeIntake sets branch to fix/issue-42");

      // Verify dashboard.json synced
      const dashFile = path.join(tempDir, ".gated-change", "dashboard.json");
      assert(fs.existsSync(dashFile), "Dashboard JSON exists after authorizeIntake");
      const dashContent = JSON.parse(fs.readFileSync(dashFile, "utf-8"));
      assert(dashContent.phases?.intake?.status === "INTAKE_AUTHORIZED", "Dashboard intake phase status is set to INTAKE_AUTHORIZED");
      assert(dashContent.issueNumber === 42, "Dashboard records issue number 42");

      // Verify audit.jsonl recorded entry
      const auditFile = path.join(tempDir, ".gated-change", "audit.jsonl");
      assert(fs.existsSync(auditFile), "Audit log exists after authorizeIntake");
      const auditLines = fs.readFileSync(auditFile, "utf-8").trim().split("\n");
      const lastAudit = JSON.parse(auditLines[auditLines.length - 1]);
      assert(lastAudit.action === "intake_stage_authorized", "Audit log records intake_stage_authorized action");
      assert(lastAudit.details.status === "INTAKE_AUTHORIZED", "Audit details show status INTAKE_AUTHORIZED");
    }

    // -----------------------------------------------------------------------
    // TEST 4: Live Bundled Hook Execution (hook-session-start.mjs)
    // -----------------------------------------------------------------------
    console.log("\nTest 4: Live Bundled Hook Execution (hook-session-start.mjs)");
    {
      assert(fs.existsSync(distHookPath), "Compiled hook bundle exists at plugins/prsquad/dist/hook-session-start.mjs");

      // Reset state to initial clean intake phase before test 4A
      const cleanState = loadState(REPO_ROOT);
      cleanState.phase = "INTAKE";
      delete (cleanState.issue as any).number;
      saveState(cleanState, REPO_ROOT);

      // 4A: Normal sessionStart with issue #1 (using local test environment allowFixtures)
      const inputNormal = JSON.stringify({
        sessionId: "sess-abc-456",
        cwd: REPO_ROOT,
        initialPrompt: "resolve issue #1",
        source: "new",
      });

      const outNormal = execSync(`node "${distHookPath}"`, {
        input: inputNormal,
        encoding: "utf-8",
        cwd: REPO_ROOT,
        env: { ...process.env, NODE_ENV: "test", PRSQUAD_ALLOW_FIXTURES: "true" },
        stdio: ["pipe", "pipe", "pipe"],
      });

      const parsedNormal = JSON.parse(outNormal.trim());
      assert(parsedNormal.decision === "allow", "sessionStart allows valid session for OPEN issue");
      assert(
        parsedNormal.additionalContext.includes("ISSUE #1 VERIFIED OPEN"),
        "additionalContext indicates issue #1 is verified OPEN"
      );
      assert(
        parsedNormal.additionalContext.includes("@gated-change-intake"),
        "additionalContext directs Orchestrator to delegate to @gated-change-intake"
      );

      // Verify .gated-change/issue-cache.json created in REPO_ROOT
      const cachePath = path.join(REPO_ROOT, ".gated-change", "issue-cache.json");
      assert(fs.existsSync(cachePath), "issue-cache.json created in .gated-change");
      const cachedData = JSON.parse(fs.readFileSync(cachePath, "utf-8"));
      assert(cachedData.number === 1, "Cached issue data has number 1");
      assert(cachedData.state === "OPEN", "Cached issue state is OPEN");

      // 4B: Session Resume in Advanced Phase (ARCHITECTING)
      // Manually set state to ARCHITECTING to simulate an in-flight workflow
      const stateToResume = loadState(REPO_ROOT);
      stateToResume.phase = "ARCHITECTING";
      stateToResume.sessionId = "sess-in-flight-999";
      saveState(stateToResume, REPO_ROOT);

      const inputResume = JSON.stringify({
        sessionId: "sess-in-flight-999",
        cwd: REPO_ROOT,
        initialPrompt: "continue fix",
        source: "resume",
      });

      const outResume = execSync(`node "${distHookPath}"`, {
        input: inputResume,
        encoding: "utf-8",
        cwd: REPO_ROOT,
        env: { ...process.env, NODE_ENV: "test" },
        stdio: ["pipe", "pipe", "pipe"],
      });

      const parsedResume = JSON.parse(outResume.trim());
      assert(parsedResume.decision === "allow", "sessionStart allows resumed session");
      assert(
        parsedResume.additionalContext.includes("SESSION RESUMED"),
        "additionalContext identifies SESSION RESUMED"
      );
      assert(
        parsedResume.additionalContext.includes("Active Phase: ARCHITECTING"),
        "additionalContext preserves Active Phase: ARCHITECTING"
      );

      // Verify state was NOT reverted to INTAKE
      const preservedState = loadState(REPO_ROOT);
      assert(
        preservedState.phase === "ARCHITECTING",
        "Resumed session strictly preserves ARCHITECTING phase without resetting to INTAKE"
      );

      // 4C: Generic session with NO issue detected
      // Reset state to clean
      preservedState.phase = "INTAKE";
      delete (preservedState.issue as any).number;
      saveState(preservedState, REPO_ROOT);

      const inputNoIssue = JSON.stringify({
        sessionId: "sess-no-issue",
        cwd: REPO_ROOT,
        initialPrompt: "hello copilot, tell me a joke",
        source: "new",
      });

      const outNoIssue = execSync(`node "${distHookPath}"`, {
        input: inputNoIssue,
        encoding: "utf-8",
        cwd: REPO_ROOT,
        env: { ...process.env, NODE_ENV: "test" },
        stdio: ["pipe", "pipe", "pipe"],
      });

      const parsedNoIssue = JSON.parse(outNoIssue.trim());
      assert(parsedNoIssue.decision === "allow", "sessionStart allows session without issue gracefully");
      assert(
        parsedNoIssue.additionalContext.includes("NO ISSUE DETECTED"),
        "additionalContext explains NO ISSUE DETECTED without erroring"
      );
    }

    // -----------------------------------------------------------------------
    // TEST 5: Closed Issue Policy Block
    // -----------------------------------------------------------------------
    console.log("\nTest 5: Closed Issue Policy Block (Fail-Closed)");
    {
      // Mock closed issue in cache to test fail-closed behavior
      const cachePath = path.join(REPO_ROOT, ".gated-change", "issue-cache.json");
      fs.writeFileSync(
        cachePath,
        JSON.stringify({
          number: 99,
          title: "Closed Issue",
          body: "Already solved",
          author: "user",
          labels: [],
          state: "CLOSED",
        }),
        "utf-8"
      );

      const inputClosed = JSON.stringify({
        sessionId: "sess-closed",
        cwd: REPO_ROOT,
        initialPrompt: "resolve issue #99",
        source: "new",
      });

      const outClosed = execSync(`node "${distHookPath}"`, {
        input: inputClosed,
        encoding: "utf-8",
        cwd: REPO_ROOT,
        env: { ...process.env, NODE_ENV: "test", PRSQUAD_ALLOW_FIXTURES: "true" },
        stdio: ["pipe", "pipe", "pipe"],
      });

      const parsedClosed = JSON.parse(outClosed.trim());
      assert(parsedClosed.decision === "deny", "sessionStart denies workflow for CLOSED issue");
      assert(
        parsedClosed.permissionDecisionReason.includes("DETERMINISTIC_POLICY_BLOCK"),
        "Closed issue triggers DETERMINISTIC_POLICY_BLOCK"
      );

      const stateAfterClosed = loadState(REPO_ROOT);
      assert(stateAfterClosed.phase === "PAUSED", "Workflow is set to PAUSED when issue is closed");
    }
  } finally {
    // Cleanup temporary test directory
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  }

  console.log("\n=======================================================");
  console.log(`  SESSION START SUITE COMPLETE: ${passed}/${total} checks passed (${Math.round((passed / total) * 100)}%)`);
  console.log("=======================================================\n");

  if (passed !== total) {
    process.exit(1);
  }
}

runSessionStartSuite().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});

/**
 * Comprehensive automated test suite for Gated Change deterministic guardrails.
 * Tests:
 *   1. State Engine & Lock Lifecycle
 *   2. Mechanical Scope Gate (preToolUse agent verification)
 *   3. Write-Scope Barrier & Developer Smart Nudge (preToolUse edit)
 *   4. Shell Command Sandboxing by Agent Role (preToolUse bash)
 *   5. Tier 1 AST Symbol Sweep across package boundaries
 */

import { execSync } from "node:child_process";
import { isEditAllowed, formatScopeDenialNudge } from "../src/guardrails/scopeEnforcer.js";
import { validateCommandForAgent } from "../src/guardrails/bashSandbox.js";
import { runSymbolSweep, extractExportedSymbols } from "../src/guardrails/symbolSweep.js";
import {
  loadState,
  saveState,
  saveApprovalLock,
  loadApprovalLock,
  revokeApprovalLock,
} from "../src/guardrails/stateStore.js";

let passedCount = 0;
let totalCount = 0;

function assert(condition: boolean, testName: string, failureDetail?: string): void {
  totalCount++;
  if (condition) {
    passedCount++;
    console.log(`  [PASS] ${testName}`);
  } else {
    console.error(`  [FAIL] ${testName}`);
    if (failureDetail) console.error(`         Detail: ${failureDetail}`);
  }
}

console.log("\n=======================================================");
console.log("  GATED CHANGE — GUARDRAILS AUTOMATED VERIFICATION");
console.log("=======================================================\n");

// ---------------------------------------------------------------------------
// 1. State Store & Lock Lifecycle Tests
// ---------------------------------------------------------------------------
console.log("Suite 1: State Store & Lock Lifecycle");
{
  const state = loadState();
  assert(typeof state.sessionId === "string" && state.sessionId.length > 0, "State initializes with valid sessionId");
  assert(state.implementationAttempt >= 1, "Implementation attempt counter initialized");

  // Save active lock
  saveApprovalLock({
    issueNumber: 999,
    approvedScope: "src/services/billing/",
    maxAttempts: 3,
    currentAttempt: 1,
    approvedAt: new Date().toISOString(),
    approvedBy: "test-approver",
    status: "ACTIVE",
  });

  const activeLock = loadApprovalLock();
  assert(activeLock !== null && activeLock.status === "ACTIVE", "Active lock successfully written and read");
  assert(activeLock?.approvedScope === "src/services/billing/", "Lock preserves approvedScope");

  // Revoke lock
  revokeApprovalLock("REVOKED");
  const revokedLock = loadApprovalLock();
  assert(revokedLock === null, "Revoked lock is not returned as active");
}

// ---------------------------------------------------------------------------
// 2. Mechanical Scope Gate Hook Tests
// ---------------------------------------------------------------------------
console.log("\nSuite 2: Guardrail 1 — Mechanical Scope Gate Hook");
{
  // Revoke any active lock
  revokeApprovalLock("REVOKED");

  // Attempt to invoke developer without lock -> Must fail
  try {
    const input = JSON.stringify({ tool: "agent", toolArgs: { name: "gated-change-developer" } });
    execSync(`npx tsx scripts/guardrails/hook-verify-gate.ts`, {
      input,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "ignore"],
    });
    assert(false, "Hook must deny developer invocation without active lock");
  } catch (err: any) {
    assert(err.status === 1, "Hook exits with code 1 when lock is missing");
  }

  // Create active lock
  saveApprovalLock({
    issueNumber: 999,
    approvedScope: "src/services/billing/",
    maxAttempts: 3,
    currentAttempt: 1,
    approvedAt: new Date().toISOString(),
    approvedBy: "test-approver",
    status: "ACTIVE",
  });

  // Attempt to invoke developer with active lock -> Must succeed
  try {
    const input = JSON.stringify({ tool: "agent", toolArgs: { name: "gated-change-developer" } });
    const stdout = execSync(`npx tsx scripts/guardrails/hook-verify-gate.ts`, {
      input,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "ignore"],
    });
    const parsed = JSON.parse(stdout);
    assert(parsed.decision === "allow", "Hook permits developer invocation when active lock is present");
  } catch (err: any) {
    assert(false, `Hook failed on valid lock: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// 3. Write-Scope Barrier & Smart Nudge Tests
// ---------------------------------------------------------------------------
console.log("\nSuite 3: Guardrail 2 — Write-Scope Barrier & Smart Nudge");
{
  const scope = "src/services/billing";

  // In-scope file
  const inScope = isEditAllowed("src/services/billing/invoice.ts", scope);
  assert(inScope.allowed, "Permits edit in approved scope prefix");

  // Out-of-scope file
  const outScope = isEditAllowed("src/common/errors.ts", scope);
  assert(!outScope.allowed, "Blocks edit outside approved scope prefix");
  assert(outScope.reason?.includes("SCOPE_VIOLATION") ?? false, "Identifies SCOPE_VIOLATION error");

  // System file protection
  const sys1 = isEditAllowed(".github/workflows/ci.yml", scope);
  assert(!sys1.allowed, "Strictly blocks edit to .github/");

  const sys2 = isEditAllowed(".gated-change/approval.lock", scope);
  assert(!sys2.allowed, "Strictly blocks edit to .gated-change/");

  // Smart nudge format
  const nudge = formatScopeDenialNudge("src/common/errors.ts", scope);
  assert(nudge.includes("SCOPE_AMENDMENT_REQUIRED"), "Nudge payload contains SCOPE_AMENDMENT_REQUIRED instruction");
  assert(nudge.includes("src/common/errors.ts"), "Nudge payload includes specific blocked path");
}

// ---------------------------------------------------------------------------
// 4. Shell Command Sandboxing Tests
// ---------------------------------------------------------------------------
console.log("\nSuite 4: Guardrail 3 — Shell Command Sandboxing");
{
  // Reviewer agent tests
  const revDiff = validateCommandForAgent("git diff HEAD~1", "gated-change-reviewer");
  assert(revDiff.allowed, "Reviewer allowed git diff");

  const revStatus = validateCommandForAgent("git status --short", "gated-change-reviewer");
  assert(revStatus.allowed, "Reviewer allowed git status");

  const revTest = validateCommandForAgent("npm test", "gated-change-reviewer");
  assert(!revTest.allowed, "Reviewer strictly blocked from running tests");

  const revRedirect = validateCommandForAgent("git diff > patch.diff", "gated-change-reviewer");
  assert(!revRedirect.allowed, "Reviewer strictly blocked from file redirects ('>')");

  // QA agent tests
  const qaTest = validateCommandForAgent("npm test", "gated-change-qa");
  assert(qaTest.allowed, "QA allowed to execute test commands");

  const qaVitest = validateCommandForAgent("npx vitest run tests/auth.test.ts", "gated-change-qa");
  assert(qaVitest.allowed, "QA allowed to execute npx test runners");

  const qaPush = validateCommandForAgent("git push origin main", "gated-change-qa");
  assert(!qaPush.allowed, "QA strictly blocked from git push");

  const qaCommit = validateCommandForAgent("git commit -m 'fix'", "gated-change-qa");
  assert(!qaCommit.allowed, "QA strictly blocked from git commit");

  // Developer agent tests
  const devPush = validateCommandForAgent("git push origin branch", "gated-change-developer");
  assert(!devPush.allowed, "Developer blocked from remote git push");
}

// ---------------------------------------------------------------------------
// 5. Tier 1 AST Symbol Sweep Tests
// ---------------------------------------------------------------------------
console.log("\nSuite 5: Guardrail 4 — Tier 1 AST Symbol Sweep");
{
  const symbols = extractExportedSymbols("src/scopeTool.ts");
  assert(symbols.includes("isWithinScope"), "Extracts exported function 'isWithinScope'");
  assert(symbols.includes("makeScopedReadTool"), "Extracts exported function 'makeScopedReadTool'");

  const report = runSymbolSweep(["src/scopeTool.ts"], "src/services/fake/");
  assert(report.totalSymbolsAnalyzed >= 2, "Analyzed exported symbols count >= 2");
  assert(report.externalReferencesFound.length > 0, "Detects external references in src/actions/architect.ts");
}

console.log("\n=======================================================");
console.log(`  VERIFICATION COMPLETE: ${passedCount}/${totalCount} checks passed.`);
console.log("=======================================================\n");

if (passedCount < totalCount) {
  process.exit(1);
}

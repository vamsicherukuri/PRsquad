/**
 * Comprehensive automated test suite for Gated Change deterministic guardrails.
 * Tests:
 *   1. State Engine & Lock Lifecycle
 *   2. Mechanical Scope Gate (preToolUse agent verification)
 *   3. Write-Scope Barrier & Developer Smart Nudge (preToolUse edit)
 *   4. Shell Command Sandboxing by Agent Role (preToolUse bash)
 *   5. Deterministic Symbol & Reference Sweep across package boundaries
 */

import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import { isEditAllowed, formatScopeDenialNudge } from "../src/guardrails/scopeEnforcer.js";
import { validateCommandForAgent } from "../src/guardrails/bashSandbox.js";
import { runSymbolSweep, extractExportedSymbols } from "../src/guardrails/symbolSweep.js";
import { isValidGitRef } from "../src/guardrails/prCreator.js";
import {
  loadState,
  saveState,
  saveApprovalLock,
  loadApprovalLock,
  revokeApprovalLock,
  toPosixRelative,
  getRepoRoot,
} from "../src/guardrails/stateStore.js";

const REPO_ROOT = getRepoRoot();
let initialBranch = "";
try {
  initialBranch = execSync("git rev-parse --abbrev-ref HEAD", { cwd: REPO_ROOT, encoding: "utf-8" }).trim();
} catch {}
const TEST_ISOLATED_DIR = mkdtempSync(join(tmpdir(), "gated-guardrails-test-"));
try {
  execSync("git init", { cwd: TEST_ISOLATED_DIR, stdio: "ignore" });
} catch {}

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
  const state = loadState(TEST_ISOLATED_DIR);
  state.issue = {
    number: 999,
    title: "Test Billing Issue",
    declaredScope: "src/services/billing/",
    fetchedAt: new Date().toISOString(),
  };
  saveState(state, TEST_ISOLATED_DIR);
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
  }, TEST_ISOLATED_DIR);

  const activeLock = loadApprovalLock(TEST_ISOLATED_DIR);
  assert(activeLock !== null && activeLock.status === "ACTIVE", "Active lock successfully written and read");
  assert(activeLock?.approvedScope === "src/services/billing/", "Lock preserves approvedScope");

  // Revoke lock
  revokeApprovalLock("REVOKED", TEST_ISOLATED_DIR);
  const revokedLock = loadApprovalLock(TEST_ISOLATED_DIR);
  assert(revokedLock === null, "Revoked lock is not returned as active");
}

// ---------------------------------------------------------------------------
// 2. Mechanical Scope Gate Hook Tests
// ---------------------------------------------------------------------------
console.log("\nSuite 2: Guardrail 1 — Mechanical Scope Gate Hook");
{
  // Revoke any active lock in test directory
  revokeApprovalLock("REVOKED", TEST_ISOLATED_DIR);

  // Attempt to invoke developer without lock -> Must fail
  try {
    const input = JSON.stringify({ cwd: TEST_ISOLATED_DIR, tool: "agent", toolArgs: { name: "gated-change-developer" } });
    execSync(`node --import tsx "${join(REPO_ROOT, "scripts/guardrails/hook-verify-gate.ts")}"`, {
      cwd: REPO_ROOT,
      input,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "ignore"],
    });
    assert(false, "Hook must deny developer invocation without active lock");
  } catch (err: any) {
    assert(err.status === 1, "Hook exits with code 1 when lock is missing");
  }

  // Ensure state issue matches
  const state = loadState(TEST_ISOLATED_DIR);
  state.issue = {
    number: 999,
    title: "Test Billing Issue",
    declaredScope: "src/services/billing/",
    fetchedAt: new Date().toISOString(),
  };
  saveState(state, TEST_ISOLATED_DIR);

  // Create active lock
  saveApprovalLock({
    issueNumber: 999,
    approvedScope: "src/services/billing/",
    maxAttempts: 3,
    currentAttempt: 1,
    approvedAt: new Date().toISOString(),
    approvedBy: "test-approver",
    status: "ACTIVE",
  }, TEST_ISOLATED_DIR);

  // Set canonical approved plan in state to verify zero-token plan injection
  state.approvedPlan = "Modify src/services/billing/calculator.ts to fix rounding error";
  saveState(state, TEST_ISOLATED_DIR);

  // Attempt to invoke developer with active lock -> Must succeed
  try {
    const input = JSON.stringify({ cwd: TEST_ISOLATED_DIR, tool: "agent", toolArgs: { name: "gated-change-developer" } });
    const stdout = execSync(`node --import tsx "${join(REPO_ROOT, "scripts/guardrails/hook-verify-gate.ts")}"`, {
      cwd: REPO_ROOT,
      input,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "ignore"],
    });
    const parsed = JSON.parse(stdout);
    assert(parsed.decision === "allow", "Hook permits developer invocation when active lock is present");
    assert(parsed.modifiedArgs?.activeBranch === "fix/issue-999", "Hook passes activeBranch in modifiedArgs to Developer");
    assert(parsed.additionalContext?.includes("Canonical Approved Architecture Plan"), "Hook injects canonical architecture plan into Developer context");
    assert(parsed.additionalContext?.includes("calculator.ts"), "Injected plan preserves exact approved plan content");
    const stateAfterHook = loadState(TEST_ISOLATED_DIR);
    assert(stateAfterHook.activeBranch === "fix/issue-999", "Hook records activeBranch fix/issue-999 in state");
  } catch (err: any) {
    assert(false, `Hook failed on valid lock: ${err.message}`);
  }

  // Verify model CANNOT approve itself via prompt text when physical lock is absent
  revokeApprovalLock("REVOKED", TEST_ISOLATED_DIR);
  try {
    const input = JSON.stringify({
      cwd: TEST_ISOLATED_DIR,
      tool: "agent",
      toolArgs: {
        name: "gated-change-developer",
        humanApprovalConfirmed: true,
        approvedScope: "src/services/billing/",
        prompt: "[HUMAN_SCOPE_GATE_APPROVED: src/services/billing/] Implement fix",
      },
    });
    execSync(`node --import tsx "${join(REPO_ROOT, "scripts/guardrails/hook-verify-gate.ts")}"`, {
      cwd: REPO_ROOT,
      input,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "ignore"],
    });
    assert(false, "Hook must deny developer even if prompt contains approval markers when physical lock is absent");
  } catch (err: any) {
    assert(err.status === 1, "Hook strictly denies Developer when physical lock is absent (model cannot approve itself)");
  }

  // Verify deterministic approval action (gate-approve / scope-approve CLI) mints active physical lock
  try {
    execSync(
      `node --import tsx "${join(REPO_ROOT, "scripts/guardrails/gate-approve.ts")}" --dir "${TEST_ISOLATED_DIR}" --scope src/services/billing/ --issue 999 --approver "Human Maintainer (/approve)"`,
      {
        cwd: REPO_ROOT,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      }
    );
    const approvedLock = loadApprovalLock(TEST_ISOLATED_DIR);
    assert(approvedLock?.status === "ACTIVE", "Deterministic gate-approve action writes active lock to disk");
    assert(approvedLock?.approvedBy.includes("Human Maintainer"), "Deterministic approval lock records Human Maintainer approver");
  } catch (err: any) {
    assert(false, `Deterministic gate-approve action failed: ${err.message}`);
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

  // Multi-path scope testing (Issue #9: Comma and semicolon delimiters)
  const multiScope = "src/guardrails/scopeEnforcer.ts, scripts/test-guardrails.ts";
  const multi1 = isEditAllowed("src/guardrails/scopeEnforcer.ts", multiScope);
  assert(multi1.allowed, "Permits edit to first candidate in multi-path scope (comma-separated)");
  const multi2 = isEditAllowed("scripts/test-guardrails.ts", multiScope);
  assert(multi2.allowed, "Permits edit to second candidate in multi-path scope (comma-separated)");
  const multiBlocked = isEditAllowed("src/other.ts", multiScope);
  assert(!multiBlocked.allowed, "Blocks edit to file outside multi-path scope");

  const semiScope = "src/guardrails/scopeEnforcer.ts; scripts/test-guardrails.ts";
  const semi1 = isEditAllowed("src/guardrails/scopeEnforcer.ts", semiScope);
  assert(semi1.allowed, "Permits edit to candidate in multi-path scope (semicolon-separated)");

  // Boundary edge cases: empty string, whitespace, and delimiter-only scopes must strictly deny edits
  const emptyScope = isEditAllowed("src/services/billing/invoice.ts", "");
  assert(!emptyScope.allowed, "Empty scope strictly denies edits");

  const whitespaceScope = isEditAllowed("src/services/billing/invoice.ts", "   ");
  assert(!whitespaceScope.allowed, "Whitespace-only scope strictly denies edits");

  const delimiterScope = isEditAllowed("src/services/billing/invoice.ts", ";,;");
  assert(!delimiterScope.allowed, "Delimiter-only scope strictly denies edits");

  const paddedDelimiterScope = isEditAllowed("src/services/billing/invoice.ts", "  ;  ,  ;  ");
  assert(!paddedDelimiterScope.allowed, "Padded delimiter-only scope strictly denies edits");

  // Sibling prefix containment: 'src/services/billing' must NOT match 'src/services/billing_other.ts'
  const siblingCheck = isEditAllowed("src/services/billing_other.ts", "src/services/billing");
  assert(!siblingCheck.allowed, "Sibling prefix (billing_other) strictly denied for scope 'billing'");

  // Path normalization for worktree absolute paths
  const fakeWorktreeRoot = "C:/virtual/worktrees/issue-9";
  const fakeFile = "C:/virtual/worktrees/issue-9/src/guardrails/scopeEnforcer.ts";
  const normalizedWorktree = toPosixRelative(fakeFile, fakeWorktreeRoot);
  assert(normalizedWorktree === "src/guardrails/scopeEnforcer.ts", "Cleanly normalizes absolute worktree file path without '..' traversal");

  // Clean denial protocol: hook-enforce-scope exits with code 0 on denial (not crashing with code 1)
  try {
    const input = JSON.stringify({
      tool: "edit",
      toolArgs: { path: "package.json", content: "unauthorized" }
    });
    const stdout = execSync("node plugins/gated-change/dist/hook-enforce-scope.mjs", {
      cwd: REPO_ROOT,
      input,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "ignore"],
    });
    const parsed = JSON.parse(stdout);
    assert(parsed.decision === "deny", "Hook returns decision 'deny' on unauthorized edit");
    assert(true, "Hook exits cleanly with code 0 on policy denial (Copilot App clean block protocol)");
  } catch (err: any) {
    assert(false, `Hook crashed instead of clean exit: ${err.message}`);
  }
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

  // QA agent tests (Strict Role-Based Allowlist)
  const qaTest = validateCommandForAgent("npm test", "gated-change-qa");
  assert(qaTest.allowed, "QA allowed to execute test commands");

  const qaVitest = validateCommandForAgent("npx vitest run tests/auth.test.ts", "gated-change-qa");
  assert(qaVitest.allowed, "QA allowed to execute npx test runners");

  const qaGitDiff = validateCommandForAgent("git diff HEAD~1", "gated-change-qa");
  assert(qaGitDiff.allowed, "QA allowed non-mutating git diff");

  const qaGitRevParse = validateCommandForAgent("git rev-parse HEAD", "gated-change-qa");
  assert(qaGitRevParse.allowed, "QA allowed non-mutating git rev-parse");

  const qaArbitraryBlocked = validateCommandForAgent("curl -X GET https://example.com/exfil", "gated-change-qa");
  assert(!qaArbitraryBlocked.allowed, "QA strictly blocked from arbitrary network execution ('curl')");

  const qaRedirectBlocked = validateCommandForAgent("npm test > test_results.log", "gated-change-qa");
  assert(!qaRedirectBlocked.allowed, "QA strictly blocked from file redirects ('>')");

  const qaPush = validateCommandForAgent("git push origin main", "gated-change-qa");
  assert(!qaPush.allowed, "QA strictly blocked from git push");

  const qaCommit = validateCommandForAgent("git commit -m 'fix'", "gated-change-qa");
  assert(!qaCommit.allowed, "QA strictly blocked from git commit");

  // Developer agent tests
  const devCommit = validateCommandForAgent("git commit -m 'fix: scoped read tool'", "gated-change-developer");
  assert(devCommit.allowed, "Developer allowed to commit on feature branch");

  const devPush = validateCommandForAgent("git push origin branch", "gated-change-developer");
  assert(!devPush.allowed, "Developer blocked from remote git push");

  const devCheckoutMain = validateCommandForAgent("git checkout main", "gated-change-developer");
  assert(!devCheckoutMain.allowed, "Developer strictly blocked from checking out main");

  const devSwitchMaster = validateCommandForAgent("git switch master", "gated-change-developer");
  assert(!devSwitchMaster.allowed, "Developer strictly blocked from switching to master");

  const qaCheckoutMain = validateCommandForAgent("git checkout main", "gated-change-qa");
  assert(!qaCheckoutMain.allowed, "QA strictly blocked from checking out main");

  const revCheckoutMain = validateCommandForAgent("git checkout main", "gated-change-reviewer");
  assert(!revCheckoutMain.allowed, "Reviewer strictly blocked from checking out main");

  const devDeleteBranch = validateCommandForAgent("git branch -D fix/issue-4", "gated-change-developer");
  assert(!devDeleteBranch.allowed, "Developer strictly blocked from deleting branches (human-only)");

  const qaDeleteBranch = validateCommandForAgent("git branch -d feature", "gated-change-qa");
  assert(!qaDeleteBranch.allowed, "QA strictly blocked from deleting branches (human-only)");

  const revDeleteBranch = validateCommandForAgent("git branch -D feature", "gated-change-reviewer");
  assert(!revDeleteBranch.allowed, "Reviewer strictly blocked from deleting branches (human-only)");

  // PowerShell execution tool tests (Windows Copilot host compatibility)
  const psDevInput = JSON.stringify({
    tool: "powershell",
    toolArgs: { command: "git commit -m 'fix: scoped read tool'", agent_type: "gated-change-developer" }
  });
  const psDevOut = execSync("node plugins/gated-change/dist/hook-sandbox-bash.mjs", {
    cwd: REPO_ROOT,
    input: psDevInput,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "ignore"],
  });
  const psDevParsed = JSON.parse(psDevOut);
  assert(psDevParsed.decision === "allow", "Sandbox permits Developer to run git commit via 'powershell' tool");

  const psQaTestInput = JSON.stringify({
    tool: "powershell",
    toolArgs: { command: "npx -y tsx scripts/test-guardrails.ts", agent_type: "gated-change-qa" }
  });
  const psQaTestOut = execSync("node plugins/gated-change/dist/hook-sandbox-bash.mjs", {
    cwd: REPO_ROOT,
    input: psQaTestInput,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "ignore"],
  });
  const psQaTestParsed = JSON.parse(psQaTestOut);
  assert(psQaTestParsed.decision === "allow", "Sandbox permits QA to run tests via 'powershell' tool");

  const psBlockedInput = JSON.stringify({
    tool: "powershell",
    toolArgs: { command: "git push origin main", agent_type: "gated-change-developer" }
  });
  const psBlockedOut = execSync("node plugins/gated-change/dist/hook-sandbox-bash.mjs", {
    cwd: REPO_ROOT,
    input: psBlockedInput,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "ignore"],
  });
  const psBlockedParsed = JSON.parse(psBlockedOut);
  assert(psBlockedParsed.decision === "deny", "Sandbox blocks Developer from git push to main via 'powershell' tool with clean exit 0");

  // Issue #18: Destructive git clean with force flags strictly blocked across agents
  const devCleanFdx = validateCommandForAgent("git clean -fdx", "gated-change-developer");
  assert(!devCleanFdx.allowed, "Developer strictly blocked from destructive 'git clean -fdx'");
  assert(devCleanFdx.reason?.includes("POLICY_DENIAL"), "Denial reason cites POLICY_DENIAL for git clean");

  const devCleanF = validateCommandForAgent("git clean -f", "gated-change-developer");
  assert(!devCleanF.allowed, "Developer strictly blocked from destructive 'git clean -f'");

  const qaCleanF = validateCommandForAgent("git clean -fdx", "gated-change-qa");
  assert(!qaCleanF.allowed, "QA strictly blocked from destructive 'git clean -fdx'");

  const devCleanDryRun = validateCommandForAgent("git clean -n", "gated-change-developer");
  assert(devCleanDryRun.allowed, "Developer permitted to execute non-destructive dry-run 'git clean -n'");

  // Issue #22: Strict git-ref validation against shell injection and invalid ref formats
  assert(isValidGitRef("fix/issue-22"), "Validates clean feature branch name 'fix/issue-22'");
  assert(isValidGitRef("prsquad/feat-ast"), "Validates branch with nested directory 'prsquad/feat-ast'");
  assert(!isValidGitRef("fix/issue-22;rm -rf /"), "Strictly rejects branch containing shell semicolon");
  assert(!isValidGitRef("feat/foo`whoami`"), "Strictly rejects branch containing shell backticks");
  assert(!isValidGitRef("branch&&curl"), "Strictly rejects branch containing shell && operator");
  assert(!isValidGitRef("-invalid-leading-dash"), "Strictly rejects branch with leading dash");
  assert(!isValidGitRef("invalid..dots"), "Strictly rejects branch with double dots");
  assert(!isValidGitRef("invalid.lock"), "Strictly rejects branch with .lock suffix");
}

// ---------------------------------------------------------------------------
// 5. Deterministic Symbol & Reference Sweep Tests
// ---------------------------------------------------------------------------
console.log("\nSuite 5: Guardrail 4 — Deterministic Symbol & Reference Sweep");
{
  const symbols = extractExportedSymbols("src/scopeTool.ts");
  assert(symbols.includes("isWithinScope"), "Extracts exported function 'isWithinScope'");
  assert(symbols.includes("makeScopedReadTool"), "Extracts exported function 'makeScopedReadTool'");

  const report = runSymbolSweep(["src/scopeTool.ts"], "src/services/fake/");
  assert(report.totalSymbolsAnalyzed >= 2, "Analyzed exported symbols count >= 2");
  assert(report.externalReferencesFound.length > 0, "Detects external references in src/actions/architect.ts");

  // Issue #21: TypeScript AST anonymous default export and arrow function tests
  const anonArrowFile = join(TEST_ISOLATED_DIR, "anon-arrow.ts");
  writeFileSync(anonArrowFile, "export default () => 42;\nexport const version = '1.0';\n");
  const anonArrowSymbols = extractExportedSymbols("anon-arrow.ts", TEST_ISOLATED_DIR);
  assert(anonArrowSymbols.includes("default"), "Captures anonymous default arrow function as 'default'");
  assert(anonArrowSymbols.includes("version"), "Captures named export alongside anonymous default export");

  const anonFuncFile = join(TEST_ISOLATED_DIR, "anon-func.ts");
  writeFileSync(anonFuncFile, "export default function() { return 'hello'; }\n");
  const anonFuncSymbols = extractExportedSymbols("anon-func.ts", TEST_ISOLATED_DIR);
  assert(anonFuncSymbols.includes("default"), "Captures anonymous default function declaration as 'default'");

  const anonClassFile = join(TEST_ISOLATED_DIR, "anon-class.ts");
  writeFileSync(anonClassFile, "export default class { compute() { return 1; } }\n");
  const anonClassSymbols = extractExportedSymbols("anon-class.ts", TEST_ISOLATED_DIR);
  assert(anonClassSymbols.includes("default"), "Captures anonymous default class as 'default'");

  // Verify external sweep ignores keyword 'default' in external switch statements
  const externalSwitchFile = join(TEST_ISOLATED_DIR, "switch-consumer.ts");
  writeFileSync(externalSwitchFile, "function handle(k: string) { switch(k) { default: return null; } }\n");
  const defaultSweepReport = runSymbolSweep(["anon-arrow.ts"], "src/", TEST_ISOLATED_DIR);
  const foundDefaultRef = defaultSweepReport.externalReferencesFound.some(r => r.symbol === "default");
  assert(!foundDefaultRef, "External sweep excludes keyword 'default' from matching external switch statements");
}

console.log("\n=======================================================");
console.log(`  VERIFICATION COMPLETE: ${passedCount}/${totalCount} checks passed.`);
console.log("=======================================================\n");

try {
  rmSync(TEST_ISOLATED_DIR, { recursive: true, force: true });
} catch {}

if (initialBranch && initialBranch !== "HEAD") {
  try {
    execSync(`git checkout ${initialBranch}`, { cwd: REPO_ROOT, stdio: "ignore" });
    execSync(`git branch -D fix/issue-999 fix/issue-gated-change`, { cwd: REPO_ROOT, stdio: "ignore" });
  } catch {}
}

if (passedCount < totalCount) {
  process.exit(1);
}


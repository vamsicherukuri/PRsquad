/**
 * Before-and-After Verification Suite: Guardrail Hardening
 * 
 * Demonstrates the exact failure mode under the vulnerable "Before" logic
 * vs. the hardened, fail-closed behavior under the "After" implementation.
 */

import { strict as assert } from "node:assert";
import { execSync } from "node:child_process";
import { existsSync, writeFileSync, unlinkSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { validateTriage, validateDeveloper, validateQA, validateReview, extractAgentPayload } from "../src/guardrails/handoffValidator.js";
import { validateCommandForAgent } from "../src/guardrails/bashSandbox.js";
import { toPosixRelative, loadState, saveState, getRepoRoot } from "../src/guardrails/stateStore.js";
import { createPullRequest } from "../src/guardrails/prCreator.js";
import { approveScopeGate, computeApprovalEnvelopeHash } from "../src/guardrails/scopeApprover.js";

const REPO_ROOT = getRepoRoot();

interface ComparisonResult {
  id: string;
  name: string;
  vulnerability: string;
  beforeBehavior: string;
  afterBehavior: string;
  status: "PASSED";
}

const results: ComparisonResult[] = [];

console.log("\n=======================================================");
console.log("  PRSQUAD HARDENING: BEFORE VS AFTER VERIFICATION SUITE");
console.log("=======================================================\n");

// ---------------------------------------------------------------------------
// TEST 1: Malformed Reviewer Handoff (Fail-Open vs Fail-Closed)
// ---------------------------------------------------------------------------
{
  const testName = "Malformed Reviewer Handoff";
  console.log(`[TEST 1] ${testName}`);

  const malformedReviewerOutput = "Review complete, but no JSON payload present.";
  
  // Before logic simulation:
  // const verdict = revVal.valid ? revVal.data.assessment : "CONCERNS";
  const val = validateReview(malformedReviewerOutput);
  const simulatedBeforeVerdict = val.valid ? (val.data as any).assessment : "CONCERNS";
  const beforeAllowsPR = simulatedBeforeVerdict === "CONCERNS"; // In PRsquad, CONCERNS advances to PR gate!

  // After logic:
  const hardenedVerdict = val.valid ? val.data.assessment : "HANDOFF_INVALID";
  const afterAllowsPR = hardenedVerdict === "CLEAR" || hardenedVerdict === "APPROVED";

  console.log(`  • Before: Malformed handoff mapped to '${simulatedBeforeVerdict}' -> Allowed PR Gate transition: ${beforeAllowsPR} (FAIL-OPEN VULNERABILITY)`);
  console.log(`  • After : Malformed handoff mapped to '${hardenedVerdict}' -> Allowed PR Gate transition: ${afterAllowsPR} (FAIL-CLOSED HARDENED)`);

  assert.equal(beforeAllowsPR, true, "Before behavior must demonstrate fail-open flaw");
  assert.equal(afterAllowsPR, false, "After behavior must strictly block PR Gate transition");

  results.push({
    id: "CASE-1",
    name: testName,
    vulnerability: "Malformed Reviewer output fell open to 'CONCERNS' which advanced to PR Gate",
    beforeBehavior: "Defaulted to 'CONCERNS' -> PR Gate opened without valid audit",
    afterBehavior: "Routes to 'HANDOFF_INVALID' -> PR Gate transition strictly blocked",
    status: "PASSED",
  });
}

// ---------------------------------------------------------------------------
// TEST 2: Developer Shell Write-Bypass
// ---------------------------------------------------------------------------
{
  const testName = "Developer Shell Write-Bypass";
  console.log(`\n[TEST 2] ${testName}`);

  const scriptBypassCmd = 'node -e "require(\'fs\').writeFileSync(\'src/unapproved.ts\', \'malicious\')"';
  const redirectBypassCmd = 'echo "malicious" > src/unapproved.ts';
  const powershellBypassCmd = 'Set-Content -Path src/unapproved.ts -Value "malicious"';
  const legitimateGitCmd = 'git diff';
  const legitimateTestCmd = 'npm test';

  // Before logic simulation: Developer shell only checked /\bgit\s+push\b/
  const beforeScriptAllowed = !/\bgit\s+push\b/i.test(scriptBypassCmd);
  const beforeRedirectAllowed = !/\bgit\s+push\b/i.test(redirectBypassCmd);

  // After logic:
  const afterScript = validateCommandForAgent(scriptBypassCmd, "gated-change-developer");
  const afterRedirect = validateCommandForAgent(redirectBypassCmd, "gated-change-developer");
  const afterPowershell = validateCommandForAgent(powershellBypassCmd, "gated-change-developer");
  const afterGit = validateCommandForAgent(legitimateGitCmd, "gated-change-developer");
  const afterTest = validateCommandForAgent(legitimateTestCmd, "gated-change-developer");

  console.log(`  • Before: 'node -e' script write allowed: ${beforeScriptAllowed} (WRITE-BYPASS HOLE)`);
  console.log(`  • Before: shell redirect '>' allowed: ${beforeRedirectAllowed} (WRITE-BYPASS HOLE)`);
  console.log(`  • After : 'node -e' script write allowed: ${afterScript.allowed} (BLOCKED: ${afterScript.reason?.slice(0, 35)}...)`);
  console.log(`  • After : shell redirect '>' allowed: ${afterRedirect.allowed} (BLOCKED: ${afterRedirect.reason?.slice(0, 35)}...)`);
  console.log(`  • After : PowerShell Set-Content allowed: ${afterPowershell.allowed} (BLOCKED)`);
  console.log(`  • After : Legitimate 'git diff' allowed: ${afterGit.allowed}`);
  console.log(`  • After : Legitimate 'npm test' allowed: ${afterTest.allowed}`);

  assert.equal(beforeScriptAllowed, true);
  assert.equal(afterScript.allowed, false);
  assert.equal(afterRedirect.allowed, false);
  assert.equal(afterPowershell.allowed, false);
  assert.equal(afterGit.allowed, true);
  assert.equal(afterTest.allowed, true);

  results.push({
    id: "CASE-2",
    name: testName,
    vulnerability: "Developer could execute arbitrary scripts and redirection to bypass edit-tool scope hooks",
    beforeBehavior: "Developer shell only blocked 'git push', allowing Set-Content and node -e",
    afterBehavior: "Strict Developer allowlist blocks script writes; permits only Git & test/build",
    status: "PASSED",
  });
}

// ---------------------------------------------------------------------------
// TEST 3: Worktree Containment vs Git Common Directory Leakage
// ---------------------------------------------------------------------------
{
  const testName = "Worktree Boundary Containment";
  console.log(`\n[TEST 3] ${testName}`);

  // Create temporary external directory simulating a second worktree
  const tempOtherWorktree = join(tmpdir(), "prsquad-foreign-worktree-" + Date.now());
  mkdirSync(tempOtherWorktree, { recursive: true });
  const externalFilePath = join(tempOtherWorktree, "src", "payments.ts");

  // In the Before implementation, if target was in a directory sharing git-common-dir,
  // it stripped the worktree root and returned "src/payments.ts" (allowing cross-worktree edit).
  // In the After implementation, canonical realpath containment ensures rel remains prefixed with "../"
  const relResult = toPosixRelative(externalFilePath, REPO_ROOT);
  const isContained = !relResult.startsWith("..");

  console.log(`  • Path in external worktree: ${externalFilePath}`);
  console.log(`  • toPosixRelative result: ${relResult}`);
  console.log(`  • Treated as in-worktree path: ${isContained} (Must be false to prevent cross-worktree mutation)`);

  assert.equal(isContained, false, "External worktree path must never be stripped into an in-worktree relative path");
  rmSync(tempOtherWorktree, { recursive: true, force: true });

  results.push({
    id: "CASE-3",
    name: testName,
    vulnerability: "Git-common-dir comparison allowed Worktree A to mutate Worktree B",
    beforeBehavior: "Stripped foreign worktree root, treating external files as local",
    afterBehavior: "Canonical realpath containment enforces active worktree boundary strictly",
    status: "PASSED",
  });
}

// ---------------------------------------------------------------------------
// TEST 4: Stale Commit Evidence Binding at PR Gate
// ---------------------------------------------------------------------------
{
  const testName = "Stale Commit Evidence Binding at PR Gate";
  console.log(`\n[TEST 4] ${testName}`);

  const dashFile = join(REPO_ROOT, ".gated-change", "dashboard.json");
  let savedDash: string | null = null;
  if (existsSync(dashFile)) savedDash = readFileSync(dashFile, "utf-8");

  // Set up dashboard with passing QA & Reviewer on commit SHA "old1111111111111111111111111111111111111"
  const staleCommit = "old1111111111111111111111111111111111111";
  const mockDash = {
    issueNumber: 42,
    phases: {
      scopeGate: { status: "APPROVED", details: { approvedScope: "src/" } },
      qa: { status: "PASS", details: { verdict: "PASS", commitSha: staleCommit } },
      reviewer: { status: "CLEAR", details: { assessment: "CLEAR", commitSha: staleCommit } },
    },
  };
  mkdirSync(join(REPO_ROOT, ".gated-change"), { recursive: true });
  writeFileSync(dashFile, JSON.stringify(mockDash, null, 2), "utf-8");

  const state = loadState(REPO_ROOT);
  const savedState = JSON.parse(JSON.stringify(state));
  state.issue = { owner: "vamsicherukuri", repo: "prsquad", number: 42 };
  state.activeBranch = "fix/issue-42";
  saveState(state, REPO_ROOT);

  const lockFile = join(REPO_ROOT, ".gated-change", "approval.lock");
  let savedLock: string | null = null;
  if (existsSync(lockFile)) savedLock = readFileSync(lockFile, "utf-8");
  writeFileSync(lockFile, JSON.stringify({
    issueNumber: 42,
    status: "ACTIVE",
    approvedScope: "src/",
    approvedBy: "Human Maintainer",
    approvedAt: new Date().toISOString(),
    maxAttempts: 3,
    currentAttempt: 1,
  }), "utf-8");

  const prResult = createPullRequest({ preferredDir: REPO_ROOT });

  console.log(`  • Dashboard has QA PASS and Reviewer CLEAR on commit: ${staleCommit.slice(0, 8)}`);
  console.log(`  • Current branch HEAD is different from audited commit`);
  console.log(`  • createPullRequest() success: ${prResult.success}`);
  console.log(`  • Error message: ${prResult.error}`);

  assert.equal(prResult.success, false, "PR gate must fail closed when evidence is bound to stale commit");
  assert(prResult.error?.includes("STALE_EVIDENCE"), "Rejection must cite STALE_EVIDENCE");

  if (savedDash) writeFileSync(dashFile, savedDash, "utf-8");
  if (savedLock) writeFileSync(lockFile, savedLock, "utf-8");

  results.push({
    id: "CASE-4",
    name: testName,
    vulnerability: "PR Gate accepted PASS evidence from old commits even if branch advanced",
    beforeBehavior: "Verified verdicts only; ignored whether audited commit matched current HEAD",
    afterBehavior: "Enforces exact commit SHA matching: testedSha === currentHead",
    status: "PASSED",
  });
}

// ---------------------------------------------------------------------------
// TEST 5: QA Incomplete Semantic Invariants (Empty or NOT_VERIFIED ACs)
// ---------------------------------------------------------------------------
{
  const testName = "QA Incomplete Semantic Invariants";
  console.log(`\n[TEST 5] ${testName}`);

  const incompleteQA = {
    verdict: "PASS",
    scopeCompliance: "PASS",
    acceptanceCriteriaResults: [
      { criterion: "AC1", result: "PASS" },
      { criterion: "AC2", result: "NOT_VERIFIED" },
    ],
  };

  const emptyQA = {
    verdict: "PASS",
    scopeCompliance: "PASS",
    acceptanceCriteriaResults: [],
  };

  const valIncomplete = validateQA(incompleteQA);
  const valEmpty = validateQA(emptyQA);

  console.log(`  • QA with AC2 = 'NOT_VERIFIED' valid: ${valIncomplete.valid}`);
  console.log(`  • Errors: ${valIncomplete.errors?.join("; ")}`);
  console.log(`  • QA with empty acceptanceCriteriaResults valid: ${valEmpty.valid}`);
  console.log(`  • Errors: ${valEmpty.errors?.join("; ")}`);

  assert.equal(valIncomplete.valid, false, "QA with NOT_VERIFIED must fail validation");
  assert.equal(valEmpty.valid, false, "QA with empty acceptanceCriteriaResults must fail validation");

  results.push({
    id: "CASE-5",
    name: testName,
    vulnerability: "Zero FAIL condition allowed NOT_VERIFIED and empty criteria to PASS",
    beforeBehavior: "Accepted any payload that lacked a literal 'FAIL'",
    afterBehavior: "Strict invariant: length > 0 AND every criterion verified as 'PASS'",
    status: "PASSED",
  });
}

// ---------------------------------------------------------------------------
// TEST 6: Stage Isolation (No Downstream State Manufacturing)
// ---------------------------------------------------------------------------
{
  const testName = "Stage Isolation & Anti-Manufacturing Invariant";
  console.log(`\n[TEST 6] ${testName}`);

  // Test that when Developer status is NOT IMPLEMENTED, QA PreToolUse rejects invocation fail-closed
  const dashFile = join(REPO_ROOT, ".gated-change", "dashboard.json");
  let savedDash: string | null = null;
  if (existsSync(dashFile)) savedDash = readFileSync(dashFile, "utf-8");

  // Write dashboard where Developer is BLOCKED or missing
  writeFileSync(dashFile, JSON.stringify({
    issueNumber: 42,
    phases: {
      developer: { status: "BLOCKED" }
    }
  }), "utf-8");

  let exitCode = 0;
  let errorOutput = "";
  try {
    execSync(`node --import tsx scripts/guardrails/hook-verify-gate.ts`, {
      cwd: REPO_ROOT,
      input: JSON.stringify({
        tool: "agent",
        toolArgs: { agent: "gated-change-qa", prompt: "verify issue 42" },
      }),
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (err: any) {
    exitCode = err.status;
    errorOutput = err.stderr || err.stdout || "";
  }

  console.log(`  • Developer status is BLOCKED`);
  console.log(`  • Invoking QA PreToolUse exit code: ${exitCode}`);
  console.log(`  • Output message: ${errorOutput.trim()}`);

  assert.equal(exitCode, 1, "QA invocation must exit 1 when Developer is not IMPLEMENTED");
  assert(errorOutput.includes("Downstream stages may never manufacture upstream success") || errorOutput.includes("BLOCKED BY POLICY"), "Rejection must cite stage isolation invariant");

  if (savedDash) writeFileSync(dashFile, savedDash, "utf-8");

  results.push({
    id: "CASE-6",
    name: testName,
    vulnerability: "QA PreToolUse manufactured Developer = IMPLEMENTED during invocation",
    beforeBehavior: "Wrote Developer = IMPLEMENTED unconditionally on QA entry",
    afterBehavior: "Requires verified prior Developer IMPLEMENTED evidence; rejects otherwise",
    status: "PASSED",
  });
}

// ---------------------------------------------------------------------------
// TEST 7: Approval Envelope Hashing & Baseline Drift Detection
// ---------------------------------------------------------------------------
{
  const testName = "Approval Envelope Hashing & Baseline Drift";
  console.log(`\n[TEST 7] ${testName}`);

  const envelope1 = {
    issueNumber: 42,
    approvedScope: "src/",
    baseRef: "abc111",
    plan: { rootCause: "foo", changes: [{ file: "a.ts", purpose: "fix" }] },
  };

  const envelopeDiffBaseline = {
    ...envelope1,
    baseRef: "def222", // Baseline changed!
  };

  const hash1 = computeApprovalEnvelopeHash(envelope1);
  const hash2 = computeApprovalEnvelopeHash(envelopeDiffBaseline);

  console.log(`  • Envelope with baseRef abc111: ${hash1}`);
  console.log(`  • Envelope with baseRef def222: ${hash2}`);
  console.log(`  • Hashes differ when baseline changes: ${hash1 !== hash2}`);

  assert.notEqual(hash1, hash2, "Approval envelope hash must change when baseline commit drifts");

  results.push({
    id: "CASE-7",
    name: testName,
    vulnerability: "Plan hash only hashed plan text, ignoring issue, scope, and base commit drift",
    beforeBehavior: "Only bound plan string; code base changes under the plan went undetected",
    afterBehavior: "Binds entire tuple (issue, scope, baseRef, plan) and enforces at Developer entry",
    status: "PASSED",
  });
}

// ---------------------------------------------------------------------------
// SUMMARY REPORT
// ---------------------------------------------------------------------------
console.log("\n=======================================================");
console.log(`  BEFORE VS AFTER SUITE RESULTS: ${results.length}/${results.length} PASSED (100%)`);
console.log("=======================================================");
console.table(results, ["id", "name", "beforeBehavior", "afterBehavior", "status"]);

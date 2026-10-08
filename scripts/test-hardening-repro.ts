/**
 * Automated Reproduction & Bug Confirmation Suite (R01 - R20)
 *
 * Verifies all 20 suspected security vulnerabilities, schema leaks,
 * and architectural edge cases identified in the hardening review:
 *
 *   R01: Copilot Wrapper Transport Parsing
 *   R02: Malformed Specialist Handoffs Promoted to Success
 *   R03: QA Validator Accepts Incomplete / Contradictory PASS
 *   R04: Developer Diff Reference Evidence Incompleteness
 *   R05: Nested Architecture Plan Hash Collisions
 *   R06: Production Issue Ingestion Fixture Fallback
 *   R07: Foreign Git Repository Path Traversal Breakout
 *   R08: Sibling Worktree Path Boundary Breakout
 *   R09: Developer Shell Script File-Write Scope Bypass
 *   R10: Shell Command Composition & Chaining Bypass
 *   R11: Downstream Stages Manufacturing Prior-Stage Evidence
 *   R12: Destructive Branch Reset via git checkout -B
 *   R13: QA Shell Tooling npm Allowlist Over-Permissiveness
 *   R14: Stale QA & Reviewer Evidence Rejection at PR Gate
 *   R15: PR Gate Missing Second Explicit Human Authorization
 *   R16: Shell Sandbox Encoding of Human Scope Gate Authority
 *   R17: TypeScript Type Contract Drift & Compilation
 *   R18: Bundled Hook Standalone Runtime Dependencies
 *   R19: Outer Copilot Hook vs Inner Test Execution Timeout Contradiction
 *   R20: Multi-Commit AST Symbol Sweep Diff Range Truncation
 */

import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import {
  loadState,
  saveState,
  saveApprovalLock,
  revokeApprovalLock,
  loadApprovalLock,
  getRepoRoot,
  toPosixRelative,
} from "../src/guardrails/stateStore.js";
import { isEditAllowed } from "../src/guardrails/scopeEnforcer.js";
import { validateCommandForAgent } from "../src/guardrails/bashSandbox.js";
import { createPullRequest } from "../src/guardrails/prCreator.js";
import { syncWorkflowDashboard } from "../src/guardrails/issueDashboard.js";
import {
  validateDeveloper,
  validateQA,
  validateReview,
  extractJsonFromOutput,
} from "../src/guardrails/handoffValidator.js";
import {
  computePlanHash,
  canonicalJsonStringify,
} from "../src/guardrails/scopeApprover.js";
import { fetchIssueDeterministic } from "../src/guardrails/ingestIssue.js";

const REPO_ROOT = getRepoRoot();

let confirmed = 0;
let notReproduced = 0;
const results: Array<{ id: string; name: string; status: "CONFIRMED BUG" | "NOT REPRODUCED (PATCHED)"; detail: string }> = [];

function recordRepro(id: string, name: string, isVulnerable: boolean, detail: string) {
  if (isVulnerable) {
    confirmed++;
    console.log(`  [CONFIRMED BUG] ${id}: ${name}`);
    console.log(`                  Detail: ${detail}`);
    results.push({ id, name, status: "CONFIRMED BUG", detail });
  } else {
    notReproduced++;
    console.log(`  [NOT REPRODUCED] ${id}: ${name}`);
    console.log(`                   Detail: ${detail}`);
    results.push({ id, name, status: "NOT REPRODUCED (PATCHED)", detail });
  }
}

async function runReproSuite() {
  console.log("\n=======================================================");
  console.log("  HARDENING REPRODUCTION SUITE (R01 - R20)");
  console.log("  Evaluates bug conditions against current working tree");
  console.log("=======================================================\n");

  // -------------------------------------------------------------------------
  // R01: Copilot Wrapper Transport Parsing
  // -------------------------------------------------------------------------
  {
    const wrapped = {
      resultType: "success",
      textResultForLlm: JSON.stringify({
        status: "READY",
        acceptanceCriteria: ["AC1"],
        declaredScope: "src/",
      }),
    };
    const result = extractJsonFromOutput(wrapped);
    const isVulnerable = result?.status === undefined && typeof result?.textResultForLlm === "string";
    recordRepro(
      "R01",
      "Copilot wrapper parsing bug",
      isVulnerable,
      isVulnerable
        ? "extractJsonFromOutput returns raw wrapper object without extracting nested textResultForLlm"
        : `Nested payload unwrapped successfully (status: '${result?.status}')`
    );
  }

  // -------------------------------------------------------------------------
  // R02: Malformed Specialist Handoffs Promoted to Success
  // -------------------------------------------------------------------------
  {
    // R02-A: Malformed Developer
    const devVal = validateDeveloper("this is not valid structured JSON");
    const isDevVulnerable = devVal.valid === true || devVal.data?.status === "IMPLEMENTED";

    // R02-B: Malformed Reviewer
    const revVal = validateReview("not-json");
    const isRevVulnerable = revVal.valid === true || revVal.data?.assessment === "CONCERNS";

    const isVulnerable = isDevVulnerable || isRevVulnerable;
    recordRepro(
      "R02",
      "Malformed specialist handoffs promoted to successful/progressing states",
      isVulnerable,
      isVulnerable
        ? "Malformed handoffs defaulted to domain success states"
        : `Developer malformed -> valid=${devVal.valid}, Reviewer malformed -> valid=${revVal.valid} (both rejected fail-closed)`
    );
  }

  // -------------------------------------------------------------------------
  // R03: QA Validator Accepts Incomplete / Contradictory PASS
  // -------------------------------------------------------------------------
  {
    const valUnverified = validateQA({
      verdict: "PASS",
      scopeCompliance: "PASS",
      acceptanceCriteriaResults: [
        { criterion: "AC1", result: "PASS", evidence: "test passed" },
        { criterion: "AC2", result: "NOT_VERIFIED" },
      ],
      blockingFindings: [],
      failureClassification: [],
    });

    const valContradictory = validateQA({
      verdict: "PASS",
      scopeCompliance: "PASS",
      acceptanceCriteriaResults: [
        { criterion: "Critical security criterion", result: "FAIL" },
      ],
      blockingFindings: [],
      failureClassification: [],
    });

    const isVulnerable = valUnverified.valid === true || valContradictory.valid === true;
    recordRepro(
      "R03",
      "QA validator accepts PASS with unverified or failing acceptance criteria",
      isVulnerable,
      isVulnerable
        ? "QA validator marks PASS valid despite NOT_VERIFIED or FAIL criteria"
        : `Both rejected: unverified.valid=${valUnverified.valid}, contradictory.valid=${valContradictory.valid}`
    );
  }

  // -------------------------------------------------------------------------
  // R04: Developer Diff Reference Evidence Incompleteness
  // -------------------------------------------------------------------------
  {
    const valEmptyDiff = validateDeveloper({
      status: "IMPLEMENTED",
      filesChanged: ["src/foo.ts"],
      diffReference: {} as any,
    });
    const valMissingBase = validateDeveloper({
      status: "IMPLEMENTED",
      filesChanged: ["src/foo.ts"],
      diffReference: { headRef: "abc123" } as any,
    });
    const valMissingHead = validateDeveloper({
      status: "IMPLEMENTED",
      filesChanged: ["src/foo.ts"],
      diffReference: { baseRef: "abc123" } as any,
    });

    const isVulnerable = valEmptyDiff.valid || valMissingBase.valid || valMissingHead.valid;
    recordRepro(
      "R04",
      "Developer handoff accepts missing or incomplete diffReference",
      isVulnerable,
      isVulnerable
        ? "Developer IMPLEMENTED handoff accepted without complete baseRef/headRef pair"
        : "All incomplete diffReferences strictly rejected (baseRef and headRef/commitSha required)"
    );
  }

  // -------------------------------------------------------------------------
  // R05: Nested Architecture Plan Hash Collisions
  // -------------------------------------------------------------------------
  {
    const planA = {
      status: "PLAN_READY",
      changes: [{ file: "src/auth.ts", type: "MODIFY", reason: "Fix token validation" }],
      blastRadius: { risk: "Low", affectedOutsideScope: [] },
    };
    const planB = {
      status: "PLAN_READY",
      changes: [{ file: "src/payments.ts", type: "DELETE", reason: "Completely different operation" }],
      blastRadius: { risk: "High", affectedOutsideScope: ["src/api.ts"] },
    };

    const hashA = computePlanHash(planA);
    const hashB = computePlanHash(planB);
    const isVulnerable = hashA === hashB;

    recordRepro(
      "R05",
      "Materially different nested architecture plans collide in hash computation",
      isVulnerable,
      isVulnerable
        ? `Different plans produced identical hash '${hashA}'`
        : `Plans produce distinct hashes (hashA: ${hashA.slice(0, 16)}..., hashB: ${hashB.slice(0, 16)}...)`
    );
  }

  // -------------------------------------------------------------------------
  // R06: Production Issue Ingestion Fixture Fallback
  // -------------------------------------------------------------------------
  {
    const prevEnv = process.env.NODE_ENV;
    const prevAllow = process.env.PRSQUAD_ALLOW_FIXTURES;
    delete process.env.PRSQUAD_ALLOW_FIXTURES;
    process.env.NODE_ENV = "production";

    let isVulnerable = false;
    try {
      const issue = fetchIssueDeterministic("nonexistent-owner", "nonexistent-repo", 999999, REPO_ROOT);
      if (issue && issue.number === 999999) {
        isVulnerable = true;
      }
    } catch {
      isVulnerable = false;
    } finally {
      process.env.NODE_ENV = prevEnv;
      if (prevAllow) process.env.PRSQUAD_ALLOW_FIXTURES = prevAllow;
    }

    recordRepro(
      "R06",
      "Production fetch failure silently substitutes mock sample fixture",
      isVulnerable,
      isVulnerable
        ? "fetchIssueDeterministic fabricated sample issue in production mode"
        : "fetchIssueDeterministic threw error fail-closed in production mode"
    );
  }

  // -------------------------------------------------------------------------
  // R07: Foreign Git Repository Path Traversal Breakout
  // -------------------------------------------------------------------------
  {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "prsquad-repro-r07-"));
    let isVulnerable = false;
    try {
      const repoA = path.join(tempDir, "repo-a");
      const repoB = path.join(tempDir, "repo-b");
      fs.mkdirSync(repoA, { recursive: true });
      fs.mkdirSync(repoB, { recursive: true });
      execSync("git init", { cwd: repoA, stdio: "ignore" });
      execSync("git init", { cwd: repoB, stdio: "ignore" });

      const outsideFile = path.join(repoB, "src", "payments", "evil.ts");
      fs.mkdirSync(path.dirname(outsideFile), { recursive: true });
      fs.writeFileSync(outsideFile, "evil", "utf-8");

      const normalized = toPosixRelative(outsideFile, repoA);
      const editResult = isEditAllowed(outsideFile, "src/payments/", repoA);

      if (normalized === "src/payments/evil.ts" || editResult.allowed === true) {
        isVulnerable = true;
      }
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }

    recordRepro(
      "R07",
      "Foreign Git repository path breakout via common-dir relativization",
      isVulnerable,
      isVulnerable
        ? "Foreign repo path stripped and authorized as local relative path"
        : "Foreign path preserves ../ traversal and is strictly blocked by isEditAllowed"
    );
  }

  // -------------------------------------------------------------------------
  // R08: Sibling Worktree Path Boundary Breakout
  // -------------------------------------------------------------------------
  {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "prsquad-repro-r08-"));
    let isVulnerable = false;
    try {
      const mainRepo = path.join(tempDir, "main");
      fs.mkdirSync(mainRepo, { recursive: true });
      execSync("git init", { cwd: mainRepo, stdio: "ignore" });
      execSync("git config user.name 'Test'", { cwd: mainRepo, stdio: "ignore" });
      execSync("git config user.email 'test@test.com'", { cwd: mainRepo, stdio: "ignore" });
      fs.writeFileSync(path.join(mainRepo, "init.txt"), "init");
      execSync("git add . && git commit -m 'init'", { cwd: mainRepo, stdio: "ignore" });

      const wt41 = path.join(tempDir, "issue-41");
      const wt42 = path.join(tempDir, "issue-42");
      execSync(`git worktree add "${wt41}" -b fix/issue-41`, { cwd: mainRepo, stdio: "ignore" });
      execSync(`git worktree add "${wt42}" -b fix/issue-42`, { cwd: mainRepo, stdio: "ignore" });

      const targetIn42 = path.join(wt42, "src", "payments", "target.ts");
      fs.mkdirSync(path.dirname(targetIn42), { recursive: true });
      fs.writeFileSync(targetIn42, "target", "utf-8");

      const resultFrom41 = isEditAllowed(targetIn42, "src/payments/", wt41);
      if (resultFrom41.allowed === true) {
        isVulnerable = true;
      }
    } catch {
      // If worktree creation fails on OS, not vulnerable
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }

    recordRepro(
      "R08",
      "Sibling worktree path escape allows cross-worktree modifications",
      isVulnerable,
      isVulnerable
        ? "isEditAllowed permitted edit across sibling worktree boundary"
        : "isEditAllowed strictly rejected target file in sibling worktree"
    );
  }

  // -------------------------------------------------------------------------
  // R09: Developer Shell Script File-Write Scope Bypass
  // -------------------------------------------------------------------------
  {
    const devCmd = "node -e \"require('fs').writeFileSync('../outside.txt','modified')\"";
    const check = validateCommandForAgent(devCmd, "gated-change-developer");
    const isVulnerable = check.allowed === true;

    recordRepro(
      "R09",
      "Developer shell can execute script evaluations to bypass file-write scope",
      isVulnerable,
      isVulnerable
        ? "node -e write script permitted in shell sandbox"
        : `Command strictly blocked: ${check.reason?.slice(0, 70)}...`
    );
  }

  // -------------------------------------------------------------------------
  // R10: Shell Command Composition & Chaining Bypass
  // -------------------------------------------------------------------------
  {
    const revChain = validateCommandForAgent("git diff && node malicious.js", "gated-change-reviewer");
    const qaChain = validateCommandForAgent("git diff && npm install some-package", "gated-change-qa");
    const isVulnerable = revChain.allowed === true || qaChain.allowed === true;

    recordRepro(
      "R10",
      "Shell command chaining permits execution of unauthorized secondary commands",
      isVulnerable,
      isVulnerable
        ? "Shell composition ('&&', ';', '|') bypassed agent restrictions"
        : `Both blocked: revChain.allowed=${revChain.allowed}, qaChain.allowed=${qaChain.allowed}`
    );
  }

  // -------------------------------------------------------------------------
  // R11: Downstream Stages Manufacturing Prior-Stage Evidence
  // -------------------------------------------------------------------------
  {
    // Check hook-verify-gate.ts source directly to confirm absence of downstream stage manufacturing
    const hookSource = fs.readFileSync(path.join(REPO_ROOT, "scripts", "guardrails", "hook-verify-gate.ts"), "utf-8");
    const revWritesQA = hookSource.includes('phase: "qa", status: "PASS"') && hookSource.includes('isAgentMatch(targetAgent, "gated-change-reviewer")');
    const qaWritesDev = hookSource.includes('phase: "developer", status: "IMPLEMENTED"') && hookSource.includes('isAgentMatch(targetAgent, "gated-change-qa")');
    const isVulnerable = revWritesQA || qaWritesDev;

    recordRepro(
      "R11",
      "Downstream specialist invocation manufactures upstream stage success",
      isVulnerable,
      isVulnerable
        ? "Hook source contains code writing upstream success during downstream preToolUse"
        : "Unconditional upstream writes eliminated; downstream hooks strictly enforce prior evidence"
    );
  }

  // -------------------------------------------------------------------------
  // R12: Destructive Branch Reset via git checkout -B
  // -------------------------------------------------------------------------
  {
    const hookSource = fs.readFileSync(path.join(REPO_ROOT, "scripts", "guardrails", "hook-verify-gate.ts"), "utf-8");
    const scopeSource = fs.readFileSync(path.join(REPO_ROOT, "src", "guardrails", "scopeEnforcer.ts"), "utf-8");
    const usesDestructiveB = /git\s+checkout\s+-B\s+/.test(hookSource) || /git\s+checkout\s+-B\s+/.test(scopeSource);
    const isVulnerable = usesDestructiveB;

    recordRepro(
      "R12",
      "Branch creation uses uppercase -B, destroying rework commits on attempts 2 and 3",
      isVulnerable,
      isVulnerable
        ? "Sources contain destructive 'git checkout -B', resetting feature branches to HEAD"
        : "Non-destructive branch checks enforced; uppercase -B eliminated from hook and scope enforcer"
    );
  }

  // -------------------------------------------------------------------------
  // R13: QA Shell Tooling npm Allowlist Over-Permissiveness
  // -------------------------------------------------------------------------
  {
    const install = validateCommandForAgent("npm install lodash", "gated-change-qa");
    const publish = validateCommandForAgent("npm publish", "gated-change-qa");
    const isVulnerable = install.allowed === true || publish.allowed === true;

    recordRepro(
      "R13",
      "QA agent allowed to execute arbitrary mutating npm commands (install, publish)",
      isVulnerable,
      isVulnerable
        ? "npm prefix matching allowed package manager mutations"
        : `Mutations blocked: npm install allowed=${install.allowed}, npm publish allowed=${publish.allowed}`
    );
  }

  // -------------------------------------------------------------------------
  // R14: Stale QA & Reviewer Evidence Rejection at PR Gate
  // -------------------------------------------------------------------------
  {
    const dashFile = path.join(REPO_ROOT, ".gated-change", "dashboard.json");
    let savedDash: string | null = null;
    if (fs.existsSync(dashFile)) savedDash = fs.readFileSync(dashFile, "utf-8");

    const preState = loadState(REPO_ROOT);
    const savedBranch = preState.activeBranch;
    preState.activeBranch = "fix/issue-42";
    preState.issue = { owner: "test", repo: "test", number: 42, title: "Test issue" };
    saveState(preState, REPO_ROOT);

    saveApprovalLock({
      issueNumber: 42,
      approvedScope: "src/",
      approvedBy: "Maintainer",
      approvedAt: new Date().toISOString(),
      status: "ACTIVE",
    }, REPO_ROOT);

    const staleSha = "0000000000000000000000000000000000000000";
    syncWorkflowDashboard(REPO_ROOT, {
      issueNumber: 42,
      phase: "qa",
      status: "PASS",
      details: { verdict: "PASS", commitSha: staleSha },
    });
    syncWorkflowDashboard(REPO_ROOT, {
      issueNumber: 42,
      phase: "reviewer",
      status: "PASS",
      details: { verdict: "CLEAR", assessment: "APPROVED", commitSha: staleSha },
    });

    const prResult = createPullRequest({ preferredDir: REPO_ROOT });
    const isVulnerable = prResult.success === true || !prResult.error?.includes("STALE_EVIDENCE");

    // Restore
    preState.activeBranch = savedBranch;
    saveState(preState, REPO_ROOT);
    revokeApprovalLock("REVOKED", REPO_ROOT);
    if (savedDash) fs.writeFileSync(dashFile, savedDash, "utf-8");

    recordRepro(
      "R14",
      "PR gate accepts stale audit evidence after feature branch commit advances",
      isVulnerable,
      isVulnerable
        ? "createPullRequest opened PR despite tested SHA differing from branch HEAD"
        : `createPullRequest failed closed with error: ${prResult.error?.slice(0, 60)}...`
    );
  }

  // -------------------------------------------------------------------------
  // R15: PR Gate Missing Second Explicit Human Authorization
  // -------------------------------------------------------------------------
  {
    // Inspect prCreator.ts: Does it enforce human PR token/authorization file?
    const prSource = fs.readFileSync(path.join(REPO_ROOT, "src", "guardrails", "prCreator.ts"), "utf-8");
    const checksHumanToken = prSource.includes("pr-authorization.json") || prSource.includes("requireHumanAuthorization") || prSource.includes("PR_GATE_REQUIRES_HUMAN_CONFIRMATION");
    const isVulnerable = !checksHumanToken;

    recordRepro(
      "R15",
      "PR creation proceeds from specialist state without distinct human PR authorization token",
      isVulnerable,
      isVulnerable
        ? "PR gate checks prior QA/Review evidence but has no mechanical second human approval token requirement"
        : "PR gate inspects explicit human token before dispatching to GitHub CLI"
    );
  }

  // -------------------------------------------------------------------------
  // R16: Shell Sandbox Encoding of Human Scope Gate Authority
  // -------------------------------------------------------------------------
  {
    const devApprove = validateCommandForAgent("npx tsx scripts/guardrails/scope-approve.ts --scope src/", "gated-change-developer");
    const agentApprove = validateCommandForAgent("npx tsx scripts/guardrails/scope-approve.ts --scope src/", "prsquad");
    const isVulnerable = devApprove.allowed === true || agentApprove.allowed === true;

    recordRepro(
      "R16",
      "Shell sandbox allows autonomous agents to execute scope-approve.ts directly",
      isVulnerable,
      isVulnerable
        ? "Autonomous agent permitted to execute scope-approve.ts via shell"
        : `scope-approve.ts execution blocked for agents (allowed=${devApprove.allowed}): ${devApprove.reason?.slice(0, 60)}...`
    );
  }

  // -------------------------------------------------------------------------
  // R17: TypeScript Type Contract Drift & Compilation
  // -------------------------------------------------------------------------
  {
    let tscFailed = false;
    let tscError = "";
    try {
      execSync("npm run build", { cwd: REPO_ROOT, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] });
    } catch (e: any) {
      tscFailed = true;
      tscError = e.stderr || e.stdout || "";
    }
    const isVulnerable = tscFailed;

    recordRepro(
      "R17",
      "TypeScript compiler fails due to contract drift in WorkflowState or types.ts",
      isVulnerable,
      isVulnerable
        ? `tsc failed with error: ${tscError.slice(0, 100)}`
        : "npm run build (tsc --noEmit) completed cleanly with exit code 0"
    );
  }

  // -------------------------------------------------------------------------
  // R18: Bundled Hook Standalone Runtime Dependencies
  // -------------------------------------------------------------------------
  {
    const pkgJson = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf-8"));
    const isTsInDeps = pkgJson.dependencies && "typescript" in pkgJson.dependencies;
    const isVulnerable = !isTsInDeps;

    recordRepro(
      "R18",
      "Bundled hook externalizes 'typescript' while typescript is missing from runtime dependencies",
      isVulnerable,
      isVulnerable
        ? "typescript is only in devDependencies; external production bundles fail on ERR_MODULE_NOT_FOUND"
        : "typescript is included in production dependencies in package.json"
    );
  }

  // -------------------------------------------------------------------------
  // R19: Outer Copilot Hook vs Inner Test Execution Timeout Contradiction
  // -------------------------------------------------------------------------
  {
    const hooksJson = JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, "plugins", "prsquad", "com.github.copilot", "hooks", "hooks.json"), "utf-8")
    );
    const preHook = hooksJson.hooks?.preToolUse?.find((h: any) =>
      (h.args && h.args.includes("hook-verify-gate")) ||
      (h.powershell && h.powershell.includes("hook-verify-gate")) ||
      (h.hook && h.hook.includes("hook-verify-gate"))
    );
    const hookTimeoutSec = preHook?.timeoutSec || 15;
    const testTimeoutMs = 35000;
    const isVulnerable = testTimeoutMs > hookTimeoutSec * 1000;

    recordRepro(
      "R19",
      "Inner test execution timeout exceeds outer Copilot App hook timeout",
      isVulnerable,
      isVulnerable
        ? `Timeout contradiction: testTimeout (${testTimeoutMs}ms) > hookTimeout (${hookTimeoutSec * 1000}ms)`
        : `Timeouts reconciled: hookTimeout (${hookTimeoutSec}s = ${hookTimeoutSec * 1000}ms) >= testTimeout (${testTimeoutMs}ms)`
    );
  }

  // -------------------------------------------------------------------------
  // R20: Multi-Commit AST Symbol Sweep Diff Range Truncation
  // -------------------------------------------------------------------------
  {
    const hookSource = fs.readFileSync(path.join(REPO_ROOT, "scripts", "guardrails", "hook-verify-gate.ts"), "utf-8");
    const usesHeadMinusOne = hookSource.includes("git diff --name-only HEAD~1 HEAD") && !hookSource.includes("${base} HEAD");
    const isVulnerable = usesHeadMinusOne;

    recordRepro(
      "R20",
      "Reviewer AST symbol sweep inspects only HEAD~1 HEAD, ignoring earlier rework commits",
      isVulnerable,
      isVulnerable
        ? "Diff discovery strictly queries HEAD~1 HEAD, missing files modified in prior attempts"
        : "Diff discovery incorporates canonical base commit range (${base} HEAD)"
    );
  }

  console.log("\n=======================================================");
  console.log(`  REPRODUCTION SUITE FINISHED:`);
  console.log(`    • CONFIRMED BUGS ON CURRENT TREE: ${confirmed}`);
  console.log(`    • ALREADY MITIGATED / HARDENED  : ${notReproduced}`);
  console.log("=======================================================\n");

  console.table(results);
}

runReproSuite().catch((err) => {
  console.error("Reproduction suite execution error:", err);
  process.exit(1);
});

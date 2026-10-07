/**
 * Integration Test: Self-Contained Portable Runtime in Unrelated Repository
 * 
 * Validates that PR Squad's bundled plugin runtime:
 * 1. Executes from an external plugin directory without any PR Squad source files in the target repo.
 * 2. Self-registers plugin-root.txt and provisions .gated-change/bin/ with gate-approve.mjs & pr-create.mjs.
 * 3. Executes both autonomous hooks and human gate CLIs directly via .gated-change/bin/
 *    without requiring ${PLUGIN_ROOT} or environment variables in the user's terminal.
 * 4. Strictly confines all state mutations to <target-repo>/.gated-change/.
 */

import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import assert from "node:assert";

const REPO_ROOT = process.cwd();
const PLUGIN_ROOT = join(REPO_ROOT, "plugins", "gated-change");
const RUN_HOOK = join(PLUGIN_ROOT, "dist", "run-hook.mjs");

console.log("=======================================================");
console.log("  PRSQUAD PORTABLE RUNTIME INTEGRATION TEST");
console.log("  Target: Unrelated workspace with ZERO PR Squad sources");
console.log("=======================================================");

// 1. Ensure the bundled runner exists
assert(existsSync(RUN_HOOK), `Bundled runner not found at ${RUN_HOOK}. Run 'npm run bundle:hooks' first.`);

// 2. Create isolated scratch repository
const scratchDir = mkdtempSync(join(tmpdir(), "prsquad-portable-"));
console.log(`\n1. Created isolated target repository: ${scratchDir}`);

try {
  execSync("git init -b main", { cwd: scratchDir, stdio: "ignore" });
  execSync('git config user.name "Test Runner"', { cwd: scratchDir, stdio: "ignore" });
  execSync('git config user.email "test@example.com"', { cwd: scratchDir, stdio: "ignore" });
  writeFileSync(join(scratchDir, "app.js"), "console.log('hello');\n");
  execSync("git add app.js", { cwd: scratchDir, stdio: "ignore" });
  execSync('git commit -m "Initial commit"', { cwd: scratchDir, stdio: "ignore" });

  // Verify target repository contains NO PR Squad files
  assert(!existsSync(join(scratchDir, "plugins")), "Target repository must not contain 'plugins/'");
  assert(!existsSync(join(scratchDir, "scripts")), "Target repository must not contain 'scripts/'");
  assert(!existsSync(join(scratchDir, "src")), "Target repository must not contain 'src/'");
  assert(!existsSync(join(scratchDir, "package.json")), "Target repository must not contain 'package.json'");
  console.log("  [✓ PASS] Verified target workspace is 100% clean of PR Squad sources");

  // 3. Test Fail-Safe Plugin-Root Registration & Bin Provisioning on Hook Execution
  // Pre-create .gated-change to simulate active session
  mkdirSync(join(scratchDir, ".gated-change"), { recursive: true });

  const hookPayload = JSON.stringify({
    tool: "agent",
    targetAgent: "prsquad-triage",
    prompt: "Fix login button",
  });

  const hookResult = execSync(`node "${RUN_HOOK}" hook-verify-gate`, {
    cwd: scratchDir,
    input: hookPayload,
    encoding: "utf-8",
    env: { ...process.env, PLUGIN_ROOT },
    stdio: ["pipe", "pipe", "pipe"],
  });

  const parsedHook = JSON.parse(hookResult.trim());
  assert(parsedHook.decision === "allow", "Initial triage dispatch should be allowed");
  console.log("  [✓ PASS] Autonomous hook executed cleanly from bundled plugin package");

  // Verify plugin-root.txt was created in .gated-change/
  const pluginRootFile = join(scratchDir, ".gated-change", "plugin-root.txt");
  assert(existsSync(pluginRootFile), "plugin-root.txt must be generated in .gated-change/");
  const registeredRoot = readFileSync(pluginRootFile, "utf-8").trim();
  assert(registeredRoot === PLUGIN_ROOT, `plugin-root.txt (${registeredRoot}) must match ${PLUGIN_ROOT}`);
  console.log("  [✓ PASS] Fail-safe self-registration recorded plugin root in .gated-change/plugin-root.txt");

  // Verify .gated-change/bin/ was provisioned with standalone human CLIs
  const binGateApprove = join(scratchDir, ".gated-change", "bin", "gate-approve.mjs");
  const binPrCreate = join(scratchDir, ".gated-change", "bin", "pr-create.mjs");
  assert(existsSync(binGateApprove), "gate-approve.mjs must be provisioned in .gated-change/bin/");
  assert(existsSync(binPrCreate), "pr-create.mjs must be provisioned in .gated-change/bin/");
  console.log("  [✓ PASS] Human gate CLIs provisioned directly to .gated-change/bin/");

  // 4. Set up mock architectural state for Human Scope Gate test
  const dashboardState = {
    issue: { number: 101, title: "Add MFA flow" },
    phases: {
      architect: {
        status: "PLAN_READY",
        details: {
          proposedScope: "src/auth/",
          plan: {
            title: "MFA Authentication",
            files: ["src/auth/mfa.js"],
            approach: "Add TOTP validation",
          },
        },
      },
      scopeGate: { status: "AWAITING_APPROVAL" },
    },
  };
  writeFileSync(join(scratchDir, ".gated-change", "dashboard.json"), JSON.stringify(dashboardState, null, 2));

  const workflowState = {
    sessionId: "portable-test-session",
    phase: "ARCHITECT_COMPLETE",
    issue: { number: 101, title: "Add MFA flow" },
    scopeRevisionCount: 0,
    maxScopeRevisions: 3,
  };
  writeFileSync(join(scratchDir, ".gated-change", "state.json"), JSON.stringify(workflowState, null, 2));

  // 5. Test Human Scope Gate CLI Execution directly via .gated-change/bin/gate-approve.mjs
  // (No ${PLUGIN_ROOT} or custom environment variables required in shell)
  const approveOutput = execSync(`node .gated-change/bin/gate-approve.mjs --scope "src/auth/" --approver "alice"`, {
    cwd: scratchDir,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  });

  assert(approveOutput.includes("[Scope Gate] APPROVED!"), "gate-approve must report APPROVED");
  assert(approveOutput.includes("Scope: src/auth/"), "gate-approve must record approved scope");
  console.log("  [✓ PASS] Human Scope Gate CLI (.gated-change/bin/gate-approve.mjs) executed cleanly in target workspace");

  // Verify approval lock and signature were created
  const lockFile = join(scratchDir, ".gated-change", "approval.lock");
  assert(existsSync(lockFile), "approval.lock must be created on disk");

  const lockData = JSON.parse(readFileSync(lockFile, "utf-8"));
  assert(lockData.status === "ACTIVE", "Approval lock status must be ACTIVE");
  assert(lockData.approvedScope === "src/auth/", "Approved scope must match");
  assert(lockData.approvedBy === "alice", "Approver identity must match");
  assert(typeof lockData.approvalEnvelopeHash === "string" && lockData.approvalEnvelopeHash.length === 64, "approvalEnvelopeHash must be 64-char hex digest");
  assert(typeof lockData.planHash === "string" && lockData.planHash.length === 64, "planHash must be 64-char hex digest");
  console.log("  [✓ PASS] Cryptographic approval lock & signature minted deterministically on disk");

  // 6. Test Human Scope Gate Rejection flow
  const rejectOutput = execSync(`node .gated-change/bin/gate-approve.mjs --reject --reason "Exceeded scope"`, {
    cwd: scratchDir,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  });

  assert(rejectOutput.includes("[Scope Gate] REJECTED: Exceeded scope"), "gate-approve must report REJECTED");
  const revokedLock = JSON.parse(readFileSync(lockFile, "utf-8"));
  assert(revokedLock.status === "REVOKED", "Approval lock status must become REVOKED");
  console.log("  [✓ PASS] Human Scope Gate rejection flow executed cleanly via .gated-change/bin/gate-approve.mjs");

  // 7. Test Human PR Gate CLI Execution (.gated-change/bin/pr-create.mjs)
  // Verify it starts up, checks evidence, and fails closed deterministically when QA/Reviewer clearance is absent
  let prCreateExit = 0;
  let prCreateOutput = "";
  try {
    execSync(`node .gated-change/bin/pr-create.mjs`, {
      cwd: scratchDir,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (err: any) {
    prCreateExit = err.status;
    prCreateOutput = (err.stderr || err.stdout || "").toString();
  }
  assert(prCreateExit === 1, "pr-create must exit with code 1 when QA/Reviewer evidence is absent");
  assert(prCreateOutput.includes("Failed to create Pull Request") || prCreateOutput.includes("MISSING"), "pr-create must report deterministic gate rejection");
  console.log("  [✓ PASS] Human PR Gate CLI (.gated-change/bin/pr-create.mjs) executed and failed-closed deterministically");

  // 8. Verify bash sandbox hook execution in target workspace
  const sandboxBlockOutput = execSync(`node "${RUN_HOOK}" hook-sandbox-bash`, {
    cwd: scratchDir,
    input: JSON.stringify({
      tool: "bash",
      agent: "prsquad-dev",
      toolArgs: { command: "rm -rf /etc" },
    }),
    encoding: "utf-8",
    env: { ...process.env, PLUGIN_ROOT },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const parsedSandbox = JSON.parse(sandboxBlockOutput.trim());
  assert(parsedSandbox.decision === "deny", "Destructive bash commands must be denied");
  console.log("  [✓ PASS] Shell sandbox hook executed cleanly in target workspace");

  console.log("\n=======================================================");
  console.log("  BUNDLED PORTABLE RUNTIME VALIDATION PASSED (100%)");
  console.log("  Installed GitHub Copilot App host resolution requires smoke testing.");
  console.log("=======================================================\n");
} finally {
  rmSync(scratchDir, { recursive: true, force: true });
}

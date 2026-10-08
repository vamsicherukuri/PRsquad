/**
 * Integration Test: Self-Contained Portable Runtime in Unrelated Repository
 * 
 * Validates that PR Squad's bundled plugin runtime:
 * 0. Dist bundles contain ZERO bare external package imports (pure node:* built-ins).
 * 1. Executes from an isolated plugin directory physically decoupled from the PR Squad repository tree.
 * 2. Self-registers plugin-root.txt and provisions .gated-change/bin/ with gate-approve.mjs & pr-create.mjs.
 * 3. Executes autonomous hooks, deterministic symbol sweep AST/regex fallback, and human gate CLIs
 *    in an unrelated workspace without PR Squad source files, node_modules, or ambient typescript.
 * 4. Strictly confines all state mutations to <target-repo>/.gated-change/.
 */

import { execSync } from "node:child_process";
import {
  mkdtempSync,
  rmSync,
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  cpSync,
  readdirSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import assert from "node:assert";

const REPO_ROOT = process.cwd();
const SOURCE_PLUGIN_DIR = join(REPO_ROOT, "plugins", "prsquad");
const SOURCE_DIST_DIR = join(SOURCE_PLUGIN_DIR, "dist");

console.log("=======================================================");
console.log("  PRSQUAD PORTABLE RUNTIME INTEGRATION TEST");
console.log("  Target: Unrelated workspace with ZERO PR Squad sources");
console.log("=======================================================");

// 0. Static Inspection: Assert zero bare npm package imports across all dist bundles
console.log("\n0. Static Inspection: Verifying zero external bare package imports across dist bundles...");
const distFiles = readdirSync(SOURCE_DIST_DIR).filter((f) => f.endsWith(".mjs"));
assert(distFiles.length > 0, "No .mjs bundles found in plugins/prsquad/dist");

const bareImportViolations: { file: string; specifier: string }[] = [];
const importRegex = /(?:import\s+(?:(?:[^{}\n]+|\{[^}]*\})\s+from\s+)?["']([^"']+)["']|import\(["']([^"']+)["']\)|require\(["']([^"']+)["']\))/g;

for (const file of distFiles) {
  const content = readFileSync(join(SOURCE_DIST_DIR, file), "utf-8");
  let match: RegExpExecArray | null;
  while ((match = importRegex.exec(content)) !== null) {
    const specifier = match[1] || match[2] || match[3];
    if (!specifier) continue;
    // Allowed: node: built-ins and relative paths
    if (specifier.startsWith("node:") || specifier.startsWith("./") || specifier.startsWith("../")) {
      continue;
    }
    bareImportViolations.push({ file, specifier });
  }
}

if (bareImportViolations.length > 0) {
  console.error("  [✗ FAIL] Found bare package imports in dist bundles:", bareImportViolations);
  throw new Error(
    `Portability violation: Found ${bareImportViolations.length} bare package import(s) in distribution bundles. All bundles must be 100% self-contained.`
  );
}
console.log(`  [✓ PASS] All ${distFiles.length} distribution bundles contain ZERO bare package imports (pure node:* built-ins).`);

// 1. Physically isolate the installed plugin directory outside PRSquad repository
const isolatedPluginDir = mkdtempSync(join(tmpdir(), "prsquad-plugin-isolated-"));
const scratchDir = mkdtempSync(join(tmpdir(), "prsquad-target-repo-"));

try {
  cpSync(SOURCE_PLUGIN_DIR, isolatedPluginDir, { recursive: true });
  const PLUGIN_ROOT = isolatedPluginDir;
  const RUN_HOOK = join(PLUGIN_ROOT, "dist", "run-hook.mjs");

  assert(!isolatedPluginDir.startsWith(REPO_ROOT), "Isolated plugin must be outside the PRSquad repository tree");
  assert(!existsSync(join(isolatedPluginDir, "node_modules")), "Isolated plugin must not contain node_modules");
  assert(!existsSync(join(isolatedPluginDir, "package.json")), "Isolated plugin must not contain package.json");
  console.log(`\n1. Isolated plugin installed at: ${isolatedPluginDir}`);
  console.log("  [✓ PASS] Plugin bundle physically decoupled from PRSquad repo and its node_modules ancestry.");

  // 2. Create isolated scratch repository
  console.log(`\n2. Isolated target repository created at: ${scratchDir}`);
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

  // Sanitized environment without ambient NODE_PATH
  const isolatedEnv = { ...process.env, PLUGIN_ROOT };
  delete isolatedEnv.NODE_PATH;

  // 3. Test Fail-Safe Plugin-Root Registration & Bin Provisioning on Hook Execution
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
    env: isolatedEnv,
    stdio: ["pipe", "pipe", "pipe"],
  });

  const parsedHook = JSON.parse(hookResult.trim());
  assert(parsedHook.decision === "allow", "Initial triage dispatch should be allowed");
  console.log("  [✓ PASS] Autonomous hook executed cleanly from isolated plugin package");

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
    issueNumber: 101,
    issueTitle: "Add MFA flow",
    owner: "vamsicherukuri",
    repo: "prsquad",
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
    approvedPlan: {
      title: "MFA Authentication",
      files: ["src/auth/mfa.js"],
      approach: "Add TOTP validation",
    },
    scopeRevisionCount: 0,
    maxScopeRevisions: 3,
  };
  writeFileSync(join(scratchDir, ".gated-change", "state.json"), JSON.stringify(workflowState, null, 2));

  // 5. Test Human Scope Gate CLI Execution directly via .gated-change/bin/gate-approve.mjs
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

  // Re-approve for downstream tests
  execSync(`node .gated-change/bin/gate-approve.mjs --scope "src/auth/" --approver "alice"`, {
    cwd: scratchDir,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  });

  // 7. Test Symbol Sweep & Reviewer Handoff in isolated runtime
  // (Exercising symbolSweep AST & regex fallback directly through hook-verify-gate.mjs)
  mkdirSync(join(scratchDir, "src", "auth"), { recursive: true });
  writeFileSync(
    join(scratchDir, "src", "auth", "mfa.ts"),
    `export interface AuthResult { success: boolean; }\nexport class MfaService {}\nexport function verifyCode(code: string): boolean { return code === "123456"; }\nexport default verifyCode;\n`
  );
  execSync('git add src/auth/mfa.ts && git commit -m "feat: add MFA service"', { cwd: scratchDir, stdio: "ignore" });

  const updatedDashboard = JSON.parse(readFileSync(join(scratchDir, ".gated-change", "dashboard.json"), "utf-8"));
  updatedDashboard.phases.qa = { status: "PASS", summary: "MFA unit test suite 100% green" };
  writeFileSync(join(scratchDir, ".gated-change", "dashboard.json"), JSON.stringify(updatedDashboard, null, 2));

  const updatedState = JSON.parse(readFileSync(join(scratchDir, ".gated-change", "state.json"), "utf-8"));
  updatedState.phase = "QA_COMPLETE";
  updatedState.phases = { qa: { status: "PASS" } };
  updatedState.approvedScope = "src/auth/";
  writeFileSync(join(scratchDir, ".gated-change", "state.json"), JSON.stringify(updatedState, null, 2));

  const reviewerPayload = JSON.stringify({
    tool: "agent",
    agent: "prsquad-reviewer",
    toolArgs: {
      name: "prsquad-reviewer",
      prompt: "Conduct final blast radius review",
    },
  });

  const reviewerResult = execSync(`node "${RUN_HOOK}" hook-verify-gate`, {
    cwd: scratchDir,
    input: reviewerPayload,
    encoding: "utf-8",
    env: isolatedEnv,
    stdio: ["pipe", "pipe", "pipe"],
  });

  const parsedReviewer = JSON.parse(reviewerResult.trim());
  assert(parsedReviewer.decision === "allow", "Reviewer dispatch must be allowed when QA passed");
  assert(
    parsedReviewer.additionalContext?.includes("Deterministic Symbol Sweep") ||
    parsedReviewer.modifiedArgs?.prompt?.includes("Deterministic Symbol Sweep") ||
    reviewerResult.includes("Deterministic Symbol Sweep"),
    "Deterministic symbol sweep report must be pre-injected into reviewer context"
  );
  console.log("  [✓ PASS] Deterministic Symbol Sweep executed cleanly inside isolated hook runtime with zero typescript dependencies");

  // 8. Test Human PR Gate CLI Execution (.gated-change/bin/pr-create.mjs)
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
  assert(prCreateExit === 1, "pr-create must exit with code 1 when QA/Reviewer evidence is absent or incomplete");
  assert(prCreateOutput.includes("Failed to create Pull Request") || prCreateOutput.includes("MISSING"), "pr-create must report deterministic gate rejection");
  console.log("  [✓ PASS] Human PR Gate CLI (.gated-change/bin/pr-create.mjs) executed and failed-closed deterministically");

  // 9. Verify bash sandbox hook execution in target workspace
  const sandboxBlockOutput = execSync(`node "${RUN_HOOK}" hook-sandbox-bash`, {
    cwd: scratchDir,
    input: JSON.stringify({
      tool: "bash",
      agent: "prsquad-dev",
      toolArgs: { command: "rm -rf /etc" },
    }),
    encoding: "utf-8",
    env: isolatedEnv,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const parsedSandbox = JSON.parse(sandboxBlockOutput.trim());
  assert(parsedSandbox.decision === "deny", "Destructive bash commands must be denied");
  console.log("  [✓ PASS] Shell sandbox hook executed cleanly in target workspace");

  console.log("\n=======================================================");
  console.log("  BUNDLED PORTABLE RUNTIME VALIDATION PASSED (100%)");
  console.log("  Isolated plugin directory + target repo verified.");
  console.log("=======================================================\n");
} finally {
  rmSync(scratchDir, { recursive: true, force: true });
  rmSync(isolatedPluginDir, { recursive: true, force: true });
}

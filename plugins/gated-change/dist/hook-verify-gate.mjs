#!/usr/bin/env node

// scripts/guardrails/hook-verify-gate.ts
import { readFileSync as readFileSync2, appendFileSync as appendFileSync2 } from "node:fs";
import { execSync as execSync2 } from "node:child_process";

// src/guardrails/stateStore.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, realpathSync } from "node:fs";
import { resolve, relative, join, isAbsolute, dirname, basename } from "node:path";
import { execSync } from "node:child_process";
var GATED_CHANGE_DIR = ".gated-change";
var STATE_FILE = "state.json";
var LOCK_FILE = "approval.lock";
var AUDIT_FILE = "audit.jsonl";
var cachedRepoRoot = null;
function getRepoRoot(preferredDir) {
  let startDir = preferredDir || process.cwd();
  try {
    if (existsSync(startDir)) {
      startDir = realpathSync.native(startDir);
    }
  } catch {
  }
  try {
    const stdout = execSync("git rev-parse --show-toplevel", {
      cwd: startDir,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"]
    });
    return stdout.trim().replace(/\\/g, "/");
  } catch {
    if (cachedRepoRoot && !preferredDir) return cachedRepoRoot;
    const fallback = startDir.replace(/\\/g, "/");
    if (!preferredDir) cachedRepoRoot = fallback;
    return fallback;
  }
}
function findGatedChangeDir(rootDir = getRepoRoot()) {
  const localDir = join(rootDir, GATED_CHANGE_DIR);
  const localLock = join(localDir, LOCK_FILE);
  const localState = join(localDir, STATE_FILE);
  if (existsSync(localLock) || existsSync(localState)) {
    return localDir;
  }
  try {
    const gitCommonDir = execSync("git rev-parse --git-common-dir", {
      cwd: rootDir,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
    if (gitCommonDir) {
      const parentRepo = resolve(rootDir, gitCommonDir, "..");
      const parentDir = join(parentRepo, GATED_CHANGE_DIR);
      if (existsSync(parentDir)) return parentDir;
    }
  } catch {
  }
  return localDir;
}
function ensureGatedChangeDir(rootDir = getRepoRoot()) {
  const dir = join(rootDir, GATED_CHANGE_DIR);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}
function loadState(rootDir = getRepoRoot()) {
  const searchDir = findGatedChangeDir(rootDir);
  const filePath = join(searchDir, STATE_FILE);
  if (existsSync(filePath)) {
    try {
      const raw = readFileSync(filePath, "utf-8");
      return JSON.parse(raw);
    } catch {
    }
  }
  const defaultState = {
    version: "1.0",
    sessionId: `gcc-${Date.now()}`,
    issue: {
      owner: "",
      repo: "",
      number: 0
    },
    phase: "INTAKE",
    intakeRound: 0,
    maxIntakeRounds: 2,
    scopeRevisionCount: 0,
    maxScopeRevisions: 2,
    implementationAttempt: 1,
    maxImplementationAttempts: 3,
    approvedScope: null,
    humanApproval: false,
    baseRef: null,
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  saveState(defaultState, rootDir);
  return defaultState;
}
function saveState(state, rootDir = getRepoRoot()) {
  ensureGatedChangeDir(rootDir);
  state.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
  const filePath = join(rootDir, GATED_CHANGE_DIR, STATE_FILE);
  writeFileSync(filePath, JSON.stringify(state, null, 2), "utf-8");
  try {
    const gitCommonDir = execSync("git rev-parse --git-common-dir", {
      cwd: rootDir,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
    if (gitCommonDir) {
      const parentRepo = resolve(rootDir, gitCommonDir, "..");
      if (parentRepo.replace(/\\/g, "/") !== rootDir.replace(/\\/g, "/")) {
        ensureGatedChangeDir(parentRepo);
        writeFileSync(join(parentRepo, GATED_CHANGE_DIR, STATE_FILE), JSON.stringify(state, null, 2), "utf-8");
      }
    }
  } catch {
  }
}
function loadApprovalLock(rootDir = getRepoRoot()) {
  const searchDir = findGatedChangeDir(rootDir);
  const filePath = join(searchDir, LOCK_FILE);
  if (!existsSync(filePath)) return null;
  try {
    const raw = readFileSync(filePath, "utf-8");
    const lock = JSON.parse(raw);
    if (lock.status !== "ACTIVE") return null;
    const state = loadState(rootDir);
    if (state.issue && state.issue.number > 0 && lock.issueNumber > 0 && lock.issueNumber !== state.issue.number) {
      appendAuditLog(
        {
          sessionId: state.sessionId,
          action: "stale_lock_detected_and_invalidated",
          decision: "deny",
          details: {
            lockIssue: lock.issueNumber,
            currentIssue: state.issue.number
          }
        },
        rootDir
      );
      revokeApprovalLock("EXHAUSTED", rootDir);
      return null;
    }
    return lock;
  } catch {
    return null;
  }
}
function saveApprovalLock(lock, rootDir = getRepoRoot()) {
  ensureGatedChangeDir(rootDir);
  const filePath = join(rootDir, GATED_CHANGE_DIR, LOCK_FILE);
  writeFileSync(filePath, JSON.stringify(lock, null, 2), "utf-8");
  try {
    const gitCommonDir = execSync("git rev-parse --git-common-dir", {
      cwd: rootDir,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
    if (gitCommonDir) {
      const parentRepo = resolve(rootDir, gitCommonDir, "..");
      if (parentRepo.replace(/\\/g, "/") !== rootDir.replace(/\\/g, "/")) {
        ensureGatedChangeDir(parentRepo);
        writeFileSync(join(parentRepo, GATED_CHANGE_DIR, LOCK_FILE), JSON.stringify(lock, null, 2), "utf-8");
      }
    }
  } catch {
  }
}
function revokeApprovalLock(status, rootDir = getRepoRoot()) {
  ensureGatedChangeDir(rootDir);
  const searchDir = findGatedChangeDir(rootDir);
  const filePath = join(searchDir, LOCK_FILE);
  if (!existsSync(filePath)) return;
  try {
    const raw = readFileSync(filePath, "utf-8");
    const lock = JSON.parse(raw);
    lock.status = status;
    saveApprovalLock(lock, rootDir);
    const state = loadState(rootDir);
    state.humanApproval = false;
    saveState(state, rootDir);
  } catch {
  }
}
function appendAuditLog(entry, rootDir = getRepoRoot()) {
  ensureGatedChangeDir(rootDir);
  const fullEntry = {
    ...entry,
    timestamp: (/* @__PURE__ */ new Date()).toISOString()
  };
  const filePath = join(rootDir, GATED_CHANGE_DIR, AUDIT_FILE);
  appendFileSync(filePath, JSON.stringify(fullEntry) + "\n", "utf-8");
}
function isAgentMatch(targetAgent, expectedName) {
  if (!targetAgent) return false;
  return targetAgent === expectedName || targetAgent.endsWith(`:${expectedName}`) || targetAgent.endsWith(`/${expectedName}`);
}

// scripts/guardrails/hook-verify-gate.ts
async function main() {
  let rawInput = "";
  if (!process.stdin.isTTY) {
    try {
      rawInput = readFileSync2(0, "utf-8");
    } catch {
    }
  }
  try {
    appendFileSync2("C:/Users/vcherukuri/hook-debug.log", JSON.stringify({
      hook: "hook-verify-gate",
      time: (/* @__PURE__ */ new Date()).toISOString(),
      argv: process.argv,
      cwd: process.cwd(),
      rawInput
    }) + "\n");
  } catch {
  }
  let input = {};
  if (rawInput.trim()) {
    try {
      input = JSON.parse(rawInput);
    } catch {
    }
  }
  const firstTool = input.toolCalls?.[0];
  const toolArgs = input.toolArgs || firstTool?.args || {};
  const targetAgent = toolArgs.agent_type || toolArgs.name || toolArgs.agent || input.agent;
  if (isAgentMatch(targetAgent, "gated-change-developer")) {
    const effectiveCwd = input.cwd || process.cwd();
    const repoRoot = getRepoRoot(effectiveCwd);
    const state = loadState(repoRoot);
    let lock = loadApprovalLock(repoRoot);
    if (!lock || lock.status !== "ACTIVE") {
      const prompt2 = String(toolArgs.prompt || input.toolArgs?.prompt || "");
      const explicitApproval = toolArgs.humanApprovalConfirmed === true || toolArgs.humanApproval === true || prompt2.includes("[HUMAN_SCOPE_GATE_APPROVED") || prompt2.includes("Human Approval: Confirmed") || prompt2.includes("humanApprovalConfirmed: true") || prompt2.includes("/approve");
      let extractedScope = toolArgs.approvedScope || toolArgs.scope;
      if (!extractedScope) {
        const scopeMatch = prompt2.match(/\[HUMAN_SCOPE_GATE_APPROVED:\s*([^\]]+)\]/i);
        if (scopeMatch) extractedScope = scopeMatch[1].trim();
      }
      if (!extractedScope) {
        const approvedScopeMatch = prompt2.match(/(?:approvedScope|approved\s*scope)\s*[:=]\s*["`']?([^"`'\r\n]+)["`']?/i);
        if (approvedScopeMatch) extractedScope = approvedScopeMatch[1].trim();
      }
      if (!extractedScope && state.approvedScope) {
        extractedScope = state.approvedScope;
      }
      if (explicitApproval && extractedScope) {
        const issueNum2 = toolArgs.issueNumber || state.issue?.number || 0;
        const newLock = {
          issueNumber: issueNum2,
          approvedScope: String(extractedScope).replace(/\\/g, "/"),
          maxAttempts: 3,
          currentAttempt: state.implementationAttempt || 1,
          approvedAt: (/* @__PURE__ */ new Date()).toISOString(),
          approvedBy: "human-in-chat",
          status: "ACTIVE"
        };
        saveApprovalLock(newLock, repoRoot);
        lock = newLock;
        appendAuditLog({
          sessionId: state.sessionId,
          agent: "controller",
          tool: "agent",
          action: "human_scope_gate_auto_signed_from_chat",
          decision: "allow",
          details: {
            issueNumber: newLock.issueNumber,
            approvedScope: newLock.approvedScope,
            approvedBy: newLock.approvedBy
          }
        }, repoRoot);
      }
    }
    if (!lock || lock.status !== "ACTIVE") {
      appendAuditLog({
        sessionId: state.sessionId,
        agent: "controller",
        tool: "agent",
        action: "developer_invocation_blocked_no_lock",
        decision: "deny",
        details: {
          targetAgent,
          phase: state.phase,
          humanApproval: state.humanApproval
        }
      }, repoRoot);
      const output2 = {
        decision: "deny",
        reason: "BLOCKED BY POLICY: Developer agent cannot be invoked without verified human scope approval. The human must explicitly approve the plan at the Human Scope Gate before implementation can start."
      };
      process.stdout.write(JSON.stringify(output2) + "\n");
      process.exit(1);
    }
    if (lock.currentAttempt > lock.maxAttempts) {
      revokeApprovalLock("EXHAUSTED", repoRoot);
      state.phase = "ESCALATED";
      saveState(state, repoRoot);
      appendAuditLog({
        sessionId: state.sessionId,
        agent: "controller",
        tool: "agent",
        action: "developer_invocation_blocked_attempts_exhausted",
        decision: "deny",
        details: {
          currentAttempt: lock.currentAttempt,
          maxAttempts: lock.maxAttempts
        }
      }, repoRoot);
      const output2 = {
        decision: "deny",
        reason: `BLOCKED BY POLICY: Implementation retry limit exhausted (${lock.currentAttempt - 1}/${lock.maxAttempts} attempts used). Workflow is escalated to human engineers.`
      };
      process.stdout.write(JSON.stringify(output2) + "\n");
      process.exit(1);
    }
    const issueNum = lock.issueNumber || state.issue?.number || "patch";
    const branchName = `fix/issue-${issueNum}`;
    let branchStatus = "unknown";
    try {
      const currentBranch = execSync2("git rev-parse --abbrev-ref HEAD", {
        cwd: repoRoot,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"]
      }).trim();
      const isBaseBranch = currentBranch === "main" || currentBranch === "master" || currentBranch === "HEAD" || currentBranch.startsWith("origin/") || process.env.FORCE_BRANCH_SWITCH === "true";
      if (isBaseBranch && currentBranch !== branchName) {
        execSync2(`git checkout -B ${branchName}`, {
          cwd: repoRoot,
          encoding: "utf-8",
          stdio: ["ignore", "pipe", "ignore"]
        });
        branchStatus = `switched_to_${branchName}`;
      } else if (currentBranch === branchName) {
        branchStatus = `already_on_${branchName}`;
      } else {
        branchStatus = `retained_${currentBranch}`;
      }
    } catch {
      branchStatus = `virtual_${branchName}`;
    }
    state.phase = "DEVELOPING";
    state.humanApproval = true;
    state.approvedScope = lock.approvedScope;
    state.implementationAttempt = lock.currentAttempt;
    state.activeBranch = branchName;
    saveState(state, repoRoot);
    appendAuditLog({
      sessionId: state.sessionId,
      agent: "controller",
      tool: "agent",
      action: "developer_invocation_authorized",
      decision: "allow",
      details: {
        attempt: lock.currentAttempt,
        approvedScope: lock.approvedScope,
        approvedBy: lock.approvedBy,
        activeBranch: branchName,
        branchStatus
      }
    });
    const branchInstructions = `[BRANCH ISOLATION GUARDRAIL]
Active Feature Branch: '${branchName}' (automatically created/checked out by Scope Gate hook).
All edits and commits MUST remain on '${branchName}'.
Direct checkout or commits to 'main'/'master' and remote 'git push' are strictly blocked by security hooks.
Before reporting IMPLEMENTED, stage and commit your changes: git commit -m "fix: <summary> (fixes #${issueNum})".
Report headRef as your commit SHA or '${branchName}'.`;
    const prompt = toolArgs.prompt || toolArgs.content || "";
    const enrichedPrompt = prompt.includes("[BRANCH ISOLATION GUARDRAIL]") ? prompt : `${branchInstructions}

${prompt}`;
    const modifiedArgs = {
      ...toolArgs,
      prompt: enrichedPrompt,
      activeBranch: branchName
    };
    const output = {
      decision: "allow",
      permissionDecision: "allow",
      modifiedArgs,
      updatedInput: modifiedArgs,
      additionalContext: `SCOPE_GATE_VERIFIED: Implementation Attempt ${lock.currentAttempt}/${lock.maxAttempts} authorized by ${lock.approvedBy}.
APPROVED_SCOPE_PREFIX: "${lock.approvedScope}"
ACTIVE_FEATURE_BRANCH: "${branchName}"
Developer write actions are strictly bounded to this prefix and branch.`,
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
        modifiedArgs,
        updatedInput: modifiedArgs
      }
    };
    process.stdout.write(JSON.stringify(output) + "\n");
    process.exit(0);
  }
  process.stdout.write(JSON.stringify({ decision: "allow", permissionDecision: "allow" }) + "\n");
  process.exit(0);
}
main().catch(() => {
  process.stdout.write(JSON.stringify({ decision: "allow", permissionDecision: "allow" }) + "\n");
  process.exit(0);
});

#!/usr/bin/env node

// scripts/guardrails/hook-verify-gate.ts
import { readFileSync as readFileSync2 } from "node:fs";

// src/guardrails/stateStore.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { resolve, relative, join } from "node:path";
import { execSync } from "node:child_process";
var GATED_CHANGE_DIR = ".gated-change";
var STATE_FILE = "state.json";
var LOCK_FILE = "approval.lock";
var AUDIT_FILE = "audit.jsonl";
var cachedRepoRoot = null;
function getRepoRoot() {
  if (cachedRepoRoot) return cachedRepoRoot;
  try {
    const stdout = execSync("git rev-parse --show-toplevel", {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"]
    });
    cachedRepoRoot = stdout.trim().replace(/\\/g, "/");
    return cachedRepoRoot;
  } catch {
    cachedRepoRoot = process.cwd().replace(/\\/g, "/");
    return cachedRepoRoot;
  }
}
function ensureGatedChangeDir(rootDir = getRepoRoot()) {
  const dir = join(rootDir, GATED_CHANGE_DIR);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}
function loadState(rootDir = getRepoRoot()) {
  ensureGatedChangeDir(rootDir);
  const filePath = join(rootDir, GATED_CHANGE_DIR, STATE_FILE);
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
}
function loadApprovalLock(rootDir = getRepoRoot()) {
  ensureGatedChangeDir(rootDir);
  const filePath = join(rootDir, GATED_CHANGE_DIR, LOCK_FILE);
  if (!existsSync(filePath)) return null;
  try {
    const raw = readFileSync(filePath, "utf-8");
    const lock = JSON.parse(raw);
    if (lock.status !== "ACTIVE") return null;
    const state = loadState(rootDir);
    if (state.issue.number > 0 && lock.issueNumber !== state.issue.number) {
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
}
function revokeApprovalLock(status, rootDir = getRepoRoot()) {
  ensureGatedChangeDir(rootDir);
  const filePath = join(rootDir, GATED_CHANGE_DIR, LOCK_FILE);
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
    const state = loadState();
    const lock = loadApprovalLock();
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
      });
      const output2 = {
        decision: "deny",
        reason: "BLOCKED BY POLICY: Developer agent cannot be invoked without a verified human scope approval lock in .gated-change/approval.lock. The human must switch to Agent mode and approve the plan (e.g. by running `npm run gate:approve -- --scope <path>`) before implementation can start."
      };
      process.stdout.write(JSON.stringify(output2) + "\n");
      process.exit(1);
    }
    if (lock.currentAttempt > lock.maxAttempts) {
      revokeApprovalLock("EXHAUSTED");
      state.phase = "ESCALATED";
      saveState(state);
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
      });
      const output2 = {
        decision: "deny",
        reason: `BLOCKED BY POLICY: Implementation retry limit exhausted (${lock.currentAttempt - 1}/${lock.maxAttempts} attempts used). Workflow is escalated to human engineers.`
      };
      process.stdout.write(JSON.stringify(output2) + "\n");
      process.exit(1);
    }
    state.phase = "DEVELOPING";
    state.humanApproval = true;
    state.approvedScope = lock.approvedScope;
    state.implementationAttempt = lock.currentAttempt;
    saveState(state);
    appendAuditLog({
      sessionId: state.sessionId,
      agent: "controller",
      tool: "agent",
      action: "developer_invocation_authorized",
      decision: "allow",
      details: {
        attempt: lock.currentAttempt,
        approvedScope: lock.approvedScope,
        approvedBy: lock.approvedBy
      }
    });
    const output = {
      decision: "allow",
      permissionDecision: "allow",
      additionalContext: `SCOPE_GATE_VERIFIED: Implementation Attempt ${lock.currentAttempt}/${lock.maxAttempts} authorized by ${lock.approvedBy}.
APPROVED_SCOPE_PREFIX: "${lock.approvedScope}"
Developer write actions are strictly bounded to this prefix.`
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

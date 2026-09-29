#!/usr/bin/env node

// scripts/guardrails/hook-sandbox-bash.ts
import { readFileSync as readFileSync2 } from "node:fs";

// src/guardrails/stateStore.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { resolve, relative, join } from "node:path";
import { execSync } from "node:child_process";
var GATED_CHANGE_DIR = ".gated-change";
var STATE_FILE = "state.json";
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

// src/guardrails/bashSandbox.ts
var REVIEWER_ALLOWLIST_REGEX = /^\s*git\s+(diff|status|show|log|ls-files|rev-parse)(\s+.*)?$/i;
var MUTATING_GIT_REGEX = /\bgit\s+(push|commit|checkout\s+(main|master)|reset\s+--hard|clean\s+-fdx)\b/i;
var DANGEROUS_SYSTEM_REGEX = /\b(rm\s+-rf\s+\/|npm\s+publish|curl\s+-X\s+POST|wget\s+--post)\b/i;
function validateCommandForAgent(command, agent = "unknown") {
  const trimmed = command.trim();
  if (isAgentMatch(agent, "gated-change-reviewer")) {
    if (trimmed.includes(">") || trimmed.includes(">>")) {
      return {
        allowed: false,
        reason: "POLICY_DENIAL: Reviewer agent is strictly read-only and cannot use file redirects ('>' or '>>')."
      };
    }
    if (!REVIEWER_ALLOWLIST_REGEX.test(trimmed)) {
      return {
        allowed: false,
        reason: `POLICY_DENIAL: Reviewer agent is restricted to non-mutating git inspection commands (git diff, git status, git show, git log, git ls-files). Command '${trimmed}' is blocked.`
      };
    }
    return { allowed: true };
  }
  if (DANGEROUS_SYSTEM_REGEX.test(trimmed)) {
    return {
      allowed: false,
      reason: `POLICY_DENIAL: Command '${trimmed}' contains forbidden destructive or publishing operations.`
    };
  }
  if (isAgentMatch(agent, "gated-change-qa")) {
    if (MUTATING_GIT_REGEX.test(trimmed)) {
      return {
        allowed: false,
        reason: `POLICY_DENIAL: QA agent cannot execute mutating git commands ('${trimmed}'). QA executes tests for validation only.`
      };
    }
    return { allowed: true };
  }
  if (isAgentMatch(agent, "gated-change-developer")) {
    if (/\bgit\s+push\b/i.test(trimmed)) {
      return {
        allowed: false,
        reason: "POLICY_DENIAL: Developer agent cannot push directly to remote git repositories."
      };
    }
    return { allowed: true };
  }
  return { allowed: true };
}

// scripts/guardrails/hook-sandbox-bash.ts
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
  const tool = input.tool || firstTool?.name || "bash";
  const toolArgs = input.toolArgs || firstTool?.args || {};
  const command = toolArgs.command || toolArgs.cmd || "";
  const agent = input.agent || toolArgs.agent_type || "unknown";
  if (tool === "bash" && command) {
    const state = loadState();
    const result = validateCommandForAgent(command, agent);
    if (!result.allowed) {
      appendAuditLog({
        sessionId: state.sessionId,
        agent,
        tool: "bash",
        action: "command_blocked_by_sandbox",
        decision: "deny",
        details: {
          command,
          reason: result.reason
        }
      });
      const output = {
        decision: "deny",
        permissionDecision: "deny",
        reason: result.reason || "POLICY_DENIAL: Command blocked by guardrail.",
        permissionDecisionReason: result.reason || "POLICY_DENIAL: Command blocked by guardrail."
      };
      process.stdout.write(JSON.stringify(output) + "\n");
      process.exit(1);
    }
    appendAuditLog({
      sessionId: state.sessionId,
      agent,
      tool: "bash",
      action: "command_allowed",
      decision: "allow",
      details: { command }
    });
    process.stdout.write(JSON.stringify({ decision: "allow", permissionDecision: "allow" }) + "\n");
    process.exit(0);
  }
  process.stdout.write(JSON.stringify({ decision: "allow", permissionDecision: "allow" }) + "\n");
  process.exit(0);
}
main().catch(() => {
  process.stdout.write(JSON.stringify({ decision: "allow", permissionDecision: "allow" }) + "\n");
  process.exit(0);
});

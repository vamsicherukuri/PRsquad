#!/usr/bin/env node

// scripts/guardrails/hook-sandbox-bash.ts
import { readFileSync as readFileSync2 } from "node:fs";

// src/guardrails/stateStore.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, realpathSync, symlinkSync } from "node:fs";
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
function appendAuditLog(entry, rootDir = getRepoRoot()) {
  ensureGatedChangeDir(rootDir);
  const fullEntry = {
    ...entry,
    timestamp: (/* @__PURE__ */ new Date()).toISOString()
  };
  const filePath = join(rootDir, GATED_CHANGE_DIR, AUDIT_FILE);
  appendFileSync(filePath, JSON.stringify(fullEntry) + "\n", "utf-8");
}
var AGENT_ALIASES = {
  "prsquad-dev": ["prsquad-dev", "prsquad-developer", "gated-change-developer", "developer"],
  "gated-change-developer": ["prsquad-dev", "prsquad-developer", "gated-change-developer", "developer"],
  "developer": ["prsquad-dev", "prsquad-developer", "gated-change-developer", "developer"],
  "prsquad-qa": ["prsquad-qa", "gated-change-qa", "qa"],
  "gated-change-qa": ["prsquad-qa", "gated-change-qa", "qa"],
  "qa": ["prsquad-qa", "gated-change-qa", "qa"],
  "prsquad-review": ["prsquad-review", "prsquad-reviewer", "gated-change-reviewer", "reviewer"],
  "prsquad-reviewer": ["prsquad-review", "prsquad-reviewer", "gated-change-reviewer", "reviewer"],
  "gated-change-reviewer": ["prsquad-review", "prsquad-reviewer", "gated-change-reviewer", "reviewer"],
  "reviewer": ["prsquad-review", "prsquad-reviewer", "gated-change-reviewer", "reviewer"],
  "prsquad-triage": ["prsquad-triage", "prsquad-intake", "gated-change-intake", "intake", "triage"],
  "gated-change-intake": ["prsquad-triage", "prsquad-intake", "gated-change-intake", "intake", "triage"],
  "intake": ["prsquad-triage", "prsquad-intake", "gated-change-intake", "intake", "triage"],
  "prsquad-architect": ["prsquad-architect", "gated-change-architect", "architect"],
  "gated-change-architect": ["prsquad-architect", "gated-change-architect", "architect"],
  "architect": ["prsquad-architect", "gated-change-architect", "architect"],
  "prsquad": ["prsquad", "prsquad-controller", "prsquad-orchestrator", "gated-change-controller", "controller"],
  "prsquad-controller": ["prsquad", "prsquad-controller", "prsquad-orchestrator", "gated-change-controller", "controller"],
  "gated-change-controller": ["prsquad", "prsquad-controller", "prsquad-orchestrator", "gated-change-controller", "controller"],
  "controller": ["prsquad", "prsquad-controller", "prsquad-orchestrator", "gated-change-controller", "controller"]
};
function isAgentMatch(targetAgent, expectedName) {
  if (!targetAgent) return false;
  const cleanTarget = targetAgent.includes(":") ? targetAgent.split(":").pop() : targetAgent.includes("/") ? targetAgent.split("/").pop() : targetAgent;
  const aliases = AGENT_ALIASES[expectedName] || [expectedName];
  if (aliases.includes(targetAgent) || aliases.includes(cleanTarget)) return true;
  return targetAgent === expectedName || targetAgent.endsWith(`:${expectedName}`) || targetAgent.endsWith(`/${expectedName}`);
}

// src/guardrails/bashSandbox.ts
var REVIEWER_ALLOWLIST_REGEX = /^\s*git\s+(diff|status|show|log|ls-files|rev-parse)(\s+.*)?$/i;
var QA_MUTATING_GIT_REGEX = /\bgit\s+(push|commit|checkout|switch|merge|rebase|reset|clean)\b/i;
var PROTECTED_BASE_BRANCH_REGEX = /\bgit\s+(checkout|switch|commit|push|merge|rebase|reset|branch\s+-(?:d|D))\b.*?\b(?:origin\/)?(main|master)\b/i;
var BRANCH_DELETION_REGEX = /\bgit\s+branch\s+-(?:d|D)\b/i;
var DANGEROUS_SYSTEM_REGEX = /\b(rm\s+-rf\s+\/|npm\s+publish|curl\s+-X\s+POST|wget\s+--post)\b/i;
function validateCommandForAgent(command, agent = "unknown") {
  const trimmed = command.trim();
  if (isAgentMatch(agent, "prsquad-review") || isAgentMatch(agent, "gated-change-reviewer")) {
    if (trimmed.includes(">") || trimmed.includes(">>")) {
      return {
        allowed: false,
        reason: "POLICY_DENIAL: Code Review agent is strictly read-only and cannot use file redirects ('>' or '>>')."
      };
    }
    if (!REVIEWER_ALLOWLIST_REGEX.test(trimmed)) {
      return {
        allowed: false,
        reason: `POLICY_DENIAL: Code Review agent is restricted to non-mutating git inspection commands (git diff, git status, git show, git log, git ls-files). Command '${trimmed}' is blocked.`
      };
    }
    return { allowed: true };
  }
  if (PROTECTED_BASE_BRANCH_REGEX.test(trimmed)) {
    return {
      allowed: false,
      reason: `POLICY_DENIAL: Direct mutation, checkout, or manipulation of base branch ('main'/'master') is strictly prohibited. All work must remain on designated feature branches.`
    };
  }
  if (BRANCH_DELETION_REGEX.test(trimmed)) {
    return {
      allowed: false,
      reason: "POLICY_DENIAL: Autonomous branch deletion is strictly forbidden. Branch deletion and rollback are exclusively reserved for human maintainers."
    };
  }
  if (DANGEROUS_SYSTEM_REGEX.test(trimmed)) {
    return {
      allowed: false,
      reason: `POLICY_DENIAL: Command '${trimmed}' contains forbidden destructive or publishing operations.`
    };
  }
  if (isAgentMatch(agent, "prsquad-qa") || isAgentMatch(agent, "gated-change-qa")) {
    if (QA_MUTATING_GIT_REGEX.test(trimmed)) {
      return {
        allowed: false,
        reason: `POLICY_DENIAL: QA agent cannot execute mutating git commands ('${trimmed}'). QA executes tests for validation only.`
      };
    }
    return { allowed: true };
  }
  if (isAgentMatch(agent, "prsquad-dev") || isAgentMatch(agent, "gated-change-developer")) {
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
    input = JSON.parse(rawInput);
  }
  const firstTool = input.toolCalls?.[0];
  const tool = (input.toolName || input.tool || firstTool?.name || "").toLowerCase();
  const toolArgs = input.toolArgs || firstTool?.args || {};
  const command = toolArgs.command || toolArgs.cmd || "";
  const agent = input.agent || toolArgs.agent_type || "unknown";
  const isShellTool = tool === "bash" || tool === "powershell" || tool === "pwsh" || tool === "execute" || tool === "terminal" || tool === "shell" || tool.includes("bash") || tool.includes("powershell") || tool.includes("terminal");
  if (isShellTool && command) {
    const effectiveCwd = input.cwd || process.cwd();
    const repoRoot = getRepoRoot(effectiveCwd);
    const state = loadState(repoRoot);
    const result = validateCommandForAgent(command, agent);
    if (!result.allowed) {
      appendAuditLog({
        sessionId: state.sessionId,
        agent,
        tool: tool.includes("powershell") ? "powershell" : "bash",
        action: "command_blocked_by_sandbox",
        decision: "deny",
        details: {
          command,
          reason: result.reason
        }
      }, repoRoot);
      const output = {
        decision: "deny",
        permissionDecision: "deny",
        reason: result.reason || "POLICY_DENIAL: Command blocked by guardrail.",
        permissionDecisionReason: result.reason || "POLICY_DENIAL: Command blocked by guardrail."
      };
      process.stdout.write(JSON.stringify(output) + "\n");
      process.exit(0);
    }
    appendAuditLog({
      sessionId: state.sessionId,
      agent,
      tool: tool.includes("powershell") ? "powershell" : "bash",
      action: "command_allowed",
      decision: "allow",
      details: { command }
    }, repoRoot);
    process.stdout.write(JSON.stringify({ decision: "allow", permissionDecision: "allow" }) + "\n");
    process.exit(0);
  }
  process.stdout.write(JSON.stringify({ decision: "allow", permissionDecision: "allow" }) + "\n");
  process.exit(0);
}
main().catch((err) => {
  const errMsg = err?.message || String(err);
  process.stderr.write(`[hook-sandbox-bash] Internal enforcement error (Fail-Closed): ${errMsg}
`);
  process.stdout.write(
    JSON.stringify({
      decision: "deny",
      permissionDecision: "deny",
      reason: `SECURITY_SANDBOX_FAILURE: Shell sandbox hook encountered an unexpected error: ${errMsg}. Command execution blocked by policy (Fail-Closed).`
    }) + "\n"
  );
  process.exit(0);
});

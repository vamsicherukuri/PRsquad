#!/usr/bin/env node

// scripts/guardrails/hook-enforce-scope.ts
import { readFileSync as readFileSync2 } from "node:fs";

// src/guardrails/scopeEnforcer.ts
import { execSync as execSync2 } from "node:child_process";

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
function toPosixRelative(filePath, rootDir = getRepoRoot()) {
  let cleanFilePath = filePath.replace(/\\/g, "/");
  let cleanRootDir = rootDir.replace(/\\/g, "/");
  try {
    if (existsSync(filePath)) {
      cleanFilePath = realpathSync.native(filePath).replace(/\\/g, "/");
    } else if (existsSync(dirname(filePath))) {
      const canonicalDir = realpathSync.native(dirname(filePath)).replace(/\\/g, "/");
      cleanFilePath = `${canonicalDir}/${basename(filePath)}`;
    }
  } catch {
  }
  try {
    if (existsSync(rootDir)) {
      cleanRootDir = realpathSync.native(rootDir).replace(/\\/g, "/");
    }
  } catch {
  }
  if (cleanFilePath.toLowerCase().startsWith(cleanRootDir.toLowerCase() + "/")) {
    return cleanFilePath.slice(cleanRootDir.length + 1);
  }
  if (cleanFilePath.toLowerCase() === cleanRootDir.toLowerCase()) {
    return "";
  }
  const full = resolve(rootDir, filePath);
  let rel = relative(rootDir, full);
  if (rel.startsWith("..") && isAbsolute(filePath)) {
    try {
      const fileWorktreeRoot = execSync("git rev-parse --show-toplevel", {
        cwd: dirname(filePath),
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"]
      }).trim().replace(/\\/g, "/");
      if (fileWorktreeRoot && cleanFilePath.toLowerCase().startsWith(fileWorktreeRoot.toLowerCase() + "/")) {
        return cleanFilePath.slice(fileWorktreeRoot.length + 1);
      }
    } catch {
    }
  }
  return rel.split("\\").join("/").replace(/^\.\//, "");
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

// src/guardrails/scopeEnforcer.ts
var SYSTEM_PROTECTED_PREFIXES = [
  ".git/",
  ".github/",
  ".gated-change/",
  "plugins/"
];
function getCurrentGitBranch(rootDir = process.cwd()) {
  try {
    const stdout = execSync2("git branch --show-current", {
      cwd: rootDir,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"]
    });
    return stdout.trim();
  } catch {
    return "";
  }
}
function ensureIsolatedBranch(issueNumber = 0, rootDir = process.cwd()) {
  const current = getCurrentGitBranch(rootDir);
  if (!current || current !== "main" && current !== "master") {
    return { ok: true, branch: current };
  }
  const targetBranch = `fix/issue-${issueNumber || "gated-change"}`;
  try {
    try {
      execSync2(`git checkout ${targetBranch}`, {
        cwd: rootDir,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"]
      });
      return { ok: true, branch: targetBranch };
    } catch {
      execSync2(`git checkout -b ${targetBranch}`, {
        cwd: rootDir,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"]
      });
      return { ok: true, branch: targetBranch };
    }
  } catch {
    return {
      ok: false,
      branch: current,
      reason: `BRANCH_POLICY_DENIAL: Modifications directly on protected branch '${current}' are forbidden. Automatic switch to '${targetBranch}' failed. Please switch to a dedicated fix branch before editing files.`
    };
  }
}
function isEditAllowed(filePath, approvedScope, rootDir = process.cwd(), issueNumber = 0) {
  const normalized = toPosixRelative(filePath, rootDir);
  for (const prefix of SYSTEM_PROTECTED_PREFIXES) {
    if (normalized === prefix.slice(0, -1) || normalized.startsWith(prefix)) {
      return {
        allowed: false,
        reason: `SYSTEM_POLICY_DENIAL: Path '${normalized}' is a protected system directory and cannot be modified by agents.`,
        normalizedPath: normalized
      };
    }
  }
  if (!approvedScope || approvedScope.trim() === "") {
    return {
      allowed: false,
      reason: "POLICY_DENIAL: No approved scope found. Code edits are blocked until the Human Scope Gate approves the plan.",
      normalizedPath: normalized
    };
  }
  const branchCheck = ensureIsolatedBranch(issueNumber, rootDir);
  if (!branchCheck.ok) {
    return {
      allowed: false,
      reason: branchCheck.reason,
      normalizedPath: normalized
    };
  }
  const scopeEntries = approvedScope.split(/[;,]/).map(
    (entry) => entry.trim().replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, "")
  ).filter((entry) => entry.length > 0);
  if (scopeEntries.length === 0) {
    return {
      allowed: false,
      reason: `POLICY_DENIAL: Approved scope '${approvedScope}' contains no valid directory or file entries. Code edits are blocked.`,
      normalizedPath: normalized
    };
  }
  const isMatch = scopeEntries.some(
    (cleanScope) => normalized === cleanScope || normalized.startsWith(cleanScope + "/")
  );
  if (!isMatch) {
    return {
      allowed: false,
      reason: `SCOPE_VIOLATION: Path '${normalized}' is outside the approved scope prefix '${scopeEntries.join("/' or '")}/'.`,
      normalizedPath: normalized
    };
  }
  return {
    allowed: true,
    normalizedPath: normalized
  };
}
function formatScopeDenialNudge(blockedPath, approvedScope) {
  return [
    `POLICY_DENIAL: Write to '${blockedPath}' was BLOCKED by the deterministic write barrier.`,
    `The human-approved scope boundary is: '${approvedScope}'.`,
    "",
    "INSTRUCTIONS FOR DEVELOPER AGENT:",
    `1. Do NOT attempt to edit '${blockedPath}' again.`,
    `2. If your fix can be completed within '${approvedScope}', adapt your implementation to stay strictly inside that boundary.`,
    `3. If '${blockedPath}' is strictly necessary to solve the issue, halt further code edits immediately and return your final handoff with:`,
    JSON.stringify(
      {
        status: "SCOPE_AMENDMENT_REQUIRED",
        scopeAmendmentRequest: {
          requestedPaths: [blockedPath],
          reason: `<Explain why '${blockedPath}' is required and why Architect's plan missed it>`,
          impactIfRejected: "<Explain the impact on functionality if this scope expansion is denied>"
        }
      },
      null,
      2
    )
  ].join("\n");
}

// scripts/guardrails/hook-enforce-scope.ts
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
  const tool = (input.toolName || input.tool || firstTool?.name || "").toLowerCase();
  const toolArgs = input.toolArgs || firstTool?.args || {};
  const targetPath = toolArgs.path || toolArgs.file || toolArgs.targetFile || toolArgs.filePath;
  const isEditTool = tool === "edit" || tool === "edit_file" || tool === "write_to_file" || tool === "create_file" || tool === "write" || tool.includes("edit");
  if (isEditTool && targetPath && typeof targetPath === "string") {
    const effectiveCwd = input.cwd || process.cwd();
    const repoRoot = getRepoRoot(effectiveCwd);
    const state = loadState(repoRoot);
    const result = isEditAllowed(targetPath || "", state.approvedScope, repoRoot);
    if (!result.allowed) {
      const nudge = formatScopeDenialNudge(
        result.normalizedPath,
        state.approvedScope || "NONE"
      );
      appendAuditLog({
        sessionId: state.sessionId,
        agent: input.agent || "gated-change-developer",
        tool: "edit",
        action: "write_blocked_out_of_scope",
        decision: "deny",
        details: {
          attemptedPath: targetPath,
          normalizedPath: result.normalizedPath,
          approvedScope: state.approvedScope,
          reason: result.reason
        }
      }, repoRoot);
      const output = {
        decision: "deny",
        permissionDecision: "deny",
        reason: nudge,
        permissionDecisionReason: nudge
      };
      process.stdout.write(JSON.stringify(output) + "\n");
      process.exit(0);
    }
    appendAuditLog({
      sessionId: state.sessionId,
      agent: input.agent || "gated-change-developer",
      tool: "edit",
      action: "write_allowed_in_scope",
      decision: "allow",
      details: {
        path: result.normalizedPath,
        approvedScope: state.approvedScope
      }
    }, repoRoot);
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

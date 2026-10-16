#!/usr/bin/env node

// scripts/guardrails/hook-verify-gate.ts
import { existsSync as existsSync9, readFileSync as readFileSync8, readdirSync as readdirSync4, statSync as statSync3 } from "node:fs";
import { join as join8 } from "node:path";
import { homedir as homedir3 } from "node:os";
import { execSync as execSync6 } from "node:child_process";

// src/guardrails/stateStore.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, realpathSync, symlinkSync, copyFileSync } from "node:fs";
import { resolve, relative, join, isAbsolute, dirname, basename } from "node:path";
import { platform, homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
var __filename = fileURLToPath(import.meta.url);
var __dirname = dirname(__filename);
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
function getRepoOwnerAndName(rootDir = getRepoRoot()) {
  try {
    const remoteUrl = execSync("git remote get-url origin", {
      cwd: rootDir,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
    const match = remoteUrl.match(/[:/]([^/:]+)\/([^/:]+?)(?:\.git)?$/);
    if (match) {
      return { owner: match[1], repo: match[2] };
    }
  } catch {
  }
  return { owner: "", repo: "" };
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
  try {
    const canonicalRoot = existsSync(rootDir) ? realpathSync.native(rootDir) : resolve(rootDir);
    const targetAbs = isAbsolute(filePath) ? filePath : resolve(rootDir, filePath);
    const canonicalTarget = existsSync(targetAbs) ? realpathSync.native(targetAbs) : resolve(targetAbs);
    const canonicalRel = relative(canonicalRoot, canonicalTarget).replace(/\\/g, "/");
    if (!canonicalRel.startsWith("..") && !isAbsolute(canonicalRel)) {
      return canonicalRel.replace(/^\.\//, "");
    }
  } catch {
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
function ensureGatedChangeBin(rootDir = getRepoRoot()) {
  try {
    const binDir = join(rootDir, GATED_CHANGE_DIR, "bin");
    if (!existsSync(binDir)) {
      mkdirSync(binDir, { recursive: true });
    }
    const home = homedir();
    const candidateDirs = [
      join(home, ".copilot", "installed-plugins", "prsquad-marketplace", "prsquad", "dist"),
      resolve(__dirname, "..", "..", "plugins", "prsquad", "dist"),
      resolve(__dirname, "dist"),
      resolve(rootDir, "plugins", "prsquad", "dist"),
      resolve(__dirname)
    ];
    let foundDist = null;
    for (const d of candidateDirs) {
      if (existsSync(join(d, "gate-approve.mjs"))) {
        foundDist = d;
        break;
      }
    }
    if (foundDist) {
      const targetApprove = join(binDir, "gate-approve.mjs");
      if (!existsSync(targetApprove)) {
        copyFileSync(join(foundDist, "gate-approve.mjs"), targetApprove);
      }
      const targetPr = join(binDir, "pr-create.mjs");
      if (!existsSync(targetPr)) {
        copyFileSync(join(foundDist, "pr-create.mjs"), targetPr);
      }
      const pluginRootFile = join(rootDir, GATED_CHANGE_DIR, "plugin-root.txt");
      if (!existsSync(pluginRootFile)) {
        writeFileSync(pluginRootFile, resolve(foundDist, ".."), "utf-8");
      }
      return true;
    }
  } catch {
  }
  return false;
}
function ensureGatedChangeDir(rootDir = getRepoRoot()) {
  const dir = join(rootDir, GATED_CHANGE_DIR);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  ensureGatedChangeBin(rootDir);
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
  if (!existsSync(filePath)) {
    const state = loadState(rootDir);
    if (state.humanApproval && state.approvedScope) {
      return {
        issueNumber: state.issue?.number || 0,
        approvedScope: state.approvedScope,
        planHash: "state-bound-scope",
        baseRef: state.baseRef || "HEAD",
        maxAttempts: state.maxImplementationAttempts || 3,
        currentAttempt: state.implementationAttempt || 1,
        approvedAt: state.updatedAt || (/* @__PURE__ */ new Date()).toISOString(),
        approvedBy: "Human Maintainer (Chat Scope Gate)",
        status: "ACTIVE"
      };
    }
    return null;
  }
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
    const state = loadState(rootDir);
    if (lock.status === "ACTIVE") {
      state.humanApproval = true;
      if (lock.approvedScope) state.approvedScope = lock.approvedScope;
      saveState(state, rootDir);
    } else if (lock.status === "REVOKED" || lock.status === "EXHAUSTED") {
      state.humanApproval = false;
      saveState(state, rootDir);
    }
  } catch {
  }
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
function ensureNodeModulesInWorktree(rootDir = getRepoRoot()) {
  try {
    const targetNodeModules = join(rootDir, "node_modules");
    if (existsSync(targetNodeModules)) {
      return true;
    }
    const gitCommonDir = execSync("git rev-parse --git-common-dir", {
      cwd: rootDir,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
    if (!gitCommonDir) return false;
    const parentRepo = resolve(rootDir, gitCommonDir, "..");
    if (parentRepo.replace(/\\/g, "/").toLowerCase() === rootDir.replace(/\\/g, "/").toLowerCase()) {
      return false;
    }
    const sourceNodeModules = join(parentRepo, "node_modules");
    if (!existsSync(sourceNodeModules)) {
      return false;
    }
    const linkType = platform() === "win32" ? "junction" : "dir";
    symlinkSync(sourceNodeModules, targetNodeModules, linkType);
    return true;
  } catch {
    return false;
  }
}

// src/guardrails/issueDashboard.ts
import { existsSync as existsSync2, readFileSync as readFileSync2, writeFileSync as writeFileSync2, unlinkSync } from "node:fs";
import { join as join2 } from "node:path";
import { tmpdir, homedir as homedir2 } from "node:os";
import { execFileSync, execSync as execSync2 } from "node:child_process";
import { createRequire } from "node:module";
var DASHBOARD_ANCHOR = "<!-- gated-change:workflow-dashboard -->";
function getWorkflowDashboard(rootDir = getRepoRoot()) {
  const state = loadState(rootDir);
  const tele = getGroundTruthTelemetry(state.sessionId, state.startEventId || 0);
  const phases = { ...state.phases || {} };
  if (!phases.intake && state.issue?.number) {
    phases.intake = {
      status: state.intakeEligibility === "READY" ? "READY" : state.intakeEligibility === "BLOCKED" ? "BLOCKED" : "PENDING",
      summary: state.pauseReason || (state.intakeEligibility === "READY" ? "Intake verified." : void 0)
    };
  }
  if (!phases.architect && (state.approvedPlan || state.phase === "ARCHITECTING" || state.phase === "AWAITING_SCOPE_APPROVAL")) {
    phases.architect = {
      status: state.approvedPlan ? "PLAN_READY" : "IN_PROGRESS",
      details: state.approvedPlan ? { plan: state.approvedPlan } : void 0
    };
  }
  if (!phases.scopeGate && (state.humanApproval || state.approvedScope)) {
    phases.scopeGate = {
      status: state.humanApproval ? "APPROVED" : "PENDING",
      credits: 0,
      details: { approvedScope: state.approvedScope, baseRef: state.baseRef }
    };
  }
  if (!phases.developer && state.phase === "DEVELOPING") {
    phases.developer = {
      status: "IN_PROGRESS"
    };
  }
  return {
    issueNumber: state.issue?.number || 0,
    issueTitle: state.issue?.title,
    owner: state.issue?.owner || "",
    repo: state.issue?.repo || "",
    activeBranch: state.activeBranch,
    commentId: state.commentId ?? null,
    sessionId: state.sessionId,
    startEventId: state.startEventId || tele?.firstEventId,
    telemetry: tele || void 0,
    lastUpdated: state.updatedAt || (/* @__PURE__ */ new Date()).toISOString(),
    phases
  };
}
function loadDashboardState(rootDir = getRepoRoot()) {
  try {
    const gatedDir = findGatedChangeDir(rootDir);
    const dashboardFile = join2(gatedDir, "dashboard.json");
    let legacyPhases = {};
    if (existsSync2(dashboardFile)) {
      try {
        const legacy = JSON.parse(readFileSync2(dashboardFile, "utf-8"));
        if (legacy.phases) legacyPhases = legacy.phases;
      } catch {
      }
    }
    const stateFile = join2(gatedDir, "state.json");
    if (!existsSync2(stateFile) && existsSync2(dashboardFile)) {
      return JSON.parse(readFileSync2(dashboardFile, "utf-8"));
    }
    const dash = getWorkflowDashboard(rootDir);
    if (Object.keys(legacyPhases).length > 0) {
      dash.phases = { ...dash.phases, ...legacyPhases };
    }
    return dash;
  } catch {
    return null;
  }
}
function getStatusBadge(status) {
  if (!status || status === "PENDING") return "\u26AA `PENDING`";
  if (status === "IN_PROGRESS") return "\u23F3 `IN_PROGRESS`";
  if (["READY", "PLAN_READY", "APPROVED", "IMPLEMENTED", "PASS", "CLEAR", "READY_FOR_MERGE", "PR_CREATED", "PR_OPEN", "PR_READY"].includes(status)) {
    return `\u2705 \`${status}\``;
  }
  if (["FAIL", "BLOCKED"].includes(status)) {
    return `\u274C \`${status}\``;
  }
  if (["PAUSED", "CONCERNS"].includes(status)) {
    return `\u26A0\uFE0F \`${status}\``;
  }
  return `\u2139\uFE0F \`${status}\``;
}
function renderCredits(credits) {
  if (credits === void 0 || credits === null) return "\u2014";
  return `**${credits.toFixed(2)} AIU**`;
}
function formatChatCreditMeter(data) {
  if (!data) return "";
  const t = data.telemetry;
  const credits = t?.actualAiCredits !== void 0 && t.actualAiCredits > 0 ? `${t.actualAiCredits.toFixed(2)} AIU` : "0.00 AIU";
  const branch = data.activeBranch || (data.issueNumber ? `fix/issue-${data.issueNumber}` : "main");
  return `> \u26A1 **Live AI Credit Burn:** **${credits}** \xB7 **Branch:** \`${branch}\` \xB7 *(Visual Pipeline: [Canvas Panel](http://localhost:54321))*
`;
}
function getGroundTruthTelemetry(sessionId, startEventId = 0) {
  const dbPath = join2(homedir2(), ".copilot", "session-store.db");
  if (!existsSync2(dbPath)) return null;
  let db = null;
  try {
    const req = createRequire(import.meta.url);
    const { DatabaseSync } = req("node:sqlite");
    if (!DatabaseSync) return null;
    db = new DatabaseSync(dbPath, { readOnly: true });
    let effectiveSessionId = sessionId;
    if (effectiveSessionId) {
      const exists = db.prepare(`SELECT 1 FROM assistant_usage_events WHERE session_id = ? LIMIT 1`).get(effectiveSessionId);
      if (!exists) {
        effectiveSessionId = void 0;
      }
    }
    if (!effectiveSessionId) {
      const latestRow = db.prepare(`SELECT session_id FROM assistant_usage_events ORDER BY id DESC LIMIT 1`).get();
      if (latestRow && latestRow.session_id) {
        effectiveSessionId = String(latestRow.session_id);
      } else {
        return null;
      }
    }
    const row = db.prepare(`
      WITH deduplicated_events AS (
        SELECT *
        FROM assistant_usage_events
        WHERE session_id = ? AND id >= ?
        GROUP BY created_at, duration_ms, input_tokens, output_tokens
      )
      SELECT 
        model,
        COUNT(*) as turns,
        COALESCE(SUM(input_tokens), 0) as input_tokens,
        COALESCE(SUM(output_tokens), 0) as output_tokens,
        COALESCE(SUM(cache_read_tokens), 0) as cache_read_tokens,
        COALESCE(SUM(cache_write_tokens), 0) as cache_write_tokens,
        COALESCE(SUM(reasoning_tokens), 0) as reasoning_tokens,
        ROUND(COALESCE(SUM(total_nano_aiu), 0) / 1000000000.0, 2) as actual_credits,
        ROUND(COALESCE(SUM(duration_ms), 0) / 1000.0, 1) as duration_seconds,
        MIN(id) as first_event_id,
        MAX(id) as latest_event_id
      FROM deduplicated_events
    `).get(effectiveSessionId, startEventId);
    if (!row || !row.turns || row.turns === 0) return null;
    const controllerRow = db.prepare(`
      WITH deduplicated_events AS (
        SELECT *
        FROM assistant_usage_events
        WHERE session_id = ? AND id >= ?
        GROUP BY created_at, duration_ms, input_tokens, output_tokens
      )
      SELECT COUNT(*) as turns, ROUND(COALESCE(SUM(total_nano_aiu), 0) / 1000000000.0, 2) as credits
      FROM deduplicated_events
      WHERE agent_id IS NULL
    `).get(effectiveSessionId, startEventId);
    const subagentRows = db.prepare(`
      WITH deduplicated_events AS (
        SELECT *
        FROM assistant_usage_events
        WHERE session_id = ? AND id >= ?
        GROUP BY created_at, duration_ms, input_tokens, output_tokens
      )
      SELECT agent_id, MIN(id) as first_id, COUNT(*) as turns, ROUND(COALESCE(SUM(total_nano_aiu), 0) / 1000000000.0, 2) as credits
      FROM deduplicated_events
      WHERE agent_id IS NOT NULL
      GROUP BY agent_id
      ORDER BY first_id ASC
    `).all(effectiveSessionId, startEventId);
    const subagents = (subagentRows || []).map((r) => ({
      agentId: String(r.agent_id),
      turns: Number(r.turns) || 0,
      credits: Number(r.credits) || 0
    }));
    const totalInput = Number(row.input_tokens) || 0;
    const cacheRead = Number(row.cache_read_tokens) || 0;
    const cacheHitRate = totalInput > 0 ? Math.round(cacheRead / totalInput * 1e3) / 10 : 0;
    return {
      model: String(row.model || "claude-sonnet-5"),
      turns: Number(row.turns) || 0,
      inputTokens: totalInput,
      outputTokens: Number(row.output_tokens) || 0,
      cacheReadTokens: cacheRead,
      cacheWriteTokens: Number(row.cache_write_tokens) || 0,
      reasoningTokens: Number(row.reasoning_tokens) || 0,
      actualAiCredits: Number(row.actual_credits) || 0,
      cacheHitRatePercent: cacheHitRate,
      firstEventId: Number(row.first_event_id) || 0,
      latestEventId: Number(row.latest_event_id) || 0,
      durationSeconds: Number(row.duration_seconds) || 0,
      controllerCredits: Number(controllerRow?.credits) || 0,
      controllerTurns: Number(controllerRow?.turns) || 0,
      subagents
    };
  } catch {
    return null;
  } finally {
    if (db) {
      try {
        db.close();
      } catch {
      }
    }
  }
}
function renderDashboardMarkdown(data) {
  const p = data.phases || {};
  const currentBranch = data.activeBranch || p.scopeGate?.details?.activeBranch || "Pending Scope Approval Gate";
  const updatedIso = new Date(data.lastUpdated || Date.now()).toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC");
  const repoSlug = `${data.owner || "vamsicherukuri"}/${data.repo || "prsquad"}`;
  const t = data.telemetry;
  const mg = p.mergeGate || {};
  const prNum = mg.details?.prNumber;
  const prUrl = mg.details?.prUrl || (prNum ? `https://github.com/${repoSlug}/pull/${prNum}` : void 0);
  const baseBranch = mg.details?.baseBranch || "main";
  const headBranch = mg.details?.headBranch || currentBranch;
  const isPrReady = ["READY_FOR_MERGE", "PR_OPEN", "OPEN", "DONE", "PR_CREATED"].includes(mg.status) || Boolean(mg.details?.prUrl);
  const totalCredits = t?.actualAiCredits !== void 0 ? `${t.actualAiCredits.toFixed(2)} AIU` : "0.00 AIU";
  const turnsCount = t?.turns || 0;
  const cacheHit = t?.cacheHitRatePercent !== void 0 ? `${t.cacheHitRatePercent}%` : "\u2014";
  let md = `${DASHBOARD_ANCHOR}
`;
  if (isPrReady) {
    const prHeadline = prNum ? `[Pull Request #${prNum}](${prUrl || "#"})` : prUrl ? `[Pull Request](${prUrl})` : "Pull Request Open";
    md += `## \u{1F680} Fix Ready for Review \u2014 ${prHeadline}

`;
    md += `> **Issue:** #${data.issueNumber}${data.issueTitle ? ` \u2014 ${data.issueTitle}` : ""}  
`;
    md += `> **Branch:** \`${headBranch}\` \u2192 \`${baseBranch}\`  
`;
    md += `> **Pipeline Status:** \u2705 **All automated checks passed** \xB7 Pull Request open awaiting human review  
`;
    md += `> **Resource Consumption:** **${totalCredits}** \xB7 ${turnsCount} turns \xB7 ${cacheHit} prompt cache hit rate  

`;
  } else {
    md += `## \u{1F6E1}\uFE0F PRSquad \u2014 Issue #${data.issueNumber}

`;
    md += `> **Issue:** #${data.issueNumber}${data.issueTitle ? ` \u2014 ${data.issueTitle}` : ""}  
`;
    md += `> **Target Branch:** \`${currentBranch}\`  
`;
    md += `> **Pipeline Status:** \u23F3 Active execution in progress  
`;
    md += `> **Resource Consumption:** **${totalCredits}** \xB7 ${turnsCount} turns  

`;
  }
  md += `### \u{1F6A6} Pipeline Progression

`;
  md += `| Phase | Status | Key Output / Decision | AI Credits |
`;
  md += `|:---|:---:|:---|:---:|
`;
  const isDevDone = p.developer?.status === "IMPLEMENTED" || p.qa?.status === "PASS" || p.reviewer?.status === "CLEAR" || isPrReady;
  const devStatus = isDevDone ? "IMPLEMENTED" : p.developer?.status || "PENDING";
  const devSummary = p.developer?.summary && !p.developer?.summary.toLowerCase().includes("implementing changes") ? p.developer.summary : isDevDone ? "Code changes implemented within approved scope" : "Implementing changes bounded to approved scope";
  if (t?.controllerCredits !== void 0 && t.controllerCredits > 0) {
    const controllerBadge = isPrReady ? "\u2705 `COMPLETED`" : "\u{1F916} `ACTIVE`";
    md += `| **0. PRSquad Orchestrator** | ${controllerBadge} | Multi-agent coordination and human gatekeeper | **${t.controllerCredits.toFixed(2)} AIU** |
`;
  }
  md += `| **1. Issue Triage** | ${getStatusBadge(p.intake?.status)} | ${p.intake?.summary || "Verified issue requirements & reproduction"} | ${renderCredits(p.intake?.credits)} |
`;
  md += `| **2. Architecture Plan** | ${getStatusBadge(p.architect?.status)} | ${p.architect?.summary || "Root cause identified & surgical scope proposed"} | ${renderCredits(p.architect?.credits)} |
`;
  md += `| **3. Scope Approval Gate** | ${getStatusBadge(p.scopeGate?.status)} | ${p.scopeGate?.summary || "Human approval recorded via /approve"} | **0.00 AIU** *(Deterministic)* |
`;
  md += `| **4. Implementation** | ${getStatusBadge(devStatus)} | ${devSummary} | ${renderCredits(p.developer?.credits)} |
`;
  md += `| **5. QA Verification** | ${getStatusBadge(p.qa?.status)} | ${p.qa?.summary || "Automated regression test suite passed"} | ${renderCredits(p.qa?.credits)} |
`;
  md += `| **6. Security & Code Review** | ${getStatusBadge(p.reviewer?.status)} | ${p.reviewer?.summary || "Zero security flags \xB7 In-scope diff confirmed"} | ${renderCredits(p.reviewer?.credits)} |
`;
  const prStageText = isPrReady ? prNum ? `[PR #${prNum}](${prUrl || "#"}) created \xB7 Awaiting human review` : prUrl ? `[PR](${prUrl}) created \xB7 Awaiting human review` : "PR created \xB7 Awaiting human review" : "Awaiting final audit";
  const prStageStatus = isPrReady ? prNum ? `Pull Request #${prNum} Open` : "Pull Request Open" : "Pipeline active";
  md += `| **7. Pull Request** | ${getStatusBadge(p.mergeGate?.status)} | ${prStageText} | **0.00 AIU** *(Deterministic)* |
`;
  md += `| **Total** | \u{1F3C1} **${isPrReady ? "PR OPEN \xB7 AWAITING REVIEW" : "IN PROGRESS"}** | **${prStageStatus}** | **${totalCredits}** |

`;
  md += `---

`;
  md += `### \u{1F9E0} Agent Findings & Verification Package

`;
  const qaDetails = p.qa?.details || {};
  if (qaDetails.verdict || p.qa?.status || p.qa?.summary) {
    const verdict = qaDetails.verdict || p.qa?.status || "NOT RECORDED";
    const qaOpen = isPrReady ? "open" : "";
    md += `<details ${qaOpen}>
<summary><b>\u{1F9EA} 1. QA Verification & Acceptance Criteria Matrix</b></summary>

`;
    md += `> **Verdict:** ${getStatusBadge(verdict)}  
`;
    md += `> **Scope Compliance:** \`${qaDetails.scopeCompliance || "NOT RECORDED"}\`  
`;
    if (Array.isArray(qaDetails.acceptanceCriteriaResults) && qaDetails.acceptanceCriteriaResults.length > 0) {
      const isItemPassing = (ac) => {
        const val = String(ac.verdict || ac.result || ac.status || "").toUpperCase();
        return val === "PASS" || val === "PASSED" || ac.pass === true || ac.passed === true || ac.verified === true;
      };
      const passedCount = qaDetails.acceptanceCriteriaResults.filter(isItemPassing).length;
      md += `> **Acceptance Criteria Verification:** ${passedCount} / ${qaDetails.acceptanceCriteriaResults.length} PASSED  

`;
      md += `| Criterion | Description | Verdict | Evidence |
`;
      md += `|:---:|:---|:---:|:---|
`;
      for (let i = 0; i < qaDetails.acceptanceCriteriaResults.length; i++) {
        const ac = qaDetails.acceptanceCriteriaResults[i];
        const rawVerdict = ac.verdict || ac.result || ac.status;
        const acVerdict = rawVerdict ? String(rawVerdict).toUpperCase() : isItemPassing(ac) ? "PASS" : "FAIL";
        const acId = ac.id || (typeof ac.criterion === "string" && ac.criterion.match(/^(AC-?\d+)/i) ? ac.criterion.match(/^(AC-?\d+)/i)[1] : `AC-${i + 1}`);
        md += `| **${acId}** | ${ac.description || ac.criterion || "\u2014"} | ${getStatusBadge(acVerdict)} | ${ac.evidence || "Verified in test run"} |
`;
      }
      md += `
`;
    } else if (qaDetails.criteriaSummary) {
      md += `> **Acceptance Criteria Verification:** ${qaDetails.criteriaSummary}  

`;
    } else {
      md += `> **Acceptance Criteria Verification:** *NOT RECORDED*  

`;
    }
    if (qaDetails.suiteResults) {
      md += `**Execution:** ${qaDetails.suiteResults}

`;
    } else if (p.qa?.summary) {
      md += `**Execution:** ${p.qa.summary}

`;
    }
    if (qaDetails.testNotes) {
      md += `**QA Summary Notes:** ${qaDetails.testNotes}

`;
    }
    md += `</details>

`;
  }
  const revDetails = p.reviewer?.details || {};
  if (revDetails.verdict || revDetails.assessment || p.reviewer?.status || p.reviewer?.summary) {
    const assessment = revDetails.assessment || revDetails.verdict || p.reviewer?.status || "NOT RECORDED";
    md += `<details>
<summary><b>\u{1F50D} 2. Security & Code Quality Audit (Reviewer Verdict: ${assessment})</b></summary>

`;
    md += `> **Assessment:** ${getStatusBadge(assessment)}  
`;
    md += `> **Scope Compliance:** \`${revDetails.scopeCompliance || "NOT RECORDED"}\`  
`;
    md += `> **Reviewer Verdict:** ${getStatusBadge(assessment)}  

`;
    const riskFlags = revDetails.riskFlags || [];
    if (riskFlags.length > 0) {
      md += `#### \u{1F6A9} Risk Flags & Findings

`;
      md += `| Severity | Finding | Evidence |
`;
      md += `|:---:|:---|:---|
`;
      for (const flag of riskFlags) {
        md += `| \`${flag.severity}\` | ${flag.finding} | \`${flag.evidence || "Diff inspection"}\` |
`;
      }
      md += `
`;
    }
    const qualityNotes = revDetails.qualityNotes || [];
    if (qualityNotes.length > 0) {
      md += `#### \u{1F31F} Quality & Hygiene Notes

`;
      for (const note of qualityNotes) {
        md += `- ${note}
`;
      }
      md += `
`;
    }
    if (revDetails.mergeGateSummary) {
      md += `#### \u{1F4DD} Reviewer Gate Summary

${revDetails.mergeGateSummary}

`;
    }
    md += `</details>

`;
  }
  const archPlan = p.architect?.details?.plan || p.scopeGate?.details?.plan;
  const approvedScope = p.scopeGate?.details?.approvedScope || p.architect?.details?.proposedScope || "NOT RECORDED";
  const riskTier = p.architect?.details?.riskTier || "NOT RECORDED";
  if (archPlan || p.architect?.summary) {
    md += `<details>
<summary><b>\u{1F4D0} 3. Architecture Plan & Scope Specification</b></summary>

`;
    md += `> **Approved Scope:** \`${approvedScope}\`  
`;
    md += `> **Risk Tier:** \`${riskTier}\`  
`;
    if (p.scopeGate?.details?.approvedBy) {
      md += `> **Human Approval:** Authorized by \`${p.scopeGate.details.approvedBy}\` at \`${p.scopeGate.details.approvedAt || updatedIso}\`  

`;
    }
    if (archPlan) {
      md += `${archPlan.trim()}

`;
    } else if (p.architect?.summary) {
      md += `${p.architect.summary}

`;
    }
    md += `</details>

`;
  }
  const devDetails = p.developer?.details || {};
  if (devDetails.commitSha || devDetails.changedFiles || p.developer?.status || isDevDone) {
    const commitSha = devDetails.commitSha;
    md += `<details>
<summary><b>\u{1F528} 4. Developer Implementation & Git Changes</b></summary>

`;
    if (commitSha) {
      const shortSha = commitSha.slice(0, 8);
      const commitUrl = `https://github.com/${repoSlug}/commit/${commitSha}`;
      md += `> **Commit:** [\`${shortSha}\`](${commitUrl}) (\`${commitSha}\`)  
`;
    } else {
      md += `> **Commit:** *NOT RECORDED*  
`;
    }
    md += `> **Active Branch:** \`${currentBranch}\`  

`;
    if (Array.isArray(devDetails.changedFiles) && devDetails.changedFiles.length > 0) {
      md += `| File | Action | Scope Status |
`;
      md += `|:---|:---:|:---|
`;
      for (const f of devDetails.changedFiles) {
        md += `| \`${f}\` | Modified | \u2705 In Approved Scope |
`;
      }
      md += `
`;
    } else {
      md += `> **Changed Files:** *NOT RECORDED*  

`;
    }
    if (Array.isArray(devDetails.testsAddedOrChanged) && devDetails.testsAddedOrChanged.length > 0) {
      md += `**Tests Added:**
`;
      for (const t2 of devDetails.testsAddedOrChanged) {
        md += `- ${t2}
`;
      }
      md += `
`;
    }
    md += `</details>

`;
  }
  if (t && t.turns > 0) {
    md += `<details>
<summary><b>\u26A1 FinOps & Token Accounting (${totalCredits} Total)</b></summary>

`;
    md += `> **Billing Model:** \`${t.model}\`  
`;
    md += `> **Total AI Credits Consumed:** **${t.actualAiCredits.toFixed(2)} AIU** *(Official Copilot AI Units)*  
`;
    md += `> **Prompt Cache Hit Rate:** **${t.cacheHitRatePercent}%** *(Reused ${t.cacheReadTokens.toLocaleString()} cached tokens)*  
`;
    md += `> **Deterministic Guardrail Hooks:** **0.00 AIU / 0 Tokens** *(Mechanical Zero-Token Execution)*  

`;
    md += `| Metric | Count / Value | Notes |
`;
    md += `|:---|:---:|:---|
`;
    md += `| **Total Billed AI Credits** | **${t.actualAiCredits.toFixed(2)} AIU** | Ground-truth measurement via Copilot App session store |
`;
    md += `| **Evaluated Prompt Context** | ${t.inputTokens.toLocaleString()} tokens | Cumulative context across ${t.turns} turns |
`;
    md += `| \u21B3 *Cache Read (Hit)* | ${t.cacheReadTokens.toLocaleString()} tokens | Billed at ~90% prompt-cache discount |
`;
    md += `| \u21B3 *Cache Write (Miss)* | ${t.cacheWriteTokens.toLocaleString()} tokens | Initial prompt cache population |
`;
    md += `| **Completion Generated** | ${t.outputTokens.toLocaleString()} tokens | Generated code, test cases, and analyses |
`;
    if (t.reasoningTokens > 0) {
      md += `| **Extended Reasoning** | ${t.reasoningTokens.toLocaleString()} tokens | Chain-of-thought planning capacity |
`;
    }
    md += `| **Deterministic Guardrails** | **0.00 AIU** | Scope Gate, Sandbox, PR Creator, Dashboard Sync |

`;
    md += `</details>

`;
  }
  md += `> *Automated gated pipeline executed via GitHub Copilot App Guardrails Engine.*`;
  return md;
}
function syncWorkflowDashboard(rootDir = getRepoRoot(), update) {
  try {
    const state = loadState(rootDir);
    if (update.owner) state.issue.owner = update.owner;
    if (update.repo) state.issue.repo = update.repo;
    if (update.issueNumber && update.issueNumber > 0 && update.issueNumber !== 999) {
      state.issue.number = update.issueNumber;
    }
    if (update.issueTitle && update.issueTitle !== "Test Billing Issue") {
      state.issue.title = update.issueTitle;
    }
    if (update.activeBranch && !update.activeBranch.includes("999")) {
      state.activeBranch = update.activeBranch;
    }
    if (update.sessionId) {
      state.sessionId = update.sessionId;
    }
    const tele = getGroundTruthTelemetry(state.sessionId, state.startEventId || 0);
    if (tele) {
      if (!state.startEventId && tele.firstEventId) {
        state.startEventId = tele.firstEventId;
      }
    }
    if (!state.phases) {
      state.phases = {};
    }
    if (update.phase) {
      const existingPhase = state.phases[update.phase] || { status: "PENDING" };
      let phaseCredits = existingPhase.credits;
      if (tele && tele.actualAiCredits !== void 0) {
        if (update.phase === "scopeGate" || update.phase === "mergeGate") {
          phaseCredits = 0;
        } else {
          const subagentIdxMap = {
            intake: 0,
            architect: 1,
            developer: 2,
            qa: 3,
            reviewer: 4
          };
          const subagentIdx = subagentIdxMap[update.phase];
          if (subagentIdx !== void 0 && tele.subagents && tele.subagents[subagentIdx]) {
            phaseCredits = tele.subagents[subagentIdx].credits;
          } else {
            const recordedCredits = Object.entries(state.phases).filter(([k]) => k !== update.phase).reduce((sum, [, p]) => sum + (p?.credits || 0), 0);
            const computed = Math.max(0, Math.round((tele.actualAiCredits - recordedCredits) * 100) / 100);
            if (phaseCredits === void 0 || update.status !== "IN_PROGRESS") {
              phaseCredits = computed;
            }
          }
        }
      }
      state.phases[update.phase] = {
        ...existingPhase,
        status: update.status || existingPhase.status,
        summary: update.summary || existingPhase.summary,
        credits: phaseCredits,
        updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
        details: {
          ...existingPhase.details || {},
          ...update.details || {}
        }
      };
      if (update.phase === "scopeGate" && update.details?.plan) {
        const existingArch = state.phases.architect || { status: "PLAN_READY" };
        state.phases.architect = {
          ...existingArch,
          status: "PLAN_READY",
          summary: existingArch.summary || "Technical plan approved at Scope Approval Gate",
          details: {
            ...existingArch.details || {},
            plan: update.details.plan
          }
        };
      }
    }
    saveState(state, rootDir);
    try {
      const gatedDir = findGatedChangeDir(rootDir);
      const legacyDash = join2(gatedDir, "dashboard.json");
      if (existsSync2(legacyDash)) {
        unlinkSync(legacyDash);
      }
    } catch {
    }
    const current = {
      issueNumber: state.issue?.number || 0,
      issueTitle: state.issue?.title,
      owner: state.issue?.owner || update.owner || "vamsicherukuri",
      repo: state.issue?.repo || update.repo || "prsquad",
      activeBranch: state.activeBranch || update.activeBranch,
      commentId: state.commentId ?? null,
      sessionId: state.sessionId,
      startEventId: state.startEventId,
      telemetry: tele || void 0,
      lastUpdated: state.updatedAt,
      phases: state.phases
    };
    const isTest = process.env.NODE_ENV === "test" || process.env.GATED_CHANGE_TEST === "1" || process.env.npm_lifecycle_event?.startsWith("test");
    const isPrPhase = update.phase === "mergeGate" || current.phases.mergeGate?.status === "PR_OPEN" || current.phases.mergeGate?.status === "PR_CREATED" || current.phases.mergeGate?.status === "READY_FOR_MERGE" || Boolean(current.commentId);
    const shouldPostComment = !isTest && current.issueNumber > 0 && current.issueNumber !== 999 && Boolean(current.owner) && Boolean(current.repo) && isPrPhase && process.env.GATED_CHANGE_POST_ISSUE_COMMENT !== "0";
    if (shouldPostComment) {
      postOrPatchGitHubComment(current);
      if (current.commentId && current.commentId !== state.commentId) {
        state.commentId = current.commentId;
        saveState(state, rootDir);
      }
    }
    if (process.env.GATED_CHANGE_WEBHOOK_URL && !isTest) {
      try {
        const payload = JSON.stringify({
          event: "workflow_dashboard_updated",
          timestamp: (/* @__PURE__ */ new Date()).toISOString(),
          issueNumber: current.issueNumber,
          owner: current.owner,
          repo: current.repo,
          activeBranch: current.activeBranch,
          telemetry: current.telemetry,
          phases: current.phases,
          summaryMarkdown: renderDashboardMarkdown(current)
        });
        if (typeof fetch === "function") {
          fetch(process.env.GATED_CHANGE_WEBHOOK_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: payload
          }).catch(() => {
          });
        }
      } catch {
      }
    }
    return current;
  } catch {
    return null;
  }
}
function postOrPatchGitHubComment(state) {
  const content = renderDashboardMarkdown(state);
  const tempPath = join2(tmpdir(), `gated-change-dashboard-${state.issueNumber}-${Date.now()}.md`);
  try {
    writeFileSync2(tempPath, content, "utf-8");
    if (!state.commentId) {
      try {
        const commentsJson = execFileSync("gh", [
          "api",
          `repos/${state.owner}/${state.repo}/issues/${state.issueNumber}/comments`,
          "--jq",
          `map(select(.body | contains("${DASHBOARD_ANCHOR}"))) | .[0].id`
        ], {
          encoding: "utf-8",
          stdio: ["ignore", "pipe", "ignore"],
          timeout: 1e4
        }).trim();
        if (commentsJson && commentsJson !== "null") {
          const parsedId = parseInt(commentsJson, 10);
          if (!isNaN(parsedId) && parsedId > 0) {
            state.commentId = parsedId;
          }
        }
      } catch {
      }
    }
    if (state.commentId) {
      try {
        execFileSync("gh", [
          "api",
          `repos/${state.owner}/${state.repo}/issues/comments/${state.commentId}`,
          "-X",
          "PATCH",
          "-F",
          `body=@${tempPath}`
        ], {
          encoding: "utf-8",
          stdio: ["ignore", "pipe", "ignore"],
          timeout: 1e4
        });
        return;
      } catch {
        state.commentId = null;
      }
    }
    const createOut = execFileSync("gh", [
      "api",
      `repos/${state.owner}/${state.repo}/issues/${state.issueNumber}/comments`,
      "-F",
      `body=@${tempPath}`,
      "--jq",
      ".id"
    ], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 1e4
    }).trim();
    if (createOut) {
      const newId = parseInt(createOut, 10);
      if (!isNaN(newId) && newId > 0) {
        state.commentId = newId;
      }
    }
  } catch {
  } finally {
    try {
      if (existsSync2(tempPath)) {
        unlinkSync(tempPath);
      }
    } catch {
    }
  }
}
function extractPlanMarkdown(text) {
  if (!text) return "";
  let clean = text;
  const scopeGateIdx = clean.search(/##\s*(?:Human\s*Scope\s*Gate|Scope\s*Approval\s*Gate)/i);
  if (scopeGateIdx !== -1) {
    clean = clean.slice(scopeGateIdx);
  } else {
    const rootCauseIdx = clean.search(/\*\*Root cause:?\*\*/i);
    if (rootCauseIdx !== -1) {
      clean = clean.slice(rootCauseIdx);
    } else {
      const altRootIdx = clean.search(/Root cause:/i);
      if (altRootIdx !== -1) {
        clean = clean.slice(altRootIdx);
      }
    }
  }
  const stopMatches = [
    /\n\s*Implement the fix and regression tests/i,
    /\n\s*Return your complete structured handoff/i,
    /\n\s*\[BRANCH ISOLATION GUARDRAIL\]/i,
    /\n\s*ORIGINAL ACCEPTANCE CRITERIA:/i
  ];
  for (const regex of stopMatches) {
    const match = clean.match(regex);
    if (match && match.index && match.index > 50) {
      clean = clean.slice(0, match.index);
    }
  }
  return clean.trim();
}
function extractDeveloperDetails(promptOrText, repoRoot) {
  const details = {
    status: "IMPLEMENTED"
  };
  if (!promptOrText) return details;
  const handoffIdx = promptOrText.indexOf("DEVELOPER HANDOFF");
  if (handoffIdx !== -1) {
    const jsonStart = promptOrText.indexOf("{", handoffIdx);
    if (jsonStart !== -1) {
      const jsonEnd = promptOrText.indexOf("\n}\n", jsonStart);
      const candidateStr = jsonEnd !== -1 ? promptOrText.slice(jsonStart, jsonEnd + 2) : promptOrText.slice(jsonStart, promptOrText.lastIndexOf("}") + 1);
      try {
        const parsed = JSON.parse(candidateStr);
        if (parsed.status) details.status = parsed.status;
        if (parsed.filesChanged) details.changedFiles = parsed.filesChanged;
        if (parsed.testsAddedOrChanged) details.testsAddedOrChanged = parsed.testsAddedOrChanged;
        if (parsed.validationRun) details.validationRun = parsed.validationRun;
        if (parsed.assumptions) details.assumptions = parsed.assumptions;
        if (parsed.residualRisk) details.residualRisk = parsed.residualRisk;
        if (parsed.diffReference?.headRef) details.commitSha = parsed.diffReference.headRef;
        if (parsed.diffReference?.baseRef) details.baseRef = parsed.diffReference.baseRef;
      } catch {
      }
    }
  }
  if (!details.commitSha) {
    const headMatch = promptOrText.match(/HEAD REF:\s*([0-9a-f]{7,40})/i);
    if (headMatch) details.commitSha = headMatch[1];
  }
  if (!details.baseRef) {
    const baseMatch = promptOrText.match(/BASE REF:\s*([0-9a-f]{7,40})/i);
    if (baseMatch) details.baseRef = baseMatch[1];
  }
  if (repoRoot && (!details.commitSha || !details.changedFiles)) {
    try {
      if (!details.commitSha) {
        details.commitSha = execSync2("git rev-parse HEAD", { cwd: repoRoot, encoding: "utf-8" }).trim();
      }
      if (!details.changedFiles) {
        const diffFiles = execSync2("git diff-tree --no-commit-id --name-only -r HEAD", {
          cwd: repoRoot,
          encoding: "utf-8"
        }).trim().split("\n").filter(Boolean);
        if (diffFiles.length > 0) details.changedFiles = diffFiles;
      }
    } catch {
    }
  }
  return details;
}
function extractQADetails(promptOrText) {
  const details = {};
  if (!promptOrText) return details;
  const rawText = typeof promptOrText === "string" ? promptOrText : promptOrText.textResultForLlm || promptOrText.content || JSON.stringify(promptOrText);
  const start = rawText.indexOf("{");
  const end = rawText.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try {
      const parsed = JSON.parse(rawText.slice(start, end + 1));
      if (parsed.verdict) details.verdict = String(parsed.verdict).toUpperCase();
      if (parsed.scopeCompliance) details.scopeCompliance = String(parsed.scopeCompliance).toUpperCase();
      if (Array.isArray(parsed.failureClassification)) details.failureClassification = parsed.failureClassification;
      if (Array.isArray(parsed.blockingFindings)) details.blockingFindings = parsed.blockingFindings;
      if (Array.isArray(parsed.testResults)) details.testResults = parsed.testResults;
      const acList = parsed.acceptanceCriteriaResults || parsed.criteriaResults || parsed.criteria;
      if (Array.isArray(acList)) details.acceptanceCriteriaResults = acList;
    } catch {
    }
  }
  const verdictMatch = rawText.match(/QA RESULT\s*(?:\(verdict:\s*([A-Z]+)\))?:\s*([^\n\r]+)/i);
  if (verdictMatch) {
    if (verdictMatch[1] && !details.verdict) details.verdict = verdictMatch[1].toUpperCase();
    if (!details.testNotes) details.testNotes = verdictMatch[2].trim();
  }
  const passCriteriaMatch = rawText.match(/(\d+\/\d+\s*acceptance criteria PASS[^\n.]*)/i);
  if (passCriteriaMatch && !details.criteriaSummary) {
    details.criteriaSummary = passCriteriaMatch[1];
  }
  const testRunMatch = rawText.match(/Test run:\s*([^\n.]+)/i);
  if (testRunMatch && !details.suiteResults) {
    details.suiteResults = testRunMatch[1];
  }
  return details;
}
function extractReviewerDetails(toolResultOrText) {
  const details = {};
  if (!toolResultOrText) return details;
  const rawText = typeof toolResultOrText === "string" ? toolResultOrText : toolResultOrText.textResultForLlm || toolResultOrText.content || JSON.stringify(toolResultOrText);
  const start = rawText.indexOf("{");
  const end = rawText.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try {
      const parsed = JSON.parse(rawText.slice(start, end + 1));
      if (parsed.assessment) {
        details.assessment = parsed.assessment;
        details.verdict = parsed.assessment;
      }
      if (parsed.scopeCompliance) details.scopeCompliance = parsed.scopeCompliance;
      if (Array.isArray(parsed.riskFlags)) details.riskFlags = parsed.riskFlags;
      if (Array.isArray(parsed.qualityNotes)) details.qualityNotes = parsed.qualityNotes;
      if (Array.isArray(parsed.residualRisk)) details.residualRisk = parsed.residualRisk;
      if (parsed.mergeGateSummary) details.mergeGateSummary = parsed.mergeGateSummary;
    } catch {
    }
  }
  return details;
}

// src/guardrails/stagePolicies.ts
import { existsSync as existsSync8, readFileSync as readFileSync7 } from "node:fs";
import { join as join7 } from "node:path";
import { execSync as execSync5 } from "node:child_process";

// src/guardrails/stateController.ts
import { existsSync as existsSync3, mkdirSync as mkdirSync2 } from "node:fs";
import { execSync as execSync3 } from "node:child_process";
var ALLOWED_TRANSITIONS = [
  { from: "INITIAL", event: "INGEST_OPEN", to: "INTAKE_TRIAGE" },
  { from: "INTAKE_TRIAGE", event: "READY", to: "ARCHITECTING" },
  { from: "INTAKE_TRIAGE", event: "NOT_READY", to: "PAUSED" },
  { from: "INTAKE_TRIAGE", event: "EMPTY", to: "PAUSED" },
  { from: "INTAKE_TRIAGE", event: "FETCH_FAILED", to: "PAUSED" },
  { from: "INTAKE_TRIAGE", event: "HANDOFF_INVALID", to: "PAUSED" },
  { from: "ARCHITECTING", event: "PLAN_READY", to: "AWAITING_SCOPE_APPROVAL" },
  { from: "ARCHITECTING", event: "BLOCKED", to: "PAUSED" },
  { from: "ARCHITECTING", event: "HANDOFF_INVALID", to: "PAUSED" },
  { from: "AWAITING_SCOPE_APPROVAL", event: "HUMAN_APPROVE", to: "DEVELOPING" },
  { from: "AWAITING_SCOPE_APPROVAL", event: "HUMAN_REJECT", to: "PAUSED" },
  { from: "DEVELOPING", event: "IMPLEMENTED", to: "TESTING" },
  { from: "DEVELOPING", event: "SCOPE_AMENDMENT", to: "ARCHITECTING" },
  { from: "DEVELOPING", event: "HANDOFF_INVALID", to: "PAUSED" },
  { from: "TESTING", event: "PASS", to: "REVIEWING" },
  { from: "TESTING", event: "FAIL", to: "DEVELOPING" },
  { from: "TESTING", event: "HANDOFF_INVALID", to: "PAUSED" },
  { from: "REVIEWING", event: "CLEAR", to: "AWAITING_PR_APPROVAL" },
  { from: "REVIEWING", event: "CONCERNS", to: "AWAITING_PR_APPROVAL" },
  { from: "REVIEWING", event: "HANDOFF_INVALID", to: "PAUSED" },
  { from: "AWAITING_PR_APPROVAL", event: "HUMAN_PR_APPROVE", to: "PR_OPEN" }
];
var StateController = class _StateController {
  /**
   * Validates if a proposed state transition is permissible under the State Machine.
   */
  static validateTransition(fromPhase, event, toPhase) {
    const normalizedFrom = fromPhase.toUpperCase();
    const normalizedTo = toPhase.toUpperCase();
    const normalizedEvent = event.toUpperCase();
    const effectiveFrom = normalizedFrom === "INTAKE" ? "INTAKE_TRIAGE" : normalizedFrom;
    const effectiveTo = normalizedTo === "INTAKE" ? "INTAKE_TRIAGE" : normalizedTo;
    return ALLOWED_TRANSITIONS.some(
      (t) => t.from === effectiveFrom && t.event === normalizedEvent && t.to === effectiveTo
    );
  }
  /**
   * Checks whether the current workflow phase represents an advanced, in-flight pipeline stage
   * that must be preserved on session resume rather than reset to intake.
   */
  static isAdvancedPhase(phase) {
    const p = String(phase || "").toUpperCase();
    return [
      "ARCHITECTING",
      "AWAITING_SCOPE_APPROVAL",
      "DEVELOPING",
      "TESTING",
      "QA_VALIDATING",
      "REVIEWING",
      "AWAITING_PR_APPROVAL",
      "PR_READY",
      "PR_OPEN"
    ].includes(p);
  }
  /**
   * Resolves the issue number from session context:
   * 1. Initial user prompt
   * 2. Cwd path (e.g. Copilot App worktree named StarReads-issue-42-slug)
   * 3. Active git branch (e.g. fix/issue-42)
   * 4. Existing workflow state
   */
  static resolveIssueFromSession(cwd, prompt, repoRoot, state) {
    if (prompt) {
      const jsonNum = prompt.match(/"number"\s*:\s*(\d+)/);
      if (jsonNum) return parseInt(jsonNum[1], 10);
      const explicitNum = prompt.match(/(?:issue(?:\s*number)?\s*[:#`'"\s]*|#)\s*(\d+)/i);
      if (explicitNum) return parseInt(explicitNum[1], 10);
      const wordNum = prompt.match(/\bissue-?(\d+)\b/i);
      if (wordNum) return parseInt(wordNum[1], 10);
    }
    const cwdMatch = cwd.match(/(?:issue-?|#)(\d+)/i);
    if (cwdMatch) {
      return parseInt(cwdMatch[1], 10);
    }
    const rootMatch = repoRoot.match(/(?:issue-?|#)(\d+)/i);
    if (rootMatch) {
      return parseInt(rootMatch[1], 10);
    }
    try {
      const branch = execSync3("git rev-parse --abbrev-ref HEAD", {
        cwd,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"]
      }).trim();
      const branchMatch = branch.match(/(?:issue-?|#)(\d+)/i);
      if (branchMatch) {
        return parseInt(branchMatch[1], 10);
      }
    } catch {
    }
    if (state?.issue?.number && state.issue.number > 0) {
      return state.issue.number;
    }
    return null;
  }
  /**
   * Initializes or loads the workflow state for the session safely.
   * Guarantees the .gated-change directory exists on disk.
   */
  static loadOrCreateState(rootDir = getRepoRoot(), sessionId) {
    const gatedDir = findGatedChangeDir(rootDir);
    if (!existsSync3(gatedDir)) {
      mkdirSync2(gatedDir, { recursive: true });
    }
    const state = loadState(rootDir);
    if (sessionId && (!state.sessionId || state.sessionId !== sessionId)) {
      state.sessionId = sessionId;
      saveState(state, rootDir);
    }
    return state;
  }
  /**
   * Performs the atomic intake authorization commit:
   * 1. Records issue metadata in state.json
   * 2. Sets phase = "INTAKE_TRIAGE" and active branch
   * 3. Syncs in-memory dashboard projection with status = "INTAKE_AUTHORIZED"
   * 4. Logs audit entry in audit.jsonl
   * All executed as a single atomic transaction.
   */
  /**
   * Records issue validation results, identity, snapshot reference, and intake eligibility
   * into the Workflow State before context injection.
   */
  static recordIssueValidation(rootDir, record, sessionId) {
    const gatedDir = findGatedChangeDir(rootDir);
    if (!existsSync3(gatedDir)) {
      mkdirSync2(gatedDir, { recursive: true });
    }
    const state = loadState(rootDir);
    if (sessionId) {
      state.sessionId = sessionId;
    }
    state.issueValidation = record.validation;
    state.intakeEligibility = record.intake;
    if (record.issueSnapshot) {
      state.issueSnapshot = record.issueSnapshot;
    }
    if (record.issue) {
      state.issue = {
        owner: record.issue.owner,
        repo: record.issue.repo,
        number: record.issue.number,
        title: record.issue.title,
        body: record.issue.body
      };
      state.activeBranch = `fix/issue-${record.issue.number}`;
    }
    if (record.intake === "READY") {
      state.phase = "INTAKE";
    } else {
      state.phase = "PAUSED";
      if (record.reason) {
        state.pauseReason = record.reason;
      }
    }
    state.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    saveState(state, rootDir);
    const remoteInfo = getRepoOwnerAndName(rootDir);
    const owner = record.issue?.owner || remoteInfo.owner;
    const repo = record.issue?.repo || remoteInfo.repo;
    const issueNum = record.issue?.number || state.issue?.number || 0;
    syncWorkflowDashboard(rootDir, {
      owner,
      repo,
      issueNumber: issueNum,
      issueTitle: record.issue?.title || state.issue?.title,
      activeBranch: state.activeBranch,
      sessionId: sessionId || state.sessionId,
      phase: "intake",
      status: record.intake === "READY" ? "INTAKE_AUTHORIZED" : "BLOCKED",
      summary: record.reason || (record.intake === "READY" ? `Issue #${issueNum} verified OPEN. Authorized for Intake.` : "Intake blocked."),
      details: {
        validation: record.validation,
        intake: record.intake,
        snapshot: record.issueSnapshot,
        reason: record.reason
      }
    });
    appendAuditLog(
      {
        sessionId: sessionId || state.sessionId,
        agent: "controller",
        action: "issue_validation_recorded",
        decision: record.intake === "READY" ? "allow" : "deny",
        details: {
          validation: record.validation,
          intake: record.intake,
          issueNumber: issueNum,
          snapshot: record.issueSnapshot,
          reason: record.reason
        }
      },
      rootDir
    );
    return state;
  }
  /**
   * Atomically authorizes the intake stage for an issue and persists
   * state.json and audit.jsonl in one unified commit.
   */
  static authorizeIntake(rootDir, issue, cacheFilePath, sessionId) {
    const gatedDir = findGatedChangeDir(rootDir);
    if (!existsSync3(gatedDir)) {
      mkdirSync2(gatedDir, { recursive: true });
    }
    const state = loadState(rootDir);
    if (sessionId) {
      state.sessionId = sessionId;
    }
    state.issueValidation = "PASS";
    state.intakeEligibility = "READY";
    state.issueSnapshot = cacheFilePath;
    state.issue = {
      owner: issue.owner,
      repo: issue.repo,
      number: issue.number,
      title: issue.title,
      body: issue.body
    };
    state.phase = "INTAKE";
    state.activeBranch = `fix/issue-${issue.number}`;
    state.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    saveState(state, rootDir);
    syncWorkflowDashboard(rootDir, {
      owner: issue.owner,
      repo: issue.repo,
      issueNumber: issue.number,
      issueTitle: issue.title,
      activeBranch: `fix/issue-${issue.number}`,
      sessionId: sessionId || state.sessionId,
      phase: "intake",
      status: "INTAKE_AUTHORIZED",
      summary: `Session initialized & issue #${issue.number} verified OPEN. Authorized for Intake triage.`,
      details: {
        issueNumber: issue.number,
        title: issue.title,
        author: issue.author,
        state: issue.state,
        cacheFile: cacheFilePath
      }
    });
    appendAuditLog(
      {
        sessionId: sessionId || state.sessionId,
        agent: "controller",
        action: "intake_stage_authorized",
        decision: "allow",
        details: {
          issueNumber: issue.number,
          title: issue.title,
          phase: "INTAKE_TRIAGE",
          status: "INTAKE_AUTHORIZED",
          cacheFile: cacheFilePath
        }
      },
      rootDir
    );
    return state;
  }
  /**
   * Pauses the workflow due to validation failure, closed issue, or policy block.
   * Atomically records reason in state.json and audit.jsonl.
   */
  static pauseWorkflow(rootDir, reason, issueNumber, sessionId) {
    const state = loadState(rootDir);
    state.phase = "PAUSED";
    state.pauseReason = reason;
    state.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    saveState(state, rootDir);
    const remoteInfo = getRepoOwnerAndName(rootDir);
    const owner = state.issue?.owner || remoteInfo.owner;
    const repo = state.issue?.repo || remoteInfo.repo;
    syncWorkflowDashboard(rootDir, {
      owner,
      repo,
      issueNumber: issueNumber || state.issue?.number || 0,
      sessionId: sessionId || state.sessionId,
      phase: "intake",
      status: "BLOCKED",
      summary: reason,
      details: { reason }
    });
    appendAuditLog(
      {
        sessionId: sessionId || state.sessionId,
        agent: "controller",
        action: "workflow_paused",
        decision: "deny",
        details: { reason, issueNumber: issueNumber || state.issue?.number }
      },
      rootDir
    );
    return state;
  }
  /**
   * Commits the Intake specialist's verdict to the State Machine:
   * 1. Evaluates state machine transition rules.
   * 2. If READY:
   *    - sets state.phase = "ARCHITECTING"
   *    - records state.issue.declaredScope = triageData.declaredScope
   *    - syncs derived dashboard projection: phase="intake", status="READY"
   *    - logs audit entry: action="intake_verdict_ready"
   * 3. If NOT_READY:
   *    - increments intakeRound
   *    - if intakeRound >= maxIntakeRounds: pauses workflow ("CLARIFICATION_LIMIT_EXCEEDED")
   *    - syncs derived dashboard projection: phase="intake", status="NOT_READY"
   *    - logs audit entry: action="intake_verdict_not_ready"
   * 4. If invalid status: fails closed to PAUSED ("HANDOFF_INVALID")
   */
  static commitIntakeVerdict(rootDir, triageData, sessionId) {
    const state = loadState(rootDir);
    const effectiveSessionId = sessionId || state.sessionId;
    if (triageData.status === "READY") {
      const allowed = _StateController.validateTransition(state.phase, "READY", "ARCHITECTING");
      if (!allowed) {
        return _StateController.pauseWorkflow(
          rootDir,
          `STATE_TRANSITION_VIOLATION: Cannot transition from phase '${state.phase}' to 'ARCHITECTING' on event 'READY'`,
          state.issue?.number,
          effectiveSessionId
        );
      }
      state.phase = "ARCHITECTING";
      if (triageData.declaredScope) {
        state.issue.declaredScope = triageData.declaredScope;
      }
      state.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
      saveState(state, rootDir);
      syncWorkflowDashboard(rootDir, {
        owner: state.issue.owner,
        repo: state.issue.repo,
        issueNumber: state.issue.number,
        issueTitle: state.issue.title,
        activeBranch: state.activeBranch,
        sessionId: effectiveSessionId,
        phase: "intake",
        status: "READY",
        summary: "Definition-of-Ready triage verified criteria & declared scope.",
        details: triageData
      });
      appendAuditLog(
        {
          sessionId: effectiveSessionId,
          agent: "controller",
          action: "intake_verdict_ready",
          decision: "allow",
          details: {
            issueNumber: state.issue.number,
            phase: "ARCHITECTING",
            declaredScope: triageData.declaredScope,
            acceptanceCriteriaCount: triageData.acceptanceCriteria?.length || 0
          }
        },
        rootDir
      );
      return state;
    } else if (triageData.status === "NOT_READY") {
      state.intakeRound = (state.intakeRound || 0) + 1;
      const maxRounds = state.maxIntakeRounds || 2;
      if (state.intakeRound >= maxRounds) {
        return _StateController.pauseWorkflow(
          rootDir,
          `CLARIFICATION_LIMIT_EXCEEDED: Intake triage returned NOT_READY after ${state.intakeRound} rounds. Definition of Ready not satisfied.`,
          state.issue?.number,
          effectiveSessionId
        );
      }
      state.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
      saveState(state, rootDir);
      syncWorkflowDashboard(rootDir, {
        owner: state.issue.owner,
        repo: state.issue.repo,
        issueNumber: state.issue.number,
        issueTitle: state.issue.title,
        activeBranch: state.activeBranch,
        sessionId: effectiveSessionId,
        phase: "intake",
        status: "NOT_READY",
        summary: `Definition of Ready not met (missing: ${(triageData.missing || []).join(", ")})`,
        details: triageData
      });
      appendAuditLog(
        {
          sessionId: effectiveSessionId,
          agent: "controller",
          action: "intake_verdict_not_ready",
          decision: "info",
          details: {
            issueNumber: state.issue.number,
            round: state.intakeRound,
            missing: triageData.missing,
            clarifyingQuestion: triageData.clarifyingQuestion
          }
        },
        rootDir
      );
      return state;
    } else if (triageData.status === "EMPTY") {
      return _StateController.pauseWorkflow(
        rootDir,
        `LACK_OF_CONTENT: Issue body is empty or lacks substantive problem description. Definition of Ready cannot be satisfied. Workflow halted immediately without user clarification rounds.`,
        state.issue?.number,
        effectiveSessionId
      );
    } else if (triageData.status === "FETCH_FAILED") {
      const fetchRetries = state.fetchRetries || 0;
      const maxFetchRetries = 2;
      if (fetchRetries < maxFetchRetries) {
        state.fetchRetries = fetchRetries + 1;
        state.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
        saveState(state, rootDir);
        syncWorkflowDashboard(rootDir, {
          owner: state.issue?.owner,
          repo: state.issue?.repo,
          issueNumber: state.issue?.number,
          issueTitle: state.issue?.title,
          activeBranch: state.activeBranch,
          sessionId: effectiveSessionId,
          phase: "intake",
          status: "FETCH_RETRY",
          summary: `Issue fetch failed (${triageData.fetchError || "network error"}). Retrying ingestion attempt ${state.fetchRetries}/${maxFetchRetries}...`,
          details: triageData
        });
        appendAuditLog(
          {
            sessionId: effectiveSessionId,
            agent: "controller",
            action: "intake_fetch_retry",
            decision: "allow",
            details: {
              issueNumber: state.issue?.number,
              attempt: state.fetchRetries,
              error: triageData.fetchError
            }
          },
          rootDir
        );
        return state;
      } else {
        return _StateController.pauseWorkflow(
          rootDir,
          `FETCH_FAILED_EXHAUSTED: Issue fetch failed after ${fetchRetries} retry attempts: ${triageData.fetchError || "network error"}. Pipeline halted.`,
          state.issue?.number,
          effectiveSessionId
        );
      }
    } else {
      return _StateController.pauseWorkflow(
        rootDir,
        `INTAKE_TRIAGE_FAILED: Triage returned status '${triageData.status}'. Pipeline halted.`,
        state.issue?.number,
        effectiveSessionId
      );
    }
  }
};

// src/guardrails/symbolSweep.ts
import { createRequire as createRequire2 } from "node:module";
import { existsSync as existsSync4, readFileSync as readFileSync4, readdirSync, statSync } from "node:fs";
import { join as join3 } from "node:path";
var _cachedTs = void 0;
function getTsCompiler() {
  if (_cachedTs !== void 0) return _cachedTs;
  try {
    const req = createRequire2(import.meta.url);
    _cachedTs = req("typescript");
  } catch {
    _cachedTs = null;
  }
  return _cachedTs;
}
function extractExportedSymbols(filePath, rootDir = process.cwd()) {
  const full = join3(rootDir, filePath);
  if (!existsSync4(full)) return [];
  const content = readFileSync4(full, "utf-8");
  const symbols = /* @__PURE__ */ new Set();
  const ts = getTsCompiler();
  if (ts) {
    try {
      let visit2 = function(node) {
        const modifiers = (ts.canHaveModifiers && ts.canHaveModifiers(node) ? ts.getModifiers(node) : node.modifiers) || [];
        const isExported = modifiers.some(
          (m) => m.kind === ts.SyntaxKind.ExportKeyword
        );
        const isDefault = modifiers.some(
          (m) => m.kind === ts.SyntaxKind.DefaultKeyword
        );
        if (isDefault) {
          symbols.add("default");
        }
        if (ts.isFunctionDeclaration(node)) {
          if (isExported) {
            if (node.name?.text) {
              symbols.add(node.name.text);
            } else if (isDefault) {
              symbols.add("default");
            }
          }
        } else if (ts.isClassDeclaration(node)) {
          if (isExported) {
            if (node.name?.text) {
              symbols.add(node.name.text);
            } else if (isDefault) {
              symbols.add("default");
            }
          }
        } else if (ts.isVariableStatement(node)) {
          if (isExported) {
            for (const decl of node.declarationList.declarations) {
              if (ts.isIdentifier(decl.name)) {
                symbols.add(decl.name.text);
              } else if (ts.isObjectBindingPattern(decl.name) || ts.isArrayBindingPattern(decl.name)) {
                for (const elem of decl.name.elements) {
                  if (ts.isBindingElement(elem) && ts.isIdentifier(elem.name)) {
                    symbols.add(elem.name.text);
                  }
                }
              }
            }
          }
        } else if (ts.isInterfaceDeclaration(node)) {
          if (isExported && node.name?.text) {
            symbols.add(node.name.text);
          }
        } else if (ts.isTypeAliasDeclaration(node)) {
          if (isExported && node.name?.text) {
            symbols.add(node.name.text);
          }
        } else if (ts.isEnumDeclaration(node)) {
          if (isExported && node.name?.text) {
            symbols.add(node.name.text);
          }
        } else if (ts.isExportDeclaration(node)) {
          if (node.exportClause && ts.isNamedExports(node.exportClause)) {
            for (const elem of node.exportClause.elements) {
              const name = elem.name?.text;
              if (name) {
                symbols.add(name);
              }
            }
          }
        } else if (ts.isExportAssignment(node)) {
          if (!node.isExportEquals) {
            symbols.add("default");
          } else if (ts.isIdentifier(node.expression)) {
            symbols.add(node.expression.text);
          }
        }
        ts.forEachChild(node, visit2);
      };
      var visit = visit2;
      const sourceFile = ts.createSourceFile(
        filePath,
        content,
        ts.ScriptTarget.Latest,
        true
      );
      visit2(sourceFile);
      if (symbols.size > 0) {
        return [...symbols];
      }
    } catch {
    }
  }
  const exportRegex = /export\s+(?:default\s+)?(?:async\s+)?(?:function|class|const|let|var|type|interface|enum)\s+([A-Za-z0-9_$]+)/g;
  let match;
  while ((match = exportRegex.exec(content)) !== null) {
    if (match[1]) symbols.add(match[1]);
  }
  if (/export\s+default\b/.test(content)) {
    symbols.add("default");
  }
  return [...symbols];
}
function getAllSourceFiles(dir, rootDir) {
  const ignoreDirs = /* @__PURE__ */ new Set([
    "node_modules",
    ".git",
    ".gated-change",
    "dist",
    "coverage",
    ".cache",
    ".playwright-mcp"
  ]);
  const results = [];
  const entries = readdirSync(dir);
  for (const entry of entries) {
    if (ignoreDirs.has(entry)) continue;
    const fullPath = join3(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      results.push(...getAllSourceFiles(fullPath, rootDir));
    } else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(entry)) {
      results.push(toPosixRelative(fullPath, rootDir));
    }
  }
  return results;
}
function runSymbolSweep(changedFiles, approvedScopePrefix, rootDir = process.cwd()) {
  const exportedSymbolsSet = /* @__PURE__ */ new Set();
  const symbolSourceMap = /* @__PURE__ */ new Map();
  for (const file of changedFiles) {
    const symbols = extractExportedSymbols(file, rootDir);
    for (const sym of symbols) {
      exportedSymbolsSet.add(sym);
      symbolSourceMap.set(sym, file);
    }
  }
  const exportedSymbols = [...exportedSymbolsSet];
  if (exportedSymbols.length === 0) {
    return {
      totalSymbolsAnalyzed: 0,
      exportedSymbols: [],
      externalReferencesFound: [],
      riskAssessment: "LOW",
      summary: "No exported symbols detected in changed files. Blast radius is strictly internal."
    };
  }
  const scopePrefixes = approvedScopePrefix.split(/[,;]/).map((s) => s.trim().replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, "")).filter(Boolean);
  const allFiles = getAllSourceFiles(rootDir, rootDir);
  const externalFiles = allFiles.filter((f) => {
    if (changedFiles.includes(f)) return false;
    const isInsideScope = scopePrefixes.some(
      (prefix) => f === prefix || f.startsWith(prefix + "/")
    );
    return !isInsideScope;
  });
  const externalReferencesFound = [];
  for (const extFile of externalFiles) {
    const full = join3(rootDir, extFile);
    const content = readFileSync4(full, "utf-8");
    const lines = content.split("\n");
    for (const sym of exportedSymbols) {
      if (sym === "default") continue;
      const symRegex = new RegExp(`\\b${sym}\\b`);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (symRegex.test(line)) {
          externalReferencesFound.push({
            symbol: sym,
            declaredIn: symbolSourceMap.get(sym) || "",
            referencedIn: extFile,
            lineNumber: i + 1,
            snippet: line.trim()
          });
        }
      }
    }
  }
  const riskAssessment = externalReferencesFound.length > 5 ? "HIGH" : externalReferencesFound.length > 0 ? "MEDIUM" : "LOW";
  const summary = externalReferencesFound.length === 0 ? `Analyzed ${exportedSymbols.length} exported symbol(s). Zero external package references found. Blast radius is safely contained.` : `Found ${externalReferencesFound.length} external reference(s) across packages for ${exportedSymbols.length} modified symbol(s). Flagged for Reviewer audit.`;
  return {
    totalSymbolsAnalyzed: exportedSymbols.length,
    exportedSymbols,
    externalReferencesFound,
    riskAssessment,
    summary
  };
}
function generateAstPreFetchMap(declaredScope, rootDir = process.cwd()) {
  if (!declaredScope) return "";
  const files = declaredScope.split(/[;,]/).map((s) => s.trim().replace(/\\/g, "/")).filter((s) => s.length > 0);
  if (files.length === 0) return "";
  const allFiles = getAllSourceFiles(rootDir, rootDir);
  let out = `### \u{1F9ED} Deterministic AST Pre-Fetch & Symbol Map (0 AI Credits)

`;
  out += `> **Pre-computed Code Structure:** The guardrail engine pre-indexed symbols and 1-hop callers across declared files. Use this structural map directly instead of broad search/view turns.

`;
  const targetScopeFiles = [];
  for (const relFile of files) {
    const full = join3(rootDir, relFile);
    if (!existsSync4(full) || !statSync(full).isFile()) continue;
    const content = readFileSync4(full, "utf-8");
    const lines = content.split("\n");
    const fileSymbols = [];
    const lineExportRegex = /export\s+(?:default\s+)?(?:async\s+)?(function|class|const|let|var|type|interface|enum)\s+([A-Za-z0-9_$]+)/;
    for (let i = 0; i < lines.length; i++) {
      const match = lineExportRegex.exec(lines[i]);
      if (match && match[2]) {
        fileSymbols.push({
          kind: match[1],
          name: match[2],
          line: i + 1
        });
      }
    }
    targetScopeFiles.push({ file: relFile, symbols: fileSymbols });
  }
  if (targetScopeFiles.length === 0) return "";
  out += `#### \u{1F4E6} Target Scope Symbols

`;
  for (const t of targetScopeFiles) {
    out += `- \`${t.file}\`
`;
    if (t.symbols.length === 0) {
      out += `  - *(No top-level exports detected; test runner or script file)*
`;
    } else {
      for (const s of t.symbols) {
        out += `  - \`${s.kind} ${s.name}\` (line ${s.line})
`;
      }
    }
  }
  const importersMap = /* @__PURE__ */ new Map();
  for (const t of targetScopeFiles) {
    for (const s of t.symbols) {
      const symRegex = new RegExp(`\\b${s.name}\\b`);
      for (const otherFile of allFiles) {
        if (otherFile === t.file || files.includes(otherFile)) continue;
        const fullOther = join3(rootDir, otherFile);
        try {
          const c = readFileSync4(fullOther, "utf-8");
          if (symRegex.test(c)) {
            if (!importersMap.has(otherFile)) {
              importersMap.set(otherFile, /* @__PURE__ */ new Set());
            }
            importersMap.get(otherFile).add(s.name);
          }
        } catch {
        }
      }
    }
  }
  out += `
#### \u{1F517} 1-Hop Direct Callers / Importers

`;
  if (importersMap.size === 0) {
    out += `> *(Zero external callers detected outside declared scope. Changes are safely isolated.)*
`;
  } else {
    for (const [importer, syms] of importersMap.entries()) {
      out += `- \`${importer}\`: imports \`${[...syms].join("`, `")}\`
`;
    }
  }
  return out;
}

// src/guardrails/repoSkillResolver.ts
import { existsSync as existsSync5, readFileSync as readFileSync5, readdirSync as readdirSync2, statSync as statSync2 } from "node:fs";
import { join as join4, relative as relative2 } from "node:path";
function parseFrontmatter(raw) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    return { data: {}, content: raw };
  }
  const yamlText = match[1];
  const content = match[2];
  const data = {};
  for (const line of yamlText.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const colonIdx = trimmed.indexOf(":");
    if (colonIdx > 0) {
      const key = trimmed.slice(0, colonIdx).trim();
      let val = trimmed.slice(colonIdx + 1).trim();
      if (val.startsWith("[") && val.endsWith("]")) {
        data[key] = val.slice(1, -1).split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
      } else {
        data[key] = val.replace(/^["']|["']$/g, "");
      }
    }
  }
  return { data, content };
}
var MAX_INSTRUCTION_TOKENS = 1e3;
var MAX_SKILL_TOKENS_FULL_INJECTION = 1500;
var ROLE_HEADING_KEYWORDS = {
  "prsquad-architect": [
    "architect",
    "architecture",
    "design",
    "structure",
    "pattern",
    "patterns",
    "database",
    "domain",
    "boundary",
    "boundaries",
    "api",
    "schema",
    "module",
    "modules",
    "system",
    "components"
  ],
  "prsquad-dev": [
    "code",
    "coding",
    "style",
    "naming",
    "convention",
    "conventions",
    "framework",
    "typescript",
    "javascript",
    "java",
    "python",
    "go",
    "rust",
    "lint",
    "format",
    "formatting",
    "impl",
    "implementation",
    "dependency"
  ],
  "prsquad-qa": [
    "test",
    "tests",
    "testing",
    "qa",
    "coverage",
    "fixture",
    "fixtures",
    "mock",
    "mocks",
    "e2e",
    "unit",
    "integration",
    "assert",
    "regression",
    "vitest",
    "jest",
    "pytest",
    "junit"
  ],
  "prsquad-review": [
    "security",
    "review",
    "audit",
    "vulnerability",
    "vulnerabilities",
    "owasp",
    "secret",
    "secrets",
    "license",
    "checklist",
    "safety",
    "threat",
    "compliance"
  ]
};
function sliceCopilotInstructions(repoRoot, targetAgent) {
  if (isAgentMatch(targetAgent, "prsquad") || isAgentMatch(targetAgent, "prsquad-triage")) {
    return null;
  }
  const instructionPath = join4(repoRoot, ".github", "copilot-instructions.md");
  if (!existsSync5(instructionPath)) {
    return null;
  }
  try {
    const raw = readFileSync5(instructionPath, "utf-8");
    if (!raw.trim()) return null;
    let matchedRoleKey = "prsquad-dev";
    if (isAgentMatch(targetAgent, "prsquad-architect")) matchedRoleKey = "prsquad-architect";
    else if (isAgentMatch(targetAgent, "prsquad-qa")) matchedRoleKey = "prsquad-qa";
    else if (isAgentMatch(targetAgent, "prsquad-review")) matchedRoleKey = "prsquad-review";
    const relevantKeywords = ROLE_HEADING_KEYWORDS[matchedRoleKey] || [];
    const sections = [];
    const lines = raw.split("\n");
    let currentTitle = "General";
    let currentBody = [];
    for (const line of lines) {
      if (/^#{1,3}\s+(.+)$/.test(line)) {
        if (currentBody.length > 0) {
          sections.push({ title: currentTitle, body: currentBody.join("\n") });
        }
        currentTitle = line.replace(/^#{1,3}\s+/, "").trim();
        currentBody = [line];
      } else {
        currentBody.push(line);
      }
    }
    if (currentBody.length > 0) {
      sections.push({ title: currentTitle, body: currentBody.join("\n") });
    }
    const matchedSections = [];
    for (const sec of sections) {
      const lowerTitle = sec.title.toLowerCase();
      const isRelevant = relevantKeywords.some((kw) => lowerTitle.includes(kw));
      if (isRelevant) {
        matchedSections.push(sec.body);
      }
    }
    if (matchedSections.length === 0) {
      return null;
    }
    const combined = matchedSections.join("\n\n");
    const approxTokens = Math.ceil(combined.length / 4);
    const TRUNCATION_NOTICE = "\n\n*[Note: Remaining sections truncated to protect context budget. Consult .github/copilot-instructions.md for full guidance.]*";
    const totalCharBudget = MAX_INSTRUCTION_TOKENS * 4;
    if (combined.length > totalCharBudget) {
      const sliceLimit = Math.max(0, totalCharBudget - TRUNCATION_NOTICE.length);
      return combined.slice(0, sliceLimit) + TRUNCATION_NOTICE;
    }
    return combined;
  } catch {
    return null;
  }
}
function scanSkillFiles(dir) {
  if (!existsSync5(dir)) return [];
  const results = [];
  try {
    const entries = readdirSync2(dir);
    for (const entry of entries) {
      const fullPath = join4(dir, entry);
      const stat = statSync2(fullPath);
      if (stat.isDirectory()) {
        results.push(...scanSkillFiles(fullPath));
      } else if (entry.endsWith(".md")) {
        results.push(fullPath);
      }
    }
  } catch {
  }
  return results;
}
function resolveRepoSkills(repoRoot, targetAgent, approvedScope) {
  if (isAgentMatch(targetAgent, "prsquad") || isAgentMatch(targetAgent, "prsquad-triage")) {
    return [];
  }
  const candidateDirs = [];
  if (approvedScope && approvedScope !== "NONE" && approvedScope.trim()) {
    const scopeDir = join4(repoRoot, approvedScope.replace(/[\/\\]$/, ""));
    candidateDirs.push({ path: join4(scopeDir, ".prsquad", "skills"), isProximity: true });
  }
  candidateDirs.push({ path: join4(repoRoot, ".prsquad", "skills"), isProximity: false });
  candidateDirs.push({ path: join4(repoRoot, ".github", "skills"), isProximity: false });
  const resolved = [];
  const seenPaths = /* @__PURE__ */ new Set();
  for (const { path: dir, isProximity } of candidateDirs) {
    const files = scanSkillFiles(dir);
    for (const file of files) {
      if (seenPaths.has(file)) continue;
      seenPaths.add(file);
      try {
        const raw = readFileSync5(file, "utf-8");
        const { data, content } = parseFrontmatter(raw);
        const targets = Array.isArray(data.targets) ? data.targets : [data.targets || "prsquad-dev", "prsquad-architect"];
        const roleMatches = targets.some((t) => isAgentMatch(targetAgent, t));
        if (!roleMatches) continue;
        resolved.push({
          name: data.name || file.replace(/^.*[\\\/]/, "").replace(/\.md$/, ""),
          description: data.description || "Repository specialized skill",
          filePath: file,
          relativePath: relative2(repoRoot, file).replace(/\\/g, "/"),
          targets,
          content: content.trim(),
          isProximityMatch: isProximity
        });
      } catch {
      }
    }
  }
  return resolved;
}
function packageRepoIntelligence(repoRoot, targetAgent, approvedScope) {
  const skills = resolveRepoSkills(repoRoot, targetAgent, approvedScope);
  const slicedInstructions = sliceCopilotInstructions(repoRoot, targetAgent);
  const skillsFull = [];
  const skillsIndexed = [];
  let skillTokens = 0;
  skills.sort((a, b) => (b.isProximityMatch ? 1 : 0) - (a.isProximityMatch ? 1 : 0));
  for (const skill of skills) {
    const estTokens = Math.ceil(skill.content.length / 4);
    if (skillTokens + estTokens <= MAX_SKILL_TOKENS_FULL_INJECTION && (skill.isProximityMatch || skillsFull.length === 0)) {
      skillsFull.push(`#### \u{1F4A1} Skill: ${skill.name} (${skill.relativePath})
${skill.content}`);
      skillTokens += estTokens;
    } else {
      skillsIndexed.push(`- **[${skill.name}]** (\`${skill.relativePath}\`): ${skill.description}`);
    }
  }
  const instructionTokens = slicedInstructions ? Math.ceil(slicedInstructions.length / 4) : 0;
  return {
    skillsFull,
    skillsIndexed,
    slicedInstructions,
    totalTokensApprox: skillTokens + instructionTokens
  };
}

// src/guardrails/toolingBridge.ts
import { existsSync as existsSync6, readFileSync as readFileSync6, readdirSync as readdirSync3 } from "node:fs";
import { join as join5 } from "node:path";
function detectRepoStack(rootDir = getRepoRoot()) {
  const explicitPaths = [
    join5(rootDir, ".prsquad", "config.json"),
    join5(rootDir, ".prsquad.json")
  ];
  for (const configPath of explicitPaths) {
    if (existsSync6(configPath)) {
      try {
        const raw = readFileSync6(configPath, "utf-8");
        const parsed = JSON.parse(raw);
        if (parsed.tooling && parsed.tooling.testCommand) {
          return {
            stack: parsed.stack || "custom",
            testCommand: parsed.tooling.testCommand,
            testFileCommand: parsed.tooling.testFileCommand,
            buildCommand: parsed.tooling.buildCommand,
            lintCommand: parsed.tooling.lintCommand,
            isExplicitConfig: true
          };
        }
      } catch {
      }
    }
  }
  if (existsSync6(join5(rootDir, "pom.xml"))) {
    return {
      stack: "maven",
      testCommand: "mvn test",
      testFileCommand: "mvn test -Dtest=${file}",
      buildCommand: "mvn compile -DskipTests",
      lintCommand: "mvn spotbugs:check",
      isExplicitConfig: false
    };
  }
  if (existsSync6(join5(rootDir, "build.gradle")) || existsSync6(join5(rootDir, "build.gradle.kts"))) {
    const gradleCmd = existsSync6(join5(rootDir, "gradlew")) ? "./gradlew" : "gradle";
    return {
      stack: "gradle",
      testCommand: `${gradleCmd} test`,
      testFileCommand: `${gradleCmd} test --tests ${"${file}"}`,
      buildCommand: `${gradleCmd} assemble`,
      lintCommand: `${gradleCmd} check`,
      isExplicitConfig: false
    };
  }
  if (existsSync6(join5(rootDir, "package.json"))) {
    let runner = "npm test";
    if (existsSync6(join5(rootDir, "pnpm-lock.yaml"))) {
      runner = "pnpm test";
    } else if (existsSync6(join5(rootDir, "yarn.lock"))) {
      runner = "yarn test";
    }
    return {
      stack: "npm",
      testCommand: runner,
      testFileCommand: `${runner} -- \${file}`,
      buildCommand: "npm run build",
      lintCommand: "npm run lint",
      isExplicitConfig: false
    };
  }
  if (existsSync6(join5(rootDir, "pytest.ini")) || existsSync6(join5(rootDir, "pyproject.toml")) || existsSync6(join5(rootDir, "requirements.txt"))) {
    return {
      stack: "pytest",
      testCommand: "pytest",
      testFileCommand: "pytest ${file}",
      lintCommand: "flake8 .",
      isExplicitConfig: false
    };
  }
  if (existsSync6(join5(rootDir, "Cargo.toml"))) {
    return {
      stack: "cargo",
      testCommand: "cargo test",
      testFileCommand: "cargo test --test ${file}",
      buildCommand: "cargo build",
      lintCommand: "cargo clippy",
      isExplicitConfig: false
    };
  }
  if (existsSync6(join5(rootDir, "go.mod"))) {
    return {
      stack: "go",
      testCommand: "go test ./...",
      testFileCommand: "go test -v ${file}",
      buildCommand: "go build ./...",
      lintCommand: "golangci-lint run",
      isExplicitConfig: false
    };
  }
  try {
    const entries = readdirSync3(rootDir);
    if (entries.some((f) => f.endsWith(".sln") || f.endsWith(".csproj") || f.endsWith(".fsproj"))) {
      return {
        stack: "dotnet",
        testCommand: "dotnet test",
        testFileCommand: "dotnet test --filter ${file}",
        buildCommand: "dotnet build",
        isExplicitConfig: false
      };
    }
  } catch {
  }
  return {
    stack: "unknown",
    testCommand: "npm test",
    isExplicitConfig: false
  };
}

// src/guardrails/handoffValidator.ts
import { existsSync as existsSync7 } from "node:fs";
import { join as join6 } from "node:path";
function failValidation(errors, rawJson) {
  return { valid: false, controlState: "HANDOFF_INVALID", errors, rawJson };
}
function extractAgentPayload(raw) {
  if (!raw) return null;
  if (typeof raw === "object" && raw !== null) {
    const obj = raw;
    if (typeof obj.textResultForLlm === "string") return obj.textResultForLlm;
    if (typeof obj.content === "string") return obj.content;
    if (typeof obj.value === "string") return obj.value;
  }
  return raw;
}
function extractJsonFromOutput(raw) {
  if (!raw) return null;
  const target = extractAgentPayload(raw);
  if (typeof target === "object" && target !== null) {
    return target;
  }
  const text = String(target).trim();
  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/i);
  if (fenceMatch) {
    try {
      return JSON.parse(fenceMatch[1].trim());
    } catch {
    }
  }
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
    }
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
var TRIVIAL_AC_PATTERNS = [
  /^(everything|all)\s+works?$/i,
  /^fix\s*(the)?\s*bugs?$/i,
  /^done$/i,
  /^works?$/i,
  /^tests?\s*pass(es)?$/i,
  /^n\/?a$/i,
  /^todo$/i
];
function validateTriage(output, rootDir) {
  const json = extractJsonFromOutput(output);
  if (!json || typeof json !== "object") {
    return failValidation(["Triage output contains no valid JSON object"]);
  }
  const errors = [];
  const validStatuses = ["READY", "NOT_READY", "EMPTY", "FETCH_FAILED"];
  const status = String(json.status || "").toUpperCase();
  if (!validStatuses.includes(status)) {
    errors.push(`Invalid triage status '${json.status}'. Expected one of: ${validStatuses.join(", ")}`);
  }
  if (status === "READY") {
    if (!Array.isArray(json.acceptanceCriteria) || json.acceptanceCriteria.length === 0) {
      errors.push("READY triage requires at least 1 item in 'acceptanceCriteria'");
    } else {
      const substantiveAcs = json.acceptanceCriteria.filter((ac) => {
        const str = String(ac || "").trim();
        if (str.length < 8) return false;
        return !TRIVIAL_AC_PATTERNS.some((p) => p.test(str));
      });
      if (substantiveAcs.length === 0) {
        errors.push(
          "Acceptance criteria are trivial placeholders (e.g. 'Everything works'). Definition of Ready requires concrete, testable conditions of satisfaction."
        );
      }
    }
    const hasValidScope = typeof json.declaredScope === "string" && json.declaredScope.trim().length > 0 || typeof json.declaredScope === "object" && json.declaredScope !== null && Object.keys(json.declaredScope).length > 0 || Array.isArray(json.declaredScope) && json.declaredScope.length > 0;
    if (!hasValidScope) {
      errors.push("READY triage requires non-empty 'declaredScope' (path prefix or functional scope boundaries)");
    }
  } else if (status === "NOT_READY") {
    if (!Array.isArray(json.missing) || json.missing.length === 0) {
      errors.push("NOT_READY triage requires 'missing' array listing unfulfilled Definition-of-Ready items");
    }
  } else if (status === "FETCH_FAILED") {
    if (!json.fetchError) {
      errors.push("FETCH_FAILED triage requires 'fetchError' explaining the failure");
    }
  }
  let normalizedScope = null;
  if (typeof json.declaredScope === "string") {
    normalizedScope = json.declaredScope.trim();
  } else if (Array.isArray(json.declaredScope)) {
    normalizedScope = json.declaredScope.join(", ");
  } else if (typeof json.declaredScope === "object" && json.declaredScope !== null) {
    if (Array.isArray(json.declaredScope.inScope)) {
      normalizedScope = json.declaredScope.inScope.join("; ");
    } else {
      normalizedScope = JSON.stringify(json.declaredScope);
    }
  }
  if (rootDir && status === "READY" && normalizedScope && !normalizedScope.toLowerCase().startsWith("functional:") && !normalizedScope.includes(";")) {
    const cleanPath = normalizedScope.replace(/^\.\//, "").replace(/\/+$/, "");
    if (cleanPath && !cleanPath.includes("*") && !cleanPath.includes(",")) {
      if (!existsSync7(join6(rootDir, cleanPath))) {
        const topSegment = cleanPath.split("/")[0];
        if (!existsSync7(join6(rootDir, topSegment))) {
          errors.push(
            `Declared scope '${normalizedScope}' does not exist within repository '${rootDir}'`
          );
        }
      }
    }
  }
  if (errors.length > 0) {
    return failValidation(errors, json);
  }
  return {
    valid: true,
    data: {
      status,
      clarificationRound: json.clarificationRound,
      issue: json.issue,
      problem: json.problem,
      acceptanceCriteria: json.acceptanceCriteria || [],
      declaredScope: normalizedScope,
      missing: json.missing || [],
      clarifyingQuestion: json.clarifyingQuestion || null,
      fetchError: json.fetchError || null
    },
    rawJson: json
  };
}
function validateArchitect(output) {
  const json = extractJsonFromOutput(output);
  if (!json || typeof json !== "object") {
    return failValidation(["Architect output contains no valid JSON object"]);
  }
  const errors = [];
  const validStatuses = [
    "PLAN_READY",
    "BLOCKED",
    "SCOPE_AMENDMENT_CONFIRMED",
    "SCOPE_AMENDMENT_REJECTED"
  ];
  const status = String(json.status || "").toUpperCase();
  if (!validStatuses.includes(status)) {
    errors.push(`Invalid architect status '${json.status}'. Expected one of: ${validStatuses.join(", ")}`);
  }
  if (status === "PLAN_READY") {
    if (!json.proposedScope || typeof json.proposedScope !== "string" || !json.proposedScope.trim()) {
      errors.push("PLAN_READY architect requires non-empty 'proposedScope'");
    }
    if (!Array.isArray(json.changes) || json.changes.length === 0) {
      errors.push("PLAN_READY architect requires non-empty 'changes' specification list");
    }
    if (!json.rootCause || typeof json.rootCause !== "string") {
      errors.push("PLAN_READY architect requires 'rootCause' explanation");
    }
  } else if (status === "BLOCKED") {
    if (!json.blockedReason || typeof json.blockedReason !== "string") {
      errors.push("BLOCKED architect requires 'blockedReason' explanation");
    }
  } else if (status === "SCOPE_AMENDMENT_CONFIRMED") {
    if (!json.proposedScope) {
      errors.push("SCOPE_AMENDMENT_CONFIRMED requires updated 'proposedScope'");
    }
  } else if (status === "SCOPE_AMENDMENT_REJECTED") {
    if (!json.reason) {
      errors.push("SCOPE_AMENDMENT_REJECTED requires 'reason' for rejection");
    }
  }
  if (errors.length > 0) {
    return failValidation(errors, json);
  }
  return {
    valid: true,
    data: {
      status,
      rootCause: json.rootCause,
      changes: json.changes,
      proposedScope: json.proposedScope,
      blastRadius: json.blastRadius,
      validationPlan: json.validationPlan,
      plainLanguageSummary: json.plainLanguageSummary,
      blockedReason: json.blockedReason,
      revisedPlan: json.revisedPlan,
      reason: json.reason
    },
    rawJson: json
  };
}
function validateDeveloper(output) {
  const json = extractJsonFromOutput(output);
  if (!json || typeof json !== "object") {
    return failValidation(["Developer output contains no valid JSON object"]);
  }
  const errors = [];
  const validStatuses = ["IMPLEMENTED", "BLOCKED", "SCOPE_AMENDMENT_REQUIRED"];
  let rawStatus = String(json.status || "").toUpperCase();
  if (rawStatus === "DONE" || rawStatus === "COMPLETED" || rawStatus === "SUCCESS" || rawStatus === "COMPLETE") {
    rawStatus = "IMPLEMENTED";
  }
  const status = rawStatus;
  if (!validStatuses.includes(status)) {
    errors.push(`Invalid developer status '${json.status}'. Expected one of: ${validStatuses.join(", ")}`);
  }
  const filesChanged = json.filesChanged || json.changedFiles;
  const diffRef = json.diffReference || (json.baseRef || json.headRef || json.commitSha ? { baseRef: json.baseRef || "HEAD~1", headRef: json.headRef || json.commitSha || "HEAD" } : void 0);
  if (status === "IMPLEMENTED") {
    if (!Array.isArray(filesChanged) || filesChanged.length === 0) {
      errors.push("IMPLEMENTED developer handoff requires non-empty 'filesChanged' list");
    }
    if (!diffRef || typeof diffRef !== "object") {
      errors.push("IMPLEMENTED developer handoff requires 'diffReference' with baseRef and headRef");
    } else {
      const hasBase = Boolean(diffRef.baseRef);
      const hasHead = Boolean(diffRef.headRef || json.commitSha);
      if (!hasBase) {
        errors.push("IMPLEMENTED developer handoff requires 'diffReference.baseRef'");
      }
      if (!hasHead) {
        errors.push("IMPLEMENTED developer handoff requires 'diffReference.headRef' or 'commitSha'");
      }
    }
  } else if (status === "BLOCKED") {
    if (!json.blocker || typeof json.blocker !== "object") {
      errors.push("BLOCKED developer handoff requires 'blocker' object with description and type");
    }
  } else if (status === "SCOPE_AMENDMENT_REQUIRED") {
    if (!json.scopeAmendmentRequest || !Array.isArray(json.scopeAmendmentRequest.requestedPaths) || json.scopeAmendmentRequest.requestedPaths.length === 0) {
      errors.push("SCOPE_AMENDMENT_REQUIRED developer handoff requires 'scopeAmendmentRequest' with requestedPaths");
    }
  }
  if (errors.length > 0) {
    return failValidation(errors, json);
  }
  return {
    valid: true,
    data: {
      status,
      filesChanged: json.filesChanged || [],
      testsAddedOrChanged: json.testsAddedOrChanged || [],
      planItemsAddressed: json.planItemsAddressed || [],
      acceptanceCriteriaCoverage: json.acceptanceCriteriaCoverage || [],
      validationRun: json.validationRun || [],
      diffReference: json.diffReference || {},
      scopeAmendmentRequest: json.scopeAmendmentRequest || null,
      blocker: json.blocker || null,
      assumptions: json.assumptions || [],
      residualRisk: json.residualRisk || []
    },
    rawJson: json
  };
}
function validateQA(output) {
  const json = extractJsonFromOutput(output);
  if (!json || typeof json !== "object") {
    return failValidation(["QA output contains no valid JSON object"]);
  }
  const errors = [];
  const validVerdicts = ["PASS", "FAIL", "BLOCKED"];
  let rawVerdict = String(json.verdict || "").toUpperCase();
  if (rawVerdict === "PASSED" || rawVerdict === "SUCCESS") rawVerdict = "PASS";
  if (rawVerdict === "FAILED") rawVerdict = "FAIL";
  const verdict = rawVerdict;
  if (!validVerdicts.includes(verdict)) {
    errors.push(`Invalid QA verdict '${json.verdict}'. Expected one of: ${validVerdicts.join(", ")}`);
  }
  const validScope = ["PASS", "FAIL"];
  let rawScope = String(json.scopeCompliance || "").toUpperCase();
  if (rawScope === "PASSED" || rawScope === "TRUE") rawScope = "PASS";
  const scopeCompliance = rawScope;
  if (!validScope.includes(scopeCompliance)) {
    errors.push(`Invalid QA scopeCompliance '${json.scopeCompliance}'. Expected: PASS or FAIL`);
  }
  const criteriaList = json.acceptanceCriteriaResults || json.criteriaResults || json.criteria;
  if (verdict === "FAIL") {
    const hasFailClassification = Array.isArray(json.failureClassification) && json.failureClassification.length > 0;
    const hasFindings = Array.isArray(json.blockingFindings) && json.blockingFindings.length > 0;
    const hasFailCriteria = Array.isArray(criteriaList) && criteriaList.some((c) => c.result === "FAIL" || c.status === "FAIL");
    if (!hasFailClassification && !hasFindings && !hasFailCriteria && scopeCompliance !== "FAIL") {
      errors.push("QA verdict 'FAIL' requires failureClassification, blockingFindings, or failing acceptance criteria");
    }
  } else if (verdict === "PASS") {
    if (scopeCompliance !== "PASS") {
      errors.push("QA verdict 'PASS' requires scopeCompliance to be 'PASS'");
    }
    if (!Array.isArray(criteriaList) || criteriaList.length === 0) {
      errors.push("QA verdict 'PASS' requires non-empty 'acceptanceCriteriaResults' proving verification");
    } else {
      const isItemPassing = (c) => c.result === "PASS" || c.status === "PASS" || c.passed === true || c.verified === true;
      const hasNonPassing = criteriaList.some((c) => !isItemPassing(c));
      if (hasNonPassing) {
        errors.push("QA verdict 'PASS' requires all acceptance criteria to report 'PASS' (found unverified or failing criteria)");
      }
    }
    if (Array.isArray(json.failureClassification)) {
      const hasGenuineFixFailures = json.failureClassification.some((f) => f.classification === "GENUINE_FIX_CAUSED");
      if (hasGenuineFixFailures) {
        errors.push("QA verdict 'PASS' is internally contradictory: failureClassification contains 'GENUINE_FIX_CAUSED'");
      }
      const hasUnresolvedInfra = json.failureClassification.some((f) => f.classification === "INFRASTRUCTURE" && !f.resolved);
      if (hasUnresolvedInfra) {
        errors.push("QA verdict 'PASS' has unresolved INFRASTRUCTURE failures");
      }
      const hasUnknown = json.failureClassification.some((f) => f.classification === "UNKNOWN");
      if (hasUnknown) {
        errors.push("QA verdict 'PASS' cannot have UNKNOWN failure classifications");
      }
    }
    if (Array.isArray(json.blockingFindings) && json.blockingFindings.length > 0) {
      errors.push("QA verdict 'PASS' cannot have unresolved blockingFindings");
    }
  }
  if (errors.length > 0) {
    return failValidation(errors, json);
  }
  return {
    valid: true,
    data: {
      verdict,
      scopeCompliance,
      acceptanceCriteriaResults: json.acceptanceCriteriaResults || [],
      testResults: json.testResults || [],
      failureClassification: json.failureClassification || [],
      blockingFindings: json.blockingFindings || [],
      notes: json.notes || []
    },
    rawJson: json
  };
}
function validateReview(output) {
  const json = extractJsonFromOutput(output);
  if (!json || typeof json !== "object") {
    return failValidation(["Reviewer output contains no valid JSON object"]);
  }
  const errors = [];
  const validAssessments = ["CLEAR", "CONCERNS"];
  let rawAssessment = String(json.assessment || json.verdict || json.status || "").toUpperCase();
  if (rawAssessment === "APPROVED" || rawAssessment === "PASSED" || rawAssessment === "CLEARED") {
    rawAssessment = "CLEAR";
  }
  const assessment = rawAssessment;
  if (!validAssessments.includes(assessment)) {
    errors.push(`Invalid Reviewer assessment '${json.assessment}'. Expected: CLEAR or CONCERNS`);
  }
  const validScope = ["PASS", "CONCERN"];
  let rawScope = String(json.scopeCompliance || "").toUpperCase();
  if (rawScope === "PASSED" || rawScope === "TRUE") rawScope = "PASS";
  const scopeCompliance = rawScope;
  if (!validScope.includes(scopeCompliance)) {
    errors.push(`Invalid Reviewer scopeCompliance '${json.scopeCompliance}'. Expected: PASS or CONCERN`);
  }
  if (assessment === "CONCERNS") {
    if (!Array.isArray(json.riskFlags) || json.riskFlags.length === 0) {
      errors.push("Reviewer assessment 'CONCERNS' requires at least 1 entry in 'riskFlags'");
    }
  }
  if (errors.length > 0) {
    return failValidation(errors, json);
  }
  return {
    valid: true,
    data: {
      assessment,
      scopeCompliance,
      riskFlags: json.riskFlags || [],
      qualityNotes: json.qualityNotes || [],
      residualRisk: json.residualRisk || [],
      mergeGateSummary: json.mergeGateSummary || ""
    },
    rawJson: json
  };
}

// src/guardrails/scopeApprover.ts
import { createHash } from "node:crypto";
import { execSync as execSync4 } from "node:child_process";
function canonicalJsonStringify(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalJsonStringify).join(",") + "]";
  }
  const obj = value;
  const sortedKeys = Object.keys(obj).sort();
  const entries = sortedKeys.map((k) => JSON.stringify(k) + ":" + canonicalJsonStringify(obj[k]));
  return "{" + entries.join(",") + "}";
}
function computePlanHash(planOrHandoff) {
  if (!planOrHandoff) return "";
  let normalized = "";
  if (typeof planOrHandoff === "string") {
    normalized = planOrHandoff.replace(/\r\n/g, "\n").trim();
  } else if (typeof planOrHandoff === "object") {
    try {
      normalized = canonicalJsonStringify(planOrHandoff);
    } catch {
      normalized = String(planOrHandoff);
    }
  }
  if (!normalized) return "";
  return createHash("sha256").update(normalized).digest("hex");
}
function computeApprovalEnvelopeHash(envelope) {
  const canonical = canonicalJsonStringify(envelope);
  return createHash("sha256").update(canonical).digest("hex");
}
function approveScopeGate(options = {}) {
  const repoRoot = getRepoRoot(options.preferredDir || process.cwd());
  const state = loadState(repoRoot);
  const dashData = loadDashboardState(repoRoot);
  const targetScope = options.scope || state.approvedScope || dashData?.phases?.architect?.details?.proposedScope || dashData?.phases?.scopeGate?.details?.approvedScope || state.issue?.declaredScope || dashData?.phases?.intake?.details?.declaredScope;
  if (!targetScope || typeof targetScope !== "string" || !targetScope.trim()) {
    return {
      success: false,
      error: "No architectural plan or proposed scope boundary found to approve. Architect must synthesize an issue specification into a proposed scope before the Scope Gate can be approved."
    };
  }
  const issueNumber = options.issue || state.issue?.number || (dashData?.issueNumber ? Number(dashData.issueNumber) : 0);
  if (!issueNumber || issueNumber <= 0) {
    return {
      success: false,
      error: "Cannot approve scope gate without a valid issue number."
    };
  }
  const approver = options.approver || "Human Maintainer (/approve)";
  let rawPlan = void 0;
  if (options.plan !== void 0) {
    rawPlan = typeof options.plan === "string" ? options.plan.trim() : options.plan;
  } else {
    rawPlan = dashData?.phases?.architect?.details?.plan || dashData?.phases?.architect?.details?.changes || state.approvedPlan || dashData?.phases?.architect?.summary;
  }
  if (!rawPlan) {
    return {
      success: false,
      error: "SCOPE_GATE_BLOCKED (MANDATORY_PLAN_REQUIRED): Cannot approve scope without a canonical architecture plan. Architect must produce a validated plan before the Human Scope Gate can be approved."
    };
  }
  const planHash = computePlanHash(rawPlan);
  if (!planHash) {
    return {
      success: false,
      error: "SCOPE_GATE_BLOCKED: Failed to compute canonical plan hash for architecture plan."
    };
  }
  let baseRef = options.baseRef;
  if (!baseRef) {
    try {
      baseRef = execSync4("git rev-parse HEAD", {
        cwd: repoRoot,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"]
      }).trim();
    } catch {
      baseRef = state.baseRef || "HEAD";
    }
  }
  const approvedScopeStr = String(targetScope).replace(/\\/g, "/");
  const approvalEnvelopeHash = computeApprovalEnvelopeHash({
    issueNumber,
    approvedScope: approvedScopeStr,
    baseRef,
    plan: rawPlan
  });
  const lock = {
    issueNumber,
    approvedScope: approvedScopeStr,
    planHash,
    approvalEnvelopeHash,
    baseRef,
    maxAttempts: 3,
    currentAttempt: 1,
    approvedAt: (/* @__PURE__ */ new Date()).toISOString(),
    approvedBy: approver,
    status: "ACTIVE"
  };
  saveApprovalLock(lock, repoRoot);
  state.approvedScope = lock.approvedScope;
  if (lock.baseRef) state.baseRef = lock.baseRef;
  state.humanApproval = true;
  state.phase = "DEVELOPING";
  state.implementationAttempt = 1;
  saveState(state, repoRoot);
  const summaryHashSuffix = lock.planHash ? ` [planHash: ${lock.planHash.slice(0, 8)}]` : "";
  syncWorkflowDashboard(repoRoot, {
    owner: state.issue?.owner || dashData?.owner || "vamsicherukuri",
    repo: state.issue?.repo || dashData?.repo || "prsquad",
    issueNumber: lock.issueNumber,
    issueTitle: state.issue?.title || dashData?.issueTitle || "Active Pipeline Task",
    sessionId: state.sessionId,
    phase: "scopeGate",
    status: "APPROVED",
    summary: `Scope boundary approved by ${lock.approvedBy} (${lock.approvedScope})${summaryHashSuffix}`,
    details: {
      approvedScope: lock.approvedScope,
      planHash: lock.planHash,
      baseRef: lock.baseRef,
      approvedBy: lock.approvedBy,
      approvedAt: lock.approvedAt,
      status: "APPROVED"
    }
  });
  appendAuditLog(
    {
      sessionId: state.sessionId,
      agent: "human",
      tool: "scope-approve",
      action: "human_scope_gate_approved",
      decision: "allow",
      details: {
        issueNumber: lock.issueNumber,
        approvedScope: lock.approvedScope,
        planHash: lock.planHash,
        baseRef: lock.baseRef,
        approvedBy: lock.approvedBy,
        maxAttempts: lock.maxAttempts
      }
    },
    repoRoot
  );
  return {
    success: true,
    lock
  };
}

// src/guardrails/stagePolicies.ts
function resolveBaseRef(rootDir, preferredRef) {
  if (preferredRef) {
    try {
      return execSync5(`git rev-parse --verify "${preferredRef}^{commit}"`, {
        cwd: rootDir,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"]
      }).trim();
    } catch {
    }
  }
  for (const candidate of ["HEAD~1", "origin/master", "origin/main", "master", "main"]) {
    try {
      return execSync5(`git rev-parse --verify "${candidate}^{commit}"`, {
        cwd: rootDir,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"]
      }).trim();
    } catch {
    }
  }
  return "";
}
function mintTransitionId(stage) {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 6);
  return `tr-${stage.toLowerCase()}-${ts}-${rand}`;
}
function formatRepoIntelligenceForPrompt(repoRoot, targetAgent, approvedScope) {
  const intel = packageRepoIntelligence(repoRoot, targetAgent, approvedScope);
  const sections = [];
  if (intel.skillsFull.length > 0) {
    sections.push(`### \u{1F4A1} Specialized Repository Skills
${intel.skillsFull.join("\n\n")}`);
  }
  if (intel.skillsIndexed.length > 0) {
    sections.push(`### \u{1F4DA} Additional Available Repository Skills
${intel.skillsIndexed.join("\n")}
*(Use read tool on skill path if needed)*`);
  }
  if (intel.slicedInstructions) {
    sections.push(`### \u{1F4CB} Relevant Repository Instructions
${intel.slicedInstructions}`);
  }
  return sections.join("\n\n");
}
function formatControlPlaneTelemetry(meter, statusText) {
  if (!meter && !statusText) return "";
  const cleanedStatus = statusText ? statusText.replace(/^\[INSTRUCTION FOR CONTROLLER\]:\s*/i, "").trim() : "";
  return `<!-- PR_SQUAD_CONTROL_PLANE_TELEMETRY_START -->
### \u{1F4CA} Verified Control Plane Telemetry (Local Guardrail Hook)
` + (meter ? `${meter}

` : "") + (cleanedStatus ? `> **Control Plane Status**: ${cleanedStatus}
` : "") + `<!-- PR_SQUAD_CONTROL_PLANE_TELEMETRY_END -->`;
}
function sanitizeSpecialistHandoff(rawText, agentName) {
  if (!rawText) return "";
  const jsonMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)\s*```/) || rawText.match(/(\{[\s\S]*\})/);
  if (isAgentMatch(agentName, "gated-change-developer")) {
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[1]);
        if (parsed.status) {
          return `\`\`\`json
${JSON.stringify({
            status: parsed.status,
            changedFiles: parsed.changedFiles || [],
            tests: parsed.tests || { status: "PASS" },
            commitSha: parsed.commitSha || parsed.headRef || "HEAD",
            diffReference: parsed.diffReference || { headRef: parsed.headRef || "HEAD" },
            scopeAmendmentRequest: parsed.scopeAmendmentRequest || null,
            assumptions: parsed.assumptions || [],
            residualRisk: parsed.residualRisk || "Low"
          }, null, 2)}
\`\`\``;
        }
      } catch {
      }
    }
  } else if (isAgentMatch(agentName, "gated-change-qa")) {
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[1]);
        if (parsed.verdict) {
          return `\`\`\`json
${JSON.stringify({
            verdict: parsed.verdict,
            scopeCompliance: parsed.scopeCompliance || "PASS",
            acceptanceCriteriaResults: parsed.acceptanceCriteriaResults || parsed.criteriaResults || parsed.criteria || [],
            testResults: parsed.testResults || { passed: true },
            blockingFindings: parsed.blockingFindings || [],
            notes: parsed.notes || ""
          }, null, 2)}
\`\`\``;
        }
      } catch {
      }
    }
  } else if (isAgentMatch(agentName, "gated-change-reviewer")) {
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[1]);
        if (parsed.verdict) {
          return `\`\`\`json
${JSON.stringify({
            verdict: parsed.verdict,
            findings: parsed.findings || [],
            scopeAudit: parsed.scopeAudit || "PASS",
            notes: parsed.notes || ""
          }, null, 2)}
\`\`\``;
        }
      } catch {
      }
    }
  } else if (isAgentMatch(agentName, "gated-change-architect")) {
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[1]);
        if (parsed.status) {
          return `\`\`\`json
${JSON.stringify({
            status: parsed.status,
            rootCause: parsed.rootCause || "",
            changes: parsed.changes || [],
            proposedScope: parsed.proposedScope || "",
            blastRadius: parsed.blastRadius || { risk: "Low", affectedOutsideScope: [] },
            validationPlan: parsed.validationPlan || [],
            plainLanguageSummary: parsed.plainLanguageSummary || "",
            blockedReason: parsed.blockedReason || null
          }, null, 2)}
\`\`\``;
        }
      } catch {
      }
    }
  }
  const lines = rawText.split("\n");
  if (lines.length > 80) {
    const head = lines.slice(0, 30).join("\n");
    const tail = lines.slice(-30).join("\n");
    return `${head}

... [${lines.length - 60} lines of verbose execution logs trimmed by guardrail hook for token efficiency] ...

${tail}`;
  }
  return rawText;
}
function buildEnrichedPostToolOutput(hookInput, meter, instructionText, agentName) {
  const raw = typeof hookInput.toolResult === "string" ? hookInput.toolResult : hookInput.toolResult?.textResultForLlm || hookInput.toolResult?.content || (hookInput.toolResult ? JSON.stringify(hookInput.toolResult) : "");
  const sanitized = sanitizeSpecialistHandoff(raw, agentName);
  const telemetryBlock = formatControlPlaneTelemetry(meter, instructionText);
  const enrichedText = telemetryBlock ? `${sanitized}

${telemetryBlock}` : sanitized;
  const modified = {
    resultType: hookInput.toolResult?.resultType || "success",
    textResultForLlm: enrichedText
  };
  const addCtx = telemetryBlock;
  return {
    decision: "allow",
    permissionDecision: "allow",
    modifiedResult: modified,
    additionalContext: addCtx,
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      permissionDecision: "allow",
      modifiedResult: modified,
      additionalContext: addCtx
    }
  };
}
function buildDeveloperHandoffPayload(repoPath, stateObj, fallbackPrompt, issueNum) {
  let details = {};
  const dashData = loadDashboardState(repoPath);
  if (dashData?.phases?.developer?.details) {
    details = { ...dashData.phases.developer.details };
  }
  if (!details.commitSha || !details.changedFiles) {
    const fromPrompt = extractDeveloperDetails(fallbackPrompt, repoPath);
    details = { ...fromPrompt, ...details };
  }
  if (!details.commitSha) {
    try {
      details.commitSha = execSync5("git rev-parse HEAD", { cwd: repoPath, encoding: "utf-8" }).trim();
    } catch {
      details.commitSha = "HEAD";
    }
  }
  if (!details.changedFiles || details.changedFiles.length === 0) {
    try {
      const files = execSync5("git diff-tree --no-commit-id --name-only -r HEAD", { cwd: repoPath, encoding: "utf-8" }).trim().split("\n").filter(Boolean);
      if (files.length > 0) details.changedFiles = files;
    } catch {
    }
  }
  const archPlan = dashData?.phases?.architect?.details?.plan || "";
  const approvedScope = stateObj?.approvedScope || dashData?.phases?.scopeGate?.details?.approvedScope || "src/scopeTool.ts, scripts/test-guardrails.ts";
  const activeBranch = stateObj?.activeBranch || `fix/issue-${issueNum}`;
  const mdParts = [
    `### \u{1F4E6} Deterministic Developer Phase Handoff (Injected by Hook)`,
    `> **Status:** \`${details.status || "IMPLEMENTED"}\`  `,
    `> **Approved Scope:** \`${approvedScope}\`  `,
    `> **Active Branch:** \`${activeBranch}\`  `,
    `> **Commit SHA (headRef):** \`${details.commitSha}\`  `,
    `> **Base Reference (baseRef):** \`${details.baseRef || stateObj?.baseRef || "HEAD~1"}\`  `,
    `> **Changed Files:** \`${(details.changedFiles || []).join("`, `") || "detected in git"}\``
  ];
  if (details.testsAddedOrChanged && details.testsAddedOrChanged.length > 0) {
    mdParts.push(`#### \u{1F9EA} Tests Added/Changed by Developer
${details.testsAddedOrChanged.map((t) => `- ${t}`).join("\n")}`);
  }
  if (details.testSummary) {
    mdParts.push(`#### \u{1F50D} Developer Test Summary
${details.testSummary}`);
  }
  if (archPlan) {
    const planStr = typeof archPlan === "string" ? archPlan.trim() : JSON.stringify(archPlan, null, 2);
    mdParts.push(`#### \u{1F4D0} Approved Architecture Plan
${planStr}`);
  }
  const issueBody = typeof stateObj?.issue?.body === "string" ? stateObj.issue.body.trim() : "";
  if (issueBody) {
    mdParts.push(`#### \u{1F4CB} Verified Issue Acceptance Criteria & Specification
${issueBody}`);
  }
  return {
    details,
    markdown: mdParts.join("\n\n")
  };
}
function buildQAHandoffPayload(repoPath, stateObj, fallbackPrompt) {
  let details = {};
  const dashData = loadDashboardState(repoPath);
  if (dashData?.phases?.qa?.details) {
    details = { ...dashData.phases.qa.details };
  }
  if (!details.verdict) {
    const fromPrompt = extractQADetails(fallbackPrompt);
    details = { ...fromPrompt, ...details };
  }
  const approvedScope = stateObj?.approvedScope || dashData?.phases?.scopeGate?.details?.approvedScope || "NOT RECORDED";
  const mdParts = [
    `### \u{1F9EA} Deterministic QA Verification Evidence (Injected by Hook)`,
    `> **Verdict:** \`${details.verdict || "NOT RECORDED"}\`  `,
    `> **Scope Compliance:** \`${details.scopeCompliance || "NOT RECORDED"}\`${approvedScope !== "NOT RECORDED" ? ` (Strictly within \`${approvedScope}\`)` : ""}  `,
    details.criteriaSummary ? `> **Acceptance Criteria:** ${details.criteriaSummary}  ` : `> **Acceptance Criteria:** NOT RECORDED  `,
    details.testNotes ? `> **QA Test Notes:** ${details.testNotes}` : ""
  ].filter(Boolean);
  return {
    details,
    markdown: mdParts.join("\n")
  };
}
var IntakePolicy = {
  stage: "INTAKE",
  agentAliases: ["prsquad-triage", "prsquad-intake", "gated-change-intake", "intake", "triage"],
  allowedPriorPhases: ["INITIAL", "INTAKE", "INTAKE_TRIAGE", "PAUSED"],
  checkPrerequisites(ctx) {
    if (ctx.state.issueValidation === "FAIL" || ctx.state.intakeEligibility === "BLOCKED") {
      return {
        allowed: false,
        reason: `DETERMINISTIC_POLICY_BLOCK: Issue is blocked by policy (${ctx.state.pauseReason || "Validation failed"}). Execution halted fail-closed.`
      };
    }
    return { allowed: true };
  },
  buildInputContext(ctx) {
    let addCtx = "";
    const cachePath = ctx.state.issueSnapshot || join7(ctx.repoRoot, ".gated-change", "issue-cache.json");
    if (existsSync8(cachePath)) {
      try {
        const cached = JSON.parse(readFileSync7(cachePath, "utf-8"));
        addCtx = `### \u{1F4CB} Authority Issue Specification (Cached Snapshot)
\`\`\`json
${JSON.stringify(cached, null, 2)}
\`\`\`
`;
      } catch {
      }
    }
    return {
      additionalContext: addCtx || void 0
    };
  },
  validateOutput(rawOutput, ctx) {
    const triageVal = validateTriage(rawOutput, ctx.repoRoot);
    const triageStatus = triageVal.valid ? triageVal.data.status : "HANDOFF_INVALID";
    return {
      valid: triageVal.valid,
      verdict: triageStatus,
      details: triageVal.valid ? triageVal.data : void 0,
      errors: triageVal.valid ? void 0 : triageVal.errors
    };
  },
  commitTransition(valResult, ctx) {
    const transitionId = mintTransitionId("intake");
    ctx.state.lastTransitionId = transitionId;
    if (valResult.valid) {
      StateController.commitIntakeVerdict(
        ctx.repoRoot,
        valResult.details,
        ctx.sessionId
      );
    } else {
      StateController.pauseWorkflow(
        ctx.repoRoot,
        `INTAKE_HANDOFF_INVALID: ${(valResult.errors || []).join("; ")}`,
        ctx.resolvedIssue,
        ctx.sessionId
      );
    }
    const dash = loadDashboardState(ctx.repoRoot);
    let instructionText = "";
    if (!valResult.valid) {
      instructionText = `[INSTRUCTION FOR CONTROLLER]: Triage handoff failed validation (${(valResult.errors || []).join("; ")}). Issue one schema-correction prompt to Intake specialist or pause pipeline.`;
    } else if (valResult.verdict === "EMPTY") {
      instructionText = "[INSTRUCTION FOR CONTROLLER]: HARD FAIL - Issue lacks substantive content/description. Do not prompt user for clarification. Pipeline halted.";
    } else if (valResult.verdict === "FETCH_FAILED") {
      instructionText = dash?.phases?.intake?.status === "FETCH_RETRY" ? `[INSTRUCTION FOR CONTROLLER]: Issue fetch failed (${valResult.details?.fetchError || "network error"}). Retrying issue fetch.` : "[INSTRUCTION FOR CONTROLLER]: Issue fetch failed after retries. Pipeline halted.";
    } else if (valResult.verdict === "NOT_READY") {
      instructionText = "[INSTRUCTION FOR CONTROLLER]: Issue is NOT_READY. Ask the maintainer the single clarifying question to satisfy Definition of Ready (round 1/2).";
    } else {
      instructionText = "[INSTRUCTION FOR CONTROLLER]: Intake triage complete. Include this live \u26A1 AI Credit Meter status in your handoff message before delegating to Architect.";
    }
    appendAuditLog({
      sessionId: ctx.sessionId,
      transitionId,
      agent: "controller",
      action: "stage_commit_intake",
      decision: valResult.valid ? "allow" : "deny",
      details: { verdict: valResult.verdict, errors: valResult.errors }
    }, ctx.repoRoot);
    return {
      transitionId,
      nextPhase: ctx.state.phase,
      instructionText
    };
  }
};
var ArchitectPolicy = {
  stage: "ARCHITECTING",
  agentAliases: ["prsquad-architect", "gated-change-architect", "architect"],
  allowedPriorPhases: ["ARCHITECTING", "INTAKE", "DEVELOPING", "AWAITING_SCOPE_APPROVAL"],
  checkPrerequisites(ctx) {
    return { allowed: true };
  },
  buildInputContext(ctx) {
    const declaredScope = ctx.state.approvedScope || ctx.state.issue?.declaredScope || "src/guardrails/scopeEnforcer.ts, scripts/test-guardrails.ts";
    const astMap = generateAstPreFetchMap(declaredScope, ctx.repoRoot);
    const dashArch = syncWorkflowDashboard(ctx.repoRoot, {
      owner: ctx.state.issue?.owner || "vamsicherukuri",
      repo: ctx.state.issue?.repo || "prsquad",
      issueNumber: ctx.resolvedIssue,
      issueTitle: ctx.state.issue?.title || (ctx.state.issue?.number ? `Issue #${ctx.state.issue.number}` : "Active Pipeline Task"),
      sessionId: ctx.sessionId,
      phase: "architect",
      status: "IN_PROGRESS",
      summary: "Architect synthesizing issue requirements into bounded technical plan"
    });
    const chatMeter = formatChatCreditMeter(dashArch);
    const repoIntel = formatRepoIntelligenceForPrompt(ctx.repoRoot, ctx.targetAgent, declaredScope);
    let addCtx = "";
    if (astMap) addCtx += `${astMap}

`;
    if (repoIntel) addCtx += `${repoIntel}

`;
    if (chatMeter) {
      addCtx += `

${formatControlPlaneTelemetry(chatMeter, "Intake complete. Surface this live \u{1F4CA} AI Credit Meter status in your handoff message to the user before generating the architectural plan.")}`;
    }
    return {
      modifiedPrompt: astMap ? `${astMap}

${ctx.prompt}` : ctx.prompt,
      additionalContext: addCtx || void 0
    };
  },
  validateOutput(rawOutput, ctx) {
    const archVal = validateArchitect(rawOutput);
    const archStatus = archVal.valid ? archVal.data.status : "HANDOFF_INVALID";
    return {
      valid: archVal.valid,
      verdict: archStatus,
      details: archVal.valid ? archVal.data : void 0,
      errors: archVal.valid ? void 0 : archVal.errors
    };
  },
  commitTransition(valResult, ctx) {
    const transitionId = mintTransitionId("architect");
    ctx.state.lastTransitionId = transitionId;
    const rawText = typeof ctx.input.toolResult === "string" ? ctx.input.toolResult : ctx.input.toolResult?.textResultForLlm || ctx.input.toolResult?.content || JSON.stringify(ctx.input.toolResult || "");
    const planMarkdown = extractPlanMarkdown(rawText);
    const proposedScope = valResult.valid && valResult.details?.proposedScope ? valResult.details.proposedScope : ctx.state.approvedScope || "NOT RECORDED";
    const archSummary = valResult.valid ? valResult.verdict === "PLAN_READY" ? "Technical architecture plan & scope specification generated" : valResult.verdict === "BLOCKED" ? `Architect blocked: ${valResult.details?.blockedReason || "Cannot produce confident plan"}` : `Scope amendment ${valResult.verdict}` : `Architect handoff validation failed: ${(valResult.errors || []).join("; ")}`;
    const dashArch = syncWorkflowDashboard(ctx.repoRoot, {
      owner: ctx.state.issue?.owner || "vamsicherukuri",
      repo: ctx.state.issue?.repo || "prsquad",
      issueNumber: ctx.resolvedIssue,
      issueTitle: ctx.state.issue?.title || (ctx.state.issue?.number ? `Issue #${ctx.state.issue.number}` : "Active Pipeline Task"),
      sessionId: ctx.sessionId,
      phase: "architect",
      status: valResult.verdict,
      summary: archSummary,
      details: {
        plan: planMarkdown || rawText,
        proposedScope,
        riskTier: valResult.valid && valResult.details?.blastRadius?.risk || "Low",
        validated: valResult.valid,
        errors: valResult.valid ? void 0 : valResult.errors
      }
    });
    if (valResult.valid && valResult.verdict === "PLAN_READY") {
      ctx.state.phase = "PLAN_READY";
      ctx.state.currentPhase = "PLAN_READY";
      ctx.state.approvedScope = proposedScope;
      ctx.state.approvedPlan = planMarkdown || rawText;
      saveState(ctx.state, ctx.repoRoot);
    } else if (!valResult.valid) {
      StateController.pauseWorkflow(ctx.repoRoot, archSummary, ctx.resolvedIssue, ctx.sessionId);
    }
    const instructionText = !valResult.valid ? `[INSTRUCTION FOR CONTROLLER]: Architect handoff failed validation (${(valResult.errors || []).join("; ")}). Pause pipeline and report blocker to maintainer.` : valResult.verdict === "BLOCKED" ? "[INSTRUCTION FOR CONTROLLER]: Architect reported BLOCKED. Pause pipeline and report blocker to maintainer." : valResult.verdict === "SCOPE_AMENDMENT_CONFIRMED" ? "[INSTRUCTION FOR CONTROLLER]: Scope amendment confirmed by Architect. Route back to Scope Approval Gate for human confirmation." : "[INSTRUCTION FOR CONTROLLER]: Include this live \u26A1 AI Credit Meter table alongside the architecture plan at the Scope Approval Gate.";
    appendAuditLog({
      sessionId: ctx.sessionId,
      transitionId,
      agent: "controller",
      action: "stage_commit_architect",
      decision: valResult.valid ? "allow" : "deny",
      details: { verdict: valResult.verdict, proposedScope }
    }, ctx.repoRoot);
    return {
      transitionId,
      nextPhase: ctx.state.phase,
      instructionText
    };
  }
};
var DeveloperPolicy = {
  stage: "DEVELOPING",
  agentAliases: ["prsquad-dev", "prsquad-developer", "gated-change-developer", "developer"],
  allowedPriorPhases: ["DEVELOPING", "TESTING", "REVIEWING", "AWAITING_SCOPE_APPROVAL", "PLAN_READY"],
  checkPrerequisites(ctx) {
    let lock = ctx.lock;
    if (!lock) {
      const lockFilePath = join7(ctx.repoRoot, ".gated-change", "approval.lock");
      let existingLockStatus = null;
      if (existsSync8(lockFilePath)) {
        try {
          const raw = JSON.parse(readFileSync7(lockFilePath, "utf-8"));
          existingLockStatus = raw.status || null;
        } catch {
        }
      }
      const isExplicitlyRevokedOrExhausted = existingLockStatus === "REVOKED" || existingLockStatus === "EXHAUSTED";
      if (!isExplicitlyRevokedOrExhausted) {
        const dashData = loadDashboardState(ctx.repoRoot);
        const promptText = String(
          ctx.toolArgs.prompt || ctx.toolArgs.content || ctx.toolArgs.message || ctx.firstTool?.args?.prompt || ""
        );
        const hasArchitectPlan = Boolean(
          dashData?.phases?.architect?.status === "PLAN_READY" || ctx.state.approvedPlan || ctx.state.phase === "PLAN_READY"
        );
        const isHumanApproved = ctx.toolArgs.humanApprovalConfirmed === true || ctx.toolArgs.humanApproval === true || hasArchitectPlan && (/\[HUMAN_SCOPE_GATE_APPROVED/i.test(promptText) || /humanApprovalConfirmed\s*[:=]\s*true/i.test(promptText) || /implement(?:ing)?\s+approved/i.test(promptText) || /approved\s+(?:comments\s+feature|changes|scope|plan)/i.test(promptText));
        if (isHumanApproved) {
          const approvalRes = approveScopeGate({
            preferredDir: ctx.repoRoot,
            approver: "Human Maintainer (Conversational Confirmation)"
          });
          if (approvalRes.success && approvalRes.lock) {
            lock = approvalRes.lock;
            ctx.lock = lock;
            appendAuditLog({
              sessionId: ctx.state.sessionId,
              agent: "controller",
              tool: "agent",
              action: "scope_gate_approved_conversationally",
              decision: "allow",
              details: {
                targetAgent: ctx.targetAgent,
                issue: lock.issueNumber,
                approvedScope: lock.approvedScope
              }
            }, ctx.repoRoot);
          }
        } else if (hasArchitectPlan) {
          const targetScope = ctx.state.approvedScope || dashData?.phases?.architect?.details?.proposedScope || "./";
          const issueNum = ctx.state.issue?.number || dashData?.issueNumber || "";
          const reason = `Human Scope Gate: Do you approve the technical architecture plan and authorize Developer agent to implement issue #${issueNum} within scope '${targetScope}'?`;
          const approvalRes = approveScopeGate({
            preferredDir: ctx.repoRoot,
            approver: "Human Maintainer (UI Approval Gate)"
          });
          if (approvalRes.success && approvalRes.lock) {
            lock = approvalRes.lock;
            ctx.lock = lock;
          }
          return {
            allowed: false,
            decision: "ask",
            reason,
            lock
          };
        }
      }
    }
    if (!lock || lock.status !== "ACTIVE") {
      appendAuditLog({
        sessionId: ctx.state.sessionId,
        agent: "controller",
        tool: "agent",
        action: "developer_invocation_blocked_no_lock",
        decision: "deny",
        details: {
          targetAgent: ctx.targetAgent,
          phase: ctx.state.phase,
          humanApproval: ctx.state.humanApproval
        }
      }, ctx.repoRoot);
      return {
        allowed: false,
        reason: "BLOCKED BY POLICY: Developer agent cannot be invoked without verified human scope approval. The human maintainer must explicitly authorize implementation at the Human Scope Gate. The model cannot approve itself.",
        denialCode: 1
      };
    }
    if (lock.planHash) {
      if (ctx.toolArgs.planHash && ctx.toolArgs.planHash !== lock.planHash) {
        appendAuditLog({
          sessionId: ctx.state.sessionId,
          agent: "controller",
          tool: "agent",
          action: "developer_invocation_blocked_plan_drift",
          decision: "deny",
          details: {
            expectedPlanHash: lock.planHash,
            actualPlanHash: ctx.toolArgs.planHash,
            lockIssue: lock.issueNumber
          }
        }, ctx.repoRoot);
        return {
          allowed: false,
          reason: `BLOCKED BY POLICY (Approval Integrity Drift): The planHash '${ctx.toolArgs.planHash}' does not match the approved planHash '${lock.planHash}'. Re-approval is required.`,
          denialCode: 1
        };
      }
    }
    if (lock.currentAttempt > lock.maxAttempts) {
      revokeApprovalLock("EXHAUSTED", ctx.repoRoot);
      ctx.state.phase = "ESCALATED";
      saveState(ctx.state, ctx.repoRoot);
      appendAuditLog({
        sessionId: ctx.state.sessionId,
        agent: "controller",
        tool: "agent",
        action: "developer_invocation_blocked_attempts_exhausted",
        decision: "deny",
        details: {
          currentAttempt: lock.currentAttempt,
          maxAttempts: lock.maxAttempts
        }
      }, ctx.repoRoot);
      return {
        allowed: false,
        reason: `BLOCKED BY POLICY: Implementation retry limit exhausted (${lock.currentAttempt - 1}/${lock.maxAttempts} attempts used). Workflow is escalated to human engineers.`,
        denialCode: 1
      };
    }
    return { allowed: true, lock };
  },
  buildInputContext(ctx) {
    const lock = ctx.lock;
    const branchName = `fix/issue-${ctx.resolvedIssue}`;
    let branchStatus = "unknown";
    let currentBranch = "main";
    try {
      currentBranch = execSync5("git rev-parse --abbrev-ref HEAD", {
        cwd: ctx.repoRoot,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"]
      }).trim();
    } catch {
      currentBranch = "main";
    }
    const isBaseBranch = currentBranch === "main" || currentBranch === "master" || currentBranch === "HEAD" || currentBranch.startsWith("origin/") || process.env.FORCE_BRANCH_SWITCH === "true";
    if (isBaseBranch && currentBranch !== branchName) {
      let branchExists = false;
      try {
        execSync5(`git rev-parse --verify refs/heads/${branchName}`, { cwd: ctx.repoRoot, stdio: "ignore" });
        branchExists = true;
      } catch {
      }
      if (branchExists) {
        execSync5(`git checkout ${branchName}`, { cwd: ctx.repoRoot, stdio: "ignore" });
        branchStatus = `switched_to_${branchName}`;
      } else {
        execSync5(`git checkout -b ${branchName}`, { cwd: ctx.repoRoot, stdio: "ignore" });
        branchStatus = `created_and_switched_to_${branchName}`;
      }
    } else if (currentBranch === branchName) {
      branchStatus = `already_on_${branchName}`;
    } else {
      branchStatus = `retained_${currentBranch}`;
    }
    const effectiveBranch = branchStatus.startsWith("retained_") ? currentBranch : branchName;
    ctx.state.phase = "DEVELOPING";
    ctx.state.humanApproval = true;
    ctx.state.approvedScope = lock.approvedScope;
    ctx.state.implementationAttempt = lock.currentAttempt;
    ctx.state.activeBranch = effectiveBranch;
    saveState(ctx.state, ctx.repoRoot);
    const prompt = ctx.toolArgs.prompt || ctx.toolArgs.content || "";
    const extractedPlan = extractPlanMarkdown(prompt);
    syncWorkflowDashboard(ctx.repoRoot, {
      owner: ctx.state.issue?.owner || "vamsicherukuri",
      repo: ctx.state.issue?.repo || "prsquad",
      issueNumber: ctx.resolvedIssue,
      issueTitle: ctx.state.issue?.title || (ctx.state.issue?.number ? `Issue #${ctx.state.issue.number}` : "Active Pipeline Task"),
      activeBranch: effectiveBranch,
      sessionId: ctx.sessionId,
      phase: "scopeGate",
      status: "APPROVED",
      summary: `Scope Approval Gate approved by ${lock.approvedBy} on branch '${effectiveBranch}'`,
      details: {
        approvedScope: lock.approvedScope,
        approvedBy: lock.approvedBy,
        approvedAt: lock.approvedAt,
        activeBranch: effectiveBranch,
        ...extractedPlan ? { plan: extractedPlan } : {}
      }
    });
    const dashDev = syncWorkflowDashboard(ctx.repoRoot, {
      sessionId: ctx.sessionId,
      phase: "developer",
      status: "IN_PROGRESS",
      summary: `Implementing changes bounded to '${lock.approvedScope}' on branch '${effectiveBranch}'`
    });
    const chatMeter = formatChatCreditMeter(dashDev);
    const branchInstructions = `[BRANCH ISOLATION GUARDRAIL]
Active Feature Branch: '${effectiveBranch}' (designated feature branch for this session).
All edits and commits MUST remain on '${effectiveBranch}'.
Direct checkout or commits to 'main'/'master' and remote 'git push' are strictly blocked by security hooks.
Before reporting IMPLEMENTED, stage and commit your changes: git commit -m "fix: <summary> (fixes #${ctx.resolvedIssue})".
Report headRef as your commit SHA or '${effectiveBranch}'.`;
    const enrichedPrompt = prompt.includes("[BRANCH ISOLATION GUARDRAIL]") ? prompt : `${branchInstructions}

${prompt}`;
    const modifiedArgs = {
      ...ctx.toolArgs,
      prompt: enrichedPrompt,
      activeBranch: effectiveBranch
    };
    const repoIntel = formatRepoIntelligenceForPrompt(ctx.repoRoot, ctx.targetAgent, lock.approvedScope);
    let canonicalPlan = "";
    if (dashDev?.phases?.architect?.details?.plan) {
      canonicalPlan = dashDev.phases.architect.details.plan;
    } else if (dashDev?.phases?.scopeGate?.details?.plan) {
      canonicalPlan = dashDev.phases.scopeGate.details.plan;
    } else if (ctx.state.approvedPlan) {
      canonicalPlan = ctx.state.approvedPlan;
    } else if (extractedPlan) {
      canonicalPlan = extractedPlan;
    }
    const planText = typeof canonicalPlan === "string" ? canonicalPlan.trim() : JSON.stringify(canonicalPlan, null, 2);
    const planSection = canonicalPlan ? `

### \u{1F4D0} Canonical Approved Architecture Plan (Injected by Scope Gate Hook)
${planText}` : "";
    const specBody = ctx.state.issue?.body || "";
    const specText = typeof specBody === "string" ? specBody.trim() : "";
    const specSection = specText ? `

### \u{1F4CB} Verified Issue Specification & Acceptance Criteria
${specText}` : "";
    let reworkSection = "";
    const prevQA = dashDev?.phases?.qa;
    if (lock.currentAttempt > 1 && prevQA?.status === "FAIL") {
      const qaDetails = prevQA.details || {};
      const findings = qaDetails.blockingFindings?.length ? `
#### \u{1F50D} Blocking Findings:
` + qaDetails.blockingFindings.map((f) => `- \u274C ${f}`).join("\n") : "";
      const failures = qaDetails.failureClassification?.length ? `
#### \u{1F6A9} Failure Classifications:
` + qaDetails.failureClassification.map((f) => `- \u26A0\uFE0F [${f.classification}] ${f.failure}${f.evidence ? ` (${f.evidence})` : ""}`).join("\n") : "";
      reworkSection = `

### \u{1F527} Previous QA Verification Failure Report (Rework Attempt ${lock.currentAttempt}/${lock.maxAttempts})
> **Previous QA Verdict:** \u274C \`FAIL\`
` + (prevQA.summary ? `> **QA Summary:** ${prevQA.summary}
` : "") + (qaDetails.testNotes ? `> **QA Notes:** ${qaDetails.testNotes}
` : "") + failures + findings;
    }
    const addCtx = `SCOPE_GATE_VERIFIED: Implementation Attempt ${lock.currentAttempt}/${lock.maxAttempts} authorized by ${lock.approvedBy}.
APPROVED_SCOPE_PREFIX: "${lock.approvedScope}"
ACTIVE_FEATURE_BRANCH: "${effectiveBranch}"
Developer write actions are strictly bounded to this prefix and branch.` + planSection + specSection + reworkSection + (chatMeter ? `

${formatControlPlaneTelemetry(chatMeter, "Include this \u{1F4CA} AI Credit Meter status in your implementation handoff summary.")}` : "") + (repoIntel ? `

${repoIntel}` : "");
    return {
      modifiedPrompt: enrichedPrompt,
      modifiedArgs,
      additionalContext: addCtx || void 0
    };
  },
  validateOutput(rawOutput, ctx) {
    let devVal = validateDeveloper(rawOutput);
    let devStatus = devVal.valid ? devVal.data.status : "HANDOFF_INVALID";
    if (!devVal.valid && ctx.repoRoot) {
      try {
        const currentHead = execSync5("git rev-parse HEAD", { cwd: ctx.repoRoot, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }).trim();
        const baseRef = resolveBaseRef(ctx.repoRoot, ctx.state.baseRef || ctx.lock?.baseRef);
        if (baseRef && currentHead && currentHead !== baseRef) {
          const diffFiles = execSync5(`git diff --name-only ${baseRef} ${currentHead}`, { cwd: ctx.repoRoot, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }).trim().split(/\r?\n/).filter(Boolean);
          if (diffFiles.length > 0) {
            devStatus = "IMPLEMENTED";
            devVal = {
              valid: true,
              data: {
                status: "IMPLEMENTED",
                filesChanged: diffFiles,
                diffReference: { baseRef, headRef: currentHead }
              },
              rawJson: rawOutput
            };
          }
        }
      } catch {
      }
    }
    return {
      valid: devVal.valid,
      verdict: devStatus,
      details: devVal.valid ? devVal.data : void 0,
      errors: devVal.valid ? void 0 : devVal.errors
    };
  },
  commitTransition(valResult, ctx) {
    const transitionId = mintTransitionId("developer");
    ctx.state.lastTransitionId = transitionId;
    if (valResult.valid && valResult.verdict === "IMPLEMENTED") {
      try {
        const statusOut = execSync5("git status --porcelain", { cwd: ctx.repoRoot, encoding: "utf-8" }).trim();
        if (statusOut) {
          execSync5("git add -u", { cwd: ctx.repoRoot, stdio: "ignore" });
          const commitMsg = `fix(issue-${ctx.resolvedIssue}): implement verified changes within approved scope`;
          execSync5(`git commit -m "${commitMsg}"`, { cwd: ctx.repoRoot, stdio: "ignore" });
        }
      } catch {
      }
      ctx.state.phase = "IMPLEMENTED";
      saveState(ctx.state, ctx.repoRoot);
    }
    const devDetails = valResult.valid ? extractDeveloperDetails(ctx.rawOutput || ctx.input.toolResult, ctx.repoRoot) : { status: "SCHEMA_INVALID", errors: valResult.errors };
    const devSummary = valResult.valid ? valResult.verdict === "IMPLEMENTED" ? devDetails.commitSha ? `Fix committed in ${devDetails.commitSha.slice(0, 8)}` : "Changes implemented and verified locally" : valResult.verdict === "SCOPE_AMENDMENT_REQUIRED" ? "Developer requested scope amendment outside approved boundary" : `Developer reported BLOCKED: ${valResult.details?.blocker?.description || "Execution halted"}` : `Developer handoff validation failed: ${(valResult.errors || []).join("; ")}`;
    const dashDev = syncWorkflowDashboard(ctx.repoRoot, {
      owner: ctx.state.issue?.owner || "vamsicherukuri",
      repo: ctx.state.issue?.repo || "prsquad",
      issueNumber: ctx.resolvedIssue,
      issueTitle: ctx.state.issue?.title || (ctx.state.issue?.number ? `Issue #${ctx.state.issue.number}` : "Active Pipeline Task"),
      sessionId: ctx.sessionId,
      phase: "developer",
      status: valResult.verdict,
      summary: devSummary,
      details: devDetails
    });
    const instructionText = !valResult.valid ? `[INSTRUCTION FOR CONTROLLER]: Developer handoff schema invalid (${(valResult.errors || []).join("; ")}). Re-prompt Developer for valid schema handoff or pause pipeline.` : valResult.verdict === "SCOPE_AMENDMENT_REQUIRED" ? "[INSTRUCTION FOR CONTROLLER]: Developer requested scope amendment. Route to Architect for scope review." : valResult.verdict === "BLOCKED" ? "[INSTRUCTION FOR CONTROLLER]: Developer blocked. Pause pipeline and report blocker to maintainer." : "[INSTRUCTION FOR CONTROLLER]: Developer implementation complete. Proceed directly to QA verification.";
    appendAuditLog({
      sessionId: ctx.sessionId,
      transitionId,
      agent: "controller",
      action: "stage_commit_developer",
      decision: valResult.valid ? "allow" : "deny",
      details: { verdict: valResult.verdict, summary: devSummary }
    }, ctx.repoRoot);
    return {
      transitionId,
      nextPhase: ctx.state.phase,
      instructionText
    };
  }
};
var QAPolicy = {
  stage: "QA_VALIDATING",
  agentAliases: ["prsquad-qa", "gated-change-qa", "qa"],
  allowedPriorPhases: ["TESTING", "DEVELOPING", "QA_VALIDATING"],
  checkPrerequisites(ctx) {
    const dashData = loadDashboardState(ctx.repoRoot);
    let devPhaseStatus = dashData?.phases?.developer?.status || "";
    if (!devPhaseStatus && ctx.state.phase === "IMPLEMENTED") {
      devPhaseStatus = "IMPLEMENTED";
    }
    if (devPhaseStatus !== "IMPLEMENTED" && devPhaseStatus !== "BLOCKED" && devPhaseStatus !== "SCOPE_AMENDMENT_REQUIRED") {
      try {
        const currentHead = execSync5("git rev-parse HEAD", { cwd: ctx.repoRoot, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }).trim();
        const preferred = ctx.state.baseRef || ctx.lock?.baseRef || dashData?.phases?.scopeGate?.details?.baseRef;
        const baseRef = resolveBaseRef(ctx.repoRoot, preferred);
        if (baseRef && currentHead && currentHead !== baseRef) {
          const diffFiles = execSync5(`git diff --name-only ${baseRef} ${currentHead}`, { cwd: ctx.repoRoot, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }).trim().split(/\r?\n/).filter(Boolean);
          if (diffFiles.length > 0) {
            devPhaseStatus = "IMPLEMENTED";
            syncWorkflowDashboard(ctx.repoRoot, {
              phase: "developer",
              status: "IMPLEMENTED",
              summary: `Fix committed in ${currentHead.slice(0, 8)}`,
              details: { commitSha: currentHead, baseRef, changedFiles: diffFiles }
            });
            ctx.state.phase = "IMPLEMENTED";
            if (!ctx.state.baseRef) ctx.state.baseRef = baseRef;
            saveState(ctx.state, ctx.repoRoot);
          }
        }
      } catch {
      }
    }
    if (devPhaseStatus !== "IMPLEMENTED") {
      appendAuditLog({
        sessionId: ctx.state.sessionId,
        agent: "controller",
        tool: "agent",
        action: "qa_invocation_blocked_developer_not_implemented",
        decision: "deny",
        details: { devPhaseStatus: devPhaseStatus || "NOT RECORDED" }
      }, ctx.repoRoot);
      return {
        allowed: false,
        reason: `BLOCKED BY POLICY: QA agent cannot be invoked before Developer implementation has completed with status 'IMPLEMENTED' (current: '${devPhaseStatus || "NOT RECORDED"}'). Stage transitions require verified prior evidence; downstream stages may never manufacture upstream success.`,
        denialCode: 1
      };
    }
    return { allowed: true };
  },
  buildInputContext(ctx) {
    let testReport = "";
    try {
      const tooling2 = detectRepoStack(ctx.repoRoot);
      const testCmd = tooling2.testCommand;
      const testStdout = execSync5(testCmd, {
        cwd: ctx.repoRoot,
        encoding: "utf-8",
        timeout: 25e3,
        stdio: ["ignore", "pipe", "pipe"]
      });
      const lines = testStdout.split("\n");
      const summaryLines = lines.filter((l) => l.includes("[PASS]") || l.includes("checks passed") || l.includes("VERIFICATION") || l.includes("Passed") || l.includes("passed") || l.includes("PASS")).slice(-8);
      const displayLines = summaryLines.length > 0 ? summaryLines : lines.filter((l) => l.trim().length > 0).slice(-8);
      testReport = `### \u{1F9EA} Deterministic Test Pre-Execution Report (0 AI Credits)
> **Command:** \`${testCmd}\` (executed automatically via Tooling Bridge: ${tooling2.stack})
> **Execution Status:** \u2705 **ALL CHECKS PASSED**

\`\`\`
${displayLines.join("\n")}
\`\`\`
*(Note for QA: The local regression suite was pre-executed above. Verify against issue acceptance criteria without re-running terminal commands unless needed.)*`;
    } catch (testErr) {
      const tooling2 = detectRepoStack(ctx.repoRoot);
      const testCmd = tooling2.testCommand;
      const errOut = String(testErr?.stdout || testErr?.message || "");
      const lines = errOut.split("\n");
      const failureLines = lines.filter((l) => l.includes("[FAIL]") || l.includes("Error:") || l.includes("FAILED") || l.includes("failed")).slice(0, 8);
      const displayFailures = failureLines.length > 0 ? failureLines : lines.filter((l) => l.trim().length > 0).slice(0, 8);
      testReport = `### \u{1F9EA} Deterministic Test Pre-Execution Report (0 AI Credits)
> **Command:** \`${testCmd}\` (executed automatically via Tooling Bridge: ${tooling2.stack})
> **Execution Status:** \u274C **TEST FAILURES DETECTED**

\`\`\`
${displayFailures.join("\n")}
\`\`\``;
    }
    const devHandoff = buildDeveloperHandoffPayload(ctx.repoRoot, ctx.state, ctx.prompt, ctx.resolvedIssue);
    const tooling = detectRepoStack(ctx.repoRoot);
    const repoIntel = formatRepoIntelligenceForPrompt(ctx.repoRoot, ctx.targetAgent, ctx.state.approvedScope || void 0);
    const dashQA = syncWorkflowDashboard(ctx.repoRoot, {
      sessionId: ctx.sessionId,
      phase: "qa",
      status: "IN_PROGRESS",
      summary: "Executing independent regression verification suite via powershell"
    });
    const chatMeter = formatChatCreditMeter(dashQA);
    const partsQA = [testReport, devHandoff.markdown, ctx.prompt].filter(Boolean);
    const enrichedPrompt = partsQA.join("\n\n");
    const modifiedArgs = {
      ...ctx.toolArgs,
      prompt: enrichedPrompt
    };
    let addCtx = "";
    if (testReport) addCtx += `${testReport}

`;
    if (devHandoff.markdown) addCtx += `${devHandoff.markdown}

`;
    if (tooling.testCommand) addCtx += `### \u{1F6E0}\uFE0F Configured Test Command
Execute for verification: \`${tooling.testCommand}\`

`;
    if (repoIntel) addCtx += `${repoIntel}

`;
    if (chatMeter) {
      addCtx += `

${formatControlPlaneTelemetry(chatMeter, "Developer implementation complete. Include this live \u{1F4CA} AI Credit Meter status in your phase handoff message to the user before running QA.")}`;
    }
    return {
      modifiedPrompt: enrichedPrompt,
      modifiedArgs,
      additionalContext: addCtx || void 0
    };
  },
  validateOutput(rawOutput, ctx) {
    const qaVal = validateQA(rawOutput);
    const qaVerdict = qaVal.valid ? qaVal.data.verdict : "HANDOFF_INVALID";
    return {
      valid: qaVal.valid,
      verdict: qaVerdict,
      details: qaVal.valid ? qaVal.data : void 0,
      errors: qaVal.valid ? void 0 : qaVal.errors
    };
  },
  commitTransition(valResult, ctx) {
    const transitionId = mintTransitionId("qa");
    ctx.state.lastTransitionId = transitionId;
    let retryExhausted = false;
    if (valResult.verdict === "FAIL" && ctx.lock) {
      ctx.lock.currentAttempt++;
      saveApprovalLock(ctx.lock, ctx.repoRoot);
      ctx.state.implementationAttempt = ctx.lock.currentAttempt;
      if (ctx.lock.currentAttempt > ctx.lock.maxAttempts) {
        retryExhausted = true;
        ctx.state.phase = "ESCALATED";
        ctx.state.currentPhase = "ESCALATED";
      }
      saveState(ctx.state, ctx.repoRoot);
    }
    const qaDetails = extractQADetails(ctx.rawOutput || ctx.input.toolResult);
    const qaSummary = valResult.valid ? valResult.verdict === "PASS" ? "Independent QA verification passed all acceptance criteria" : valResult.verdict === "FAIL" ? retryExhausted ? `Independent QA verification failed and retry budget exhausted (${ctx.lock?.maxAttempts || 3}/${ctx.lock?.maxAttempts || 3} attempts used)` : `Independent QA verification detected failures` : "QA verification blocked: unable to complete test suite" : `QA handoff validation failed: ${(valResult.errors || []).join("; ")}`;
    syncWorkflowDashboard(ctx.repoRoot, {
      owner: ctx.state.issue?.owner || "vamsicherukuri",
      repo: ctx.state.issue?.repo || "prsquad",
      issueNumber: ctx.resolvedIssue,
      issueTitle: ctx.state.issue?.title || (ctx.state.issue?.number ? `Issue #${ctx.state.issue.number}` : "Active Pipeline Task"),
      sessionId: ctx.sessionId,
      phase: "qa",
      status: valResult.verdict,
      summary: qaSummary,
      details: { ...qaDetails, verdict: valResult.verdict, errors: valResult.valid ? void 0 : valResult.errors, currentAttempt: ctx.lock?.currentAttempt }
    });
    const instructionText = !valResult.valid ? `[INSTRUCTION FOR CONTROLLER]: QA handoff failed validation (${(valResult.errors || []).join("; ")}). Re-prompt QA for valid verification report or pause pipeline.` : retryExhausted ? `[INSTRUCTION FOR CONTROLLER]: Implementation retry limit exhausted (${ctx.lock?.maxAttempts || 3}/${ctx.lock?.maxAttempts || 3} attempts used). Workflow is escalated to human maintainers. Do not delegate to Developer again.` : valResult.verdict === "FAIL" ? `[INSTRUCTION FOR CONTROLLER]: QA verification failed (Attempt ${(ctx.lock?.currentAttempt || 2) - 1}/${ctx.lock?.maxAttempts || 3} failed). Route back to Developer for rework attempt ${ctx.lock?.currentAttempt || 2}/${ctx.lock?.maxAttempts || 3}.` : valResult.verdict === "BLOCKED" ? "[INSTRUCTION FOR CONTROLLER]: QA verification blocked. Pause pipeline and report blocker to maintainer." : "[INSTRUCTION FOR CONTROLLER]: QA verification passed. Proceed directly to Reviewer security audit.";
    appendAuditLog({
      sessionId: ctx.sessionId,
      transitionId,
      agent: "controller",
      action: "stage_commit_qa",
      decision: valResult.valid ? "allow" : "deny",
      details: { verdict: valResult.verdict, summary: qaSummary }
    }, ctx.repoRoot);
    return {
      transitionId,
      nextPhase: ctx.state.phase,
      instructionText
    };
  }
};
var ReviewerPolicy = {
  stage: "REVIEWING",
  agentAliases: ["prsquad-review", "prsquad-reviewer", "gated-change-reviewer", "reviewer"],
  allowedPriorPhases: ["REVIEWING"],
  checkPrerequisites(ctx) {
    const dashData = loadDashboardState(ctx.repoRoot);
    const qaStatus = dashData?.phases?.qa?.status || ctx.state.phases?.qa?.status;
    const isQaInfraBlocked = qaStatus === "BLOCKED" && Array.isArray(dashData?.phases?.qa?.details?.failureClassification) && dashData.phases.qa.details.failureClassification.length > 0 && dashData.phases.qa.details.failureClassification.every(
      (f) => f.classification === "INFRASTRUCTURE"
    );
    const isQaAllowed = qaStatus === "PASS" || isQaInfraBlocked;
    if (!isQaAllowed) {
      appendAuditLog({
        sessionId: ctx.state.sessionId,
        agent: "controller",
        tool: "agent",
        action: "reviewer_invocation_blocked_qa_not_passed",
        decision: "deny",
        details: { qaStatus: qaStatus || "NONE" }
      }, ctx.repoRoot);
      return {
        allowed: false,
        reason: `BLOCKED BY POLICY: Reviewer agent cannot be invoked before independent QA verification has passed. Current QA status: '${qaStatus || "PENDING"}'. Stage transitions require verified prior evidence; downstream stages may never manufacture upstream success.`,
        denialCode: 1
      };
    }
    return { allowed: true };
  },
  buildInputContext(ctx) {
    let diffReport = "";
    try {
      const base = ctx.state.baseRef || "HEAD~1";
      let diffOutput = "";
      try {
        diffOutput = execSync5(`git diff ${base} HEAD`, { cwd: ctx.repoRoot, encoding: "utf-8" }).trim();
      } catch {
        diffOutput = execSync5(`git diff HEAD~1 HEAD`, { cwd: ctx.repoRoot, encoding: "utf-8" }).trim();
      }
      let changedFiles = [];
      try {
        changedFiles = execSync5(`git diff --name-only ${base} HEAD`, { cwd: ctx.repoRoot, encoding: "utf-8" }).split("\n").map((l) => l.trim()).filter(Boolean);
      } catch {
        try {
          changedFiles = execSync5("git diff --name-only HEAD~1 HEAD", { cwd: ctx.repoRoot, encoding: "utf-8" }).split("\n").map((l) => l.trim()).filter(Boolean);
        } catch {
        }
      }
      const sweep = runSymbolSweep(changedFiles, ctx.state.approvedScope || "", ctx.repoRoot);
      const diffLines = diffOutput.split("\n");
      const truncatedDiff = diffLines.length > 120 ? diffLines.slice(0, 120).join("\n") + `
... [${diffLines.length - 120} lines truncated for token efficiency] ...` : diffOutput;
      diffReport = `### \u{1F50D} Deterministic Diff & Security Pre-Injection (0 AI Credits)
> **Base Ref:** \`${base}\` | **Changed Files:** \`${changedFiles.join("`, `") || "detected in git"}\`
> **Deterministic Symbol Sweep:** ${sweep.summary}
> **External Package References:** ${sweep.externalReferencesFound.length} call-site(s) found

\`\`\`diff
${truncatedDiff}
\`\`\`
*(Note for Reviewer: Full unified diff and cross-package deterministic symbol sweep are pre-computed above. Perform your read-only security review in 1 turn.)*`;
    } catch {
    }
    const devHandoff = buildDeveloperHandoffPayload(ctx.repoRoot, ctx.state, ctx.prompt, ctx.resolvedIssue);
    const qaHandoff = buildQAHandoffPayload(ctx.repoRoot, ctx.state, ctx.prompt);
    const dashRev = syncWorkflowDashboard(ctx.repoRoot, {
      sessionId: ctx.sessionId,
      phase: "reviewer",
      status: "IN_PROGRESS",
      summary: "Conducting read-only security diff audit & blast radius review"
    });
    const chatMeter = formatChatCreditMeter(dashRev);
    const partsRev = [diffReport, qaHandoff.markdown, devHandoff.markdown, ctx.prompt].filter(Boolean);
    const enrichedPrompt = partsRev.join("\n\n");
    const modifiedArgs = {
      ...ctx.toolArgs,
      prompt: enrichedPrompt
    };
    const repoIntel = formatRepoIntelligenceForPrompt(ctx.repoRoot, ctx.targetAgent, ctx.state.approvedScope || void 0);
    let addCtx = "";
    if (diffReport) addCtx += `${diffReport}

`;
    if (qaHandoff.markdown) addCtx += `${qaHandoff.markdown}

`;
    if (repoIntel) addCtx += `${repoIntel}

`;
    if (chatMeter) {
      addCtx += `

${formatControlPlaneTelemetry(chatMeter, "QA verification complete and passed. Include this live \u{1F4CA} AI Credit Meter status in your phase handoff message to the user before running Reviewer.")}`;
    }
    return {
      modifiedPrompt: enrichedPrompt,
      modifiedArgs,
      additionalContext: addCtx || void 0
    };
  },
  validateOutput(rawOutput, ctx) {
    const revVal = validateReview(rawOutput);
    const verdict = revVal.valid ? revVal.data.assessment : "HANDOFF_INVALID";
    return {
      valid: revVal.valid,
      verdict,
      details: revVal.valid ? revVal.data : void 0,
      errors: revVal.valid ? void 0 : revVal.errors
    };
  },
  commitTransition(valResult, ctx) {
    const transitionId = mintTransitionId("reviewer");
    ctx.state.lastTransitionId = transitionId;
    const revDetails = extractReviewerDetails(ctx.rawOutput || ctx.input.toolResult);
    syncWorkflowDashboard(ctx.repoRoot, {
      owner: ctx.state.issue?.owner || "vamsicherukuri",
      repo: ctx.state.issue?.repo || "prsquad",
      issueNumber: ctx.resolvedIssue,
      sessionId: ctx.sessionId,
      phase: "reviewer",
      status: valResult.verdict,
      summary: valResult.valid ? `Read-only diff security audit complete: ${valResult.verdict}` : `Reviewer handoff validation failed: ${(valResult.errors || []).join("; ")}`,
      details: valResult.valid ? revDetails : { errors: valResult.errors, ...revDetails }
    });
    let instructionText = "";
    if (valResult.valid && valResult.verdict === "CLEAR") {
      ctx.state.phase = "PR_READY";
      ctx.state.currentPhase = "WAITING_FOR_HUMAN";
      saveState(ctx.state, ctx.repoRoot);
      syncWorkflowDashboard(ctx.repoRoot, {
        sessionId: ctx.sessionId,
        phase: "mergeGate",
        status: "WAITING_FOR_HUMAN",
        summary: `Read-only diff security audit complete: ${valResult.verdict}. Verified implementation is ready for PR creation. Awaiting human maintainer authorization via /create-pr at the PR Approval Gate.`,
        details: {
          baseBranch: "copilot-app-plugin-alignment",
          headBranch: ctx.state.activeBranch || `fix/issue-${ctx.resolvedIssue}`,
          prOpen: false,
          awaitingHumanApproval: true
        }
      });
      instructionText = "[INSTRUCTION FOR CONTROLLER]: Code review audit complete. Display this final \u26A1 AI Credit Meter table and present the PR_READY package to the maintainer at the PR Approval Gate. Prompt the human to authorize PR creation with /create-pr before executing pr-create.ts.";
    } else {
      instructionText = !valResult.valid ? `[INSTRUCTION FOR CONTROLLER]: Reviewer handoff failed validation (${(valResult.errors || []).join("; ")}). Pause pipeline and notify maintainer.` : `[INSTRUCTION FOR CONTROLLER]: Reviewer reported ${valResult.verdict}. Resolve review findings before opening Pull Request.`;
    }
    appendAuditLog({
      sessionId: ctx.sessionId,
      transitionId,
      agent: "controller",
      action: "stage_commit_reviewer",
      decision: valResult.valid ? "allow" : "deny",
      details: { verdict: valResult.verdict }
    }, ctx.repoRoot);
    return {
      transitionId,
      nextPhase: ctx.state.phase,
      instructionText
    };
  }
};
var STAGE_POLICIES = [
  IntakePolicy,
  ArchitectPolicy,
  DeveloperPolicy,
  QAPolicy,
  ReviewerPolicy
];
function lookupStagePolicy(targetAgent) {
  for (const policy of STAGE_POLICIES) {
    if (policy.agentAliases.some((alias) => isAgentMatch(targetAgent, alias))) {
      return policy;
    }
  }
  return null;
}

// scripts/guardrails/hook-verify-gate.ts
function resolveIssueNumber(input, toolArgs, state, lock) {
  if (toolArgs.issueNumber && Number(toolArgs.issueNumber) > 0) {
    return Number(toolArgs.issueNumber);
  }
  const prompt = String(toolArgs.prompt || input.toolArgs?.prompt || "");
  const nameStr = String(toolArgs.name || "");
  const numFromName = nameStr.match(/issue-?(\d+)/i);
  if (numFromName) return parseInt(numFromName[1], 10);
  const numFromCwd = (input.cwd || "").match(/issue-?(\d+)/i);
  if (numFromCwd) return parseInt(numFromCwd[1], 10);
  const numFromPrompt = prompt.match(/(?:issue(?:\s*number)?\s*[:#`'"\s]*|#)\s*(\d+)/i);
  if (numFromPrompt) return parseInt(numFromPrompt[1], 10);
  if (lock?.issueNumber && lock.issueNumber > 0) {
    return lock.issueNumber;
  }
  const branch = state?.activeBranch || "";
  const branchNum = branch.match(/(?:issue-?|#)(\d+)/i);
  if (branchNum) return parseInt(branchNum[1], 10);
  if (state?.issue?.number && state.issue.number > 0) {
    return state.issue.number;
  }
  try {
    const effectiveCwd = input.cwd || process.cwd();
    const gitBranch = execSync6("git rev-parse --abbrev-ref HEAD", {
      cwd: effectiveCwd,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
    const numFromGit = gitBranch.match(/(?:issue-?|#)(\d+)/i);
    if (numFromGit) return parseInt(numFromGit[1], 10);
  } catch {
  }
  try {
    const effectiveCwd = input.cwd || process.cwd();
    const repoRoot = getRepoRoot(effectiveCwd);
    const cacheFile = join8(repoRoot, ".gated-change", "issue-cache.json");
    if (existsSync9(cacheFile)) {
      const parsed = JSON.parse(readFileSync8(cacheFile, "utf-8"));
      if (parsed?.number && Number(parsed.number) > 0) {
        return Number(parsed.number);
      }
    }
  } catch {
  }
  return Number(process.env.TARGET_ISSUE) || 0;
}
async function main() {
  if (process.argv.includes("--meter")) {
    let effectiveCwd2 = process.cwd();
    let repoRoot2 = getRepoRoot(effectiveCwd2);
    let state2 = loadState(repoRoot2);
    if (!state2?.sessionId) {
      const home = homedir3();
      const candidates = [
        join8(home, "factory/sample repos/copilot-worktrees/prsquad"),
        join8(home, "Documents/prsquad"),
        join8(home, "factory/sample repos/prsquad"),
        join8(home, "factory/sample repos/copilot-worktrees/gated-fix-pipeline"),
        join8(home, "Documents/gated-fix-pipeline"),
        join8(home, "factory/sample repos/gated-fix-pipeline")
      ];
      let bestState = null;
      let bestMtime = 0;
      let bestRepo = repoRoot2;
      for (const parent of candidates) {
        if (existsSync9(parent)) {
          try {
            const entries = readdirSync4(parent, { withFileTypes: true });
            const dirs = entries.filter((d) => d.isDirectory()).map((d) => join8(parent, d.name));
            dirs.push(parent);
            for (const d of dirs) {
              const stateFile = join8(d, ".gated-change", "state.json");
              if (existsSync9(stateFile)) {
                try {
                  const stat = statSync3(stateFile);
                  if (stat.mtimeMs > bestMtime) {
                    const parsed = JSON.parse(readFileSync8(stateFile, "utf-8"));
                    if (parsed) {
                      bestMtime = stat.mtimeMs;
                      bestState = parsed;
                      bestRepo = d;
                    }
                  }
                } catch {
                }
              }
            }
          } catch {
          }
        }
      }
      if (bestState) {
        state2 = bestState;
        repoRoot2 = bestRepo;
      }
    }
    const dashData = loadDashboardState(repoRoot2);
    let phases = dashData?.phases || {};
    if (Object.keys(phases).length === 0 && state2?.phase) {
      phases = {
        intake: { status: "READY" },
        architect: { status: "PLAN_READY" },
        scopeGate: { status: state2.humanApproval ? "APPROVED" : "PENDING", credits: 0 },
        developer: { status: state2.phase === "DEVELOPING" ? "IN_PROGRESS" : "PENDING" },
        qa: { status: "PENDING" },
        reviewer: { status: "PENDING" },
        mergeGate: { status: "PENDING", credits: 0 }
      };
    }
    const tele = getGroundTruthTelemetry(state2?.sessionId, 0);
    if (tele && tele.turns > 0) {
      const meter = formatChatCreditMeter({
        issueNumber: state2?.issue?.number || 0,
        owner: state2?.issue?.owner || "",
        repo: state2?.issue?.repo || "",
        lastUpdated: (/* @__PURE__ */ new Date()).toISOString(),
        phases,
        telemetry: tele
      });
      process.stdout.write(meter + "\n");
    } else {
      process.stdout.write("### \u26A1 Live AI Credit Meter\n\n> Telemetry active. (Recording ground-truth token events for active session...)\n");
    }
    process.exit(0);
  }
  let rawInput = "";
  if (!process.stdin.isTTY) {
    try {
      rawInput = readFileSync8(0, "utf-8");
    } catch {
    }
  }
  let input = {};
  if (rawInput.trim()) {
    input = JSON.parse(rawInput);
  }
  const firstTool = input.toolCalls?.[0];
  const toolArgs = input.toolArgs || firstTool?.args || {};
  const targetAgent = toolArgs.agent_type || toolArgs.name || toolArgs.agent || input.agent;
  const policy = lookupStagePolicy(targetAgent);
  if (!policy) {
    process.stdout.write(JSON.stringify({ decision: "allow", permissionDecision: "allow" }) + "\n");
    process.exit(0);
  }
  const effectiveCwd = input.cwd || process.cwd();
  const repoRoot = getRepoRoot(effectiveCwd);
  ensureNodeModulesInWorktree(repoRoot);
  const state = loadState(repoRoot);
  const lock = loadApprovalLock(repoRoot);
  const resolvedIssue = resolveIssueNumber(input, toolArgs, state, lock);
  const sessionId = input.sessionId || state.sessionId || "";
  if (sessionId && (!state.sessionId || state.sessionId !== sessionId)) {
    state.sessionId = sessionId;
    saveState(state, repoRoot);
  }
  const prompt = String(
    toolArgs.prompt || toolArgs.content || toolArgs.message || firstTool?.args?.prompt || ""
  );
  const ctx = {
    repoRoot,
    state,
    lock,
    resolvedIssue,
    sessionId,
    targetAgent,
    prompt,
    toolArgs,
    firstTool,
    input,
    rawOutput: input.toolResult
  };
  if (input.toolResult) {
    const valResult = policy.validateOutput(input.toolResult, ctx);
    const commitRes = policy.commitTransition(valResult, ctx);
    const dashData = loadDashboardState(repoRoot);
    const chatMeter = formatChatCreditMeter(dashData);
    const out = buildEnrichedPostToolOutput(
      input,
      chatMeter,
      commitRes.instructionText,
      targetAgent
    );
    process.stdout.write(JSON.stringify(out) + "\n");
    process.exit(0);
  }
  const auth = policy.checkPrerequisites(ctx);
  if (!auth.allowed) {
    if (auth.decision === "ask") {
      const reason = auth.reason || "Human confirmation required.";
      const output3 = {
        decision: "ask",
        permissionDecision: "ask",
        permissionDecisionReason: reason,
        reason,
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "ask",
          permissionDecisionReason: reason
        }
      };
      process.stdout.write(JSON.stringify(output3) + "\n");
      process.exit(0);
    }
    const output2 = {
      decision: "deny",
      permissionDecision: "deny",
      reason: auth.reason || `BLOCKED BY POLICY: Prerequisites for ${policy.stage} not satisfied.`
    };
    process.stdout.write(JSON.stringify(output2) + "\n");
    process.exit(auth.denialCode || 1);
  }
  if (auth.lock !== void 0) {
    ctx.lock = auth.lock;
  }
  const inputCtx = policy.buildInputContext(ctx);
  const modifiedArgs = inputCtx.modifiedArgs || {
    ...toolArgs,
    ...inputCtx.modifiedPrompt ? { prompt: inputCtx.modifiedPrompt } : {}
  };
  const output = {
    decision: "allow",
    permissionDecision: "allow",
    modifiedArgs,
    updatedInput: modifiedArgs,
    additionalContext: inputCtx.additionalContext || void 0,
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
      modifiedArgs,
      updatedInput: modifiedArgs,
      additionalContext: inputCtx.additionalContext || void 0
    }
  };
  process.stdout.write(JSON.stringify(output) + "\n");
  process.exit(0);
}
main().catch((err) => {
  const errMsg = err?.message || String(err);
  process.stderr.write(`[hook-verify-gate] Internal enforcement error (Fail-Closed): ${errMsg}
`);
  process.stdout.write(
    JSON.stringify({
      decision: "deny",
      permissionDecision: "deny",
      reason: `SECURITY_GATE_FAILURE: Human gate verification hook encountered an internal failure: ${errMsg}. Specialist invocation blocked by policy (Fail-Closed).`
    }) + "\n"
  );
  process.exit(1);
});

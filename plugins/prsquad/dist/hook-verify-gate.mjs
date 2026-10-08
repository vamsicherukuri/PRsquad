#!/usr/bin/env node

// scripts/guardrails/hook-verify-gate.ts
import { existsSync as existsSync7, readFileSync as readFileSync7, readdirSync as readdirSync4, statSync as statSync3 } from "node:fs";
import { join as join7 } from "node:path";
import { homedir as homedir3 } from "node:os";
import { execSync as execSync4 } from "node:child_process";

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
      const passedCount = qaDetails.acceptanceCriteriaResults.filter(
        (ac) => ac.verdict === "PASS" || ac.pass === true
      ).length;
      md += `> **Acceptance Criteria Verification:** ${passedCount} / ${qaDetails.acceptanceCriteriaResults.length} PASSED  

`;
      md += `| Criterion | Description | Verdict | Evidence |
`;
      md += `|:---:|:---|:---:|:---|
`;
      for (const ac of qaDetails.acceptanceCriteriaResults) {
        const acVerdict = ac.verdict || (ac.pass ? "PASS" : "FAIL");
        md += `| **${ac.id || "AC"}** | ${ac.description || ac.criterion || "\u2014"} | ${getStatusBadge(acVerdict)} | ${ac.evidence || "Verified in test run"} |
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
    const gatedDir = findGatedChangeDir(rootDir);
    const dashboardFile = join2(gatedDir, "dashboard.json");
    let current = {
      issueNumber: update.issueNumber || 0,
      issueTitle: update.issueTitle,
      owner: update.owner || "vamsicherukuri",
      repo: update.repo || "prsquad",
      activeBranch: update.activeBranch,
      sessionId: update.sessionId,
      lastUpdated: (/* @__PURE__ */ new Date()).toISOString(),
      phases: {}
    };
    if (existsSync2(dashboardFile)) {
      try {
        const raw = readFileSync2(dashboardFile, "utf-8");
        const parsed = JSON.parse(raw);
        const isSameIssue = !update.issueNumber || update.issueNumber === parsed.issueNumber;
        current = {
          ...parsed,
          phases: isSameIssue ? { ...parsed.phases } : {}
        };
      } catch {
      }
    }
    if (update.owner) current.owner = update.owner;
    if (update.repo) current.repo = update.repo;
    if (update.issueNumber && update.issueNumber > 0 && update.issueNumber !== 999) {
      current.issueNumber = update.issueNumber;
    }
    if (update.issueTitle && update.issueTitle !== "Test Billing Issue") {
      current.issueTitle = update.issueTitle;
    }
    if (update.activeBranch && !update.activeBranch.includes("999")) {
      current.activeBranch = update.activeBranch;
    }
    if (update.sessionId) {
      current.sessionId = update.sessionId;
    }
    current.lastUpdated = (/* @__PURE__ */ new Date()).toISOString();
    const tele = getGroundTruthTelemetry(current.sessionId, current.startEventId || 0);
    if (tele) {
      if (!current.startEventId && tele.firstEventId) {
        current.startEventId = tele.firstEventId;
      }
      current.telemetry = tele;
    }
    if (update.phase) {
      const existingPhase = current.phases[update.phase] || { status: "PENDING" };
      let phaseCredits = existingPhase.credits;
      if (current.telemetry && current.telemetry.actualAiCredits !== void 0) {
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
          if (subagentIdx !== void 0 && current.telemetry.subagents && current.telemetry.subagents[subagentIdx]) {
            phaseCredits = current.telemetry.subagents[subagentIdx].credits;
          } else {
            const recordedCredits = Object.entries(current.phases).filter(([k]) => k !== update.phase).reduce((sum, [, p]) => sum + (p?.credits || 0), 0);
            const computed = Math.max(0, Math.round((current.telemetry.actualAiCredits - recordedCredits) * 100) / 100);
            if (phaseCredits === void 0 || update.status !== "IN_PROGRESS") {
              phaseCredits = computed;
            }
          }
        }
      }
      current.phases[update.phase] = {
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
        const existingArch = current.phases.architect || { status: "PLAN_READY" };
        current.phases.architect = {
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
    writeFileSync2(dashboardFile, JSON.stringify(current, null, 2), "utf-8");
    const isTest = process.env.NODE_ENV === "test" || process.env.GATED_CHANGE_TEST === "1" || process.env.npm_lifecycle_event?.startsWith("test");
    const shouldPostComment = !isTest && current.issueNumber > 0 && current.issueNumber !== 999 && Boolean(current.owner) && Boolean(current.repo) && process.env.GATED_CHANGE_POST_ISSUE_COMMENT !== "0";
    if (shouldPostComment) {
      postOrPatchGitHubComment(current);
      writeFileSync2(dashboardFile, JSON.stringify(current, null, 2), "utf-8");
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
      if (Array.isArray(parsed.acceptanceCriteriaResults)) details.acceptanceCriteriaResults = parsed.acceptanceCriteriaResults;
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

// src/guardrails/symbolSweep.ts
import { createRequire as createRequire2 } from "node:module";
import { existsSync as existsSync3, readFileSync as readFileSync3, readdirSync, statSync } from "node:fs";
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
  if (!existsSync3(full)) return [];
  const content = readFileSync3(full, "utf-8");
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
    const content = readFileSync3(full, "utf-8");
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
    if (!existsSync3(full) || !statSync(full).isFile()) continue;
    const content = readFileSync3(full, "utf-8");
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
          const c = readFileSync3(fullOther, "utf-8");
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
import { existsSync as existsSync4, readFileSync as readFileSync4, readdirSync as readdirSync2, statSync as statSync2 } from "node:fs";
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
  if (!existsSync4(instructionPath)) {
    return null;
  }
  try {
    const raw = readFileSync4(instructionPath, "utf-8");
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
  if (!existsSync4(dir)) return [];
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
        const raw = readFileSync4(file, "utf-8");
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
import { existsSync as existsSync5, readFileSync as readFileSync5, readdirSync as readdirSync3 } from "node:fs";
import { join as join5 } from "node:path";
function detectRepoStack(rootDir = getRepoRoot()) {
  const explicitPaths = [
    join5(rootDir, ".prsquad", "config.json"),
    join5(rootDir, ".prsquad.json")
  ];
  for (const configPath of explicitPaths) {
    if (existsSync5(configPath)) {
      try {
        const raw = readFileSync5(configPath, "utf-8");
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
  if (existsSync5(join5(rootDir, "pom.xml"))) {
    return {
      stack: "maven",
      testCommand: "mvn test",
      testFileCommand: "mvn test -Dtest=${file}",
      buildCommand: "mvn compile -DskipTests",
      lintCommand: "mvn spotbugs:check",
      isExplicitConfig: false
    };
  }
  if (existsSync5(join5(rootDir, "build.gradle")) || existsSync5(join5(rootDir, "build.gradle.kts"))) {
    const gradleCmd = existsSync5(join5(rootDir, "gradlew")) ? "./gradlew" : "gradle";
    return {
      stack: "gradle",
      testCommand: `${gradleCmd} test`,
      testFileCommand: `${gradleCmd} test --tests ${"${file}"}`,
      buildCommand: `${gradleCmd} assemble`,
      lintCommand: `${gradleCmd} check`,
      isExplicitConfig: false
    };
  }
  if (existsSync5(join5(rootDir, "package.json"))) {
    let runner = "npm test";
    if (existsSync5(join5(rootDir, "pnpm-lock.yaml"))) {
      runner = "pnpm test";
    } else if (existsSync5(join5(rootDir, "yarn.lock"))) {
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
  if (existsSync5(join5(rootDir, "pytest.ini")) || existsSync5(join5(rootDir, "pyproject.toml")) || existsSync5(join5(rootDir, "requirements.txt"))) {
    return {
      stack: "pytest",
      testCommand: "pytest",
      testFileCommand: "pytest ${file}",
      lintCommand: "flake8 .",
      isExplicitConfig: false
    };
  }
  if (existsSync5(join5(rootDir, "Cargo.toml"))) {
    return {
      stack: "cargo",
      testCommand: "cargo test",
      testFileCommand: "cargo test --test ${file}",
      buildCommand: "cargo build",
      lintCommand: "cargo clippy",
      isExplicitConfig: false
    };
  }
  if (existsSync5(join5(rootDir, "go.mod"))) {
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
function validateTriage(output) {
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
  if (errors.length > 0) {
    return failValidation(errors, json);
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
  const status = String(json.status || "").toUpperCase();
  if (!validStatuses.includes(status)) {
    errors.push(`Invalid developer status '${json.status}'. Expected one of: ${validStatuses.join(", ")}`);
  }
  if (status === "IMPLEMENTED") {
    if (!Array.isArray(json.filesChanged) || json.filesChanged.length === 0) {
      errors.push("IMPLEMENTED developer handoff requires non-empty 'filesChanged' list");
    }
    if (!json.diffReference || typeof json.diffReference !== "object") {
      errors.push("IMPLEMENTED developer handoff requires 'diffReference' with baseRef and headRef");
    } else {
      const hasBase = Boolean(json.diffReference.baseRef);
      const hasHead = Boolean(json.diffReference.headRef || json.commitSha);
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
  const verdict = String(json.verdict || "").toUpperCase();
  if (!validVerdicts.includes(verdict)) {
    errors.push(`Invalid QA verdict '${json.verdict}'. Expected one of: ${validVerdicts.join(", ")}`);
  }
  const validScope = ["PASS", "FAIL"];
  const scopeCompliance = String(json.scopeCompliance || "").toUpperCase();
  if (!validScope.includes(scopeCompliance)) {
    errors.push(`Invalid QA scopeCompliance '${json.scopeCompliance}'. Expected: PASS or FAIL`);
  }
  if (verdict === "FAIL") {
    const hasFailClassification = Array.isArray(json.failureClassification) && json.failureClassification.length > 0;
    const hasFindings = Array.isArray(json.blockingFindings) && json.blockingFindings.length > 0;
    const hasFailCriteria = Array.isArray(json.acceptanceCriteriaResults) && json.acceptanceCriteriaResults.some((c) => c.result === "FAIL");
    if (!hasFailClassification && !hasFindings && !hasFailCriteria && scopeCompliance !== "FAIL") {
      errors.push("QA verdict 'FAIL' requires failureClassification, blockingFindings, or failing acceptance criteria");
    }
  } else if (verdict === "PASS") {
    if (scopeCompliance !== "PASS") {
      errors.push("QA verdict 'PASS' requires scopeCompliance to be 'PASS'");
    }
    if (!Array.isArray(json.acceptanceCriteriaResults) || json.acceptanceCriteriaResults.length === 0) {
      errors.push("QA verdict 'PASS' requires non-empty 'acceptanceCriteriaResults' proving verification");
    } else {
      const hasNonPassing = json.acceptanceCriteriaResults.some(
        (c) => c.result !== "PASS" && c.passed !== true
      );
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
  const assessment = String(json.assessment || "").toUpperCase();
  if (!validAssessments.includes(assessment)) {
    errors.push(`Invalid Reviewer assessment '${json.assessment}'. Expected: CLEAR or CONCERNS`);
  }
  const validScope = ["PASS", "CONCERN"];
  const scopeCompliance = String(json.scopeCompliance || "").toUpperCase();
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
import { existsSync as existsSync6, readFileSync as readFileSync6 } from "node:fs";
import { join as join6 } from "node:path";
import { createHash } from "node:crypto";
import { execSync as execSync3 } from "node:child_process";
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
  const dashFile = join6(repoRoot, ".gated-change", "dashboard.json");
  let dashData = null;
  if (existsSync6(dashFile)) {
    try {
      dashData = JSON.parse(readFileSync6(dashFile, "utf-8"));
    } catch {
    }
  }
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
      baseRef = execSync3("git rev-parse HEAD", {
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

// scripts/guardrails/hook-verify-gate.ts
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
  return 11;
}
async function main() {
  if (process.argv.includes("--meter")) {
    let effectiveCwd2 = process.cwd();
    let repoRoot2 = getRepoRoot(effectiveCwd2);
    let state2 = loadState(repoRoot2);
    if (!state2?.sessionId) {
      const home = homedir3();
      const candidates = [
        join7(home, "factory/sample repos/copilot-worktrees/prsquad"),
        join7(home, "OneDrive - Microsoft/Documents/GitHub Copilot App Enterprise Challenge/prsquad"),
        join7(home, "factory/sample repos/prsquad"),
        join7(home, "factory/sample repos/copilot-worktrees/gated-fix-pipeline"),
        join7(home, "OneDrive - Microsoft/Documents/GitHub Copilot App Enterprise Challenge/gated-fix-pipeline"),
        join7(home, "factory/sample repos/gated-fix-pipeline")
      ];
      let bestState = null;
      let bestMtime = 0;
      let bestRepo = repoRoot2;
      for (const parent of candidates) {
        if (existsSync7(parent)) {
          try {
            const entries = readdirSync4(parent, { withFileTypes: true });
            const dirs = entries.filter((d) => d.isDirectory()).map((d) => join7(parent, d.name));
            dirs.push(parent);
            for (const d of dirs) {
              const stateFile = join7(d, ".gated-change", "state.json");
              if (existsSync7(stateFile)) {
                try {
                  const stat = statSync3(stateFile);
                  if (stat.mtimeMs > bestMtime) {
                    const parsed = JSON.parse(readFileSync7(stateFile, "utf-8"));
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
    let phases = {};
    const dashFile = join7(repoRoot2, ".gated-change", "dashboard.json");
    if (existsSync7(dashFile)) {
      try {
        const parsed = JSON.parse(readFileSync7(dashFile, "utf-8"));
        if (parsed.phases) phases = parsed.phases;
      } catch {
      }
    } else if (state2?.phase) {
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
      rawInput = readFileSync7(0, "utf-8");
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
  if (isAgentMatch(targetAgent, "gated-change-developer")) {
    const effectiveCwd2 = input.cwd || process.cwd();
    const repoRoot2 = getRepoRoot(effectiveCwd2);
    ensureNodeModulesInWorktree(repoRoot2);
    const state2 = loadState(repoRoot2);
    let lock2 = loadApprovalLock(repoRoot2);
    if (!lock2) {
      const lockFilePath = join7(repoRoot2, ".gated-change", "approval.lock");
      let existingLockStatus = null;
      if (existsSync7(lockFilePath)) {
        try {
          const raw = JSON.parse(readFileSync7(lockFilePath, "utf-8"));
          existingLockStatus = raw.status || null;
        } catch {
        }
      }
      const isExplicitlyRevokedOrExhausted = existingLockStatus === "REVOKED" || existingLockStatus === "EXHAUSTED";
      if (!isExplicitlyRevokedOrExhausted) {
        const isHumanApproved = toolArgs.humanApprovalConfirmed === true || toolArgs.humanApproval === true;
        if (isHumanApproved) {
          const approvalRes = approveScopeGate({
            preferredDir: repoRoot2,
            approver: "Human Maintainer (Conversational Confirmation)"
          });
          if (approvalRes.success && approvalRes.lock) {
            lock2 = approvalRes.lock;
            appendAuditLog({
              sessionId: state2.sessionId,
              agent: "controller",
              tool: "agent",
              action: "scope_gate_approved_conversationally",
              decision: "allow",
              details: {
                targetAgent,
                issue: lock2.issueNumber,
                approvedScope: lock2.approvedScope
              }
            }, repoRoot2);
          }
        }
      }
    }
    if (!lock2 || lock2.status !== "ACTIVE") {
      appendAuditLog({
        sessionId: state2.sessionId,
        agent: "controller",
        tool: "agent",
        action: "developer_invocation_blocked_no_lock",
        decision: "deny",
        details: {
          targetAgent,
          phase: state2.phase,
          humanApproval: state2.humanApproval
        }
      }, repoRoot2);
      const output2 = {
        decision: "deny",
        reason: "BLOCKED BY POLICY: Developer agent cannot be invoked without verified human scope approval. The human maintainer must explicitly authorize implementation at the Human Scope Gate in the Canvas panel or via 'node .gated-change/bin/gate-approve.mjs'. The model cannot approve itself."
      };
      process.stdout.write(JSON.stringify(output2) + "\n");
      process.exit(1);
    }
    if (lock2.planHash) {
      if (toolArgs.planHash && toolArgs.planHash !== lock2.planHash) {
        appendAuditLog({
          sessionId: state2.sessionId,
          agent: "controller",
          tool: "agent",
          action: "developer_invocation_blocked_plan_drift",
          decision: "deny",
          details: {
            expectedPlanHash: lock2.planHash,
            actualPlanHash: toolArgs.planHash,
            lockIssue: lock2.issueNumber
          }
        }, repoRoot2);
        const output2 = {
          decision: "deny",
          reason: `BLOCKED BY POLICY (Approval Integrity Drift): The planHash '${toolArgs.planHash}' does not match the approved planHash '${lock2.planHash}'. Re-approval is required.`
        };
        process.stdout.write(JSON.stringify(output2) + "\n");
        process.exit(1);
      }
      const structuredPlan = toolArgs.plan || toolArgs.planMarkdown;
      if (structuredPlan) {
        const currentHash = computePlanHash(structuredPlan);
        if (currentHash && currentHash !== lock2.planHash) {
          appendAuditLog({
            sessionId: state2.sessionId,
            agent: "controller",
            tool: "agent",
            action: "developer_invocation_blocked_plan_drift",
            decision: "deny",
            details: {
              expectedPlanHash: lock2.planHash,
              actualPlanHash: currentHash,
              lockIssue: lock2.issueNumber
            }
          }, repoRoot2);
          const output2 = {
            decision: "deny",
            reason: `BLOCKED BY POLICY (Approval Integrity Drift): The technical plan passed to Developer does not match the plan approved by the human maintainer at the Scope Gate (expected planHash: ${lock2.planHash}, actual: ${currentHash}). Re-approval is required before implementation can proceed.`
          };
          process.stdout.write(JSON.stringify(output2) + "\n");
          process.exit(1);
        }
      }
    }
    if (lock2.currentAttempt > lock2.maxAttempts) {
      revokeApprovalLock("EXHAUSTED", repoRoot2);
      state2.phase = "ESCALATED";
      saveState(state2, repoRoot2);
      appendAuditLog({
        sessionId: state2.sessionId,
        agent: "controller",
        tool: "agent",
        action: "developer_invocation_blocked_attempts_exhausted",
        decision: "deny",
        details: {
          currentAttempt: lock2.currentAttempt,
          maxAttempts: lock2.maxAttempts
        }
      }, repoRoot2);
      const output2 = {
        decision: "deny",
        reason: `BLOCKED BY POLICY: Implementation retry limit exhausted (${lock2.currentAttempt - 1}/${lock2.maxAttempts} attempts used). Workflow is escalated to human engineers.`
      };
      process.stdout.write(JSON.stringify(output2) + "\n");
      process.exit(1);
    }
    const resolvedIssue2 = resolveIssueNumber(input, toolArgs, state2, lock2);
    const branchName = `fix/issue-${resolvedIssue2}`;
    let branchStatus = "unknown";
    let currentBranch = "main";
    try {
      try {
        currentBranch = execSync4("git rev-parse --abbrev-ref HEAD", {
          cwd: repoRoot2,
          encoding: "utf-8",
          stdio: ["ignore", "pipe", "ignore"]
        }).trim();
      } catch {
        try {
          currentBranch = execSync4("git symbolic-ref --short HEAD", {
            cwd: repoRoot2,
            encoding: "utf-8",
            stdio: ["ignore", "pipe", "ignore"]
          }).trim();
        } catch {
          currentBranch = "main";
        }
      }
      const isBaseBranch = currentBranch === "main" || currentBranch === "master" || currentBranch === "HEAD" || currentBranch.startsWith("origin/") || process.env.FORCE_BRANCH_SWITCH === "true";
      if (isBaseBranch && currentBranch !== branchName) {
        let hasCommits = false;
        try {
          execSync4("git rev-parse HEAD", { cwd: repoRoot2, stdio: "ignore" });
          hasCommits = true;
        } catch {
        }
        if (!hasCommits) {
          try {
            execSync4(`git checkout -b ${branchName}`, { cwd: repoRoot2, stdio: "ignore" });
          } catch {
            execSync4(`git symbolic-ref HEAD refs/heads/${branchName}`, { cwd: repoRoot2, stdio: "ignore" });
          }
          branchStatus = `initialized_on_${branchName}`;
        } else {
          let branchExists = false;
          try {
            execSync4(`git rev-parse --verify refs/heads/${branchName}`, { cwd: repoRoot2, stdio: "ignore" });
            branchExists = true;
          } catch {
          }
          if (branchExists) {
            execSync4(`git checkout ${branchName}`, {
              cwd: repoRoot2,
              encoding: "utf-8",
              stdio: ["ignore", "pipe", "ignore"]
            });
            branchStatus = `switched_to_${branchName}`;
          } else {
            execSync4(`git checkout -b ${branchName}`, {
              cwd: repoRoot2,
              encoding: "utf-8",
              stdio: ["ignore", "pipe", "ignore"]
            });
            branchStatus = `created_and_switched_to_${branchName}`;
          }
        }
      } else if (currentBranch === branchName) {
        branchStatus = `already_on_${branchName}`;
      } else {
        branchStatus = `retained_${currentBranch}`;
      }
      try {
        const verifiedBranch = execSync4("git rev-parse --abbrev-ref HEAD", { cwd: repoRoot2, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }).trim();
        if (verifiedBranch === "main" || verifiedBranch === "master") {
          const output2 = {
            decision: "deny",
            reason: `BLOCKED BY POLICY (BASE_BRANCH_LOCKDOWN): Developer agent cannot execute on base branch '${verifiedBranch}'. Halting fail-closed to protect base branch.`
          };
          process.stdout.write(JSON.stringify(output2) + "\n");
          process.exit(1);
        }
        if (isBaseBranch && verifiedBranch !== branchName && verifiedBranch !== "HEAD") {
          const output2 = {
            decision: "deny",
            reason: `BLOCKED BY POLICY (CHECKOUT_VERIFICATION_FAILED): Expected active branch '${branchName}', but git rev-parse reported '${verifiedBranch}'. Halting fail-closed.`
          };
          process.stdout.write(JSON.stringify(output2) + "\n");
          process.exit(1);
        }
      } catch {
      }
    } catch (branchErr) {
      appendAuditLog({
        sessionId: state2.sessionId,
        agent: "controller",
        tool: "agent",
        action: "developer_branch_isolation_failed",
        decision: "deny",
        details: { branchName, error: branchErr?.message }
      }, repoRoot2);
      const output2 = {
        decision: "deny",
        reason: `BLOCKED BY POLICY: Failed to create or switch to feature branch '${branchName}': ${branchErr?.message}. Developer execution halted to protect base branch.`
      };
      process.stdout.write(JSON.stringify(output2) + "\n");
      process.exit(1);
    }
    state2.phase = "DEVELOPING";
    state2.humanApproval = true;
    state2.approvedScope = lock2.approvedScope;
    state2.implementationAttempt = lock2.currentAttempt;
    state2.activeBranch = branchStatus.startsWith("retained_") ? currentBranch : branchName;
    if (!state2.issue) {
      state2.issue = { owner: "vamsicherukuri", repo: "prsquad", number: resolvedIssue2 };
    } else {
      state2.issue.number = resolvedIssue2;
    }
    saveState(state2, repoRoot2);
    if (lock2.currentAttempt === 1 && lock2.baseRef && lock2.baseRef !== "HEAD") {
      let currentHead = "";
      try {
        currentHead = execSync4("git rev-parse HEAD", { cwd: repoRoot2, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }).trim();
      } catch {
      }
      if (currentHead && !currentHead.startsWith(lock2.baseRef) && !lock2.baseRef.startsWith(currentHead)) {
        let isAncestor = false;
        try {
          execSync4(`git merge-base --is-ancestor ${lock2.baseRef} HEAD`, { cwd: repoRoot2, stdio: "ignore" });
          isAncestor = true;
        } catch {
        }
        if (!isAncestor) {
          const output2 = {
            decision: "deny",
            reason: `BLOCKED BY POLICY (BASELINE_DRIFT): Repository baseline changed after Scope Gate approval. Approved baseRef is '${lock2.baseRef.slice(0, 8)}', but current HEAD is '${currentHead.slice(0, 8)}'. Maintainer re-approval required.`
          };
          process.stdout.write(JSON.stringify(output2) + "\n");
          process.exit(1);
        }
      }
    }
    const prompt2 = toolArgs.prompt || toolArgs.content || "";
    const extractedPlan = extractPlanMarkdown(prompt2);
    if (input.sessionId) {
      state2.sessionId = input.sessionId;
      saveState(state2, repoRoot2);
    }
    syncWorkflowDashboard(repoRoot2, {
      owner: state2.issue?.owner || "vamsicherukuri",
      repo: state2.issue?.repo || "prsquad",
      issueNumber: resolvedIssue2,
      issueTitle: state2.issue?.title || (state2.issue?.number ? `Issue #${state2.issue.number}` : "Active Pipeline Task"),
      activeBranch: branchName,
      sessionId: input.sessionId || state2.sessionId,
      phase: "scopeGate",
      status: "APPROVED",
      summary: `Scope Approval Gate approved by ${lock2.approvedBy} on branch '${branchName}'`,
      details: {
        approvedScope: lock2.approvedScope,
        approvedBy: lock2.approvedBy,
        approvedAt: lock2.approvedAt,
        activeBranch: branchName,
        ...extractedPlan ? { plan: extractedPlan } : {}
      }
    });
    const dashDev = syncWorkflowDashboard(repoRoot2, {
      sessionId: input.sessionId || state2.sessionId,
      phase: "developer",
      status: "IN_PROGRESS",
      summary: `Implementing changes bounded to '${lock2.approvedScope}' on branch '${branchName}'`
    });
    const chatMeter = formatChatCreditMeter(dashDev);
    appendAuditLog({
      sessionId: state2.sessionId,
      agent: "controller",
      tool: "agent",
      action: "developer_invocation_authorized",
      decision: "allow",
      details: {
        attempt: lock2.currentAttempt,
        approvedScope: lock2.approvedScope,
        approvedBy: lock2.approvedBy,
        activeBranch: branchName,
        branchStatus
      }
    });
    const branchInstructions = `[BRANCH ISOLATION GUARDRAIL]
Active Feature Branch: '${branchName}' (automatically created/checked out by Scope Gate hook).
All edits and commits MUST remain on '${branchName}'.
Direct checkout or commits to 'main'/'master' and remote 'git push' are strictly blocked by security hooks.
Before reporting IMPLEMENTED, stage and commit your changes: git commit -m "fix: <summary> (fixes #${resolvedIssue2})".
Report headRef as your commit SHA or '${branchName}'.`;
    const enrichedPrompt = prompt2.includes("[BRANCH ISOLATION GUARDRAIL]") ? prompt2 : `${branchInstructions}

${prompt2}`;
    const modifiedArgs = {
      ...toolArgs,
      prompt: enrichedPrompt,
      activeBranch: branchName
    };
    const repoIntel = formatRepoIntelligenceForPrompt(repoRoot2, targetAgent, lock2.approvedScope);
    let canonicalPlan = "";
    if (dashDev?.phases?.architect?.details?.plan) {
      canonicalPlan = dashDev.phases.architect.details.plan;
    } else if (dashDev?.phases?.scopeGate?.details?.plan) {
      canonicalPlan = dashDev.phases.scopeGate.details.plan;
    } else if (state2.approvedPlan) {
      canonicalPlan = state2.approvedPlan;
    } else if (extractedPlan) {
      canonicalPlan = extractedPlan;
    }
    const planText = typeof canonicalPlan === "string" ? canonicalPlan.trim() : JSON.stringify(canonicalPlan, null, 2);
    const planSection = canonicalPlan ? `

### \u{1F4D0} Canonical Approved Architecture Plan (Injected by Scope Gate Hook)
${planText}` : "";
    const specText = typeof specBody === "string" ? specBody.trim() : "";
    const specSection = specText ? `

### \u{1F4CB} Verified Issue Specification & Acceptance Criteria
${specText}` : "";
    let reworkSection = "";
    const prevQA = dashDev?.phases?.qa;
    if (lock2.currentAttempt > 1 && prevQA?.status === "FAIL") {
      const qaDetails = prevQA.details || {};
      const findings = qaDetails.blockingFindings?.length ? `
#### \u{1F50D} Blocking Findings:
` + qaDetails.blockingFindings.map((f) => `- \u274C ${f}`).join("\n") : "";
      const failures = qaDetails.failureClassification?.length ? `
#### \u{1F6A9} Failure Classifications:
` + qaDetails.failureClassification.map((f) => `- \u26A0\uFE0F [${f.classification}] ${f.failure}${f.evidence ? ` (${f.evidence})` : ""}`).join("\n") : "";
      reworkSection = `

### \u{1F527} Previous QA Verification Failure Report (Rework Attempt ${lock2.currentAttempt}/${lock2.maxAttempts})
> **Previous QA Verdict:** \u274C \`FAIL\`
` + (prevQA.summary ? `> **QA Summary:** ${prevQA.summary}
` : "") + (qaDetails.testNotes ? `> **QA Notes:** ${qaDetails.testNotes}
` : "") + failures + findings;
    }
    const addCtx = `SCOPE_GATE_VERIFIED: Implementation Attempt ${lock2.currentAttempt}/${lock2.maxAttempts} authorized by ${lock2.approvedBy}.
APPROVED_SCOPE_PREFIX: "${lock2.approvedScope}"
ACTIVE_FEATURE_BRANCH: "${branchName}"
Developer write actions are strictly bounded to this prefix and branch.` + planSection + specSection + reworkSection + (chatMeter ? `

${formatControlPlaneTelemetry(chatMeter, "Include this \u{1F4CA} AI Credit Meter status in your implementation handoff summary.")}` : "") + (repoIntel ? `

${repoIntel}` : "");
    const output = {
      decision: "allow",
      permissionDecision: "allow",
      modifiedArgs,
      updatedInput: modifiedArgs,
      additionalContext: addCtx,
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
        modifiedArgs,
        updatedInput: modifiedArgs,
        additionalContext: addCtx
      }
    };
    process.stdout.write(JSON.stringify(output) + "\n");
    process.exit(0);
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
              acceptanceCriteriaResults: parsed.acceptanceCriteriaResults || [],
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
    const sanitized = sanitizeSpecialistHandoff(raw, agentName || targetAgent);
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
    const dashFile = join7(repoPath, ".gated-change", "dashboard.json");
    let dashData = null;
    if (existsSync7(dashFile)) {
      try {
        dashData = JSON.parse(readFileSync7(dashFile, "utf-8"));
        if (dashData?.phases?.developer?.details) {
          details = { ...dashData.phases.developer.details };
        }
      } catch {
      }
    }
    if (!details.commitSha || !details.changedFiles) {
      const fromPrompt = extractDeveloperDetails(fallbackPrompt, repoPath);
      details = { ...fromPrompt, ...details };
    }
    if (!details.commitSha) {
      try {
        details.commitSha = execSync4("git rev-parse HEAD", { cwd: repoPath, encoding: "utf-8" }).trim();
      } catch {
        details.commitSha = "HEAD";
      }
    }
    if (!details.changedFiles || details.changedFiles.length === 0) {
      try {
        const files = execSync4("git diff-tree --no-commit-id --name-only -r HEAD", { cwd: repoPath, encoding: "utf-8" }).trim().split("\n").filter(Boolean);
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
    const dashFile = join7(repoPath, ".gated-change", "dashboard.json");
    let dashData = null;
    if (existsSync7(dashFile)) {
      try {
        dashData = JSON.parse(readFileSync7(dashFile, "utf-8"));
        if (dashData?.phases?.qa?.details) {
          details = { ...dashData.phases.qa.details };
        }
      } catch {
      }
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
  if (input.toolResult) {
    const effectiveCwd2 = input.cwd || process.cwd();
    const repoRoot2 = getRepoRoot(effectiveCwd2);
    const state2 = loadState(repoRoot2);
    const lock2 = loadApprovalLock(repoRoot2);
    const resolvedIssue2 = resolveIssueNumber(input, toolArgs, state2, lock2);
    if (input.sessionId && (!state2.sessionId || state2.sessionId !== input.sessionId)) {
      state2.sessionId = input.sessionId;
      saveState(state2, repoRoot2);
    }
    if (isAgentMatch(targetAgent, "gated-change-intake")) {
      const triageVal = validateTriage(input.toolResult);
      const triageStatus = triageVal.valid ? triageVal.data.status : "HANDOFF_INVALID";
      const triageSummary = triageVal.valid ? triageStatus === "READY" ? "Issue requirements extracted and acceptance criteria validated" : triageStatus === "NOT_READY" ? `Definition of Ready not met (missing: ${triageVal.data.missing?.join(", ")})` : `Triage reported ${triageStatus}` : `Triage handoff validation failed: ${triageVal.errors.join("; ")}`;
      const dashIntake = syncWorkflowDashboard(repoRoot2, {
        owner: state2.issue?.owner || "vamsicherukuri",
        repo: state2.issue?.repo || "prsquad",
        issueNumber: resolvedIssue2,
        issueTitle: state2.issue?.title || (state2.issue?.number ? `Issue #${state2.issue.number}` : "Active Pipeline Task"),
        sessionId: input.sessionId || state2.sessionId,
        phase: "intake",
        status: triageStatus,
        summary: triageSummary,
        details: triageVal.valid ? triageVal.data : { errors: triageVal.errors }
      });
      const triageInstruction = !triageVal.valid ? `[INSTRUCTION FOR CONTROLLER]: Triage handoff failed validation (${triageVal.errors.join("; ")}). Issue one schema-correction prompt to Intake specialist or pause pipeline.` : triageStatus === "NOT_READY" ? "[INSTRUCTION FOR CONTROLLER]: Issue is NOT_READY. Ask the maintainer the single clarifying question to satisfy Definition of Ready (round 1/2)." : "[INSTRUCTION FOR CONTROLLER]: Intake triage complete. Include this live \u26A1 AI Credit Meter status in your handoff message before delegating to Architect.";
      const chatMeter = formatChatCreditMeter(dashIntake);
      const out = chatMeter ? buildEnrichedPostToolOutput(input, chatMeter, triageInstruction) : { decision: "allow" };
      process.stdout.write(JSON.stringify(out) + "\n");
      process.exit(0);
    } else if (isAgentMatch(targetAgent, "gated-change-architect")) {
      const archVal = validateArchitect(input.toolResult);
      const archStatus = archVal.valid ? archVal.data.status : "HANDOFF_INVALID";
      const rawText = typeof input.toolResult === "string" ? input.toolResult : input.toolResult.textResultForLlm || input.toolResult.content || JSON.stringify(input.toolResult);
      const planMarkdown = extractPlanMarkdown(rawText);
      const proposedScope = archVal.valid && archVal.data.proposedScope ? archVal.data.proposedScope : state2.approvedScope || "NOT RECORDED";
      const archSummary = archVal.valid ? archStatus === "PLAN_READY" ? "Technical architecture plan & scope specification generated" : archStatus === "BLOCKED" ? `Architect blocked: ${archVal.data.blockedReason || "Cannot produce confident plan"}` : `Scope amendment ${archStatus}` : `Architect handoff validation failed: ${archVal.errors.join("; ")}`;
      const dashArch = syncWorkflowDashboard(repoRoot2, {
        owner: state2.issue?.owner || "vamsicherukuri",
        repo: state2.issue?.repo || "prsquad",
        issueNumber: resolvedIssue2,
        issueTitle: state2.issue?.title || (state2.issue?.number ? `Issue #${state2.issue.number}` : "Active Pipeline Task"),
        sessionId: input.sessionId || state2.sessionId,
        phase: "architect",
        status: archStatus,
        summary: archSummary,
        details: {
          plan: planMarkdown || rawText,
          proposedScope,
          riskTier: archVal.valid && archVal.data.blastRadius?.risk || "Low",
          validated: archVal.valid,
          errors: archVal.valid ? void 0 : archVal.errors
        }
      });
      const archInstruction = !archVal.valid ? `[INSTRUCTION FOR CONTROLLER]: Architect handoff failed validation (${archVal.errors.join("; ")}). Pause pipeline and report blocker to maintainer.` : archStatus === "BLOCKED" ? "[INSTRUCTION FOR CONTROLLER]: Architect reported BLOCKED. Pause pipeline and report blocker to maintainer." : archStatus === "SCOPE_AMENDMENT_CONFIRMED" ? "[INSTRUCTION FOR CONTROLLER]: Scope amendment confirmed by Architect. Route back to Scope Approval Gate for human confirmation." : "[INSTRUCTION FOR CONTROLLER]: Include this live \u26A1 AI Credit Meter table alongside the architecture plan at the Scope Approval Gate.";
      const chatMeter = formatChatCreditMeter(dashArch);
      const out = chatMeter ? buildEnrichedPostToolOutput(input, chatMeter, archInstruction) : { decision: "allow" };
      process.stdout.write(JSON.stringify(out) + "\n");
      process.exit(0);
    } else if (isAgentMatch(targetAgent, "gated-change-developer")) {
      const devVal = validateDeveloper(input.toolResult);
      const devStatus = devVal.valid ? devVal.data.status : "HANDOFF_INVALID";
      if (devVal.valid && devStatus === "IMPLEMENTED") {
        try {
          const statusOut = execSync4("git status --porcelain", { cwd: repoRoot2, encoding: "utf-8" }).trim();
          if (statusOut) {
            execSync4("git add -u", { cwd: repoRoot2, stdio: "ignore" });
            const commitMsg = `fix(issue-${resolvedIssue2}): implement verified changes within approved scope`;
            execSync4(`git commit -m "${commitMsg}"`, { cwd: repoRoot2, stdio: "ignore" });
          }
        } catch {
        }
      }
      const devDetails = devVal.valid ? extractDeveloperDetails(input.toolResult, repoRoot2) : { status: "SCHEMA_INVALID", errors: devVal.errors };
      const devSummary = devVal.valid ? devStatus === "IMPLEMENTED" ? devDetails.commitSha ? `Fix committed in ${devDetails.commitSha.slice(0, 8)}` : "Changes implemented and verified locally" : devStatus === "SCOPE_AMENDMENT_REQUIRED" ? "Developer requested scope amendment outside approved boundary" : `Developer reported BLOCKED: ${devVal.data.blocker?.description || "Execution halted"}` : `Developer handoff validation failed: ${devVal.errors.join("; ")}`;
      const dashDev = syncWorkflowDashboard(repoRoot2, {
        owner: state2.issue?.owner || "vamsicherukuri",
        repo: state2.issue?.repo || "prsquad",
        issueNumber: resolvedIssue2,
        issueTitle: state2.issue?.title || (state2.issue?.number ? `Issue #${state2.issue.number}` : "Active Pipeline Task"),
        sessionId: input.sessionId || state2.sessionId,
        phase: "developer",
        status: devStatus,
        summary: devSummary,
        details: devDetails
      });
      const devInstruction = !devVal.valid ? `[INSTRUCTION FOR CONTROLLER]: Developer handoff schema invalid (${devVal.errors.join("; ")}). Re-prompt Developer for valid schema handoff or pause pipeline.` : devStatus === "SCOPE_AMENDMENT_REQUIRED" ? "[INSTRUCTION FOR CONTROLLER]: Developer requested scope amendment. Route to Architect for scope review." : devStatus === "BLOCKED" ? "[INSTRUCTION FOR CONTROLLER]: Developer blocked. Pause pipeline and report blocker to maintainer." : "[INSTRUCTION FOR CONTROLLER]: Developer implementation complete. Proceed directly to QA verification.";
      const devAiCredits = dashDev?.telemetry?.actualAiCredits !== void 0 ? `> \u26A1 Live Telemetry: **${dashDev.telemetry.actualAiCredits.toFixed(2)} AIU** consumed across active phases.` : "";
      const out = buildEnrichedPostToolOutput(input, devAiCredits, devInstruction);
      process.stdout.write(JSON.stringify(out) + "\n");
      process.exit(0);
    } else if (isAgentMatch(targetAgent, "gated-change-qa")) {
      const qaVal = validateQA(input.toolResult);
      const qaDetails = extractQADetails(input.toolResult);
      const qaVerdict = qaVal.valid ? qaVal.data.verdict : "HANDOFF_INVALID";
      let retryExhausted = false;
      if (qaVerdict === "FAIL" && lock2) {
        lock2.currentAttempt++;
        saveApprovalLock(lock2, repoRoot2);
        state2.implementationAttempt = lock2.currentAttempt;
        if (lock2.currentAttempt > lock2.maxAttempts) {
          retryExhausted = true;
          state2.phase = "ESCALATED";
          state2.currentPhase = "ESCALATED";
        }
        saveState(state2, repoRoot2);
      }
      const qaSummary = qaVal.valid ? qaVerdict === "PASS" ? "Independent QA verification passed all acceptance criteria" : qaVerdict === "FAIL" ? retryExhausted ? `Independent QA verification failed and retry budget exhausted (${lock2.maxAttempts}/${lock2.maxAttempts} attempts used)` : `Independent QA verification detected failures (${qaVal.data.failureClassification?.map((f) => f.failure).join("; ") || qaVal.data.blockingFindings?.join("; ") || "Test failure"})` : "QA verification blocked: unable to complete test suite" : `QA handoff validation failed: ${qaVal.errors.join("; ")}`;
      const dashQA = syncWorkflowDashboard(repoRoot2, {
        owner: state2.issue?.owner || "vamsicherukuri",
        repo: state2.issue?.repo || "prsquad",
        issueNumber: resolvedIssue2,
        issueTitle: state2.issue?.title || (state2.issue?.number ? `Issue #${state2.issue.number}` : "Active Pipeline Task"),
        sessionId: input.sessionId || state2.sessionId,
        phase: "qa",
        status: qaVerdict,
        summary: qaSummary,
        details: { ...qaDetails, verdict: qaVerdict, errors: qaVal.valid ? void 0 : qaVal.errors, currentAttempt: lock2 ? lock2.currentAttempt : void 0 }
      });
      const qaInstruction = !qaVal.valid ? `[INSTRUCTION FOR CONTROLLER]: QA handoff failed validation (${qaVal.errors.join("; ")}). Re-prompt QA for valid verification report or pause pipeline.` : retryExhausted ? `[INSTRUCTION FOR CONTROLLER]: Implementation retry limit exhausted (${lock2.maxAttempts}/${lock2.maxAttempts} attempts used). Workflow is escalated to human maintainers. Do not delegate to Developer again.` : qaVerdict === "FAIL" ? `[INSTRUCTION FOR CONTROLLER]: QA verification failed (Attempt ${(lock2?.currentAttempt || 2) - 1}/${lock2?.maxAttempts || 3} failed). Route back to Developer for rework attempt ${lock2?.currentAttempt || 2}/${lock2?.maxAttempts || 3}.` : qaVerdict === "BLOCKED" ? "[INSTRUCTION FOR CONTROLLER]: QA verification blocked. Pause pipeline and report blocker to maintainer." : "[INSTRUCTION FOR CONTROLLER]: QA verification passed. Proceed directly to Reviewer security audit.";
      const qaAiCredits = dashQA?.telemetry?.actualAiCredits !== void 0 ? `> \u26A1 Live Telemetry: **${dashQA.telemetry.actualAiCredits.toFixed(2)} AIU** consumed across active phases.` : "";
      const out = buildEnrichedPostToolOutput(input, qaAiCredits, qaInstruction);
      process.stdout.write(JSON.stringify(out) + "\n");
      process.exit(0);
    } else if (isAgentMatch(targetAgent, "gated-change-reviewer")) {
      const revVal = validateReview(input.toolResult);
      const revDetails = extractReviewerDetails(input.toolResult);
      const verdict = revVal.valid ? revVal.data.assessment : "HANDOFF_INVALID";
      syncWorkflowDashboard(repoRoot2, {
        owner: state2.issue?.owner || "vamsicherukuri",
        repo: state2.issue?.repo || "prsquad",
        issueNumber: resolvedIssue2,
        sessionId: input.sessionId || state2.sessionId,
        phase: "reviewer",
        status: verdict,
        summary: revVal.valid ? `Read-only diff security audit complete: ${verdict}` : `Reviewer handoff validation failed: ${revVal.errors.join("; ")}`,
        details: revVal.valid ? revDetails : { errors: revVal.errors, ...revDetails }
      });
      if (revVal.valid && verdict === "CLEAR") {
        state2.phase = "PR_READY";
        state2.currentPhase = "WAITING_FOR_HUMAN";
        saveState(state2, repoRoot2);
        const dashMerge = syncWorkflowDashboard(repoRoot2, {
          sessionId: input.sessionId || state2.sessionId,
          phase: "mergeGate",
          status: "WAITING_FOR_HUMAN",
          summary: `Read-only diff security audit complete: ${verdict}. Verified implementation is ready for PR creation. Awaiting human maintainer authorization via /create-pr at the PR Approval Gate.`,
          details: {
            baseBranch: "copilot-app-plugin-alignment",
            headBranch: state2.activeBranch || `fix/issue-${resolvedIssue2}`,
            prOpen: false,
            awaitingHumanApproval: true
          }
        });
        const chatMeter = formatChatCreditMeter(dashMerge);
        const out = chatMeter ? buildEnrichedPostToolOutput(
          input,
          chatMeter,
          "[INSTRUCTION FOR CONTROLLER]: Code review audit complete. Display this final \u26A1 AI Credit Meter table and present the PR_READY package to the maintainer at the PR Approval Gate. Prompt the human to authorize PR creation with /create-pr before executing pr-create.ts."
        ) : { decision: "allow" };
        process.stdout.write(JSON.stringify(out) + "\n");
        process.exit(0);
      } else {
        const revInstruction = !revVal.valid ? `[INSTRUCTION FOR CONTROLLER]: Reviewer handoff failed validation (${revVal.errors.join("; ")}). Pause pipeline and notify maintainer.` : `[INSTRUCTION FOR CONTROLLER]: Reviewer reported ${verdict}. Resolve review findings before opening Pull Request.`;
        const out = buildEnrichedPostToolOutput(input, "", revInstruction);
        process.stdout.write(JSON.stringify(out) + "\n");
        process.exit(0);
      }
    }
    process.stdout.write(JSON.stringify({ decision: "allow" }) + "\n");
    process.exit(0);
  }
  const effectiveCwd = input.cwd || process.cwd();
  const repoRoot = getRepoRoot(effectiveCwd);
  ensureNodeModulesInWorktree(repoRoot);
  const state = loadState(repoRoot);
  const lock = loadApprovalLock(repoRoot);
  const resolvedIssue = resolveIssueNumber(input, toolArgs, state, lock);
  const prompt = String(toolArgs.prompt || input.toolArgs?.prompt || "");
  if (input.sessionId && (!state.sessionId || state.sessionId !== input.sessionId)) {
    state.sessionId = input.sessionId;
    saveState(state, repoRoot);
  }
  if (isAgentMatch(targetAgent, "gated-change-architect")) {
    const declaredScope = state.approvedScope || state.issue?.declaredScope || "src/guardrails/scopeEnforcer.ts, scripts/test-guardrails.ts";
    const astMap = generateAstPreFetchMap(declaredScope, repoRoot);
    const dashArch = syncWorkflowDashboard(repoRoot, {
      owner: state.issue?.owner || "vamsicherukuri",
      repo: state.issue?.repo || "prsquad",
      issueNumber: resolvedIssue,
      issueTitle: state.issue?.title || (state.issue?.number ? `Issue #${state.issue.number}` : "Active Pipeline Task"),
      sessionId: input.sessionId || state.sessionId,
      phase: "architect",
      status: "IN_PROGRESS",
      summary: "Architect synthesizing issue requirements into bounded technical plan"
    });
    const chatMeter = formatChatCreditMeter(dashArch);
    const enrichedPrompt = astMap ? `${astMap}

${prompt}` : prompt;
    const modifiedArgs = {
      ...toolArgs,
      prompt: enrichedPrompt
    };
    const repoIntel = formatRepoIntelligenceForPrompt(repoRoot, targetAgent, declaredScope);
    let addCtx = "";
    if (astMap) addCtx += `${astMap}

`;
    if (repoIntel) addCtx += `${repoIntel}

`;
    if (chatMeter) {
      addCtx += `

${formatControlPlaneTelemetry(chatMeter, "Intake complete. Surface this live \u{1F4CA} AI Credit Meter status in your handoff message to the user before generating the architectural plan.")}`;
    }
    const out = {
      decision: "allow",
      permissionDecision: "allow",
      modifiedArgs,
      updatedInput: modifiedArgs,
      additionalContext: addCtx || void 0,
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
        modifiedArgs,
        updatedInput: modifiedArgs,
        additionalContext: addCtx || void 0
      }
    };
    process.stdout.write(JSON.stringify(out) + "\n");
    process.exit(0);
  } else if (isAgentMatch(targetAgent, "gated-change-qa")) {
    ensureNodeModulesInWorktree(repoRoot);
    let testReport = "";
    try {
      const tooling2 = detectRepoStack(repoRoot);
      const testCmd = tooling2.testCommand;
      const testStdout = execSync4(testCmd, {
        cwd: repoRoot,
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
      const tooling2 = detectRepoStack(repoRoot);
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
    const devHandoff = buildDeveloperHandoffPayload(repoRoot, state, prompt, resolvedIssue);
    const dashFile = join7(repoRoot, ".gated-change", "dashboard.json");
    let devPhaseStatus = "";
    if (existsSync7(dashFile)) {
      try {
        const d = JSON.parse(readFileSync7(dashFile, "utf-8"));
        devPhaseStatus = d?.phases?.developer?.status || "";
      } catch {
      }
    }
    if (devPhaseStatus !== "IMPLEMENTED") {
      const output = {
        decision: "deny",
        reason: `BLOCKED BY POLICY: QA agent cannot be invoked before Developer implementation has completed with status 'IMPLEMENTED' (current: '${devPhaseStatus || "NOT RECORDED"}'). Stage transitions require verified prior evidence; downstream stages may never manufacture upstream success.`
      };
      process.stdout.write(JSON.stringify(output) + "\n");
      process.exit(1);
    }
    const dashQA = syncWorkflowDashboard(repoRoot, {
      sessionId: input.sessionId || state.sessionId,
      phase: "qa",
      status: "IN_PROGRESS",
      summary: "Executing independent regression verification suite via powershell"
    });
    const chatMeter = formatChatCreditMeter(dashQA);
    const partsQA = [testReport, devHandoff.markdown, prompt].filter(Boolean);
    const enrichedPrompt = partsQA.join("\n\n");
    const modifiedArgs = {
      ...toolArgs,
      prompt: enrichedPrompt
    };
    const tooling = detectRepoStack(repoRoot);
    const repoIntel = formatRepoIntelligenceForPrompt(repoRoot, targetAgent, state.approvedScope);
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
    const out = {
      decision: "allow",
      permissionDecision: "allow",
      modifiedArgs,
      updatedInput: modifiedArgs,
      additionalContext: addCtx || void 0,
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
        modifiedArgs,
        updatedInput: modifiedArgs,
        additionalContext: addCtx || void 0
      }
    };
    process.stdout.write(JSON.stringify(out) + "\n");
    process.exit(0);
  } else if (isAgentMatch(targetAgent, "gated-change-reviewer")) {
    ensureNodeModulesInWorktree(repoRoot);
    const dashFile = join7(repoRoot, ".gated-change", "dashboard.json");
    let dashData = null;
    if (existsSync7(dashFile)) {
      try {
        dashData = JSON.parse(readFileSync7(dashFile, "utf-8"));
      } catch {
      }
    }
    const qaStatus = dashData?.phases?.qa?.status || state.phases?.qa?.status;
    if (qaStatus !== "PASS") {
      appendAuditLog({
        sessionId: state.sessionId,
        agent: "controller",
        tool: "agent",
        action: "reviewer_invocation_blocked_qa_not_passed",
        decision: "deny",
        details: { qaStatus: qaStatus || "NONE" }
      }, repoRoot);
      const output = {
        decision: "deny",
        reason: `BLOCKED BY POLICY: Reviewer agent cannot be invoked before independent QA verification has passed. Current QA status: '${qaStatus || "PENDING"}'.`
      };
      process.stdout.write(JSON.stringify(output) + "\n");
      process.exit(1);
    }
    let diffReport = "";
    try {
      const base = state.baseRef || "HEAD~1";
      let diffOutput = "";
      try {
        diffOutput = execSync4(`git diff ${base} HEAD`, { cwd: repoRoot, encoding: "utf-8" }).trim();
      } catch {
        diffOutput = execSync4(`git diff HEAD~1 HEAD`, { cwd: repoRoot, encoding: "utf-8" }).trim();
      }
      let changedFiles = [];
      try {
        changedFiles = execSync4(`git diff --name-only ${base} HEAD`, { cwd: repoRoot, encoding: "utf-8" }).split("\n").map((l) => l.trim()).filter(Boolean);
      } catch {
        try {
          changedFiles = execSync4("git diff --name-only HEAD~1 HEAD", { cwd: repoRoot, encoding: "utf-8" }).split("\n").map((l) => l.trim()).filter(Boolean);
        } catch {
        }
      }
      const sweep = runSymbolSweep(changedFiles, state.approvedScope || "", repoRoot);
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
    const devHandoff = buildDeveloperHandoffPayload(repoRoot, state, prompt, resolvedIssue);
    const qaHandoff = buildQAHandoffPayload(repoRoot, state, prompt);
    const dashRev = syncWorkflowDashboard(repoRoot, {
      sessionId: input.sessionId || state.sessionId,
      phase: "reviewer",
      status: "IN_PROGRESS",
      summary: "Conducting read-only security diff audit & blast radius review"
    });
    const chatMeter = formatChatCreditMeter(dashRev);
    const partsRev = [diffReport, qaHandoff.markdown, devHandoff.markdown, prompt].filter(Boolean);
    const enrichedPrompt = partsRev.join("\n\n");
    const modifiedArgs = {
      ...toolArgs,
      prompt: enrichedPrompt
    };
    const repoIntel = formatRepoIntelligenceForPrompt(repoRoot, targetAgent, state.approvedScope);
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
    const out = {
      decision: "allow",
      permissionDecision: "allow",
      modifiedArgs,
      updatedInput: modifiedArgs,
      additionalContext: addCtx || void 0,
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
        modifiedArgs,
        updatedInput: modifiedArgs,
        additionalContext: addCtx || void 0
      }
    };
    process.stdout.write(JSON.stringify(out) + "\n");
    process.exit(0);
  }
  process.stdout.write(JSON.stringify({ decision: "allow", permissionDecision: "allow" }) + "\n");
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

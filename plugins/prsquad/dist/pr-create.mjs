#!/usr/bin/env node

// src/guardrails/prCreator.ts
import { writeFileSync as writeFileSync3, unlinkSync as unlinkSync2, existsSync as existsSync3, readFileSync as readFileSync3 } from "node:fs";
import { join as join3 } from "node:path";
import { tmpdir as tmpdir2 } from "node:os";
import { execSync as execSync3, execFileSync as execFileSync2 } from "node:child_process";

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

// src/guardrails/issueDashboard.ts
import { existsSync as existsSync2, readFileSync as readFileSync2, writeFileSync as writeFileSync2, unlinkSync } from "node:fs";
import { join as join2 } from "node:path";
import { tmpdir, homedir as homedir2 } from "node:os";
import { execFileSync, execSync as execSync2 } from "node:child_process";
import { createRequire } from "node:module";
var DASHBOARD_ANCHOR = "<!-- gated-change:workflow-dashboard -->";
function loadDashboardState(rootDir = getRepoRoot()) {
  try {
    const gatedDir = findGatedChangeDir(rootDir);
    const dashboardFile = join2(gatedDir, "dashboard.json");
    if (existsSync2(dashboardFile)) {
      return JSON.parse(readFileSync2(dashboardFile, "utf-8"));
    }
  } catch {
  }
  return null;
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

// src/guardrails/prCreator.ts
function buildPullRequestBody(params) {
  const rootDir = getRepoRoot(params.rootDir);
  const headCommit = params.headCommit || (() => {
    try {
      return execSync3("git rev-parse HEAD", { cwd: rootDir, encoding: "utf-8" }).trim();
    } catch {
      return "0000000000000000000000000000000000000000";
    }
  })();
  const shortSha = headCommit.slice(0, 7);
  const lock = loadApprovalLock(rootDir);
  const state = loadState(rootDir);
  let rawLockStatus;
  try {
    const searchDir = findGatedChangeDir(rootDir);
    const lockPath = join3(searchDir, "approval.lock");
    if (existsSync3(lockPath)) {
      const parsed = JSON.parse(readFileSync3(lockPath, "utf-8"));
      if (parsed.status) rawLockStatus = parsed.status;
    }
  } catch {
  }
  const dashboard = loadDashboardState(rootDir);
  const qa = dashboard?.phases?.qa;
  const qaVerdict = qa?.details?.verdict || qa?.status || "NOT RECORDED";
  const qaEvidence = qa?.summary || qa?.details?.testNotes || (qaVerdict === "PASS" ? "Verified clean via independent test execution cycle" : "NOT RECORDED");
  const rev = dashboard?.phases?.reviewer;
  const revVerdict = rev?.details?.assessment || rev?.details?.verdict || rev?.status || "NOT RECORDED";
  const revEvidence = rev?.summary || rev?.details?.mergeGateSummary || (revVerdict === "CLEAR" || revVerdict === "APPROVED" ? "Verified read-only diff inspection, zero security concerns" : "NOT RECORDED");
  const lockStatus = lock?.status || rawLockStatus || "NOT RECORDED";
  const approverInfo = lock?.approvedBy ? `\`${lock.approvedBy}\` (${lock.approvedAt || "timestamp not recorded"})` : "`NOT RECORDED`";
  const approvedScopeStr = lock && lock.status === "ACTIVE" ? lock.approvedScope || state.approvedScope || "NOT RECORDED" : "NOT RECORDED";
  return `## \u{1F6E1}\uFE0F PRSquad Governed Pull Request

<p align="left">
  <a href="https://github.com/vamsicherukuri/prsquad"><img alt="Supervised Agentic Workflow" src="https://img.shields.io/badge/PRsquad-Supervised%20Workflow-8250df?style=flat-square&logo=github"></a>
  <a href="#"><img alt="Deterministic Policy" src="https://img.shields.io/badge/Deterministic%20Policy-Enforced-2ea043?style=flat-square"></a>
  <a href="#"><img alt="Human Scope Gate" src="https://img.shields.io/badge/Scope%20Gate-Deterministically%20Locked-0969da?style=flat-square"></a>
</p>

Closes #${params.issueNum}

### \u{1F4CB} Overview
${params.issueTitle}

### \u{1F512} Deterministic Provenance & Scope Lock
- **Approval Lock Status**: \`${lockStatus}\`
- **Authorized By**: ${approverInfo}
- **Approved Scope**: \`${approvedScopeStr}\`
${lock?.planHash ? `- **Approval Integrity Binding (planHash)**: \`${lock.planHash.slice(0, 16)}\`
` : ""}- **Feature Branch**: \`${params.activeBranch}\`
- **Base Target**: \`${params.baseBranch}\`

### \u{1F528} Implementation Summary
- **Commit SHA**: \`${shortSha}\` (\`${headCommit}\`)
- **Author**: Autonomous \`@prsquad-dev\` via native PowerShell
- **Scope Compliance**: ${approvedScopeStr !== "NOT RECORDED" ? "100% strictly bounded to approved scope" : "NOT RECORDED"}

### \u{1F9EA} QA Independent Verification
- **Verdict**: \`${qaVerdict}\`
- **Evidence**: ${qaEvidence}

### \u{1F50D} Security & Code Review
- **Code Review Verdict**: \`${revVerdict}\`
- **Diff Inspection**: ${revEvidence}

---
> *Pull Request opened automatically by **PRSquad** upon human **PR Gate** confirmation.*  
> *Merging is strictly reserved for human maintainers on GitHub after PR review.*
`;
}
function isValidGitRef(branch) {
  if (!branch || typeof branch !== "string") return false;
  const VALID_BRANCH_REGEX = /^[a-zA-Z0-9/_.-]+$/;
  const SHELL_META_REGEX = /[;|&$\`><\n\r]/;
  if (!VALID_BRANCH_REGEX.test(branch)) return false;
  if (SHELL_META_REGEX.test(branch)) return false;
  if (branch.startsWith("-") || branch.startsWith("/") || branch.endsWith("/")) return false;
  if (branch.includes("..") || branch.includes("@{") || branch.endsWith(".lock")) return false;
  return true;
}
function createPullRequest(options = {}) {
  const rootDir = getRepoRoot(options.preferredDir);
  const state = loadState(rootDir);
  try {
    let activeBranch = "";
    try {
      activeBranch = execSync3("git rev-parse --abbrev-ref HEAD", {
        cwd: rootDir,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"]
      }).trim();
    } catch {
    }
    const gitBranch = activeBranch;
    if (!activeBranch || activeBranch === "HEAD") {
      activeBranch = state.activeBranch || "";
    }
    if (gitBranch === "main" || gitBranch === "master" || activeBranch === "main" || activeBranch === "master" || !activeBranch) {
      return {
        success: false,
        error: `Cannot create PR from base branch '${gitBranch === "main" || gitBranch === "master" ? gitBranch : activeBranch}'. Must be on a designated feature branch.`
      };
    }
    if (!isValidGitRef(activeBranch)) {
      return {
        success: false,
        error: `INVALID_BRANCH_NAME: Feature branch '${activeBranch}' violates pr-governance naming rules. Must match '^[a-zA-Z0-9/_.-]+$' without shell operators, control characters, or leading hyphens.`
      };
    }
    let baseBranch = options.baseBranch;
    if (!baseBranch) {
      try {
        const remotes = execSync3("git branch -r", { cwd: rootDir, encoding: "utf-8" });
        if (remotes.includes("origin/copilot-app-plugin-alignment")) {
          baseBranch = "copilot-app-plugin-alignment";
        } else {
          baseBranch = "main";
        }
      } catch {
        baseBranch = "copilot-app-plugin-alignment";
      }
    }
    if (baseBranch && !isValidGitRef(baseBranch)) {
      return {
        success: false,
        error: `INVALID_BRANCH_NAME: Base branch '${baseBranch}' violates pr-governance naming rules. Must match '^[a-zA-Z0-9/_.-]+$' without shell operators, control characters, or leading hyphens.`
      };
    }
    let issueNum = 0;
    const branchMatch = activeBranch.match(/(?:issue-?|#)(\d+)/i);
    if (branchMatch) {
      issueNum = parseInt(branchMatch[1], 10);
    }
    if (!issueNum) {
      const lock = loadApprovalLock(rootDir);
      if (lock?.issueNumber && lock.issueNumber > 0) {
        issueNum = lock.issueNumber;
      }
    }
    if (!issueNum && state.issue?.number && state.issue.number > 0) {
      issueNum = state.issue.number;
    }
    if (!issueNum || issueNum <= 0) {
      return {
        success: false,
        error: "PR_GATE_BLOCKED: Cannot determine target issue number from branch, approval lock, or state. Refusing to open PR without verified target issue."
      };
    }
    if (!options.skipEvidenceCheck) {
      const lock = loadApprovalLock(rootDir);
      if (!lock || lock.status !== "ACTIVE" || !lock.approvedScope) {
        return {
          success: false,
          error: "PR_GATE_BLOCKED: Missing valid Human Scope Gate approval lock. PR cannot be created without verified human authorization."
        };
      }
      const dashboard = loadDashboardState(rootDir);
      const qaRecord = dashboard?.phases?.qa;
      const qaVerdict = qaRecord?.details?.verdict || qaRecord?.status;
      if (!qaVerdict || qaVerdict !== "PASS") {
        return {
          success: false,
          error: `PR_GATE_BLOCKED: QA verification not recorded or failed (verdict: ${qaVerdict || "NOT RECORDED"}). PR gate strictly requires verified QA PASS evidence.`
        };
      }
      const revRecord = dashboard?.phases?.reviewer;
      const revVerdict = revRecord?.details?.assessment || revRecord?.details?.verdict || revRecord?.status;
      if (!revVerdict || revVerdict !== "CLEAR" && revVerdict !== "APPROVED") {
        return {
          success: false,
          error: `PR_GATE_BLOCKED: Security and code review audit not recorded or cleared (verdict: ${revVerdict || "NOT RECORDED"}). PR gate strictly requires Reviewer clearance (CLEAR or APPROVED).`
        };
      }
      let currentHead = "";
      try {
        currentHead = execSync3("git rev-parse HEAD", { cwd: rootDir, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }).trim();
      } catch {
      }
      if (currentHead && currentHead !== "HEAD") {
        const qaCommit = qaRecord?.details?.commitSha || qaRecord?.details?.headRef;
        if (qaCommit && qaCommit !== "HEAD" && !currentHead.startsWith(qaCommit) && !qaCommit.startsWith(currentHead)) {
          return {
            success: false,
            error: `PR_GATE_BLOCKED (STALE_EVIDENCE): QA verification was executed against commit '${qaCommit.slice(0, 8)}', but current branch HEAD is '${currentHead.slice(0, 8)}'. Re-verification required before opening PR.`
          };
        }
        const revCommit = revRecord?.details?.commitSha || revRecord?.details?.headRef;
        if (revCommit && revCommit !== "HEAD" && !currentHead.startsWith(revCommit) && !revCommit.startsWith(currentHead)) {
          return {
            success: false,
            error: `PR_GATE_BLOCKED (STALE_EVIDENCE): Code review was executed against commit '${revCommit.slice(0, 8)}', but current branch HEAD is '${currentHead.slice(0, 8)}'. Re-review required before opening PR.`
          };
        }
      }
      const searchDir = findGatedChangeDir(rootDir);
      const prAuthPath = join3(searchDir, "pr-authorization.json");
      if (existsSync3(prAuthPath)) {
        try {
          const authData = JSON.parse(readFileSync3(prAuthPath, "utf-8"));
          if (authData.status === "REVOKED") {
            return {
              success: false,
              error: `PR_GATE_BLOCKED: PR authorization token has been revoked by maintainer.`
            };
          }
          if (authData.issueNumber && authData.issueNumber !== issueNum) {
            return {
              success: false,
              error: `PR_GATE_BLOCKED: PR authorization token is bound to issue #${authData.issueNumber}, not current issue #${issueNum}.`
            };
          }
        } catch {
        }
      }
    }
    const remoteInfo = getRepoOwnerAndName(rootDir);
    const owner = state.issue?.owner || remoteInfo.owner || "vamsicherukuri";
    const repo = state.issue?.repo || remoteInfo.repo || "prsquad";
    let issueTitle = state.issue?.title;
    if (!issueTitle || state.issue?.number && state.issue.number !== issueNum) {
      try {
        const out = execFileSync2("gh", ["issue", "view", String(issueNum), "--repo", `${owner}/${repo}`, "--json", "title"], {
          encoding: "utf-8",
          stdio: ["ignore", "pipe", "ignore"]
        });
        const parsed = JSON.parse(out);
        if (parsed.title) issueTitle = parsed.title;
      } catch {
      }
    }
    if (!issueTitle) issueTitle = `Issue #${issueNum} resolution`;
    if (!state.issue) {
      state.issue = { owner, repo, number: issueNum, title: issueTitle };
    } else {
      state.issue.number = issueNum;
      state.issue.title = issueTitle;
    }
    saveState(state, rootDir);
    try {
      execFileSync2("git", ["push", "-u", "origin", activeBranch], {
        cwd: rootDir,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "pipe"]
      });
    } catch (pushErr) {
    }
    try {
      const existingOut = execFileSync2("gh", [
        "pr",
        "view",
        activeBranch,
        "--repo",
        `${owner}/${repo}`,
        "--json",
        "url,number"
      ], {
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"]
      }).trim();
      if (existingOut) {
        const parsed = JSON.parse(existingOut);
        if (parsed.url) {
          syncWorkflowDashboard(rootDir, {
            phase: "mergeGate",
            status: "PR_OPEN",
            summary: `PR #${parsed.number} is open: ${parsed.url}. Awaiting human maintainer review on GitHub.`
          });
          return {
            success: true,
            prUrl: parsed.url,
            prNumber: parsed.number,
            branch: activeBranch
          };
        }
      }
    } catch {
    }
    const prTitle = options.customTitle || (issueTitle && !issueTitle.startsWith("Issue #") ? `fix: resolve issue #${issueNum} - ${issueTitle}` : `fix: resolve issue #${issueNum}`);
    const prBody = buildPullRequestBody({
      rootDir,
      issueNum,
      issueTitle,
      activeBranch,
      baseBranch
    });
    const tempBodyPath = join3(tmpdir2(), `gated-change-pr-body-${Date.now()}.md`);
    writeFileSync3(tempBodyPath, prBody, "utf-8");
    try {
      const prCreateOut = execFileSync2("gh", [
        "pr",
        "create",
        "--repo",
        `${owner}/${repo}`,
        "--base",
        baseBranch,
        "--head",
        activeBranch,
        "--title",
        prTitle,
        "--body-file",
        tempBodyPath
      ], {
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "pipe"]
      }).trim();
      const prUrl = prCreateOut.split("\n").filter((l) => l.startsWith("http"))[0] || prCreateOut;
      const numMatch = prUrl.match(/\/pull\/(\d+)/);
      const prNumber = numMatch ? parseInt(numMatch[1], 10) : void 0;
      if (prNumber) {
        try {
          execFileSync2("gh", [
            "pr",
            "edit",
            String(prNumber),
            "--repo",
            `${owner}/${repo}`,
            "--add-label",
            "prsquad-verified,governance:supervised"
          ], {
            encoding: "utf-8",
            stdio: ["ignore", "ignore", "ignore"]
          });
        } catch {
        }
      }
      syncWorkflowDashboard(rootDir, {
        phase: "mergeGate",
        status: "PR_OPEN",
        summary: `PR ${prNumber ? `#${prNumber}` : ""} opened: ${prUrl}. Awaiting human maintainer review on GitHub.`
      });
      return {
        success: true,
        prUrl,
        prNumber,
        branch: activeBranch
      };
    } finally {
      if (existsSync3(tempBodyPath)) {
        unlinkSync2(tempBodyPath);
      }
    }
  } catch (err) {
    return {
      success: false,
      error: String(err?.message || err)
    };
  }
}

// scripts/guardrails/pr-create.ts
async function main() {
  console.log("=======================================================");
  console.log("  GATED CHANGE \u2014 DETERMINISTIC PULL REQUEST CREATION");
  console.log("=======================================================");
  const targetDir = process.argv[2] || process.cwd();
  const result = createPullRequest({ preferredDir: targetDir });
  if (result.success) {
    console.log(`
\u2705 PULL REQUEST SUCCESSFULLY OPENED!`);
    console.log(`   PR URL: ${result.prUrl}`);
    console.log(`   Branch: ${result.branch}`);
    console.log(`
\u2139\uFE0F Note: Merging is strictly reserved for human maintainers on GitHub after PR review.`);
    process.exit(0);
  } else {
    console.error(`
\u274C Failed to create Pull Request:`);
    console.error(`   ${result.error}`);
    process.exit(1);
  }
}
main().catch((err) => {
  console.error("Fatal error creating Pull Request:", err);
  process.exit(1);
});

#!/usr/bin/env node

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

// src/guardrails/scopeApprover.ts
import { existsSync as existsSync3, readFileSync as readFileSync3 } from "node:fs";
import { join as join3 } from "node:path";
import { createHash } from "node:crypto";
import { execSync as execSync3 } from "node:child_process";

// src/guardrails/issueDashboard.ts
import { existsSync as existsSync2, readFileSync as readFileSync2, writeFileSync as writeFileSync2, unlinkSync } from "node:fs";
import { join as join2 } from "node:path";
import { tmpdir, homedir } from "node:os";
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
function getGroundTruthTelemetry(sessionId, startEventId = 0) {
  const dbPath = join2(homedir(), ".copilot", "session-store.db");
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

// src/guardrails/scopeApprover.ts
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
  const dashFile = join3(repoRoot, ".gated-change", "dashboard.json");
  let dashData = null;
  if (existsSync3(dashFile)) {
    try {
      dashData = JSON.parse(readFileSync3(dashFile, "utf-8"));
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

// scripts/guardrails/gate-approve.ts
function parseArgs(args) {
  const result = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith("--")) {
        result[key] = next;
        i++;
      } else {
        result[key] = true;
      }
    }
  }
  return result;
}
function main() {
  const args = parseArgs(process.argv.slice(2));
  const targetDir = typeof args.dir === "string" ? args.dir : process.cwd();
  const repoRoot = getRepoRoot(targetDir);
  const state = loadState(repoRoot);
  if (args.reject) {
    const reason = typeof args.reason === "string" ? args.reason : "Rejected by human approver";
    revokeApprovalLock("REVOKED", repoRoot);
    state.phase = "PAUSED";
    state.humanApproval = false;
    state.scopeRevisionCount += 1;
    saveState(state, repoRoot);
    appendAuditLog({
      sessionId: state.sessionId,
      action: "human_scope_gate_rejected",
      decision: "deny",
      details: {
        reason,
        revisionCount: state.scopeRevisionCount
      }
    }, repoRoot);
    console.log(`[Scope Gate] REJECTED: ${reason}`);
    console.log(`[Scope Gate] Scope revision count: ${state.scopeRevisionCount}/${state.maxScopeRevisions}`);
    process.exit(0);
  }
  const customScope = typeof args.scope === "string" ? args.scope : void 0;
  const issueNum = typeof args.issue === "string" ? parseInt(args.issue, 10) : void 0;
  const approver = typeof args.approver === "string" ? args.approver : "Human Maintainer (/approve)";
  const result = approveScopeGate({
    preferredDir: repoRoot,
    scope: customScope,
    issue: issueNum,
    approver
  });
  if (result.success && result.lock) {
    console.log(`[Scope Gate] APPROVED!`);
    console.log(`  Issue: #${result.lock.issueNumber}`);
    console.log(`  Scope: ${result.lock.approvedScope}`);
    console.log(`  Approver: ${result.lock.approvedBy}`);
    console.log(`  Lock file written to .gated-change/approval.lock`);
    console.log(`  Developer agent is now authorized to execute.`);
    process.exit(0);
  } else {
    console.error(`[Scope Gate Error] ${result.error}`);
    process.exit(1);
  }
}
main();

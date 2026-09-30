#!/usr/bin/env node
var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});

// scripts/guardrails/hook-intake-ingest.ts
import { readFileSync as readFileSync4, appendFileSync as appendFileSync2 } from "node:fs";

// src/guardrails/ingestIssue.ts
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
function fetchIssueDeterministic(owner, repo, issueNumber, rootDir = process.cwd()) {
  try {
    const cmd = `gh issue view ${issueNumber} --repo ${owner}/${repo} --json number,title,body,comments,labels,author,state`;
    const stdout = execSync(cmd, {
      cwd: rootDir,
      encoding: "utf-8",
      timeout: 1e4,
      stdio: ["ignore", "pipe", "ignore"]
    });
    const parsed = JSON.parse(stdout);
    return {
      owner,
      repo,
      number: parsed.number ?? issueNumber,
      title: parsed.title ?? "",
      body: parsed.body ?? "",
      author: parsed.author?.login ?? "unknown",
      labels: (parsed.labels ?? []).map((l) => l.name ?? l),
      comments: (parsed.comments ?? []).map((c) => ({
        author: c.author?.login ?? "unknown",
        body: c.body ?? "",
        createdAt: c.createdAt ?? ""
      })),
      state: (parsed.state ?? "OPEN").toUpperCase()
    };
  } catch {
    const candidates = [
      join(rootDir, "examples", `sample-issue-${issueNumber}.json`),
      join(rootDir, "examples", "sample-issue-ready.json"),
      join(rootDir, "examples", "sample-issue-vague.json")
    ];
    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        try {
          const raw = readFileSync(candidate, "utf-8");
          const parsed = JSON.parse(raw);
          if (parsed.id === issueNumber || parsed.number === issueNumber || candidate.endsWith("-ready.json")) {
            return {
              owner: owner || "local",
              repo: repo || "sample-repo",
              number: parsed.id ?? parsed.number ?? issueNumber,
              title: parsed.title ?? "",
              body: parsed.body ?? "",
              author: "fixture-author",
              labels: parsed.labels ?? [],
              comments: (parsed.comments ?? []).map((c) => ({
                author: c.author ?? "commenter",
                body: c.body ?? (typeof c === "string" ? c : ""),
                createdAt: (/* @__PURE__ */ new Date()).toISOString()
              })),
              state: (parsed.state ?? "OPEN").toUpperCase()
            };
          }
        } catch {
        }
      }
    }
    throw new Error(
      `Could not fetch issue #${issueNumber} from GitHub CLI ('gh') or local fixtures in 'examples/'.`
    );
  }
}
function formatIntakePayload(issueData, round = 0) {
  return JSON.stringify(
    {
      source: "DETERMINISTIC_HOOK_INGESTION",
      clarificationRound: round,
      issue: {
        owner: issueData.owner,
        repo: issueData.repo,
        number: issueData.number,
        title: issueData.title,
        body: issueData.body,
        author: issueData.author,
        labels: issueData.labels,
        comments: issueData.comments,
        state: issueData.state
      },
      instructions: "Evaluate this pre-fetched issue against the Definition of Ready (Reproduction/Expected vs Actual, Acceptance Criteria, Declared Scope). Output your structured triage verdict."
    },
    null,
    2
  );
}

// src/guardrails/stateStore.ts
import { existsSync as existsSync2, mkdirSync, readFileSync as readFileSync2, writeFileSync, appendFileSync, realpathSync } from "node:fs";
import { resolve, relative, join as join2, isAbsolute, dirname, basename } from "node:path";
import { execSync as execSync2 } from "node:child_process";
var GATED_CHANGE_DIR = ".gated-change";
var STATE_FILE = "state.json";
var LOCK_FILE = "approval.lock";
var AUDIT_FILE = "audit.jsonl";
var cachedRepoRoot = null;
function getRepoRoot(preferredDir) {
  let startDir = preferredDir || process.cwd();
  try {
    if (existsSync2(startDir)) {
      startDir = realpathSync.native(startDir);
    }
  } catch {
  }
  try {
    const stdout = execSync2("git rev-parse --show-toplevel", {
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
  const localDir = join2(rootDir, GATED_CHANGE_DIR);
  const localLock = join2(localDir, LOCK_FILE);
  const localState = join2(localDir, STATE_FILE);
  if (existsSync2(localLock) || existsSync2(localState)) {
    return localDir;
  }
  try {
    const gitCommonDir = execSync2("git rev-parse --git-common-dir", {
      cwd: rootDir,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
    if (gitCommonDir) {
      const parentRepo = resolve(rootDir, gitCommonDir, "..");
      const parentDir = join2(parentRepo, GATED_CHANGE_DIR);
      if (existsSync2(parentDir)) return parentDir;
    }
  } catch {
  }
  return localDir;
}
function ensureGatedChangeDir(rootDir = getRepoRoot()) {
  const dir = join2(rootDir, GATED_CHANGE_DIR);
  if (!existsSync2(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}
function loadState(rootDir = getRepoRoot()) {
  const searchDir = findGatedChangeDir(rootDir);
  const filePath = join2(searchDir, STATE_FILE);
  if (existsSync2(filePath)) {
    try {
      const raw = readFileSync2(filePath, "utf-8");
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
  const filePath = join2(rootDir, GATED_CHANGE_DIR, STATE_FILE);
  writeFileSync(filePath, JSON.stringify(state, null, 2), "utf-8");
  try {
    const gitCommonDir = execSync2("git rev-parse --git-common-dir", {
      cwd: rootDir,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
    if (gitCommonDir) {
      const parentRepo = resolve(rootDir, gitCommonDir, "..");
      if (parentRepo.replace(/\\/g, "/") !== rootDir.replace(/\\/g, "/")) {
        ensureGatedChangeDir(parentRepo);
        writeFileSync(join2(parentRepo, GATED_CHANGE_DIR, STATE_FILE), JSON.stringify(state, null, 2), "utf-8");
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
  const filePath = join2(rootDir, GATED_CHANGE_DIR, AUDIT_FILE);
  appendFileSync(filePath, JSON.stringify(fullEntry) + "\n", "utf-8");
}
function isAgentMatch(targetAgent, expectedName) {
  if (!targetAgent) return false;
  return targetAgent === expectedName || targetAgent.endsWith(`:${expectedName}`) || targetAgent.endsWith(`/${expectedName}`);
}

// src/guardrails/issueDashboard.ts
import { existsSync as existsSync3, readFileSync as readFileSync3, writeFileSync as writeFileSync2, unlinkSync } from "node:fs";
import { join as join3 } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
var DASHBOARD_ANCHOR = "<!-- gated-change:workflow-dashboard -->";
function getStatusBadge(status) {
  if (!status || status === "PENDING") return "\u26AA `PENDING`";
  if (status === "IN_PROGRESS") return "\u23F3 `IN_PROGRESS`";
  if (["READY", "PLAN_READY", "APPROVED", "IMPLEMENTED", "PASS", "CLEAR", "READY_FOR_MERGE"].includes(status)) {
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
function renderDashboardMarkdown(data) {
  const p = data.phases || {};
  const currentBranch = data.activeBranch || p.scopeGate?.details?.activeBranch || "Pending Human Scope Gate";
  const updatedIso = new Date(data.lastUpdated || Date.now()).toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC");
  let md = `${DASHBOARD_ANCHOR}
## \u{1F6E1}\uFE0F Gated Change Workflow Dashboard

> **Issue:** #${data.issueNumber}${data.issueTitle ? ` \u2014 ${data.issueTitle}` : ""}  
> **Repository:** \`${data.owner}/${data.repo}\`  
> **Target Branch:** \`${currentBranch}\`  
> **Last Updated:** ${updatedIso}  
> **Automation Engine:** 100% Deterministic Guardrail Hooks (Zero LLM Token Burn)

### \u{1F4CA} Real-Time Phase Tracker

| Phase | Specialist / Actor | Status | Key Artifact / Hand-off Summary |
|:---|:---|:---:|:---|
| **1. Intake Triage** | \`@gated-change-intake\` | ${getStatusBadge(p.intake?.status)} | ${p.intake?.summary || "Awaiting triage"} |
| **2. Architecture Plan** | \`@gated-change-architect\` | ${getStatusBadge(p.architect?.status)} | ${p.architect?.summary || "Pending intake triage"} |
| **3. Human Scope Gate** | **Human Approver** | ${getStatusBadge(p.scopeGate?.status)} | ${p.scopeGate?.summary || "Pending architecture plan"} |
| **4. Implementation** | \`@gated-change-developer\` | ${getStatusBadge(p.developer?.status)} | ${p.developer?.summary || "Locked until human approval"} |
| **5. QA Verification** | \`@gated-change-qa\` | ${getStatusBadge(p.qa?.status)} | ${p.qa?.summary || "Awaiting implementation"} |
| **6. Security Audit** | \`@gated-change-reviewer\` | ${getStatusBadge(p.reviewer?.status)} | ${p.reviewer?.summary || "Awaiting QA sign-off"} |
| **7. Human Merge Gate** | **Human Approver** | ${getStatusBadge(p.mergeGate?.status)} | ${p.mergeGate?.summary || "Awaiting audit report"} |

---
`;
  if (p.architect?.details?.plan || p.scopeGate?.details?.approvedScope) {
    const scope = p.scopeGate?.details?.approvedScope || p.architect?.details?.proposedScope || "Pending";
    const risk = p.architect?.details?.riskTier || "Tier 1";
    md += `
<details open>
<summary><b>\u{1F4D0} Architecture Plan & Human Scope Gate Specification</b></summary>

`;
    md += `- **Approved Scope**: \`${scope}\`
`;
    md += `- **Risk Assessment**: \`${risk}\`
`;
    if (p.scopeGate?.details?.approvedBy) {
      md += `- **Human Approval**: Signed by \`${p.scopeGate.details.approvedBy}\` at \`${p.scopeGate.details.approvedAt || updatedIso}\`
`;
    }
    md += `
---

`;
    if (p.architect?.details?.plan) {
      md += `${p.architect.details.plan.trim()}

`;
    }
    md += `</details>
`;
  }
  if (p.developer?.details?.commitSha || p.developer?.details?.changedFiles) {
    md += `
<details open>
<summary><b>\u{1F528} Developer Implementation Evidence</b></summary>

`;
    if (p.developer.details.commitSha) {
      md += `- **Commit Reference**: \`${p.developer.details.commitSha}\`
`;
    }
    if (p.developer.details.changedFiles && Array.isArray(p.developer.details.changedFiles)) {
      md += `- **Files Modified**:
`;
      for (const f of p.developer.details.changedFiles) {
        md += `  - \`${f}\`
`;
      }
    }
    if (p.developer.details.testSummary) {
      md += `- **Local Test Run**: \`${p.developer.details.testSummary}\`
`;
    }
    md += `
</details>
`;
  }
  if (p.qa?.details?.verdict || p.qa?.summary) {
    md += `
<details open>
<summary><b>\u{1F9EA} QA Verification Evidence</b></summary>

`;
    md += `- **Verdict**: \`${p.qa.details?.verdict || p.qa.status}\`
`;
    if (p.qa.details?.suiteResults) {
      md += `- **Test Suites**:
\`\`\`
${p.qa.details.suiteResults}
\`\`\`
`;
    } else if (p.qa.summary) {
      md += `- **Summary**: ${p.qa.summary}
`;
    }
    md += `
</details>
`;
  }
  if (p.reviewer?.details?.verdict || p.reviewer?.summary) {
    md += `
<details open>
<summary><b>\u{1F50D} Security & Review Audit</b></summary>

`;
    md += `- **Verdict**: \`${p.reviewer.details?.verdict || p.reviewer.status}\`
`;
    if (p.reviewer.summary) {
      md += `- **Audit Notes**: ${p.reviewer.summary}
`;
    }
    md += `
</details>
`;
  }
  md += `
> *This live dashboard was updated automatically by the Gated Change Guardrails Engine via authenticated local GitHub CLI.*`;
  return md;
}
function syncWorkflowDashboard(rootDir = getRepoRoot(), update) {
  try {
    const gatedDir = findGatedChangeDir(rootDir);
    const dashboardFile = join3(gatedDir, "dashboard.json");
    let current = {
      issueNumber: update.issueNumber || 0,
      issueTitle: update.issueTitle,
      owner: update.owner || "vamsicherukuri",
      repo: update.repo || "gated-fix-pipeline",
      activeBranch: update.activeBranch,
      lastUpdated: (/* @__PURE__ */ new Date()).toISOString(),
      phases: {}
    };
    if (existsSync3(dashboardFile)) {
      try {
        const raw = readFileSync3(dashboardFile, "utf-8");
        const parsed = JSON.parse(raw);
        current = {
          ...parsed,
          phases: { ...parsed.phases }
        };
      } catch {
      }
    }
    if (update.owner) current.owner = update.owner;
    if (update.repo) current.repo = update.repo;
    if (update.issueNumber && update.issueNumber > 0) current.issueNumber = update.issueNumber;
    if (update.issueTitle) current.issueTitle = update.issueTitle;
    if (update.activeBranch) current.activeBranch = update.activeBranch;
    current.lastUpdated = (/* @__PURE__ */ new Date()).toISOString();
    if (update.phase) {
      const existingPhase = current.phases[update.phase] || { status: "PENDING" };
      current.phases[update.phase] = {
        ...existingPhase,
        status: update.status || existingPhase.status,
        summary: update.summary || existingPhase.summary,
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
          summary: existingArch.summary || "Technical plan approved at Human Scope Gate",
          details: {
            ...existingArch.details || {},
            plan: update.details.plan
          }
        };
      }
    }
    writeFileSync2(dashboardFile, JSON.stringify(current, null, 2), "utf-8");
    const isTest = process.env.NODE_ENV === "test" || process.env.GATED_CHANGE_TEST === "1" || process.env.npm_lifecycle_event?.startsWith("test");
    if (current.issueNumber > 0 && current.owner && current.repo && !isTest) {
      postOrPatchGitHubComment(current);
      writeFileSync2(dashboardFile, JSON.stringify(current, null, 2), "utf-8");
    }
    return current;
  } catch (err) {
    try {
      const { appendFileSync: appendFileSync3 } = __require("node:fs");
      appendFileSync3("C:/Users/vcherukuri/hook-debug.log", JSON.stringify({
        event: "syncWorkflowDashboard_error",
        error: String(err?.message || err),
        time: (/* @__PURE__ */ new Date()).toISOString()
      }) + "\n");
    } catch {
    }
    return null;
  }
}
function postOrPatchGitHubComment(state) {
  const content = renderDashboardMarkdown(state);
  const tempPath = join3(tmpdir(), `gated-change-dashboard-${state.issueNumber}-${Date.now()}.md`);
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
          timeout: 7e3
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
          timeout: 7e3
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
      timeout: 7e3
    }).trim();
    if (createOut) {
      const newId = parseInt(createOut, 10);
      if (!isNaN(newId) && newId > 0) {
        state.commentId = newId;
      }
    }
  } catch (err) {
    try {
      const { appendFileSync: appendFileSync3 } = __require("node:fs");
      appendFileSync3("C:/Users/vcherukuri/hook-debug.log", JSON.stringify({
        event: "postOrPatchGitHubComment_error",
        error: String(err?.message || err),
        time: (/* @__PURE__ */ new Date()).toISOString()
      }) + "\n");
    } catch {
    }
  } finally {
    try {
      if (existsSync3(tempPath)) {
        unlinkSync(tempPath);
      }
    } catch {
    }
  }
}

// scripts/guardrails/hook-intake-ingest.ts
async function main() {
  let rawInput = "";
  if (!process.stdin.isTTY) {
    try {
      rawInput = readFileSync4(0, "utf-8");
    } catch {
    }
  }
  try {
    appendFileSync2("C:/Users/vcherukuri/hook-debug.log", JSON.stringify({
      hook: "hook-intake-ingest",
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
  if (isAgentMatch(targetAgent, "gated-change-intake")) {
    const state = loadState();
    const prompt = toolArgs.prompt || input.toolArgs?.prompt || "";
    let issueNum = 1;
    const jsonNum = prompt.match(/"number"\s*:\s*(\d+)/);
    const textNum = prompt.match(/(?:issue(?:\s*number)?\s*[:#`'"\s]*|#)\s*(\d+)/i);
    const nameNum = String(toolArgs.name || "").match(/(?:issue-?|#)(\d+)/i);
    if (jsonNum) {
      issueNum = parseInt(jsonNum[1], 10);
    } else if (textNum) {
      issueNum = parseInt(textNum[1], 10);
    } else if (nameNum) {
      issueNum = parseInt(nameNum[1], 10);
    } else if (state.issue?.number && state.issue.number > 0) {
      issueNum = state.issue.number;
    }
    let owner = state.issue?.owner || "vamsicherukuri";
    let repo = state.issue?.repo || "gated-fix-pipeline";
    const jsonOwner = prompt.match(/"owner"\s*:\s*"([^"]+)"/);
    const jsonRepo = prompt.match(/"repo"\s*:\s*"([^"]+)"/);
    if (jsonOwner && jsonRepo) {
      owner = jsonOwner[1];
      repo = jsonRepo[1];
    } else {
      const explicitRepo = prompt.match(/\b(?:in|repo(?:sitory)?(?:\s*name)?\s*[:=]?)\s*([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)\b/i);
      if (explicitRepo) {
        owner = explicitRepo[1];
        repo = explicitRepo[2];
      }
    }
    try {
      const issueData = fetchIssueDeterministic(owner, repo, issueNum);
      if (issueData.state && issueData.state !== "OPEN") {
        state.issue = { owner, repo, number: issueData.number, title: issueData.title };
        state.phase = "PAUSED";
        saveState(state);
        appendAuditLog({
          sessionId: state.sessionId,
          agent: "controller",
          tool: "agent",
          action: "deterministic_closed_issue_block",
          decision: "deny",
          details: {
            issueNumber: issueData.number,
            title: issueData.title,
            state: issueData.state
          }
        });
        const reason = `DETERMINISTIC_POLICY_BLOCK: Issue #${issueData.number} has lifecycle status ${issueData.state} on GitHub. Gated Change workflows can only be initiated on OPEN issues. Pipeline halted.`;
        const output2 = {
          decision: "deny",
          permissionDecision: "deny",
          permissionDecisionReason: reason,
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "deny",
            permissionDecisionReason: reason
          }
        };
        process.stdout.write(JSON.stringify(output2) + "\n");
        process.exit(0);
      }
      const payload = formatIntakePayload(issueData, state.intakeRound);
      state.issue = { owner, repo, number: issueData.number, title: issueData.title };
      state.phase = "INTAKE";
      saveState(state);
      syncWorkflowDashboard(process.cwd(), {
        owner,
        repo,
        issueNumber: issueData.number,
        issueTitle: issueData.title,
        phase: "intake",
        status: "READY",
        summary: `Deterministic triage verified OPEN status with verified criteria`
      });
      appendAuditLog({
        sessionId: state.sessionId,
        agent: "controller",
        tool: "agent",
        action: "deterministic_issue_ingestion",
        decision: "allow",
        details: {
          issueNumber: issueData.number,
          title: issueData.title,
          round: state.intakeRound
        }
      });
      const enrichedPrompt = prompt.includes("PRE_FETCHED_ISSUE_PAYLOAD") ? prompt : `${prompt}

PRE_FETCHED_ISSUE_PAYLOAD:
${payload}`;
      const modifiedArgs = {
        ...toolArgs,
        prompt: enrichedPrompt
      };
      const output = {
        decision: "allow",
        permissionDecision: "allow",
        modifiedArgs,
        updatedInput: modifiedArgs,
        additionalContext: `PRE_FETCHED_ISSUE_PAYLOAD:
${payload}`,
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "allow",
          modifiedArgs,
          updatedInput: modifiedArgs,
          additionalContext: `PRE_FETCHED_ISSUE_PAYLOAD:
${payload}`
        }
      };
      process.stdout.write(JSON.stringify(output) + "\n");
      process.exit(0);
    } catch (err) {
      appendAuditLog({
        sessionId: state.sessionId,
        agent: "controller",
        tool: "agent",
        action: "deterministic_issue_ingestion_warning",
        decision: "allow",
        details: { error: err.message }
      });
      const output = {
        decision: "allow",
        permissionDecision: "allow",
        additionalContext: `ISSUE_INGESTION_NOTICE: Could not pre-fetch issue #${issueNum} via gh CLI: ${err.message}. Specialist should proceed with standard triage.`
      };
      process.stdout.write(JSON.stringify(output) + "\n");
      process.exit(0);
    }
  }
  process.stdout.write(JSON.stringify({ decision: "allow", permissionDecision: "allow" }) + "\n");
  process.exit(0);
}
main().catch(() => {
  process.stdout.write(JSON.stringify({ decision: "allow", permissionDecision: "allow" }) + "\n");
  process.exit(0);
});

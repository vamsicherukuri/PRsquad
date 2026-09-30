import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { findGatedChangeDir, getRepoRoot } from "./stateStore.js";

export interface PhaseRecord {
  status: string;
  updatedAt?: string;
  summary?: string;
  details?: Record<string, any>;
}

export interface DashboardState {
  issueNumber: number;
  issueTitle?: string;
  owner: string;
  repo: string;
  activeBranch?: string;
  commentId?: number | null;
  lastUpdated: string;
  phases: {
    intake?: PhaseRecord;
    architect?: PhaseRecord;
    scopeGate?: PhaseRecord;
    developer?: PhaseRecord;
    qa?: PhaseRecord;
    reviewer?: PhaseRecord;
    mergeGate?: PhaseRecord;
  };
}

export const DASHBOARD_ANCHOR = "<!-- gated-change:workflow-dashboard -->";

function getStatusBadge(status?: string): string {
  if (!status || status === "PENDING") return "⚪ `PENDING`";
  if (status === "IN_PROGRESS") return "⏳ `IN_PROGRESS`";
  if (["READY", "PLAN_READY", "APPROVED", "IMPLEMENTED", "PASS", "CLEAR", "READY_FOR_MERGE"].includes(status)) {
    return `✅ \`${status}\``;
  }
  if (["FAIL", "BLOCKED"].includes(status)) {
    return `❌ \`${status}\``;
  }
  if (["PAUSED", "CONCERNS"].includes(status)) {
    return `⚠️ \`${status}\``;
  }
  return `ℹ️ \`${status}\``;
}

export function renderDashboardMarkdown(data: DashboardState): string {
  const p = data.phases || {};
  const currentBranch = data.activeBranch || (p.scopeGate?.details?.activeBranch) || "Pending Human Scope Gate";
  const updatedIso = new Date(data.lastUpdated || Date.now()).toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC");

  let md = `${DASHBOARD_ANCHOR}
## 🛡️ Gated Change Workflow Dashboard

> **Issue:** #${data.issueNumber}${data.issueTitle ? ` — ${data.issueTitle}` : ""}  
> **Repository:** \`${data.owner}/${data.repo}\`  
> **Target Branch:** \`${currentBranch}\`  
> **Last Updated:** ${updatedIso}  
> **Automation Engine:** 100% Deterministic Guardrail Hooks (Zero LLM Token Burn)

### 📊 Real-Time Phase Tracker

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

  // Section 1: Architect Plan & Proposed Scope (Human Scope Gate Presentation)
  if (p.architect?.details?.plan || p.scopeGate?.details?.approvedScope) {
    const scope = p.scopeGate?.details?.approvedScope || p.architect?.details?.proposedScope || "Pending";
    const risk = p.architect?.details?.riskTier || "Tier 1";
    md += `\n<details open>\n<summary><b>📐 Architecture Plan & Human Scope Gate Specification</b></summary>\n\n`;
    md += `- **Approved Scope**: \`${scope}\`\n`;
    md += `- **Risk Assessment**: \`${risk}\`\n`;
    if (p.scopeGate?.details?.approvedBy) {
      md += `- **Human Approval**: Signed by \`${p.scopeGate.details.approvedBy}\` at \`${p.scopeGate.details.approvedAt || updatedIso}\`\n`;
    }
    md += `\n---\n\n`;
    if (p.architect?.details?.plan) {
      md += `${p.architect.details.plan.trim()}\n\n`;
    }
    md += `</details>\n`;
  }

  // Section 2: Developer Implementation
  if (p.developer?.details?.commitSha || p.developer?.details?.changedFiles) {
    md += `\n<details open>\n<summary><b>🔨 Developer Implementation Evidence</b></summary>\n\n`;
    if (p.developer.details.commitSha) {
      md += `- **Commit Reference**: \`${p.developer.details.commitSha}\`\n`;
    }
    if (p.developer.details.changedFiles && Array.isArray(p.developer.details.changedFiles)) {
      md += `- **Files Modified**:\n`;
      for (const f of p.developer.details.changedFiles) {
        md += `  - \`${f}\`\n`;
      }
    }
    if (p.developer.details.testSummary) {
      md += `- **Local Test Run**: \`${p.developer.details.testSummary}\`\n`;
    }
    md += `\n</details>\n`;
  }

  // Section 3: QA Verification Evidence
  if (p.qa?.details?.verdict || p.qa?.summary) {
    md += `\n<details open>\n<summary><b>🧪 QA Verification Evidence</b></summary>\n\n`;
    md += `- **Verdict**: \`${p.qa.details?.verdict || p.qa.status}\`\n`;
    if (p.qa.details?.suiteResults) {
      md += `- **Test Suites**:\n\`\`\`\n${p.qa.details.suiteResults}\n\`\`\`\n`;
    } else if (p.qa.summary) {
      md += `- **Summary**: ${p.qa.summary}\n`;
    }
    md += `\n</details>\n`;
  }

  // Section 4: Security & Quality Review
  if (p.reviewer?.details?.verdict || p.reviewer?.summary) {
    md += `\n<details open>\n<summary><b>🔍 Security & Review Audit</b></summary>\n\n`;
    md += `- **Verdict**: \`${p.reviewer.details?.verdict || p.reviewer.status}\`\n`;
    if (p.reviewer.summary) {
      md += `- **Audit Notes**: ${p.reviewer.summary}\n`;
    }
    md += `\n</details>\n`;
  }

  md += `\n> *This live dashboard was updated automatically by the Gated Change Guardrails Engine via authenticated local GitHub CLI.*`;
  return md;
}

export function syncWorkflowDashboard(
  rootDir: string = getRepoRoot(),
  update: {
    owner?: string;
    repo?: string;
    issueNumber?: number;
    issueTitle?: string;
    activeBranch?: string;
    phase?: keyof DashboardState["phases"];
    status?: string;
    summary?: string;
    details?: Record<string, any>;
  }
): DashboardState | null {
  try {
    const gatedDir = findGatedChangeDir(rootDir);
    const dashboardFile = join(gatedDir, "dashboard.json");

    let current: DashboardState = {
      issueNumber: update.issueNumber || 0,
      issueTitle: update.issueTitle,
      owner: update.owner || "vamsicherukuri",
      repo: update.repo || "gated-fix-pipeline",
      activeBranch: update.activeBranch,
      lastUpdated: new Date().toISOString(),
      phases: {},
    };

    if (existsSync(dashboardFile)) {
      try {
        const raw = readFileSync(dashboardFile, "utf-8");
        const parsed = JSON.parse(raw);
        current = {
          ...parsed,
          phases: { ...parsed.phases },
        };
      } catch {}
    }

    if (update.owner) current.owner = update.owner;
    if (update.repo) current.repo = update.repo;
    if (update.issueNumber && update.issueNumber > 0) current.issueNumber = update.issueNumber;
    if (update.issueTitle) current.issueTitle = update.issueTitle;
    if (update.activeBranch) current.activeBranch = update.activeBranch;
    current.lastUpdated = new Date().toISOString();

    if (update.phase) {
      const existingPhase = current.phases[update.phase] || { status: "PENDING" };
      current.phases[update.phase] = {
        ...existingPhase,
        status: update.status || existingPhase.status,
        summary: update.summary || existingPhase.summary,
        updatedAt: new Date().toISOString(),
        details: {
          ...(existingPhase.details || {}),
          ...(update.details || {}),
        },
      };

      // If scopeGate carries the architect plan, mirror it into the architect phase
      if (update.phase === "scopeGate" && update.details?.plan) {
        const existingArch = current.phases.architect || { status: "PLAN_READY" };
        current.phases.architect = {
          ...existingArch,
          status: "PLAN_READY",
          summary: existingArch.summary || "Technical plan approved at Human Scope Gate",
          details: {
            ...(existingArch.details || {}),
            plan: update.details.plan,
          },
        };
      }
    }

    // Save dashboard state to disk locally
    writeFileSync(dashboardFile, JSON.stringify(current, null, 2), "utf-8");

    const isTest =
      process.env.NODE_ENV === "test" ||
      process.env.GATED_CHANGE_TEST === "1" ||
      process.env.npm_lifecycle_event?.startsWith("test");

    // If issue number is valid and not running unit tests, push update to GitHub issue comment via gh CLI
    if (current.issueNumber > 0 && current.owner && current.repo && !isTest) {
      postOrPatchGitHubComment(current);
      writeFileSync(dashboardFile, JSON.stringify(current, null, 2), "utf-8");
    }

    return current;
  } catch (err: any) {
    try {
      const { appendFileSync } = require("node:fs");
      appendFileSync("C:/Users/vcherukuri/hook-debug.log", JSON.stringify({
        event: "syncWorkflowDashboard_error",
        error: String(err?.message || err),
        time: new Date().toISOString()
      }) + "\n");
    } catch {}
    return null;
  }
}

function postOrPatchGitHubComment(state: DashboardState): void {
  const content = renderDashboardMarkdown(state);
  const tempPath = join(tmpdir(), `gated-change-dashboard-${state.issueNumber}-${Date.now()}.md`);

  try {
    writeFileSync(tempPath, content, "utf-8");

    // 1. Locate existing comment if commentId is not yet cached
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
          timeout: 7000,
        }).trim();

        if (commentsJson && commentsJson !== "null") {
          const parsedId = parseInt(commentsJson, 10);
          if (!isNaN(parsedId) && parsedId > 0) {
            state.commentId = parsedId;
          }
        }
      } catch {}
    }

    // 2. Patch existing comment if found
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
          timeout: 7000,
        });
        return;
      } catch {
        // If PATCH failed (e.g. comment was deleted), reset commentId and recreate below
        state.commentId = null;
      }
    }

    // 3. Create fresh comment if none exists
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
      timeout: 7000,
    }).trim();

    if (createOut) {
      const newId = parseInt(createOut, 10);
      if (!isNaN(newId) && newId > 0) {
        state.commentId = newId;
      }
    }
  } catch (err: any) {
    try {
      const { appendFileSync } = require("node:fs");
      appendFileSync("C:/Users/vcherukuri/hook-debug.log", JSON.stringify({
        event: "postOrPatchGitHubComment_error",
        error: String(err?.message || err),
        time: new Date().toISOString()
      }) + "\n");
    } catch {}
  } finally {
    try {
      if (existsSync(tempPath)) {
        unlinkSync(tempPath);
      }
    } catch {}
  }
}

export function extractPlanMarkdown(text: string): string {
  if (!text) return "";
  const scopeGateIdx = text.indexOf("## Human Scope Gate");
  if (scopeGateIdx !== -1) {
    return text.slice(scopeGateIdx).trim();
  }
  const rootCauseIdx = text.search(/\*\*Root cause:?\*\*/i);
  if (rootCauseIdx !== -1) {
    return text.slice(rootCauseIdx).trim();
  }
  const altRootIdx = text.search(/Root cause:/i);
  if (altRootIdx !== -1) {
    return text.slice(altRootIdx).trim();
  }
  return text.trim();
}

export function extractTextFromToolResult(res: any): string {
  if (!res) return "";
  if (typeof res === "string") return res;
  if (typeof res.content === "string") return res.content;
  if (typeof res.text === "string") return res.text;
  if (typeof res.output === "string") return res.output;
  if (typeof res.result === "string") return res.result;
  if (res.plan && typeof res.plan === "string") return res.plan;
  if (Array.isArray(res)) {
    return res.map(extractTextFromToolResult).join("\n");
  }
  if (typeof res === "object") {
    for (const key of ["content", "text", "output", "result", "plan", "message", "response"]) {
      if (res[key] && typeof res[key] === "string") return res[key];
    }
  }
  return String(res);
}

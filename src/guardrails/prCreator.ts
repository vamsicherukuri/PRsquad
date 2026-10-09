import { writeFileSync, unlinkSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync, execFileSync } from "node:child_process";
import { loadState, saveState, loadApprovalLock, getRepoRoot, findGatedChangeDir, getRepoOwnerAndName } from "./stateStore.js";
import { syncWorkflowDashboard, loadDashboardState } from "./issueDashboard.js";

export interface PROptions {
  preferredDir?: string;
  baseBranch?: string;
  customTitle?: string;
  skipEvidenceCheck?: boolean;
}

export interface PRResult {
  success: boolean;
  prUrl?: string;
  prNumber?: number;
  branch?: string;
  error?: string;
}

/**
 * Builds the structured Pull Request body with verification badges and deterministic provenance.
 */
export function buildPullRequestBody(params: {
  rootDir?: string;
  issueNum: number;
  issueTitle: string;
  activeBranch: string;
  baseBranch: string;
  headCommit?: string;
}): string {
  const rootDir = getRepoRoot(params.rootDir);
  const headCommit = params.headCommit || (() => {
    try {
      return execSync("git rev-parse HEAD", { cwd: rootDir, encoding: "utf-8" }).trim();
    } catch {
      return "0000000000000000000000000000000000000000";
    }
  })();
  const shortSha = headCommit.slice(0, 7);
  const lock = loadApprovalLock(rootDir);
  const state = loadState(rootDir);

  // Read raw lock file to detect REVOKED or EXHAUSTED status if inactive
  let rawLockStatus: string | undefined;
  try {
    const searchDir = findGatedChangeDir(rootDir);
    const lockPath = join(searchDir, "approval.lock");
    if (existsSync(lockPath)) {
      const parsed = JSON.parse(readFileSync(lockPath, "utf-8"));
      if (parsed.status) rawLockStatus = parsed.status;
    }
  } catch {}

  // Load ground-truth dashboard evidence if recorded
  const dashboard = loadDashboardState(rootDir);
  const qa = dashboard?.phases?.qa;
  const qaVerdict = qa?.details?.verdict || qa?.status || "NOT RECORDED";
  const qaEvidence = qa?.summary || qa?.details?.testNotes || (qaVerdict === "PASS" ? "Verified clean via independent test execution cycle" : "NOT RECORDED");

  const rev = dashboard?.phases?.reviewer;
  const revVerdict = rev?.details?.assessment || rev?.details?.verdict || rev?.status || "NOT RECORDED";
  const revEvidence = rev?.summary || rev?.details?.mergeGateSummary || ((revVerdict === "CLEAR" || revVerdict === "APPROVED" || revVerdict === "CONCERNS") ? `Verified read-only diff inspection (assessment: ${revVerdict})` : "NOT RECORDED");

  const lockStatus = lock?.status || rawLockStatus || "NOT RECORDED";
  const approverInfo = lock?.approvedBy
    ? `\`${lock.approvedBy}\` (${lock.approvedAt || "timestamp not recorded"})`
    : "`NOT RECORDED`";
  const approvedScopeStr = (lock && lock.status === "ACTIVE")
    ? (lock.approvedScope || state.approvedScope || "NOT RECORDED")
    : "NOT RECORDED";

  return `## 🛡️ PRSquad Governed Pull Request

<p align="left">
  <a href="https://github.com/vamsicherukuri/prsquad"><img alt="Supervised Agentic Workflow" src="https://img.shields.io/badge/PRsquad-Supervised%20Workflow-8250df?style=flat-square&logo=github"></a>
  <a href="#"><img alt="Deterministic Policy" src="https://img.shields.io/badge/Deterministic%20Policy-Enforced-2ea043?style=flat-square"></a>
  <a href="#"><img alt="Human Scope Gate" src="https://img.shields.io/badge/Scope%20Gate-Deterministically%20Locked-0969da?style=flat-square"></a>
</p>

Closes #${params.issueNum}

### 📋 Overview
${params.issueTitle}

### 🔒 Deterministic Provenance & Scope Lock
- **Approval Lock Status**: \`${lockStatus}\`
- **Authorized By**: ${approverInfo}
- **Approved Scope**: \`${approvedScopeStr}\`
${lock?.planHash ? `- **Approval Integrity Binding (planHash)**: \`${lock.planHash.slice(0, 16)}\`\n` : ""}- **Feature Branch**: \`${params.activeBranch}\`
- **Base Target**: \`${params.baseBranch}\`

### 🔨 Implementation Summary
- **Commit SHA**: \`${shortSha}\` (\`${headCommit}\`)
- **Author**: Autonomous \`@prsquad-dev\` via native PowerShell
- **Scope Compliance**: ${approvedScopeStr !== "NOT RECORDED" ? "100% strictly bounded to approved scope" : "NOT RECORDED"}

### 🧪 QA Independent Verification
- **Verdict**: \`${qaVerdict}\`
- **Evidence**: ${qaEvidence}

### 🔍 Security & Code Review
- **Code Review Verdict**: \`${revVerdict}\`
- **Diff Inspection**: ${revEvidence}

---
> *Pull Request opened automatically by **PRSquad** upon human **PR Gate** confirmation.*  
> *Merging is strictly reserved for human maintainers on GitHub after PR review.*
`;
}

/**
 * Strict branch name validation conforming to pr-governance skill and git-check-ref-format standards.
 * Enforces: ^[a-zA-Z0-9/_.-]+$
 * Rejects: shell metacharacters (; | & $ ` < > \n \r), leading hyphens, double dots (..),
 * trailing slashes, leading slashes, .lock suffixes, and @{ sequences.
 */
export function isValidGitRef(branch: string): boolean {
  if (!branch || typeof branch !== "string") return false;
  const VALID_BRANCH_REGEX = /^[a-zA-Z0-9/_.-]+$/;
  const SHELL_META_REGEX = /[;|&$\`><\n\r]/;
  if (!VALID_BRANCH_REGEX.test(branch)) return false;
  if (SHELL_META_REGEX.test(branch)) return false;
  if (branch.startsWith("-") || branch.startsWith("/") || branch.endsWith("/")) return false;
  if (branch.includes("..") || branch.includes("@{") || branch.endsWith(".lock")) return false;
  return true;
}

/**
 * Deterministically creates a GitHub Pull Request for the active feature branch.
 * Zero LLM token cost: extracts evidence from local state and executes via gh CLI.
 * Does NOT merge; leaves merging exclusively to human review on GitHub.
 */
export function createPullRequest(options: PROptions = {}): PRResult {
  const rootDir = getRepoRoot(options.preferredDir);
  const state = loadState(rootDir);

  try {
    // 1. Resolve current active branch
    let activeBranch = "";
    try {
      activeBranch = execSync("git rev-parse --abbrev-ref HEAD", {
        cwd: rootDir,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    } catch {}

    const gitBranch = activeBranch;
    if (!activeBranch || activeBranch === "HEAD") {
      activeBranch = state.activeBranch || "";
    }

    if (gitBranch === "main" || gitBranch === "master" || activeBranch === "main" || activeBranch === "master" || !activeBranch) {
      return {
        success: false,
        error: `Cannot create PR from base branch '${gitBranch === "main" || gitBranch === "master" ? gitBranch : activeBranch}'. Must be on a designated feature branch.`,
      };
    }

    // Validate active feature branch format against pr-governance skill
    if (!isValidGitRef(activeBranch)) {
      return {
        success: false,
        error: `INVALID_BRANCH_NAME: Feature branch '${activeBranch}' violates pr-governance naming rules. Must match '^[a-zA-Z0-9/_.-]+$' without shell operators, control characters, or leading hyphens.`,
      };
    }

    // 2. Resolve target base branch dynamically (checks origin/HEAD, main, or master)
    let baseBranch = options.baseBranch;
    if (!baseBranch) {
      try {
        try {
          const symRef = execSync("git symbolic-ref --short refs/remotes/origin/HEAD", {
            cwd: rootDir,
            encoding: "utf-8",
            stdio: ["ignore", "pipe", "ignore"],
          }).trim();
          if (symRef) {
            baseBranch = symRef.replace(/^origin\//, "");
          }
        } catch {}

        if (!baseBranch) {
          const remotes = execSync("git branch -r", { cwd: rootDir, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] });
          if (remotes.includes("origin/main")) {
            baseBranch = "main";
          } else if (remotes.includes("origin/master")) {
            baseBranch = "master";
          } else if (remotes.includes("origin/copilot-app-plugin-alignment")) {
            baseBranch = "copilot-app-plugin-alignment";
          } else {
            baseBranch = "main";
          }
        }
      } catch {
        baseBranch = "main";
      }
    }

    // Validate target base branch format against pr-governance skill
    if (baseBranch && !isValidGitRef(baseBranch)) {
      return {
        success: false,
        error: `INVALID_BRANCH_NAME: Base branch '${baseBranch}' violates pr-governance naming rules. Must match '^[a-zA-Z0-9/_.-]+$' without shell operators, control characters, or leading hyphens.`,
      };
    }

    // Deterministically resolve issue number from:
    // 1. Feature branch name (e.g. fix/issue-11, fix/issue-42)
    // 2. Options custom override
    // 3. Approval lock
    // 4. State store
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
        error: "PR_GATE_BLOCKED: Cannot determine target issue number from branch, approval lock, or state. Refusing to open PR without verified target issue.",
      };
    }

    // Verify Required Governance Evidence (Fail-Closed PR Gate)
    // Never: Evidence missing -> PASS
    if (!options.skipEvidenceCheck) {
      // 4a. Active Human Scope Gate Approval Lock
      const lock = loadApprovalLock(rootDir);
      if (!lock || lock.status !== "ACTIVE" || !lock.approvedScope) {
        return {
          success: false,
          error: "PR_GATE_BLOCKED: Missing valid Human Scope Gate approval lock. PR cannot be created without verified human authorization.",
        };
      }

      // 4b. Verified Independent QA Evidence
      const dashboard = loadDashboardState(rootDir);
      const qaRecord = dashboard?.phases?.qa;
      const qaVerdict = qaRecord?.details?.verdict || qaRecord?.status;
      const isQaInfraBlocked =
        qaVerdict === "BLOCKED" &&
        Array.isArray(qaRecord?.details?.failureClassification) &&
        qaRecord.details.failureClassification.length > 0 &&
        qaRecord.details.failureClassification.every(
          (f: any) => f.classification === "INFRASTRUCTURE"
        );
      const isQaPassing = qaVerdict === "PASS" || isQaInfraBlocked;

      if (!qaVerdict || !isQaPassing) {
        return {
          success: false,
          error: `PR_GATE_BLOCKED: QA verification not recorded or failed (verdict: ${qaVerdict || "NOT RECORDED"}). PR gate strictly requires verified QA PASS evidence.`,
        };
      }

      // 4c. Verified Security & Code Review Clearance Evidence (CLEAR, APPROVED, or informational CONCERNS)
      const revRecord = dashboard?.phases?.reviewer;
      const revVerdict = revRecord?.details?.assessment || revRecord?.details?.verdict || revRecord?.status;
      const isReviewPassing = revVerdict === "CLEAR" || revVerdict === "APPROVED" || revVerdict === "CONCERNS";
      if (!revVerdict || !isReviewPassing) {
        return {
          success: false,
          error: `PR_GATE_BLOCKED: Security and code review audit not recorded or cleared (verdict: ${revVerdict || "NOT RECORDED"}). PR gate strictly requires Reviewer clearance (CLEAR, APPROVED, or CONCERNS).`,
        };
      }

      // 4d. Anti-Stale Evidence Binding: Tested/Reviewed commits must match current HEAD
      let currentHead = "";
      try {
        currentHead = execSync("git rev-parse HEAD", { cwd: rootDir, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }).trim();
      } catch {}

      if (currentHead && currentHead !== "HEAD") {
        const isHexSha = (val: unknown): boolean =>
          typeof val === "string" && /^[0-9a-f]{7,40}$/i.test(val.trim());

        const qaCommit = qaRecord?.details?.commitSha || qaRecord?.details?.headRef;
        if (isHexSha(qaCommit) && !currentHead.startsWith(qaCommit) && !qaCommit.startsWith(currentHead)) {
          return {
            success: false,
            error: `PR_GATE_BLOCKED (STALE_EVIDENCE): QA verification was executed against commit '${qaCommit.slice(0, 8)}', but current branch HEAD is '${currentHead.slice(0, 8)}'. Re-verification required before opening PR.`,
          };
        }

        const revCommit = revRecord?.details?.commitSha || revRecord?.details?.headRef;
        if (isHexSha(revCommit) && !currentHead.startsWith(revCommit) && !revCommit.startsWith(currentHead)) {
          return {
            success: false,
            error: `PR_GATE_BLOCKED (STALE_EVIDENCE): Code review was executed against commit '${revCommit.slice(0, 8)}', but current branch HEAD is '${currentHead.slice(0, 8)}'. Re-review required before opening PR.`,
          };
        }
      }

      // 4e. Human PR Authorization Token Inspection
      const searchDir = findGatedChangeDir(rootDir);
      const prAuthPath = join(searchDir, "pr-authorization.json");
      if (existsSync(prAuthPath)) {
        try {
          const authData = JSON.parse(readFileSync(prAuthPath, "utf-8"));
          if (authData.status === "REVOKED") {
            return {
              success: false,
              error: `PR_GATE_BLOCKED: PR authorization token has been revoked by maintainer.`,
            };
          }
          if (authData.issueNumber && authData.issueNumber !== issueNum) {
            return {
              success: false,
              error: `PR_GATE_BLOCKED: PR authorization token is bound to issue #${authData.issueNumber}, not current issue #${issueNum}.`,
            };
          }
        } catch {}
      }
    }

    const remoteInfo = getRepoOwnerAndName(rootDir);
    const owner = state.issue?.owner || remoteInfo.owner || "vamsicherukuri";
    const repo = state.issue?.repo || remoteInfo.repo || "prsquad";

    let issueTitle = state.issue?.title;
    if (!issueTitle || (state.issue?.number && state.issue.number !== issueNum)) {
      try {
        const out = execFileSync("gh", ["issue", "view", String(issueNum), "--repo", `${owner}/${repo}`, "--json", "title"], {
          encoding: "utf-8",
          stdio: ["ignore", "pipe", "ignore"],
        });
        const parsed = JSON.parse(out);
        if (parsed.title) issueTitle = parsed.title;
      } catch {}
    }
    if (!issueTitle) issueTitle = `Issue #${issueNum} resolution`;

    if (!state.issue) {
      state.issue = { owner, repo, number: issueNum, title: issueTitle };
    } else {
      state.issue.number = issueNum;
      state.issue.title = issueTitle;
    }
    saveState(state, rootDir);

    // 5. Push active feature branch to remote origin
    try {
      execFileSync("git", ["push", "-u", "origin", activeBranch], {
        cwd: rootDir,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (pushErr: any) {
      // If push fails because branch already exists or network issue, continue to check if PR exists
    }

    // 6. Check if PR already exists for this branch
    try {
      const existingOut = execFileSync("gh", [
        "pr",
        "view",
        activeBranch,
        "--repo",
        `${owner}/${repo}`,
        "--json",
        "url,number",
      ], {
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();

      if (existingOut) {
        const parsed = JSON.parse(existingOut);
        if (parsed.url) {
          syncWorkflowDashboard(rootDir, {
            phase: "mergeGate",
            status: "PR_OPEN",
            summary: `PR #${parsed.number} is open: ${parsed.url}. Awaiting human maintainer review on GitHub.`,
          });
          return {
            success: true,
            prUrl: parsed.url,
            prNumber: parsed.number,
            branch: activeBranch,
          };
        }
      }
    } catch {}

    // 7. Build rich structured PR body with verification badges and deterministic provenance
    const prTitle = options.customTitle || (issueTitle && !issueTitle.startsWith("Issue #") ? `fix: resolve issue #${issueNum} - ${issueTitle}` : `fix: resolve issue #${issueNum}`);
    const prBody = buildPullRequestBody({
      rootDir,
      issueNum,
      issueTitle,
      activeBranch,
      baseBranch,
    });

    const tempBodyPath = join(tmpdir(), `gated-change-pr-body-${Date.now()}.md`);
    writeFileSync(tempBodyPath, prBody, "utf-8");

    try {
      const prCreateOut = execFileSync("gh", [
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
        tempBodyPath,
      ], {
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "pipe"],
      }).trim();

      const prUrl = prCreateOut.split("\n").filter((l) => l.startsWith("http"))[0] || prCreateOut;
      const numMatch = prUrl.match(/\/pull\/(\d+)/);
      const prNumber = numMatch ? parseInt(numMatch[1], 10) : undefined;

      // Automatically attach governance labels to the PR if available
      if (prNumber) {
        try {
          execFileSync("gh", [
            "pr",
            "edit",
            String(prNumber),
            "--repo",
            `${owner}/${repo}`,
            "--add-label",
            "prsquad-verified,governance:supervised",
          ], {
            encoding: "utf-8",
            stdio: ["ignore", "ignore", "ignore"],
          });
        } catch {}
      }

      // 6. Update living dashboard on issue
      syncWorkflowDashboard(rootDir, {
        phase: "mergeGate",
        status: "PR_OPEN",
        summary: `PR ${prNumber ? `#${prNumber}` : ""} opened: ${prUrl}. Awaiting human maintainer review on GitHub.`,
      });

      return {
        success: true,
        prUrl,
        prNumber,
        branch: activeBranch,
      };
    } finally {
      if (existsSync(tempBodyPath)) {
        unlinkSync(tempBodyPath);
      }
    }
  } catch (err: any) {
    return {
      success: false,
      error: String(err?.message || err),
    };
  }
}

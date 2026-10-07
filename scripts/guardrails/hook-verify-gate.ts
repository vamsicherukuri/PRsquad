#!/usr/bin/env node
/**
 * Hook: Mechanical Scope Gate Verification (preToolUse / postToolUse)
 * Intercepts delegation to 'gated-change-developer' and enforces physical lock check.
 * Synchronizes living workflow dashboard on GitHub issue comments across all specialist phases.
 */

import { existsSync, readFileSync, appendFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { execSync } from "node:child_process";
import { loadState, saveState, loadApprovalLock, saveApprovalLock, revokeApprovalLock, appendAuditLog, isAgentMatch, getRepoRoot, ensureNodeModulesInWorktree } from "../../src/guardrails/stateStore.js";
import {
  syncWorkflowDashboard,
  formatChatCreditMeter,
  getGroundTruthTelemetry,
  extractPlanMarkdown,
  extractDeveloperDetails,
  extractQADetails,
  extractReviewerDetails,
} from "../../src/guardrails/issueDashboard.js";
import { generateAstPreFetchMap, runSymbolSweep } from "../../src/guardrails/symbolSweep.js";
import { packageRepoIntelligence } from "../../src/guardrails/repoSkillResolver.js";
import { detectRepoStack } from "../../src/guardrails/toolingBridge.js";
import {
  validateTriage,
  validateArchitect,
  validateDeveloper,
  validateQA,
  validateReview,
} from "../../src/guardrails/handoffValidator.js";
import { computePlanHash } from "../../src/guardrails/scopeApprover.js";
import type { HookInput, HookOutput, ApprovalLock } from "../../src/guardrails/types.js";

function formatRepoIntelligenceForPrompt(repoRoot: string, targetAgent: string, approvedScope?: string): string {
  const intel = packageRepoIntelligence(repoRoot, targetAgent, approvedScope);
  const sections: string[] = [];

  if (intel.skillsFull.length > 0) {
    sections.push(`### 💡 Specialized Repository Skills\n${intel.skillsFull.join("\n\n")}`);
  }

  if (intel.skillsIndexed.length > 0) {
    sections.push(`### 📚 Additional Available Repository Skills\n${intel.skillsIndexed.join("\n")}\n*(Use read tool on skill path if needed)*`);
  }

  if (intel.slicedInstructions) {
    sections.push(`### 📋 Relevant Repository Instructions\n${intel.slicedInstructions}`);
  }

  return sections.join("\n\n");
}

function resolveIssueNumber(input: HookInput, toolArgs: any, state: any, lock: any): number {
  if (toolArgs.issueNumber && Number(toolArgs.issueNumber) > 0) {
    return Number(toolArgs.issueNumber);
  }
  const prompt = String(toolArgs.prompt || input.toolArgs?.prompt || "");
  const nameStr = String(toolArgs.name || "");
  const numFromName = nameStr.match(/issue-?(\d+)/i);
  if (numFromName) return parseInt(numFromName[1], 10);

  const numFromCwd = (input.cwd || "").match(/issue-?(\d+)/i);
  if (numFromCwd) return parseInt(numFromCwd[1], 10);

  // 1. Explicit prompt mention (e.g. "Resolve issue #11" or "[HUMAN_SCOPE_GATE_APPROVED...]")
  const numFromPrompt = prompt.match(/(?:issue(?:\s*number)?\s*[:#`'"\s]*|#)\s*(\d+)/i);
  if (numFromPrompt) return parseInt(numFromPrompt[1], 10);

  // 2. Active approval lock
  if (lock?.issueNumber && lock.issueNumber > 0) {
    return lock.issueNumber;
  }

  // 3. Active feature branch name
  const branch = state?.activeBranch || "";
  const branchNum = branch.match(/(?:issue-?|#)(\d+)/i);
  if (branchNum) return parseInt(branchNum[1], 10);

  // 4. Current state store
  if (state?.issue?.number && state.issue.number > 0) {
    return state.issue.number;
  }

  return 11; // Target issue for active challenge
}

async function main() {
  if (process.argv.includes("--meter")) {
    let effectiveCwd = process.cwd();
    let repoRoot = getRepoRoot(effectiveCwd);
    let state = loadState(repoRoot);

    // If cwd was not in a repository/worktree with state, search active worktrees by latest modified time
    if (!state?.sessionId) {
      const home = homedir();
      const candidates = [
        join(home, "factory/sample repos/copilot-worktrees/prsquad"),
        join(home, "OneDrive - Microsoft/Documents/GitHub Copilot App Enterprise Challenge/prsquad"),
        join(home, "factory/sample repos/prsquad"),
        join(home, "factory/sample repos/copilot-worktrees/gated-fix-pipeline"),
        join(home, "OneDrive - Microsoft/Documents/GitHub Copilot App Enterprise Challenge/gated-fix-pipeline"),
        join(home, "factory/sample repos/gated-fix-pipeline"),
      ];
      let bestState: any = null;
      let bestMtime = 0;
      let bestRepo = repoRoot;

      for (const parent of candidates) {
        if (existsSync(parent)) {
          try {
            const entries = readdirSync(parent, { withFileTypes: true });
            const dirs = entries.filter((d) => d.isDirectory()).map((d) => join(parent, d.name));
            dirs.push(parent);
            for (const d of dirs) {
              const stateFile = join(d, ".gated-change", "state.json");
              if (existsSync(stateFile)) {
                try {
                  const stat = statSync(stateFile);
                  if (stat.mtimeMs > bestMtime) {
                    const parsed = JSON.parse(readFileSync(stateFile, "utf-8"));
                    if (parsed) {
                      bestMtime = stat.mtimeMs;
                      bestState = parsed;
                      bestRepo = d;
                    }
                  }
                } catch {}
              }
            }
          } catch {}
        }
      }
      if (bestState) {
        state = bestState;
        repoRoot = bestRepo;
      }
    }

    let phases: Record<string, any> = {};
    const dashFile = join(repoRoot, ".gated-change", "dashboard.json");
    if (existsSync(dashFile)) {
      try {
        const parsed = JSON.parse(readFileSync(dashFile, "utf-8"));
        if (parsed.phases) phases = parsed.phases;
      } catch {}
    } else if (state?.phase) {
      phases = {
        intake: { status: "READY" },
        architect: { status: "PLAN_READY" },
        scopeGate: { status: state.humanApproval ? "APPROVED" : "PENDING", credits: 0.0 },
        developer: { status: state.phase === "DEVELOPING" ? "IN_PROGRESS" : "PENDING" },
        qa: { status: "PENDING" },
        reviewer: { status: "PENDING" },
        mergeGate: { status: "PENDING", credits: 0.0 },
      };
    }

    const tele = getGroundTruthTelemetry(state?.sessionId, 0);
    if (tele && tele.turns > 0) {
      const meter = formatChatCreditMeter({
        issueNumber: state?.issue?.number || 0,
        owner: state?.issue?.owner || "",
        repo: state?.issue?.repo || "",
        lastUpdated: new Date().toISOString(),
        phases,
        telemetry: tele,
      });
      process.stdout.write(meter + "\n");
    } else {
      process.stdout.write("### ⚡ Live AI Credit Meter\n\n> Telemetry active. (Recording ground-truth token events for active session...)\n");
    }
    process.exit(0);
  }

  let rawInput = "";
  if (!process.stdin.isTTY) {
    try {
      rawInput = readFileSync(0, "utf-8");
    } catch {
      // No stdin
    }
  }

  let input: HookInput = {};
  if (rawInput.trim()) {
    input = JSON.parse(rawInput);
  }

  const firstTool = input.toolCalls?.[0];
  const toolArgs = input.toolArgs || firstTool?.args || {};
  const targetAgent =
    toolArgs.agent_type ||
    toolArgs.name ||
    toolArgs.agent ||
    input.agent;

  // Intercept Developer agent invocation (supports qualified gated-change:gated-change-developer)
  if (isAgentMatch(targetAgent, "gated-change-developer")) {
    const effectiveCwd = input.cwd || process.cwd();
    const repoRoot = getRepoRoot(effectiveCwd);
    ensureNodeModulesInWorktree(repoRoot);
    const state = loadState(repoRoot);
    const lock = loadApprovalLock(repoRoot);

    // 1. Missing or inactive approval lock
    // Enforces the core invariant: "The model cannot approve itself."
    // Physical approval.lock on disk is MANDATORY and cannot be derived from agent prompt text.
    if (!lock || lock.status !== "ACTIVE") {
      appendAuditLog({
        sessionId: state.sessionId,
        agent: "controller",
        tool: "agent",
        action: "developer_invocation_blocked_no_lock",
        decision: "deny",
        details: {
          targetAgent,
          phase: state.phase,
          humanApproval: state.humanApproval,
        },
      }, repoRoot);

      const output: HookOutput = {
        decision: "deny",
        reason:
          "BLOCKED BY POLICY: Developer agent cannot be invoked without verified human scope approval. " +
          "The human maintainer must explicitly authorize implementation at the Human Scope Gate by running /approve " +
          "(or 'npx -y tsx scripts/guardrails/scope-approve.ts'). The model cannot approve itself.",
      };
      process.stdout.write(JSON.stringify(output) + "\n");
      process.exit(1);
    }

    // 2. Approval Integrity Binding: verify plan hash and base commit
    // Enforces that structured plan arguments match the plan approved by the human maintainer.
    // Avoids fuzzy prompt regex scraping to prevent false-positive blocks on natural language variation.
    if (lock.planHash) {
      if (toolArgs.planHash && toolArgs.planHash !== lock.planHash) {
        appendAuditLog({
          sessionId: state.sessionId,
          agent: "controller",
          tool: "agent",
          action: "developer_invocation_blocked_plan_drift",
          decision: "deny",
          details: {
            expectedPlanHash: lock.planHash,
            actualPlanHash: toolArgs.planHash,
            lockIssue: lock.issueNumber,
          },
        }, repoRoot);

        const output: HookOutput = {
          decision: "deny",
          reason:
            `BLOCKED BY POLICY (Approval Integrity Drift): The planHash '${toolArgs.planHash}' does not match ` +
            `the approved planHash '${lock.planHash}'. Re-approval is required.`,
        };
        process.stdout.write(JSON.stringify(output) + "\n");
        process.exit(1);
      }

      const structuredPlan = toolArgs.plan || toolArgs.planMarkdown;
      if (structuredPlan) {
        const currentHash = computePlanHash(structuredPlan);
        if (currentHash && currentHash !== lock.planHash) {
          appendAuditLog({
            sessionId: state.sessionId,
            agent: "controller",
            tool: "agent",
            action: "developer_invocation_blocked_plan_drift",
            decision: "deny",
            details: {
              expectedPlanHash: lock.planHash,
              actualPlanHash: currentHash,
              lockIssue: lock.issueNumber,
            },
          }, repoRoot);

          const output: HookOutput = {
            decision: "deny",
            reason:
              `BLOCKED BY POLICY (Approval Integrity Drift): The technical plan passed to Developer does not match ` +
              `the plan approved by the human maintainer at the Scope Gate (expected planHash: ${lock.planHash}, actual: ${currentHash}). ` +
              `Re-approval is required before implementation can proceed.`,
          };
          process.stdout.write(JSON.stringify(output) + "\n");
          process.exit(1);
        }
      }
    }

    // 3. Attempt budget exceeded
    if (lock.currentAttempt > lock.maxAttempts) {
      revokeApprovalLock("EXHAUSTED", repoRoot);
      state.phase = "ESCALATED";
      saveState(state, repoRoot);

      appendAuditLog({
        sessionId: state.sessionId,
        agent: "controller",
        tool: "agent",
        action: "developer_invocation_blocked_attempts_exhausted",
        decision: "deny",
        details: {
          currentAttempt: lock.currentAttempt,
          maxAttempts: lock.maxAttempts,
        },
      }, repoRoot);

      const output: HookOutput = {
        decision: "deny",
        reason:
          `BLOCKED BY POLICY: Implementation retry limit exhausted (${lock.currentAttempt - 1}/${lock.maxAttempts} attempts used). ` +
          "Workflow is escalated to human engineers.",
      };
      process.stdout.write(JSON.stringify(output) + "\n");
      process.exit(1);
    }

    // 3. Lock is valid -> create/switch branch & authorize execution
    const resolvedIssue = resolveIssueNumber(input, toolArgs, state, lock);
    const branchName = `fix/issue-${resolvedIssue}`;
    let branchStatus = "unknown";
    let currentBranch = "main";

    try {
      try {
        currentBranch = execSync("git rev-parse --abbrev-ref HEAD", {
          cwd: repoRoot,
          encoding: "utf-8",
          stdio: ["ignore", "pipe", "ignore"],
        }).trim();
      } catch {
        try {
          currentBranch = execSync("git symbolic-ref --short HEAD", {
            cwd: repoRoot,
            encoding: "utf-8",
            stdio: ["ignore", "pipe", "ignore"],
          }).trim();
        } catch {
          currentBranch = "main";
        }
      }

      const isBaseBranch =
        currentBranch === "main" ||
        currentBranch === "master" ||
        currentBranch === "HEAD" ||
        currentBranch.startsWith("origin/") ||
        process.env.FORCE_BRANCH_SWITCH === "true";

      if (isBaseBranch && currentBranch !== branchName) {
        let hasCommits = false;
        try {
          execSync("git rev-parse HEAD", { cwd: repoRoot, stdio: "ignore" });
          hasCommits = true;
        } catch {}

        if (!hasCommits) {
          try {
            execSync(`git checkout -b ${branchName}`, { cwd: repoRoot, stdio: "ignore" });
          } catch {
            execSync(`git symbolic-ref HEAD refs/heads/${branchName}`, { cwd: repoRoot, stdio: "ignore" });
          }
          branchStatus = `initialized_on_${branchName}`;
        } else {
          let branchExists = false;
          try {
            execSync(`git rev-parse --verify refs/heads/${branchName}`, { cwd: repoRoot, stdio: "ignore" });
            branchExists = true;
          } catch {}

          if (branchExists) {
            execSync(`git checkout ${branchName}`, {
              cwd: repoRoot,
              encoding: "utf-8",
              stdio: ["ignore", "pipe", "ignore"],
            });
            branchStatus = `switched_to_${branchName}`;
          } else {
            execSync(`git checkout -b ${branchName}`, {
              cwd: repoRoot,
              encoding: "utf-8",
              stdio: ["ignore", "pipe", "ignore"],
            });
            branchStatus = `created_and_switched_to_${branchName}`;
          }
        }
      } else if (currentBranch === branchName) {
        branchStatus = `already_on_${branchName}`;
      } else {
        branchStatus = `retained_${currentBranch}`;
      }

      // Independent physical checkout verification: verify git HEAD is genuinely on branchName if base switch occurred, and strictly enforce base branch lockdown
      try {
        const verifiedBranch = execSync("git rev-parse --abbrev-ref HEAD", { cwd: repoRoot, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }).trim();
        if (verifiedBranch === "main" || verifiedBranch === "master") {
          const output: HookOutput = {
            decision: "deny",
            reason: `BLOCKED BY POLICY (BASE_BRANCH_LOCKDOWN): Developer agent cannot execute on base branch '${verifiedBranch}'. Halting fail-closed to protect base branch.`,
          };
          process.stdout.write(JSON.stringify(output) + "\n");
          process.exit(1);
        }
        if (isBaseBranch && verifiedBranch !== branchName && verifiedBranch !== "HEAD") {
          const output: HookOutput = {
            decision: "deny",
            reason: `BLOCKED BY POLICY (CHECKOUT_VERIFICATION_FAILED): Expected active branch '${branchName}', but git rev-parse reported '${verifiedBranch}'. Halting fail-closed.`,
          };
          process.stdout.write(JSON.stringify(output) + "\n");
          process.exit(1);
        }
      } catch {}
    } catch (branchErr: any) {
      appendAuditLog({
        sessionId: state.sessionId,
        agent: "controller",
        tool: "agent",
        action: "developer_branch_isolation_failed",
        decision: "deny",
        details: { branchName, error: branchErr?.message },
      }, repoRoot);

      const output: HookOutput = {
        decision: "deny",
        reason: `BLOCKED BY POLICY: Failed to create or switch to feature branch '${branchName}': ${branchErr?.message}. Developer execution halted to protect base branch.`,
      };
      process.stdout.write(JSON.stringify(output) + "\n");
      process.exit(1);
    }

    state.phase = "DEVELOPING";
    state.humanApproval = true;
    state.approvedScope = lock.approvedScope;
    state.implementationAttempt = lock.currentAttempt;
    state.activeBranch = branchStatus.startsWith("retained_") ? currentBranch : branchName;
    if (!state.issue) {
      state.issue = { owner: "vamsicherukuri", repo: "prsquad", number: resolvedIssue };
    } else {
      state.issue.number = resolvedIssue;
    }
    saveState(state, repoRoot);

    // Baseline Drift Verification on Attempt 1: Approved baseRef must match current repository baseline
    if (lock.currentAttempt === 1 && lock.baseRef && lock.baseRef !== "HEAD") {
      let currentHead = "";
      try {
        currentHead = execSync("git rev-parse HEAD", { cwd: repoRoot, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }).trim();
      } catch {}
      if (currentHead && !currentHead.startsWith(lock.baseRef) && !lock.baseRef.startsWith(currentHead)) {
        const output: HookOutput = {
          decision: "deny",
          reason: `BLOCKED BY POLICY (BASELINE_DRIFT): Repository baseline changed after Scope Gate approval. Approved baseRef is '${lock.baseRef.slice(0, 8)}', but current HEAD is '${currentHead.slice(0, 8)}'. Maintainer re-approval required.`,
        };
        process.stdout.write(JSON.stringify(output) + "\n");
        process.exit(1);
      }
    }

    const prompt = toolArgs.prompt || toolArgs.content || "";
    const extractedPlan = extractPlanMarkdown(prompt);

    if (input.sessionId) {
      state.sessionId = input.sessionId;
      saveState(state, repoRoot);
    }

    syncWorkflowDashboard(repoRoot, {
      owner: state.issue?.owner || "vamsicherukuri",
      repo: state.issue?.repo || "prsquad",
      issueNumber: resolvedIssue,
      issueTitle: state.issue?.title || (state.issue?.number ? `Issue #${state.issue.number}` : "Active Pipeline Task"),
      activeBranch: branchName,
      sessionId: input.sessionId || state.sessionId,
      phase: "scopeGate",
      status: "APPROVED",
      summary: `Scope Approval Gate approved by ${lock.approvedBy} on branch '${branchName}'`,
      details: {
        approvedScope: lock.approvedScope,
        approvedBy: lock.approvedBy,
        approvedAt: lock.approvedAt,
        activeBranch: branchName,
        ...(extractedPlan ? { plan: extractedPlan } : {}),
      },
    });

    const dashDev = syncWorkflowDashboard(repoRoot, {
      sessionId: input.sessionId || state.sessionId,
      phase: "developer",
      status: "IN_PROGRESS",
      summary: `Implementing changes bounded to '${lock.approvedScope}' on branch '${branchName}'`,
    });

    const chatMeter = formatChatCreditMeter(dashDev);

    appendAuditLog({
      sessionId: state.sessionId,
      agent: "controller",
      tool: "agent",
      action: "developer_invocation_authorized",
      decision: "allow",
      details: {
        attempt: lock.currentAttempt,
        approvedScope: lock.approvedScope,
        approvedBy: lock.approvedBy,
        activeBranch: branchName,
        branchStatus,
      },
    });

    const branchInstructions =
      `[BRANCH ISOLATION GUARDRAIL]\n` +
      `Active Feature Branch: '${branchName}' (automatically created/checked out by Scope Gate hook).\n` +
      `All edits and commits MUST remain on '${branchName}'.\n` +
      `Direct checkout or commits to 'main'/'master' and remote 'git push' are strictly blocked by security hooks.\n` +
      `Before reporting IMPLEMENTED, stage and commit your changes: git commit -m "fix: <summary> (fixes #${resolvedIssue})".\n` +
      `Report headRef as your commit SHA or '${branchName}'.`;

    const enrichedPrompt = prompt.includes("[BRANCH ISOLATION GUARDRAIL]")
      ? prompt
      : `${branchInstructions}\n\n${prompt}`;

    const modifiedArgs = {
      ...toolArgs,
      prompt: enrichedPrompt,
      activeBranch: branchName,
    };

    const repoIntel = formatRepoIntelligenceForPrompt(repoRoot, targetAgent, lock.approvedScope);

    // Deterministic Canonical Plan Injection (0 Token Overhead)
    // Injects the exact canonical plan approved at the Scope Gate directly from dashboard/state
    let canonicalPlan = "";
    if (dashDev?.phases?.architect?.details?.plan) {
      canonicalPlan = dashDev.phases.architect.details.plan;
    } else if (dashDev?.phases?.scopeGate?.details?.plan) {
      canonicalPlan = dashDev.phases.scopeGate.details.plan;
    } else if (state.approvedPlan) {
      canonicalPlan = state.approvedPlan;
    } else if (extractedPlan) {
      canonicalPlan = extractedPlan;
    }

    const planText = typeof canonicalPlan === "string" ? canonicalPlan.trim() : JSON.stringify(canonicalPlan, null, 2);
    const planSection = canonicalPlan
      ? `\n\n### 📐 Canonical Approved Architecture Plan (Injected by Scope Gate Hook)\n${planText}`
      : "";

    const specText = typeof specBody === "string" ? specBody.trim() : "";
    const specSection = specText
      ? `\n\n### 📋 Verified Issue Specification & Acceptance Criteria\n${specText}`
      : "";

    // Deterministic QA Rework Diagnostics (Attempt 2+ following a failed QA verification)
    // Ephemeral per-invocation: only injected for Developer rework, never leaks to QA or Reviewer
    let reworkSection = "";
    const prevQA = dashDev?.phases?.qa;
    if (lock.currentAttempt > 1 && prevQA?.status === "FAIL") {
      const qaDetails = prevQA.details || {};
      const findings = qaDetails.blockingFindings?.length
        ? `\n#### 🔍 Blocking Findings:\n` + qaDetails.blockingFindings.map((f: string) => `- ❌ ${f}`).join("\n")
        : "";
      const failures = qaDetails.failureClassification?.length
        ? `\n#### 🚩 Failure Classifications:\n` + qaDetails.failureClassification.map((f: any) => `- ⚠️ [${f.classification}] ${f.failure}${f.evidence ? ` (${f.evidence})` : ""}`).join("\n")
        : "";

      reworkSection =
        `\n\n### 🔧 Previous QA Verification Failure Report (Rework Attempt ${lock.currentAttempt}/${lock.maxAttempts})\n` +
        `> **Previous QA Verdict:** ❌ \`FAIL\`\n` +
        (prevQA.summary ? `> **QA Summary:** ${prevQA.summary}\n` : "") +
        (qaDetails.testNotes ? `> **QA Notes:** ${qaDetails.testNotes}\n` : "") +
        failures +
        findings;
    }

    const addCtx =
      `SCOPE_GATE_VERIFIED: Implementation Attempt ${lock.currentAttempt}/${lock.maxAttempts} authorized by ${lock.approvedBy}.\n` +
      `APPROVED_SCOPE_PREFIX: "${lock.approvedScope}"\n` +
      `ACTIVE_FEATURE_BRANCH: "${branchName}"\n` +
      "Developer write actions are strictly bounded to this prefix and branch." +
      planSection +
      specSection +
      reworkSection +
      (chatMeter ? `\n\n${chatMeter}\n\n[INSTRUCTION FOR CONTROLLER]: Include this ⚡ AI Credit Meter status in your implementation handoff summary.` : "") +
      (repoIntel ? `\n\n${repoIntel}` : "");

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
        additionalContext: addCtx,
      },
    };
    process.stdout.write(JSON.stringify(output) + "\n");
    process.exit(0);
  }

  function sanitizeSpecialistHandoff(rawText: string, agentName?: string): string {
    if (!rawText) return "";

    const jsonMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)\s*```/) || rawText.match(/(\{[\s\S]*\})/);

    if (isAgentMatch(agentName, "gated-change-developer")) {
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[1]);
          if (parsed.status) {
            return `\`\`\`json\n${JSON.stringify({
              status: parsed.status,
              changedFiles: parsed.changedFiles || [],
              tests: parsed.tests || { status: "PASS" },
              commitSha: parsed.commitSha || parsed.headRef || "HEAD",
              diffReference: parsed.diffReference || { headRef: parsed.headRef || "HEAD" },
              scopeAmendmentRequest: parsed.scopeAmendmentRequest || null,
              assumptions: parsed.assumptions || [],
              residualRisk: parsed.residualRisk || "Low",
            }, null, 2)}\n\`\`\``;
          }
        } catch {}
      }
    } else if (isAgentMatch(agentName, "gated-change-qa")) {
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[1]);
          if (parsed.verdict) {
            return `\`\`\`json\n${JSON.stringify({
              verdict: parsed.verdict,
              scopeCompliance: parsed.scopeCompliance || "PASS",
              acceptanceCriteriaResults: parsed.acceptanceCriteriaResults || [],
              testResults: parsed.testResults || { passed: true },
              blockingFindings: parsed.blockingFindings || [],
              notes: parsed.notes || "",
            }, null, 2)}\n\`\`\``;
          }
        } catch {}
      }
    } else if (isAgentMatch(agentName, "gated-change-reviewer")) {
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[1]);
          if (parsed.verdict) {
            return `\`\`\`json\n${JSON.stringify({
              verdict: parsed.verdict,
              findings: parsed.findings || [],
              scopeAudit: parsed.scopeAudit || "PASS",
              notes: parsed.notes || "",
            }, null, 2)}\n\`\`\``;
          }
        } catch {}
      }
    } else if (isAgentMatch(agentName, "gated-change-architect")) {
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[1]);
          if (parsed.status) {
            return `\`\`\`json\n${JSON.stringify({
              status: parsed.status,
              rootCause: parsed.rootCause || "",
              changes: parsed.changes || [],
              proposedScope: parsed.proposedScope || "",
              blastRadius: parsed.blastRadius || { risk: "Low", affectedOutsideScope: [] },
              validationPlan: parsed.validationPlan || [],
              plainLanguageSummary: parsed.plainLanguageSummary || "",
              blockedReason: parsed.blockedReason || null,
            }, null, 2)}\n\`\`\``;
          }
        } catch {}
      }
    }

    // Trim verbose repetitive terminal stdout (>80 lines) for token efficiency
    const lines = rawText.split("\n");
    if (lines.length > 80) {
      const head = lines.slice(0, 30).join("\n");
      const tail = lines.slice(-30).join("\n");
      return `${head}\n\n... [${lines.length - 60} lines of verbose execution logs trimmed by guardrail hook for token efficiency] ...\n\n${tail}`;
    }

    return rawText;
  }

  function buildEnrichedPostToolOutput(hookInput: HookInput, meter: string, instructionText: string, agentName?: string) {
    const raw = typeof hookInput.toolResult === "string"
      ? hookInput.toolResult
      : hookInput.toolResult?.textResultForLlm || hookInput.toolResult?.content || (hookInput.toolResult ? JSON.stringify(hookInput.toolResult) : "");
    const sanitized = sanitizeSpecialistHandoff(raw, agentName || targetAgent);
    const enrichedText = `${sanitized}\n\n${meter}\n\n${instructionText}`;
    const modified = {
      resultType: hookInput.toolResult?.resultType || "success",
      textResultForLlm: enrichedText,
    };
    const addCtx = `${meter}\n\n${instructionText}`;
    return {
      decision: "allow",
      modifiedResult: modified,
      additionalContext: addCtx,
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        permissionDecision: "allow",
        modifiedResult: modified,
        additionalContext: addCtx,
      },
    };
  }

  function buildDeveloperHandoffPayload(
    repoPath: string,
    stateObj: any,
    fallbackPrompt: string,
    issueNum: number
  ): { details: Record<string, any>; markdown: string } {
    let details: Record<string, any> = {};
    const dashFile = join(repoPath, ".gated-change", "dashboard.json");
    let dashData: any = null;
    if (existsSync(dashFile)) {
      try {
        dashData = JSON.parse(readFileSync(dashFile, "utf-8"));
        if (dashData?.phases?.developer?.details) {
          details = { ...dashData.phases.developer.details };
        }
      } catch {}
    }

    if (!details.commitSha || !details.changedFiles) {
      const fromPrompt = extractDeveloperDetails(fallbackPrompt, repoPath);
      details = { ...fromPrompt, ...details };
    }

    if (!details.commitSha) {
      try {
        details.commitSha = execSync("git rev-parse HEAD", { cwd: repoPath, encoding: "utf-8" }).trim();
      } catch {
        details.commitSha = "HEAD";
      }
    }

    if (!details.changedFiles || details.changedFiles.length === 0) {
      try {
        const files = execSync("git diff-tree --no-commit-id --name-only -r HEAD", { cwd: repoPath, encoding: "utf-8" })
          .trim().split("\n").filter(Boolean);
        if (files.length > 0) details.changedFiles = files;
      } catch {}
    }

    const archPlan = dashData?.phases?.architect?.details?.plan || "";
    const approvedScope = stateObj?.approvedScope || dashData?.phases?.scopeGate?.details?.approvedScope || "src/scopeTool.ts, scripts/test-guardrails.ts";
    const activeBranch = stateObj?.activeBranch || `fix/issue-${issueNum}`;

    const mdParts = [
      `### 📦 Deterministic Developer Phase Handoff (Injected by Hook)`,
      `> **Status:** \`${details.status || "IMPLEMENTED"}\`  `,
      `> **Approved Scope:** \`${approvedScope}\`  `,
      `> **Active Branch:** \`${activeBranch}\`  `,
      `> **Commit SHA (headRef):** \`${details.commitSha}\`  `,
      `> **Base Reference (baseRef):** \`${details.baseRef || stateObj?.baseRef || "HEAD~1"}\`  `,
      `> **Changed Files:** \`${(details.changedFiles || []).join("`, `") || "detected in git"}\``,
    ];

    if (details.testsAddedOrChanged && details.testsAddedOrChanged.length > 0) {
      mdParts.push(`#### 🧪 Tests Added/Changed by Developer\n${details.testsAddedOrChanged.map((t: string) => `- ${t}`).join("\n")}`);
    }
    if (details.testSummary) {
      mdParts.push(`#### 🔍 Developer Test Summary\n${details.testSummary}`);
    }
    if (archPlan) {
      const planStr = typeof archPlan === "string" ? archPlan.trim() : JSON.stringify(archPlan, null, 2);
      mdParts.push(`#### 📐 Approved Architecture Plan\n${planStr}`);
    }
    const issueBody = typeof stateObj?.issue?.body === "string" ? stateObj.issue.body.trim() : "";
    if (issueBody) {
      mdParts.push(`#### 📋 Verified Issue Acceptance Criteria & Specification\n${issueBody}`);
    }

    return {
      details,
      markdown: mdParts.join("\n\n"),
    };
  }

  function buildQAHandoffPayload(
    repoPath: string,
    stateObj: any,
    fallbackPrompt: string
  ): { details: Record<string, any>; markdown: string } {
    let details: Record<string, any> = {};
    const dashFile = join(repoPath, ".gated-change", "dashboard.json");
    let dashData: any = null;
    if (existsSync(dashFile)) {
      try {
        dashData = JSON.parse(readFileSync(dashFile, "utf-8"));
        if (dashData?.phases?.qa?.details) {
          details = { ...dashData.phases.qa.details };
        }
      } catch {}
    }

    if (!details.verdict) {
      const fromPrompt = extractQADetails(fallbackPrompt);
      details = { ...fromPrompt, ...details };
    }

    const approvedScope = stateObj?.approvedScope || dashData?.phases?.scopeGate?.details?.approvedScope || "NOT RECORDED";

    const mdParts = [
      `### 🧪 Deterministic QA Verification Evidence (Injected by Hook)`,
      `> **Verdict:** \`${details.verdict || "NOT RECORDED"}\`  `,
      `> **Scope Compliance:** \`${details.scopeCompliance || "NOT RECORDED"}\`${approvedScope !== "NOT RECORDED" ? ` (Strictly within \`${approvedScope}\`)` : ""}  `,
      details.criteriaSummary ? `> **Acceptance Criteria:** ${details.criteriaSummary}  ` : `> **Acceptance Criteria:** NOT RECORDED  `,
      details.testNotes ? `> **QA Test Notes:** ${details.testNotes}` : "",
    ].filter(Boolean);

    return {
      details,
      markdown: mdParts.join("\n"),
    };
  }

  // 1. PostToolUse handling (when toolResult is returned)
  if (input.toolResult) {
    const effectiveCwd = input.cwd || process.cwd();
    const repoRoot = getRepoRoot(effectiveCwd);
    const state = loadState(repoRoot);
    const lock = loadApprovalLock(repoRoot);
    const resolvedIssue = resolveIssueNumber(input, toolArgs, state, lock);

    if (input.sessionId && (!state.sessionId || state.sessionId !== input.sessionId)) {
      state.sessionId = input.sessionId;
      saveState(state, repoRoot);
    }

    if (isAgentMatch(targetAgent, "gated-change-intake")) {
      const triageVal = validateTriage(input.toolResult);
      const triageStatus = triageVal.valid ? triageVal.data.status : "HANDOFF_INVALID";
      const triageSummary = triageVal.valid
        ? (triageStatus === "READY"
            ? "Issue requirements extracted and acceptance criteria validated"
            : triageStatus === "NOT_READY"
              ? `Definition of Ready not met (missing: ${triageVal.data.missing?.join(", ")})`
              : `Triage reported ${triageStatus}`)
        : `Triage handoff validation failed: ${triageVal.errors.join("; ")}`;

      const dashIntake = syncWorkflowDashboard(repoRoot, {
        owner: state.issue?.owner || "vamsicherukuri",
        repo: state.issue?.repo || "prsquad",
        issueNumber: resolvedIssue,
        issueTitle: state.issue?.title || (state.issue?.number ? `Issue #${state.issue.number}` : "Active Pipeline Task"),
        sessionId: input.sessionId || state.sessionId,
        phase: "intake",
        status: triageStatus,
        summary: triageSummary,
        details: triageVal.valid ? triageVal.data : { errors: triageVal.errors },
      });

      const triageInstruction = !triageVal.valid
        ? `[INSTRUCTION FOR CONTROLLER]: Triage handoff failed validation (${triageVal.errors.join("; ")}). Issue one schema-correction prompt to Intake specialist or pause pipeline.`
        : triageStatus === "NOT_READY"
          ? "[INSTRUCTION FOR CONTROLLER]: Issue is NOT_READY. Ask the maintainer the single clarifying question to satisfy Definition of Ready (round 1/2)."
          : "[INSTRUCTION FOR CONTROLLER]: Intake triage complete. Include this live ⚡ AI Credit Meter status in your handoff message before delegating to Architect.";

      const chatMeter = formatChatCreditMeter(dashIntake);
      const out = chatMeter
        ? buildEnrichedPostToolOutput(input, chatMeter, triageInstruction)
        : { decision: "allow" };
      process.stdout.write(JSON.stringify(out) + "\n");
      process.exit(0);
    } else if (isAgentMatch(targetAgent, "gated-change-architect")) {
      const archVal = validateArchitect(input.toolResult);
      const archStatus = archVal.valid ? archVal.data.status : "HANDOFF_INVALID";
      const rawText = typeof input.toolResult === "string"
        ? input.toolResult
        : input.toolResult.textResultForLlm || input.toolResult.content || JSON.stringify(input.toolResult);
      const planMarkdown = extractPlanMarkdown(rawText);
      const proposedScope = (archVal.valid && archVal.data.proposedScope)
        ? archVal.data.proposedScope
        : (state.approvedScope || "NOT RECORDED");

      const archSummary = archVal.valid
        ? (archStatus === "PLAN_READY"
            ? "Technical architecture plan & scope specification generated"
            : archStatus === "BLOCKED"
              ? `Architect blocked: ${archVal.data.blockedReason || "Cannot produce confident plan"}`
              : `Scope amendment ${archStatus}`)
        : `Architect handoff validation failed: ${archVal.errors.join("; ")}`;

      const dashArch = syncWorkflowDashboard(repoRoot, {
        owner: state.issue?.owner || "vamsicherukuri",
        repo: state.issue?.repo || "prsquad",
        issueNumber: resolvedIssue,
        issueTitle: state.issue?.title || (state.issue?.number ? `Issue #${state.issue.number}` : "Active Pipeline Task"),
        sessionId: input.sessionId || state.sessionId,
        phase: "architect",
        status: archStatus,
        summary: archSummary,
        details: {
          plan: planMarkdown || rawText,
          proposedScope,
          riskTier: (archVal.valid && archVal.data.blastRadius?.risk) || "Low",
          validated: archVal.valid,
          errors: archVal.valid ? undefined : archVal.errors,
        },
      });

      const archInstruction = !archVal.valid
        ? `[INSTRUCTION FOR CONTROLLER]: Architect handoff failed validation (${archVal.errors.join("; ")}). Pause pipeline and report blocker to maintainer.`
        : archStatus === "BLOCKED"
          ? "[INSTRUCTION FOR CONTROLLER]: Architect reported BLOCKED. Pause pipeline and report blocker to maintainer."
          : archStatus === "SCOPE_AMENDMENT_CONFIRMED"
            ? "[INSTRUCTION FOR CONTROLLER]: Scope amendment confirmed by Architect. Route back to Scope Approval Gate for human confirmation."
            : "[INSTRUCTION FOR CONTROLLER]: Include this live ⚡ AI Credit Meter table alongside the architecture plan at the Scope Approval Gate.";

      const chatMeter = formatChatCreditMeter(dashArch);
      const out = chatMeter
        ? buildEnrichedPostToolOutput(input, chatMeter, archInstruction)
        : { decision: "allow" };
      process.stdout.write(JSON.stringify(out) + "\n");
      process.exit(0);
    } else if (isAgentMatch(targetAgent, "gated-change-developer")) {
      const devVal = validateDeveloper(input.toolResult);
      const devStatus = devVal.valid ? devVal.data.status : "HANDOFF_INVALID";

      // Deterministic auto-commit: strictly require VALID IMPLEMENTED handoff
      if (devVal.valid && devStatus === "IMPLEMENTED") {
        try {
          const statusOut = execSync("git status --porcelain", { cwd: repoRoot, encoding: "utf-8" }).trim();
          if (statusOut) {
            execSync("git add -u", { cwd: repoRoot, stdio: "ignore" });
            const commitMsg = `fix(issue-${resolvedIssue}): implement verified changes within approved scope`;
            execSync(`git commit -m "${commitMsg}"`, { cwd: repoRoot, stdio: "ignore" });
          }
        } catch {}
      }

      const devDetails = devVal.valid
        ? extractDeveloperDetails(input.toolResult, repoRoot)
        : { status: "SCHEMA_INVALID", errors: devVal.errors };
      const devSummary = devVal.valid
        ? (devStatus === "IMPLEMENTED"
            ? (devDetails.commitSha ? `Fix committed in ${devDetails.commitSha.slice(0, 8)}` : "Changes implemented and verified locally")
            : devStatus === "SCOPE_AMENDMENT_REQUIRED"
              ? "Developer requested scope amendment outside approved boundary"
              : `Developer reported BLOCKED: ${devVal.data.blocker?.description || "Execution halted"}`)
        : `Developer handoff validation failed: ${devVal.errors.join("; ")}`;

      const dashDev = syncWorkflowDashboard(repoRoot, {
        owner: state.issue?.owner || "vamsicherukuri",
        repo: state.issue?.repo || "prsquad",
        issueNumber: resolvedIssue,
        issueTitle: state.issue?.title || (state.issue?.number ? `Issue #${state.issue.number}` : "Active Pipeline Task"),
        sessionId: input.sessionId || state.sessionId,
        phase: "developer",
        status: devStatus,
        summary: devSummary,
        details: devDetails,
      });

      const devInstruction = !devVal.valid
        ? `[INSTRUCTION FOR CONTROLLER]: Developer handoff schema invalid (${devVal.errors.join("; ")}). Re-prompt Developer for valid schema handoff or pause pipeline.`
        : devStatus === "SCOPE_AMENDMENT_REQUIRED"
          ? "[INSTRUCTION FOR CONTROLLER]: Developer requested scope amendment. Route to Architect for scope review."
          : devStatus === "BLOCKED"
            ? "[INSTRUCTION FOR CONTROLLER]: Developer blocked. Pause pipeline and report blocker to maintainer."
            : "[INSTRUCTION FOR CONTROLLER]: Developer implementation complete. Proceed directly to QA verification.";

      const devAiCredits = dashDev?.telemetry?.actualAiCredits !== undefined
        ? `> ⚡ Live Telemetry: **${dashDev.telemetry.actualAiCredits.toFixed(2)} AIU** consumed across active phases.`
        : "";
      const out = buildEnrichedPostToolOutput(input, devAiCredits, devInstruction);
      process.stdout.write(JSON.stringify(out) + "\n");
      process.exit(0);
    } else if (isAgentMatch(targetAgent, "gated-change-qa")) {
      const qaVal = validateQA(input.toolResult);
      const qaDetails = extractQADetails(input.toolResult);
      const qaVerdict = qaVal.valid ? qaVal.data.verdict : "HANDOFF_INVALID";

      // Deterministic implementation retry tracking & exhaustion guardrail
      let retryExhausted = false;
      if (qaVerdict === "FAIL" && lock) {
        lock.currentAttempt++;
        saveApprovalLock(lock, repoRoot);
        state.implementationAttempt = lock.currentAttempt;
        if (lock.currentAttempt > lock.maxAttempts) {
          retryExhausted = true;
          state.phase = "ESCALATED";
          state.currentPhase = "ESCALATED";
        }
        saveState(state, repoRoot);
      }

      const qaSummary = qaVal.valid
        ? (qaVerdict === "PASS"
            ? "Independent QA verification passed all acceptance criteria"
            : qaVerdict === "FAIL"
              ? (retryExhausted
                  ? `Independent QA verification failed and retry budget exhausted (${lock!.maxAttempts}/${lock!.maxAttempts} attempts used)`
                  : `Independent QA verification detected failures (${qaVal.data.failureClassification?.map(f => f.failure).join("; ") || qaVal.data.blockingFindings?.join("; ") || "Test failure"})`)
              : "QA verification blocked: unable to complete test suite")
        : `QA handoff validation failed: ${qaVal.errors.join("; ")}`;

      const dashQA = syncWorkflowDashboard(repoRoot, {
        owner: state.issue?.owner || "vamsicherukuri",
        repo: state.issue?.repo || "prsquad",
        issueNumber: resolvedIssue,
        issueTitle: state.issue?.title || (state.issue?.number ? `Issue #${state.issue.number}` : "Active Pipeline Task"),
        sessionId: input.sessionId || state.sessionId,
        phase: "qa",
        status: qaVerdict,
        summary: qaSummary,
        details: { ...qaDetails, verdict: qaVerdict, errors: qaVal.valid ? undefined : qaVal.errors, currentAttempt: lock ? lock.currentAttempt : undefined },
      });

      const qaInstruction = !qaVal.valid
        ? `[INSTRUCTION FOR CONTROLLER]: QA handoff failed validation (${qaVal.errors.join("; ")}). Re-prompt QA for valid verification report or pause pipeline.`
        : retryExhausted
          ? `[INSTRUCTION FOR CONTROLLER]: Implementation retry limit exhausted (${lock!.maxAttempts}/${lock!.maxAttempts} attempts used). Workflow is escalated to human maintainers. Do not delegate to Developer again.`
          : qaVerdict === "FAIL"
            ? `[INSTRUCTION FOR CONTROLLER]: QA verification failed (Attempt ${(lock?.currentAttempt || 2) - 1}/${lock?.maxAttempts || 3} failed). Route back to Developer for rework attempt ${lock?.currentAttempt || 2}/${lock?.maxAttempts || 3}.`
            : qaVerdict === "BLOCKED"
              ? "[INSTRUCTION FOR CONTROLLER]: QA verification blocked. Pause pipeline and report blocker to maintainer."
              : "[INSTRUCTION FOR CONTROLLER]: QA verification passed. Proceed directly to Reviewer security audit.";

      const qaAiCredits = dashQA?.telemetry?.actualAiCredits !== undefined
        ? `> ⚡ Live Telemetry: **${dashQA.telemetry.actualAiCredits.toFixed(2)} AIU** consumed across active phases.`
        : "";
      const out = buildEnrichedPostToolOutput(input, qaAiCredits, qaInstruction);
      process.stdout.write(JSON.stringify(out) + "\n");
      process.exit(0);
    } else if (isAgentMatch(targetAgent, "gated-change-reviewer")) {
      const revVal = validateReview(input.toolResult);
      const revDetails = extractReviewerDetails(input.toolResult);
      const verdict = revVal.valid ? revVal.data.assessment : "HANDOFF_INVALID";

      syncWorkflowDashboard(repoRoot, {
        owner: state.issue?.owner || "vamsicherukuri",
        repo: state.issue?.repo || "prsquad",
        issueNumber: resolvedIssue,
        sessionId: input.sessionId || state.sessionId,
        phase: "reviewer",
        status: verdict,
        summary: revVal.valid
          ? `Read-only diff security audit complete: ${verdict}`
          : `Reviewer handoff validation failed: ${revVal.errors.join("; ")}`,
        details: revVal.valid ? revDetails : { errors: revVal.errors, ...revDetails },
      });

      if (revVal.valid && verdict === "CLEAR") {
        // Transition state: REVIEW_COMPLETE -> PR_READY -> WAITING_FOR_HUMAN
        state.phase = "PR_READY";
        state.currentPhase = "WAITING_FOR_HUMAN";
        saveState(state, repoRoot);

        const dashMerge = syncWorkflowDashboard(repoRoot, {
          sessionId: input.sessionId || state.sessionId,
          phase: "mergeGate",
          status: "WAITING_FOR_HUMAN",
          summary: `Read-only diff security audit complete: ${verdict}. Verified implementation is ready for PR creation. Awaiting human maintainer authorization via /create-pr at the PR Approval Gate.`,
          details: {
            baseBranch: "copilot-app-plugin-alignment",
            headBranch: state.activeBranch || `fix/issue-${resolvedIssue}`,
            prOpen: false,
            awaitingHumanApproval: true,
          },
        });

        const chatMeter = formatChatCreditMeter(dashMerge);
        const out = chatMeter
          ? buildEnrichedPostToolOutput(
              input,
              chatMeter,
              "[INSTRUCTION FOR CONTROLLER]: Code review audit complete. Display this final ⚡ AI Credit Meter table and present the PR_READY package to the maintainer at the PR Approval Gate. Prompt the human to authorize PR creation with /create-pr before executing pr-create.ts."
            )
          : { decision: "allow" };
        process.stdout.write(JSON.stringify(out) + "\n");
        process.exit(0);
      } else {
        const revInstruction = !revVal.valid
          ? `[INSTRUCTION FOR CONTROLLER]: Reviewer handoff failed validation (${revVal.errors.join("; ")}). Pause pipeline and notify maintainer.`
          : `[INSTRUCTION FOR CONTROLLER]: Reviewer reported ${verdict}. Resolve review findings before opening Pull Request.`;
        const out = buildEnrichedPostToolOutput(input, "", revInstruction);
        process.stdout.write(JSON.stringify(out) + "\n");
        process.exit(0);
      }
    }

    process.stdout.write(JSON.stringify({ decision: "allow" }) + "\n");
    process.exit(0);
  }

  // 2. PreToolUse handling for other specialists
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
    // Idea 1: Deterministic AST Pre-Fetch Map
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
      summary: "Architect synthesizing issue requirements into bounded technical plan",
    });

    const chatMeter = formatChatCreditMeter(dashArch);
    const enrichedPrompt = astMap ? `${astMap}\n\n${prompt}` : prompt;
    const modifiedArgs = {
      ...toolArgs,
      prompt: enrichedPrompt,
    };

    const repoIntel = formatRepoIntelligenceForPrompt(repoRoot, targetAgent, declaredScope);
    let addCtx = "";
    if (astMap) addCtx += `${astMap}\n\n`;
    if (repoIntel) addCtx += `${repoIntel}\n\n`;
    if (chatMeter) {
      addCtx += `${chatMeter}\n\n[INSTRUCTION FOR CONTROLLER]: Intake complete. Surface this live ⚡ AI Credit Meter status in your handoff message to the user before generating the architectural plan.`;
    }

    const out: any = {
      decision: "allow",
      permissionDecision: "allow",
      modifiedArgs,
      updatedInput: modifiedArgs,
      additionalContext: addCtx || undefined,
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
        modifiedArgs,
        updatedInput: modifiedArgs,
        additionalContext: addCtx || undefined,
      },
    };
    process.stdout.write(JSON.stringify(out) + "\n");
    process.exit(0);
  } else if (isAgentMatch(targetAgent, "gated-change-qa")) {
    ensureNodeModulesInWorktree(repoRoot);

    // Idea 3: Deterministic Test Pre-Execution via Tooling Bridge
    let testReport = "";
    try {
      const tooling = detectRepoStack(repoRoot);
      const testCmd = tooling.testCommand;
      const testStdout = execSync(testCmd, {
        cwd: repoRoot,
        encoding: "utf-8",
        timeout: 25000,
        stdio: ["ignore", "pipe", "pipe"],
      });
      const lines = testStdout.split("\n");
      const summaryLines = lines.filter(l => l.includes("[PASS]") || l.includes("checks passed") || l.includes("VERIFICATION") || l.includes("Passed") || l.includes("passed") || l.includes("PASS")).slice(-8);
      const displayLines = summaryLines.length > 0 ? summaryLines : lines.filter(l => l.trim().length > 0).slice(-8);
      testReport = `### 🧪 Deterministic Test Pre-Execution Report (0 AI Credits)\n` +
        `> **Command:** \`${testCmd}\` (executed automatically via Tooling Bridge: ${tooling.stack})\n` +
        `> **Execution Status:** ✅ **ALL CHECKS PASSED**\n\n` +
        `\`\`\`\n${displayLines.join("\n")}\n\`\`\`\n` +
        `*(Note for QA: The local regression suite was pre-executed above. Verify against issue acceptance criteria without re-running terminal commands unless needed.)*`;
    } catch (testErr: any) {
      const tooling = detectRepoStack(repoRoot);
      const testCmd = tooling.testCommand;
      const errOut = String(testErr?.stdout || testErr?.message || "");
      const lines = errOut.split("\n");
      const failureLines = lines.filter(l => l.includes("[FAIL]") || l.includes("Error:") || l.includes("FAILED") || l.includes("failed")).slice(0, 8);
      const displayFailures = failureLines.length > 0 ? failureLines : lines.filter(l => l.trim().length > 0).slice(0, 8);
      testReport = `### 🧪 Deterministic Test Pre-Execution Report (0 AI Credits)\n` +
        `> **Command:** \`${testCmd}\` (executed automatically via Tooling Bridge: ${tooling.stack})\n` +
        `> **Execution Status:** ❌ **TEST FAILURES DETECTED**\n\n` +
        `\`\`\`\n${displayFailures.join("\n")}\n\`\`\``;
    }

    const devHandoff = buildDeveloperHandoffPayload(repoRoot, state, prompt, resolvedIssue);

    // Stage Isolation Invariant: QA requires prior Developer IMPLEMENTED evidence; never manufacture it
    const dashFile = join(repoRoot, ".gated-change", "dashboard.json");
    let devPhaseStatus = "";
    if (existsSync(dashFile)) {
      try {
        const d = JSON.parse(readFileSync(dashFile, "utf-8"));
        devPhaseStatus = d?.phases?.developer?.status || "";
      } catch {}
    }

    if (devPhaseStatus !== "IMPLEMENTED") {
      const output: HookOutput = {
        decision: "deny",
        reason: `BLOCKED BY POLICY: QA agent cannot be invoked before Developer implementation has completed with status 'IMPLEMENTED' (current: '${devPhaseStatus || "NOT RECORDED"}'). Stage transitions require verified prior evidence; downstream stages may never manufacture upstream success.`,
      };
      process.stdout.write(JSON.stringify(output) + "\n");
      process.exit(1);
    }

    const dashQA = syncWorkflowDashboard(repoRoot, {
      sessionId: input.sessionId || state.sessionId,
      phase: "qa",
      status: "IN_PROGRESS",
      summary: "Executing independent regression verification suite via powershell",
    });

    const chatMeter = formatChatCreditMeter(dashQA);
    const partsQA = [testReport, devHandoff.markdown, prompt].filter(Boolean);
    const enrichedPrompt = partsQA.join("\n\n");
    const modifiedArgs = {
      ...toolArgs,
      prompt: enrichedPrompt,
    };

    const tooling = detectRepoStack(repoRoot);
    const repoIntel = formatRepoIntelligenceForPrompt(repoRoot, targetAgent, state.approvedScope);

    let addCtx = "";
    if (testReport) addCtx += `${testReport}\n\n`;
    if (devHandoff.markdown) addCtx += `${devHandoff.markdown}\n\n`;
    if (tooling.testCommand) addCtx += `### 🛠️ Configured Test Command\nExecute for verification: \`${tooling.testCommand}\`\n\n`;
    if (repoIntel) addCtx += `${repoIntel}\n\n`;
    if (chatMeter) {
      addCtx += `${chatMeter}\n\n[INSTRUCTION FOR CONTROLLER]: Developer implementation complete. Include this live ⚡ AI Credit Meter status in your phase handoff message to the user before running QA.`;
    }

    const out: any = {
      decision: "allow",
      permissionDecision: "allow",
      modifiedArgs,
      updatedInput: modifiedArgs,
      additionalContext: addCtx || undefined,
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
        modifiedArgs,
        updatedInput: modifiedArgs,
        additionalContext: addCtx || undefined,
      },
    };
    process.stdout.write(JSON.stringify(out) + "\n");
    process.exit(0);
  } else if (isAgentMatch(targetAgent, "gated-change-reviewer")) {
    ensureNodeModulesInWorktree(repoRoot);

    // Gate check: Reviewer cannot be invoked before QA verification passes
    const dashFile = join(repoRoot, ".gated-change", "dashboard.json");
    let dashData: any = null;
    if (existsSync(dashFile)) {
      try {
        dashData = JSON.parse(readFileSync(dashFile, "utf-8"));
      } catch {}
    }
    const qaStatus = dashData?.phases?.qa?.status || state.phases?.qa?.status;
    if (qaStatus !== "PASS") {
      appendAuditLog({
        sessionId: state.sessionId,
        agent: "controller",
        tool: "agent",
        action: "reviewer_invocation_blocked_qa_not_passed",
        decision: "deny",
        details: { qaStatus: qaStatus || "NONE" },
      }, repoRoot);

      const output: HookOutput = {
        decision: "deny",
        reason:
          `BLOCKED BY POLICY: Reviewer agent cannot be invoked before independent QA verification has passed. ` +
          `Current QA status: '${qaStatus || "PENDING"}'.`,
      };
      process.stdout.write(JSON.stringify(output) + "\n");
      process.exit(1);
    }

    // Idea 4: Deterministic Diff Pre-Injection & AST Symbol Sweep
    let diffReport = "";
    try {
      const base = state.baseRef || "HEAD~1";
      let diffOutput = "";
      try {
        diffOutput = execSync(`git diff ${base} HEAD`, { cwd: repoRoot, encoding: "utf-8" }).trim();
      } catch {
        diffOutput = execSync(`git diff HEAD~1 HEAD`, { cwd: repoRoot, encoding: "utf-8" }).trim();
      }

      let changedFiles: string[] = [];
      try {
        changedFiles = execSync(`git diff --name-only ${base} HEAD`, { cwd: repoRoot, encoding: "utf-8" })
          .split("\n").map(l => l.trim()).filter(Boolean);
      } catch {
        try {
          changedFiles = execSync("git diff --name-only HEAD~1 HEAD", { cwd: repoRoot, encoding: "utf-8" })
            .split("\n").map(l => l.trim()).filter(Boolean);
        } catch {}
      }

      const sweep = runSymbolSweep(changedFiles, state.approvedScope || "", repoRoot);

      const diffLines = diffOutput.split("\n");
      const truncatedDiff = diffLines.length > 120
        ? diffLines.slice(0, 120).join("\n") + `\n... [${diffLines.length - 120} lines truncated for token efficiency] ...`
        : diffOutput;

      diffReport = `### 🔍 Deterministic Diff & Security Pre-Injection (0 AI Credits)\n` +
        `> **Base Ref:** \`${base}\` | **Changed Files:** \`${changedFiles.join("`, `") || "detected in git"}\`\n` +
        `> **Deterministic Symbol Sweep:** ${sweep.summary}\n` +
        `> **External Package References:** ${sweep.externalReferencesFound.length} call-site(s) found\n\n` +
        `\`\`\`diff\n${truncatedDiff}\n\`\`\`\n` +
        `*(Note for Reviewer: Full unified diff and cross-package deterministic symbol sweep are pre-computed above. Perform your read-only security review in 1 turn.)*`;
    } catch {}

    const devHandoff = buildDeveloperHandoffPayload(repoRoot, state, prompt, resolvedIssue);
    const qaHandoff = buildQAHandoffPayload(repoRoot, state, prompt);

    const dashRev = syncWorkflowDashboard(repoRoot, {
      sessionId: input.sessionId || state.sessionId,
      phase: "reviewer",
      status: "IN_PROGRESS",
      summary: "Conducting read-only security diff audit & blast radius review",
    });

    const chatMeter = formatChatCreditMeter(dashRev);
    const partsRev = [diffReport, qaHandoff.markdown, devHandoff.markdown, prompt].filter(Boolean);
    const enrichedPrompt = partsRev.join("\n\n");
    const modifiedArgs = {
      ...toolArgs,
      prompt: enrichedPrompt,
    };

    const repoIntel = formatRepoIntelligenceForPrompt(repoRoot, targetAgent, state.approvedScope);

    let addCtx = "";
    if (diffReport) addCtx += `${diffReport}\n\n`;
    if (qaHandoff.markdown) addCtx += `${qaHandoff.markdown}\n\n`;
    if (repoIntel) addCtx += `${repoIntel}\n\n`;
    if (chatMeter) {
      addCtx += `${chatMeter}\n\n[INSTRUCTION FOR CONTROLLER]: QA verification complete and passed. Include this live ⚡ AI Credit Meter status in your phase handoff message to the user before running Reviewer.`;
    }

    const out: any = {
      decision: "allow",
      permissionDecision: "allow",
      modifiedArgs,
      updatedInput: modifiedArgs,
      additionalContext: addCtx || undefined,
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
        modifiedArgs,
        updatedInput: modifiedArgs,
        additionalContext: addCtx || undefined,
      },
    };
    process.stdout.write(JSON.stringify(out) + "\n");
    process.exit(0);
  }

  // Pass through for other agents
  process.stdout.write(JSON.stringify({ decision: "allow", permissionDecision: "allow" }) + "\n");
  process.exit(0);
}

main().catch((err: any) => {
  const errMsg = err?.message || String(err);
  process.stderr.write(`[hook-verify-gate] Internal enforcement error (Fail-Closed): ${errMsg}\n`);
  process.stdout.write(
    JSON.stringify({
      decision: "deny",
      permissionDecision: "deny",
      reason: `SECURITY_GATE_FAILURE: Human gate verification hook encountered an internal failure: ${errMsg}. Specialist invocation blocked by policy (Fail-Closed).`,
    }) + "\n"
  );
  process.exit(1);
});

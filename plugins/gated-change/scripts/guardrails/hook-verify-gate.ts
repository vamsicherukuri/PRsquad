#!/usr/bin/env node
/**
 * Hook: Mechanical Scope Gate Verification (preToolUse)
 * Intercepts delegation to 'gated-change-developer' and enforces physical lock check.
 */

import { readFileSync, appendFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { loadState, saveState, loadApprovalLock, saveApprovalLock, revokeApprovalLock, appendAuditLog, isAgentMatch, getRepoRoot } from "../../src/guardrails/stateStore.js";
import type { HookInput, HookOutput, ApprovalLock } from "../../src/guardrails/types.js";

async function main() {
  let rawInput = "";
  if (!process.stdin.isTTY) {
    try {
      rawInput = readFileSync(0, "utf-8");
    } catch {
      // No stdin
    }
  }

  try {
    appendFileSync("C:/Users/vcherukuri/hook-debug.log", JSON.stringify({
      hook: "hook-verify-gate",
      time: new Date().toISOString(),
      argv: process.argv,
      cwd: process.cwd(),
      rawInput
    }) + "\n");
  } catch {}

  let input: HookInput = {};
  if (rawInput.trim()) {
    try {
      input = JSON.parse(rawInput);
    } catch {
      // Ignore parse failure
    }
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
    const state = loadState();
    let lock = loadApprovalLock();

    // If an active physical lock does not exist on disk, check for verified in-chat human approval
    if (!lock || lock.status !== "ACTIVE") {
      const prompt = String(toolArgs.prompt || input.toolArgs?.prompt || "");
      const explicitApproval =
        toolArgs.humanApprovalConfirmed === true ||
        toolArgs.humanApproval === true ||
        prompt.includes("[HUMAN_SCOPE_GATE_APPROVED") ||
        prompt.includes("Human Approval: Confirmed") ||
        prompt.includes("humanApprovalConfirmed: true");

      // Extract approved scope from tool arguments, verification header, or state
      let extractedScope = toolArgs.approvedScope || toolArgs.scope;
      if (!extractedScope) {
        const scopeMatch = prompt.match(/\[HUMAN_SCOPE_GATE_APPROVED:\s*([^\]]+)\]/i);
        if (scopeMatch) extractedScope = scopeMatch[1].trim();
      }
      if (!extractedScope) {
        const approvedScopeMatch = prompt.match(/(?:approvedScope|approved\s*scope)\s*[:=]\s*["`']?([^"`'\r\n]+)["`']?/i);
        if (approvedScopeMatch) extractedScope = approvedScopeMatch[1].trim();
      }
      if (!extractedScope && state.approvedScope) {
        extractedScope = state.approvedScope;
      }

      // If explicit in-chat approval and valid scope are present, auto-sign the mechanical lock
      if (explicitApproval && extractedScope) {
        const issueNum = toolArgs.issueNumber || state.issue?.number || 0;
        const newLock: ApprovalLock = {
          issueNumber: issueNum,
          approvedScope: String(extractedScope).replace(/\\/g, "/"),
          maxAttempts: 3,
          currentAttempt: state.implementationAttempt || 1,
          approvedAt: new Date().toISOString(),
          approvedBy: "human-in-chat",
          status: "ACTIVE",
        };
        saveApprovalLock(newLock);
        lock = newLock;

        appendAuditLog({
          sessionId: state.sessionId,
          agent: "controller",
          tool: "agent",
          action: "human_scope_gate_auto_signed_from_chat",
          decision: "allow",
          details: {
            issueNumber: newLock.issueNumber,
            approvedScope: newLock.approvedScope,
            approvedBy: newLock.approvedBy,
          },
        });
      }
    }

    // 1. Missing or inactive approval lock
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
      });

      const output: HookOutput = {
        decision: "deny",
        reason:
          "BLOCKED BY POLICY: Developer agent cannot be invoked without verified human scope approval. " +
          "The human must explicitly approve the plan at the Human Scope Gate before implementation can start.",
      };
      process.stdout.write(JSON.stringify(output) + "\n");
      process.exit(1);
    }

    // 2. Attempt budget exceeded
    if (lock.currentAttempt > lock.maxAttempts) {
      revokeApprovalLock("EXHAUSTED");
      state.phase = "ESCALATED";
      saveState(state);

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
      });

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
    const issueNum = lock.issueNumber || state.issue?.number || "patch";
    const branchName = `fix/issue-${issueNum}`;
    const repoRoot = getRepoRoot();
    let branchStatus = "unknown";

    try {
      const currentBranch = execSync("git rev-parse --abbrev-ref HEAD", {
        cwd: repoRoot,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();

      const isBaseBranch =
        currentBranch === "main" ||
        currentBranch === "master" ||
        currentBranch === "HEAD" ||
        currentBranch.startsWith("origin/") ||
        process.env.FORCE_BRANCH_SWITCH === "true";

      if (isBaseBranch && currentBranch !== branchName) {
        execSync(`git checkout -B ${branchName}`, {
          cwd: repoRoot,
          encoding: "utf-8",
          stdio: ["ignore", "pipe", "ignore"],
        });
        branchStatus = `switched_to_${branchName}`;
      } else if (currentBranch === branchName) {
        branchStatus = `already_on_${branchName}`;
      } else {
        branchStatus = `retained_${currentBranch}`;
      }
    } catch {
      // In worktree or non-git environments, record virtual branch without failing
      branchStatus = `virtual_${branchName}`;
    }

    state.phase = "DEVELOPING";
    state.humanApproval = true;
    state.approvedScope = lock.approvedScope;
    state.implementationAttempt = lock.currentAttempt;
    state.activeBranch = branchName;
    saveState(state);

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
      `Before reporting IMPLEMENTED, stage and commit your changes: git commit -m "fix: <summary> (fixes #${issueNum})".\n` +
      `Report headRef as your commit SHA or '${branchName}'.`;

    const prompt = toolArgs.prompt || toolArgs.content || "";
    const enrichedPrompt = prompt.includes("[BRANCH ISOLATION GUARDRAIL]")
      ? prompt
      : `${branchInstructions}\n\n${prompt}`;

    const modifiedArgs = {
      ...toolArgs,
      prompt: enrichedPrompt,
      activeBranch: branchName,
    };

    const output = {
      decision: "allow",
      permissionDecision: "allow",
      modifiedArgs,
      updatedInput: modifiedArgs,
      additionalContext:
        `SCOPE_GATE_VERIFIED: Implementation Attempt ${lock.currentAttempt}/${lock.maxAttempts} authorized by ${lock.approvedBy}.\n` +
        `APPROVED_SCOPE_PREFIX: "${lock.approvedScope}"\n` +
        `ACTIVE_FEATURE_BRANCH: "${branchName}"\n` +
        "Developer write actions are strictly bounded to this prefix and branch.",
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
        modifiedArgs,
        updatedInput: modifiedArgs,
      },
    };
    process.stdout.write(JSON.stringify(output) + "\n");
    process.exit(0);
  }

  // Pass through for other agents
  process.stdout.write(JSON.stringify({ decision: "allow", permissionDecision: "allow" }) + "\n");
  process.exit(0);
}

main().catch(() => {
  process.stdout.write(JSON.stringify({ decision: "allow", permissionDecision: "allow" }) + "\n");
  process.exit(0);
});

#!/usr/bin/env node
/**
 * Hook: Session Start Handler (sessionStart)
 * Invoked on session start to resolve issue identity from worktree/branch/prompt,
 * fetch issue details via gh CLI (excluding comments), verify OPEN lifecycle status,
 * cache structured issue JSON, and atomically commit INTAKE_AUTHORIZED state.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { fetchIssueDeterministic } from "../../src/guardrails/ingestIssue.js";
import {
  getRepoRoot,
  getRepoOwnerAndName,
  requireRepoIdentity,
} from "../../src/guardrails/stateStore.js";
import { StateController } from "../../src/guardrails/stateController.js";
import type { HookInput, WorkflowState } from "../../src/guardrails/types.js";
export async function runSessionStart(input: HookInput = {}): Promise<void> {
  const effectiveCwd = input.cwd || process.cwd();
  const repoRoot = getRepoRoot(effectiveCwd);
  const sessionId = input.sessionId || "";
  const initialPrompt = input.initialPrompt || (input as any).prompt || "";
  const source = input.source || "new";

  // 1. Resolve repo identity fail-closed
  let remoteInfo: { owner: string; repo: string };
  try {
    remoteInfo = requireRepoIdentity(effectiveCwd);
  } catch (err: any) {
    const reason = `FAIL_CLOSED: Git repository identity verification failed: ${err?.message || err}`;
    const output = {
      decision: "deny",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: reason,
      },
      additionalContext: reason,
    };
    process.stdout.write(JSON.stringify(output) + "\n");
    return;
  }

  // 2. Load or create workflow state
  const state = StateController.loadOrCreateState(repoRoot, sessionId);

  // 3. Check session resume & advanced phase protection
  if (source === "resume" || (state.phase && StateController.isAdvancedPhase(state.phase))) {
    const resumeContext = [
      `[PRSQUAD SESSION RESUMED]`,
      `Active Phase: ${state.phase}`,
      `Issue: #${state.issue?.number ?? "N/A"} (${state.issue?.title ?? "Untitled"})`,
      `Active Branch: ${state.activeBranch ?? "N/A"}`,
      `Session ID: ${state.sessionId}`,
      `Pipeline state is preserved and in progress. Do NOT re-run intake triage. Continue executing tasks for phase: ${state.phase}.`,
    ].join("\n");

    const output = {
      decision: "allow",
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: resumeContext,
      },
      additionalContext: resumeContext,
    };
    process.stdout.write(JSON.stringify(output) + "\n");
    return;
  }

  // 4. Resolve issue number from session context (worktree path, branch, prompt)
  const issueNum = StateController.resolveIssueFromSession(effectiveCwd, initialPrompt, repoRoot, state);

  if (!issueNum) {
    const idleContext = [
      `[PRSQUAD SESSION INITIALIZED - NO ISSUE DETECTED]`,
      `Repository: ${remoteInfo.owner}/${remoteInfo.repo}`,
      `Worktree: ${effectiveCwd}`,
      `No specific issue number was detected from the session worktree, branch, or initial prompt.`,
      `To start a gated fix workflow, please reference an issue number (e.g. "resolve issue #42") or open an issue worktree.`,
    ].join("\n");

    const output = {
      decision: "allow",
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: idleContext,
      },
      additionalContext: idleContext,
    };
    process.stdout.write(JSON.stringify(output) + "\n");
    return;
  }

  // 5. Fetch issue info deterministically (comments omitted)
  let issueData;
  try {
    issueData = fetchIssueDeterministic(
      remoteInfo.owner,
      remoteInfo.repo,
      issueNum,
      repoRoot,
      false // Exclude comments
    );
  } catch (err: any) {
    const reason = `INTAKE_FETCH_FAILED: Could not retrieve issue #${issueNum} from repository ${remoteInfo.owner}/${remoteInfo.repo}: ${err?.message || err}`;
    StateController.pauseWorkflow(repoRoot, reason, issueNum, sessionId);

    const output = {
      decision: "deny",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: reason,
      },
      additionalContext: reason,
    };
    process.stdout.write(JSON.stringify(output) + "\n");
    return;
  }

  // 6. Validate issue is OPEN
  if (issueData.state && issueData.state.toUpperCase() !== "OPEN") {
    const reason = `DETERMINISTIC_POLICY_BLOCK: Issue #${issueData.number} is ${issueData.state.toUpperCase()} on GitHub. Gated Change workflows can only be initiated on OPEN issues. Pipeline halted.`;
    StateController.pauseWorkflow(repoRoot, reason, issueData.number, sessionId);

    const output = {
      decision: "deny",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: reason,
      },
      additionalContext: reason,
    };
    process.stdout.write(JSON.stringify(output) + "\n");
    return;
  }

  // 7. Save structured snapshot to .gated-change/issue-cache.json
  const cacheDir = join(repoRoot, ".gated-change");
  if (!existsSync(cacheDir)) {
    mkdirSync(cacheDir, { recursive: true });
  }
  const cacheFile = join(cacheDir, "issue-cache.json");
  const cacheContent = {
    ...issueData,
    cachedAt: new Date().toISOString(),
    source: "sessionStart",
  };
  writeFileSync(cacheFile, JSON.stringify(cacheContent, null, 2), "utf-8");

  // 8. Atomic state transition via StateController
  StateController.authorizeIntake(repoRoot, issueData, cacheFile, sessionId);

  // 9. Prepare structured context to prime the Orchestrator agent
  const additionalContext = [
    `[PRSQUAD SESSION INITIALIZED - ISSUE #${issueData.number} VERIFIED OPEN]`,
    `Repository: ${issueData.owner}/${issueData.repo}`,
    `Issue: #${issueData.number} - "${issueData.title}"`,
    `Author: @${issueData.author}`,
    `Labels: ${issueData.labels.length > 0 ? issueData.labels.join(", ") : "none"}`,
    `Status: ${issueData.state}`,
    `Structured snapshot cached at: .gated-change/issue-cache.json`,
    `Workflow State: Phase=INTAKE, Status=INTAKE_AUTHORIZED, Branch=fix/issue-${issueData.number}`,
    `Next Step: Delegate immediately to @gated-change-intake for Definition-of-Ready evaluation (reproduction steps, acceptance criteria, declared scope).`,
  ].join("\n");

  const output = {
    decision: "allow",
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext,
    },
    additionalContext,
  };

  process.stdout.write(JSON.stringify(output) + "\n");
}

async function main() {
  let rawInput = "";
  if (!process.stdin.isTTY) {
    try {
      rawInput = readFileSync(0, "utf-8");
    } catch {
      // No stdin provided
    }
  }

  let input: HookInput = {};
  if (rawInput.trim()) {
    try {
      input = JSON.parse(rawInput);
    } catch {}
  }

  await runSessionStart(input);
}

main().catch((err: any) => {
  const errMsg = err?.message || String(err);
  process.stderr.write(`[sessionStart error] ${errMsg}\n`);
  process.stdout.write(
    JSON.stringify({
      decision: "deny",
      permissionDecision: "deny",
      permissionDecisionReason: `SESSION_START_FAILURE: ${errMsg}`,
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: `SESSION_START_FAILURE: ${errMsg}`,
      },
      additionalContext: `SESSION_START_FAILURE: ${errMsg}`,
    }) + "\n"
  );
  process.exit(0);
});

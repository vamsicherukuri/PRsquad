#!/usr/bin/env node
/**
 * Hook: Session Start Handler (sessionStart)
 * Invoked on session start to resolve issue identity from worktree/branch/prompt,
 * fetch issue details via gh CLI (excluding comments), verify OPEN lifecycle status,
 * cache structured issue JSON, and atomically commit INTAKE_AUTHORIZED state.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fetchIssueDeterministic } from "../../src/guardrails/ingestIssue.js";
import {
  getRepoRoot,
  requireRepoIdentity,
} from "../../src/guardrails/stateStore.js";
import { StateController } from "../../src/guardrails/stateController.js";
import type { HookInput } from "../../src/guardrails/types.js";
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

  // 4. Extract issue number explicitly in sessionStart.ts
  // 4A. Native Copilot App <copilot_issue_context> XML block parsing
  const xmlIssueMatch = initialPrompt.match(/issue_number:\s*(\d+)/i);
  const xmlRepoMatch = initialPrompt.match(/issue_repo_full_name:\s*([^\s\n\r]+)/i);

  let issueNum: number | null = xmlIssueMatch ? parseInt(xmlIssueMatch[1], 10) : null;
  if (xmlRepoMatch && xmlRepoMatch[1].includes("/")) {
    const [extOwner, extRepo] = xmlRepoMatch[1].split("/");
    remoteInfo.owner = extOwner;
    remoteInfo.repo = extRepo;
  }

  // 4B. User chat prompt patterns, worktree directory name, git branch, or active state
  if (!issueNum) {
    issueNum = StateController.resolveIssueFromSession(effectiveCwd, initialPrompt, repoRoot, state);
  }

  if (!issueNum) {
    const reason = "No explicit issue number detected in prompt. Please provide an issue number (e.g. 'resolve issue #42').";
    StateController.recordIssueValidation(
      repoRoot,
      {
        validation: "ISSUE_UNRESOLVED",
        intake: "BLOCKED",
        reason,
      },
      sessionId
    );

    const unresolvedEnvelope = {
      runId: sessionId,
      validation: "ISSUE_UNRESOLVED",
      intake: "BLOCKED",
      message: reason,
    };
    const additionalContext = JSON.stringify(unresolvedEnvelope, null, 2);

    const output = {
      decision: "allow",
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext,
      },
      additionalContext,
    };
    process.stdout.write(JSON.stringify(output) + "\n");
    return;
  }

  // 5. Fetch issue info deterministically (comments omitted to prevent prompt bloat)
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
    StateController.recordIssueValidation(
      repoRoot,
      {
        validation: "FAIL",
        issue: { owner: remoteInfo.owner, repo: remoteInfo.repo, number: issueNum, state: "UNKNOWN" },
        intake: "BLOCKED",
        reason,
      },
      sessionId
    );

    const failEnvelope = {
      runId: sessionId,
      issue: {
        repository: `${remoteInfo.owner}/${remoteInfo.repo}`,
        number: issueNum,
        state: "UNKNOWN",
      },
      validation: "FAIL",
      intake: "BLOCKED",
      error: reason,
    };
    const additionalContext = JSON.stringify(failEnvelope, null, 2);

    const output = {
      decision: "deny",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext,
      },
      additionalContext,
    };
    process.stdout.write(JSON.stringify(output) + "\n");
    return;
  }

  // 6. Validate issue is OPEN (block CLOSED issues)
  if (issueData.state && issueData.state.toUpperCase() !== "OPEN") {
    const reason = `DETERMINISTIC_POLICY_BLOCK: Issue #${issueData.number} is ${issueData.state.toUpperCase()} on GitHub. Gated Change workflows can only be initiated on OPEN issues. Pipeline halted.`;
    StateController.recordIssueValidation(
      repoRoot,
      {
        validation: "FAIL",
        issue: issueData,
        intake: "BLOCKED",
        reason,
      },
      sessionId
    );

    const closedEnvelope = {
      runId: sessionId,
      issue: {
        repository: `${issueData.owner}/${issueData.repo}`,
        number: issueData.number,
        state: issueData.state.toUpperCase(),
      },
      validation: "FAIL",
      intake: "BLOCKED",
      reason,
    };
    const additionalContext = JSON.stringify(closedEnvelope, null, 2);

    const output = {
      decision: "deny",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext,
      },
      additionalContext,
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

  // 8. Explicitly record validation in Workflow State via StateController
  StateController.recordIssueValidation(
    repoRoot,
    {
      validation: "PASS",
      issue: issueData,
      intake: "READY",
      issueSnapshot: "issue-cache.json",
      nextStage: "INTAKE",
    },
    sessionId
  );

  // 9. Inject compact JSON envelope as deterministic handoff context
  const handoffEnvelope = {
    runId: sessionId,
    issue: {
      repository: `${issueData.owner}/${issueData.repo}`,
      number: issueData.number,
      state: "OPEN",
    },
    validation: "PASS",
    intake: "READY",
    issueSnapshot: "issue-cache.json",
    nextStage: "INTAKE",
  };
  const additionalContext = JSON.stringify(handoffEnvelope, null, 2);

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

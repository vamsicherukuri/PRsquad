#!/usr/bin/env node
/**
 * Hook: Deterministic Issue Ingestion (preToolUse)
 * Intercepts delegation to 'gated-change-intake', fetches the issue via gh CLI
 * (or fallback fixture), and injects verified structured issue context.
 */

import { readFileSync, appendFileSync } from "node:fs";
import { fetchIssueDeterministic, formatIntakePayload } from "../../src/guardrails/ingestIssue.js";
import { loadState, saveState, appendAuditLog, isAgentMatch, getRepoOwnerAndName, getRepoRoot } from "../../src/guardrails/stateStore.js";
import { syncWorkflowDashboard } from "../../src/guardrails/issueDashboard.js";
import type { HookInput, HookOutput } from "../../src/guardrails/types.js";

async function main() {
  let rawInput = "";
  if (!process.stdin.isTTY) {
    try {
      rawInput = readFileSync(0, "utf-8");
    } catch {
      // No stdin provided
    }
  }

  try {
    appendFileSync("C:/Users/vcherukuri/hook-debug.log", JSON.stringify({
      hook: "hook-intake-ingest",
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

  // Only intercept when invoking gated-change-intake (supports qualified names)
  if (isAgentMatch(targetAgent, "gated-change-intake")) {
    const repoRoot = getRepoRoot();
    const state = loadState(repoRoot);
    const prompt = toolArgs.prompt || input.toolArgs?.prompt || "";

    // Extract issue number accurately
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

    // Extract owner and repo dynamically from remote origin or prompt
    const remoteInfo = getRepoOwnerAndName(repoRoot);
    let owner = state.issue?.owner || remoteInfo.owner || "vamsicherukuri";
    let repo = state.issue?.repo || remoteInfo.repo || "gated-fix-pipeline";
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

      // Deterministic lifecycle guardrail: strictly require OPEN
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
            state: issueData.state,
          },
        });

        const reason = `DETERMINISTIC_POLICY_BLOCK: Issue #${issueData.number} has lifecycle status ${issueData.state} on GitHub. Gated Change workflows can only be initiated on OPEN issues. Pipeline halted.`;
        const output = {
          decision: "deny",
          permissionDecision: "deny",
          permissionDecisionReason: reason,
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "deny",
            permissionDecisionReason: reason,
          },
        };
        process.stdout.write(JSON.stringify(output) + "\n");
        process.exit(0);
      }

      const payload = formatIntakePayload(issueData, state.intakeRound);

      // Update state
      state.issue = { owner, repo, number: issueData.number, title: issueData.title, body: issueData.body };
      state.phase = "INTAKE";
      if (input.sessionId) {
        state.sessionId = input.sessionId;
      }
      saveState(state);

      syncWorkflowDashboard(process.cwd(), {
        owner,
        repo,
        issueNumber: issueData.number,
        issueTitle: issueData.title,
        sessionId: input.sessionId || state.sessionId,
        phase: "intake",
        status: "READY",
        summary: `Deterministic triage verified OPEN status with verified criteria`,
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
          round: state.intakeRound,
        },
      });

      const enrichedPrompt = prompt.includes("PRE_FETCHED_ISSUE_PAYLOAD")
        ? prompt
        : `${prompt}\n\nPRE_FETCHED_ISSUE_PAYLOAD:\n${payload}`;

      const modifiedArgs = {
        ...toolArgs,
        prompt: enrichedPrompt,
      };

      const output = {
        decision: "allow",
        permissionDecision: "allow",
        modifiedArgs,
        updatedInput: modifiedArgs,
        additionalContext: `PRE_FETCHED_ISSUE_PAYLOAD:\n${payload}`,
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "allow",
          modifiedArgs,
          updatedInput: modifiedArgs,
          additionalContext: `PRE_FETCHED_ISSUE_PAYLOAD:\n${payload}`,
        },
      };
      process.stdout.write(JSON.stringify(output) + "\n");
      process.exit(0);
    } catch (err: any) {
      appendAuditLog({
        sessionId: state.sessionId,
        agent: "controller",
        tool: "agent",
        action: "deterministic_issue_ingestion_warning",
        decision: "allow",
        details: { error: err.message },
      });

      // Pass through gracefully so Intake specialist can report standard FETCH_FAILED
      const output = {
        decision: "allow",
        permissionDecision: "allow",
        additionalContext: `ISSUE_INGESTION_NOTICE: Could not pre-fetch issue #${issueNum} via gh CLI: ${err.message}. Specialist should proceed with standard triage.`,
      };
      process.stdout.write(JSON.stringify(output) + "\n");
      process.exit(0);
    }
  }

  // Pass through for other tools/agents
  process.stdout.write(JSON.stringify({ decision: "allow", permissionDecision: "allow" }) + "\n");
  process.exit(0);
}

main().catch(() => {
  process.stdout.write(JSON.stringify({ decision: "allow", permissionDecision: "allow" }) + "\n");
  process.exit(0);
});

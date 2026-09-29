#!/usr/bin/env node
/**
 * Hook: Deterministic Issue Ingestion (preToolUse)
 * Intercepts delegation to 'gated-change-intake', fetches the issue via gh CLI
 * (or fallback fixture), and injects verified structured issue context.
 */

import { readFileSync } from "node:fs";
import { fetchIssueDeterministic, formatIntakePayload } from "../../src/guardrails/ingestIssue.js";
import { loadState, saveState, appendAuditLog, isAgentMatch } from "../../src/guardrails/stateStore.js";
import type { HookInput, HookOutput } from "../../src/guardrails/types.js";

async function main() {
  let rawInput = "";
  try {
    rawInput = readFileSync(0, "utf-8");
  } catch {
    // No stdin provided
  }

  let input: HookInput = {};
  if (rawInput.trim()) {
    try {
      input = JSON.parse(rawInput);
    } catch {
      // Ignore parse failure
    }
  }

  const targetAgent = input.toolArgs?.name || input.toolArgs?.agent || input.agent;

  // Only intercept when invoking gated-change-intake (supports qualified names)
  if (isAgentMatch(targetAgent, "gated-change-intake")) {
    const state = loadState();
    const prompt = input.toolArgs?.prompt || "";

    // Extract issue number and owner/repo from prompt or state
    const issueMatch = prompt.match(/(?:issue\s*#?|#)(\d+)/i) || prompt.match(/(\d+)/);
    const issueNum = issueMatch ? parseInt(issueMatch[1], 10) : state.issue.number || 1;
    const repoMatch = prompt.match(/([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)/);
    const owner = repoMatch ? repoMatch[1].replace(/[.,!?;:]+$/, "") : (state.issue.owner || "vamsicherukuri");
    const repo = repoMatch ? repoMatch[2].replace(/[.,!?;:]+$/, "") : (state.issue.repo || "gated-fix-pipeline");

    try {
      const issueData = fetchIssueDeterministic(owner, repo, issueNum);
      const payload = formatIntakePayload(issueData, state.intakeRound);

      // Update state
      state.issue = { owner, repo, number: issueData.number, title: issueData.title };
      state.phase = "INTAKE";
      saveState(state);

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

      const output: HookOutput = {
        decision: "allow",
        additionalContext: `PRE_FETCHED_ISSUE_PAYLOAD:\n${payload}`,
      };
      process.stdout.write(JSON.stringify(output) + "\n");
      process.exit(0);
    } catch (err: any) {
      appendAuditLog({
        sessionId: state.sessionId,
        agent: "controller",
        tool: "agent",
        action: "deterministic_issue_ingestion_failed",
        decision: "deny",
        details: { error: err.message },
      });

      const output: HookOutput = {
        decision: "deny",
        reason: `FETCH_FAILED: Deterministic ingestion could not retrieve issue #${issueNum}: ${err.message}`,
      };
      process.stdout.write(JSON.stringify(output) + "\n");
      process.exit(1);
    }
  }

  // Pass through for other tools/agents
  process.stdout.write(JSON.stringify({ decision: "allow" }) + "\n");
  process.exit(0);
}

main().catch(() => {
  process.stdout.write(JSON.stringify({ decision: "allow" }) + "\n");
  process.exit(0);
});

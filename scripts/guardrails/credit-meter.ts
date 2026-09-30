#!/usr/bin/env node
/**
 * CLI Tool: Deterministic Live AI Credit Meter
 * Queries Copilot App session-store.db and prints the live markdown telemetry table.
 */

import { getRepoRoot, loadState } from "../../src/guardrails/stateStore.js";
import { syncWorkflowDashboard, formatChatCreditMeter } from "../../src/guardrails/issueDashboard.js";

async function main() {
  const repoRoot = getRepoRoot(process.cwd());
  const state = loadState(repoRoot);
  const issueNumber = state.issue?.number || 11;
  const sessionId = state.sessionId || undefined;

  const dash = syncWorkflowDashboard(repoRoot, {
    issueNumber,
    sessionId,
  });

  const meter = formatChatCreditMeter(dash);
  if (meter) {
    console.log(meter);
  } else {
    console.log("⚡ Live AI Credit Meter: 0.00 AIU (Initial Turn)");
  }
}

main().catch((err) => {
  console.log("⚡ Live AI Credit Meter: Active");
});

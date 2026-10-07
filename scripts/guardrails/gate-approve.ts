#!/usr/bin/env node
/**
 * CLI Tool: Human Scope Gate Approver / Rejecter
 * Usage:
 *   npx tsx scripts/guardrails/gate-approve.ts --scope src/services/auth/ [--issue 42] [--approver vamsi]
 *   npx tsx scripts/guardrails/gate-approve.ts --reject [--reason "Need to exclude utils"]
 */

import { loadState, saveState, revokeApprovalLock, appendAuditLog, getRepoRoot } from "../../src/guardrails/stateStore.js";
import { approveScopeGate } from "../../src/guardrails/scopeApprover.js";

function parseArgs(args: string[]): Record<string, string | boolean> {
  const result: Record<string, string | boolean> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith("--")) {
        result[key] = next;
        i++;
      } else {
        result[key] = true;
      }
    }
  }
  return result;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const targetDir = typeof args.dir === "string" ? args.dir : process.cwd();
  const repoRoot = getRepoRoot(targetDir);
  const state = loadState(repoRoot);

  if (args.reject) {
    const reason = typeof args.reason === "string" ? args.reason : "Rejected by human approver";
    revokeApprovalLock("REVOKED", repoRoot);

    state.phase = "PAUSED";
    state.humanApproval = false;
    state.scopeRevisionCount += 1;
    saveState(state, repoRoot);

    appendAuditLog({
      sessionId: state.sessionId,
      action: "human_scope_gate_rejected",
      decision: "deny",
      details: {
        reason,
        revisionCount: state.scopeRevisionCount,
      },
    }, repoRoot);

    console.log(`[Scope Gate] REJECTED: ${reason}`);
    console.log(`[Scope Gate] Scope revision count: ${state.scopeRevisionCount}/${state.maxScopeRevisions}`);
    process.exit(0);
  }

  const customScope = typeof args.scope === "string" ? args.scope : undefined;
  const issueNum = typeof args.issue === "string" ? parseInt(args.issue, 10) : undefined;
  const approver = typeof args.approver === "string" ? args.approver : "Human Maintainer (/approve)";

  const result = approveScopeGate({
    preferredDir: repoRoot,
    scope: customScope,
    issue: issueNum,
    approver,
  });

  if (result.success && result.lock) {
    console.log(`[Scope Gate] APPROVED!`);
    console.log(`  Issue: #${result.lock.issueNumber}`);
    console.log(`  Scope: ${result.lock.approvedScope}`);
    console.log(`  Approver: ${result.lock.approvedBy}`);
    console.log(`  Lock file written to .gated-change/approval.lock`);
    console.log(`  Developer agent is now authorized to execute.`);
    process.exit(0);
  } else {
    console.error(`[Scope Gate Error] ${result.error}`);
    process.exit(1);
  }
}

main();

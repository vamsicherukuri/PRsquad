#!/usr/bin/env node
/**
 * CLI Tool: Human Scope Gate Approver / Rejecter
 * Usage:
 *   npx tsx scripts/guardrails/gate-approve.ts --scope src/services/auth/ [--issue 42] [--approver vamsi]
 *   npx tsx scripts/guardrails/gate-approve.ts --reject [--reason "Need to exclude utils"]
 */

import { loadState, saveState, saveApprovalLock, revokeApprovalLock, appendAuditLog } from "../../src/guardrails/stateStore.js";
import type { ApprovalLock } from "../../src/guardrails/types.js";

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
  const state = loadState();

  if (args.reject) {
    const reason = typeof args.reason === "string" ? args.reason : "Rejected by human approver";
    revokeApprovalLock("REVOKED");

    state.phase = "PAUSED";
    state.humanApproval = false;
    state.scopeRevisionCount += 1;
    saveState(state);

    appendAuditLog({
      sessionId: state.sessionId,
      action: "human_scope_gate_rejected",
      decision: "deny",
      details: {
        reason,
        revisionCount: state.scopeRevisionCount,
      },
    });

    console.log(`[Scope Gate] REJECTED: ${reason}`);
    console.log(`[Scope Gate] Scope revision count: ${state.scopeRevisionCount}/${state.maxScopeRevisions}`);
    process.exit(0);
  }

  const scope = typeof args.scope === "string" ? args.scope : state.approvedScope;
  if (!scope) {
    console.error("[Scope Gate Error] Must specify --scope <path/prefix/> to approve.");
    process.exit(1);
  }

  const issueNumber =
    typeof args.issue === "string"
      ? parseInt(args.issue, 10)
      : state.issue.number || 42;

  const approver = typeof args.approver === "string" ? args.approver : "human-user";

  const lock: ApprovalLock = {
    issueNumber,
    approvedScope: scope.replace(/\\/g, "/"),
    maxAttempts: 3,
    currentAttempt: 1,
    approvedAt: new Date().toISOString(),
    approvedBy: approver,
    status: "ACTIVE",
  };

  saveApprovalLock(lock);

  state.approvedScope = lock.approvedScope;
  state.humanApproval = true;
  state.phase = "DEVELOPING";
  state.implementationAttempt = 1;
  saveState(state);

  appendAuditLog({
    sessionId: state.sessionId,
    action: "human_scope_gate_approved",
    decision: "allow",
    details: {
      approvedScope: lock.approvedScope,
      issueNumber: lock.issueNumber,
      approvedBy: lock.approvedBy,
      maxAttempts: lock.maxAttempts,
    },
  });

  console.log(`[Scope Gate] APPROVED!`);
  console.log(`  Issue: #${lock.issueNumber}`);
  console.log(`  Scope: ${lock.approvedScope}`);
  console.log(`  Approver: ${lock.approvedBy}`);
  console.log(`  Lock file written to .gated-change/approval.lock`);
  console.log(`  Developer agent is now authorized to execute.`);
}

main();

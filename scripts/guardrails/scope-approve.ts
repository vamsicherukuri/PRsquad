#!/usr/bin/env node
/**
 * CLI Tool: Deterministic Human Scope Gate Approver
 * Executed when human maintains authorize implementation via /approve.
 * Creates the deterministically verified approval.lock file on disk with approval integrity binding.
 * 
 * Enforces the core invariant: "The model cannot approve itself."
 */

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

async function main() {
  console.log("=======================================================");
  console.log("  PRSQUAD — DETERMINISTIC SCOPE GATE AUTHORIZATION");
  console.log("=======================================================");

  const args = parseArgs(process.argv.slice(2));
  const targetDir = typeof args.dir === "string" ? args.dir : process.cwd();
  const customScope = typeof args.scope === "string" ? args.scope : undefined;
  const issueNum = typeof args.issue === "string" ? parseInt(args.issue, 10) : undefined;
  const approver = typeof args.approver === "string" ? args.approver : "Human Maintainer (/approve)";

  const result = approveScopeGate({
    preferredDir: targetDir,
    scope: customScope,
    issue: issueNum,
    approver,
  });

  if (result.success && result.lock) {
    console.log(`\n✅ SCOPE APPROVAL LOCK MINTED!`);
    console.log(`   Issue: #${result.lock.issueNumber}`);
    console.log(`   Approved Scope: ${result.lock.approvedScope}`);
    console.log(`   Authorized By: ${result.lock.approvedBy}`);
    console.log(`   Approved At: ${result.lock.approvedAt}`);
    console.log(`   Lock file: .gated-change/approval.lock`);
    console.log(`\nDeveloper agent is now authorized to implement changes strictly within this boundary.`);
    process.exit(0);
  } else {
    console.error(`\n❌ Failed to approve Scope Gate:`);
    console.error(`   ${result.error}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal error authorizing Scope Gate:", err);
  process.exit(1);
});

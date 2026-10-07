#!/usr/bin/env node
/**
 * Hook: Deterministic Write-Scope Barrier (preToolUse)
 * Intercepts all 'edit' tool calls and blocks modifications outside the approved scope.
 */

import { readFileSync } from "node:fs";
import { isEditAllowed, formatScopeDenialNudge } from "../../src/guardrails/scopeEnforcer.js";
import { loadState, appendAuditLog, getRepoRoot } from "../../src/guardrails/stateStore.js";
import type { HookInput, HookOutput } from "../../src/guardrails/types.js";

async function main() {
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
  const tool = (input.toolName || input.tool || firstTool?.name || "").toLowerCase();
  const toolArgs = input.toolArgs || firstTool?.args || {};
  const targetPath =
    toolArgs.path ||
    toolArgs.file ||
    toolArgs.targetFile ||
    toolArgs.filePath;

  const isEditTool =
    tool === "edit" ||
    tool === "edit_file" ||
    tool === "write_to_file" ||
    tool === "create_file" ||
    tool === "write" ||
    tool.includes("edit");

  // Only enforce write scope if this is an edit tool and has a valid file path target
  if (isEditTool && targetPath && typeof targetPath === "string") {
    const effectiveCwd = input.cwd || process.cwd();
    const repoRoot = getRepoRoot(effectiveCwd);
    const state = loadState(repoRoot);
    const result = isEditAllowed(targetPath || "", state.approvedScope, repoRoot);

    if (!result.allowed) {
      const nudge = formatScopeDenialNudge(
        result.normalizedPath,
        state.approvedScope || "NONE"
      );

      appendAuditLog({
        sessionId: state.sessionId,
        agent: input.agent || "prsquad-dev",
        tool: "edit",
        action: "write_blocked_out_of_scope",
        decision: "deny",
        details: {
          attemptedPath: targetPath,
          normalizedPath: result.normalizedPath,
          approvedScope: state.approvedScope,
          reason: result.reason,
        },
      }, repoRoot);

      const output = {
        decision: "deny",
        permissionDecision: "deny",
        reason: nudge,
        permissionDecisionReason: nudge,
      };
      process.stdout.write(JSON.stringify(output) + "\n");
      process.exit(0);
    }

    // Write is in scope
    appendAuditLog({
      sessionId: state.sessionId,
      agent: input.agent || "prsquad-dev",
      tool: "edit",
      action: "write_allowed_in_scope",
      decision: "allow",
      details: {
        path: result.normalizedPath,
        approvedScope: state.approvedScope,
      },
    }, repoRoot);

    process.stdout.write(JSON.stringify({ decision: "allow", permissionDecision: "allow" }) + "\n");
    process.exit(0);
  }

  // Pass through for non-edit tools
  process.stdout.write(JSON.stringify({ decision: "allow", permissionDecision: "allow" }) + "\n");
  process.exit(0);
}

main().catch((err: any) => {
  const errMsg = err?.message || String(err);
  process.stderr.write(`[hook-enforce-scope] Internal enforcement error (Fail-Closed): ${errMsg}\n`);
  process.stdout.write(
    JSON.stringify({
      decision: "deny",
      permissionDecision: "deny",
      reason: `SECURITY_ENFORCEMENT_FAILURE: Scope enforcement hook encountered an unexpected error: ${errMsg}. File modification blocked by policy (Fail-Closed).`,
    }) + "\n"
  );
  process.exit(0);
});

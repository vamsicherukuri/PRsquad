#!/usr/bin/env node
/**
 * Hook: Shell Command Sandbox (preToolUse)
 * Intercepts all 'bash' tool calls and validates commands based on the active agent's role.
 */

import { readFileSync } from "node:fs";
import { validateCommandForAgent } from "../../src/guardrails/bashSandbox.js";
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
  const command = toolArgs.command || toolArgs.cmd || "";
  const agent = input.agent || toolArgs.agent_type || "unknown";

  const isShellTool =
    tool === "bash" ||
    tool === "powershell" ||
    tool === "pwsh" ||
    tool === "execute" ||
    tool === "terminal" ||
    tool === "shell" ||
    tool.includes("bash") ||
    tool.includes("powershell") ||
    tool.includes("terminal");

  if (isShellTool && command) {
    const effectiveCwd = input.cwd || process.cwd();
    const repoRoot = getRepoRoot(effectiveCwd);
    const state = loadState(repoRoot);
    const result = validateCommandForAgent(command, agent, repoRoot);

    if (!result.allowed) {
      appendAuditLog({
        sessionId: state.sessionId,
        agent,
        tool: tool.includes("powershell") ? "powershell" : "bash",
        action: "command_blocked_by_sandbox",
        decision: "deny",
        details: {
          command,
          reason: result.reason,
        },
      }, repoRoot);

      const output = {
        decision: "deny",
        permissionDecision: "deny",
        reason: result.reason || "POLICY_DENIAL: Command blocked by guardrail.",
        permissionDecisionReason: result.reason || "POLICY_DENIAL: Command blocked by guardrail.",
      };
      process.stdout.write(JSON.stringify(output) + "\n");
      process.exit(0);
    }

    appendAuditLog({
      sessionId: state.sessionId,
      agent,
      tool: tool.includes("powershell") ? "powershell" : "bash",
      action: "command_allowed",
      decision: "allow",
      details: { command },
    }, repoRoot);

    process.stdout.write(JSON.stringify({ decision: "allow", permissionDecision: "allow" }) + "\n");
    process.exit(0);
  }

  // Pass through
  process.stdout.write(JSON.stringify({ decision: "allow", permissionDecision: "allow" }) + "\n");
  process.exit(0);
}

main().catch((err: any) => {
  const errMsg = err?.message || String(err);
  process.stderr.write(`[hook-sandbox-bash] Internal enforcement error (Fail-Closed): ${errMsg}\n`);
  process.stdout.write(
    JSON.stringify({
      decision: "deny",
      permissionDecision: "deny",
      reason: `SECURITY_SANDBOX_FAILURE: Shell sandbox hook encountered an unexpected error: ${errMsg}. Command execution blocked by policy (Fail-Closed).`,
    }) + "\n"
  );
  process.exit(0);
});

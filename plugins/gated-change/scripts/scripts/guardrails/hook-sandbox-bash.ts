#!/usr/bin/env node
/**
 * Hook: Shell Command Sandbox (preToolUse)
 * Intercepts all 'bash' tool calls and validates commands based on the active agent's role.
 */

import { readFileSync } from "node:fs";
import { validateCommandForAgent } from "../../src/guardrails/bashSandbox.js";
import { loadState, appendAuditLog } from "../../src/guardrails/stateStore.js";
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
    try {
      input = JSON.parse(rawInput);
    } catch {
      // Ignore parse failure
    }
  }

  const tool = input.tool || "bash";
  const command = input.toolArgs?.command || input.toolArgs?.cmd || "";
  const agent = input.agent || "unknown";

  if (tool === "bash" && command) {
    const state = loadState();
    const result = validateCommandForAgent(command, agent);

    if (!result.allowed) {
      appendAuditLog({
        sessionId: state.sessionId,
        agent,
        tool: "bash",
        action: "command_blocked_by_sandbox",
        decision: "deny",
        details: {
          command,
          reason: result.reason,
        },
      });

      const output = {
        decision: "deny",
        permissionDecision: "deny",
        reason: result.reason || "POLICY_DENIAL: Command blocked by guardrail.",
        permissionDecisionReason: result.reason || "POLICY_DENIAL: Command blocked by guardrail.",
      };
      process.stdout.write(JSON.stringify(output) + "\n");
      process.exit(1);
    }

    appendAuditLog({
      sessionId: state.sessionId,
      agent,
      tool: "bash",
      action: "command_allowed",
      decision: "allow",
      details: { command },
    });

    process.stdout.write(JSON.stringify({ decision: "allow", permissionDecision: "allow" }) + "\n");
    process.exit(0);
  }

  // Pass through
  process.stdout.write(JSON.stringify({ decision: "allow", permissionDecision: "allow" }) + "\n");
  process.exit(0);
}

main().catch(() => {
  process.stdout.write(JSON.stringify({ decision: "allow", permissionDecision: "allow" }) + "\n");
  process.exit(0);
});

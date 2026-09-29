import { CopilotClient, approveAll, type Tool } from "@github/copilot-sdk";
import type { AgentDefinition } from "./loadAgent.js";

/**
 * Extracts the assistant's final JSON reply from a Copilot session run against one agent.
 * Shared by the local CLI orchestrator (orchestrator.ts) and the per-stage GitHub Actions
 * scripts (src/actions/*) so both drive agents identically - one source of truth for how a
 * pipeline stage actually talks to Copilot.
 */
export async function runAgentJSON<T>(
  client: CopilotClient,
  agent: AgentDefinition,
  userPrompt: string,
  extraTools: Tool<any>[] = []
): Promise<T> {
  const session = await client.createSession({
    // "append" mode, deliberately: it layers each agent's narrow mandate (implementation-plan.md §7)
    // on top of the SDK's own system prompt while keeping the SDK's built-in guardrails and security
    // restrictions intact. "replace" mode drops those guardrails entirely, which cuts against the
    // governance story this whole design is built around.
    systemMessage: { mode: "append", content: agent.systemMessage },
    tools: extraTools,
    onPermissionRequest: approveAll,
  });

  const result = await session.sendAndWait({ prompt: userPrompt });
  const finalText = result?.data.content ?? "";

  const jsonMatch = finalText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(
      `${agent.name} did not return parseable JSON. Raw reply:\n${finalText}`
    );
  }
  return JSON.parse(jsonMatch[0]) as T;
}

export { CopilotClient };

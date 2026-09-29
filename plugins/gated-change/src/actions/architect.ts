import { CopilotClient } from "@github/copilot-sdk";
import { loadAgent } from "../loadAgent.js";
import { runAgentJSON } from "../copilotAgent.js";
import { makeScopedReadTool } from "../scopeTool.js";
import { fetchIssue, postComment, setJobOutput } from "./ghIssue.js";
import type { Plan } from "../types.js";

/** Step 02 (Architect) as its own job - read access bounded to the declared scope, per §5b/§6. */
async function main() {
  const issueNumber = Number(process.argv[2]);
  const declaredScope = process.argv[3];
  if (!issueNumber || !declaredScope) {
    console.error("Usage: tsx src/actions/architect.ts <issue-number> <declared-scope>");
    process.exit(1);
  }

  const issue = fetchIssue(issueNumber);
  const agent = loadAgent("harness/agents/architect.agent.md");
  const client = new CopilotClient();
  await client.start();

  const tool = makeScopedReadTool(declaredScope, process.cwd());
  const prompt =
    `Issue #${issue.number}: ${issue.title}\n\n${issue.body}\n\nDeclared scope: ${declaredScope}`;
  const plan = await runAgentJSON<Plan>(client, agent, prompt, [tool]);
  console.log("[Architect]", plan);

  const changesList = plan.changes
    .map((c) => `- \`${c.file}\` (${c.type}) - ${c.reason}`)
    .join("\n");
  const outsideScope = plan.blastRadius.affectedOutsideScope.length
    ? `\n\n⚠️ Also touches outside declared scope: ${plan.blastRadius.affectedOutsideScope.join(", ")}`
    : "";

  postComment(
    issueNumber,
    `**Step 02 - Plan drafted (Architect)**\n\n` +
      `**Root cause:** ${plan.rootCause}\n\n` +
      `**Changes:**\n${changesList}\n\n` +
      `**Blast radius:** ${plan.blastRadius.risk}${outsideScope}\n\n` +
      `**Summary for approval:** ${plan.plainLanguageSummary}\n\n` +
      "Proceeding to Step 03 (Scope gate) - this run now waits for a required-reviewer approval."
  );

  setJobOutput("risk", plan.blastRadius.risk);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

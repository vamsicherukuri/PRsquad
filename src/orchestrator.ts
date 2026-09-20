import { readFileSync } from "node:fs";
import { CopilotClient } from "@github/copilot-sdk";
import { loadAgent, type AgentDefinition } from "./loadAgent.js";
import { makeScopedReadTool } from "./scopeTool.js";
import { makeMockGithubTools } from "./mockGithubTools.js";
import { askScopeGate } from "./scopeGate.js";
import { runAgentJSON } from "./copilotAgent.js";
import {
  INTAKE_TRIAGE_MAX_ROUNDS,
  SCOPE_GATE_MAX_ROUNDS,
  type Issue,
  type PluginPlan,
  type PluginTriageResult,
} from "./types.js";

const ROOT = process.cwd();
const REPO_OWNER = "local";
const REPO_NAME = "sample-repo";

/** Step 01.5 - Intake Triage, capped at INTAKE_TRIAGE_MAX_ROUNDS per implementation-plan.md §4. */
async function runIntakeTriage(
  client: CopilotClient,
  agent: AgentDefinition,
  issue: Issue
): Promise<PluginTriageResult | "ESCALATE_TO_PM"> {
  const tools = makeMockGithubTools(issue);

  for (let round = 0; round < INTAKE_TRIAGE_MAX_ROUNDS + 1; round++) {
    const prompt =
      `Repository owner: ${REPO_OWNER}\nRepository name: ${REPO_NAME}\n` +
      `Issue number: ${issue.id}\nClarification round: ${round}`;
    const result = await runAgentJSON<PluginTriageResult>(client, agent, prompt, tools);
    console.log(`\n[Intake Triage round ${round}]`, result);

    if (result.status === "READY") return result;

    if (round === INTAKE_TRIAGE_MAX_ROUNDS) {
      console.log(
        `\nIntake Triage did not reach "READY" within ${INTAKE_TRIAGE_MAX_ROUNDS} clarification rounds - ` +
          "escalating to PM (implementation-plan.md §4)."
      );
      return "ESCALATE_TO_PM";
    }

    if (result.status === "FETCH_FAILED") {
      console.log("\nIntake Triage reported FETCH_FAILED - escalating.");
      return "ESCALATE_TO_PM";
    }

    console.log(`Clarifying question that would be posted: ${result.clarifyingQuestion}`);
  }

  return "ESCALATE_TO_PM";
}

/** Step 02 - Architect, read access bounded to the declared scope via the scoped-read tool. */
async function runArchitect(
  client: CopilotClient,
  agent: AgentDefinition,
  issue: Issue,
  declaredScope: string
): Promise<PluginPlan> {
  const tool = makeScopedReadTool(declaredScope, ROOT);
  const prompt =
    `Issue #${issue.id}: ${issue.title}\n\n${issue.body}\n\nDeclared scope: ${declaredScope}`;
  return runAgentJSON<PluginPlan>(client, agent, prompt, [tool]);
}

/** Step 03 - Scope gate, capped at SCOPE_GATE_MAX_ROUNDS per implementation-plan.md §5a. */
async function runScopeGate(
  client: CopilotClient,
  architectAgent: AgentDefinition,
  issue: Issue,
  declaredScope: string,
  initialPlan: PluginPlan
): Promise<{ approved: boolean; plan: PluginPlan }> {
  let plan = initialPlan;

  for (let round = 1; round <= SCOPE_GATE_MAX_ROUNDS; round++) {
    const decision = await askScopeGate(plan);

    if (decision.kind === "approve") {
      console.log("\nScope gate: APPROVED. Proceeding to Step 04 (branch isolated) - out of scope for this slice.");
      return { approved: true, plan };
    }

    if (decision.kind === "send_back") {
      console.log("\nScope gate: sent back entirely - no revision attempt, escalating (implementation-plan.md §5a).");
      return { approved: false, plan };
    }

    if (round === SCOPE_GATE_MAX_ROUNDS) {
      console.log(
        `\nScope gate: revision requested but the ${SCOPE_GATE_MAX_ROUNDS}-round cap is reached - ` +
          "escalating to manual PM/Architect handling (implementation-plan.md §5a)."
      );
      return { approved: false, plan };
    }

    console.log(`\nScope gate: revision requested - "${decision.feedback}". Architect re-drafting (round ${round + 1})...`);
    const prompt =
      `Issue #${issue.id}: ${issue.title}\n\n${issue.body}\n\nDeclared scope: ${declaredScope}\n\n` +
      `Your previous plan:\n${JSON.stringify(plan, null, 2)}\n\n` +
      `PM feedback to incorporate (only re-analyze what this feedback touches): ${decision.feedback}`;
    plan = await runAgentJSON<PluginPlan>(
      client,
      architectAgent,
      prompt,
      [makeScopedReadTool(declaredScope, ROOT)]
    );
  }

  return { approved: false, plan };
}

async function main() {
  const issuePath = process.argv[2];
  if (!issuePath) {
    console.error("Usage: tsx src/orchestrator.ts <path-to-issue.json>");
    process.exit(1);
  }

  const issue = JSON.parse(readFileSync(issuePath, "utf-8")) as Issue;
  const intakeAgent = loadAgent(
    "plugins/gated-change/com.github.copilot/agents/gated-change-intake.agent.md"
  );
  const architectAgent = loadAgent(
    "plugins/gated-change/com.github.copilot/agents/gated-change-architect.agent.md"
  );

  const client = new CopilotClient();
  await client.start();

  console.log(`=== Step 01: Issue filed ===\n${issue.title}`);

  const triage = await runIntakeTriage(client, intakeAgent, issue);
  if (triage === "ESCALATE_TO_PM") {
    console.log("\nPipeline paused: Intake Triage could not confirm readiness. Stopping here.");
    return;
  }
  if (!triage.declaredScope) {
    console.log("\nPipeline paused: no declared scope available even though triage reported ready. Stopping here.");
    return;
  }

  console.log(`\n=== Step 02: Plan drafted (Architect, scope = "${triage.declaredScope}") ===`);
  const plan = await runArchitect(client, architectAgent, issue, triage.declaredScope);
  console.log(plan);

  if (plan.status === "BLOCKED") {
    console.log(`\nPipeline paused: Architect returned BLOCKED - "${plan.blockedReason}". Stopping here (correct behavior, not a bug).`);
    return;
  }

  console.log("\n=== Step 03: Scope gate ===");
  const gateResult = await runScopeGate(client, architectAgent, issue, triage.declaredScope, plan);

  if (gateResult.approved) {
    console.log("\nNarrow slice complete. Steps 04+ (branch, implementation, tests, review, merge) are designed in implementation-plan.md but not yet built.");
  } else {
    console.log("\nNarrow slice ended without approval - this is a correct, designed outcome for this run, not a bug.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

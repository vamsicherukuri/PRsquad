import { CopilotClient } from "@github/copilot-sdk";
import { loadAgent } from "../loadAgent.js";
import { runAgentJSON } from "../copilotAgent.js";
import { fetchIssue, postComment, addLabel, removeLabel, setJobOutput } from "./ghIssue.js";
import { INTAKE_TRIAGE_MAX_ROUNDS, type TriageResult } from "../types.js";

const TRIGGER_LABEL = "run-agentic-pipeline";
const ESCALATION_LABEL = "needs-info";

/**
 * One round of Step 01.5 (Intake Triage), run as its own GitHub Actions job so each round is a
 * separate, inspectable unit in the workflow graph - see implementation-plan.md §4 for the
 * ≤2-round cap this script enforces via its caller (the workflow YAML wires round 2 to run only
 * `if: needs.intake-triage-round-1.outputs.ready == 'false'`).
 */
async function main() {
  const issueNumber = Number(process.argv[2]);
  const round = Number(process.argv[3]);
  if (!issueNumber || (round !== 1 && round !== 2)) {
    console.error("Usage: tsx src/actions/intakeTriage.ts <issue-number> <round: 1|2>");
    process.exit(1);
  }

  if (round === 1) {
    // Remove the trigger label immediately so re-labeling is required to re-run the pipeline -
    // prevents an in-flight run from being accidentally re-triggered by the same label event.
    removeLabel(issueNumber, TRIGGER_LABEL);
  }

  const issue = fetchIssue(issueNumber);
  const agent = loadAgent("harness/agents/intake-triage.agent.md");
  const client = new CopilotClient();
  await client.start();

  // Round 2 sees everything round 1 saw, plus any reply the reporter has left since (comments
  // include our own round-1 result comment too, which is fine context for the model to see).
  const commentsText = issue.comments.map((c) => c.body).join("\n\n---\n\n");
  const context =
    `Issue #${issue.number}: ${issue.title}\n\n${issue.body}` +
    (commentsText ? `\n\nComments so far:\n${commentsText}` : "");

  const result = await runAgentJSON<TriageResult>(client, agent, context);
  console.log(`[Intake Triage round ${round}]`, result);

  if (result.ready) {
    postComment(
      issueNumber,
      `**Intake Triage (round ${round}) - ready ✅**\n\nDeclared scope: \`${result.declaredScope}\`\n\nProceeding to Step 02 (Architect).`
    );
    setJobOutput("ready", "true");
    setJobOutput("scope", result.declaredScope ?? "");
    return;
  }

  if (round === INTAKE_TRIAGE_MAX_ROUNDS) {
    postComment(
      issueNumber,
      `**Intake Triage (round ${round}) - still missing information after ${INTAKE_TRIAGE_MAX_ROUNDS} rounds** ⏸️\n\n` +
        `Missing: ${result.missing.join(", ")}\n\n` +
        "Per implementation-plan.md §4, this escalates to manual PM handling rather than continuing to " +
        `guess - the pipeline stops here. Re-apply the \`${TRIGGER_LABEL}\` label once the issue has been updated.`
    );
    addLabel(issueNumber, ESCALATION_LABEL);
    setJobOutput("ready", "false");
    setJobOutput("scope", "");
    return;
  }

  postComment(
    issueNumber,
    `**Intake Triage (round ${round}) - needs more detail** ❓\n\n` +
      `Missing: ${result.missing.join(", ")}\n\n${result.clarifyingQuestion}`
  );
  setJobOutput("ready", "false");
  setJobOutput("scope", "");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

import { createInterface } from "node:readline/promises";
import type { Plan, ScopeGateDecision } from "./types.js";

/**
 * implementation-plan.md §5a / §5g: the Scope gate is a HARD BLOCK - nothing proceeds until a human
 * (the PM) responds here. This CLI prompt stands in for whatever front-end the real GHCP App surface
 * would use; the important property it preserves is that execution genuinely pauses on stdin, it does
 * not simulate approval automatically.
 */
export async function askScopeGate(plan: Plan): Promise<ScopeGateDecision> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log("\n--- SCOPE GATE (PM approval required) ---");
    console.log(`Risk: ${plan.blastRadius.risk}`);
    if (plan.blastRadius.affectedOutsideScope.length > 0) {
      console.log(`Also touches outside declared scope: ${plan.blastRadius.affectedOutsideScope.join(", ")}`);
    }
    console.log(`\n${plan.plainLanguageSummary}\n`);

    const answer = (
      await rl.question('Approve, "revise: <feedback>", or "send back"? ')
    ).trim();

    if (/^approve$/i.test(answer)) return { kind: "approve" };
    if (/^send back$/i.test(answer)) return { kind: "send_back" };
    const revise = answer.match(/^revise:\s*(.+)$/i);
    if (revise) return { kind: "revise", feedback: revise[1] };

    console.log('Not understood - treating as "send back" for safety.');
    return { kind: "send_back" };
  } finally {
    rl.close();
  }
}

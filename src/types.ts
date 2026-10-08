export interface Issue {
  id: string;
  title: string;
  body: string;
}

export interface TriageResult {
  ready: boolean;
  missing: string[];
  declaredScope: string | null;
  clarifyingQuestion: string | null;
}

export interface PlanChange {
  file: string;
  type: "ADD" | "MODIFY" | "DELETE";
  reason: string;
}

export interface Plan {
  rootCause: string;
  changes: PlanChange[];
  blastRadius: {
    risk: "Low" | "Medium" | "High";
    affectedOutsideScope: string[];
  };
  plainLanguageSummary: string;
}

/**
 * Matches the real plugin's prsquad-triage schema (plugins/prsquad/com.github.copilot/
 * agents/prsquad-triage.agent.md) - distinct from the older TriageResult above, which
 * src/actions/*.ts still uses against the separate harness/agents/*.agent.md copies.
 */
export interface PluginTriageResult {
  status: "FETCH_FAILED" | "EMPTY" | "NOT_READY" | "READY";
  clarificationRound: number;
  issue: {
    owner: string;
    repo: string;
    number: number;
    title: string;
    body: string;
    comments: string[];
  };
  problem: string | null;
  acceptanceCriteria: string[];
  declaredScope: string | null;
  missing: string[];
  clarifyingQuestion: string | null;
  fetchError: string | null;
}

/** Matches the real plugin's prsquad-architect initial-planning schema. */
export interface PluginPlan {
  status: "PLAN_READY" | "BLOCKED";
  rootCause: string;
  changes: PlanChange[];
  proposedScope: string;
  blastRadius: {
    risk: "Low" | "Medium" | "High";
    affectedOutsideScope: string[];
  };
  validationPlan: string[];
  plainLanguageSummary: string;
  blockedReason: string | null;
}

export type ScopeGateDecision =
  | { kind: "approve" }
  | { kind: "revise"; feedback: string }
  | { kind: "send_back" };

/**
 * Per README.md#L1 (limitations) and implementation-plan.md §5a: the Scope gate's revision path
 * is capped at 2 total rounds (initial + 1 revision). Enforced here in code, not left to the
 * agent's judgment - see runScopeGate() in orchestrator.ts.
 */
export const SCOPE_GATE_MAX_ROUNDS = 2;

/** implementation-plan.md §4: Intake Triage clarification is capped at 2 rounds before escalating to the PM. */
export const INTAKE_TRIAGE_MAX_ROUNDS = 2;

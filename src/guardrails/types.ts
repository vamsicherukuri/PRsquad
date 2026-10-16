/**
 * Types and interfaces for the Gated Change deterministic guardrails engine.
 */

export type WorkflowPhase =
  | "INITIAL"
  | "INTAKE"
  | "INTAKE_TRIAGE"
  | "ARCHITECTING"
  | "PLAN_READY"
  | "AWAITING_SCOPE_APPROVAL"
  | "DEVELOPING"
  | "IMPLEMENTED"
  | "TESTING"
  | "QA_VALIDATING"
  | "REVIEWING"
  | "AWAITING_PR_APPROVAL"
  | "PR_READY"
  | "PR_OPEN"
  | "PAUSED"
  | "ESCALATED";

export interface WorkflowState {
  version: string;
  sessionId: string;
  issue: {
    owner: string;
    repo: string;
    number: number;
    title?: string;
    body?: string;
    declaredScope?: string;
  };
  phase: WorkflowPhase;
  intakeRound: number;
  maxIntakeRounds: number;
  scopeRevisionCount: number;
  maxScopeRevisions: number;
  implementationAttempt: number;
  maxImplementationAttempts: number;
  approvedScope: string | null;
  humanApproval: boolean;
  baseRef: string | null;
  activeBranch?: string;
  currentPhase?: string;
  approvedPlan?: any;
  pauseReason?: string;
  fetchRetries?: number;
  issueValidation?: "PASS" | "FAIL" | "ISSUE_UNRESOLVED";
  issueSnapshot?: string;
  intakeEligibility?: "READY" | "BLOCKED";
  commentId?: number | null;
  phases?: Record<string, any>;
  startEventId?: number;
  lastTransitionId?: string;
  updatedAt: string;
}

export interface ApprovalLock {
  issueNumber: number;
  approvedScope: string;
  planHash?: string;
  approvalEnvelopeHash?: string;
  baseRef?: string;
  maxAttempts: number;
  currentAttempt: number;
  approvedAt: string;
  approvedBy: string;
  status: "ACTIVE" | "EXHAUSTED" | "REVOKED";
}

export interface PRAuthorization {
  issueNumber: number;
  activeBranch: string;
  headCommitSha: string;
  reviewVerdict: string;
  authorizedBy: string;
  authorizedAt: string;
  status: "ACTIVE" | "USED" | "REVOKED";
}

export interface AuditLogEntry {
  timestamp: string;
  sessionId: string;
  transitionId?: string;
  agent?: string;
  tool?: string;
  action: string;
  decision: "allow" | "deny" | "info";
  details: Record<string, unknown>;
}

export interface HookInput {
  tool?: string;
  toolArgs?: Record<string, any>;
  toolCalls?: Array<{ name: string; args: Record<string, any> }>;
  toolResult?: any;
  agent?: string;
  sessionId?: string;
  environment?: Record<string, string>;
  cwd?: string;
  initialPrompt?: string;
  source?: string;
  timestamp?: string;
}

export interface HookOutput {
  decision: "allow" | "deny" | "ask";
  permissionDecision?: "allow" | "deny" | "ask";
  permissionDecisionReason?: string;
  reason?: string;
  additionalContext?: string;
  modifiedArgs?: Record<string, any>;
  updatedInput?: Record<string, any>;
  modifiedResult?: Record<string, any>;
  hookSpecificOutput?: Record<string, any>;
}

export interface FetchedIssueData {
  owner: string;
  repo: string;
  number: number;
  title: string;
  body: string;
  author: string;
  labels: string[];
  comments: Array<{
    author: string;
    body: string;
    createdAt: string;
  }>;
  state: "OPEN" | "CLOSED" | string;
}

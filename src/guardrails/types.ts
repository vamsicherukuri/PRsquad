/**
 * Types and interfaces for the Gated Change deterministic guardrails engine.
 */

export type WorkflowPhase =
  | "INTAKE"
  | "ARCHITECTING"
  | "AWAITING_SCOPE_APPROVAL"
  | "DEVELOPING"
  | "QA_VALIDATING"
  | "REVIEWING"
  | "PR_READY"
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
  agent?: string;
  tool?: string;
  action: string;
  decision: "allow" | "deny" | "info";
  details: Record<string, unknown>;
}

export interface HookInput {
  tool?: string;
  toolArgs?: Record<string, any>;
  agent?: string;
  sessionId?: string;
  environment?: Record<string, string>;
}

export interface HookOutput {
  decision: "allow" | "deny";
  reason?: string;
  additionalContext?: string;
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

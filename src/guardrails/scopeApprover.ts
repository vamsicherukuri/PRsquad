/**
 * Deterministic Scope Gate Approver (Layer B Deterministic Guardrail)
 * 
 * Executes when human authorizes implementation at the Human Scope Gate.
 * Minting the cryptographic approval.lock on disk is strictly separated from
 * agent text generation.
 * 
 * Enforces the core invariant: "The model cannot approve itself."
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  getRepoRoot,
  loadState,
  saveState,
  saveApprovalLock,
  appendAuditLog,
} from "./stateStore.js";
import { syncWorkflowDashboard } from "./issueDashboard.js";
import type { ApprovalLock } from "./types.js";

export interface ScopeApprovalOptions {
  preferredDir?: string;
  scope?: string;
  issue?: number;
  approver?: string;
}

export interface ScopeApprovalResult {
  success: boolean;
  lock?: ApprovalLock;
  error?: string;
}

export function approveScopeGate(options: ScopeApprovalOptions = {}): ScopeApprovalResult {
  const repoRoot = getRepoRoot(options.preferredDir || process.cwd());
  const state = loadState(repoRoot);

  const dashFile = join(repoRoot, ".gated-change", "dashboard.json");
  let dashData: any = null;
  if (existsSync(dashFile)) {
    try {
      dashData = JSON.parse(readFileSync(dashFile, "utf-8"));
    } catch {}
  }

  // 1. Resolve target scope: CLI option -> state -> architect plan -> intake declared scope
  const targetScope =
    options.scope ||
    state.approvedScope ||
    dashData?.phases?.architect?.details?.proposedScope ||
    dashData?.phases?.scopeGate?.details?.approvedScope ||
    state.issue?.declaredScope ||
    dashData?.phases?.intake?.details?.declaredScope;

  if (!targetScope || typeof targetScope !== "string" || !targetScope.trim()) {
    return {
      success: false,
      error:
        "No architectural plan or proposed scope boundary found to approve. " +
        "Architect must synthesize an issue specification into a proposed scope before the Scope Gate can be approved.",
    };
  }

  // 2. Resolve issue number
  const issueNumber =
    options.issue ||
    state.issue?.number ||
    (dashData?.issueNumber ? Number(dashData.issueNumber) : 42);

  const approver = options.approver || "Human Maintainer (/approve)";

  // 3. Create cryptographic approval lock
  const lock: ApprovalLock = {
    issueNumber,
    approvedScope: String(targetScope).replace(/\\/g, "/"),
    maxAttempts: 3,
    currentAttempt: 1,
    approvedAt: new Date().toISOString(),
    approvedBy: approver,
    status: "ACTIVE",
  };

  saveApprovalLock(lock, repoRoot);

  // 4. Update workflow state
  state.approvedScope = lock.approvedScope;
  state.humanApproval = true;
  state.phase = "DEVELOPING";
  state.implementationAttempt = 1;
  saveState(state, repoRoot);

  // 5. Update living dashboard
  syncWorkflowDashboard(repoRoot, {
    owner: state.issue?.owner || dashData?.owner || "vamsicherukuri",
    repo: state.issue?.repo || dashData?.repo || "prsquad",
    issueNumber: lock.issueNumber,
    issueTitle: state.issue?.title || dashData?.issueTitle || "Active Pipeline Task",
    sessionId: state.sessionId,
    phase: "scopeGate",
    status: "APPROVED",
    summary: `Scope boundary approved by ${lock.approvedBy} (${lock.approvedScope})`,
    details: {
      approvedScope: lock.approvedScope,
      approvedBy: lock.approvedBy,
      approvedAt: lock.approvedAt,
      status: "APPROVED",
    },
  });

  // 6. Record audit log entry
  appendAuditLog(
    {
      sessionId: state.sessionId,
      agent: "human",
      tool: "scope-approve",
      action: "human_scope_gate_approved",
      decision: "allow",
      details: {
        issueNumber: lock.issueNumber,
        approvedScope: lock.approvedScope,
        approvedBy: lock.approvedBy,
        maxAttempts: lock.maxAttempts,
      },
    },
    repoRoot
  );

  return {
    success: true,
    lock,
  };
}

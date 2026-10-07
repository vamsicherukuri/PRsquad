/**
 * Deterministic Scope Gate Approver (Layer B Deterministic Guardrail)
 * 
 * Executes when human authorizes implementation at the Human Scope Gate.
 * Implements Approval Integrity Binding: binds approval.lock via cryptographic
 * SHA-256 digest to the exact canonical Architect plan (planHash) and base commit (baseRef).
 * 
 * Enforces the core invariant: "The model cannot approve itself."
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
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
  plan?: string | object;
  baseRef?: string;
}

export interface ScopeApprovalResult {
  success: boolean;
  lock?: ApprovalLock;
  error?: string;
}

/**
 * Recursively produces a canonical JSON string with sorted keys and preserved array order.
 */
export function canonicalJsonStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalJsonStringify).join(",") + "]";
  }
  const obj = value as Record<string, unknown>;
  const sortedKeys = Object.keys(obj).sort();
  const entries = sortedKeys.map((k) => JSON.stringify(k) + ":" + canonicalJsonStringify(obj[k]));
  return "{" + entries.join(",") + "}";
}

/**
 * Computes a deterministic canonical SHA-256 hash for an architecture plan.
 * Normalizes line endings (CRLF -> LF) and trims whitespace.
 * Uses full 64-character SHA-256 hex digest.
 */
export function computePlanHash(planOrHandoff: unknown): string {
  if (!planOrHandoff) return "";
  let normalized = "";
  if (typeof planOrHandoff === "string") {
    normalized = planOrHandoff.replace(/\r\n/g, "\n").trim();
  } else if (typeof planOrHandoff === "object") {
    try {
      normalized = canonicalJsonStringify(planOrHandoff);
    } catch {
      normalized = String(planOrHandoff);
    }
  }
  if (!normalized) return "";
  return createHash("sha256").update(normalized).digest("hex");
}

/**
 * Computes a deterministic canonical SHA-256 hash for the full approval envelope:
 * (issueNumber + approvedScope + baseRef + plan).
 */
export function computeApprovalEnvelopeHash(envelope: {
  issueNumber: number;
  approvedScope: string;
  baseRef: string;
  plan: any;
}): string {
  const canonical = canonicalJsonStringify(envelope);
  return createHash("sha256").update(canonical).digest("hex");
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
    (dashData?.issueNumber ? Number(dashData.issueNumber) : 0);

  if (!issueNumber || issueNumber <= 0) {
    return {
      success: false,
      error: "Cannot approve scope gate without a valid issue number.",
    };
  }

  const approver = options.approver || "Human Maintainer (/approve)";

  // 3. Approval Integrity Binding: Canonical plan hash & base commit anchoring
  let rawPlan: any = undefined;
  if (options.plan !== undefined) {
    rawPlan = typeof options.plan === "string" ? options.plan.trim() : options.plan;
  } else {
    rawPlan =
      dashData?.phases?.architect?.details?.plan ||
      dashData?.phases?.architect?.details?.changes ||
      state.approvedPlan ||
      dashData?.phases?.architect?.summary;
  }

  if (!rawPlan) {
    return {
      success: false,
      error:
        "SCOPE_GATE_BLOCKED (MANDATORY_PLAN_REQUIRED): Cannot approve scope without a canonical architecture plan. " +
        "Architect must produce a validated plan before the Human Scope Gate can be approved.",
    };
  }

  const planHash = computePlanHash(rawPlan);
  if (!planHash) {
    return {
      success: false,
      error: "SCOPE_GATE_BLOCKED: Failed to compute canonical plan hash for architecture plan.",
    };
  }

  let baseRef = options.baseRef;
  if (!baseRef) {
    try {
      baseRef = execSync("git rev-parse HEAD", {
        cwd: repoRoot,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    } catch {
      baseRef = state.baseRef || "HEAD";
    }
  }

  // 4. Create deterministic approval lock with Approval Integrity Binding
  const approvedScopeStr = String(targetScope).replace(/\\/g, "/");
  const approvalEnvelopeHash = computeApprovalEnvelopeHash({
    issueNumber,
    approvedScope: approvedScopeStr,
    baseRef,
    plan: rawPlan,
  });

  const lock: ApprovalLock = {
    issueNumber,
    approvedScope: approvedScopeStr,
    planHash,
    approvalEnvelopeHash,
    baseRef,
    maxAttempts: 3,
    currentAttempt: 1,
    approvedAt: new Date().toISOString(),
    approvedBy: approver,
    status: "ACTIVE",
  };

  saveApprovalLock(lock, repoRoot);

  // 5. Update workflow state
  state.approvedScope = lock.approvedScope;
  if (lock.baseRef) state.baseRef = lock.baseRef;
  state.humanApproval = true;
  state.phase = "DEVELOPING";
  state.implementationAttempt = 1;
  saveState(state, repoRoot);

  // 6. Update living dashboard
  const summaryHashSuffix = lock.planHash ? ` [planHash: ${lock.planHash.slice(0, 8)}]` : "";
  syncWorkflowDashboard(repoRoot, {
    owner: state.issue?.owner || dashData?.owner || "vamsicherukuri",
    repo: state.issue?.repo || dashData?.repo || "prsquad",
    issueNumber: lock.issueNumber,
    issueTitle: state.issue?.title || dashData?.issueTitle || "Active Pipeline Task",
    sessionId: state.sessionId,
    phase: "scopeGate",
    status: "APPROVED",
    summary: `Scope boundary approved by ${lock.approvedBy} (${lock.approvedScope})${summaryHashSuffix}`,
    details: {
      approvedScope: lock.approvedScope,
      planHash: lock.planHash,
      baseRef: lock.baseRef,
      approvedBy: lock.approvedBy,
      approvedAt: lock.approvedAt,
      status: "APPROVED",
    },
  });

  // 7. Record audit log entry with Approval Integrity Binding metadata
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
        planHash: lock.planHash,
        baseRef: lock.baseRef,
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

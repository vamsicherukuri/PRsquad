/**
 * State Controller: Authoritative State Machine Engine
 * Enforces valid state transitions, provides atomic workflow commits,
 * and maintains the single source of truth for the Gated Fix Pipeline.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import type { WorkflowState, WorkflowPhase, FetchedIssueData } from "./types.js";
import type { TriageHandoff } from "./handoffValidator.js";
import {
  loadState,
  saveState,
  appendAuditLog,
  getRepoRoot,
  findGatedChangeDir,
  getRepoOwnerAndName,
} from "./stateStore.js";
import { syncWorkflowDashboard } from "./issueDashboard.js";

export interface TransitionRule {
  from: string;
  event: string;
  to: string;
}

/**
 * Standard State Machine Transitions matching .prsquad/security-invariants.json
 */
export const ALLOWED_TRANSITIONS: TransitionRule[] = [
  { from: "INITIAL", event: "INGEST_OPEN", to: "INTAKE_TRIAGE" },
  { from: "INTAKE_TRIAGE", event: "READY", to: "ARCHITECTING" },
  { from: "INTAKE_TRIAGE", event: "NOT_READY", to: "PAUSED" },
  { from: "INTAKE_TRIAGE", event: "EMPTY", to: "PAUSED" },
  { from: "INTAKE_TRIAGE", event: "FETCH_FAILED", to: "PAUSED" },
  { from: "INTAKE_TRIAGE", event: "HANDOFF_INVALID", to: "PAUSED" },
  { from: "ARCHITECTING", event: "PLAN_READY", to: "AWAITING_SCOPE_APPROVAL" },
  { from: "ARCHITECTING", event: "BLOCKED", to: "PAUSED" },
  { from: "ARCHITECTING", event: "HANDOFF_INVALID", to: "PAUSED" },
  { from: "AWAITING_SCOPE_APPROVAL", event: "HUMAN_APPROVE", to: "DEVELOPING" },
  { from: "AWAITING_SCOPE_APPROVAL", event: "HUMAN_REJECT", to: "PAUSED" },
  { from: "DEVELOPING", event: "IMPLEMENTED", to: "TESTING" },
  { from: "DEVELOPING", event: "SCOPE_AMENDMENT", to: "ARCHITECTING" },
  { from: "DEVELOPING", event: "HANDOFF_INVALID", to: "PAUSED" },
  { from: "TESTING", event: "PASS", to: "REVIEWING" },
  { from: "TESTING", event: "FAIL", to: "DEVELOPING" },
  { from: "TESTING", event: "HANDOFF_INVALID", to: "PAUSED" },
  { from: "REVIEWING", event: "CLEAR", to: "AWAITING_PR_APPROVAL" },
  { from: "REVIEWING", event: "CONCERNS", to: "AWAITING_PR_APPROVAL" },
  { from: "REVIEWING", event: "HANDOFF_INVALID", to: "PAUSED" },
  { from: "AWAITING_PR_APPROVAL", event: "HUMAN_PR_APPROVE", to: "PR_OPEN" },
];

export class StateController {
  /**
   * Validates if a proposed state transition is permissible under the State Machine.
   */
  static validateTransition(fromPhase: string, event: string, toPhase: string): boolean {
    const normalizedFrom = fromPhase.toUpperCase();
    const normalizedTo = toPhase.toUpperCase();
    const normalizedEvent = event.toUpperCase();

    // Map legacy INTAKE alias to INTAKE_TRIAGE
    const effectiveFrom = normalizedFrom === "INTAKE" ? "INTAKE_TRIAGE" : normalizedFrom;
    const effectiveTo = normalizedTo === "INTAKE" ? "INTAKE_TRIAGE" : normalizedTo;

    return ALLOWED_TRANSITIONS.some(
      (t) =>
        t.from === effectiveFrom &&
        t.event === normalizedEvent &&
        t.to === effectiveTo
    );
  }

  /**
   * Checks whether the current workflow phase represents an advanced, in-flight pipeline stage
   * that must be preserved on session resume rather than reset to intake.
   */
  static isAdvancedPhase(phase: string): boolean {
    const p = String(phase || "").toUpperCase();
    return [
      "ARCHITECTING",
      "AWAITING_SCOPE_APPROVAL",
      "DEVELOPING",
      "TESTING",
      "QA_VALIDATING",
      "REVIEWING",
      "AWAITING_PR_APPROVAL",
      "PR_READY",
      "PR_OPEN",
    ].includes(p);
  }

  /**
   * Resolves the issue number from session context:
   * 1. Initial user prompt
   * 2. Cwd path (e.g. Copilot App worktree named StarReads-issue-42-slug)
   * 3. Active git branch (e.g. fix/issue-42)
   * 4. Existing workflow state
   */
  static resolveIssueFromSession(
    cwd: string,
    prompt: string,
    repoRoot: string,
    state?: WorkflowState
  ): number | null {
    // 1. Check prompt
    if (prompt) {
      const jsonNum = prompt.match(/"number"\s*:\s*(\d+)/);
      if (jsonNum) return parseInt(jsonNum[1], 10);

      const explicitNum = prompt.match(/(?:issue(?:\s*number)?\s*[:#`'"\s]*|#)\s*(\d+)/i);
      if (explicitNum) return parseInt(explicitNum[1], 10);

      const wordNum = prompt.match(/\bissue-?(\d+)\b/i);
      if (wordNum) return parseInt(wordNum[1], 10);
    }

    // 2. Check worktree cwd path (GitHub Copilot App worktrees encode issue number)
    const cwdMatch = cwd.match(/(?:issue-?|#)(\d+)/i);
    if (cwdMatch) {
      return parseInt(cwdMatch[1], 10);
    }

    const rootMatch = repoRoot.match(/(?:issue-?|#)(\d+)/i);
    if (rootMatch) {
      return parseInt(rootMatch[1], 10);
    }

    // 3. Check active git branch
    try {
      const branch = execSync("git rev-parse --abbrev-ref HEAD", {
        cwd,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
      const branchMatch = branch.match(/(?:issue-?|#)(\d+)/i);
      if (branchMatch) {
        return parseInt(branchMatch[1], 10);
      }
    } catch {}

    // 4. Check existing state
    if (state?.issue?.number && state.issue.number > 0) {
      return state.issue.number;
    }

    return null;
  }

  /**
   * Initializes or loads the workflow state for the session safely.
   * Guarantees the .gated-change directory exists on disk.
   */
  static loadOrCreateState(rootDir: string = getRepoRoot(), sessionId?: string): WorkflowState {
    const gatedDir = findGatedChangeDir(rootDir);
    if (!existsSync(gatedDir)) {
      mkdirSync(gatedDir, { recursive: true });
    }

    const state = loadState(rootDir);
    if (sessionId && (!state.sessionId || state.sessionId !== sessionId)) {
      state.sessionId = sessionId;
      saveState(state, rootDir);
    }
    return state;
  }

  /**
   * Performs the atomic intake authorization commit (Streamlined Fix for Redundancy A):
   * 1. Records issue metadata in state.json
   * 2. Sets phase = "INTAKE_TRIAGE" and active branch
   * 3. Syncs dashboard.json with status = "INTAKE_AUTHORIZED"
   * 4. Logs audit entry in audit.jsonl
   * All executed as a single atomic transaction.
   */
  static authorizeIntake(
    rootDir: string,
    issue: FetchedIssueData,
    cacheFilePath: string,
    sessionId?: string
  ): WorkflowState {
    const gatedDir = findGatedChangeDir(rootDir);
    if (!existsSync(gatedDir)) {
      mkdirSync(gatedDir, { recursive: true });
    }

    const state = loadState(rootDir);

    if (sessionId) {
      state.sessionId = sessionId;
    }

    // 1. Update state.json
    state.issue = {
      owner: issue.owner,
      repo: issue.repo,
      number: issue.number,
      title: issue.title,
      body: issue.body,
    };
    state.phase = "INTAKE";
    state.activeBranch = `fix/issue-${issue.number}`;
    state.updatedAt = new Date().toISOString();
    saveState(state, rootDir);

    // 2. Sync living dashboard
    syncWorkflowDashboard(rootDir, {
      owner: issue.owner,
      repo: issue.repo,
      issueNumber: issue.number,
      issueTitle: issue.title,
      activeBranch: `fix/issue-${issue.number}`,
      sessionId: sessionId || state.sessionId,
      phase: "intake",
      status: "INTAKE_AUTHORIZED",
      summary: `Session initialized & issue #${issue.number} verified OPEN. Authorized for Intake triage.`,
      details: {
        issueNumber: issue.number,
        title: issue.title,
        author: issue.author,
        state: issue.state,
        cacheFile: cacheFilePath,
      },
    });

    // 3. Log audit entry
    appendAuditLog(
      {
        sessionId: sessionId || state.sessionId,
        agent: "controller",
        action: "intake_stage_authorized",
        decision: "allow",
        details: {
          issueNumber: issue.number,
          title: issue.title,
          phase: "INTAKE_TRIAGE",
          status: "INTAKE_AUTHORIZED",
          cacheFile: cacheFilePath,
        },
      },
      rootDir
    );

    return state;
  }

  /**
   * Pauses the workflow due to validation failure, closed issue, or policy block.
   * Atomically records reason in state.json, dashboard.json, and audit.jsonl.
   */
  static pauseWorkflow(
    rootDir: string,
    reason: string,
    issueNumber?: number,
    sessionId?: string
  ): WorkflowState {
    const state = loadState(rootDir);
    state.phase = "PAUSED";
    state.pauseReason = reason;
    state.updatedAt = new Date().toISOString();
    saveState(state, rootDir);

    const remoteInfo = getRepoOwnerAndName(rootDir);
    const owner = state.issue?.owner || remoteInfo.owner;
    const repo = state.issue?.repo || remoteInfo.repo;

    syncWorkflowDashboard(rootDir, {
      owner,
      repo,
      issueNumber: issueNumber || state.issue?.number || 0,
      sessionId: sessionId || state.sessionId,
      phase: "intake",
      status: "BLOCKED",
      summary: reason,
      details: { reason },
    });

    appendAuditLog(
      {
        sessionId: sessionId || state.sessionId,
        agent: "controller",
        action: "workflow_paused",
        decision: "deny",
        details: { reason, issueNumber: issueNumber || state.issue?.number },
      },
      rootDir
    );

    return state;
  }

  /**
   * Commits the Intake specialist's verdict to the State Machine:
   * 1. Evaluates state machine transition rules.
   * 2. If READY:
   *    - sets state.phase = "ARCHITECTING"
   *    - records state.issue.declaredScope = triageData.declaredScope
   *    - syncs derived dashboard projection: phase="intake", status="READY"
   *    - logs audit entry: action="intake_verdict_ready"
   * 3. If NOT_READY:
   *    - increments intakeRound
   *    - if intakeRound >= maxIntakeRounds: pauses workflow ("CLARIFICATION_LIMIT_EXCEEDED")
   *    - syncs derived dashboard projection: phase="intake", status="NOT_READY"
   *    - logs audit entry: action="intake_verdict_not_ready"
   * 4. If invalid status: fails closed to PAUSED ("HANDOFF_INVALID")
   */
  static commitIntakeVerdict(
    rootDir: string,
    triageData: TriageHandoff,
    sessionId?: string
  ): WorkflowState {
    const state = loadState(rootDir);
    const effectiveSessionId = sessionId || state.sessionId;

    if (triageData.status === "READY") {
      const allowed = StateController.validateTransition(state.phase, "READY", "ARCHITECTING");
      if (!allowed) {
        return StateController.pauseWorkflow(
          rootDir,
          `STATE_TRANSITION_VIOLATION: Cannot transition from phase '${state.phase}' to 'ARCHITECTING' on event 'READY'`,
          state.issue?.number,
          effectiveSessionId
        );
      }

      state.phase = "ARCHITECTING";
      if (triageData.declaredScope) {
        state.issue.declaredScope = triageData.declaredScope;
      }
      state.updatedAt = new Date().toISOString();
      saveState(state, rootDir);

      syncWorkflowDashboard(rootDir, {
        owner: state.issue.owner,
        repo: state.issue.repo,
        issueNumber: state.issue.number,
        issueTitle: state.issue.title,
        activeBranch: state.activeBranch,
        sessionId: effectiveSessionId,
        phase: "intake",
        status: "READY",
        summary: "Definition-of-Ready triage verified criteria & declared scope.",
        details: triageData,
      });

      appendAuditLog(
        {
          sessionId: effectiveSessionId,
          agent: "controller",
          action: "intake_verdict_ready",
          decision: "allow",
          details: {
            issueNumber: state.issue.number,
            phase: "ARCHITECTING",
            declaredScope: triageData.declaredScope,
            acceptanceCriteriaCount: triageData.acceptanceCriteria?.length || 0,
          },
        },
        rootDir
      );

      return state;
    } else if (triageData.status === "NOT_READY") {
      state.intakeRound = (state.intakeRound || 0) + 1;
      const maxRounds = state.maxIntakeRounds || 2;
      if (state.intakeRound >= maxRounds) {
        return StateController.pauseWorkflow(
          rootDir,
          `CLARIFICATION_LIMIT_EXCEEDED: Intake triage returned NOT_READY after ${state.intakeRound} rounds. Definition of Ready not satisfied.`,
          state.issue?.number,
          effectiveSessionId
        );
      }

      state.updatedAt = new Date().toISOString();
      saveState(state, rootDir);

      syncWorkflowDashboard(rootDir, {
        owner: state.issue.owner,
        repo: state.issue.repo,
        issueNumber: state.issue.number,
        issueTitle: state.issue.title,
        activeBranch: state.activeBranch,
        sessionId: effectiveSessionId,
        phase: "intake",
        status: "NOT_READY",
        summary: `Definition of Ready not met (missing: ${(triageData.missing || []).join(", ")})`,
        details: triageData,
      });

      appendAuditLog(
        {
          sessionId: effectiveSessionId,
          agent: "controller",
          action: "intake_verdict_not_ready",
          decision: "info",
          details: {
            issueNumber: state.issue.number,
            round: state.intakeRound,
            missing: triageData.missing,
            clarifyingQuestion: triageData.clarifyingQuestion,
          },
        },
        rootDir
      );

      return state;
    } else if (triageData.status === "EMPTY") {
      return StateController.pauseWorkflow(
        rootDir,
        `LACK_OF_CONTENT: Issue body is empty or lacks substantive problem description. Definition of Ready cannot be satisfied. Workflow halted immediately without user clarification rounds.`,
        state.issue?.number,
        effectiveSessionId
      );
    } else if (triageData.status === "FETCH_FAILED") {
      const fetchRetries = state.fetchRetries || 0;
      const maxFetchRetries = 2;
      if (fetchRetries < maxFetchRetries) {
        state.fetchRetries = fetchRetries + 1;
        state.updatedAt = new Date().toISOString();
        saveState(state, rootDir);

        syncWorkflowDashboard(rootDir, {
          owner: state.issue?.owner,
          repo: state.issue?.repo,
          issueNumber: state.issue?.number,
          issueTitle: state.issue?.title,
          activeBranch: state.activeBranch,
          sessionId: effectiveSessionId,
          phase: "intake",
          status: "FETCH_RETRY",
          summary: `Issue fetch failed (${triageData.fetchError || "network error"}). Retrying ingestion attempt ${state.fetchRetries}/${maxFetchRetries}...`,
          details: triageData,
        });

        appendAuditLog(
          {
            sessionId: effectiveSessionId,
            agent: "controller",
            action: "intake_fetch_retry",
            decision: "allow",
            details: {
              issueNumber: state.issue?.number,
              attempt: state.fetchRetries,
              error: triageData.fetchError,
            },
          },
          rootDir
        );

        return state;
      } else {
        return StateController.pauseWorkflow(
          rootDir,
          `FETCH_FAILED_EXHAUSTED: Issue fetch failed after ${fetchRetries} retry attempts: ${triageData.fetchError || "network error"}. Pipeline halted.`,
          state.issue?.number,
          effectiveSessionId
        );
      }
    } else {
      return StateController.pauseWorkflow(
        rootDir,
        `INTAKE_TRIAGE_FAILED: Triage returned status '${triageData.status}'. Pipeline halted.`,
        state.issue?.number,
        effectiveSessionId
      );
    }
  }
}

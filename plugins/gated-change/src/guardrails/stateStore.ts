import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { resolve, relative, join } from "node:path";
import { execSync } from "node:child_process";
import type { WorkflowState, ApprovalLock, AuditLogEntry } from "./types.js";

export const GATED_CHANGE_DIR = ".gated-change";
export const STATE_FILE = "state.json";
export const LOCK_FILE = "approval.lock";
export const AUDIT_FILE = "audit.jsonl";

let cachedRepoRoot: string | null = null;

/**
 * Dynamically resolves the true git repository root.
 * Guarantees that hooks and agents never create or read .gated-change from a subfolder.
 */
export function getRepoRoot(): string {
  if (cachedRepoRoot) return cachedRepoRoot;
  try {
    const stdout = execSync("git rev-parse --show-toplevel", {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    cachedRepoRoot = stdout.trim().replace(/\\/g, "/");
    return cachedRepoRoot;
  } catch {
    cachedRepoRoot = process.cwd().replace(/\\/g, "/");
    return cachedRepoRoot;
  }
}

/**
 * Normalizes any Windows or POSIX path into a clean, relative POSIX path
 * from the repository root (e.g. "src/auth/service.ts").
 */
export function toPosixRelative(filePath: string, rootDir: string = getRepoRoot()): string {
  const full = resolve(rootDir, filePath);
  const rel = relative(rootDir, full);
  return rel.split("\\").join("/").replace(/^\.\//, "");
}

/**
 * Ensures the runtime .gated-change directory exists in the true repository root.
 */
export function ensureGatedChangeDir(rootDir: string = getRepoRoot()): string {
  const dir = join(rootDir, GATED_CHANGE_DIR);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Loads the current workflow state, or initializes a default state if not present.
 */
export function loadState(rootDir: string = getRepoRoot()): WorkflowState {
  ensureGatedChangeDir(rootDir);
  const filePath = join(rootDir, GATED_CHANGE_DIR, STATE_FILE);
  if (existsSync(filePath)) {
    try {
      const raw = readFileSync(filePath, "utf-8");
      return JSON.parse(raw) as WorkflowState;
    } catch {
      // Fallback to fresh state if file is corrupt
    }
  }

  const defaultState: WorkflowState = {
    version: "1.0",
    sessionId: `gcc-${Date.now()}`,
    issue: {
      owner: "",
      repo: "",
      number: 0,
    },
    phase: "INTAKE",
    intakeRound: 0,
    maxIntakeRounds: 2,
    scopeRevisionCount: 0,
    maxScopeRevisions: 2,
    implementationAttempt: 1,
    maxImplementationAttempts: 3,
    approvedScope: null,
    humanApproval: false,
    baseRef: null,
    updatedAt: new Date().toISOString(),
  };

  saveState(defaultState, rootDir);
  return defaultState;
}

/**
 * Persists the workflow state to .gated-change/state.json.
 */
export function saveState(state: WorkflowState, rootDir: string = getRepoRoot()): void {
  ensureGatedChangeDir(rootDir);
  state.updatedAt = new Date().toISOString();
  const filePath = join(rootDir, GATED_CHANGE_DIR, STATE_FILE);
  writeFileSync(filePath, JSON.stringify(state, null, 2), "utf-8");
}

/**
 * Loads the approval lock if one exists and is ACTIVE.
 * Automatically invalidates stale locks if the issue number does not match current state.
 */
export function loadApprovalLock(rootDir: string = getRepoRoot()): ApprovalLock | null {
  ensureGatedChangeDir(rootDir);
  const filePath = join(rootDir, GATED_CHANGE_DIR, LOCK_FILE);
  if (!existsSync(filePath)) return null;

  try {
    const raw = readFileSync(filePath, "utf-8");
    const lock = JSON.parse(raw) as ApprovalLock;
    if (lock.status !== "ACTIVE") return null;

    // Detect stale lock from a previous issue
    const state = loadState(rootDir);
    if (state.issue.number > 0 && lock.issueNumber !== state.issue.number) {
      appendAuditLog(
        {
          sessionId: state.sessionId,
          action: "stale_lock_detected_and_invalidated",
          decision: "deny",
          details: {
            lockIssue: lock.issueNumber,
            currentIssue: state.issue.number,
          },
        },
        rootDir
      );
      revokeApprovalLock("EXHAUSTED", rootDir);
      return null;
    }

    return lock;
  } catch {
    return null;
  }
}

/**
 * Persists an approval lock to .gated-change/approval.lock.
 */
export function saveApprovalLock(lock: ApprovalLock, rootDir: string = getRepoRoot()): void {
  ensureGatedChangeDir(rootDir);
  const filePath = join(rootDir, GATED_CHANGE_DIR, LOCK_FILE);
  writeFileSync(filePath, JSON.stringify(lock, null, 2), "utf-8");
}

/**
 * Marks the approval lock as revoked or exhausted.
 */
export function revokeApprovalLock(
  status: "EXHAUSTED" | "REVOKED",
  rootDir: string = getRepoRoot()
): void {
  ensureGatedChangeDir(rootDir);
  const filePath = join(rootDir, GATED_CHANGE_DIR, LOCK_FILE);
  if (!existsSync(filePath)) return;

  try {
    const raw = readFileSync(filePath, "utf-8");
    const lock = JSON.parse(raw) as ApprovalLock;
    lock.status = status;
    saveApprovalLock(lock, rootDir);

    const state = loadState(rootDir);
    state.humanApproval = false;
    saveState(state, rootDir);
  } catch {
    // Ignore error if lock file cannot be parsed
  }
}

/**
 * Appends a tamper-evident entry to .gated-change/audit.jsonl.
 */
export function appendAuditLog(
  entry: Omit<AuditLogEntry, "timestamp">,
  rootDir: string = getRepoRoot()
): void {
  ensureGatedChangeDir(rootDir);
  const fullEntry: AuditLogEntry = {
    ...entry,
    timestamp: new Date().toISOString(),
  };
  const filePath = join(rootDir, GATED_CHANGE_DIR, AUDIT_FILE);
  appendFileSync(filePath, JSON.stringify(fullEntry) + "\n", "utf-8");
}

/**
 * Matches an agent name accounting for Copilot namespace qualification
 * (e.g. "gated-change-developer" or "gated-change:gated-change-developer").
 */
export function isAgentMatch(targetAgent: string | undefined, expectedName: string): boolean {
  if (!targetAgent) return false;
  return (
    targetAgent === expectedName ||
    targetAgent.endsWith(`:${expectedName}`) ||
    targetAgent.endsWith(`/${expectedName}`)
  );
}

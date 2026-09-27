import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { resolve, relative, join } from "node:path";
import type { WorkflowState, ApprovalLock, AuditLogEntry } from "./types.js";

export const GATED_CHANGE_DIR = ".gated-change";
export const STATE_FILE = "state.json";
export const LOCK_FILE = "approval.lock";
export const AUDIT_FILE = "audit.jsonl";

/**
 * Normalizes any Windows or POSIX path into a clean, relative POSIX path
 * from the repository root (e.g. "src/auth/service.ts").
 */
export function toPosixRelative(filePath: string, rootDir: string = process.cwd()): string {
  const full = resolve(rootDir, filePath);
  const rel = relative(rootDir, full);
  return rel.split("\\").join("/").replace(/^\.\//, "");
}

/**
 * Ensures the runtime .gated-change directory exists.
 */
export function ensureGatedChangeDir(rootDir: string = process.cwd()): string {
  const dir = join(rootDir, GATED_CHANGE_DIR);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Loads the current workflow state, or initializes a default state if not present.
 */
export function loadState(rootDir: string = process.cwd()): WorkflowState {
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
export function saveState(state: WorkflowState, rootDir: string = process.cwd()): void {
  ensureGatedChangeDir(rootDir);
  state.updatedAt = new Date().toISOString();
  const filePath = join(rootDir, GATED_CHANGE_DIR, STATE_FILE);
  writeFileSync(filePath, JSON.stringify(state, null, 2), "utf-8");
}

/**
 * Loads the approval lock if one exists and is ACTIVE.
 */
export function loadApprovalLock(rootDir: string = process.cwd()): ApprovalLock | null {
  ensureGatedChangeDir(rootDir);
  const filePath = join(rootDir, GATED_CHANGE_DIR, LOCK_FILE);
  if (!existsSync(filePath)) return null;

  try {
    const raw = readFileSync(filePath, "utf-8");
    const lock = JSON.parse(raw) as ApprovalLock;
    return lock.status === "ACTIVE" ? lock : null;
  } catch {
    return null;
  }
}

/**
 * Persists an approval lock to .gated-change/approval.lock.
 */
export function saveApprovalLock(lock: ApprovalLock, rootDir: string = process.cwd()): void {
  ensureGatedChangeDir(rootDir);
  const filePath = join(rootDir, GATED_CHANGE_DIR, LOCK_FILE);
  writeFileSync(filePath, JSON.stringify(lock, null, 2), "utf-8");
}

/**
 * Marks the approval lock as revoked or exhausted.
 */
export function revokeApprovalLock(
  status: "EXHAUSTED" | "REVOKED",
  rootDir: string = process.cwd()
): void {
  const lock = loadApprovalLock(rootDir);
  if (!lock) return;

  lock.status = status;
  saveApprovalLock(lock, rootDir);

  // Update state.json as well
  const state = loadState(rootDir);
  state.humanApproval = false;
  saveState(state, rootDir);
}

/**
 * Appends a tamper-evident entry to .gated-change/audit.jsonl.
 */
export function appendAuditLog(
  entry: Omit<AuditLogEntry, "timestamp">,
  rootDir: string = process.cwd()
): void {
  ensureGatedChangeDir(rootDir);
  const fullEntry: AuditLogEntry = {
    ...entry,
    timestamp: new Date().toISOString(),
  };
  const filePath = join(rootDir, GATED_CHANGE_DIR, AUDIT_FILE);
  appendFileSync(filePath, JSON.stringify(fullEntry) + "\n", "utf-8");
}

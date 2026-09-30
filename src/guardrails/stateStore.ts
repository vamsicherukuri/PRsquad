import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, realpathSync } from "node:fs";
import { resolve, relative, join, isAbsolute, dirname, basename } from "node:path";
import { execSync } from "node:child_process";
import type { WorkflowState, ApprovalLock, AuditLogEntry } from "./types.js";

export const GATED_CHANGE_DIR = ".gated-change";
export const STATE_FILE = "state.json";
export const LOCK_FILE = "approval.lock";
export const AUDIT_FILE = "audit.jsonl";

let cachedRepoRoot: string | null = null;

/**
 * Resolves the repository root directory safely.
 * Supports explicit working directories (such as isolated Copilot worktrees).
 */
export function getRepoRoot(preferredDir?: string): string {
  let startDir = preferredDir || process.cwd();
  try {
    if (existsSync(startDir)) {
      startDir = realpathSync.native(startDir);
    }
  } catch {}
  try {
    const stdout = execSync("git rev-parse --show-toplevel", {
      cwd: startDir,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return stdout.trim().replace(/\\/g, "/");
  } catch {
    if (cachedRepoRoot && !preferredDir) return cachedRepoRoot;
    const fallback = startDir.replace(/\\/g, "/");
    if (!preferredDir) cachedRepoRoot = fallback;
    return fallback;
  }
}

/**
 * Normalizes any Windows or POSIX path into a clean, relative POSIX path
 * from the repository root (e.g. "src/auth/service.ts").
 */
export function toPosixRelative(filePath: string, rootDir: string = getRepoRoot()): string {
  let cleanFilePath = filePath.replace(/\\/g, "/");
  let cleanRootDir = rootDir.replace(/\\/g, "/");

  // On Windows, resolve 8.3 short paths (e.g. VCHERU~1 -> vcherukuri)
  try {
    if (existsSync(filePath)) {
      cleanFilePath = realpathSync.native(filePath).replace(/\\/g, "/");
    } else if (existsSync(dirname(filePath))) {
      const canonicalDir = realpathSync.native(dirname(filePath)).replace(/\\/g, "/");
      cleanFilePath = `${canonicalDir}/${basename(filePath)}`;
    }
  } catch {}

  try {
    if (existsSync(rootDir)) {
      cleanRootDir = realpathSync.native(rootDir).replace(/\\/g, "/");
    }
  } catch {}

  // If filePath is already prefixed with rootDir, cleanly strip it
  if (cleanFilePath.toLowerCase().startsWith(cleanRootDir.toLowerCase() + "/")) {
    return cleanFilePath.slice(cleanRootDir.length + 1);
  }
  if (cleanFilePath.toLowerCase() === cleanRootDir.toLowerCase()) {
    return "";
  }

  const full = resolve(rootDir, filePath);
  let rel = relative(rootDir, full);

  // If relative path escaped rootDir with '..' but filePath is an absolute path,
  // attempt to locate the true worktree root for filePath
  if (rel.startsWith("..") && isAbsolute(filePath)) {
    try {
      const fileWorktreeRoot = execSync("git rev-parse --show-toplevel", {
        cwd: dirname(filePath),
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim().replace(/\\/g, "/");
      if (fileWorktreeRoot && cleanFilePath.toLowerCase().startsWith(fileWorktreeRoot.toLowerCase() + "/")) {
        return cleanFilePath.slice(fileWorktreeRoot.length + 1);
      }
    } catch {}
  }

  return rel.split("\\").join("/").replace(/^\.\//, "");
}

/**
 * Finds the nearest .gated-change directory, checking the worktree first,
 * then falling back to the parent git common repository root.
 */
export function findGatedChangeDir(rootDir: string = getRepoRoot()): string {
  const localDir = join(rootDir, GATED_CHANGE_DIR);
  const localLock = join(localDir, LOCK_FILE);
  const localState = join(localDir, STATE_FILE);

  // If local directory has either lock or state, prioritize local
  if (existsSync(localLock) || existsSync(localState)) {
    return localDir;
  }

  try {
    const gitCommonDir = execSync("git rev-parse --git-common-dir", {
      cwd: rootDir,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (gitCommonDir) {
      const parentRepo = resolve(rootDir, gitCommonDir, "..");
      const parentDir = join(parentRepo, GATED_CHANGE_DIR);
      if (existsSync(parentDir)) return parentDir;
    }
  } catch {}

  return localDir;
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
  const searchDir = findGatedChangeDir(rootDir);
  const filePath = join(searchDir, STATE_FILE);
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

  // Synchronize to parent repo if running inside an isolated git worktree
  try {
    const gitCommonDir = execSync("git rev-parse --git-common-dir", {
      cwd: rootDir,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (gitCommonDir) {
      const parentRepo = resolve(rootDir, gitCommonDir, "..");
      if (parentRepo.replace(/\\/g, "/") !== rootDir.replace(/\\/g, "/")) {
        ensureGatedChangeDir(parentRepo);
        writeFileSync(join(parentRepo, GATED_CHANGE_DIR, STATE_FILE), JSON.stringify(state, null, 2), "utf-8");
      }
    }
  } catch {}
}

/**
 * Loads the approval lock if one exists and is ACTIVE.
 * Automatically invalidates stale locks if the issue number does not match current state.
 */
export function loadApprovalLock(rootDir: string = getRepoRoot()): ApprovalLock | null {
  const searchDir = findGatedChangeDir(rootDir);
  const filePath = join(searchDir, LOCK_FILE);
  if (!existsSync(filePath)) return null;

  try {
    const raw = readFileSync(filePath, "utf-8");
    const lock = JSON.parse(raw) as ApprovalLock;
    if (lock.status !== "ACTIVE") return null;

    // Detect stale lock from a previous issue
    const state = loadState(rootDir);
    if (state.issue && state.issue.number > 0 && lock.issueNumber > 0 && lock.issueNumber !== state.issue.number) {
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

  // Synchronize to parent repo if running inside an isolated git worktree
  try {
    const gitCommonDir = execSync("git rev-parse --git-common-dir", {
      cwd: rootDir,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (gitCommonDir) {
      const parentRepo = resolve(rootDir, gitCommonDir, "..");
      if (parentRepo.replace(/\\/g, "/") !== rootDir.replace(/\\/g, "/")) {
        ensureGatedChangeDir(parentRepo);
        writeFileSync(join(parentRepo, GATED_CHANGE_DIR, LOCK_FILE), JSON.stringify(lock, null, 2), "utf-8");
      }
    }
  } catch {}
}

/**
 * Marks the approval lock as revoked or exhausted.
 */
export function revokeApprovalLock(
  status: "EXHAUSTED" | "REVOKED",
  rootDir: string = getRepoRoot()
): void {
  ensureGatedChangeDir(rootDir);
  const searchDir = findGatedChangeDir(rootDir);
  const filePath = join(searchDir, LOCK_FILE);
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

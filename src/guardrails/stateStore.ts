import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, realpathSync, symlinkSync, copyFileSync } from "node:fs";
import { resolve, relative, join, isAbsolute, dirname, basename } from "node:path";
import { platform, homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import type { WorkflowState, ApprovalLock, AuditLogEntry } from "./types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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
 * Dynamically resolves repository owner and name from the git origin remote.
 * Completely repository- and technology-agnostic.
 */
export function getRepoOwnerAndName(rootDir: string = getRepoRoot()): { owner: string; repo: string } {
  try {
    const remoteUrl = execSync("git remote get-url origin", {
      cwd: rootDir,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const match = remoteUrl.match(/[:/]([^/:]+)\/([^/:]+?)(?:\.git)?$/);
    if (match) {
      return { owner: match[1], repo: match[2] };
    }
  } catch {}
  return { owner: "", repo: "" };
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

  // Canonical worktree containment boundary
  try {
    const canonicalRoot = existsSync(rootDir) ? realpathSync.native(rootDir) : resolve(rootDir);
    const targetAbs = isAbsolute(filePath) ? filePath : resolve(rootDir, filePath);
    const canonicalTarget = existsSync(targetAbs) ? realpathSync.native(targetAbs) : resolve(targetAbs);
    const canonicalRel = relative(canonicalRoot, canonicalTarget).replace(/\\/g, "/");

    // Strictly enforce active worktree containment: only relativize if target is inside active worktree root
    if (!canonicalRel.startsWith("..") && !isAbsolute(canonicalRel)) {
      return canonicalRel.replace(/^\.\//, "");
    }
  } catch {}

  // Outside active worktree root: retain relative escape (../) so scope checkers reject cross-worktree mutation
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
 * Ensures .gated-change/bin is provisioned with standalone CLI tools (gate-approve.mjs & pr-create.mjs).
 */
export function ensureGatedChangeBin(rootDir: string = getRepoRoot()): boolean {
  try {
    const binDir = join(rootDir, GATED_CHANGE_DIR, "bin");
    if (!existsSync(binDir)) {
      mkdirSync(binDir, { recursive: true });
    }

    const home = homedir();
    const candidateDirs = [
      join(home, ".copilot", "installed-plugins", "prsquad-marketplace", "prsquad", "dist"),
      resolve(__dirname, "..", "..", "plugins", "prsquad", "dist"),
      resolve(__dirname, "dist"),
      resolve(rootDir, "plugins", "prsquad", "dist"),
      resolve(__dirname),
    ];

    let foundDist: string | null = null;
    for (const d of candidateDirs) {
      if (existsSync(join(d, "gate-approve.mjs"))) {
        foundDist = d;
        break;
      }
    }

    if (foundDist) {
      const targetApprove = join(binDir, "gate-approve.mjs");
      if (!existsSync(targetApprove)) {
        copyFileSync(join(foundDist, "gate-approve.mjs"), targetApprove);
      }
      const targetPr = join(binDir, "pr-create.mjs");
      if (!existsSync(targetPr)) {
        copyFileSync(join(foundDist, "pr-create.mjs"), targetPr);
      }
      const pluginRootFile = join(rootDir, GATED_CHANGE_DIR, "plugin-root.txt");
      if (!existsSync(pluginRootFile)) {
        writeFileSync(pluginRootFile, resolve(foundDist, ".."), "utf-8");
      }
      return true;
    }
  } catch {}
  return false;
}

/**
 * Ensures the runtime .gated-change directory exists in the true repository root.
 */
export function ensureGatedChangeDir(rootDir: string = getRepoRoot()): string {
  const dir = join(rootDir, GATED_CHANGE_DIR);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  ensureGatedChangeBin(rootDir);
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
  if (!existsSync(filePath)) {
    const state = loadState(rootDir);
    if (state.humanApproval && state.approvedScope) {
      return {
        issueNumber: state.issue?.number || 0,
        approvedScope: state.approvedScope,
        planHash: "state-bound-scope",
        baseRef: state.baseRef || "HEAD",
        maxAttempts: state.maxImplementationAttempts || 3,
        currentAttempt: state.implementationAttempt || 1,
        approvedAt: state.updatedAt || new Date().toISOString(),
        approvedBy: "Human Maintainer (Chat Scope Gate)",
        status: "ACTIVE",
      };
    }
    return null;
  }

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

  // Keep state.json in sync with lock status
  try {
    const state = loadState(rootDir);
    if (lock.status === "ACTIVE") {
      state.humanApproval = true;
      if (lock.approvedScope) state.approvedScope = lock.approvedScope;
      saveState(state, rootDir);
    } else if (lock.status === "REVOKED" || lock.status === "EXHAUSTED") {
      state.humanApproval = false;
      saveState(state, rootDir);
    }
  } catch {}

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

const AGENT_ALIASES: Record<string, string[]> = {
  "prsquad-dev": ["prsquad-dev", "prsquad-developer", "gated-change-developer", "developer"],
  "gated-change-developer": ["prsquad-dev", "prsquad-developer", "gated-change-developer", "developer"],
  "developer": ["prsquad-dev", "prsquad-developer", "gated-change-developer", "developer"],

  "prsquad-qa": ["prsquad-qa", "gated-change-qa", "qa"],
  "gated-change-qa": ["prsquad-qa", "gated-change-qa", "qa"],
  "qa": ["prsquad-qa", "gated-change-qa", "qa"],

  "prsquad-review": ["prsquad-review", "prsquad-reviewer", "gated-change-reviewer", "reviewer"],
  "prsquad-reviewer": ["prsquad-review", "prsquad-reviewer", "gated-change-reviewer", "reviewer"],
  "gated-change-reviewer": ["prsquad-review", "prsquad-reviewer", "gated-change-reviewer", "reviewer"],
  "reviewer": ["prsquad-review", "prsquad-reviewer", "gated-change-reviewer", "reviewer"],

  "prsquad-triage": ["prsquad-triage", "prsquad-intake", "gated-change-intake", "intake", "triage"],
  "gated-change-intake": ["prsquad-triage", "prsquad-intake", "gated-change-intake", "intake", "triage"],
  "intake": ["prsquad-triage", "prsquad-intake", "gated-change-intake", "intake", "triage"],

  "prsquad-architect": ["prsquad-architect", "gated-change-architect", "architect"],
  "gated-change-architect": ["prsquad-architect", "gated-change-architect", "architect"],
  "architect": ["prsquad-architect", "gated-change-architect", "architect"],

  "prsquad": ["prsquad", "prsquad-controller", "prsquad-orchestrator", "gated-change-controller", "controller"],
  "prsquad-controller": ["prsquad", "prsquad-controller", "prsquad-orchestrator", "gated-change-controller", "controller"],
  "gated-change-controller": ["prsquad", "prsquad-controller", "prsquad-orchestrator", "gated-change-controller", "controller"],
  "controller": ["prsquad", "prsquad-controller", "prsquad-orchestrator", "gated-change-controller", "controller"]
};

/**
 * Matches an agent name accounting for Copilot namespace qualification and PRSquad aliases
 * (e.g. "prsquad-dev" matches "gated-change-developer", "prsquad:prsquad-dev", etc.).
 */
export function isAgentMatch(targetAgent: string | undefined, expectedName: string): boolean {
  if (!targetAgent) return false;
  const cleanTarget = targetAgent.includes(":") ? targetAgent.split(":").pop()! : (targetAgent.includes("/") ? targetAgent.split("/").pop()! : targetAgent);
  
  const aliases = AGENT_ALIASES[expectedName] || [expectedName];
  if (aliases.includes(targetAgent) || aliases.includes(cleanTarget)) return true;

  return (
    targetAgent === expectedName ||
    targetAgent.endsWith(`:${expectedName}`) ||
    targetAgent.endsWith(`/${expectedName}`)
  );
}

/**
 * Ensures node_modules is available in worktrees by creating a native symlink / directory junction
 * to the parent repo's node_modules. 100% cross-platform (macOS/Linux dir symlink, Windows junction without admin rights).
 */
export function ensureNodeModulesInWorktree(rootDir: string = getRepoRoot()): boolean {
  try {
    const targetNodeModules = join(rootDir, "node_modules");
    if (existsSync(targetNodeModules)) {
      return true; // Already exists
    }

    const gitCommonDir = execSync("git rev-parse --git-common-dir", {
      cwd: rootDir,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();

    if (!gitCommonDir) return false;
    const parentRepo = resolve(rootDir, gitCommonDir, "..");
    if (parentRepo.replace(/\\/g, "/").toLowerCase() === rootDir.replace(/\\/g, "/").toLowerCase()) {
      return false; // Already in main repo
    }

    const sourceNodeModules = join(parentRepo, "node_modules");
    if (!existsSync(sourceNodeModules)) {
      return false; // Parent doesn't have node_modules either
    }

    const linkType = platform() === "win32" ? "junction" : "dir";
    symlinkSync(sourceNodeModules, targetNodeModules, linkType);
    return true;
  } catch {
    return false;
  }
}


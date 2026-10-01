import { execSync } from "node:child_process";
import { toPosixRelative } from "./stateStore.js";

export interface ScopeCheckResult {
  allowed: boolean;
  reason?: string;
  normalizedPath: string;
}

const SYSTEM_PROTECTED_PREFIXES = [
  ".git/",
  ".github/",
  ".gated-change/",
  "plugins/",
];

/**
 * Gets the current active git branch name.
 */
export function getCurrentGitBranch(rootDir: string = process.cwd()): string {
  try {
    const stdout = execSync("git branch --show-current", {
      cwd: rootDir,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return stdout.trim();
  } catch {
    return "";
  }
}

/**
 * Guarantees that implementation never occurs directly on 'main' or 'master'.
 * Automatically branches to 'fix/issue-<num>' if safe, or blocks with an actionable message.
 */
export function ensureIsolatedBranch(
  issueNumber: number = 0,
  rootDir: string = process.cwd()
): { ok: boolean; branch: string; reason?: string } {
  const current = getCurrentGitBranch(rootDir);
  if (!current || (current !== "main" && current !== "master")) {
    return { ok: true, branch: current };
  }

  const targetBranch = `fix/issue-${issueNumber || "gated-change"}`;
  try {
    try {
      execSync(`git checkout ${targetBranch}`, {
        cwd: rootDir,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      return { ok: true, branch: targetBranch };
    } catch {
      execSync(`git checkout -b ${targetBranch}`, {
        cwd: rootDir,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      return { ok: true, branch: targetBranch };
    }
  } catch {
    return {
      ok: false,
      branch: current,
      reason: `BRANCH_POLICY_DENIAL: Modifications directly on protected branch '${current}' are forbidden. Automatic switch to '${targetBranch}' failed. Please switch to a dedicated fix branch before editing files.`,
    };
  }
}

/**
 * Validates whether a file write/edit is permitted within the approved scope and isolated branch.
 */
export function isEditAllowed(
  filePath: string,
  approvedScope: string | null,
  rootDir: string = process.cwd(),
  issueNumber: number = 0
): ScopeCheckResult {
  const normalized = toPosixRelative(filePath, rootDir);

  // 1. System-level protection: Agents may never edit governance, git, or plugin configurations
  for (const prefix of SYSTEM_PROTECTED_PREFIXES) {
    if (normalized === prefix.slice(0, -1) || normalized.startsWith(prefix)) {
      return {
        allowed: false,
        reason: `SYSTEM_POLICY_DENIAL: Path '${normalized}' is a protected system directory and cannot be modified by agents.`,
        normalizedPath: normalized,
      };
    }
  }

  // 2. Check if a human-approved scope exists
  if (!approvedScope || approvedScope.trim() === "") {
    return {
      allowed: false,
      reason: "POLICY_DENIAL: No approved scope found. Code edits are blocked until the Human Scope Gate approves the plan.",
      normalizedPath: normalized,
    };
  }

  // 3. Branch isolation check: prevent modifying main/master directly
  const branchCheck = ensureIsolatedBranch(issueNumber, rootDir);
  if (!branchCheck.ok) {
    return {
      allowed: false,
      reason: branchCheck.reason,
      normalizedPath: normalized,
    };
  }

  // 4. Split multi-path approved scopes on ';' and ',' into individual candidate entries
  const scopeEntries = approvedScope
    .split(/[;,]/)
    .map((entry) =>
      entry
        .trim()
        .replace(/\\/g, "/")
        .replace(/^\/+/, "")
        .replace(/\/+$/, "")
    )
    .filter((entry) => entry.length > 0);

  if (scopeEntries.length === 0) {
    return {
      allowed: false,
      reason: `POLICY_DENIAL: Approved scope '${approvedScope}' contains no valid directory or file entries. Code edits are blocked.`,
      normalizedPath: normalized,
    };
  }

  // 5. Prefix containment against candidate entries
  const isMatch = scopeEntries.some(
    (cleanScope) =>
      normalized === cleanScope ||
      normalized.startsWith(cleanScope + "/")
  );

  if (!isMatch) {
    return {
      allowed: false,
      reason: `SCOPE_VIOLATION: Path '${normalized}' is outside the approved scope prefix '${scopeEntries.join("/' or '")}/'.`,
      normalizedPath: normalized,
    };
  }

  return {
    allowed: true,
    normalizedPath: normalized,
  };
}

/**
 * Builds the structured Smart Nudge message for the Developer agent on blocked writes.
 */
export function formatScopeDenialNudge(
  blockedPath: string,
  approvedScope: string
): string {
  return [
    `POLICY_DENIAL: Write to '${blockedPath}' was BLOCKED by the deterministic write barrier.`,
    `The human-approved scope boundary is: '${approvedScope}'.`,
    "",
    "INSTRUCTIONS FOR DEVELOPER AGENT:",
    `1. Do NOT attempt to edit '${blockedPath}' again.`,
    `2. If your fix can be completed within '${approvedScope}', adapt your implementation to stay strictly inside that boundary.`,
    `3. If '${blockedPath}' is strictly necessary to solve the issue, halt further code edits immediately and return your final handoff with:`,
    JSON.stringify(
      {
        status: "SCOPE_AMENDMENT_REQUIRED",
        scopeAmendmentRequest: {
          requestedPaths: [blockedPath],
          reason: `<Explain why '${blockedPath}' is required and why Architect's plan missed it>`,
          impactIfRejected: "<Explain the impact on functionality if this scope expansion is denied>",
        },
      },
      null,
      2
    ),
  ].join("\n");
}

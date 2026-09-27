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
 * Validates whether a file write/edit is permitted within the approved scope.
 */
export function isEditAllowed(
  filePath: string,
  approvedScope: string | null,
  rootDir: string = process.cwd()
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
  if (!approvedScope) {
    return {
      allowed: false,
      reason: "POLICY_DENIAL: No approved scope found. Code edits are blocked until the Human Scope Gate approves the plan.",
      normalizedPath: normalized,
    };
  }

  const cleanScope = approvedScope
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");

  // 3. Prefix containment
  const isMatch =
    normalized === cleanScope ||
    normalized.startsWith(cleanScope + "/");

  if (!isMatch) {
    return {
      allowed: false,
      reason: `SCOPE_VIOLATION: Path '${normalized}' is outside the approved scope prefix '${cleanScope}/'.`,
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

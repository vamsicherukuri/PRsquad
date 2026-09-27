export interface BashValidationResult {
  allowed: boolean;
  reason?: string;
}

// Reviewer may ONLY execute non-mutating git inspection commands
const REVIEWER_ALLOWLIST_REGEX =
  /^\s*git\s+(diff|status|show|log|ls-files|rev-parse)(\s+.*)?$/i;

// Mutating git operations that QA and Developer must never run
const MUTATING_GIT_REGEX =
  /\bgit\s+(push|commit|checkout\s+(main|master)|reset\s+--hard|clean\s+-fdx)\b/i;

// Dangerous destructive or exfiltration commands
const DANGEROUS_SYSTEM_REGEX =
  /\b(rm\s+-rf\s+\/|npm\s+publish|curl\s+-X\s+POST|wget\s+--post)\b/i;

/**
 * Validates whether a shell command is permissible for the calling agent.
 */
export function validateCommandForAgent(
  command: string,
  agent: string = "unknown"
): BashValidationResult {
  const trimmed = command.trim();

  // 1. Reviewer Agent: Strict Allowlist
  if (agent === "gated-change-reviewer") {
    // Disallow output redirection
    if (trimmed.includes(">") || trimmed.includes(">>")) {
      return {
        allowed: false,
        reason: "POLICY_DENIAL: Reviewer agent is strictly read-only and cannot use file redirects ('>' or '>>').",
      };
    }

    if (!REVIEWER_ALLOWLIST_REGEX.test(trimmed)) {
      return {
        allowed: false,
        reason: `POLICY_DENIAL: Reviewer agent is restricted to non-mutating git inspection commands (git diff, git status, git show, git log, git ls-files). Command '${trimmed}' is blocked.`,
      };
    }

    return { allowed: true };
  }

  // 2. Global Safety: Block destructive remote push or publishing
  if (DANGEROUS_SYSTEM_REGEX.test(trimmed)) {
    return {
      allowed: false,
      reason: `POLICY_DENIAL: Command '${trimmed}' contains forbidden destructive or publishing operations.`,
    };
  }

  // 3. QA Agent: Prevent mutating git repository state
  if (agent === "gated-change-qa") {
    if (MUTATING_GIT_REGEX.test(trimmed)) {
      return {
        allowed: false,
        reason: `POLICY_DENIAL: QA agent cannot execute mutating git commands ('${trimmed}'). QA executes tests for validation only.`,
      };
    }
    return { allowed: true };
  }

  // 4. Developer Agent: Block git push to remotes
  if (agent === "gated-change-developer") {
    if (/\bgit\s+push\b/i.test(trimmed)) {
      return {
        allowed: false,
        reason: "POLICY_DENIAL: Developer agent cannot push directly to remote git repositories.",
      };
    }
    return { allowed: true };
  }

  return { allowed: true };
}

import { isAgentMatch } from "./stateStore.js";

export interface BashValidationResult {
  allowed: boolean;
  reason?: string;
}

// Reviewer may ONLY execute non-mutating git inspection commands
const REVIEWER_ALLOWLIST_REGEX =
  /^\s*git\s+(diff|status|show|log|ls-files|rev-parse)(\s+.*)?$/i;

// Mutating git operations that QA must never run
const QA_MUTATING_GIT_REGEX =
  /\bgit\s+(push|commit|checkout|switch|merge|rebase|reset|clean)\b/i;

// Base branch protection: NO agent may checkout, switch to, commit to, merge, or push main/master
const PROTECTED_BASE_BRANCH_REGEX =
  /\bgit\s+(checkout|switch|commit|push|merge|rebase|reset|branch\s+-(?:d|D))\b.*?\b(?:origin\/)?(main|master)\b/i;

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

  // 1. Reviewer Agent: Strict Allowlist (supports qualified names)
  if (isAgentMatch(agent, "gated-change-reviewer")) {
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

  // 2. Base Branch Protection: Never allow mutating or switching to main/master
  if (PROTECTED_BASE_BRANCH_REGEX.test(trimmed)) {
    return {
      allowed: false,
      reason: `POLICY_DENIAL: Direct mutation, checkout, or manipulation of base branch ('main'/'master') is strictly prohibited. All work must remain on designated feature branches.`,
    };
  }

  // 3. Global Safety: Block destructive remote push or publishing
  if (DANGEROUS_SYSTEM_REGEX.test(trimmed)) {
    return {
      allowed: false,
      reason: `POLICY_DENIAL: Command '${trimmed}' contains forbidden destructive or publishing operations.`,
    };
  }

  // 4. QA Agent: Prevent mutating git repository state (supports qualified names)
  if (isAgentMatch(agent, "gated-change-qa")) {
    if (QA_MUTATING_GIT_REGEX.test(trimmed)) {
      return {
        allowed: false,
        reason: `POLICY_DENIAL: QA agent cannot execute mutating git commands ('${trimmed}'). QA executes tests for validation only.`,
      };
    }
    return { allowed: true };
  }

  // 5. Developer Agent: Block git push to remotes (supports qualified names)
  if (isAgentMatch(agent, "gated-change-developer")) {
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

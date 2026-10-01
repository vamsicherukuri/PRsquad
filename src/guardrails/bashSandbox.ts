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

// Branch deletion is strictly reserved for human maintainers. NO agent may delete branches.
const BRANCH_DELETION_REGEX = /\bgit\s+branch\s+-(?:d|D)\b/i;

// Dangerous destructive or exfiltration commands
const DANGEROUS_SYSTEM_REGEX =
  /\b(rm\s+-rf\s+\/|npm\s+publish|curl\s+-X\s+POST|wget\s+--post)\b/i;

// Any 'git clean' invocation, captured so we can inspect its flags regardless of order.
// The 's' (dotAll) flag ensures '.' matches newlines too, so the full remainder of the
// command string (including flags appearing after an embedded newline) is captured,
// rather than only the rest of the current line.
const GIT_CLEAN_COMMAND_REGEX = /\bgit\s+clean\b(.*)$/is;

/**
 * Determines whether a 'git clean' invocation includes any force-type flag
 * (e.g. -f, --force, -fd, -fdx, -fx, -xdf, -df, -dfx), in any flag order,
 * while explicitly exempting dry-run invocations (-n / --dry-run).
 */
function isForceGitClean(trimmed: string): boolean {
  const match = trimmed.match(GIT_CLEAN_COMMAND_REGEX);
  if (!match) {
    return false;
  }

  const tokens = (match[1] || "").split(/\s+/).filter(Boolean);

  for (const token of tokens) {
    // Once a bare '--' separator is encountered, all remaining tokens are pathspecs
    // (not flags) and must not be evaluated as force-flag clusters.
    if (token === "--") {
      break;
    }
    if (token === "--force") {
      return true;
    }
    if (token === "--dry-run" || token === "-n") {
      continue;
    }
    // Short-option cluster (e.g. -f, -fd, -fdx, -fx, -xdf, -df, -dfx) containing 'f'
    if (/^-[^-]*f[^-]*$/i.test(token)) {
      return true;
    }
  }

  return false;
}

/**
 * Validates whether a shell command is permissible for the calling agent.
 */
export function validateCommandForAgent(
  command: string,
  agent: string = "unknown"
): BashValidationResult {
  const trimmed = command.trim();

  // 0. Global Safety: Block destructive 'git clean' force-flag invocations for ALL agents.
  // Dry-run invocations ('git clean -n' / 'git clean --dry-run') remain allowed and fall
  // through to the normal per-agent logic below.
  if (isForceGitClean(trimmed)) {
    return {
      allowed: false,
      reason: "POLICY_DENIAL: Destructive git clean operations with force flags are prohibited.",
    };
  }

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

  // 3. Branch Deletion Guardrail: No agent may delete branches (human-only privilege)
  if (BRANCH_DELETION_REGEX.test(trimmed)) {
    return {
      allowed: false,
      reason: "POLICY_DENIAL: Autonomous branch deletion is strictly forbidden. Branch deletion and rollback are exclusively reserved for human maintainers.",
    };
  }

  // 4. Global Safety: Block destructive remote push or publishing
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

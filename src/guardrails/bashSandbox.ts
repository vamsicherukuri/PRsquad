import { isAgentMatch, getRepoRoot } from "./stateStore.js";
import { detectRepoStack, isCommandAllowedByTooling } from "./toolingBridge.js";

export interface BashValidationResult {
  allowed: boolean;
  reason?: string;
}

// Non-mutating git inspection commands allowed for Reviewer and QA
const GIT_INSPECTION_ALLOWLIST_REGEX =
  /^\s*git\s+(diff|status|show|log|ls-files|rev-parse)(\s+.*)?$/i;

// Generic/native test runner regex patterns
const TEST_RUNNER_ALLOWLIST_REGEX =
  /^\s*(?:(?:npm|pnpm|yarn|bun)\s+(?:test|run\s+test\S*)|npx(?:\s+-[a-zA-Z0-9_\-]+)*\s+(?:vitest|jest|mocha|playwright|cypress|tsx|ts-node|ava|tape|pytest|karma|jasmine|tap)|pytest|python(?:3)?\s+-m\s+(?:unittest|pytest)|(?:mvn|gradle|\.\/gradlew)\s+(?:test|verify|check)|go\s+test|cargo\s+test|dotnet\s+test)(?:\s+.*)?$/i;

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

// Destructive git clean operations with force flags (-f, --force, -fd, -fdx, -fx, -xdf)
const DESTRUCTIVE_GIT_CLEAN_REGEX =
  /\bgit\s+clean\b.*?(?:-[a-zA-Z]*f[a-zA-Z]*\b|--force\b)/i;

/**
 * Validates whether a shell command is permissible for the calling agent.
 */
export function validateCommandForAgent(
  command: string,
  agent: string = "unknown",
  rootDir?: string
): BashValidationResult {
  const trimmed = command.trim();

  // Global Safety: Autonomous agents cannot execute scope-approve to self-mint locks
  const AGENT_SELF_APPROVE_REGEX = /\bscope-approve(?:\.ts|\.js)?\b/i;
  if (AGENT_SELF_APPROVE_REGEX.test(trimmed)) {
    return {
      allowed: false,
      reason: "POLICY_DENIAL (HUMAN_ONLY_GATE): Autonomous agents are strictly prohibited from executing 'scope-approve'. Scope authorization is exclusively reserved for the human maintainer.",
    };
  }

  // Shell chaining / composition operators
  const SHELL_CHAINING_REGEX = /[;&|\n]/;

  // 1. Code Review Agent: Strict Allowlist (supports qualified names)
  if (isAgentMatch(agent, "prsquad-review") || isAgentMatch(agent, "gated-change-reviewer")) {
    // Disallow output redirection
    if (trimmed.includes(">") || trimmed.includes(">>")) {
      return {
        allowed: false,
        reason: "POLICY_DENIAL: Code Review agent is strictly read-only and cannot use file redirects ('>' or '>>').",
      };
    }

    // Disallow shell chaining operators (;, &&, ||, |)
    if (SHELL_CHAINING_REGEX.test(trimmed)) {
      return {
        allowed: false,
        reason: "POLICY_DENIAL (SHELL_COMPOSITION_NOT_PERMITTED): Code Review agent cannot use shell composition or chaining operators (';', '&&', '||', '|').",
      };
    }

    if (!GIT_INSPECTION_ALLOWLIST_REGEX.test(trimmed)) {
      return {
        allowed: false,
        reason: `POLICY_DENIAL: Code Review agent is restricted to non-mutating git inspection commands (git diff, git status, git show, git log, git ls-files, git rev-parse). Command '${trimmed}' is blocked.`,
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

  // 5. Destructive Workspace Clean: Block git clean operations with force flags across all agents
  if (DESTRUCTIVE_GIT_CLEAN_REGEX.test(trimmed)) {
    return {
      allowed: false,
      reason:
        "POLICY_DENIAL: Destructive git clean operations with force flags are prohibited. Use dry-run ('git clean -n') for inspection.",
    };
  }

  // 6. QA Agent: Strict Allowlist (Test execution & non-mutating git inspection only)
  if (isAgentMatch(agent, "prsquad-qa") || isAgentMatch(agent, "gated-change-qa")) {
    // A. Disallow shell file redirection
    if (trimmed.includes(">") || trimmed.includes(">>")) {
      return {
        allowed: false,
        reason: "POLICY_DENIAL: QA agent cannot use file redirects ('>' or '>>'). QA executes tests for validation only with zero disk mutations.",
      };
    }

    // B. Disallow shell chaining operators (;, &&, ||, |)
    if (SHELL_CHAINING_REGEX.test(trimmed)) {
      return {
        allowed: false,
        reason: "POLICY_DENIAL (SHELL_COMPOSITION_NOT_PERMITTED): QA agent cannot use shell composition or chaining operators (';', '&&', '||', '|').",
      };
    }

    // C. Explicit check against mutating git commands
    if (QA_MUTATING_GIT_REGEX.test(trimmed)) {
      return {
        allowed: false,
        reason: `POLICY_DENIAL: QA agent cannot execute mutating git commands ('${trimmed}'). QA executes tests for validation only.`,
      };
    }

    // C. Non-mutating git inspections
    if (GIT_INSPECTION_ALLOWLIST_REGEX.test(trimmed)) {
      return { allowed: true };
    }

    // D. Configured repository tooling
    try {
      const config = detectRepoStack(rootDir || getRepoRoot());
      if (config) {
        if (isCommandAllowedByTooling(trimmed, config)) {
          return { allowed: true };
        }
        if (config.buildCommand && trimmed.startsWith(config.buildCommand)) {
          return { allowed: true };
        }
        if (config.lintCommand && trimmed.startsWith(config.lintCommand)) {
          return { allowed: true };
        }
      }
    } catch {}

    // E. Generic / native test runner patterns
    if (TEST_RUNNER_ALLOWLIST_REGEX.test(trimmed)) {
      return { allowed: true };
    }

    // F. Deny everything else
    return {
      allowed: false,
      reason: `POLICY_DENIAL: QA agent is strictly restricted to test execution and non-mutating git inspections. Command '${trimmed}' is blocked by policy.`,
    };
  }

  // 6. Developer Agent: Block git push to remotes (supports qualified names)
  if (isAgentMatch(agent, "prsquad-dev") || isAgentMatch(agent, "gated-change-developer")) {
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

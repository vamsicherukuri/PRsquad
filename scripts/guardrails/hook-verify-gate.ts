#!/usr/bin/env node
/**
 * Hook: Mechanical Scope Gate Verification (preToolUse / postToolUse)
 * Intercepts delegation to specialist agents and enforces declarative stage policies.
 * Ensures cumulative commit diff range: git diff ${base} HEAD for AST symbol sweeps.
 * Synchronizes living workflow dashboard on GitHub issue comments across all specialist phases.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { execSync } from "node:child_process";
import {
  loadState,
  saveState,
  loadApprovalLock,
  getRepoRoot,
  ensureNodeModulesInWorktree,
} from "../../src/guardrails/stateStore.js";
import {
  loadDashboardState,
  formatChatCreditMeter,
  getGroundTruthTelemetry,
} from "../../src/guardrails/issueDashboard.js";
import {
  lookupStagePolicy,
  buildEnrichedPostToolOutput,
  type StageContext,
} from "../../src/guardrails/stagePolicies.js";
import type { HookInput, HookOutput } from "../../src/guardrails/types.js";

function resolveIssueNumber(input: HookInput, toolArgs: any, state: any, lock: any): number {
  if (toolArgs.issueNumber && Number(toolArgs.issueNumber) > 0) {
    return Number(toolArgs.issueNumber);
  }
  const prompt = String(toolArgs.prompt || input.toolArgs?.prompt || "");
  const nameStr = String(toolArgs.name || "");
  const numFromName = nameStr.match(/issue-?(\d+)/i);
  if (numFromName) return parseInt(numFromName[1], 10);

  const numFromCwd = (input.cwd || "").match(/issue-?(\d+)/i);
  if (numFromCwd) return parseInt(numFromCwd[1], 10);

  // 1. Explicit prompt mention (e.g. "Resolve issue #47" or "[HUMAN_SCOPE_GATE_APPROVED...]")
  const numFromPrompt = prompt.match(/(?:issue(?:\s*number)?\s*[:#`'"\s]*|#)\s*(\d+)/i);
  if (numFromPrompt) return parseInt(numFromPrompt[1], 10);

  // 2. Active approval lock
  if (lock?.issueNumber && lock.issueNumber > 0) {
    return lock.issueNumber;
  }

  // 3. Active feature branch name
  const branch = state?.activeBranch || "";
  const branchNum = branch.match(/(?:issue-?|#)(\d+)/i);
  if (branchNum) return parseInt(branchNum[1], 10);

  // 4. Current state store
  if (state?.issue?.number && state.issue.number > 0) {
    return state.issue.number;
  }

  // 5. Active git branch in worktree
  try {
    const effectiveCwd = input.cwd || process.cwd();
    const gitBranch = execSync("git rev-parse --abbrev-ref HEAD", {
      cwd: effectiveCwd,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const numFromGit = gitBranch.match(/(?:issue-?|#)(\d+)/i);
    if (numFromGit) return parseInt(numFromGit[1], 10);
  } catch {}

  // 6. Local issue cache file
  try {
    const effectiveCwd = input.cwd || process.cwd();
    const repoRoot = getRepoRoot(effectiveCwd);
    const cacheFile = join(repoRoot, ".gated-change", "issue-cache.json");
    if (existsSync(cacheFile)) {
      const parsed = JSON.parse(readFileSync(cacheFile, "utf-8"));
      if (parsed?.number && Number(parsed.number) > 0) {
        return Number(parsed.number);
      }
    }
  } catch {}

  return Number(process.env.TARGET_ISSUE) || 0;
}

async function main() {
  if (process.argv.includes("--meter")) {
    let effectiveCwd = process.cwd();
    let repoRoot = getRepoRoot(effectiveCwd);
    let state = loadState(repoRoot);

    // If cwd was not in a repository/worktree with state, search active worktrees by latest modified time
    if (!state?.sessionId) {
      const home = homedir();
      const candidates = [
        join(home, "factory/sample repos/copilot-worktrees/prsquad"),
        join(home, "Documents/prsquad"),
        join(home, "factory/sample repos/prsquad"),
        join(home, "factory/sample repos/copilot-worktrees/gated-fix-pipeline"),
        join(home, "Documents/gated-fix-pipeline"),
        join(home, "factory/sample repos/gated-fix-pipeline"),
      ];
      let bestState: any = null;
      let bestMtime = 0;
      let bestRepo = repoRoot;

      for (const parent of candidates) {
        if (existsSync(parent)) {
          try {
            const entries = readdirSync(parent, { withFileTypes: true });
            const dirs = entries.filter((d) => d.isDirectory()).map((d) => join(parent, d.name));
            dirs.push(parent);
            for (const d of dirs) {
              const stateFile = join(d, ".gated-change", "state.json");
              if (existsSync(stateFile)) {
                try {
                  const stat = statSync(stateFile);
                  if (stat.mtimeMs > bestMtime) {
                    const parsed = JSON.parse(readFileSync(stateFile, "utf-8"));
                    if (parsed) {
                      bestMtime = stat.mtimeMs;
                      bestState = parsed;
                      bestRepo = d;
                    }
                  }
                } catch {}
              }
            }
          } catch {}
        }
      }
      if (bestState) {
        state = bestState;
        repoRoot = bestRepo;
      }
    }

    const dashData = loadDashboardState(repoRoot);
    let phases: Record<string, any> = dashData?.phases || {};
    if (Object.keys(phases).length === 0 && state?.phase) {
      phases = {
        intake: { status: "READY" },
        architect: { status: "PLAN_READY" },
        scopeGate: { status: state.humanApproval ? "APPROVED" : "PENDING", credits: 0.0 },
        developer: { status: state.phase === "DEVELOPING" ? "IN_PROGRESS" : "PENDING" },
        qa: { status: "PENDING" },
        reviewer: { status: "PENDING" },
        mergeGate: { status: "PENDING", credits: 0.0 },
      };
    }

    const tele = getGroundTruthTelemetry(state?.sessionId, 0);
    if (tele && tele.turns > 0) {
      const meter = formatChatCreditMeter({
        issueNumber: state?.issue?.number || 0,
        owner: state?.issue?.owner || "",
        repo: state?.issue?.repo || "",
        lastUpdated: new Date().toISOString(),
        phases,
        telemetry: tele,
      });
      process.stdout.write(meter + "\n");
    } else {
      process.stdout.write("### ⚡ Live AI Credit Meter\n\n> Telemetry active. (Recording ground-truth token events for active session...)\n");
    }
    process.exit(0);
  }

  let rawInput = "";
  if (!process.stdin.isTTY) {
    try {
      rawInput = readFileSync(0, "utf-8");
    } catch {
      // No stdin
    }
  }

  let input: HookInput = {};
  if (rawInput.trim()) {
    input = JSON.parse(rawInput);
  }

  const firstTool = input.toolCalls?.[0];
  const toolArgs = input.toolArgs || firstTool?.args || {};
  const targetAgent =
    toolArgs.agent_type ||
    toolArgs.name ||
    toolArgs.agent ||
    input.agent;

  const policy = lookupStagePolicy(targetAgent);
  if (!policy) {
    process.stdout.write(JSON.stringify({ decision: "allow", permissionDecision: "allow" }) + "\n");
    process.exit(0);
  }

  const effectiveCwd = input.cwd || process.cwd();
  const repoRoot = getRepoRoot(effectiveCwd);
  ensureNodeModulesInWorktree(repoRoot);

  const state = loadState(repoRoot);
  const lock = loadApprovalLock(repoRoot);
  const resolvedIssue = resolveIssueNumber(input, toolArgs, state, lock);
  const sessionId = input.sessionId || state.sessionId || "";
  if (sessionId && (!state.sessionId || state.sessionId !== sessionId)) {
    state.sessionId = sessionId;
    saveState(state, repoRoot);
  }

  const prompt = String(
    toolArgs.prompt ||
    toolArgs.content ||
    toolArgs.message ||
    firstTool?.args?.prompt ||
    ""
  );

  const ctx: StageContext = {
    repoRoot,
    state,
    lock,
    resolvedIssue,
    sessionId,
    targetAgent,
    prompt,
    toolArgs,
    firstTool,
    input,
    rawOutput: input.toolResult,
  };

  // Step 4, 5, 6: PostToolUse (Validate, Commit, Return)
  if (input.toolResult) {
    const valResult = policy.validateOutput(input.toolResult, ctx);
    const commitRes = policy.commitTransition(valResult, ctx);

    const dashData = loadDashboardState(repoRoot);
    const chatMeter = formatChatCreditMeter(dashData);

    const out = buildEnrichedPostToolOutput(
      input,
      chatMeter,
      commitRes.instructionText,
      targetAgent
    );
    process.stdout.write(JSON.stringify(out) + "\n");
    process.exit(0);
  }

  // Step 2, 2b: PreToolUse (Authorize & Input Normalization)
  const auth = policy.checkPrerequisites(ctx);
  if (!auth.allowed) {
    if (auth.decision === "ask") {
      const reason = auth.reason || "Human confirmation required.";
      const output = {
        decision: "ask",
        permissionDecision: "ask",
        permissionDecisionReason: reason,
        reason,
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "ask",
          permissionDecisionReason: reason,
        },
      };
      process.stdout.write(JSON.stringify(output) + "\n");
      process.exit(0);
    }

    const output: HookOutput = {
      decision: "deny",
      permissionDecision: "deny",
      reason: auth.reason || `BLOCKED BY POLICY: Prerequisites for ${policy.stage} not satisfied.`,
    };
    process.stdout.write(JSON.stringify(output) + "\n");
    process.exit(auth.denialCode || 1);
  }

  if (auth.lock !== undefined) {
    ctx.lock = auth.lock;
  }

  const inputCtx = policy.buildInputContext(ctx);
  const modifiedArgs = inputCtx.modifiedArgs || {
    ...toolArgs,
    ...(inputCtx.modifiedPrompt ? { prompt: inputCtx.modifiedPrompt } : {}),
  };

  const output = {
    decision: "allow",
    permissionDecision: "allow",
    modifiedArgs,
    updatedInput: modifiedArgs,
    additionalContext: inputCtx.additionalContext || undefined,
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
      modifiedArgs,
      updatedInput: modifiedArgs,
      additionalContext: inputCtx.additionalContext || undefined,
    },
  };
  process.stdout.write(JSON.stringify(output) + "\n");
  process.exit(0);
}

main().catch((err: any) => {
  const errMsg = err?.message || String(err);
  process.stderr.write(`[hook-verify-gate] Internal enforcement error (Fail-Closed): ${errMsg}\n`);
  process.stdout.write(
    JSON.stringify({
      decision: "deny",
      permissionDecision: "deny",
      reason: `SECURITY_GATE_FAILURE: Human gate verification hook encountered an internal failure: ${errMsg}. Specialist invocation blocked by policy (Fail-Closed).`,
    }) + "\n"
  );
  process.exit(1);
});

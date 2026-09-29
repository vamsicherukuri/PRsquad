#!/usr/bin/env node

// scripts/guardrails/hook-intake-ingest.ts
import { readFileSync as readFileSync3, appendFileSync as appendFileSync2 } from "node:fs";

// src/guardrails/ingestIssue.ts
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
function fetchIssueDeterministic(owner, repo, issueNumber, rootDir = process.cwd()) {
  try {
    const cmd = `gh issue view ${issueNumber} --repo ${owner}/${repo} --json number,title,body,comments,labels,author`;
    const stdout = execSync(cmd, {
      cwd: rootDir,
      encoding: "utf-8",
      timeout: 1e4,
      stdio: ["ignore", "pipe", "ignore"]
    });
    const parsed = JSON.parse(stdout);
    return {
      owner,
      repo,
      number: parsed.number ?? issueNumber,
      title: parsed.title ?? "",
      body: parsed.body ?? "",
      author: parsed.author?.login ?? "unknown",
      labels: (parsed.labels ?? []).map((l) => l.name ?? l),
      comments: (parsed.comments ?? []).map((c) => ({
        author: c.author?.login ?? "unknown",
        body: c.body ?? "",
        createdAt: c.createdAt ?? ""
      }))
    };
  } catch {
    const candidates = [
      join(rootDir, "examples", `sample-issue-${issueNumber}.json`),
      join(rootDir, "examples", "sample-issue-ready.json"),
      join(rootDir, "examples", "sample-issue-vague.json")
    ];
    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        try {
          const raw = readFileSync(candidate, "utf-8");
          const parsed = JSON.parse(raw);
          if (parsed.id === issueNumber || parsed.number === issueNumber || candidate.endsWith("-ready.json")) {
            return {
              owner: owner || "local",
              repo: repo || "sample-repo",
              number: parsed.id ?? parsed.number ?? issueNumber,
              title: parsed.title ?? "",
              body: parsed.body ?? "",
              author: "fixture-author",
              labels: parsed.labels ?? [],
              comments: (parsed.comments ?? []).map((c) => ({
                author: c.author ?? "commenter",
                body: c.body ?? (typeof c === "string" ? c : ""),
                createdAt: (/* @__PURE__ */ new Date()).toISOString()
              }))
            };
          }
        } catch {
        }
      }
    }
    throw new Error(
      `Could not fetch issue #${issueNumber} from GitHub CLI ('gh') or local fixtures in 'examples/'.`
    );
  }
}
function formatIntakePayload(issueData, round = 0) {
  return JSON.stringify(
    {
      source: "DETERMINISTIC_HOOK_INGESTION",
      clarificationRound: round,
      issue: {
        owner: issueData.owner,
        repo: issueData.repo,
        number: issueData.number,
        title: issueData.title,
        body: issueData.body,
        author: issueData.author,
        labels: issueData.labels,
        comments: issueData.comments
      },
      instructions: "Evaluate this pre-fetched issue against the Definition of Ready (Reproduction/Expected vs Actual, Acceptance Criteria, Declared Scope). Output your structured triage verdict."
    },
    null,
    2
  );
}

// src/guardrails/stateStore.ts
import { existsSync as existsSync2, mkdirSync, readFileSync as readFileSync2, writeFileSync, appendFileSync } from "node:fs";
import { resolve, relative, join as join2 } from "node:path";
import { execSync as execSync2 } from "node:child_process";
var GATED_CHANGE_DIR = ".gated-change";
var STATE_FILE = "state.json";
var AUDIT_FILE = "audit.jsonl";
var cachedRepoRoot = null;
function getRepoRoot() {
  if (cachedRepoRoot) return cachedRepoRoot;
  try {
    const stdout = execSync2("git rev-parse --show-toplevel", {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"]
    });
    cachedRepoRoot = stdout.trim().replace(/\\/g, "/");
    return cachedRepoRoot;
  } catch {
    cachedRepoRoot = process.cwd().replace(/\\/g, "/");
    return cachedRepoRoot;
  }
}
function ensureGatedChangeDir(rootDir = getRepoRoot()) {
  const dir = join2(rootDir, GATED_CHANGE_DIR);
  if (!existsSync2(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}
function loadState(rootDir = getRepoRoot()) {
  ensureGatedChangeDir(rootDir);
  const filePath = join2(rootDir, GATED_CHANGE_DIR, STATE_FILE);
  if (existsSync2(filePath)) {
    try {
      const raw = readFileSync2(filePath, "utf-8");
      return JSON.parse(raw);
    } catch {
    }
  }
  const defaultState = {
    version: "1.0",
    sessionId: `gcc-${Date.now()}`,
    issue: {
      owner: "",
      repo: "",
      number: 0
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
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  saveState(defaultState, rootDir);
  return defaultState;
}
function saveState(state, rootDir = getRepoRoot()) {
  ensureGatedChangeDir(rootDir);
  state.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
  const filePath = join2(rootDir, GATED_CHANGE_DIR, STATE_FILE);
  writeFileSync(filePath, JSON.stringify(state, null, 2), "utf-8");
}
function appendAuditLog(entry, rootDir = getRepoRoot()) {
  ensureGatedChangeDir(rootDir);
  const fullEntry = {
    ...entry,
    timestamp: (/* @__PURE__ */ new Date()).toISOString()
  };
  const filePath = join2(rootDir, GATED_CHANGE_DIR, AUDIT_FILE);
  appendFileSync(filePath, JSON.stringify(fullEntry) + "\n", "utf-8");
}
function isAgentMatch(targetAgent, expectedName) {
  if (!targetAgent) return false;
  return targetAgent === expectedName || targetAgent.endsWith(`:${expectedName}`) || targetAgent.endsWith(`/${expectedName}`);
}

// scripts/guardrails/hook-intake-ingest.ts
async function main() {
  let rawInput = "";
  if (!process.stdin.isTTY) {
    try {
      rawInput = readFileSync3(0, "utf-8");
    } catch {
    }
  }
  try {
    appendFileSync2("C:/Users/vcherukuri/hook-debug.log", JSON.stringify({
      hook: "hook-intake-ingest",
      time: (/* @__PURE__ */ new Date()).toISOString(),
      argv: process.argv,
      cwd: process.cwd(),
      rawInput
    }) + "\n");
  } catch {
  }
  let input = {};
  if (rawInput.trim()) {
    try {
      input = JSON.parse(rawInput);
    } catch {
    }
  }
  const firstTool = input.toolCalls?.[0];
  const toolArgs = input.toolArgs || firstTool?.args || {};
  const targetAgent = toolArgs.agent_type || toolArgs.name || toolArgs.agent || input.agent;
  if (isAgentMatch(targetAgent, "gated-change-intake")) {
    const state = loadState();
    const prompt = toolArgs.prompt || input.toolArgs?.prompt || "";
    let issueNum = 1;
    const jsonNum = prompt.match(/"number"\s*:\s*(\d+)/);
    const textNum = prompt.match(/\b(?:issue(?:\s*number)?\s*[:#]?\s*|#)(\d+)\b/i);
    if (jsonNum) {
      issueNum = parseInt(jsonNum[1], 10);
    } else if (textNum) {
      issueNum = parseInt(textNum[1], 10);
    } else if (state.issue?.number && state.issue.number > 0) {
      issueNum = state.issue.number;
    }
    let owner = state.issue?.owner || "vamsicherukuri";
    let repo = state.issue?.repo || "gated-fix-pipeline";
    const jsonOwner = prompt.match(/"owner"\s*:\s*"([^"]+)"/);
    const jsonRepo = prompt.match(/"repo"\s*:\s*"([^"]+)"/);
    if (jsonOwner && jsonRepo) {
      owner = jsonOwner[1];
      repo = jsonRepo[1];
    } else {
      const explicitRepo = prompt.match(/\b(?:in|repo(?:sitory)?(?:\s*name)?\s*[:=]?)\s*([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)\b/i);
      if (explicitRepo) {
        owner = explicitRepo[1];
        repo = explicitRepo[2];
      }
    }
    try {
      const issueData = fetchIssueDeterministic(owner, repo, issueNum);
      const payload = formatIntakePayload(issueData, state.intakeRound);
      state.issue = { owner, repo, number: issueData.number, title: issueData.title };
      state.phase = "INTAKE";
      saveState(state);
      appendAuditLog({
        sessionId: state.sessionId,
        agent: "controller",
        tool: "agent",
        action: "deterministic_issue_ingestion",
        decision: "allow",
        details: {
          issueNumber: issueData.number,
          title: issueData.title,
          round: state.intakeRound
        }
      });
      const output = {
        decision: "allow",
        permissionDecision: "allow",
        additionalContext: `PRE_FETCHED_ISSUE_PAYLOAD:
${payload}`
      };
      process.stdout.write(JSON.stringify(output) + "\n");
      process.exit(0);
    } catch (err) {
      appendAuditLog({
        sessionId: state.sessionId,
        agent: "controller",
        tool: "agent",
        action: "deterministic_issue_ingestion_warning",
        decision: "allow",
        details: { error: err.message }
      });
      const output = {
        decision: "allow",
        permissionDecision: "allow",
        additionalContext: `ISSUE_INGESTION_NOTICE: Could not pre-fetch issue #${issueNum} via gh CLI: ${err.message}. Specialist should proceed with standard triage.`
      };
      process.stdout.write(JSON.stringify(output) + "\n");
      process.exit(0);
    }
  }
  process.stdout.write(JSON.stringify({ decision: "allow", permissionDecision: "allow" }) + "\n");
  process.exit(0);
}
main().catch(() => {
  process.stdout.write(JSON.stringify({ decision: "allow", permissionDecision: "allow" }) + "\n");
  process.exit(0);
});

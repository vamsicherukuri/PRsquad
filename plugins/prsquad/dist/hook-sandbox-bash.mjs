#!/usr/bin/env node

// scripts/guardrails/hook-sandbox-bash.ts
import { readFileSync as readFileSync3 } from "node:fs";

// src/guardrails/stateStore.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, realpathSync, symlinkSync, copyFileSync } from "node:fs";
import { resolve, relative, join, isAbsolute, dirname, basename } from "node:path";
import { platform, homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
var __filename = fileURLToPath(import.meta.url);
var __dirname = dirname(__filename);
var GATED_CHANGE_DIR = ".gated-change";
var STATE_FILE = "state.json";
var LOCK_FILE = "approval.lock";
var AUDIT_FILE = "audit.jsonl";
var cachedRepoRoot = null;
function getRepoRoot(preferredDir) {
  let startDir = preferredDir || process.cwd();
  try {
    if (existsSync(startDir)) {
      startDir = realpathSync.native(startDir);
    }
  } catch {
  }
  try {
    const stdout = execSync("git rev-parse --show-toplevel", {
      cwd: startDir,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"]
    });
    return stdout.trim().replace(/\\/g, "/");
  } catch {
    if (cachedRepoRoot && !preferredDir) return cachedRepoRoot;
    const fallback = startDir.replace(/\\/g, "/");
    if (!preferredDir) cachedRepoRoot = fallback;
    return fallback;
  }
}
function findGatedChangeDir(rootDir = getRepoRoot()) {
  const localDir = join(rootDir, GATED_CHANGE_DIR);
  const localLock = join(localDir, LOCK_FILE);
  const localState = join(localDir, STATE_FILE);
  if (existsSync(localLock) || existsSync(localState)) {
    return localDir;
  }
  try {
    const gitCommonDir = execSync("git rev-parse --git-common-dir", {
      cwd: rootDir,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
    if (gitCommonDir) {
      const parentRepo = resolve(rootDir, gitCommonDir, "..");
      const parentDir = join(parentRepo, GATED_CHANGE_DIR);
      if (existsSync(parentDir)) return parentDir;
    }
  } catch {
  }
  return localDir;
}
function ensureGatedChangeBin(rootDir = getRepoRoot()) {
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
      resolve(__dirname)
    ];
    let foundDist = null;
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
  } catch {
  }
  return false;
}
function ensureGatedChangeDir(rootDir = getRepoRoot()) {
  const dir = join(rootDir, GATED_CHANGE_DIR);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  ensureGatedChangeBin(rootDir);
  return dir;
}
function loadState(rootDir = getRepoRoot()) {
  const searchDir = findGatedChangeDir(rootDir);
  const filePath = join(searchDir, STATE_FILE);
  if (existsSync(filePath)) {
    try {
      const raw = readFileSync(filePath, "utf-8");
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
  const filePath = join(rootDir, GATED_CHANGE_DIR, STATE_FILE);
  writeFileSync(filePath, JSON.stringify(state, null, 2), "utf-8");
  try {
    const gitCommonDir = execSync("git rev-parse --git-common-dir", {
      cwd: rootDir,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
    if (gitCommonDir) {
      const parentRepo = resolve(rootDir, gitCommonDir, "..");
      if (parentRepo.replace(/\\/g, "/") !== rootDir.replace(/\\/g, "/")) {
        ensureGatedChangeDir(parentRepo);
        writeFileSync(join(parentRepo, GATED_CHANGE_DIR, STATE_FILE), JSON.stringify(state, null, 2), "utf-8");
      }
    }
  } catch {
  }
}
function appendAuditLog(entry, rootDir = getRepoRoot()) {
  ensureGatedChangeDir(rootDir);
  const fullEntry = {
    ...entry,
    timestamp: (/* @__PURE__ */ new Date()).toISOString()
  };
  const filePath = join(rootDir, GATED_CHANGE_DIR, AUDIT_FILE);
  appendFileSync(filePath, JSON.stringify(fullEntry) + "\n", "utf-8");
}
var AGENT_ALIASES = {
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
function isAgentMatch(targetAgent, expectedName) {
  if (!targetAgent) return false;
  const cleanTarget = targetAgent.includes(":") ? targetAgent.split(":").pop() : targetAgent.includes("/") ? targetAgent.split("/").pop() : targetAgent;
  const aliases = AGENT_ALIASES[expectedName] || [expectedName];
  if (aliases.includes(targetAgent) || aliases.includes(cleanTarget)) return true;
  return targetAgent === expectedName || targetAgent.endsWith(`:${expectedName}`) || targetAgent.endsWith(`/${expectedName}`);
}

// src/guardrails/toolingBridge.ts
import { existsSync as existsSync2, readFileSync as readFileSync2, readdirSync } from "node:fs";
import { join as join2 } from "node:path";
function detectRepoStack(rootDir = getRepoRoot()) {
  const explicitPaths = [
    join2(rootDir, ".prsquad", "config.json"),
    join2(rootDir, ".prsquad.json")
  ];
  for (const configPath of explicitPaths) {
    if (existsSync2(configPath)) {
      try {
        const raw = readFileSync2(configPath, "utf-8");
        const parsed = JSON.parse(raw);
        if (parsed.tooling && parsed.tooling.testCommand) {
          return {
            stack: parsed.stack || "custom",
            testCommand: parsed.tooling.testCommand,
            testFileCommand: parsed.tooling.testFileCommand,
            buildCommand: parsed.tooling.buildCommand,
            lintCommand: parsed.tooling.lintCommand,
            isExplicitConfig: true
          };
        }
      } catch {
      }
    }
  }
  if (existsSync2(join2(rootDir, "pom.xml"))) {
    return {
      stack: "maven",
      testCommand: "mvn test",
      testFileCommand: "mvn test -Dtest=${file}",
      buildCommand: "mvn compile -DskipTests",
      lintCommand: "mvn spotbugs:check",
      isExplicitConfig: false
    };
  }
  if (existsSync2(join2(rootDir, "build.gradle")) || existsSync2(join2(rootDir, "build.gradle.kts"))) {
    const gradleCmd = existsSync2(join2(rootDir, "gradlew")) ? "./gradlew" : "gradle";
    return {
      stack: "gradle",
      testCommand: `${gradleCmd} test`,
      testFileCommand: `${gradleCmd} test --tests ${"${file}"}`,
      buildCommand: `${gradleCmd} assemble`,
      lintCommand: `${gradleCmd} check`,
      isExplicitConfig: false
    };
  }
  if (existsSync2(join2(rootDir, "package.json"))) {
    let runner = "npm test";
    if (existsSync2(join2(rootDir, "pnpm-lock.yaml"))) {
      runner = "pnpm test";
    } else if (existsSync2(join2(rootDir, "yarn.lock"))) {
      runner = "yarn test";
    }
    return {
      stack: "npm",
      testCommand: runner,
      testFileCommand: `${runner} -- \${file}`,
      buildCommand: "npm run build",
      lintCommand: "npm run lint",
      isExplicitConfig: false
    };
  }
  if (existsSync2(join2(rootDir, "pytest.ini")) || existsSync2(join2(rootDir, "pyproject.toml")) || existsSync2(join2(rootDir, "requirements.txt"))) {
    return {
      stack: "pytest",
      testCommand: "pytest",
      testFileCommand: "pytest ${file}",
      lintCommand: "flake8 .",
      isExplicitConfig: false
    };
  }
  if (existsSync2(join2(rootDir, "Cargo.toml"))) {
    return {
      stack: "cargo",
      testCommand: "cargo test",
      testFileCommand: "cargo test --test ${file}",
      buildCommand: "cargo build",
      lintCommand: "cargo clippy",
      isExplicitConfig: false
    };
  }
  if (existsSync2(join2(rootDir, "go.mod"))) {
    return {
      stack: "go",
      testCommand: "go test ./...",
      testFileCommand: "go test -v ${file}",
      buildCommand: "go build ./...",
      lintCommand: "golangci-lint run",
      isExplicitConfig: false
    };
  }
  try {
    const entries = readdirSync(rootDir);
    if (entries.some((f) => f.endsWith(".sln") || f.endsWith(".csproj") || f.endsWith(".fsproj"))) {
      return {
        stack: "dotnet",
        testCommand: "dotnet test",
        testFileCommand: "dotnet test --filter ${file}",
        buildCommand: "dotnet build",
        isExplicitConfig: false
      };
    }
  } catch {
  }
  return {
    stack: "unknown",
    testCommand: "npm test",
    isExplicitConfig: false
  };
}
var PACKAGE_MUTATION_REGEX = /\b(?:npm\s+(?:install|i|add|publish|pack|link|uninstall|update|login)|pnpm\s+(?:install|i|add|publish|link|update)|yarn\s+(?:add|publish|install)|pip(?:3)?\s+install|cargo\s+publish|mvn\s+deploy|dotnet\s+nuget\s+push)\b/i;
function matchesConfiguredCommand(actual, configured) {
  if (!configured) return false;
  const trimmedActual = actual.trim();
  const trimmedConfig = configured.trim();
  if (trimmedActual === trimmedConfig) return true;
  if (trimmedActual.startsWith(trimmedConfig + " ") || trimmedActual.startsWith(trimmedConfig + "=")) {
    return true;
  }
  return false;
}
function isCommandAllowedByTooling(command, config) {
  const trimmed = command.trim();
  const tokens = trimmed.split(/\s+/);
  if (PACKAGE_MUTATION_REGEX.test(trimmed)) {
    return false;
  }
  if (matchesConfiguredCommand(trimmed, config.testCommand)) return true;
  if (matchesConfiguredCommand(trimmed, config.buildCommand)) return true;
  if (matchesConfiguredCommand(trimmed, config.lintCommand)) return true;
  if (config.stack === "npm" || config.stack === "typescript" || config.stack === "node") {
    if (tokens[0] === "npm" && (tokens[1] === "test" || tokens[1] === "t" || tokens[1] === "run" && tokens[2]?.startsWith("test"))) {
      return true;
    }
    if (tokens[0] === "pnpm" && (tokens[1] === "test" || tokens[1] === "t" || tokens[1] === "run" && tokens[2]?.startsWith("test"))) {
      return true;
    }
    if (tokens[0] === "yarn" && (tokens[1] === "test" || tokens[1] === "run" && tokens[2]?.startsWith("test"))) {
      return true;
    }
    return false;
  }
  if (config.stack === "maven") {
    return tokens[0] === "mvn" && tokens.includes("test");
  }
  if (config.stack === "gradle") {
    return (tokens[0] === "gradle" || tokens[0] === "./gradlew") && tokens.includes("test");
  }
  if (config.stack === "pytest") {
    return tokens[0] === "pytest" || tokens[0].startsWith("python") && tokens.includes("pytest");
  }
  if (config.stack === "cargo") {
    return tokens[0] === "cargo" && tokens[1] === "test";
  }
  if (config.stack === "go") {
    return tokens[0] === "go" && tokens[1] === "test";
  }
  if (config.stack === "dotnet") {
    return tokens[0] === "dotnet" && tokens[1] === "test";
  }
  return false;
}

// src/guardrails/bashSandbox.ts
var GIT_INSPECTION_ALLOWLIST_REGEX = /^\s*git\s+(diff|status|show|log|ls-files|rev-parse)(\s+.*)?$/i;
var TEST_RUNNER_ALLOWLIST_REGEX = /^\s*(?:(?:npm|pnpm|yarn|bun)\s+(?:test|run\s+test\S*)|npx(?:\s+-[a-zA-Z0-9_\-]+)*\s+(?:vitest|jest|mocha|playwright|cypress|tsx|ts-node|ava|tape|pytest|karma|jasmine|tap)|pytest|python(?:3)?\s+-m\s+(?:unittest|pytest)|(?:mvn|gradle|\.\/gradlew)\s+(?:test|verify|check)|go\s+test|cargo\s+test|dotnet\s+test)(?:\s+.*)?$/i;
var QA_MUTATING_GIT_REGEX = /\bgit\s+(push|commit|checkout|switch|merge|rebase|reset|clean)\b/i;
var PROTECTED_BASE_BRANCH_REGEX = /\bgit\s+(checkout|switch|commit|push|merge|rebase|reset|branch\s+-(?:d|D))\b.*?\b(?:origin\/)?(main|master)\b/i;
var BRANCH_DELETION_REGEX = /\bgit\s+branch\s+-(?:d|D)\b/i;
var DANGEROUS_SYSTEM_REGEX = /\b(rm\s+-rf\s+\/|npm\s+publish|curl\s+-X\s+POST|wget\s+--post)\b/i;
var DESTRUCTIVE_GIT_CLEAN_REGEX = /\bgit\s+clean\b.*?(?:-[a-zA-Z]*f[a-zA-Z]*\b|--force\b)/i;
function validateCommandForAgent(command, agent = "unknown", rootDir) {
  const trimmed = command.trim();
  const AGENT_SELF_APPROVE_REGEX = /\b(?:scope-approve|pr-create|gate-approve)(?:\.ts|\.js)?\b/i;
  if (AGENT_SELF_APPROVE_REGEX.test(trimmed)) {
    return {
      allowed: false,
      reason: "POLICY_DENIAL (HUMAN_ONLY_GATE): Autonomous agents are strictly prohibited from executing 'scope-approve', 'gate-approve', or 'pr-create'. Scope authorization and PR creation are exclusively reserved for human maintainers."
    };
  }
  const PACKAGE_MUTATION_REGEX2 = /\b(?:npm\s+(?:install|i|add|publish|pack|link|uninstall|update|login)|pnpm\s+(?:install|i|add|publish|link|update)|yarn\s+(?:add|publish|install)|pip(?:3)?\s+install|cargo\s+publish|mvn\s+deploy|dotnet\s+nuget\s+push)\b/i;
  if (PACKAGE_MUTATION_REGEX2.test(trimmed)) {
    return {
      allowed: false,
      reason: `POLICY_DENIAL (PACKAGE_MUTATION_NOT_PERMITTED): Package management mutations and publishing ('${trimmed}') are strictly prohibited for pipeline agents.`
    };
  }
  const SHELL_CHAINING_REGEX = /[;&|\n]/;
  if (isAgentMatch(agent, "prsquad-review") || isAgentMatch(agent, "gated-change-reviewer")) {
    if (trimmed.includes(">") || trimmed.includes(">>")) {
      return {
        allowed: false,
        reason: "POLICY_DENIAL: Code Review agent is strictly read-only and cannot use file redirects ('>' or '>>')."
      };
    }
    if (SHELL_CHAINING_REGEX.test(trimmed)) {
      return {
        allowed: false,
        reason: "POLICY_DENIAL (SHELL_COMPOSITION_NOT_PERMITTED): Code Review agent cannot use shell composition or chaining operators (';', '&&', '||', '|')."
      };
    }
    if (!GIT_INSPECTION_ALLOWLIST_REGEX.test(trimmed)) {
      return {
        allowed: false,
        reason: `POLICY_DENIAL: Code Review agent is restricted to non-mutating git inspection commands (git diff, git status, git show, git log, git ls-files, git rev-parse). Command '${trimmed}' is blocked.`
      };
    }
    return { allowed: true };
  }
  if (PROTECTED_BASE_BRANCH_REGEX.test(trimmed)) {
    return {
      allowed: false,
      reason: `POLICY_DENIAL: Direct mutation, checkout, or manipulation of base branch ('main'/'master') is strictly prohibited. All work must remain on designated feature branches.`
    };
  }
  if (BRANCH_DELETION_REGEX.test(trimmed)) {
    return {
      allowed: false,
      reason: "POLICY_DENIAL: Autonomous branch deletion is strictly forbidden. Branch deletion and rollback are exclusively reserved for human maintainers."
    };
  }
  if (DANGEROUS_SYSTEM_REGEX.test(trimmed)) {
    return {
      allowed: false,
      reason: `POLICY_DENIAL: Command '${trimmed}' contains forbidden destructive or publishing operations.`
    };
  }
  if (DESTRUCTIVE_GIT_CLEAN_REGEX.test(trimmed)) {
    return {
      allowed: false,
      reason: "POLICY_DENIAL: Destructive git clean operations with force flags are prohibited. Use dry-run ('git clean -n') for inspection."
    };
  }
  if (isAgentMatch(agent, "prsquad-qa") || isAgentMatch(agent, "gated-change-qa")) {
    if (trimmed.includes(">") || trimmed.includes(">>")) {
      return {
        allowed: false,
        reason: "POLICY_DENIAL: QA agent cannot use file redirects ('>' or '>>'). QA executes tests for validation only with zero disk mutations."
      };
    }
    if (SHELL_CHAINING_REGEX.test(trimmed)) {
      return {
        allowed: false,
        reason: "POLICY_DENIAL (SHELL_COMPOSITION_NOT_PERMITTED): QA agent cannot use shell composition or chaining operators (';', '&&', '||', '|')."
      };
    }
    if (QA_MUTATING_GIT_REGEX.test(trimmed)) {
      return {
        allowed: false,
        reason: `POLICY_DENIAL: QA agent cannot execute mutating git commands ('${trimmed}'). QA executes tests for validation only.`
      };
    }
    if (GIT_INSPECTION_ALLOWLIST_REGEX.test(trimmed)) {
      return { allowed: true };
    }
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
    } catch {
    }
    if (TEST_RUNNER_ALLOWLIST_REGEX.test(trimmed)) {
      return { allowed: true };
    }
    return {
      allowed: false,
      reason: `POLICY_DENIAL: QA agent is strictly restricted to test execution and non-mutating git inspections. Command '${trimmed}' is blocked by policy.`
    };
  }
  if (isAgentMatch(agent, "prsquad-dev") || isAgentMatch(agent, "gated-change-developer")) {
    if (trimmed.includes(">") || trimmed.includes(">>")) {
      return {
        allowed: false,
        reason: "POLICY_DENIAL (MUTATION_SURFACE_RESTRICTION): Developer agent cannot use shell redirection ('>' or '>>'). File mutations must occur exclusively through monitored edit tools."
      };
    }
    if (SHELL_CHAINING_REGEX.test(trimmed)) {
      return {
        allowed: false,
        reason: "POLICY_DENIAL (SHELL_COMPOSITION_NOT_PERMITTED): Developer agent cannot use shell composition or chaining operators (';', '&&', '||', '|')."
      };
    }
    const SCRIPT_WRITE_BYPASS_REGEX = /\b(?:node\s+(?:-e|--eval)|python(?:3)?\s+-c|perl|ruby|Set-Content|Out-File|Add-Content|Export-Csv|New-Item|Copy-Item|Move-Item|Remove-Item|cp\s|mv\s|rm\s|sed\s|awk\s)\b/i;
    if (SCRIPT_WRITE_BYPASS_REGEX.test(trimmed)) {
      return {
        allowed: false,
        reason: "POLICY_DENIAL (MUTATION_SURFACE_RESTRICTION): Developer agent cannot execute arbitrary script evaluations or file manipulation utilities via the shell. All file edits must be performed through verified edit tools."
      };
    }
    if (/\bgit\s+push\b/i.test(trimmed)) {
      return {
        allowed: false,
        reason: "POLICY_DENIAL: Developer agent cannot push directly to remote git repositories."
      };
    }
    const DEV_GIT_ALLOWLIST_REGEX = /^git\s+(?:status|diff|add|commit|checkout|branch|log|show|rev-parse|ls-files|symbolic-ref|clean)\b/i;
    if (DEV_GIT_ALLOWLIST_REGEX.test(trimmed)) {
      return { allowed: true };
    }
    try {
      const config = detectRepoStack(rootDir || getRepoRoot());
      if (config && isCommandAllowedByTooling(trimmed, config)) {
        return { allowed: true };
      }
    } catch {
    }
    if (TEST_RUNNER_ALLOWLIST_REGEX.test(trimmed)) {
      return { allowed: true };
    }
    return {
      allowed: false,
      reason: `POLICY_DENIAL (DEVELOPER_SHELL_ALLOWLIST): Developer shell execution is restricted to Git operations and configured test/build commands. Command '${trimmed}' is blocked. File mutations must occur exclusively through monitored edit tools.`
    };
  }
  return { allowed: true };
}

// scripts/guardrails/hook-sandbox-bash.ts
async function main() {
  let rawInput = "";
  if (!process.stdin.isTTY) {
    try {
      rawInput = readFileSync3(0, "utf-8");
    } catch {
    }
  }
  let input = {};
  if (rawInput.trim()) {
    input = JSON.parse(rawInput);
  }
  const firstTool = input.toolCalls?.[0];
  const tool = (input.toolName || input.tool || firstTool?.name || "").toLowerCase();
  const toolArgs = input.toolArgs || firstTool?.args || {};
  const command = toolArgs.command || toolArgs.cmd || "";
  const agent = input.agent || toolArgs.agent_type || "unknown";
  const isShellTool = tool === "bash" || tool === "powershell" || tool === "pwsh" || tool === "execute" || tool === "terminal" || tool === "shell" || tool.includes("bash") || tool.includes("powershell") || tool.includes("terminal");
  if (isShellTool && command) {
    const effectiveCwd = input.cwd || process.cwd();
    const repoRoot = getRepoRoot(effectiveCwd);
    const state = loadState(repoRoot);
    const result = validateCommandForAgent(command, agent, repoRoot);
    if (!result.allowed) {
      appendAuditLog({
        sessionId: state.sessionId,
        agent,
        tool: tool.includes("powershell") ? "powershell" : "bash",
        action: "command_blocked_by_sandbox",
        decision: "deny",
        details: {
          command,
          reason: result.reason
        }
      }, repoRoot);
      const output = {
        decision: "deny",
        permissionDecision: "deny",
        reason: result.reason || "POLICY_DENIAL: Command blocked by guardrail.",
        permissionDecisionReason: result.reason || "POLICY_DENIAL: Command blocked by guardrail."
      };
      process.stdout.write(JSON.stringify(output) + "\n");
      process.exit(0);
    }
    appendAuditLog({
      sessionId: state.sessionId,
      agent,
      tool: tool.includes("powershell") ? "powershell" : "bash",
      action: "command_allowed",
      decision: "allow",
      details: { command }
    }, repoRoot);
    process.stdout.write(JSON.stringify({ decision: "allow", permissionDecision: "allow" }) + "\n");
    process.exit(0);
  }
  process.stdout.write(JSON.stringify({ decision: "allow", permissionDecision: "allow" }) + "\n");
  process.exit(0);
}
main().catch((err) => {
  const errMsg = err?.message || String(err);
  process.stderr.write(`[hook-sandbox-bash] Internal enforcement error (Fail-Closed): ${errMsg}
`);
  process.stdout.write(
    JSON.stringify({
      decision: "deny",
      permissionDecision: "deny",
      reason: `SECURITY_SANDBOX_FAILURE: Shell sandbox hook encountered an unexpected error: ${errMsg}. Command execution blocked by policy (Fail-Closed).`
    }) + "\n"
  );
  process.exit(0);
});

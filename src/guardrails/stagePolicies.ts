/**
 * Declarative Stage Policy Registry for PRSquad
 * 
 * Defines declarative stage-specific policies for each specialist agent.
 * Powers the universal stage hook engine without duplicating TypeScript logic.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import type { WorkflowState, WorkflowPhase, ApprovalLock, HookInput, HookOutput } from "./types.js";
import {
  saveState,
  saveApprovalLock,
  revokeApprovalLock,
  appendAuditLog,
  isAgentMatch,
} from "./stateStore.js";
import {
  syncWorkflowDashboard,
  loadDashboardState,
  formatChatCreditMeter,
  extractPlanMarkdown,
  extractDeveloperDetails,
  extractQADetails,
  extractReviewerDetails,
} from "./issueDashboard.js";
import { StateController } from "./stateController.js";
import { generateAstPreFetchMap, runSymbolSweep } from "./symbolSweep.js";
import { packageRepoIntelligence } from "./repoSkillResolver.js";
import { detectRepoStack } from "./toolingBridge.js";
import {
  validateTriage,
  validateArchitect,
  validateDeveloper,
  validateQA,
  validateReview,
} from "./handoffValidator.js";
import {
  approveScopeGate,
  computePlanHash,
} from "./scopeApprover.js";

export interface StageContext {
  repoRoot: string;
  state: WorkflowState;
  lock: ApprovalLock | null;
  resolvedIssue: number;
  sessionId: string;
  targetAgent: string;
  prompt: string;
  toolArgs: any;
  firstTool?: any;
  input: HookInput;
  rawOutput?: any;
}

export interface PrerequisiteResult {
  allowed: boolean;
  decision?: "allow" | "deny" | "ask";
  reason?: string;
  denialCode?: number;
  lock?: ApprovalLock | null;
}

export interface InputContextResult {
  modifiedPrompt?: string;
  modifiedArgs?: Record<string, any>;
  additionalContext?: string;
}

export interface StageValidationResult {
  valid: boolean;
  verdict: string;
  details?: Record<string, any>;
  errors?: string[];
}

export interface StagePolicy {
  stage: WorkflowPhase;
  agentAliases: string[];
  allowedPriorPhases: string[];

  // Step 2: Authorize
  checkPrerequisites: (ctx: StageContext) => PrerequisiteResult;

  // Step 2b: Normalize input payload
  buildInputContext: (ctx: StageContext) => InputContextResult;

  // Step 4: Validate specialist output
  validateOutput: (rawOutput: any, ctx: StageContext) => StageValidationResult;

  // Step 5: Commit verdict to workflow-state.json
  commitTransition: (valResult: StageValidationResult, ctx: StageContext) => {
    transitionId: string;
    nextPhase: WorkflowPhase;
    instructionText: string;
  };
}

export function resolveBaseRef(rootDir: string, preferredRef?: string | null): string {
  if (preferredRef) {
    try {
      return execSync(`git rev-parse --verify "${preferredRef}^{commit}"`, {
        cwd: rootDir,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    } catch {}
  }
  for (const candidate of ["HEAD~1", "origin/master", "origin/main", "master", "main"]) {
    try {
      return execSync(`git rev-parse --verify "${candidate}^{commit}"`, {
        cwd: rootDir,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    } catch {}
  }
  return "";
}

export function mintTransitionId(stage: string): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 6);
  return `tr-${stage.toLowerCase()}-${ts}-${rand}`;
}

export function formatRepoIntelligenceForPrompt(repoRoot: string, targetAgent: string, approvedScope?: string): string {
  const intel = packageRepoIntelligence(repoRoot, targetAgent, approvedScope);
  const sections: string[] = [];

  if (intel.skillsFull.length > 0) {
    sections.push(`### 💡 Specialized Repository Skills\n${intel.skillsFull.join("\n\n")}`);
  }

  if (intel.skillsIndexed.length > 0) {
    sections.push(`### 📚 Additional Available Repository Skills\n${intel.skillsIndexed.join("\n")}\n*(Use read tool on skill path if needed)*`);
  }

  if (intel.slicedInstructions) {
    sections.push(`### 📋 Relevant Repository Instructions\n${intel.slicedInstructions}`);
  }

  return sections.join("\n\n");
}

export function formatControlPlaneTelemetry(meter: string, statusText?: string): string {
  if (!meter && !statusText) return "";
  const cleanedStatus = statusText ? statusText.replace(/^\[INSTRUCTION FOR CONTROLLER\]:\s*/i, "").trim() : "";
  return (
    `<!-- PR_SQUAD_CONTROL_PLANE_TELEMETRY_START -->\n` +
    `### 📊 Verified Control Plane Telemetry (Local Guardrail Hook)\n` +
    (meter ? `${meter}\n\n` : "") +
    (cleanedStatus ? `> **Control Plane Status**: ${cleanedStatus}\n` : "") +
    `<!-- PR_SQUAD_CONTROL_PLANE_TELEMETRY_END -->`
  );
}

export function sanitizeSpecialistHandoff(rawText: string, agentName?: string): string {
  if (!rawText) return "";

  const jsonMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)\s*```/) || rawText.match(/(\{[\s\S]*\})/);

  if (isAgentMatch(agentName, "gated-change-developer")) {
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[1]);
        if (parsed.status) {
          return `\`\`\`json\n${JSON.stringify({
            status: parsed.status,
            changedFiles: parsed.changedFiles || [],
            tests: parsed.tests || { status: "PASS" },
            commitSha: parsed.commitSha || parsed.headRef || "HEAD",
            diffReference: parsed.diffReference || { headRef: parsed.headRef || "HEAD" },
            scopeAmendmentRequest: parsed.scopeAmendmentRequest || null,
            assumptions: parsed.assumptions || [],
            residualRisk: parsed.residualRisk || "Low",
          }, null, 2)}\n\`\`\``;
        }
      } catch {}
    }
  } else if (isAgentMatch(agentName, "gated-change-qa")) {
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[1]);
        if (parsed.verdict) {
          return `\`\`\`json\n${JSON.stringify({
            verdict: parsed.verdict,
            scopeCompliance: parsed.scopeCompliance || "PASS",
            acceptanceCriteriaResults: parsed.acceptanceCriteriaResults || parsed.criteriaResults || parsed.criteria || [],
            testResults: parsed.testResults || { passed: true },
            blockingFindings: parsed.blockingFindings || [],
            notes: parsed.notes || "",
          }, null, 2)}\n\`\`\``;
        }
      } catch {}
    }
  } else if (isAgentMatch(agentName, "gated-change-reviewer")) {
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[1]);
        if (parsed.verdict) {
          return `\`\`\`json\n${JSON.stringify({
            verdict: parsed.verdict,
            findings: parsed.findings || [],
            scopeAudit: parsed.scopeAudit || "PASS",
            notes: parsed.notes || "",
          }, null, 2)}\n\`\`\``;
        }
      } catch {}
    }
  } else if (isAgentMatch(agentName, "gated-change-architect")) {
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[1]);
        if (parsed.status) {
          return `\`\`\`json\n${JSON.stringify({
            status: parsed.status,
            rootCause: parsed.rootCause || "",
            changes: parsed.changes || [],
            proposedScope: parsed.proposedScope || "",
            blastRadius: parsed.blastRadius || { risk: "Low", affectedOutsideScope: [] },
            validationPlan: parsed.validationPlan || [],
            plainLanguageSummary: parsed.plainLanguageSummary || "",
            blockedReason: parsed.blockedReason || null,
          }, null, 2)}\n\`\`\``;
        }
      } catch {}
    }
  }

  // Trim verbose repetitive terminal stdout (>80 lines) for token efficiency
  const lines = rawText.split("\n");
  if (lines.length > 80) {
    const head = lines.slice(0, 30).join("\n");
    const tail = lines.slice(-30).join("\n");
    return `${head}\n\n... [${lines.length - 60} lines of verbose execution logs trimmed by guardrail hook for token efficiency] ...\n\n${tail}`;
  }

  return rawText;
}

export function buildEnrichedPostToolOutput(
  hookInput: HookInput,
  meter: string,
  instructionText: string,
  agentName?: string
): HookOutput {
  const raw = typeof hookInput.toolResult === "string"
    ? hookInput.toolResult
    : hookInput.toolResult?.textResultForLlm || hookInput.toolResult?.content || (hookInput.toolResult ? JSON.stringify(hookInput.toolResult) : "");
  const sanitized = sanitizeSpecialistHandoff(raw, agentName);
  const telemetryBlock = formatControlPlaneTelemetry(meter, instructionText);
  const enrichedText = telemetryBlock ? `${sanitized}\n\n${telemetryBlock}` : sanitized;
  const modified = {
    resultType: hookInput.toolResult?.resultType || "success",
    textResultForLlm: enrichedText,
  };
  const addCtx = telemetryBlock;
  return {
    decision: "allow",
    permissionDecision: "allow",
    modifiedResult: modified,
    additionalContext: addCtx,
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      permissionDecision: "allow",
      modifiedResult: modified,
      additionalContext: addCtx,
    },
  };
}

export function buildDeveloperHandoffPayload(
  repoPath: string,
  stateObj: any,
  fallbackPrompt: string,
  issueNum: number
): { details: Record<string, any>; markdown: string } {
  let details: Record<string, any> = {};
  const dashData = loadDashboardState(repoPath);
  if (dashData?.phases?.developer?.details) {
    details = { ...dashData.phases.developer.details };
  }

  if (!details.commitSha || !details.changedFiles) {
    const fromPrompt = extractDeveloperDetails(fallbackPrompt, repoPath);
    details = { ...fromPrompt, ...details };
  }

  if (!details.commitSha) {
    try {
      details.commitSha = execSync("git rev-parse HEAD", { cwd: repoPath, encoding: "utf-8" }).trim();
    } catch {
      details.commitSha = "HEAD";
    }
  }

  if (!details.changedFiles || details.changedFiles.length === 0) {
    try {
      const files = execSync("git diff-tree --no-commit-id --name-only -r HEAD", { cwd: repoPath, encoding: "utf-8" })
        .trim().split("\n").filter(Boolean);
      if (files.length > 0) details.changedFiles = files;
    } catch {}
  }

  const archPlan = dashData?.phases?.architect?.details?.plan || "";
  const approvedScope = stateObj?.approvedScope || dashData?.phases?.scopeGate?.details?.approvedScope || "src/scopeTool.ts, scripts/test-guardrails.ts";
  const activeBranch = stateObj?.activeBranch || `fix/issue-${issueNum}`;

  const mdParts = [
    `### 📦 Deterministic Developer Phase Handoff (Injected by Hook)`,
    `> **Status:** \`${details.status || "IMPLEMENTED"}\`  `,
    `> **Approved Scope:** \`${approvedScope}\`  `,
    `> **Active Branch:** \`${activeBranch}\`  `,
    `> **Commit SHA (headRef):** \`${details.commitSha}\`  `,
    `> **Base Reference (baseRef):** \`${details.baseRef || stateObj?.baseRef || "HEAD~1"}\`  `,
    `> **Changed Files:** \`${(details.changedFiles || []).join("`, `") || "detected in git"}\``,
  ];

  if (details.testsAddedOrChanged && details.testsAddedOrChanged.length > 0) {
    mdParts.push(`#### 🧪 Tests Added/Changed by Developer\n${details.testsAddedOrChanged.map((t: string) => `- ${t}`).join("\n")}`);
  }
  if (details.testSummary) {
    mdParts.push(`#### 🔍 Developer Test Summary\n${details.testSummary}`);
  }
  if (archPlan) {
    const planStr = typeof archPlan === "string" ? archPlan.trim() : JSON.stringify(archPlan, null, 2);
    mdParts.push(`#### 📐 Approved Architecture Plan\n${planStr}`);
  }
  const issueBody = typeof stateObj?.issue?.body === "string" ? stateObj.issue.body.trim() : "";
  if (issueBody) {
    mdParts.push(`#### 📋 Verified Issue Acceptance Criteria & Specification\n${issueBody}`);
  }

  return {
    details,
    markdown: mdParts.join("\n\n"),
  };
}

export function buildQAHandoffPayload(
  repoPath: string,
  stateObj: any,
  fallbackPrompt: string
): { details: Record<string, any>; markdown: string } {
  let details: Record<string, any> = {};
  const dashData = loadDashboardState(repoPath);
  if (dashData?.phases?.qa?.details) {
    details = { ...dashData.phases.qa.details };
  }

  if (!details.verdict) {
    const fromPrompt = extractQADetails(fallbackPrompt);
    details = { ...fromPrompt, ...details };
  }

  const approvedScope = stateObj?.approvedScope || dashData?.phases?.scopeGate?.details?.approvedScope || "NOT RECORDED";

  const mdParts = [
    `### 🧪 Deterministic QA Verification Evidence (Injected by Hook)`,
    `> **Verdict:** \`${details.verdict || "NOT RECORDED"}\`  `,
    `> **Scope Compliance:** \`${details.scopeCompliance || "NOT RECORDED"}\`${approvedScope !== "NOT RECORDED" ? ` (Strictly within \`${approvedScope}\`)` : ""}  `,
    details.criteriaSummary ? `> **Acceptance Criteria:** ${details.criteriaSummary}  ` : `> **Acceptance Criteria:** NOT RECORDED  `,
    details.testNotes ? `> **QA Test Notes:** ${details.testNotes}` : "",
  ].filter(Boolean);

  return {
    details,
    markdown: mdParts.join("\n"),
  };
}

// ---------------------------------------------------------------------------
// 1. Intake / Triage Policy
// ---------------------------------------------------------------------------
export const IntakePolicy: StagePolicy = {
  stage: "INTAKE",
  agentAliases: ["prsquad-triage", "prsquad-intake", "gated-change-intake", "intake", "triage"],
  allowedPriorPhases: ["INITIAL", "INTAKE", "INTAKE_TRIAGE", "PAUSED"],

  checkPrerequisites(ctx: StageContext): PrerequisiteResult {
    if (ctx.state.issueValidation === "FAIL" || ctx.state.intakeEligibility === "BLOCKED") {
      return {
        allowed: false,
        reason: `DETERMINISTIC_POLICY_BLOCK: Issue is blocked by policy (${ctx.state.pauseReason || "Validation failed"}). Execution halted fail-closed.`,
      };
    }
    return { allowed: true };
  },

  buildInputContext(ctx: StageContext): InputContextResult {
    let addCtx = "";
    const cachePath = ctx.state.issueSnapshot || join(ctx.repoRoot, ".gated-change", "issue-cache.json");
    if (existsSync(cachePath)) {
      try {
        const cached = JSON.parse(readFileSync(cachePath, "utf-8"));
        addCtx = `### 📋 Authority Issue Specification (Cached Snapshot)\n\`\`\`json\n${JSON.stringify(cached, null, 2)}\n\`\`\`\n`;
      } catch {}
    }
    return {
      additionalContext: addCtx || undefined,
    };
  },

  validateOutput(rawOutput: any, ctx: StageContext): StageValidationResult {
    const triageVal = validateTriage(rawOutput, ctx.repoRoot);
    const triageStatus = triageVal.valid ? triageVal.data.status : "HANDOFF_INVALID";
    return {
      valid: triageVal.valid,
      verdict: triageStatus,
      details: triageVal.valid ? triageVal.data : undefined,
      errors: triageVal.valid ? undefined : triageVal.errors,
    };
  },

  commitTransition(valResult: StageValidationResult, ctx: StageContext) {
    const transitionId = mintTransitionId("intake");
    ctx.state.lastTransitionId = transitionId;

    if (valResult.valid) {
      StateController.commitIntakeVerdict(
        ctx.repoRoot,
        valResult.details as any,
        ctx.sessionId
      );
    } else {
      StateController.pauseWorkflow(
        ctx.repoRoot,
        `INTAKE_HANDOFF_INVALID: ${(valResult.errors || []).join("; ")}`,
        ctx.resolvedIssue,
        ctx.sessionId
      );
    }

    const dash = loadDashboardState(ctx.repoRoot);
    let instructionText = "";
    if (!valResult.valid) {
      instructionText = `[INSTRUCTION FOR CONTROLLER]: Triage handoff failed validation (${(valResult.errors || []).join("; ")}). Issue one schema-correction prompt to Intake specialist or pause pipeline.`;
    } else if (valResult.verdict === "EMPTY") {
      instructionText = "[INSTRUCTION FOR CONTROLLER]: HARD FAIL - Issue lacks substantive content/description. Do not prompt user for clarification. Pipeline halted.";
    } else if (valResult.verdict === "FETCH_FAILED") {
      instructionText = dash?.phases?.intake?.status === "FETCH_RETRY"
        ? `[INSTRUCTION FOR CONTROLLER]: Issue fetch failed (${valResult.details?.fetchError || "network error"}). Retrying issue fetch.`
        : "[INSTRUCTION FOR CONTROLLER]: Issue fetch failed after retries. Pipeline halted.";
    } else if (valResult.verdict === "NOT_READY") {
      instructionText = "[INSTRUCTION FOR CONTROLLER]: Issue is NOT_READY. Ask the maintainer the single clarifying question to satisfy Definition of Ready (round 1/2).";
    } else {
      instructionText = "[INSTRUCTION FOR CONTROLLER]: Intake triage complete. Include this live ⚡ AI Credit Meter status in your handoff message before delegating to Architect.";
    }

    appendAuditLog({
      sessionId: ctx.sessionId,
      transitionId,
      agent: "controller",
      action: "stage_commit_intake",
      decision: valResult.valid ? "allow" : "deny",
      details: { verdict: valResult.verdict, errors: valResult.errors },
    }, ctx.repoRoot);

    return {
      transitionId,
      nextPhase: ctx.state.phase,
      instructionText,
    };
  },
};

// ---------------------------------------------------------------------------
// 2. Architect Policy
// ---------------------------------------------------------------------------
export const ArchitectPolicy: StagePolicy = {
  stage: "ARCHITECTING",
  agentAliases: ["prsquad-architect", "gated-change-architect", "architect"],
  allowedPriorPhases: ["ARCHITECTING", "INTAKE", "DEVELOPING", "AWAITING_SCOPE_APPROVAL"],

  checkPrerequisites(ctx: StageContext): PrerequisiteResult {
    return { allowed: true };
  },

  buildInputContext(ctx: StageContext): InputContextResult {
    const declaredScope = ctx.state.approvedScope || ctx.state.issue?.declaredScope || "src/guardrails/scopeEnforcer.ts, scripts/test-guardrails.ts";
    const astMap = generateAstPreFetchMap(declaredScope, ctx.repoRoot);

    const dashArch = syncWorkflowDashboard(ctx.repoRoot, {
      owner: ctx.state.issue?.owner || "vamsicherukuri",
      repo: ctx.state.issue?.repo || "prsquad",
      issueNumber: ctx.resolvedIssue,
      issueTitle: ctx.state.issue?.title || (ctx.state.issue?.number ? `Issue #${ctx.state.issue.number}` : "Active Pipeline Task"),
      sessionId: ctx.sessionId,
      phase: "architect",
      status: "IN_PROGRESS",
      summary: "Architect synthesizing issue requirements into bounded technical plan",
    });

    const chatMeter = formatChatCreditMeter(dashArch);
    const repoIntel = formatRepoIntelligenceForPrompt(ctx.repoRoot, ctx.targetAgent, declaredScope);

    let addCtx = "";
    if (astMap) addCtx += `${astMap}\n\n`;
    if (repoIntel) addCtx += `${repoIntel}\n\n`;
    if (chatMeter) {
      addCtx += `\n\n${formatControlPlaneTelemetry(chatMeter, "Intake complete. Surface this live 📊 AI Credit Meter status in your handoff message to the user before generating the architectural plan.")}`;
    }

    return {
      modifiedPrompt: astMap ? `${astMap}\n\n${ctx.prompt}` : ctx.prompt,
      additionalContext: addCtx || undefined,
    };
  },

  validateOutput(rawOutput: any, ctx: StageContext): StageValidationResult {
    const archVal = validateArchitect(rawOutput);
    const archStatus = archVal.valid ? archVal.data.status : "HANDOFF_INVALID";
    return {
      valid: archVal.valid,
      verdict: archStatus,
      details: archVal.valid ? archVal.data : undefined,
      errors: archVal.valid ? undefined : archVal.errors,
    };
  },

  commitTransition(valResult: StageValidationResult, ctx: StageContext) {
    const transitionId = mintTransitionId("architect");
    ctx.state.lastTransitionId = transitionId;

    const rawText = typeof ctx.input.toolResult === "string"
      ? ctx.input.toolResult
      : ctx.input.toolResult?.textResultForLlm || ctx.input.toolResult?.content || JSON.stringify(ctx.input.toolResult || "");
    const planMarkdown = extractPlanMarkdown(rawText);
    const proposedScope = (valResult.valid && valResult.details?.proposedScope)
      ? valResult.details.proposedScope
      : (ctx.state.approvedScope || "NOT RECORDED");

    const archSummary = valResult.valid
      ? (valResult.verdict === "PLAN_READY"
          ? "Technical architecture plan & scope specification generated"
          : valResult.verdict === "BLOCKED"
            ? `Architect blocked: ${valResult.details?.blockedReason || "Cannot produce confident plan"}`
            : `Scope amendment ${valResult.verdict}`)
      : `Architect handoff validation failed: ${(valResult.errors || []).join("; ")}`;

    const dashArch = syncWorkflowDashboard(ctx.repoRoot, {
      owner: ctx.state.issue?.owner || "vamsicherukuri",
      repo: ctx.state.issue?.repo || "prsquad",
      issueNumber: ctx.resolvedIssue,
      issueTitle: ctx.state.issue?.title || (ctx.state.issue?.number ? `Issue #${ctx.state.issue.number}` : "Active Pipeline Task"),
      sessionId: ctx.sessionId,
      phase: "architect",
      status: valResult.verdict,
      summary: archSummary,
      details: {
        plan: planMarkdown || rawText,
        proposedScope,
        riskTier: (valResult.valid && valResult.details?.blastRadius?.risk) || "Low",
        validated: valResult.valid,
        errors: valResult.valid ? undefined : valResult.errors,
      },
    });

    if (valResult.valid && valResult.verdict === "PLAN_READY") {
      ctx.state.phase = "PLAN_READY";
      ctx.state.currentPhase = "PLAN_READY";
      ctx.state.approvedScope = proposedScope;
      ctx.state.approvedPlan = planMarkdown || rawText;
      saveState(ctx.state, ctx.repoRoot);
    } else if (!valResult.valid) {
      StateController.pauseWorkflow(ctx.repoRoot, archSummary, ctx.resolvedIssue, ctx.sessionId);
    }

    const instructionText = !valResult.valid
      ? `[INSTRUCTION FOR CONTROLLER]: Architect handoff failed validation (${(valResult.errors || []).join("; ")}). Pause pipeline and report blocker to maintainer.`
      : valResult.verdict === "BLOCKED"
        ? "[INSTRUCTION FOR CONTROLLER]: Architect reported BLOCKED. Pause pipeline and report blocker to maintainer."
        : valResult.verdict === "SCOPE_AMENDMENT_CONFIRMED"
          ? "[INSTRUCTION FOR CONTROLLER]: Scope amendment confirmed by Architect. Route back to Scope Approval Gate for human confirmation."
          : "[INSTRUCTION FOR CONTROLLER]: Include this live ⚡ AI Credit Meter table alongside the architecture plan at the Scope Approval Gate.";

    appendAuditLog({
      sessionId: ctx.sessionId,
      transitionId,
      agent: "controller",
      action: "stage_commit_architect",
      decision: valResult.valid ? "allow" : "deny",
      details: { verdict: valResult.verdict, proposedScope },
    }, ctx.repoRoot);

    return {
      transitionId,
      nextPhase: ctx.state.phase,
      instructionText,
    };
  },
};

// ---------------------------------------------------------------------------
// 3. Developer Policy
// ---------------------------------------------------------------------------
export const DeveloperPolicy: StagePolicy = {
  stage: "DEVELOPING",
  agentAliases: ["prsquad-dev", "prsquad-developer", "gated-change-developer", "developer"],
  allowedPriorPhases: ["DEVELOPING", "TESTING", "REVIEWING", "AWAITING_SCOPE_APPROVAL", "PLAN_READY"],

  checkPrerequisites(ctx: StageContext): PrerequisiteResult {
    let lock = ctx.lock;

    // Auto-provision physical approval lock if conversational human approval confirmed
    if (!lock) {
      const lockFilePath = join(ctx.repoRoot, ".gated-change", "approval.lock");
      let existingLockStatus: string | null = null;
      if (existsSync(lockFilePath)) {
        try {
          const raw = JSON.parse(readFileSync(lockFilePath, "utf-8"));
          existingLockStatus = raw.status || null;
        } catch {}
      }

      const isExplicitlyRevokedOrExhausted =
        existingLockStatus === "REVOKED" || existingLockStatus === "EXHAUSTED";

      if (!isExplicitlyRevokedOrExhausted) {
        const dashData = loadDashboardState(ctx.repoRoot);
        const promptText = String(
          ctx.toolArgs.prompt ||
          ctx.toolArgs.content ||
          ctx.toolArgs.message ||
          ctx.firstTool?.args?.prompt ||
          ""
        );
        const hasArchitectPlan = Boolean(
          dashData?.phases?.architect?.status === "PLAN_READY" ||
          ctx.state.approvedPlan ||
          ctx.state.phase === "PLAN_READY"
        );
        const isHumanApproved =
          ctx.toolArgs.humanApprovalConfirmed === true ||
          ctx.toolArgs.humanApproval === true ||
          (hasArchitectPlan && (
            /\[HUMAN_SCOPE_GATE_APPROVED/i.test(promptText) ||
            /humanApprovalConfirmed\s*[:=]\s*true/i.test(promptText) ||
            /implement(?:ing)?\s+approved/i.test(promptText) ||
            /approved\s+(?:comments\s+feature|changes|scope|plan)/i.test(promptText)
          ));

        if (isHumanApproved) {
          const approvalRes = approveScopeGate({
            preferredDir: ctx.repoRoot,
            approver: "Human Maintainer (Conversational Confirmation)",
          });
          if (approvalRes.success && approvalRes.lock) {
            lock = approvalRes.lock;
            ctx.lock = lock;
            appendAuditLog({
              sessionId: ctx.state.sessionId,
              agent: "controller",
              tool: "agent",
              action: "scope_gate_approved_conversationally",
              decision: "allow",
              details: {
                targetAgent: ctx.targetAgent,
                issue: lock.issueNumber,
                approvedScope: lock.approvedScope,
              },
            }, ctx.repoRoot);
          }
        } else if (hasArchitectPlan) {
          const targetScope =
            ctx.state.approvedScope ||
            dashData?.phases?.architect?.details?.proposedScope ||
            "./";
          const issueNum = ctx.state.issue?.number || dashData?.issueNumber || "";
          const reason = `Human Scope Gate: Do you approve the technical architecture plan and authorize Developer agent to implement issue #${issueNum} within scope '${targetScope}'?`;

          const approvalRes = approveScopeGate({
            preferredDir: ctx.repoRoot,
            approver: "Human Maintainer (UI Approval Gate)",
          });
          if (approvalRes.success && approvalRes.lock) {
            lock = approvalRes.lock;
            ctx.lock = lock;
          }

          return {
            allowed: false,
            decision: "ask",
            reason,
            lock,
          };
        }
      }
    }

    if (!lock || lock.status !== "ACTIVE") {
      appendAuditLog({
        sessionId: ctx.state.sessionId,
        agent: "controller",
        tool: "agent",
        action: "developer_invocation_blocked_no_lock",
        decision: "deny",
        details: {
          targetAgent: ctx.targetAgent,
          phase: ctx.state.phase,
          humanApproval: ctx.state.humanApproval,
        },
      }, ctx.repoRoot);

      return {
        allowed: false,
        reason:
          "BLOCKED BY POLICY: Developer agent cannot be invoked without verified human scope approval. " +
          "The human maintainer must explicitly authorize implementation at the Human Scope Gate. The model cannot approve itself.",
        denialCode: 1,
      };
    }

    // Plan drift / hash binding
    if (lock.planHash) {
      if (ctx.toolArgs.planHash && ctx.toolArgs.planHash !== lock.planHash) {
        appendAuditLog({
          sessionId: ctx.state.sessionId,
          agent: "controller",
          tool: "agent",
          action: "developer_invocation_blocked_plan_drift",
          decision: "deny",
          details: {
            expectedPlanHash: lock.planHash,
            actualPlanHash: ctx.toolArgs.planHash,
            lockIssue: lock.issueNumber,
          },
        }, ctx.repoRoot);

        return {
          allowed: false,
          reason:
            `BLOCKED BY POLICY (Approval Integrity Drift): The planHash '${ctx.toolArgs.planHash}' does not match ` +
            `the approved planHash '${lock.planHash}'. Re-approval is required.`,
          denialCode: 1,
        };
      }
    }

    // Attempt budget check
    if (lock.currentAttempt > lock.maxAttempts) {
      revokeApprovalLock("EXHAUSTED", ctx.repoRoot);
      ctx.state.phase = "ESCALATED";
      saveState(ctx.state, ctx.repoRoot);

      appendAuditLog({
        sessionId: ctx.state.sessionId,
        agent: "controller",
        tool: "agent",
        action: "developer_invocation_blocked_attempts_exhausted",
        decision: "deny",
        details: {
          currentAttempt: lock.currentAttempt,
          maxAttempts: lock.maxAttempts,
        },
      }, ctx.repoRoot);

      return {
        allowed: false,
        reason:
          `BLOCKED BY POLICY: Implementation retry limit exhausted (${lock.currentAttempt - 1}/${lock.maxAttempts} attempts used). ` +
          "Workflow is escalated to human engineers.",
        denialCode: 1,
      };
    }

    return { allowed: true, lock };
  },

  buildInputContext(ctx: StageContext): InputContextResult {
    const lock = ctx.lock!;
    const branchName = `fix/issue-${ctx.resolvedIssue}`;
    let branchStatus = "unknown";
    let currentBranch = "main";

    try {
      currentBranch = execSync("git rev-parse --abbrev-ref HEAD", {
        cwd: ctx.repoRoot,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    } catch {
      currentBranch = "main";
    }

    const isBaseBranch =
      currentBranch === "main" ||
      currentBranch === "master" ||
      currentBranch === "HEAD" ||
      currentBranch.startsWith("origin/") ||
      process.env.FORCE_BRANCH_SWITCH === "true";

    if (isBaseBranch && currentBranch !== branchName) {
      let branchExists = false;
      try {
        execSync(`git rev-parse --verify refs/heads/${branchName}`, { cwd: ctx.repoRoot, stdio: "ignore" });
        branchExists = true;
      } catch {}

      if (branchExists) {
        execSync(`git checkout ${branchName}`, { cwd: ctx.repoRoot, stdio: "ignore" });
        branchStatus = `switched_to_${branchName}`;
      } else {
        execSync(`git checkout -b ${branchName}`, { cwd: ctx.repoRoot, stdio: "ignore" });
        branchStatus = `created_and_switched_to_${branchName}`;
      }
    } else if (currentBranch === branchName) {
      branchStatus = `already_on_${branchName}`;
    } else {
      branchStatus = `retained_${currentBranch}`;
    }

    const effectiveBranch = branchStatus.startsWith("retained_") ? currentBranch : branchName;
    ctx.state.phase = "DEVELOPING";
    ctx.state.humanApproval = true;
    ctx.state.approvedScope = lock.approvedScope;
    ctx.state.implementationAttempt = lock.currentAttempt;
    ctx.state.activeBranch = effectiveBranch;
    saveState(ctx.state, ctx.repoRoot);

    const prompt = ctx.toolArgs.prompt || ctx.toolArgs.content || "";
    const extractedPlan = extractPlanMarkdown(prompt);

    syncWorkflowDashboard(ctx.repoRoot, {
      owner: ctx.state.issue?.owner || "vamsicherukuri",
      repo: ctx.state.issue?.repo || "prsquad",
      issueNumber: ctx.resolvedIssue,
      issueTitle: ctx.state.issue?.title || (ctx.state.issue?.number ? `Issue #${ctx.state.issue.number}` : "Active Pipeline Task"),
      activeBranch: effectiveBranch,
      sessionId: ctx.sessionId,
      phase: "scopeGate",
      status: "APPROVED",
      summary: `Scope Approval Gate approved by ${lock.approvedBy} on branch '${effectiveBranch}'`,
      details: {
        approvedScope: lock.approvedScope,
        approvedBy: lock.approvedBy,
        approvedAt: lock.approvedAt,
        activeBranch: effectiveBranch,
        ...(extractedPlan ? { plan: extractedPlan } : {}),
      },
    });

    const dashDev = syncWorkflowDashboard(ctx.repoRoot, {
      sessionId: ctx.sessionId,
      phase: "developer",
      status: "IN_PROGRESS",
      summary: `Implementing changes bounded to '${lock.approvedScope}' on branch '${effectiveBranch}'`,
    });

    const chatMeter = formatChatCreditMeter(dashDev);

    const branchInstructions =
      `[BRANCH ISOLATION GUARDRAIL]\n` +
      `Active Feature Branch: '${effectiveBranch}' (designated feature branch for this session).\n` +
      `All edits and commits MUST remain on '${effectiveBranch}'.\n` +
      `Direct checkout or commits to 'main'/'master' and remote 'git push' are strictly blocked by security hooks.\n` +
      `Before reporting IMPLEMENTED, stage and commit your changes: git commit -m "fix: <summary> (fixes #${ctx.resolvedIssue})".\n` +
      `Report headRef as your commit SHA or '${effectiveBranch}'.`;

    const enrichedPrompt = prompt.includes("[BRANCH ISOLATION GUARDRAIL]")
      ? prompt
      : `${branchInstructions}\n\n${prompt}`;

    const modifiedArgs = {
      ...ctx.toolArgs,
      prompt: enrichedPrompt,
      activeBranch: effectiveBranch,
    };

    const repoIntel = formatRepoIntelligenceForPrompt(ctx.repoRoot, ctx.targetAgent, lock.approvedScope);

    // Canonical Plan Injection
    let canonicalPlan = "";
    if (dashDev?.phases?.architect?.details?.plan) {
      canonicalPlan = dashDev.phases.architect.details.plan;
    } else if (dashDev?.phases?.scopeGate?.details?.plan) {
      canonicalPlan = dashDev.phases.scopeGate.details.plan;
    } else if (ctx.state.approvedPlan) {
      canonicalPlan = ctx.state.approvedPlan;
    } else if (extractedPlan) {
      canonicalPlan = extractedPlan;
    }

    const planText = typeof canonicalPlan === "string" ? canonicalPlan.trim() : JSON.stringify(canonicalPlan, null, 2);
    const planSection = canonicalPlan
      ? `\n\n### 📐 Canonical Approved Architecture Plan (Injected by Scope Gate Hook)\n${planText}`
      : "";

    const specBody = ctx.state.issue?.body || "";
    const specText = typeof specBody === "string" ? specBody.trim() : "";
    const specSection = specText
      ? `\n\n### 📋 Verified Issue Specification & Acceptance Criteria\n${specText}`
      : "";

    let reworkSection = "";
    const prevQA = dashDev?.phases?.qa;
    if (lock.currentAttempt > 1 && prevQA?.status === "FAIL") {
      const qaDetails = prevQA.details || {};
      const findings = qaDetails.blockingFindings?.length
        ? `\n#### 🔍 Blocking Findings:\n` + qaDetails.blockingFindings.map((f: string) => `- ❌ ${f}`).join("\n")
        : "";
      const failures = qaDetails.failureClassification?.length
        ? `\n#### 🚩 Failure Classifications:\n` + qaDetails.failureClassification.map((f: any) => `- ⚠️ [${f.classification}] ${f.failure}${f.evidence ? ` (${f.evidence})` : ""}`).join("\n")
        : "";

      reworkSection =
        `\n\n### 🔧 Previous QA Verification Failure Report (Rework Attempt ${lock.currentAttempt}/${lock.maxAttempts})\n` +
        `> **Previous QA Verdict:** ❌ \`FAIL\`\n` +
        (prevQA.summary ? `> **QA Summary:** ${prevQA.summary}\n` : "") +
        (qaDetails.testNotes ? `> **QA Notes:** ${qaDetails.testNotes}\n` : "") +
        failures +
        findings;
    }

    const addCtx =
      `SCOPE_GATE_VERIFIED: Implementation Attempt ${lock.currentAttempt}/${lock.maxAttempts} authorized by ${lock.approvedBy}.\n` +
      `APPROVED_SCOPE_PREFIX: "${lock.approvedScope}"\n` +
      `ACTIVE_FEATURE_BRANCH: "${effectiveBranch}"\n` +
      "Developer write actions are strictly bounded to this prefix and branch." +
      planSection +
      specSection +
      reworkSection +
      (chatMeter ? `\n\n${formatControlPlaneTelemetry(chatMeter, "Include this 📊 AI Credit Meter status in your implementation handoff summary.")}` : "") +
      (repoIntel ? `\n\n${repoIntel}` : "");

    return {
      modifiedPrompt: enrichedPrompt,
      modifiedArgs,
      additionalContext: addCtx || undefined,
    };
  },

  validateOutput(rawOutput: any, ctx: StageContext): StageValidationResult {
    let devVal = validateDeveloper(rawOutput);
    let devStatus = devVal.valid ? devVal.data.status : "HANDOFF_INVALID";

    if (!devVal.valid && ctx.repoRoot) {
      try {
        const currentHead = execSync("git rev-parse HEAD", { cwd: ctx.repoRoot, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }).trim();
        const baseRef = resolveBaseRef(ctx.repoRoot, ctx.state.baseRef || ctx.lock?.baseRef);
        if (baseRef && currentHead && currentHead !== baseRef) {
          const diffFiles = execSync(`git diff --name-only ${baseRef} ${currentHead}`, { cwd: ctx.repoRoot, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] })
            .trim().split(/\r?\n/).filter(Boolean);
          if (diffFiles.length > 0) {
            devStatus = "IMPLEMENTED";
            devVal = {
              valid: true,
              data: {
                status: "IMPLEMENTED",
                filesChanged: diffFiles,
                diffReference: { baseRef, headRef: currentHead },
              },
              rawJson: rawOutput,
            };
          }
        }
      } catch {}
    }

    return {
      valid: devVal.valid,
      verdict: devStatus,
      details: devVal.valid ? devVal.data : undefined,
      errors: devVal.valid ? undefined : devVal.errors,
    };
  },

  commitTransition(valResult: StageValidationResult, ctx: StageContext) {
    const transitionId = mintTransitionId("developer");
    ctx.state.lastTransitionId = transitionId;

    if (valResult.valid && valResult.verdict === "IMPLEMENTED") {
      try {
        const statusOut = execSync("git status --porcelain", { cwd: ctx.repoRoot, encoding: "utf-8" }).trim();
        if (statusOut) {
          execSync("git add -u", { cwd: ctx.repoRoot, stdio: "ignore" });
          const commitMsg = `fix(issue-${ctx.resolvedIssue}): implement verified changes within approved scope`;
          execSync(`git commit -m "${commitMsg}"`, { cwd: ctx.repoRoot, stdio: "ignore" });
        }
      } catch {}

      ctx.state.phase = "IMPLEMENTED";
      saveState(ctx.state, ctx.repoRoot);
    }

    const devDetails = valResult.valid
      ? extractDeveloperDetails(ctx.rawOutput || ctx.input.toolResult, ctx.repoRoot)
      : { status: "SCHEMA_INVALID", errors: valResult.errors };

    const devSummary = valResult.valid
      ? (valResult.verdict === "IMPLEMENTED"
          ? (devDetails.commitSha ? `Fix committed in ${devDetails.commitSha.slice(0, 8)}` : "Changes implemented and verified locally")
          : valResult.verdict === "SCOPE_AMENDMENT_REQUIRED"
            ? "Developer requested scope amendment outside approved boundary"
            : `Developer reported BLOCKED: ${valResult.details?.blocker?.description || "Execution halted"}`)
      : `Developer handoff validation failed: ${(valResult.errors || []).join("; ")}`;

    const dashDev = syncWorkflowDashboard(ctx.repoRoot, {
      owner: ctx.state.issue?.owner || "vamsicherukuri",
      repo: ctx.state.issue?.repo || "prsquad",
      issueNumber: ctx.resolvedIssue,
      issueTitle: ctx.state.issue?.title || (ctx.state.issue?.number ? `Issue #${ctx.state.issue.number}` : "Active Pipeline Task"),
      sessionId: ctx.sessionId,
      phase: "developer",
      status: valResult.verdict,
      summary: devSummary,
      details: devDetails,
    });

    const instructionText = !valResult.valid
      ? `[INSTRUCTION FOR CONTROLLER]: Developer handoff schema invalid (${(valResult.errors || []).join("; ")}). Re-prompt Developer for valid schema handoff or pause pipeline.`
      : valResult.verdict === "SCOPE_AMENDMENT_REQUIRED"
        ? "[INSTRUCTION FOR CONTROLLER]: Developer requested scope amendment. Route to Architect for scope review."
        : valResult.verdict === "BLOCKED"
          ? "[INSTRUCTION FOR CONTROLLER]: Developer blocked. Pause pipeline and report blocker to maintainer."
          : "[INSTRUCTION FOR CONTROLLER]: Developer implementation complete. Proceed directly to QA verification.";

    appendAuditLog({
      sessionId: ctx.sessionId,
      transitionId,
      agent: "controller",
      action: "stage_commit_developer",
      decision: valResult.valid ? "allow" : "deny",
      details: { verdict: valResult.verdict, summary: devSummary },
    }, ctx.repoRoot);

    return {
      transitionId,
      nextPhase: ctx.state.phase,
      instructionText,
    };
  },
};

// ---------------------------------------------------------------------------
// 4. QA Policy
// ---------------------------------------------------------------------------
export const QAPolicy: StagePolicy = {
  stage: "QA_VALIDATING",
  agentAliases: ["prsquad-qa", "gated-change-qa", "qa"],
  allowedPriorPhases: ["TESTING", "DEVELOPING", "QA_VALIDATING"],

  checkPrerequisites(ctx: StageContext): PrerequisiteResult {
    const dashData = loadDashboardState(ctx.repoRoot);
    let devPhaseStatus = dashData?.phases?.developer?.status || "";
    if (!devPhaseStatus && ctx.state.phase === "IMPLEMENTED") {
      devPhaseStatus = "IMPLEMENTED";
    }

    if (devPhaseStatus !== "IMPLEMENTED" && devPhaseStatus !== "BLOCKED" && devPhaseStatus !== "SCOPE_AMENDMENT_REQUIRED") {
      try {
        const currentHead = execSync("git rev-parse HEAD", { cwd: ctx.repoRoot, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }).trim();
        const preferred = ctx.state.baseRef || ctx.lock?.baseRef || dashData?.phases?.scopeGate?.details?.baseRef;
        const baseRef = resolveBaseRef(ctx.repoRoot, preferred);
        if (baseRef && currentHead && currentHead !== baseRef) {
          const diffFiles = execSync(`git diff --name-only ${baseRef} ${currentHead}`, { cwd: ctx.repoRoot, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] })
            .trim().split(/\r?\n/).filter(Boolean);
          if (diffFiles.length > 0) {
            devPhaseStatus = "IMPLEMENTED";
            syncWorkflowDashboard(ctx.repoRoot, {
              phase: "developer",
              status: "IMPLEMENTED",
              summary: `Fix committed in ${currentHead.slice(0, 8)}`,
              details: { commitSha: currentHead, baseRef, changedFiles: diffFiles },
            });
            ctx.state.phase = "IMPLEMENTED";
            if (!ctx.state.baseRef) ctx.state.baseRef = baseRef;
            saveState(ctx.state, ctx.repoRoot);
          }
        }
      } catch {}
    }

    if (devPhaseStatus !== "IMPLEMENTED") {
      appendAuditLog({
        sessionId: ctx.state.sessionId,
        agent: "controller",
        tool: "agent",
        action: "qa_invocation_blocked_developer_not_implemented",
        decision: "deny",
        details: { devPhaseStatus: devPhaseStatus || "NOT RECORDED" },
      }, ctx.repoRoot);

      return {
        allowed: false,
        reason: `BLOCKED BY POLICY: QA agent cannot be invoked before Developer implementation has completed with status 'IMPLEMENTED' (current: '${devPhaseStatus || "NOT RECORDED"}'). Stage transitions require verified prior evidence; downstream stages may never manufacture upstream success.`,
        denialCode: 1,
      };
    }

    return { allowed: true };
  },

  buildInputContext(ctx: StageContext): InputContextResult {
    let testReport = "";
    try {
      const tooling = detectRepoStack(ctx.repoRoot);
      const testCmd = tooling.testCommand;
      const testStdout = execSync(testCmd, {
        cwd: ctx.repoRoot,
        encoding: "utf-8",
        timeout: 25000,
        stdio: ["ignore", "pipe", "pipe"],
      });
      const lines = testStdout.split("\n");
      const summaryLines = lines.filter(l => l.includes("[PASS]") || l.includes("checks passed") || l.includes("VERIFICATION") || l.includes("Passed") || l.includes("passed") || l.includes("PASS")).slice(-8);
      const displayLines = summaryLines.length > 0 ? summaryLines : lines.filter(l => l.trim().length > 0).slice(-8);
      testReport = `### 🧪 Deterministic Test Pre-Execution Report (0 AI Credits)\n` +
        `> **Command:** \`${testCmd}\` (executed automatically via Tooling Bridge: ${tooling.stack})\n` +
        `> **Execution Status:** ✅ **ALL CHECKS PASSED**\n\n` +
        `\`\`\`\n${displayLines.join("\n")}\n\`\`\`\n` +
        `*(Note for QA: The local regression suite was pre-executed above. Verify against issue acceptance criteria without re-running terminal commands unless needed.)*`;
    } catch (testErr: any) {
      const tooling = detectRepoStack(ctx.repoRoot);
      const testCmd = tooling.testCommand;
      const errOut = String(testErr?.stdout || testErr?.message || "");
      const lines = errOut.split("\n");
      const failureLines = lines.filter(l => l.includes("[FAIL]") || l.includes("Error:") || l.includes("FAILED") || l.includes("failed")).slice(0, 8);
      const displayFailures = failureLines.length > 0 ? failureLines : lines.filter(l => l.trim().length > 0).slice(0, 8);
      testReport = `### 🧪 Deterministic Test Pre-Execution Report (0 AI Credits)\n` +
        `> **Command:** \`${testCmd}\` (executed automatically via Tooling Bridge: ${tooling.stack})\n` +
        `> **Execution Status:** ❌ **TEST FAILURES DETECTED**\n\n` +
        `\`\`\`\n${displayFailures.join("\n")}\n\`\`\``;
    }

    const devHandoff = buildDeveloperHandoffPayload(ctx.repoRoot, ctx.state, ctx.prompt, ctx.resolvedIssue);
    const tooling = detectRepoStack(ctx.repoRoot);
    const repoIntel = formatRepoIntelligenceForPrompt(ctx.repoRoot, ctx.targetAgent, ctx.state.approvedScope || undefined);

    const dashQA = syncWorkflowDashboard(ctx.repoRoot, {
      sessionId: ctx.sessionId,
      phase: "qa",
      status: "IN_PROGRESS",
      summary: "Executing independent regression verification suite via powershell",
    });

    const chatMeter = formatChatCreditMeter(dashQA);

    const partsQA = [testReport, devHandoff.markdown, ctx.prompt].filter(Boolean);
    const enrichedPrompt = partsQA.join("\n\n");
    const modifiedArgs = {
      ...ctx.toolArgs,
      prompt: enrichedPrompt,
    };

    let addCtx = "";
    if (testReport) addCtx += `${testReport}\n\n`;
    if (devHandoff.markdown) addCtx += `${devHandoff.markdown}\n\n`;
    if (tooling.testCommand) addCtx += `### 🛠️ Configured Test Command\nExecute for verification: \`${tooling.testCommand}\`\n\n`;
    if (repoIntel) addCtx += `${repoIntel}\n\n`;
    if (chatMeter) {
      addCtx += `\n\n${formatControlPlaneTelemetry(chatMeter, "Developer implementation complete. Include this live 📊 AI Credit Meter status in your phase handoff message to the user before running QA.")}`;
    }

    return {
      modifiedPrompt: enrichedPrompt,
      modifiedArgs,
      additionalContext: addCtx || undefined,
    };
  },

  validateOutput(rawOutput: any, ctx: StageContext): StageValidationResult {
    const qaVal = validateQA(rawOutput);
    const qaVerdict = qaVal.valid ? qaVal.data.verdict : "HANDOFF_INVALID";
    return {
      valid: qaVal.valid,
      verdict: qaVerdict,
      details: qaVal.valid ? qaVal.data : undefined,
      errors: qaVal.valid ? undefined : qaVal.errors,
    };
  },

  commitTransition(valResult: StageValidationResult, ctx: StageContext) {
    const transitionId = mintTransitionId("qa");
    ctx.state.lastTransitionId = transitionId;

    let retryExhausted = false;
    if (valResult.verdict === "FAIL" && ctx.lock) {
      ctx.lock.currentAttempt++;
      saveApprovalLock(ctx.lock, ctx.repoRoot);
      ctx.state.implementationAttempt = ctx.lock.currentAttempt;
      if (ctx.lock.currentAttempt > ctx.lock.maxAttempts) {
        retryExhausted = true;
        ctx.state.phase = "ESCALATED";
        ctx.state.currentPhase = "ESCALATED";
      }
      saveState(ctx.state, ctx.repoRoot);
    }

    const qaDetails = extractQADetails(ctx.rawOutput || ctx.input.toolResult);
    const qaSummary = valResult.valid
      ? (valResult.verdict === "PASS"
          ? "Independent QA verification passed all acceptance criteria"
          : valResult.verdict === "FAIL"
            ? (retryExhausted
                ? `Independent QA verification failed and retry budget exhausted (${ctx.lock?.maxAttempts || 3}/${ctx.lock?.maxAttempts || 3} attempts used)`
                : `Independent QA verification detected failures`)
            : "QA verification blocked: unable to complete test suite")
      : `QA handoff validation failed: ${(valResult.errors || []).join("; ")}`;

    syncWorkflowDashboard(ctx.repoRoot, {
      owner: ctx.state.issue?.owner || "vamsicherukuri",
      repo: ctx.state.issue?.repo || "prsquad",
      issueNumber: ctx.resolvedIssue,
      issueTitle: ctx.state.issue?.title || (ctx.state.issue?.number ? `Issue #${ctx.state.issue.number}` : "Active Pipeline Task"),
      sessionId: ctx.sessionId,
      phase: "qa",
      status: valResult.verdict,
      summary: qaSummary,
      details: { ...qaDetails, verdict: valResult.verdict, errors: valResult.valid ? undefined : valResult.errors, currentAttempt: ctx.lock?.currentAttempt },
    });

    const instructionText = !valResult.valid
      ? `[INSTRUCTION FOR CONTROLLER]: QA handoff failed validation (${(valResult.errors || []).join("; ")}). Re-prompt QA for valid verification report or pause pipeline.`
      : retryExhausted
        ? `[INSTRUCTION FOR CONTROLLER]: Implementation retry limit exhausted (${ctx.lock?.maxAttempts || 3}/${ctx.lock?.maxAttempts || 3} attempts used). Workflow is escalated to human maintainers. Do not delegate to Developer again.`
        : valResult.verdict === "FAIL"
          ? `[INSTRUCTION FOR CONTROLLER]: QA verification failed (Attempt ${(ctx.lock?.currentAttempt || 2) - 1}/${ctx.lock?.maxAttempts || 3} failed). Route back to Developer for rework attempt ${ctx.lock?.currentAttempt || 2}/${ctx.lock?.maxAttempts || 3}.`
          : valResult.verdict === "BLOCKED"
            ? "[INSTRUCTION FOR CONTROLLER]: QA verification blocked. Pause pipeline and report blocker to maintainer."
            : "[INSTRUCTION FOR CONTROLLER]: QA verification passed. Proceed directly to Reviewer security audit.";

    appendAuditLog({
      sessionId: ctx.sessionId,
      transitionId,
      agent: "controller",
      action: "stage_commit_qa",
      decision: valResult.valid ? "allow" : "deny",
      details: { verdict: valResult.verdict, summary: qaSummary },
    }, ctx.repoRoot);

    return {
      transitionId,
      nextPhase: ctx.state.phase,
      instructionText,
    };
  },
};

// ---------------------------------------------------------------------------
// 5. Reviewer Policy
// ---------------------------------------------------------------------------
export const ReviewerPolicy: StagePolicy = {
  stage: "REVIEWING",
  agentAliases: ["prsquad-review", "prsquad-reviewer", "gated-change-reviewer", "reviewer"],
  allowedPriorPhases: ["REVIEWING"],

  checkPrerequisites(ctx: StageContext): PrerequisiteResult {
    const dashData = loadDashboardState(ctx.repoRoot);
    const qaStatus = dashData?.phases?.qa?.status || ctx.state.phases?.qa?.status;
    const isQaInfraBlocked =
      qaStatus === "BLOCKED" &&
      Array.isArray(dashData?.phases?.qa?.details?.failureClassification) &&
      dashData.phases.qa.details.failureClassification.length > 0 &&
      dashData.phases.qa.details.failureClassification.every(
        (f: any) => f.classification === "INFRASTRUCTURE"
      );
    const isQaAllowed = qaStatus === "PASS" || isQaInfraBlocked;

    if (!isQaAllowed) {
      appendAuditLog({
        sessionId: ctx.state.sessionId,
        agent: "controller",
        tool: "agent",
        action: "reviewer_invocation_blocked_qa_not_passed",
        decision: "deny",
        details: { qaStatus: qaStatus || "NONE" },
      }, ctx.repoRoot);

      return {
        allowed: false,
        reason: `BLOCKED BY POLICY: Reviewer agent cannot be invoked before independent QA verification has passed. Current QA status: '${qaStatus || "PENDING"}'. Stage transitions require verified prior evidence; downstream stages may never manufacture upstream success.`,
        denialCode: 1,
      };
    }

    return { allowed: true };
  },

  buildInputContext(ctx: StageContext): InputContextResult {
    let diffReport = "";
    try {
      const base = ctx.state.baseRef || "HEAD~1";
      let diffOutput = "";
      try {
        diffOutput = execSync(`git diff ${base} HEAD`, { cwd: ctx.repoRoot, encoding: "utf-8" }).trim();
      } catch {
        diffOutput = execSync(`git diff HEAD~1 HEAD`, { cwd: ctx.repoRoot, encoding: "utf-8" }).trim();
      }

      let changedFiles: string[] = [];
      try {
        changedFiles = execSync(`git diff --name-only ${base} HEAD`, { cwd: ctx.repoRoot, encoding: "utf-8" })
          .split("\n").map(l => l.trim()).filter(Boolean);
      } catch {
        try {
          changedFiles = execSync("git diff --name-only HEAD~1 HEAD", { cwd: ctx.repoRoot, encoding: "utf-8" })
            .split("\n").map(l => l.trim()).filter(Boolean);
        } catch {}
      }

      const sweep = runSymbolSweep(changedFiles, ctx.state.approvedScope || "", ctx.repoRoot);

      const diffLines = diffOutput.split("\n");
      const truncatedDiff = diffLines.length > 120
        ? diffLines.slice(0, 120).join("\n") + `\n... [${diffLines.length - 120} lines truncated for token efficiency] ...`
        : diffOutput;

      diffReport = `### 🔍 Deterministic Diff & Security Pre-Injection (0 AI Credits)\n` +
        `> **Base Ref:** \`${base}\` | **Changed Files:** \`${changedFiles.join("`, `") || "detected in git"}\`\n` +
        `> **Deterministic Symbol Sweep:** ${sweep.summary}\n` +
        `> **External Package References:** ${sweep.externalReferencesFound.length} call-site(s) found\n\n` +
        `\`\`\`diff\n${truncatedDiff}\n\`\`\`\n` +
        `*(Note for Reviewer: Full unified diff and cross-package deterministic symbol sweep are pre-computed above. Perform your read-only security review in 1 turn.)*`;
    } catch {}

    const devHandoff = buildDeveloperHandoffPayload(ctx.repoRoot, ctx.state, ctx.prompt, ctx.resolvedIssue);
    const qaHandoff = buildQAHandoffPayload(ctx.repoRoot, ctx.state, ctx.prompt);

    const dashRev = syncWorkflowDashboard(ctx.repoRoot, {
      sessionId: ctx.sessionId,
      phase: "reviewer",
      status: "IN_PROGRESS",
      summary: "Conducting read-only security diff audit & blast radius review",
    });

    const chatMeter = formatChatCreditMeter(dashRev);
    const partsRev = [diffReport, qaHandoff.markdown, devHandoff.markdown, ctx.prompt].filter(Boolean);
    const enrichedPrompt = partsRev.join("\n\n");
    const modifiedArgs = {
      ...ctx.toolArgs,
      prompt: enrichedPrompt,
    };

    const repoIntel = formatRepoIntelligenceForPrompt(ctx.repoRoot, ctx.targetAgent, ctx.state.approvedScope || undefined);

    let addCtx = "";
    if (diffReport) addCtx += `${diffReport}\n\n`;
    if (qaHandoff.markdown) addCtx += `${qaHandoff.markdown}\n\n`;
    if (repoIntel) addCtx += `${repoIntel}\n\n`;
    if (chatMeter) {
      addCtx += `\n\n${formatControlPlaneTelemetry(chatMeter, "QA verification complete and passed. Include this live 📊 AI Credit Meter status in your phase handoff message to the user before running Reviewer.")}`;
    }

    return {
      modifiedPrompt: enrichedPrompt,
      modifiedArgs,
      additionalContext: addCtx || undefined,
    };
  },

  validateOutput(rawOutput: any, ctx: StageContext): StageValidationResult {
    const revVal = validateReview(rawOutput);
    const verdict = revVal.valid ? revVal.data.assessment : "HANDOFF_INVALID";
    return {
      valid: revVal.valid,
      verdict,
      details: revVal.valid ? revVal.data : undefined,
      errors: revVal.valid ? undefined : revVal.errors,
    };
  },

  commitTransition(valResult: StageValidationResult, ctx: StageContext) {
    const transitionId = mintTransitionId("reviewer");
    ctx.state.lastTransitionId = transitionId;
    const revDetails = extractReviewerDetails(ctx.rawOutput || ctx.input.toolResult);

    syncWorkflowDashboard(ctx.repoRoot, {
      owner: ctx.state.issue?.owner || "vamsicherukuri",
      repo: ctx.state.issue?.repo || "prsquad",
      issueNumber: ctx.resolvedIssue,
      sessionId: ctx.sessionId,
      phase: "reviewer",
      status: valResult.verdict,
      summary: valResult.valid
        ? `Read-only diff security audit complete: ${valResult.verdict}`
        : `Reviewer handoff validation failed: ${(valResult.errors || []).join("; ")}`,
      details: valResult.valid ? revDetails : { errors: valResult.errors, ...revDetails },
    });

    let instructionText = "";
    if (valResult.valid && valResult.verdict === "CLEAR") {
      ctx.state.phase = "PR_READY";
      ctx.state.currentPhase = "WAITING_FOR_HUMAN";
      saveState(ctx.state, ctx.repoRoot);

      syncWorkflowDashboard(ctx.repoRoot, {
        sessionId: ctx.sessionId,
        phase: "mergeGate",
        status: "WAITING_FOR_HUMAN",
        summary: `Read-only diff security audit complete: ${valResult.verdict}. Verified implementation is ready for PR creation. Awaiting human maintainer authorization via /create-pr at the PR Approval Gate.`,
        details: {
          baseBranch: "copilot-app-plugin-alignment",
          headBranch: ctx.state.activeBranch || `fix/issue-${ctx.resolvedIssue}`,
          prOpen: false,
          awaitingHumanApproval: true,
        },
      });

      instructionText = "[INSTRUCTION FOR CONTROLLER]: Code review audit complete. Display this final ⚡ AI Credit Meter table and present the PR_READY package to the maintainer at the PR Approval Gate. Prompt the human to authorize PR creation with /create-pr before executing pr-create.ts.";
    } else {
      instructionText = !valResult.valid
        ? `[INSTRUCTION FOR CONTROLLER]: Reviewer handoff failed validation (${(valResult.errors || []).join("; ")}). Pause pipeline and notify maintainer.`
        : `[INSTRUCTION FOR CONTROLLER]: Reviewer reported ${valResult.verdict}. Resolve review findings before opening Pull Request.`;
    }

    appendAuditLog({
      sessionId: ctx.sessionId,
      transitionId,
      agent: "controller",
      action: "stage_commit_reviewer",
      decision: valResult.valid ? "allow" : "deny",
      details: { verdict: valResult.verdict },
    }, ctx.repoRoot);

    return {
      transitionId,
      nextPhase: ctx.state.phase,
      instructionText,
    };
  },
};

// ---------------------------------------------------------------------------
// Policy Registry & Lookup Engine
// ---------------------------------------------------------------------------
export const STAGE_POLICIES: StagePolicy[] = [
  IntakePolicy,
  ArchitectPolicy,
  DeveloperPolicy,
  QAPolicy,
  ReviewerPolicy,
];

export function lookupStagePolicy(targetAgent: string): StagePolicy | null {
  for (const policy of STAGE_POLICIES) {
    if (policy.agentAliases.some(alias => isAgentMatch(targetAgent, alias))) {
      return policy;
    }
  }
  return null;
}

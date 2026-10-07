/**
 * Deterministic Specialist Handoff Validator (Layer B Guardrail)
 * 
 * Validates structured JSON handoffs from specialists deterministically before
 * workflow state, dashboard records, or routing decisions are made.
 * 
 * Enforces the core PRsquad invariant: "Never infer missing evidence."
 */

export interface ValidationSuccess<T> {
  valid: true;
  data: T;
  rawJson: any;
}

export interface ValidationFailure {
  valid: false;
  errors: string[];
  rawJson?: any;
}

export type HandoffValidation<T> = ValidationSuccess<T> | ValidationFailure;

/**
 * Extracts a JSON object from raw input (string, object, or markdown-wrapped JSON).
 */
export function extractJsonFromOutput(raw: unknown): any | null {
  if (!raw) return null;

  let target = raw;
  if (typeof target === "object" && target !== null) {
    const obj = target as Record<string, any>;
    if (typeof obj.textResultForLlm === "string") {
      target = obj.textResultForLlm;
    } else if (typeof obj.content === "string") {
      target = obj.content;
    } else if (typeof obj.value === "string") {
      target = obj.value;
    } else if (obj.status || obj.verdict || obj.assessment) {
      return obj;
    }
  }

  const text = String(target).trim();

  // 1. Try markdown fenced json block: ```json ... ```
  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/i);
  if (fenceMatch) {
    try {
      return JSON.parse(fenceMatch[1].trim());
    } catch {}
  }

  // 2. Try outermost curly braces: { ... }
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {}
  }

  // 3. Try direct parse
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 1. Triage Handoff Validation
// ---------------------------------------------------------------------------
export type TriageStatus = "READY" | "NOT_READY" | "EMPTY" | "FETCH_FAILED";

export interface TriageHandoff {
  status: TriageStatus;
  clarificationRound?: number;
  issue?: {
    owner?: string;
    repo?: string;
    number?: number;
    title?: string;
  };
  problem?: string | null;
  acceptanceCriteria?: string[];
  declaredScope?: string | null;
  missing?: string[];
  clarifyingQuestion?: string | null;
  fetchError?: string | null;
}

export function validateTriage(output: unknown): HandoffValidation<TriageHandoff> {
  const json = extractJsonFromOutput(output);
  if (!json || typeof json !== "object") {
    return { valid: false, errors: ["Triage output contains no valid JSON object"] };
  }

  const errors: string[] = [];
  const validStatuses: TriageStatus[] = ["READY", "NOT_READY", "EMPTY", "FETCH_FAILED"];
  const status = String(json.status || "").toUpperCase() as TriageStatus;

  if (!validStatuses.includes(status)) {
    errors.push(`Invalid triage status '${json.status}'. Expected one of: ${validStatuses.join(", ")}`);
  }

  if (status === "READY") {
    if (!Array.isArray(json.acceptanceCriteria) || json.acceptanceCriteria.length === 0) {
      errors.push("READY triage requires at least 1 item in 'acceptanceCriteria'");
    }
    if (!json.declaredScope || typeof json.declaredScope !== "string" || !json.declaredScope.trim()) {
      errors.push("READY triage requires non-empty 'declaredScope' path prefix");
    }
  } else if (status === "NOT_READY") {
    if (!Array.isArray(json.missing) || json.missing.length === 0) {
      errors.push("NOT_READY triage requires 'missing' array listing unfulfilled Definition-of-Ready items");
    }
  } else if (status === "FETCH_FAILED") {
    if (!json.fetchError) {
      errors.push("FETCH_FAILED triage requires 'fetchError' explaining the failure");
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors, rawJson: json };
  }

  return {
    valid: true,
    data: {
      status,
      clarificationRound: json.clarificationRound,
      issue: json.issue,
      problem: json.problem,
      acceptanceCriteria: json.acceptanceCriteria || [],
      declaredScope: json.declaredScope || null,
      missing: json.missing || [],
      clarifyingQuestion: json.clarifyingQuestion || null,
      fetchError: json.fetchError || null,
    },
    rawJson: json,
  };
}

// ---------------------------------------------------------------------------
// 2. Architect Handoff Validation
// ---------------------------------------------------------------------------
export type ArchitectStatus =
  | "PLAN_READY"
  | "BLOCKED"
  | "SCOPE_AMENDMENT_CONFIRMED"
  | "SCOPE_AMENDMENT_REJECTED";

export interface ArchitectHandoff {
  status: ArchitectStatus;
  rootCause?: string;
  changes?: Array<{ file: string; type: "ADD" | "MODIFY" | "DELETE"; reason?: string }>;
  proposedScope?: string | null;
  blastRadius?: {
    risk: "Low" | "Medium" | "High";
    affectedOutsideScope: string[];
  };
  validationPlan?: string[];
  plainLanguageSummary?: string;
  blockedReason?: string | null;
  revisedPlan?: string | null;
  reason?: string;
}

export function validateArchitect(output: unknown): HandoffValidation<ArchitectHandoff> {
  const json = extractJsonFromOutput(output);
  if (!json || typeof json !== "object") {
    return { valid: false, errors: ["Architect output contains no valid JSON object"] };
  }

  const errors: string[] = [];
  const validStatuses: ArchitectStatus[] = [
    "PLAN_READY",
    "BLOCKED",
    "SCOPE_AMENDMENT_CONFIRMED",
    "SCOPE_AMENDMENT_REJECTED",
  ];
  const status = String(json.status || "").toUpperCase() as ArchitectStatus;

  if (!validStatuses.includes(status)) {
    errors.push(`Invalid architect status '${json.status}'. Expected one of: ${validStatuses.join(", ")}`);
  }

  if (status === "PLAN_READY") {
    if (!json.proposedScope || typeof json.proposedScope !== "string" || !json.proposedScope.trim()) {
      errors.push("PLAN_READY architect requires non-empty 'proposedScope'");
    }
    if (!Array.isArray(json.changes) || json.changes.length === 0) {
      errors.push("PLAN_READY architect requires non-empty 'changes' specification list");
    }
    if (!json.rootCause || typeof json.rootCause !== "string") {
      errors.push("PLAN_READY architect requires 'rootCause' explanation");
    }
  } else if (status === "BLOCKED") {
    if (!json.blockedReason || typeof json.blockedReason !== "string") {
      errors.push("BLOCKED architect requires 'blockedReason' explanation");
    }
  } else if (status === "SCOPE_AMENDMENT_CONFIRMED") {
    if (!json.proposedScope) {
      errors.push("SCOPE_AMENDMENT_CONFIRMED requires updated 'proposedScope'");
    }
  } else if (status === "SCOPE_AMENDMENT_REJECTED") {
    if (!json.reason) {
      errors.push("SCOPE_AMENDMENT_REJECTED requires 'reason' for rejection");
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors, rawJson: json };
  }

  return {
    valid: true,
    data: {
      status,
      rootCause: json.rootCause,
      changes: json.changes,
      proposedScope: json.proposedScope,
      blastRadius: json.blastRadius,
      validationPlan: json.validationPlan,
      plainLanguageSummary: json.plainLanguageSummary,
      blockedReason: json.blockedReason,
      revisedPlan: json.revisedPlan,
      reason: json.reason,
    },
    rawJson: json,
  };
}

// ---------------------------------------------------------------------------
// 3. Developer Handoff Validation
// ---------------------------------------------------------------------------
export type DeveloperStatus = "IMPLEMENTED" | "BLOCKED" | "SCOPE_AMENDMENT_REQUIRED";

export interface DeveloperHandoff {
  status: DeveloperStatus;
  filesChanged?: string[];
  testsAddedOrChanged?: string[];
  planItemsAddressed?: string[];
  acceptanceCriteriaCoverage?: Array<{ criterion: string; tests: string[] }>;
  validationRun?: Array<{ command: string; result: "PASS" | "FAIL"; notes?: string }>;
  diffReference?: {
    baseRef?: string;
    headRef?: string;
  };
  scopeAmendmentRequest?: {
    requestedPaths: string[];
    reason: string;
    impactIfRejected: string;
  } | null;
  blocker?: {
    type: "PLATFORM" | "INFRASTRUCTURE" | "DEPENDENCY" | "OTHER";
    description: string;
    partialWorkExists: boolean;
  } | null;
  assumptions?: string[];
  residualRisk?: string[];
}

export function validateDeveloper(output: unknown): HandoffValidation<DeveloperHandoff> {
  const json = extractJsonFromOutput(output);
  if (!json || typeof json !== "object") {
    return { valid: false, errors: ["Developer output contains no valid JSON object"] };
  }

  const errors: string[] = [];
  const validStatuses: DeveloperStatus[] = ["IMPLEMENTED", "BLOCKED", "SCOPE_AMENDMENT_REQUIRED"];
  const status = String(json.status || "").toUpperCase() as DeveloperStatus;

  if (!validStatuses.includes(status)) {
    errors.push(`Invalid developer status '${json.status}'. Expected one of: ${validStatuses.join(", ")}`);
  }

  if (status === "IMPLEMENTED") {
    if (!Array.isArray(json.filesChanged) || json.filesChanged.length === 0) {
      errors.push("IMPLEMENTED developer handoff requires non-empty 'filesChanged' list");
    }
    if (!json.diffReference || typeof json.diffReference !== "object") {
      errors.push("IMPLEMENTED developer handoff requires 'diffReference' with baseRef and headRef");
    } else {
      const hasBase = Boolean(json.diffReference.baseRef || json.baseRef);
      const hasHead = Boolean(json.diffReference.headRef || json.headRef || json.commitSha);
      if (!hasBase) {
        errors.push("IMPLEMENTED developer handoff requires 'diffReference.baseRef'");
      }
      if (!hasHead) {
        errors.push("IMPLEMENTED developer handoff requires 'diffReference.headRef' or 'commitSha'");
      }
    }
  } else if (status === "BLOCKED") {
    if (!json.blocker || typeof json.blocker !== "object") {
      errors.push("BLOCKED developer handoff requires 'blocker' object with description and type");
    }
  } else if (status === "SCOPE_AMENDMENT_REQUIRED") {
    if (
      !json.scopeAmendmentRequest ||
      !Array.isArray(json.scopeAmendmentRequest.requestedPaths) ||
      json.scopeAmendmentRequest.requestedPaths.length === 0
    ) {
      errors.push("SCOPE_AMENDMENT_REQUIRED developer handoff requires 'scopeAmendmentRequest' with requestedPaths");
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors, rawJson: json };
  }

  return {
    valid: true,
    data: {
      status,
      filesChanged: json.filesChanged || [],
      testsAddedOrChanged: json.testsAddedOrChanged || [],
      planItemsAddressed: json.planItemsAddressed || [],
      acceptanceCriteriaCoverage: json.acceptanceCriteriaCoverage || [],
      validationRun: json.validationRun || [],
      diffReference: json.diffReference || {},
      scopeAmendmentRequest: json.scopeAmendmentRequest || null,
      blocker: json.blocker || null,
      assumptions: json.assumptions || [],
      residualRisk: json.residualRisk || [],
    },
    rawJson: json,
  };
}

// ---------------------------------------------------------------------------
// 4. QA Handoff Validation
// ---------------------------------------------------------------------------
export type QAVerdict = "PASS" | "FAIL" | "BLOCKED";

export interface QAHandoff {
  verdict: QAVerdict;
  scopeCompliance: "PASS" | "FAIL";
  acceptanceCriteriaResults?: Array<{
    criterion: string;
    result: "PASS" | "FAIL" | "NOT_VERIFIED";
    evidence?: string;
  }>;
  testResults?: Array<{ command: string; result: "PASS" | "FAIL"; notes?: string }>;
  failureClassification?: Array<{
    failure: string;
    classification: "PRE_EXISTING" | "FLAKY" | "GENUINE_FIX_CAUSED" | "INFRASTRUCTURE" | "UNKNOWN";
    evidence?: string;
  }>;
  blockingFindings?: string[];
  notes?: string[];
}

export function validateQA(output: unknown): HandoffValidation<QAHandoff> {
  const json = extractJsonFromOutput(output);
  if (!json || typeof json !== "object") {
    return { valid: false, errors: ["QA output contains no valid JSON object"] };
  }

  const errors: string[] = [];
  const validVerdicts: QAVerdict[] = ["PASS", "FAIL", "BLOCKED"];
  const verdict = String(json.verdict || "").toUpperCase() as QAVerdict;

  if (!validVerdicts.includes(verdict)) {
    errors.push(`Invalid QA verdict '${json.verdict}'. Expected one of: ${validVerdicts.join(", ")}`);
  }

  const validScope = ["PASS", "FAIL"];
  const scopeCompliance = String(json.scopeCompliance || "").toUpperCase() as "PASS" | "FAIL";
  if (!validScope.includes(scopeCompliance)) {
    errors.push(`Invalid QA scopeCompliance '${json.scopeCompliance}'. Expected: PASS or FAIL`);
  }

  if (verdict === "FAIL") {
    const hasFailClassification = Array.isArray(json.failureClassification) && json.failureClassification.length > 0;
    const hasFindings = Array.isArray(json.blockingFindings) && json.blockingFindings.length > 0;
    const hasFailCriteria = Array.isArray(json.acceptanceCriteriaResults) && json.acceptanceCriteriaResults.some((c: any) => c.result === "FAIL");
    if (!hasFailClassification && !hasFindings && !hasFailCriteria && scopeCompliance !== "FAIL") {
      errors.push("QA verdict 'FAIL' requires failureClassification, blockingFindings, or failing acceptance criteria");
    }
  } else if (verdict === "PASS") {
    if (scopeCompliance !== "PASS") {
      errors.push("QA verdict 'PASS' requires scopeCompliance to be 'PASS'");
    }
    if (Array.isArray(json.acceptanceCriteriaResults)) {
      const hasFailingCriteria = json.acceptanceCriteriaResults.some(
        (c: any) => c.result === "FAIL" || c.passed === false || c.result === false
      );
      if (hasFailingCriteria) {
        errors.push("QA verdict 'PASS' is internally contradictory: one or more acceptance criteria reported 'FAIL'");
      }
    }
    if (Array.isArray(json.failureClassification)) {
      const hasGenuineFixFailures = json.failureClassification.some((f: any) => f.classification === "GENUINE_FIX_CAUSED");
      if (hasGenuineFixFailures) {
        errors.push("QA verdict 'PASS' is internally contradictory: failureClassification contains 'GENUINE_FIX_CAUSED'");
      }
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors, rawJson: json };
  }

  return {
    valid: true,
    data: {
      verdict,
      scopeCompliance,
      acceptanceCriteriaResults: json.acceptanceCriteriaResults || [],
      testResults: json.testResults || [],
      failureClassification: json.failureClassification || [],
      blockingFindings: json.blockingFindings || [],
      notes: json.notes || [],
    },
    rawJson: json,
  };
}

// ---------------------------------------------------------------------------
// 5. Reviewer Handoff Validation
// ---------------------------------------------------------------------------
export type ReviewAssessment = "CLEAR" | "CONCERNS";

export interface ReviewHandoff {
  assessment: ReviewAssessment;
  scopeCompliance: "PASS" | "CONCERN";
  riskFlags?: Array<{
    severity: "LOW" | "MEDIUM" | "HIGH";
    finding: string;
    evidence?: string;
  }>;
  qualityNotes?: string[];
  residualRisk?: string[];
  mergeGateSummary?: string;
}

export function validateReview(output: unknown): HandoffValidation<ReviewHandoff> {
  const json = extractJsonFromOutput(output);
  if (!json || typeof json !== "object") {
    return { valid: false, errors: ["Reviewer output contains no valid JSON object"] };
  }

  const errors: string[] = [];
  const validAssessments: ReviewAssessment[] = ["CLEAR", "CONCERNS"];
  const assessment = String(json.assessment || "").toUpperCase() as ReviewAssessment;

  if (!validAssessments.includes(assessment)) {
    errors.push(`Invalid Reviewer assessment '${json.assessment}'. Expected: CLEAR or CONCERNS`);
  }

  const validScope = ["PASS", "CONCERN"];
  const scopeCompliance = String(json.scopeCompliance || "").toUpperCase() as "PASS" | "CONCERN";
  if (!validScope.includes(scopeCompliance)) {
    errors.push(`Invalid Reviewer scopeCompliance '${json.scopeCompliance}'. Expected: PASS or CONCERN`);
  }

  if (assessment === "CONCERNS") {
    if (!Array.isArray(json.riskFlags) || json.riskFlags.length === 0) {
      errors.push("Reviewer assessment 'CONCERNS' requires at least 1 entry in 'riskFlags'");
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors, rawJson: json };
  }

  return {
    valid: true,
    data: {
      assessment,
      scopeCompliance,
      riskFlags: json.riskFlags || [],
      qualityNotes: json.qualityNotes || [],
      residualRisk: json.residualRisk || [],
      mergeGateSummary: json.mergeGateSummary || "",
    },
    rawJson: json,
  };
}

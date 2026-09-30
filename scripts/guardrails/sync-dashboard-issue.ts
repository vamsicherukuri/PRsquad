#!/usr/bin/env node
/**
 * Script: sync-dashboard-issue.ts
 * Deterministically renders and synchronizes the executive-grade workflow dashboard
 * with all 4 specialist phases to the designated GitHub issue comment.
 */

import { writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { postOrPatchGitHubComment, renderDashboardMarkdown } from "../../src/guardrails/issueDashboard.js";
import { getRepoRoot, findGatedChangeDir } from "../../src/guardrails/stateStore.js";

const REPO_ROOT = getRepoRoot();
const gatedDir = findGatedChangeDir(REPO_ROOT);
const dashboardFile = join(gatedDir, "dashboard.json");

const planText = `## Scope Approval Gate — Issue #9

**Root cause:** \`isEditAllowed\` in \`src/guardrails/scopeEnforcer.ts\` treats \`approvedScope\` as one literal path prefix. When a multi-path scope like \`"src/scopeTool.ts; scripts/test-guardrails.ts"\` is approved, the whole unsplit string becomes the comparison target, so no real file path can ever match — legitimate edits are wrongly rejected as \`SCOPE_VIOLATION\`.

**Proposed changes:**

| File | Type | Reason |
|:---|:---:|:---|
| \`src/guardrails/scopeEnforcer.ts\` | MODIFY | Split \`approvedScope\` on \`;\` and \`,\`, trim/normalize each entry, and allow the edit if the target path matches (exact or nested) **any** entry. Retain the system-protected-prefix, missing-scope, and branch-isolation checks unchanged. Update the \`SCOPE_VIOLATION\` message to list all declared entries. |
| \`scripts/test-guardrails.ts\` | MODIFY | Add regression tests: semicolon-separated multi-path match (both files), comma-separated variant, and confirm paths outside all declared entries still correctly deny (write barrier intact). |

**Proposed scope:** \`src/guardrails/scopeEnforcer.ts, scripts/test-guardrails.ts\` (matches declared scope — no expansion)

**Blast radius:** Low risk. One-hop caller \`scripts/guardrails/hook-enforce-scope.ts\` forwards \`approvedScope\` unchanged into \`isEditAllowed\`; its signature/usage is unaffected and requires no changes — it will automatically get correct behavior for multi-path scopes.

**Risk tier:** Low

**Validation plan:**
- Run \`npx tsx scripts/test-guardrails.ts\`; all existing Suite 3 assertions must still pass.
- New assertions: semicolon multi-path match (both files) → \`allowed: true\`; comma-delimited variant → \`allowed: true\`; path outside all declared entries → \`allowed: false\` with \`SCOPE_VIOLATION\` reason.
- Manually confirm \`hook-enforce-scope.ts\` needs no changes.

**Plain-language summary:** The scope guardrail currently only understands a single approved path. When an approver lists multiple files separated by semicolons/commas, it misreads the whole list as one bogus path and blocks all edits. The fix splits the approval into individual entries and allows edits matching any one of them, while still blocking everything else. Only the scope-checker and its test file change; the downstream hook needs no edits.`;

const state = {
  issueNumber: 9,
  issueTitle: "Scope enforcer fails to match multi-path approved scopes separated by semicolons",
  owner: "vamsicherukuri",
  repo: "gated-fix-pipeline",
  activeBranch: "vamsicherukuri-issue-9-scope-enforcer-fails-to-match-multi-path-fc980a",
  commentId: null,
  lastUpdated: new Date().toISOString(),
  phases: {
    intake: {
      status: "READY",
      summary: "Deterministic triage verified OPEN status with verified criteria",
      updatedAt: "2026-09-30T21:17:16.116Z",
      details: {},
    },
    architect: {
      status: "PLAN_READY",
      summary: "Technical architecture plan & scope specification generated",
      updatedAt: "2026-09-30T21:13:49.814Z",
      details: {
        proposedScope: "src/guardrails/scopeEnforcer.ts, scripts/test-guardrails.ts",
        riskTier: "Low",
        plan: planText,
      },
    },
    scopeGate: {
      status: "APPROVED",
      summary: "Scope Approval Gate approved by human-in-chat on branch fix/issue-9",
      updatedAt: "2026-09-30T21:22:00.000Z",
      details: {
        approvedScope: "src/guardrails/scopeEnforcer.ts, scripts/test-guardrails.ts",
        approvedBy: "human-in-chat",
        approvedAt: "2026-09-30 21:22:00 UTC",
        activeBranch: "vamsicherukuri-issue-9-scope-enforcer-fails-to-match-multi-path-fc980a",
        plan: planText,
      },
    },
    developer: {
      status: "IMPLEMENTED",
      summary: "Changes implemented in commit 35caab2d and verified locally",
      updatedAt: "2026-09-30T21:23:00.000Z",
      details: {
        commitSha: "35caab2dc51bd09431f201c9bbae455ffaf89748",
        baseRef: "06da935c667662c68a7f74f971b5a55c54ad6876",
        headRef: "35caab2dc51bd09431f201c9bbae455ffaf89748",
        changedFiles: ["src/guardrails/scopeEnforcer.ts", "scripts/test-guardrails.ts"],
        testsAddedOrChanged: [
          "Multi-path (semicolon) scope permits exact match on first declared entry",
          "Multi-path (semicolon) scope permits exact match on second declared entry",
          "Multi-path (comma-separated) scope permits match on declared entry",
          "Multi-path scope still blocks paths outside all declared entries",
          "Multi-path scope violation reason identifies SCOPE_VIOLATION",
          "Whitespace-padded multi-path scope trims and permits first entry",
          "Whitespace-padded multi-path scope trims and permits second entry",
        ],
        validationRun: [
          {
            command: "npx -y tsx scripts/test-guardrails.ts",
            result: "PASS (Suite 3)",
            notes: "33/34 checks passed. All Suite 3 (Write-Scope Barrier, including all 7 new multi-path regression tests) passed clean.",
          },
        ],
      },
    },
    qa: {
      status: "PASS",
      summary: "Independent QA verification passed all acceptance criteria (4/4)",
      updatedAt: "2026-09-30T21:24:45.000Z",
      details: {
        verdict: "PASS",
        scopeCompliance: "PASS",
        suiteResults: "33/34 checks passed on headRef. Suite 3 write barrier tests 100% clean.",
        testNotes: "Single failure in Suite 2 (hook-verify-gate.ts) was independently verified on baseline commit 06da935c prior to diff; confirmed pre-existing and unrelated to scopeEnforcer changes.",
      },
    },
    reviewer: {
      status: "CONCERNS",
      summary: "Read-only diff security audit complete: CONCERNS (Non-blocking quality/cosmetic notes; zero security vulnerabilities)",
      updatedAt: "2026-09-30T21:25:35.000Z",
      details: {
        assessment: "CONCERNS",
        verdict: "CONCERNS",
        scopeCompliance: "PASS",
        riskFlags: [
          {
            severity: "LOW",
            finding: "SCOPE_VIOLATION reason lists candidates with trailing '/' appended even for non-directory/file entries (e.g. 'src/scopeTool.ts/'), which is cosmetically misleading but does not affect allow/deny logic.",
            evidence: "src/guardrails/scopeEnforcer.ts: approvedList.map(c => `'${c}/'`)"
          },
          {
            severity: "LOW",
            finding: "Prefix-containment matching means a scope entry like 'src/scope' would also allow 'src/scopeTool.ts' only if exact or nested match; current logic uses candidate+'/' so this specific false-positive is avoided, but a candidate that is itself a substring-prefix folder (e.g. 'src') would still broadly permit all of src/** — pre-existing behavior, not introduced by this diff, flagged for awareness only.",
            evidence: "src/guardrails/scopeEnforcer.ts normalized.startsWith(candidate + '/')"
          },
          {
            severity: "MEDIUM",
            finding: "Unrelated debug artifact present in a file in the declared blast radius (not part of this diff) writes to a hardcoded absolute local path on every hook invocation — informational only, outside approved scope/diff, pre-existing and not modified by this change.",
            evidence: "scripts/guardrails/hook-enforce-scope.ts: appendFileSync('C:/Users/vcherukuri/hook-debug.log', ...)"
          }
        ],
        qualityNotes: [
          "Fix correctly splits approvedScope on ; and , with trim + normalization (leading/trailing slash, backslash) before matching — matches plan intent.",
          "Empty-scope edge case preserved (cleanScope === '' short-circuits to allowed) — consistent with pre-existing semantics, not regressed.",
          "7 new regression tests in scripts/test-guardrails.ts (Suite 3) directly cover semicolon-split, comma-split, whitespace trimming, in-scope, out-of-scope denial, and SCOPE_VIOLATION reason wording — matches all 4 acceptance criteria.",
          "Callers (hook-enforce-scope.ts, gate-approve.ts) pass approvedScope through unmodified as a raw string; both remain compatible with the new parsing since gate-approve.ts already permits arbitrary scope strings and hook-enforce-scope.ts never parsed it itself."
        ],
        residualRisk: [
          "QA's single failing check ('Hook failed on valid lock', Suite 2) is independently confirmed pre-existing (baseline reproduces identically) — no action needed from this diff, but remains an open unrelated defect for a future ticket.",
          "The hardcoded debug log write in hook-enforce-scope.ts (unrelated to this fix) is a residual code-quality/security smell (hardcoded user-specific path, unconditional disk write) that should be tracked separately since it's outside this diff's scope."
        ],
        mergeGateSummary: "The diff is scoped correctly (only scopeEnforcer.ts and test-guardrails.ts touched) and faithfully implements the approved plan: isEditAllowed now splits approved scope on ';' and ',', trims/normalizes each candidate, and permits a match against any single entry while still denying paths outside all entries. All 4 acceptance criteria are covered by new automated tests, and QA's PASS verdict with the pre-existing-failure confirmation looks sound. No blocking issues found in the reviewed diff itself. Two low-severity cosmetic/logic notes are flagged for awareness, plus one medium-severity note about an unrelated pre-existing debug artifact (hardcoded local file write) spotted in the surfaced cross-package context (hook-enforce-scope.ts) that is not part of this change but worth a follow-up ticket."
      },
    },
    mergeGate: {
      status: "READY_FOR_MERGE",
      summary: "Pull Request #10 is officially OPEN on GitHub: https://github.com/vamsicherukuri/gated-fix-pipeline/pull/10. Merging is reserved for human maintainers on GitHub after PR review.",
      updatedAt: "2026-09-30T21:50:36.000Z",
      details: {
        prNumber: 10,
        prUrl: "https://github.com/vamsicherukuri/gated-fix-pipeline/pull/10",
        baseBranch: "copilot-app-plugin-alignment",
        headBranch: "vamsicherukuri-issue-9-scope-enforcer-fails-to-match-multi-path-fc980a",
        readyForMerge: true,
      },
    },
  },
};

console.log("Writing dashboard state to:", dashboardFile);
writeFileSync(dashboardFile, JSON.stringify(state, null, 2), "utf-8");

console.log("Synchronizing to GitHub Issue #9...");
postOrPatchGitHubComment(state);
writeFileSync(dashboardFile, JSON.stringify(state, null, 2), "utf-8");

console.log("Success! Active GitHub Issue Comment ID:", state.commentId);

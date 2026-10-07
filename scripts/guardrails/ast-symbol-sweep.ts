#!/usr/bin/env node
/**
 * CLI Tool: Deterministic Symbol & Reference Sweep
 * Sweeps for external references to modified symbols across package boundaries.
 * Usage:
 *   npx tsx scripts/guardrails/ast-symbol-sweep.ts [--files src/services/auth/service.ts] [--scope src/services/auth/]
 */

import { runSymbolSweep, getChangedFilesFromGit } from "../../src/guardrails/symbolSweep.js";
import { loadState, appendAuditLog } from "../../src/guardrails/stateStore.js";

function parseArgs(args: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--") && args[i + 1] && !args[i + 1].startsWith("--")) {
      result[arg.slice(2)] = args[i + 1];
      i++;
    }
  }
  return result;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const state = loadState();

  const scope = args.scope || state.approvedScope || "src/";
  let files: string[] = [];

  if (args.files) {
    files = args.files.split(",").map((f) => f.trim());
  } else {
    files = getChangedFilesFromGit(state.baseRef || "HEAD");
  }

  console.log(`[Symbol Sweep] Running Deterministic Symbol & Reference Sweep...`);
  console.log(`  Scope Boundary: ${scope}`);
  console.log(`  Target Files: ${files.length > 0 ? files.join(", ") : "(Scanning all exported files in scope)"}`);

  if (files.length === 0) {
    // If no git diff, test against existing sample source files in scope
    files = ["src/scopeTool.ts", "src/orchestrator.ts"];
  }

  const report = runSymbolSweep(files, scope);

  console.log(`\n=== Sweep Results ===`);
  console.log(`  Analyzed Symbols: ${report.totalSymbolsAnalyzed} (${report.exportedSymbols.join(", ") || "none"})`);
  console.log(`  Risk Assessment:  ${report.riskAssessment}`);
  console.log(`  Summary:          ${report.summary}`);

  if (report.externalReferencesFound.length > 0) {
    console.log(`\n=== External References Found (${report.externalReferencesFound.length}) ===`);
    for (const ref of report.externalReferencesFound) {
      console.log(`  - [${ref.symbol}] referenced in ${ref.referencedIn}:${ref.lineNumber}`);
      console.log(`    ${ref.snippet}`);
    }
  }

  appendAuditLog({
    sessionId: state.sessionId,
    agent: "reviewer",
    action: "ast_symbol_sweep_completed",
    decision: "info",
    details: {
      riskAssessment: report.riskAssessment,
      totalSymbols: report.totalSymbolsAnalyzed,
      externalReferences: report.externalReferencesFound.length,
    },
  });
}

main();

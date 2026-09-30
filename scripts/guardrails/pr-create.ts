#!/usr/bin/env node
/**
 * CLI Tool: Deterministic Pull Request Creator
 * Executed when human approves at the PR Approval Gate.
 * Pushes the verified feature branch and creates an official GitHub Pull Request.
 */

import { createPullRequest } from "../../src/guardrails/prCreator.js";

async function main() {
  console.log("=======================================================");
  console.log("  GATED CHANGE — DETERMINISTIC PULL REQUEST CREATION");
  console.log("=======================================================");

  const targetDir = process.argv[2] || process.cwd();
  const result = createPullRequest({ preferredDir: targetDir });

  if (result.success) {
    console.log(`\n✅ PULL REQUEST SUCCESSFULLY OPENED!`);
    console.log(`   PR URL: ${result.prUrl}`);
    console.log(`   Branch: ${result.branch}`);
    console.log(`\nℹ️ Note: Merging is strictly reserved for human maintainers on GitHub after PR review.`);
    process.exit(0);
  } else {
    console.error(`\n❌ Failed to create Pull Request:`);
    console.error(`   ${result.error}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal error creating Pull Request:", err);
  process.exit(1);
});

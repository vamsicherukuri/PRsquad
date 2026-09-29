import { postComment, addLabel } from "./ghIssue.js";

/**
 * Posts the outcome of Step 03 (Scope gate). Called with "approved" from the job that only runs
 * once the required-reviewer Environment approval succeeds, and with "rejected" from a follow-up
 * job that runs `if: failure()` on that same job - see implementation-plan.md §5a: a reject here
 * is "send back entirely," no revision pass, since GitHub's native Environment approval is binary.
 */
async function main() {
  const issueNumber = Number(process.argv[2]);
  const outcome = process.argv[3];
  if (!issueNumber || (outcome !== "approved" && outcome !== "rejected")) {
    console.error('Usage: tsx src/actions/scopeGateResult.ts <issue-number> <"approved"|"rejected">');
    process.exit(1);
  }

  if (outcome === "approved") {
    postComment(
      issueNumber,
      "**Scope gate - APPROVED ✅**\n\n" +
        "Steps 04+ (branch, implementation, tests, review, merge) are designed in " +
        "implementation-plan.md but not yet built in this pipeline."
    );
    addLabel(issueNumber, "scope-approved");
  } else {
    postComment(
      issueNumber,
      "**Scope gate - sent back entirely ❌**\n\n" +
        "No revision attempt (binary approval in this workflow) - escalating per implementation-plan.md §5a."
    );
    addLabel(issueNumber, "scope-rejected");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

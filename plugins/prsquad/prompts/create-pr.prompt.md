---
name: create-pr
description: Instructions for the human approver to authorize opening an official GitHub Pull Request at the PR Approval Gate
tools: ["agent"]
---

# PR Approval Gate Authorization

The human approver explicitly authorizes opening the official GitHub Pull Request for the verified implementation.

## Human Approver Action Required:
Pull Request creation must originate from the human maintainer (autonomous agents are strictly prohibited from opening PRs autonomously).

1. Instruct the approver to run the deterministic PR creation command in their terminal:
   `node .gated-change/bin/pr-create.mjs`
2. Once the approver executes this command, report the generated Pull Request URL to the human.
3. State clearly:
   "The Pull Request is officially open on GitHub. Merging is strictly reserved for human maintainers on GitHub after PR review."

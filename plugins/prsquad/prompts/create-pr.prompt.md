---
name: create-pr
description: Instructions for the human approver to authorize opening an official GitHub Pull Request at the PR Approval Gate
tools: ["agent", "powershell", "bash"]
---

# PR Approval Gate Authorization

The human approver explicitly authorizes opening the official GitHub Pull Request for the verified implementation.

## Human Approver Action Required:
Pull Request creation must originate from human authorization (autonomous agents are strictly prohibited from opening PRs autonomously without human confirmation).

1. Confirm human approval in chat (e.g. user typed "Open PR" or invoked `/create-pr`).
2. Execute the deterministic PR creation command directly in your shell tool (`powershell` or `bash`):
   `node .gated-change/bin/pr-create.mjs`
3. Report the generated Pull Request URL to the human.
4. State clearly:
   "The Pull Request is officially open on GitHub. Merging is strictly reserved for human maintainers on GitHub after PR review."

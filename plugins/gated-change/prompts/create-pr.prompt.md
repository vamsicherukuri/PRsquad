---
name: create-pr
description: Authorize opening an official GitHub Pull Request at the PR Approval Gate
tools: ["powershell", "bash", "execute", "terminal", "agent"]
---

# PR Approval Gate Authorization

The human approver explicitly authorizes opening the official GitHub Pull Request for the verified implementation.

## Actions to perform immediately:
1. Run the deterministic PR creation command via powershell:
   `npx -y tsx scripts/guardrails/pr-create.ts`
2. Report the generated Pull Request URL to the human.
3. State clearly:
   "The Pull Request is officially open on GitHub. Merging is strictly reserved for human maintainers on GitHub after PR review."

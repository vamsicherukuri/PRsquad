---
name: approve
description: Approve the proposed technical plan and scope at the Human Scope Gate and authorize implementation
tools: ["powershell", "bash", "execute", "terminal", "agent"]
---

# Human Scope Gate Approval

The human maintainer explicitly authorizes implementation for the proposed technical plan and scope boundary.

## Actions to perform immediately:
1. Run the deterministic Scope Gate approval command via powershell/terminal:
   `npx -y tsx scripts/guardrails/scope-approve.ts`
2. Confirm to the maintainer:
   "Human Scope Gate explicitly APPROVED. Cryptographic approval lock minted on disk."
3. Delegate to `prsquad-dev` (or `gated-change-developer`) to begin implementation strictly bounded to the approved scope.
4. Pass the approved plan, original acceptance criteria, risk tier, and approved scope to the developer.

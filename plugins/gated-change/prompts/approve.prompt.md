---
name: approve
description: Instructions for the human maintainer to approve the proposed technical plan and scope at the Human Scope Gate
tools: ["agent"]
---

# Human Scope Gate Approval

The human maintainer explicitly authorizes implementation for the proposed technical plan and scope boundary.

## Human Maintainer Action Required:
Scope Gate authorization must originate from the human maintainer (autonomous agents are strictly prohibited from minting approval locks).

1. Instruct the maintainer to run the deterministic approval command in their terminal:
   `node .gated-change/bin/gate-approve.mjs`
2. Once the maintainer executes this command, confirm:
   "Human Scope Gate explicitly APPROVED. Deterministic approval lock minted on disk with approval integrity binding."
3. Delegate to `prsquad-dev` to begin implementation strictly bounded to the approved scope.
4. Pass the approved plan, original acceptance criteria, risk tier, and approved scope to the developer.

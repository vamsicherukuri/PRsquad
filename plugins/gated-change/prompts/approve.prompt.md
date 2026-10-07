---
name: approve
description: Approve the proposed technical plan and scope at the Human Scope Gate and authorize implementation
tools: ["powershell", "bash", "execute", "terminal", "agent"]
---

# Human Scope Gate Approval

The human maintainer explicitly authorizes implementation for the proposed technical plan and scope boundary.

## Actions to perform immediately:
1. Run the deterministic Scope Gate approval command via powershell/terminal:
   `node "${PLUGIN_ROOT}/dist/run-hook.mjs" gate-approve`
   (Windows PowerShell: `node "$env:PLUGIN_ROOT/dist/run-hook.mjs" gate-approve`)
2. Confirm to the maintainer:
   "Human Scope Gate explicitly APPROVED. Deterministic approval lock minted on disk with approval integrity binding."
3. Delegate to `prsquad-dev` (or `gated-change-developer`) to begin implementation strictly bounded to the approved scope.
4. Pass the approved plan, original acceptance criteria, risk tier, and approved scope to the developer.

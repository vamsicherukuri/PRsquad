---
name: approve
description: Instructions for the human maintainer to approve the proposed technical plan and scope at the Human Scope Gate
tools: ["agent"]
---

# Human Scope Gate Approval

The human maintainer explicitly authorizes implementation for the proposed technical plan and scope boundary.

## Human Maintainer Action Required:
Scope Gate authorization must originate from the human maintainer (autonomous agents are strictly prohibited from minting approval locks).

1. Confirm scope approval with the maintainer directly in the UI or chat:
   "Do you approve this technical plan and scope to proceed with implementation?"
2. Once the maintainer approves (via the native UI confirmation or replying 'Approve'), the Human Scope Gate authorizes implementation.
3. Delegate to `prsquad-dev` to begin implementation strictly bounded to the approved scope.
4. Pass the approved plan, original acceptance criteria, risk tier, and approved scope to the developer.

---
name: approve
description: Approve the proposed technical plan and scope at the Human Scope Gate and authorize implementation
tools: ["agent"]
---

# Human Scope Gate Approval

The human approver explicitly grants scope approval for the proposed plan.

## Actions to perform immediately:
1. State the updated workflow phase as `DEVELOPING`.
2. Confirm that the Human Scope Gate is APPROVED for the current issue.
3. Delegate to `gated-change-developer` (or `gated-change:gated-change-developer`) with:
   - Header: `[HUMAN_SCOPE_GATE_APPROVED: <approvedScope>]`
   - Fields: `humanApprovalConfirmed: true` and `approvedScope: "<approvedScope>"`
4. Pass the approved plan, original acceptance criteria, risk tier, approved scope, and implementation attempt number.

# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.2.x   | :white_check_mark: |
| < 0.2.0 | :x:                |

---

## Reporting a Vulnerability

We take the security of PRSquad and the deterministic control plane seriously. If you believe you have discovered a vulnerability, bypass, or sandbox escape in any PRSquad component, please report it responsibly.

### How to Report

- **Email**: Report vulnerabilities privately to [vamsicherukuri@github.com](mailto:vamsicherukuri@github.com) or submit a private security advisory via GitHub.
- **Include**:
  - Detailed description of the vulnerability (e.g., bypass in `hook-enforce-scope`, prompt injection escaping `hook-sandbox-bash`, or lock forgery).
  - Reproducible steps or test scripts demonstrating the issue.
  - Potential impact and target environment.

Please **do not** report security vulnerabilities through public GitHub issues.

### Response Time

- You will receive an acknowledgment within **48 hours**.
- We will provide a timeline for triage and remediation.

---

## Security Model & Deterministic Invariants

PRSquad operates under the principle that **probabilistic agents must be bounded by deterministic control planes**:

1. **Cryptographic Approval Lock**:
   - Developer execution is blocked unless `.gated-change/approval.lock` is physically present on disk.
   - Agents are forbidden from minting this lock; only the human maintainer can sign it via `node .gated-change/bin/gate-approve.mjs`.

2. **OS-Level Write Barrier (`hook-enforce-scope`)**:
   - File edits are inspected before disk writes occur.
   - Changes outside the approved scope or targeting protected paths (`.github/`, `.gated-change/`) are deterministically blocked with clean exit code `0`.

3. **Shell Execution Sandboxing (`hook-sandbox-bash`)**:
   - Shell commands executed by agents undergo strict AST and regex inspection.
   - Reviewers have read-only git access (`git diff`, `git status`) and cannot execute code or mutate repository state.
   - Destructive operations, remote pushes, and branch deletions are strictly reserved for human maintainers.

4. **Fail-Closed Gate Design**:
   - If hooks encounter corrupted state or missing prerequisites, they exit with code `1` or `deny`, halting the pipeline rather than allowing unauthorized execution.

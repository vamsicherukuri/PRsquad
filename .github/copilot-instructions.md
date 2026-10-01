# Gated Change Pipeline Repository Instructions

These instructions govern all autonomous and assisted agent workflows in this repository.

## Architectural Boundaries & Pipeline Structure
- **7-Stage Workflow**: All issues must progress linearly through: Intake Triage -> Architect -> Human Scope Gate -> Developer -> QA -> Reviewer -> PR Creator.
- **Strict Human Scope Gate**: Implementation cannot begin without verified human approval recorded in `.gated-change/approval.lock`.
- **System Path Immutability**: Governance and plugin definition files (`.github/`, `plugins/`, `.gated-change/`) are immutable during agent task execution.
- **Cross-Platform Path Hygiene**: Always normalize file paths to POSIX standard (`toPosixRelative`) to guarantee consistency across Windows and POSIX environments.

## TypeScript Coding Standards & Conventions
- **Module Architecture**: Use strict ECMAScript Modules (`import` / `export`) with `.js` extension specifiers for local imports.
- **Static Type Safety**: Maintain strict TypeScript checking with zero unhandled `any` casts.
- **AST Parsing Resilience**: When inspecting AST declarations with TypeScript compiler API or Babel, always guard against anonymous / unnamed expressions (`ExportDefaultDeclaration` without identifier).
- **Execution Defense**: Never use unescaped string interpolation when passing variables to `child_process.exec` or `execSync`; use parameterized commands or strict regex allowlisting.

## Testing & QA Standards
- **Test Runner**: Execute verification suites using `npm run test:guardrails`.
- **Comprehensive Coverage**: Every bug fix or security patch must include dedicated regression tests in `scripts/test-guardrails.ts`.
- **Edge Case Assertions**: Tests must assert both positive paths (valid input succeeds) and negative paths (malformed input or injection attempts fail cleanly with descriptive errors).
- **Baseline Determinism**: Never leave stray git branches or uncommitted files after running test suites.

## Security Review & Policy Compliance
- **Zero Shell Injection**: Enforce strict alphanumeric allowlists on branch names (`^[a-zA-Z0-9/_.-]+$`) and commit messages.
- **OWASP Compliance**: Protect all file access routines against directory traversal attacks (e.g. `../` escapes).
- **Audit Traceability**: All guardrail enforcement events, denials, and approvals must be logged to `.gated-change/` audit logs.
- **Secret Redaction**: Never commit or display raw API tokens, credentials, or sensitive headers in prompt outputs or git history.

# Contributing to PRSquad

Thank you for your interest in contributing to **PRSquad**!

PRSquad is built around a core architectural invariant: **Probabilistic coding agents operating within a deterministic control plane.**

We welcome contributions that improve developer experience, extend specialist capabilities, strengthen deterministic guardrails, or enhance portability.

---

## Code of Conduct

This project and everyone participating in it are governed by the [PRSquad Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code.

---

## Development Workflow

### Prerequisites

- **Node.js**: `>= 20.0.0`
- **npm**: `>= 10.0.0`
- **Git**: `>= 2.40.0`
- **GitHub CLI (`gh`)**: Recommended for live issue and PR workflows

### Setup

1. Fork and clone the repository:
   ```bash
   git clone https://github.com/vamsicherukuri/PRsquad.git
   cd PRsquad
   ```
2. Install dependencies:
   ```bash
   npm install
   ```

---

## Quality & Governance Gates

PRSquad enforces strict deterministic security invariants. All pull requests must pass the full suite of automated verification checks before being merged.

### Run Verification Commands

| Command | Purpose |
|---|---|
| `npm run check:plugin` | Verifies agent schemas, contract routing, frontmatter consistency, and tool permissions |
| `npm run build` | TypeScript typecheck (`tsc --noEmit`) |
| `npm run test:guardrails` | Layer A guardrail tests (approval locks, scope enforcer, bash sandbox, AST symbol sweep) |
| `npm run test:edge-cases` | Bounded loops, clarification bounds, and error recovery |
| `npm run test:security-invariants` | Verification of all 7 machine-readable security invariants |
| `npm run test:portable` | Portability integration test verifying execution in isolated scratch repositories |
| `npm run bundle:hooks` | Bundles hook entrypoints with esbuild into `plugins/gated-change/dist/` |
| `npm run ci` | Runs full clean build, lint, bundle, and invariant suites |

To run the complete verification suite locally:

```bash
npm run ci
```

---

## Guardrail Architecture Invariants

When modifying agent prompts, hooks, or scripts, preserve the following invariants:

1. **Zero Auto-Approval**: Autonomous agents must **never** be capable of self-signing scope locks or initiating pull-request creation.
2. **Deterministic Write Barrier**: Edits must be strictly confined to approved file paths (`isEditAllowed`).
3. **Role-Scoped Sandboxing**: Shell commands must be strictly constrained by agent role (e.g., Reviewer is read-only git; QA cannot push or commit).
4. **Independent QA**: QA must remain separate from Developer implementation and run criteria tests independently.
5. **Bounded Autonomy**: Repair cycles between Developer and QA must remain strictly capped (max 3 attempts).

---

## Submitting Pull Requests

1. Create a feature branch from `master`:
   ```bash
   git checkout -b feature/my-enhancement
   ```
2. Make your changes and ensure `npm run ci` passes cleanly with 100% checks passing.
3. Commit with clear, conventional commit messages:
   ```bash
   git commit -m "feat(guardrails): add branch protection invariant"
   ```
4. Push to your fork and submit a Pull Request to `master`.
5. Maintainers will review your PR and verify all CI checks pass.

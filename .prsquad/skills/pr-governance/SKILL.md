---
name: pr-governance
description: Branch naming sanitization, command injection defense, and PR delivery standards
targets: [prsquad-architect, prsquad-dev, prsquad-qa]
---

# Pull Request Governance & Security Hardening Skill

This repository skill defines strict standards for git branch creation, command execution security, and pull request delivery in the Gated Change Pipeline.

## 1. Branch Naming & Shell Sanitization
- All generated branch names (feature, fix, release) must strictly conform to:
  `^[a-zA-Z0-9/_.-]+$`
- Any branch name containing shell command operators (`;`, `|`, `&`, `$`, `` ` ``, `>`, `<`, `\n`) must be immediately rejected before passing to child processes or external CLI tools (`gh pr create`, `git checkout`).
- If an invalid branch name is detected, throw an `InvalidBranchNameError` or return `{ success: false, error: "INVALID_BRANCH_NAME" }`.

## 2. Protected Branch Invariants
- Direct commits or pushes to `main` or `master` are strictly prohibited.
- Developers and QA tools must operate inside dedicated isolated branches (`fix/issue-<num>` or `prsquad/*`).

## 3. Pull Request Submission Conventions
- PR Titles must follow Conventional Commits format:
  `fix(<scope>): <short description>` or `feat(<scope>): <short description>`
- PR Bodies must clearly list:
  - Link to GitHub Issue (`Fixes #<number>`)
  - Summary of architectural decisions
  - Human Scope Gate confirmation
  - QA verification results

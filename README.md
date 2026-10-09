# PR Squad: Supervised Agentic Workflow

[![GitHub Copilot App Plugin](https://img.shields.io/badge/GitHub%20Copilot%20App-Plugin-6f42c1?logo=githubcopilot&logoColor=white)](https://github.com/vamsicherukuri/PRsquad)
[![Releases](https://img.shields.io/badge/releases-v0.2.8-blue)](https://github.com/vamsicherukuri/PRsquad/releases)
[![Interactive Workflow](https://img.shields.io/badge/🎮%20Interactive%20Workflow-7--Stage%20Pipeline%20%26%20Hooks-8250df?style=flat-square&logo=googlechrome&logoColor=white)](https://vamsicherukuri.github.io/PRsquad/)
[![Automated Tests](https://img.shields.io/badge/tests-331%20passing%20(100%25)-3fb950?style=flat-square&logo=githubactions&logoColor=white)](https://vamsicherukuri.github.io/PRsquad/)


## The Challenge: The Agent Autonomy Dilemma

Agentic coding systems are powerful because LLMs can reason, plan, write code, use tools, and adapt to changing context. But that behavior is inherently probabilistic.

An agent can hallucinate, misinterpret intent, drift from the original objective, lose constraints during long-running workflows, act on stale assumptions, or be influenced by untrusted data and prompt injection embedded in issues, source code, documentation, logs, or tool output.

There is also a fundamental difference between what an agent believes is true and the actual state of the system. A model may believe it is operating within the approved scope, on the correct branch, against validated code, or after a successful test run—but reasoning alone does not prove those conditions are true.

As agent autonomy increases, critical development controls should not depend on the model remembering or correctly interpreting instructions.


> **Use AI for reasoning. Do not rely on AI to enforce the boundaries around its own autonomy.**

### The Solution: Probabilistic Agents, Deterministic Control

PR Squad separates AI reasoning from deterministic workflow control.

Specialized agents perform role-specific work within defined scopes, while the `@prsquad` orchestrator coordinates execution through structured stage handoffs.

An independent deterministic control plane mechanically enforces approved write scopes, role-based command restrictions, protected branch rules, stage ordering, bounded repair loops, evidence integrity, and non-bypassable human approval gates.

This preserves flexibility in how agents solve a problem without giving them authority to bypass the policies governing what they may change and when the workflow may advance.

PR Squad also provides stage-level observability by tracking AI credit and token consumption across specialist agents and rework cycles.

> **Agents reason. The orchestrator coordinates. The control plane enforces. Humans approve. Execution remains observable.**

## ⚡ Quick Setup

1. Open the **GitHub Copilot Desktop App** and click **Customize** in the left sidebar.
2. In the Marketplaces section, add this repository if not already listed:

   ```text
   https://github.com/vamsicherukuri/PRsquad
   ```
3. Click **+ Add** in the top-right corner and select **Install plugin...**.
4. In the dialog, enter the marketplace plugin spec:
   ```text
   prsquad@prsquad-marketplace
   ```
5. Click **Install**.
6. **Restart the GitHub Copilot App** so its backend daemon loads the newly installed agent catalog into memory.


## 🚀 Run Your First Workflow

1. Open your target repository in the **GitHub Copilot Desktop App**.
2. Add a new project or open an existing one, select the GitHub issue you want to work on, and click **New Session**.
3. In the chat prompt bar, open the **Agent Picker** dropdown (the `Default agent` selector next to the model picker) and choose **`prsquad`**.
4. Prompt PR Squad to start on your issue:

```text
Resolve issue
```

PR Squad orchestrates the workflow from a GitHub issue to a review-ready Pull Request, while deterministic hooks enforce governance within each agent's defined scope and permissions:

```text
Issue → Triage → Plan → Human Scope Gate → Implementation → QA → Review → Human PR Gate → Pull Request
```

Specialist agents do **not** directly delegate work to one another. Every specialist returns a structured handoff to `@prsquad`, which validates the result and determines the next allowed action under deterministic policy enforcement.

> 🎮 **Interactive Visualizer & Policy Sandbox:** Walk through all 7 pipeline stages, inspect the 4 Copilot hook engines, and test real-time policy barriers in your browser: **[Open Interactive Workflow](https://vamsicherukuri.github.io/PRsquad/)** *(or open [docs/index.html](docs/index.html) locally)*.

## Architecture at a Glance


`@prsquad` orchestrates the workflow: it routes work to isolated specialist agents, validates their structured handoffs against strict schemas, and selects the next stage. Every specialist reports results back exclusively through the orchestrator, while independent deterministic hooks verify whether each transition is permitted.

![How PRSquad Flows](docs/images/prsquad-flow.png)

4 Deterministic Hook Engines enforcing 6 Specialized Guardrails across the lifecycle.

| # | Hook Interception | Deployed At Which Agent? | Trigger Event |
|:---:|---|---|---|
| 1 | **Deterministic Ingest Hook** | Orchestrator → Intake Agent | `preToolUse` on `agent` (quarantines issue before Intake starts). |
| 2 | **Mechanical Scope Gate Hook** | Orchestrator → Developer Agent | `preToolUse` on `agent` (blocks Developer dispatch if `.approval.lock` is missing). |
| 3 | **Write-Scope Barrier Hook** | Developer Agent | `preToolUse` on `edit_file`, `write_to_file`, `create_file` (blocks out-of-scope edits). |
| 4 | **QA Bash Sandbox Hook** | QA Specialist Agent | `preToolUse` on `bash` / `powershell` (permits test runners, but blocks `git push` & `commits`). |
| 5 | **Reviewer Read-Only Sandbox** | Reviewer Agent | `preToolUse` on `bash` / `powershell` (strictly allowlists `git diff`, blocks `>` redirects). |
| 6 | **State & AI-Credit Telemetry Hook** | Orchestrator Level | `postToolUse` on `agent` (executes whenever *any* specialist finishes and returns). |

Both gates are strictly human-governed. Only a maintainer can authorize the implementation plan at the **Scope Gate** before code can be written, and approve opening the pull request at the **PR Gate** once independent verification is complete. Final code review and merging always remain with humans.

### The Two Layers

![The Two Layers: Probabilistic Coding Agents + Deterministic Control Plane](docs/images/prsquad-two-layers.svg)


**Agents decide how to solve the problem. The control plane decides what they are allowed to do and when they are allowed to proceed.**

### What the Control Plane Enforces

| Control | What PRSquad does |
|---|---|
| **🔒 Human authorization** | Implementation cannot start without an active human-approved scope lock. Pull-request creation is also reserved for explicit human authorization. |
| **🛡 Scope & execution containment** | Agent writes are restricted to approved paths, protected branches are guarded, and shell commands are constrained by specialist role. |
| **🔁 Bounded autonomy** | Developer ↔ QA repair cycles have a fixed retry ceiling rather than allowing uncontrolled autonomous loops. |
| **✅ Independent verification** | QA is separate from the Developer and must verify the issue's acceptance criteria before review can proceed. |
| **🧬 Evidence integrity** | Approved plans, implementation references, QA evidence, review evidence, and current Git HEAD are checked so stale or unverified work cannot silently advance. |
| **⚡ Context & cost observability** | PRSquad uses deterministic precomputation, role-scoped context, repository-aware skills, workflow state, audit records, and Copilot AIU/token telemetry to reduce redundant work and expose resource consumption. |

Core governance guarantees are also represented as machine-readable security invariants and exercised by the repository's CI gate.

---

## Boundaries

- **LLM reasoning remains probabilistic.** Determinism applies to governance and execution boundaries, not to generated plans, code, QA reasoning, or review judgment.
- **Human authority is preserved.** Autonomous agents cannot mint their own scope approval or invoke PR creation on their own.
- **PRSquad stops at pull-request creation.** Final review and merge remain human-maintainer responsibilities.
- **Telemetry depends on runtime availability.** AIU/token reporting uses Copilot session telemetry when that data is available.
- **External-repository portability is still being validated.** The current hook configuration invokes bundled runtime scripts through repository-relative paths.

---

## Reference

<details>
<summary><strong>Agents and responsibilities</strong></summary>

| Agent | Responsibility | Key boundary |
|---|---|---|
| `@prsquad` | Orchestration, validation, routing, human-gate coordination | Does not inspect or modify product code |
| `@prsquad-triage` | Definition-of-Ready evaluation | No repository source access |
| `@prsquad-architect` | Technical plan, scope, blast-radius analysis | Read/search only |
| `@prsquad-dev` | Approved implementation + regression tests | Writes only inside approved scope |
| `@prsquad-qa` | Independent acceptance-criteria and regression validation | No source-code writes |
| `@prsquad-review` | Read-only final risk/security/code review | No fixes, no test execution |

Every specialist returns its result to `@prsquad`; specialists do not directly delegate to each other.

</details>

<details>
<summary><strong>Deterministic hooks</strong></summary>

PRSquad registers deterministic `preToolUse` / `postToolUse` hooks around critical actions:

| Hook | Purpose |
|---|---|
| `hook-intake-ingest` | Fetches and verifies issue context before Triage |
| `hook-verify-gate` | Validates stage ordering, approval locks, handoffs, retry budgets, evidence, and specialist delegation |
| `hook-enforce-scope` | Blocks file writes outside the approved scope |
| `hook-sandbox-bash` | Restricts terminal commands according to agent role |

Policy denials are treated as deliberate control-plane decisions, not transient agent errors.

</details>

<details>
<summary><strong>Security and governance invariants</strong></summary>

The repository defines machine-readable governance contracts covering areas such as:

- fail-closed specialist handoffs,
- strict QA PASS semantics,
- canonical plan-approval hashing,
- foreign-repository and cross-worktree write prevention,
- shell mutation and command-chaining prevention,
- stage-evidence monotonicity,
- non-destructive branch lifecycle,
- current-HEAD verification binding,
- human-only scope and PR authorization,
- hook runtime/timeout integrity,
- cumulative-diff review coverage.

These contracts are exercised by the repository's security-invariant and adversarial test suites.

</details>

<details>
<summary><strong>State, audit, and approval artifacts</strong></summary>

Runtime governance state is persisted under `.gated-change/`, including artifacts such as:

```text
.gated-change/
├── state.json
├── approval.lock
├── audit.jsonl
└── dashboard.json
```

The scope approval lock binds human authorization to the approved workflow state instead of allowing approval to exist only as conversational text.

</details>

<details>
<summary><strong>Repository-aware context and tooling</strong></summary>

PRSquad can detect or configure repository tooling for common ecosystems including:

- npm / Node.js
- Maven
- Gradle
- Pytest
- Cargo
- Go
- .NET

Repository instructions and skills are selected by specialist role and approved scope so agents receive relevant context without loading the full repository guidance into every stage.

</details>

<details>
<summary><strong>Human gates</strong></summary>

### Scope Gate

Implementation cannot begin until the maintainer explicitly authorizes the proposed plan by executing:

```bash
node .gated-change/bin/gate-approve.mjs
```

This creates `.gated-change/approval.lock`, which the control plane verifies before Developer delegation is allowed.

### PR Gate

After QA and Review complete, the maintainer explicitly authorizes pull-request creation by executing:

```bash
node .gated-change/bin/pr-create.mjs
```

PRSquad opens the pull request but never performs the final merge.

</details>

### Official plugin documentation

- [GitHub Copilot plugins](https://docs.github.com/en/copilot/concepts/agents/about-plugins)
- [Customizing the GitHub Copilot app](https://docs.github.com/en/enterprise-cloud@latest/copilot/how-tos/github-copilot-app/customize-github-copilot-app)
- [Agent plugins in VS Code](https://code.visualstudio.com/docs/agent-customization/agent-plugins)

---

## License

See [LICENSE](LICENSE).

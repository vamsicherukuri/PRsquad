# PR Squad: Supervised Agentic Workflow

[![GitHub Copilot App Plugin](https://img.shields.io/badge/GitHub%20Copilot%20App-Plugin-6f42c1?logo=githubcopilot&logoColor=white)](https://github.com/vamsicherukuri/PRsquad)
[![Releases](https://img.shields.io/badge/releases-v0.2.8-blue)](https://github.com/vamsicherukuri/PRsquad/releases)
[![Interactive Workflow](https://img.shields.io/badge/🎮%20Interactive%20Workflow-7--Stage%20Pipeline%20%26%20Hooks-8250df?style=flat-square&logo=googlechrome&logoColor=white)](https://vamsicherukuri.github.io/PRsquad/)
[![Automated Tests](https://img.shields.io/badge/tests-331%20passing%20(100%25)-3fb950?style=flat-square&logo=githubactions&logoColor=white)](https://vamsicherukuri.github.io/PRsquad/)


## The Challenge: Coding Agent Autonomy Dilemma

Agentic coding systems are powerful because LLMs can reason, plan, write code, use tools, and adapt to changing context. But that behavior is inherently probabilistic.

An agent can hallucinate, misinterpret intent, drift from the original objective, lose constraints during long running workflows, act on stale assumptions, or be influenced by untrusted data and prompt injection embedded in issues, source code, documentation, logs, or tool output.

There is also a fundamental difference between what an agent believes is true and the actual state of the system. A model may believe it is operating within the approved scope, on the correct branch, against validated code, or after a successful test run but reasoning alone does not prove those conditions are true.

As agent autonomy increases, critical development controls should not depend on the model remembering or correctly interpreting instructions.


> **Use AI for reasoning. Do not rely on AI to enforce the boundaries around its own autonomy.**

### The Solution: Probabilistic Agents, Deterministic Control

PR Squad separates AI reasoning from deterministic workflow control.

Specialized agents perform role specific work within defined scopes, while the `@prsquad` orchestrator coordinates execution through structured stage handoffs.

An independent deterministic control plane mechanically enforces approved write scopes, role-based command restrictions, protected branch rules, stage ordering, bounded repair loops, evidence integrity, and non-bypassable human approval gates.

This preserves flexibility in how agents solve a problem without giving them authority to bypass the policies governing what they may change and when the workflow may advance.

PR Squad also provides stage level observability by tracking AI credit and token consumption across specialist agents and rework cycles.

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

Specialist agents do **not** directly delegate work to one another. Every specialist returns a structured handoff to orchestrator, which validates the result and determines the next allowed action under deterministic policy enforcement.

> 🎮 **Interactive Visualizer & Policy Sandbox:** Walk through all 7 pipeline stages, inspect the 4 Copilot hook engines, and test real-time policy barriers in your browser: **[Open Interactive Workflow](https://vamsicherukuri.github.io/PRsquad/)** *(or open [docs/index.html](docs/index.html) locally)*.

## Architecture at a Glance

![How PRSquad Flows](docs/images/prsquad-flow.png)

### The Two Layers

![The Two Layers: Probabilistic Coding Agents + Deterministic Control Plane](docs/images/prsquad-two-layers.svg)

4 Deterministic Hook Engines enforcing 6 Specialized Guardrails across the lifecycle.

### ⚡ Hook Interception Matrix

| # | Hook Interception | Deployed At Which Agent? | Trigger Event |
|:---:|---|---|---|
| 1 | **Deterministic Ingest Hook** | Orchestrator → Intake Agent | `preToolUse` on `agent` (quarantines issue before Intake starts). |
| 2 | **Mechanical Scope Gate Hook** | Orchestrator → Developer Agent | `preToolUse` on `agent` (blocks Developer dispatch if `.approval.lock` is missing). |
| 3 | **Write-Scope Barrier Hook** | Developer Agent | `preToolUse` on `edit_file`, `write_to_file`, `create_file` (blocks out-of-scope edits). |
| 4 | **QA Bash Sandbox Hook** | QA Specialist Agent | `preToolUse` on `bash` / `powershell` (permits test runners, but blocks `git push` & `commits`). |
| 5 | **Reviewer Read-Only Sandbox** | Reviewer Agent | `preToolUse` on `bash` / `powershell` (strictly allowlists `git diff`, blocks `>` redirects). |
| 6 | **State & AI-Credit Telemetry Hook** | Orchestrator Level | `postToolUse` on `agent` (executes whenever *any* specialist finishes and returns). |

Only a human can authorize the implementation plan at the **Scope Gate** before code can be written, and approve opening the pull request at the **PR Gate** once independent verification is complete. Final code review and merging always remain with humans.

### 🛡️ What the Control Plane Enforces

| Control | What PRSquad does |
|---|---|
| **🔒 Human authorization** | Implementation cannot start without an active human-approved scope lock. Pull-request creation is also reserved for explicit human authorization. |
| **🛡 Scope & execution containment** | Agent writes are restricted to approved paths, protected branches are guarded, and shell commands are constrained by specialist role. |
| **🔁 Bounded autonomy** | Developer ↔ QA repair cycles have a fixed retry ceiling rather than allowing uncontrolled autonomous loops. |
| **✅ Independent verification** | QA is separate from the Developer and must verify the issue's acceptance criteria before review can proceed. |
| **🧬 Evidence integrity** | Approved plans, implementation references, QA evidence, review evidence, and current Git HEAD are checked so stale or unverified work cannot silently advance. |
| **⚡ Context & cost observability** | PRSquad uses deterministic precomputation, role-scoped context, repository-aware skills, workflow state, audit records, and Copilot AIU/token telemetry to reduce redundant work and expose resource consumption. |

---

## 📊 Stage-Level Observability & Live Visual Canvas

PR Squad provides enterprise-grade execution transparency so autonomous multi-agent workflows never become unobservable black boxes.

### ⚡ Real-Time AI Credit & Token Telemetry

On every specialist handoff, the control plane intercepts execution via `postToolUse` hooks to record ground-truth Copilot session telemetry into `.gated-change/dashboard.json` and `.gated-change/audit.jsonl`.

- **Per-Stage Cost Breakdown**: Quantifies exact AI credit consumption (Copilot AIUs), prompt tokens, completion tokens, and prompt cache hit rates for each phase: Triage, Architecture, Implementation, Independent QA, and Security Review.
- **In-Chat ⚡ AI Credit Meter**: Surfaces a live Markdown telemetry table directly in GitHub Copilot chat, displaying accumulated resource consumption and remaining retry budgets (e.g., Attempt 1/3).
- **Rework Loop Cost Accounting**: Directly tracks the exact cost of Developer ↔ QA repair iterations, preventing runaway token loops and providing visibility into regression fixes.

### 🎨 PR Squad Live Visual Canvas

Users can open the **PR Squad Live Visual Canvas** to pictographically view the real-time workflow status and inspect stage details:

👉 **[Open Live Visual Canvas](https://vamsicherukuri.github.io/PRsquad/)** *(or open [docs/index.html](docs/index.html) locally)*

- **Pictographic 7-Stage Stepper**: Visually follows the pipeline from Issue Intake to PR Creation, color-coding active, completed, and human-gated stages.
- **Stage Execution Storyboard**: Click any stage to inspect the active agent's role, injected repository skills, sliced instructions, and exact token overhead.
- **Deterministic Checkpoint Cards**: Pictographically reviews Allow (✓) and Block (⛔) decisions recorded by the 4 mechanical hook engines (`hook-intake-ingest`, `hook-verify-gate`, `hook-enforce-scope`, `hook-sandbox-bash`).
- **Interactive Policy Sandbox**: Directly test and simulate write-scope barriers, shell command allowlists, cryptographic approval locks, and anti-stale commit bindings in real time.

---

## License

See [LICENSE](LICENSE).

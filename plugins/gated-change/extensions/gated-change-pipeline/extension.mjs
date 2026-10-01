import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createCanvas, joinSession } from "@github/copilot-sdk/extension";

const servers = new Map();

function findDashboardJson() {
	const candidates = [
		resolve(process.cwd(), ".gated-change", "dashboard.json"),
		resolve(process.cwd(), "..", ".gated-change", "dashboard.json"),
		resolve("C:/Users/vcherukuri/factory/sample repos/copilot-worktrees/gated-fix-pipeline/vamsicherukuri-issue-11-scoped-read-tool-fails-to-match-multi-pa-6375d8/.gated-change/dashboard.json"),
		resolve("C:/Users/vcherukuri/factory/sample repos/gated-fix-pipeline/.gated-change/dashboard.json"),
		resolve("C:/Users/vcherukuri/OneDrive - Microsoft/Documents/GitHub Copilot App Enterprise Challenge/gated-fix-pipeline/.gated-change/dashboard.json")
	];
	for (const p of candidates) {
		if (existsSync(p)) {
			try {
				return JSON.parse(readFileSync(p, "utf-8"));
			} catch (_) {}
		}
	}
	return null;
}

function findAuditJsonl() {
	const candidates = [
		resolve(process.cwd(), ".gated-change", "audit.jsonl"),
		resolve(process.cwd(), "..", ".gated-change", "audit.jsonl"),
		resolve("C:/Users/vcherukuri/factory/sample repos/copilot-worktrees/gated-fix-pipeline/vamsicherukuri-issue-11-scoped-read-tool-fails-to-match-multi-pa-6375d8/.gated-change/audit.jsonl"),
		resolve("C:/Users/vcherukuri/factory/sample repos/gated-fix-pipeline/.gated-change/audit.jsonl"),
		resolve("C:/Users/vcherukuri/OneDrive - Microsoft/Documents/GitHub Copilot App Enterprise Challenge/gated-fix-pipeline/.gated-change/audit.jsonl")
	];
	for (const p of candidates) {
		if (existsSync(p)) {
			try {
				const lines = readFileSync(p, "utf-8").trim().split("\n").filter(Boolean);
				return lines.slice(-30).map(l => JSON.parse(l)).reverse();
			} catch (_) {}
		}
	}
	return [];
}

function renderHtml() {
	return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Gated Fix Pipeline</title>
  <style>
    :root {
      --bg: #0d1117;
      --card-bg: #161b22;
      --card-bg-hover: #1c2128;
      --border: #30363d;
      --border-muted: #21262d;
      --text: #f0f6fc;
      --text-muted: #8b949e;
      --green-bg: rgba(46, 160, 67, 0.12);
      --green-border: rgba(46, 160, 67, 0.4);
      --green-text: #3fb950;
      --blue-bg: rgba(56, 139, 253, 0.15);
      --blue-border: #1f6feb;
      --blue-text: #58a6ff;
      --amber-bg: rgba(210, 153, 34, 0.15);
      --amber-border: #9e5b00;
      --amber-text: #f0883e;
      --purple-bg: rgba(163, 113, 247, 0.15);
      --purple-border: rgba(163, 113, 247, 0.4);
      --purple-text: #d2a8ff;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    
    body {
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      padding: 12px;
      user-select: none;
      height: 100vh;
      display: flex;
      flex-direction: column;
      gap: 10px;
      overflow-y: auto;
    }

    .container {
      container-type: inline-size;
      display: flex;
      flex-direction: column;
      gap: 10px;
      flex: 1;
    }

    /* Header Bar */
    .header {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 8px 12px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 8px;
    }

    .header-left {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .pulse-dot {
      position: relative;
      width: 10px;
      height: 10px;
    }

    .pulse-dot span {
      position: absolute;
      width: 100%;
      height: 100%;
      border-radius: 50%;
      background: #3fb950;
    }

    .pulse-dot .ping {
      animation: ping 1.8s cubic-bezier(0, 0, 0.2, 1) infinite;
      opacity: 0.75;
    }

    @keyframes ping {
      75%, 100% { transform: scale(2.2); opacity: 0; }
    }

    .title {
      font-size: 13px;
      font-weight: 700;
      color: var(--text);
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .badge-issue {
      background: rgba(56, 139, 253, 0.12);
      color: var(--blue-text);
      border: 1px solid rgba(56, 139, 253, 0.3);
      padding: 1px 7px;
      border-radius: 12px;
      font-size: 11px;
      font-family: ui-monospace, SFMono-Regular, monospace;
      font-weight: 600;
    }

    .meta-metrics {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 11px;
      font-family: ui-monospace, SFMono-Regular, monospace;
      color: var(--text-muted);
    }

    .credit-meter {
      background: rgba(56, 139, 253, 0.15);
      border: 1px solid rgba(56, 139, 253, 0.4);
      color: var(--blue-text);
      padding: 2px 7px;
      border-radius: 6px;
      font-weight: 600;
    }

    /* 7-Stage Pipeline Grid */
    .pipeline-grid {
      display: grid;
      grid-template-columns: repeat(7, 1fr);
      gap: 6px;
      width: 100%;
    }

    @container (max-width: 680px) {
      .pipeline-grid {
        grid-template-columns: repeat(4, 1fr);
      }
    }

    @container (max-width: 420px) {
      .pipeline-grid {
        grid-template-columns: repeat(2, 1fr);
      }
    }

    .stage-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 7px 9px;
      min-height: 68px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      cursor: pointer;
      transition: all 0.2s ease-in-out;
      position: relative;
    }

    .stage-card:hover {
      background: var(--card-bg-hover);
      border-color: var(--text-muted);
    }

    .stage-card.selected {
      ring: 2px solid var(--blue-border);
      box-shadow: 0 0 0 2px var(--blue-border);
    }

    .stage-card-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 10px;
      font-family: ui-monospace, SFMono-Regular, monospace;
      font-weight: 700;
      color: var(--text-muted);
    }

    .hook-tag {
      font-size: 9px;
      padding: 1px 4px;
      border-radius: 4px;
      font-family: ui-monospace, monospace;
      font-weight: 600;
      background: var(--purple-bg);
      color: var(--purple-text);
      border: 1px solid var(--purple-border);
      display: inline-flex;
      align-items: center;
      gap: 2px;
    }

    .stage-name {
      font-size: 11px;
      font-weight: 600;
      color: var(--text);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      margin: 2px 0;
    }

    .stage-metric {
      font-size: 10.5px;
      font-family: ui-monospace, SFMono-Regular, monospace;
      font-weight: 500;
      color: var(--text-muted);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    /* Status Variants */
    .stage-card.done {
      background: var(--green-bg);
      border-color: var(--green-border);
    }
    .stage-card.done .stage-card-top {
      color: var(--green-text);
    }
    .stage-card.done .stage-metric {
      color: var(--green-text);
      font-weight: 600;
    }

    .stage-card.gate-approved {
      background: var(--amber-bg);
      border-color: var(--amber-border);
    }
    .stage-card.gate-approved .stage-card-top,
    .stage-card.gate-approved .stage-metric {
      color: var(--amber-text);
      font-weight: 600;
    }

    .stage-card.active {
      background: var(--blue-bg);
      border-color: var(--blue-border);
      box-shadow: 0 0 10px rgba(56, 139, 253, 0.25);
      animation: pulse 1.8s infinite;
    }
    .stage-card.active .stage-card-top,
    .stage-card.active .stage-metric {
      color: var(--blue-text);
      font-weight: 700;
    }

    .stage-card.pending {
      opacity: 0.65;
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.85; }
    }

    /* Tabs Bar for Details / Hooks */
    .section-tabs {
      display: flex;
      gap: 6px;
      border-bottom: 1px solid var(--border);
      padding-bottom: 4px;
    }

    .tab-btn {
      background: transparent;
      border: none;
      color: var(--text-muted);
      font-size: 11px;
      font-weight: 600;
      padding: 4px 10px;
      border-radius: 6px;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 6px;
      font-family: ui-monospace, SFMono-Regular, monospace;
      transition: all 0.2s;
    }

    .tab-btn:hover {
      color: var(--text);
      background: var(--border-muted);
    }

    .tab-btn.active {
      color: var(--text);
      background: var(--card-bg);
      border: 1px solid var(--border);
    }

    .badge-count {
      background: var(--purple-bg);
      color: var(--purple-text);
      border: 1px solid var(--purple-border);
      padding: 0 5px;
      border-radius: 10px;
      font-size: 10px;
    }

    /* Details Panel */
    .content-area {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 8px;
      overflow-y: auto;
    }

    .panel-box {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 10px 12px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    /* Live Hook Stream View */
    .hook-event-list {
      display: flex;
      flex-direction: column;
      gap: 6px;
      max-height: 220px;
      overflow-y: auto;
    }

    .hook-event-item {
      background: rgba(110, 118, 129, 0.08);
      border: 1px solid var(--border-muted);
      border-radius: 6px;
      padding: 6px 10px;
      display: flex;
      align-items: flex-start;
      gap: 8px;
      font-size: 11px;
      line-height: 1.4;
      animation: fadeIn 0.3s ease;
    }

    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(-3px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .hook-decision-icon {
      font-weight: 700;
      flex-shrink: 0;
      margin-top: 1px;
    }
    .hook-decision-icon.allow { color: var(--green-text); }
    .hook-decision-icon.deny { color: #f85149; }

    .hook-event-body {
      flex: 1;
      overflow: hidden;
    }

    .hook-event-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
      margin-bottom: 2px;
    }

    .hook-name {
      font-family: ui-monospace, SFMono-Regular, monospace;
      font-weight: 600;
      color: var(--purple-text);
      font-size: 10.5px;
    }

    .hook-time {
      font-family: ui-monospace, monospace;
      font-size: 10px;
      color: var(--text-muted);
    }

    .hook-action-desc {
      font-family: ui-monospace, SFMono-Regular, monospace;
      font-size: 11px;
      color: #c9d1d9;
      word-break: break-all;
    }

    .hook-action-desc code {
      color: var(--blue-text);
      background: rgba(110, 118, 129, 0.2);
      padding: 1px 4px;
      border-radius: 3px;
    }

    /* Details Content */
    .details-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: 6px;
      margin-top: 4px;
    }

    .stat-pill {
      background: rgba(110, 118, 129, 0.1);
      border: 1px solid var(--border-muted);
      border-radius: 6px;
      padding: 6px 8px;
    }

    .stat-label {
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-muted);
      margin-bottom: 2px;
    }

    .stat-val {
      font-size: 11.5px;
      font-weight: 600;
      color: var(--text);
      font-family: ui-monospace, monospace;
    }
  </style>
</head>
<body>
  <div class="container">
    <!-- Header -->
    <div class="header">
      <div class="header-left">
        <div class="pulse-dot">
          <span class="ping"></span>
          <span></span>
        </div>
        <div class="title">
          <span>Gated Fix Pipeline</span>
          <span class="badge-issue" id="issue-tag">Issue #11</span>
        </div>
      </div>
      <div class="meta-metrics">
        <div class="credit-meter" id="total-credits">⚡ 19.30 AIU</div>
        <span id="turns-metric">6 turns</span>
        <span id="duration-metric">38.7s</span>
      </div>
    </div>

    <!-- 7 Stage Cards with Guardrail Hook Indicators -->
    <div class="pipeline-grid" id="pipeline-nodes">
      <!-- 1. Intake -->
      <div class="stage-card done" id="stage-0" onclick="selectStage(0)">
        <div class="stage-card-top">
          <span>1</span>
          <span class="hook-tag">🛡️ Ingress</span>
        </div>
        <div class="stage-name">Intake</div>
        <div class="stage-metric" id="metric-0">1.24 AIU</div>
      </div>

      <!-- 2. Architect -->
      <div class="stage-card done" id="stage-1" onclick="selectStage(1)">
        <div class="stage-card-top">
          <span>2</span>
          <span class="hook-tag">🛡️ ReadScope</span>
        </div>
        <div class="stage-name">Architect</div>
        <div class="stage-metric" id="metric-1">6.71 AIU</div>
      </div>

      <!-- 3. Scope Gate -->
      <div class="stage-card gate-approved" id="stage-2" onclick="selectStage(2)">
        <div class="stage-card-top">
          <span>3</span>
          <span class="hook-tag" style="background:var(--amber-bg); color:var(--amber-text); border-color:var(--amber-border);">🛡️ VerifyGate</span>
        </div>
        <div class="stage-name">Scope Gate</div>
        <div class="stage-metric" id="metric-2">APPROVED</div>
      </div>

      <!-- 4. Developer -->
      <div class="stage-card active selected" id="stage-3" onclick="selectStage(3)">
        <div class="stage-card-top">
          <span>4</span>
          <span class="hook-tag" style="background:var(--blue-bg); color:var(--blue-text); border-color:var(--blue-border);">🛡️ EnforceScope</span>
        </div>
        <div class="stage-name">Developer</div>
        <div class="stage-metric" id="metric-3">Active...</div>
      </div>

      <!-- 5. QA -->
      <div class="stage-card pending" id="stage-4" onclick="selectStage(4)">
        <div class="stage-card-top">
          <span>5</span>
          <span class="hook-tag">🛡️ Sandbox</span>
        </div>
        <div class="stage-name">QA Test</div>
        <div class="stage-metric" id="metric-4">Queued</div>
      </div>

      <!-- 6. Reviewer -->
      <div class="stage-card pending" id="stage-5" onclick="selectStage(5)">
        <div class="stage-card-top">
          <span>6</span>
          <span class="hook-tag">🛡️ ReadOnly</span>
        </div>
        <div class="stage-name">Reviewer</div>
        <div class="stage-metric" id="metric-5">Queued</div>
      </div>

      <!-- 7. PR Gate -->
      <div class="stage-card pending" id="stage-6" onclick="selectStage(6)">
        <div class="stage-card-top">
          <span>7</span>
          <span class="hook-tag">🛡️ PRGate</span>
        </div>
        <div class="stage-name">PR Gate</div>
        <div class="stage-metric" id="metric-6">Queued</div>
      </div>
    </div>

    <!-- Section Tabs: Stage Details vs Live Guardrail Hook Feed -->
    <div class="section-tabs">
      <button class="tab-btn active" id="tab-btn-details" onclick="switchView('details')">
        Stage Details
      </button>
      <button class="tab-btn" id="tab-btn-hooks" onclick="switchView('hooks')">
        🛡️ Live Guardrail Hooks <span class="badge-count" id="hook-count-badge">0</span>
      </button>
    </div>

    <!-- Content Area -->
    <div class="content-area">
      <!-- View 1: Stage Details -->
      <div class="panel-box" id="view-details">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <span style="font-size:11px; font-family:ui-monospace, monospace; text-transform:uppercase; color:var(--text-muted); font-weight:600;" id="detail-title">
            Stage 4: Developer Agent Execution
          </span>
          <span id="detail-badge" style="font-size:11px; padding:2px 8px; border-radius:12px; font-weight:600; font-family:ui-monospace; background:var(--blue-bg); color:var(--blue-text); border:1px solid var(--blue-border);">
            ACTIVE
          </span>
        </div>
        <div style="font-size:12px; line-height:1.5; color:#c9d1d9;" id="detail-content">
          Developer is applying fixes strictly within approved boundaries in an isolated git worktree. Guardrail write barrier active.
        </div>
        <div class="details-grid" id="detail-stats">
          <div class="stat-pill">
            <div class="stat-label">Active Guardrail Hook</div>
            <div class="stat-val" style="color:var(--purple-text);">hook-enforce-scope</div>
          </div>
          <div class="stat-pill">
            <div class="stat-label">Approved Scope</div>
            <div class="stat-val" style="font-size:11px;">src/scopeTool.ts, scripts/test-guardrails.ts</div>
          </div>
          <div class="stat-pill">
            <div class="stat-label">Retry Loop Budget</div>
            <div class="stat-val">Attempt 1 of 3</div>
          </div>
        </div>
      </div>

      <!-- View 2: Live Hook Events Stream -->
      <div class="panel-box" id="view-hooks" style="display:none;">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <span style="font-size:11px; font-family:ui-monospace, monospace; text-transform:uppercase; color:var(--purple-text); font-weight:600;">
            🛡️ Deterministic Hook Invocations (audit.jsonl)
          </span>
          <span style="font-size:10.5px; color:var(--text-muted); font-family:ui-monospace;">Zero-bypass runtime barriers</span>
        </div>
        <div class="hook-event-list" id="hook-events-container">
          <!-- Populated dynamically from /api/audit -->
        </div>
      </div>
    </div>
  </div>

  <script>
    let currentSelected = 3;
    let activeTab = 'details';
    let cachedAudit = [];

    const stageMeta = [
      {
        title: "Stage 1: Intake Triage",
        badge: "READY",
        badgeStyle: "background:var(--green-bg); color:var(--green-text); border:1px solid var(--green-border);",
        content: "Validates issue completeness, reproducibility, and acceptance criteria before engaging model planning.",
        stats: [
          { label: "Active Hook", val: "preToolUse: ingress_check" },
          { label: "Credits Burned", val: "1.24 AIU" },
          { label: "Triage Cost", val: "Cheap fast check" }
        ]
      },
      {
        title: "Stage 2: Architect Agent Plan",
        badge: "PLAN_READY",
        badgeStyle: "background:var(--green-bg); color:var(--green-text); border:1px solid var(--green-border);",
        content: "Investigated root cause using read-scoped tools. Produced surgical modification plan with strict blast-radius bounding.",
        stats: [
          { label: "Active Hook", val: "makeScopedReadTool" },
          { label: "Credits Burned", val: "6.71 AIU" },
          { label: "Risk Tier", val: "Low" }
        ]
      },
      {
        title: "Stage 3: PM Scope Approval Gate",
        badge: "APPROVED",
        badgeStyle: "background:var(--amber-bg); color:var(--amber-text); border:1px solid var(--amber-border);",
        content: "Hard human-in-the-loop review barrier. Developer execution remained blocked until PM confirmed proposed boundaries in chat.",
        stats: [
          { label: "Active Hook", val: "hook-verify-gate" },
          { label: "Decision", val: "PASSED (approval.lock valid)" },
          { label: "Tokens Used", val: "0 (Deterministic Gate)" }
        ]
      },
      {
        title: "Stage 4: Developer Implementation",
        badge: "RUNNING",
        badgeStyle: "background:var(--blue-bg); color:var(--blue-text); border:1px solid var(--blue-border);",
        content: "Developer is applying fixes strictly within approved boundaries in an isolated git worktree. Guardrail write barrier active.",
        stats: [
          { label: "Active Hook", val: "hook-enforce-scope" },
          { label: "Write Barrier", val: "Active (Hard Block)" },
          { label: "Attempt", val: "1 of 3 (Bounded)" }
        ]
      },
      {
        title: "Stage 5: QA Independent Verification",
        badge: "QUEUED",
        badgeStyle: "background:#21262d; color:#8b949e; border:1px solid #30363d;",
        content: "Fresh independent QA agent runs automated test suites and regression scenarios. Will reject if any test fails.",
        stats: [
          { label: "Active Hook", val: "hook-sandbox-bash" },
          { label: "Sandbox Policy", val: "Tests allowed, Git Push blocked" },
          { label: "Max Retries", val: "3 loops before escalation" }
        ]
      },
      {
        title: "Stage 6: Reviewer Risk & Security Audit",
        badge: "QUEUED",
        badgeStyle: "background:#21262d; color:#8b949e; border:1px solid #30363d;",
        content: "Read-only security & diff inspection agent reviews git changes for regressions, secrets, and policy compliance.",
        stats: [
          { label: "Active Hook", val: "hook-sandbox-bash (Read-Only)" },
          { label: "Scope Verification", val: "Diff within declared boundary" },
          { label: "AST Checks", val: "Symbol reference integrity" }
        ]
      },
      {
        title: "Stage 7: Human Pull Request Gate",
        badge: "QUEUED",
        badgeStyle: "background:#21262d; color:#8b949e; border:1px solid #30363d;",
        content: "Final human-in-the-loop review. Draft PR generated with evidence package and AI credit receipt. Requires human merge approval.",
        stats: [
          { label: "Active Hook", val: "hook-verify-gate: PR review" },
          { label: "Merge Policy", val: "Human Approval Required" },
          { label: "Audit Trail", val: "Tamper-evident audit.jsonl" }
        ]
      }
    ];

    function selectStage(index) {
      currentSelected = index;
      for (let i = 0; i < 7; i++) {
        const el = document.getElementById('stage-' + i);
        if (el) {
          if (i === index) el.classList.add('selected');
          else el.classList.remove('selected');
        }
      }
      renderDetail(index);
    }

    function renderDetail(index) {
      const d = stageMeta[index];
      if (!d) return;
      document.getElementById('detail-title').textContent = d.title;
      const bEl = document.getElementById('detail-badge');
      bEl.textContent = d.badge;
      bEl.style.cssText = d.badgeStyle;
      document.getElementById('detail-content').innerHTML = d.content;

      const statsEl = document.getElementById('detail-stats');
      statsEl.innerHTML = d.stats.map(s => \`
        <div class="stat-pill">
          <div class="stat-label">\${s.label}</div>
          <div class="stat-val">\${s.val}</div>
        </div>
      \`).join('');
    }

    function switchView(tab) {
      activeTab = tab;
      document.getElementById('tab-btn-details').className = 'tab-btn' + (tab === 'details' ? ' active' : '');
      document.getElementById('tab-btn-hooks').className = 'tab-btn' + (tab === 'hooks' ? ' active' : '');
      document.getElementById('view-details').style.display = tab === 'details' ? 'flex' : 'none';
      document.getElementById('view-hooks').style.display = tab === 'hooks' ? 'flex' : 'none';
    }

    function formatTime(iso) {
      try {
        const d = new Date(iso);
        return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      } catch (_) {
        return '';
      }
    }

    function renderHookList(events) {
      const container = document.getElementById('hook-events-container');
      if (!events || events.length === 0) {
        container.innerHTML = '<div style="font-size:11px; color:var(--text-muted); padding:8px;">No hook events recorded yet.</div>';
        return;
      }

      document.getElementById('hook-count-badge').textContent = events.length;

      container.innerHTML = events.slice(0, 15).map(e => {
        const isAllow = e.decision === 'allow';
        const icon = isAllow ? '✓' : '⛔';
        const iconClass = isAllow ? 'allow' : 'deny';
        
        let desc = e.action || '';
        if (e.action === 'write_allowed_in_scope') {
          desc = \`Allowed edit to <code>\${e.details?.path || ''}</code>\`;
        } else if (e.action === 'command_allowed') {
          const cmd = String(e.details?.command || '').split(';').pop().trim();
          desc = \`Permitted command: <code>\${cmd.slice(0, 55)}\${cmd.length > 55 ? '...' : ''}</code>\`;
        } else if (e.action === 'human_scope_gate_auto_signed_from_chat') {
          desc = \`Verified PM Scope Approval lock: <code>\${e.details?.approvedScope || ''}</code>\`;
        } else if (e.action === 'scope_violation_blocked') {
          desc = \`Blocked unauthorized edit to <code>\${e.details?.path || ''}</code> (Smart nudge sent)\`;
        } else if (e.action === 'disallowed_command_blocked') {
          desc = \`Blocked dangerous command: <code>\${e.details?.command || ''}</code>\`;
        }

        const hookName = e.tool === 'edit' ? 'hook-enforce-scope' 
          : (e.tool === 'agent' ? 'hook-verify-gate' : 'hook-sandbox-bash');

        return \`
          <div class="hook-event-item">
            <span class="hook-decision-icon \${iconClass}">\${icon}</span>
            <div class="hook-event-body">
              <div class="hook-event-top">
                <span class="hook-name">\${hookName}</span>
                <span class="hook-time">\${formatTime(e.timestamp)}</span>
              </div>
              <div class="hook-action-desc">\${desc}</div>
            </div>
          </div>
        \`;
      }).join('');
    }

    async function poll() {
      try {
        const [dashRes, auditRes] = await Promise.all([
          fetch('/api/dashboard'),
          fetch('/api/audit')
        ]);

        if (dashRes.ok) {
          const dash = await dashRes.json();
          updateDashboard(dash);
        }
        if (auditRes.ok) {
          const audit = await auditRes.json();
          cachedAudit = audit;
          renderHookList(audit);
        }
      } catch (_) {}
    }

    function updateDashboard(data) {
      if (!data) return;
      if (data.issueNumber) {
        document.getElementById('issue-tag').textContent = 'Issue #' + data.issueNumber;
      }
      if (data.telemetry) {
        document.getElementById('total-credits').textContent = '⚡ ' + (data.telemetry.actualAiCredits || 0).toFixed(2) + ' AIU';
        document.getElementById('turns-metric').textContent = (data.telemetry.turns || 0) + ' turns';
        if (data.telemetry.durationSeconds) {
          document.getElementById('duration-metric').textContent = data.telemetry.durationSeconds + 's';
        }
      }
      if (data.phases) {
        if (data.phases.intake) {
          document.getElementById('metric-0').textContent = (data.phases.intake.credits || 1.24).toFixed(2) + ' AIU';
        }
        if (data.phases.architect) {
          document.getElementById('metric-1').textContent = (data.phases.architect.credits || 6.71).toFixed(2) + ' AIU';
        }
        if (data.phases.developer) {
          if (data.phases.developer.credits) {
            document.getElementById('metric-3').textContent = data.phases.developer.credits.toFixed(2) + ' AIU';
          }
        }
      }
    }

    renderDetail(currentSelected);
    setInterval(poll, 1500);
    poll();
  </script>
</body>
</html>
`;
}

async function startServer(instanceId, session) {
	const server = createServer(async (req, res) => {
		res.setHeader("Access-Control-Allow-Origin", "*");
		if (req.url === "/api/dashboard" || req.url === "/dashboard.json") {
			const data = findDashboardJson();
			res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
			res.end(JSON.stringify(data || {}));
			return;
		}
		if (req.url === "/api/audit" || req.url === "/audit.json") {
			const data = findAuditJsonl();
			res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
			res.end(JSON.stringify(data || []));
			return;
		}
		res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
		res.end(renderHtml());
	});

	await new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => resolve());
	});

	const port = server.address().port;
	return {
		server,
		url: `http://127.0.0.1:${port}/`
	};
}

let session;
session = await joinSession({
	canvases: [
		createCanvas({
			id: "gated-change-pipeline",
			displayName: "Gated Change Pipeline",
			description: "Visual 7-stage interactive pipeline for gated-change workflow.",
			open: async (ctx) => {
				let entry = servers.get(ctx.instanceId);
				if (!entry) {
					entry = await startServer(ctx.instanceId, session);
					servers.set(ctx.instanceId, entry);
				}
				return {
					title: "Gated Change Pipeline",
					url: entry.url
				};
			},
			onClose: async (ctx) => {
				const entry = servers.get(ctx.instanceId);
				if (entry) {
					servers.delete(ctx.instanceId);
					await new Promise((resolve) => entry.server.close(() => resolve()));
				}
			}
		})
	]
});

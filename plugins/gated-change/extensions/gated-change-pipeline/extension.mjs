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

function renderHtml() {
	return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Gated Change Pipeline</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: #0d1117;
      color: #c9d1d9;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      padding: 16px 20px;
      user-select: none;
      height: 100vh;
      display: flex;
      flex-direction: column;
    }
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 16px;
      padding-bottom: 12px;
      border-bottom: 1px solid #30363d;
    }
    .title {
      font-size: 14px;
      font-weight: 700;
      color: #f0f6fc;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: #238636;
      box-shadow: 0 0 8px #2ea043;
      animation: pulse 2s infinite;
    }
    .meta {
      font-size: 12px;
      font-family: ui-monospace, SFMono-Regular, monospace;
      color: #8b949e;
      display: flex;
      gap: 14px;
    }
    .credit-badge {
      background: #1f6feb22;
      color: #58a6ff;
      border: 1px solid #1f6feb55;
      padding: 2px 8px;
      border-radius: 12px;
      font-weight: 600;
    }
    .pipeline {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      width: 100%;
      margin-bottom: 16px;
    }
    .node {
      flex: 1;
      height: 64px;
      border-radius: 8px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-align: center;
      font-size: 11px;
      font-weight: 600;
      padding: 6px;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      border: 1px solid transparent;
    }
    .arrow {
      color: #484f58;
      font-size: 14px;
      flex-shrink: 0;
    }
    /* Status Styles */
    .done {
      background: #0e4429;
      color: #3fb950;
      border-color: #238636;
      box-shadow: 0 0 10px rgba(46, 160, 67, 0.2);
    }
    .gate-done {
      background: #4d2d00;
      color: #f0883e;
      border-color: #9e5b00;
      box-shadow: 0 0 10px rgba(210, 153, 34, 0.2);
    }
    .gate-active {
      background: #6e3c00;
      color: #ffc680;
      border-color: #d29922;
      animation: pulse 1.5s infinite;
    }
    .active {
      background: #0c2d6b;
      color: #58a6ff;
      border-color: #1f6feb;
      box-shadow: 0 0 12px rgba(56, 139, 253, 0.35);
      animation: pulse 1.5s infinite;
    }
    .pending {
      background: #161b22;
      color: #6e7681;
      border-color: #30363d;
    }
    .node-title {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 4px;
    }
    .node-sub {
      font-size: 10px;
      font-weight: normal;
      opacity: 0.85;
    }
    .details-card {
      flex: 1;
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 8px;
      padding: 14px 16px;
      overflow-y: auto;
      font-size: 12px;
      line-height: 1.5;
    }
    .details-title {
      font-size: 12px;
      font-weight: 700;
      color: #f0f6fc;
      margin-bottom: 8px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.88; transform: scale(0.99); }
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="title">
      <span class="dot"></span>
      <span id="issue-header">Issue Pipeline</span>
    </div>
    <div class="meta">
      <span class="credit-badge" id="credits-badge">⚡ 0.00 AI Credits</span>
      <span id="turns-badge">Turns: 0</span>
      <span id="time-badge">38.7s</span>
    </div>
  </div>

  <div class="pipeline">
    <div class="node rect done" id="node-intake">
      <div class="node-title">1. Intake</div>
      <div class="node-sub" id="sub-intake">Extract Spec</div>
    </div>
    <div class="arrow">➜</div>
    <div class="node rect done" id="node-architect">
      <div class="node-title">2. Architect</div>
      <div class="node-sub" id="sub-architect">Design Scope</div>
    </div>
    <div class="arrow">➜</div>
    <div class="node hex gate-active" id="node-scope">
      <div class="node-title">3. Scope Gate</div>
      <div class="node-sub" id="sub-scope">Human Approval</div>
    </div>
    <div class="arrow">➜</div>
    <div class="node rect pending" id="node-developer">
      <div class="node-title">4. Developer</div>
      <div class="node-sub" id="sub-developer">Bounded Code</div>
    </div>
    <div class="arrow">➜</div>
    <div class="node rect pending" id="node-qa">
      <div class="node-title">5. QA</div>
      <div class="node-sub" id="sub-qa">Verify Gates</div>
    </div>
    <div class="arrow">➜</div>
    <div class="node rect pending" id="node-reviewer">
      <div class="node-title">6. Reviewer</div>
      <div class="node-sub" id="sub-reviewer">Diff Security</div>
    </div>
    <div class="arrow">➜</div>
    <div class="node hex pending" id="node-pr">
      <div class="node-title">7. PR Gate</div>
      <div class="node-sub" id="sub-pr">Merge Lock</div>
    </div>
  </div>

  <div class="details-card">
    <div class="details-title" id="details-header">Active Stage Details</div>
    <div id="details-body">
      <strong>Awaiting Scope Approval</strong>: Human-in-the-loop review required before code changes begin.<br>
      • Proposed Scope: <code style="color:#58a6ff; background:#0d1117; padding:2px 6px; border-radius:4px;">src/scopeTool.ts, scripts/test-guardrails.ts</code><br>
      • Risk Assessment: <span style="color:#3fb950; font-weight:600;">Low</span><br>
      • Controller status: Active and waiting for approval in session chat.
    </div>
  </div>

  <script>
    async function poll() {
      try {
        const res = await fetch('/api/dashboard');
        if (res.ok) {
          const data = await res.json();
          update(data);
        }
      } catch (err) {}
    }

    function update(data) {
      if (!data) return;
      if (data.issueNumber) {
        document.getElementById('issue-header').textContent = 'Issue #' + data.issueNumber + ': ' + (data.issueTitle || '');
      }
      if (data.telemetry) {
        document.getElementById('credits-badge').textContent = '⚡ ' + (data.telemetry.actualAiCredits || 0).toFixed(2) + ' AI Credits';
        document.getElementById('turns-badge').textContent = 'Turns: ' + (data.telemetry.turns || 0);
        if (data.telemetry.durationSeconds) {
          document.getElementById('time-badge').textContent = data.telemetry.durationSeconds + 's';
        }
      }
      if (data.phases) {
        if (data.phases.intake) {
          const el = document.getElementById('node-intake');
          el.className = 'node rect done';
          document.getElementById('sub-intake').textContent = (data.phases.intake.credits || 0) + ' credits';
        }
        if (data.phases.architect) {
          const el = document.getElementById('node-architect');
          el.className = 'node rect done';
          document.getElementById('sub-architect').textContent = (data.phases.architect.credits || 0) + ' credits';
        }
        if (data.phases.developer) {
          const el = document.getElementById('node-developer');
          if (data.phases.developer.status === 'ACTIVE') {
            el.className = 'node rect active';
          } else if (data.phases.developer.status === 'DONE') {
            el.className = 'node rect done';
          }
        }
      }
    }

    setInterval(poll, 1500);
    poll();
  </script>
</body>
</html>`;
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

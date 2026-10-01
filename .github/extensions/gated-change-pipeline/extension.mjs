import { createServer } from "node:http";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { createCanvas, joinSession } from "@github/copilot-sdk/extension";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const servers = new Map();
const userHome = homedir();

// In-memory caches to eliminate disk and stat syscall churn on every poll
let cachedWorktreeDir = null;
let lastWorktreeScan = 0;
const WORKTREE_TTL_MS = 3500;

let cachedDashboard = { path: null, mtime: 0, data: null };
let cachedAudit = { path: null, mtime: 0, data: [] };

function getLatestWorktreeDir() {
	const now = Date.now();
	if (cachedWorktreeDir !== null && (now - lastWorktreeScan < WORKTREE_TTL_MS)) {
		return cachedWorktreeDir;
	}
	lastWorktreeScan = now;

	const candidates = [
		join(userHome, "factory", "sample repos", "copilot-worktrees", "gated-fix-pipeline"),
		join(userHome, "copilot-worktrees", "gated-fix-pipeline"),
		resolve(process.cwd(), "..", "copilot-worktrees", "gated-fix-pipeline")
	];

	for (const base of candidates) {
		if (existsSync(base)) {
			try {
				const entries = readdirSync(base, { withFileTypes: true })
					.filter(d => d.isDirectory() && (d.name.startsWith("vamsicherukuri-issue-") || d.name.includes("issue-")))
					.map(d => ({
						path: join(base, d.name),
						time: statSync(join(base, d.name)).mtimeMs
					}))
					.sort((a, b) => b.time - a.time);
				if (entries.length > 0) {
					cachedWorktreeDir = entries[0].path;
					return cachedWorktreeDir;
				}
			} catch (_) {}
		}
	}
	cachedWorktreeDir = null;
	return null;
}

function findDashboardJson() {
	const latestWorktree = getLatestWorktreeDir();
	const candidates = [
		latestWorktree ? join(latestWorktree, ".gated-change", "dashboard.json") : null,
		resolve(process.cwd(), ".gated-change", "dashboard.json"),
		resolve(process.cwd(), "..", ".gated-change", "dashboard.json"),
		join(userHome, "factory", "sample repos", "gated-fix-pipeline", ".gated-change", "dashboard.json"),
		join(userHome, "OneDrive - Microsoft", "Documents", "GitHub Copilot App Enterprise Challenge", "gated-fix-pipeline", ".gated-change", "dashboard.json"),
		join(userHome, "Documents", "GitHub Copilot App Enterprise Challenge", "gated-fix-pipeline", ".gated-change", "dashboard.json")
	].filter(Boolean);

	for (const p of candidates) {
		if (existsSync(p)) {
			try {
				const stat = statSync(p);
				if (cachedDashboard.path === p && cachedDashboard.mtime === stat.mtimeMs && cachedDashboard.data) {
					return cachedDashboard.data;
				}
				const data = JSON.parse(readFileSync(p, "utf-8"));
				cachedDashboard = { path: p, mtime: stat.mtimeMs, data };
				return data;
			} catch (_) {}
		}
	}
	return null;
}

function findAuditJsonl() {
	const latestWorktree = getLatestWorktreeDir();
	const candidates = [
		latestWorktree ? join(latestWorktree, ".gated-change", "audit.jsonl") : null,
		resolve(process.cwd(), ".gated-change", "audit.jsonl"),
		resolve(process.cwd(), "..", ".gated-change", "audit.jsonl"),
		join(userHome, "factory", "sample repos", "gated-fix-pipeline", ".gated-change", "audit.jsonl"),
		join(userHome, "OneDrive - Microsoft", "Documents", "GitHub Copilot App Enterprise Challenge", "gated-fix-pipeline", ".gated-change", "audit.jsonl"),
		join(userHome, "Documents", "GitHub Copilot App Enterprise Challenge", "gated-fix-pipeline", ".gated-change", "audit.jsonl")
	].filter(Boolean);

	for (const p of candidates) {
		if (existsSync(p)) {
			try {
				const stat = statSync(p);
				if (cachedAudit.path === p && cachedAudit.mtime === stat.mtimeMs && cachedAudit.data) {
					return cachedAudit.data;
				}
				const lines = readFileSync(p, "utf-8").trim().split("\n").filter(Boolean);
				const data = lines.slice(-40).map(l => JSON.parse(l)).reverse();
				cachedAudit = { path: p, mtime: stat.mtimeMs, data };
				return data;
			} catch (_) {}
		}
	}
	return [];
}

function getHtmlContent() {
	const candidates = [
		resolve(__dirname, "canvas.html"),
		resolve(process.cwd(), ".github", "extensions", "gated-change-pipeline", "canvas.html"),
		join(userHome, "OneDrive - Microsoft", "Documents", "GitHub Copilot App Enterprise Challenge", "gated-fix-pipeline", ".github", "extensions", "gated-change-pipeline", "canvas.html"),
		join(userHome, "factory", "sample repos", "copilot-worktrees", "gated-fix-pipeline", "vamsicherukuri-issue-11-scoped-read-tool-fails-to-match-multi-pa-6375d8", ".github", "extensions", "gated-change-pipeline", "canvas.html")
	];
	for (const p of candidates) {
		if (existsSync(p)) {
			try {
				return readFileSync(p, "utf-8");
			} catch (_) {}
		}
	}
	return "<h3>Gated Change Pipeline: Canvas interface loading...</h3>";
}

async function startServer(instanceId, session) {
	const server = createServer(async (req, res) => {
		res.setHeader("Access-Control-Allow-Origin", "*");
		res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");

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
		res.end(getHtmlContent());
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
			actions: [
				{
					name: "get_pipeline_status",
					description: "Returns the current stage, active telemetry, and review status of the gated-change pipeline.",
					handler: async () => {
						const dash = findDashboardJson();
						return {
							success: true,
							issueNumber: dash?.issueNumber,
							telemetry: dash?.telemetry,
							phases: dash?.phases
						};
					}
				}
			],
			open: async (ctx) => {
				let entry = servers.get(ctx.instanceId);
				if (!entry) {
					entry = await startServer(ctx.instanceId, session);
					servers.set(ctx.instanceId, entry);
				}
				return {
					title: "Gated Change Pipeline",
					url: entry.url,
					statusText: "Deterministic Governance Active"
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

#!/usr/bin/env node
/**
 * Lightweight local HTTP server for Gated Change Visualizer
 * Serves pipeline-visualizer.html and live dashboard.json for Copilot App's Browser panel.
 * Zero external dependencies.
 */

import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { getRepoRoot } from "../../src/guardrails/stateStore.js";

const PORT = 54321;
const repoRoot = getRepoRoot(process.cwd());
const visualizerPath = join(repoRoot, ".gated-change", "pipeline-visualizer.html");
const dashboardPath = join(repoRoot, ".gated-change", "dashboard.json");

const server = createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");

  if (req.url === "/" || req.url === "/index.html") {
    if (existsSync(visualizerPath)) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(readFileSync(visualizerPath, "utf-8"));
    } else {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Visualizer HTML not found. Run workflow to initialize.");
    }
    return;
  }

  if (req.url?.startsWith("/dashboard.json")) {
    if (existsSync(dashboardPath)) {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(readFileSync(dashboardPath, "utf-8"));
    } else {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ issueNumber: 11, phases: {} }));
    }
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not Found");
});

server.on("error", (err: any) => {
  if (err.code === "EADDRINUSE") {
    // Already running on this port, safe to exit cleanly
    process.exit(0);
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`⚡ Gated Change Visualizer Server running at http://localhost:${PORT}`);
});

import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createCanvas, joinSession } from "@github/copilot-sdk/extension";

const PORT = 54321;
const repoRoot = process.cwd();
const visualizerPath = resolve(repoRoot, ".gated-change", "pipeline-visualizer.html");
const dashboardPath = resolve(repoRoot, ".gated-change", "dashboard.json");

let serverInstance = null;

function ensureServer() {
  if (serverInstance) return Promise.resolve(PORT);
  return new Promise((res) => {
    const s = createServer((req, resHttp) => {
      resHttp.setHeader("Access-Control-Allow-Origin", "*");
      resHttp.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");

      if (req.url === "/" || req.url === "/index.html") {
        if (existsSync(visualizerPath)) {
          resHttp.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          resHttp.end(readFileSync(visualizerPath, "utf-8"));
        } else {
          resHttp.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          resHttp.end("<h3>Gated Change Pipeline: Awaiting workflow initialization</h3>");
        }
        return;
      }

      if (req.url?.startsWith("/dashboard.json")) {
        if (existsSync(dashboardPath)) {
          resHttp.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          resHttp.end(readFileSync(dashboardPath, "utf-8"));
        } else {
          resHttp.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          resHttp.end(JSON.stringify({ issueNumber: 11, phases: {} }));
        }
        return;
      }

      resHttp.writeHead(404);
      resHttp.end("Not Found");
    });

    s.on("error", () => {
      // If port is already in use by existing daemon, reuse it
      res(PORT);
    });

    s.listen(PORT, "127.0.0.1", () => {
      serverInstance = s;
      res(PORT);
    });
  });
}

const pipelineCanvas = createCanvas({
  id: "gated-change-pipeline",
  displayName: "Gated Change Pipeline",
  description: "Live visual stage tracker and AI credit telemetry for the active issue.",
  open: async (_ctx) => {
    await ensureServer();
    return {
      title: "Gated Change Pipeline",
      url: `http://127.0.0.1:${PORT}`,
    };
  },
  onClose: async () => {},
});

try {
  await joinSession({
    canvases: [pipelineCanvas],
  });
} catch {
  // Graceful fallback when executed outside Copilot session IPC
}

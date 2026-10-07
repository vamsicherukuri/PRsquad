#!/usr/bin/env node
import { existsSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const action = process.argv[2] || "hook-verify-gate";

// Fail-safe self-registration & Human CLI provisioning:
// When .gated-change exists in the active workspace, provision .gated-change/bin/
// with standalone gate-approve.mjs and pr-create.mjs for frictionless terminal execution
try {
  const stateDir = resolve(process.cwd(), ".gated-change");
  if (existsSync(stateDir)) {
    const pluginRoot = resolve(__dirname, "..");
    writeFileSync(join(stateDir, "plugin-root.txt"), pluginRoot, "utf-8");

    const binDir = join(stateDir, "bin");
    if (!existsSync(binDir)) {
      mkdirSync(binDir, { recursive: true });
    }
    const gateApproveSrc = resolve(__dirname, "gate-approve.mjs");
    if (existsSync(gateApproveSrc)) {
      copyFileSync(gateApproveSrc, join(binDir, "gate-approve.mjs"));
    }
    const prCreateSrc = resolve(__dirname, "pr-create.mjs");
    if (existsSync(prCreateSrc)) {
      copyFileSync(prCreateSrc, join(binDir, "pr-create.mjs"));
    }
  }
} catch {}

const candidates = [
  resolve(__dirname, `${action}.mjs`),
  resolve(process.cwd(), "plugins/gated-change/dist", `${action}.mjs`),
  resolve(process.cwd(), "dist", `${action}.mjs`),
];

const target = candidates.find((p) => existsSync(p));
if (!target) {
  process.stderr.write(`[PRSquad Hook Error] Could not resolve hook '${action}'\n`);
  process.exit(1);
}

// Rewire process.argv so the target script sees its expected arguments
process.argv = [process.argv[0], target, ...process.argv.slice(3)];

await import(`file://${target.replace(/\\/g, "/")}`);

/**
 * Static consistency checker for the gated-change plugin. Runs no model calls - it only parses
 * the shipped .agent.md/SKILL.md/plugin.json files and checks structural invariants that have
 * already caused real drift bugs in this repo (e.g. a status enum added to one agent's schema
 * but never routed in the Controller, or a paraphrase in SKILL.md going stale).
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import matter from "gray-matter";

const ROOT = process.cwd();
const AGENTS_DIR = join(ROOT, "plugins/prsquad/com.github.copilot/agents");
const SKILL_FILE = join(ROOT, "plugins/prsquad/skills/prsquad/SKILL.md");
const PLUGIN_JSON = join(ROOT, "plugins/prsquad/plugin.json");
const MARKETPLACE_JSON = join(ROOT, ".github/plugin/marketplace.json");
const CONTROLLER_NAME = "prsquad";

interface CheckResult {
  ok: boolean;
  message: string;
}

const results: CheckResult[] = [];

function check(ok: boolean, message: string): void {
  results.push({ ok, message });
}

function loadAgentFile(name: string) {
  const path = join(AGENTS_DIR, `${name}.agent.md`);
  const raw = readFileSync(path, "utf-8");
  const { data, content } = matter(raw);
  return { path, data, content };
}

/** Pulls every status/verdict/assessment enum literal out of a specialist's documented JSON schema(s). */
function extractStatusEnumValues(content: string): string[] {
  const values = new Set<string>();
  const regex = /"(?:status|verdict|assessment)":\s*"([A-Z_|]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(content))) {
    for (const v of m[1].split("|")) {
      if (v) values.add(v);
    }
  }
  return [...values];
}

const agentFiles = readdirSync(AGENTS_DIR).filter((f) => f.endsWith(".agent.md"));
const agentNames = agentFiles.map((f) => f.replace(/\.agent\.md$/, ""));

check(agentFiles.length > 0, `Found ${agentFiles.length} agent files in ${AGENTS_DIR}`);

for (const name of agentNames) {
  const { data } = loadAgentFile(name);
  for (const field of ["name", "description", "target", "tools", "user-invocable"]) {
    check(field in data, `${name}: frontmatter has "${field}"`);
  }
  check(Array.isArray(data.tools), `${name}: "tools" is an array`);
  if (name !== CONTROLLER_NAME) {
    check(data["user-invocable"] === false, `${name}: user-invocable is false (specialist, not user-facing)`);
    check(!("agents" in data), `${name}: has no agents: allow-list (only the Controller may delegate)`);
  }
}

if (!agentNames.includes(CONTROLLER_NAME)) {
  check(false, `Controller file "${CONTROLLER_NAME}.agent.md" not found`);
} else {
  const { data, content } = loadAgentFile(CONTROLLER_NAME);

  check(data["user-invocable"] === true, "Controller: user-invocable is true");

  const listedAgents: string[] = data.agents ?? [];
  check(listedAgents.length > 0, "Controller has a non-empty agents: allow-list");
  for (const agentName of listedAgents) {
    check(
      agentNames.includes(agentName),
      `Controller's agents: list references "${agentName}", which exists as a file`
    );
  }
  for (const name of agentNames) {
    if (name === CONTROLLER_NAME) continue;
    check(
      listedAgents.includes(name),
      `Specialist "${name}" is reachable via Controller's agents: allow-list`
    );
  }

  const tools: string[] = data.tools ?? [];
  check(
    !tools.includes("read") && !tools.includes("search"),
    "Controller's tools: frontmatter excludes read/search (orchestration-only, per its own instructions)"
  );

  for (const name of agentNames) {
    if (name === CONTROLLER_NAME) continue;
    const { content: specialistContent } = loadAgentFile(name);
    const statuses = extractStatusEnumValues(specialistContent);
    for (const status of statuses) {
      check(
        content.includes(`\`${status}\``),
        `Controller routes "${status}" (from ${name}'s schema)`
      );
    }
  }
}

const skillContent = readFileSync(SKILL_FILE, "utf-8");
check(
  !/```json/.test(skillContent),
  "SKILL.md contains no embedded JSON schema blocks (avoids duplicating agent contracts)"
);

const pluginJson = JSON.parse(readFileSync(PLUGIN_JSON, "utf-8"));
const marketplaceJson = JSON.parse(readFileSync(MARKETPLACE_JSON, "utf-8"));
check(
  pluginJson.version === marketplaceJson.metadata.version &&
    pluginJson.version === marketplaceJson.plugins[0].version,
  `plugin.json (${pluginJson.version}) matches marketplace.json (${marketplaceJson.metadata.version} / ${marketplaceJson.plugins[0].version})`
);

const failed = results.filter((r) => !r.ok);
for (const r of results) {
  console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.message}`);
}
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
if (failed.length > 0) {
  process.exit(1);
}

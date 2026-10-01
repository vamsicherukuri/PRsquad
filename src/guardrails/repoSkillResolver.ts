/**
 * Repository Skill & Instruction Slicer
 * Dynamically resolves folder-proximity skills and slices monolithic copilot-instructions.md
 * strictly by specialist agent role, avoiding context bloat and token exhaustion.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { isAgentMatch } from "./stateStore.js";

/**
 * Lightweight, zero-dependency Markdown frontmatter parser.
 * Eliminates external CJS dynamic require issues in bundled ESM hooks.
 */
export function parseFrontmatter(raw: string): { data: Record<string, any>; content: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    return { data: {}, content: raw };
  }
  const yamlText = match[1];
  const content = match[2];
  const data: Record<string, any> = {};

  for (const line of yamlText.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const colonIdx = trimmed.indexOf(":");
    if (colonIdx > 0) {
      const key = trimmed.slice(0, colonIdx).trim();
      let val = trimmed.slice(colonIdx + 1).trim();
      if (val.startsWith("[") && val.endsWith("]")) {
        data[key] = val
          .slice(1, -1)
          .split(",")
          .map((s) => s.trim().replace(/^["']|["']$/g, ""))
          .filter(Boolean);
      } else {
        data[key] = val.replace(/^["']|["']$/g, "");
      }
    }
  }

  return { data, content };
}

export interface ResolvedSkill {
  name: string;
  description: string;
  filePath: string;
  relativePath: string;
  targets: string[];
  content: string;
  isProximityMatch: boolean;
}

export interface InjectedIntelligence {
  skillsFull: string[];
  skillsIndexed: string[];
  slicedInstructions: string | null;
  totalTokensApprox: number;
}

// Maximum tokens allowed for sliced instructions per agent (~4 characters per token heuristic)
const MAX_INSTRUCTION_TOKENS = 1000;
const MAX_SKILL_TOKENS_FULL_INJECTION = 1500;

/**
 * Keyword routing table mapping copilot-instructions.md markdown headings to specialist agent roles.
 */
const ROLE_HEADING_KEYWORDS: Record<string, string[]> = {
  "prsquad-architect": [
    "architect", "architecture", "design", "structure", "pattern", "patterns",
    "database", "domain", "boundary", "boundaries", "api", "schema", "module", "modules", "system", "components"
  ],
  "prsquad-dev": [
    "code", "coding", "style", "naming", "convention", "conventions",
    "framework", "typescript", "javascript", "java", "python",
    "go", "rust", "lint", "format", "formatting", "impl", "implementation", "dependency"
  ],
  "prsquad-qa": [
    "test", "tests", "testing", "qa", "coverage", "fixture", "fixtures", "mock", "mocks",
    "e2e", "unit", "integration", "assert", "regression", "vitest", "jest", "pytest", "junit"
  ],
  "prsquad-review": [
    "security", "review", "audit", "vulnerability", "vulnerabilities", "owasp", "secret", "secrets",
    "license", "checklist", "safety", "threat", "compliance"
  ]
};

/**
 * Slices a monolithic .github/copilot-instructions.md file into role-specific guidance.
 */
export function sliceCopilotInstructions(
  repoRoot: string,
  targetAgent: string
): string | null {
  // Orchestrator and Triage receive 0 repo instructions to preserve protocol purity
  if (isAgentMatch(targetAgent, "prsquad") || isAgentMatch(targetAgent, "prsquad-triage")) {
    return null;
  }

  const instructionPath = join(repoRoot, ".github", "copilot-instructions.md");
  if (!existsSync(instructionPath)) {
    return null;
  }

  try {
    const raw = readFileSync(instructionPath, "utf-8");
    if (!raw.trim()) return null;

    // Normalize target agent role
    let matchedRoleKey = "prsquad-dev";
    if (isAgentMatch(targetAgent, "prsquad-architect")) matchedRoleKey = "prsquad-architect";
    else if (isAgentMatch(targetAgent, "prsquad-qa")) matchedRoleKey = "prsquad-qa";
    else if (isAgentMatch(targetAgent, "prsquad-review")) matchedRoleKey = "prsquad-review";

    const relevantKeywords = ROLE_HEADING_KEYWORDS[matchedRoleKey] || [];

    // Split markdown by headings (# Header, ## Header, ### Header)
    const sections: { title: string; body: string }[] = [];
    const lines = raw.split("\n");
    let currentTitle = "General";
    let currentBody: string[] = [];

    for (const line of lines) {
      if (/^#{1,3}\s+(.+)$/.test(line)) {
        if (currentBody.length > 0) {
          sections.push({ title: currentTitle, body: currentBody.join("\n") });
        }
        currentTitle = line.replace(/^#{1,3}\s+/, "").trim();
        currentBody = [line];
      } else {
        currentBody.push(line);
      }
    }
    if (currentBody.length > 0) {
      sections.push({ title: currentTitle, body: currentBody.join("\n") });
    }

    // Filter sections whose titles match the agent's keyword affinity
    const matchedSections: string[] = [];
    for (const sec of sections) {
      const lowerTitle = sec.title.toLowerCase();
      const isRelevant = relevantKeywords.some((kw) => lowerTitle.includes(kw));
      if (isRelevant) {
        matchedSections.push(sec.body);
      }
    }

    if (matchedSections.length === 0) {
      return null;
    }

    const combined = matchedSections.join("\n\n");
    const approxTokens = Math.ceil(combined.length / 4);

    const TRUNCATION_NOTICE = "\n\n*[Note: Remaining sections truncated to protect context budget. Consult .github/copilot-instructions.md for full guidance.]*";
    const totalCharBudget = MAX_INSTRUCTION_TOKENS * 4;

    if (combined.length > totalCharBudget) {
      const sliceLimit = Math.max(0, totalCharBudget - TRUNCATION_NOTICE.length);
      return combined.slice(0, sliceLimit) + TRUNCATION_NOTICE;
    }

    return combined;
  } catch {
    return null;
  }
}

/**
 * Recursively scans a directory for *.md skill files.
 */
function scanSkillFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const results: string[] = [];
  try {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        results.push(...scanSkillFiles(fullPath));
      } else if (entry.endsWith(".md")) {
        results.push(fullPath);
      }
    }
  } catch {}
  return results;
}

/**
 * Resolves repository skills adhering to directory proximity and role affinity.
 */
export function resolveRepoSkills(
  repoRoot: string,
  targetAgent: string,
  approvedScope?: string
): ResolvedSkill[] {
  // Orchestrator and Triage receive 0 skills
  if (isAgentMatch(targetAgent, "prsquad") || isAgentMatch(targetAgent, "prsquad-triage")) {
    return [];
  }

  const candidateDirs: { path: string; isProximity: boolean }[] = [];

  // 1. Level 1: Proximity folder inside approved scope
  if (approvedScope && approvedScope !== "NONE" && approvedScope.trim()) {
    const scopeDir = join(repoRoot, approvedScope.replace(/[\/\\]$/, ""));
    candidateDirs.push({ path: join(scopeDir, ".prsquad", "skills"), isProximity: true });
  }

  // 2. Level 2: Root .prsquad/skills/ and .github/skills/
  candidateDirs.push({ path: join(repoRoot, ".prsquad", "skills"), isProximity: false });
  candidateDirs.push({ path: join(repoRoot, ".github", "skills"), isProximity: false });

  const resolved: ResolvedSkill[] = [];
  const seenPaths = new Set<string>();

  for (const { path: dir, isProximity } of candidateDirs) {
    const files = scanSkillFiles(dir);
    for (const file of files) {
      if (seenPaths.has(file)) continue;
      seenPaths.add(file);

      try {
        const raw = readFileSync(file, "utf-8");
        const { data, content } = parseFrontmatter(raw);

        const targets: string[] = Array.isArray(data.targets)
          ? data.targets
          : [data.targets || "prsquad-dev", "prsquad-architect"];

        // Check role affinity
        const roleMatches = targets.some((t: string) => isAgentMatch(targetAgent, t));
        if (!roleMatches) continue;

        resolved.push({
          name: data.name || file.replace(/^.*[\\\/]/, "").replace(/\.md$/, ""),
          description: data.description || "Repository specialized skill",
          filePath: file,
          relativePath: relative(repoRoot, file).replace(/\\/g, "/"),
          targets,
          content: content.trim(),
          isProximityMatch: isProximity,
        });
      } catch {}
    }
  }

  return resolved;
}

/**
 * Packages skills and sliced instructions using the Smart Hybrid pattern.
 */
export function packageRepoIntelligence(
  repoRoot: string,
  targetAgent: string,
  approvedScope?: string
): InjectedIntelligence {
  const skills = resolveRepoSkills(repoRoot, targetAgent, approvedScope);
  const slicedInstructions = sliceCopilotInstructions(repoRoot, targetAgent);

  const skillsFull: string[] = [];
  const skillsIndexed: string[] = [];
  let skillTokens = 0;

  // Proximity matches sorted first
  skills.sort((a, b) => (b.isProximityMatch ? 1 : 0) - (a.isProximityMatch ? 1 : 0));

  for (const skill of skills) {
    const estTokens = Math.ceil(skill.content.length / 4);

    // If within budget and either proximity match or first skill, inject in full
    if (skillTokens + estTokens <= MAX_SKILL_TOKENS_FULL_INJECTION && (skill.isProximityMatch || skillsFull.length === 0)) {
      skillsFull.push(`#### 💡 Skill: ${skill.name} (${skill.relativePath})\n${skill.content}`);
      skillTokens += estTokens;
    } else {
      // Index auxiliary skills to eliminate data-mule overhead
      skillsIndexed.push(`- **[${skill.name}]** (\`${skill.relativePath}\`): ${skill.description}`);
    }
  }

  const instructionTokens = slicedInstructions ? Math.ceil(slicedInstructions.length / 4) : 0;

  return {
    skillsFull,
    skillsIndexed,
    slicedInstructions,
    totalTokensApprox: skillTokens + instructionTokens,
  };
}

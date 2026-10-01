/**
 * Test Suite: Repository Skills, Instruction Slicing & Tooling Manifest Bridge
 * Verifies dynamic repository intelligence discovery, role-affinity routing,
 * instruction slicing, token budget capping, and multi-stack tooling detection.
 */

import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { detectRepoStack, isCommandAllowedByTooling } from "../src/guardrails/toolingBridge.js";
import {
  sliceCopilotInstructions,
  resolveRepoSkills,
  packageRepoIntelligence
} from "../src/guardrails/repoSkillResolver.js";

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
  if (condition) {
    console.log(`  [PASS] ${msg}`);
    passed++;
  } else {
    console.error(`  [FAIL] ${msg}`);
    failed++;
  }
}

function runTests() {
  console.log("\n=======================================================");
  console.log("  PRSQUAD REPOSITORY SKILLS & TOOLING AUTOMATED TESTS");
  console.log("=======================================================\n");

  const testDir = mkdtempSync(join(tmpdir(), "prsquad-skills-test-"));

  try {
    // -------------------------------------------------------------
    // Suite 1: Tooling Manifest Bridge & Stack Auto-Detection
    // -------------------------------------------------------------
    console.log("Suite 1: Declarative Tooling Manifest & Multi-Stack Fallbacks");

    // 1.1 Zero-config Node
    writeFileSync(join(testDir, "package.json"), "{}");
    let tooling = detectRepoStack(testDir);
    assert(tooling.stack === "npm", "Detects npm stack from package.json");
    assert(tooling.testCommand === "npm test", "Sets testCommand to 'npm test'");
    assert(isCommandAllowedByTooling("npm test", tooling), "Allows 'npm test'");
    assert(isCommandAllowedByTooling("npm test -- auth.test.ts", tooling), "Allows targeted npm test");
    rmSync(join(testDir, "package.json"));

    // 1.2 Zero-config Maven
    writeFileSync(join(testDir, "pom.xml"), "<project></project>");
    tooling = detectRepoStack(testDir);
    assert(tooling.stack === "maven", "Detects Maven stack from pom.xml");
    assert(tooling.testCommand === "mvn test", "Sets testCommand to 'mvn test'");
    assert(isCommandAllowedByTooling("mvn test -Dtest=AuthServiceTest", tooling), "Allows targeted Maven test");
    rmSync(join(testDir, "pom.xml"));

    // 1.3 Zero-config Python / Pytest
    writeFileSync(join(testDir, "pyproject.toml"), "[tool.pytest]");
    tooling = detectRepoStack(testDir);
    assert(tooling.stack === "pytest", "Detects Pytest stack from pyproject.toml");
    assert(tooling.testCommand === "pytest", "Sets testCommand to 'pytest'");
    assert(isCommandAllowedByTooling("pytest tests/test_api.py", tooling), "Allows targeted Pytest run");
    rmSync(join(testDir, "pyproject.toml"));

    // 1.4 Zero-config Go
    writeFileSync(join(testDir, "go.mod"), "module test");
    tooling = detectRepoStack(testDir);
    assert(tooling.stack === "go", "Detects Go stack from go.mod");
    assert(tooling.testCommand === "go test ./...", "Sets testCommand to 'go test ./...'");
    assert(isCommandAllowedByTooling("go test -v ./services/billing", tooling), "Allows targeted Go test");
    rmSync(join(testDir, "go.mod"));

    // 1.5 Explicit Config override via .prsquad/config.json
    mkdirSync(join(testDir, ".prsquad"), { recursive: true });
    writeFileSync(
      join(testDir, ".prsquad", "config.json"),
      JSON.stringify({
        stack: "custom-gradle",
        tooling: {
          testCommand: "./gradlew test --parallel",
          lintCommand: "./gradlew check"
        }
      })
    );
    tooling = detectRepoStack(testDir);
    assert(tooling.isExplicitConfig === true, "Recognizes explicit .prsquad/config.json");
    assert(tooling.stack === "custom-gradle", "Preserves custom stack name");
    assert(tooling.testCommand === "./gradlew test --parallel", "Preserves custom test runner command");
    assert(isCommandAllowedByTooling("./gradlew test --parallel", tooling), "Permits custom test command");
    rmSync(join(testDir, ".prsquad", "config.json"));

    // -------------------------------------------------------------
    // Suite 2: Monolithic Instruction Slicer (.github/copilot-instructions.md)
    // -------------------------------------------------------------
    console.log("\nSuite 2: Monolithic copilot-instructions.md Semantic Slicing");

    mkdirSync(join(testDir, ".github"), { recursive: true });
    const monolithicInstructions = `
# Engineering Handbook

## System Architecture and Domain Boundaries
All services must follow clean architecture. Database access is strictly encapsulated in repository interfaces.

## TypeScript and Code Style
Use strict TypeScript. Functions must have explicit return types. Prettier formatting is enforced.

## Testing and Quality Assurance
All PRs must include unit tests with at least 80% branch coverage. Use Vitest fixtures and mock network calls.

## Security Audit and Review Guidelines
Never commit API secrets. Review all external dependency additions for known CVEs. Check for SQL injection vulnerabilities.
`;
    writeFileSync(join(testDir, ".github", "copilot-instructions.md"), monolithicInstructions);

    // 2.1 Protocol Isolation: Orchestrator and Triage receive ZERO instructions
    const orchSlice = sliceCopilotInstructions(testDir, "prsquad");
    assert(orchSlice === null, "Orchestrator (@prsquad) receives 0 repo instructions (protocol purity)");

    const triageSlice = sliceCopilotInstructions(testDir, "prsquad-triage");
    assert(triageSlice === null, "Triage (@prsquad-triage) receives 0 repo instructions (gatekeeper purity)");

    // 2.2 Role-Affinity Routing
    const archSlice = sliceCopilotInstructions(testDir, "prsquad-architect") || "";
    assert(archSlice.includes("System Architecture"), "Architect receives Architecture section");
    assert(!archSlice.includes("Vitest fixtures"), "Architect does NOT receive Testing section");

    const devSlice = sliceCopilotInstructions(testDir, "prsquad-dev") || "";
    assert(devSlice.includes("TypeScript and Code Style"), "Developer receives Code Style section");
    assert(!devSlice.includes("SQL injection"), "Developer does NOT receive Security Review section");

    const qaSlice = sliceCopilotInstructions(testDir, "prsquad-qa") || "";
    assert(qaSlice.includes("Testing and Quality Assurance"), "QA receives Testing section");
    assert(!qaSlice.includes("clean architecture"), "QA does NOT receive Architecture section");

    const revSlice = sliceCopilotInstructions(testDir, "prsquad-review") || "";
    assert(revSlice.includes("Security Audit and Review Guidelines"), "Reviewer receives Security Review section");
    assert(!revSlice.includes("strict TypeScript"), "Reviewer does NOT receive TypeScript Style section");

    // 2.3 Hard Token Ceiling on massive instructions
    const giantInstructions = `
## Coding Standards
${"Always write clean code and document your functions.\n".repeat(200)}
`;
    writeFileSync(join(testDir, ".github", "copilot-instructions.md"), giantInstructions);
    const cappedDevSlice = sliceCopilotInstructions(testDir, "prsquad-dev") || "";
    assert(cappedDevSlice.length <= 4100, "Capped instruction length stays under 4,100 chars (~1,000 tokens)");
    assert(cappedDevSlice.includes("Remaining sections truncated"), "Appends truncation notice when budget exceeded");

    // -------------------------------------------------------------
    // Suite 3: Repository Skill Resolution & Directory Proximity
    // -------------------------------------------------------------
    console.log("\nSuite 3: Directory Proximity Skills & Zero-Skill Fallback");

    // 3.1 Zero-skill fallback in clean repo
    const emptySkills = resolveRepoSkills(testDir, "prsquad-dev", "services/auth/");
    assert(emptySkills.length === 0, "Zero-skill fallback returns empty array when no skills exist");

    // 3.2 Global root skill
    mkdirSync(join(testDir, ".prsquad", "skills", "global-formatting"), { recursive: true });
    writeFileSync(
      join(testDir, ".prsquad", "skills", "global-formatting", "SKILL.md"),
      `---
name: global-formatting
description: Team formatting standard
targets: [prsquad-dev]
---
# Global Formatting Standard
Tabs over spaces.
`
    );

    // 3.3 Folder proximity skill in services/billing/
    mkdirSync(join(testDir, "services", "billing", ".prsquad", "skills", "stripe-webhooks"), { recursive: true });
    writeFileSync(
      join(testDir, "services", "billing", ".prsquad", "skills", "stripe-webhooks", "SKILL.md"),
      `---
name: stripe-webhooks
description: Stripe webhook handler conventions
targets: [prsquad-dev, prsquad-qa]
---
# Stripe Webhook Protocol
Check idempotency keys on every transaction.
`
    );

    // 3.4 Resolving for Developer working in services/billing/
    const devBillingSkills = resolveRepoSkills(testDir, "prsquad-dev", "services/billing/");
    assert(devBillingSkills.length === 2, "Resolves both folder-proximity skill and root skill");
    assert(devBillingSkills[0].name === "stripe-webhooks", "Prioritizes folder-proximity skill first");
    assert(devBillingSkills[0].isProximityMatch === true, "Marks proximity match as true");

    // 3.5 Role filtering: QA does NOT receive Developer-only formatting skill
    const qaBillingSkills = resolveRepoSkills(testDir, "prsquad-qa", "services/billing/");
    assert(qaBillingSkills.length === 1, "QA receives only QA-targeted skills");
    assert(qaBillingSkills[0].name === "stripe-webhooks", "QA receives stripe-webhooks skill");

    // 3.6 Resolving outside billing: frontend/ does NOT receive billing proximity skill
    const frontendSkills = resolveRepoSkills(testDir, "prsquad-dev", "frontend/");
    assert(frontendSkills.length === 1, "Frontend scope does not load billing proximity skill");
    assert(frontendSkills[0].name === "global-formatting", "Frontend scope loads only root skill");

    // -------------------------------------------------------------
    // Suite 4: Smart Hybrid Packaging (Full vs. Index)
    // -------------------------------------------------------------
    console.log("\nSuite 4: Smart Hybrid Context Packaging");

    const intel = packageRepoIntelligence(testDir, "prsquad-dev", "services/billing/");
    assert(intel.skillsFull.length >= 1, "Injects primary proximity skill in full text");
    assert(intel.totalTokensApprox > 0, "Computes approximate token footprint");

    console.log("\n=======================================================");
    console.log(`  VERIFICATION COMPLETE: ${passed}/${passed + failed} checks passed.`);
    console.log("=======================================================\n");

    if (failed > 0) {
      process.exit(1);
    }
  } finally {
    // Cleanup temporary directory
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {}
  }
}

runTests();

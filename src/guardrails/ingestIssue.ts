import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { FetchedIssueData } from "./types.js";

/**
 * Deterministically fetches issue details using the GitHub CLI (`gh`).
 * Falls back to local JSON fixture in examples/ if gh fails or when testing locally.
 */
export function fetchIssueDeterministic(
  owner: string,
  repo: string,
  issueNumber: number,
  rootDir: string = process.cwd()
): FetchedIssueData {
  // 1. Try native GitHub CLI
  try {
    const cmd = `gh issue view ${issueNumber} --repo ${owner}/${repo} --json number,title,body,comments,labels,author,state`;
    const stdout = execSync(cmd, {
      cwd: rootDir,
      encoding: "utf-8",
      timeout: 10000,
      stdio: ["ignore", "pipe", "ignore"],
    });

    const parsed = JSON.parse(stdout);
    return {
      owner,
      repo,
      number: parsed.number ?? issueNumber,
      title: parsed.title ?? "",
      body: parsed.body ?? "",
      author: parsed.author?.login ?? "unknown",
      labels: (parsed.labels ?? []).map((l: any) => l.name ?? l),
      comments: (parsed.comments ?? [])
        .filter((c: any) => {
          const body = c.body || "";
          if (body.includes("<!-- gated-change:workflow-dashboard -->")) return false;
          if (body.includes("Gated Change Workflow Dashboard")) return false;
          if (c.author?.login?.includes("[bot]")) return false;
          return true;
        })
        .map((c: any) => ({
          author: c.author?.login ?? "unknown",
          body: c.body ?? "",
          createdAt: c.createdAt ?? "",
        })),
      state: (parsed.state ?? "OPEN").toUpperCase(),
    };
  } catch {
    // 2. Fallback to local examples fixture ONLY if testing environment explicitly permits
    const allowFixtures =
      process.env.NODE_ENV === "test" ||
      process.env.PRSQUAD_ALLOW_FIXTURES === "true" ||
      process.env.PRSQUAD_ALLOW_FIXTURES === "1";

    if (allowFixtures) {
      const candidates = [
        join(rootDir, "examples", `sample-issue-${issueNumber}.json`),
        join(rootDir, "examples", "sample-issue-ready.json"),
        join(rootDir, "examples", "sample-issue-vague.json"),
      ];

      for (const candidate of candidates) {
        if (existsSync(candidate)) {
          try {
            const raw = readFileSync(candidate, "utf-8");
            const parsed = JSON.parse(raw);
            if (parsed.id === issueNumber || parsed.number === issueNumber || candidate.endsWith("-ready.json")) {
              return {
                owner: owner || "local",
                repo: repo || "sample-repo",
                number: parsed.id ?? parsed.number ?? issueNumber,
                title: parsed.title ?? "",
                body: parsed.body ?? "",
                author: "fixture-author",
                labels: parsed.labels ?? [],
                comments: (parsed.comments ?? []).map((c: any) => ({
                  author: c.author ?? "commenter",
                  body: c.body ?? (typeof c === "string" ? c : ""),
                  createdAt: new Date().toISOString(),
                })),
                state: (parsed.state ?? "OPEN").toUpperCase(),
              };
            }
          } catch {
            // Continue to next candidate
          }
        }
      }
    }

    throw new Error(
      `Could not fetch issue #${issueNumber} from GitHub CLI ('gh'). Native issue ingestion failed and mock fixtures are disabled in production.`
    );
  }
}

/**
 * Builds the pre-formatted structured prompt payload for the Intake agent.
 */
export function formatIntakePayload(issueData: FetchedIssueData, round: number = 0): string {
  // On initial triage (round 0), the issue description and title are the authoritative specification.
  // Comments are only passed during clarification rounds (round > 0) to prevent historical prompt noise.
  const relevantComments = round > 0 ? (issueData.comments || []) : [];

  return JSON.stringify(
    {
      source: "DETERMINISTIC_HOOK_INGESTION",
      clarificationRound: round,
      issue: {
        owner: issueData.owner,
        repo: issueData.repo,
        number: issueData.number,
        title: issueData.title,
        body: issueData.body,
        author: issueData.author,
        labels: issueData.labels,
        comments: relevantComments,
        state: issueData.state,
      },
      instructions:
        "Evaluate this pre-fetched issue against the Definition of Ready (Reproduction/Expected vs Actual, Acceptance Criteria, Declared Scope). Output your structured triage verdict.",
    },
    null,
    2
  );
}

/**
 * Synchronizes human chat clarifications back to the GitHub issue comments
 * to keep the remote issue as the durable single source of truth.
 */
export function syncClarificationToIssue(
  owner: string,
  repo: string,
  issueNumber: number,
  clarificationText: string,
  rootDir: string = process.cwd()
): boolean {
  try {
    const escaped = clarificationText.replace(/"/g, '\\"');
    execSync(`gh issue comment ${issueNumber} --repo ${owner}/${repo} --body "Clarification from Copilot session: ${escaped}"`, {
      cwd: rootDir,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return true;
  } catch {
    return false;
  }
}

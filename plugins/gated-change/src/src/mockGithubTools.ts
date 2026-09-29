import { defineTool, type Tool } from "@github/copilot-sdk";
import type { Issue } from "./types.js";

/**
 * Stands in for the real GitHub issue tools the gated-change-intake agent expects
 * (`github/get_issue`, `github/get_issue_comments`). This local harness has no GitHub
 * connection, so these always resolve to the one local sample issue regardless of the
 * owner/repo/number the agent passes - good enough to smoke-test the real agent's prompt
 * and schema handling, not a substitute for testing against a real GitHub issue.
 */
export function makeMockGithubTools(issue: Issue): Tool<Record<string, never>>[] {
  const getIssue = defineTool<{ owner: string; repo: string; issue_number: number }>(
    "github_get_issue",
    {
      description: "Fetch a GitHub issue's title, body, and metadata.",
      parameters: {
        type: "object",
        properties: {
          owner: { type: "string" },
          repo: { type: "string" },
          issue_number: { type: "number" },
        },
        required: ["owner", "repo", "issue_number"],
      },
      handler: async () => ({
        owner: "local",
        repo: "sample-repo",
        number: Number(issue.id),
        title: issue.title,
        body: issue.body,
      }),
    }
  );

  const getIssueComments = defineTool<{ owner: string; repo: string; issue_number: number }>(
    "github_get_issue_comments",
    {
      description: "Fetch a GitHub issue's comments.",
      parameters: {
        type: "object",
        properties: {
          owner: { type: "string" },
          repo: { type: "string" },
          issue_number: { type: "number" },
        },
        required: ["owner", "repo", "issue_number"],
      },
      handler: async () => [],
    }
  );

  return [getIssue, getIssueComments] as unknown as Tool<Record<string, never>>[];
}

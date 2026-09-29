import { readFileSync } from "node:fs";
import matter from "gray-matter";

export interface AgentDefinition {
  name: string;
  description: string;
  tools: string[];
  systemMessage: string;
  metadata: Record<string, string>;
}

/** Parses a .agent.md file (frontmatter + system-prompt body) into an AgentDefinition. */
export function loadAgent(path: string): AgentDefinition {
  const raw = readFileSync(path, "utf-8");
  const { data, content } = matter(raw);

  if (!data.description) {
    throw new Error(`${path}: missing required "description" in frontmatter`);
  }

  return {
    name: data.name ?? path,
    description: data.description,
    tools: data.tools ?? [],
    systemMessage: content.trim(),
    metadata: data.metadata ?? {},
  };
}

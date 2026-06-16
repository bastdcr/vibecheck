import { readdir, readFile, stat } from "node:fs/promises";
import { join, resolve, basename } from "node:path";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import type { ClaudeSession, ClaudePrompt, ToolCall } from "../types.js";

const CLAUDE_DIRS = [
  join(homedir(), ".claude", "projects"),
  join(homedir(), ".claude"),
];

export async function readClaudeHistory(
  repoPath: string
): Promise<{ sessions: ClaudeSession[]; sessionCount: number }> {
  const resolvedRepo = resolve(repoPath);
  const allSessions: ClaudeSession[] = [];

  for (const dir of CLAUDE_DIRS) {
    if (!existsSync(dir)) continue;
    const sessions = await findSessionFiles(dir, resolvedRepo);
    allSessions.push(...sessions);
  }

  // Sort by timestamp, newest first
  allSessions.sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );

  return { sessions: allSessions, sessionCount: allSessions.length };
}

async function findSessionFiles(
  baseDir: string,
  repoPath: string
): Promise<ClaudeSession[]> {
  const sessions: ClauseSession[] = [];

  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        // Look inside project-specific directories
        await walk(fullPath);
      } else if (entry.name.endsWith(".jsonl") || entry.name.endsWith(".json")) {
        try {
          const session = await parseSessionFile(fullPath, repoPath);
          if (session && session.prompts.length > 0) {
            sessions.push(session);
          }
        } catch {
          // Skip unparseable files
        }
      }
    }
  }

  await walk(baseDir);
  return sessions;
}

type ClauseSession = ClaudeSession;

async function parseSessionFile(
  filePath: string,
  repoPath: string
): Promise<ClaudeSession | null> {
  const content = await readFile(filePath, "utf-8");
  const lines = content.split("\n").filter(Boolean);

  let sessionTimestamp = "";
  const prompts: ClaudePrompt[] = [];

  // Check if this session is related to the repo
  let isRelevant = false;

  for (const line of lines) {
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    // Detect relevance from the session's working directory or file paths
    if (!isRelevant) {
      const cwd = (entry.cwd || entry.workingDirectory || "") as string;
      if (cwd && resolve(cwd).startsWith(repoPath)) {
        isRelevant = true;
      }
    }

    // Extract user messages as prompts
    const role = entry.role || entry.type;
    if (role === "human" || role === "user") {
      const text = extractText(entry);
      if (text) {
        const ts =
          (entry.timestamp as string) ||
          (entry.createdAt as string) ||
          sessionTimestamp;
        if (!sessionTimestamp) sessionTimestamp = ts;

        prompts.push({
          text,
          timestamp: ts,
          filesGenerated: [],
          toolCalls: [],
        });
      }
    }

    // Extract assistant responses with tool usage to find generated files
    if (role === "assistant") {
      const toolCalls = extractToolCalls(entry);
      if (toolCalls.length > 0 && prompts.length > 0) {
        const lastPrompt = prompts[prompts.length - 1];
        lastPrompt.toolCalls.push(...toolCalls);
        for (const tc of toolCalls) {
          if (tc.filePath) {
            lastPrompt.filesGenerated.push(tc.filePath);
          }
        }
      }
    }
  }

  // If file path hints at the project
  if (!isRelevant) {
    const repoName = basename(repoPath).toLowerCase();
    if (filePath.toLowerCase().includes(repoName)) {
      isRelevant = true;
    }
  }

  if (!isRelevant && prompts.length > 0) {
    // Check if any generated files match repo files
    for (const p of prompts) {
      for (const f of p.filesGenerated) {
        if (resolve(f).startsWith(repoPath) || !f.startsWith("/")) {
          isRelevant = true;
          break;
        }
      }
      if (isRelevant) break;
    }
  }

  if (!isRelevant) return null;

  // Try to get session timestamp from file stat if not found in content
  if (!sessionTimestamp) {
    try {
      const s = await stat(filePath);
      sessionTimestamp = s.mtime.toISOString();
    } catch {
      sessionTimestamp = new Date().toISOString();
    }
  }

  return { timestamp: sessionTimestamp, prompts };
}

function extractText(entry: Record<string, unknown>): string {
  if (typeof entry.content === "string") return entry.content;

  if (typeof entry.message === "string") return entry.message;

  if (Array.isArray(entry.content)) {
    const texts = entry.content
      .filter(
        (c: Record<string, unknown>) =>
          c.type === "text" && typeof c.text === "string"
      )
      .map((c: Record<string, unknown>) => c.text as string);
    return texts.join("\n");
  }

  if (
    entry.message &&
    typeof entry.message === "object" &&
    (entry.message as Record<string, unknown>).content
  ) {
    return extractText(entry.message as Record<string, unknown>);
  }

  return "";
}

function extractToolCalls(entry: Record<string, unknown>): ToolCall[] {
  const calls: ToolCall[] = [];

  const content = entry.content;
  if (Array.isArray(content)) {
    for (const block of content) {
      if (block.type === "tool_use" || block.type === "tool_call") {
        const tc: ToolCall = {
          tool: (block.name || block.function?.name || "unknown") as string,
          args: (block.input || block.function?.arguments || {}) as Record<
            string,
            unknown
          >,
        };

        // Extract file paths from write/create tool calls
        const toolName = tc.tool.toLowerCase();
        if (
          toolName.includes("write") ||
          toolName.includes("create") ||
          toolName.includes("edit") ||
          toolName.includes("file")
        ) {
          const path =
            (tc.args.file_path as string) ||
            (tc.args.path as string) ||
            (tc.args.filePath as string) ||
            (tc.args.file as string);
          if (path) {
            tc.filePath = path;
            tc.content = (tc.args.content as string) || undefined;
          }
        }

        calls.push(tc);
      }
    }
  }

  return calls;
}

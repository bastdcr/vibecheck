import { readdir, readFile, stat } from "node:fs/promises";
import { join, resolve, basename } from "node:path";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import type { ClaudeSession, ClaudePrompt, ToolCall } from "../types.js";

const CLAUDE_DIRS = [
  join(homedir(), ".claude", "projects"),
  join(homedir(), ".claude"),
];

const GENERIC_PROMPT_RE = /^(ok|oui|yes|yep|go|continue|next|sure|d'accord|parfait|merci|thanks|good|bien|c'est bon|les autres|et les autres|la suite)/i;

function isGenericPrompt(text: string): boolean {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length < 25 || GENERIC_PROMPT_RE.test(clean);
}

function findSubstantivePrompt(prompts: ClaudePrompt[]): ClaudePrompt | null {
  for (let i = prompts.length - 1; i >= 0; i--) {
    if (!isGenericPrompt(prompts[i].text)) return prompts[i];
  }
  return prompts[prompts.length - 1] ?? null;
}

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

  allSessions.sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );

  return { sessions: allSessions, sessionCount: allSessions.length };
}

async function findSessionFiles(
  baseDir: string,
  repoPath: string
): Promise<ClaudeSession[]> {
  const sessions: ClaudeSession[] = [];

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

async function parseSessionFile(
  filePath: string,
  repoPath: string
): Promise<ClaudeSession | null> {
  const content = await readFile(filePath, "utf-8");
  const lines = content.split("\n").filter(Boolean);

  let sessionTimestamp = "";
  const prompts: ClaudePrompt[] = [];
  let isRelevant = false;

  for (const line of lines) {
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    // Detect relevance from cwd field
    if (!isRelevant) {
      const cwd = (entry.cwd || entry.workingDirectory || "") as string;
      if (cwd && resolve(cwd).startsWith(repoPath)) {
        isRelevant = true;
      }
    }

    // Normalize: Claude Code nests message under entry.message
    const msg = (
      entry.message && typeof entry.message === "object"
        ? entry.message
        : entry
    ) as Record<string, unknown>;
    const role =
      (msg.role as string) || (entry.role as string) || (entry.type as string) || "";

    // Extract user prompts
    if (role === "human" || role === "user") {
      // Skip pure tool_result lines (they are user-type but contain tool output, not prompts)
      if (entry.toolUseResult !== undefined) {
        // Harvest file paths from toolUseResult, attach to the best prompt
        const tur = entry.toolUseResult;
        if (tur && typeof tur === "object") {
          const turObj = tur as Record<string, unknown>;
          const fp = turObj.filePath as string;
          if (fp && prompts.length > 0) {
            const target = findSubstantivePrompt(prompts)!;
            if (!target.filesGenerated.includes(fp)) {
              target.filesGenerated.push(fp);
            }
          }
        }
        continue;
      }

      const text = extractText(msg);
      if (text && text.length > 5) {
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

    // Extract assistant tool calls to find generated files
    if (role === "assistant") {
      const toolCalls = extractToolCalls(msg);
      if (toolCalls.length > 0 && prompts.length > 0) {
        const target = findSubstantivePrompt(prompts)!;
        target.toolCalls.push(...toolCalls);
        for (const tc of toolCalls) {
          if (tc.filePath && !target.filesGenerated.includes(tc.filePath)) {
            target.filesGenerated.push(tc.filePath);
          }
        }
      }
    }
  }

  // Check relevance by file path heuristic
  if (!isRelevant) {
    const repoName = basename(repoPath).toLowerCase();
    if (filePath.toLowerCase().includes(repoName)) {
      isRelevant = true;
    }
  }

  if (!isRelevant && prompts.length > 0) {
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

function extractText(msg: Record<string, unknown>): string {
  if (typeof msg.content === "string") return msg.content;

  if (typeof msg.message === "string") return msg.message;

  if (Array.isArray(msg.content)) {
    const texts = msg.content
      .filter(
        (c: Record<string, unknown>) =>
          c.type === "text" && typeof c.text === "string"
      )
      .map((c: Record<string, unknown>) => c.text as string);
    return texts.join("\n");
  }

  // Recurse into nested message
  if (
    msg.message &&
    typeof msg.message === "object" &&
    (msg.message as Record<string, unknown>).content
  ) {
    return extractText(msg.message as Record<string, unknown>);
  }

  return "";
}

function extractToolCalls(msg: Record<string, unknown>): ToolCall[] {
  const calls: ToolCall[] = [];

  // Claude Code: tool_use blocks are in msg.content (which is message.content)
  const content = msg.content;
  if (!Array.isArray(content)) return calls;

  for (const block of content) {
    if (
      !block ||
      typeof block !== "object" ||
      (block.type !== "tool_use" && block.type !== "tool_call")
    ) {
      continue;
    }

    const tc: ToolCall = {
      tool: (block.name || block.function?.name || "unknown") as string,
      args: (block.input || block.function?.arguments || {}) as Record<
        string,
        unknown
      >,
    };

    const toolName = tc.tool.toLowerCase();

    // Write / Create / Edit / StrReplace / EditNotebook — direct file writes
    if (
      toolName.includes("write") ||
      toolName.includes("create") ||
      toolName.includes("edit") ||
      toolName.includes("file") ||
      toolName.includes("strreplace") ||
      toolName.includes("notebookedit")
    ) {
      const path =
        (tc.args.file_path as string) ||
        (tc.args.path as string) ||
        (tc.args.filePath as string) ||
        (tc.args.file as string) ||
        (tc.args.target_notebook as string);
      if (path) {
        tc.filePath = path;
        tc.content = (tc.args.content as string) || (tc.args.contents as string) || undefined;
      }
    }

    // mcp__supabase__apply_migration — derive migration file path from name
    if (toolName.includes("apply_migration")) {
      const migrationName = tc.args.name as string;
      if (migrationName) {
        tc.filePath = `supabase/migrations/${migrationName}`;
        tc.content = tc.args.query as string || undefined;
      }
    }

    calls.push(tc);
  }

  return calls;
}

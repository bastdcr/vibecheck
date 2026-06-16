import { readdir, readFile, stat } from "node:fs/promises";
import { join, resolve, basename } from "node:path";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import type { ClaudeSession, ClaudePrompt, ToolCall } from "../types.js";

const CURSOR_PROJECTS_DIR = join(homedir(), ".cursor", "projects");

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

/**
 * Build the Cursor project slug from an absolute repo path.
 * /Users/foo/Documents/github/titane → Users-foo-Documents-github-titane
 */
function repoPathToSlug(repoPath: string): string {
  const resolved = resolve(repoPath);
  // Strip leading / and replace all / with -
  return resolved.replace(/^\//, "").replace(/\//g, "-");
}

export async function readCursorHistory(
  repoPath: string
): Promise<{ sessions: ClaudeSession[]; sessionCount: number }> {
  const slug = repoPathToSlug(repoPath);
  const transcriptsDir = join(CURSOR_PROJECTS_DIR, slug, "agent-transcripts");

  if (!existsSync(transcriptsDir)) {
    return { sessions: [], sessionCount: 0 };
  }

  const sessions: ClaudeSession[] = [];

  let sessionDirs: string[];
  try {
    sessionDirs = await readdir(transcriptsDir);
  } catch {
    return { sessions: [], sessionCount: 0 };
  }

  for (const dir of sessionDirs) {
    const dirPath = join(transcriptsDir, dir);
    const jsonlFile = join(dirPath, `${dir}.jsonl`);

    if (!existsSync(jsonlFile)) continue;

    try {
      const session = await parseTranscript(jsonlFile);
      if (session && session.prompts.length > 0) {
        sessions.push(session);
      }
    } catch {
      // Skip unparseable transcripts
    }
  }

  sessions.sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );

  return { sessions, sessionCount: sessions.length };
}

async function parseTranscript(
  filePath: string
): Promise<ClaudeSession | null> {
  const content = await readFile(filePath, "utf-8");
  const lines = content.split("\n").filter(Boolean);

  let sessionTimestamp = "";
  const prompts: ClaudePrompt[] = [];

  for (const line of lines) {
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    const role = entry.role as string || "";
    const msg = (entry.message || {}) as Record<string, unknown>;
    const msgContent = msg.content;

    if (role === "user") {
      const text = extractUserText(msgContent);
      if (text && text.length > 5) {
        const ts = (entry.timestamp as string) || sessionTimestamp;
        if (!sessionTimestamp) sessionTimestamp = ts;

        prompts.push({
          text,
          timestamp: ts,
          filesGenerated: [],
          toolCalls: [],
        });
      }
    }

    if (role === "assistant" && Array.isArray(msgContent)) {
      const toolCalls = extractToolCalls(msgContent);
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

  if (prompts.length === 0) return null;

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

function extractUserText(content: unknown): string {
  if (typeof content === "string") return content;

  if (Array.isArray(content)) {
    return content
      .filter(
        (c: Record<string, unknown>) =>
          c.type === "text" && typeof c.text === "string"
      )
      .map((c: Record<string, unknown>) => {
        let text = c.text as string;
        // Strip system tags to get the actual user query
        const match = text.match(/<user_query>\s*([\s\S]*?)\s*<\/user_query>/);
        if (match) return match[1];
        return text;
      })
      .join("\n");
  }

  return "";
}

function extractToolCalls(content: unknown[]): ToolCall[] {
  const calls: ToolCall[] = [];

  for (const block of content) {
    if (
      !block ||
      typeof block !== "object" ||
      (block as Record<string, unknown>).type !== "tool_use"
    ) {
      continue;
    }

    const b = block as Record<string, unknown>;
    const toolName = (b.name || "unknown") as string;
    const input = (b.input || {}) as Record<string, unknown>;

    const tc: ToolCall = {
      tool: toolName,
      args: input,
    };

    const name = toolName.toLowerCase();

    // Write, StrReplace, EditNotebook — direct file modifications
    if (
      name === "write" ||
      name === "strreplace" ||
      name === "editnotebook" ||
      name === "delete"
    ) {
      const path =
        (input.path as string) ||
        (input.file_path as string) ||
        (input.filePath as string) ||
        (input.target_notebook as string);
      if (path) {
        tc.filePath = path;
        tc.content = (input.contents as string) || (input.content as string) || (input.new_string as string) || undefined;
      }
    }

    // CallMcpTool — check for apply_migration
    if (name === "callmcptool") {
      const mcpToolName = (input.toolName as string || "").toLowerCase();
      if (mcpToolName.includes("apply_migration")) {
        const args = input.arguments as Record<string, unknown> | undefined;
        if (args?.name) {
          tc.filePath = `supabase/migrations/${args.name as string}`;
          tc.content = args.query as string || undefined;
        }
      }
    }

    calls.push(tc);
  }

  return calls;
}

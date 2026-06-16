export interface PromptTrace {
  prompt: string;
  session: string;
  file: string;
  result: string;
  missingConstraints: string[];
}

export interface Finding {
  id: number;
  severity: "critical" | "medium";
  path: string;
  title: string;
  meta: string;
  source: "gitleaks" | "semgrep" | "rls" | "deps";
  trace: PromptTrace | null;
  manual: string | null;
}

export type FindingStatus = "open" | "ignored" | "solved";

export interface ScanResult {
  findings: Finding[];
  stats: {
    gitHistory: boolean;
    sourceScanned: boolean;
    supabaseMigrations: boolean;
    claudeSessions: number;
    cursorSessions: number;
    stack: string[];
    contributors: number;
  };
}

export interface ClaudeSession {
  timestamp: string;
  prompts: ClaudePrompt[];
}

export interface ClaudePrompt {
  text: string;
  timestamp: string;
  filesGenerated: string[];
  toolCalls: ToolCall[];
}

export interface ToolCall {
  tool: string;
  args: Record<string, unknown>;
  filePath?: string;
  content?: string;
}

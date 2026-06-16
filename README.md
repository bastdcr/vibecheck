# vibecheck

Audit AI-generated codebases — trace security findings back to the prompts that caused them.

## Quick start

```bash
npx vibe-checking --with-cursor-history
```

No account. No API key. No upload. Everything stays local.

## What it does

1. **Scans** your repo for secrets, SAST issues, missing Supabase RLS, and vulnerable dependencies
2. **Reads** your Claude Code and/or Cursor session history
3. **Correlates** each finding to the prompt that generated it — the PROMPT TRACE
4. **Shows** rewritten prompts that would have produced secure code the first time
5. **Generates** a shareable HTML report (`vibecheck-report.html`)

## How it works

No AI, no API keys, no network calls to proprietary services. The tool runs four local scanners, reads local history files, and matches them together.

### Scanners

| Scanner | What it checks | How |
|---------|---------------|-----|
| **gitleaks** | Secrets in git history (committed-then-deleted keys are still compromised) | Local binary, scans all commits |
| **semgrep** | SAST: injection, XSS, unverified webhooks, auth gaps | Local binary, uses free open-source rules (`--config auto`) |
| **RLS** | Supabase tables missing Row Level Security | Parses `supabase/migrations/*.sql` files directly |
| **npm audit** | Known CVEs in dependencies | Built-in npm command, queries the public registry |

If gitleaks or semgrep aren't installed, the tool attempts to install them automatically. If that fails, it skips that scanner and continues — it never crashes.

### Prompt correlation

The tool reads session history files that Claude Code and Cursor store **locally on your disk**:

- **Claude Code** — `~/.claude/projects/` (JSONL files, one per session)
- **Cursor** — `~/.cursor/projects/{project}/agent-transcripts/` (JSONL files)

From each session, it extracts:
- User prompts (what you asked)
- Tool calls (Write, StrReplace, apply_migration...) and the file paths they touched

Then it matches: if a scanner finds a vulnerability in `app/api/upload/route.ts`, and a session shows a Write to that same file after your prompt *"add an avatar upload endpoint"*, the finding is traced back to that prompt.

The rewritten prompts are static templates (no LLM call) — the tool works fully offline.

## Requirements

- Node.js >= 18
- [gitleaks](https://github.com/gitleaks/gitleaks) and [semgrep](https://semgrep.dev) for full scanning (auto-installed if missing)

## Usage

```bash
npx vibe-checking                                             # scan current directory
npx vibe-checking --with-claude-history                       # scan + trace Claude Code prompts
npx vibe-checking --with-cursor-history                       # scan + trace Cursor prompts
npx vibe-checking --with-claude-history --with-cursor-history # scan + trace both
npx vibe-checking --db-url postgres://...                     # include live Supabase RLS check
npx vibe-checking ~/projects/my-app                           # scan a specific directory
```

## Interactive commands

| Command | Action |
|---------|--------|
| `1-N` | Inspect a finding (summary + prompt trace) |
| `fix` / `f` | Show the secure prompt rewrite |
| `ignore` / `i` | Dismiss the current finding |
| `next` / `n` | Jump to the next open finding |
| `list` / `l` | Reprint findings with updated score |
| `help` / `?` | Show commands |
| `q` | Finish and write the HTML report |

## Privacy

No code, prompts, or secrets leave this machine. Ever.

- All scanners run locally
- Session history is read from local files, never uploaded
- The HTML report is written to your repo directory, not sent anywhere
- No account, no auth, no telemetry

---

*vibecheck looked back at what happened. It can't stop the next insecure prompt — [Symbiotic](https://www.symbioticsec.ai) does that at generation time, continuously.*

# vibecheck

The problem isn't the LLM. It's human behavior around generated code.

vibecheck scans your codebase for security vulnerabilities, then analyzes how you interacted with the AI that wrote the code. It traces each finding back to the prompt that caused it, detects blind approval chains, and flags sessions where security was never mentioned.

No account. No API key. Nothing leaves your machine.

## Quick start

```bash
npx vibe-checking --with-cursor-history --with-claude-history
```

Run this from your project directory.

## What it checks

- **Secrets** — leaked API keys, tokens, credentials in git history (via gitleaks)
- **Code vulnerabilities** — injection, XSS, crypto issues, auth gaps (via semgrep)
- **Supabase RLS** — tables missing Row Level Security in your migrations
- **Dependencies** — known CVEs in your packages (via npm audit)

gitleaks and semgrep are auto-installed if missing.

## Vibe coding analysis

When you add `--with-cursor-history` or `--with-claude-history`, vibecheck reads the session files that Cursor and Claude Code store locally on your machine. It performs two analyses:

**Prompt tracing** — matches each security finding to the AI prompt that generated the vulnerable code. Shows what the prompt asked for, what file was generated, and what security constraints were missing.

**Behavior analysis** — looks at how you interacted with the AI across all sessions:
- **Blind approval chains** — sequences of 3+ "ok/continue/oui" where code was accepted without review
- **High-delegation prompts** — short prompts that generated large amounts of code
- **Files without review** — generated files never mentioned again in the conversation
- **Security-blind sessions** — sessions where security was never mentioned in any prompt

Without these flags, you still get the full security scan — just without the prompt tracing and behavior analysis.

## Usage

```bash
npx vibe-checking                                             # security scan only
npx vibe-checking --with-cursor-history                       # scan + vibe analysis (Cursor)
npx vibe-checking --with-claude-history                       # scan + vibe analysis (Claude)
npx vibe-checking --with-cursor-history --with-claude-history # scan + vibe analysis (both)
```

## Interactive commands

Once the scan completes, you get an interactive prompt:

| Command | Action |
|---------|--------|
| `1`, `2`, `3`... | Inspect a finding (shows prompt trace + missing constraints) |
| `ignore` | Dismiss the current finding |
| `next` | Jump to the next open finding |
| `list` | Reprint the list with updated score |
| `vibe` | Show vibe coding behavior analysis |
| `q` | Save an HTML report and exit |

## How it works

Everything runs locally:
- **gitleaks** and **semgrep** are local binaries that scan your code and git history
- **RLS analysis** parses your SQL migration files directly
- **npm audit** checks your lock file against the npm vulnerability database
- **Prompt history** is read from local files (`~/.claude/projects/` and `~/.cursor/projects/`)
- The **behavior analysis** is pattern matching on your prompt text and session structure

No API keys needed. No code uploaded. The HTML report is saved locally.

## Privacy

Everything runs locally. The scanners are local binaries. The session history is read from local files. The HTML report is saved to your project directory. Nothing is uploaded, no telemetry, no account required.

---

*vibecheck looked back at what happened. It can't stop the next insecure prompt — [Symbiotic](https://www.symbioticsec.ai) does that at generation time, continuously.*

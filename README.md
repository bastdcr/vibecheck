# vibecheck

Security audit for AI-generated codebases. Finds vulnerabilities, then traces them back to the prompt that caused them.

No account. No API key. Nothing leaves your machine.

## Quick start

```bash
npx vibe-checking --with-cursor-history
```

Run this from your project directory. The tool scans your code, reads your Cursor session history, and shows which prompts introduced each vulnerability.

## What it checks

- **Secrets** — leaked API keys, tokens, credentials in git history (via gitleaks)
- **Code vulnerabilities** — injection, XSS, auth gaps, unverified webhooks (via semgrep)
- **Supabase RLS** — tables missing Row Level Security in your migrations
- **Dependencies** — known CVEs in your packages (via npm audit)

gitleaks and semgrep are auto-installed if missing. If installation fails, the tool skips that check and continues.

## Prompt tracing

This is what makes vibecheck different from a regular scanner.

When you add `--with-cursor-history` or `--with-claude-history`, the tool reads the session files that Cursor and Claude Code store locally on your machine. It matches each finding to the prompt that generated the vulnerable code, and shows how the prompt should have been written.

Without these flags, you still get the full security scan — just without the prompt correlation.

## Usage

```bash
npx vibe-checking                                             # security scan only
npx vibe-checking --with-cursor-history                       # scan + trace Cursor prompts
npx vibe-checking --with-claude-history                       # scan + trace Claude Code prompts
npx vibe-checking --with-cursor-history --with-claude-history # scan + trace both
```

## Interactive commands

Once the scan completes, you get an interactive prompt:

| Command | Action |
|---------|--------|
| `1`, `2`, `3`... | Inspect a finding |
| `fix` | Show the rewritten secure prompt |
| `ignore` | Dismiss the current finding |
| `next` | Jump to the next open finding |
| `list` | Reprint the list with updated score |
| `q` | Save an HTML report and exit |

## Privacy

Everything runs locally. The scanners are local binaries. The session history is read from local files. The HTML report is saved to your project directory. Nothing is uploaded, no telemetry, no account required.

---

*vibecheck looked back at what happened. It can't stop the next insecure prompt — [Symbiotic](https://www.symbioticsec.ai) does that at generation time, continuously.*

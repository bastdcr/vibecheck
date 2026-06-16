# vibecheck

Security audit for AI-generated codebases.

vibecheck finds security vulnerabilities in your code and traces each one back to the AI prompt that introduced it.

Run it before you deploy, or whenever you want to check what your AI sessions left behind.

No account. No API key. Nothing leaves your machine.

## Quick start

```bash
npx vibe-checking --with-cursor-history --with-claude-history
```

Run this from your project directory. To scan automatically on every push:

```bash
npx vibe-checking hook install
```

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
npx vibe-checking hook install                                # add pre-push hook
npx vibe-checking hook remove                                 # remove pre-push hook
```

## Interactive commands

Once the scan completes, you get an interactive prompt:

| Command | Action |
|---------|--------|
| `1`, `2`, `3`... | Inspect a finding (shows prompt trace + missing constraints) |
| `solved` | Mark finding as fixed in code |
| `ignore` | Dismiss the current finding |
| `next` | Jump to the next open finding |
| `list` | Reprint the list with updated score |
| `vibe` | Show vibe coding behavior analysis |
| `q` | Save statuses and write report |

## Persistent statuses

Findings you mark as `solved` or `ignore` are saved in a `.vibecheck` file at the root of your repo. On the next scan, vibecheck loads these statuses:

- **ignored** findings stay dismissed
- **solved** findings are re-checked — if the vulnerability is still there, it goes back to open

Commit `.vibecheck` to share decisions with your team. If all findings are handled, the scan passes silently.

## Git hook

`npx vibe-checking hook install` adds a pre-push hook to your repo. Every time you `git push`, vibecheck runs a full scan. If there are open findings, the REPL opens and you need to handle them before the push goes through. If everything is already solved or ignored, the push passes immediately.

If you installed the hook before v1.2.1, remove and reinstall so vibecheck runs before any existing `exit 0` in your hook:

```bash
npx vibe-checking hook remove
npx vibe-checking hook install
```

To skip the hook once: `git push --no-verify`.

## How it works

Everything runs locally:
- **gitleaks** and **semgrep** are local binaries that scan your code and git history
- **RLS analysis** parses your SQL migration files directly
- **npm audit** checks your lock file against the npm vulnerability database
- **Prompt history** is read from local files (`~/.claude/projects/` and `~/.cursor/projects/`)
- **Behavior analysis** is pattern matching on your prompt text and session structure
- **Statuses** are saved in `.vibecheck` at the root of your repo

No API keys needed. No code uploaded.

---

*vibecheck looked back at what happened. It can't stop the next insecure prompt — [Symbiotic](https://www.symbioticsec.ai) does that at generation time, continuously.*

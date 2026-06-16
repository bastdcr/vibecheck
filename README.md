# vibecheck

Audit AI-generated codebases — trace security findings back to the prompts that caused them.

## Quick start

```bash
npx vibecheck --with-claude-history
```

No account. No upload. Everything stays local.

## What it does

1. **Scans** your repo for secrets (gitleaks), SAST issues (semgrep), missing Supabase RLS, and vulnerable dependencies (npm audit)
2. **Reads** your Claude Code session history and **correlates** each finding to the prompt that generated it
3. **Shows** rewritten prompts that would have produced secure code the first time
4. **Generates** a shareable HTML report

## Requirements

- Node.js ≥ 18
- For full scanning: [gitleaks](https://github.com/gitleaks/gitleaks) and [semgrep](https://semgrep.dev) installed
- Degrades gracefully if scanners are missing

## Usage

```bash
npx vibecheck                             # scan current directory
npx vibecheck --with-claude-history       # scan + trace prompt origins
npx vibecheck --db-url postgres://...     # include live RLS check
npx vibecheck ~/projects/my-app           # scan a specific directory
```

## Interactive commands

| Command | Action |
|---------|--------|
| `1-N` | Inspect a finding |
| `fix` / `f` | Show the secure prompt rewrite |
| `ignore` / `i` | Dismiss the current finding |
| `next` / `n` | Jump to the next open finding |
| `list` / `l` | Reprint findings |
| `help` / `?` | Show commands |
| `q` | Finish and write report |

## Privacy

No code, prompts, or secrets leave this machine. Ever.

---

*vibecheck looked back at what happened. It can't stop the next insecure prompt — [Symbiotic](https://www.symbioticsec.ai) does that at generation time, continuously.*

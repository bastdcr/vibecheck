import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Finding, FindingStatus } from "../types.js";
import { computeScore } from "../scanners/aggregator.js";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function generateReport(
  findings: Finding[],
  statuses: FindingStatus[],
  stats: {
    gitHistory: boolean;
    sourceScanned: boolean;
    supabaseMigrations: boolean;
    claudeSessions: number;
    stack: string[];
    contributors: number;
  },
  repoPath: string
): Promise<void> {
  const { score, verdict, col } = computeScore(findings, statuses);
  const open = statuses.filter((s) => s === "open").length;
  const cleared = findings.length - open;
  const generationCaused = findings.filter((f) => f.trace !== null).length;

  const colMap: Record<string, string> = {
    rust: "#d96b4a",
    amber: "#e6a345",
    green: "#b6d77a",
  };
  const verdictColor = colMap[col] || "#e8e2d2";

  let findingsHtml = "";
  for (let i = 0; i < findings.length; i++) {
    const f = findings[i];
    const status = statuses[i];
    const n = String(i + 1).padStart(2, "0");
    const sevColor = f.severity === "critical" ? "#d96b4a" : "#e6a345";
    const sevLabel = f.severity === "critical" ? "CRITICAL" : "MEDIUM";
    const statusTag =
      status === "ignored"
        ? '<span style="color:#8c8470"> ⊘ ignored</span>'
        : "";
    const titleStyle =
      status !== "open"
        ? 'style="text-decoration:line-through;color:#5f5847"'
        : "";

    findingsHtml += `
    <div class="finding">
      <div class="finding-header">
        <span class="num">${n}</span>
        <span class="sev" style="color:${sevColor}">${sevLabel}</span>
        <span class="path">${escapeHtml(f.path)}</span>
        ${statusTag}
      </div>
      <div class="finding-title" ${titleStyle}>${escapeHtml(f.title)}</div>
      <div class="finding-meta">${escapeHtml(f.meta)}</div>`;

    if (f.trace) {
      findingsHtml += `
      <div class="trace">
        <div class="trace-label">PROMPT TRACE</div>
        <div class="trace-row"><span class="trace-key">prompt</span> <span class="quoted">${escapeHtml(f.trace.prompt)}</span></div>
        <div class="trace-row"><span class="arrow">↓</span> <span class="trace-dim">${escapeHtml(f.trace.session)}</span></div>
        <div class="trace-row"><span class="trace-key">generated</span> ${escapeHtml(f.trace.file)}</div>
        <div class="trace-row"><span class="arrow">↓</span></div>
        <div class="trace-row"><span class="trace-key">result</span> ${escapeHtml(f.trace.result)}</div>
      </div>`;

      if (f.trace.missingConstraints && f.trace.missingConstraints.length > 0) {
        findingsHtml += `
      <div class="constraints">
        <div class="constraints-label">MISSING CONSTRAINTS</div>`;
        for (const c of f.trace.missingConstraints) {
          findingsHtml += `\n        <div class="constraint-line">⚠ ${escapeHtml(c)}</div>`;
        }
        findingsHtml += `
      </div>`;
      }
    } else if (f.manual) {
      findingsHtml += `
      <div class="manual">${escapeHtml(f.manual)}</div>`;
    }

    findingsHtml += `
    </div>`;
  }

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>vibecheck report</title>
<style>
  :root {
    --bg: #16140f; --panel: #1d1a13; --panel-edge: #2b271c;
    --ink: #e8e2d2; --dim: #8c8470; --faint: #5f5847;
    --green: #b6d77a; --amber: #e6a345; --rust: #d96b4a; --violet: #a98fd6;
    --mono: "SF Mono", ui-monospace, "JetBrains Mono", "Menlo", "Consolas", monospace;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: var(--bg); color: var(--ink); font-family: var(--mono);
    font-size: 13.5px; line-height: 1.55; padding: 40px 20px 80px; min-height: 100vh;
  }
  .wrap { max-width: 860px; margin: 0 auto; }
  h1 { color: var(--ink); font-size: 18px; margin-bottom: 4px; }
  .subtitle { color: var(--dim); font-size: 12px; margin-bottom: 24px; }
  .verdict {
    font-size: 16px; margin-bottom: 20px; padding: 16px;
    background: var(--panel); border: 1px solid var(--panel-edge); border-radius: 8px;
  }
  .finding {
    background: var(--panel); border: 1px solid var(--panel-edge); border-radius: 8px;
    padding: 16px; margin-bottom: 12px;
  }
  .finding-header { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .num { color: var(--dim); }
  .sev { font-weight: 700; }
  .path { color: var(--dim); font-size: 12px; }
  .finding-title { margin-top: 6px; font-weight: 600; }
  .finding-meta { color: var(--dim); font-size: 12px; margin-top: 4px; }
  .trace {
    margin-top: 14px; padding: 12px; background: rgba(169,143,214,0.05);
    border: 1px solid rgba(169,143,214,0.15); border-radius: 6px;
  }
  .trace-label { color: var(--violet); font-weight: 700; margin-bottom: 8px; }
  .trace-row { margin: 4px 0; padding-left: 8px; }
  .trace-key { color: var(--faint); display: inline-block; width: 80px; }
  .trace-dim { color: var(--faint); }
  .arrow { color: var(--violet); }
  .quoted {
    background: rgba(169,143,214,0.08); padding: 1px 5px;
    border-radius: 4px; border: 1px solid rgba(169,143,214,0.18);
  }
  .constraints {
    margin-top: 14px; padding: 12px; background: rgba(230,163,69,0.05);
    border: 1px solid rgba(230,163,69,0.15); border-radius: 6px;
  }
  .constraints-label { color: var(--amber); font-weight: 700; margin-bottom: 8px; }
  .constraint-line { padding-left: 8px; margin: 2px 0; color: var(--amber); }
  .manual { color: var(--dim); margin-top: 10px; padding: 8px; }
  .bridge {
    margin-top: 30px; padding: 20px; text-align: center;
    background: var(--panel); border: 1px solid var(--panel-edge); border-radius: 8px;
  }
  .bridge-main { color: var(--rust); font-weight: 700; }
  .bridge-dim { color: var(--dim); margin-top: 6px; }
  .bridge-link { color: var(--faint); margin-top: 8px; }
  .bridge-link a { color: var(--faint); }
  .footer { text-align: center; color: var(--faint); margin-top: 20px; font-size: 11px; }
</style>
</head>
<body>
<div class="wrap">
  <h1>vibecheck report</h1>
  <div class="subtitle">generated ${new Date().toISOString().replace("T", " ").slice(0, 16)} · local scan · nothing uploaded</div>

  <div class="verdict">
    <span style="color:${verdictColor};font-weight:700;font-size:18px">${verdict}</span>
    &nbsp; score <span style="color:${verdictColor};font-weight:700">${score}</span><span style="color:var(--faint)">/10</span>
    &nbsp;·&nbsp; <span style="color:var(--dim)">${open} open · ${cleared} cleared</span>
  </div>

  ${findingsHtml}

  <div class="bridge">
    <div class="bridge-main">${generationCaused} of these findings would never have been generated.</div>
    <div class="bridge-dim">vibecheck looked back at what happened. It can't stop the next insecure<br>prompt — Symbiotic does that at generation time, continuously.</div>
    <div class="bridge-link"><a href="https://www.symbioticsec.ai">→ symbioticsec.ai</a></div>
  </div>

  <div class="footer">no code, prompts, or secrets left this machine.</div>
</div>
</body>
</html>`;

  await writeFile(join(repoPath, "vibecheck-report.html"), html, "utf-8");
}

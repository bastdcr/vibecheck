import * as readline from "node:readline";
import pc from "picocolors";
import type { Finding, FindingStatus } from "../types.js";
import {
  printList,
  printInspect,
  printIgnore,
  printHelp,
  printFinish,
  printVibeAnalysis,
} from "./display.js";
import { generateReport } from "../report/html.js";
import { saveState } from "../state/store.js";
import type { VibeAnalysis } from "../analysis/behavior.js";

export async function startRepl(
  findings: Finding[],
  initialStatuses: FindingStatus[],
  stats: {
    gitHistory: boolean;
    sourceScanned: boolean;
    supabaseMigrations: boolean;
    claudeSessions: number;
    stack: string[];
    contributors: number;
  },
  repoPath: string,
  vibeAnalysis?: VibeAnalysis
): Promise<void> {
  const statuses: FindingStatus[] = [...initialStatuses];
  let current = -1;

  printList(findings, statuses);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: pc.bold(pc.magenta("vibecheck>")) + " ",
    terminal: true,
  });

  rl.prompt();

  return new Promise<void>((resolve) => {
    let finished = false;

    async function finish(withReport: boolean): Promise<void> {
      if (finished) return;
      finished = true;
      await saveState(repoPath, findings, statuses);
      if (withReport) {
        const reportPath = "vibecheck-report.html";
        await generateReport(findings, statuses, stats, repoPath);
        printFinish(findings, statuses, reportPath, repoPath);
      }
      resolve();
    }

    rl.on("line", async (raw: string) => {
      const cmd = raw.trim().toLowerCase();

      if (cmd === "") {
        rl.prompt();
        return;
      }

      // Number → inspect finding
      if (/^[1-9][0-9]*$/.test(cmd)) {
        const i = parseInt(cmd, 10) - 1;
        if (i >= 0 && i < findings.length) {
          current = i;
          printInspect(findings[i], i);
        } else {
          console.log(
            pc.dim(
              pc.gray(
                `no finding ${cmd}. there are ${findings.length}.`
              )
            )
          );
          console.log();
        }
        rl.prompt();
        return;
      }

      if (cmd === "solved" || cmd === "s") {
        if (current < 0) {
          console.log(
            pc.dim(
              pc.gray("inspect a finding first — type its number.")
            )
          );
          console.log();
        } else {
          statuses[current] =
            statuses[current] === "solved" ? "open" : "solved";
          const n = String(current + 1).padStart(2, "0");
          console.log(
            pc.dim(
              `finding ${n} ${statuses[current] === "solved" ? pc.green("marked as solved") : "restored to open"}.`
            )
          );
          console.log();
        }
        rl.prompt();
        return;
      }

      if (cmd === "ignore" || cmd === "i") {
        if (current < 0) {
          console.log(
            pc.dim(
              pc.gray("inspect a finding first — type its number.")
            )
          );
          console.log();
        } else {
          statuses[current] =
            statuses[current] === "ignored" ? "open" : "ignored";
          printIgnore(current, statuses[current] === "ignored");
        }
        rl.prompt();
        return;
      }

      if (cmd === "next" || cmd === "n") {
        let found = false;
        for (let k = 0; k < findings.length; k++) {
          const idx = (current + 1 + k) % findings.length;
          if (statuses[idx] === "open") {
            current = idx;
            printInspect(findings[idx], idx);
            found = true;
            break;
          }
        }
        if (!found) {
          console.log(
            pc.green(
              `nothing left open. type ${pc.magenta("list")} to review or ${pc.magenta("q")} to finish.`
            )
          );
          console.log();
        }
        rl.prompt();
        return;
      }

      if (cmd === "list" || cmd === "l") {
        printList(findings, statuses);
        rl.prompt();
        return;
      }

      if (cmd === "vibe" || cmd === "v" || cmd === "prompts") {
        if (vibeAnalysis) {
          printVibeAnalysis(vibeAnalysis);
        } else {
          console.log(
            pc.dim(
              pc.gray("no vibe analysis available — run with --with-claude-history or --with-cursor-history")
            )
          );
        }
        console.log();
        rl.prompt();
        return;
      }

      if (cmd === "help" || cmd === "h" || cmd === "?") {
        printHelp(findings.length);
        rl.prompt();
        return;
      }

      if (cmd === "q" || cmd === "quit" || cmd === "exit") {
        await finish(true);
        rl.close();
        return;
      }

      console.log(
        pc.dim(
          pc.gray(
            `unknown command: ${cmd} — type ${pc.magenta("help")}`
          )
        )
      );
      console.log();
      rl.prompt();
    });

    rl.on("close", () => {
      void finish(false);
    });
  });
}

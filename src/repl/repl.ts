import * as readline from "node:readline";
import pc from "picocolors";
import type { Finding, FindingStatus } from "../types.js";
import {
  printList,
  printInspect,
  printFix,
  printIgnore,
  printHelp,
  printFinish,
} from "./display.js";
import { generateReport } from "../report/html.js";

export async function startRepl(
  findings: Finding[],
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
  const statuses: FindingStatus[] = findings.map(() => "open");
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

      if (cmd === "fix" || cmd === "f") {
        if (current < 0) {
          console.log(
            pc.dim(
              pc.gray("inspect a finding first — type its number.")
            )
          );
          console.log();
        } else {
          printFix(findings[current]);
          if (
            findings[current].fix &&
            statuses[current] !== "ignored"
          ) {
            statuses[current] = "fixed";
          }
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

      if (cmd === "help" || cmd === "h" || cmd === "?") {
        printHelp(findings.length);
        rl.prompt();
        return;
      }

      if (cmd === "q" || cmd === "quit" || cmd === "exit") {
        const reportPath = "vibecheck-report.html";
        await generateReport(findings, statuses, stats, repoPath);
        printFinish(findings, statuses, reportPath);
        rl.close();
        resolve();
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
      resolve();
    });
  });
}

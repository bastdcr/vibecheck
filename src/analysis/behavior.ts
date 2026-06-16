import type { ClaudeSession, Finding } from "../types.js";

export interface VibeAnalysis {
  blindChains: number;
  highDelegationPrompts: number;
  filesWithoutReview: number;
  sessionsWithoutSecurityMention: number;
  totalSessions: number;
  totalPrompts: number;
  findingsFromBlindChains: number;
}

const GENERIC_PROMPT_RE =
  /^(ok|oui|yes|yep|go|continue|next|sure|d'accord|parfait|merci|thanks|good|bien|c'est bon|les autres|et les autres|la suite)/i;

const SECURITY_KEYWORDS = [
  "security", "auth", "validation", "rls", "sanitize", "encrypt",
  "permission", "policy", "access control", "xss", "injection",
  "csrf", "cors", "secret", "credential", "token verification",
  "signature", "webhook secret", "row level",
];

const BLIND_CHAIN_THRESHOLD = 3;
const HIGH_DELEGATION_RATIO = 20;

function isGeneric(text: string): boolean {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length < 25 || GENERIC_PROMPT_RE.test(clean);
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function analyzeVibePatterns(
  sessions: ClaudeSession[],
  findings: Finding[]
): VibeAnalysis {
  let blindChains = 0;
  let highDelegationPrompts = 0;
  let filesWithoutReview = 0;
  let sessionsWithoutSecurityMention = 0;
  let totalPrompts = 0;

  const blindChainFiles = new Set<string>();

  for (const session of sessions) {
    const prompts = session.prompts;
    totalPrompts += prompts.length;

    // Signal 1: blind approval chains
    let consecutiveGeneric = 0;
    for (const prompt of prompts) {
      if (isGeneric(prompt.text)) {
        consecutiveGeneric++;
        if (consecutiveGeneric >= BLIND_CHAIN_THRESHOLD) {
          if (consecutiveGeneric === BLIND_CHAIN_THRESHOLD) blindChains++;
          for (const f of prompt.filesGenerated) {
            blindChainFiles.add(f);
          }
        }
      } else {
        consecutiveGeneric = 0;
      }
    }

    // Signal 2: high delegation ratio
    for (const prompt of prompts) {
      if (prompt.toolCalls.length === 0) continue;
      const words = wordCount(prompt.text);
      if (words < 3) continue;

      let linesGenerated = 0;
      for (const tc of prompt.toolCalls) {
        if (tc.content) {
          linesGenerated += tc.content.split("\n").length;
        }
      }

      if (linesGenerated > 0 && linesGenerated / words > HIGH_DELEGATION_RATIO) {
        highDelegationPrompts++;
      }
    }

    // Signal 3: files accepted without review
    const allGeneratedFiles = new Set<string>();
    const mentionedInFollowUp = new Set<string>();

    for (let i = 0; i < prompts.length; i++) {
      for (const f of prompts[i].filesGenerated) {
        allGeneratedFiles.add(f);
      }
      // Check if later prompts mention any previously generated files
      if (i > 0) {
        const promptLower = prompts[i].text.toLowerCase();
        for (const f of allGeneratedFiles) {
          const basename = f.split("/").pop() || f;
          if (promptLower.includes(basename.toLowerCase())) {
            mentionedInFollowUp.add(f);
          }
        }
      }
    }

    filesWithoutReview += allGeneratedFiles.size - mentionedInFollowUp.size;

    // Signal 4: no security mention
    const hasSecurityMention = prompts.some((p) => {
      const lower = p.text.toLowerCase();
      return SECURITY_KEYWORDS.some((kw) => lower.includes(kw));
    });

    if (!hasSecurityMention) {
      sessionsWithoutSecurityMention++;
    }
  }

  // Cross-reference: how many findings come from blind chain files
  const findingsFromBlindChains = findings.filter((f) => {
    if (!f.trace) return false;
    return Array.from(blindChainFiles).some(
      (bcf) => bcf.endsWith(f.path) || f.path.endsWith(bcf.split("/").pop() || "")
    );
  }).length;

  return {
    blindChains,
    highDelegationPrompts,
    filesWithoutReview,
    sessionsWithoutSecurityMention,
    totalSessions: sessions.length,
    totalPrompts,
    findingsFromBlindChains,
  };
}

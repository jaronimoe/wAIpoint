import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  isToolCallEventType,
  isBashToolResult,
} from "@earendil-works/pi-coding-agent";
import { execSync } from "node:child_process";

// ---------------------------------------------------------------------------
// Valid status values per entity type
// ---------------------------------------------------------------------------
const VALID_STATUSES: Record<string, string[]> = {
  "update-task": ["open", "current", "done", "dropped"],
  "update-wp": ["planned", "in-progress", "blocked", "done"],
  "update-project": ["active", "paused", "completed", "archived"],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function deriveSlug(cwd: string): string | null {
  try {
    const url = execSync("git remote get-url origin", {
      cwd,
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    const match = url.match(/\/([^/]+?)(?:\.git)?$/);
    // Slugs are lowercase kebab-case; repo names need not be (jaronimoe/wAIpoint).
    return match ? match[1].toLowerCase() : null;
  } catch {
    return null;
  }
}

function deriveRepoPath(cwd: string): string | null {
  try {
    const url = execSync("git remote get-url origin", {
      cwd,
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    // Extract owner/repo from https://github.com/owner/repo.git or git@github.com:owner/repo.git
    const httpsMatch = url.match(/github\.com\/([^/]+\/[^/]+?)(?:\.git)?$/);
    if (httpsMatch) return httpsMatch[1];
    const sshMatch = url.match(/github\.com:([^/]+\/[^/]+?)(?:\.git)?$/);
    if (sshMatch) return sshMatch[1];
    return null;
  } catch {
    return null;
  }
}

function getWaipointShow(slug: string): string | null {
  try {
    return execSync(`waipoint show ${slug}`, {
      encoding: "utf-8",
      timeout: 15000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    return null;
  }
}

function parseWaipointStatus(
  command: string
): { subcommand: string; status: string } | null {
  const match = command.match(
    /\bwaipoint\s+(update-task|update-wp|update-project)\b.*?--status\s+(\S+)/
  );
  if (!match) return null;
  return { subcommand: match[1], status: match[2].replace(/['"]/g, "") };
}

function commandContainsGitCommit(command: string): boolean {
  // Match "git commit" but not "git commit --amend" false positives from log/show
  return /\bgit\s+commit\b/.test(command);
}

function commandContainsWaipointUpdate(command: string): boolean {
  return /\bwaipoint\s+update-task\b/.test(command);
}

/**
 * Extract short commit hash from git commit output.
 * Typical output: "[main abc1234] commit message"
 */
function extractCommitHash(output: string): string | null {
  const match = output.match(/\[[\w/.-]+\s+([a-f0-9]{7,})\]/);
  return match ? match[1] : null;
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

export default function (pi: ExtensionAPI) {
  // Session-scoped state
  let projectSlug: string | null = null;
  let repoPath: string | null = null;
  let isTracked = false;
  let hintInjected = false;

  // Commit tracking for unmatched-commit detection
  let pendingCommitHash: string | null = null;

  // ------------------------------------------------------------------
  // Session start: detect project, show widget
  // ------------------------------------------------------------------
  pi.on("session_start", async (_event, ctx) => {
    // Reset state
    projectSlug = deriveSlug(ctx.cwd);
    repoPath = deriveRepoPath(ctx.cwd);
    isTracked = false;
    hintInjected = false;
    pendingCommitHash = null;

    if (!projectSlug) return;

    const output = getWaipointShow(projectSlug);
    if (!output) return;

    isTracked = true;

    // Build widget summary
    const lines = output.split("\n");
    const widgetLines: string[] = [];

    const header = lines.find((l) => l.startsWith("==="));
    if (header) {
      widgetLines.push(header.replace(/=/g, "").trim());
    }

    let total = 0,
      done = 0,
      current = 0;
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("[x]")) {
        done++;
        total++;
      } else if (trimmed.startsWith("[>]")) {
        current++;
        total++;
      } else if (trimmed.startsWith("[ ]") || trimmed.startsWith("[-]")) {
        total++;
      }
    }

    if (total > 0) {
      const parts = [`${done}/${total} done`];
      if (current > 0) parts.push(`${current} active`);
      widgetLines.push(`waipoint: ${parts.join(", ")}`);
    }

    if (widgetLines.length > 0) {
      ctx.ui.setWidget("waipoint", widgetLines);
    }
  });

  // ------------------------------------------------------------------
  // C: Inject context hint on first agent turn (if tracked)
  // ------------------------------------------------------------------
  pi.on("before_agent_start", async (_event, _ctx) => {
    if (!isTracked || !projectSlug || hintInjected) return;
    hintInjected = true;

    const commitUrlBase = repoPath
      ? `https://github.com/${repoPath}/commit/`
      : "<commit-url>";

    return {
      message: {
        customType: "waipoint",
        content: [
          `This project is tracked as \`${projectSlug}\` in wAIpoint.`,
          `When you complete significant work, run \`waipoint show ${projectSlug}\` to find a matching task and update it:`,
          `\`waipoint update-task ${projectSlug} <wp> <task> --status done --commit ${commitUrlBase}<sha>\``,
          `If no task matches, move on — don't create new tasks without being asked.`,
        ].join(" "),
        display: false, // Don't clutter the conversation UI
      },
    };
  });

  // ------------------------------------------------------------------
  // D: Detect git commit in tool results, set pending flag
  // ------------------------------------------------------------------
  pi.on("tool_result", async (event, _ctx) => {
    if (!isTracked || !projectSlug) return;

    if (
      isBashToolResult(event) &&
      commandContainsGitCommit(event.input?.command ?? "") &&
      !event.isError
    ) {
      // Extract commit hash from the output
      const contentText =
        event.content
          ?.filter((c: { type: string }) => c.type === "text")
          .map((c: { text: string }) => c.text)
          .join("") ?? "";
      const hash = extractCommitHash(contentText);
      if (hash) {
        pendingCommitHash = hash;
      }
    }

    // If the agent calls waipoint update-task, clear the pending flag
    if (
      isBashToolResult(event) &&
      commandContainsWaipointUpdate(event.input?.command ?? "") &&
      !event.isError
    ) {
      pendingCommitHash = null;
    }
  });

  // ------------------------------------------------------------------
  // After agent settles: notify if commit wasn't matched
  // ------------------------------------------------------------------
  pi.on("agent_settled", async (_event, ctx) => {
    if (pendingCommitHash) {
      const hash = pendingCommitHash;
      pendingCommitHash = null;
      ctx.ui.notify(
        `Commit ${hash} wasn't matched to a wAIpoint task in ${projectSlug}`,
        "info"
      );
    }
  });

  // ------------------------------------------------------------------
  // Validate --status enums on waipoint bash calls
  // ------------------------------------------------------------------
  pi.on("tool_call", async (event, _ctx) => {
    if (!isToolCallEventType("bash", event)) return;

    const command = event.input.command;
    if (!command.includes("waipoint")) return;

    const parsed = parseWaipointStatus(command);
    if (!parsed) return;

    const { subcommand, status } = parsed;
    const allowed = VALID_STATUSES[subcommand];
    if (!allowed) return;

    if (!allowed.includes(status)) {
      return {
        block: true,
        reason: `Invalid status "${status}" for waipoint ${subcommand}. Valid values: ${allowed.join(", ")}`,
      };
    }
  });
}

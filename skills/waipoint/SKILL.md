---
name: waipoint
description: >
  Track and update project roadmaps using the waipoint CLI.
  Use when working in a git repo that may be tracked in wAIpoint,
  or when the user asks to set up project tracking.
  Covers three scenarios: setting up tracking for an existing repo with history,
  initializing a new repo incrementally, and updating an already-tracked project.
---

# wAIpoint — Project Tracking for Agents

wAIpoint is a lightweight project tracker. It stores data as JSON files in a GitHub repo via the `gh` CLI. Agents push status updates from any project repo without cloning the tracker.

## Quick reference

```bash
waipoint show <slug>                          # Check if tracked, see WPs + tasks
waipoint update-task <slug> <wp> <task> \
  --status done --commit <commit-url>         # Mark task done
waipoint update-task <slug> <wp> <task> \
  --status current                            # Mark task in progress
waipoint help                                 # Full CLI reference
```

**Project slug** = last segment of `git remote get-url origin`, without `.git`, lowercased.

**Commit URLs** follow `https://github.com/<owner>/<repo>/commit/<sha>`.

### Valid statuses (no others exist — use `--notes` for caveats)

| Level | Values |
|-------|--------|
| Project | `active` · `paused` · `completed` · `archived` |
| Work package | `planned` · `in-progress` · `blocked` · `done` |
| Task | `open` · `current` · `done` · `dropped` |

Work package priority: `low` · `medium` · `high` (projects and tasks don't have priority).

## At session start

1. Derive the project slug from `git remote get-url origin` (last segment, lowercased).
2. Run `waipoint show <slug>`.
3. If the project is found → **Case 3** (already tracked). Read [case3-update.md](references/case3-update.md).
4. If not found or the command fails → the project isn't tracked. Only proceed with setup if the user explicitly asks. Then:
   - Repo has substantial history (README, roadmap, non-trivial git log) → **Case 1**. Read [case1-existing-repo.md](references/case1-existing-repo.md).
   - Repo is new or has little/no history → **Case 2**. Read [case2-new-repo.md](references/case2-new-repo.md).

## Rules (all cases)

- **Direction comes from the user, not the tracker.** Never read tracker state to decide what to work on.
- **Only create** projects, work packages, or tasks **when the user explicitly asks** (e.g. "set up the roadmap in wAIpoint", "add a work package for X").
- **Ask rather than guess** if you can't determine the right task slug from the `show` output and the user's instructions.
- **Don't read project state repeatedly** within a session — one `show` at session start is enough. Re-reading to verify your own writes is fine.
- **If a command behaves unexpectedly**, verify the underlying state via `gh api repos/<tracker-repo>/contents/<path>` before working around it (the tracker repo is `$WAIPOINT_REPO`, or the `repo=` line in `~/.config/waipoint/config`). The tool stores JSON files in a GitHub repo. If it looks like a bug in the script itself, say so and ask before patching.
- **If the CLI says no tracker repo is configured, or that the repo has no `waipoint-data.json`**, stop and tell the user. Don't set `WAIPOINT_REPO`, edit the config file, or create the marker to get past it — the check exists to stop writes landing in the wrong repo.

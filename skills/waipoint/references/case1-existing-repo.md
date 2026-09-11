# Case 1: Tracking an existing repo with history

Use when `waipoint show <slug>` finds nothing, but the repo has substantial existing work — a README, spec, roadmap docs, non-trivial git history — and the user asks to set it up.

## Procedure

### 1. Gather evidence (don't inspect code)

Read the repo's README, spec, and roadmap docs. Run `git log --date=short --pretty=format:'%h %ad %s' --reverse` to see the full commit history.

Commit messages and file-level docs are sufficient evidence of what's done. Don't read actual source code or diffs for this step.

### 2. Draft a proposed structure

Build a complete proposal with:

- **Work packages** grouped by roadmap area or feature domain, each with a suggested priority (`low`/`medium`/`high`).
- **Tasks** within each WP — typically one per roadmap bullet or significant feature.
- **Status for each task** — using commit history as evidence:
  - `done` — a commit clearly implements this task. Note the justifying commit hash(es).
  - `open` — no matching commit found.
  - `current` — work has started (matching commit exists) but the task isn't fully complete.
- **Ambiguous cases** — when a commit *might* satisfy a task but isn't clearly a full match, flag it explicitly. Propose `open` or `current` with an explanatory `--notes` value rather than marking `done`. Ask the user to confirm.

Include a WP for completed foundational work if the user wants history documented (ask if unclear).

### 3. Present and confirm

Show the full proposal as a table before running any commands. Ask about:
- Work package grouping and naming
- Task granularity (too fine? too coarse?)
- Ambiguous status calls
- Priority assignments

**Do not run `init-project`, `init-wp`, `add-task`, or `update-task` until the user confirms.**

### 4. Execute

Once confirmed, run commands in order:

```bash
# 1. Create the project
waipoint init-project <slug> \
  --name "Human Name" \
  --repo owner/repo \
  --description "..." \
  --tags tag1,tag2

# 2. Create work packages
waipoint init-wp <slug> <wp-slug> \
  --name "WP Name" \
  --description "..." \
  --priority high

# 3. Add tasks and set their status
waipoint add-task <slug> <wp> <task-slug> --name "Task name"
waipoint update-task <slug> <wp> <task-slug> \
  --status done \
  --commit https://github.com/owner/repo/commit/<sha>

# 4. Update WP status if all tasks are done
waipoint update-wp <slug> <wp> --status done
```

### 5. Verify

Run `waipoint show <slug>` once at the end to confirm everything persisted correctly.

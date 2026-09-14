# Case 3: Updating an already-tracked repo

Use when `waipoint show <slug>` succeeds — the project, its work packages, and tasks already exist. This is the common case for ongoing sessions.

## Rules

- **Don't recreate or restructure** existing work packages and tasks. Only add new ones if the user explicitly asks for new scope.
- **Don't re-read** `show` output to decide what to work on — direction comes from the user.

## During work

### Starting a task

When you begin work on a task that matches an existing entry in the `show` output:

```bash
waipoint update-task <slug> <wp> <task> --status current
```

### Completing a task

When you finish significant work and commit it:

```bash
waipoint update-task <slug> <wp> <task> \
  --status done \
  --commit https://github.com/<owner>/<repo>/commit/<sha>
```

### No obvious match

If you completed work but the `show` output has no obviously matching task slug — **ask the user** rather than guessing a slug or silently skipping the update.

### Adding notes

Use `--notes` for context that doesn't fit a status change:

```bash
waipoint update-task <slug> <wp> <task> \
  --notes "Partial implementation exists but needs verification against spec"
```

### Work package status

Update WP status when appropriate:

```bash
# All tasks done
waipoint update-wp <slug> <wp> --status done

# Work has started
waipoint update-wp <slug> <wp> --status in-progress

# Blocked on another work package in the project (sets status to blocked)
waipoint update-wp <slug> <wp> --blocked-by <other-wp> \
  --notes "Needs the session endpoint from <other-wp>"

# Blocked on something outside the project
waipoint update-wp <slug> <wp> --status blocked \
  --notes "Waiting on an upstream fix in <library>"
```

When you mark a work package blocked, always say why in `--notes`. Moving it to any other status clears `blocked_by`; update the notes too (`--notes ""` clears them) if they no longer apply.

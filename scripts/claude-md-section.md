## Project Tracking (wAIpoint)

If `waipoint` is on PATH and this project is a git repo:

1. At session start, derive the project slug from `git remote get-url origin`
   (last path segment, lowercased) and run `waipoint show <slug>`.
2. If tracked, follow `/waipoint` (Case 3) for steady-state updates.
3. After committing significant work, check if it matches a task in the `show`
   output and update it with `waipoint update-task`. If no task matches, ask
   the user rather than skipping silently or creating a new task.
4. If the project is not tracked, only set it up if the user explicitly asks —
   then run `/waipoint` for the full procedure.

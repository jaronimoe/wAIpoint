# Case 2: Tracking a new repo

Use when `waipoint show <slug>` finds nothing, the repo is new or has little/no history, and the user asks to set it up.

## Procedure

### 1. Initialize the project

Don't try to mine history for structure — there isn't any meaningful history to mine. Just create the project with whatever the user provides:

```bash
waipoint init-project <slug> \
  --name "Human Name" \
  --repo owner/repo \
  --description "..." \
  --tags tag1,tag2
```

Ask the user for name, description, and tags if not obvious from context.

### 2. Build the roadmap incrementally

**Don't front-load a full work-package/task breakdown speculatively.** The roadmap doesn't exist yet — it will emerge as the user works.

Create work packages and tasks only when the user actually defines scope:
- *"Let's add a work package for authentication"* → `init-wp` + `add-task` for the tasks they describe.
- *"I'm going to work on the login flow"* → if a matching task exists, mark it `current`. If not, ask whether to create one.
- *"I finished the OAuth integration"* → mark the task `done` with the commit URL.

### 3. Ongoing

Once tasks exist, follow the same steady-state flow as [Case 3](case3-update.md).

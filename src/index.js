/**
 * Worker with static assets -- serves the dashboard and its write API.
 *
 * Static assets are served first (run_worker_first: false), so "/" returns the
 * built dashboard and only /api/* reaches this script.
 *
 * Bindings:
 *   GITHUB_TOKEN   secret  fine-grained PAT, THIS REPO ONLY, contents:read+write
 *   TRACKER_REPO   var     set in wrangler.jsonc
 *
 * Identity comes from Cloudflare Access via ctx.access -- the Access policy is
 * attached to the Worker, so every hostname it answers on is gated and there is
 * no JWT to verify by hand.
 *
 * Writes go through the Git Data API so each record lands as ONE commit, and a
 * concurrent write from the CLI loses the ref update rather than silently
 * clobbering.
 *
 * Dashboard writes stamp `edited` and never touch `updated`, which only the CLI
 * sets. That split is how the page tells a manual change from an agent's.
 */

const PROJECT_STATUS = ["active", "paused", "completed", "archived"];
const WP_STATUS = ["planned", "in-progress", "blocked", "done"];
const TASK_STATUS = ["open", "current", "done", "dropped"];
const PRIORITY = ["low", "medium", "high"];
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Fields the dashboard may change on an existing record, and their values. */
const EDITABLE = {
  project: { status: PROJECT_STATUS },
  wp: { status: WP_STATUS, priority: PRIORITY },
  task: { status: TASK_STATUS },
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const nowIso = () => new Date().toISOString().replace(/\.\d+Z$/, "Z");

/* ---------- identity ------------------------------------------------- */

/** Decode a JWT payload without verifying it -- see accessEmail for why that
 *  is sound here. */
function jwtPayload(token) {
  try {
    const p = token.split(".")[1];
    const pad = p.replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(pad.padEnd(pad.length + ((4 - (pad.length % 4)) % 4), "=")));
  } catch {
    return null;
  }
}

/**
 * Access is attached to the Worker itself, so a request cannot reach this code
 * without having passed the edge policy first -- there is no origin to bypass.
 * That makes both of these sources trustworthy:
 *
 *   1. ctx.access.getIdentity(), the documented API; and
 *   2. the Cf-Access-Jwt-Assertion header, which only Cloudflare can set.
 *
 * Prefer (1); fall back to (2) so a missing ctx.access does not lock writes out.
 */
async function accessIdentity(request, ctx) {
  if (ctx && ctx.access) {
    try {
      const identity = await ctx.access.getIdentity();
      if (identity?.email) return { email: identity.email, via: "ctx.access" };
      return { email: null, via: "ctx.access", detail: "getIdentity returned no email" };
    } catch (e) {
      return { email: null, via: "ctx.access", detail: `getIdentity threw: ${e.message}` };
    }
  }

  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (token) {
    const claims = jwtPayload(token);
    if (claims?.email) return { email: claims.email, via: "jwt-header" };
    return { email: null, via: "jwt-header", detail: "no email claim" };
  }

  return { email: null, via: "none", detail: "ctx.access absent and no Access header" };
}

/* ---------- validation ----------------------------------------------- */

/** Mirrors schema/workpackage.schema.json and schema/task.schema.json. */
function validateCreate(body) {
  const err = (m) => ({ error: m });
  const { kind, project, wp, task, name } = body;

  if (kind !== "wp" && kind !== "task") return err("kind must be 'wp' or 'task'");
  if (!SLUG.test(project || "")) return err("project must be a kebab-case slug");
  if (!SLUG.test(wp || "")) return err("wp must be a kebab-case slug");
  if (typeof name !== "string" || !name.trim()) return err("name is required");
  if (name.length > 200) return err("name too long");

  if (kind === "wp") {
    const { status = "planned", priority = "medium", description = "" } = body;
    if (!WP_STATUS.includes(status)) return err(`status must be one of ${WP_STATUS}`);
    if (!PRIORITY.includes(priority)) return err(`priority must be one of ${PRIORITY}`);
    if (typeof description !== "string" || description.length > 2000)
      return err("description must be a string under 2000 chars");
    return null;
  }

  if (!SLUG.test(task || "")) return err("task must be a kebab-case slug");
  const { status = "open", notes = "" } = body;
  if (!TASK_STATUS.includes(status)) return err(`status must be one of ${TASK_STATUS}`);
  if (typeof notes !== "string" || notes.length > 2000)
    return err("notes must be a string under 2000 chars");
  return null;
}

/** One record, one field -- EDITABLE is the whole allowlist. */
function validateUpdate(body) {
  const err = (m) => ({ error: m });
  const { kind, project, wp, task, field, value } = body;

  if (!Object.hasOwn(EDITABLE, kind)) return err(`kind must be one of ${Object.keys(EDITABLE)}`);
  if (!SLUG.test(project || "")) return err("project must be a kebab-case slug");
  if (kind !== "project" && !SLUG.test(wp || "")) return err("wp must be a kebab-case slug");
  if (kind === "task" && !SLUG.test(task || "")) return err("task must be a kebab-case slug");

  const fields = EDITABLE[kind];
  if (!Object.hasOwn(fields, field)) return err(`field must be one of ${Object.keys(fields)}`);
  if (!fields[field].includes(value)) return err(`${field} must be one of ${fields[field]}`);
  return null;
}

function recordPath({ kind, project, wp, task }) {
  if (kind === "project") return `projects/${project}/project.json`;
  if (kind === "wp") return `projects/${project}/${wp}/workpackage.json`;
  return `projects/${project}/${wp}/tasks/${task}.json`;
}

function recordLabel({ kind, project, wp, task }) {
  if (kind === "project") return project;
  if (kind === "wp") return `${project}/${wp}`;
  return `${project}/${wp}/${task}`;
}

/** A new record. It carries `edited` rather than `updated`: no agent wrote it. */
function buildDoc(body, now) {
  if (body.kind === "wp") {
    return {
      name: body.name.trim(),
      description: (body.description || "").trim(),
      status: body.status || "planned",
      priority: body.priority || "medium",
      created: now,
      edited: now,
    };
  }
  return {
    name: body.name.trim(),
    status: body.status || "open",
    commits: [],
    notes: (body.notes || "").trim(),
    created: now,
    edited: now,
  };
}

/* ---------- GitHub ---------------------------------------------------- */

function gh(env) {
  const base = `https://api.github.com/repos/${env.TRACKER_REPO}`;
  return async (path, init = {}) => {
    const res = await fetch(base + path, {
      ...init,
      headers: {
        authorization: `Bearer ${env.GITHUB_TOKEN}`,
        accept: "application/vnd.github+json",
        "user-agent": "waipoint-dashboard",
        ...(init.body ? { "content-type": "application/json" } : {}),
      },
    });
    return res;
  };
}

/** A file's JSON as of one commit: { found, doc } or { status, error }. */
async function readJson(api, path, sha) {
  const res = await api(`/contents/${path}?ref=${sha}`);
  if (res.status === 404) return { found: false };
  if (!res.ok) return { status: 502, error: `could not read ${path}` };
  const { content } = await res.json();
  const bytes = Uint8Array.from(atob(content.replace(/\n/g, "")), (c) => c.charCodeAt(0));
  return { found: true, doc: JSON.parse(new TextDecoder().decode(bytes)) };
}

/**
 * One commit: blob -> tree (on top of the current one) -> commit -> ref.
 * The ref update is not forced, so if an agent committed while we were
 * building this, we lose and retry against the new head.
 *
 * `makeDoc(headSha)` decides what to write, and must read anything it needs AT
 * headSha. Reading "main" instead could pair an older file with a newer head;
 * the unforced update would then succeed and quietly drop the write in between.
 * It returns { doc, message }, { unchanged, doc } or { status, error }.
 */
async function commitFile(api, path, makeDoc) {
  const ref = await api("/git/ref/heads/main");
  if (!ref.ok) return { status: 502, error: "could not read branch ref" };
  const headSha = (await ref.json()).object.sha;

  const made = await makeDoc(headSha);
  if (made.error || made.unchanged) return made;

  const head = await api(`/git/commits/${headSha}`);
  const baseTree = (await head.json()).tree.sha;

  const blob = await api("/git/blobs", {
    method: "POST",
    body: JSON.stringify({
      content: JSON.stringify(made.doc, null, 2) + "\n",
      encoding: "utf-8",
    }),
  });
  const blobSha = (await blob.json()).sha;

  const tree = await api("/git/trees", {
    method: "POST",
    body: JSON.stringify({
      base_tree: baseTree,
      tree: [{ path, mode: "100644", type: "blob", sha: blobSha }],
    }),
  });
  const treeSha = (await tree.json()).sha;

  const commit = await api("/git/commits", {
    method: "POST",
    body: JSON.stringify({ message: made.message, tree: treeSha, parents: [headSha] }),
  });
  const commitSha = (await commit.json()).sha;

  const update = await api("/git/refs/heads/main", {
    method: "PATCH",
    body: JSON.stringify({ sha: commitSha, force: false }),
  });
  if (update.status === 422) return { retry: true };
  if (!update.ok) return { status: 502, error: "ref update failed" };
  return { commitSha, doc: made.doc };
}

async function commitWithRetry(api, path, makeDoc) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const result = await commitFile(api, path, makeDoc);
    if (!result.retry) return result;
  }
  return { status: 503, error: "repo busy, try again" };
}

/* ---------- handlers -------------------------------------------------- */

/** What every write needs before touching the repo: a signed-in user, a body
 *  that passes `check`, and a token. Returns { email, body } or a Response. */
async function acceptWrite(request, env, ctx, check) {
  const who = await accessIdentity(request, ctx);
  if (!who.email) {
    return json({ error: `unauthenticated (${who.via}: ${who.detail})` }, 401);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid JSON" }, 400);
  }
  if (!body || typeof body !== "object") return json({ error: "invalid JSON" }, 400);

  const bad = check(body);
  if (bad) return json(bad, 400);

  if (!env.GITHUB_TOKEN) {
    return json({ error: "GITHUB_TOKEN is not configured on this Worker" }, 503);
  }
  return { email: who.email, body };
}

async function handleCreate(request, env, ctx) {
  const accepted = await acceptWrite(request, env, ctx, validateCreate);
  if (accepted instanceof Response) return accepted;
  const { email, body } = accepted;

  const api = gh(env);
  const path = recordPath(body);
  const doc = buildDoc(body, nowIso());
  const message = `${body.kind === "wp" ? "init wp" : "add task"}: ${recordLabel(body)}\n\nvia dashboard by ${email}`;

  const result = await commitWithRetry(api, path, async (headSha) => {
    // Refuse to overwrite something that already exists.
    const existing = await readJson(api, path, headSha);
    if (existing.error) return existing;
    if (existing.found) return { status: 409, error: `${path} already exists` };
    return { doc, message };
  });
  if (result.error) return json({ error: result.error }, result.status);
  return json({ ok: true, path, slug: body.task || body.wp, doc, commit: result.commitSha });
}

/**
 * Change one field on an existing record. The rest of the record comes from
 * the repo, not the page, whose copy dates from the last deploy. The full doc
 * goes back so the page picks up anything an agent wrote since then too.
 */
async function handleUpdate(request, env, ctx) {
  const accepted = await acceptWrite(request, env, ctx, validateUpdate);
  if (accepted instanceof Response) return accepted;
  const { email, body } = accepted;
  const { kind, field, value } = body;

  const api = gh(env);
  const path = recordPath(body);

  const result = await commitWithRetry(api, path, async (headSha) => {
    const current = await readJson(api, path, headSha);
    if (current.error) return current;
    if (!current.found) return { status: 404, error: `${path} not found` };
    const doc = current.doc;
    // No commit for a no-op: it would still stamp `edited` and move the marker.
    if (doc[field] === value) return { unchanged: true, doc };
    const from = doc[field] ?? "(unset)";
    doc[field] = value;
    doc.edited = nowIso();
    const message = `update ${kind}: ${recordLabel(body)}\n\n${field}: ${from} -> ${value}\nvia dashboard by ${email}`;
    return { doc, message };
  });
  if (result.error) return json({ error: result.error }, result.status);
  return json({ ok: true, path, doc: result.doc, commit: result.commitSha || null });
}

const ROUTES = { "/api/create": handleCreate, "/api/update": handleUpdate };

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    const handler = ROUTES[pathname];
    if (!handler) return new Response("Not found", { status: 404 });

    // OPTIONS is the page's readiness probe. Reporting 503 until the token
    // is configured keeps the write controls hidden rather than offering
    // controls that would fail on click.
    if (request.method === "OPTIONS") {
      return new Response(null, { status: env.GITHUB_TOKEN ? 204 : 503 });
    }
    if (request.method !== "POST") return json({ error: "method not allowed" }, 405);
    return handler(request, env, ctx);
  },
};

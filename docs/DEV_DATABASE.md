# Dev database & safe migrations

How schema changes get tested before they touch production. Set up 2026-09-03.

## The short version

- **Production** is the live Supabase cloud project (`wscfpkaltajnrhiusoze`). Real user data.
- **Local dev DB** is a full private copy of Supabase that runs on Adam's Mac via
  Docker, built from the migration files in `supabase/migrations/`. Schema-only
  (no production rows) — same as a cloud branch would be.
- Every schema change is written as a migration file, **tested locally first**,
  and only then applied to production.

Docker is installed to `~/Applications/Docker.app`. The CLI is `npx supabase`
(not a global install). The `docker` binary lives at `~/.docker/bin/docker` with
its socket at `~/.docker/run/docker.sock` (set `DOCKER_HOST` to that if the
`docker` command isn't found on PATH).

## The migration workflow

1. **Write** the change as a new migration file:
   ```
   npx supabase migration new <short_name>
   ```
   (creates `supabase/migrations/<timestamp>_<short_name>.sql` — edit it with the SQL).

2. **Test locally** — rebuild the local DB from scratch through every migration,
   which proves the new one applies cleanly on top of the real schema:
   ```
   SUPABASE_DB_PASSWORD='<db password>' npx supabase start   # first time / when stopped
   npx supabase db reset                                     # replays all migrations
   ```
   If it errors, it errors **here, on the laptop** — never in production.

3. **Apply to production** once it's clean locally. Either:
   - via the Supabase MCP (`apply_migration`), or
   - `SUPABASE_DB_PASSWORD='<db password>' npx supabase db push`

4. **Commit** the migration file. This keeps the git history = the source of
   truth, which is what makes the project handoff-ready.

5. **Stop** the local stack when done testing so it isn't using resources:
   ```
   npx supabase stop --no-backup
   ```

## Belt-and-suspenders safety (always on)

Even without spinning up local, risky changes get dry-run against production
inside a rolled-back transaction (`BEGIN; ... ROLLBACK;`) via the MCP — proves it
applies and shows what it touches, with nothing kept. And Supabase Pro takes
automatic daily backups (point-in-time restore) as the backstop underneath
everything.

## Notes / gotchas

- The local `[analytics]` service is **disabled** in `config.toml` (it collided
  with a port already in use on this Mac, and we don't need it for migration
  testing). Leave it off unless you specifically want the local Logflare UI.
- Local Studio (a web UI for the local DB) runs at http://127.0.0.1:54323 while
  the stack is up. Local DB connection: `postgresql://postgres:postgres@127.0.0.1:54322/postgres`.
- The local keys/URLs printed by `supabase start` are **local-only throwaways** —
  they are not the production keys and are safe to ignore.
- The migration history was reconciled on 2026-09-03 (the remote had 84 tracked
  versions with no local files; those were repaired to `reverted` and the current
  live schema captured as the single baseline `20260903150504_remote_schema.sql`).

## When you hire a developer: turning on cloud branching

Local dev is the right fit while Adam works solo and applies migrations himself.
When the project is handed to a dev (or a small team) doing GitHub pull-request
work, flip on **Supabase Branching** so each PR gets its own throwaway preview
database in the cloud. It's a ~10-minute setup *at that point* — do NOT pre-build
it now (it bills per branch-hour and is wired to a PR flow that doesn't exist
yet). The steps, for later:

1. Push this repo to GitHub (it uses `gh` CLI + git over SSH today).
2. In the Supabase Dashboard → **Project Settings → Integrations → GitHub**,
   connect the repository and point it at the `supabase/` directory.
3. Enable **Branching** in the dashboard. From then on, opening a PR spins up a
   preview branch that runs the migrations in `supabase/migrations/`; merging to
   the production branch promotes them.
4. Nothing about the local workflow above has to change — both run off the same
   committed migration files. Local and cloud branching are not mutually
   exclusive.

Because every schema change already lives in `supabase/migrations/` in git, the
new dev inherits the complete history the day they clone the repo — that, not
cloud branching, is what actually makes the handoff clean.

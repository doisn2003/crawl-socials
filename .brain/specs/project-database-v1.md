# FindLink project database

Approved work on 9 November 2026 introduces independent projects and a PostgreSQL recovery copy. The desktop keeps each project's working files under `data/projects/<project-id>/data`. PostgreSQL uses the additive `csd_backup` schema. The desktop performs collection and filtering against local files and SQLite, then publishes changed files in an atomic project backup transaction.

## Relational schema

| Table | Identity | Stored data |
| --- | --- | --- |
| `schema_migrations` | `version` | Applied additive schema version |
| `users` | UUID `id`, unique `username` | Registered accounts with salted scrypt password hashes, or machine guest identity |
| `sessions` | SHA-256 `token_hash` | Account ownership and 90-day session expiry |
| `projects` | UUID `id` | Owner, name, embedded image avatar, timestamps, deletion tombstone, revision, device and backup fingerprint |
| `project_posts` | `(project_id, platform, root_id)` | One canonical social post, its first run, observation times, content and saved assessment |
| `project_run_posts` | `(project_id, run_id, platform, root_id)` | Membership in each collection run and boolean `previously_collected` |
| `project_records` | `(project_id, kind, record_key)` | Queryable JSON documents for configuration, plans, run state, results and model evidence |
| `project_files` | `(project_id, path)` | Complete recovery content, SHA-256 and category for every generated project file |

Canonical posts and run membership are projected from `project-posts.sqlite` in the same transaction as its recovery file. The projection uses the immutable SQLite snapshot captured for that transaction. A post can belong to multiple runs while retaining one canonical identity per project.

## Data inventory and recovery mapping

| FindLink data | Local source | PostgreSQL storage |
| --- | --- | --- |
| Prompt, filter mode, target, language and configuration | `user-config.json`, active draft and run configuration | JSON records and exact recovery files |
| Planning dialogue, keyword families, recipes, revisions and presets | Campaign directories and `filter-presets` | JSON records and exact recovery files |
| Runs, selected profiles, progress and checkpoints | `latest-run.json`, `collections/<run>/run-state.json`, collector state | JSON records and exact recovery files |
| Raw posts, source observations and provenance | Collector JSONL journals, observations and SQLite | Exact recovery files and consistent SQLite snapshots |
| Canonical post identity and latest reusable assessment | `project-posts.sqlite` | `project_posts` plus complete SQLite recovery file |
| Inclusion in a new run and previous-collection flag | `project-posts.sqlite` | `project_run_posts` plus complete SQLite recovery file |
| Comments, reply roots, conversation snapshots and coverage | Per-run opportunity databases and journals | Consistent SQLite snapshots and exact recovery files |
| Classification decisions, evidence, review history and jobs | Per-run opportunity SQLite | Consistent SQLite snapshots |
| Historical discovery schedules, delivery history and attempts | Project `discovery.sqlite` and campaign data | Consistent SQLite snapshots and JSON records |
| Model responses, token usage, run spending and assessment cache | Run model journals and `assessment-cache` | Exact recovery files, JSON records when applicable |
| Saved exports | Project `exports` and run result files | Exact recovery files, including Excel bytes |
| Project name, avatar and ownership | Local workspace index | `projects`, `users` |

Machine login cookies, browser sessions, API keys, PostgreSQL credentials, encrypted secret storage and machine-global spending authorizations remain in machine storage. Session tokens use the existing Windows encrypted secret store. New computers authenticate social-network accounts locally. The account's project data restores from PostgreSQL after FindLink login.

## Synchronization and recovery

New backups contain project configuration, saved prompts and presets, run metadata, and JSON results. Hash comparison avoids resending unchanged files. Direct PostgreSQL uploads use a worker and bounded batches. A changing file causes the attempt to retry later. Projects restored from JSON can show and export the saved results. A local checkpoint supports Resume for incomplete runs.

Newly completed collection runs keep the result JSON and release their generated working stores after closing the writers. Saved post rows can be filtered again from JSON. Local identity and delivery indexes keep previous-collection flags, assessment provenance and export history. Older full backups remain readable, including SQLite snapshots and their committed WAL state.

An existing project whose latest run is complete can be compacted while FindLink is closed. Run `node scripts/compact-project-data.mjs <absolute-project-data-directory>` after building. The migration verifies the result files before switching the active directory and preserves the original directory as a recovery checkpoint.

Each remote update compares the last observed revision while holding a project advisory lock. An outdated device with divergent changes receives `PROJECT_BACKUP_CONFLICT`, preserving its local files. Explicit pull and account login restore only projects whose local content still matches the last synchronized snapshot. Remote reads verify the expected revision inside a repeatable-read transaction.

Restore verifies every file hash, rejects path traversal, stages the complete directory and publishes it by rename. Operational run-state and collector output paths are rebased to the new computer, including each collector manifest's configuration hash. Recipes, import manifests, raw journals and evidence retain their exact bytes and hash identities. External retained-source directories require selection on the new machine. The prior local directory remains as a recovery checkpoint. A deletion uses a tombstone and removes the project from the active list while retaining its saved recovery files.

The first launch copies existing application data into a default project and preserves its original location. Migration completion is journaled in the workspace index so interrupted migration retries. Account login can claim guest projects. Login on a new machine selects an existing account project after restoration. Login sessions survive app restarts through Windows-encrypted storage, and cloud operations verify the saved session before upload.

## Setup

Build the application, then run the migration command using the environment file containing `DATABASE_URL`.

```powershell
npm run build
node scripts/setup-project-database.mjs --env=C:/path/to/.env
```

`CSD_ENV_FILE` can also select the environment file. The migration creates the schema and tables within the PostgreSQL database addressed by `DATABASE_URL`. Application startup also initializes the additive schema on first cloud use.

The desktop PostgreSQL connection is intended for a trusted deployment where database credentials are supplied by the operator. The application enforces account ownership in its queries. A public distribution would require a separately authenticated server to keep database credentials out of client machines.

## Verification on 9 November 2026

The integration suite passed 1,116 tests. Type checking and the production build passed. The isolated Electron renderer and production IPC checks passed project CRUD, avatar changes, prompt restoration and recovery after a partial login failure.

The schema was applied to the PostgreSQL database selected by the operator's environment file. An isolated two-device test against that database passed registration, password login, backup, restoration, one canonical post across runs, revision conflicts, session restoration and account isolation. Generated test accounts and rows were removed after verification. Development verification made zero paid model calls.

The prior-collection flag records earlier collection within the project. Actual seeding activity is recorded by the user's workflow. Reused assessments retain their original mode, run and evaluation provenance, and changed evidence triggers a fresh assessment.

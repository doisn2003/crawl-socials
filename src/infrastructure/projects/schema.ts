/** Additive migration. Application data is always owned by a registered or guest user. */
export const PROJECT_SCHEMA_SQL = `
CREATE SCHEMA IF NOT EXISTS csd_backup;
CREATE TABLE IF NOT EXISTS csd_backup.schema_migrations (
  version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS csd_backup.users (
  id uuid PRIMARY KEY, username text UNIQUE, password_hash text,
  guest_secret_hash text, created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((username IS NOT NULL AND password_hash IS NOT NULL) OR guest_secret_hash IS NOT NULL)
);
CREATE TABLE IF NOT EXISTS csd_backup.projects (
  id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES csd_backup.users(id),
  name text NOT NULL, avatar text, created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL, deleted_at timestamptz,
  revision bigint NOT NULL DEFAULT 0, fingerprint text NOT NULL,
  source_directory text NOT NULL, device_id uuid NOT NULL,
  backed_up_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS csd_backup.sessions (
  token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES csd_backup.users(id),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '90 days'
);
CREATE INDEX IF NOT EXISTS projects_owner_idx ON csd_backup.projects(owner_id);
CREATE TABLE IF NOT EXISTS csd_backup.project_files (
  project_id uuid NOT NULL REFERENCES csd_backup.projects(id) ON DELETE CASCADE,
  path text NOT NULL, category text NOT NULL, sha256 text NOT NULL,
  content bytea NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, path)
);
CREATE TABLE IF NOT EXISTS csd_backup.project_records (
  project_id uuid NOT NULL REFERENCES csd_backup.projects(id) ON DELETE CASCADE,
  kind text NOT NULL, record_key text NOT NULL, payload jsonb NOT NULL,
  PRIMARY KEY (project_id, kind, record_key)
);
CREATE TABLE IF NOT EXISTS csd_backup.project_posts (
  project_id uuid NOT NULL REFERENCES csd_backup.projects(id) ON DELETE CASCADE,
  platform text NOT NULL, root_id text NOT NULL, first_run_id text NOT NULL,
  first_seen_at timestamptz NOT NULL, last_seen_at timestamptz NOT NULL,
  payload jsonb NOT NULL, assessment jsonb,
  PRIMARY KEY(project_id, platform, root_id)
);
CREATE TABLE IF NOT EXISTS csd_backup.project_run_posts (
  project_id uuid NOT NULL, run_id text NOT NULL, platform text NOT NULL, root_id text NOT NULL,
  previously_collected boolean NOT NULL,
  PRIMARY KEY(project_id, run_id, platform, root_id),
  FOREIGN KEY(project_id, platform, root_id) REFERENCES csd_backup.project_posts(project_id, platform, root_id) ON DELETE CASCADE
);
COMMENT ON TABLE csd_backup.project_files IS 'Complete restorable project data, including raw journals, run state, model responses, recipes, exports and consistent SQLite snapshots. Machine credentials are excluded.';
COMMENT ON TABLE csd_backup.project_records IS 'Queryable JSON documents mirrored from project files. SQLite records and canonical post identities remain in complete project snapshots.';
INSERT INTO csd_backup.schema_migrations(version) VALUES (1) ON CONFLICT DO NOTHING;
`;

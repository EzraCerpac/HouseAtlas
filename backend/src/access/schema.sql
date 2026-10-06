-- Published dedicated access database schema 1 (packages/access/src/store.mjs).
CREATE TABLE IF NOT EXISTS access_meta (
    id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL, epoch TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS access_users (
    user_id TEXT PRIMARY KEY, actor_id TEXT UNIQUE NOT NULL,
    username TEXT UNIQUE NOT NULL, verifier TEXT NOT NULL,
    enabled INTEGER NOT NULL, version INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS access_memberships (
    user_id TEXT NOT NULL REFERENCES access_users(user_id),
    workspace_id TEXT NOT NULL, home_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('viewer','editor')),
    enabled INTEGER NOT NULL, version INTEGER NOT NULL,
    PRIMARY KEY(user_id,workspace_id,home_id)
);
CREATE TABLE IF NOT EXISTS access_sessions (
    token_hash TEXT PRIMARY KEY, csrf_hash TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES access_users(user_id),
    user_version INTEGER NOT NULL, epoch TEXT NOT NULL, origin TEXT NOT NULL,
    created_at INTEGER NOT NULL, last_seen INTEGER NOT NULL, expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS access_sources (
    workspace_id TEXT NOT NULL, home_id TEXT NOT NULL,
    instance_id TEXT NOT NULL, collection_id TEXT NOT NULL,
    registration TEXT NOT NULL, enabled INTEGER NOT NULL, version INTEGER NOT NULL,
    PRIMARY KEY(workspace_id,home_id,instance_id,collection_id)
);
CREATE TABLE IF NOT EXISTS access_rates (
    bucket TEXT PRIMARY KEY, starts_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL, count INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS migrations(version INTEGER PRIMARY KEY, applied_at BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,name TEXT NOT NULL,password TEXT NOT NULL,role TEXT NOT NULL DEFAULT 'player',banned INTEGER NOT NULL DEFAULT 0,created BIGINT NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS users_name_unique ON users(lower(name));
CREATE UNIQUE INDEX IF NOT EXISTS single_owner ON users(role) WHERE role='superadmin';
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS wallets(user_id TEXT NOT NULL REFERENCES users(id),context TEXT NOT NULL,available BIGINT NOT NULL CHECK(available>=0),reserved BIGINT NOT NULL DEFAULT 0 CHECK(reserved>=0),PRIMARY KEY(user_id,context));
CREATE TABLE IF NOT EXISTS ledger(id TEXT PRIMARY KEY,at BIGINT NOT NULL,user_id TEXT NOT NULL REFERENCES users(id),context TEXT NOT NULL,delta BIGINT NOT NULL,reserved_delta BIGINT NOT NULL,reason TEXT NOT NULL,reference TEXT NOT NULL,UNIQUE(user_id,context,reason,reference));
CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY,name TEXT NOT NULL,status TEXT NOT NULL,"startingChips" BIGINT NOT NULL,stakes TEXT NOT NULL,games TEXT NOT NULL,created BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS event_options(event_id TEXT PRIMARY KEY REFERENCES events(id),starts_at BIGINT,ends_at BIGINT,participant_limit INTEGER);
CREATE TABLE IF NOT EXISTS rooms(id TEXT PRIMARY KEY,data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS actions(room_id TEXT NOT NULL,user_id TEXT NOT NULL,action_id TEXT NOT NULL,PRIMARY KEY(room_id,user_id,action_id));
CREATE TABLE IF NOT EXISTS audit(id TEXT PRIMARY KEY,at BIGINT NOT NULL,actor TEXT NOT NULL,action TEXT NOT NULL,target TEXT NOT NULL,detail TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS settings(id INTEGER PRIMARY KEY CHECK(id=1),data TEXT NOT NULL);
CREATE OR REPLACE FUNCTION venatus_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Ledger and audit are append-only'; END; $$;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='ledger_immutable') THEN
    CREATE TRIGGER ledger_immutable BEFORE UPDATE OR DELETE ON ledger FOR EACH ROW EXECUTE FUNCTION venatus_append_only();
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='audit_immutable') THEN
    CREATE TRIGGER audit_immutable BEFORE UPDATE OR DELETE ON audit FOR EACH ROW EXECUTE FUNCTION venatus_append_only();
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS ledger_context ON ledger(context,at);
CREATE INDEX IF NOT EXISTS rooms_status ON rooms((data::jsonb->>'status'));
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS event_metadata(event_id TEXT PRIMARY KEY REFERENCES events(id),data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS event_results(event_id TEXT PRIMARY KEY REFERENCES events(id),data TEXT NOT NULL);

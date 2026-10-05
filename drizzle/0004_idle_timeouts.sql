-- Serverless instances can go to sleep while holding database connections open, which fills the
-- connection pooler. Have Postgres close sessions for this role that sit idle, so slots free up on their own.
-- Best effort: skipped quietly if the role is not allowed to change its own defaults.
DO $$
BEGIN
  EXECUTE format('ALTER ROLE %I SET idle_session_timeout = %L', current_user, '60s');
  EXECUTE format('ALTER ROLE %I SET idle_in_transaction_session_timeout = %L', current_user, '60s');
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not set idle timeouts: %', SQLERRM;
END $$;

-- Tables created later by the migration owner are usable by the app roles without a per-migration grant.
-- (RLS still has to be enabled per table; tests/db/rls-catalog.test.ts enforces that.)
alter default privileges in schema public grant select, insert, update, delete on tables to app_user, app_admin;

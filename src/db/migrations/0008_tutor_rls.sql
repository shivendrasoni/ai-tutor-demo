-- Row-level security for the tutor tables (same pattern as 0006_content_rls.sql). Grants come from 0003 default privileges.
alter table conversations enable row level security;--> statement-breakpoint
alter table conversations force row level security;--> statement-breakpoint
create policy tenant_isolation on conversations using (school_id = nullif(current_setting('app.school_id', true), '')::uuid)
  with check (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
alter table messages enable row level security;--> statement-breakpoint
alter table messages force row level security;--> statement-breakpoint
create policy tenant_isolation on messages using (school_id = nullif(current_setting('app.school_id', true), '')::uuid)
  with check (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
alter table usage_daily enable row level security;--> statement-breakpoint
alter table usage_daily force row level security;--> statement-breakpoint
create policy tenant_isolation on usage_daily using (school_id = nullif(current_setting('app.school_id', true), '')::uuid)
  with check (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
-- skills is global reference data: tenant code (app_user) may read it but never write it.
revoke insert, update, delete on skills from app_user;

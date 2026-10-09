-- Row-level security: tenant isolation (fail closed when app.school_id is unset) + role grants.
alter table branches enable row level security;--> statement-breakpoint
alter table branches force row level security;--> statement-breakpoint
create policy tenant_isolation on branches using (school_id = nullif(current_setting('app.school_id', true), '')::uuid)
  with check (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint

alter table sections enable row level security;--> statement-breakpoint
alter table sections force row level security;--> statement-breakpoint
create policy tenant_isolation on sections using (school_id = nullif(current_setting('app.school_id', true), '')::uuid)
  with check (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint

alter table subjects enable row level security;--> statement-breakpoint
alter table subjects force row level security;--> statement-breakpoint
create policy tenant_isolation on subjects using (school_id = nullif(current_setting('app.school_id', true), '')::uuid)
  with check (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint

alter table memberships enable row level security;--> statement-breakpoint
alter table memberships force row level security;--> statement-breakpoint
create policy tenant_isolation on memberships using (school_id = nullif(current_setting('app.school_id', true), '')::uuid)
  with check (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint

alter table teacher_assignments enable row level security;--> statement-breakpoint
alter table teacher_assignments force row level security;--> statement-breakpoint
create policy tenant_isolation on teacher_assignments using (school_id = nullif(current_setting('app.school_id', true), '')::uuid)
  with check (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint

alter table student_profiles enable row level security;--> statement-breakpoint
alter table student_profiles force row level security;--> statement-breakpoint
create policy tenant_isolation on student_profiles using (school_id = nullif(current_setting('app.school_id', true), '')::uuid)
  with check (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint

alter table subscriptions enable row level security;--> statement-breakpoint
alter table subscriptions force row level security;--> statement-breakpoint
create policy tenant_isolation on subscriptions using (school_id = nullif(current_setting('app.school_id', true), '')::uuid)
  with check (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint

alter table payments enable row level security;--> statement-breakpoint
alter table payments force row level security;--> statement-breakpoint
create policy tenant_isolation on payments using (school_id = nullif(current_setting('app.school_id', true), '')::uuid)
  with check (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint

alter table invites enable row level security;--> statement-breakpoint
alter table invites force row level security;--> statement-breakpoint
create policy tenant_isolation on invites using (school_id = nullif(current_setting('app.school_id', true), '')::uuid)
  with check (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint

alter table schools enable row level security;--> statement-breakpoint
alter table schools force row level security;--> statement-breakpoint
create policy tenant_isolation on schools using (id = nullif(current_setting('app.school_id', true), '')::uuid)
  with check (id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint

grant usage on schema public to app_user, app_admin;--> statement-breakpoint
grant select, insert, update, delete on all tables in schema public to app_user, app_admin;--> statement-breakpoint
grant usage, select on all sequences in schema public to app_user, app_admin;--> statement-breakpoint
revoke update, delete on plans from app_user;

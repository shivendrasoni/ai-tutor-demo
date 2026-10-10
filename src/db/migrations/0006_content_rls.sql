-- Row-level security for the content tables (same pattern as 0001_rls.sql). Grants come from 0003 default privileges.
-- The chunk indexes (btree + HNSW cosine) are created by the generated schema migration.
alter table content_items enable row level security;--> statement-breakpoint
alter table content_items force row level security;--> statement-breakpoint
create policy tenant_isolation on content_items using (school_id = nullif(current_setting('app.school_id', true), '')::uuid)
  with check (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
alter table content_exclusions enable row level security;--> statement-breakpoint
alter table content_exclusions force row level security;--> statement-breakpoint
create policy tenant_isolation on content_exclusions using (school_id = nullif(current_setting('app.school_id', true), '')::uuid)
  with check (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
alter table content_chapters enable row level security;--> statement-breakpoint
alter table content_chapters force row level security;--> statement-breakpoint
create policy tenant_isolation on content_chapters using (school_id = nullif(current_setting('app.school_id', true), '')::uuid)
  with check (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
alter table chunks enable row level security;--> statement-breakpoint
alter table chunks force row level security;--> statement-breakpoint
create policy tenant_isolation on chunks using (school_id = nullif(current_setting('app.school_id', true), '')::uuid)
  with check (school_id = nullif(current_setting('app.school_id', true), '')::uuid);

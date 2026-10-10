-- Row-level security for the study tools tables (same pattern as 0008_tutor_rls.sql). Grants come from 0003 default privileges.
alter table artifacts enable row level security;--> statement-breakpoint
alter table artifacts force row level security;--> statement-breakpoint
create policy tenant_isolation on artifacts using (school_id = nullif(current_setting('app.school_id', true), '')::uuid)
  with check (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
alter table attempts enable row level security;--> statement-breakpoint
alter table attempts force row level security;--> statement-breakpoint
create policy tenant_isolation on attempts using (school_id = nullif(current_setting('app.school_id', true), '')::uuid)
  with check (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
-- exam_patterns is global reference data: tenant code (app_user) may read it but never write it.
revoke insert, update, delete on exam_patterns from app_user;--> statement-breakpoint
insert into exam_patterns (key, name, grade_min, grade_max, duration_minutes, sections) values
  ('standard_80', 'Standard exam (80 marks)', 9, 12, 180, '[
    {"key":"A","title":"Section A","questionType":"mcq","count":20,"marksEach":1},
    {"key":"B","title":"Section B","questionType":"short","count":5,"marksEach":2},
    {"key":"C","title":"Section C","questionType":"short","count":6,"marksEach":3},
    {"key":"D","title":"Section D","questionType":"long","count":4,"marksEach":5},
    {"key":"E","title":"Section E","questionType":"case","count":3,"marksEach":4}]'::jsonb),
  ('junior_50', 'Junior exam (50 marks)', 5, 8, 120, '[
    {"key":"A","title":"Section A","questionType":"mcq","count":10,"marksEach":1},
    {"key":"B","title":"Section B","questionType":"short","count":10,"marksEach":2},
    {"key":"C","title":"Section C","questionType":"long","count":4,"marksEach":5}]'::jsonb);

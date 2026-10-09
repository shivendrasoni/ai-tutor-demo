CREATE TABLE "chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"content_item_id" uuid NOT NULL,
	"chapter_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"page_start" integer NOT NULL,
	"page_end" integer NOT NULL,
	"text" text NOT NULL,
	"token_estimate" integer NOT NULL,
	"embedding" vector(1536),
	"embedding_model" text,
	"embedding_dim" integer
);
--> statement-breakpoint
CREATE TABLE "content_chapters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"content_item_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"title" text NOT NULL,
	"page_start" integer NOT NULL,
	"page_end" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_exclusions" (
	"school_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"content_item_id" uuid NOT NULL,
	CONSTRAINT "content_exclusions_branch_id_content_item_id_pk" PRIMARY KEY("branch_id","content_item_id")
);
--> statement-breakpoint
CREATE TABLE "content_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"grade" integer NOT NULL,
	"subject_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"scope" text NOT NULL,
	"branch_id" uuid,
	"section_id" uuid,
	"title" text NOT NULL,
	"file_key" text NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"ingest_status" text DEFAULT 'queued' NOT NULL,
	"ingest_error" text,
	"page_count" integer,
	"ocr_pages" integer DEFAULT 0 NOT NULL,
	"ocr_skipped_pages" integer DEFAULT 0 NOT NULL,
	"size_bytes" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_items_grade_check" CHECK ("content_items"."grade" between 5 and 12),
	CONSTRAINT "content_items_kind_check" CHECK ("content_items"."kind" in ('book','material')),
	CONSTRAINT "content_items_scope_values_check" CHECK ("content_items"."scope" in ('school','branch','section')),
	CONSTRAINT "content_items_ingest_status_check" CHECK ("content_items"."ingest_status" in ('queued','processing','ready','failed')),
	CONSTRAINT "content_items_scope_check" CHECK (("content_items"."scope" = 'school' and "content_items"."branch_id" is null and "content_items"."section_id" is null)
        or ("content_items"."scope" = 'branch' and "content_items"."branch_id" is not null and "content_items"."section_id" is null)
        or ("content_items"."scope" = 'section' and "content_items"."branch_id" is not null and "content_items"."section_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "chunks" ADD CONSTRAINT "chunks_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chunks" ADD CONSTRAINT "chunks_content_item_id_content_items_id_fk" FOREIGN KEY ("content_item_id") REFERENCES "public"."content_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chunks" ADD CONSTRAINT "chunks_chapter_id_content_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."content_chapters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_chapters" ADD CONSTRAINT "content_chapters_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_chapters" ADD CONSTRAINT "content_chapters_content_item_id_content_items_id_fk" FOREIGN KEY ("content_item_id") REFERENCES "public"."content_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_exclusions" ADD CONSTRAINT "content_exclusions_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_exclusions" ADD CONSTRAINT "content_exclusions_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_exclusions" ADD CONSTRAINT "content_exclusions_content_item_id_content_items_id_fk" FOREIGN KEY ("content_item_id") REFERENCES "public"."content_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_section_id_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."sections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chunks_school_item_idx" ON "chunks" USING btree ("school_id","content_item_id");--> statement-breakpoint
CREATE INDEX "chunks_embedding_hnsw_idx" ON "chunks" USING hnsw ("embedding" vector_cosine_ops);
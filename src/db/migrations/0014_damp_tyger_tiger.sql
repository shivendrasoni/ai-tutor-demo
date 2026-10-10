ALTER TABLE "content_items" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
UPDATE "content_items" SET "updated_at" = "created_at";
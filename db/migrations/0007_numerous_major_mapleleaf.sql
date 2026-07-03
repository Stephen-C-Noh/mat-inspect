DROP TYPE "public"."checklist_item_type";--> statement-breakpoint
CREATE TYPE "public"."checklist_item_type" AS ENUM('BOOLEAN', 'BOOLEAN_PHOTO_ON_FAIL', 'TEXT');
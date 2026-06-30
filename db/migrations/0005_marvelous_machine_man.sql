CREATE TYPE "public"."defect_status" AS ENUM('OPEN', 'ACKNOWLEDGED', 'IN_REPAIR', 'RESOLVED', 'REJECTED');--> statement-breakpoint
CREATE TABLE "defects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"inspection_id" uuid NOT NULL,
	"equipment_id" uuid NOT NULL,
	"item_key" text NOT NULL,
	"severity" "fail_severity" NOT NULL,
	"description" text NOT NULL,
	"photo_ids" uuid[] DEFAULT '{}' NOT NULL,
	"status" "defect_status" DEFAULT 'OPEN' NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" uuid,
	"resolution_notes" text,
	"return_to_service_approved_by" uuid
);
--> statement-breakpoint
ALTER TABLE "equipment" ADD COLUMN "readiness_baseline_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "defects" ADD CONSTRAINT "defects_inspection_id_inspections_id_fk" FOREIGN KEY ("inspection_id") REFERENCES "public"."inspections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "defects" ADD CONSTRAINT "defects_equipment_id_equipment_id_fk" FOREIGN KEY ("equipment_id") REFERENCES "public"."equipment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "defects" ADD CONSTRAINT "defects_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "defects" ADD CONSTRAINT "defects_return_to_service_approved_by_users_id_fk" FOREIGN KEY ("return_to_service_approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
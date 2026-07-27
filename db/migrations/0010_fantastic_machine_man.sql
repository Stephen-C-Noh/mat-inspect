CREATE TABLE "notification_dismissals" (
	"user_id" uuid NOT NULL,
	"inspection_id" uuid NOT NULL,
	"dismissed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_dismissals_user_id_inspection_id_pk" PRIMARY KEY("user_id","inspection_id")
);
--> statement-breakpoint
ALTER TABLE "notification_dismissals" ADD CONSTRAINT "notification_dismissals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_dismissals" ADD CONSTRAINT "notification_dismissals_inspection_id_inspections_id_fk" FOREIGN KEY ("inspection_id") REFERENCES "public"."inspections"("id") ON DELETE no action ON UPDATE no action;
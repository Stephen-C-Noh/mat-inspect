CREATE TYPE "public"."equipment_status" AS ENUM('READY', 'AWAITING_INSPECTION', 'OUT_OF_SERVICE', 'RETIRED');--> statement-breakpoint
CREATE TYPE "public"."equipment_type" AS ENUM('OVERHEAD_CRANE', 'TRUCK', 'PALLET_JACK', 'FORKLIFT');--> statement-breakpoint
CREATE TABLE "equipment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_tag" text NOT NULL,
	"name" text NOT NULL,
	"type" "equipment_type" NOT NULL,
	"status" "equipment_status" DEFAULT 'AWAITING_INSPECTION' NOT NULL,
	"location" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "equipment_asset_tag_unique" UNIQUE("asset_tag")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"email" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);

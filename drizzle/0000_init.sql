CREATE TYPE "public"."priority" AS ENUM('urgent', 'high', 'normal', 'low');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('owner', 'lead', 'csm', 'implementer', 'client');--> statement-breakpoint
CREATE TYPE "public"."request_status" AS ENUM('submitted', 'triaged', 'scoped', 'assigned', 'in_progress', 'waiting', 'qa', 'delivered', 'closed', 'cancelled');--> statement-breakpoint
CREATE TABLE "comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"author_id" uuid,
	"author_name" text NOT NULL,
	"body" text NOT NULL,
	"internal" boolean DEFAULT false NOT NULL,
	"from_client" boolean DEFAULT false NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "escalations" (
	"key" text PRIMARY KEY NOT NULL,
	"request_id" uuid NOT NULL,
	"level" integer NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"to_id" uuid NOT NULL,
	"text" text NOT NULL,
	"request_id" uuid,
	"kind" text NOT NULL,
	"by_name" text DEFAULT 'Mainline' NOT NULL,
	"read" boolean DEFAULT false NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org_prices" (
	"org_id" uuid PRIMARY KEY NOT NULL,
	"monthly_price" numeric NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orgs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"platform" text NOT NULL,
	"pod_id" uuid,
	"plan" text DEFAULT 'Growth' NOT NULL,
	"monthly_credits" integer DEFAULT 0 NOT NULL,
	"credits" integer DEFAULT 0 NOT NULL,
	"credits_period" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"csm_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"role" "role" NOT NULL,
	"org_id" uuid,
	"pod_id" uuid,
	"platforms" text[] DEFAULT '{}' NOT NULL,
	"capacity" integer DEFAULT 30 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profiles_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" text NOT NULL,
	"window_start" bigint NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "rate_limits_key_window_start_pk" PRIMARY KEY("key","window_start")
);
--> statement-breakpoint
CREATE TABLE "request_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"actor_id" uuid,
	"actor_name" text NOT NULL,
	"type" text NOT NULL,
	"from_status" text,
	"to_status" text,
	"text" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"num" serial NOT NULL,
	"org_id" uuid NOT NULL,
	"sku_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"priority" "priority" DEFAULT 'normal' NOT NULL,
	"status" "request_status" DEFAULT 'submitted' NOT NULL,
	"source" text DEFAULT 'Client portal' NOT NULL,
	"contact" text DEFAULT '' NOT NULL,
	"submitted_by" uuid,
	"submitted_by_name" text DEFAULT '' NOT NULL,
	"assignee_id" uuid,
	"qa_id" uuid,
	"credits" integer DEFAULT 0 NOT NULL,
	"sla_hours" integer,
	"est_hours" numeric,
	"first_response_at" timestamp with time zone,
	"scoped_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"paused_at" timestamp with time zone,
	"paused_biz_ms" bigint DEFAULT 0 NOT NULL,
	"delivered_at" timestamp with time zone,
	"auto_accept_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"qa_fails" integer DEFAULT 0 NOT NULL,
	"revisions" integer DEFAULT 0 NOT NULL,
	"unhappy" boolean DEFAULT false NOT NULL,
	"needs_lead" boolean DEFAULT false NOT NULL,
	"ai" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"sla_mode" text DEFAULT 'business' NOT NULL,
	"biz_start" integer DEFAULT 9 NOT NULL,
	"biz_end" integer DEFAULT 18 NOT NULL,
	"auto_reset" boolean DEFAULT true NOT NULL,
	"last_sweep_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "skus" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"platform" text NOT NULL,
	"category" text DEFAULT 'General' NOT NULL,
	"credits" integer DEFAULT 0 NOT NULL,
	"est_hours" numeric DEFAULT 0 NOT NULL,
	"sla_hours" integer DEFAULT 16 NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"qa" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff_rates" (
	"profile_id" uuid PRIMARY KEY NOT NULL,
	"hourly_rate" numeric NOT NULL
);
--> statement-breakpoint
CREATE TABLE "timelogs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"sku_id" text NOT NULL,
	"staff_id" uuid NOT NULL,
	"hours" numeric NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"work_date" date NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "comments_request_idx" ON "comments" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "notifications_to_idx" ON "notifications" USING btree ("to_id","read");--> statement-breakpoint
CREATE INDEX "events_request_idx" ON "request_events" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "requests_org_idx" ON "requests" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "requests_status_idx" ON "requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "timelogs_request_idx" ON "timelogs" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "timelogs_date_idx" ON "timelogs" USING btree ("work_date");
CREATE TABLE "attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"mime" text,
	"size" integer,
	"path" text,
	"url" text,
	"internal" boolean DEFAULT false NOT NULL,
	"from_client" boolean DEFAULT false NOT NULL,
	"uploaded_by" uuid,
	"uploaded_by_name" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "attachments_request_idx" ON "attachments" USING btree ("request_id");--> statement-breakpoint
-- Row Level Security: clients read their own company's non-internal attachments; staff read all; nobody writes directly.
ALTER TABLE public.attachments ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.attachments FROM anon, authenticated;--> statement-breakpoint
REVOKE ALL ON public.attachments FROM anon;--> statement-breakpoint
GRANT SELECT ON public.attachments TO authenticated;--> statement-breakpoint
CREATE POLICY attachments_read ON public.attachments FOR SELECT TO authenticated
  USING (
    public.viewer_is_staff()
    OR (NOT internal AND EXISTS (
      SELECT 1 FROM public.requests r WHERE r.id = request_id AND r.org_id = public.viewer_org()
    ))
  );

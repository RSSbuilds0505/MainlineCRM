-- Additive only: existing accounts remain retainers and retain all credits/history.
ALTER TABLE public.orgs ADD COLUMN billing_model text NOT NULL DEFAULT 'retainer';
--> statement-breakpoint
ALTER TABLE public.orgs ADD COLUMN contracted_hours numeric NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE public.orgs ADD CONSTRAINT orgs_billing_model_check CHECK (billing_model IN ('retainer', 'project'));
--> statement-breakpoint
ALTER TABLE public.orgs ADD CONSTRAINT orgs_contracted_hours_check CHECK (contracted_hours >= 0 AND contracted_hours <= 1000000);
--> statement-breakpoint
CREATE TABLE public.project_prices (org_id uuid PRIMARY KEY REFERENCES public.orgs(id), hourly_rate numeric NOT NULL CHECK (hourly_rate >= 0 AND hourly_rate <= 1000000));
--> statement-breakpoint
ALTER TABLE public.project_prices ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON public.project_prices FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT ON public.project_prices TO authenticated;
--> statement-breakpoint
CREATE POLICY project_prices_read ON public.project_prices FOR SELECT TO authenticated USING (public.viewer_role() = 'owner');

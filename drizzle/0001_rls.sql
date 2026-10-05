-- Row Level Security for every table.
-- The app reads and writes through a server-side database connection and checks roles in code.
-- These policies are the second line of defense: anyone holding the public anon key can read
-- only what their role allows and can never write directly.

CREATE OR REPLACE FUNCTION public.viewer_role() RETURNS text
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
$$ SELECT role::text FROM public.profiles WHERE id = auth.uid() AND active $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.viewer_org() RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
$$ SELECT org_id FROM public.profiles WHERE id = auth.uid() AND active AND role = 'client' $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.viewer_is_staff() RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
$$ SELECT coalesce(public.viewer_role() IN ('owner','lead','csm','implementer'), false) $$;
--> statement-breakpoint
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.pods ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.orgs ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.skus ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.requests ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.request_events ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.comments ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.timelogs ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.escalations ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.staff_rates ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.org_prices ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public FROM anon, authenticated;--> statement-breakpoint
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;--> statement-breakpoint
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;--> statement-breakpoint

CREATE POLICY profiles_read ON public.profiles FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.viewer_is_staff());--> statement-breakpoint
CREATE POLICY pods_read ON public.pods FOR SELECT TO authenticated
  USING (public.viewer_is_staff());--> statement-breakpoint
CREATE POLICY orgs_read ON public.orgs FOR SELECT TO authenticated
  USING (public.viewer_is_staff() OR id = public.viewer_org());--> statement-breakpoint
CREATE POLICY skus_read ON public.skus FOR SELECT TO authenticated
  USING (public.viewer_role() IS NOT NULL);--> statement-breakpoint
CREATE POLICY requests_read ON public.requests FOR SELECT TO authenticated
  USING (public.viewer_is_staff() OR org_id = public.viewer_org());--> statement-breakpoint
CREATE POLICY events_read ON public.request_events FOR SELECT TO authenticated
  USING (public.viewer_is_staff());--> statement-breakpoint
CREATE POLICY comments_read ON public.comments FOR SELECT TO authenticated
  USING (
    public.viewer_is_staff()
    OR (NOT internal AND EXISTS (
      SELECT 1 FROM public.requests r WHERE r.id = request_id AND r.org_id = public.viewer_org()
    ))
  );--> statement-breakpoint
CREATE POLICY timelogs_read ON public.timelogs FOR SELECT TO authenticated
  USING (public.viewer_is_staff());--> statement-breakpoint
CREATE POLICY notifications_read ON public.notifications FOR SELECT TO authenticated
  USING (to_id = auth.uid());--> statement-breakpoint
CREATE POLICY escalations_read ON public.escalations FOR SELECT TO authenticated
  USING (public.viewer_is_staff());--> statement-breakpoint
CREATE POLICY settings_read ON public.settings FOR SELECT TO authenticated
  USING (public.viewer_role() IS NOT NULL);--> statement-breakpoint
CREATE POLICY staff_rates_read ON public.staff_rates FOR SELECT TO authenticated
  USING (public.viewer_role() = 'owner');--> statement-breakpoint
CREATE POLICY org_prices_read ON public.org_prices FOR SELECT TO authenticated
  USING (public.viewer_role() = 'owner');--> statement-breakpoint
-- rate_limits: no policy, so nobody outside the server can read it.

INSERT INTO public.settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

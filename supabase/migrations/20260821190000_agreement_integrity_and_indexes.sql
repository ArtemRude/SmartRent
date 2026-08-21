-- Tenants can see property details only while a lease is currently active.
-- Historical agreements and their PDFs remain available through lease-specific policies.
CREATE OR REPLACE FUNCTION public.tenant_can_see_property(_property_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.lease_agreements la
    JOIN public.tenants t ON t.id = la.tenant_id
    WHERE la.property_id = _property_id
      AND t.user_id = auth.uid()
      AND la.status = 'active'
      AND CURRENT_DATE BETWEEN la.start_date AND la.end_date
  );
$$;

REVOKE EXECUTE ON FUNCTION public.tenant_can_see_property(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tenant_can_see_property(uuid) TO authenticated;

ALTER TABLE public.lease_agreements
  ADD CONSTRAINT lease_dates_are_valid CHECK (end_date >= start_date) NOT VALID,
  ADD CONSTRAINT lease_payment_is_nonnegative CHECK (monthly_payment >= 0) NOT VALID,
  ADD CONSTRAINT lease_status_is_known CHECK (status IN ('active', 'archived')) NOT VALID;

CREATE INDEX IF NOT EXISTS properties_owner_id_idx ON public.properties(owner_id);
CREATE INDEX IF NOT EXISTS units_property_id_idx ON public.units(property_id);
CREATE INDEX IF NOT EXISTS tenants_owner_id_idx ON public.tenants(owner_id);
CREATE INDEX IF NOT EXISTS tenants_user_id_idx ON public.tenants(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS tenants_owner_email_lower_idx
  ON public.tenants(owner_id, lower(email)) WHERE email <> '';
CREATE INDEX IF NOT EXISTS leases_owner_id_idx ON public.lease_agreements(owner_id);
CREATE INDEX IF NOT EXISTS leases_property_id_idx ON public.lease_agreements(property_id);
CREATE INDEX IF NOT EXISTS leases_tenant_id_idx ON public.lease_agreements(tenant_id);
CREATE INDEX IF NOT EXISTS leases_end_date_active_idx
  ON public.lease_agreements(end_date) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS requests_owner_status_idx ON public.requests(owner_id, status);
CREATE INDEX IF NOT EXISTS requests_tenant_id_idx ON public.requests(tenant_id);
CREATE INDEX IF NOT EXISTS requests_property_id_idx
  ON public.requests(property_id) WHERE property_id IS NOT NULL;

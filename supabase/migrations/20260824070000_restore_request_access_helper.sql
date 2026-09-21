-- Some existing projects have the early migration recorded in their history
-- without this helper being present in the schema. Restore it before the
-- request status history migration creates policies that depend on it.
CREATE OR REPLACE FUNCTION public.can_see_request(_request_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.requests AS r
    LEFT JOIN public.tenants AS t ON t.id = r.tenant_id
    WHERE r.id = _request_id
      AND (
        r.owner_id = (SELECT auth.uid())
        OR t.user_id = (SELECT auth.uid())
      )
  );
$function$;

REVOKE EXECUTE ON FUNCTION public.can_see_request(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_see_request(uuid)
  TO authenticated;

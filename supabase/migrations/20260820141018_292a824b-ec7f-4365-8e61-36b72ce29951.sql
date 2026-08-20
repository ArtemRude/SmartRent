
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_my_tenant_record(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.owns_property(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.tenant_can_see_property(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.can_see_request(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_my_tenant_record(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.owns_property(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tenant_can_see_property(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_see_request(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.link_tenant_user() FROM PUBLIC, anon, authenticated;

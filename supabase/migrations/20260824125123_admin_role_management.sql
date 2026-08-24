-- Keep one effective application role per user so route guards and RLS agree.
DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'user_roles_user_id_key'
      AND conrelid = 'public.user_roles'::regclass
  ) THEN
    ALTER TABLE public.user_roles
      ADD CONSTRAINT user_roles_user_id_key UNIQUE (user_id);
  END IF;
END
$migration$;

-- The browser client may only read roles and update an existing role.
-- Inserts remain owned by the auth signup trigger; deletes remain unavailable.
REVOKE ALL ON TABLE public.user_roles FROM anon;
REVOKE INSERT, DELETE ON TABLE public.user_roles FROM authenticated;
GRANT SELECT, UPDATE ON TABLE public.user_roles TO authenticated;

DROP POLICY IF EXISTS "user_roles_admin_update" ON public.user_roles;
CREATE POLICY "user_roles_admin_update"
  ON public.user_roles
  FOR UPDATE
  TO authenticated
  USING (public.has_role((SELECT auth.uid()), 'admin'))
  WITH CHECK (public.has_role((SELECT auth.uid()), 'admin'));

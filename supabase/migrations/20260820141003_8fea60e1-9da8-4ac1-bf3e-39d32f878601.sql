
CREATE TYPE public.app_role AS ENUM ('admin','owner','tenant');
CREATE TYPE public.property_type AS ENUM ('apartment','warehouse','commercial','other');
CREATE TYPE public.request_category AS ENUM ('repair','question','payment','other');
CREATE TYPE public.request_status AS ENUM ('new','in_progress','closed');

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  phone text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

CREATE TABLE public.properties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  type public.property_type NOT NULL DEFAULT 'apartment',
  address text NOT NULL DEFAULT '',
  description text,
  photos text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.properties TO authenticated;
GRANT ALL ON public.properties TO service_role;
ALTER TABLE public.properties ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  name text NOT NULL,
  area numeric,
  status text NOT NULL DEFAULT 'vacant',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.units TO authenticated;
GRANT ALL ON public.units TO service_role;
ALTER TABLE public.units ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  name text NOT NULL,
  email text NOT NULL DEFAULT '',
  phone text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenants TO authenticated;
GRANT ALL ON public.tenants TO service_role;
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.lease_agreements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  unit_id uuid REFERENCES public.units(id) ON DELETE SET NULL,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  start_date date NOT NULL,
  end_date date NOT NULL,
  monthly_payment numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active',
  document_file text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lease_agreements TO authenticated;
GRANT ALL ON public.lease_agreements TO service_role;
ALTER TABLE public.lease_agreements ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  property_id uuid REFERENCES public.properties(id) ON DELETE SET NULL,
  unit_id uuid REFERENCES public.units(id) ON DELETE SET NULL,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  category public.request_category NOT NULL DEFAULT 'other',
  photo text,
  status public.request_status NOT NULL DEFAULT 'new',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.requests TO authenticated;
GRANT ALL ON public.requests TO service_role;
ALTER TABLE public.requests ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.requests(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.comments TO authenticated;
GRANT ALL ON public.comments TO service_role;
ALTER TABLE public.comments ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_my_tenant_record(_tenant_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = _tenant_id AND t.user_id = auth.uid());
$$;

CREATE OR REPLACE FUNCTION public.owns_property(_property_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.properties p WHERE p.id = _property_id AND p.owner_id = auth.uid());
$$;

CREATE OR REPLACE FUNCTION public.tenant_can_see_property(_property_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.lease_agreements la
    JOIN public.tenants t ON t.id = la.tenant_id
    WHERE la.property_id = _property_id AND t.user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.can_see_request(_request_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.requests r
    LEFT JOIN public.tenants t ON t.id = r.tenant_id
    WHERE r.id = _request_id AND (r.owner_id = auth.uid() OR t.user_id = auth.uid())
  );
$$;

CREATE POLICY "profiles_select_self_or_admin" ON public.profiles FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "profiles_insert_self" ON public.profiles FOR INSERT TO authenticated WITH CHECK (id = auth.uid());
CREATE POLICY "profiles_update_self" ON public.profiles FOR UPDATE TO authenticated
  USING (id = auth.uid() OR public.has_role(auth.uid(),'admin')) WITH CHECK (true);

CREATE POLICY "user_roles_select_self_or_admin" ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin'));

CREATE POLICY "properties_owner_all" ON public.properties FOR ALL TO authenticated
  USING (owner_id = auth.uid() OR public.has_role(auth.uid(),'admin'))
  WITH CHECK (owner_id = auth.uid() OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "properties_tenant_select" ON public.properties FOR SELECT TO authenticated
  USING (public.tenant_can_see_property(id));

CREATE POLICY "units_owner_all" ON public.units FOR ALL TO authenticated
  USING (public.owns_property(property_id) OR public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.owns_property(property_id) OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "units_tenant_select" ON public.units FOR SELECT TO authenticated
  USING (public.tenant_can_see_property(property_id));

CREATE POLICY "tenants_owner_all" ON public.tenants FOR ALL TO authenticated
  USING (owner_id = auth.uid() OR public.has_role(auth.uid(),'admin'))
  WITH CHECK (owner_id = auth.uid() OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "tenants_self_select" ON public.tenants FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "leases_owner_all" ON public.lease_agreements FOR ALL TO authenticated
  USING (owner_id = auth.uid() OR public.has_role(auth.uid(),'admin'))
  WITH CHECK (owner_id = auth.uid() OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "leases_tenant_select" ON public.lease_agreements FOR SELECT TO authenticated
  USING (public.is_my_tenant_record(tenant_id));

CREATE POLICY "requests_owner_all" ON public.requests FOR ALL TO authenticated
  USING (owner_id = auth.uid() OR public.has_role(auth.uid(),'admin'))
  WITH CHECK (owner_id = auth.uid() OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "requests_tenant_select" ON public.requests FOR SELECT TO authenticated
  USING (public.is_my_tenant_record(tenant_id));
CREATE POLICY "requests_tenant_insert" ON public.requests FOR INSERT TO authenticated
  WITH CHECK (public.is_my_tenant_record(tenant_id));

CREATE POLICY "comments_select" ON public.comments FOR SELECT TO authenticated
  USING (public.can_see_request(request_id) OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "comments_insert" ON public.comments FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND public.can_see_request(request_id));
CREATE POLICY "comments_delete_own" ON public.comments FOR DELETE TO authenticated
  USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _role public.app_role;
BEGIN
  INSERT INTO public.profiles (id, name, email, phone)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'name', split_part(COALESCE(NEW.email,''),'@',1)),
    COALESCE(NEW.email,''),
    NEW.raw_user_meta_data->>'phone'
  )
  ON CONFLICT (id) DO NOTHING;

  _role := COALESCE(NULLIF(NEW.raw_user_meta_data->>'role',''), 'owner')::public.app_role;
  IF _role = 'admin' THEN _role := 'owner'; END IF;

  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, _role)
  ON CONFLICT (user_id, role) DO NOTHING;

  UPDATE public.tenants SET user_id = NEW.id
  WHERE user_id IS NULL AND lower(email) = lower(COALESCE(NEW.email,''));

  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE OR REPLACE FUNCTION public.link_tenant_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.user_id IS NULL AND COALESCE(NEW.email,'') <> '' THEN
    SELECT id INTO NEW.user_id FROM auth.users WHERE lower(email) = lower(NEW.email) LIMIT 1;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER tenants_link_user
BEFORE INSERT OR UPDATE ON public.tenants
FOR EACH ROW EXECUTE FUNCTION public.link_tenant_user();

CREATE POLICY "media_read_authenticated" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id IN ('property-photos','request-photos'));
CREATE POLICY "media_upload_authenticated" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id IN ('property-photos','request-photos'));
CREATE POLICY "media_delete_own" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id IN ('property-photos','request-photos') AND owner = auth.uid());

CREATE POLICY "lease_docs_insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'lease-documents' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "lease_docs_owner_select" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'lease-documents' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "lease_docs_owner_delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'lease-documents' AND (storage.foldername(name))[1] = auth.uid()::text);

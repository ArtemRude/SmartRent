-- Team access is an explicit operational workspace. Existing application roles,
-- ownership helpers, financial RPCs and document/storage policies stay authoritative.
SET lock_timeout = '5s';
SET statement_timeout = '30s';

CREATE TABLE public.team_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL CHECK (email = lower(btrim(email)) AND length(email) BETWEEN 3 AND 254),
  role text NOT NULL CHECK (role IN ('manager', 'viewer')),
  status text NOT NULL DEFAULT 'invited' CHECK (status IN ('invited', 'active', 'revoked')),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  token_hash text CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '7 days',
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  joined_at timestamptz,
  CHECK (user_id IS NULL OR user_id <> owner_id),
  CHECK (status = 'invited' OR token_hash IS NULL)
);
CREATE UNIQUE INDEX team_memberships_open_email_idx ON public.team_memberships(owner_id,email) WHERE status <> 'revoked';
CREATE UNIQUE INDEX team_memberships_active_user_idx ON public.team_memberships(owner_id,user_id) WHERE status = 'active';
CREATE UNIQUE INDEX team_memberships_token_idx ON public.team_memberships(token_hash) WHERE token_hash IS NOT NULL;
CREATE INDEX team_memberships_owner_created_idx ON public.team_memberships(owner_id,created_at DESC,id);
CREATE INDEX team_memberships_user_idx ON public.team_memberships(user_id) WHERE user_id IS NOT NULL;
CREATE TABLE public.team_property_access (
  membership_id uuid NOT NULL REFERENCES public.team_memberships(id) ON DELETE CASCADE,
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  PRIMARY KEY (membership_id,property_id)
);
CREATE INDEX team_property_access_property_idx ON public.team_property_access(property_id,membership_id);
CREATE TABLE public.team_property_responsibles (
  property_id uuid PRIMARY KEY REFERENCES public.properties(id) ON DELETE CASCADE,
  membership_id uuid NOT NULL REFERENCES public.team_memberships(id) ON DELETE CASCADE
);
CREATE INDEX team_property_responsibles_member_idx ON public.team_property_responsibles(membership_id);
CREATE TABLE public.team_activity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Historical IDs deliberately survive deletion of a property or membership.
  property_id uuid,
  membership_id uuid,
  action text NOT NULL CHECK (action IN ('invitation_created','invitation_accepted','member_updated','member_revoked','responsible_changed','property_note','request_status','request_comment')),
  detail jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(detail) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX team_activity_owner_created_idx ON public.team_activity(owner_id,created_at DESC,id DESC);
CREATE INDEX team_activity_property_created_idx ON public.team_activity(property_id,created_at DESC,id DESC) WHERE property_id IS NOT NULL;
CREATE INDEX team_activity_actor_idx ON public.team_activity(actor_id) WHERE actor_id IS NOT NULL;
ALTER TABLE public.team_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_property_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_property_responsibles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_activity ENABLE ROW LEVEL SECURITY;
-- No direct Data API access, including to invitation digests. Narrow authenticated
-- RPCs below are the only client interface; RLS also defaults to denying all rows.
REVOKE ALL ON public.team_memberships,public.team_property_access,public.team_property_responsibles,public.team_activity FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.team_memberships,public.team_property_access,public.team_property_responsibles,public.team_activity TO service_role;

CREATE FUNCTION private.team_has_access(p_property_id uuid,p_write boolean DEFAULT false)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.properties p WHERE p.id=p_property_id AND (
      p.owner_id=auth.uid() OR EXISTS (
        SELECT 1 FROM public.team_memberships m JOIN public.team_property_access g ON g.membership_id=m.id
        WHERE g.property_id=p.id AND m.owner_id=p.owner_id AND m.user_id=auth.uid()
          AND m.status='active' AND (NOT p_write OR m.role='manager')
      )
    )
  );
$$;
REVOKE ALL ON FUNCTION private.team_has_access(uuid,boolean) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.invite_team_member(p_email text,p_role text,p_property_ids uuid[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_uid uuid:=auth.uid(); v_email text:=lower(btrim(p_email)); v_member public.team_memberships;
  v_token text; v_properties uuid[]; v_names text[];
BEGIN
  IF v_uid IS NULL OR NOT (private.has_role(v_uid,'owner') OR private.has_role(v_uid,'admin')) THEN
    RAISE EXCEPTION 'Приглашать сотрудников может собственник' USING ERRCODE='42501'; END IF;
  IF v_email IS NULL OR length(v_email)>254 OR v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    OR p_role IS NULL OR p_role NOT IN ('manager','viewer') THEN
    RAISE EXCEPTION 'Проверьте email и роль сотрудника' USING ERRCODE='22023'; END IF;
  IF EXISTS(SELECT 1 FROM auth.users WHERE id=v_uid AND lower(email)=v_email) THEN
    RAISE EXCEPTION 'Нельзя пригласить себя' USING ERRCODE='22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('team:'||v_uid::text,0));
  SELECT array_agg(DISTINCT x ORDER BY x) INTO v_properties FROM unnest(p_property_ids) x;
  IF coalesce(cardinality(v_properties),0)=0 OR cardinality(v_properties)>100 OR array_position(v_properties,NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'Выберите от 1 до 100 объектов' USING ERRCODE='22023'; END IF;
  PERFORM 1 FROM public.properties WHERE id=ANY(v_properties) ORDER BY id FOR SHARE;
  IF (SELECT count(*) FROM public.properties WHERE id=ANY(v_properties) AND owner_id=v_uid)<>cardinality(v_properties) THEN
    RAISE EXCEPTION 'Можно передать доступ только к своим объектам' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_member FROM public.team_memberships WHERE owner_id=v_uid AND email=v_email AND status<>'revoked' FOR UPDATE;
  IF v_member.status='active' THEN RAISE EXCEPTION 'Сотрудник уже в команде. Измените его доступ' USING ERRCODE='22023'; END IF;
  -- Two independently generated UUIDs provide 244 random bits without requiring an extension.
  v_token:=replace(gen_random_uuid()::text||gen_random_uuid()::text,'-','');
  IF v_member.id IS NULL THEN
    INSERT INTO public.team_memberships(owner_id,email,role,token_hash)
    VALUES(v_uid,v_email,p_role,encode(sha256(convert_to(v_token,'UTF8')),'hex')) RETURNING * INTO v_member;
  ELSE
    UPDATE public.team_memberships SET role=p_role,token_hash=encode(sha256(convert_to(v_token,'UTF8')),'hex'),
      expires_at=now()+interval '7 days',revision=revision+1 WHERE id=v_member.id RETURNING * INTO v_member;
  END IF;
  DELETE FROM public.team_property_access WHERE membership_id=v_member.id;
  INSERT INTO public.team_property_access SELECT v_member.id,x FROM unnest(v_properties) x;
  SELECT array_agg(name ORDER BY name) INTO v_names FROM public.properties WHERE id=ANY(v_properties);
  INSERT INTO public.team_activity(owner_id,actor_id,membership_id,action,detail) VALUES
    (v_uid,v_uid,v_member.id,'invitation_created',jsonb_build_object('email',v_email,'role',p_role,'property_names',v_names));
  RETURN jsonb_build_object('membership_id',v_member.id,'token',v_token,'expires_at',v_member.expires_at);
END;
$$;

CREATE FUNCTION private.accept_team_invitation(p_token text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_uid uuid:=auth.uid(); v_member public.team_memberships; v_owner uuid;
BEGIN
  IF v_uid IS NULL OR p_token IS NULL OR p_token !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Приглашение недействительно или истекло' USING ERRCODE='42501'; END IF;
  SELECT owner_id INTO v_owner FROM public.team_memberships WHERE token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex');
  IF v_owner IS NULL THEN RAISE EXCEPTION 'Приглашение недействительно или истекло' USING ERRCODE='42501'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('team:'||v_owner::text,0));
  SELECT * INTO v_member FROM public.team_memberships WHERE token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex') FOR UPDATE;
  IF v_member.id IS NULL OR v_member.status<>'invited' OR v_member.expires_at<=now() THEN
    RAISE EXCEPTION 'Приглашение недействительно или истекло' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM auth.users WHERE id=v_uid AND lower(email)=v_member.email AND email_confirmed_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Войдите с подтверждённым email, на который создано приглашение' USING ERRCODE='42501'; END IF;
  IF v_member.owner_id=v_uid OR EXISTS(SELECT 1 FROM public.team_memberships WHERE owner_id=v_member.owner_id AND user_id=v_uid AND status='active') THEN
    RAISE EXCEPTION 'Вы уже состоите в этой команде' USING ERRCODE='22023'; END IF;
  UPDATE public.team_memberships SET user_id=v_uid,status='active',token_hash=NULL,joined_at=now(),revision=revision+1 WHERE id=v_member.id;
  INSERT INTO public.team_activity(owner_id,actor_id,membership_id,action,detail) VALUES
    (v_member.owner_id,v_uid,v_member.id,'invitation_accepted',jsonb_build_object('email',v_member.email));
  RETURN v_member.id;
END;
$$;

CREATE FUNCTION private.manage_team_member(p_membership_id uuid,p_revision integer,p_role text,p_property_ids uuid[],p_revoke boolean DEFAULT false)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_uid uuid:=auth.uid(); v_member public.team_memberships; v_properties uuid[]; v_names text[];
BEGIN
  SELECT * INTO v_member FROM public.team_memberships WHERE id=p_membership_id;
  IF v_uid IS NULL OR v_member.owner_id IS DISTINCT FROM v_uid THEN RAISE EXCEPTION 'Нет доступа к управлению командой' USING ERRCODE='42501'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('team:'||v_uid::text,0));
  SELECT * INTO v_member FROM public.team_memberships WHERE id=p_membership_id FOR UPDATE;
  IF v_member.owner_id IS DISTINCT FROM v_uid THEN RAISE EXCEPTION 'Нет доступа к управлению командой' USING ERRCODE='42501'; END IF;
  IF p_revision IS DISTINCT FROM v_member.revision THEN RAISE EXCEPTION 'Доступ уже изменён. Обновите страницу' USING ERRCODE='40001'; END IF;
  IF v_member.status='revoked' THEN RAISE EXCEPTION 'Доступ уже отозван' USING ERRCODE='22023'; END IF;
  IF p_revoke IS TRUE THEN
    DELETE FROM public.team_property_responsibles WHERE membership_id=v_member.id;
    DELETE FROM public.team_property_access WHERE membership_id=v_member.id;
    UPDATE public.team_memberships SET status='revoked',token_hash=NULL,revision=revision+1 WHERE id=v_member.id;
    INSERT INTO public.team_activity(owner_id,actor_id,membership_id,action,detail) VALUES
      (v_uid,v_uid,v_member.id,'member_revoked',jsonb_build_object('email',v_member.email));
  ELSE
    IF p_role IS NULL OR p_role NOT IN ('manager','viewer') THEN RAISE EXCEPTION 'Неизвестная роль' USING ERRCODE='22023'; END IF;
    SELECT array_agg(DISTINCT x ORDER BY x) INTO v_properties FROM unnest(p_property_ids) x;
    IF coalesce(cardinality(v_properties),0)=0 OR cardinality(v_properties)>100 OR array_position(v_properties,NULL) IS NOT NULL THEN
      RAISE EXCEPTION 'Выберите от 1 до 100 объектов' USING ERRCODE='22023'; END IF;
    PERFORM 1 FROM public.properties WHERE id=ANY(v_properties) ORDER BY id FOR SHARE;
    IF (SELECT count(*) FROM public.properties WHERE id=ANY(v_properties) AND owner_id=v_uid)<>cardinality(v_properties) THEN
      RAISE EXCEPTION 'Можно передать доступ только к своим объектам' USING ERRCODE='42501'; END IF;
    DELETE FROM public.team_property_responsibles WHERE membership_id=v_member.id AND (p_role<>'manager' OR property_id<>ALL(v_properties));
    DELETE FROM public.team_property_access WHERE membership_id=v_member.id AND property_id<>ALL(v_properties);
    INSERT INTO public.team_property_access SELECT v_member.id,x FROM unnest(v_properties) x ON CONFLICT DO NOTHING;
    UPDATE public.team_memberships SET role=p_role,revision=revision+1 WHERE id=v_member.id;
    SELECT array_agg(name ORDER BY name) INTO v_names FROM public.properties WHERE id=ANY(v_properties);
    INSERT INTO public.team_activity(owner_id,actor_id,membership_id,action,detail) VALUES
      (v_uid,v_uid,v_member.id,'member_updated',jsonb_build_object('email',v_member.email,'role',p_role,'property_names',v_names));
  END IF;
  RETURN v_member.id;
END;
$$;

CREATE FUNCTION private.set_team_responsible(p_property_id uuid,p_membership_id uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_uid uuid:=auth.uid(); v_name text;
BEGIN
  IF v_uid IS NULL OR NOT EXISTS(SELECT 1 FROM public.properties WHERE id=p_property_id AND owner_id=v_uid) THEN
    RAISE EXCEPTION 'Назначить ответственного может собственник объекта' USING ERRCODE='42501'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('team:'||v_uid::text,0));
  PERFORM 1 FROM public.properties WHERE id=p_property_id AND owner_id=v_uid FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Объект недоступен' USING ERRCODE='42501'; END IF;
  IF p_membership_id IS NOT NULL THEN
    SELECT coalesce(nullif(u.name,''),m.email) INTO v_name FROM public.team_memberships m
      JOIN public.team_property_access g ON g.membership_id=m.id AND g.property_id=p_property_id
      LEFT JOIN public.profiles u ON u.id=m.user_id
      WHERE m.id=p_membership_id AND m.owner_id=v_uid AND m.status='active' AND m.role='manager';
    IF NOT FOUND THEN RAISE EXCEPTION 'Выберите действующего управляющего с доступом к объекту' USING ERRCODE='22023'; END IF;
    INSERT INTO public.team_property_responsibles VALUES(p_property_id,p_membership_id)
      ON CONFLICT(property_id) DO UPDATE SET membership_id=excluded.membership_id;
  ELSE DELETE FROM public.team_property_responsibles WHERE property_id=p_property_id; END IF;
  INSERT INTO public.team_activity(owner_id,actor_id,property_id,membership_id,action,detail) VALUES
    (v_uid,v_uid,p_property_id,p_membership_id,'responsible_changed',jsonb_build_object('name',v_name));
  RETURN p_property_id;
END;
$$;

CREATE FUNCTION private.act_on_team_property(p_property_id uuid,p_action text,p_values jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_uid uuid:=auth.uid(); v_property public.properties; v_owner uuid; v_request public.requests;
  v_text text; v_status text; v_detail jsonb; v_action text; v_id uuid; v_member uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Войдите в аккаунт' USING ERRCODE='42501'; END IF;
  SELECT owner_id INTO v_owner FROM public.properties WHERE id=p_property_id;
  IF v_owner IS NULL THEN RAISE EXCEPTION 'Объект недоступен' USING ERRCODE='42501'; END IF;
  -- Serialize with access edits/revocation; the property lock also prevents an ownership transfer.
  PERFORM pg_advisory_xact_lock(hashtextextended('team:'||v_owner::text,0));
  SELECT * INTO v_property FROM public.properties WHERE id=p_property_id FOR SHARE;
  IF v_property.owner_id IS DISTINCT FROM v_owner THEN
    RAISE EXCEPTION 'Владелец объекта изменён. Обновите страницу' USING ERRCODE='40001'; END IF;
  IF NOT private.team_has_access(p_property_id,true) THEN RAISE EXCEPTION 'Нет права изменять этот объект' USING ERRCODE='42501'; END IF;
  IF jsonb_typeof(p_values) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Проверьте данные действия' USING ERRCODE='22023'; END IF;
  IF p_action='note' THEN
    v_text:=btrim(p_values->>'text');
    IF coalesce(length(v_text),0)=0 OR length(v_text)>2000 THEN RAISE EXCEPTION 'Введите заметку до 2000 символов' USING ERRCODE='22023'; END IF;
    v_detail:=jsonb_build_object('text',v_text); v_action:='property_note'; v_id:=p_property_id;
  ELSIF p_action IN ('request_status','request_comment') THEN
    BEGIN v_id:=(p_values->>'request_id')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'Выберите заявку' USING ERRCODE='22023'; END;
    SELECT * INTO v_request FROM public.requests WHERE id=v_id AND property_id=p_property_id AND owner_id=v_property.owner_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Заявка недоступна на этом объекте' USING ERRCODE='42501'; END IF;
    IF p_action='request_status' THEN
      v_status:=p_values->>'status';
      IF v_status IS NULL OR v_status NOT IN ('new','in_progress','closed') THEN RAISE EXCEPTION 'Неизвестный статус заявки' USING ERRCODE='22023'; END IF;
      IF (p_values->>'expected_status') IS DISTINCT FROM v_request.status::text THEN RAISE EXCEPTION 'Статус заявки уже изменён. Обновите страницу' USING ERRCODE='40001'; END IF;
      IF v_status=v_request.status::text THEN RETURN v_id; END IF;
      UPDATE public.requests SET status=v_status::public.request_status WHERE id=v_request.id;
      IF v_uid<>v_property.owner_id THEN
        INSERT INTO public.notifications(user_id,kind,title,body,href,entity_type,entity_id)
          VALUES(v_property.owner_id,'request_status','Сотрудник изменил статус заявки',
            left(v_request.title||': '||CASE v_status WHEN 'new' THEN 'Новая' WHEN 'in_progress' THEN 'В работе' ELSE 'Закрыта' END,1000),
            '/requests','request',v_request.id);
      END IF;
      v_detail:=jsonb_build_object('title',v_request.title,'from',v_request.status,'to',v_status);
    ELSE
      v_text:=btrim(p_values->>'text');
      IF coalesce(length(v_text),0)=0 OR length(v_text)>4000 THEN RAISE EXCEPTION 'Введите сообщение до 4000 символов' USING ERRCODE='22023'; END IF;
      INSERT INTO public.comments(request_id,user_id,text) VALUES(v_request.id,v_uid,v_text);
      v_detail:=jsonb_build_object('title',v_request.title,'text',v_text);
    END IF;
    v_action:=p_action;
  ELSE RAISE EXCEPTION 'Неизвестное действие' USING ERRCODE='22023'; END IF;
  SELECT m.id INTO v_member FROM public.team_memberships m WHERE m.owner_id=v_property.owner_id AND m.user_id=v_uid AND m.status='active';
  INSERT INTO public.team_activity(owner_id,actor_id,property_id,membership_id,action,detail)
    VALUES(v_property.owner_id,v_uid,p_property_id,v_member,v_action,v_detail);
  RETURN v_id;
END;
$$;

-- A team author may not bypass revocation by deleting their old base-table comments.
ALTER POLICY comments_delete_own ON public.comments
  USING (user_id=(SELECT auth.uid()) AND private.can_see_request(request_id));

CREATE FUNCTION private.team_overview()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_uid uuid:=auth.uid(); v_result jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Войдите в аккаунт' USING ERRCODE='42501'; END IF;
  WITH work AS (
    SELECT p.id,p.name,p.address,p.status,p.owner_id,coalesce(nullif(o.name,''),'Собственник') AS owner_name,
      m.id AS membership_id,CASE WHEN p.owner_id=v_uid THEN 'owner' ELSE m.role END AS role,
      (SELECT coalesce(nullif(rp.name,''),rm.email) FROM public.team_property_responsibles r
        JOIN public.team_memberships rm ON rm.id=r.membership_id AND rm.owner_id=p.owner_id AND rm.status='active' AND rm.role='manager'
        JOIN public.team_property_access rg ON rg.membership_id=rm.id AND rg.property_id=p.id
        LEFT JOIN public.profiles rp ON rp.id=rm.user_id WHERE r.property_id=p.id) AS responsible_name,
      (SELECT count(*) FROM public.units u WHERE u.property_id=p.id) AS unit_count,
      (SELECT count(*) FROM public.lease_agreements a WHERE a.property_id=p.id AND a.owner_id=p.owner_id AND a.status='active') AS active_agreements,
      (SELECT count(*) FROM public.requests r WHERE r.property_id=p.id AND r.owner_id=p.owner_id AND r.status<>'closed') AS open_requests
    FROM public.properties p LEFT JOIN public.profiles o ON o.id=p.owner_id
    LEFT JOIN public.team_memberships m ON m.owner_id=p.owner_id AND m.user_id=v_uid AND m.status='active'
      AND EXISTS(SELECT 1 FROM public.team_property_access g WHERE g.membership_id=m.id AND g.property_id=p.id)
    WHERE p.owner_id=v_uid OR m.id IS NOT NULL
  ), members AS (
    SELECT m.id,m.owner_id,coalesce(nullif(o.name,''),'Собственник') AS owner_name,m.email,
      coalesce(nullif(u.name,''),m.email) AS name,m.user_id,m.role,m.status,m.expires_at,m.revision,m.created_at,m.joined_at,
      coalesce((SELECT jsonb_agg(g.property_id ORDER BY g.property_id) FROM public.team_property_access g
        JOIN public.properties p ON p.id=g.property_id AND p.owner_id=m.owner_id
        WHERE g.membership_id=m.id AND (m.owner_id=v_uid OR m.status='active')),'[]') AS property_ids
    FROM public.team_memberships m LEFT JOIN public.profiles o ON o.id=m.owner_id LEFT JOIN public.profiles u ON u.id=m.user_id
    WHERE m.owner_id=v_uid OR m.user_id=v_uid
  ), events AS (
    SELECT a.id,a.owner_id,a.property_id,a.membership_id,coalesce(nullif(u.name,''),'Пользователь') AS actor_name,a.action,a.detail,a.created_at
    FROM public.team_activity a LEFT JOIN public.profiles u ON u.id=a.actor_id WHERE a.owner_id=v_uid ORDER BY a.created_at DESC,a.id DESC LIMIT 100
  )
  SELECT jsonb_build_object(
    'properties',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'name',name,'address',address,'status',status) ORDER BY name,id) FROM public.properties WHERE owner_id=v_uid),'[]'),
    'members',coalesce((SELECT jsonb_agg(to_jsonb(m) ORDER BY created_at DESC,id) FROM members m),'[]'),
    'assignments',coalesce((SELECT jsonb_agg(jsonb_build_object('property_id',r.property_id,'membership_id',r.membership_id)) FROM public.team_property_responsibles r
       JOIN public.properties p ON p.id=r.property_id AND p.owner_id=v_uid
       JOIN public.team_memberships m ON m.id=r.membership_id AND m.owner_id=p.owner_id AND m.status='active' AND m.role='manager'
       JOIN public.team_property_access g ON g.property_id=p.id AND g.membership_id=m.id),'[]'),
    'workspaces',coalesce((SELECT jsonb_agg(to_jsonb(w) ORDER BY name,id) FROM work w),'[]'),
    'events',coalesce((SELECT jsonb_agg(to_jsonb(e) ORDER BY created_at DESC,id DESC) FROM events e),'[]'),
    'events_truncated',(SELECT count(*)>100 FROM public.team_activity WHERE owner_id=v_uid)
  ) INTO v_result;
  RETURN v_result;
END;
$$;

CREATE FUNCTION private.team_workspace(p_property_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_uid uuid:=auth.uid(); v_property public.properties; v_result jsonb;
BEGIN
  IF NOT private.team_has_access(p_property_id,false) THEN RAISE EXCEPTION 'Доступ к объекту отозван или не предоставлен' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_property FROM public.properties WHERE id=p_property_id;
  WITH requests AS (
    SELECT r.id,r.title,r.description,r.category,r.status,r.created_at,
      coalesce(t.name,'Арендатор') AS tenant_name,u.name AS unit_name
    FROM public.requests r LEFT JOIN public.tenants t ON t.id=r.tenant_id AND t.owner_id=v_property.owner_id
      LEFT JOIN public.units u ON u.id=r.unit_id AND u.property_id=p_property_id
    WHERE r.property_id=p_property_id AND r.owner_id=v_property.owner_id ORDER BY r.created_at DESC,r.id DESC LIMIT 200
  ), comments AS (
    SELECT c.id,c.request_id,coalesce(nullif(u.name,''),'Пользователь') AS user_name,c.text,c.created_at
    FROM public.comments c JOIN requests r ON r.id=c.request_id LEFT JOIN public.profiles u ON u.id=c.user_id
    ORDER BY c.created_at DESC,c.id DESC LIMIT 500
  ), notes AS (
    SELECT a.id,a.detail->>'text' AS text,coalesce(nullif(u.name,''),'Пользователь') AS actor_name,a.created_at
    FROM public.team_activity a LEFT JOIN public.profiles u ON u.id=a.actor_id
    WHERE a.owner_id=v_property.owner_id AND a.property_id=p_property_id AND a.action='property_note' ORDER BY a.created_at DESC,a.id DESC LIMIT 50
  )
  SELECT jsonb_build_object(
    'property',jsonb_build_object('id',v_property.id,'name',v_property.name,'address',v_property.address,'description',v_property.description,'status',v_property.status,
      'owner_id',v_property.owner_id,'owner_name',(SELECT coalesce(nullif(name,''),'Собственник') FROM public.profiles WHERE id=v_property.owner_id),
      'role',CASE WHEN v_property.owner_id=v_uid THEN 'owner' ELSE (SELECT role FROM public.team_memberships WHERE owner_id=v_property.owner_id AND user_id=v_uid AND status='active') END,
      'responsible_name',(SELECT coalesce(nullif(u.name,''),m.email) FROM public.team_property_responsibles r
        JOIN public.team_memberships m ON m.id=r.membership_id AND m.owner_id=v_property.owner_id AND m.status='active' AND m.role='manager'
        JOIN public.team_property_access g ON g.membership_id=m.id AND g.property_id=p_property_id LEFT JOIN public.profiles u ON u.id=m.user_id WHERE r.property_id=p_property_id)),
    'units',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'name',name,'area',area,'status',status) ORDER BY name,id) FROM public.units WHERE property_id=p_property_id),'[]'),
    'agreements',coalesce((SELECT jsonb_agg(jsonb_build_object('id',a.id,'tenant_name',t.name,'unit_name',u.name,'start_date',a.start_date,'end_date',a.end_date,
      'monthly_payment',private.agreement_rent_at(a.id,CURRENT_DATE,a.monthly_payment),'status',a.status) ORDER BY a.end_date,a.id)
      FROM public.lease_agreements a JOIN public.tenants t ON t.id=a.tenant_id AND t.owner_id=v_property.owner_id
      LEFT JOIN public.units u ON u.id=a.unit_id AND u.property_id=p_property_id WHERE a.property_id=p_property_id AND a.owner_id=v_property.owner_id),'[]'),
    'requests',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY created_at DESC,id DESC) FROM requests r),'[]'),
    'comments',coalesce((SELECT jsonb_agg(to_jsonb(c) ORDER BY created_at,id) FROM comments c),'[]'),
    'notes',coalesce((SELECT jsonb_agg(to_jsonb(n) ORDER BY created_at DESC,id DESC) FROM notes n),'[]'),
    'requests_truncated',(SELECT count(*)>200 FROM public.requests WHERE property_id=p_property_id AND owner_id=v_property.owner_id),
    'comments_truncated',(SELECT count(*)>500 FROM public.comments c JOIN requests r ON r.id=c.request_id),
    'notes_truncated',(SELECT count(*)>50 FROM public.team_activity WHERE owner_id=v_property.owner_id AND property_id=p_property_id AND action='property_note')
  ) INTO v_result;
  RETURN v_result;
END;
$$;

CREATE FUNCTION public.invite_team_member(p_email text,p_role text,p_property_ids uuid[]) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT private.invite_team_member(p_email,p_role,p_property_ids); $$;
CREATE FUNCTION public.accept_team_invitation(p_token text) RETURNS uuid LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT private.accept_team_invitation(p_token); $$;
CREATE FUNCTION public.manage_team_member(p_membership_id uuid,p_revision integer,p_role text,p_property_ids uuid[],p_revoke boolean DEFAULT false) RETURNS uuid LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT private.manage_team_member(p_membership_id,p_revision,p_role,p_property_ids,p_revoke); $$;
CREATE FUNCTION public.set_team_responsible(p_property_id uuid,p_membership_id uuid DEFAULT NULL) RETURNS uuid LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT private.set_team_responsible(p_property_id,p_membership_id); $$;
CREATE FUNCTION public.act_on_team_property(p_property_id uuid,p_action text,p_values jsonb) RETURNS uuid LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT private.act_on_team_property(p_property_id,p_action,p_values); $$;
CREATE FUNCTION public.team_overview() RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$ SELECT private.team_overview(); $$;
CREATE FUNCTION public.team_workspace(p_property_id uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$ SELECT private.team_workspace(p_property_id); $$;
REVOKE ALL ON FUNCTION public.invite_team_member(text,text,uuid[]),public.accept_team_invitation(text),public.manage_team_member(uuid,integer,text,uuid[],boolean),public.set_team_responsible(uuid,uuid),public.act_on_team_property(uuid,text,jsonb),public.team_overview(),public.team_workspace(uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION private.invite_team_member(text,text,uuid[]),private.accept_team_invitation(text),private.manage_team_member(uuid,integer,text,uuid[],boolean),private.set_team_responsible(uuid,uuid),private.act_on_team_property(uuid,text,jsonb),private.team_overview(),private.team_workspace(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.invite_team_member(text,text,uuid[]),public.accept_team_invitation(text),public.manage_team_member(uuid,integer,text,uuid[],boolean),public.set_team_responsible(uuid,uuid),public.act_on_team_property(uuid,text,jsonb),public.team_overview(),public.team_workspace(uuid) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.invite_team_member(text,text,uuid[]),private.accept_team_invitation(text),private.manage_team_member(uuid,integer,text,uuid[],boolean),private.set_team_responsible(uuid,uuid),private.act_on_team_property(uuid,text,jsonb),private.team_overview(),private.team_workspace(uuid) TO authenticated,service_role;

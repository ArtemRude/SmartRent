SET lock_timeout='5s';
SET statement_timeout='30s';
-- Transport contains identifiers and coarse event kinds only, never notification text or contact data.
CREATE TABLE private.telegram_config (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 bot_username text CHECK(bot_username ~ '^[A-Za-z0-9_]{5,32}$'),
 enabled boolean NOT NULL DEFAULT false,
 CHECK(NOT enabled OR bot_username IS NOT NULL)
);
INSERT INTO private.telegram_config(singleton) VALUES(true);
CREATE TABLE private.telegram_preferences (
 user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
 enabled boolean NOT NULL DEFAULT true,
 topics text[] NOT NULL DEFAULT ARRAY['payments','agreements','requests','repairs','recruitment','utilities','objects'],
 CHECK(topics <@ ARRAY['payments','agreements','requests','repairs','recruitment','utilities','objects']::text[] AND array_position(topics,NULL) IS NULL)
);
CREATE TABLE private.telegram_connections (
 user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
 id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
 chat_id text NOT NULL UNIQUE CHECK(chat_id ~ '^[1-9][0-9]{0,18}$'),
 username text CHECK(username ~ '^[A-Za-z0-9_]{1,32}$'),
 connected_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE private.telegram_links (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
 token_hash text NOT NULL UNIQUE,
 expires_at timestamptz NOT NULL DEFAULT now()+interval '10 minutes',
 chat_id text CHECK(chat_id ~ '^[1-9][0-9]{0,18}$'),
 username text CHECK(username ~ '^[A-Za-z0-9_]{1,32}$'),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE private.telegram_updates (
 update_id bigint PRIMARY KEY CHECK(update_id>=0), received_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE private.telegram_deliveries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 connection_id uuid NOT NULL,
 notification_id uuid REFERENCES public.notifications(id) ON DELETE SET NULL,
 kind text NOT NULL,
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','processing','sent','failed','cancelled','uncertain')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),
 created_at timestamptz NOT NULL DEFAULT now(),
 available_at timestamptz NOT NULL DEFAULT now(),
 claim_token uuid, claimed_at timestamptz,
 sent_at timestamptz, error_code text CHECK(error_code ~ '^[a-z0-9_]{1,64}$'),
 message_id bigint,
 UNIQUE(notification_id,connection_id)
);
CREATE INDEX telegram_deliveries_claim_idx ON private.telegram_deliveries(available_at,created_at,id) WHERE status='queued';
CREATE INDEX telegram_deliveries_lease_idx ON private.telegram_deliveries(claimed_at) WHERE status='processing';
CREATE INDEX telegram_deliveries_user_idx ON private.telegram_deliveries(user_id,created_at DESC,id);
CREATE INDEX telegram_deliveries_notification_idx ON private.telegram_deliveries(notification_id) WHERE notification_id IS NOT NULL;
CREATE INDEX telegram_deliveries_connection_idx ON private.telegram_deliveries(connection_id) WHERE status IN ('queued','processing');
ALTER TABLE private.telegram_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.telegram_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.telegram_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.telegram_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.telegram_updates ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.telegram_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.telegram_config,private.telegram_preferences,private.telegram_connections,private.telegram_links,private.telegram_updates,private.telegram_deliveries FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.telegram_topic(p_kind text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT CASE WHEN p_kind LIKE 'payment_%' THEN 'payments' WHEN p_kind LIKE 'agreement_%' OR p_kind='handover_status' THEN 'agreements'
 WHEN p_kind LIKE 'request_%' THEN 'requests' WHEN p_kind='repair_status' THEN 'repairs' WHEN p_kind='rental_application' THEN 'recruitment'
 WHEN p_kind LIKE 'utility_%' THEN 'utilities' WHEN p_kind='object_activity' THEN 'objects' END;
$$;
CREATE FUNCTION private.telegram_property_access(p_user uuid,p_property uuid,p_manager boolean DEFAULT false) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.properties p WHERE p.id=p_property AND (p.owner_id=p_user OR private.has_role(p_user,'admin') OR EXISTS(
 SELECT 1 FROM public.team_memberships m JOIN public.team_property_access g ON g.membership_id=m.id WHERE m.user_id=p_user AND m.owner_id=p.owner_id AND m.status='active' AND g.property_id=p.id AND (NOT p_manager OR m.role='manager'))));
$$;
CREATE FUNCTION private.telegram_event_access(p_user uuid,p_type text,p_id uuid,p_kind text) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF p_type='property' THEN RETURN private.telegram_property_access(p_user,p_id);
 ELSIF p_type='request' THEN RETURN EXISTS(SELECT 1 FROM public.requests r JOIN public.tenants t ON t.id=r.tenant_id WHERE r.id=p_id AND (r.owner_id=p_user OR t.user_id=p_user OR private.has_role(p_user,'admin') OR private.telegram_property_access(p_user,r.property_id)));
 ELSIF p_type='agreement' THEN RETURN EXISTS(SELECT 1 FROM public.lease_agreements a JOIN public.tenants t ON t.id=a.tenant_id WHERE a.id=p_id AND (a.owner_id=p_user OR t.user_id=p_user OR private.has_role(p_user,'admin'))
 AND (p_kind<>'agreement_expiring' OR (a.status='active' AND a.end_date>=CURRENT_DATE AND a.end_date<=CURRENT_DATE+30)));
 ELSIF p_type='rent_charge' THEN RETURN EXISTS(SELECT 1 FROM public.rent_charges c JOIN public.tenants t ON t.id=c.tenant_id JOIN public.lease_agreements a ON a.id=c.agreement_id WHERE c.id=p_id AND (c.owner_id=p_user OR t.user_id=p_user OR private.has_role(p_user,'admin'))
 AND (p_kind NOT IN ('payment_due','payment_overdue','payment_reminder') OR (c.paid_at IS NULL AND a.status='active' AND c.amount+c.adjustment_amount-c.paid_amount>0 AND (p_kind<>'payment_overdue' OR c.due_date<CURRENT_DATE) AND (p_kind<>'payment_due' OR c.due_date BETWEEN CURRENT_DATE AND CURRENT_DATE+7))));
 ELSIF p_type='repair' THEN RETURN EXISTS(SELECT 1 FROM public.repair_jobs j WHERE j.id=p_id AND (private.telegram_property_access(p_user,j.property_id) OR (j.published_at IS NOT NULL AND EXISTS(SELECT 1 FROM public.requests r JOIN public.tenants t ON t.id=r.tenant_id WHERE r.id=j.request_id AND r.owner_id=j.owner_id AND t.user_id=p_user))));
 ELSIF p_type='application' THEN RETURN EXISTS(SELECT 1 FROM public.rental_applications a JOIN public.property_listings l ON l.id=a.listing_id WHERE a.id=p_id AND (a.applicant_id=p_user OR private.telegram_property_access(p_user,l.property_id,true)));
 END IF;
 RETURN false;
END;
$$;
CREATE FUNCTION private.telegram_href(p_kind text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT CASE private.telegram_topic(p_kind) WHEN 'payments' THEN '/payments' WHEN 'agreements' THEN '/agreements' WHEN 'requests' THEN '/requests' WHEN 'repairs' THEN '/repairs' WHEN 'recruitment' THEN '/recruitment' WHEN 'utilities' THEN '/utilities' WHEN 'objects' THEN '/portfolio' ELSE '/notifications' END;
$$;
CREATE FUNCTION private.enqueue_telegram_notification() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('telegram-state',0));
 INSERT INTO private.telegram_deliveries(user_id,connection_id,notification_id,kind)
 SELECT NEW.user_id,c.id,NEW.id,NEW.kind FROM private.telegram_connections c
 JOIN private.telegram_preferences p ON p.user_id=c.user_id
 WHERE c.user_id=NEW.user_id AND p.enabled AND private.telegram_topic(NEW.kind)=ANY(p.topics)
 AND EXISTS(SELECT 1 FROM private.telegram_config WHERE enabled)
 ON CONFLICT(notification_id,connection_id) DO NOTHING;
 RETURN NEW;
END;
$$;
CREATE TRIGGER enqueue_telegram_notification AFTER INSERT ON public.notifications FOR EACH ROW EXECUTE FUNCTION private.enqueue_telegram_notification();

CREATE FUNCTION private.telegram_overview() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE u uuid:=auth.uid(); result jsonb;
BEGIN
 IF u IS NULL THEN RAISE EXCEPTION 'Войдите в аккаунт' USING ERRCODE='42501'; END IF;
 SELECT jsonb_build_object('configured',g.enabled AND g.bot_username IS NOT NULL,'bot_username',g.bot_username,
 'connection',(SELECT jsonb_build_object('username',c.username,'connected_at',c.connected_at) FROM private.telegram_connections c WHERE c.user_id=u),
 'pending',(SELECT jsonb_build_object('id',l.id,'username',l.username,'expires_at',l.expires_at) FROM private.telegram_links l WHERE l.user_id=u AND l.chat_id IS NOT NULL AND l.expires_at>now()),
 'enabled',coalesce(p.enabled,true),'topics',coalesce(p.topics,ARRAY['payments','agreements','requests','repairs','recruitment','utilities','objects']),
 'deliveries',coalesce((SELECT jsonb_agg(x.obj ORDER BY x.created_at DESC,x.id DESC) FROM (SELECT d.created_at,d.id,jsonb_build_object('id',d.id,'kind',d.kind,'status',CASE WHEN d.status='queued' THEN CASE WHEN d.attempts>0 THEN 'retry' ELSE 'pending' END ELSE d.status END,'attempts',d.attempts,'created_at',d.created_at,'sent_at',d.sent_at,'error_code',d.error_code) obj FROM private.telegram_deliveries d WHERE d.user_id=u ORDER BY d.created_at DESC,d.id DESC LIMIT 50) x),'[]'),
 'history_truncated',(SELECT count(*)>50 FROM (SELECT 1 FROM private.telegram_deliveries d WHERE d.user_id=u LIMIT 51) limited)) INTO result
 FROM private.telegram_config g LEFT JOIN private.telegram_preferences p ON p.user_id=u;
 RETURN result;
END;
$$;
CREATE FUNCTION private.begin_telegram_link() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE u uuid:=auth.uid(); token text; link private.telegram_links; bot text;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('telegram-state',0));
 IF u IS NULL THEN RAISE EXCEPTION 'Войдите в аккаунт' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('telegram:'||u::text,0));
 SELECT bot_username INTO bot FROM private.telegram_config WHERE enabled;
 IF bot IS NULL THEN RAISE EXCEPTION 'Telegram ещё не настроен' USING ERRCODE='55000'; END IF;
 token:=replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','');
 DELETE FROM private.telegram_links WHERE user_id=u;
 INSERT INTO private.telegram_links(user_id,token_hash) VALUES(u,encode(sha256(convert_to(token,'UTF8')),'hex')) RETURNING * INTO link;
 RETURN jsonb_build_object('id',link.id,'token',token,'bot_username',bot,'expires_at',link.expires_at);
END;
$$;
CREATE FUNCTION private.confirm_telegram_link(p_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE u uuid:=auth.uid(); l private.telegram_links;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('telegram-state',0));
 IF u IS NULL THEN RAISE EXCEPTION 'Войдите в аккаунт' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('telegram:'||u::text,0));
 SELECT * INTO l FROM private.telegram_links WHERE id=p_id AND user_id=u FOR UPDATE;
 IF NOT FOUND OR l.expires_at<=now() OR l.chat_id IS NULL OR NOT EXISTS(SELECT 1 FROM private.telegram_config WHERE enabled) THEN RAISE EXCEPTION 'Привязка истекла или ещё не подтверждена ботом' USING ERRCODE='23514'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('telegram-chat:'||l.chat_id,0));
 IF EXISTS(SELECT 1 FROM private.telegram_connections WHERE chat_id=l.chat_id AND user_id<>u) THEN RAISE EXCEPTION 'Этот Telegram уже подключён к другому аккаунту' USING ERRCODE='23505'; END IF;
 -- A new generation fences every old queued or in-flight delivery.
 UPDATE private.telegram_deliveries SET status=CASE WHEN status='processing' THEN 'uncertain' ELSE 'cancelled' END,error_code='connection_changed' WHERE user_id=u AND status IN ('queued','processing');
 DELETE FROM private.telegram_connections WHERE user_id=u;
 INSERT INTO private.telegram_connections(user_id,chat_id,username) VALUES(u,l.chat_id,l.username);
 INSERT INTO private.telegram_preferences(user_id) VALUES(u) ON CONFLICT(user_id) DO UPDATE SET enabled=true;
 DELETE FROM private.telegram_links WHERE user_id=u;
END;
$$;
CREATE FUNCTION private.disconnect_telegram() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE u uuid:=auth.uid();
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('telegram-state',0));
 IF u IS NULL THEN RAISE EXCEPTION 'Войдите в аккаунт' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('telegram:'||u::text,0));
 DELETE FROM private.telegram_links WHERE user_id=u;
 DELETE FROM private.telegram_connections WHERE user_id=u;
 UPDATE private.telegram_deliveries SET status=CASE WHEN status='processing' THEN 'uncertain' ELSE 'cancelled' END,error_code='disconnected' WHERE user_id=u AND status IN ('queued','processing');
END;
$$;
CREATE FUNCTION private.save_telegram_preferences(p_enabled boolean,p_topics text[]) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE u uuid:=auth.uid();
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('telegram-state',0));
 IF u IS NULL THEN RAISE EXCEPTION 'Войдите в аккаунт' USING ERRCODE='42501'; END IF;
 IF p_enabled IS NULL OR p_topics IS NULL OR NOT p_topics <@ ARRAY['payments','agreements','requests','repairs','recruitment','utilities','objects']::text[] OR array_position(p_topics,NULL) IS NOT NULL THEN RAISE EXCEPTION 'Некорректные настройки' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('telegram:'||u::text,0));
 INSERT INTO private.telegram_preferences(user_id,enabled,topics) VALUES(u,p_enabled,ARRAY(SELECT DISTINCT unnest(p_topics))) ON CONFLICT(user_id) DO UPDATE SET enabled=excluded.enabled,topics=excluded.topics;
 UPDATE private.telegram_deliveries SET status='cancelled',error_code='preferences_changed' WHERE user_id=u AND status='queued' AND (NOT p_enabled OR (kind<>'test' AND NOT coalesce(private.telegram_topic(kind)=ANY(p_topics),false)));
END;
$$;
CREATE FUNCTION private.test_telegram_delivery() RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE u uuid:=auth.uid(); c uuid; result uuid;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('telegram-state',0));
 IF u IS NULL THEN RAISE EXCEPTION 'Войдите в аккаунт' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('telegram:'||u::text,0));
 SELECT x.id INTO c FROM private.telegram_connections x JOIN private.telegram_preferences p ON p.user_id=x.user_id WHERE x.user_id=u AND p.enabled AND EXISTS(SELECT 1 FROM private.telegram_config WHERE enabled);
 IF c IS NULL THEN RAISE EXCEPTION 'Подключите Telegram и включите уведомления' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM private.telegram_deliveries WHERE user_id=u AND kind='test' AND created_at>now()-interval '1 minute') THEN RAISE EXCEPTION 'Повторить проверку можно через минуту' USING ERRCODE='54000'; END IF;
 INSERT INTO private.telegram_deliveries(user_id,connection_id,kind) VALUES(u,c,'test') RETURNING id INTO result;
 RETURN result;
END;
$$;

CREATE FUNCTION private.telegram_configure(p_bot_username text,p_enabled boolean) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('telegram-state',0));
 IF p_enabled IS NULL OR (p_bot_username IS NOT NULL AND p_bot_username !~ '^[A-Za-z0-9_]{5,32}$') OR (p_enabled AND p_bot_username IS NULL) THEN RAISE EXCEPTION 'Invalid bot configuration' USING ERRCODE='22023'; END IF;
 -- Swapping bot identities cannot reuse chat ids obtained by another bot.
 IF EXISTS(SELECT 1 FROM private.telegram_config WHERE bot_username IS DISTINCT FROM p_bot_username) THEN
  DELETE FROM private.telegram_links; DELETE FROM private.telegram_connections;
  UPDATE private.telegram_deliveries SET status=CASE WHEN status='processing' THEN 'uncertain' ELSE 'cancelled' END,error_code='bot_changed' WHERE status IN ('queued','processing');
 END IF;
 UPDATE private.telegram_config SET bot_username=p_bot_username,enabled=p_enabled;
 IF NOT p_enabled THEN UPDATE private.telegram_deliveries SET status='cancelled',error_code='channel_disabled' WHERE status='queued'; END IF;
END;
$$;
CREATE FUNCTION private.receive_telegram_update(p_update_id bigint,p_chat_id text,p_username text DEFAULT NULL,p_token text DEFAULT NULL,p_stop boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE l private.telegram_links; u uuid;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('telegram-state',0));
 IF p_update_id IS NULL OR p_update_id<0 OR p_chat_id IS NULL OR p_chat_id !~ '^[1-9][0-9]{0,18}$' OR (p_username IS NOT NULL AND p_username !~ '^[A-Za-z0-9_]{1,32}$') THEN RAISE EXCEPTION 'Invalid Telegram update' USING ERRCODE='22023'; END IF;
 INSERT INTO private.telegram_updates(update_id) VALUES(p_update_id) ON CONFLICT DO NOTHING;
 IF NOT FOUND THEN RETURN jsonb_build_object('result','ignored'); END IF;
 IF p_stop THEN
  SELECT user_id INTO u FROM private.telegram_connections WHERE chat_id=p_chat_id;
  IF u IS NOT NULL THEN
   PERFORM pg_advisory_xact_lock(hashtextextended('telegram:'||u::text,0));
   DELETE FROM private.telegram_connections WHERE user_id=u AND chat_id=p_chat_id;
   IF FOUND THEN
    UPDATE private.telegram_preferences SET enabled=false WHERE user_id=u;
    UPDATE private.telegram_deliveries SET status=CASE WHEN status='processing' THEN 'uncertain' ELSE 'cancelled' END,error_code='bot_stopped' WHERE user_id=u AND status IN ('queued','processing');
   END IF;
  END IF;
  DELETE FROM private.telegram_links WHERE chat_id=p_chat_id;
  RETURN jsonb_build_object('result','stopped');
 END IF;
 IF NOT EXISTS(SELECT 1 FROM private.telegram_config WHERE enabled) OR coalesce(p_token,'') !~ '^[a-f0-9]{64}$' THEN RETURN jsonb_build_object('result','ignored'); END IF;
 SELECT user_id INTO u FROM private.telegram_links WHERE token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex');
 IF u IS NULL THEN RETURN jsonb_build_object('result','ignored'); END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('telegram:'||u::text,0));
 SELECT * INTO l FROM private.telegram_links WHERE user_id=u AND token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex') FOR UPDATE;
 IF NOT FOUND OR l.expires_at<=now() OR l.chat_id IS NOT NULL THEN RETURN jsonb_build_object('result','ignored'); END IF;
 UPDATE private.telegram_links SET chat_id=p_chat_id,username=p_username WHERE id=l.id;
 RETURN jsonb_build_object('result','pending');
END;
$$;

CREATE FUNCTION private.claim_telegram_deliveries(p_limit integer DEFAULT 10) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d private.telegram_deliveries; c private.telegram_connections; n public.notifications; token uuid; result jsonb:='[]'; enabled boolean; topics text[]; href text; event_label text;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('telegram-state',0));
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION 'Invalid limit' USING ERRCODE='22023'; END IF;
 -- A crashed worker might already have sent a message. Never replay an expired claim.
 UPDATE private.telegram_deliveries SET status='uncertain',error_code='claim_expired' WHERE status='processing' AND claimed_at<now()-interval '5 minutes';
 FOR d IN SELECT * FROM private.telegram_deliveries WHERE status='queued' AND available_at<=now() ORDER BY available_at,created_at,id LIMIT p_limit FOR UPDATE SKIP LOCKED LOOP
  SELECT * INTO c FROM private.telegram_connections WHERE user_id=d.user_id AND id=d.connection_id;
  SELECT p.enabled,p.topics INTO enabled,topics FROM private.telegram_preferences p WHERE p.user_id=d.user_id;
  IF c.id IS NULL OR NOT coalesce(enabled,false) OR NOT EXISTS(SELECT 1 FROM private.telegram_config g WHERE g.enabled) OR (d.kind<>'test' AND NOT coalesce(private.telegram_topic(d.kind)=ANY(topics),false)) THEN
   UPDATE private.telegram_deliveries SET status='cancelled',error_code='access_or_settings_changed' WHERE id=d.id; CONTINUE;
  END IF;
  IF d.created_at<now()-interval '24 hours' THEN UPDATE private.telegram_deliveries SET status='cancelled',error_code='event_expired' WHERE id=d.id; CONTINUE; END IF;
  IF d.kind<>'test' THEN
   SELECT * INTO n FROM public.notifications WHERE id=d.notification_id AND user_id=d.user_id;
   IF n.id IS NULL OR NOT private.telegram_event_access(d.user_id,n.entity_type,n.entity_id,n.kind) THEN
    UPDATE private.telegram_deliveries SET status='cancelled',error_code='event_unavailable' WHERE id=d.id; CONTINUE;
   END IF;
  END IF;
  token:=gen_random_uuid();
  UPDATE private.telegram_deliveries SET status='processing',attempts=attempts+1,claim_token=token,claimed_at=now(),error_code=NULL WHERE id=d.id;
  href:=CASE WHEN d.kind='test' THEN '/notifications'
   WHEN d.kind='object_activity' AND n.entity_type='property' THEN '/objects/'||n.entity_id::text
   WHEN n.href IN ('/cabinet','/agreements','/payments','/requests','/repairs','/recruitment','/utilities','/team','/portfolio','/handover','/lease-changes','/notifications') THEN n.href
   ELSE private.telegram_href(d.kind) END;
  IF href IN ('/agreements','/payments') AND NOT private.has_role(d.user_id,'owner') AND NOT private.has_role(d.user_id,'admin') THEN href:='/cabinet'; END IF;
  -- Only known non-personal action labels may cross the transport boundary. Never copy arbitrary title/body.
  event_label:=CASE WHEN d.kind='object_activity' AND n.entity_type='property' AND n.title IN (
   'Добавлен объект','Объект обновлён','Добавлено помещение','Помещение обновлено','Помещение удалено',
   'Изменён ответственный по объекту','Добавлена заметка по объекту','Предложение аренды опубликовано','Предложение аренды снято с публикации'
  ) THEN n.title END;
  result:=result||jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('id',d.id,'claim_token',token,'user_id',d.user_id,'chat_id',c.chat_id,'kind',d.kind,'href',href,'event_label',event_label)));
 END LOOP;
 RETURN result;
END;
$$;
CREATE FUNCTION private.finish_telegram_delivery(p_id uuid,p_claim_token uuid,p_outcome text,p_error_code text DEFAULT NULL,p_retry_after integer DEFAULT NULL,p_message_id bigint DEFAULT NULL) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d private.telegram_deliveries;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('telegram-state',0));
 IF p_outcome IS NULL OR p_outcome NOT IN ('sent','retry','failed','uncertain') OR (p_error_code IS NOT NULL AND p_error_code !~ '^[a-z0-9_]{1,64}$') OR (p_retry_after IS NOT NULL AND p_retry_after NOT BETWEEN 1 AND 86400) THEN RAISE EXCEPTION 'Invalid delivery outcome' USING ERRCODE='22023'; END IF;
 SELECT * INTO d FROM private.telegram_deliveries WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR d.status<>'processing' OR d.claim_token IS DISTINCT FROM p_claim_token THEN RETURN; END IF;
 IF d.claimed_at<now()-interval '5 minutes' THEN UPDATE private.telegram_deliveries SET status='uncertain',error_code='claim_expired' WHERE id=d.id; RETURN; END IF;
 IF p_outcome='retry' AND coalesce(p_error_code,'') NOT IN ('telegram_429','telegram_500','telegram_502','telegram_503','telegram_504') THEN RAISE EXCEPTION 'Only definitive retryable API errors may be retried' USING ERRCODE='22023'; END IF;
 IF p_error_code='telegram_403' THEN
  -- Fenced by generation: a stale worker cannot disconnect a newer pairing.
  DELETE FROM private.telegram_connections WHERE user_id=d.user_id AND id=d.connection_id;
  IF FOUND THEN
   UPDATE private.telegram_preferences SET enabled=false WHERE user_id=d.user_id;
   UPDATE private.telegram_deliveries SET status='cancelled',error_code='bot_blocked' WHERE connection_id=d.connection_id AND id<>d.id AND status='queued';
  END IF;
 END IF;
 UPDATE private.telegram_deliveries SET status=CASE WHEN p_outcome='retry' THEN CASE WHEN attempts>=5 THEN 'failed' ELSE 'queued' END ELSE p_outcome END,
 error_code=CASE WHEN p_outcome='retry' AND attempts>=5 THEN 'retry_exhausted' ELSE p_error_code END,
 available_at=CASE WHEN p_outcome='retry' THEN now()+make_interval(secs=>greatest(coalesce(p_retry_after,0),least(3600,(30*power(2,attempts-1))::integer))) ELSE available_at END,
 sent_at=CASE WHEN p_outcome='sent' THEN now() END,message_id=CASE WHEN p_outcome='sent' THEN p_message_id END WHERE id=d.id;
END;
$$;

-- All transport state mutations use one short advisory transaction lock. It prevents
-- pairing/stop/config/claim races at prototype volume; the lock never spans an HTTP call.
-- Explicit API allowlists. Definers stay in the unexposed schema; browser wrappers are invokers.
REVOKE ALL ON FUNCTION private.telegram_topic(text),private.telegram_property_access(uuid,uuid,boolean),private.telegram_event_access(uuid,text,uuid,text),private.telegram_href(text),private.enqueue_telegram_notification() FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.telegram_overview() RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$SELECT private.telegram_overview()$$;
CREATE FUNCTION public.begin_telegram_link() RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$SELECT private.begin_telegram_link()$$;
CREATE FUNCTION public.confirm_telegram_link(p_id uuid) RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$SELECT private.confirm_telegram_link(p_id)$$;
CREATE FUNCTION public.disconnect_telegram() RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$SELECT private.disconnect_telegram()$$;
CREATE FUNCTION public.save_telegram_preferences(p_enabled boolean,p_topics text[]) RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$SELECT private.save_telegram_preferences(p_enabled,p_topics)$$;
CREATE FUNCTION public.test_telegram_delivery() RETURNS uuid LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$SELECT private.test_telegram_delivery()$$;
REVOKE ALL ON FUNCTION private.telegram_overview(),private.begin_telegram_link(),private.confirm_telegram_link(uuid),private.disconnect_telegram(),private.save_telegram_preferences(boolean,text[]),private.test_telegram_delivery(),public.telegram_overview(),public.begin_telegram_link(),public.confirm_telegram_link(uuid),public.disconnect_telegram(),public.save_telegram_preferences(boolean,text[]),public.test_telegram_delivery() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.telegram_overview(),private.begin_telegram_link(),private.confirm_telegram_link(uuid),private.disconnect_telegram(),private.save_telegram_preferences(boolean,text[]),private.test_telegram_delivery(),public.telegram_overview(),public.begin_telegram_link(),public.confirm_telegram_link(uuid),public.disconnect_telegram(),public.save_telegram_preferences(boolean,text[]),public.test_telegram_delivery() TO authenticated;
CREATE FUNCTION public.telegram_configure(p_bot_username text,p_enabled boolean) RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$SELECT private.telegram_configure(p_bot_username,p_enabled)$$;
CREATE FUNCTION public.receive_telegram_update(p_update_id bigint,p_chat_id text,p_username text DEFAULT NULL,p_token text DEFAULT NULL,p_stop boolean DEFAULT false) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$SELECT private.receive_telegram_update(p_update_id,p_chat_id,p_username,p_token,p_stop)$$;
CREATE FUNCTION public.claim_telegram_deliveries(p_limit integer DEFAULT 10) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$SELECT private.claim_telegram_deliveries(p_limit)$$;
CREATE FUNCTION public.finish_telegram_delivery(p_id uuid,p_claim_token uuid,p_outcome text,p_error_code text DEFAULT NULL,p_retry_after integer DEFAULT NULL,p_message_id bigint DEFAULT NULL) RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$SELECT private.finish_telegram_delivery(p_id,p_claim_token,p_outcome,p_error_code,p_retry_after,p_message_id)$$;
REVOKE ALL ON FUNCTION private.telegram_configure(text,boolean),private.receive_telegram_update(bigint,text,text,text,boolean),private.claim_telegram_deliveries(integer),private.finish_telegram_delivery(uuid,uuid,text,text,integer,bigint),public.telegram_configure(text,boolean),public.receive_telegram_update(bigint,text,text,text,boolean),public.claim_telegram_deliveries(integer),public.finish_telegram_delivery(uuid,uuid,text,text,integer,bigint) FROM PUBLIC,anon,authenticated,service_role;
GRANT USAGE ON SCHEMA private TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.telegram_configure(text,boolean),private.receive_telegram_update(bigint,text,text,text,boolean),private.claim_telegram_deliveries(integer),private.finish_telegram_delivery(uuid,uuid,text,text,integer,bigint),public.telegram_configure(text,boolean),public.receive_telegram_update(bigint,text,text,text,boolean),public.claim_telegram_deliveries(integer),public.finish_telegram_delivery(uuid,uuid,text,text,integer,bigint) TO service_role;

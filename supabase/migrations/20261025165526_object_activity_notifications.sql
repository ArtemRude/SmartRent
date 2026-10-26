-- Canonical activity produces inbox events; the Telegram delivery trigger reuses
-- these events. Historical audit rows are deliberately not replayed.
SET lock_timeout = '5s';
SET statement_timeout = '30s';

ALTER TABLE public.notifications DROP CONSTRAINT notifications_kind_valid;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_kind_valid CHECK(kind IN (
 'request_created','request_comment','request_status','agreement_created','agreement_status','agreement_accepted','agreement_expiring',
 'payment_status','payment_due','payment_overdue','payment_reminder','payment_reported','payment_report_status',
 'utility_submitted','utility_reviewed','handover_status','agreement_amendment','repair_status','rental_application','object_activity'));
ALTER TABLE public.notifications DROP CONSTRAINT notifications_entity_type_valid;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_entity_type_valid CHECK(entity_type IN ('request','agreement','rent_charge','repair','application','property'));

CREATE FUNCTION private.notify_object_activity(
 p_property_id uuid,p_actor_id uuid,p_source text,p_event_id uuid,p_title text,p_include_owner boolean DEFAULT true,
 p_kind text DEFAULT 'object_activity',p_entity_type text DEFAULT 'property',p_entity_id uuid DEFAULT NULL,p_managers_only boolean DEFAULT false
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 -- No audit snapshots, comments, candidate contacts, money, documents or storage
 -- paths are copied to this generic notification. Recipients re-open the app.
 INSERT INTO public.notifications(user_id,kind,title,body,href,entity_type,entity_id,dedupe_key)
 SELECT recipients.user_id,p_kind,p_title,'Откройте объект в кабинете, чтобы увидеть подробности.','/team',p_entity_type,coalesce(p_entity_id,p_property_id),
  'object:'||p_source||':'||p_event_id::text
 FROM (
  SELECT p.owner_id AS user_id FROM public.properties p WHERE p.id=p_property_id AND p_include_owner
  UNION
  SELECT m.user_id FROM public.properties p
   JOIN public.team_memberships m ON m.owner_id=p.owner_id AND m.status='active' AND (NOT p_managers_only OR m.role='manager')
   JOIN public.team_property_access a ON a.membership_id=m.id AND a.property_id=p.id
   WHERE p.id=p_property_id AND m.user_id IS NOT NULL
 ) recipients WHERE recipients.user_id IS DISTINCT FROM p_actor_id
 ON CONFLICT(user_id,dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
END;
$$;
REVOKE ALL ON FUNCTION private.notify_object_activity(uuid,uuid,text,uuid,text,boolean,text,text,uuid,boolean) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.notify_object_audit_insert() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE property_id uuid; actor_id uuid; label text; owner_recipient boolean:=true;
 kind text:='object_activity'; entity_type text:='property'; entity_id uuid; managers_only boolean:=false;
BEGIN
 IF TG_TABLE_NAME='request_status_events' THEN
  -- Initial status is already covered by the request-created event.
  IF NEW.from_status IS NULL THEN RETURN NEW; END IF;
  actor_id:=NEW.changed_by;
 ELSE actor_id:=NEW.actor_id; END IF;
 IF TG_TABLE_NAME='property_activity_events' THEN
  property_id:=NEW.property_id;
  label:=CASE NEW.event_type WHEN 'property_created' THEN 'Добавлен объект' WHEN 'property_updated' THEN 'Объект обновлён'
   WHEN 'unit_created' THEN 'Добавлено помещение' WHEN 'unit_updated' THEN 'Помещение обновлено' WHEN 'unit_deleted' THEN 'Помещение удалено' END;
 ELSIF TG_TABLE_NAME='team_activity' THEN
  property_id:=NEW.property_id;
  -- Archiving/restoring already emits property_activity_events. Request actions
  -- are handled once by requests/comments history below.
  IF NEW.action='responsible_changed' THEN label:='Изменён ответственный по объекту';
  ELSIF NEW.action='property_note' AND NOT NEW.detail ? 'to_status' THEN label:='Добавлена заметка по объекту';
  ELSE RETURN NEW; END IF;
 ELSIF TG_TABLE_NAME='recruitment_events' THEN
  SELECT l.property_id INTO property_id FROM public.property_listings l WHERE l.id=NEW.listing_id;
  label:=CASE NEW.action WHEN 'publish' THEN 'Предложение аренды опубликовано' WHEN 'pause' THEN 'Предложение аренды снято с публикации'
   WHEN 'applied' THEN 'Новый кандидат по объекту' WHEN 'withdraw' THEN 'Кандидат отозвал отклик'
   WHEN 'schedule' THEN 'Назначен показ объекта' WHEN 'shortlist' THEN 'Обновлён отбор кандидатов'
   WHEN 'note' THEN 'Обновлена заявка кандидата' WHEN 'reject' THEN 'Заявка кандидата отклонена'
   WHEN 'accept' THEN 'Выбран кандидат по объекту' WHEN 'undo_selection' THEN 'Отменён выбор кандидата' END;
  -- The existing recruitment workflow already notifies the owner about these.
  owner_recipient:=NEW.action NOT IN ('applied','withdraw');
  IF NEW.action NOT IN ('draft_saved','publish','pause') AND NEW.application_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.application_id IS NOT NULL THEN
   kind:='rental_application'; entity_type:='application'; entity_id:=NEW.application_id; managers_only:=true;
  END IF;
 ELSIF TG_TABLE_NAME='repair_events' THEN
  SELECT j.property_id INTO property_id FROM public.repair_jobs j WHERE j.id=NEW.job_id;
  label:=CASE NEW.action WHEN 'draft_saved' THEN 'Обновлена смета по объекту' WHEN 'submit' THEN 'Смета ожидает согласования'
   WHEN 'approve' THEN 'Смета согласована' WHEN 'reject' THEN 'Смета возвращена на доработку'
   WHEN 'start' THEN 'Работа по объекту начата' WHEN 'report' THEN 'Результат работы ожидает приёмки'
   WHEN 'accept' THEN 'Работа по объекту принята' WHEN 'return' THEN 'Работа возвращена на доработку'
   WHEN 'cancel' THEN 'Работа по объекту отменена' END;
  owner_recipient:=false;
  kind:='repair_status'; entity_type:='repair'; entity_id:=NEW.job_id;
 ELSIF TG_TABLE_NAME='request_status_events' THEN
  SELECT r.property_id INTO property_id FROM public.requests r WHERE r.id=NEW.request_id;
  label:='Статус заявки по объекту изменён'; owner_recipient:=false;
  kind:='request_status'; entity_type:='request'; entity_id:=NEW.request_id;
 END IF;
 IF property_id IS NOT NULL AND label IS NOT NULL THEN
  PERFORM private.notify_object_activity(property_id,actor_id,TG_TABLE_NAME,NEW.id,label,owner_recipient,kind,entity_type,entity_id,managers_only);
 END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.notify_object_audit_insert() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER notify_property_activity AFTER INSERT ON public.property_activity_events FOR EACH ROW EXECUTE FUNCTION private.notify_object_audit_insert();
CREATE TRIGGER notify_team_property_activity AFTER INSERT ON public.team_activity FOR EACH ROW EXECUTE FUNCTION private.notify_object_audit_insert();
CREATE TRIGGER notify_recruitment_property_activity AFTER INSERT ON public.recruitment_events FOR EACH ROW EXECUTE FUNCTION private.notify_object_audit_insert();
CREATE TRIGGER notify_repair_property_activity AFTER INSERT ON public.repair_events FOR EACH ROW EXECUTE FUNCTION private.notify_object_audit_insert();
CREATE TRIGGER notify_request_property_status AFTER INSERT ON public.request_status_events FOR EACH ROW EXECUTE FUNCTION private.notify_object_audit_insert();

CREATE FUNCTION private.notify_object_request_insert() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE property_id uuid;
BEGIN
 IF TG_TABLE_NAME='requests' THEN
  PERFORM private.notify_object_activity(NEW.property_id,auth.uid(),'requests',NEW.id,'Новая заявка по объекту',false,'request_created','request',NEW.id);
 ELSE
  SELECT r.property_id INTO property_id FROM public.requests r WHERE r.id=NEW.request_id;
  PERFORM private.notify_object_activity(property_id,NEW.user_id,'comments',NEW.id,'Новый комментарий к заявке по объекту',false,'request_comment','request',NEW.request_id);
 END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.notify_object_request_insert() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER notify_object_new_request AFTER INSERT ON public.requests FOR EACH ROW EXECUTE FUNCTION private.notify_object_request_insert();
CREATE TRIGGER notify_object_request_comment AFTER INSERT ON public.comments FOR EACH ROW EXECUTE FUNCTION private.notify_object_request_insert();

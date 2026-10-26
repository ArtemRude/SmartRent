SET lock_timeout='5s';
SET statement_timeout='30s';
-- Keep safeupdate enabled: explicitly scope the intentional bot-identity reset
-- to existing Telegram links/connections and the singleton configuration row.
CREATE OR REPLACE FUNCTION private.telegram_configure(p_bot_username text,p_enabled boolean) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('telegram-state',0));
 IF p_enabled IS NULL OR (p_bot_username IS NOT NULL AND p_bot_username !~ '^[A-Za-z0-9_]{5,32}$') OR (p_enabled AND p_bot_username IS NULL) THEN RAISE EXCEPTION 'Invalid bot configuration' USING ERRCODE='22023'; END IF;
 -- Swapping bot identities cannot reuse chat ids obtained by another bot.
 IF EXISTS(SELECT 1 FROM private.telegram_config WHERE bot_username IS DISTINCT FROM p_bot_username) THEN
  DELETE FROM private.telegram_links WHERE user_id IS NOT NULL; DELETE FROM private.telegram_connections WHERE user_id IS NOT NULL;
  UPDATE private.telegram_deliveries SET status=CASE WHEN status='processing' THEN 'uncertain' ELSE 'cancelled' END,error_code='bot_changed' WHERE status IN ('queued','processing');
 END IF;
 UPDATE private.telegram_config SET bot_username=p_bot_username,enabled=p_enabled WHERE singleton IS TRUE;
 IF NOT p_enabled THEN UPDATE private.telegram_deliveries SET status='cancelled',error_code='channel_disabled' WHERE status='queued'; END IF;
END;
$$;

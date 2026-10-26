-- Run in Supabase SQL Editor after adding the two named Vault secrets.
-- No credentials are stored in this file or in migration history.
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name='telegram_dispatch_url' AND decrypted_secret ~ '^https://[^/]+/functions/v1/telegram-dispatch$')
     OR NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name='telegram_worker_secret' AND length(decrypted_secret)>=32) THEN
    RAISE EXCEPTION 'Add telegram_dispatch_url and telegram_worker_secret in Vault first';
  END IF;
END;
$$;

SELECT cron.schedule(
  'telegram-dispatch', '* * * * *',
  $job$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='telegram_dispatch_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Telegram-Worker-Secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='telegram_worker_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $job$
);

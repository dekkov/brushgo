-- Run only after the Edge Function and these two Vault secrets are configured.
-- brushy_push_url: https://<project-ref>.supabase.co/functions/v1/push-dispatch
-- brushy_push_token: same random value as the Edge Function's PUSH_DISPATCH_TOKEN
-- Enable the Supabase Cron (pg_cron) and pg_net extensions first.
select cron.schedule('brushy-web-push', '* * * * *', $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'brushy_push_url'),
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' ||
      (select decrypted_secret from vault.decrypted_secrets where name = 'brushy_push_token')),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
$job$);

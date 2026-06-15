-- Enable pg_cron extension (available on Supabase paid tiers, or use the dashboard)
-- This schedules the sms-dispatch edge function every minute
select
  cron.schedule(
    'sms-dispatch-every-minute',
    '* * * * *',
    $$
    select
      net.http_post(
        url := current_setting('app.supabase_url') || '/functions/v1/sms-dispatch',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || current_setting('app.service_role_key')
        ),
        body := '{}'::jsonb
      )
    $$
  );

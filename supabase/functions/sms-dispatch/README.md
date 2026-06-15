# SMS Dispatch Edge Function

Runs every minute via pg_cron to send tee time notifications.

## Deploy

```bash
supabase functions deploy sms-dispatch --project-ref YOUR_PROJECT_REF
```

## Set secrets

```bash
supabase secrets set TWILIO_ACCOUNT_SID=your_sid --project-ref YOUR_PROJECT_REF
supabase secrets set TWILIO_AUTH_TOKEN=your_token --project-ref YOUR_PROJECT_REF
supabase secrets set TWILIO_PHONE_NUMBER=+1xxxxxxxxxx --project-ref YOUR_PROJECT_REF
```

SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are automatically available inside Edge Functions.

## Schedule (run in Supabase SQL editor after deploying)

Run `supabase/migrations/002_cron_schedule.sql` in the Supabase SQL editor.
Note: pg_cron requires the `pg_net` extension. Enable both in Supabase dashboard → Database → Extensions.

-- Atomic advance of the shared queue epoch (settings key 'queue_epoch_at').
--
-- Why a Postgres function: the app-side alternative is select-then-upsert,
-- which under concurrent requests (two staff actions at once, or a staff
-- action racing a guest's self-ready) is a classic lost-update race — and a
-- silently lost epoch update is exactly the "one source of truth silently
-- drifted" failure mode this project's SKILL.md documents happening three
-- separate times. A single function call is one atomic statement on
-- Postgres's side.
--
-- Called via supabase.rpc('advance_queue_epoch', { delta_minutes }) from
-- src/lib/queue-epoch-server.ts — positive delta for a front-of-queue
-- dequeue/notify, negative delta for an undo-notify revert.
--
-- IMPORTANT (deploy process, per SKILL.md "Known gaps"): there is no
-- Supabase CLI access to this client's project from the dev environment, so
-- this migration must be applied manually — paste this file into the
-- Supabase dashboard's SQL editor (project: River Club's own Supabase, NOT
-- Ben's Baynes org) and run it BEFORE deploying the app code that calls the
-- RPC. Until it exists, every dequeue/notify route will 500 on the epoch
-- step by design (failures are surfaced, not swallowed).

create or replace function advance_queue_epoch(delta_minutes numeric)
returns timestamptz
language plpgsql
as $$
declare
  current_val timestamptz;
  new_val timestamptz;
begin
  select value::timestamptz into current_val from settings where key = 'queue_epoch_at';
  if current_val is null then
    current_val := now();
  end if;
  -- Note: not make_interval(mins => ...) — that only accepts an integer,
  -- and rates are numeric (admin-adjustable, may be fractional).
  new_val := current_val + (delta_minutes * interval '1 minute');
  insert into settings (key, value) values ('queue_epoch_at', new_val::text)
    on conflict (key) do update set value = excluded.value;
  return new_val;
end;
$$;

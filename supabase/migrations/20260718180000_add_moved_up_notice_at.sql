-- Phase 4 (guest self-service "move down 1 spot" swap): timestamp set on
-- the party who moved UP as a result of the swap, so their tracking page
-- can show a one-time "You got moved up!" banner on its next poll.
--
-- NOT YET APPLIED TO THE LIVE PROJECT. Same constraint as
-- 20260718170000_advance_queue_epoch_function.sql: no Supabase CLI/DB
-- access is available for this client's project from this environment.
-- Run this manually via the Supabase dashboard SQL editor before the
-- swap-down feature can work live.

alter table parties add column if not exists moved_up_notice_at timestamptz;

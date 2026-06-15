create extension if not exists "uuid-ossp";

create table parties (
  id uuid primary key default uuid_generate_v4(),
  first_name text not null,
  last_initial char(1) not null,
  party_size int not null check (party_size > 0),
  phone text not null,
  notes text,
  checked_in_at timestamptz not null default now(),
  notified_at timestamptz,
  followup_sent_at timestamptz,
  status text not null default 'waiting'
    check (status in ('waiting', 'notified', 'no_show', 'playing', 'removed'))
);

create index parties_status_idx on parties(status);
create index parties_checked_in_idx on parties(checked_in_at);

create table tee_times (
  id uuid primary key default uuid_generate_v4(),
  scheduled_at timestamptz not null,
  party_size int not null check (party_size > 0),
  notes text
);

create table settings (
  key text primary key,
  value text not null
);

insert into settings (key, value) values
  ('avg_min_per_hole', '2.5'),
  ('notification_lead_minutes', '3'),
  ('no_show_timeout_minutes', '10'),
  ('queue_close_time', '20:00'),
  ('daily_reset_time', '23:00'),
  ('admin_pin', '1234'),
  ('welcome_sms_template', 'Welcome to River Club! 🏌️ Your tee time is in {wait} min. We''ll text you when it''s time to grab your putters!'),
  ('notification_sms_template', 'Hey {name}, come grab your putters — your tee time is almost here! ⛳'),
  ('followup_sms_template', 'Hey {name}, looks like you may have missed your spot! Stop by the River Club check-in desk to rejoin the queue.');

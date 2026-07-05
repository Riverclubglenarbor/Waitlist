insert into settings (key, value) values
  ('add_time_total_minutes', '0')
on conflict (key) do nothing;

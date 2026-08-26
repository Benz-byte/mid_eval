-- Optional Student Assistant assignment made from an event card.
alter table public.admin_events
  add column if not exists assistant_id text,
  add column if not exists assistant_label text;

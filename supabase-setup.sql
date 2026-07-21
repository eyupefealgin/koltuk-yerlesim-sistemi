create table if not exists venue_state (
  id int primary key default 1,
  cols int not null default 10,
  rows int not null default 8,
  seat_states jsonb not null default '[]'::jsonb,
  seat_sales jsonb not null default '[]'::jsonb,
  tiers jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

insert into venue_state (id, cols, rows, seat_states, seat_sales, tiers)
values (1, 10, 8, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb)
on conflict (id) do nothing;

grant usage on schema public to anon, authenticated;
grant select, insert, update on venue_state to anon, authenticated;

alter publication supabase_realtime add table venue_state;

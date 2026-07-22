-- Koltuklar (herkese, misafir dahil, acik): sadece doluluk bilgisi.
-- Fiyat/bilet/odeme bilgisi bu tabloda YOK -- misafirin agina bu veri hic gitmiyor.
create table if not exists seats (
  id int primary key default 1,
  cols int not null default 10,
  rows int not null default 8,
  seat_states jsonb not null default '[]'::jsonb,
  venue_type text not null default 'sinema',
  updated_at timestamptz not null default now()
);

-- Satis verisi: sadece Yonetici/Satis rolu bu tabloya erisir (client tarafinda kontrol edilir).
create table if not exists sales (
  id int primary key default 1,
  seat_sales jsonb not null default '[]'::jsonb,
  tiers jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

insert into seats (id) values (1) on conflict (id) do nothing;
insert into sales (id) values (1) on conflict (id) do nothing;

-- Onemli: yeni Supabase projelerinde RLS varsayilan acik gelebilir.
-- Bu sistemde gercek kullanici girisi (Supabase Auth) yok, roller sadece
-- client tarafinda kontrol ediliyor -- bu yuzden RLS'i kapatmak gerekiyor.
alter table seats disable row level security;
alter table sales disable row level security;

grant usage on schema public to anon, authenticated;
grant select, insert, update on seats to anon, authenticated;
grant select, insert, update on sales to anon, authenticated;

alter publication supabase_realtime add table seats;
alter publication supabase_realtime add table sales;

-- Coklu etkinlik semasi. Eski tek-etkinlikli surumden (sabit id=1 satirli
-- seats/sales tablolari) buraya gecildi -- her etkinligin kendi koltuk
-- duzeni, doluluk durumu ve satis/bilet-turu verisi var.

-- Etkinlikler (herkese, misafir dahil, acik): sadece isim/tarih/tur/doluluk.
-- Fiyat/bilet/odeme bilgisi bu tabloda YOK -- misafirin agina bu veri hic gitmiyor.
create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  event_date date,
  venue_type text not null default 'sinema',
  cols int not null default 10,
  rows int not null default 8,
  seat_states jsonb not null default '[]'::jsonb,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Satis verisi (etkinlik basina): sadece Yonetici/Satis rolu bu tabloya
-- erisir (client tarafinda kontrol edilir). event_id, events.id silindiginde
-- otomatik silinsin diye cascade.
create table if not exists event_sales (
  event_id uuid primary key references events(id) on delete cascade,
  seat_sales jsonb not null default '[]'::jsonb,
  tiers jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

-- Onemli: yeni Supabase projelerinde RLS varsayilan acik gelebilir.
-- Bu sistemde gercek kullanici girisi (Supabase Auth) yok, roller sadece
-- client tarafinda kontrol ediliyor -- bu yuzden RLS'i kapatmak gerekiyor.
alter table events disable row level security;
alter table event_sales disable row level security;

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on events to anon, authenticated;
grant select, insert, update, delete on event_sales to anon, authenticated;

alter publication supabase_realtime add table events;
alter publication supabase_realtime add table event_sales;

-- Eski tek-etkinlikli tablolar (seats, sales) artik kullanilmiyor.
-- Gercek verin varsa once ona gore yeni bir etkinlik olustur, sonra
-- istersen eski tablolari elle silebilirsin:
--   drop table if exists seats;
--   drop table if exists sales;

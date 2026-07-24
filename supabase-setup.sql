-- Coklu etkinlik semasi. Eski tek-etkinlikli surumden (sabit id=1 satirli
-- seats/sales tablolari) buraya gecildi -- her etkinligin kendi koltuk
-- duzeni, doluluk durumu ve satis/bilet-turu verisi var.
--
-- Bu script bastan asagi TEKRAR CALISTIRILABILIR (idempotent) -- create
-- table'lar IF NOT EXISTS, yeni sutun ADD COLUMN IF NOT EXISTS, publication'a
-- ekleme de var mi diye kontrol edip sadece yoksa ekliyor. Daha once
-- calistirdiysan ve "already member of publication" gibi bir hatayla
-- yarim kaldiysa, bu guncel halini bastan sona tekrar calistirman yeterli.

-- Etkinlikler (herkese, misafir dahil, acik): isim/tarih/tur/doluluk +
-- bilet turleri/fiyatlari (tiers). Fiyat LISTESI gizli bir bilgi degil --
-- gercek bir etkinlikte herkes fiyatlari gorebilir, misafir kendi bileti
-- kendi alabilsin diye burada tutuluyor. Gizli kalan sey KIMIN NE ALDIGI
-- (event_sales.seat_sales) -- o hala ayri tabloda.
create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  event_date date,
  venue_type text not null default 'sinema',
  cols int not null default 10,
  rows int not null default 8,
  seat_states jsonb not null default '[]'::jsonb,
  tiers jsonb not null default '[]'::jsonb,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Tablo daha once (tiers sutunu olmadan) olusturulmus olabilir -- garanti olsun diye.
alter table events add column if not exists tiers jsonb not null default '[]'::jsonb;

-- Satis verisi (etkinlik basina): kimin hangi koltugu ne kadara, hangi
-- odeme yontemiyle aldigi + bilet kodu/check-in durumu. Sadece Yonetici/
-- Satis rolu bu tabloyu toplu okur (client tarafinda kontrol edilir);
-- misafir sadece KENDI satin alma islemini yazar (purchase_seat()
-- fonksiyonu ile), asla baskasinin satirini okumaz. event_id, events.id
-- silindiginde otomatik silinsin diye cascade.
create table if not exists event_sales (
  event_id uuid primary key references events(id) on delete cascade,
  seat_sales jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

-- Tiers artik events tablosunda -- eski surumden kalma sutunu varsa temizle.
alter table event_sales drop column if exists tiers;

-- Onemli: yeni Supabase projelerinde RLS varsayilan acik gelebilir.
-- Bu sistemde gercek kullanici girisi (Supabase Auth) yok, roller sadece
-- client tarafinda kontrol ediliyor -- bu yuzden RLS'i kapatmak gerekiyor.
alter table events disable row level security;
alter table event_sales disable row level security;

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on events to anon, authenticated;
grant select, insert, update, delete on event_sales to anon, authenticated;

-- ALTER PUBLICATION ... ADD TABLE'in IF NOT EXISTS'i yok -- daha once
-- eklenmisse hata firlatip scriptin geri kalanini (asagidaki fonksiyon dahil)
-- rollback ettiriyordu. Once var mi diye kontrol edip sadece yoksa ekliyoruz.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'events'
  ) then
    alter publication supabase_realtime add table events;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'event_sales'
  ) then
    alter publication supabase_realtime add table event_sales;
  end if;
end $$;

-- Tek bir koltugu atomik olarak "satin al" -- misafirin kendi bileti kendi
-- almasi icin kullanilir. Iki farkli misafir ayni bos koltuga ayni anda
-- tiklarsa WHERE kosulundaki "hala empty mi" kontrolu sayesinde sadece biri
-- basarili olur, digeri SEAT_UNAVAILABLE hatasi alir. jsonb_set ile SADECE
-- ilgili index guncellenir -- misafirin tarayicisindaki eksik/eski kopya
-- diger koltuklarin/satislarin verisini asla ezmez.
create or replace function purchase_seat(p_event_id uuid, p_idx int, p_gender text, p_sale jsonb)
returns void
language plpgsql
security definer
as $$
begin
  update events
  set seat_states = jsonb_set(seat_states, array[p_idx::text], to_jsonb(p_gender)),
      updated_at = now()
  where id = p_event_id
    and seat_states ->> p_idx = 'empty'; -- ->> int = array index; ->> text (::text cast) NULL doner ve hep SEAT_UNAVAILABLE firlatirdi

  if not found then
    raise exception 'SEAT_UNAVAILABLE';
  end if;

  update event_sales
  set seat_sales = jsonb_set(seat_sales, array[p_idx::text], p_sale),
      updated_at = now()
  where event_id = p_event_id;
end;
$$;

grant execute on function purchase_seat(uuid, int, text, jsonb) to anon, authenticated;

-- Eski tek-etkinlikli tablolar (seats, sales) artik kullanilmiyor.
-- Gercek verin varsa once ona gore yeni bir etkinlik olustur, sonra
-- istersen eski tablolari elle silebilirsin:
--   drop table if exists seats;
--   drop table if exists sales;

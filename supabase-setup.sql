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

-- ============================================================
-- KOLTUK REZERVASYONU (sepet zamanlayicisi)
-- ============================================================
-- Bir kullanici koltugu secip satin alma akisina girdiginde birkac dakika
-- icin kilitlenir -- ayni koltuga baskasi tiklarsa "az once tutuldu"
-- hatasi alir. Sure dolunca (expires_at gecince) veya kullanici vazgecip
-- modali kapatinca serbest kalir.
create table if not exists seat_holds (
  event_id uuid not null references events(id) on delete cascade,
  seat_idx int not null,
  hold_token text not null,
  expires_at timestamptz not null,
  primary key (event_id, seat_idx)
);
alter table seat_holds disable row level security;
grant select, insert, update, delete on seat_holds to anon, authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'seat_holds'
  ) then
    alter publication supabase_realtime add table seat_holds;
  end if;
end $$;

create or replace function reserve_seat(p_event_id uuid, p_idx int, p_token text, p_ttl_seconds int default 300)
returns void
language plpgsql
security definer
as $$
begin
  delete from seat_holds where event_id = p_event_id and seat_idx = p_idx and expires_at < now();

  if exists (
    select 1 from seat_holds
    where event_id = p_event_id and seat_idx = p_idx and hold_token <> p_token
  ) then
    raise exception 'SEAT_HELD';
  end if;

  if not exists (
    select 1 from events where id = p_event_id and seat_states ->> p_idx = 'empty'
  ) then
    raise exception 'SEAT_UNAVAILABLE';
  end if;

  insert into seat_holds (event_id, seat_idx, hold_token, expires_at)
  values (p_event_id, p_idx, p_token, now() + (p_ttl_seconds || ' seconds')::interval)
  on conflict (event_id, seat_idx)
  do update set hold_token = excluded.hold_token, expires_at = excluded.expires_at;
end;
$$;
grant execute on function reserve_seat(uuid, int, text, int) to anon, authenticated;

create or replace function release_seat_hold(p_event_id uuid, p_idx int, p_token text)
returns void
language plpgsql
security definer
as $$
begin
  delete from seat_holds
  where event_id = p_event_id and seat_idx = p_idx and hold_token = p_token;
end;
$$;
grant execute on function release_seat_hold(uuid, int, text) to anon, authenticated;

-- Tek bir koltugu atomik olarak "satin al" -- misafirin kendi bileti kendi
-- almasi icin kullanilir. Iki farkli misafir ayni bos koltuga ayni anda
-- tiklarsa WHERE kosulundaki "hala empty mi" kontrolu sayesinde sadece biri
-- basarili olur, digeri SEAT_UNAVAILABLE hatasi alir. jsonb_set ile SADECE
-- ilgili index guncellenir -- misafirin tarayicisindaki eksik/eski kopya
-- diger koltuklarin/satislarin verisini asla ezmez. p_token verilirse
-- kendi hold'unu es gecer; baskasinin aktif (suresi dolmamis) hold'u varsa
-- SEAT_HELD hatasi verir.
create or replace function purchase_seat(p_event_id uuid, p_idx int, p_gender text, p_sale jsonb, p_token text default null)
returns void
language plpgsql
security definer
as $$
begin
  delete from seat_holds where event_id = p_event_id and seat_idx = p_idx and expires_at < now();

  if exists (
    select 1 from seat_holds
    where event_id = p_event_id and seat_idx = p_idx and (p_token is null or hold_token <> p_token)
  ) then
    raise exception 'SEAT_HELD';
  end if;

  update events
  set seat_states = jsonb_set(seat_states, array[p_idx::text], to_jsonb(p_gender)),
      updated_at = now()
  where id = p_event_id
    and seat_states ->> p_idx = 'empty'; -- ->> int = array index; ->> text (::text cast) NULL doner ve hep SEAT_UNAVAILABLE firlatirdi

  if not found then
    raise exception 'SEAT_UNAVAILABLE';
  end if;

  delete from seat_holds where event_id = p_event_id and seat_idx = p_idx;

  update event_sales
  set seat_sales = jsonb_set(seat_sales, array[p_idx::text], p_sale),
      updated_at = now()
  where event_id = p_event_id;
end;
$$;

grant execute on function purchase_seat(uuid, int, text, jsonb, text) to anon, authenticated;

-- ============================================================
-- INDIRIM KODLARI (etkinlik basina)
-- ============================================================
alter table events add column if not exists discount_codes jsonb not null default '[]'::jsonb;

-- Bir indirim kodunu atomik olarak "kullan": kod yoksa CODE_NOT_FOUND,
-- kullanim limiti dolduysa CODE_EXHAUSTED hatasi verir; gecerliyse
-- used_count'u +1 yapar ve guncel kod kaydini (tip/deger) dondurur --
-- client bunu indirimli fiyati hesaplamak icin kullanir. "for update"
-- satir kilidi, ayni kodun ayni anda iki kez kullanilmasini engeller.
create or replace function redeem_discount_code(p_event_id uuid, p_code text)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_codes jsonb;
  v_i int;
  v_entry jsonb;
  v_found_i int := null;
begin
  select discount_codes into v_codes from events where id = p_event_id for update;
  if v_codes is null then
    raise exception 'CODE_NOT_FOUND';
  end if;

  for v_i in 0 .. jsonb_array_length(v_codes) - 1 loop
    v_entry := v_codes -> v_i;
    if upper(v_entry ->> 'code') = upper(p_code) then
      v_found_i := v_i;
      exit;
    end if;
  end loop;

  if v_found_i is null then
    raise exception 'CODE_NOT_FOUND';
  end if;

  v_entry := v_codes -> v_found_i;

  if (v_entry ->> 'maxUses') is not null
     and (v_entry ->> 'usedCount')::int >= (v_entry ->> 'maxUses')::int then
    raise exception 'CODE_EXHAUSTED';
  end if;

  v_entry := jsonb_set(v_entry, '{usedCount}', to_jsonb(coalesce((v_entry ->> 'usedCount')::int, 0) + 1));

  update events
  set discount_codes = jsonb_set(discount_codes, array[v_found_i::text], v_entry),
      updated_at = now()
  where id = p_event_id;

  return v_entry;
end;
$$;
grant execute on function redeem_discount_code(uuid, text) to anon, authenticated;

-- Eski tek-etkinlikli tablolar (seats, sales) artik kullanilmiyor.
-- Gercek verin varsa once ona gore yeni bir etkinlik olustur, sonra
-- istersen eski tablolari elle silebilirsin:
--   drop table if exists seats;
--   drop table if exists sales;

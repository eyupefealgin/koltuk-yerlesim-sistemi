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
-- Satis rolu bu tabloyu toplu okur -- ARTIK GERCEKTEN (bkz. asagidaki RLS),
-- eskiden sadece client tarafinda kontrol ediliyordu ve anon key ile herkes
-- bu tabloyu dogrudan okuyabiliyordu (guvenlik denetiminin en kritik
-- bulgusu). Misafir kendi satin alma islemini purchase_seat()/
-- purchase_stadium_block() ile yazar (security definer, RLS'i atlar);
-- kendi biletini de find_ticket_by_code() ile bulur (tum tabloyu degil,
-- sadece eslesen bileti dondurur). event_id, events.id silindiginde
-- otomatik silinsin diye cascade.
create table if not exists event_sales (
  event_id uuid primary key references events(id) on delete cascade,
  seat_sales jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

-- Tiers artik events tablosunda -- eski surumden kalma sutunu varsa temizle.
alter table event_sales drop column if exists tiers;

-- ============================================================
-- GERCEK ROL/YETKI SISTEMI (Supabase Auth + profiles)
-- ============================================================
-- Eskiden roller ("misafir"/"satis"/"yonetici") sadece client'ta bir
-- sessionStorage degeriydi -- sunucu/veritabani bunu hic bilmiyordu, bu
-- yuzden RLS kapaliydi ve anon key'i bilen HERKES tum satis verisini
-- okuyabiliyor/degistirebiliyordu (guvenlik denetiminin #1 bulgusu).
-- Artik personel gercek bir Supabase Auth hesabiyla giris yapiyor; bu
-- tablo o hesabin (auth.users.id) hangi role sahip oldugunu tutuyor.
-- Hesaplari Supabase Dashboard > Authentication > Users'tan elle
-- olusturup buraya bir satir eklemen gerekiyor (bkz. README).
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('admin', 'sales')),
  created_at timestamptz not null default now()
);
alter table profiles enable row level security;

drop policy if exists "kendi profilini oku" on profiles;
create policy "kendi profilini oku" on profiles
  for select to authenticated
  using (id = auth.uid());

-- security definer + stable: RLS politikalarinin icinde guvenle cagrilabilir
-- (kendi basina bir sonsuz donguye girmez, cunku profiles tablosunun RLS'ini
-- degil dogrudan satiri okuyor).
create or replace function current_staff_role()
returns text
language sql
security definer
stable
as $$
  select role from profiles where id = auth.uid();
$$;
grant execute on function current_staff_role() to anon, authenticated;

-- ============================================================
-- ROW LEVEL SECURITY: events + event_sales
-- ============================================================
-- events: fiyat listesi/doluluk herkese acik kalmali (misafir kendi bileti
-- kendi alabilsin diye) -- SELECT anon+authenticated'a acik. Yazma islemleri
-- (etkinlik olustur/sil/duzenle) artik SADECE gercekten giris yapmis
-- personele acik.
alter table events enable row level security;

drop policy if exists "herkes okuyabilir" on events;
create policy "herkes okuyabilir" on events
  for select to anon, authenticated
  using (true);

drop policy if exists "personel guncelleyebilir" on events;
create policy "personel guncelleyebilir" on events
  for update to authenticated
  using (current_staff_role() in ('admin', 'sales'));

drop policy if exists "yonetici olusturabilir" on events;
create policy "yonetici olusturabilir" on events
  for insert to authenticated
  with check (current_staff_role() = 'admin');

drop policy if exists "yonetici silebilir" on events;
create policy "yonetici silebilir" on events
  for delete to authenticated
  using (current_staff_role() = 'admin');

revoke insert, update, delete on events from anon;
grant select on events to anon;
grant select, insert, update, delete on events to authenticated;

-- event_sales: kimin ne aldigi artik SADECE giris yapmis personel tarafindan
-- toplu okunabiliyor -- misafir artik bu tabloyu hic dogrudan sorgulamiyor,
-- kendi bileti icin find_ticket_by_code() RPC'sini kullaniyor (bkz. asagi).
alter table event_sales enable row level security;

drop policy if exists "personel okuyabilir" on event_sales;
create policy "personel okuyabilir" on event_sales
  for select to authenticated
  using (current_staff_role() in ('admin', 'sales'));

drop policy if exists "personel guncelleyebilir (sales)" on event_sales;
create policy "personel guncelleyebilir (sales)" on event_sales
  for update to authenticated
  using (current_staff_role() in ('admin', 'sales'));

drop policy if exists "yonetici olusturabilir (sales)" on event_sales;
create policy "yonetici olusturabilir (sales)" on event_sales
  for insert to authenticated
  with check (current_staff_role() = 'admin');

revoke select, insert, update, delete on event_sales from anon;
grant select, insert, update, delete on event_sales to authenticated;

grant usage on schema public to anon, authenticated;

-- Misafirin kendi biletini bilet koduyla bulmasi ("Biletim Var") -- eskiden
-- client TUM event_sales tablosunu ("select event_id, seat_sales" -- her
-- etkinligin butun satis dizisi) indirip kendi tarayicisinda araniyordu; bu
-- hem yukaridaki RLS'le artik zaten calismaz (anon'un event_sales SELECT
-- yetkisi yok) hem de gereksiz yere agir bir veri transferiydi. Bu fonksiyon
-- aramayi sunucuda yapip SADECE eslesen tek bileti donduruyor.
create or replace function find_ticket_by_code(p_code text)
returns table(
  event_id uuid, seat_idx int, sale jsonb,
  event_name text, event_venue_type text, event_cols int, event_rows int,
  event_accessible_seats jsonb
)
language plpgsql
security definer
as $$
declare
  v_row record;
  v_idx int;
  v_entry jsonb;
  v_candidates jsonb;
  v_found jsonb;
begin
  for v_row in select es.event_id, es.seat_sales from event_sales es loop
    for v_idx in 0 .. coalesce(jsonb_array_length(v_row.seat_sales), 1) - 1 loop
      v_entry := v_row.seat_sales -> v_idx;
      if v_entry is null or jsonb_typeof(v_entry) = 'null' then
        continue;
      end if;
      v_candidates := case when jsonb_typeof(v_entry) = 'array' then v_entry else jsonb_build_array(v_entry) end;

      select c into v_found from jsonb_array_elements(v_candidates) c
      where c ->> 'ticketCode' = p_code limit 1;

      if v_found is not null then
        return query
          select v_row.event_id, v_idx, v_found, e.name, e.venue_type, e.cols, e.rows, e.accessible_seats
          from events e where e.id = v_row.event_id;
        return;
      end if;
    end loop;
  end loop;
  return;
end;
$$;
grant execute on function find_ticket_by_code(text) to anon, authenticated;

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

  -- 'e' yeni kisa kodlama, 'empty' eski uzun format -- ikisini de kabul
  -- ediyoruz ki JS ve SQL farkli zamanlarda guncellense de bozulmasin.
  if not exists (
    select 1 from events where id = p_event_id and seat_states ->> p_idx in ('e', 'empty')
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

-- Guvenlik denetimi: misafir satin alma RPC'lerine (purchase_seat,
-- purchase_stadium_block) gelen p_sale/p_sales.price client'ta hesaplaniyor
-- ve ONCEDEN hic dogrulanmiyordu -- tarayici konsolundan RPC'yi dogrudan
-- cagirip fiyati 0/negatif/istenilen deger yapmak mumkundu. Bu fonksiyon,
-- gonderilen fiyatin o etkinligin GERCEK tiers fiyatina (+ olasi yogun talep
-- zammi tavani, - olasi en yuksek indirim kodu) gore mantikli bir aralikta
-- olup olmadigini kontrol ediyor. Not: bu kontrol SADECE guest self-purchase
-- RPC'lerini kapsiyor -- personelin toplu-yazan push mekanizmasi (bkz.
-- pushSalesData) hala dogrudan tablo yazdigi icin bu RPC'nin disinda kalir
-- (guvenlik denetimindeki RLS/anon-erisim bulgusuyla ayni kok neden).
create or replace function validate_sale_price(p_event_id uuid, p_tier_id text, p_price numeric)
returns boolean
language plpgsql
security definer
as $$
declare
  v_tiers jsonb;
  v_tier jsonb;
  v_base numeric;
  v_dyn jsonb;
  v_surge_mult numeric := 1;
  v_ceiling numeric;
  v_codes jsonb;
  v_code jsonb;
  v_i int;
  v_max_pct numeric := 0;
  v_max_fixed numeric := 0;
  v_floor numeric;
begin
  if p_price is null or p_price < 0 then
    return false;
  end if;

  select tiers, dynamic_pricing, discount_codes
    into v_tiers, v_dyn, v_codes
    from events where id = p_event_id;

  if v_tiers is null then
    return false;
  end if;

  select t into v_tier from jsonb_array_elements(v_tiers) t where t ->> 'id' = p_tier_id limit 1;
  if v_tier is null then
    return false;
  end if;

  v_base := (v_tier ->> 'price')::numeric;

  if v_dyn is not null and coalesce((v_dyn ->> 'enabled')::boolean, false) then
    -- Guncel dolulugun esigi gecip gecmedigine bakmiyoruz (kucuk bir yaris
    -- durumu yaratirdi) -- sadece "zam aktifse en fazla ne kadar olabilir"
    -- tavanini hesapliyoruz, her zaman guvenli tarafta kaliyoruz.
    v_surge_mult := 1 + coalesce((v_dyn ->> 'increase')::numeric, 0) / 100;
  end if;
  v_ceiling := round(v_base * v_surge_mult);

  if v_codes is not null then
    for v_i in 0 .. jsonb_array_length(v_codes) - 1 loop
      v_code := v_codes -> v_i;
      if (v_code ->> 'maxUses') is null
         or coalesce((v_code ->> 'usedCount')::int, 0) < (v_code ->> 'maxUses')::int then
        if v_code ->> 'type' = 'percent' then
          v_max_pct := greatest(v_max_pct, coalesce((v_code ->> 'value')::numeric, 0));
        else
          v_max_fixed := greatest(v_max_fixed, coalesce((v_code ->> 'value')::numeric, 0));
        end if;
      end if;
    end loop;
  end if;

  v_floor := greatest(0, round(v_ceiling * (1 - v_max_pct / 100)) - v_max_fixed);

  -- +-1 yuvarlama toleransi (client Math.round kullaniyor).
  return p_price >= v_floor - 1 and p_price <= v_ceiling + 1;
end;
$$;
grant execute on function validate_sale_price(uuid, text, numeric) to anon, authenticated;

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
  if not validate_sale_price(p_event_id, p_sale ->> 'tier', (p_sale ->> 'price')::numeric) then
    raise exception 'INVALID_PRICE';
  end if;

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
    -- ->> int = dizi indeksi; ->> text (::text cast) NULL doner ve hep
    -- SEAT_UNAVAILABLE firlatirdi. 'e' yeni kisa kodlama, 'empty' eski format.
    and seat_states ->> p_idx in ('e', 'empty');

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

-- ============================================================
-- AFIS GORSELI + DINAMIK FIYATLANDIRMA (etkinlik basina)
-- ============================================================
-- poster_url: etkinlik kartinda/detayinda gosterilen afis (opsiyonel).
-- dynamic_pricing: {"enabled":bool,"threshold":int,"increase":int}
--   doluluk >= threshold% olunca fiyatlara increase% zam uygulanir.
alter table events add column if not exists poster_url text;
alter table events add column if not exists dynamic_pricing jsonb not null
  default '{"enabled":false,"threshold":80,"increase":10}'::jsonb;

-- ============================================================
-- ERISILEBILIR / ENGELLI KOLTUK ISARETLEME (etkinlik basina)
-- ============================================================
-- accessible_seats: koltuk indekslerinin (int) dizisi, ornegin [3, 4, 27].
-- Koltugun dolu/bos durumundan bagimsiz, sabit bir fiziksel ozellik.
alter table events add column if not exists accessible_seats jsonb not null
  default '[]'::jsonb;

-- ============================================================
-- ETKINLIK NOTU (etkinlik basina)
-- ============================================================
-- note: misafirlere gosterilen serbest metin (ornegin "Kapilar 19:00'da
-- acilir", festival kurallari, vb.) -- hassas degil, poster_url gibi herkese
-- acik.
alter table events add column if not exists note text;

-- ============================================================
-- GENEL ETKINLIK: UCRETSIZ/BILETSIZ TEK GIRIS HAVUZU (etkinlik basina)
-- ============================================================
-- general_capacity: sadece venue_type='genel' etkinliklerde kullanilir --
-- koltuk numarasi/bilet turu/fiyat yok, tek bir kapasiteli havuz (bkz.
-- joinGeneralEvent). seat_states[0] o havuza KATILAN kisi sayisidir.
alter table events add column if not exists general_capacity int not null default 500;

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

-- ============================================================
-- KOLTUK DURUMU KISA KODLAMASI (veri trafigini kucultmek icin)
-- ============================================================
-- Realtime, bir satir her degistiginde satirin TAMAMINI yayinliyor; en buyuk
-- alan seat_states oldugu icin degerleri tek harfe indirdik:
--   "empty" -> "e",  "male" -> "m",  "female" -> "f"
-- Asagidaki migrasyon mevcut kayitlari yeni formata cevirir. Fonksiyonlar
-- iki formati da kabul ettigi icin bu adim atlanirsa da sistem calisir,
-- sadece o eski satirlar buyuk kalmaya devam eder.
-- "with ordinality ... order by ord": koltuk sirasi kesinlikle korunmali,
-- yoksa tum koltuklar birbirine karisir.
update events e
set seat_states = sub.new_states
from (
  select ev.id,
         jsonb_agg(
           case elem #>> '{}'
             when 'empty' then '"e"'::jsonb
             when 'male' then '"m"'::jsonb
             when 'female' then '"f"'::jsonb
             else elem
           end
           order by ord
         ) as new_states
  from events ev,
       lateral jsonb_array_elements(ev.seat_states) with ordinality as a(elem, ord)
  where jsonb_typeof(ev.seat_states) = 'array'
    and ev.seat_states::text ~ '"(empty|male|female)"'
  group by ev.id
) sub
where e.id = sub.id;

-- ============================================================
-- BILET IPTALI (musterinin kendi bileti)
-- ============================================================
-- Yetkilendirme bilet kodunun kendisi: kodu bilmeyen iptal edemez.
-- Kapidan giris yapilmis (checkedIn) bir bilet iptal edilemez.
create or replace function cancel_ticket(p_event_id uuid, p_idx int, p_ticket_code text)
returns void
language plpgsql
security definer
as $$
declare
  v_sale jsonb;
begin
  select seat_sales -> p_idx into v_sale
  from event_sales where event_id = p_event_id;

  if v_sale is null or jsonb_typeof(v_sale) = 'null' then
    raise exception 'TICKET_NOT_FOUND';
  end if;

  if v_sale ->> 'ticketCode' is distinct from p_ticket_code then
    raise exception 'TICKET_NOT_FOUND';
  end if;

  if coalesce((v_sale ->> 'checkedIn')::boolean, false) then
    raise exception 'ALREADY_CHECKED_IN';
  end if;

  update events
  set seat_states = jsonb_set(seat_states, array[p_idx::text], '"e"'::jsonb),
      updated_at = now()
  where id = p_event_id;

  update event_sales
  set seat_sales = jsonb_set(seat_sales, array[p_idx::text], 'null'::jsonb),
      updated_at = now()
  where event_id = p_event_id;
end;
$$;
grant execute on function cancel_ticket(uuid, int, text) to anon, authenticated;

-- ============================================================
-- FUTBOL SAHASI: KAPASITELI BLOK SATISI
-- ============================================================
-- Diger venue turlerinde "bir koltuk = bir alici" ama gercek bir stadyum
-- boyle calismiyor: "Premium 1" gibi bir blok tek kisilik degil, N kisilik.
-- Bu yuzden futbol bloklarinda iki alan farkli anlama geliyor:
--   events.seat_states[idx]      -> TAM SAYI: o bloktan simdiye kadar
--                                    satilan bilet sayisi (0..capacity)
--   event_sales.seat_sales[idx]  -> DIZI: o bloktaki her bilet kendi
--                                    kaydiyla (alici, cinsiyet, kod, odeme)
-- p_capacity client'tan geliyor (STADIUM_BLOCKS'ta sabit, sir degil) --
-- ayni p_gender'in purchase_seat'e client'tan gelmesi gibi.
create or replace function purchase_stadium_block(
  p_event_id uuid, p_idx int, p_quantity int, p_capacity int, p_sales jsonb, p_token text default null
)
returns void
language plpgsql
security definer
as $$
declare
  v_i int;
  v_sale jsonb;
begin
  if p_quantity is null or p_quantity < 1 then
    raise exception 'INVALID_QUANTITY';
  end if;

  -- Genel Etkinlik'in ucretsiz havuzunda p_sales bos dizi gelir (bkz.
  -- joinGeneralEvent) -- dongu hicbir sey yapmaz, gecerli. Futbol
  -- bloklarinda her satis kaydinin fiyati gercek tiers fiyatina gore
  -- dogrulaniyor (bkz. validate_sale_price).
  if p_sales is not null and jsonb_typeof(p_sales) = 'array' then
    for v_i in 0 .. jsonb_array_length(p_sales) - 1 loop
      v_sale := p_sales -> v_i;
      if not validate_sale_price(p_event_id, v_sale ->> 'tier', (v_sale ->> 'price')::numeric) then
        raise exception 'INVALID_PRICE';
      end if;
    end loop;
  end if;

  delete from seat_holds where event_id = p_event_id and seat_idx = p_idx and expires_at < now();
  if exists (
    select 1 from seat_holds
    where event_id = p_event_id and seat_idx = p_idx and (p_token is null or hold_token <> p_token)
  ) then
    raise exception 'SEAT_HELD';
  end if;

  -- Atomik kapasite kontrolu: WHERE kosulu UPDATE ile AYNI satirda
  -- degerlendirildigi icin iki alici ayni anda gelirse biri kazanir,
  -- digeri (guncel sayiyi gormeden) CAPACITY_EXCEEDED alir -- purchase_seat'in
  -- "hala empty mi" deseninin kapasiteli versiyonu.
  update events
  set seat_states = jsonb_set(
        seat_states, array[p_idx::text],
        to_jsonb(coalesce((seat_states ->> p_idx)::int, 0) + p_quantity)
      ),
      updated_at = now()
  where id = p_event_id
    and coalesce((seat_states ->> p_idx)::int, 0) + p_quantity <= p_capacity;

  if not found then
    raise exception 'CAPACITY_EXCEEDED';
  end if;

  delete from seat_holds where event_id = p_event_id and seat_idx = p_idx;

  -- coalesce(x, '[]') sadece x SQL NULL ise devreye girer -- ama bos bir
  -- havuz burada JSONB NULL olarak saklanmis olabilir (bkz. event_sales
  -- insert'i / eski veri gocleri), ki bu SQL NULL DEGILDIR. O durumda
  -- coalesce hicbir sey yapmaz ve 'null'::jsonb || p_sales, sol taraf dizi
  -- olmadigindan onu [null] olarak sarip sonuca bastan bir null sokusturur
  -- (Postgres'in jsonb || davranisi). jsonb_typeof kontroluyle GERCEKTEN
  -- dizi olmayan her seyi (SQL NULL, JSONB null, yanlislikla baska bir tip)
  -- once '[]'e ceviriyoruz.
  update event_sales
  set seat_sales = jsonb_set(
        seat_sales, array[p_idx::text],
        (case when jsonb_typeof(seat_sales -> p_idx) = 'array' then seat_sales -> p_idx else '[]'::jsonb end) || p_sales
      ),
      updated_at = now()
  where event_id = p_event_id;
end;
$$;
grant execute on function purchase_stadium_block(uuid, int, int, int, jsonb, text) to anon, authenticated;

-- Kapasiteli blokta TEK bir bileti iptal eder (dizideki eslesen ticketCode).
-- Blok satis sayaci (seat_states[idx]) 1 azalir; diger biletler etkilenmez.
create or replace function cancel_stadium_ticket(p_event_id uuid, p_idx int, p_ticket_code text)
returns void
language plpgsql
security definer
as $$
declare
  v_tickets jsonb;
  v_i int;
  v_found_i int := null;
begin
  select seat_sales -> p_idx into v_tickets
  from event_sales where event_id = p_event_id;

  if v_tickets is null or jsonb_typeof(v_tickets) <> 'array' then
    raise exception 'TICKET_NOT_FOUND';
  end if;

  for v_i in 0 .. jsonb_array_length(v_tickets) - 1 loop
    if (v_tickets -> v_i ->> 'ticketCode') = p_ticket_code then
      v_found_i := v_i;
      exit;
    end if;
  end loop;

  if v_found_i is null then
    raise exception 'TICKET_NOT_FOUND';
  end if;

  if coalesce((v_tickets -> v_found_i ->> 'checkedIn')::boolean, false) then
    raise exception 'ALREADY_CHECKED_IN';
  end if;

  update event_sales
  set seat_sales = jsonb_set(seat_sales, array[p_idx::text], v_tickets - v_found_i),
      updated_at = now()
  where event_id = p_event_id;

  update events
  set seat_states = jsonb_set(
        seat_states, array[p_idx::text],
        to_jsonb(greatest(0, coalesce((seat_states ->> p_idx)::int, 1) - 1))
      ),
      updated_at = now()
  where id = p_event_id;
end;
$$;
grant execute on function cancel_stadium_ticket(uuid, int, text) to anon, authenticated;

-- Eski tek-etkinlikli tablolar (seats, sales) artik kullanilmiyor.
-- Gercek verin varsa once ona gore yeni bir etkinlik olustur, sonra
-- istersen eski tablolari elle silebilirsin:
--   drop table if exists seats;
--   drop table if exists sales;

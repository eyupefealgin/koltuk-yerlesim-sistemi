# Koltuk Yerleşim Sistemi

https://eyupefealgin.github.io/koltuk-yerlesim-sistemi/

Sinema/tiyatro/konser/futbol sahası gibi **birden çok etkinlik** için koltuk yerleşim ve bilet satış sistemi. Misafir/Satış/Yönetici olmak üzere 3 rol var ve Supabase üzerinden **çoklu cihaz senkronizasyonu** ile çalışıyor — bir bilgisayarda yapılan değişiklik anında diğerlerinde de görünüyor.

## Özellikler

- **Çoklu etkinlik**: giriş yaptıktan sonra bir **Etkinlikler** listesi karşılıyor — her etkinliğin kendi adı, tarihi, türü, koltuk düzeni ve satışları var. Yönetici "+ Yeni Etkinlik" ile oluşturur, herkes listeden birine girip görüntüleyebilir/satabilir. Etkinlik kartlarında canlı doluluk yüzdesi görünür (Misafir dahil — fiyat sızmaz, sadece doluluk oranı)
- **3 rol**: **Misafir** (şifresiz, sadece görüntüler) · **Satış** (kendi şifresi, koltuk satar) · **Yönetici** (kendi şifresi, her şeye erişir: etkinlik oluşturma/arşivleme/silme, düzen, bilet türleri, sıfırlama)
- **Etkinlik türü**: her etkinlik için Sinema / Tiyatro / Konser / Futbol Sahası / Genel Etkinlik seçilir — üstteki "PERDE/SAHNE/ALAN" alanı türe göre şekil ve etiket değiştirir
- **Futbol Sahası düzeni**: sayısal koltuk yerine sabit bir stadyum şeması — ortada saha, etrafında Doğu/Batı/Kuzey/Güney tribün blokları (iç+dış katman) + VIP/Misafir/Basın/Protokol köşe blokları (44 blok). Sütun/satır ayarı bu türde geçerli değil; diğer türler normal koltuk ızgarasını kullanır
- **Arama ve filtre**: koltuk/blok numarasına, ada, cinsiyete, bilet türüne veya ödeme yöntemine göre anlık arama; Tümü/Boş/Erkek/Kadın/Satılan filtre cipleri ile eşleşmeyen koltuklar soluklaştırılır. İstatistik panelinde canlı **doluluk yüzdesi** çubuğu
- **Satış akışı**: bir koltuğa tıkla → sırayla **Cinsiyet** (Erkek/Kadın) → **Bilet Türü** (Standart/VIP/Öğrenci/... ) → **Ödeme Yöntemi** (Kart/Nakit) seç, koltuk otomatik kaydedilir. Dolu bir koltuğa tıklayınca bilgisi gösterilir, "Koltuğu Boşalt" ile geri alınabilir
- **Toplu seçim**: "Çoklu Seçim" moduna geçip birden fazla boş koltuğu işaretleyip "Satışa Başla" ile hepsine tek seferde aynı cinsiyet/tür/ödeme uygulanabilir
- **Cinsiyet uyarısı**: aynı sırada yan yana farklı cinsiyet atanacaksa uyarı gösterilir (işlemi engellemez)
- Her etkinlik için sütun/satır sayısı girilir, hazır düzen şablonları (6×5, 10×8, 12×10, 16×12) — sadece Yönetici
- **Bilet türlerini yönetme**: her etkinliğin kendi bilet türleri/fiyatları var; ekle, sil, fiyatını değiştir — sadece Yönetici; daha önce satılmış koltuklar satıldığı andaki isim/fiyatı korur
- Canlı istatistik + **Ciro Özeti** (bilet türüne göre + ödeme yöntemine göre — Kart/Nakit) — Satış ve Yönetici görür, Misafir görmez
- **Çoklu cihaz senkronizasyonu + veri azaltma**: Supabase realtime ile iki ayrı tablo kullanılır — `events` (etkinlik adı/tarih/tür/doluluk) herkese açık, `event_sales` (fiyat/bilet/ödeme, etkinlik başına) sadece Satış/Yönetici tarafından çekilir. Misafirin tarayıcısına fiyat/ödeme verisi **hiç gitmez** (sadece arayüzde gizli değil — ağ isteği bile atılmaz)

## Teknolojiler
HTML5 · CSS3 · Vanilla JavaScript · Supabase (Postgres + Realtime)

## Kurulum

1. `supabase-setup.sql` dosyasındaki SQL'i Supabase projenin **SQL Editor**'ünde çalıştır (`events` ve `event_sales` tablolarını oluşturur)
2. Her iki tabloda da **Row Level Security kapalı** olmalı (anon key ile okuma/yazma için) — proje varsayılanı RLS'i açık getiriyorsa: `alter table events disable row level security; alter table event_sales disable row level security;`
3. `script.js` içindeki `SUPABASE_URL` / `SUPABASE_KEY` değerlerini kendi projenle değiştir
4. Şifreleri değiştirmek istersen `script.js` içindeki `SALES_PASSWORD` / `ADMIN_PASSWORD` sabitlerini düzenle (şu an: `satis123` / `yonetici123`)

## Çalıştırma
`index.html` dosyasını bir tarayıcıda aç, ya da:

```
python -m http.server 5175
```

sonra `http://localhost:5175` adresine git.

## Notlar
- Şifreler client-side bir kontrol — kaynak koduna bakan biri şifreleri görebilir. Gerçek güvenlik gerekiyorsa Supabase Auth ile değiştirilmeli.
- `supabase.min.js` dosyası, CDN'e bağımlı kalmamak için Supabase JS kütüphanesinin yerel bir kopyasıdır.
- Eski tek-etkinlikli sürümden (`seats`, `sales` — sabit tek satırlı tablolar) geçiş yapıldı; bu iki tablo artık kullanılmıyor, istersen elle silebilirsin (`drop table if exists seats; drop table if exists sales;`).
- Etkinlik silme kalıcıdır ve o etkinliğin satış verisini de (`event_sales`, cascade ile) siler — geri alınamaz.

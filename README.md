# Koltuk Yerleşim Sistemi

Sinema tarzı koltuk yerleşim ve bilet satış sistemi. Misafir/Satış/Yönetici olmak üzere 3 rol var ve Supabase üzerinden **çoklu cihaz senkronizasyonu** ile çalışıyor — bir bilgisayarda yapılan değişiklik anında diğerlerinde de görünüyor.

## Özellikler

- **3 rol**: **Misafir** (şifresiz, sadece görüntüler) · **Satış** (kendi şifresi, koltuk satar) · **Yönetici** (kendi şifresi, her şeye erişir: düzen, bilet türleri, sıfırlama)
- **Satış akışı**: bir koltuğa tıkla → sırayla **Cinsiyet** (Erkek/Kadın) → **Bilet Türü** (Standart/VIP/Öğrenci/... ) → **Ödeme Yöntemi** (Kart/Nakit) seç, koltuk otomatik kaydedilir. Dolu bir koltuğa tıklayınca bilgisi gösterilir, "Koltuğu Boşalt" ile geri alınabilir
- **Sinema teması**: koyu zemin, altın vurgular, "PERDE" çizgisi, büyük koltuklar
- Sütun/satır sayısı girilir, hazır düzen şablonları (6×5, 10×8, 12×10, 16×12) — sadece Yönetici
- **Bilet türlerini yönetme**: ekle, sil, fiyatını değiştir — sadece Yönetici; daha önce satılmış koltuklar satıldığı andaki isim/fiyatı korur
- Canlı istatistik + **Ciro Özeti** (bilet türüne göre + ödeme yöntemine göre — Kart/Nakit) — Satış ve Yönetici görür, Misafir görmez
- **Çoklu cihaz senkronizasyonu**: Supabase realtime ile — bir cihazda koltuk/satış/düzen değişikliği tüm bağlı cihazlarda anında güncellenir
- `localStorage` yerel önbellek olarak kullanılır (bağlantı yoksa da çalışmaya devam eder)

## Teknolojiler
HTML5 · CSS3 · Vanilla JavaScript · Supabase (Postgres + Realtime)

## Kurulum

1. `supabase-setup.sql` dosyasındaki SQL'i Supabase projenin **SQL Editor**'ünde çalıştır (tabloyu oluşturur)
2. Aynı tabloda **Row Level Security kapalı** olmalı (anon key ile okuma/yazma için) — proje varsayılanı RLS'i açık getiriyorsa: `alter table venue_state disable row level security;`
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

# Koltuk Yerleşim Sistemi

Sinema tarzı koltuk yerleşim, cinsiyet işaretleme ve bilet satış sistemi. Misafir/Yönetici rol ayrımı var ve Supabase üzerinden **çoklu cihaz senkronizasyonu** ile çalışıyor — bir bilgisayarda yapılan değişiklik anında diğerlerinde de görünüyor.

## Özellikler

- **Misafir / Yönetici girişi**: Misafir sadece koltukları görüntüler; Yönetici (şifreyle giriş) düzeni oluşturur, koltukları işaretler, bilet satar
- **Sinema teması**: koyu zemin, altın vurgular, "PERDE" çizgisi, büyük koltuklar
- Sütun/satır sayısı girilir, hazır düzen şablonları (6×5, 10×8, 12×10, 16×12)
- **Boyama Modu**: Döngü (Boş → Erkek → Kadın → Boş) ya da fırça seçip tıkla/sürükle ile toplu işaretleme
- **Bilet Satışı**: Standart/VIP/Öğrenci gibi bilet türleri — ekle, sil, fiyatını değiştir; satış cinsiyet işaretlemesinden bağımsız, aynı koltukta ikisi birlikte olabilir
- Canlı istatistik + **Ciro Özeti** (tür bazlı satış + toplam ciro) — sadece Yönetici görür
- **Çoklu cihaz senkronizasyonu**: Supabase realtime ile — bir cihazda koltuk/satış/düzen değişikliği tüm bağlı cihazlarda anında güncellenir
- `localStorage` yerel önbellek olarak kullanılır (bağlantı yoksa da çalışmaya devam eder)

## Teknolojiler
HTML5 · CSS3 · Vanilla JavaScript · Supabase (Postgres + Realtime)

## Kurulum

1. `supabase-setup.sql` dosyasındaki SQL'i Supabase projenin **SQL Editor**'ünde çalıştır (tabloyu oluşturur)
2. Aynı tabloda **Row Level Security kapalı** olmalı (anon key ile okuma/yazma için) — proje varsayılanı RLS'i açık getiriyorsa: `alter table venue_state disable row level security;`
3. `script.js` içindeki `SUPABASE_URL` / `SUPABASE_KEY` değerlerini kendi projenle değiştir
4. Yönetici şifresini değiştirmek istersen `script.js` içindeki `ADMIN_PASSWORD` sabitini düzenle (şu an: `yonetici123`)

## Çalıştırma
`index.html` dosyasını bir tarayıcıda aç, ya da:

```
python -m http.server 5175
```

sonra `http://localhost:5175` adresine git.

## Notlar
- Yönetici şifresi client-side bir kontrol — kaynak koduna bakan biri şifreyi görebilir. Gerçek güvenlik gerekiyorsa Supabase Auth ile değiştirilmeli.
- `supabase.min.js` dosyası, CDN'e bağımlı kalmamak için Supabase JS kütüphanesinin yerel bir kopyasıdır.

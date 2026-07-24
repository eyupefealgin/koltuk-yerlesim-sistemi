# Koltuk Yerleşim Sistemi

https://eyupefealgin.github.io/koltuk-yerlesim-sistemi/

Sinema/tiyatro/konser/futbol sahası gibi **birden çok etkinlik** için koltuk yerleşim ve bilet satış sistemi. Misafir kendi biletini kendi alabiliyor, Satış/Yönetici de gişeden satış yapabiliyor — her satışta **QR kodlu bir bilet** üretiliyor ve kapıda **check-in** ile doğrulanabiliyor. Supabase üzerinden **çoklu cihaz senkronizasyonu** ile çalışıyor — bir cihazda yapılan değişiklik anında diğerlerinde de görünüyor.

## Özellikler

- **Çoklu etkinlik**: giriş yaptıktan sonra bir **Etkinlikler** listesi karşılıyor — her etkinliğin kendi adı, tarihi, türü, koltuk düzeni, bilet türleri/fiyatları ve satışları var. Yönetici "+ Yeni Etkinlik" ile oluşturur/arşivler/siler, herkes listeden birine girip görüntüleyebilir/satın alabilir. Kartlarda canlı doluluk yüzdesi görünür
- **3 rol**: **Misafir** (şifresiz, kendi biletini kendi satın alabilir) · **Satış** (kendi şifresi, gişeden koltuk satar) · **Yönetici** (kendi şifresi, her şeye erişir: etkinlik/düzen/bilet türü yönetimi, sıfırlama)
- **Misafirin kendi bileti kendi alması**: boş bir koltuğa tıklayıp cinsiyet → bilet türü → ad soyad → ödeme yöntemi seçerek kendi biletini satın alabilir. İki farklı misafir aynı koltuğa aynı anda tıklarsa, atomik bir veritabanı fonksiyonu (`purchase_seat`) sayesinde sadece biri başarılı olur, diğerine "bu koltuk az önce alındı" uyarısı gösterilir
- **QR kodlu bilet**: her satışta (gişeden veya misafirden) benzersiz bir bilet kodu + QR kod üretilir; satış sonrası otomatik gösterilir, yazdırılabilir. Personel, dolu bir koltuğun bilgisinden "Bileti Görüntüle" ile bileti tekrar açabilir
- **Bilet Doğrula (check-in)**: Satış/Yönetici, bilet kodunu girerek girişte bileti "kullanıldı" olarak işaretleyebilir; aynı bilet ikinci kez okutulursa uyarı verir, geçersiz kod için "bulunamadı" der — sadece geçerli etkinliğin belleğe alınmış satışları içinde arar
- **Etkinlik türü**: her etkinlik için Sinema / Tiyatro / Konser / Futbol Sahası / Genel Etkinlik seçilir — üstteki "PERDE/SAHNE/ALAN" alanı türe göre şekil ve etiket değiştirir
- **Futbol Sahası düzeni**: sayısal koltuk yerine sabit bir stadyum şeması — ortada saha, etrafında Doğu/Batı/Kuzey/Güney tribün blokları (iç+dış katman) + VIP/Misafir/Basın/Protokol köşe blokları (44 blok). Sütun/satır ayarı bu türde geçerli değil; diğer türler normal koltuk ızgarasını kullanır
- **Arama ve filtre**: koltuk/blok numarasına, ada, cinsiyete, bilet türüne veya ödeme yöntemine göre anlık arama; Tümü/Boş/Erkek/Kadın/Satılan filtre cipleri ile eşleşmeyen koltuklar soluklaştırılır. İstatistik panelinde canlı **doluluk yüzdesi** çubuğu
- **Toplu seçim** (sadece personel): "Çoklu Seçim" moduna geçip birden fazla boş koltuğu işaretleyip "Satışa Başla" ile hepsine tek seferde aynı cinsiyet/tür/ödeme uygulanabilir
- **Cinsiyet uyarısı**: aynı sırada yan yana farklı cinsiyet atanacaksa uyarı gösterilir (işlemi engellemez)
- Her etkinlik için sütun/satır sayısı girilir, hazır düzen şablonları (6×5, 10×8, 12×10, 16×12) — sadece Yönetici
- **Bilet türlerini yönetme**: her etkinliğin kendi bilet türleri/fiyatları var; ekle, sil, fiyatını değiştir — sadece Yönetici; daha önce satılmış koltuklar satıldığı andaki isim/fiyatı korur
- Canlı istatistik + **Ciro Özeti** (bilet türüne göre + ödeme yöntemine göre — Kart/Nakit) — Satış ve Yönetici görür, Misafir görmez
- **Çoklu cihaz senkronizasyonu + veri azaltma**: `events` tablosu (etkinlik adı/tarih/tür/doluluk + bilet türü **fiyat listesi**) herkese açık — misafirin kendi bileti alabilmesi için fiyatları görmesi gerekiyor. `event_sales` (kimin ne aldığı: alıcı adı, ödeme yöntemi, bilet kodu) sadece Satış/Yönetici tarafından toplu okunur; misafir sadece **kendi** satın alma işlemini `purchase_seat` fonksiyonuyla yazar, başka kimsenin satış kaydını asla okumaz

## Teknolojiler
HTML5 · CSS3 · Vanilla JavaScript · Supabase (Postgres + Realtime) · [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) (yerel, MIT lisanslı)

## Kurulum

1. `supabase-setup.sql` dosyasındaki SQL'in **tamamını** Supabase projenin **SQL Editor**'ünde çalıştır — `events`/`event_sales` tablolarını, `purchase_seat` fonksiyonunu oluşturur. Script baştan sona tekrar tekrar çalıştırılabilir (idempotent), daha önce kısmen çalıştırdıysan sorun olmaz
2. Her iki tabloda da **Row Level Security kapalı** olmalı (anon key ile okuma/yazma için) — açık gelirse: `alter table events disable row level security; alter table event_sales disable row level security;`
3. `script.js` içindeki `SUPABASE_URL` / `SUPABASE_KEY` değerlerini kendi projenle değiştir
4. Şifreleri değiştirmek istersen `script.js` içindeki `SALES_PASSWORD` / `ADMIN_PASSWORD` sabitlerini düzenle (şu an: `satis123` / `yonetici123`)

## Çalıştırma
`index.html` dosyasını bir tarayıcıda aç, ya da:

```
python -m http.server 5175
```

sonra `http://localhost:5175` adresine git.

## Notlar
- **Gerçek ödeme altyapısı yok** — "Kart/Nakit" seçimi sadece kayıt amaçlı bir etikettir, gerçek bir ödeme sağlayıcısı (iyzico, Stripe vb.) üzerinden para tahsil edilmez. Satın alma ekranında misafire bu açıkça belirtilir.
- Şifreler client-side bir kontrol — kaynak koduna bakan biri şifreleri görebilir. Gerçek güvenlik gerekiyorsa Supabase Auth ile değiştirilmeli.
- `supabase.min.js` ve `qrcode.min.js` dosyaları, CDN'e bağımlı kalmamak için ilgili kütüphanelerin yerel birer kopyasıdır.
- Eski tek-etkinlikli sürümden (`seats`, `sales` — sabit tek satırlı tablolar) geçiş yapıldı; bu iki tablo artık kullanılmıyor, istersen elle silebilirsin (`drop table if exists seats; drop table if exists sales;`).
- Etkinlik silme kalıcıdır ve o etkinliğin satış verisini de (`event_sales`, cascade ile) siler — geri alınamaz.
- Bilet kodları (`TKT-...`) kriptografik değil, gerçek kullanıcı doğrulaması (Supabase Auth) yok — sistem, kağıt bir bilet kadar güvenli: kodu bilen/QR'ı okutan biri check-in yapabilir.

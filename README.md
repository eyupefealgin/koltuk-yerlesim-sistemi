# Koltuk Yerleşim Sistemi

https://eyupefealgin.github.io/koltuk-yerlesim-sistemi/

Sinema/tiyatro/konser/futbol sahası gibi **birden çok etkinlik** için koltuk yerleşim ve bilet satış sistemi. Misafir kendi biletini kendi alabiliyor, Satış/Yönetici de gişeden satış yapabiliyor — her satışta **QR kodlu bir bilet** üretiliyor ve kapıda **check-in** ile doğrulanabiliyor. Supabase üzerinden **çoklu cihaz senkronizasyonu** ile çalışıyor — bir cihazda yapılan değişiklik anında diğerlerinde de görünüyor.

## Sayfalar (diğer e-bilet siteleri gibi ayrı URL'ler)

- **`index.html`** — herkese açık müşteri sitesi. Giriş ekranı/rol seçimi yok, her ziyaret otomatik misafir olarak açılır; personel girişine buradan erişilmez.
- **`satis.html`** — satış girişi. Rol seçimi yok, sadece Satış şifresi sorulur (URL'nin kendisi rolü belirliyor).
- **`yonetici.html`** — yönetici girişi. Aynı şekilde sadece Yönetici şifresi sorulur. Her iki personel sayfası da arama motorlarında indekslenmemesi için `noindex` etiketi taşır.
- **`legal.html`** — Mesafeli Satış Sözleşmesi / KVKK şablon sayfası (satın alma akışından linklenir).

## Özellikler

- **Çoklu etkinlik**: bir **Etkinlikler** listesi karşılıyor — her etkinliğin kendi adı, tarihi, türü, koltuk düzeni, bilet türleri/fiyatları ve satışları var. Yönetici "+ Yeni Etkinlik" ile oluşturur/arşivler/siler, herkes listeden birine girip görüntüleyebilir/satın alabilir. Kartlarda canlı doluluk yüzdesi görünür
- **Paylaşılabilir etkinlik linki**: bir etkinliğe girince adres `?etkinlik=<id>` olur; bu link paylaşılınca karşı taraf doğrudan o etkinliğin koltuk planına düşer. Tarayıcının geri/ileri tuşları çalışır, silinmiş bir etkinliğin linki açılırsa kullanıcı bilgilendirilip listeye döndürülür
- **Etkinlik listesi arama ve filtreleme**: etkinlik adına göre anlık arama (Türkçe büyük/küçük harf duyarlı — "DERBİ" ile "derbi" eşleşir) + tür, tarih aralığı ve fiyat aralığı filtreleri. Tamamen istemci tarafında, ek sorgu atmaz
- **Bilet iptali (müşteri)**: "Biletim Var" ile bulunan bilet, sahibi tarafından iptal edilip koltuk tekrar satışa açılabilir. Yetkilendirme bilet kodunun kendisidir; kapıdan giriş yapılmış (`checkedIn`) bir bilet iptal edilemez — bu kural veritabanı fonksiyonunda da uygulanır, sadece arayüzde gizlenmez
- **Erişilebilir/engelli koltuk işaretleme**: Yönetici, koltuk planında "♿ İşaretle" moduyla belirli koltukları erişilebilir olarak işaretleyebilir (dolu/boş durumundan bağımsız, kalıcı bir özellik). İşaretli koltuklar herkese (misafir dahil) planda ♿ rozetiyle görünür; satış modalinde ve bilette de belirtilir. Düzen tamamen değiştirilirse eski işaretler otomatik temizlenir
- **3 rol**: **Misafir** (şifresiz, kendi biletini kendi satın alabilir) · **Satış** (kendi şifresi, gişeden koltuk satar) · **Yönetici** (kendi şifresi, her şeye erişir: etkinlik/düzen/bilet türü yönetimi, sıfırlama)
- **Misafirin kendi bileti kendi alması**: boş bir koltuğa tıklayıp cinsiyet → bilet türü → ad soyad → ödeme yöntemi seçerek kendi biletini satın alabilir. İki farklı misafir aynı koltuğa aynı anda tıklarsa, atomik bir veritabanı fonksiyonu (`purchase_seat`) sayesinde sadece biri başarılı olur, diğerine "bu koltuk az önce alındı" uyarısı gösterilir
- **Rezervasyon sayacı (sepet zamanlayıcısı)**: bir koltuğa tıklanınca 5 dakikalığına o kullanıcı için kilitlenir (`reserve_seat`), modalda canlı geri sayım gösterilir; süre dolar ya da vazgeçilirse (modal kapatılırsa) otomatik serbest kalır, başka biri o koltuğa aynı anda bakıyorsa "az önce tutuldu" uyarısı verilir
- **QR kodlu bilet**: her satışta (gişeden veya misafirden) benzersiz bir bilet kodu + QR kod üretilir; satış sonrası otomatik gösterilir, yazdırılabilir. Personel, dolu bir koltuğun bilgisinden "Bileti Görüntüle" ile bileti tekrar açabilir
- **Biletim Var**: etkinlik listesi ekranından, misafir bilet kodunu girerek daha önce aldığı bileti (QR dahil) tekrar bulup görüntüleyebilir/yazdırabilir. Ayrıca bu cihazda daha önce alınan biletler `localStorage`'da tutulur ve listede tek tıkla tekrar açılabilir
- **İndirim kodu**: Yönetici etkinlik başına yüzde veya sabit tutarlı, opsiyonel kullanım limitli kodlar tanımlayabilir; satın alma sırasında kod girilip fiyat anında güncellenir, kullanım sayısı atomik olarak artar (aynı kod aynı anda iki kez kullanılamaz)
- **Yasal onay**: misafir kendi bileti kendi alırken, ödeme adımından önce Mesafeli Satış Sözleşmesi/KVKK metnini (`legal.html`, şablon) okuyup onaylaması zorunludur — onaylanmadan ödeme butonları pasif kalır
- **Bilet Doğrula (check-in)**: Satış/Yönetici, bilet kodunu girerek girişte bileti "kullanıldı" olarak işaretleyebilir; aynı bilet ikinci kez okutulursa uyarı verir, geçersiz kod için "bulunamadı" der — sadece geçerli etkinliğin belleğe alınmış satışları içinde arar
- **Etkinlik türü**: her etkinlik için Sinema / Tiyatro / Konser / Futbol Sahası / Genel Etkinlik seçilir — üstteki "PERDE/SAHNE/ALAN" alanı türe göre şekil ve etiket değiştirir
- **Futbol Sahası düzeni**: sayısal koltuk yerine sabit bir stadyum şeması — ortada saha, etrafında Doğu/Batı/Kuzey/Güney tribün blokları (iç+dış katman) + VIP/Misafir/Basın/Protokol köşe blokları (44 blok). Sütun/satır ayarı bu türde geçerli değil; diğer türler normal koltuk ızgarasını kullanır
- **Arama ve filtre**: koltuk/blok numarasına, ada, cinsiyete, bilet türüne veya ödeme yöntemine göre anlık arama; Tümü/Boş/Erkek/Kadın/Satılan filtre cipleri ile eşleşmeyen koltuklar soluklaştırılır. İstatistik panelinde canlı **doluluk yüzdesi** çubuğu
- **Toplu seçim** (sadece personel): "Çoklu Seçim" moduna geçip birden fazla boş koltuğu işaretleyip "Satışa Başla" ile hepsine tek seferde aynı cinsiyet/tür/ödeme uygulanabilir
- **Cinsiyet uyarısı**: aynı sırada yan yana farklı cinsiyet atanacaksa uyarı gösterilir (işlemi engellemez)
- Her etkinlik için sütun/satır sayısı girilir, hazır düzen şablonları (6×5, 10×8, 12×10, 16×12) — sadece Yönetici
- **Bilet türlerini yönetme**: her etkinliğin kendi bilet türleri/fiyatları var; ekle, sil, fiyatını değiştir — sadece Yönetici; daha önce satılmış koltuklar satıldığı andaki isim/fiyatı korur
- Canlı istatistik + **Ciro Özeti** (bilet türüne göre + ödeme yöntemine göre — Kart/Nakit) — Satış ve Yönetici görür, Misafir görmez
- **Etkinlik afişi**: her etkinliğe görsel URL'i eklenebilir; etkinlik kartında afiş olarak gösterilir. Sadece `http(s)` adreslerine izin verilir, kırık/erişilemeyen görsel kartı bozmaz (kendini gizler)
- **Dinamik fiyatlandırma**: etkinlik başına "doluluk %X'i geçince fiyatlar %Y artsın" kuralı. Zam **indirim kodundan önce** uygulanır ve satın alma ekranında adım adım gösterilir (ör. `100₺ → 115₺ (yoğun talep) → 92₺ (kod: ERKEN20)`); bilet üzerinde de fiyatın neden değiştiği yazar
- **Satış grafiği**: her satışa `soldAt` zaman damgası yazılır, Ciro Özeti'nde son 14 günün günlük satış/ciro dağılımı çubuk grafik olarak görünür. Bu özellikten önce satılmış (zaman damgasız) biletler "Tarihsiz" satırında toplanır, sessizce kaybolmaz
- **Kamerayla QR okutma**: Bilet Doğrula ekranında kamerayla QR taranabilir (`BarcodeDetector` API). Tarayıcı desteklemiyorsa, kamera izni verilmezse veya sayfa `https` değilse ayrı ayrı açıklayıcı mesaj gösterilir ve elle kod girişi her zaman kullanılabilir kalır; modal kapanınca kamera bırakılır
- **Demo verisi**: Yönetici panelindeki "Demo Verisi Oluştur" butonu, sunum/portfolyo için 4 gerçekçi örnek etkinlik (sinema/tiyatro/konser/futbol) ve bir miktar satış üretir — mevcut etkinlikleri silmez
- **Düşük veri trafiği**: bir koltuk değiştiğinde (a) etkinlik listesi kanalı, etkinlik içindeyken kapatılır — daha önce aynı satır iki ayrı kanaldan birden geliyordu; (b) liste kanalı artık tüm etkinlikleri yeniden indirmek yerine gelen payload'ı yerel diziye yamalar; (c) koltuk durumları `"empty"/"male"/"female"` yerine `"e"/"m"/"f"` saklanır (44 koltukta 353 → 177 bayt). Sonuç: koltuk başına ~2.8 kB WebSocket + 1.2 kB tam yeniden indirme yerine tek bir ~1.2 kB'lık frame
- **Çoklu cihaz senkronizasyonu + veri azaltma**: `events` tablosu (etkinlik adı/tarih/tür/doluluk + bilet türü **fiyat listesi**) herkese açık — misafirin kendi bileti alabilmesi için fiyatları görmesi gerekiyor. `event_sales` (kimin ne aldığı: alıcı adı, ödeme yöntemi, bilet kodu) sadece Satış/Yönetici tarafından toplu okunur; misafir sadece **kendi** satın alma işlemini `purchase_seat` fonksiyonuyla yazar, başka kimsenin satış kaydını asla okumaz

## Arayüz / Tema

"Gece Prizması" — mor eğilimli koyu zemin, zeminde sabit duran bulanık geometrik kapsüller, vurgu olarak orkide moru. Yazı tipi Outfit; el yazısı **Pacifico** yalnızca tek bir yerde (halka açık sayfanın hero başlığında) degradeli vurgu satırı olarak kullanılıyor — arayüzün geri kalanında okunurluğu bozmasın diye hiç geçmiyor.

Renkler anlamlarına göre ayrı tutuldu; hepsi düz nötr griden kaçınacak biçimde seçildi:

| Rol | Renk | Not |
|---|---|---|
| Vurgu (buton/odak) | `#7A5AE0` orkide | Beyaz metinle 4.8:1 |
| Satılan koltuk | `#E8A44C` kehribar | Vurgudan ayrı; mor halka mavi/gül dolgu üstünde kayboluyordu |
| Erkek / Kadın | `#3569BE` / `#A84770` | Koltuk numarası beyaz basıldığı için degradenin **en açık** ucu da 4.5:1'i geçiyor |
| Erişilebilir koltuk | `#2FD4C0` camgöbeği | Diğer dört durumdan ayırt edilebilir beşinci ton |

Tüm metin/zemin çiftleri tarayıcıda ölçüldü, en düşük oran 4.5:1 üzerinde (gövde metni 16.6:1). Dokunmatikte filtre/mod çipleri 44px'e çıkarılıyor.

## Teknolojiler
HTML5 · CSS3 · Vanilla JavaScript · Supabase (Postgres + Realtime) · [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) (yerel, MIT lisanslı)

## Kurulum

1. `supabase-setup.sql` dosyasındaki SQL'in **tamamını** Supabase projenin **SQL Editor**'ünde çalıştır — `events`/`event_sales`/`seat_holds` tablolarını, `purchase_seat`/`reserve_seat`/`release_seat_hold`/`redeem_discount_code`/`cancel_ticket` fonksiyonlarını, `accessible_seats` sütununu oluşturur. Script baştan sona tekrar tekrar çalıştırılabilir (idempotent), daha önce kısmen çalıştırdıysan sorun olmaz
2. Daha önceki bir sürümden geliyorsan yeni sütunlar için: `alter table events add column if not exists poster_url text;` ve `alter table events add column if not exists dynamic_pricing jsonb not null default '{"enabled":false,"threshold":80,"increase":10}'::jsonb;` (script'in tamamı zaten bunları içeriyor)
3. Üç tabloda da (**events**, **event_sales**, **seat_holds**) **Row Level Security kapalı** olmalı (anon key ile okuma/yazma için) — açık gelirse: `alter table events disable row level security; alter table event_sales disable row level security; alter table seat_holds disable row level security;`
4. `script.js` içindeki `SUPABASE_URL` / `SUPABASE_KEY` değerlerini kendi projenle değiştir
5. Şifreleri değiştirmek istersen `script.js` içindeki `SALES_PASSWORD` / `ADMIN_PASSWORD` sabitlerini düzenle (şu an: `satis123` / `yonetici123`)

## Çalıştırma
`index.html` (müşteri), `satis.html` veya `yonetici.html` (personel) dosyasını bir tarayıcıda aç, ya da:

```
python -m http.server 5175
```

sonra `http://localhost:5175`, `http://localhost:5175/satis.html` veya `http://localhost:5175/yonetici.html` adresine git.

## Notlar
- **Gerçek ödeme altyapısı yok** — "Kart/Nakit" seçimi sadece kayıt amaçlı bir etikettir, gerçek bir ödeme sağlayıcısı (iyzico, Stripe vb.) üzerinden para tahsil edilmez. Satın alma ekranında misafire bu açıkça belirtilir.
- Şifreler client-side bir kontrol — kaynak koduna bakan biri şifreleri görebilir. Gerçek güvenlik gerekiyorsa Supabase Auth ile değiştirilmeli.
- `supabase.min.js` ve `qrcode.min.js` dosyaları, CDN'e bağımlı kalmamak için ilgili kütüphanelerin yerel birer kopyasıdır.
- Eski tek-etkinlikli sürümden (`seats`, `sales` — sabit tek satırlı tablolar) geçiş yapıldı; bu iki tablo artık kullanılmıyor, istersen elle silebilirsin (`drop table if exists seats; drop table if exists sales;`).
- Etkinlik silme kalıcıdır ve o etkinliğin satış verisini de (`event_sales`, cascade ile) siler — geri alınamaz.
- Bilet kodları (`TKT-...`) kriptografik değil, gerçek kullanıcı doğrulaması (Supabase Auth) yok — sistem, kağıt bir bilet kadar güvenli: kodu bilen/QR'ı okutan biri check-in yapabilir.
- Rezervasyon kilidi ve atomik satın alma sadece **tekli** satın alma akışında (misafir + personelin tek koltuk satışı) çalışır; personelin "Çoklu Seçim" ile toplu satışı bu kilide tabi değildir (düşük risk, tek operatörlük personel senaryosu).
- İndirim kodu `redeem_discount_code` ile atomik olarak "kullanılır" (kullanım sayacı hemen artar) — kod uygulanıp satın alma tamamlanmazsa (kullanıcı vazgeçerse) o hak boşa gitmiş olur; hobi ölçekli bir uygulama için kabul edilebilir bir sınırlama.
- `legal.html` gerçek bir hukuki belge değil, **şablondur** — gerçek kullanım için satıcı/işletme bilgileriyle doldurulup bir hukuk danışmanına gösterilmelidir.
- Kamerayla QR okuma `BarcodeDetector` API'sine dayanır; bu API her tarayıcıda bulunmaz (Safari/Firefox'ta genelde yok). Desteklenmeyen ortamlarda elle kod girişi devreye girer — geliştirme sırasında **yedek yol doğrulandı, kamerayla okumanın kendisi gerçek bir cihazda denenmeli**.
- Dinamik fiyatlandırma yalnızca **yeni** satışları etkiler; daha önce satılmış biletler satıldıkları andaki fiyatı korur.
- Afiş görselleri dış bir adresten (ör. Unsplash) yüklenir — o adres erişilemez olursa görsel kartta gösterilmez.
- `satis.html`/`yonetici.html`'deki `noindex` etiketi sadece iyi niyetli arama motoru botlarına bir "istekte bulunma" niteliğindedir, gerçek bir erişim kısıtlaması değildir — URL'yi bilen herkes sayfayı açabilir (şifre ekranı asıl koruma).

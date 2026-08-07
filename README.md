# BiletHub

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
- **Misafir için çoklu koltuk seçimi (grup/aile bileti)**: "Çoklu Seçim" moduna geçip birden fazla boş koltuk işaretleyip tek akışta (bir isim + bir ödeme yöntemi) satın alabilir. Her koltuk için ayrı ayrı atomik `purchase_seat` çağrılır; seçimden biri araya girip başkası tarafından alınmışsa sadece o koltuk başarısız olur, geri kalanı için bilet oluşur ve "N bilet oluşturuldu, M koltuk az önce alındı" gibi net bir sonuç bildirilir
- **Rezervasyon sayacı (sepet zamanlayıcısı)**: bir koltuğa tıklanınca 5 dakikalığına o kullanıcı için kilitlenir (`reserve_seat`), modalda canlı geri sayım gösterilir; süre dolar ya da vazgeçilirse (modal kapatılırsa) otomatik serbest kalır, başka biri o koltuğa aynı anda bakıyorsa "az önce tutuldu" uyarısı verilir
- **QR kodlu bilet**: her satışta (gişeden veya misafirden) benzersiz bir bilet kodu + QR kod üretilir; satış sonrası otomatik gösterilir, yazdırılabilir. Personel, dolu bir koltuğun bilgisinden "Bileti Görüntüle" ile bileti tekrar açabilir
- **Biletim Var**: etkinlik listesi ekranından, misafir bilet kodunu girerek daha önce aldığı bileti (QR dahil) tekrar bulup görüntüleyebilir/yazdırabilir. Ayrıca bu cihazda daha önce alınan biletler `localStorage`'da tutulur ve listede tek tıkla tekrar açılabilir
- **İndirim kodu**: Yönetici etkinlik başına yüzde veya sabit tutarlı, opsiyonel kullanım limitli kodlar tanımlayabilir; satın alma sırasında kod girilip fiyat anında güncellenir, kullanım sayısı atomik olarak artar (aynı kod aynı anda iki kez kullanılamaz)
- **Yasal onay**: misafir kendi bileti kendi alırken, ödeme adımından önce Mesafeli Satış Sözleşmesi/KVKK metnini (`legal.html`, şablon) okuyup onaylaması zorunludur — onaylanmadan ödeme butonları pasif kalır
- **Bilet Doğrula (check-in)**: Satış/Yönetici, bilet kodunu girerek girişte bileti "kullanıldı" olarak işaretleyebilir; aynı bilet ikinci kez okutulursa uyarı verir, geçersiz kod için "bulunamadı" der — sadece geçerli etkinliğin belleğe alınmış satışları içinde arar
- **Etkinlik türü**: her etkinlik için Sinema / Tiyatro / Konser / Futbol Sahası / Genel Etkinlik seçilir — üstteki "PERDE/SAHNE/ALAN" alanı türe göre şekil ve etiket değiştirir
- **Futbol Sahası düzeni**: sayısal koltuk yerine sabit bir stadyum şeması — ortada saha, etrafında 10 fiyat katmanına göre renklenen 40 tribün bloğu (Premium/Gold VIP/Classic VIP/Numaralı Üst VIP/Doğu Maraton Alt-Üst/Güney Alt-Üst/Kuzey Kale Arkası Alt-Üst — gerçek stadyum bilet şemalarından esinlenildi). Blok altındaki fiyat listesi (renk + kategori + ₺) canlı `TICKET_TIERS`'tan okunur, yönetici "Bilet Türleri" panelinden değiştirince anında yansır. Diğer venue türlerinde koltuk rengi hâlâ cinsiyete göre; futbolda ise fiyat katmanına göre — cinsiyet hâlâ satın alma adımında soruluyor, sadece blok rengini belirlemiyor. Sütun/satır ayarı bu türde geçerli değil; diğer türler normal koltuk ızgarasını kullanır
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
- **Düşük veri trafiği**: bir koltuk değiştiğinde (a) etkinlik listesi kanalı, etkinlik içindeyken kapatılır — daha önce aynı satır iki ayrı kanaldan birden geliyordu; (b) liste kanalı artık tüm etkinlikleri yeniden indirmek yerine gelen payload'ı yerel diziye yamalar; (c) koltuk durumları `"empty"/"male"/"female"` yerine `"e"/"m"/"f"` saklanır (44 koltukta 353 → 177 bayt). Sonuç: koltuk başına ~2.8 kB WebSocket + 1.2 kB tam yeniden indirme yerine tek bir ~1.2 kB'lık frame
- **Çoklu cihaz senkronizasyonu + veri azaltma**: `events` tablosu (etkinlik adı/tarih/tür/doluluk + bilet türü **fiyat listesi**) herkese açık — misafirin kendi bileti alabilmesi için fiyatları görmesi gerekiyor. `event_sales` (kimin ne aldığı: alıcı adı, ödeme yöntemi, bilet kodu) sadece Satış/Yönetici tarafından toplu okunur; misafir sadece **kendi** satın alma işlemini `purchase_seat` fonksiyonuyla yazar, başka kimsenin satış kaydını asla okumaz

## Arayüz / Tema

"Editoryal Karanlık" — sıcak neredeyse-siyah zemin, ince tek-piksel kenarlıklar, düz dolgular (gradyan/parıltı yok), serif başlık (**Fraunces**) + sade gövde fontu (Outfit), tek bir vurgu rengi (bordo). Bunu, aynı fikrin gradyanlı/camsı-parıltılı bir öncülü ("Gece Prizması") ile birlikte kullanıcıya karşılaştırmalı olarak gösterip seçtirdik — jenerik "AI SaaS kiti" hissi rengin kendisinden değil, gradyan/parıltı/aşırı-yuvarlak biçim dilinden geliyordu. O yüzden bu turda **kısıtlama** asıl değişiklik: buton/panel/kart gölgeleri kaldırıldı, "hap" biçimli etiketler küçük dikdörtgene döndü, yarıçap ölçeği 24px'ten 3-6px'e indi.

Renkler anlamlarına göre ayrı tutuldu; hepsi düz nötr griden kaçınacak biçimde seçildi:

| Rol | Renk | Not |
|---|---|---|
| Vurgu (buton dolgusu) | `#9C2A4C` bordo | Beyaz metinle 7.4:1 |
| Vurgu (rozet/etiket metni) | `#D9748F` açık bordo | Koyu zeminde okunması için ayrı bir ton — buton dolgusunun aynısı olsaydı okunmazdı |
| Satılan koltuk | `#E8A44C` kehribar | Vurgudan ayrı; bordo halka mavi/gül dolgu üstünde kayboluyordu |
| Erkek / Kadın | `#3569BE` / `#A84770` | Koltuk numarası beyaz basıldığı için 4.5:1'i geçecek şekilde seçildi (önceki turdan korunuyor) |
| Erişilebilir koltuk | `#2FD4C0` camgöbeği | Diğer dört durumdan ayırt edilebilir beşinci ton |

Tüm metin/zemin çiftleri tarayıcıda ölçüldü, en düşük oran 4.5:1 üzerinde (gövde metni 16:1). Dokunmatikte filtre/mod çipleri 44px'e çıkarılıyor.

## Teknolojiler
HTML5 · CSS3 · Vanilla JavaScript · Supabase (Postgres + Realtime) · [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) (yerel, MIT lisanslı)

## Kurulum

1. `supabase-setup.sql` dosyasındaki SQL'in **tamamını** Supabase projenin **SQL Editor**'ünde çalıştır — `events`/`event_sales`/`seat_holds`/`profiles` tablolarını, tüm RPC fonksiyonlarını (`purchase_seat`, `reserve_seat`, `release_seat_hold`, `redeem_discount_code`, `cancel_ticket`, `purchase_stadium_block`, `cancel_stadium_ticket`, `find_ticket_by_code`), RLS politikalarını ve gerekli sütunları oluşturur. Script baştan sona tekrar tekrar çalıştırılabilir (idempotent), daha önce kısmen çalıştırdıysan sorun olmaz
2. Daha önceki bir sürümden geliyorsan yeni sütunlar için: `alter table events add column if not exists poster_url text;` ve `alter table events add column if not exists dynamic_pricing jsonb not null default '{"enabled":false,"threshold":80,"increase":10}'::jsonb;` (script'in tamamı zaten bunları içeriyor)
3. **Row Level Security açık olmalı** (`events`, `event_sales`, `profiles`) — `supabase-setup.sql` bunu kendisi ayarlıyor (`alter table ... enable row level security` + politikalar). Eğer projede eski bir sürümden kalma "RLS kapalı" hâli varsa, script'i tekrar çalıştırman yeterli, kendi kendini düzeltir. `seat_holds` hassas veri taşımadığı için RLS'siz kalıyor.
4. `script.js` içindeki `SUPABASE_URL` / `SUPABASE_KEY` değerlerini kendi projenle değiştir
5. **Personel hesapları oluştur** (artık düz metin şifre yok, gerçek Supabase Auth hesabı gerekiyor):
   1. Supabase panelinde **Authentication → Users → Add user** ile bir yönetici, bir de satış hesabı oluştur (e-posta + şifre, "Auto Confirm User" işaretli)
   2. Her hesabın **User UID**'sini kopyala (Users listesinde görünür)
   3. SQL Editor'de her biri için: `insert into profiles (id, role) values ('<UID>', 'admin');` (satış hesabı için `'sales'`)
   4. `yonetici.html`'e o yönetici hesabıyla, `satis.html`'e o satış hesabıyla giriş yapılır — yanlış rollü bir hesapla girmeye çalışılırsa oturum otomatik kapatılır

## Çalıştırma
`index.html` (müşteri), `satis.html` veya `yonetici.html` (personel) dosyasını bir tarayıcıda aç, ya da:

```
python -m http.server 5175
```

sonra `http://localhost:5175`, `http://localhost:5175/satis.html` veya `http://localhost:5175/yonetici.html` adresine git.

## Notlar
- **Gerçek ödeme altyapısı yok** — "Kart/Nakit" seçimi sadece kayıt amaçlı bir etikettir, gerçek bir ödeme sağlayıcısı (iyzico, Stripe vb.) üzerinden para tahsil edilmez. Satın alma ekranında misafire bu açıkça belirtilir.
- Personel girişi gerçek Supabase Auth (e-posta+şifre) + veritabanındaki RLS politikalarıyla korunuyor — `events`/`event_sales` tablolarına anon key ile doğrudan yazma/okuma artık mümkün değil, sadece giriş yapmış admin/sales hesapları ve güvenli (`security definer`) RPC'ler üzerinden.
- `supabase.min.js` ve `qrcode.min.js` dosyaları, CDN'e bağımlı kalmamak için ilgili kütüphanelerin yerel birer kopyasıdır.
- Eski tek-etkinlikli sürümden (`seats`, `sales` — sabit tek satırlı tablolar) geçiş yapıldı; bu iki tablo artık kullanılmıyor, istersen elle silebilirsin (`drop table if exists seats; drop table if exists sales;`).
- Etkinlik silme kalıcıdır ve o etkinliğin satış verisini de (`event_sales`, cascade ile) siler — geri alınamaz.
- Bilet kodları (`TKT-...`) `crypto.randomUUID()` ile üretilir ama misafirin kendisi için gerçek bir hesap/oturum yok — sistem, kağıt bir bilet kadar güvenli: kodu bilen/QR'ı okutan biri check-in yapabilir (bu, gerçek e-biletlerin de genel çalışma prensibidir).
- **"Giriş Yap" (e-posta ile) gerçek bir Supabase Auth OTP akışıdır** — kod client'ta üretilmiyor, `signInWithOtp`/`verifyOtp` ile Supabase'in kendi sunucusundan gerçek bir e-posta gönderiliyor. Supabase'in ücretsiz katmanında e-posta gönderim hızı sınırlı (saatte birkaç e-posta gibi) — demo/sunum için yeterli, yoğun gerçek kullanım için kendi SMTP sağlayıcını (Supabase Dashboard > Authentication > Email) bağlaman gerekir.
- Rezervasyon kilidi (`reserve_seat`) sadece **tekli** satın alma akışında çalışır; "Çoklu Seçim" (misafir grup bileti / personel toplu satışı) seçim sırasında koltuğu tutmaz — her koltuk için `purchase_seat` yine atomik çalıştığı için biri araya girip bir koltuğu alırsa sadece o koltuk başarısız olur, diğerleri etkilenmez.
- Personelin "Çoklu Seçim"i tüm-diziyi-yeniden-yazan bir push kullanır (düşük risk, tek operatörlük personel senaryosu); misafirin çoklu seçimi ise her koltuk için ayrı ayrı atomik `purchase_seat` çağırır — ikisi farklı mekanizma, ikisi de kendi bağlamında güvenli.
- İndirim kodu `redeem_discount_code` ile atomik olarak "kullanılır" (kullanım sayacı hemen artar) — kod uygulanıp satın alma tamamlanmazsa (kullanıcı vazgeçerse) o hak boşa gitmiş olur; hobi ölçekli bir uygulama için kabul edilebilir bir sınırlama.
- `legal.html` gerçek bir hukuki belge değil, **şablondur** — gerçek kullanım için satıcı/işletme bilgileriyle doldurulup bir hukuk danışmanına gösterilmelidir.
- Kamerayla QR okuma `BarcodeDetector` API'sine dayanır; bu API her tarayıcıda bulunmaz (Safari/Firefox'ta genelde yok). Desteklenmeyen ortamlarda elle kod girişi devreye girer — geliştirme sırasında **yedek yol doğrulandı, kamerayla okumanın kendisi gerçek bir cihazda denenmeli**.
- Dinamik fiyatlandırma yalnızca **yeni** satışları etkiler; daha önce satılmış biletler satıldıkları andaki fiyatı korur.
- Afiş görselleri dış bir adresten (ör. Unsplash) yüklenir — o adres erişilemez olursa görsel kartta gösterilmez.
- `satis.html`/`yonetici.html`'deki `noindex` etiketi sadece iyi niyetli arama motoru botlarına bir "istekte bulunma" niteliğindedir, gerçek bir erişim kısıtlaması değildir — URL'yi bilen herkes sayfayı açabilir (şifre ekranı asıl koruma).

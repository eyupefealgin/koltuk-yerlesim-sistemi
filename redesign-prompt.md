Koltuk Yerleşim Sistemi projesinin (C:\Users\efeal\Desktop\koltuk-yerlesim-sistemi — index.html, style.css, script.js) arayüzünü tamamen yeniden tasarla. Şu anki hâli koyu lacivert/siyah zeminli, altın vurgulu bir "sinema" temasında. Bunun yerine **kremsi tonlarda, şık ve premium/lüks** bir görünüme geçir — fonksiyonalite ve mevcut JS mantığı (roller, Supabase senkronizasyonu, koltuk satış akışı) aynen kalacak, sadece görsel/stil değişecek.

## Renk Paleti
- Zemin: sıcak fildişi/krem tonları (ör. #F5F0E6, #EFE7D8 gibi) — beyaz değil, kremsi
- Panel/kart yüzeyleri: kremden biraz daha açık veya biraz daha koyu bir krem, ince bir ayrım olacak şekilde
- Vurgu rengi: sıcak bronz/bakır ya da derin bordo/şarap rengi gibi premium hissi veren bir ton (parlak altın/sarı değil, daha "matte luxury" bir renk)
- Metin: yumuşak koyu kahve/antrasit (siyah değil)
- Erkek/Kadın koltuk renkleri: mevcut mavi/kırmızıyı koru ama kremsi zeminle uyumlu, biraz daha pastel/muted tonlara çek
- Genel his: bir butik otel, spa ya da premium etkinlik davetiyesi gibi — soğuk/neon değil, sıcak ve zarif

## Tipografi
- Başlıklar için zarif bir serif font (ör. Playfair Display, Cormorant, ya da benzeri "luxury" bir Google Font)
- Gövde metni/butonlar için temiz bir sans-serif (mevcut Inter kalabilir ya da benzeri bir font)
- Bol boşluk (whitespace), ince harf aralıkları, fazla kalabalık olmayan bir hiyerarşi

## Bileşenler
- Kartlar/paneller: sert gölge yerine yumuşak, dağınık gölgeler; ince kenarlıklar; köşeler yumuşak ama abartısız
- Butonlar: dolgun neon/parlak değil, mat ve zarif — vurgu renginde ince dolgulu ya da sadece kenarlıklı zarif butonlar
- Koltuk kutucukları: mevcut kare/yuvarlak köşe formunu koru ama kremsi zeminde daha yumuşak gölgeli, "gerçek koltuk minderi" hissi veren ince bir iç gradyan ekle
- "PERDE" ekran çizgisi: altın parlaklığı yerine daha yumuşak, ince bir bronz/bej degrade
- Modal (koltuk satış penceresi): kremsi kart, yumuşak açılış animasyonu
- Giriş ekranı (Misafir/Satış/Yönetici): sade, ortalanmış, zarif bir davetiye kartı gibi

## Değişmeyecekler
- Tüm JS mantığı (rol sistemi, Supabase realtime senkronizasyon, satış akışı: cinsiyet → bilet türü → ödeme) aynen kalacak
- HTML yapısındaki id/class isimleri mümkün olduğunca korunacak (fonksiyonellik bunlara bağlı)
- Erişilebilirlik: metin/zemin kontrastı yeterli olacak (WCAG AA), focus stilleri görünür kalacak, prefers-reduced-motion'a saygı gösterilecek

Sonunda tarayıcıda açıp görsel olarak test et ve ekran görüntüsüyle/açıklamayla sonucu göster.

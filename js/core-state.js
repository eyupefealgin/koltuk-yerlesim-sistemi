// ===== Supabase (cross-device sync) =====
const SUPABASE_URL = 'https://bkgcudklzrvkzodlqcij.supabase.co';
const SUPABASE_KEY = 'sb_publishable_jhO5H_R_KNEvZfqkZMdVsQ_40S_NuyZ';
// Named supabaseClient, not supabase — the library itself declares a global
// `var supabase`, and redeclaring that name with const/let is a SyntaxError
// that silently kills the whole script (no console output, nothing runs).
// Personel (satis.html/yonetici.html) şifreyle, misafir (index.html) artık
// e-posta+OTP ile gerçek bir Supabase Auth oturumu açabiliyor — ikisi de
// AYNI tarayıcıda AYNI localStorage anahtarını kullanırsa (varsayılan
// davranış) biri diğerinin oturumunu ezer. Sayfaya göre farklı bir
// storageKey vererek bu çakışmayı önlüyoruz.
const supabaseClient = window.supabase
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { storageKey: document.body.dataset.page === 'public' ? 'sb-guest-auth' : 'sb-staff-auth' },
    })
  : null;

// Panel > Authentication > URL Configuration'daki "Site URL" doğru
// (https://eyupefealgin.github.io/koltuk-yerlesim-sistemi/) görünse de,
// signUp()/resetPasswordForEmail()'in ürettiği onay/sıfırlama linklerinde
// redirect_to hâlâ yol olmadan (sadece kök domain) çıkıyordu — panel
// ayarına güvenmek yerine burada açıkça belirtiyoruz.
const AUTH_REDIRECT_URL = 'https://eyupefealgin.github.io/koltuk-yerlesim-sistemi/';

let isApplyingRemote = false; // true while applying an incoming update, so we don't echo it straight back
let pushTimerSeatStates = null;
let pushTimerLayout = null;
let pushTimerVenueType = null;
let pushTimerSalesData = null;
let pushTimerTiers = null;
let pushTimerAccessibleSeats = null;
let pushTimerGeneralCapacity = null;

function clearPushTimers(){
  clearTimeout(pushTimerSeatStates);
  clearTimeout(pushTimerLayout);
  clearTimeout(pushTimerVenueType);
  clearTimeout(pushTimerSalesData);
  clearTimeout(pushTimerTiers);
  clearTimeout(pushTimerAccessibleSeats);
  clearTimeout(pushTimerGeneralCapacity);
}

// Ticket tiers are per-event (stored in events.tiers — public, since a price
// list isn't sensitive; what stays private is who bought what) — this is
// just the seed used when a new event is created / before any event loads.
const DEFAULT_TIERS = [
  { id: 'standart', label: 'Standart', price: 100 },
  { id: 'vip', label: 'VIP', price: 250 },
  { id: 'ogrenci', label: 'Öğrenci', price: 60 },
];
let TICKET_TIERS = [...DEFAULT_TIERS];

// Futbol Sahası için ayrı bir fiyat kategorisi seti — gerçek stadyum bilet
// biletlemesi gibi bölgeler cinsiyete değil fiyat katmanına göre renkleniyor
// (bkz. buildStadiumBlocks). Admin bunları da normal "Bilet Türleri" panelinden
// düzenleyebiliyor, isim/fiyat serbest; sadece id eşleşmesi STADIUM_TIER_COLORS
// ile renk bağlantısını sağlıyor.
const DEFAULT_STADIUM_TIERS = [
  { id: 'premium', label: 'Premium', price: 5000 },
  { id: 'gold-vip', label: 'Gold VIP', price: 3500 },
  { id: 'classic-vip', label: 'Classic VIP', price: 3000 },
  { id: 'numarali-ust-vip', label: 'Numaralı Üst VIP', price: 2750 },
  { id: 'dogu-maraton-alt', label: 'Doğu Maraton Alt', price: 2500 },
  { id: 'dogu-maraton-ust', label: 'Doğu Maraton Üst', price: 2000 },
  { id: 'guney-alt', label: 'Güney Alt', price: 1500 },
  { id: 'guney-ust', label: 'Güney Üst', price: 1500 },
  { id: 'kuzey-kale-arkasi-alt', label: 'Kuzey Kale Arkası Alt', price: 1500 },
  { id: 'kuzey-kale-arkasi-ust', label: 'Kuzey Kale Arkası Üst', price: 1500 },
];
// Beyaz metinle 4.5:1+ verecek şekilde seçildi (tarayıcıda doğrulandı).
const STADIUM_TIER_COLORS = {
  'premium': '#B23A5C',
  'gold-vip': '#7A2233',
  'classic-vip': '#A33B3B',
  'numarali-ust-vip': '#5B3A8C',
  'dogu-maraton-alt': '#3A8456',   // #3E8E5C beyazla 4.02 idi, 4.55'e düşürüldü
  'dogu-maraton-ust': '#2A6B45',
  'guney-alt': '#3B6FD1',
  'guney-ust': '#244A96',
  'kuzey-kale-arkasi-alt': '#A76526',   // #C97A2E beyazla 3.33 idi, 4.63'e düşürüldü
  'kuzey-kale-arkasi-ust': '#96591F',
};
// Her blok tek bir bilete değil, N kişilik bir havuza karşılık geliyor —
// gerçek bir stadyumda "Premium" bölümü tek koltuk değildir. VIP katmanları
// küçük/pahalı, genel tribün blokları büyük/ucuz tutuldu. Toplam ~6000 kişilik
// bir stadyum (40 blok × bu kapasiteler).
const STADIUM_TIER_CAPACITY = {
  'premium': 40,
  'gold-vip': 40,
  'classic-vip': 60,
  'numarali-ust-vip': 60,
  'dogu-maraton-alt': 250,
  'dogu-maraton-ust': 200,
  'guney-alt': 180,
  'guney-ust': 150,
  'kuzey-kale-arkasi-alt': 180,
  'kuzey-kale-arkasi-ust': 150,
};

// Bilet QR/check-in kodu — crypto.randomUUID() ile üretiliyor (122 bit
// rastgelelik, tarayıcının kriptografik RNG'si). Önceki sürüm Date.now() +
// Math.random() kullanıyordu: zaman damgası tahmin edilebilir (satış saati
// genelde bilinir) ve Math.random() kriptografik değil — ikisi birleşince
// bir bilet kodu, kabaca bilinen bir zaman aralığında brute-force ile
// bulunabilirdi (bkz. güvenlik denetimi). randomUUID zaten her tarayıcıda
// var (crypto API), fallback'e gerek yok.
function generateTicketCode(){
  return `TKT-${crypto.randomUUID().toUpperCase()}`;
}

const VENUE_TYPES = {
  sinema:  { label: 'Sinema', screenLabel: 'PERDE', shape: 'curve' },
  tiyatro: { label: 'Tiyatro', screenLabel: 'SAHNE', shape: 'curve' },
  konser:  { label: 'Konser / Etkinlik', screenLabel: 'SAHNE', shape: 'curve' },
  futbol:  { label: 'Futbol Sahası', screenLabel: 'SAHA', shape: 'oval' },
  genel:   { label: 'Genel Etkinlik', screenLabel: 'ALAN', shape: 'flat' },
};
let venueType = 'sinema';

function isStadiumMode(){
  return venueType === 'futbol';
}

// "Havuzlu" mod: koltuk numarası yok, kapasiteli bir havuza karşılık gelir —
// seatStates[idx] satılan/katılan SAYI, seatSales[idx] bilet DİZİSİ olur
// (bkz. blockSoldCount/salesAt). Futbolda sabit 40 blok var (fiyatlı, biletli);
// Genel Etkinlik'te ise tek bir ÜCRETSİZ/biletsiz giriş havuzu var (bkz.
// poolBlocks/joinGeneralEvent) — bilet türü/fiyat kavramı hiç yok, sadece
// toplam kapasite ve kaç kişinin katıldığı takip ediliyor.
function isPooledMode(){
  return venueType === 'futbol' || venueType === 'genel';
}

// Genel Etkinlik oluşturulunca ya da bu türe ilk geçilince varsayılan
// kapasite — admin sonradan kapasite alanından değiştirebilir.
const DEFAULT_GENERAL_CAPACITY = 500;
let GENERAL_CAPACITY = DEFAULT_GENERAL_CAPACITY; // geçerli etkinliğin kapasitesi (events.general_capacity)
let GENERAL_MAX_PER_PURCHASE = null; // tek seferde katılınabilecek maksimum kişi — null = sınırsız (events.general_max_per_purchase)

// Havuzlu moddaki "blok" listesi: futbolda sabit stadyum şeması (fiyatlı,
// bilet türüne göre), Genel Etkinlik'te ise tek bir ücretsiz giriş havuzu.
// idx bazlı tüm paylaşılan kod (renderSeatVisual, seatAriaLabel, vb.)
// STADIUM_BLOCKS yerine bunu okur.
function poolBlocks(){
  if(isStadiumMode()) return STADIUM_BLOCKS;
  if(venueType === 'genel'){
    return [{ label: 'Genel Giriş', tier: null, capacity: GENERAL_CAPACITY }];
  }
  return [];
}

// Fixed stadium seating map for Futbol Sahası: bir saha, çevresinde gerçek
// stadyum bilet şemalarındaki gibi FİYAT KATMANINA göre renklenen tribün
// blokları (bkz. DEFAULT_STADIUM_TIERS/STADIUM_TIER_COLORS) — orijinal
// düzen, belirli bir gerçek stadyumun kopyası değil.
//
// ÖNEMLİ: her blok TEK bir bilete değil, capacity kişilik bir HAVUZA karşılık
// gelir — gerçek bir stadyumda "Premium" bölümü tek koltuk değildir. Bu yüzden
// bu bloklar diğer venue türlerindeki koltuklardan farklı bir veri şekli
// kullanır: seatStates[idx] o bloktan satılan bilet SAYISI (tam sayı),
// seatSales[idx] ise her biletin kendi kaydını taşıyan bir DİZİ (bkz.
// purchase_stadium_block/cancel_stadium_ticket, salesAt() yardımcı fonksiyonu).
//
// Grid 10 sütun × 8 satır (1-2 = sol katman, 3-8 = saha, 9-10 = sağ katman;
// satırlarda da aynı mantık).
function buildStadiumBlocks(){
  const blocks = [];

  // ÜST kenar (eski "Doğu") — sahaya en yakın taraf: 4 üst-katman fiyat
  // kategorisi, 3'er blok. İçteki sıra (2. satır) ucuz VIP çiftini, dıştaki
  // sıra (1. satır) pahalı VIP çiftini taşıyor — referans şemadaki gibi.
  const topTierGroups = [
    { tier: 'premium', cols: [3, 4, 5], row: '2 / 3' },
    { tier: 'gold-vip', cols: [6, 7, 8], row: '2 / 3' },
    { tier: 'classic-vip', cols: [3, 4, 5], row: '1 / 2' },
    { tier: 'numarali-ust-vip', cols: [6, 7, 8], row: '1 / 2' },
  ];
  topTierGroups.forEach(g => {
    const label = DEFAULT_STADIUM_TIERS.find(t => t.id === g.tier).label;
    g.cols.forEach((c, i) => blocks.push({ label: `${label} ${i + 1}`, col: `${c} / ${c + 1}`, row: g.row, tier: g.tier, capacity: STADIUM_TIER_CAPACITY[g.tier] }));
  });

  // ALT kenar (eski "Batı") — 2 fiyat katmanı, 6'şar blok.
  const fieldCols = [3, 4, 5, 6, 7, 8];
  const bottomAltLabel = DEFAULT_STADIUM_TIERS.find(t => t.id === 'dogu-maraton-alt').label;
  const bottomUstLabel = DEFAULT_STADIUM_TIERS.find(t => t.id === 'dogu-maraton-ust').label;
  fieldCols.forEach((c, i) => blocks.push({ label: `${bottomAltLabel} ${i + 1}`, col: `${c} / ${c + 1}`, row: '7 / 8', tier: 'dogu-maraton-alt', capacity: STADIUM_TIER_CAPACITY['dogu-maraton-alt'] }));
  fieldCols.forEach((c, i) => blocks.push({ label: `${bottomUstLabel} ${i + 1}`, col: `${c} / ${c + 1}`, row: '8 / 9', tier: 'dogu-maraton-ust', capacity: STADIUM_TIER_CAPACITY['dogu-maraton-ust'] }));

  const fieldRows = [3, 4, 5, 6];
  const leftAltLabel = DEFAULT_STADIUM_TIERS.find(t => t.id === 'guney-alt').label;
  const leftUstLabel = DEFAULT_STADIUM_TIERS.find(t => t.id === 'guney-ust').label;
  fieldRows.forEach((r, i) => blocks.push({ label: `${leftAltLabel} ${i + 1}`, col: '2 / 3', row: `${r} / ${r + 1}`, tier: 'guney-alt', capacity: STADIUM_TIER_CAPACITY['guney-alt'] }));
  fieldRows.forEach((r, i) => blocks.push({ label: `${leftUstLabel} ${i + 1}`, col: '1 / 2', row: `${r} / ${r + 1}`, tier: 'guney-ust', capacity: STADIUM_TIER_CAPACITY['guney-ust'] }));

  const rightAltLabel = DEFAULT_STADIUM_TIERS.find(t => t.id === 'kuzey-kale-arkasi-alt').label;
  const rightUstLabel = DEFAULT_STADIUM_TIERS.find(t => t.id === 'kuzey-kale-arkasi-ust').label;
  fieldRows.forEach((r, i) => blocks.push({ label: `${rightAltLabel} ${i + 1}`, col: '9 / 10', row: `${r} / ${r + 1}`, tier: 'kuzey-kale-arkasi-alt', capacity: STADIUM_TIER_CAPACITY['kuzey-kale-arkasi-alt'] }));
  fieldRows.forEach((r, i) => blocks.push({ label: `${rightUstLabel} ${i + 1}`, col: '10 / 11', row: `${r} / ${r + 1}`, tier: 'kuzey-kale-arkasi-ust', capacity: STADIUM_TIER_CAPACITY['kuzey-kale-arkasi-ust'] }));

  return blocks;
}
const STADIUM_BLOCKS = buildStadiumBlocks();

const EVENT_SESSION_KEY = 'koltukYerlesim.eventId';
const HOLD_TOKEN_KEY = 'koltukYerlesim.holdToken';
const HOLD_TTL_SECONDS = 300; // 5 dakika — reserve_seat()'in varsayılanıyla aynı

// Bu sekmeye özel, kalıcı bir rezervasyon jetonu — reserve_seat/purchase_seat
// bir koltuğun bu sekim mi yoksa başkasının mı tarafından tutulduğunu bu
// jetonla ayırt ediyor.
function getHoldToken(){
  let token = sessionStorage.getItem(HOLD_TOKEN_KEY);
  if(!token){
    token = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    sessionStorage.setItem(HOLD_TOKEN_KEY, token);
  }
  return token;
}
const holdToken = getHoldToken();
// Gerçek kimlik doğrulama: Supabase Auth (e-posta+şifre) + profiles tablosu
// (bkz. supabase-setup.sql). Eskiden burada düz metin şifreler vardı
// (SALES_PASSWORD/ADMIN_PASSWORD) — kaynak koduna bakan herkes görebiliyordu
// ve veritabani bunun farkinda degildi (RLS kapaliydi, guvenlik denetiminin
// #1 bulgusu). Artik personel gercek bir hesapla giris yapiyor, rol
// veritabanindaki profiles tablosundan okunuyor.
let pendingLoginRole = null; // 'sales' | 'admin', while the password row is showing

const loginGate = document.getElementById('loginGate');
const appRoot = document.getElementById('appRoot');
const guestLoginBtn = document.getElementById('guestLoginBtn');
const passwordRow = document.getElementById('passwordRow');
const emailInput = document.getElementById('emailInput');
const passwordInput = document.getElementById('passwordInput');
const passwordSubmit = document.getElementById('passwordSubmit');
const loginError = document.getElementById('loginError');
const roleBadge = document.getElementById('roleBadge');
const logoutBtn = document.getElementById('logoutBtn');
const resetAllBtn = document.getElementById('resetAllBtn');

let currentRole = null; // 'guest' | 'sales' | 'admin'


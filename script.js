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

// ===== Event list =====
const eventListView = document.getElementById('eventListView');
const eventDetailView = document.getElementById('eventDetailView');
const eventGridEl = document.getElementById('eventGrid');
const eventEmptyHint = document.getElementById('eventEmptyHint');
const eventFilterEmptyHint = document.getElementById('eventFilterEmptyHint');
const eventFilterName = document.getElementById('eventFilterName');
const eventFilterVenue = document.getElementById('eventFilterVenue');
const eventFilterDateFrom = document.getElementById('eventFilterDateFrom');
const eventFilterDateTo = document.getElementById('eventFilterDateTo');
const eventFilterPriceMin = document.getElementById('eventFilterPriceMin');
const eventFilterPriceMax = document.getElementById('eventFilterPriceMax');
const eventFilterClearBtn = document.getElementById('eventFilterClearBtn');
const createEventBtn = document.getElementById('createEventBtn');
const createEventOverlay = document.getElementById('createEventOverlay');
const createEventClose = document.getElementById('createEventClose');
const newEventName = document.getElementById('newEventName');
const newEventDate = document.getElementById('newEventDate');
const newEventVenue = document.getElementById('newEventVenue');
const newEventCols = document.getElementById('newEventCols');
const newEventRows = document.getElementById('newEventRows');
const newEventPoster = document.getElementById('newEventPoster');
const newEventDimsRow = document.getElementById('newEventDimsRow');
const newEventStadiumNote = document.getElementById('newEventStadiumNote');
const submitCreateEventBtn = document.getElementById('submitCreateEventBtn');
const backToEventsBtn = document.getElementById('backToEventsBtn');
const currentEventNameBadge = document.getElementById('currentEventNameBadge');

let events = [];
let currentEventId = null;
let eventsSynced = false;
let eventsChannel = null;
let seatsChannel = null;
let salesChannel = null;

const colsInput = document.getElementById('colsInput');
const rowsInput = document.getElementById('rowsInput');
const totalPreview = document.getElementById('totalPreview');
const layoutControlsEl = document.getElementById('layoutControls');
const stadiumNoteEl = document.getElementById('stadiumNote');
const seatGrid = document.getElementById('seatGrid');
const stadiumLegendEl = document.getElementById('stadiumLegend');
const gridHint = document.getElementById('gridHint');
const screenAccentEl = document.getElementById('screenAccent');
const tierListEl = document.getElementById('tierList');
const newTierNameInput = document.getElementById('newTierName');
const newTierPriceInput = document.getElementById('newTierPrice');
const revenuePanel = document.getElementById('revenuePanel');
const revenueBreakdownEl = document.getElementById('revenueBreakdown');
const paymentBreakdownEl = document.getElementById('paymentBreakdown');

// Bulk selection toolbar
const singleModeBtn = document.getElementById('singleModeBtn');
const bulkModeBtn = document.getElementById('bulkModeBtn');
const accessModeBtn = document.getElementById('accessModeBtn');
const startBulkSaleBtn = document.getElementById('startBulkSaleBtn');
const startBulkSaleLabel = document.getElementById('startBulkSaleLabel');
const bulkCountEl = document.getElementById('bulkCount');

// Seat modal (satış akışı: cinsiyet → bilet türü → alıcı → ödeme)
const seatModalOverlay = document.getElementById('seatModalOverlay');
const seatModalTitle = document.getElementById('seatModalTitle');
const seatModalClose = document.getElementById('seatModalClose');
const modalTierButtonsEl = document.getElementById('modalTierButtons');
const modalInfoTextEl = document.getElementById('modalInfoText');
const modalClearSeatBtn = document.getElementById('modalClearSeatBtn');
const viewTicketBtn = document.getElementById('viewTicketBtn');
const buyerNameInput = document.getElementById('buyerNameInput');
const buyerEmailInput = document.getElementById('buyerEmailInput');
const buyerNoteText = document.getElementById('buyerNoteText');
const buyerContinueBtn = document.getElementById('buyerContinueBtn');
const paymentDisclaimerEl = document.getElementById('paymentDisclaimer');
const legalConsentRow = document.getElementById('legalConsentRow');
const legalConsentCheckbox = document.getElementById('legalConsentCheckbox');
const paymentChoiceButtons = document.querySelectorAll('.modal-step-panel[data-panel="payment"] [data-payment]');
const holdCountdownEl = document.getElementById('holdCountdown');
const discountCodeInput = document.getElementById('discountCodeInput');
const applyDiscountBtn = document.getElementById('applyDiscountBtn');
const discountNoteText = document.getElementById('discountNoteText');
const priceSummaryText = document.getElementById('priceSummaryText');

// İndirim kodu yönetimi (Yönetici)
const discountListEl = document.getElementById('discountList');
const newDiscountCode = document.getElementById('newDiscountCode');
const newDiscountType = document.getElementById('newDiscountType');
const newDiscountValue = document.getElementById('newDiscountValue');
const newDiscountMaxUses = document.getElementById('newDiscountMaxUses');
const addDiscountBtn = document.getElementById('addDiscountBtn');

// Afiş görseli (Yönetici)
const eventPosterInput = document.getElementById('eventPosterInput');
const savePosterBtn = document.getElementById('savePosterBtn');
const posterPreview = document.getElementById('posterPreview');

// Etkinlik notu (Yönetici düzenler, herkes görür — bkz. eventNoteDisplay)
const eventNoteInput = document.getElementById('eventNoteInput');
const saveNoteBtn = document.getElementById('saveNoteBtn');
const eventNoteDisplay = document.getElementById('eventNoteDisplay');

// Genel Etkinlik: tek ücretsiz giriş havuzunun kapasitesi + bilet türü/
// fiyat (tierPanelSection) ve indirim kodu (discountPanelSection) panelleri
// — ikisi de fiyatlı bilet varsayar, Genel Etkinlik'te anlamsız (bkz.
// renderVenueAccent).
const generalCapacitySection = document.getElementById('generalCapacitySection');
const generalCapacityInput = document.getElementById('generalCapacityInput');
const saveGeneralCapacityBtn = document.getElementById('saveGeneralCapacityBtn');
const tierPanelSection = document.getElementById('tierPanelSection');
const discountPanelSection = document.getElementById('discountPanelSection');

// Dinamik fiyatlandırma (Yönetici)
const dynEnabled = document.getElementById('dynEnabled');
const dynThreshold = document.getElementById('dynThreshold');
const dynIncrease = document.getElementById('dynIncrease');
const saveDynBtn = document.getElementById('saveDynBtn');
const dynStatusNote = document.getElementById('dynStatusNote');

// Satış grafiği
const salesChart = document.getElementById('salesChart');
const salesChartBody = document.getElementById('salesChartBody');

// Kamerayla QR tarama
const checkinScanBtn = document.getElementById('checkinScanBtn');
const scannerBox = document.getElementById('scannerBox');
const scannerVideo = document.getElementById('scannerVideo');
const scannerStopBtn = document.getElementById('scannerStopBtn');
const scannerNote = document.getElementById('scannerNote');

// Ticket view (QR + bilet kodu)
const ticketViewOverlay = document.getElementById('ticketViewOverlay');
const ticketViewClose = document.getElementById('ticketViewClose');
const ticketCloseBtn = document.getElementById('ticketCloseBtn');
const ticketPrintBtn = document.getElementById('ticketPrintBtn');

// Check-in (bilet doğrula)
const checkinOverlay = document.getElementById('checkinOverlay');
const checkinClose = document.getElementById('checkinClose');
const openCheckinBtn = document.getElementById('openCheckinBtn');
const checkinCodeInput = document.getElementById('checkinCodeInput');
const checkinVerifyBtn = document.getElementById('checkinVerifyBtn');
const checkinResultEl = document.getElementById('checkinResult');

// Biletim Var (misafirin kendi biletini kod ile bulması)
const openMyTicketBtn = document.getElementById('openMyTicketBtn');
const myTicketOverlay = document.getElementById('myTicketOverlay');
const myTicketClose = document.getElementById('myTicketClose');
const myTicketCodeInput = document.getElementById('myTicketCodeInput');
const myTicketFindBtn = document.getElementById('myTicketFindBtn');
const myTicketResultEl = document.getElementById('myTicketResult');

// E-posta ile giriş — gerçek Supabase Auth OTP (signInWithOtp/verifyOtp),
// bkz. index.html notu. Sadece misafir sayfasında (index.html) var,
// satis.html/yonetici.html'de yok — bu yüzden hepsi ?. ile erişiliyor.
const emailLoginBtn = document.getElementById('emailLoginBtn');
const emailLoginOverlay = document.getElementById('emailLoginOverlay');
const emailLoginClose = document.getElementById('emailLoginClose');
const emailLoginEmailInput = document.getElementById('emailLoginEmailInput');
const emailLoginSendBtn = document.getElementById('emailLoginSendBtn');
const emailLoginCodeNote = document.getElementById('emailLoginCodeNote');
const emailLoginCodeInput = document.getElementById('emailLoginCodeInput');
const emailLoginVerifyBtn = document.getElementById('emailLoginVerifyBtn');
const emailLoginErrorEl = document.getElementById('emailLoginError');
const myEmailTicketsNote = document.getElementById('myEmailTicketsNote');
const myEmailTicketsList = document.getElementById('myEmailTicketsList');
const emailLogoutBtn = document.getElementById('emailLogoutBtn');

let cols = 10;
let rows = 8;
let seatStates = [];
let seatSales = [];
let seatButtons = [];
let currentFilter = 'all';

let bulkMode = false;
let bulkSelected = new Set();

let accessMode = false;        // koltuk tıklamaları erişilebilirlik işaretlemeye gidiyor
let ACCESSIBLE_SEATS = new Set(); // erişilebilir olarak işaretli koltuk index'leri (events.accessible_seats)

let modalSeatIdx = null;      // single-seat flow
let modalSeatIndices = null;  // bulk flow (array of indices)
let modalGender = null;
let modalTier = null;
let modalBuyerName = '';
let modalBuyerEmail = '';
let modalHeldIdx = null;       // reserve_seat başarılı olduysa tutulan koltuk index'i
let holdCountdownInterval = null;
let holdExpiresAt = null;
let modalDiscount = null;      // { code, type, value } — uygulanmış indirim (varsa)
let DISCOUNT_CODES = [];       // geçerli etkinliğin indirim kodları (events.discount_codes)
let POSTER_URL = null;         // geçerli etkinliğin afiş görseli (events.poster_url)
let EVENT_NOTE = null;         // geçerli etkinliğin notu (events.note) — herkese açık
const DEFAULT_DYNAMIC = { enabled: false, threshold: 80, increase: 10 };
let DYNAMIC_PRICING = { ...DEFAULT_DYNAMIC }; // events.dynamic_pricing

function canEdit(){
  return currentRole === 'admin' || currentRole === 'sales';
}

function isAdmin(){
  return currentRole === 'admin';
}

// Misafir artık kendi koltuğunu kendi satın alabiliyor (staff'ın toplu
// düzenleme yetkisi olmadan) — bu, canEdit()'ten ayrı ve daha dar bir izin.
function canPurchase(){
  return currentRole === 'guest' || canEdit();
}

// Etkinlik/koltuk gezinmesi (renk/doluluk görmek) girişsiz kalıyor — sadece
// bir koltuğa TIKLAYIP satın almaya BAŞLAMAK e-posta doğrulaması istiyor.
// Personel (staff/admin) bu kontrolden muaf, sadece misafir akışını kapsıyor.
function requireGuestLogin(){
  if(currentRole !== 'guest' || verifiedEmail) return true;
  toast('Bilet almak için önce e-posta ile giriş yapmalısın.');
  openEmailLoginModal();
  return false;
}

function clampDims(){
  cols = Math.min(40, Math.max(1, Number(colsInput.value) || 1));
  rows = Math.min(30, Math.max(1, Number(rowsInput.value) || 1));
  colsInput.value = cols;
  rowsInput.value = rows;
}

function updateTotalPreview(){
  clampDims();
  totalPreview.textContent = cols * rows;
}

// While the user is still typing, only preview the total — never rewrite
// the input's value, otherwise backspacing to clear it snaps back to "1"
// and the next digit gets appended instead of replacing it.
function livePreviewTotal(){
  const c = Math.min(40, Math.max(0, Number(colsInput.value) || 0));
  const r = Math.min(30, Math.max(0, Number(rowsInput.value) || 0));
  totalPreview.textContent = c * r;
}

function renderVenueAccent(){
  const cfg = VENUE_TYPES[venueType] || VENUE_TYPES.sinema;
  screenAccentEl.className = `screen-curve${cfg.shape !== 'curve' ? ' ' + cfg.shape : ''}`;
  screenAccentEl.querySelector('span').textContent = cfg.screenLabel;
  document.querySelectorAll('#venueTypeChips .preset-chip').forEach(c => {
    c.classList.toggle('is-active', c.dataset.venue === venueType);
  });

  // Havuzlu modlar (futbol + Genel Etkinlik) koltuk numarası kullanmadığı
  // için sütun/satır ayarları anlamsız — o kontroller gizleniyor.
  const stadium = isStadiumMode();
  const pooled = isPooledMode();
  const genel = venueType === 'genel';
  layoutControlsEl.hidden = pooled;
  stadiumNoteEl.hidden = !pooled;
  stadiumNoteEl.textContent = stadium
    ? 'Futbol Sahası için sabit stadyum düzeni kullanılır — sütun/satır ayarı bu türde geçerli değil.'
    : 'Genel Etkinlik ücretsiz/biletsiz tek bir giriş havuzudur — koltuk numarası ve bilet türü/fiyat yoktur, sadece toplam kapasite.';
  // activeBlockIdx dolu olan bir "havuz" değil, blok İÇİNDE gerçek tek tek
  // koltuk seçimi (bkz. renderGrid) — bu durumda SAHA etiketi ve Tekli/Çoklu
  // Seçim yine anlamlı. Bu fonksiyon her realtime güncellemede de çalıştığı
  // için (bkz. applyEventRow) burada `pooled` deyip geçmek, kullanıcı bir
  // blok içinde çoklu koltuk seçerken başka biri BAŞKA bir koltuk aldığında
  // setBulkMode(false) ile seçimini sıfırlardı.
  const inBlock = stadium && activeBlockIdx !== null;
  screenAccentEl.hidden = pooled && !inBlock;

  // Genel Etkinlik'te fiyat/bilet türü ve indirim kodu kavramı yok (bkz.
  // joinGeneralEvent) — o panelleri gizleyip yerine tek bir kapasite
  // alanı gösteriliyor.
  generalCapacitySection.hidden = !genel;
  tierPanelSection.hidden = genel;
  discountPanelSection.hidden = genel;
  if(genel) renderGeneralCapacityEditor();

  // Ciro Özeti de fiyat/bilet türü varsayıyor — ücretsiz Genel Etkinlik'te
  // hep "0 adet — 0₺" satırları göstermesi kafa karıştırıyordu, tamamen gizleniyor.
  if(revenuePanel) revenuePanel.hidden = genel;

  // Tekli/Çoklu Seçim, kapasiteli havuzlarda anlamsız (her havuz kendi
  // miktar seçimini kendi modalinde yapıyor) — ♿ İşaretle bloklar için de
  // geçerli kaldığından o ayrı kalıyor.
  singleModeBtn.hidden = pooled && !inBlock;
  bulkModeBtn.hidden = pooled && !inBlock;
  if(pooled && !inBlock) setBulkMode(false);

  // Filtre çipleri (Tümü/Boş/Erkek/Kadın/Satılan) havuzlu modda anlamsız —
  // her blok/havuzun üzerinde zaten kendi "X/Y" sayısı yazıyor, ayrıca bir
  // dolu/boş filtresine gerek yok. Takılı kalmış bir filtre varsa (başka bir
  // türden geçilirken) tüm ızgara soluk görünür kalmasın diye sıfırlanıyor.
  const gridFiltersEl = document.getElementById('gridFilters');
  if(gridFiltersEl) gridFiltersEl.hidden = pooled;
  if(pooled && currentFilter !== 'all'){
    currentFilter = 'all';
    document.querySelectorAll('#gridFilters .filter-chip').forEach(c => c.classList.toggle('is-active', c.dataset.filter === 'all'));
  }
}

// seatSales must always be the same length as seatStates for index alignment —
// the two arrays are now stored in separate Supabase tables (events vs
// event_sales) and can briefly drift out of sync while both realtime
// updates arrive.
function normalizeSalesLength(){
  const total = seatStates.length;
  if(seatSales.length !== total){
    const next = new Array(total).fill(null);
    for(let i = 0; i < Math.min(seatSales.length, total); i++) next[i] = seatSales[i];
    seatSales = next;
  }
}

function generateGrid(preserve){
  clampDims();
  const total = cols * rows;
  let accessibleChanged = false;

  if(preserve && seatStates.length){
    const nextStates = new Array(total).fill('empty');
    const nextSales = new Array(total).fill(null);
    for(let i = 0; i < Math.min(seatStates.length, total); i++){
      nextStates[i] = seatStates[i];
      nextSales[i] = seatSales[i] || null;
    }
    seatStates = nextStates;
    seatSales = nextSales;
    accessibleChanged = pruneAccessibleSeats(total);
  } else {
    seatStates = new Array(total).fill('empty');
    seatSales = new Array(total).fill(null);
    // Duzen sifirlaniyorsa eski isaretler de anlamsiz kalir.
    accessibleChanged = ACCESSIBLE_SEATS.size > 0;
    ACCESSIBLE_SEATS.clear();
  }

  if(accessibleChanged) pushAccessibleSeats();

  renderGrid();
  pushLayout();     // cols/rows/seat_states → events table
  pushSalesData();  // seat_sales reset too → event_sales table
}

function renderGrid(){
  if(isStadiumMode()){
    const inBlock = activeBlockIdx !== null;
    // Blok icine girince artik gercek sinema-tarzi tek koltuk secimi var --
    // "SAHA" yon etiketi (screenAccentEl, digerlerinde PERDE/SAHNE) ve
    // Tekli/Coklu Seçim anlamli hale geliyor. Blok listesinde (havuz
    // gorunumu) bunlarin hicbiri anlamsiz, renderVenueAccent'te oldugu gibi gizli kaliyor.
    if(screenAccentEl) screenAccentEl.hidden = !inBlock;
    singleModeBtn.hidden = !inBlock;
    bulkModeBtn.hidden = !inBlock;
    if(inBlock){
      renderBlockSeatGrid();
      return;
    }
    setBulkMode(false);
    renderStadiumGrid();
    return;
  }
  if(venueType === 'genel'){
    renderGeneralGrid();
    return;
  }

  seatGrid.classList.remove('stadium-mode', 'general-mode', 'block-seat-mode');
  if(stadiumLegendEl) stadiumLegendEl.hidden = true;
  // Seats are direct grid children so CSS Grid wraps them into real rows —
  // wrapping them in per-row divs previously made every row a single grid
  // item, so all rows collapsed onto one visual line.
  seatGrid.style.gridTemplateColumns = `repeat(${cols}, auto)`;
  seatGrid.style.gridTemplateRows = '';
  seatGrid.classList.toggle('guest-mode', !canEdit());
  normalizeSalesLength();
  seatGrid.innerHTML = '';
  seatButtons = [];

  let seatNum = 0;
  for(let r = 0; r < rows; r++){
    for(let c = 0; c < cols; c++){
      const idx = seatNum;
      const btn = document.createElement('button');
      btn.type = 'button';
      renderSeatVisual(btn, idx);
      if(bulkMode && bulkSelected.has(idx)) btn.classList.add('bulk-selected');
      btn.addEventListener('click', () => handleSeatClick(idx, btn));
      seatGrid.appendChild(btn);
      seatButtons.push(btn);
      seatNum++;
    }
  }
  updateStats();
  applyFilterAndSearch();
}

// Stadium mode: fixed pitch + tribün-block layout instead of a rows×cols
// numbered grid. seatStates/seatSales are forced to STADIUM_BLOCKS.length so
// every block still maps 1:1 to one array index — the sale modal, bulk
// select, revenue breakdown and Supabase sync all keep working unchanged.
function renderStadiumGrid(){
  const total = STADIUM_BLOCKS.length;
  if(seatStates.length !== total){
    // Stadyumda "boş" 0 (satılan bilet sayısı), diğer venue türlerindeki
    // 'empty' string'i değil — bkz. blockSoldCount/salesAt.
    const nextStates = new Array(total).fill(0);
    const nextSales = new Array(total).fill(null);
    for(let i = 0; i < Math.min(seatStates.length, total); i++){
      nextStates[i] = seatStates[i];
      nextSales[i] = seatSales[i] || null;
    }
    seatStates = nextStates;
    seatSales = nextSales;
  }
  normalizeSalesLength();

  seatGrid.classList.remove('general-mode', 'block-seat-mode');
  seatGrid.classList.add('stadium-mode');
  seatGrid.style.gridTemplateColumns = '';
  seatGrid.style.gridTemplateRows = '';
  seatGrid.classList.toggle('guest-mode', !canEdit());
  seatGrid.innerHTML = '';
  seatButtons = [];

  const field = document.createElement('div');
  field.className = 'stadium-field';
  field.setAttribute('aria-hidden', 'true');
  const boxLeft = document.createElement('div');
  boxLeft.className = 'stadium-field-box left';
  const boxRight = document.createElement('div');
  boxRight.className = 'stadium-field-box right';
  field.appendChild(boxLeft);
  field.appendChild(boxRight);
  seatGrid.appendChild(field);

  STADIUM_BLOCKS.forEach((block, idx) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    renderSeatVisual(btn, idx);
    btn.style.gridColumn = block.col;
    btn.style.gridRow = block.row;
    // Futbolda blok rengi cinsiyete değil FİYAT KATMANINA göre — inline
    // stil sınıf tabanlı erkek/kadın dolgusunu ezer (satır içi > sınıf).
    // Dolu/boş/satılan durumu artık renkle değil rozet/halka ile gösteriliyor.
    if(block.tier && STADIUM_TIER_COLORS[block.tier]) btn.style.background = STADIUM_TIER_COLORS[block.tier];
    if(bulkMode && bulkSelected.has(idx)) btn.classList.add('bulk-selected');
    btn.addEventListener('click', () => handleSeatClick(idx, btn));
    seatGrid.appendChild(btn);
    seatButtons.push(btn);
  });

  updateStats();
  applyFilterAndSearch();
  renderStadiumLegend();
}

// Fiyat katmanı lejantı — referans stadyum bilet şemalarındaki gibi renk
// karesi + kategori adı + fiyat listesi. Yalnızca futbol modunda gösterilir;
// TICKET_TIERS'tan okur, yani yönetici "Bilet Türleri" panelinden fiyatları
// değiştirirse burada da anında yansır.
function renderStadiumLegend(){
  if(!stadiumLegendEl) return;
  if(!isStadiumMode()){ stadiumLegendEl.hidden = true; return; }

  stadiumLegendEl.innerHTML = '';
  TICKET_TIERS.forEach(tier => {
    const row = document.createElement('div');
    row.className = 'stadium-legend-row';
    const swatch = document.createElement('span');
    swatch.className = 'stadium-legend-swatch';
    swatch.style.background = STADIUM_TIER_COLORS[tier.id] || 'var(--tint-3)';
    const label = document.createElement('span');
    label.className = 'stadium-legend-label';
    label.textContent = tier.label;
    const price = document.createElement('span');
    price.className = 'stadium-legend-price';
    price.textContent = `${tier.price}₺`;
    row.appendChild(swatch);
    row.appendChild(label);
    row.appendChild(price);
    stadiumLegendEl.appendChild(row);
  });
  stadiumLegendEl.hidden = false;
}

// Genel Etkinlik: koltuk numarası yok, sabit stadyum şeması da yok — tek bir
// ücretsiz/biletsiz giriş havuzu (bkz. poolBlocks/joinGeneralEvent) tek
// satırlık bir kart olarak gösterilir. renderSeatVisual zaten isPooledMode()
// dallanmasıyla aynı görsel bloğu (sold/empty/partial + kesir + dolgu
// çubuğu) üretiyor, burada sadece stadyumun sabit pitch/grid düzeni yerine
// basit bir liste düzeni kuruluyor.
function renderGeneralGrid(){
  const blocks = poolBlocks();
  const total = blocks.length;
  if(seatStates.length !== total){
    const nextStates = new Array(total).fill(0);
    const nextSales = new Array(total).fill(null);
    for(let i = 0; i < Math.min(seatStates.length, total); i++){
      nextStates[i] = seatStates[i];
      nextSales[i] = seatSales[i] || null;
    }
    seatStates = nextStates;
    seatSales = nextSales;
  }
  normalizeSalesLength();

  seatGrid.classList.remove('stadium-mode', 'block-seat-mode');
  seatGrid.classList.add('general-mode');
  seatGrid.style.gridTemplateColumns = '';
  seatGrid.style.gridTemplateRows = '';
  seatGrid.classList.toggle('guest-mode', !canEdit());
  if(stadiumLegendEl) stadiumLegendEl.hidden = true;
  seatGrid.innerHTML = '';
  seatButtons = [];

  blocks.forEach((block, idx) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    renderSeatVisual(btn, idx);
    if(bulkMode && bulkSelected.has(idx)) btn.classList.add('bulk-selected');
    btn.addEventListener('click', () => handleSeatClick(idx, btn));
    seatGrid.appendChild(btn);
    seatButtons.push(btn);
  });

  updateStats();
  applyFilterAndSearch();
}

function handleSeatClick(idx, btn){
  // Erişilebilirlik işaretleme sadece yönetici özelliği; koltuğun dolu/boş
  // durumundan bağımsız çalışır (satılmış bir koltuk da işaretlenebilir).
  if(isAdmin() && accessMode){
    toggleAccessibleSeat(idx, btn);
    return;
  }

  if(!canPurchase()) return;

  // Bir bloğa tıklamak artık o bloğun İÇİNE girer — koltuklar orada tek
  // tek (sinema düzeni gibi) seçiliyor, bkz. enterBlockView.
  if(isStadiumMode()){
    enterBlockView(idx);
    return;
  }
  // Genel Etkinlik: ücretsiz/biletsiz tek giriş havuzu — bilet türü/ödeme
  // adımı yok, tek tıkla katılım (bkz. joinGeneralEvent). Tek tık = doğrudan
  // "satın alma" (katılma) olduğu için giriş kontrolü burada.
  if(venueType === 'genel'){
    if(!requireGuestLogin()) return;
    joinGeneralEvent();
    return;
  }

  // Toplu seçim artık misafirde de var (grup/aile bileti için) — sadece
  // erişilebilirlik işaretleme yönetici özelliği kalıyor. "Dolu" kontrolü
  // seatStates'e bakıyor (herkese gönderiliyor); seatSales misafirde hiç
  // yok, o yüzden ona bakılmıyor (her zaman boş/undefined dönerdi).
  if(bulkMode){
    const state = seatStates[idx] || 'empty';
    if(state !== 'empty'){
      toast('Bu koltuk dolu — toplu seçim için boş koltuk seç.');
      return;
    }
    if(bulkSelected.has(idx)){
      bulkSelected.delete(idx);
      btn.classList.remove('bulk-selected');
    } else {
      bulkSelected.add(idx);
      btn.classList.add('bulk-selected');
    }
    updateBulkToolbar();
    return;
  }

  if(!requireGuestLogin()) return;
  openSeatModal(idx);
}

function updateBulkToolbar(){
  bulkCountEl.textContent = bulkSelected.size;
  startBulkSaleBtn.hidden = bulkSelected.size === 0;
  startBulkSaleLabel.textContent = canEdit() ? 'Satışa Başla' : 'Koltukları Al';
}

function setBulkMode(on){
  bulkMode = on;
  singleModeBtn.classList.toggle('is-active', !on);
  bulkModeBtn.classList.toggle('is-active', on);
  if(!on){
    bulkSelected.forEach(i => {
      const btn = seatButtons[i];
      if(btn) btn.classList.remove('bulk-selected');
    });
    bulkSelected.clear();
    updateBulkToolbar();
  }
}

singleModeBtn.addEventListener('click', () => setBulkMode(false));
bulkModeBtn.addEventListener('click', () => setBulkMode(true));

function setAccessMode(on){
  accessMode = on;
  accessModeBtn?.classList.toggle('is-active', on);
  gridHint.textContent = on
    ? 'Erişilebilir olacak koltuklara tıkla — tekrar tıklayınca kaldırılır. Bitirince modu kapat.'
    : 'Bir koltuğa tıkla: cinsiyet, bilet türü ve ödeme yöntemini seç';
  if(on) setBulkMode(false);
}

accessModeBtn?.addEventListener('click', () => setAccessMode(!accessMode));

function toggleAccessibleSeat(idx, btn){
  if(ACCESSIBLE_SEATS.has(idx)) ACCESSIBLE_SEATS.delete(idx);
  else ACCESSIBLE_SEATS.add(idx);
  renderSeatVisual(btn, idx);
  pushAccessibleSeats();
}

// Katman/mekan türü değişince koltuk sayısı değişebilir — artık var olmayan
// indeksleri işaretli listeden temizler. Değişiklik varsa true döner.
function pruneAccessibleSeats(total){
  let changed = false;
  ACCESSIBLE_SEATS.forEach(i => {
    if(i >= total){ ACCESSIBLE_SEATS.delete(i); changed = true; }
  });
  return changed;
}

startBulkSaleBtn.addEventListener('click', () => {
  if(bulkSelected.size === 0) return;
  if(!requireGuestLogin()) return;
  modalSeatIndices = [...bulkSelected];
  modalSeatIdx = null;
  modalBlockSeatPos = null;
  modalGender = null;

  // Blok içindeki çoklu seçim: tür zaten blok tarafından sabit, cinsiyet
  // ayrımı da yok (bkz. openBuyerPanelForBlockSeat) — tür VE cinsiyet
  // panelleri atlanıp doğrudan alıcı bilgisine geçiliyor.
  if(activeBlockIdx !== null){
    modalTier = STADIUM_BLOCKS[activeBlockIdx].tier;
    seatModalTitle.textContent = `${STADIUM_BLOCKS[activeBlockIdx].label} — ${modalSeatIndices.length} Koltuk`;
    openBuyerPanelForBlockSeat();
    seatModalOverlay.hidden = false;
    return;
  }

  modalTier = null;
  seatModalTitle.textContent = `${modalSeatIndices.length} Koltuk`;
  renderModalTierButtons();
  showModalPanel('gender');
  seatModalOverlay.hidden = false;
});

function labelFor(state){
  return state === 'male' ? 'Erkek' : state === 'female' ? 'Kadın' : 'Boş';
}

function paymentLabel(payment){
  const normalized = PAYMENT_LONG[payment] || payment;
  return normalized === 'kart' ? 'Kart' : normalized === 'nakit' ? 'Nakit' : null;
}

// Same-row immediate left/right neighbor check. Warns (doesn't block) when a
// gender assignment would put opposite genders directly side by side.
// Havuzlu modlar (futbol/Genel Etkinlik) basit sütun×satır ızgarası
// kullanmadığı için bu kontrol orada uygulanmıyor.
function findAdjacencyConflict(idx, gender){
  if(isPooledMode()) return false;
  const col = idx % cols;
  const neighbors = [];
  if(col > 0) neighbors.push(idx - 1);
  if(col < cols - 1) neighbors.push(idx + 1);
  return neighbors.some(n => {
    const st = seatStates[n];
    return st && st !== 'empty' && st !== gender;
  });
}

function seatAriaLabel(idx){
  if(isPooledMode()){
    const block = poolBlocks()[idx];
    const capacity = block.capacity;
    const sold = blockSoldCount(idx);
    let label = isStadiumMode()
      ? `${block.label} Bloğu, ${sold}/${capacity} satıldı`
      : `${block.label}, ${sold}/${capacity} katıldı`;
    if(ACCESSIBLE_SEATS.has(idx)) label += ', erişilebilir';
    return label;
  }

  const state = seatStates[idx] || 'empty';
  const sale = seatSales[idx];
  const r = Math.floor(idx / cols) + 1;
  const c = (idx % cols) + 1;
  let label = `Koltuk ${r}-${c}, durum: ${labelFor(state)}`;
  if(sale) label += `, satıldı: ${sale.label} ${sale.price}₺ (${paymentLabel(sale.payment) || '-'})`;
  if(ACCESSIBLE_SEATS.has(idx)) label += ', erişilebilir koltuk';
  return label;
}

function renderSeatVisual(btn, idx){
  const accessible = ACCESSIBLE_SEATS.has(idx);

  if(isPooledMode()){
    const block = poolBlocks()[idx];
    const capacity = block.capacity;
    const sold = blockSoldCount(idx);
    const full = capacity > 0 && sold >= capacity;
    const hasAny = sold > 0;

    // 'empty' = hiç satış yok ("Boş" çipi bunu arıyor), 'sold' = en az 1
    // bilet satılmış ("Satılan" çipi bunu arıyor — tamamen dolu olması
    // şart değil, kapasitesi 250 olan bir havuzda 1 satış bile "satılan"
    // sayılır). Kısmen dolu olanlar ayrıca 'partial' alır (sadece görsel
    // ayrım için, filtre mantığını etkilemiyor).
    btn.className = ['seat', 'stadium-block', hasAny ? 'sold' : 'empty', (hasAny && !full) ? 'partial' : null, accessible ? 'accessible' : null].filter(Boolean).join(' ');
    btn.innerHTML = '';

    const num = document.createElement('span');
    num.className = 'seat-num';
    num.textContent = block.label;
    btn.appendChild(num);

    const fraction = document.createElement('span');
    fraction.className = 'stadium-block-fraction';
    fraction.textContent = `${sold}/${capacity}`;
    btn.appendChild(fraction);

    const fillBar = document.createElement('span');
    fillBar.className = 'stadium-block-fill';
    fillBar.style.width = `${capacity > 0 ? Math.min(100, Math.round((sold / capacity) * 100)) : 0}%`;
    btn.appendChild(fillBar);

    if(accessible){
      const wheel = document.createElement('span');
      wheel.className = 'accessible-badge';
      wheel.textContent = '♿';
      wheel.setAttribute('aria-hidden', 'true');
      btn.appendChild(wheel);
    }

    btn.title = full ? (isStadiumMode() ? 'Bu blok dolu.' : 'Bu etkinlik dolu.') : `${capacity - sold} yer kaldı.`;
    btn.setAttribute('aria-label', seatAriaLabel(idx));
    return;
  }

  // ---- Diğer venue türleri: davranış değişmedi (tek koltuk = tek alıcı) ----
  const state = seatStates[idx] || 'empty';
  const sale = seatSales[idx];
  // "empty" de dahil DAİMA bir durum sınıfı eklenmeli: "Boş" filtre çipi
  // .seat:not(.empty) arıyor — eskiden boş koltuklar hiç sınıf almadığı
  // için bu filtre hiçbir zaman doğru koltuğu bulamıyor, her şeyi
  // soluklaştırıyordu. .seat.empty için ayrı bir görsel kural yok, o
  // yüzden bu eklemenin görünüme etkisi yok, sadece filtreyi düzeltiyor.
  btn.className = ['seat', state, sale ? 'sold' : null, accessible ? 'accessible' : null].filter(Boolean).join(' ');
  btn.innerHTML = '';

  const num = document.createElement('span');
  num.className = 'seat-num';
  num.textContent = idx + 1;
  btn.appendChild(num);

  if(accessible){
    const wheel = document.createElement('span');
    wheel.className = 'accessible-badge';
    wheel.textContent = '♿';
    wheel.setAttribute('aria-hidden', 'true');
    btn.appendChild(wheel);
  }

  if(sale){
    const badge = document.createElement('span');
    badge.className = 'sold-badge';
    badge.textContent = '₺';
    btn.appendChild(badge);
    btn.title = `${sale.label} — ${sale.price}₺ (${paymentLabel(sale.payment) || '-'})`;
  } else {
    btn.removeAttribute('title');
  }

  btn.setAttribute('aria-label', seatAriaLabel(idx));
}

function updateStats(){
  const pooled = isPooledMode();
  let total, taken, sold;

  // Havuzlu modlarda (futbol/Genel Etkinlik) seatStates[idx] cinsiyet değil
  // satılan bilet SAYISI — "Erkek"/"Kadın" kartlarının burada karşılığı yok
  // (bkz. poolBlocks/blockSoldCount), bu yüzden gizlenip toplam kapasite/
  // satılan adet üzerinden hesaplanıyor.
  const maleStatEl = document.getElementById('statMale').closest('.stat');
  const femaleStatEl = document.getElementById('statFemale').closest('.stat');
  if(maleStatEl) maleStatEl.hidden = pooled;
  if(femaleStatEl) femaleStatEl.hidden = pooled;

  if(pooled){
    const blocks = poolBlocks();
    total = blocks.reduce((sum, b) => sum + b.capacity, 0);
    taken = blocks.reduce((sum, b, idx) => sum + blockSoldCount(idx), 0);
    sold = taken;
  } else {
    const male = seatStates.filter(s => s === 'male').length;
    const female = seatStates.filter(s => s === 'female').length;
    document.getElementById('statMale').textContent = male;
    document.getElementById('statFemale').textContent = female;
    total = seatStates.length;
    taken = male + female;
    sold = seatSales.filter(Boolean).length;
  }

  const revenue = allSalesFlat().reduce((sum, s) => sum + s.price, 0);

  document.getElementById('statTotal').textContent = total;
  document.getElementById('statEmpty').textContent = total - taken;
  document.getElementById('statSold').textContent = sold;
  document.getElementById('statRevenue').textContent = `${revenue} ₺`;

  // "sold" (seatSales) misafire hic gonderilmiyor (gizlilik) -- oradan
  // yuzde hesaplarsak misafir icin her etkinlik DAIMA %0 gorunurdu (tam
  // olarak bu bug canli sitede vardi: liste karti "%55 dolu" derken
  // etkinlik icindeki Doluluk Orani "%0" gosteriyordu). seatStates
  // (erkek/kadin/bos, futbolda satilan sayisi) herkese gonderiliyor,
  // dolulugu ondan hesapla -- liste ekranindaki computeOccupancy() de
  // zaten boyle yapiyor.
  const occupancyPercent = total > 0 ? Math.round((taken / total) * 100) : 0;
  const capacityPercentEl = document.getElementById('capacityPercent');
  const capacityBarEl = document.getElementById('capacityBar');
  if (capacityPercentEl) capacityPercentEl.textContent = `${occupancyPercent}%`;
  if (capacityBarEl) capacityBarEl.style.width = `${occupancyPercent}%`;

  updateRevenueBreakdown(revenue);
}

// Per-tier breakdown (count sold + subtotal) plus the grand total ("Toplam Ciro"),
// and a second breakdown by payment method (Kart/Nakit). Both are keyed by the
// snapshot on each sale, not the live tier list, so a renamed/deleted tier still
// shows up correctly under its original name.
function buildRevenueRow(label, valueText){
  const row = document.createElement('div');
  row.className = 'revenue-row';
  const labelEl = document.createElement('span');
  labelEl.textContent = label;
  const valueEl = document.createElement('span');
  valueEl.textContent = valueText;
  row.appendChild(labelEl);
  row.appendChild(valueEl);
  return row;
}

function updateRevenueBreakdown(totalRevenue){
  const byTier = new Map();
  TICKET_TIERS.forEach(t => byTier.set(t.label, { count: 0, revenue: 0 }));
  const byPayment = { kart: 0, nakit: 0 };

  allSalesFlat().forEach(s => {
    if(!byTier.has(s.label)) byTier.set(s.label, { count: 0, revenue: 0 });
    const entry = byTier.get(s.label);
    entry.count++;
    entry.revenue += s.price;
    // payment "kart"/"nakit" ya da kısaltılmış "k"/"n" olabilir (bkz.
    // PAYMENT_SHORT/PAYMENT_LONG) — ikisini de kapsayacak şekilde normalize.
    const paymentLong = PAYMENT_LONG[s.payment] || s.payment;
    if(paymentLong === 'kart' || paymentLong === 'nakit') byPayment[paymentLong] += s.price;
  });

  revenueBreakdownEl.innerHTML = '';
  byTier.forEach((entry, label) => {
    // textContent (not innerHTML) — label bir bilet türü adı, admin
    // panelinden serbest metin olarak girilebiliyor; innerHTML ile
    // basılırsa depolanmış (stored) XSS'e açık olurdu.
    revenueBreakdownEl.appendChild(buildRevenueRow(label, `${entry.count} adet — ${entry.revenue} ₺`));
  });
  const totalRow = buildRevenueRow('Toplam Ciro', `${totalRevenue} ₺`);
  totalRow.classList.add('revenue-total');
  revenueBreakdownEl.appendChild(totalRow);

  paymentBreakdownEl.innerHTML = '';
  [['Kart', byPayment.kart], ['Nakit', byPayment.nakit]].forEach(([label, amount]) => {
    paymentBreakdownEl.appendChild(buildRevenueRow(label, `${amount} ₺`));
  });

  renderSalesChart();
}

// Güne göre satış dağılımı. soldAt zaman damgası bu özellikten önce
// satılmış biletlerde yok — onları "Tarihsiz" tek bir satırda topluyoruz ki
// grafik sessizce eksik veri göstermesin.
function renderSalesChart(){
  if(!salesChart) return;

  const byDay = new Map();
  let undated = { count: 0, revenue: 0 };

  allSalesFlat().forEach(s => {
    if(!s.soldAt){ undated.count++; undated.revenue += s.price; return; }
    const day = String(s.soldAt).slice(0, 10);
    if(!byDay.has(day)) byDay.set(day, { count: 0, revenue: 0 });
    const entry = byDay.get(day);
    entry.count++;
    entry.revenue += s.price;
  });

  if(byDay.size === 0 && undated.count === 0){
    salesChart.hidden = true;
    return;
  }

  const rows = [...byDay.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-14)   // son 14 gün yeter, grafik sonsuza kadar uzamasın
    .map(([day, v]) => ({
      label: new Date(`${day}T00:00:00`).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' }),
      ...v,
    }));

  if(undated.count) rows.push({ label: 'Tarihsiz', ...undated });

  const max = Math.max(...rows.map(r => r.count), 1);

  salesChartBody.innerHTML = '';
  rows.forEach(r => {
    const row = document.createElement('div');
    row.className = 'chart-row';

    const label = document.createElement('span');
    label.className = 'chart-label';
    label.textContent = r.label;

    const track = document.createElement('div');
    track.className = 'chart-track';
    const bar = document.createElement('div');
    bar.className = 'chart-bar';
    bar.style.width = `${Math.round((r.count / max) * 100)}%`;
    track.appendChild(bar);

    const value = document.createElement('span');
    value.className = 'chart-value';
    value.textContent = `${r.count} · ${r.revenue}₺`;

    row.appendChild(label);
    row.appendChild(track);
    row.appendChild(value);
    salesChartBody.appendChild(row);
  });

  salesChart.hidden = false;
}

function toast(msg){
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.hidden = true; }, 2200);
}

document.getElementById('generateBtn').addEventListener('click', () => {
  generateGrid(false);
  toast('Düzen oluşturuldu.');
});

colsInput.addEventListener('input', livePreviewTotal);
rowsInput.addEventListener('input', livePreviewTotal);
colsInput.addEventListener('blur', updateTotalPreview);
rowsInput.addEventListener('blur', updateTotalPreview);

document.querySelectorAll('.preset-chip[data-cols]').forEach(chip => {
  chip.addEventListener('click', () => {
    colsInput.value = chip.dataset.cols;
    rowsInput.value = chip.dataset.rows;
    updateTotalPreview();
    generateGrid(false);
    toast('Düzen oluşturuldu.');
  });
});

document.querySelectorAll('#venueTypeChips .preset-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    const wasStadium = isStadiumMode();
    venueType = chip.dataset.venue;
    renderVenueAccent();
    pushVenueType();

    if(isStadiumMode()){
      // Futbol Sahası kendi fiyat katmanı setini kullanıyor (bkz.
      // buildStadiumBlocks) — sinema/tiyatro'dan kalma Standart/VIP/Öğrenci
      // burada anlamsız, bloklar zaten o katmanların adını taşıyor.
      TICKET_TIERS = [...DEFAULT_STADIUM_TIERS];
      renderTierList();
      pushTiers();
      // Baska bir venue'den geliyorsak seatStates hala 'e'/'m'/'f' string'i
      // tasiyor olabilir -- stadyumda bu alan artik SAYI (satilan bilet
      // adedi). Uzunluk tesaduefen STADIUM_BLOCKS.length'e denk gelirse
      // renderStadiumGrid'deki uzunluk kontrolu bu donusumu atlar, o yuzden
      // burada ayrica ve kosulsuz donusturuyoruz.
      seatStates = seatStates.map(s => isSeatTaken(s) ? 1 : 0);
      // renderGrid() will resize seatStates/seatSales to STADIUM_BLOCKS.length.
      if(pruneAccessibleSeats(STADIUM_BLOCKS.length)) pushAccessibleSeats();
      renderGrid();
      pushSeatStates();
      pushSalesData();
    } else if(venueType === 'genel'){
      // Genel Etkinlik: koltuk numarası VE bilet türü/fiyat yok — tek bir
      // ücretsiz giriş havuzu (bkz. poolBlocks/joinGeneralEvent). Kapasitesi
      // yoksa varsayılana çekiliyor; başka bir venue'den geliniyorsa eski
      // seatStates (koltuk/blok bazlı) burada anlamsız, sıfırlanıyor.
      // Futboldan geliniyorsa TICKET_TIERS da sıfırlanıyor — genel'de
      // gösterilmiyor ama sonra tekrar sinema/tiyatro/konser'e geçilirse
      // eski Premium/Gold VIP isimlerinin sızmaması için.
      if(wasStadium) TICKET_TIERS = [...DEFAULT_TIERS];
      if(!GENERAL_CAPACITY) GENERAL_CAPACITY = DEFAULT_GENERAL_CAPACITY;
      pushGeneralCapacity();
      seatStates = [0];
      if(pruneAccessibleSeats(1)) pushAccessibleSeats();
      renderGrid();
      pushSeatStates();
      pushSalesData();
    } else {
      if(wasStadium){
        // Futboldan çıkılıyor — Premium/Gold VIP/... katmanları bu venue
        // türlerinde anlamsız kalır, genel Standart/VIP/Öğrenci listesine
        // dönülüyor. Bunu yapmazsak (önceki bug) sinema/tiyatro/konser'e
        // dönüldüğünde fiyat listesi hâlâ futbol katmanlarını gösteriyordu.
        TICKET_TIERS = [...DEFAULT_TIERS];
        renderTierList();
        pushTiers();
      }
      if(seatStates.length !== cols * rows){
        // Coming back from the fixed stadium layout — its block count won't
        // line up with whatever cols/rows this venue type uses, so start
        // this venue type with a fresh empty grid rather than a length mismatch.
        generateGrid(false);
      } else {
        renderGrid();
      }
    }

    toast(`Etkinlik türü: ${VENUE_TYPES[venueType].label}`);
  });
});

resetAllBtn.addEventListener('click', () => {
  seatStates = seatStates.map(() => 'empty');
  seatSales = seatSales.map(() => null);
  renderGrid();
  pushSeatStates();
  pushSalesData();
  toast('Tüm koltuklar sıfırlandı.');
});

// ===== Ticket tier management (add / remove / rename / reprice) =====

function renderTierList(){
  tierListEl.innerHTML = '';

  TICKET_TIERS.forEach(tier => {
    const row = document.createElement('div');
    row.className = 'tier-row';

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'tier-name-input';
    nameInput.maxLength = 20;
    nameInput.value = tier.label;
    nameInput.setAttribute('aria-label', 'Bilet türü adı');

    const priceInput = document.createElement('input');
    priceInput.type = 'number';
    priceInput.className = 'tier-price-input';
    priceInput.min = '0';
    priceInput.step = '1';
    priceInput.value = tier.price;
    priceInput.setAttribute('aria-label', `${tier.label} fiyatı`);

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'tier-del-btn';
    delBtn.textContent = '×';
    delBtn.setAttribute('aria-label', `${tier.label} bilet türünü sil`);

    // Only preview live (never rewrite the input mid-typing — see the
    // seat-count field fix for why); price rounds/clamps on blur.
    nameInput.addEventListener('input', () => {
      tier.label = nameInput.value.trim() ? nameInput.value : tier.label;
      pushTiers();
    });
    priceInput.addEventListener('input', () => {
      const raw = Number(priceInput.value);
      tier.price = Number.isFinite(raw) && raw >= 0 ? raw : 0;
      pushTiers();
    });
    priceInput.addEventListener('blur', () => {
      tier.price = Math.max(0, Math.round(Number(priceInput.value) || 0));
      priceInput.value = tier.price;
      pushTiers();
    });
    delBtn.addEventListener('click', () => removeTier(tier.id));

    row.appendChild(nameInput);
    row.appendChild(priceInput);
    row.appendChild(delBtn);
    tierListEl.appendChild(row);
  });
}

function addTier(){
  const label = newTierNameInput.value.trim();
  if(!label){
    toast('Bilet türü için bir isim gir.');
    return;
  }
  const price = Math.max(0, Math.round(Number(newTierPriceInput.value) || 0));
  const id = `tier_${Date.now()}`;

  TICKET_TIERS.push({ id, label, price });
  newTierNameInput.value = '';
  newTierPriceInput.value = '';

  renderTierList();
  pushTiers();
  toast(`"${label}" bilet türü eklendi.`);
}

function removeTier(tierId){
  if(TICKET_TIERS.length <= 1){
    toast('En az bir bilet türü kalmalı.');
    return;
  }
  const removed = TICKET_TIERS.find(t => t.id === tierId);
  TICKET_TIERS = TICKET_TIERS.filter(t => t.id !== tierId);

  renderTierList();
  pushTiers();
  toast(removed ? `"${removed.label}" bilet türü silindi.` : 'Bilet türü silindi.');
}

document.getElementById('addTierBtn').addEventListener('click', addTier);
[newTierNameInput, newTierPriceInput].forEach(input => {
  input.addEventListener('keydown', (e) => {
    if(e.key === 'Enter'){
      e.preventDefault();
      addTier();
    }
  });
});

// ===== İndirim kodu yönetimi (etkinlik başına, sadece Yönetici) =====

function pushDiscountCodes(){
  if(!supabaseClient || isApplyingRemote || !currentEventId) return;
  supabaseClient.from('events').update({
    discount_codes: DISCOUNT_CODES,
    updated_at: new Date().toISOString(),
  }).eq('id', currentEventId).then(({ error }) => {
    if(error) console.warn('Supabase (events) indirim kodu güncelleme hatası:', error.message);
  });
}

function renderDiscountList(){
  discountListEl.innerHTML = '';
  DISCOUNT_CODES.forEach(dc => {
    const row = document.createElement('div');
    row.className = 'discount-row-item';

    const label = document.createElement('span');
    label.className = 'discount-code-label';
    label.textContent = `${dc.code} — ${dc.type === 'percent' ? `%${dc.value}` : `${dc.value}₺`}`;

    const usage = document.createElement('span');
    usage.className = 'discount-usage-label';
    usage.textContent = dc.maxUses ? `${dc.usedCount || 0}/${dc.maxUses} kullanıldı` : `${dc.usedCount || 0} kullanıldı`;

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'tier-del-btn';
    delBtn.textContent = '×';
    delBtn.setAttribute('aria-label', `${dc.code} kodunu sil`);
    delBtn.addEventListener('click', () => removeDiscountCode(dc.code));

    row.appendChild(label);
    row.appendChild(usage);
    row.appendChild(delBtn);
    discountListEl.appendChild(row);
  });
}

function addDiscountCode(){
  const code = newDiscountCode.value.trim().toUpperCase();
  if(!code){
    toast('Kod için bir metin gir.');
    return;
  }
  if(DISCOUNT_CODES.some(dc => dc.code === code)){
    toast('Bu kod zaten var.');
    return;
  }
  const type = newDiscountType.value === 'fixed' ? 'fixed' : 'percent';
  const value = Math.max(0, Number(newDiscountValue.value) || 0);
  const maxUses = newDiscountMaxUses.value ? Math.max(1, Math.round(Number(newDiscountMaxUses.value))) : null;

  DISCOUNT_CODES.push({ code, type, value, maxUses, usedCount: 0 });
  newDiscountCode.value = '';
  newDiscountValue.value = '';
  newDiscountMaxUses.value = '';

  renderDiscountList();
  pushDiscountCodes();
  toast(`"${code}" indirim kodu eklendi.`);
}

function removeDiscountCode(code){
  DISCOUNT_CODES = DISCOUNT_CODES.filter(dc => dc.code !== code);
  renderDiscountList();
  pushDiscountCodes();
  toast(`"${code}" kodu silindi.`);
}

addDiscountBtn.addEventListener('click', addDiscountCode);
[newDiscountCode, newDiscountValue, newDiscountMaxUses].forEach(input => {
  input.addEventListener('keydown', (e) => {
    if(e.key === 'Enter'){
      e.preventDefault();
      addDiscountCode();
    }
  });
});

// ===== Afiş görseli (etkinlik başına, sadece Yönetici) =====

// Afiş URL'i yöneticinin serbestçe girdiği bir metin ve <img src> olarak
// kullanılıyor; sadece http(s) şemasına izin veriyoruz ki "javascript:" gibi
// bir şey yapıştırılıp tıklanabilir bir güvenlik açığına dönüşmesin.
function safeImageUrl(raw){
  const url = (raw || '').trim();
  if(!url) return null;
  try {
    const parsed = new URL(url);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') ? url : null;
  } catch {
    return null;
  }
}

function renderPosterEditor(){
  eventPosterInput.value = POSTER_URL || '';
  if(POSTER_URL){
    posterPreview.src = POSTER_URL;
    posterPreview.hidden = false;
  } else {
    posterPreview.removeAttribute('src');
    posterPreview.hidden = true;
  }
}

savePosterBtn.addEventListener('click', async () => {
  if(!supabaseClient || !currentEventId) return;
  const raw = eventPosterInput.value.trim();
  const url = raw ? safeImageUrl(raw) : null;

  if(raw && !url){
    toast('Geçersiz adres — http:// veya https:// ile başlamalı.');
    return;
  }

  savePosterBtn.disabled = true;
  const { error } = await supabaseClient.from('events').update({
    poster_url: url, updated_at: new Date().toISOString(),
  }).eq('id', currentEventId);
  savePosterBtn.disabled = false;

  if(error){ toast('Afiş kaydedilemedi.'); return; }
  POSTER_URL = url;
  renderPosterEditor();
  toast(url ? 'Afiş kaydedildi.' : 'Afiş kaldırıldı.');
});

// Not: poster_url gibi herkese açık bir alan — misafir eventNoteDisplay'de
// görür, yönetici burada (eventNoteInput/saveNoteBtn) düzenler.
function renderNoteEditor(){
  eventNoteInput.value = EVENT_NOTE || '';
  if(EVENT_NOTE){
    eventNoteDisplay.textContent = EVENT_NOTE;
    eventNoteDisplay.hidden = false;
  } else {
    eventNoteDisplay.textContent = '';
    eventNoteDisplay.hidden = true;
  }
}

function renderGeneralCapacityEditor(){
  generalCapacityInput.value = GENERAL_CAPACITY;
}

saveGeneralCapacityBtn.addEventListener('click', async () => {
  if(!supabaseClient || !currentEventId) return;
  const raw = Math.round(Number(generalCapacityInput.value));
  const capacity = Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_GENERAL_CAPACITY;
  generalCapacityInput.value = capacity;

  saveGeneralCapacityBtn.disabled = true;
  const { error } = await supabaseClient.from('events').update({
    general_capacity: capacity, updated_at: new Date().toISOString(),
  }).eq('id', currentEventId);
  saveGeneralCapacityBtn.disabled = false;

  if(error){ toast('Kapasite kaydedilemedi.'); return; }
  GENERAL_CAPACITY = capacity;
  if(seatButtons[0]) renderSeatVisual(seatButtons[0], 0);
  updateStats();
  toast('Kapasite kaydedildi.');
});

saveNoteBtn.addEventListener('click', async () => {
  if(!supabaseClient || !currentEventId) return;
  const note = eventNoteInput.value.trim() || null;

  saveNoteBtn.disabled = true;
  const { error } = await supabaseClient.from('events').update({
    note, updated_at: new Date().toISOString(),
  }).eq('id', currentEventId);
  saveNoteBtn.disabled = false;

  if(error){ toast('Not kaydedilemedi.'); return; }
  EVENT_NOTE = note;
  renderNoteEditor();
  toast(note ? 'Not kaydedildi.' : 'Not kaldırıldı.');
});

// ===== Dinamik fiyatlandırma (etkinlik başına, sadece Yönetici) =====
// Doluluk oranı eşiği geçince bilet fiyatlarına yüzde zam uygulanır.
// Zam, indirim kodundan ÖNCE hesaplanır: önce zamlı fiyat bulunur,
// indirim onun üzerine iner.

function currentOccupancyPercent(){
  // Havuzlu modda (futbol/Genel Etkinlik) seatStates[idx] "en az 1 satış var
  // mı" değil, gerçek kapasite doluluk oranı istenir — havuzdaki tekil
  // "satıldı mı" boole'u burada yanıltıcı olurdu (40 kişilik havuz 1 bilet
  // satınca %100 dolu sayılırdı).
  if(isPooledMode()){
    const blocks = poolBlocks();
    const totalCap = blocks.reduce((sum, b) => sum + b.capacity, 0);
    if(!totalCap) return 0;
    const taken = blocks.reduce((sum, b, idx) => sum + blockSoldCount(idx), 0);
    return Math.round((taken / totalCap) * 100);
  }
  const total = seatStates.length;
  if(!total) return 0;
  return Math.round((seatStates.filter(isSeatTaken).length / total) * 100);
}

function isSurgeActive(){
  return !!(DYNAMIC_PRICING && DYNAMIC_PRICING.enabled
    && currentOccupancyPercent() >= Number(DYNAMIC_PRICING.threshold || 0));
}

function effectiveTierPrice(tier){
  if(!isSurgeActive()) return tier.price;
  const inc = Number(DYNAMIC_PRICING.increase || 0);
  return Math.max(0, Math.round(tier.price * (1 + inc / 100)));
}

function renderDynamicPricingEditor(){
  dynEnabled.checked = !!DYNAMIC_PRICING.enabled;
  dynThreshold.value = DYNAMIC_PRICING.threshold ?? 80;
  dynIncrease.value = DYNAMIC_PRICING.increase ?? 10;

  const occ = currentOccupancyPercent();
  if(!DYNAMIC_PRICING.enabled){
    dynStatusNote.className = 'dynamic-note';
    dynStatusNote.textContent = `Kapalı. Şu anki doluluk: %${occ}`;
  } else if(isSurgeActive()){
    dynStatusNote.className = 'dynamic-note active';
    dynStatusNote.textContent = `Aktif — doluluk %${occ}, fiyatlara %${DYNAMIC_PRICING.increase} zam uygulanıyor.`;
  } else {
    dynStatusNote.className = 'dynamic-note';
    dynStatusNote.textContent = `Beklemede — doluluk %${occ}, eşik %${DYNAMIC_PRICING.threshold}.`;
  }
}

saveDynBtn.addEventListener('click', async () => {
  if(!supabaseClient || !currentEventId) return;
  const next = {
    enabled: dynEnabled.checked,
    threshold: Math.min(100, Math.max(1, Math.round(Number(dynThreshold.value) || 80))),
    increase: Math.min(200, Math.max(1, Math.round(Number(dynIncrease.value) || 10))),
  };

  saveDynBtn.disabled = true;
  const { error } = await supabaseClient.from('events').update({
    dynamic_pricing: next, updated_at: new Date().toISOString(),
  }).eq('id', currentEventId);
  saveDynBtn.disabled = false;

  if(error){ toast('Ayar kaydedilemedi.'); return; }
  DYNAMIC_PRICING = next;
  renderDynamicPricingEditor();
  toast('Dinamik fiyatlandırma kaydedildi.');
});

// ===== Seat modal: cinsiyet → bilet türü → alıcı bilgisi → ödeme yöntemi =====

function showModalPanel(name){
  document.querySelectorAll('.modal-step-panel').forEach(p => p.hidden = p.dataset.panel !== name);
}

function seatLabelFor(idx){
  if(isStadiumMode()) return `${STADIUM_BLOCKS[idx].label} Bloğu`;
  if(venueType === 'genel') return poolBlocks()[idx].label;
  const r = Math.floor(idx / cols) + 1;
  const c = (idx % cols) + 1;
  return `Koltuk ${r}-${c}`;
}

function renderModalTierButtons(){
  modalTierButtonsEl.innerHTML = '';
  const surge = isSurgeActive();
  TICKET_TIERS.forEach(tier => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'choice-btn';
    const price = effectiveTierPrice(tier);
    btn.textContent = surge && price !== tier.price
      ? `${tier.label} (${price}₺ · yoğun talep)`
      : `${tier.label} (${price}₺)`;
    btn.addEventListener('click', () => {
      modalTier = tier.id;
      buyerNameInput.value = '';
      if(buyerEmailInput) buyerEmailInput.value = verifiedEmail || '';
      buyerNoteText.textContent = currentRole === 'guest'
        ? 'Biletin bu isimle düzenlenecek.'
        : 'Opsiyonel — boş bırakılabilir.';
      showModalPanel('buyer');
      buyerNameInput.focus();
    });
    modalTierButtonsEl.appendChild(btn);
  });
}

async function openSeatModal(idx){
  modalSeatIdx = idx;
  modalSeatIndices = null;
  modalBlockSeatPos = null;
  modalGender = null;
  modalTier = null;
  modalBuyerName = '';
  modalBuyerEmail = '';
  modalDiscount = null;
  modalHeldIdx = null;

  seatModalTitle.textContent = seatLabelFor(idx) + (ACCESSIBLE_SEATS.has(idx) ? ' ♿' : '');

  const state = seatStates[idx] || 'empty';
  const sale = seatSales[idx];

  if(state !== 'empty' || sale){
    const parts = [`Cinsiyet: ${labelFor(state)}`];
    // Fiyat/bilet-türü/ödeme sadece personele gösterilir — CSS zaten
    // .editor-only ile gizliyor ama burada da JS'te kontrol ediyoruz
    // (modaller #appRoot dışında yaşıyor, bu yüzden CSS'e tek başına
    // güvenilmiyor — bkz. body[data-role] notu).
    if(sale && canEdit()) parts.push(`Bilet: ${sale.label} — ${sale.price}₺ (${paymentLabel(sale.payment) || '-'})`);
    modalInfoTextEl.textContent = parts.join(' · ');

    if(sale && sale.ticketCode && canEdit()){
      viewTicketBtn.hidden = false;
      viewTicketBtn.onclick = () => showTicketView(idx, sale);
    } else {
      viewTicketBtn.hidden = true;
      viewTicketBtn.onclick = null;
    }
    modalClearSeatBtn.hidden = !canEdit();

    holdCountdownEl.hidden = true;
    showModalPanel('info');
    seatModalOverlay.hidden = false;
    return;
  }

  // Boş koltuk: satın alma akışına girmeden önce birkaç dakikalık bir
  // rezervasyon dene — başarısız olursa (başkası az önce aldı/bakıyor)
  // modalı hiç açma.
  if(currentEventId){
    try {
      const { error } = await supabaseClient.rpc('reserve_seat', {
        p_event_id: currentEventId, p_idx: idx, p_token: holdToken, p_ttl_seconds: HOLD_TTL_SECONDS,
      });
      if(error) throw error;
      modalHeldIdx = idx;
      startHoldCountdown();
    } catch(err){
      const held = err && err.message && err.message.includes('SEAT_HELD');
      toast(held ? 'Bu koltuğa şu anda başka biri bakıyor, birazdan tekrar dene.' : 'Bu koltuk artık uygun değil.');
      return;
    }
  }

  discountCodeInput.value = '';
  discountNoteText.hidden = true;
  renderModalTierButtons();
  showModalPanel('gender');
  seatModalOverlay.hidden = false;
}

function startHoldCountdown(){
  stopHoldCountdown();
  holdExpiresAt = Date.now() + HOLD_TTL_SECONDS * 1000;
  holdCountdownEl.hidden = false;
  updateHoldCountdownText();
  holdCountdownInterval = setInterval(updateHoldCountdownText, 1000);
}

function updateHoldCountdownText(){
  const remainingMs = holdExpiresAt - Date.now();
  if(remainingMs <= 0){
    stopHoldCountdown();
    toast('Koltuk rezervasyon süresi doldu, lütfen tekrar seç.');
    closeSeatModal();
    return;
  }
  const totalSec = Math.ceil(remainingMs / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  holdCountdownEl.textContent = `Bu koltuk sizin için ${m}:${String(s).padStart(2, '0')} ayrıldı`;
}

function stopHoldCountdown(){
  clearInterval(holdCountdownInterval);
  holdCountdownInterval = null;
  holdExpiresAt = null;
  holdCountdownEl.hidden = true;
}

function closeSeatModal(){
  seatModalOverlay.hidden = true;
  stopHoldCountdown();
  if(modalHeldIdx !== null && currentEventId){
    supabaseClient.rpc('release_seat_hold', { p_event_id: currentEventId, p_idx: modalHeldIdx, p_token: holdToken })
      .then(({ error }) => { if(error) console.warn('Rezervasyon serbest bırakılamadı.', error.message); });
  }
  modalSeatIdx = null;
  modalSeatIndices = null;
  modalBlockSeatPos = null;
  modalGender = null;
  modalTier = null;
  modalBuyerName = '';
  modalBuyerEmail = '';
  modalDiscount = null;
  modalHeldIdx = null;
}

// ===== Futbol bloğu içinde tek tek koltuk seçimi (sinema düzeni gibi) =====
// Bir bloğa (ör. "Classic VIP 2") tıklayınca artık sadece bir adet
// seçilmiyor — o bloğun İÇİNE girilip capacity kadar numaralı koltuk
// gösteriliyor, her biri normal sinema koltuğu gibi tek tek (cinsiyet +
// alıcı + ödeme) satın alınıyor. seatStates[blockIdx]/seatSales[blockIdx]
// artık kendi başına bir dizi (bkz. blockSoldCount/purchase_stadium_seat).
let activeBlockIdx = null;
let modalBlockSeatPos = null; // block içi hangi koltuk pozisyonu satın alınıyor

function blockSeatStates(blockIdx){
  const capacity = STADIUM_BLOCKS[blockIdx].capacity;
  let arr = seatStates[blockIdx];
  if(!Array.isArray(arr)) arr = [];
  // Kapasiteye kadar pad et — göç edilmiş veri sadece o ana kadar satılmış
  // koltukları içerir (bkz. supabase-setup.sql migrasyon notu), kalanı boş.
  if(arr.length < capacity) arr = [...arr, ...new Array(capacity - arr.length).fill('e')];
  seatStates[blockIdx] = arr;
  return arr;
}
function blockSaleStates(blockIdx){
  const capacity = STADIUM_BLOCKS[blockIdx].capacity;
  let arr = seatSales[blockIdx];
  if(!Array.isArray(arr)) arr = [];
  if(arr.length < capacity) arr = [...arr, ...new Array(capacity - arr.length).fill(null)];
  seatSales[blockIdx] = arr;
  return arr;
}

function enterBlockView(blockIdx){
  activeBlockIdx = blockIdx;
  blockSeatStates(blockIdx);
  blockSaleStates(blockIdx);
  bulkSelected.clear();
  updateBulkToolbar();
  renderGrid();
}
function exitBlockView(){
  activeBlockIdx = null;
  bulkSelected.clear();
  updateBulkToolbar();
  renderGrid();
}

function renderBlockSeatGrid(){
  const block = STADIUM_BLOCKS[activeBlockIdx];
  const states = blockSeatStates(activeBlockIdx);

  seatGrid.classList.remove('general-mode', 'stadium-mode');
  seatGrid.classList.add('block-seat-mode');
  seatGrid.style.gridTemplateColumns = `repeat(${Math.max(1, Math.ceil(Math.sqrt(block.capacity)))}, auto)`;
  seatGrid.style.gridTemplateRows = '';
  seatGrid.classList.toggle('guest-mode', !canEdit());
  if(stadiumLegendEl) stadiumLegendEl.hidden = true;
  seatGrid.innerHTML = '';
  seatButtons = [];

  const backBtn = document.createElement('button');
  backBtn.type = 'button';
  backBtn.className = 'btn btn-ghost block-back-btn';
  backBtn.textContent = `← ${block.label} — Bloklara Dön`;
  backBtn.addEventListener('click', exitBlockView);
  seatGrid.appendChild(backBtn);

  states.forEach((state, pos) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    renderBlockSeatVisual(btn, pos);
    if(bulkMode && bulkSelected.has(pos)) btn.classList.add('bulk-selected');
    btn.addEventListener('click', () => handleBlockSeatClick(pos, btn));
    seatGrid.appendChild(btn);
    seatButtons.push(btn);
  });

  updateStats();
  applyFilterAndSearch();
}

function renderBlockSeatVisual(btn, pos){
  const state = blockSeatStates(activeBlockIdx)[pos] || 'e';
  const sale = blockSaleStates(activeBlockIdx)[pos];
  btn.className = ['seat', state, sale ? 'sold' : null].filter(Boolean).join(' ');
  btn.innerHTML = '';
  const num = document.createElement('span');
  num.className = 'seat-num';
  num.textContent = pos + 1;
  btn.appendChild(num);
  // labelFor(state) "Erkek/Kadın/Boş" döner ama futbol bloklarında cinsiyet
  // ayrımı yok (bkz. openBuyerPanelForBlockSeat) -- isSeatTaken ile dolu/boş
  // olarak anons ediliyor.
  btn.setAttribute('aria-label', `${STADIUM_BLOCKS[activeBlockIdx].label} - Koltuk ${pos + 1}, durum: ${isSeatTaken(state) ? 'Dolu' : 'Boş'}`);
}

function handleBlockSeatClick(pos, btn){
  if(!canPurchase()) return;

  // Klasik ızgaradaki bulkMode dalıyla aynı mantık (bkz. handleSeatClick) --
  // blok içinde de artık gerçek koltuk pozisyonları var, o yüzden grup/aile
  // bileti için toplu seçim burada da anlamlı.
  if(bulkMode){
    const state = blockSeatStates(activeBlockIdx)[pos] || 'e';
    if(isSeatTaken(state)){
      toast('Bu koltuk dolu — toplu seçim için boş koltuk seç.');
      return;
    }
    if(bulkSelected.has(pos)){
      bulkSelected.delete(pos);
      btn.classList.remove('bulk-selected');
    } else {
      bulkSelected.add(pos);
      btn.classList.add('bulk-selected');
    }
    updateBulkToolbar();
    return;
  }

  if(!requireGuestLogin()) return;
  openBlockSeatModal(pos);
}

async function openBlockSeatModal(pos){
  modalSeatIdx = null;
  modalSeatIndices = null;
  modalBlockSeatPos = pos;
  modalGender = null;
  modalTier = STADIUM_BLOCKS[activeBlockIdx].tier; // tür blok tarafından sabit
  modalBuyerName = '';
  modalBuyerEmail = '';
  modalDiscount = null;
  modalHeldIdx = null;

  const block = STADIUM_BLOCKS[activeBlockIdx];
  const state = blockSeatStates(activeBlockIdx)[pos] || 'e';
  const sale = blockSaleStates(activeBlockIdx)[pos];

  seatModalTitle.textContent = `${block.label} — Koltuk ${pos + 1}`;

  if(isSeatTaken(state) || sale){
    // Futbol bloklarında koltuklar artık cinsiyete göre değil, sadece dolu/boş
    // olarak takip ediliyor (bkz. openBuyerPanelForBlockSeat) — burada
    // "Cinsiyet: ..." satırı gösterilmiyor.
    const parts = [];
    if(sale && canEdit()) parts.push(`Bilet: ${sale.label} — ${sale.price}₺ (${paymentLabel(sale.payment) || '-'})`);
    modalInfoTextEl.textContent = parts.length ? parts.join(' · ') : 'Bu koltuk satılmış.';
    if(sale && sale.ticketCode && canEdit()){
      viewTicketBtn.hidden = false;
      viewTicketBtn.onclick = () => showTicketView(activeBlockIdx, sale, null, pos);
    } else {
      viewTicketBtn.hidden = true;
      viewTicketBtn.onclick = null;
    }
    modalClearSeatBtn.hidden = !canEdit();
    holdCountdownEl.hidden = true;
    showModalPanel('info');
    seatModalOverlay.hidden = false;
    return;
  }

  discountCodeInput.value = '';
  discountNoteText.hidden = true;
  openBuyerPanelForBlockSeat();
  seatModalOverlay.hidden = false;
}

// Futbol bloklarında koltuklar cinsiyete göre ayrılmıyor (sinema/tiyatrodan
// farklı olarak stadyum tribününde bu ayrım anlamsız) -- bu yüzden hem tekli
// hem çoklu blok koltuğu seçiminde cinsiyet paneli hiç gösterilmiyor,
// doğrudan alıcı bilgisine geçiliyor. modalGender'a hâlâ sabit bir değer
// yazılıyor çünkü seat_states/purchase_stadium_seat atomik "hâlâ boş mu"
// kontrolü için hâlâ 'e'/'empty' DIŞINDA bir değere ihtiyaç duyuyor — bu
// sadece dahili bir "dolu" işareti, kullanıcıya hiçbir yerde gösterilmiyor.
function openBuyerPanelForBlockSeat(){
  modalGender = 'male';
  buyerNameInput.value = '';
  if(buyerEmailInput) buyerEmailInput.value = verifiedEmail || '';
  buyerNoteText.textContent = currentRole === 'guest'
    ? 'Biletin bu isimle düzenlenecek.'
    : 'Opsiyonel — boş bırakılabilir.';
  showModalPanel('buyer');
  buyerNameInput.focus();
}

// Bloğun tamamı bir kapasite havuzu olduğu için reserve_seat/hold burada
// tutulmuyor — misafirin/personelin gerçekten bu koltuğu alıp almadığı
// purchase_stadium_seat RPC'sindeki atomik "hâlâ boş mu" kontrolüyle karar veriliyor.
async function finalizeBlockSeatPurchase(payment){
  const pos = modalBlockSeatPos;
  if(pos === null || activeBlockIdx === null) return;

  const tier = TICKET_TIERS.find(t => t.id === modalTier);
  if(!tier) return;
  const sale = buildSaleRecord(tier, payment);
  const blockIdx = activeBlockIdx;

  if(currentRole !== 'guest'){
    blockSeatStates(blockIdx)[pos] = modalGender;
    blockSaleStates(blockIdx)[pos] = sale;
    if(seatButtons[pos]) renderBlockSeatVisual(seatButtons[pos], pos);
    updateStats();
    pushSeatStates();
    pushSalesData();
    closeSeatModal();
    toast('Koltuk kaydedildi.');
    showTicketView(blockIdx, sale, null, pos);
    return;
  }

  if(!currentEventId) return;
  if(!legalConsentRow.hidden && !legalConsentCheckbox.checked){
    toast('Devam etmek için sözleşmeyi onaylaman gerekiyor.');
    return;
  }

  try {
    const { error } = await supabaseClient.rpc('purchase_stadium_seat', {
      p_event_id: currentEventId,
      p_block_idx: blockIdx,
      p_seat_pos: pos,
      p_gender: SEAT_STATE_SHORT[modalGender] || modalGender,
      p_sale: sale,
      p_token: holdToken,
    });
    if(error) throw error;

    blockSeatStates(blockIdx)[pos] = modalGender;
    blockSaleStates(blockIdx)[pos] = sale;
    if(seatButtons[pos]) renderBlockSeatVisual(seatButtons[pos], pos);
    updateStats();

    saveMyTicketLocally(currentEventNameBadge.textContent || '', `${STADIUM_BLOCKS[blockIdx].label} — Koltuk ${pos + 1}`, sale.ticketCode);
    closeSeatModal();
    showTicketView(blockIdx, sale, null, pos);
  } catch(err){
    console.warn('Koltuk satın alınamadı.', err);
    const msg = (err && err.message) || '';
    toast(msg.includes('SEAT_UNAVAILABLE')
      ? 'Üzgünüz, bu koltuk az önce başkası tarafından alındı.'
      : msg.includes('SEAT_HELD')
        ? 'Bu koltuk şu anda başka biri tarafından işleniyor, birazdan tekrar dene.'
        : 'Satın alma başarısız — buluta bağlanılamadı.');
    closeSeatModal();
  }
}

// Blok içinde ÇOKLU koltuk seçimiyle satın alma — grup/aile bileti için
// (finalizeGuestBulkPurchase'in blok-içi karşılığı). Tür zaten blok
// tarafından sabit. Misafir akışında her koltuk kendi purchase_stadium_seat
// çağrısıyla ayrı ayrı, atomik olarak alınır — biri araya girip başkası
// tarafından alınmışsa sadece o koltuk başarısız olur, diğerleri etkilenmez.
async function finalizeBlockBulkPurchase(payment){
  const positions = modalSeatIndices ? [...modalSeatIndices] : [];
  if(!positions.length || activeBlockIdx === null) return;

  const tier = TICKET_TIERS.find(t => t.id === modalTier);
  if(!tier) return;
  const blockIdx = activeBlockIdx;

  if(currentRole !== 'guest'){
    positions.forEach(pos => {
      const sale = buildSaleRecord(tier, payment);
      blockSeatStates(blockIdx)[pos] = modalGender;
      blockSaleStates(blockIdx)[pos] = sale;
      if(seatButtons[pos]) renderBlockSeatVisual(seatButtons[pos], pos);
    });
    updateStats();
    pushSeatStates();
    pushSalesData();
    bulkSelected.clear();
    updateBulkToolbar();
    setBulkMode(false);
    closeSeatModal();
    toast(`${positions.length} koltuk kaydedildi.`);
    return;
  }

  if(!currentEventId) return;
  if(!legalConsentRow.hidden && !legalConsentCheckbox.checked){
    toast('Devam etmek için sözleşmeyi onaylaman gerekiyor.');
    return;
  }

  const basarili = [];
  let basarisizSayisi = 0;

  for(const pos of positions){
    const sale = buildSaleRecord(tier, payment);
    try {
      const { error } = await supabaseClient.rpc('purchase_stadium_seat', {
        p_event_id: currentEventId,
        p_block_idx: blockIdx,
        p_seat_pos: pos,
        p_gender: SEAT_STATE_SHORT[modalGender] || modalGender,
        p_sale: sale,
        p_token: holdToken,
      });
      if(error) throw error;

      blockSeatStates(blockIdx)[pos] = modalGender;
      blockSaleStates(blockIdx)[pos] = sale;
      if(seatButtons[pos]) renderBlockSeatVisual(seatButtons[pos], pos);
      saveMyTicketLocally(currentEventNameBadge.textContent || '', `${STADIUM_BLOCKS[blockIdx].label} — Koltuk ${pos + 1}`, sale.ticketCode);
      basarili.push({ pos, sale });
    } catch(err){
      console.warn(`Koltuk ${pos} satın alınamadı.`, err);
      basarisizSayisi++;
    }
  }

  updateStats();
  bulkSelected.clear();
  updateBulkToolbar();
  setBulkMode(false);
  closeSeatModal();

  if(!basarili.length){
    toast('Üzgünüz, seçtiğin koltukların hepsi az önce başkası tarafından alındı.');
    return;
  }
  toast(basarisizSayisi
    ? `${basarili.length} bilet oluşturuldu, ${basarisizSayisi} koltuk az önce başkası tarafından alındı.`
    : `${basarili.length} bilet oluşturuldu — "Biletim Var" listenden görebilirsin.`);
  showTicketView(blockIdx, basarili[0].sale, null, basarili[0].pos);
}

// Genel Etkinlik: ücretsiz/biletsiz tek giriş havuzu — fiyat/bilet türü,
// alıcı bilgisi, ödeme yöntemi, QR/bilet kodu YOK. Tek tıkla katılım,
// kapasite kontrolü purchase_stadium_block RPC'sinde atomik yapılıyor
// (p_sales boş dizi geçiliyor — kişisel bir kayıt tutulmuyor, sadece sayaç
// artıyor). Modal hiç açılmıyor, doğrudan confirm() ile onay alınıyor.
async function joinGeneralEvent(){
  const block = poolBlocks()[0];
  const sold = blockSoldCount(0);
  const remaining = block.capacity - sold;

  if(remaining <= 0){
    toast('Bu etkinlik dolu.');
    return;
  }
  if(!confirm(`${sold}/${block.capacity} katıldı — ${remaining} yer kaldı. Katılmak istiyor musun?`)) return;

  if(currentRole !== 'guest'){
    seatStates[0] = sold + 1;
    if(seatButtons[0]) renderSeatVisual(seatButtons[0], 0);
    updateStats();
    pushSeatStates();
    toast('Katılım kaydedildi.');
    return;
  }

  if(!currentEventId) return;
  try {
    const { error } = await supabaseClient.rpc('purchase_stadium_block', {
      p_event_id: currentEventId, p_idx: 0, p_quantity: 1, p_capacity: block.capacity, p_sales: [], p_token: holdToken,
    });
    if(error) throw error;

    seatStates[0] = sold + 1;
    if(seatButtons[0]) renderSeatVisual(seatButtons[0], 0);
    updateStats();
    toast('Katılımın kaydedildi!');
  } catch(err){
    console.warn('Katılım kaydedilemedi.', err);
    const msg = (err && err.message) || '';
    toast(msg.includes('CAPACITY_EXCEEDED') ? 'Üzgünüz, etkinlik az önce doldu.' : 'Katılım kaydedilemedi — buluta bağlanılamadı.');
  }
}

document.querySelectorAll('.modal-step-panel[data-panel="gender"] [data-gender]').forEach(btn => {
  btn.addEventListener('click', () => {
    // Bu panel artık sadece klasik/Genel Etkinlik akışında görünüyor -- futbol
    // blok koltuklarında cinsiyet ayrımı yok, gösterilmiyor (bkz.
    // openBuyerPanelForBlockSeat) -- bu yüzden burası hep tür paneline geçer.
    modalGender = btn.dataset.gender;

    const targets = modalSeatIndices && modalSeatIndices.length ? modalSeatIndices : [modalSeatIdx];
    const conflicts = targets.filter(i => findAdjacencyConflict(i, modalGender)).length;
    if(conflicts === 1) toast('Uyarı: yan koltukta farklı cinsiyet var.');
    else if(conflicts > 1) toast(`Uyarı: ${conflicts} koltukta yan yana farklı cinsiyet var.`);

    showModalPanel('tier');
  });
});

function updatePaymentButtonsEnabled(){
  const needsConsent = !legalConsentRow.hidden;
  const enabled = !needsConsent || legalConsentCheckbox.checked;
  paymentChoiceButtons.forEach(btn => { btn.disabled = !enabled; });
}

buyerContinueBtn.addEventListener('click', () => {
  const name = buyerNameInput.value.trim();
  if(currentRole === 'guest' && !name){
    toast('Lütfen ad soyad gir.');
    return;
  }
  modalBuyerName = name;
  modalBuyerEmail = (buyerEmailInput?.value || '').trim();
  const isGuest = currentRole === 'guest';
  paymentDisclaimerEl.hidden = !isGuest;
  legalConsentRow.hidden = !isGuest;
  legalConsentCheckbox.checked = false;
  discountCodeInput.value = '';
  discountNoteText.hidden = true;
  modalDiscount = null;
  updatePriceSummary();
  updatePaymentButtonsEnabled();
  showModalPanel('payment');
});
legalConsentCheckbox.addEventListener('change', updatePaymentButtonsEnabled);
buyerNameInput.addEventListener('keydown', (e) => {
  if(e.key === 'Enter'){ e.preventDefault(); buyerContinueBtn.click(); }
});

// İndirim kodu: redeem_discount_code() atomik olarak kullanım sayacını
// artırıyor (kod geçersiz/limiti dolmuşsa hata döner) — bu yüzden gerçek
// satın alma tamamlanmasa bile hakkı harcanmış olabilir; hobi ölçekli bir
// uygulama için kabul edilebilir bir sınırlama olarak not düşüldü.
applyDiscountBtn.addEventListener('click', async () => {
  const code = discountCodeInput.value.trim();
  if(!code || !currentEventId) return;

  applyDiscountBtn.disabled = true;
  try {
    const { data, error } = await supabaseClient.rpc('redeem_discount_code', { p_event_id: currentEventId, p_code: code });
    if(error) throw error;

    modalDiscount = { code: data.code, type: data.type, value: Number(data.value) };
    discountNoteText.className = 'discount-note ok';
    discountNoteText.textContent = `"${data.code}" kodu uygulandı.`;
    discountNoteText.hidden = false;
    updatePriceSummary();
  } catch(err){
    const msg = (err && err.message) || '';
    discountNoteText.className = 'discount-note error';
    discountNoteText.textContent = msg.includes('CODE_EXHAUSTED')
      ? 'Bu kodun kullanım limiti doldu.'
      : msg.includes('CODE_NOT_FOUND')
        ? 'Kod bulunamadı.'
        : 'Kod uygulanamadı.';
    discountNoteText.hidden = false;
  } finally {
    applyDiscountBtn.disabled = false;
  }
});

function computeDiscountedPrice(price, discount){
  if(!discount) return price;
  const raw = discount.type === 'percent' ? price - (price * discount.value / 100) : price - discount.value;
  return Math.max(0, Math.round(raw));
}

function updatePriceSummary(){
  const tier = TICKET_TIERS.find(t => t.id === modalTier);
  if(!tier){ priceSummaryText.textContent = ''; return; }

  const surged = effectiveTierPrice(tier);          // önce yoğun talep zammı
  const finalPrice = computeDiscountedPrice(surged, modalDiscount); // sonra indirim
  const surgeApplied = surged !== tier.price;

  const prefix = `${tier.label}: `;
  const suffix = '';

  let text = prefix;
  if(surgeApplied && modalDiscount){
    text += `${tier.price}₺ → ${surged}₺ (yoğun talep) → ${finalPrice}₺ (kod: ${modalDiscount.code})${suffix}`;
  } else if(surgeApplied){
    text += `${tier.price}₺ → ${surged}₺ (yoğun talep)${suffix}`;
  } else if(modalDiscount){
    text += `${tier.price}₺ → ${finalPrice}₺ (kod: ${modalDiscount.code})${suffix}`;
  } else {
    text += `${tier.price}₺${suffix}`;
  }
  priceSummaryText.textContent = text;
}

document.querySelectorAll('.modal-step-panel[data-panel="payment"] [data-payment]').forEach(btn => {
  btn.addEventListener('click', () => {
    if(modalBlockSeatPos !== null){
      finalizeBlockSeatPurchase(btn.dataset.payment);
    } else if(activeBlockIdx !== null && modalSeatIndices && modalSeatIndices.length){
      finalizeBlockBulkPurchase(btn.dataset.payment);
    } else if(currentRole === 'guest'){
      (modalSeatIndices && modalSeatIndices.length > 1)
        ? finalizeGuestBulkPurchase(btn.dataset.payment)
        : finalizeGuestPurchase(btn.dataset.payment);
    } else {
      finalizeSeatSale(btn.dataset.payment);
    }
  });
});

// Optimizasyon notu: bu kayıt event_sales'in içinde saklanıyor ve Realtime
// bir satır her değiştiğinde TÜM diziyi tekrar yayınlıyor (bkz. websocket
// veri akışı notu) — bu yüzden alan sayısı/boyutu bir etkinlikteki satış
// sayısıyla çarpılarak büyüyor. originalPrice/discountCode/surged/buyerName
// çoğu satışta boş/varsayılan kalıyor; hep null/false yazmak yerine sadece
// geçerliyken ekleniyor (okuyan taraflar zaten hepsi truthy kontrolü yapıyor,
// undefined ile null/false arasında fark yok). checkedIn de aynı sebeple hiç
// yazılmıyor — SQL tarafı da (coalesce(...,false)) zaten "yoksa false" kabul
// ediyor. payment "kart"/"nakit" yerine "k"/"n" (seat_states'teki e/m/f
// kısaltmasıyla aynı fikir).
function buildSaleRecord(tier, payment){
  const surged = effectiveTierPrice(tier);
  const finalPrice = computeDiscountedPrice(surged, modalDiscount);
  const changed = finalPrice !== tier.price;
  const sale = {
    tier: tier.id, label: tier.label, price: finalPrice,
    payment: PAYMENT_SHORT[payment] || payment,
    soldAt: new Date().toISOString(),   // satış grafiği bunu kullanıyor
    ticketCode: generateTicketCode(),
  };
  if(changed) sale.originalPrice = tier.price;
  if(modalDiscount) sale.discountCode = modalDiscount.code;
  if(surged !== tier.price) sale.surged = true;
  if(modalBuyerName) sale.buyerName = modalBuyerName;
  if(modalBuyerEmail) sale.buyerEmail = modalBuyerEmail;
  return sale;
}

// Personel akışı (tekli veya toplu) — mevcut tüm-diziyi-yeniden-yazan push
// mekanizmasını kullanır; personel zaten güncel diziyi çektiği için güvenli.
function finalizeSeatSale(payment){
  const targets = modalSeatIndices && modalSeatIndices.length
    ? modalSeatIndices
    : (modalSeatIdx !== null ? [modalSeatIdx] : []);
  if(!targets.length) return;

  const tier = TICKET_TIERS.find(t => t.id === modalTier);
  let singleSale = null;
  targets.forEach(idx => {
    seatStates[idx] = modalGender;
    const sale = tier ? buildSaleRecord(tier, payment) : null;
    seatSales[idx] = sale;
    if(targets.length === 1) singleSale = sale;
    if(seatButtons[idx]) renderSeatVisual(seatButtons[idx], idx);
  });

  updateStats();
  pushSeatStates();
  pushSalesData();

  const wasBulk = targets.length > 1;
  const singleIdx = targets.length === 1 ? targets[0] : null;
  closeSeatModal();

  if(wasBulk){
    bulkSelected.clear();
    updateBulkToolbar();
    setBulkMode(false);
    toast(`${targets.length} koltuk kaydedildi.`);
  } else {
    toast('Koltuk kaydedildi.');
    if(singleIdx !== null && singleSale) showTicketView(singleIdx, singleSale);
  }
}

// Misafir akışı — tüm diziyi tekrar yazmak yerine atomik purchase_seat()
// RPC'sini kullanır: misafirin tarayıcısı diğer koltukların/satışların
// güncel bir kopyasına sahip DEĞİL, o yüzden tüm-diziyi-yeniden-yazan push
// burada kullanılırsa başkalarının verisini ezebilirdi. RPC sadece kendi
// index'ini günceller ve koltuk hâlâ boşsa diye atomik kontrol yapar.
async function finalizeGuestPurchase(payment){
  const idx = modalSeatIdx;
  if(idx === null || !currentEventId) return;

  if(!legalConsentRow.hidden && !legalConsentCheckbox.checked){
    toast('Devam etmek için sözleşmeyi onaylaman gerekiyor.');
    return;
  }

  const tier = TICKET_TIERS.find(t => t.id === modalTier);
  if(!tier) return;

  const sale = buildSaleRecord(tier, payment);

  try {
    const { error } = await supabaseClient.rpc('purchase_seat', {
      p_event_id: currentEventId,
      p_idx: idx,
      p_gender: SEAT_STATE_SHORT[modalGender] || modalGender,
      p_sale: sale,
      p_token: holdToken,
    });
    if(error) throw error;

    seatStates[idx] = modalGender;
    seatSales[idx] = sale;
    if(seatButtons[idx]) renderSeatVisual(seatButtons[idx], idx);
    updateStats();

    modalHeldIdx = null; // purchase_seat hold'u zaten sildi — closeSeatModal tekrar denemesin
    saveMyTicketLocally(currentEventNameBadge.textContent || '', seatLabelFor(idx), sale.ticketCode);
    closeSeatModal();
    showTicketView(idx, sale);
  } catch(err){
    console.warn('Satın alma başarısız.', err);
    const msg = (err && err.message) || '';
    toast(msg.includes('SEAT_HELD')
      ? 'Rezervasyon süresi doldu, koltuk artık uygun değil.'
      : msg.includes('SEAT_UNAVAILABLE')
        ? 'Üzgünüz, bu koltuk az önce başkası tarafından alındı.'
        : 'Satın alma başarısız — buluta bağlanılamadı.');
    closeSeatModal();
  }
}

// Misafirin çoklu koltuk seçip tek akışta (bir isim + bir ödeme yöntemi)
// satın alması — grup/aile bileti için. Tek koltuklu misafir akışı gibi
// tüm-diziyi-yeniden-yazan push YERİNE her koltuk için ayrı ayrı atomik
// purchase_seat() çağrılır (önceden reserve_seat ile TUTULMADAN — RPC'nin
// kendisi zaten "hâlâ boşsa" kontrolünü atomik yapıyor, bkz. supabase-setup.sql).
// Bu yüzden N koltuktan biri araya girip başkası tarafından alınmışsa sadece
// o koltuk başarısız olur, diğerleri etkilenmez.
async function finalizeGuestBulkPurchase(payment){
  const targets = modalSeatIndices ? [...modalSeatIndices] : [];
  if(!targets.length || !currentEventId) return;

  if(!legalConsentRow.hidden && !legalConsentCheckbox.checked){
    toast('Devam etmek için sözleşmeyi onaylaman gerekiyor.');
    return;
  }

  const tier = TICKET_TIERS.find(t => t.id === modalTier);
  if(!tier) return;

  const basarili = [];
  let basarisizSayisi = 0;

  for(const idx of targets){
    const sale = buildSaleRecord(tier, payment);
    try {
      const { error } = await supabaseClient.rpc('purchase_seat', {
        p_event_id: currentEventId,
        p_idx: idx,
        p_gender: SEAT_STATE_SHORT[modalGender] || modalGender,
        p_sale: sale,
        p_token: holdToken,
      });
      if(error) throw error;

      seatStates[idx] = modalGender;
      seatSales[idx] = sale;
      if(seatButtons[idx]) renderSeatVisual(seatButtons[idx], idx);
      saveMyTicketLocally(currentEventNameBadge.textContent || '', seatLabelFor(idx), sale.ticketCode);
      basarili.push({ idx, sale });
    } catch(err){
      console.warn(`Koltuk ${idx} satın alınamadı.`, err);
      basarisizSayisi++;
    }
  }

  updateStats();
  bulkSelected.clear();
  updateBulkToolbar();
  setBulkMode(false);
  closeSeatModal();

  if(!basarili.length){
    toast('Üzgünüz, seçtiğin koltukların hepsi az önce başkası tarafından alındı.');
    return;
  }
  toast(basarisizSayisi
    ? `${basarili.length} bilet oluşturuldu, ${basarisizSayisi} koltuk az önce başkası tarafından alındı.`
    : `${basarili.length} bilet oluşturuldu — "Biletim Var" listenden görebilirsin.`);
  showTicketView(basarili[0].idx, basarili[0].sale);
}

modalClearSeatBtn.addEventListener('click', () => {
  if(modalBlockSeatPos !== null && activeBlockIdx !== null){
    const pos = modalBlockSeatPos;
    const blockIdx = activeBlockIdx;
    blockSeatStates(blockIdx)[pos] = 'e';
    blockSaleStates(blockIdx)[pos] = null;
    if(seatButtons[pos]) renderBlockSeatVisual(seatButtons[pos], pos);
    updateStats();
    pushSeatStates();
    pushSalesData();
    closeSeatModal();
    toast('Koltuk boşaltıldı.');
    return;
  }
  const idx = modalSeatIdx;
  if(idx === null) return;
  seatStates[idx] = 'empty';
  seatSales[idx] = null;
  if(seatButtons[idx]) renderSeatVisual(seatButtons[idx], idx);
  updateStats();
  pushSeatStates();
  pushSalesData();
  closeSeatModal();
  toast('Koltuk boşaltıldı.');
});

seatModalClose.addEventListener('click', closeSeatModal);
seatModalOverlay.addEventListener('click', (e) => { if(e.target === seatModalOverlay) closeSeatModal(); });

// ===== Ticket view (QR + bilet kodu) =====

// eventInfo verilirse (Biletlerim aramasından — farklı/aktif olmayan bir
// etkinlik için) o bilgiler kullanılır; verilmezse şu an içinde bulunulan
// etkinliğin global durumu (currentEventNameBadge, cols, venueType) kullanılır.
function computeSeatLabelFor(idx, eventInfo, seatPos){
  if(!eventInfo){
    // seatPos verilmişse idx bir blok index'idir ve seatPos o blok içindeki
    // koltuk pozisyonu (bkz. finalizeBlockSeatPurchase/openBlockSeatModal) —
    // activeBlockIdx gibi ambient bir duruma güvenmiyoruz çünkü aynı
    // seatLabelFor(idx) çağrısı verifyTicket() içinde farklı bir anlamda
    // (idx = blok index'i, blok görünümünde olup olmamaktan bağımsız) kullanılıyor.
    if(seatPos !== null && seatPos !== undefined){
      const block = STADIUM_BLOCKS[idx];
      return `${block ? block.label : idx} — Koltuk ${seatPos + 1}`;
    }
    return seatLabelFor(idx);
  }
  if(eventInfo.venue_type === 'futbol'){
    const block = STADIUM_BLOCKS[idx];
    const blockLabel = block ? block.label : idx;
    // seatPos varsa (bkz. find_ticket_by_code/find_tickets_by_email'in
    // seat_pos kolonu) blok içindeki tekil koltuğu gösterir; yoksa (eski
    // havuz modeli) sadece blok adı gösterilir.
    return (seatPos !== null && seatPos !== undefined)
      ? `${blockLabel} — Koltuk ${seatPos + 1}`
      : `${blockLabel} Bloğu`;
  }
  // Genel Etkinlik'te bilet/QR hiç yok (bkz. joinGeneralEvent), bu yüzden
  // "Biletim Var" araması oraya hiçbir zaman bir kayıt bulamaz — ayrı bir
  // dal gerekmiyor.
  const c = eventInfo.cols || 1;
  const r = Math.floor(idx / c) + 1;
  const col = (idx % c) + 1;
  return `Koltuk ${r}-${col}`;
}

// "Biletim Var" akışından açılan biletlerde iptal butonu gösterilir; burada
// tutuyoruz ki iptal RPC'si hangi etkinlik/koltuk olduğunu bilsin.
let ticketCancelContext = null;

function showTicketView(idx, sale, eventInfo, seatPos){
  document.getElementById('ticketEventName').textContent = eventInfo ? eventInfo.name : (currentEventNameBadge.textContent || '');
  // eventInfo verilmişse (Biletim Var akışı) o etkinliğin kendi listesine
  // bak — ACCESSIBLE_SEATS o an ekranda açık olan BAŞKA bir etkinliğe ait
  // olabilir, index eşleşmesi yanlış koltuğu işaretli gösterebilirdi.
  const accessibleList = eventInfo ? (Array.isArray(eventInfo.accessible_seats) ? eventInfo.accessible_seats : []) : [...ACCESSIBLE_SEATS];
  const isAccessible = accessibleList.includes(idx);
  document.getElementById('ticketSeatLabel').textContent = computeSeatLabelFor(idx, eventInfo, seatPos) + (isAccessible ? ' ♿' : '');
  // Fiyat liste fiyatından farklıysa sebebini de yaz — zam mı, indirim mi,
  // ikisi birden mi. (Eskiden indirim kodu yokken bile "kod: null" yazıyordu.)
  const odeme = paymentLabel(sale.payment) || '-';
  let priceText;
  if(sale.originalPrice){
    const sebep = [
      sale.surged ? 'yoğun talep' : null,
      sale.discountCode ? `kod: ${sale.discountCode}` : null,
    ].filter(Boolean).join(' + ');
    priceText = `${sale.label} — ${sale.originalPrice}₺ → ${sale.price}₺`
      + (sebep ? ` (${sebep})` : '') + ` — ${odeme}`;
  } else {
    priceText = `${sale.label} — ${sale.price}₺ (${odeme})`;
  }
  document.getElementById('ticketTierLabel').textContent = priceText;

  const buyerEl = document.getElementById('ticketBuyerName');
  if(sale.buyerName){
    buyerEl.textContent = `Alıcı: ${sale.buyerName}`;
    buyerEl.hidden = false;
  } else {
    buyerEl.hidden = true;
  }

  document.getElementById('ticketCodeText').textContent = sale.ticketCode || '';
  document.getElementById('ticketCheckinStatus').textContent = sale.checkedIn
    ? 'Giriş yapıldı'
    : 'Henüz giriş yapılmadı';

  const qrHolder = document.getElementById('ticketQrHolder');
  qrHolder.innerHTML = '';
  if(sale.ticketCode && typeof qrcode === 'function'){
    try {
      const qr = qrcode(0, 'M');
      qr.addData(sale.ticketCode);
      qr.make();
      qrHolder.innerHTML = qr.createSvgTag({ cellSize: 5, margin: 4 });
    } catch(err){
      qrHolder.textContent = sale.ticketCode;
    }
  }

  // İptal butonu sadece "Biletim Var" akışında (ticketCancelContext dolu) ve
  // henüz kapıdan giriş yapılmamış biletlerde görünür.
  const iptalEdilebilir = !!ticketCancelContext && !sale.checkedIn;
  ticketCancelBtn.hidden = !iptalEdilebilir;

  ticketViewOverlay.hidden = false;
}

function closeTicketView(){
  ticketViewOverlay.hidden = true;
  ticketCancelContext = null;
  ticketCancelBtn.hidden = true;
}
ticketViewClose.addEventListener('click', closeTicketView);
ticketCloseBtn.addEventListener('click', closeTicketView);
ticketViewOverlay.addEventListener('click', (e) => { if(e.target === ticketViewOverlay) closeTicketView(); });
ticketPrintBtn.addEventListener('click', () => window.print());

// ===== Bilet iptali (müşterinin kendi bileti) =====
// Yetki bilet kodunun kendisi: cancel_ticket RPC'si koda bakıyor, eşleşmezse
// iptal etmiyor. Kapıdan giriş yapılmış bilet iptal edilemez (SQL de kontrol
// ediyor — buradaki gizleme sadece arayüz kolaylığı).

const ticketCancelBtn = document.getElementById('ticketCancelBtn');

ticketCancelBtn.addEventListener('click', async () => {
  if(!ticketCancelContext || !supabaseClient) return;
  const { eventId, idx, ticketCode, venueType: ticketVenueType, seatPos } = ticketCancelContext;
  if(!confirm('Bu bilet iptal edilecek ve koltuk tekrar satışa açılacak. Emin misin?')) return;

  ticketCancelBtn.disabled = true;
  try {
    // seatPos varsa futbol bloğu içinde tekil koltuk takibi yapılıyor demektir
    // (bkz. purchase_stadium_seat) — o koltuk cancel_stadium_seat ile boşa
    // düşürülür. seatPos yoksa eski havuz modeli (cancel_stadium_ticket, sadece
    // sayaç azaltır) veya klasik tekil koltuk (cancel_ticket) devrede.
    const { error } = (ticketVenueType === 'futbol' && seatPos !== null && seatPos !== undefined)
      ? await supabaseClient.rpc('cancel_stadium_seat', {
          p_event_id: eventId, p_block_idx: idx, p_seat_pos: seatPos, p_ticket_code: ticketCode,
        })
      : ticketVenueType === 'futbol'
        ? await supabaseClient.rpc('cancel_stadium_ticket', {
            p_event_id: eventId, p_idx: idx, p_ticket_code: ticketCode,
          })
        : await supabaseClient.rpc('cancel_ticket', {
            p_event_id: eventId, p_idx: idx, p_ticket_code: ticketCode,
          });
    if(error) throw error;

    forgetMyTicketLocally(ticketCode);
    closeTicketView();
    toast('Bilet iptal edildi.');
  } catch(err){
    console.warn('Bilet iptal edilemedi.', err);
    const msg = (err && err.message) || '';
    toast(msg.includes('ALREADY_CHECKED_IN')
      ? 'Bu bilet kapıdan giriş yapmış, iptal edilemez.'
      : msg.includes('TICKET_NOT_FOUND')
        ? 'Bilet bulunamadı.'
        : 'İptal başarısız — buluta bağlanılamadı.');
  } finally {
    ticketCancelBtn.disabled = false;
  }
});

// ===== Check-in (bilet doğrula) — geçerli etkinliğin belleğe çekilmiş
// satışları içinde kod arar; sadece Satış/Yönetici erişebilir (editor-only). =====

function openCheckinModal(){
  if(!canEdit()) return; // buton CSS ile de gizli (.editor-only) — JS'te ek kontrol
  checkinCodeInput.value = '';
  checkinResultEl.hidden = true;
  scannerNote.hidden = true;
  checkinOverlay.hidden = false;
  checkinCodeInput.focus();
}
function closeCheckinModal(){
  stopScanner();   // modal kapanınca kamera mutlaka bırakılmalı
  checkinOverlay.hidden = true;
}

// ===== Kamerayla QR okuma =====
// BarcodeDetector desteklenmiyorsa veya kamera izni yoksa sessizce elle
// giriş yedeğine düşüyoruz — check-in her koşulda yapılabilir kalmalı.

let scanStream = null;
let scanTimer = null;
let scanning = false;

function showScannerNote(msg){
  scannerNote.textContent = msg;
  scannerNote.hidden = false;
}

async function startScanner(){
  scannerNote.hidden = true;

  if(typeof window.BarcodeDetector === 'undefined'){
    showScannerNote('Bu tarayıcı kamerayla QR okumayı desteklemiyor (Chrome/Edge veya Android önerilir). Kodu elle girebilirsin.');
    return;
  }
  if(!navigator.mediaDevices?.getUserMedia){
    showScannerNote('Kameraya erişilemiyor — sayfanın https üzerinden açıldığından emin ol.');
    return;
  }

  try {
    scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
  } catch(err){
    showScannerNote(err && err.name === 'NotAllowedError'
      ? 'Kamera izni verilmedi. Tarayıcı ayarlarından izin verip tekrar dene.'
      : 'Kamera açılamadı.');
    return;
  }

  scannerVideo.srcObject = scanStream;
  await scannerVideo.play().catch(() => {});
  scannerBox.hidden = false;
  checkinScanBtn.hidden = true;
  showScannerNote('QR kodu kameraya gösterin.');

  const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
  scanning = true;

  const tick = async () => {
    if(!scanning) return;
    try {
      const codes = await detector.detect(scannerVideo);
      const value = codes && codes.length ? String(codes[0].rawValue || '').trim() : '';
      if(value){
        checkinCodeInput.value = value;
        stopScanner();
        verifyTicket();
        return;
      }
    } catch { /* bu kare okunamadı, sonrakinde devam */ }
    scanTimer = setTimeout(tick, 250);
  };
  tick();
}

function stopScanner(){
  scanning = false;
  clearTimeout(scanTimer);
  scanTimer = null;
  if(scanStream){
    scanStream.getTracks().forEach(t => t.stop());
    scanStream = null;
  }
  scannerVideo.srcObject = null;
  scannerBox.hidden = true;
  checkinScanBtn.hidden = false;
}

checkinScanBtn.addEventListener('click', startScanner);
scannerStopBtn.addEventListener('click', () => { stopScanner(); scannerNote.hidden = true; });

function showCheckinResult(kind, text){
  checkinResultEl.className = `checkin-result ${kind}`;
  checkinResultEl.textContent = text;
  checkinResultEl.hidden = false;
}

function verifyTicket(){
  const code = checkinCodeInput.value.trim();
  if(!code) return;

  // salesAt() her idx'i her zaman dizi olarak döner (futbolda gerçek bir
  // dizi, diğer venue türlerinde tekil kaydı [kayit] olarak sarar) — bu
  // yüzden tek bir arama koduyla her iki veri şeklinde de çalışır.
  let idx = -1, sale = null;
  for(let i = 0; i < seatSales.length; i++){
    const found = salesAt(i).find(s => s.ticketCode === code);
    if(found){ idx = i; sale = found; break; }
  }
  if(idx === -1){
    showCheckinResult('error', 'Bilet bulunamadı.');
    return;
  }

  const seatLabel = seatLabelFor(idx);

  if(sale.checkedIn){
    showCheckinResult('warn', `Bu bilet zaten kullanılmış! (${seatLabel} — ${sale.label})`);
    return;
  }

  sale.checkedIn = true;
  if(seatButtons[idx]) renderSeatVisual(seatButtons[idx], idx);
  pushSalesData();
  showCheckinResult('ok', `Giriş onaylandı: ${seatLabel} — ${sale.label}${sale.buyerName ? ' — ' + sale.buyerName : ''}`);
}

openCheckinBtn.addEventListener('click', openCheckinModal);
checkinClose.addEventListener('click', closeCheckinModal);
checkinOverlay.addEventListener('click', (e) => { if(e.target === checkinOverlay) closeCheckinModal(); });
checkinVerifyBtn.addEventListener('click', verifyTicket);
checkinCodeInput.addEventListener('keydown', (e) => { if(e.key === 'Enter'){ e.preventDefault(); verifyTicket(); } });

// ===== Biletim Var — misafirin kendi biletini bilet koduyla bulması =====
// Etkinlik listesindeki herkese açık ekrandan erişilir; kod bilinmeden bir
// eşleşme bulunamaz (36^13'e yakın bir uzayda), bu yüzden başkasının
// biletini "gözden geçirme" riski yok — bkz. README'deki bilet kodu notu.

const MY_TICKETS_KEY = 'koltukYerlesim.myTickets';

function saveMyTicketLocally(eventName, seatLabel, ticketCode){
  try {
    const list = JSON.parse(localStorage.getItem(MY_TICKETS_KEY) || '[]');
    list.unshift({ eventName, seatLabel, ticketCode });
    localStorage.setItem(MY_TICKETS_KEY, JSON.stringify(list.slice(0, 20)));
  } catch { /* localStorage kapalı/dolu olabilir — sessizce atla */ }
}

function forgetMyTicketLocally(ticketCode){
  try {
    const list = JSON.parse(localStorage.getItem(MY_TICKETS_KEY) || '[]');
    localStorage.setItem(MY_TICKETS_KEY, JSON.stringify(list.filter(t => t.ticketCode !== ticketCode)));
  } catch { /* localStorage kapalı olabilir — sessizce atla */ }
}

function renderMyTicketHistory(){
  let list = [];
  try { list = JSON.parse(localStorage.getItem(MY_TICKETS_KEY) || '[]'); } catch { /* yoksay */ }

  const historyEl = document.getElementById('myTicketHistory');
  const listEl = document.getElementById('myTicketHistoryList');
  if(!list.length){ historyEl.hidden = true; return; }

  historyEl.hidden = false;
  listEl.innerHTML = '';
  list.forEach(item => {
    const row = document.createElement('div');
    row.className = 'my-ticket-history-item';

    const nameEl = document.createElement('span');
    nameEl.className = 'hist-event';
    nameEl.textContent = item.eventName;

    const seatEl = document.createElement('span');
    seatEl.className = 'hist-seat';
    seatEl.textContent = item.seatLabel;

    row.appendChild(nameEl);
    row.appendChild(seatEl);
    row.addEventListener('click', () => {
      myTicketCodeInput.value = item.ticketCode;
      findMyTicket();
    });
    listEl.appendChild(row);
  });
}

function openMyTicketModal(){
  myTicketCodeInput.value = '';
  myTicketResultEl.hidden = true;
  renderMyTicketHistory();
  myTicketOverlay.hidden = false;
  myTicketCodeInput.focus();
}
function closeMyTicketModal(){
  myTicketOverlay.hidden = true;
}

// Eskiden client TÜM event_sales tablosunu (her etkinliğin bütün satış
// dizisini) indirip kendi tarayıcısında arıyordu — hem gereksiz ağır bir
// veri transferiydi hem de (güvenlik denetimi sonrası event_sales artık
// sadece personele açık olduğu için) misafir için zaten çalışmazdı. Arama
// artık sunucuda (find_ticket_by_code RPC) yapılıyor, sadece eşleşen tek
// bilet dönüyor.
async function findMyTicket(){
  const code = myTicketCodeInput.value.trim();
  if(!code || !supabaseClient) return;

  myTicketFindBtn.disabled = true;
  myTicketResultEl.hidden = true;
  try {
    const { data, error } = await supabaseClient.rpc('find_ticket_by_code', { p_code: code });
    if(error) throw error;

    const found = Array.isArray(data) ? data[0] : data;
    if(!found){
      myTicketResultEl.className = 'checkin-result error';
      myTicketResultEl.textContent = 'Bilet bulunamadı.';
      myTicketResultEl.hidden = false;
      return;
    }

    const ev = {
      name: found.event_name, venue_type: found.event_venue_type,
      cols: found.event_cols, rows: found.event_rows, accessible_seats: found.event_accessible_seats,
    };
    closeMyTicketModal();
    ticketCancelContext = { eventId: found.event_id, idx: found.seat_idx, ticketCode: code, venueType: ev.venue_type, seatPos: found.seat_pos };
    showTicketView(found.seat_idx, found.sale, ev, found.seat_pos);
  } catch(err){
    console.warn('Bilet aranamadı.', err);
    myTicketResultEl.className = 'checkin-result error';
    myTicketResultEl.textContent = 'Arama başarısız — buluta bağlanılamadı.';
    myTicketResultEl.hidden = false;
  } finally {
    myTicketFindBtn.disabled = false;
  }
}

openMyTicketBtn.addEventListener('click', openMyTicketModal);

[eventFilterName, eventFilterVenue, eventFilterDateFrom, eventFilterDateTo, eventFilterPriceMin, eventFilterPriceMax].forEach(el => {
  el.addEventListener('input', renderEventList);
  el.addEventListener('change', renderEventList);
});
eventFilterClearBtn.addEventListener('click', () => {
  eventFilterName.value = '';
  eventFilterVenue.value = '';
  eventFilterDateFrom.value = '';
  eventFilterDateTo.value = '';
  eventFilterPriceMin.value = '';
  eventFilterPriceMax.value = '';
  renderEventList();
});
myTicketClose.addEventListener('click', closeMyTicketModal);
myTicketOverlay.addEventListener('click', (e) => { if(e.target === myTicketOverlay) closeMyTicketModal(); });
myTicketFindBtn.addEventListener('click', findMyTicket);
myTicketCodeInput.addEventListener('keydown', (e) => { if(e.key === 'Enter'){ e.preventDefault(); findMyTicket(); } });

// ===== E-posta ile giriş (GERÇEK Supabase Auth OTP) + "Biletlerim" =====
// Kod client'ta ÜRETİLMİYOR — signInWithOtp() Supabase'in kendi sunucusundan
// gerçek bir e-posta gönderiyor, verifyOtp() o kodu sunucuda doğruluyor.
// Sadece misafir sayfasında (index.html) var; emailLoginBtn diğer
// sayfalarda null olduğu için hepsi ?. ile erişiliyor.
let verifiedEmail = null;

function updateEmailLoginBtnLabel(){
  if(!emailLoginBtn) return;
  emailLoginBtn.textContent = verifiedEmail ? 'Biletlerim' : 'Giriş Yap';
}
updateEmailLoginBtnLabel();

// Sayfa açılışında zaten geçerli bir Supabase Auth oturumu varsa (önceki
// ziyaretten kalma, tarayıcı kendi tutuyor) onu yükle — async olduğu için
// buton etiketi bir anlığına "Giriş Yap" gösterip sonra "Biletlerim"e dönebilir.
(async () => {
  if(!supabaseClient) return;
  try {
    const { data } = await supabaseClient.auth.getSession();
    if(data.session?.user?.email){
      verifiedEmail = data.session.user.email;
      updateEmailLoginBtnLabel();
    }
  } catch { /* yoksay */ }
})();

function showEmailPanel(name){
  document.querySelectorAll('#emailLoginOverlay [data-email-panel]').forEach(p => {
    p.hidden = p.dataset.emailPanel !== name;
  });
}

// "Giriş Yap" / "Kayıt Ol" sekmeleri — normal sitelerdeki gibi görünsün diye
// eklendi, ama Supabase Auth OTP zaten şifresiz: signInWithOtp() e-posta
// önceden var mı yok mu diye ayrım YAPMADAN aynı kodu gönderiyor (yeni
// kullanıcıyı otomatik oluşturuyor). Bu yüzden iki sekme de AYNI
// emailLoginSendBtn akışına gidiyor — sadece başlık/açıklama metni değişiyor.
let authTabMode = 'login';
const authTabLoginBtn = document.getElementById('authTabLogin');
const authTabSignupBtn = document.getElementById('authTabSignup');
const emailLoginNoteEl = document.getElementById('emailLoginNote');
const emailLoginTitleEl = document.getElementById('emailLoginTitle');
const loginSuccessNoteEl = document.getElementById('loginSuccessNote');

function setAuthTab(mode){
  authTabMode = mode;
  authTabLoginBtn?.classList.toggle('is-active', mode === 'login');
  authTabSignupBtn?.classList.toggle('is-active', mode === 'signup');
  if(emailLoginTitleEl) emailLoginTitleEl.textContent = mode === 'signup' ? 'Hesap Oluştur' : 'Giriş Yap';
  if(emailLoginNoteEl){
    emailLoginNoteEl.textContent = mode === 'signup'
      ? 'Hesap oluşturmak için e-postanı gir, sana bir doğrulama kodu gönderelim.'
      : 'E-posta adresini gir, sana bir doğrulama kodu gönderelim.';
  }
}
authTabLoginBtn?.addEventListener('click', () => setAuthTab('login'));
authTabSignupBtn?.addEventListener('click', () => setAuthTab('signup'));

function openEmailLoginModal(){
  if(!emailLoginOverlay) return;
  emailLoginErrorEl.hidden = true;
  emailLoginOverlay.hidden = false;
  if(verifiedEmail){
    if(emailLoginTitleEl) emailLoginTitleEl.textContent = 'Biletlerim';
    if(loginSuccessNoteEl) loginSuccessNoteEl.textContent = `✓ ${verifiedEmail} olarak giriş yaptın.`;
    showEmailPanel('tickets');
    loadMyEmailTickets();
  } else {
    setAuthTab('login');
    emailLoginEmailInput.value = '';
    showEmailPanel('email');
    emailLoginEmailInput.focus();
  }
}
function closeEmailLoginModal(){
  if(emailLoginOverlay) emailLoginOverlay.hidden = true;
}

async function loadMyEmailTickets(){
  myEmailTicketsNote.textContent = 'Yükleniyor...';
  myEmailTicketsList.innerHTML = '';
  if(!supabaseClient || !verifiedEmail) return;
  try {
    const { data, error } = await supabaseClient.rpc('find_tickets_by_email', { p_email: verifiedEmail });
    if(error) throw error;

    const tickets = data || [];
    if(!tickets.length){
      myEmailTicketsNote.textContent = 'Bu e-postayla alınmış bir bilet bulunamadı.';
      return;
    }
    myEmailTicketsNote.textContent = `${tickets.length} bilet bulundu — birine tıklayarak görüntüleyebilirsin.`;
    tickets.forEach(t => {
      const row = document.createElement('div');
      row.className = 'my-ticket-history-item';

      const nameEl = document.createElement('span');
      nameEl.className = 'hist-event';
      nameEl.textContent = t.event_name;

      const seatEl = document.createElement('span');
      seatEl.className = 'hist-seat';
      seatEl.textContent = t.sale.ticketCode;

      row.appendChild(nameEl);
      row.appendChild(seatEl);
      row.addEventListener('click', () => {
        closeEmailLoginModal();
        const ev = {
          name: t.event_name, venue_type: t.event_venue_type,
          cols: t.event_cols, rows: t.event_rows, accessible_seats: t.event_accessible_seats,
        };
        ticketCancelContext = { eventId: t.event_id, idx: t.seat_idx, ticketCode: t.sale.ticketCode, venueType: ev.venue_type, seatPos: t.seat_pos };
        showTicketView(t.seat_idx, t.sale, ev, t.seat_pos);
      });
      myEmailTicketsList.appendChild(row);
    });
  } catch(err){
    console.warn('Biletler alınamadı.', err);
    myEmailTicketsNote.textContent = 'Biletler alınamadı — buluta bağlanılamadı.';
  }
}

emailLoginBtn?.addEventListener('click', openEmailLoginModal);
emailLoginClose?.addEventListener('click', closeEmailLoginModal);
emailLoginOverlay?.addEventListener('click', (e) => { if(e.target === emailLoginOverlay) closeEmailLoginModal(); });

emailLoginSendBtn?.addEventListener('click', async () => {
  const email = emailLoginEmailInput.value.trim();
  if(!email || !email.includes('@')){
    toast('Geçerli bir e-posta adresi gir.');
    return;
  }
  if(!supabaseClient) return;
  emailLoginSendBtn.disabled = true;
  try {
    const { error } = await supabaseClient.auth.signInWithOtp({ email });
    if(error) throw error;
    emailLoginCodeNote.textContent = `${email} adresine bir kod gönderdik — gelen kutunu (spam dahil) kontrol et.`;
    emailLoginCodeInput.value = '';
    emailLoginErrorEl.hidden = true;
    showEmailPanel('code');
    emailLoginCodeInput.focus();
  } catch(err){
    console.warn('Kod gönderilemedi.', err);
    toast('Kod gönderilemedi — buluta bağlanılamadı.');
  } finally {
    emailLoginSendBtn.disabled = false;
  }
});
emailLoginEmailInput?.addEventListener('keydown', (e) => { if(e.key === 'Enter'){ e.preventDefault(); emailLoginSendBtn.click(); } });

emailLoginVerifyBtn?.addEventListener('click', async () => {
  const code = emailLoginCodeInput.value.trim();
  const email = emailLoginEmailInput.value.trim();
  if(!code || !supabaseClient) return;

  emailLoginVerifyBtn.disabled = true;
  try {
    const { data, error } = await supabaseClient.auth.verifyOtp({ email, token: code, type: 'email' });
    if(error) throw error;

    emailLoginErrorEl.hidden = true;
    verifiedEmail = data.user?.email || email;
    updateEmailLoginBtnLabel();
    if(emailLoginTitleEl) emailLoginTitleEl.textContent = 'Biletlerim';
    if(loginSuccessNoteEl) loginSuccessNoteEl.textContent = `✓ ${verifiedEmail} olarak giriş yaptın.`;
    showEmailPanel('tickets');
    loadMyEmailTickets();
    toast('Giriş yapıldı.');
  } catch(err){
    console.warn('Kod doğrulanamadı.', err);
    emailLoginErrorEl.hidden = false;
  } finally {
    emailLoginVerifyBtn.disabled = false;
  }
});
emailLoginCodeInput?.addEventListener('keydown', (e) => { if(e.key === 'Enter'){ e.preventDefault(); emailLoginVerifyBtn.click(); } });

emailLogoutBtn?.addEventListener('click', async () => {
  if(supabaseClient) await supabaseClient.auth.signOut();
  verifiedEmail = null;
  updateEmailLoginBtnLabel();
  closeEmailLoginModal();
  toast('Çıkış yapıldı.');
});

document.addEventListener('keydown', (e) => {
  if(e.key !== 'Escape') return;
  if(!seatModalOverlay.hidden) closeSeatModal();
  if(!createEventOverlay.hidden) closeCreateEventModal();
  if(!ticketViewOverlay.hidden) closeTicketView();
  if(!checkinOverlay.hidden) closeCheckinModal();
  if(!myTicketOverlay.hidden) closeMyTicketModal();
  if(emailLoginOverlay && !emailLoginOverlay.hidden) closeEmailLoginModal();
});

// ===== Filters & Search functionality =====

function setupFilters(){
  const filtersContainer = document.getElementById('gridFilters');
  if(!filtersContainer) return;

  filtersContainer.addEventListener('click', (e) => {
    const chip = e.target.closest('.filter-chip');
    if(!chip) return;

    filtersContainer.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('is-active'));
    chip.classList.add('is-active');

    currentFilter = chip.dataset.filter;
    applyFilterAndSearch();
  });
}

function applyFilterAndSearch(){
  const query = (document.getElementById('seatSearchInput')?.value || '').trim().toLowerCase();
  const clearSearchBtn = document.getElementById('clearSearchBtn');
  if(clearSearchBtn) {
    clearSearchBtn.hidden = !query;
  }

  seatGrid.classList.remove('filter-empty', 'filter-male', 'filter-female', 'filter-sold', 'search-active');

  const hasFilter = currentFilter !== 'all';
  const hasSearch = query.length > 0;

  if (hasFilter) {
    seatGrid.classList.add(`filter-${currentFilter}`);
  }
  if (hasSearch) {
    seatGrid.classList.add('search-active');
  }

  seatStates.forEach((state, idx) => {
    const btn = seatButtons[idx];
    if(!btn) return;

    let isMatch = true;

    if (hasSearch) {
      // Havuzlu modlarda (futbol/Genel Etkinlik) seatSales[idx] tekil bir
      // kayıt değil bir DİZİ, ve state (satılan sayısı) 'male'/'female' hiç
      // olmuyor — salesAt() ile normalize edip her satışı ayrı ayrı kontrol
      // ediyoruz, cinsiyet aramasını da bu modda devre dışı bırakıyoruz
      // (bkz. blockSoldCount/salesAt).
      const pooled = isPooledMode();
      const sales = salesAt(idx);
      const seatNumStr = String(idx + 1);
      const label = pooled ? poolBlocks()[idx].label.toLowerCase() : `koltuk ${Math.floor(idx / cols) + 1}-${(idx % cols) + 1}`;

      const matchLabel = label.includes(query);
      const matchNum = seatNumStr === query;
      const matchState = !pooled && labelFor(state).toLowerCase().includes(query);
      const matchTier = sales.some(s => s.label.toLowerCase().includes(query));
      const matchPayment = sales.some(s => paymentLabel(s.payment)?.toLowerCase().includes(query));

      isMatch = matchLabel || matchNum || matchState || matchTier || matchPayment;
    }

    btn.classList.toggle('search-match', isMatch);
  });
}

// ===== Cross-device sync (Supabase realtime), scoped to the current event =====
// Split into two tables on purpose:
//   events       — cols/rows/seat_states/venue_type per event — occupancy only, no pricing.
//   event_sales  — seat_sales/tiers per event — prices, tiers, payment method.
// Misafir only ever fetches/subscribes to `events`, so ticket prices and
// payment details never reach a guest's browser at all (not just hidden in
// the UI — never sent over the wire). Satış/Yönetici sync both tables.

// Supabase'e giderken koltuk durumlarını tek harfe indiriyoruz:
// ["empty","empty",...] yerine ["e","e",...]. Realtime bir satır her
// değiştiğinde satırın TAMAMINI yayınladığı için seat_states en büyük
// kalem oluyordu; bu kodlama onu ~%55 küçültüyor.
// Okurken iki formatı da kabul ediyoruz — böylece eski kayıtlar ve
// JS/SQL'in farklı zamanlarda güncellenmesi sorun çıkarmıyor.
const SEAT_STATE_SHORT = { empty: 'e', male: 'm', female: 'f' };
const SEAT_STATE_LONG = { e: 'empty', m: 'male', f: 'female' };

// Aynı fikir, satış kayıtlarındaki ödeme yöntemi için — "kart"/"nakit" yerine
// "k"/"n". seat_states'ten farklı olarak bu tek bir alanı ~4 byte küçültüyor
// ama bir etkinlikte yüzlerce satış kaydı olabildiğinden toplamda anlamlı
// (bkz. optimizasyon notu). Okurken iki formatı da kabul ediyoruz.
const PAYMENT_SHORT = { kart: 'k', nakit: 'n' };
const PAYMENT_LONG = { k: 'kart', n: 'nakit' };

function encodeSeatStates(states){
  // Futbol bloklarında bir üst-eleman tekil durum değil, o bloktaki HER
  // koltuğun kendi durumunu taşıyan bir DİZİ (bkz. blockSoldCount notu) —
  // içine de recursive olarak aynı kısaltmayı uyguluyoruz.
  return states.map(s => Array.isArray(s) ? s.map(x => SEAT_STATE_SHORT[x] || x) : (SEAT_STATE_SHORT[s] || s));
}
function decodeSeatStates(states){
  return states.map(s => Array.isArray(s) ? s.map(x => SEAT_STATE_LONG[x] || x) : (SEAT_STATE_LONG[s] || s));
}
function isSeatTaken(state){
  return !!state && state !== 'empty' && state !== 'e';
}

// ===== Futbol Sahası kapasiteli blok yardımcıları =====
// Genel Etkinlik'te seatStates[idx] SATILAN/KATILAN SAYISI (tam sayı,
// Number() ile okunuyor). Futbol bloklarında ise artık her koltuk tek tek
// takip ediliyor — seatStates[blockIdx] o bloktaki HER koltuğun kendi
// durumunu ('e'/'m'/'f') taşıyan bir DİZİ (bkz. renderBlockSeatGrid);
// "satılan sayısı" bu dizideki dolu koltukları saymakla bulunuyor.
function blockSoldCount(idx){
  const v = seatStates[idx];
  if(Array.isArray(v)) return v.filter(isSeatTaken).length;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// seatSales[idx] diğer venue türlerinde tek bir satış nesnesi ya da null;
// stadyumda ise bir DİZİ (bloktaki her bilet kendi kaydıyla). Bu yardımcı
// ikisini de her zaman bir DİZİ olarak döndürür — eski/göçmemiş tekil bir
// kayıt varsa onu da [kayit] olarak sarar, böylece istatistik/rapor/check-in
// kodu tek bir yoldan (her zaman dizi üzerinden) çalışabilir.
function salesAt(idx){
  const v = seatSales[idx];
  if(!v) return [];
  // .filter(Boolean): eski bir RPC/veri göçü hatası bir diziye null
  // sızdırmış olabilir (bkz. supabase-setup.sql'deki jsonb_typeof notu) —
  // burada temizlemezsek her okuyucu (istatistik, check-in, "Ciro Özeti"...)
  // s.ticketCode/s.label gibi bir alana erişirken patlardı.
  return (Array.isArray(v) ? v : [v]).filter(Boolean);
}

// Tüm satışları (venue türünden bağımsız) tek düz bir dizi olarak döner —
// istatistik/rapor/check-in kodu artık seatSales[idx]'in tekil nesne mi dizi
// mi olduğuyla uğraşmadan tek bir yoldan çalışabiliyor.
function allSalesFlat(){
  return seatSales.flatMap((_, idx) => salesAt(idx));
}

function pushSeatStates(){
  if(!supabaseClient || isApplyingRemote || !currentEventId) return;
  clearTimeout(pushTimerSeatStates);
  pushTimerSeatStates = setTimeout(async () => {
    const { error } = await supabaseClient.from('events').update({
      seat_states: encodeSeatStates(seatStates),
      updated_at: new Date().toISOString(),
    }).eq('id', currentEventId);
    if(error) console.warn('Supabase (events) güncelleme hatası:', error.message);
  }, 400);
}

function pushLayout(){
  if(!supabaseClient || isApplyingRemote || !currentEventId) return;
  clearTimeout(pushTimerLayout);
  pushTimerLayout = setTimeout(async () => {
    const { error } = await supabaseClient.from('events').update({
      cols, rows,
      seat_states: encodeSeatStates(seatStates),
      venue_type: venueType,
      updated_at: new Date().toISOString(),
    }).eq('id', currentEventId);
    if(error) console.warn('Supabase (events) güncelleme hatası:', error.message);
  }, 400);
}

function pushAccessibleSeats(){
  if(!supabaseClient || isApplyingRemote || !currentEventId) return;
  clearTimeout(pushTimerAccessibleSeats);
  pushTimerAccessibleSeats = setTimeout(async () => {
    const { error } = await supabaseClient.from('events').update({
      accessible_seats: [...ACCESSIBLE_SEATS],
      updated_at: new Date().toISOString(),
    }).eq('id', currentEventId);
    if(error) console.warn('Supabase (events) güncelleme hatası:', error.message);
  }, 400);
}

function pushVenueType(){
  if(!supabaseClient || isApplyingRemote || !currentEventId) return;
  clearTimeout(pushTimerVenueType);
  pushTimerVenueType = setTimeout(async () => {
    const { error } = await supabaseClient.from('events').update({
      venue_type: venueType,
      updated_at: new Date().toISOString(),
    }).eq('id', currentEventId);
    if(error) console.warn('Supabase (events) güncelleme hatası:', error.message);
  }, 400);
}

// Genel Etkinlik'in tek giriş havuzunun kapasitesi (events.general_capacity)
// — diğer venue türlerinde hiç okunmuyor.
function pushGeneralCapacity(){
  if(!supabaseClient || isApplyingRemote || !currentEventId) return;
  clearTimeout(pushTimerGeneralCapacity);
  pushTimerGeneralCapacity = setTimeout(async () => {
    const { error } = await supabaseClient.from('events').update({
      general_capacity: GENERAL_CAPACITY,
      updated_at: new Date().toISOString(),
    }).eq('id', currentEventId);
    if(error) console.warn('Supabase (events) güncelleme hatası:', error.message);
  }, 400);
}

function pushSalesData(){
  if(!supabaseClient || isApplyingRemote || !canEdit() || !currentEventId) return;
  clearTimeout(pushTimerSalesData);
  pushTimerSalesData = setTimeout(async () => {
    const { error } = await supabaseClient.from('event_sales').update({
      seat_sales: seatSales,
      updated_at: new Date().toISOString(),
    }).eq('event_id', currentEventId);
    if(error) console.warn('Supabase (event_sales) güncelleme hatası:', error.message);
  }, 400);
}

// Tiers artik events tablosunda (herkese acik fiyat listesi) — misafirin
// kendi bileti kendi alabilmesi icin tier secimini gormesi gerekiyor.
function pushTiers(){
  if(!supabaseClient || isApplyingRemote || !currentEventId) return;
  clearTimeout(pushTimerTiers);
  pushTimerTiers = setTimeout(async () => {
    const { error } = await supabaseClient.from('events').update({
      tiers: TICKET_TIERS,
      updated_at: new Date().toISOString(),
    }).eq('id', currentEventId);
    if(error) console.warn('Supabase (events) güncelleme hatası:', error.message);
  }, 400);
}

function applySeatsPayload(row){
  if(!row) return;
  isApplyingRemote = true;

  cols = row.cols;
  rows = row.rows;
  seatStates = Array.isArray(row.seat_states) ? decodeSeatStates(row.seat_states) : [];
  if(row.venue_type && VENUE_TYPES[row.venue_type]) venueType = row.venue_type;
  TICKET_TIERS = Array.isArray(row.tiers) && row.tiers.length ? row.tiers : [...DEFAULT_TIERS];
  DISCOUNT_CODES = Array.isArray(row.discount_codes) ? row.discount_codes : [];
  POSTER_URL = safeImageUrl(row.poster_url);
  EVENT_NOTE = typeof row.note === 'string' && row.note.trim() ? row.note : null;
  GENERAL_CAPACITY = Number(row.general_capacity) > 0 ? Number(row.general_capacity) : DEFAULT_GENERAL_CAPACITY;
  // İsmi buradan da yazıyoruz: paylaşılan bir linkle doğrudan girildiğinde
  // etkinlik listesi henüz yüklenmemiş oluyor ve başlık boş kalıyordu.
  // (Yönetici etkinliği yeniden adlandırırsa da bu sayede anında güncellenir.)
  if(row.name) currentEventNameBadge.textContent = row.name;
  DYNAMIC_PRICING = (row.dynamic_pricing && typeof row.dynamic_pricing === 'object')
    ? { ...DEFAULT_DYNAMIC, ...row.dynamic_pricing }
    : { ...DEFAULT_DYNAMIC };
  ACCESSIBLE_SEATS = new Set(Array.isArray(row.accessible_seats) ? row.accessible_seats : []);
  normalizeSalesLength();

  colsInput.value = cols;
  rowsInput.value = rows;
  updateTotalPreview();
  renderVenueAccent();
  renderGrid();
  renderTierList();
  renderDiscountList();
  renderPosterEditor();
  renderNoteEditor();
  renderDynamicPricingEditor();

  isApplyingRemote = false;
}

function applySalesPayload(row){
  if(!row) return;
  isApplyingRemote = true;

  seatSales = Array.isArray(row.seat_sales) ? row.seat_sales : [];
  normalizeSalesLength();

  renderGrid();

  isApplyingRemote = false;
}

function subscribeSeatsRealtime(eventId){
  seatsChannel = supabaseClient
    .channel(`event_seats_${eventId}`)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'events', filter: `id=eq.${eventId}` },
      (payload) => applySeatsPayload(payload.new))
    .subscribe();
}

function subscribeSalesRealtime(eventId){
  salesChannel = supabaseClient
    .channel(`event_sales_${eventId}`)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'event_sales', filter: `event_id=eq.${eventId}` },
      (payload) => applySalesPayload(payload.new))
    .subscribe();
}

function unsubscribeEventChannels(){
  if(seatsChannel){ supabaseClient.removeChannel(seatsChannel); seatsChannel = null; }
  if(salesChannel){ supabaseClient.removeChannel(salesChannel); salesChannel = null; }
}

async function ensureEventSeatsSync(eventId){
  try {
    const { data, error } = await supabaseClient.from('events').select('*').eq('id', eventId).maybeSingle();
    if(error) throw error;

    // Silinmiş/geçersiz bir etkinliğin linki açılmış olabilir — boş bir
    // koltuk ekranında bırakmak yerine listeye geri dön.
    if(!data){
      toast('Bu etkinlik bulunamadı, silinmiş olabilir.');
      exitEvent();
      return;
    }

    applySeatsPayload(data);
    subscribeSeatsRealtime(eventId);
  } catch(err){
    console.warn('Supabase (events) bağlantısı kurulamadı.', err);
    toast('Buluta bağlanılamadı — yerel modda çalışılıyor.');
  }
}

async function ensureEventSalesSync(eventId){
  try {
    const { data, error } = await supabaseClient.from('event_sales').select('*').eq('event_id', eventId).maybeSingle();
    if(error) throw error;
    if(data) applySalesPayload(data);
    subscribeSalesRealtime(eventId);
  } catch(err){
    console.warn('Supabase (event_sales) bağlantısı kurulamadı.', err);
  }
}

// ===== Events list (the "which event am I managing" layer) =====

function computeOccupancy(ev){
  const states = Array.isArray(ev.seat_states) ? ev.seat_states : [];

  if(ev.venue_type === 'futbol' || ev.venue_type === 'genel'){
    // Bu liste satırındaki 'ev' aktif olarak açık etkinlik olmayabilir, o
    // yüzden global seatStates'e bakan blockSoldCount() yerine
    // ev.seat_states üzerinde aynı Number()-tabanlı çözümü doğrudan
    // uyguluyoruz. Futbolda kapasite sabit (STADIUM_BLOCKS), Genel
    // Etkinlik'te ise etkinliğin kendi general_capacity'sinden okunuyor.
    const total = ev.venue_type === 'futbol'
      ? STADIUM_BLOCKS.reduce((sum, b) => sum + b.capacity, 0)
      : (Number(ev.general_capacity) > 0 ? Number(ev.general_capacity) : DEFAULT_GENERAL_CAPACITY);
    // Futbol bloklarında s artık bir SAYI değil, o bloktaki her koltuğun
    // kendi durumunu taşıyan bir DİZİ (bkz. purchase_stadium_seat) — bu
    // yüzden Array.isArray kontrolüyle dolu koltukları sayıyoruz; Genel
    // Etkinlik'te (ve henüz göçmemiş eski futbol verisinde) hâlâ düz bir
    // sayı, Number() ile okunuyor.
    const filled = states.reduce((sum, s) => {
      if(Array.isArray(s)) return sum + s.filter(isSeatTaken).length;
      const n = Number(s);
      return sum + (Number.isFinite(n) ? n : 0);
    }, 0);
    const pct = total > 0 ? Math.round((filled / total) * 100) : 0;
    return { total, filled, pct };
  }

  const total = states.length;
  const filled = states.filter(isSeatTaken).length;
  const pct = total > 0 ? Math.round((filled / total) * 100) : 0;
  return { total, filled, pct };
}

function formatEventDate(dateStr){
  if(!dateStr) return 'Tarih belirtilmedi';
  try {
    return new Date(`${dateStr}T00:00:00`).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
  } catch {
    return dateStr;
  }
}

function computeMinTierPrice(ev){
  const tiers = Array.isArray(ev.tiers) ? ev.tiers : [];
  if(!tiers.length) return null;
  return Math.min(...tiers.map(t => t.price));
}

// Etkinlik listesindeki filtre çubuğu — tamamen istemci tarafında, zaten
// belleğe çekilmiş `events` dizisini süzer (yeni bir sorgu atmaz).
function eventMatchesFilters(ev){
  // Türkçe'ye özgü küçültme ('İ' → 'i', 'I' → 'ı') — normal toLowerCase
  // "İSTANBUL" yazan bir kullanıcıyı "istanbul" ile eşleştiremezdi.
  const q = eventFilterName.value.trim().toLocaleLowerCase('tr');
  if(q && !(ev.name || '').toLocaleLowerCase('tr').includes(q)) return false;

  const venueVal = eventFilterVenue.value;
  if(venueVal && ev.venue_type !== venueVal) return false;

  const dateFrom = eventFilterDateFrom.value;
  const dateTo = eventFilterDateTo.value;
  if(dateFrom && (!ev.event_date || ev.event_date < dateFrom)) return false;
  if(dateTo && (!ev.event_date || ev.event_date > dateTo)) return false;

  const priceMinRaw = eventFilterPriceMin.value;
  const priceMaxRaw = eventFilterPriceMax.value;
  if(priceMinRaw !== '' || priceMaxRaw !== ''){
    const minPrice = computeMinTierPrice(ev);
    if(minPrice === null) return false;
    if(priceMinRaw !== '' && minPrice < Number(priceMinRaw)) return false;
    if(priceMaxRaw !== '' && minPrice > Number(priceMaxRaw)) return false;
  }

  return true;
}

// Hero'daki canlı özet — uydurma pazarlama sayısı değil, listedeki gerçek
// etkinliklerden hesaplanıyor. Hero yalnızca index.html'de olduğu için
// personel sayfalarında bu element yok, sessizce atlanıyor.
function renderHeroMeta(list){
  const el = document.getElementById('heroMeta');
  if(!el) return;

  if(!list.length){ el.hidden = true; return; }

  const bosKoltuk = list.reduce((sum, ev) => {
    const { total, filled } = computeOccupancy(ev);
    return sum + Math.max(0, total - filled);
  }, 0);

  el.textContent = `${list.length} etkinlik · ${bosKoltuk} boş koltuk`;
  el.hidden = false;
}

function renderEventList(){
  eventGridEl.innerHTML = '';
  eventEmptyHint.hidden = events.length > 0;

  const sorted = [...events].sort((a, b) => {
    if(a.status !== b.status) return a.status === 'archived' ? 1 : -1;
    return new Date(b.created_at) - new Date(a.created_at);
  });

  const filtered = sorted.filter(eventMatchesFilters);
  eventFilterEmptyHint.hidden = !(events.length > 0 && filtered.length === 0);
  renderHeroMeta(filtered);

  filtered.forEach(ev => {
    const { total, pct } = computeOccupancy(ev);
    const venueLabel = (VENUE_TYPES[ev.venue_type] || VENUE_TYPES.sinema).label;
    const statusLabel = ev.status === 'archived' ? 'Arşivlendi' : 'Aktif';

    // Tarih sütunu gün/ay olarak ayrı basılıyor (bkz. .program-date) —
    // tam tarih (yıl dahil) yine de .program-date-full'de tam metin olarak
    // kalıyor, bilgi kaybı yok.
    let dayNum = '—', monShort = '';
    if(ev.event_date){
      try {
        const d = new Date(`${ev.event_date}T00:00:00`);
        dayNum = d.toLocaleDateString('tr-TR', { day: '2-digit' });
        monShort = d.toLocaleDateString('tr-TR', { month: 'short' }).replace('.', '');
      } catch { /* formatEventDate zaten bozuk tarihte ham metni döndürüyor */ }
    }

    const row = document.createElement('div');
    row.className = 'program-row';
    row.dataset.status = ev.status;

    row.innerHTML = `
      <div class="program-date"><div class="day"></div><div class="mon"></div></div>
      <div class="program-info">
        <div class="program-info-top">
          <span class="program-venue"></span>
          <span class="program-status-badge"></span>
        </div>
        <h3></h3>
        <p class="program-date-full"></p>
        <p class="program-note" hidden></p>
      </div>
      <div class="program-fill">
        <div class="capacity-bar-bg"><div class="capacity-bar" style="width:${pct}%"></div></div>
        <span>%${pct} dolu · ${total} koltuk</span>
      </div>
      <div class="program-actions">
        <button class="btn btn-gold btn-sm event-enter-btn" type="button">Gir</button>
        <button class="btn btn-ghost btn-sm admin-only event-archive-btn" type="button"></button>
        <button class="btn btn-ghost btn-sm admin-only event-delete-btn" type="button">Sil</button>
      </div>
    `;
    // Afiş varsa tarih sütunundan sonra küçük bir küçük resim olarak ekle.
    // safeImageUrl sadece http(s) geçirir.
    const poster = safeImageUrl(ev.poster_url);
    if(poster){
      const img = document.createElement('img');
      img.className = 'program-poster';
      img.src = poster;
      img.alt = '';
      img.loading = 'lazy';
      // Kırık/erişilemeyen görsel satırı bozmasın diye kendini gizlesin.
      img.addEventListener('error', () => img.remove());
      row.querySelector('.program-info').before(img);
    }

    // textContent (not innerHTML) for anything derived from user-entered
    // event names — avoids injecting HTML from an admin-typed event name.
    // ev.status'un kendisi de artık template string'e gömülmüyor —
    // .dataset ataması her zaman düz metin olarak yazılır, attribute'tan
    // kaçıp HTML enjekte etme riski taşımaz (bkz. güvenlik denetimi).
    row.querySelector('.program-date .day').textContent = dayNum;
    row.querySelector('.program-date .mon').textContent = monShort;
    row.querySelector('.program-venue').textContent = venueLabel;
    row.querySelector('.program-status-badge').textContent = statusLabel;
    row.querySelector('.program-status-badge').dataset.status = ev.status;
    row.querySelector('h3').textContent = ev.name;
    row.querySelector('.program-date-full').textContent = formatEventDate(ev.event_date);
    row.querySelector('.event-archive-btn').textContent = ev.status === 'archived' ? 'Aktifleştir' : 'Arşivle';
    if(typeof ev.note === 'string' && ev.note.trim()){
      const noteEl = row.querySelector('.program-note');
      noteEl.textContent = ev.note;
      noteEl.hidden = false;
    }

    row.querySelector('.event-enter-btn').addEventListener('click', () => enterEvent(ev.id, ev.name));
    row.querySelector('.event-archive-btn').addEventListener('click', () => toggleArchiveEvent(ev));
    row.querySelector('.event-delete-btn').addEventListener('click', () => deleteEventRow(ev));

    eventGridEl.appendChild(row);
  });
}

async function loadEvents(){
  try {
    const { data, error } = await supabaseClient.from('events').select('*').order('created_at', { ascending: false });
    if(error) throw error;
    events = data || [];
    renderEventList();
  } catch(err){
    console.warn('Etkinlikler yüklenemedi.', err);
    toast('Etkinlikler yüklenemedi — buluta bağlanılamadı.');
  }
}

// Gelen payload zaten değişen satırın tamamını taşıyor. Eskiden burada
// loadEvents() çağrılıp TÜM etkinlikler (hepsinin seat_states'i dahil)
// baştan indiriliyordu — hem de her koltuk tıklamasında, her bağlı cihazda.
// Artık yerel diziyi doğrudan payload'dan yamalıyoruz, ek istek yok.
function subscribeEventsRealtime(){
  eventsChannel = supabaseClient
    .channel('events_list_changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'events' }, (payload) => {
      if(payload.eventType === 'DELETE'){
        // REPLICA IDENTITY DEFAULT'ta payload.old sadece birincil anahtarı
        // taşır — bize zaten yeten tek şey o.
        events = events.filter(e => e.id !== payload.old.id);
      } else {
        const row = payload.new;
        const i = events.findIndex(e => e.id === row.id);
        if(i === -1) events.unshift(row);
        else events[i] = row;
      }
      renderEventList();
    })
    .subscribe();
}

function unsubscribeEventsListRealtime(){
  if(eventsChannel){ supabaseClient.removeChannel(eventsChannel); eventsChannel = null; }
}

async function ensureEventsSync(){
  if(eventsSynced || !supabaseClient) return;
  eventsSynced = true;
  await loadEvents();
  subscribeEventsRealtime();
}

async function toggleArchiveEvent(ev){
  const newStatus = ev.status === 'archived' ? 'active' : 'archived';
  const { error } = await supabaseClient.from('events').update({
    status: newStatus,
    updated_at: new Date().toISOString(),
  }).eq('id', ev.id);
  if(error){ toast('İşlem başarısız.'); return; }
  toast(newStatus === 'archived' ? 'Etkinlik arşivlendi.' : 'Etkinlik aktifleştirildi.');
}

async function deleteEventRow(ev){
  if(!confirm(`"${ev.name}" etkinliğini kalıcı olarak silmek istediğine emin misin? Bu işlem geri alınamaz.`)) return;
  const { error } = await supabaseClient.from('events').delete().eq('id', ev.id);
  if(error){ toast('Silinemedi.'); return; }
  toast(`"${ev.name}" silindi.`);
  if(currentEventId === ev.id) exitEvent();
}

function toggleNewEventDimsVisibility(){
  const vType = newEventVenue.value;
  const isFutbol = vType === 'futbol';
  const isGenel = vType === 'genel';
  newEventDimsRow.hidden = isFutbol || isGenel;
  newEventStadiumNote.hidden = !(isFutbol || isGenel);
  if(isFutbol){
    newEventStadiumNote.textContent = `Futbol Sahası için sabit ${STADIUM_BLOCKS.length} bloklu stadyum düzeni kullanılır.`;
  } else if(isGenel){
    newEventStadiumNote.textContent = 'Genel Etkinlik ücretsiz/biletsiz tek bir giriş havuzudur — koltuk numarası ve bilet türü/fiyat yok, sadece toplam kapasite. Kapasiteyi oluşturduktan sonra ayarlayabilirsin.';
  }
}

function openCreateEventModal(){
  newEventName.value = '';
  newEventDate.value = '';
  newEventPoster.value = '';
  newEventVenue.value = 'sinema';
  newEventCols.value = 10;
  newEventRows.value = 8;
  toggleNewEventDimsVisibility();
  createEventOverlay.hidden = false;
  newEventName.focus();
}

function closeCreateEventModal(){
  createEventOverlay.hidden = true;
}

async function createEvent(){
  const name = newEventName.value.trim();
  if(!name){
    toast('Etkinlik adı gir.');
    return;
  }
  const date = newEventDate.value || null;
  const vType = newEventVenue.value;

  // general_capacity sütunu "not null" — diğer venue türlerinde hiç
  // okunmuyor ama insert'e AÇIKÇA null geçmek Postgres'te varsayılan
  // değeri (500) devre dışı bırakıp not-null ihlali veriyordu, bu yüzden
  // burada da varsayılana çekiliyor.
  let evCols, evRows, states, evTiers, evGeneralCapacity = DEFAULT_GENERAL_CAPACITY;
  if(vType === 'futbol'){
    evCols = STADIUM_BLOCKS.length;
    evRows = 1;
    // Stadyumda "boş" 0 (satılan bilet sayısı) — bkz. blockSoldCount.
    states = new Array(STADIUM_BLOCKS.length).fill(0);
    evTiers = DEFAULT_STADIUM_TIERS;
  } else if(vType === 'genel'){
    // Genel Etkinlik'te koltuk numarası da bilet türü/fiyat da yok — tek bir
    // ücretsiz giriş havuzu (bkz. poolBlocks/joinGeneralEvent). "boş" burada
    // da 0 (katılan kişi sayısı).
    evGeneralCapacity = DEFAULT_GENERAL_CAPACITY;
    evCols = 1;
    evRows = 1;
    states = [0];
    evTiers = [];
  } else {
    evCols = Math.min(40, Math.max(1, Number(newEventCols.value) || 10));
    evRows = Math.min(30, Math.max(1, Number(newEventRows.value) || 8));
    states = new Array(evCols * evRows).fill('empty');
    evTiers = DEFAULT_TIERS;
  }

  submitCreateEventBtn.disabled = true;
  try {
    const { data, error } = await supabaseClient.from('events').insert({
      name, event_date: date, venue_type: vType,
      cols: evCols, rows: evRows, seat_states: encodeSeatStates(states),
      tiers: evTiers, general_capacity: evGeneralCapacity,
      poster_url: safeImageUrl(newEventPoster.value), status: 'active',
    }).select().single();
    if(error) throw error;

    // Havuzlu türlerde (futbol/genel) her göze bir DİZİ gerekiyor, boş → null
    // değil []. null bırakılırsa purchase_stadium_block RPC'sindeki
    // "coalesce(...) || p_sales" ilk satın almada diziye bastan sızan bir
    // null sokuyordu (bkz. supabase-setup.sql notu) — RPC artık bunu da
    // kendi tarafında güvenceye aldı, ama kaynağında da doğru olsun.
    const emptySale = (vType === 'futbol' || vType === 'genel') ? [] : null;
    const { error: salesError } = await supabaseClient.from('event_sales').insert({
      event_id: data.id,
      seat_sales: new Array(states.length).fill(emptySale),
    });
    if(salesError) throw salesError;

    closeCreateEventModal();
    toast(`"${name}" etkinliği oluşturuldu.`);
    enterEvent(data.id, data.name);
  } catch(err){
    console.warn('Etkinlik oluşturulamadı.', err);
    toast('Etkinlik oluşturulamadı — buluta bağlanılamadı.');
  } finally {
    submitCreateEventBtn.disabled = false;
  }
}

createEventBtn.addEventListener('click', openCreateEventModal);
createEventClose.addEventListener('click', closeCreateEventModal);
createEventOverlay.addEventListener('click', (e) => { if(e.target === createEventOverlay) closeCreateEventModal(); });
newEventVenue.addEventListener('change', toggleNewEventDimsVisibility);
submitCreateEventBtn.addEventListener('click', createEvent);

// ===== Entering / leaving an event =====
// Açık etkinlik URL'de ?etkinlik=<id> olarak tutuluyor: böylece belirli bir
// etkinliğin linki paylaşılabiliyor ve tarayıcının geri tuşu çalışıyor.

const EVENT_URL_PARAM = 'etkinlik';

function eventIdFromUrl(){
  return new URL(window.location.href).searchParams.get(EVENT_URL_PARAM);
}

function syncEventUrl(id, replace){
  const url = new URL(window.location.href);
  if(id) url.searchParams.set(EVENT_URL_PARAM, id);
  else url.searchParams.delete(EVENT_URL_PARAM);
  if(url.href === window.location.href) return;
  if(replace) history.replaceState({ eventId: id || null }, '', url);
  else history.pushState({ eventId: id || null }, '', url);
}

// Geri/ileri tuşu: URL ile ekrandaki durumu eşitle (skipUrl=true ile
// tekrar history'ye yazmayı engelliyoruz, yoksa döngü olur).
window.addEventListener('popstate', () => {
  const id = eventIdFromUrl();
  if(id && id !== currentEventId) enterEvent(id, null, true);
  else if(!id && currentEventId) exitEvent(true);
});

async function enterEvent(id, nameHint, skipUrl){
  clearPushTimers();
  unsubscribeEventChannels();
  // Etkinlik listesi ekranda değilken canlı tutmanın anlamı yok — üstelik
  // events_list_changes ile event_seats_<id> ikisi de `events` tablosunu
  // dinlediği için her koltuk değişikliği aynı satırı iki kez gönderiyordu.
  unsubscribeEventsListRealtime();
  setBulkMode(false);
  setAccessMode(false);
  bulkSelected.clear();

  currentEventId = id;
  sessionStorage.setItem(EVENT_SESSION_KEY, id);
  if(!skipUrl) syncEventUrl(id);

  const ev = nameHint ? { name: nameHint } : events.find(e => e.id === id);
  currentEventNameBadge.textContent = ev ? ev.name : '';
  currentEventNameBadge.hidden = false;
  backToEventsBtn.hidden = false;
  resetAllBtn.hidden = !canEdit();

  gridHint.textContent = canEdit()
    ? 'Bir koltuğa tıkla: cinsiyet, bilet türü ve ödeme yöntemini seç'
    : 'Boş bir koltuğa tıklayarak kendi biletini satın alabilirsin.';

  // Reset local state before the fetch resolves so a stale previous event's
  // seats never flash on screen while this one is loading.
  seatStates = [];
  seatSales = [];
  seatButtons = [];
  TICKET_TIERS = [...DEFAULT_TIERS];
  DISCOUNT_CODES = [];
  POSTER_URL = null;
  EVENT_NOTE = null;
  eventNoteDisplay.hidden = true;
  GENERAL_CAPACITY = DEFAULT_GENERAL_CAPACITY;
  DYNAMIC_PRICING = { ...DEFAULT_DYNAMIC };

  eventListView.hidden = true;
  eventDetailView.hidden = false;

  // Supabase'den veri gelene kadar ızgara bomboş kalıyordu — bir bağlantı
  // yavaşsa bu "bozuk/silinmiş" gibi görünüyordu. renderGrid()/
  // renderStadiumGrid() zaten seatGrid.innerHTML'i temizleyip yeniden
  // dolduruyor, o yüzden burada ekstra bir temizleme kodu gerekmiyor.
  seatGrid.innerHTML = '<p class="grid-loading">Koltuklar yükleniyor…</p>';

  await ensureEventSeatsSync(id);
  if(canEdit()) await ensureEventSalesSync(id);
}

function exitEvent(skipUrl){
  clearPushTimers();
  unsubscribeEventChannels();
  currentEventId = null;
  sessionStorage.removeItem(EVENT_SESSION_KEY);
  if(!skipUrl) syncEventUrl(null);

  backToEventsBtn.hidden = true;
  currentEventNameBadge.hidden = true;
  eventDetailView.hidden = true;
  eventListView.hidden = false;

  // Listeye dönerken bir kez tazele ve canlı aboneliği geri aç (etkinlik
  // içindeyken kapatmıştık).
  if(supabaseClient && !eventsChannel){
    loadEvents();
    subscribeEventsRealtime();
  }
}

// Ok fonksiyonu şart: doğrudan exitEvent verilirse tıklama olayı skipUrl
// parametresine düşer ve truthy olduğu için URL güncellenmez.
backToEventsBtn.addEventListener('click', () => exitEvent());

// ===== Login / role gate (misafir / satış / yönetici) =====

function enterApp(role){
  currentRole = role;
  appRoot.dataset.role = role;
  // Modaller (koltuk/bilet/check-in) DOM'da #appRoot disinda yasiyor --
  // rol bilgisi body'de de olmali yoksa oradaki editor-only/admin-only
  // butonlar (Koltugu Bosalt, Bileti Goruntule, Bilet Dogrula) misafirden
  // gizlenemez.
  document.body.dataset.role = role;
  roleBadge.textContent = role === 'admin' ? 'Yönetici' : role === 'sales' ? 'Satış' : 'Misafir';
  loginGate.hidden = true;
  appRoot.hidden = false;

  ensureEventsSync();

  // URL'deki etkinlik, oturum hafızasındakini ezer: paylaşılan bir linki
  // açan kişi kendi son baktığı etkinliğe değil, linkteki etkinliğe gitmeli.
  const urlEventId = eventIdFromUrl();
  const savedEventId = urlEventId || sessionStorage.getItem(EVENT_SESSION_KEY);
  if(savedEventId){
    // Açılıştaki geri yükleme bir kullanıcı gezinmesi değil — history'ye yeni
    // kayıt EKLEMEmeli, yoksa geri tuşu listeye değil bu etkinliğe döner.
    // Adresi replaceState ile yazıyoruz.
    enterEvent(savedEventId, null, true);
    syncEventUrl(savedEventId, true);
  } else {
    eventListView.hidden = false;
    eventDetailView.hidden = true;
  }
}

// guestLoginBtn admin.html'de yok (personel-only sayfa) — bkz. admin.html.
guestLoginBtn?.addEventListener('click', () => enterApp('guest'));

// Personelin veritabanindaki GERCEK rolunu (profiles.role) okur. Girisin
// kendisi basarili olsa bile (dogru e-posta/sifre), eger bu hesabin rolu bu
// sayfanin bekledigi rolle (pendingLoginRole: 'sales'/'admin') eslesmiyorsa
// -- ornegin bir satis hesabiyla yonetici.html'e girilmeye calisiliyorsa --
// oturum hemen kapatilir. Rol artik client'in soyledigi bir sey degil,
// veritabaninin (current_staff_role()/profiles) dogruladigi bir sey.
async function fetchStaffRole(userId){
  const { data, error } = await supabaseClient
    .from('profiles').select('role').eq('id', userId).maybeSingle();
  if(error) throw error;
  return data ? data.role : null;
}

async function tryPasswordLogin(){
  if(!supabaseClient) return;
  const email = (emailInput?.value || '').trim();
  const password = passwordInput.value;
  if(!email || !password){
    loginError.textContent = 'E-posta ve şifre gir.';
    loginError.hidden = false;
    return;
  }

  passwordSubmit.disabled = true;
  try {
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if(error) throw error;

    const role = await fetchStaffRole(data.user.id);
    if(role !== pendingLoginRole){
      await supabaseClient.auth.signOut();
      loginError.textContent = 'Bu hesabın bu sayfaya giriş yetkisi yok.';
      loginError.hidden = false;
      return;
    }

    loginError.hidden = true;
    passwordInput.value = '';
    enterApp(role);
  } catch(err){
    console.warn('Giriş başarısız.', err);
    loginError.textContent = 'Hatalı e-posta veya şifre.';
    loginError.hidden = false;
  } finally {
    passwordSubmit.disabled = false;
  }
}
passwordSubmit.addEventListener('click', tryPasswordLogin);
passwordInput.addEventListener('keydown', (e) => {
  if(e.key === 'Enter'){
    e.preventDefault();
    tryPasswordLogin();
  }
});
emailInput?.addEventListener('keydown', (e) => {
  if(e.key === 'Enter'){
    e.preventDefault();
    tryPasswordLogin();
  }
});

logoutBtn.addEventListener('click', async () => {
  if(supabaseClient) await supabaseClient.auth.signOut();
  sessionStorage.removeItem(EVENT_SESSION_KEY);
  currentRole = null;
  delete document.body.dataset.role;
  appRoot.hidden = true;
  loginGate.hidden = false;
  passwordInput.value = '';
  loginError.hidden = true;
  setBulkMode(false);

  // satis.html/yonetici.html tek-rollü sayfalar — rol seçim ekranı yok, o
  // yüzden çıkış sonrası init()'teki gibi şifre/e-posta alanı doğrudan
  // tekrar gösterilip odaklanmalı, yoksa kullanıcı boş bir login kartıyla kalır.
  const page = document.body.dataset.page;
  if(page === 'sales' || page === 'admin'){
    pendingLoginRole = page;
    passwordRow.hidden = false;
    emailInput?.focus();
  } else {
    passwordRow.hidden = true;
  }

  clearPushTimers();
  unsubscribeEventChannels();
  unsubscribeEventsListRealtime();
  eventsSynced = false;
  events = [];
  currentEventId = null;

  // Wipe any sales data pulled in during a privileged session — otherwise,
  // without a page reload, a guest login right after in the same tab would
  // still see it sitting in memory even though it's never fetched for guests.
  seatSales = new Array(seatStates.length).fill(null);
});

// Init: restore previous session (role + last-open event), otherwise show the login gate
(async function init(){
  setupFilters();

  const searchInput = document.getElementById('seatSearchInput');
  if(searchInput) {
    searchInput.addEventListener('input', applyFilterAndSearch);
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        searchInput.blur();
      }
    });
  }

  const clearSearchBtn = document.getElementById('clearSearchBtn');
  if(clearSearchBtn) {
    clearSearchBtn.addEventListener('click', () => {
      searchInput.value = '';
      applyFilterAndSearch();
    });
  }

  // index.html (data-page="public") = müşteri sitesi: personel girişi hiç
  // gösterilmez, her ziyaret otomatik misafir olarak başlar — diğer e-bilet
  // sitelerinde olduğu gibi. satis.html (data-page="sales") ve
  // yonetici.html (data-page="admin") kendi rolüne ait GERÇEK bir Supabase
  // Auth oturumu varsa (bkz. tryPasswordLogin) otomatik girer — eskiden
  // burada client'in kendi yazdığı bir sessionStorage bayrağına bakılıyordu,
  // yani "girişli" olmak sadece bir tarayıcı değişkeniydi. Artık gerçek
  // oturum + veritabanındaki profiles.role kontrol ediliyor.
  const page = document.body.dataset.page;

  if(page === 'sales' || page === 'admin'){
    pendingLoginRole = page;
    let role = null;
    let session = null;
    if(supabaseClient){
      try {
        const sessionRes = await supabaseClient.auth.getSession();
        session = sessionRes.data.session;
        if(session) role = await fetchStaffRole(session.user.id);
      } catch(err){
        console.warn('Oturum kontrol edilemedi.', err);
      }
    }
    if(role === page){
      enterApp(role);
    } else {
      // Bir oturum var ama rolü bu sayfayla eşleşmiyor (ör. satış hesabıyla
      // yönetici.html'e girilmiş) — yarım/karışık bir durumda bırakmamak
      // için oturumu burada kapatıyoruz, kullanıcı temiz bir giriş ekranı görür.
      if(session && supabaseClient) await supabaseClient.auth.signOut();
      passwordRow.hidden = false;
      emailInput?.focus();
    }
  } else {
    enterApp('guest');
  }
})();

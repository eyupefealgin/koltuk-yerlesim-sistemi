// ===== Supabase (cross-device sync) =====
const SUPABASE_URL = 'https://bkgcudklzrvkzodlqcij.supabase.co';
const SUPABASE_KEY = 'sb_publishable_jhO5H_R_KNEvZfqkZMdVsQ_40S_NuyZ';
// Named supabaseClient, not supabase — the library itself declares a global
// `var supabase`, and redeclaring that name with const/let is a SyntaxError
// that silently kills the whole script (no console output, nothing runs).
const supabaseClient = window.supabase
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY)
  : null;

let isApplyingRemote = false; // true while applying an incoming update, so we don't echo it straight back
let pushTimerSeatStates = null;
let pushTimerLayout = null;
let pushTimerVenueType = null;
let pushTimerSalesData = null;
let pushTimerTiers = null;
let pushTimerAccessibleSeats = null;

function clearPushTimers(){
  clearTimeout(pushTimerSeatStates);
  clearTimeout(pushTimerLayout);
  clearTimeout(pushTimerVenueType);
  clearTimeout(pushTimerSalesData);
  clearTimeout(pushTimerTiers);
  clearTimeout(pushTimerAccessibleSeats);
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

// Unique-enough code for a ticket's QR + check-in lookup. Not cryptographic —
// this app has no real auth, so it's already only as secure as "don't share
// your ticket code," same trust level as a printed paper ticket.
function generateTicketCode(){
  const time = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `TKT-${time}-${rand}`;
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

// Fixed stadium seating map for Futbol Sahası: bir saha, çevresinde gerçek
// stadyum bilet şemalarındaki gibi FİYAT KATMANINA göre renklenen tribün
// blokları (bkz. DEFAULT_STADIUM_TIERS/STADIUM_TIER_COLORS) — orijinal
// düzen, belirli bir gerçek stadyumun kopyası değil. Her blok, numaralı bir
// koltuk gibi seatStates/seatSales'te tek bir giriş; satış/senkron/veri
// azaltma hattının tamamı değişmeden kullanılıyor. Cinsiyet hâlâ satın alma
// adımında soruluyor, sadece artık blok rengini belirlemiyor (o iş fiyat
// katmanının).
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
    g.cols.forEach((c, i) => blocks.push({ label: `${label} ${i + 1}`, col: `${c} / ${c + 1}`, row: g.row, tier: g.tier }));
  });

  // ALT kenar (eski "Batı") — 2 fiyat katmanı, 6'şar blok.
  const fieldCols = [3, 4, 5, 6, 7, 8];
  const bottomAltLabel = DEFAULT_STADIUM_TIERS.find(t => t.id === 'dogu-maraton-alt').label;
  const bottomUstLabel = DEFAULT_STADIUM_TIERS.find(t => t.id === 'dogu-maraton-ust').label;
  fieldCols.forEach((c, i) => blocks.push({ label: `${bottomAltLabel} ${i + 1}`, col: `${c} / ${c + 1}`, row: '7 / 8', tier: 'dogu-maraton-alt' }));
  fieldCols.forEach((c, i) => blocks.push({ label: `${bottomUstLabel} ${i + 1}`, col: `${c} / ${c + 1}`, row: '8 / 9', tier: 'dogu-maraton-ust' }));

  const fieldRows = [3, 4, 5, 6];
  const leftAltLabel = DEFAULT_STADIUM_TIERS.find(t => t.id === 'guney-alt').label;
  const leftUstLabel = DEFAULT_STADIUM_TIERS.find(t => t.id === 'guney-ust').label;
  fieldRows.forEach((r, i) => blocks.push({ label: `${leftAltLabel} ${i + 1}`, col: '2 / 3', row: `${r} / ${r + 1}`, tier: 'guney-alt' }));
  fieldRows.forEach((r, i) => blocks.push({ label: `${leftUstLabel} ${i + 1}`, col: '1 / 2', row: `${r} / ${r + 1}`, tier: 'guney-ust' }));

  const rightAltLabel = DEFAULT_STADIUM_TIERS.find(t => t.id === 'kuzey-kale-arkasi-alt').label;
  const rightUstLabel = DEFAULT_STADIUM_TIERS.find(t => t.id === 'kuzey-kale-arkasi-ust').label;
  fieldRows.forEach((r, i) => blocks.push({ label: `${rightAltLabel} ${i + 1}`, col: '9 / 10', row: `${r} / ${r + 1}`, tier: 'kuzey-kale-arkasi-alt' }));
  fieldRows.forEach((r, i) => blocks.push({ label: `${rightUstLabel} ${i + 1}`, col: '10 / 11', row: `${r} / ${r + 1}`, tier: 'kuzey-kale-arkasi-ust' }));

  return blocks;
}
const STADIUM_BLOCKS = buildStadiumBlocks();

const ROLE_SESSION_KEY = 'koltukYerlesim.role';
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
// Client-side gate only — not real security, just separates the three
// experiences (misafir/satış/yönetici). Anyone can read these in the source.
const SALES_PASSWORD = 'satis123';
const ADMIN_PASSWORD = 'yonetici123';
let pendingLoginRole = null; // 'sales' | 'admin', while the password row is showing

const loginGate = document.getElementById('loginGate');
const appRoot = document.getElementById('appRoot');
const guestLoginBtn = document.getElementById('guestLoginBtn');
const salesLoginBtn = document.getElementById('salesLoginBtn');
const adminLoginBtn = document.getElementById('adminLoginBtn');
const passwordRow = document.getElementById('passwordRow');
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
const createDemoBtn = document.getElementById('createDemoBtn'); // sadece yonetici.html'de var
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
const revenueBreakdownEl = document.getElementById('revenueBreakdown');
const paymentBreakdownEl = document.getElementById('paymentBreakdown');

// Bulk selection toolbar
const singleModeBtn = document.getElementById('singleModeBtn');
const bulkModeBtn = document.getElementById('bulkModeBtn');
const accessModeBtn = document.getElementById('accessModeBtn');
const startBulkSaleBtn = document.getElementById('startBulkSaleBtn');
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
let modalHeldIdx = null;       // reserve_seat başarılı olduysa tutulan koltuk index'i
let holdCountdownInterval = null;
let holdExpiresAt = null;
let modalDiscount = null;      // { code, type, value } — uygulanmış indirim (varsa)
let DISCOUNT_CODES = [];       // geçerli etkinliğin indirim kodları (events.discount_codes)
let POSTER_URL = null;         // geçerli etkinliğin afiş görseli (events.poster_url)
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

  // Stadium mode replaces the cols/rows grid + accent bar with a fixed
  // stadium diagram (pitch + tribün blocks), so the layout controls that
  // only make sense for a rectangular grid are hidden in this mode.
  const stadium = isStadiumMode();
  layoutControlsEl.hidden = stadium;
  stadiumNoteEl.hidden = !stadium;
  screenAccentEl.hidden = stadium;
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
    renderStadiumGrid();
    return;
  }

  seatGrid.classList.remove('stadium-mode');
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
    const nextStates = new Array(total).fill('empty');
    const nextSales = new Array(total).fill(null);
    for(let i = 0; i < Math.min(seatStates.length, total); i++){
      nextStates[i] = seatStates[i];
      nextSales[i] = seatSales[i] || null;
    }
    seatStates = nextStates;
    seatSales = nextSales;
  }
  normalizeSalesLength();

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

function handleSeatClick(idx, btn){
  // Erişilebilirlik işaretleme sadece yönetici özelliği; koltuğun dolu/boş
  // durumundan bağımsız çalışır (satılmış bir koltuk da işaretlenebilir).
  if(isAdmin() && accessMode){
    toggleAccessibleSeat(idx, btn);
    return;
  }

  if(!canPurchase()) return;

  // Toplu seçim sadece personel özelliği — misafir kendi biletini tek tek
  // (ve sadece boş bir koltuk için) alabilir, bulkMode misafir için hiç
  // tetiklenmez (araç çubuğu editor-only).
  if(canEdit() && bulkMode){
    const state = seatStates[idx] || 'empty';
    if(state !== 'empty' || seatSales[idx]){
      toast('Bu koltuk dolu — toplu satış için boş koltuk seç.');
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

  openSeatModal(idx);
}

function updateBulkToolbar(){
  bulkCountEl.textContent = bulkSelected.size;
  startBulkSaleBtn.hidden = bulkSelected.size === 0;
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
  modalSeatIndices = [...bulkSelected];
  modalSeatIdx = null;
  modalGender = null;
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
  return payment === 'kart' ? 'Kart' : payment === 'nakit' ? 'Nakit' : null;
}

// Same-row immediate left/right neighbor check. Warns (doesn't block) when a
// gender assignment would put opposite genders directly side by side.
// Stadium blocks aren't laid out as simple grid rows, so this check doesn't
// apply there.
function findAdjacencyConflict(idx, gender){
  if(isStadiumMode()) return false;
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
  const state = seatStates[idx] || 'empty';
  const sale = seatSales[idx];
  const name = isStadiumMode() ? `${STADIUM_BLOCKS[idx].label} Bloğu` : (() => {
    const r = Math.floor(idx / cols) + 1;
    const c = (idx % cols) + 1;
    return `Koltuk ${r}-${c}`;
  })();
  let label = `${name}, durum: ${labelFor(state)}`;
  if(sale) label += `, satıldı: ${sale.label} ${sale.price}₺ (${paymentLabel(sale.payment) || '-'})`;
  if(ACCESSIBLE_SEATS.has(idx)) label += ', erişilebilir koltuk';
  return label;
}

function renderSeatVisual(btn, idx){
  const state = seatStates[idx] || 'empty';
  const sale = seatSales[idx];
  const stadium = isStadiumMode();

  // stadium-block must be re-applied every time, not just on the initial
  // render — finalizeSeatSale()/modalClearSeatBtn call this directly after a
  // sale, which used to wipe className back to just "seat" + state, losing
  // the stadium sizing class.
  const accessible = ACCESSIBLE_SEATS.has(idx);
  btn.className = ['seat', state !== 'empty' ? state : null, sale ? 'sold' : null, stadium ? 'stadium-block' : null, accessible ? 'accessible' : null].filter(Boolean).join(' ');
  btn.innerHTML = '';

  const num = document.createElement('span');
  num.className = 'seat-num';
  num.textContent = stadium ? STADIUM_BLOCKS[idx].label : idx + 1;
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
  const total = seatStates.length;
  const male = seatStates.filter(s => s === 'male').length;
  const female = seatStates.filter(s => s === 'female').length;
  const empty = total - male - female;
  const sold = seatSales.filter(Boolean).length;
  const revenue = seatSales.reduce((sum, s) => sum + (s ? s.price : 0), 0);

  document.getElementById('statTotal').textContent = total;
  document.getElementById('statMale').textContent = male;
  document.getElementById('statFemale').textContent = female;
  document.getElementById('statEmpty').textContent = empty;
  document.getElementById('statSold').textContent = sold;
  document.getElementById('statRevenue').textContent = `${revenue} ₺`;

  const occupancyPercent = total > 0 ? Math.round((sold / total) * 100) : 0;
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
function updateRevenueBreakdown(totalRevenue){
  const byTier = new Map();
  TICKET_TIERS.forEach(t => byTier.set(t.label, { count: 0, revenue: 0 }));
  const byPayment = { kart: 0, nakit: 0 };

  seatSales.forEach(s => {
    if(!s) return;
    if(!byTier.has(s.label)) byTier.set(s.label, { count: 0, revenue: 0 });
    const entry = byTier.get(s.label);
    entry.count++;
    entry.revenue += s.price;
    if(s.payment === 'kart' || s.payment === 'nakit') byPayment[s.payment] += s.price;
  });

  revenueBreakdownEl.innerHTML = '';
  byTier.forEach((entry, label) => {
    const row = document.createElement('div');
    row.className = 'revenue-row';
    row.innerHTML = `<span>${label}</span><span>${entry.count} adet — ${entry.revenue} ₺</span>`;
    revenueBreakdownEl.appendChild(row);
  });
  const totalRow = document.createElement('div');
  totalRow.className = 'revenue-row revenue-total';
  totalRow.innerHTML = `<span>Toplam Ciro</span><span>${totalRevenue} ₺</span>`;
  revenueBreakdownEl.appendChild(totalRow);

  paymentBreakdownEl.innerHTML = '';
  [['Kart', byPayment.kart], ['Nakit', byPayment.nakit]].forEach(([label, amount]) => {
    const row = document.createElement('div');
    row.className = 'revenue-row';
    row.innerHTML = `<span>${label}</span><span>${amount} ₺</span>`;
    paymentBreakdownEl.appendChild(row);
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

  seatSales.forEach(s => {
    if(!s) return;
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
      // renderGrid() will resize seatStates/seatSales to STADIUM_BLOCKS.length.
      if(pruneAccessibleSeats(STADIUM_BLOCKS.length)) pushAccessibleSeats();
      renderGrid();
      pushSeatStates();
      pushSalesData();
    } else if(seatStates.length !== cols * rows){
      // Coming back from the fixed stadium layout — its block count won't
      // line up with whatever cols/rows this venue type uses, so start
      // this venue type with a fresh empty grid rather than a length mismatch.
      generateGrid(false);
    } else {
      renderGrid();
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

// ===== Dinamik fiyatlandırma (etkinlik başına, sadece Yönetici) =====
// Doluluk oranı eşiği geçince bilet fiyatlarına yüzde zam uygulanır.
// Zam, indirim kodundan ÖNCE hesaplanır: önce zamlı fiyat bulunur,
// indirim onun üzerine iner.

function currentOccupancyPercent(){
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
  modalGender = null;
  modalTier = null;
  modalBuyerName = '';
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
  modalGender = null;
  modalTier = null;
  modalBuyerName = '';
  modalDiscount = null;
  modalHeldIdx = null;
}

document.querySelectorAll('.modal-step-panel[data-panel="gender"] [data-gender]').forEach(btn => {
  btn.addEventListener('click', () => {
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

  let text = `${tier.label}: `;
  if(surgeApplied && modalDiscount){
    text += `${tier.price}₺ → ${surged}₺ (yoğun talep) → ${finalPrice}₺ (kod: ${modalDiscount.code})`;
  } else if(surgeApplied){
    text += `${tier.price}₺ → ${surged}₺ (yoğun talep)`;
  } else if(modalDiscount){
    text += `${tier.price}₺ → ${finalPrice}₺ (kod: ${modalDiscount.code})`;
  } else {
    text += `${tier.price}₺`;
  }
  priceSummaryText.textContent = text;
}

document.querySelectorAll('.modal-step-panel[data-panel="payment"] [data-payment]').forEach(btn => {
  btn.addEventListener('click', () => {
    if(currentRole === 'guest') finalizeGuestPurchase(btn.dataset.payment);
    else finalizeSeatSale(btn.dataset.payment);
  });
});

function buildSaleRecord(tier, payment){
  const surged = effectiveTierPrice(tier);
  const finalPrice = computeDiscountedPrice(surged, modalDiscount);
  const changed = finalPrice !== tier.price;
  return {
    tier: tier.id, label: tier.label, price: finalPrice, payment,
    // originalPrice, biletin üzerinde "şu fiyattan şuna" gösterebilmek için —
    // fiyat zam veya indirim yüzünden liste fiyatından farklıysa doldurulur.
    originalPrice: changed ? tier.price : null,
    discountCode: modalDiscount ? modalDiscount.code : null,
    surged: surged !== tier.price,
    soldAt: new Date().toISOString(),   // satış grafiği bunu kullanıyor
    buyerName: modalBuyerName || null,
    ticketCode: generateTicketCode(),
    checkedIn: false,
  };
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

modalClearSeatBtn.addEventListener('click', () => {
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
function computeSeatLabelFor(idx, eventInfo){
  if(!eventInfo) return seatLabelFor(idx);
  if(eventInfo.venue_type === 'futbol') return `${STADIUM_BLOCKS[idx] ? STADIUM_BLOCKS[idx].label : idx} Bloğu`;
  const c = eventInfo.cols || 1;
  const r = Math.floor(idx / c) + 1;
  const col = (idx % c) + 1;
  return `Koltuk ${r}-${col}`;
}

// "Biletim Var" akışından açılan biletlerde iptal butonu gösterilir; burada
// tutuyoruz ki iptal RPC'si hangi etkinlik/koltuk olduğunu bilsin.
let ticketCancelContext = null;

function showTicketView(idx, sale, eventInfo){
  document.getElementById('ticketEventName').textContent = eventInfo ? eventInfo.name : (currentEventNameBadge.textContent || '');
  // eventInfo verilmişse (Biletim Var akışı) o etkinliğin kendi listesine
  // bak — ACCESSIBLE_SEATS o an ekranda açık olan BAŞKA bir etkinliğe ait
  // olabilir, index eşleşmesi yanlış koltuğu işaretli gösterebilirdi.
  const accessibleList = eventInfo ? (Array.isArray(eventInfo.accessible_seats) ? eventInfo.accessible_seats : []) : [...ACCESSIBLE_SEATS];
  const isAccessible = accessibleList.includes(idx);
  document.getElementById('ticketSeatLabel').textContent = computeSeatLabelFor(idx, eventInfo) + (isAccessible ? ' ♿' : '');
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
  const { eventId, idx, ticketCode } = ticketCancelContext;
  if(!confirm('Bu bilet iptal edilecek ve koltuk tekrar satışa açılacak. Emin misin?')) return;

  ticketCancelBtn.disabled = true;
  try {
    const { error } = await supabaseClient.rpc('cancel_ticket', {
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

  const idx = seatSales.findIndex(s => s && s.ticketCode === code);
  if(idx === -1){
    showCheckinResult('error', 'Bilet bulunamadı.');
    return;
  }

  const sale = seatSales[idx];
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

async function findMyTicket(){
  const code = myTicketCodeInput.value.trim();
  if(!code || !supabaseClient) return;

  myTicketFindBtn.disabled = true;
  myTicketResultEl.hidden = true;
  try {
    const [salesRes, eventsRes] = await Promise.all([
      supabaseClient.from('event_sales').select('event_id, seat_sales'),
      supabaseClient.from('events').select('id, name, venue_type, cols, rows, accessible_seats'),
    ]);
    if(salesRes.error) throw salesRes.error;
    if(eventsRes.error) throw eventsRes.error;

    let found = null;
    for(const row of salesRes.data || []){
      const idx = (row.seat_sales || []).findIndex(s => s && s.ticketCode === code);
      if(idx !== -1){
        found = { eventId: row.event_id, idx, sale: row.seat_sales[idx] };
        break;
      }
    }

    if(!found){
      myTicketResultEl.className = 'checkin-result error';
      myTicketResultEl.textContent = 'Bilet bulunamadı.';
      myTicketResultEl.hidden = false;
      return;
    }

    const ev = (eventsRes.data || []).find(e => e.id === found.eventId) || { name: '', venue_type: 'sinema', cols: 1 };
    closeMyTicketModal();
    ticketCancelContext = { eventId: found.eventId, idx: found.idx, ticketCode: code };
    showTicketView(found.idx, found.sale, ev);
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

document.addEventListener('keydown', (e) => {
  if(e.key !== 'Escape') return;
  if(!seatModalOverlay.hidden) closeSeatModal();
  if(!createEventOverlay.hidden) closeCreateEventModal();
  if(!ticketViewOverlay.hidden) closeTicketView();
  if(!checkinOverlay.hidden) closeCheckinModal();
  if(!myTicketOverlay.hidden) closeMyTicketModal();
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
      const sale = seatSales[idx];
      const seatNumStr = String(idx + 1);
      const label = isStadiumMode() ? STADIUM_BLOCKS[idx].label.toLowerCase() : `koltuk ${Math.floor(idx / cols) + 1}-${(idx % cols) + 1}`;

      const matchLabel = label.includes(query);
      const matchNum = seatNumStr === query;
      const matchState = labelFor(state).toLowerCase().includes(query);
      const matchTier = sale && sale.label.toLowerCase().includes(query);
      const matchPayment = sale && paymentLabel(sale.payment)?.toLowerCase().includes(query);

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

function encodeSeatStates(states){
  return states.map(s => SEAT_STATE_SHORT[s] || s);
}
function decodeSeatStates(states){
  return states.map(s => SEAT_STATE_LONG[s] || s);
}
function isSeatTaken(state){
  return !!state && state !== 'empty' && state !== 'e';
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

    const card = document.createElement('div');
    card.className = 'event-card';
    card.dataset.status = ev.status;

    card.innerHTML = `
      <div class="event-card-top">
        <span class="event-venue-badge"></span>
        <span class="event-status-badge" data-status="${ev.status}"></span>
      </div>
      <h3 class="event-card-name"></h3>
      <p class="event-card-date"></p>
      <div class="event-card-occupancy">
        <div class="capacity-bar-bg"><div class="capacity-bar" style="width:${pct}%"></div></div>
        <span>%${pct} dolu · ${total} koltuk</span>
      </div>
      <div class="event-card-actions">
        <button class="btn btn-gold btn-sm event-enter-btn" type="button">Gir</button>
        <button class="btn btn-ghost btn-sm admin-only event-archive-btn" type="button"></button>
        <button class="btn btn-ghost btn-sm admin-only event-delete-btn" type="button">Sil</button>
      </div>
    `;
    // Afiş varsa kartın en üstüne ekle. safeImageUrl sadece http(s) geçirir.
    const poster = safeImageUrl(ev.poster_url);
    if(poster){
      const img = document.createElement('img');
      img.className = 'event-card-poster';
      img.src = poster;
      img.alt = '';
      img.loading = 'lazy';
      // Kırık/erişilemeyen görsel kartı bozmasın diye kendini gizlesin.
      img.addEventListener('error', () => img.remove());
      card.prepend(img);
    }

    // textContent (not innerHTML) for anything derived from user-entered
    // event names — avoids injecting HTML from an admin-typed event name.
    card.querySelector('.event-venue-badge').textContent = venueLabel;
    card.querySelector('.event-status-badge').textContent = statusLabel;
    card.querySelector('.event-card-name').textContent = ev.name;
    card.querySelector('.event-card-date').textContent = formatEventDate(ev.event_date);
    card.querySelector('.event-archive-btn').textContent = ev.status === 'archived' ? 'Aktifleştir' : 'Arşivle';

    card.querySelector('.event-enter-btn').addEventListener('click', () => enterEvent(ev.id, ev.name));
    card.querySelector('.event-archive-btn').addEventListener('click', () => toggleArchiveEvent(ev));
    card.querySelector('.event-delete-btn').addEventListener('click', () => deleteEventRow(ev));

    eventGridEl.appendChild(card);
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
  const isFutbol = newEventVenue.value === 'futbol';
  newEventDimsRow.hidden = isFutbol;
  newEventStadiumNote.hidden = !isFutbol;
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

  let evCols, evRows, states;
  if(vType === 'futbol'){
    evCols = STADIUM_BLOCKS.length;
    evRows = 1;
    states = new Array(STADIUM_BLOCKS.length).fill('empty');
  } else {
    evCols = Math.min(40, Math.max(1, Number(newEventCols.value) || 10));
    evRows = Math.min(30, Math.max(1, Number(newEventRows.value) || 8));
    states = new Array(evCols * evRows).fill('empty');
  }

  submitCreateEventBtn.disabled = true;
  try {
    const { data, error } = await supabaseClient.from('events').insert({
      name, event_date: date, venue_type: vType,
      cols: evCols, rows: evRows, seat_states: encodeSeatStates(states),
      tiers: vType === 'futbol' ? DEFAULT_STADIUM_TIERS : DEFAULT_TIERS,
      poster_url: safeImageUrl(newEventPoster.value), status: 'active',
    }).select().single();
    if(error) throw error;

    const { error: salesError } = await supabaseClient.from('event_sales').insert({
      event_id: data.id,
      seat_sales: new Array(states.length).fill(null),
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

// ===== Demo verisi =====
// Bos bir veritabaniyla acilan site "Henuz etkinlik yok" gosteriyor; bu
// buton sunum/portfolyo icin gercekci gorunumlu ornek etkinlikler uretir.
// Mevcut veriyi SILMEZ, sadece ekler.

const DEMO_FIRST_NAMES = ['Ahmet', 'Elif', 'Mehmet', 'Zeynep', 'Can', 'Ayşe', 'Burak', 'Deniz', 'Emre', 'Selin', 'Kaan', 'Merve'];
const DEMO_LAST_NAMES = ['Yılmaz', 'Kaya', 'Demir', 'Şahin', 'Çelik', 'Aydın', 'Arslan', 'Doğan'];

// Afişler Unsplash'ten, serbestçe kullanılabilen fotoğraflar.
const DEMO_EVENTS = [
  { name: 'Yıldızlararası — Özel Gösterim', venue: 'sinema',  cols: 12, rows: 8,  days: 5,  fill: 0.35,
    poster: 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=600&q=70' },
  { name: 'Hamlet',                          venue: 'tiyatro', cols: 10, rows: 6,  days: 12, fill: 0.50,
    poster: 'https://images.unsplash.com/photo-1503095396549-807759245b35?w=600&q=70' },
  { name: 'Yaz Konseri 2026',                venue: 'konser',  cols: 16, rows: 10, days: 20, fill: 0.18,
    poster: 'https://images.unsplash.com/photo-1459749411175-04bf5292ceea?w=600&q=70' },
  { name: 'Şehir Derbisi',                   venue: 'futbol',  cols: null, rows: null, days: 30, fill: 0.40,
    poster: 'https://images.unsplash.com/photo-1522778119026-d647f0596c20?w=600&q=70' },
];

function demoBuyerName(i){
  return `${DEMO_FIRST_NAMES[i % DEMO_FIRST_NAMES.length]} ${DEMO_LAST_NAMES[(i * 3) % DEMO_LAST_NAMES.length]}`;
}

function demoFutureDate(daysAhead){
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  return d.toISOString().slice(0, 10);
}

async function createDemoData(){
  if(!supabaseClient) return;
  if(!confirm('4 örnek etkinlik ve bir miktar satış oluşturulacak. Mevcut etkinlikler silinmez. Devam edilsin mi?')) return;

  createDemoBtn.disabled = true;
  try {
    for(let e = 0; e < DEMO_EVENTS.length; e++){
      const d = DEMO_EVENTS[e];
      const isStadium = d.venue === 'futbol';
      const evCols = isStadium ? STADIUM_BLOCKS.length : d.cols;
      const evRows = isStadium ? 1 : d.rows;
      const total = evCols * evRows;

      const states = new Array(total).fill('empty');
      const sales = new Array(total).fill(null);

      // Deterministik ama dagilmis gorunen bir doluluk deseni — her seferinde
      // ayni sonucu verir, rastgele bir sey yok.
      for(let i = 0; i < total; i++){
        if(((i * 7 + e * 3) % 11) / 11 >= d.fill) continue;

        const tier = isStadium
          ? DEFAULT_STADIUM_TIERS.find(t => t.id === STADIUM_BLOCKS[i].tier)
          : DEFAULT_TIERS[(i + e) % DEFAULT_TIERS.length];
        states[i] = ((i + e) % 2 === 0) ? 'male' : 'female';

        // Satislari son 10 gune yay ki satis grafigi anlamli gorunsun.
        const soldDaysAgo = (i * 3 + e) % 10;
        const soldAt = new Date();
        soldAt.setDate(soldAt.getDate() - soldDaysAgo);
        soldAt.setHours(10 + (i % 10), (i * 7) % 60, 0, 0);

        sales[i] = {
          tier: tier.id, label: tier.label, price: tier.price,
          payment: (i % 3 === 0) ? 'nakit' : 'kart',
          originalPrice: null, discountCode: null, surged: false,
          soldAt: soldAt.toISOString(),
          buyerName: demoBuyerName(i + e),
          ticketCode: generateTicketCode(),
          checkedIn: i % 5 === 0,   // bir kismi kapidan giris yapmis olsun
        };
      }

      const { data, error } = await supabaseClient.from('events').insert({
        name: d.name,
        event_date: demoFutureDate(d.days),
        venue_type: d.venue,
        cols: evCols, rows: evRows,
        seat_states: encodeSeatStates(states),
        tiers: isStadium ? DEFAULT_STADIUM_TIERS : DEFAULT_TIERS,
        poster_url: d.poster,
        // Tiyatro etkinliginde dinamik fiyatlandirma acik olsun ki ozellik
        // demoda gorunur olsun (doluluk %50, esik %40 -> zam aktif).
        dynamic_pricing: e === 1
          ? { enabled: true, threshold: 40, increase: 15 }
          : { ...DEFAULT_DYNAMIC },
        discount_codes: e === 0
          ? [{ code: 'ERKEN20', type: 'percent', value: 20, maxUses: 50, usedCount: 3 }]
          : [],
        status: 'active',
      }).select().single();
      if(error) throw error;

      const { error: salesError } = await supabaseClient.from('event_sales').insert({
        event_id: data.id, seat_sales: sales,
      });
      if(salesError) throw salesError;
    }

    await loadEvents();
    toast('Demo verisi oluşturuldu.');
  } catch(err){
    console.warn('Demo verisi oluşturulamadı.', err);
    toast('Demo verisi oluşturulamadı — buluta bağlanılamadı.');
  } finally {
    createDemoBtn.disabled = false;
  }
}

createDemoBtn?.addEventListener('click', createDemoData);

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
  sessionStorage.setItem(ROLE_SESSION_KEY, role);
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

// guestLoginBtn admin.html'de yok (personel-only sayfa), salesLoginBtn/
// adminLoginBtn index.html'de yok (misafir-only sayfa) — bkz. admin.html.
guestLoginBtn?.addEventListener('click', () => enterApp('guest'));

function showPasswordRow(role){
  pendingLoginRole = role;
  passwordRow.hidden = false;
  loginError.hidden = true;
  passwordInput.value = '';
  passwordInput.focus();
}
salesLoginBtn?.addEventListener('click', () => showPasswordRow('sales'));
adminLoginBtn?.addEventListener('click', () => showPasswordRow('admin'));

function tryPasswordLogin(){
  const expected = pendingLoginRole === 'admin' ? ADMIN_PASSWORD : SALES_PASSWORD;
  if(passwordInput.value === expected){
    loginError.hidden = true;
    passwordInput.value = '';
    enterApp(pendingLoginRole);
  } else {
    loginError.hidden = false;
  }
}
passwordSubmit.addEventListener('click', tryPasswordLogin);
passwordInput.addEventListener('keydown', (e) => {
  if(e.key === 'Enter'){
    e.preventDefault();
    tryPasswordLogin();
  }
});

logoutBtn.addEventListener('click', () => {
  sessionStorage.removeItem(ROLE_SESSION_KEY);
  sessionStorage.removeItem(EVENT_SESSION_KEY);
  currentRole = null;
  pendingLoginRole = null;
  delete document.body.dataset.role;
  appRoot.hidden = true;
  loginGate.hidden = false;
  passwordRow.hidden = true;
  passwordInput.value = '';
  loginError.hidden = true;
  setBulkMode(false);

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
(function init(){
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
  // yonetici.html (data-page="admin") kendi rolüne ait bir oturum varsa
  // otomatik girer, yoksa doğrudan o role ait şifre alanına odaklanır
  // (rol seçim ekranı yok — hangi role ait olduğu URL'den zaten belli).
  const page = document.body.dataset.page;
  const existingRole = sessionStorage.getItem(ROLE_SESSION_KEY);

  if(page === 'sales' || page === 'admin'){
    if(existingRole === page){
      enterApp(existingRole);
    } else {
      pendingLoginRole = page;
      passwordInput.focus();
    }
  } else {
    enterApp('guest');
  }
})();

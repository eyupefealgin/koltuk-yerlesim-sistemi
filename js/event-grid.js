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
const newEventEndDate = document.getElementById('newEventEndDate');
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

// Seat modal (satış akışı: bilet türü → alıcı → ödeme)
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

// Bitiş tarihi (oluştururken de girilebilir, sonradan burada değiştirilebilir)
const eventEndDateInput = document.getElementById('eventEndDateInput');
const saveEndDateBtn = document.getElementById('saveEndDateBtn');

// Etkinlik başına ödeme yöntemi seçimi (Kart/Nakit) — bkz. paymentChoiceButtons
const paymentMethodKartCheckbox = document.getElementById('paymentMethodKart');
const paymentMethodNakitCheckbox = document.getElementById('paymentMethodNakit');
const savePaymentMethodsBtn = document.getElementById('savePaymentMethodsBtn');
const newEventPaymentRow = document.getElementById('newEventPaymentRow');
const newEventPaymentKart = document.getElementById('newEventPaymentKart');
const newEventPaymentNakit = document.getElementById('newEventPaymentNakit');

// Genel Etkinlik: oluşturma anında sınırlı/sınırsız bilet seçimi (bkz.
// toggleNewEventDimsVisibility/createEvent) — varsayılan pasif (sınırsız).
const newEventLimitedRow = document.getElementById('newEventLimitedRow');
const newEventLimitedCheckbox = document.getElementById('newEventLimitedCheckbox');
const newEventCapacityInput = document.getElementById('newEventCapacityInput');
const newEventMaxPerPurchaseRow = document.getElementById('newEventMaxPerPurchaseRow');
const newEventMaxPerPurchaseInput = document.getElementById('newEventMaxPerPurchaseInput');

// Genel Etkinlik: tek ücretsiz giriş havuzunun kapasitesi + bilet türü/
// fiyat (tierPanelSection) ve indirim kodu (discountPanelSection) panelleri
// — ikisi de fiyatlı bilet varsayar, Genel Etkinlik'te anlamsız (bkz.
// renderVenueAccent).
const generalCapacitySection = document.getElementById('generalCapacitySection');
const generalLimitedCheckbox = document.getElementById('generalLimitedCheckbox');
const generalCapacityInputRow = document.getElementById('generalCapacityInputRow');
const generalCapacityInput = document.getElementById('generalCapacityInput');
const saveGeneralCapacityBtn = document.getElementById('saveGeneralCapacityBtn');
const generalMaxPerPurchaseInput = document.getElementById('generalMaxPerPurchaseInput');
const saveGeneralMaxPerPurchaseBtn = document.getElementById('saveGeneralMaxPerPurchaseBtn');

// Genel Etkinlik: tek seferde katılım modalındaki miktar adımı (bkz.
// joinGeneralEvent/seat-purchase.js) — confirm() yerine gerçek bir giriş.
const generalQuantityInput = document.getElementById('generalQuantityInput');
const generalQuantityNote = document.getElementById('generalQuantityNote');
const generalQuantityContinueBtn = document.getElementById('generalQuantityContinueBtn');
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

// E-posta+şifre ile giriş — gerçek Supabase Auth (signUp/signInWithPassword),
// bkz. index.html notu. Sadece misafir sayfasında (index.html) var,
// satis.html/yonetici.html'de yok — bu yüzden hepsi ?. ile erişiliyor.
const emailLoginBtn = document.getElementById('emailLoginBtn');
const emailLoginOverlay = document.getElementById('emailLoginOverlay');
const emailLoginClose = document.getElementById('emailLoginClose');
const emailLoginEmailInput = document.getElementById('emailLoginEmailInput');
const emailLoginPasswordInput = document.getElementById('emailLoginPasswordInput');
const emailLoginSendBtn = document.getElementById('emailLoginSendBtn');
const emailLoginErrorEl = document.getElementById('emailLoginError');
const emailLoginInfoNote = document.getElementById('emailLoginInfoNote');
const forgotPasswordBtn = document.getElementById('forgotPasswordBtn');
const forgotEmailInput = document.getElementById('forgotEmailInput');
const forgotSendBtn = document.getElementById('forgotSendBtn');
const forgotBackBtn = document.getElementById('forgotBackBtn');
const forgotErrorEl = document.getElementById('forgotErrorEl');
const forgotInfoNote = document.getElementById('forgotInfoNote');
const resetPasswordInput = document.getElementById('resetPasswordInput');
const resetConfirmBtn = document.getElementById('resetConfirmBtn');
const resetErrorEl = document.getElementById('resetErrorEl');
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
let modalHeldIdx = null;       // reserve_seat/reserve_stadium_seat başarılı olduysa tutulan TEK koltuk index'i (blok içindeyse pos)
let modalHeldIndices = null;   // toplu seçimde tutulan koltuk index'lerinin (ya da blok pos'larının) dizisi
let holdCountdownInterval = null;
let holdExpiresAt = null;
let modalDiscount = null;      // { code, type, value } — uygulanmış indirim (varsa)
let DISCOUNT_CODES = [];       // geçerli etkinliğin indirim kodları (events.discount_codes)
let PAYMENT_METHODS = ['kart', 'nakit']; // geçerli etkinliğin kabul ettiği ödeme yöntemleri (events.payment_methods)
let POSTER_URL = null;         // geçerli etkinliğin afiş görseli (events.poster_url)
let EVENT_NOTE = null;         // geçerli etkinliğin notu (events.note) — herkese açık
let EVENT_END_DATE = null;     // geçerli etkinliğin bitiş tarihi (events.end_date)
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

  // Filtre çipleri (Tümü/Boş/Satılan) havuzlu modda anlamsız —
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
    : 'Bir koltuğa tıkla: bilet türü ve ödeme yöntemini seç';
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

startBulkSaleBtn.addEventListener('click', async () => {
  if(bulkSelected.size === 0) return;
  if(!requireGuestLogin()) return;

  const requested = [...bulkSelected];
  const blockIdx = activeBlockIdx; // null ise klasik ızgara
  let indices = requested;

  // Seçimdeki her koltuğu tek tek tut — biri az önce başkası tarafından
  // alınmış/bakılıyorsa sadece o düşer, kalanlarla devam edilir (bkz.
  // reserveBulkSeats). currentEventId yoksa (yerel/bağlantısız durum) hiç
  // rezervasyon denenmez, eskisi gibi doğrudan devam eder.
  if(currentEventId){
    const { held, failed } = await reserveBulkSeats(requested, blockIdx);
    if(!held.length){
      toast('Seçtiğin koltuklara şu anda başka biri bakıyor, birazdan tekrar dene.');
      return;
    }
    if(failed){
      requested.filter(i => !held.includes(i)).forEach(i => {
        bulkSelected.delete(i);
        const btn = seatButtons[i];
        if(btn) btn.classList.remove('bulk-selected');
      });
      updateBulkToolbar();
      toast(`${failed} koltuk az önce başkası tarafından alındı — kalan ${held.length} koltukla devam ediliyor.`);
    }
    indices = held;
    modalHeldIndices = held;
    startHoldCountdown();
  }

  modalSeatIndices = indices;
  modalSeatIdx = null;
  modalBlockSeatPos = null;
  // modalGender artık kullanıcıya sorulmuyor (bkz. openSeatModal) — sabit
  // bir "dolu" işareti, seat_states/purchase_seat atomik kontrolü için.
  modalGender = 'male';

  // Blok içindeki çoklu seçim: tür zaten blok tarafından sabit — tür paneli
  // atlanıp doğrudan alıcı bilgisine geçiliyor.
  if(blockIdx !== null){
    modalTier = STADIUM_BLOCKS[blockIdx].tier;
    seatModalTitle.textContent = `${STADIUM_BLOCKS[blockIdx].label} — ${modalSeatIndices.length} Koltuk`;
    openBuyerPanelForBlockSeat();
    seatModalOverlay.hidden = false;
    return;
  }

  modalTier = null;
  seatModalTitle.textContent = `${modalSeatIndices.length} Koltuk`;
  renderModalTierButtons();
  showModalPanel('tier');
  seatModalOverlay.hidden = false;
});

function labelFor(state){
  return isSeatTaken(state) ? 'Satıldı' : 'Boş';
}

// Genel Etkinlik'te "Sınırlı Bilet" kapalıysa GENERAL_CAPACITY Infinity
// olur (bkz. filters-sync.js applySeatsPayload) — ekrana ham "Infinity"
// yazmamak için tek bir yerden metne çeviriyoruz.
function capacityLabel(capacity){
  return capacity === Infinity ? '∞' : String(capacity);
}

function paymentLabel(payment){
  const normalized = PAYMENT_LONG[payment] || payment;
  return normalized === 'kart' ? 'Kart' : normalized === 'nakit' ? 'Nakit' : null;
}

function seatAriaLabel(idx){
  if(isPooledMode()){
    const block = poolBlocks()[idx];
    const capacity = block.capacity;
    const sold = blockSoldCount(idx);
    let label = isStadiumMode()
      ? `${block.label} Bloğu, ${sold}/${capacityLabel(capacity)} satıldı`
      : `${block.label}, ${sold}/${capacityLabel(capacity)} katıldı`;
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
    fraction.textContent = `${sold}/${capacityLabel(capacity)}`;
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

    btn.title = full
      ? (isStadiumMode() ? 'Bu blok dolu.' : 'Bu etkinlik dolu.')
      : (capacity === Infinity ? 'Sınırsız katılım.' : `${capacity - sold} yer kaldı.`);
    btn.setAttribute('aria-label', seatAriaLabel(idx));
    return;
  }

  // ---- Diğer venue türleri: tek koltuk = tek alıcı, cinsiyet ayrımı yok ----
  const state = seatStates[idx] || 'empty';
  const sale = seatSales[idx];
  // Durum sınıfı 'taken'/'empty' — ham state değeri (hâlâ dahili olarak
  // 'male' olabilir, bkz. openSeatModal) artık CSS'e hiç sızmıyor, eski
  // verideki 'female' işaretli koltuklar da yenilerle aynı görünür.
  // "Boş" filtre çipi .seat:not(.taken) arıyor.
  btn.className = ['seat', isSeatTaken(state) ? 'taken' : 'empty', sale ? 'sold' : null, accessible ? 'accessible' : null].filter(Boolean).join(' ');
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

  // Havuzlu modlarda (futbol/Genel Etkinlik) seatStates[idx] dolu/boş değil
  // satılan bilet SAYISI (bkz. poolBlocks/blockSoldCount) — toplam kapasite/
  // satılan adet üzerinden hesaplanıyor.
  if(pooled){
    const blocks = poolBlocks();
    total = blocks.reduce((sum, b) => sum + b.capacity, 0);
    taken = blocks.reduce((sum, b, idx) => sum + blockSoldCount(idx), 0);
    sold = taken;
  } else {
    total = seatStates.length;
    taken = seatStates.filter(isSeatTaken).length;
    sold = seatSales.filter(Boolean).length;
  }

  const revenue = allSalesFlat().reduce((sum, s) => sum + s.price, 0);

  document.getElementById('statTotal').textContent = capacityLabel(total);
  document.getElementById('statEmpty').textContent = total === Infinity ? '∞' : total - taken;
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


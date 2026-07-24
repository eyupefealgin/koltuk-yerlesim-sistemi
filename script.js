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

function clearPushTimers(){
  clearTimeout(pushTimerSeatStates);
  clearTimeout(pushTimerLayout);
  clearTimeout(pushTimerVenueType);
  clearTimeout(pushTimerSalesData);
  clearTimeout(pushTimerTiers);
}

// Ticket tiers are per-event (stored in event_sales.tiers) — this is just
// the seed used when a new event is created / before any event is loaded.
const DEFAULT_TIERS = [
  { id: 'standart', label: 'Standart', price: 100 },
  { id: 'vip', label: 'VIP', price: 250 },
  { id: 'ogrenci', label: 'Öğrenci', price: 60 },
];
let TICKET_TIERS = [...DEFAULT_TIERS];

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

// Fixed stadium seating map for Futbol Sahası: a pitch in the center with
// named tribün blocks arranged around it (Doğu/Batı = uzun kenarlar,
// Kuzey/Güney = kısa kenarlar), each stand split into an inner tier (nearer
// the pitch) and outer tier (back row), plus corner special blocks —
// original layout, not a copy of any specific real stadium's chart. Each
// block is just one entry in seatStates/seatSales, same as a numbered seat,
// so the whole sale/sync/data-minimization pipeline is reused unchanged.
//
// Grid is exactly 10 columns × 8 rows with no unused tracks (1-2 = left
// tier, 3-8 = pitch, 9-10 = right tier; same idea for rows) — an earlier
// version declared 11 columns while only using 10, leaving a dead column
// that pushed the whole diagram off-center.
function buildStadiumBlocks(){
  const blocks = [];
  const fieldCols = [3, 4, 5, 6, 7, 8];
  const innerLetters = ['A', 'B', 'C', 'D', 'E', 'F'];
  const outerLetters = ['G', 'H', 'I', 'J', 'K', 'L'];

  fieldCols.forEach((c, i) => blocks.push({ label: `Doğu ${innerLetters[i]}`, col: `${c} / ${c + 1}`, row: '2 / 3' }));
  fieldCols.forEach((c, i) => blocks.push({ label: `Doğu ${outerLetters[i]}`, col: `${c} / ${c + 1}`, row: '1 / 2' }));
  fieldCols.forEach((c, i) => blocks.push({ label: `Batı ${innerLetters[i]}`, col: `${c} / ${c + 1}`, row: '7 / 8' }));
  fieldCols.forEach((c, i) => blocks.push({ label: `Batı ${outerLetters[i]}`, col: `${c} / ${c + 1}`, row: '8 / 9' }));

  const fieldRows = [3, 4, 5, 6];
  const shortInner = ['A', 'B', 'C', 'D'];
  const shortOuter = ['E', 'F', 'G', 'H'];

  fieldRows.forEach((r, i) => blocks.push({ label: `Kuzey ${shortInner[i]}`, col: '2 / 3', row: `${r} / ${r + 1}` }));
  fieldRows.forEach((r, i) => blocks.push({ label: `Kuzey ${shortOuter[i]}`, col: '1 / 2', row: `${r} / ${r + 1}` }));
  fieldRows.forEach((r, i) => blocks.push({ label: `Güney ${shortInner[i]}`, col: '9 / 10', row: `${r} / ${r + 1}` }));
  fieldRows.forEach((r, i) => blocks.push({ label: `Güney ${shortOuter[i]}`, col: '10 / 11', row: `${r} / ${r + 1}` }));

  blocks.push({ label: 'VIP', col: '1 / 3', row: '1 / 3' });
  blocks.push({ label: 'Misafir', col: '9 / 11', row: '1 / 3' });
  blocks.push({ label: 'Basın', col: '1 / 3', row: '7 / 9' });
  blocks.push({ label: 'Protokol', col: '9 / 11', row: '7 / 9' });

  return blocks;
}
const STADIUM_BLOCKS = buildStadiumBlocks();

const ROLE_SESSION_KEY = 'koltukYerlesim.role';
const EVENT_SESSION_KEY = 'koltukYerlesim.eventId';
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
const createEventBtn = document.getElementById('createEventBtn');
const createEventOverlay = document.getElementById('createEventOverlay');
const createEventClose = document.getElementById('createEventClose');
const newEventName = document.getElementById('newEventName');
const newEventDate = document.getElementById('newEventDate');
const newEventVenue = document.getElementById('newEventVenue');
const newEventCols = document.getElementById('newEventCols');
const newEventRows = document.getElementById('newEventRows');
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
const startBulkSaleBtn = document.getElementById('startBulkSaleBtn');
const bulkCountEl = document.getElementById('bulkCount');

// Seat modal (satış akışı: cinsiyet → bilet türü → ödeme)
const seatModalOverlay = document.getElementById('seatModalOverlay');
const seatModalTitle = document.getElementById('seatModalTitle');
const seatModalClose = document.getElementById('seatModalClose');
const modalTierButtonsEl = document.getElementById('modalTierButtons');
const modalInfoTextEl = document.getElementById('modalInfoText');
const modalClearSeatBtn = document.getElementById('modalClearSeatBtn');

let cols = 10;
let rows = 8;
let seatStates = [];
let seatSales = [];
let seatButtons = [];
let currentFilter = 'all';

let bulkMode = false;
let bulkSelected = new Set();

let modalSeatIdx = null;      // single-seat flow
let modalSeatIndices = null;  // bulk flow (array of indices)
let modalGender = null;
let modalTier = null;

function canEdit(){
  return currentRole === 'admin' || currentRole === 'sales';
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

  if(preserve && seatStates.length){
    const nextStates = new Array(total).fill('empty');
    const nextSales = new Array(total).fill(null);
    for(let i = 0; i < Math.min(seatStates.length, total); i++){
      nextStates[i] = seatStates[i];
      nextSales[i] = seatSales[i] || null;
    }
    seatStates = nextStates;
    seatSales = nextSales;
  } else {
    seatStates = new Array(total).fill('empty');
    seatSales = new Array(total).fill(null);
  }

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
    if(bulkMode && bulkSelected.has(idx)) btn.classList.add('bulk-selected');
    btn.addEventListener('click', () => handleSeatClick(idx, btn));
    seatGrid.appendChild(btn);
    seatButtons.push(btn);
  });

  updateStats();
  applyFilterAndSearch();
}

function handleSeatClick(idx, btn){
  if(!canEdit()) return;

  if(bulkMode){
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
  } else {
    openSeatModal(idx);
  }
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
  btn.className = ['seat', state !== 'empty' ? state : null, sale ? 'sold' : null, stadium ? 'stadium-block' : null].filter(Boolean).join(' ');
  btn.innerHTML = '';

  const num = document.createElement('span');
  num.className = 'seat-num';
  num.textContent = stadium ? STADIUM_BLOCKS[idx].label : idx + 1;
  btn.appendChild(num);

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
      // renderGrid() will resize seatStates/seatSales to STADIUM_BLOCKS.length.
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

// ===== Seat modal: cinsiyet → bilet türü → ödeme yöntemi =====

function showModalPanel(name){
  document.querySelectorAll('.modal-step-panel').forEach(p => p.hidden = p.dataset.panel !== name);
}

function renderModalTierButtons(){
  modalTierButtonsEl.innerHTML = '';
  TICKET_TIERS.forEach(tier => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'choice-btn';
    btn.textContent = `${tier.label} (${tier.price}₺)`;
    btn.addEventListener('click', () => {
      modalTier = tier.id;
      showModalPanel('payment');
    });
    modalTierButtonsEl.appendChild(btn);
  });
}

function openSeatModal(idx){
  modalSeatIdx = idx;
  modalSeatIndices = null;
  modalGender = null;
  modalTier = null;

  if(isStadiumMode()){
    seatModalTitle.textContent = `${STADIUM_BLOCKS[idx].label} Bloğu`;
  } else {
    const r = Math.floor(idx / cols) + 1;
    const c = (idx % cols) + 1;
    seatModalTitle.textContent = `Koltuk ${r}-${c}`;
  }

  const state = seatStates[idx] || 'empty';
  const sale = seatSales[idx];

  if(state !== 'empty' || sale){
    const parts = [`Cinsiyet: ${labelFor(state)}`];
    if(sale) parts.push(`Bilet: ${sale.label} — ${sale.price}₺ (${paymentLabel(sale.payment) || '-'})`);
    modalInfoTextEl.textContent = parts.join(' · ');
    showModalPanel('info');
  } else {
    renderModalTierButtons();
    showModalPanel('gender');
  }

  seatModalOverlay.hidden = false;
}

function closeSeatModal(){
  seatModalOverlay.hidden = true;
  modalSeatIdx = null;
  modalSeatIndices = null;
  modalGender = null;
  modalTier = null;
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

document.querySelectorAll('.modal-step-panel[data-panel="payment"] [data-payment]').forEach(btn => {
  btn.addEventListener('click', () => finalizeSeatSale(btn.dataset.payment));
});

function finalizeSeatSale(payment){
  const targets = modalSeatIndices && modalSeatIndices.length
    ? modalSeatIndices
    : (modalSeatIdx !== null ? [modalSeatIdx] : []);
  if(!targets.length) return;

  const tier = TICKET_TIERS.find(t => t.id === modalTier);
  targets.forEach(idx => {
    seatStates[idx] = modalGender;
    seatSales[idx] = tier ? { tier: tier.id, label: tier.label, price: tier.price, payment } : null;
    if(seatButtons[idx]) renderSeatVisual(seatButtons[idx], idx);
  });

  updateStats();
  pushSeatStates();
  pushSalesData();

  const wasBulk = targets.length > 1;
  closeSeatModal();

  if(wasBulk){
    bulkSelected.clear();
    updateBulkToolbar();
    setBulkMode(false);
    toast(`${targets.length} koltuk kaydedildi.`);
  } else {
    toast('Koltuk kaydedildi.');
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
document.addEventListener('keydown', (e) => {
  if(e.key !== 'Escape') return;
  if(!seatModalOverlay.hidden) closeSeatModal();
  if(!createEventOverlay.hidden) closeCreateEventModal();
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

function pushSeatStates(){
  if(!supabaseClient || isApplyingRemote || !currentEventId) return;
  clearTimeout(pushTimerSeatStates);
  pushTimerSeatStates = setTimeout(async () => {
    const { error } = await supabaseClient.from('events').update({
      seat_states: seatStates,
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
      seat_states: seatStates,
      venue_type: venueType,
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

function pushTiers(){
  if(!supabaseClient || isApplyingRemote || !currentEventId) return;
  clearTimeout(pushTimerTiers);
  pushTimerTiers = setTimeout(async () => {
    const { error } = await supabaseClient.from('event_sales').update({
      tiers: TICKET_TIERS,
      updated_at: new Date().toISOString(),
    }).eq('event_id', currentEventId);
    if(error) console.warn('Supabase (event_sales) güncelleme hatası:', error.message);
  }, 400);
}

function applySeatsPayload(row){
  if(!row) return;
  isApplyingRemote = true;

  cols = row.cols;
  rows = row.rows;
  seatStates = Array.isArray(row.seat_states) ? row.seat_states : [];
  if(row.venue_type && VENUE_TYPES[row.venue_type]) venueType = row.venue_type;
  normalizeSalesLength();

  colsInput.value = cols;
  rowsInput.value = rows;
  updateTotalPreview();
  renderVenueAccent();
  renderGrid();

  isApplyingRemote = false;
}

function applySalesPayload(row){
  if(!row) return;
  isApplyingRemote = true;

  seatSales = Array.isArray(row.seat_sales) ? row.seat_sales : [];
  normalizeSalesLength();
  TICKET_TIERS = Array.isArray(row.tiers) && row.tiers.length ? row.tiers : [...DEFAULT_TIERS];

  renderGrid();
  renderTierList();

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
    if(data) applySeatsPayload(data);
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
  const filled = states.filter(s => s && s !== 'empty').length;
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

function renderEventList(){
  eventGridEl.innerHTML = '';
  eventEmptyHint.hidden = events.length > 0;

  const sorted = [...events].sort((a, b) => {
    if(a.status !== b.status) return a.status === 'archived' ? 1 : -1;
    return new Date(b.created_at) - new Date(a.created_at);
  });

  sorted.forEach(ev => {
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

function subscribeEventsRealtime(){
  eventsChannel = supabaseClient
    .channel('events_list_changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'events' }, () => loadEvents())
    .subscribe();
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
      cols: evCols, rows: evRows, seat_states: states, status: 'active',
    }).select().single();
    if(error) throw error;

    const { error: salesError } = await supabaseClient.from('event_sales').insert({
      event_id: data.id,
      seat_sales: new Array(states.length).fill(null),
      tiers: DEFAULT_TIERS,
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

async function enterEvent(id, nameHint){
  clearPushTimers();
  unsubscribeEventChannels();
  setBulkMode(false);
  bulkSelected.clear();

  currentEventId = id;
  sessionStorage.setItem(EVENT_SESSION_KEY, id);

  const ev = nameHint ? { name: nameHint } : events.find(e => e.id === id);
  currentEventNameBadge.textContent = ev ? ev.name : '';
  currentEventNameBadge.hidden = false;
  backToEventsBtn.hidden = false;
  resetAllBtn.hidden = !canEdit();

  gridHint.textContent = canEdit()
    ? 'Bir koltuğa tıkla: cinsiyet, bilet türü ve ödeme yöntemini seç'
    : 'Misafir modundasın — koltukları görüntüleyebilirsin, değişiklik yapamazsın.';

  // Reset local state before the fetch resolves so a stale previous event's
  // seats never flash on screen while this one is loading.
  seatStates = [];
  seatSales = [];
  seatButtons = [];
  TICKET_TIERS = [...DEFAULT_TIERS];

  eventListView.hidden = true;
  eventDetailView.hidden = false;

  await ensureEventSeatsSync(id);
  if(canEdit()) await ensureEventSalesSync(id);
}

function exitEvent(){
  clearPushTimers();
  unsubscribeEventChannels();
  currentEventId = null;
  sessionStorage.removeItem(EVENT_SESSION_KEY);

  backToEventsBtn.hidden = true;
  currentEventNameBadge.hidden = true;
  eventDetailView.hidden = true;
  eventListView.hidden = false;
}

backToEventsBtn.addEventListener('click', exitEvent);

// ===== Login / role gate (misafir / satış / yönetici) =====

function enterApp(role){
  currentRole = role;
  sessionStorage.setItem(ROLE_SESSION_KEY, role);
  appRoot.dataset.role = role;
  roleBadge.textContent = role === 'admin' ? 'Yönetici' : role === 'sales' ? 'Satış' : 'Misafir';
  loginGate.hidden = true;
  appRoot.hidden = false;

  ensureEventsSync();

  const savedEventId = sessionStorage.getItem(EVENT_SESSION_KEY);
  if(savedEventId){
    enterEvent(savedEventId);
  } else {
    eventListView.hidden = false;
    eventDetailView.hidden = true;
  }
}

guestLoginBtn.addEventListener('click', () => enterApp('guest'));

function showPasswordRow(role){
  pendingLoginRole = role;
  passwordRow.hidden = false;
  loginError.hidden = true;
  passwordInput.value = '';
  passwordInput.focus();
}
salesLoginBtn.addEventListener('click', () => showPasswordRow('sales'));
adminLoginBtn.addEventListener('click', () => showPasswordRow('admin'));

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
  appRoot.hidden = true;
  loginGate.hidden = false;
  passwordRow.hidden = true;
  passwordInput.value = '';
  loginError.hidden = true;
  setBulkMode(false);

  clearPushTimers();
  unsubscribeEventChannels();
  if(eventsChannel){ supabaseClient.removeChannel(eventsChannel); eventsChannel = null; }
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

  const existingRole = sessionStorage.getItem(ROLE_SESSION_KEY);
  if(existingRole === 'admin' || existingRole === 'sales' || existingRole === 'guest') enterApp(existingRole);
})();

const STORAGE_KEY = 'koltukYerlesim.state';
const TIERS_KEY = 'koltukYerlesim.tiers';
const VENUE_KEY = 'koltukYerlesim.venueType';

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
let seatsSynced = false;
let salesSynced = false;

// Mutable — tiers can be added/removed/renamed/repriced by the user at runtime.
let TICKET_TIERS = [
  { id: 'standart', label: 'Standart', price: 100 },
  { id: 'vip', label: 'VIP', price: 250 },
  { id: 'ogrenci', label: 'Öğrenci', price: 60 },
];

const VENUE_TYPES = {
  sinema:  { label: 'Sinema', screenLabel: 'PERDE', shape: 'curve' },
  tiyatro: { label: 'Tiyatro', screenLabel: 'SAHNE', shape: 'curve' },
  konser:  { label: 'Konser / Etkinlik', screenLabel: 'SAHNE', shape: 'curve' },
  futbol:  { label: 'Futbol Sahası', screenLabel: 'SAHA', shape: 'oval' },
  genel:   { label: 'Genel Etkinlik', screenLabel: 'ALAN', shape: 'flat' },
};
let venueType = 'sinema';

const ROLE_SESSION_KEY = 'koltukYerlesim.role';
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

let currentRole = null; // 'guest' | 'sales' | 'admin'

const colsInput = document.getElementById('colsInput');
const rowsInput = document.getElementById('rowsInput');
const totalPreview = document.getElementById('totalPreview');
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

// seatSales is deliberately NOT cached here. It used to be, but that meant a
// browser that had ever been logged in as Satış/Yönetici kept real prices in
// localStorage — and a later Misafir session on that same browser/computer
// would read that stale cache and show sold badges/prices it was never
// actually sent. seatSales now only ever comes from a live Supabase fetch
// (ensureSalesSync, canEdit() roles only) or stays null for guests.
function saveState(){
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ cols, rows, seatStates }));
}

function loadState(){
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)); }
  catch { return null; }
}

function saveTiers(){
  localStorage.setItem(TIERS_KEY, JSON.stringify(TICKET_TIERS));
  pushTiers();
}

function loadTiers(){
  try {
    const saved = JSON.parse(localStorage.getItem(TIERS_KEY));
    if(Array.isArray(saved) && saved.length){
      TICKET_TIERS = saved.filter(t => t && t.id && t.label && typeof t.price === 'number');
    }
  } catch { /* ignore malformed storage */ }
  if(!TICKET_TIERS.length){
    TICKET_TIERS = [{ id: 'standart', label: 'Standart', price: 100 }];
  }
}

function saveVenueType(){
  localStorage.setItem(VENUE_KEY, venueType);
  pushVenueType();
}

function loadVenueType(){
  try {
    const saved = localStorage.getItem(VENUE_KEY);
    if(saved && VENUE_TYPES[saved]) venueType = saved;
  } catch { /* ignore */ }
}

function renderVenueAccent(){
  const cfg = VENUE_TYPES[venueType] || VENUE_TYPES.sinema;
  screenAccentEl.className = `screen-curve${cfg.shape !== 'curve' ? ' ' + cfg.shape : ''}`;
  screenAccentEl.querySelector('span').textContent = cfg.screenLabel;
  document.querySelectorAll('#venueTypeChips .preset-chip').forEach(c => {
    c.classList.toggle('is-active', c.dataset.venue === venueType);
  });
}

// seatSales must always be the same length as seatStates for index alignment —
// the two arrays are now stored in separate Supabase tables (seats vs sales)
// and can briefly drift out of sync while both realtime updates arrive.
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
  saveState();
  pushLayout();     // cols/rows/seat_states → seats table
  pushSalesData();  // seat_sales reset too → sales table
}

function renderGrid(){
  // Seats are direct grid children so CSS Grid wraps them into real rows —
  // wrapping them in per-row divs previously made every row a single grid
  // item, so all rows collapsed onto one visual line.
  seatGrid.style.gridTemplateColumns = `repeat(${cols}, auto)`;
  seatGrid.classList.toggle('guest-mode', !canEdit());
  normalizeSalesLength();
  seatGrid.innerHTML = '';

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
      seatNum++;
    }
  }
  updateStats();
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
      const btn = seatGrid.children[i];
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
function findAdjacencyConflict(idx, gender){
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
  const r = Math.floor(idx / cols) + 1;
  const c = (idx % cols) + 1;
  const state = seatStates[idx] || 'empty';
  const sale = seatSales[idx];
  let label = `Koltuk ${r}-${c}, durum: ${labelFor(state)}`;
  if(sale) label += `, satıldı: ${sale.label} ${sale.price}₺ (${paymentLabel(sale.payment) || '-'})`;
  return label;
}

function renderSeatVisual(btn, idx){
  const state = seatStates[idx] || 'empty';
  const sale = seatSales[idx];

  btn.className = ['seat', state !== 'empty' ? state : null, sale ? 'sold' : null].filter(Boolean).join(' ');
  btn.innerHTML = '';

  const num = document.createElement('span');
  num.className = 'seat-num';
  num.textContent = idx + 1;
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
    saveVenueType();
    toast(`Etkinlik türü: ${VENUE_TYPES[venueType].label}`);
  });
});

document.getElementById('resetAllBtn').addEventListener('click', () => {
  seatStates = seatStates.map(() => 'empty');
  seatSales = seatSales.map(() => null);
  renderGrid();
  saveState();
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
      saveTiers();
    });
    priceInput.addEventListener('input', () => {
      const raw = Number(priceInput.value);
      tier.price = Number.isFinite(raw) && raw >= 0 ? raw : 0;
      saveTiers();
    });
    priceInput.addEventListener('blur', () => {
      tier.price = Math.max(0, Math.round(Number(priceInput.value) || 0));
      priceInput.value = tier.price;
      saveTiers();
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
  saveTiers();
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
  saveTiers();
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

  const r = Math.floor(idx / cols) + 1;
  const c = (idx % cols) + 1;
  seatModalTitle.textContent = `Koltuk ${r}-${c}`;

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
    renderSeatVisual(seatGrid.children[idx], idx);
  });

  updateStats();
  saveState();
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
  renderSeatVisual(seatGrid.children[idx], idx);
  updateStats();
  saveState();
  pushSeatStates();
  pushSalesData();
  closeSeatModal();
  toast('Koltuk boşaltıldı.');
});

seatModalClose.addEventListener('click', closeSeatModal);
seatModalOverlay.addEventListener('click', (e) => { if(e.target === seatModalOverlay) closeSeatModal(); });
document.addEventListener('keydown', (e) => { if(e.key === 'Escape' && !seatModalOverlay.hidden) closeSeatModal(); });

// ===== Cross-device sync (Supabase realtime) =====
// Split into two tables on purpose:
//   seats  — cols/rows/seat_states/venue_type — occupancy only, no pricing.
//   sales  — seat_sales/tiers — prices, tiers, payment method.
// Misafir only ever fetches/subscribes to `seats`, so ticket prices and
// payment details never reach a guest's browser at all (not just hidden in
// the UI — never sent over the wire). Satış/Yönetici sync both tables.

function pushSeatStates(){
  if(!supabaseClient || isApplyingRemote) return;
  clearTimeout(pushTimerSeatStates);
  pushTimerSeatStates = setTimeout(async () => {
    const { error } = await supabaseClient.from('seats').update({
      seat_states: seatStates,
      updated_at: new Date().toISOString(),
    }).eq('id', 1);
    if(error) console.warn('Supabase (seats) güncelleme hatası:', error.message);
  }, 400);
}

function pushLayout(){
  if(!supabaseClient || isApplyingRemote) return;
  clearTimeout(pushTimerLayout);
  pushTimerLayout = setTimeout(async () => {
    const { error } = await supabaseClient.from('seats').update({
      cols, rows,
      seat_states: seatStates,
      venue_type: venueType,
      updated_at: new Date().toISOString(),
    }).eq('id', 1);
    if(error) console.warn('Supabase (seats) güncelleme hatası:', error.message);
  }, 400);
}

function pushVenueType(){
  if(!supabaseClient || isApplyingRemote) return;
  clearTimeout(pushTimerVenueType);
  pushTimerVenueType = setTimeout(async () => {
    const { error } = await supabaseClient.from('seats').update({
      venue_type: venueType,
      updated_at: new Date().toISOString(),
    }).eq('id', 1);
    if(error) console.warn('Supabase (seats) güncelleme hatası:', error.message);
  }, 400);
}

function pushSalesData(){
  if(!supabaseClient || isApplyingRemote || !canEdit()) return;
  clearTimeout(pushTimerSalesData);
  pushTimerSalesData = setTimeout(async () => {
    const { error } = await supabaseClient.from('sales').update({
      seat_sales: seatSales,
      updated_at: new Date().toISOString(),
    }).eq('id', 1);
    if(error) console.warn('Supabase (sales) güncelleme hatası:', error.message);
  }, 400);
}

function pushTiers(){
  if(!supabaseClient || isApplyingRemote) return;
  clearTimeout(pushTimerTiers);
  pushTimerTiers = setTimeout(async () => {
    const { error } = await supabaseClient.from('sales').update({
      tiers: TICKET_TIERS,
      updated_at: new Date().toISOString(),
    }).eq('id', 1);
    if(error) console.warn('Supabase (sales) güncelleme hatası:', error.message);
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
  saveState();
  localStorage.setItem(VENUE_KEY, venueType);

  isApplyingRemote = false;
}

function applySalesPayload(row){
  if(!row) return;
  isApplyingRemote = true;

  seatSales = Array.isArray(row.seat_sales) ? row.seat_sales : [];
  normalizeSalesLength();
  if(Array.isArray(row.tiers) && row.tiers.length) TICKET_TIERS = row.tiers;

  renderGrid();
  renderTierList();
  saveState();
  localStorage.setItem(TIERS_KEY, JSON.stringify(TICKET_TIERS));

  isApplyingRemote = false;
}

function subscribeSeatsRealtime(){
  supabaseClient
    .channel('seats_changes')
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'seats', filter: 'id=eq.1' },
      (payload) => applySeatsPayload(payload.new))
    .subscribe();
}

function subscribeSalesRealtime(){
  supabaseClient
    .channel('sales_changes')
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'sales', filter: 'id=eq.1' },
      (payload) => applySalesPayload(payload.new))
    .subscribe();
}

async function ensureSeatsSync(){
  if(seatsSynced || !supabaseClient) return;
  seatsSynced = true;
  try {
    const { data, error } = await supabaseClient.from('seats').select('*').eq('id', 1).maybeSingle();
    if(error) throw error;

    if(!data){
      await supabaseClient.from('seats').insert({
        id: 1, cols, rows, seat_states: seatStates, venue_type: venueType,
      });
    } else {
      applySeatsPayload(data);
    }

    subscribeSeatsRealtime();
  } catch(err){
    console.warn('Supabase (seats) bağlantısı kurulamadı, yerel modda devam ediliyor.', err);
    toast('Buluta bağlanılamadı — yerel modda çalışılıyor.');
  }
}

async function ensureSalesSync(){
  if(salesSynced || !supabaseClient) return;
  salesSynced = true;
  try {
    const { data, error } = await supabaseClient.from('sales').select('*').eq('id', 1).maybeSingle();
    if(error) throw error;

    if(!data){
      await supabaseClient.from('sales').insert({
        id: 1, seat_sales: seatSales, tiers: TICKET_TIERS,
      });
    } else {
      applySalesPayload(data);
    }

    subscribeSalesRealtime();
  } catch(err){
    console.warn('Supabase (sales) bağlantısı kurulamadı.', err);
  }
}

// ===== Login / role gate (misafir / satış / yönetici) =====

function enterApp(role){
  currentRole = role;
  sessionStorage.setItem(ROLE_SESSION_KEY, role);
  appRoot.dataset.role = role;
  roleBadge.textContent = role === 'admin' ? 'Yönetici' : role === 'sales' ? 'Satış' : 'Misafir';
  seatGrid.classList.toggle('guest-mode', !canEdit());
  loginGate.hidden = true;
  appRoot.hidden = false;

  gridHint.textContent = canEdit()
    ? 'Bir koltuğa tıkla: cinsiyet, bilet türü ve ödeme yöntemini seç'
    : 'Misafir modundasın — koltukları görüntüleyebilirsin, değişiklik yapamazsın.';

  ensureSeatsSync();
  if(canEdit()) ensureSalesSync();
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
  currentRole = null;
  pendingLoginRole = null;
  appRoot.hidden = true;
  loginGate.hidden = false;
  passwordRow.hidden = true;
  passwordInput.value = '';
  loginError.hidden = true;
  setBulkMode(false);

  // Wipe any sales data pulled in during a privileged session — otherwise,
  // without a page reload, a guest login right after in the same tab would
  // still see it sitting in memory even though it's never fetched for guests.
  seatSales = new Array(seatStates.length).fill(null);
  salesSynced = false;
  renderGrid();
});

// Init: restore previous session or default grid
(function init(){
  loadTiers();
  renderTierList();
  loadVenueType();

  const saved = loadState();
  if(saved && saved.cols && saved.rows && Array.isArray(saved.seatStates)){
    cols = saved.cols;
    rows = saved.rows;
    seatStates = saved.seatStates;
    // Always start clean, never from cache — see the note on saveState().
    seatSales = new Array(seatStates.length).fill(null);
    colsInput.value = cols;
    rowsInput.value = rows;
    updateTotalPreview();
    renderVenueAccent();
    renderGrid();
  } else {
    updateTotalPreview();
    renderVenueAccent();
    generateGrid(false);
  }

  const existingRole = sessionStorage.getItem(ROLE_SESSION_KEY);
  if(existingRole === 'admin' || existingRole === 'sales' || existingRole === 'guest') enterApp(existingRole);
})();

const STORAGE_KEY = 'koltukYerlesim.state';
const TIERS_KEY = 'koltukYerlesim.tiers';
const STATES = ['empty', 'male', 'female'];

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
let pushTimer = null;

const GENDER_HINTS = {
  cycle: 'Bir koltuğa tıkla: Boş → Erkek → Kadın → Boş',
  empty: 'Koltuklara tıkla veya sürükle: Boş olarak işaretle',
  male: 'Koltuklara tıkla veya sürükle: Erkek olarak işaretle',
  female: 'Koltuklara tıkla veya sürükle: Kadın olarak işaretle',
};

// Mutable — tiers can be added/removed/renamed/repriced by the user at runtime.
let TICKET_TIERS = [
  { id: 'standart', label: 'Standart', price: 100 },
  { id: 'vip', label: 'VIP', price: 250 },
  { id: 'ogrenci', label: 'Öğrenci', price: 60 },
];

function saleHint(tierId){
  if(tierId === 'clear') return 'Koltuklara tıkla veya sürükle: Satışı kaldır';
  const tier = TICKET_TIERS.find(t => t.id === tierId);
  return tier ? `Koltuklara tıkla veya sürükle: ${tier.label} bilet olarak sat (${tier.price}₺)` : '';
}

const ROLE_SESSION_KEY = 'koltukYerlesim.role';
// Client-side gate only — not real security, just separates the "view" (misafir)
// experience from the "edit" (yönetici) one. Anyone can read this in the source.
const ADMIN_PASSWORD = 'yonetici123';

const loginGate = document.getElementById('loginGate');
const appRoot = document.getElementById('appRoot');
const guestLoginBtn = document.getElementById('guestLoginBtn');
const adminLoginBtn = document.getElementById('adminLoginBtn');
const adminPasswordRow = document.getElementById('adminPasswordRow');
const adminPasswordInput = document.getElementById('adminPasswordInput');
const adminPasswordSubmit = document.getElementById('adminPasswordSubmit');
const loginError = document.getElementById('loginError');
const roleBadge = document.getElementById('roleBadge');
const logoutBtn = document.getElementById('logoutBtn');

let currentRole = null; // 'guest' | 'admin'

const colsInput = document.getElementById('colsInput');
const rowsInput = document.getElementById('rowsInput');
const totalPreview = document.getElementById('totalPreview');
const seatGrid = document.getElementById('seatGrid');
const gridHint = document.getElementById('gridHint');
const genderToolbar = document.getElementById('genderToolbar');
const saleToolbar = document.getElementById('saleToolbar');
const tierListEl = document.getElementById('tierList');
const saleTierButtonsEl = document.getElementById('saleTierButtons');
const newTierNameInput = document.getElementById('newTierName');
const newTierPriceInput = document.getElementById('newTierPrice');
const revenueBreakdownEl = document.getElementById('revenueBreakdown');

let cols = 10;
let rows = 8;
let seatStates = [];
let seatSales = [];
let activeMode = 'gender'; // 'gender' | 'sale'
let activeBrush = 'cycle';
let activeSaleBrush = 'standart';
let isPainting = false;

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

function saveState(){
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ cols, rows, seatStates, seatSales }));
  pushRemoteState();
}

function loadState(){
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)); }
  catch { return null; }
}

function saveTiers(){
  localStorage.setItem(TIERS_KEY, JSON.stringify(TICKET_TIERS));
  pushRemoteState();
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
}

function updatePaintingModeClass(){
  const painting = activeMode === 'sale' || (activeMode === 'gender' && activeBrush !== 'cycle');
  seatGrid.classList.toggle('painting-mode', painting);
}

function updateGridHint(){
  gridHint.textContent = activeMode === 'gender' ? GENDER_HINTS[activeBrush] : saleHint(activeSaleBrush);
}

function renderGrid(){
  // Seats are direct grid children so CSS Grid wraps them into real rows —
  // wrapping them in per-row divs previously made every row a single grid
  // item, so all rows collapsed onto one visual line.
  seatGrid.style.gridTemplateColumns = `repeat(${cols}, auto)`;
  updatePaintingModeClass();
  seatGrid.innerHTML = '';

  let seatNum = 0;
  for(let r = 0; r < rows; r++){
    for(let c = 0; c < cols; c++){
      const idx = seatNum;
      const btn = document.createElement('button');
      btn.type = 'button';
      renderSeatVisual(btn, idx);

      btn.addEventListener('pointerdown', (e) => {
        if(currentRole !== 'admin' || e.button !== 0) return;
        isPainting = true;
        applyAction(idx, btn);
      });
      btn.addEventListener('pointerenter', () => {
        if(currentRole === 'admin' && isPainting) applyAction(idx, btn);
      });
      btn.addEventListener('click', (e) => {
        if(currentRole === 'admin' && e.detail === 0) applyAction(idx, btn);
      });

      seatGrid.appendChild(btn);
      seatNum++;
    }
  }
  updateStats();
}

function labelFor(state){
  return state === 'male' ? 'Erkek' : state === 'female' ? 'Kadın' : 'Boş';
}

function seatAriaLabel(idx){
  const r = Math.floor(idx / cols) + 1;
  const c = (idx % cols) + 1;
  const state = seatStates[idx] || 'empty';
  const sale = seatSales[idx];
  let label = `Koltuk ${r}-${c}, durum: ${labelFor(state)}`;
  if(sale) label += `, satıldı: ${sale.label} ${sale.price}₺`;
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
    btn.title = `${sale.label} — ${sale.price}₺`;
  } else {
    btn.removeAttribute('title');
  }

  btn.setAttribute('aria-label', seatAriaLabel(idx));
}

function applyAction(idx, btn){
  if(activeMode === 'gender') applyGenderBrush(idx, btn);
  else applySaleBrush(idx, btn);
}

function applyGenderBrush(idx, btn){
  if(activeBrush === 'cycle'){
    const current = seatStates[idx] || 'empty';
    seatStates[idx] = STATES[(STATES.indexOf(current) + 1) % STATES.length];
  } else {
    seatStates[idx] = activeBrush;
  }
  renderSeatVisual(btn, idx);
  updateStats();
  saveState();
}

function applySaleBrush(idx, btn){
  if(!activeSaleBrush || activeSaleBrush === 'clear'){
    seatSales[idx] = null;
  } else {
    const tier = TICKET_TIERS.find(t => t.id === activeSaleBrush);
    // Snapshot label + price at sale time so later renaming/repricing/deleting
    // a tier never changes what a seat was actually sold for.
    seatSales[idx] = tier ? { tier: tier.id, label: tier.label, price: tier.price } : null;
  }
  renderSeatVisual(btn, idx);
  updateStats();
  saveState();
}

document.addEventListener('pointerup', () => { isPainting = false; });
document.addEventListener('pointercancel', () => { isPainting = false; });

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

// Per-tier breakdown (count sold + subtotal) plus the grand total ("Toplam Ciro").
// Keyed by the snapshot label on each sale, not the live tier list, so a
// renamed/deleted tier still shows up correctly under its original name.
function updateRevenueBreakdown(totalRevenue){
  const breakdown = new Map();
  TICKET_TIERS.forEach(t => breakdown.set(t.label, { count: 0, revenue: 0 }));
  seatSales.forEach(s => {
    if(!s) return;
    if(!breakdown.has(s.label)) breakdown.set(s.label, { count: 0, revenue: 0 });
    const entry = breakdown.get(s.label);
    entry.count++;
    entry.revenue += s.price;
  });

  revenueBreakdownEl.innerHTML = '';
  breakdown.forEach((entry, label) => {
    const row = document.createElement('div');
    row.className = 'revenue-row';
    row.innerHTML = `<span>${label}</span><span>${entry.count} adet — ${entry.revenue} ₺</span>`;
    revenueBreakdownEl.appendChild(row);
  });

  const totalRow = document.createElement('div');
  totalRow.className = 'revenue-row revenue-total';
  totalRow.innerHTML = `<span>Toplam Ciro</span><span>${totalRevenue} ₺</span>`;
  revenueBreakdownEl.appendChild(totalRow);
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

document.querySelectorAll('.preset-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    colsInput.value = chip.dataset.cols;
    rowsInput.value = chip.dataset.rows;
    updateTotalPreview();
    generateGrid(false);
    toast('Düzen oluşturuldu.');
  });
});

document.getElementById('resetAllBtn').addEventListener('click', () => {
  seatStates = seatStates.map(() => 'empty');
  seatSales = seatSales.map(() => null);
  renderGrid();
  saveState();
  toast('Tüm koltuklar sıfırlandı.');
});

document.getElementById('clearSalesBtn').addEventListener('click', () => {
  seatSales = seatSales.map(() => null);
  seatGrid.querySelectorAll('.seat').forEach((btn, idx) => renderSeatVisual(btn, idx));
  updateStats();
  saveState();
  toast('Tüm satışlar temizlendi.');
});

document.querySelectorAll('.mode-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    activeMode = tab.dataset.mode;
    document.querySelectorAll('.mode-tab').forEach(t => {
      t.classList.toggle('is-active', t === tab);
      t.setAttribute('aria-selected', t === tab ? 'true' : 'false');
    });
    genderToolbar.hidden = activeMode !== 'gender';
    saleToolbar.hidden = activeMode !== 'sale';
    updateGridHint();
    updatePaintingModeClass();
  });
});

document.querySelectorAll('#genderToolbar .brush-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    activeBrush = btn.dataset.brush;
    document.querySelectorAll('#genderToolbar .brush-btn').forEach(b => b.classList.toggle('is-active', b === btn));
    updateGridHint();
    updatePaintingModeClass();
  });
});

// Delegated so it keeps working after renderSaleTierButtons() rebuilds the
// dynamic tier buttons (add/remove/edit a tier) — covers those plus the
// static "Satışı Kaldır" button in one handler.
saleToolbar.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-sale-tier]');
  if(!btn) return;
  activeSaleBrush = btn.dataset.saleTier;
  saleToolbar.querySelectorAll('[data-sale-tier]').forEach(b => b.classList.toggle('is-active', b === btn));
  updateGridHint();
  updatePaintingModeClass();
});

// ===== Ticket tier management (add / remove / rename / reprice) =====

function renderSaleTierButtons(){
  if(!TICKET_TIERS.find(t => t.id === activeSaleBrush)){
    activeSaleBrush = TICKET_TIERS[0] ? TICKET_TIERS[0].id : null;
  }
  saleTierButtonsEl.innerHTML = '';
  TICKET_TIERS.forEach(tier => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `brush-btn${tier.id === activeSaleBrush ? ' is-active' : ''}`;
    btn.dataset.saleTier = tier.id;
    btn.textContent = `${tier.label} (${tier.price}₺)`;
    saleTierButtonsEl.appendChild(btn);
  });
  updateGridHint();
  updateStats();
}

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
      renderSaleTierButtons();
      saveTiers();
    });
    priceInput.addEventListener('input', () => {
      const raw = Number(priceInput.value);
      tier.price = Number.isFinite(raw) && raw >= 0 ? raw : 0;
      renderSaleTierButtons();
      saveTiers();
    });
    priceInput.addEventListener('blur', () => {
      tier.price = Math.max(0, Math.round(Number(priceInput.value) || 0));
      priceInput.value = tier.price;
      renderSaleTierButtons();
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
  renderSaleTierButtons();
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
  renderSaleTierButtons();
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

// ===== Cross-device sync (Supabase realtime) =====
// One shared row (id=1) holds the whole venue: grid size, seat states/sales,
// ticket tiers. Any admin write replaces it; every connected tab (guest or
// admin) is subscribed and re-renders when it changes — that's how a seat
// picked on one computer shows up on another.

function pushRemoteState(){
  if(!supabaseClient || isApplyingRemote) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(async () => {
    const { error } = await supabaseClient.from('venue_state').update({
      cols, rows,
      seat_states: seatStates,
      seat_sales: seatSales,
      tiers: TICKET_TIERS,
      updated_at: new Date().toISOString(),
    }).eq('id', 1);
    if(error) console.warn('Supabase güncelleme hatası:', error.message);
  }, 400);
}

function applyRemotePayload(row){
  if(!row) return;
  isApplyingRemote = true;

  cols = row.cols;
  rows = row.rows;
  seatStates = Array.isArray(row.seat_states) ? row.seat_states : [];
  seatSales = Array.isArray(row.seat_sales) ? row.seat_sales : [];
  if(Array.isArray(row.tiers) && row.tiers.length) TICKET_TIERS = row.tiers;

  colsInput.value = cols;
  rowsInput.value = rows;
  updateTotalPreview();
  renderGrid();
  renderTierList();
  renderSaleTierButtons();
  saveState();
  saveTiers();

  isApplyingRemote = false;
}

function subscribeRealtime(){
  supabaseClient
    .channel('venue_state_changes')
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'venue_state', filter: 'id=eq.1' },
      (payload) => applyRemotePayload(payload.new))
    .subscribe();
}

async function initRemoteSync(){
  if(!supabaseClient) return;
  try {
    const { data, error } = await supabaseClient.from('venue_state').select('*').eq('id', 1).maybeSingle();
    if(error) throw error;

    if(!data){
      await supabaseClient.from('venue_state').insert({
        id: 1, cols, rows, seat_states: seatStates, seat_sales: seatSales, tiers: TICKET_TIERS,
      });
    } else {
      applyRemotePayload(data);
    }

    subscribeRealtime();
  } catch(err){
    console.warn('Supabase bağlantısı kurulamadı, yerel modda devam ediliyor.', err);
    toast('Buluta bağlanılamadı — yerel modda çalışılıyor.');
  }
}

// ===== Login / role gate (misafir vs yönetici) =====

function enterApp(role){
  currentRole = role;
  sessionStorage.setItem(ROLE_SESSION_KEY, role);
  appRoot.dataset.role = role;
  roleBadge.textContent = role === 'admin' ? 'Yönetici' : 'Misafir';
  seatGrid.classList.toggle('guest-mode', role !== 'admin');
  loginGate.hidden = true;
  appRoot.hidden = false;

  if(role === 'guest'){
    gridHint.textContent = 'Misafir modundasın — koltukları görüntüleyebilirsin, değişiklik yapamazsın.';
  } else {
    updateGridHint();
  }
}

guestLoginBtn.addEventListener('click', () => enterApp('guest'));

adminLoginBtn.addEventListener('click', () => {
  adminPasswordRow.hidden = false;
  adminPasswordInput.focus();
});

function tryAdminLogin(){
  if(adminPasswordInput.value === ADMIN_PASSWORD){
    loginError.hidden = true;
    adminPasswordInput.value = '';
    enterApp('admin');
  } else {
    loginError.hidden = false;
  }
}
adminPasswordSubmit.addEventListener('click', tryAdminLogin);
adminPasswordInput.addEventListener('keydown', (e) => {
  if(e.key === 'Enter'){
    e.preventDefault();
    tryAdminLogin();
  }
});

logoutBtn.addEventListener('click', () => {
  sessionStorage.removeItem(ROLE_SESSION_KEY);
  currentRole = null;
  appRoot.hidden = true;
  loginGate.hidden = false;
  adminPasswordRow.hidden = true;
  adminPasswordInput.value = '';
  loginError.hidden = true;
});

// Init: restore previous session or default grid
(function init(){
  loadTiers();
  renderTierList();
  renderSaleTierButtons();

  const saved = loadState();
  if(saved && saved.cols && saved.rows && Array.isArray(saved.seatStates)){
    cols = saved.cols;
    rows = saved.rows;
    seatStates = saved.seatStates;
    seatSales = Array.isArray(saved.seatSales) && saved.seatSales.length === seatStates.length
      ? saved.seatSales
      : new Array(seatStates.length).fill(null);
    colsInput.value = cols;
    rowsInput.value = rows;
    updateTotalPreview();
    renderGrid();
  } else {
    updateTotalPreview();
    generateGrid(false);
  }

  const existingRole = sessionStorage.getItem(ROLE_SESSION_KEY);
  if(existingRole === 'admin' || existingRole === 'guest') enterApp(existingRole);

  initRemoteSync();
})();

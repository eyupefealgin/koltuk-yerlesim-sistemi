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

// Etkinlik başına ödeme yöntemi seçimi — misafirin satın alma ekranındaki
// Kart/Nakit butonlarından sadece burada seçili olanlar çıkar (bkz.
// paymentChoiceButtons, modal-payment-panel'de sabit HTML olarak duruyor,
// biz sadece görünürlüğünü PAYMENT_METHODS'a göre açıp kapatıyoruz).
function applyPaymentMethodsVisibility(){
  paymentChoiceButtons.forEach(btn => {
    btn.hidden = !PAYMENT_METHODS.includes(btn.dataset.payment);
  });
}

function renderPaymentMethodsEditor(){
  paymentMethodKartCheckbox.checked = PAYMENT_METHODS.includes('kart');
  paymentMethodNakitCheckbox.checked = PAYMENT_METHODS.includes('nakit');
  applyPaymentMethodsVisibility();
}

savePaymentMethodsBtn.addEventListener('click', async () => {
  if(!supabaseClient || !currentEventId) return;
  const methods = [];
  if(paymentMethodKartCheckbox.checked) methods.push('kart');
  if(paymentMethodNakitCheckbox.checked) methods.push('nakit');
  if(!methods.length){
    toast('En az bir ödeme yöntemi seçili olmalı.');
    return;
  }

  savePaymentMethodsBtn.disabled = true;
  const { error } = await supabaseClient.from('events').update({
    payment_methods: methods, updated_at: new Date().toISOString(),
  }).eq('id', currentEventId);
  savePaymentMethodsBtn.disabled = false;

  if(error){ toast('Ödeme yöntemleri kaydedilemedi.'); return; }
  PAYMENT_METHODS = methods;
  applyPaymentMethodsVisibility();
  toast('Ödeme yöntemleri kaydedildi.');
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


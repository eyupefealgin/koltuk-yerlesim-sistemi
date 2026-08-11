// ===== Seat modal: bilet türü → alıcı bilgisi → ödeme yöntemi =====

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
  // modalGender artık kullanıcıya sorulmuyor — sabit bir "dolu" işareti,
  // seat_states/purchase_seat atomik kontrolü için (bkz. SEAT_STATE_SHORT).
  modalGender = 'male';
  modalTier = null;
  modalBuyerName = '';
  modalBuyerEmail = '';
  modalDiscount = null;
  modalHeldIdx = null;

  seatModalTitle.textContent = seatLabelFor(idx) + (ACCESSIBLE_SEATS.has(idx) ? ' ♿' : '');

  const state = seatStates[idx] || 'empty';
  const sale = seatSales[idx];

  if(state !== 'empty' || sale){
    const parts = [labelFor(state)];
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
  showModalPanel('tier');
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

// blockIdx null ise klasik ızgaradaki bir koltuk index'i, değilse activeBlockIdx
// içindeki bir koltuk pozisyonu — hangisi olduğuna göre doğru RPC çağrılır.
function releaseHeldSeat(idx, blockIdx){
  if(!currentEventId) return;
  const rpcName = blockIdx !== null ? 'release_stadium_seat_hold' : 'release_seat_hold';
  const params = blockIdx !== null
    ? { p_event_id: currentEventId, p_block_idx: blockIdx, p_seat_pos: idx, p_token: holdToken }
    : { p_event_id: currentEventId, p_idx: idx, p_token: holdToken };
  supabaseClient.rpc(rpcName, params)
    .then(({ error }) => { if(error) console.warn('Rezervasyon serbest bırakılamadı.', error.message); });
}

// Toplu seçimdeki her koltuğu (klasik index ya da blok içindeki pos) ayrı
// ayrı reserve_seat/reserve_stadium_seat ile tutmaya çalışır — biri az önce
// başkası tarafından alınmış/bakılıyorsa sadece o başarısız olur, diğerleri
// yine de tutulur. Tek atomik satın alma RPC'leri zaten bu korumayı
// sağlıyordu (bkz. finalizeGuestBulkPurchase notu); bu ek katman sadece "iki
// misafir aynı koltuğu aynı anda seçip forma kadar ilerleyebilme" kötü
// deneyimini önlüyor.
async function reserveBulkSeats(indices, blockIdx){
  const held = [];
  let failed = 0;
  for(const idx of indices){
    try {
      const rpcName = blockIdx !== null ? 'reserve_stadium_seat' : 'reserve_seat';
      const params = blockIdx !== null
        ? { p_event_id: currentEventId, p_block_idx: blockIdx, p_seat_pos: idx, p_token: holdToken, p_ttl_seconds: HOLD_TTL_SECONDS }
        : { p_event_id: currentEventId, p_idx: idx, p_token: holdToken, p_ttl_seconds: HOLD_TTL_SECONDS };
      const { error } = await supabaseClient.rpc(rpcName, params);
      if(error) throw error;
      held.push(idx);
    } catch(err){
      failed++;
    }
  }
  return { held, failed };
}

function closeSeatModal(){
  seatModalOverlay.hidden = true;
  stopHoldCountdown();
  // Blok içindeysek tutulan koltuklar da blok pozisyonu bazlı (bkz.
  // openBlockSeatModal/startBulkSaleBtn) — activeBlockIdx modal açıkken
  // değişmez, doğru RPC'yi seçmek için burada da okunuyor.
  const blockIdx = activeBlockIdx;
  if(modalHeldIdx !== null) releaseHeldSeat(modalHeldIdx, blockIdx);
  if(modalHeldIndices && modalHeldIndices.length) modalHeldIndices.forEach(idx => releaseHeldSeat(idx, blockIdx));
  modalSeatIdx = null;
  modalSeatIndices = null;
  modalBlockSeatPos = null;
  modalGender = null;
  modalTier = null;
  modalBuyerName = '';
  modalBuyerEmail = '';
  modalDiscount = null;
  modalHeldIdx = null;
  modalHeldIndices = null;
}

// ===== Futbol bloğu içinde tek tek koltuk seçimi (sinema düzeni gibi) =====
// Bir bloğa (ör. "Classic VIP 2") tıklayınca artık sadece bir adet
// seçilmiyor — o bloğun İÇİNE girilip capacity kadar numaralı koltuk
// gösteriliyor, her biri normal sinema koltuğu gibi tek tek (bilet türü +
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
  btn.className = ['seat', isSeatTaken(state) ? 'taken' : 'empty', sale ? 'sold' : null].filter(Boolean).join(' ');
  btn.innerHTML = '';
  const num = document.createElement('span');
  num.className = 'seat-num';
  num.textContent = pos + 1;
  btn.appendChild(num);
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

  // Boş koltuk: klasik openSeatModal'daki reserve_seat ile aynı mantık,
  // sadece blok koltukları için — iki misafirin aynı koltuğa aynı anda
  // tıklayıp forma kadar ilerleyebilmesini önler (bkz. reserve_stadium_seat).
  if(currentEventId){
    try {
      const { error } = await supabaseClient.rpc('reserve_stadium_seat', {
        p_event_id: currentEventId, p_block_idx: activeBlockIdx, p_seat_pos: pos, p_token: holdToken, p_ttl_seconds: HOLD_TTL_SECONDS,
      });
      if(error) throw error;
      modalHeldIdx = pos;
      startHoldCountdown();
    } catch(err){
      const held = err && err.message && err.message.includes('SEAT_HELD');
      toast(held ? 'Bu koltuğa şu anda başka biri bakıyor, birazdan tekrar dene.' : 'Bu koltuk artık uygun değil.');
      return;
    }
  }

  discountCodeInput.value = '';
  discountNoteText.hidden = true;
  openBuyerPanelForBlockSeat();
  seatModalOverlay.hidden = false;
}

// Blok koltuklarında da gösterilecek bir bilet-türü seçimi yok (tür zaten
// blok tarafından sabit) -- bu yüzden hem tekli hem çoklu blok koltuğu
// seçiminde doğrudan alıcı bilgisine geçiliyor. modalGender'a hâlâ sabit
// bir değer yazılıyor çünkü seat_states/purchase_stadium_seat atomik "hâlâ
// boş mu" kontrolü için hâlâ 'e'/'empty' DIŞINDA bir değere ihtiyaç
// duyuyor — bu sadece dahili bir "dolu" işareti, kullanıcıya hiçbir yerde
// gösterilmiyor (bkz. openSeatModal'daki aynı yaklaşım).
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
  const remaining = block.capacity - sold; // Infinity - sold = Infinity, hiç dolmaz

  if(remaining <= 0){
    toast('Bu etkinlik dolu.');
    return;
  }
  const confirmText = block.capacity === Infinity
    ? `${sold} katıldı — sınırsız katılım. Katılmak istiyor musun?`
    : `${sold}/${block.capacity} katıldı — ${remaining} yer kaldı. Katılmak istiyor musun?`;
  if(!confirm(confirmText)) return;

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
    // p_capacity SQL'de int — Infinity JSON'a serileşirken null'a döner ve RPC
    // "her zaman dolu" gibi davranırdı (bkz. purchase_stadium_block'taki
    // <= p_capacity kontrolü). Sınırsızsa Postgres int4'ün üst sınırını
    // (pratikte hiç ulaşılamayacak bir tavan) gönderiyoruz.
    const capacityParam = Number.isFinite(block.capacity) ? block.capacity : 2147483647;
    const { error } = await supabaseClient.rpc('purchase_stadium_block', {
      p_event_id: currentEventId, p_idx: 0, p_quantity: 1, p_capacity: capacityParam, p_sales: [], p_token: holdToken,
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


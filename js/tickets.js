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

// qrcode.min.js (~12KB) sadece bilet görüntülenirken gerekiyor (kamerayla
// check-in native BarcodeDetector kullanıyor, bu kütüphaneye ihtiyacı yok)
// — bu yüzden sayfa yüklenirken hiç indirilmiyor, ilk bilet görüntülenince
// bir kere indiriliyor ve sonrasında önbellekten geliyor.
let qrcodeLoadPromise = null;
function ensureQrcodeLoaded(){
  if(typeof qrcode === 'function') return Promise.resolve();
  if(qrcodeLoadPromise) return qrcodeLoadPromise;
  qrcodeLoadPromise = new Promise((resolve) => {
    const script = document.createElement('script');
    script.src = 'qrcode.min.js';
    script.onload = () => resolve();
    script.onerror = () => resolve(); // aşağıdaki kod-metni fallback'i zaten var
    document.head.appendChild(script);
  });
  return qrcodeLoadPromise;
}

async function renderTicketQr(qrHolder, ticketCode){
  qrHolder.dataset.pending = ticketCode;
  await ensureQrcodeLoaded();
  if(qrHolder.dataset.pending !== ticketCode) return; // arada başka bilet açılmış
  if(typeof qrcode !== 'function'){ qrHolder.textContent = ticketCode; return; }
  try {
    const qr = qrcode(0, 'M');
    qr.addData(ticketCode);
    qr.make();
    qrHolder.innerHTML = qr.createSvgTag({ cellSize: 5, margin: 4 });
  } catch(err){
    qrHolder.textContent = ticketCode;
  }
}

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
  if(sale.ticketCode){
    renderTicketQr(qrHolder, sale.ticketCode);
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
  el.addEventListener('input', () => renderEventList());
  el.addEventListener('change', () => renderEventList());
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


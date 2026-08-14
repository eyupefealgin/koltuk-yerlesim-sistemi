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

  seatGrid.classList.remove('filter-empty', 'filter-sold', 'search-active');

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
      // kayıt değil bir DİZİ, ve state bir durum değil satılan SAYISI —
      // salesAt() ile normalize edip her satışı ayrı ayrı kontrol ediyoruz,
      // "Boş/Satıldı" durum aramasını da bu modda devre dışı bırakıyoruz
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
  EVENT_END_DATE = row.end_date || null;
  PAYMENT_METHODS = Array.isArray(row.payment_methods) && row.payment_methods.length ? row.payment_methods : ['kart', 'nakit'];
  // general_capacity sütunda NULL = "Sınırlı Bilet" kapalı, yani sınırsız
  // katılım (bkz. createEvent/renderGeneralCapacityEditor). Bellekte Infinity
  // olarak tutuluyor — poolBlocks/joinGeneralEvent/renderSeatVisual'daki tüm
  // kapasite - katılan aritmetiği değişiklik gerektirmeden doğru çalışır.
  GENERAL_CAPACITY = row.general_capacity === null
    ? Infinity
    : (Number(row.general_capacity) > 0 ? Number(row.general_capacity) : DEFAULT_GENERAL_CAPACITY);
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
  renderEndDateEditor();
  renderPaymentMethodsEditor();
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
      : (ev.general_capacity === null
          ? Infinity
          : (Number(ev.general_capacity) > 0 ? Number(ev.general_capacity) : DEFAULT_GENERAL_CAPACITY));
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

// Birden fazla gün süren etkinliklerde (ev.end_date dolu ve başlangıçtan
// farklıysa) "10 Ağustos - 12 Ağustos 2026" gibi bir aralık gösterir.
function formatEventDateRange(startStr, endStr){
  if(!endStr || endStr === startStr) return formatEventDate(startStr);
  if(!startStr) return formatEventDate(endStr);
  try {
    const start = new Date(`${startStr}T00:00:00`);
    const end = new Date(`${endStr}T00:00:00`);
    const sameMonth = start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth();
    const startPart = start.toLocaleDateString('tr-TR', sameMonth ? { day: 'numeric' } : { day: 'numeric', month: 'long' });
    const endPart = end.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
    return `${startPart} - ${endPart}`;
  } catch {
    return formatEventDate(startStr);
  }
}

function computeMinTierPrice(ev){
  const tiers = Array.isArray(ev.tiers) ? ev.tiers : [];
  if(!tiers.length) return null;
  return Math.min(...tiers.map(t => t.price));
}

// Etkinlik listesindeki filtre çubuğu — tamamen istemci tarafında, zaten
// belleğe çekilmiş `events` dizisini süzer (yeni bir sorgu atmaz).
// Bugünün tarihi, event_date (YYYY-MM-DD) ile doğrudan string karşılaştırma
// yapılabilecek biçimde — saat dilimi kaymasına karşı yerel tarihten kuruluyor.
function todayDateStr(){
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function isPastEvent(ev){
  return !!ev.event_date && ev.event_date < todayDateStr();
}

// Etkinlik listesi görünüm sekmesi — Yaklaşan (varsayılan) / Geçmiş /
// Favorilerim. Sadece misafir sayfasında (index.html) sekmeleri var;
// personel sayfalarında elemanlar null olduğu için hepsi ?. ile erişiliyor,
// eventViewMode her zaman 'upcoming' kalır (personel her şeyi görür).
let eventViewMode = 'upcoming';
const eventViewUpcomingBtn = document.getElementById('eventViewUpcoming');
const eventViewPastBtn = document.getElementById('eventViewPast');
const eventViewFavoritesBtn = document.getElementById('eventViewFavorites');

function setEventViewMode(mode){
  if(mode === 'favorites' && !requireGuestLogin()) return;
  eventViewMode = mode;
  eventViewUpcomingBtn?.classList.toggle('is-active', mode === 'upcoming');
  eventViewPastBtn?.classList.toggle('is-active', mode === 'past');
  eventViewFavoritesBtn?.classList.toggle('is-active', mode === 'favorites');
  renderEventList();
}
eventViewUpcomingBtn?.addEventListener('click', () => setEventViewMode('upcoming'));
eventViewPastBtn?.addEventListener('click', () => setEventViewMode('past'));
eventViewFavoritesBtn?.addEventListener('click', () => setEventViewMode('favorites'));


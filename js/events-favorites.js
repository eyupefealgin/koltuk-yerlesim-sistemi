// ===== Favoriler (sadece giriş yapmış misafirler, bkz. favorites tablosu) =====
async function loadFavorites(){
  if(!supabaseClient || !verifiedUserId){ favoriteEventIds = new Set(); return; }
  try {
    // RLS zaten sadece auth.uid() = user_id olan satırları döndürüyor --
    // burada ayrıca .eq('user_id', ...) filtrelemeye gerek yok.
    const { data, error } = await supabaseClient.from('favorites').select('event_id');
    if(error) throw error;
    favoriteEventIds = new Set((data || []).map(r => r.event_id));
  } catch(err){
    console.warn('Favoriler alınamadı.', err);
    favoriteEventIds = new Set();
  }
  renderEventList();
}

async function toggleFavorite(eventId, starBtn){
  if(!requireGuestLogin()) return;
  const isFav = favoriteEventIds.has(eventId);
  starBtn.disabled = true;
  try {
    if(isFav){
      const { error } = await supabaseClient.from('favorites').delete().eq('event_id', eventId);
      if(error) throw error;
      favoriteEventIds.delete(eventId);
    } else {
      const { error } = await supabaseClient.from('favorites').insert({ user_id: verifiedUserId, event_id: eventId });
      if(error) throw error;
      favoriteEventIds.add(eventId);
    }
    starBtn.classList.toggle('is-favorite', !isFav);
    starBtn.setAttribute('aria-label', !isFav ? 'Favorilerden çıkar' : 'Favorilere ekle');
    if(eventViewMode === 'favorites') renderEventList();
  } catch(err){
    console.warn('Favori güncellenemedi.', err);
    toast('Favori güncellenemedi — buluta bağlanılamadı.');
  } finally {
    starBtn.disabled = false;
  }
}

function eventMatchesFilters(ev){
  if(eventViewMode === 'favorites') return favoriteEventIds.has(ev.id);
  if(eventViewMode === 'past'){
    if(ev.status !== 'active' || !isPastEvent(ev)) return false;
  } else {
    // 'upcoming': tarihi geçmiş AKTİF etkinlikler ana listeden çıkıyor --
    // tarihsiz veya gelecekteki etkinlikler ile arşivlenmiş etkinlikler
    // (mevcut soluk gösterim davranışı) burada kalıyor.
    if(ev.status === 'active' && isPastEvent(ev)) return false;
  }

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

  // Sınırsız (total === Infinity) etkinlikler bu toplama katılmıyor — aksi
  // halde tek bir sınırsız etkinlik tüm sayacı Infinity'e sürüklerdi.
  const bosKoltuk = list.reduce((sum, ev) => {
    const { total, filled } = computeOccupancy(ev);
    return total === Infinity ? sum : sum + Math.max(0, total - filled);
  }, 0);

  el.textContent = `${list.length} etkinlik · ${bosKoltuk} boş koltuk`;
  el.hidden = false;
}

// Etkinlik listesindeki afiş yalnızca 54x54 (mobilde 44x44) bir küçük resim
// olarak gösteriliyor — admin genelde Unsplash gibi bir siteden kopyaladığı,
// çok daha büyük çözünürlüklü (600px+) bir link yapıştırıyor, o da her
// ziyaretçide gereksiz yere onlarca KB indiriyor. Bilinen CDN'lerde boyut
// parametresini küçük bir thumbnail'a indiriyoruz; tanımadığımız bir adres
// olduğunda dokunmadan olduğu gibi geçiyoruz.
function posterThumbnailUrl(url){
  try {
    const u = new URL(url);
    if(u.hostname.endsWith('unsplash.com')){
      u.searchParams.set('w', '120');
      u.searchParams.set('q', '60');
      u.searchParams.delete('h');
      return u.toString();
    }
  } catch { /* geçersizse safeImageUrl zaten elemiş olurdu */ }
  return url;
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
    const { total, filled, pct } = computeOccupancy(ev);
    // total Infinity ise "Sınırlı Bilet" kapalı bir Genel Etkinlik —
    // yüzde/koltuk sayısı yerine "Sınırsız" ve katılan sayısı gösteriliyor.
    const fillText = total === Infinity ? `${filled} katılımcı · Sınırsız` : `%${pct} dolu · ${total} koltuk`;
    const fillPct = total === Infinity ? 0 : pct;
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
          <button class="favorite-star" type="button" aria-label="Favorilere ekle">★</button>
          <span class="program-venue"></span>
          <span class="program-status-badge"></span>
        </div>
        <h3></h3>
        <p class="program-date-full"></p>
        <p class="program-note" hidden></p>
      </div>
      <div class="program-fill">
        <div class="capacity-bar-bg"><div class="capacity-bar" style="width:${fillPct}%"></div></div>
        <span>${fillText}</span>
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
      img.src = posterThumbnailUrl(poster);
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

    // Favori yıldızı sadece misafir sayfasında (index.html) — personel
    // sayfalarında elemanı gizliyoruz, tıklaması hiç bağlanmıyor.
    const starBtn = row.querySelector('.favorite-star');
    if(document.body.dataset.page === 'public'){
      const isFav = favoriteEventIds.has(ev.id);
      starBtn.classList.toggle('is-favorite', isFav);
      starBtn.setAttribute('aria-label', isFav ? 'Favorilerden çıkar' : 'Favorilere ekle');
      starBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleFavorite(ev.id, starBtn);
      });
    } else {
      starBtn.hidden = true;
    }

    eventGridEl.appendChild(row);
  });

  renderNotifications();
}

// ===== Bildirimler (yeni / yaklaşan / bitmek üzere etkinlik) =====
// Ayrı bir tablo/kanal yok — zaten bellekte duran `events` dizisinden anlık
// hesaplanıyor, renderEventList() her çalıştığında (yükleme, realtime,
// filtre, favori) otomatik güncelleniyor.
const NOTIF_NEW_WINDOW_DAYS = 3;      // bu kadar gün içinde eklenmiş etkinlik "yeni" sayılır
const NOTIF_UPCOMING_WINDOW_DAYS = 3; // etkinliğe bu kadar gün veya daha az kaldıysa "yaklaşan"
const NOTIF_SOLDOUT_PCT = 90;         // doluluk bu yüzdeyi geçtiyse "bitmek üzere"
const NOTIF_TYPE_PRIORITY = { ending: 0, new: 1, upcoming: 2 };
const NOTIF_TYPE_TAG = { ending: 'Son Günler', new: 'Yeni', upcoming: 'Yaklaşan' };

const notifBellBtn = document.getElementById('notifBellBtn');
const notifBadge = document.getElementById('notifBadge');
const notifPanel = document.getElementById('notifPanel');
const notifPanelList = document.getElementById('notifPanelList');

function daysUntilEvent(dateStr){
  if(!dateStr) return null;
  const today = new Date(`${todayDateStr()}T00:00:00`);
  const target = new Date(`${dateStr}T00:00:00`);
  return Math.round((target - today) / 86400000);
}

function computeNotifications(){
  const items = [];
  const now = Date.now();

  events.forEach(ev => {
    if(ev.status !== 'active') return;

    if(ev.created_at){
      const ageMs = now - new Date(ev.created_at).getTime();
      if(ageMs >= 0 && ageMs <= NOTIF_NEW_WINDOW_DAYS * 86400000){
        items.push({ type: 'new', ev, sortKey: ageMs, desc: 'Az önce eklendi.' });
      }
    }

    const days = daysUntilEvent(ev.event_date);
    if(days === null || days < 0) return;

    const { pct } = computeOccupancy(ev);
    if(days === 0){
      items.push({ type: 'ending', ev, sortKey: 0, desc: 'Bugün oynuyor — son biletler için acele et.' });
    } else if(pct >= NOTIF_SOLDOUT_PCT){
      items.push({ type: 'ending', ev, sortKey: days, desc: `%${pct} dolu — tükenmek üzere.` });
    } else if(days <= NOTIF_UPCOMING_WINDOW_DAYS){
      items.push({ type: 'upcoming', ev, sortKey: days, desc: `${days} gün sonra · ${formatEventDate(ev.event_date)}` });
    }
  });

  items.sort((a, b) => (NOTIF_TYPE_PRIORITY[a.type] - NOTIF_TYPE_PRIORITY[b.type]) || (a.sortKey - b.sortKey));
  return items;
}

function renderNotifications(){
  if(!notifBellBtn) return;
  const items = computeNotifications();

  if(notifBadge){
    notifBadge.textContent = items.length > 9 ? '9+' : String(items.length);
    notifBadge.hidden = items.length === 0;
  }

  if(!notifPanelList) return;
  notifPanelList.innerHTML = '';
  if(!items.length){
    notifPanelList.innerHTML = '<p class="notif-empty">Yeni bildirim yok.</p>';
    return;
  }

  items.forEach(item => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = `notif-item notif-item-${item.type}`;
    row.innerHTML = `
      <span class="notif-item-tag"></span>
      <strong class="notif-item-name"></strong>
      <span class="notif-item-desc"></span>
    `;
    row.querySelector('.notif-item-tag').textContent = NOTIF_TYPE_TAG[item.type];
    row.querySelector('.notif-item-name').textContent = item.ev.name;
    row.querySelector('.notif-item-desc').textContent = item.desc;

    row.addEventListener('click', () => {
      closeNotifPanel();
      enterEvent(item.ev.id, item.ev.name);
    });
    notifPanelList.appendChild(row);
  });
}

function openNotifPanel(){
  if(!notifPanel) return;
  renderNotifications();
  notifPanel.hidden = false;
}
function closeNotifPanel(){
  if(notifPanel) notifPanel.hidden = true;
}

notifBellBtn?.addEventListener('click', (e) => {
  e.stopPropagation();
  if(notifPanel.hidden) openNotifPanel();
  else closeNotifPanel();
});
document.addEventListener('click', (e) => {
  if(!notifPanel || notifPanel.hidden) return;
  if(notifPanel.contains(e.target) || notifBellBtn.contains(e.target)) return;
  closeNotifPanel();
});

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
  // Genel Etkinlik'te bilet türü/ödeme adımı hiç yok (bkz. joinGeneralEvent)
  // — ödeme yöntemi seçimi de anlamsız, gizleniyor.
  newEventPaymentRow.hidden = isGenel;
  // "Sınırlı Bilet" sadece Genel Etkinlik'te anlamlı — kapalı (pasif)
  // gelir, yani varsayılan sınırsız katılım.
  newEventLimitedRow.hidden = !isGenel;
  if(isFutbol){
    newEventStadiumNote.textContent = `Futbol Sahası için sabit ${STADIUM_BLOCKS.length} bloklu stadyum düzeni kullanılır.`;
  } else if(isGenel){
    newEventStadiumNote.textContent = 'Genel Etkinlik ücretsiz/biletsiz tek bir giriş havuzudur — koltuk numarası ve bilet türü/fiyat yok, sadece toplam kapasite.';
  }
}

newEventLimitedCheckbox.addEventListener('change', () => {
  newEventCapacityInput.hidden = !newEventLimitedCheckbox.checked;
  if(newEventLimitedCheckbox.checked){
    if(!newEventCapacityInput.value) newEventCapacityInput.value = DEFAULT_GENERAL_CAPACITY;
    newEventCapacityInput.focus();
  }
});

function openCreateEventModal(){
  newEventName.value = '';
  newEventDate.value = '';
  newEventPoster.value = '';
  newEventVenue.value = 'sinema';
  newEventCols.value = 10;
  newEventRows.value = 8;
  newEventPaymentKart.checked = true;
  newEventPaymentNakit.checked = true;
  newEventLimitedCheckbox.checked = false;
  newEventCapacityInput.value = '';
  newEventCapacityInput.hidden = true;
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

  // Genel Etkinlik'te odeme adimi yok, secimi de yok sayiliyor — diger
  // turlerde en az bir yontem secili olmali.
  const evPaymentMethods = [];
  if(newEventPaymentKart.checked) evPaymentMethods.push('kart');
  if(newEventPaymentNakit.checked) evPaymentMethods.push('nakit');
  if(vType !== 'genel' && !evPaymentMethods.length){
    toast('En az bir ödeme yöntemi seçili olmalı.');
    return;
  }

  // general_capacity artık nullable — null demek "Sınırlı Bilet" kapalı,
  // yani sınırsız katılım (bkz. computeOccupancy/joinGeneralEvent). Diğer
  // venue türlerinde bu alan hiç okunmuyor, null geçilir.
  let evCols, evRows, states, evTiers, evGeneralCapacity = null;
  if(vType === 'futbol'){
    evCols = STADIUM_BLOCKS.length;
    evRows = 1;
    // Stadyumda "boş" 0 (satılan bilet sayısı) — bkz. blockSoldCount.
    states = new Array(STADIUM_BLOCKS.length).fill(0);
    evTiers = DEFAULT_STADIUM_TIERS;
  } else if(vType === 'genel'){
    // Genel Etkinlik'te koltuk numarası da bilet türü/fiyat da yok — tek bir
    // ücretsiz giriş havuzu (bkz. poolBlocks/joinGeneralEvent). "boş" burada
    // da 0 (katılan kişi sayısı). "Sınırlı Bilet" işaretli değilse sınırsız
    // (general_capacity = null).
    if(newEventLimitedCheckbox.checked){
      const cap = Math.round(Number(newEventCapacityInput.value));
      if(!Number.isFinite(cap) || cap < 1){
        toast('Geçerli bir kapasite sayısı gir.');
        return;
      }
      evGeneralCapacity = cap;
    }
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
      payment_methods: evPaymentMethods.length ? evPaymentMethods : ['kart', 'nakit'],
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


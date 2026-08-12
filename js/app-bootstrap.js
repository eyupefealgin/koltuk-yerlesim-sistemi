// Sayfa açılışında zaten geçerli bir Supabase Auth oturumu varsa (önceki
// ziyaretten kalma, tarayıcı kendi tutuyor) onu yükle — async olduğu için
// buton etiketi bir anlığına "Giriş Yap" gösterip sonra "Biletlerim"e dönebilir.
// (auth.js'den buraya taşındı: loadFavorites() events-favorites.js'de tanımlı
// ve bu dosya ondan sonra yükleniyor, ama script'ler dosyaya bölünse de en
// güvenlisi bu init kodunun diğer başlangıç (init()) koduyla birlikte durması.)
(async () => {
  if(!supabaseClient) return;
  try {
    const { data } = await supabaseClient.auth.getSession();
    if(data.session?.user?.email){
      verifiedEmail = data.session.user.email;
      verifiedUserId = data.session.user.id;
      verifiedName = fullNameFromUser(data.session.user);
      updateEmailLoginBtnLabel();
      loadFavorites();
    }
  } catch { /* yoksay */ }
})();

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
    ? 'Bir koltuğa tıkla: bilet türü ve ödeme yöntemini seç'
    : 'Boş bir koltuğa tıklayarak kendi biletini satın alabilirsin.';

  // Reset local state before the fetch resolves so a stale previous event's
  // seats never flash on screen while this one is loading.
  seatStates = [];
  seatSales = [];
  seatButtons = [];
  TICKET_TIERS = [...DEFAULT_TIERS];
  DISCOUNT_CODES = [];
  POSTER_URL = null;
  EVENT_NOTE = null;
  PAYMENT_METHODS = ['kart', 'nakit'];
  eventNoteDisplay.hidden = true;
  GENERAL_CAPACITY = DEFAULT_GENERAL_CAPACITY;
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

// guestLoginBtn admin.html'de yok (personel-only sayfa) — bkz. admin.html.
guestLoginBtn?.addEventListener('click', () => enterApp('guest'));

// Personelin veritabanindaki GERCEK rolunu (profiles.role) okur. Girisin
// kendisi basarili olsa bile (dogru e-posta/sifre), eger bu hesabin rolu bu
// sayfanin bekledigi rolle (pendingLoginRole: 'sales'/'admin') eslesmiyorsa
// -- ornegin bir satis hesabiyla yonetici.html'e girilmeye calisiliyorsa --
// oturum hemen kapatilir. Rol artik client'in soyledigi bir sey degil,
// veritabaninin (current_staff_role()/profiles) dogruladigi bir sey.
async function fetchStaffRole(userId){
  const { data, error } = await supabaseClient
    .from('profiles').select('role').eq('id', userId).maybeSingle();
  if(error) throw error;
  return data ? data.role : null;
}

async function tryPasswordLogin(){
  if(!supabaseClient) return;
  const email = (emailInput?.value || '').trim();
  const password = passwordInput.value;
  if(!email || !password){
    loginError.textContent = 'E-posta ve şifre gir.';
    loginError.hidden = false;
    return;
  }

  passwordSubmit.disabled = true;
  try {
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if(error) throw error;

    const role = await fetchStaffRole(data.user.id);
    if(role !== pendingLoginRole){
      await supabaseClient.auth.signOut();
      loginError.textContent = 'Bu hesabın bu sayfaya giriş yetkisi yok.';
      loginError.hidden = false;
      return;
    }

    loginError.hidden = true;
    passwordInput.value = '';
    enterApp(role);
  } catch(err){
    console.warn('Giriş başarısız.', err);
    loginError.textContent = 'Hatalı e-posta veya şifre.';
    loginError.hidden = false;
  } finally {
    passwordSubmit.disabled = false;
  }
}
passwordSubmit.addEventListener('click', tryPasswordLogin);
passwordInput.addEventListener('keydown', (e) => {
  if(e.key === 'Enter'){
    e.preventDefault();
    tryPasswordLogin();
  }
});
emailInput?.addEventListener('keydown', (e) => {
  if(e.key === 'Enter'){
    e.preventDefault();
    tryPasswordLogin();
  }
});

logoutBtn.addEventListener('click', async () => {
  if(supabaseClient) await supabaseClient.auth.signOut();
  sessionStorage.removeItem(EVENT_SESSION_KEY);
  currentRole = null;
  delete document.body.dataset.role;
  appRoot.hidden = true;
  loginGate.hidden = false;
  passwordInput.value = '';
  loginError.hidden = true;
  setBulkMode(false);

  // satis.html/yonetici.html tek-rollü sayfalar — rol seçim ekranı yok, o
  // yüzden çıkış sonrası init()'teki gibi şifre/e-posta alanı doğrudan
  // tekrar gösterilip odaklanmalı, yoksa kullanıcı boş bir login kartıyla kalır.
  const page = document.body.dataset.page;
  if(page === 'sales' || page === 'admin'){
    pendingLoginRole = page;
    passwordRow.hidden = false;
    emailInput?.focus();
  } else {
    passwordRow.hidden = true;
  }

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
(async function init(){
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
  // yonetici.html (data-page="admin") kendi rolüne ait GERÇEK bir Supabase
  // Auth oturumu varsa (bkz. tryPasswordLogin) otomatik girer — eskiden
  // burada client'in kendi yazdığı bir sessionStorage bayrağına bakılıyordu,
  // yani "girişli" olmak sadece bir tarayıcı değişkeniydi. Artık gerçek
  // oturum + veritabanındaki profiles.role kontrol ediliyor.
  const page = document.body.dataset.page;

  if(page === 'sales' || page === 'admin'){
    pendingLoginRole = page;
    let role = null;
    let session = null;
    if(supabaseClient){
      try {
        const sessionRes = await supabaseClient.auth.getSession();
        session = sessionRes.data.session;
        if(session) role = await fetchStaffRole(session.user.id);
      } catch(err){
        console.warn('Oturum kontrol edilemedi.', err);
      }
    }
    if(role === page){
      enterApp(role);
    } else {
      // Bir oturum var ama rolü bu sayfayla eşleşmiyor (ör. satış hesabıyla
      // yönetici.html'e girilmiş) — yarım/karışık bir durumda bırakmamak
      // için oturumu burada kapatıyoruz, kullanıcı temiz bir giriş ekranı görür.
      if(session && supabaseClient) await supabaseClient.auth.signOut();
      passwordRow.hidden = false;
      emailInput?.focus();
    }
  } else {
    enterApp('guest');
    // QR kodu telefonun kendi kamerasıyla okutulduğunda düz metin göstermek
    // yerine buraya (?bilet=<kod>) düşer — biletin kendi görünümünü otomatik
    // açıyoruz (bkz. tickets.js showTicketFromCode/ticketQrUrl).
    const ticketCode = ticketCodeFromPageUrl();
    if(ticketCode){
      showTicketFromCode(ticketCode);
      const url = new URL(window.location.href);
      url.searchParams.delete(TICKET_URL_PARAM);
      history.replaceState(null, '', url);
    }
  }
})();

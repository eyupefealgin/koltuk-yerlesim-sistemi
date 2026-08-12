// ===== E-posta+şifre ile giriş/kayıt (GERÇEK Supabase Auth) + "Biletlerim" =====
// signUp()/signInWithPassword() — Supabase panelinde "Confirm email" AÇIK,
// bu yüzden signUp() sonrası data.session null dönebilir (onay linki
// tıklanana kadar). Sadece misafir sayfasında (index.html) var; emailLoginBtn
// diğer sayfalarda null olduğu için hepsi ?. ile erişiliyor.
let verifiedEmail = null;
let verifiedUserId = null;    // favorites tablosunun user_id'si için (bkz. loadFavorites/toggleFavorite)
let verifiedName = null;      // Kayıt Ol'da alınan ad soyad (bkz. signUp options.data) — bilet alırken tekrar sorulmasın diye
let favoriteEventIds = new Set();

// signUp() sırasında user_metadata.first_name/last_name olarak kaydedildi
// (bkz. emailLoginSendBtn) — hem yeni kayıt hem de sonraki her girişte
// (giriş, sayfa açılışında oturum geri yükleme) buradan okunuyor.
function fullNameFromUser(user){
  const meta = user?.user_metadata || {};
  const combined = `${(meta.first_name || '').trim()} ${(meta.last_name || '').trim()}`.trim();
  return combined || null;
}
const topbarLogoutBtn = document.getElementById('topbarLogoutBtn');

// Üst çubukta "Biletlerim"in yanında ayrı bir "Çıkış" butonu -- modalı
// açmadan tek tıkla çıkış/hesap değiştirme için (bkz. emailLogoutBtn'in
// modal içindeki eşleniği, aynı signOut() mantığını paylaşıyor).
function updateEmailLoginBtnLabel(){
  if(!emailLoginBtn) return;
  emailLoginBtn.textContent = verifiedEmail ? 'Biletlerim' : 'Giriş Yap';
  if(topbarLogoutBtn) topbarLogoutBtn.hidden = !verifiedEmail;
}
updateEmailLoginBtnLabel();

async function performEmailLogout(){
  if(supabaseClient) await supabaseClient.auth.signOut();
  verifiedEmail = null;
  verifiedUserId = null;
  verifiedName = null;
  favoriteEventIds = new Set();
  updateEmailLoginBtnLabel();
  closeEmailLoginModal();
  if(eventViewMode === 'favorites') setEventViewMode('upcoming');
  else renderEventList();
  toast('Çıkış yapıldı.');
}
topbarLogoutBtn?.addEventListener('click', performEmailLogout);
// Sayfa açılışında zaten geçerli bir oturum varsa yüklenmesi app-bootstrap.js'e
// taşındı (loadFavorites() events-favorites.js'de tanımlı, o da bu dosyadan
// sonra yükleniyor — script bölünmesinden sonra da doğru sırada çalışsın diye).

function showEmailPanel(name){
  document.querySelectorAll('#emailLoginOverlay [data-email-panel]').forEach(p => {
    p.hidden = p.dataset.emailPanel !== name;
  });
}

// "Giriş Yap" / "Kayıt Ol" sekmeleri — gerçek Supabase Auth e-posta+şifre
// (signInWithPassword/signUp), normal sitelerdeki gibi iki ayrı işlem.
// Panel/alanlar aynı, sadece hangi Supabase çağrısının yapılacağını ve
// buton/metin diline hangisinin kullanılacağını authTabMode belirliyor.
let authTabMode = 'login';
// signUp/signInWithPassword/updateUser çağrılarımız da Supabase'in kendi
// onAuthStateChange('SIGNED_IN') olayını tetikliyor -- bu bayrak, o olayı
// SADECE kullanıcı e-postasındaki onay linkine tıklayıp sayfaya kendiliğinden
// geri döndüğünde (bizim tetiklemediğimiz bir giriş) ele almamızı sağlıyor,
// aksi halde aynı "giriş yapıldı" bilgisi iki kez gösterilirdi.
let authSelfInitiated = false;
const authTabLoginBtn = document.getElementById('authTabLogin');
const authTabSignupBtn = document.getElementById('authTabSignup');
const emailLoginNoteEl = document.getElementById('emailLoginNote');
const emailLoginTitleEl = document.getElementById('emailLoginTitle');
const loginSuccessNoteEl = document.getElementById('loginSuccessNote');
const signupNameRow = document.getElementById('signupNameRow');
const signupFirstNameInput = document.getElementById('signupFirstNameInput');
const signupLastNameInput = document.getElementById('signupLastNameInput');

function setAuthTab(mode){
  authTabMode = mode;
  authTabLoginBtn?.classList.toggle('is-active', mode === 'login');
  authTabSignupBtn?.classList.toggle('is-active', mode === 'signup');
  if(emailLoginTitleEl) emailLoginTitleEl.textContent = mode === 'signup' ? 'Hesap Oluştur' : 'Giriş Yap';
  if(emailLoginNoteEl){
    emailLoginNoteEl.textContent = mode === 'signup'
      ? 'Hesap oluşturmak için ad soyad, e-posta ve bir şifre belirle.'
      : 'E-posta ve şifreni gir.';
  }
  if(emailLoginSendBtn) emailLoginSendBtn.textContent = mode === 'signup' ? 'Hesap Oluştur' : 'Giriş Yap';
  if(emailLoginPasswordInput) emailLoginPasswordInput.autocomplete = mode === 'signup' ? 'new-password' : 'current-password';
  if(forgotPasswordBtn) forgotPasswordBtn.hidden = mode === 'signup';
  if(signupNameRow) signupNameRow.hidden = mode !== 'signup';
  if(mode === 'login'){
    if(signupFirstNameInput) signupFirstNameInput.value = '';
    if(signupLastNameInput) signupLastNameInput.value = '';
  }
  if(emailLoginErrorEl) emailLoginErrorEl.hidden = true;
  if(emailLoginInfoNote) emailLoginInfoNote.hidden = true;
}
authTabLoginBtn?.addEventListener('click', () => setAuthTab('login'));
authTabSignupBtn?.addEventListener('click', () => setAuthTab('signup'));

function openEmailLoginModal(){
  if(!emailLoginOverlay) return;
  emailLoginErrorEl.hidden = true;
  emailLoginOverlay.hidden = false;
  if(verifiedEmail){
    if(emailLoginTitleEl) emailLoginTitleEl.textContent = 'Biletlerim';
    if(loginSuccessNoteEl) loginSuccessNoteEl.textContent = `✓ ${verifiedEmail} olarak giriş yaptın.`;
    showEmailPanel('tickets');
    loadMyEmailTickets();
  } else {
    setAuthTab('login');
    emailLoginEmailInput.value = '';
    emailLoginPasswordInput.value = '';
    showEmailPanel('email');
    emailLoginEmailInput.focus();
  }
}
function closeEmailLoginModal(){
  if(emailLoginOverlay) emailLoginOverlay.hidden = true;
}

async function loadMyEmailTickets(){
  myEmailTicketsNote.textContent = 'Yükleniyor...';
  myEmailTicketsList.innerHTML = '';
  if(!supabaseClient || !verifiedEmail) return;
  try {
    const { data, error } = await supabaseClient.rpc('find_tickets_by_email', { p_email: verifiedEmail });
    if(error) throw error;

    const tickets = data || [];
    if(!tickets.length){
      myEmailTicketsNote.textContent = 'Bu e-postayla alınmış bir bilet bulunamadı.';
      return;
    }
    myEmailTicketsNote.textContent = `${tickets.length} bilet bulundu — birine tıklayarak görüntüleyebilirsin.`;
    tickets.forEach(t => {
      const row = document.createElement('div');
      row.className = 'my-ticket-history-item';

      const nameEl = document.createElement('span');
      nameEl.className = 'hist-event';
      nameEl.textContent = t.event_name;

      const seatEl = document.createElement('span');
      seatEl.className = 'hist-seat';
      seatEl.textContent = t.sale.ticketCode;

      row.appendChild(nameEl);
      row.appendChild(seatEl);
      row.addEventListener('click', () => {
        closeEmailLoginModal();
        const ev = {
          name: t.event_name, venue_type: t.event_venue_type,
          cols: t.event_cols, rows: t.event_rows, accessible_seats: t.event_accessible_seats,
        };
        ticketCancelContext = { eventId: t.event_id, idx: t.seat_idx, ticketCode: t.sale.ticketCode, venueType: ev.venue_type, seatPos: t.seat_pos };
        showTicketView(t.seat_idx, t.sale, ev, t.seat_pos);
      });
      myEmailTicketsList.appendChild(row);
    });
  } catch(err){
    console.warn('Biletler alınamadı.', err);
    myEmailTicketsNote.textContent = 'Biletler alınamadı — buluta bağlanılamadı.';
  }
}

emailLoginBtn?.addEventListener('click', openEmailLoginModal);
emailLoginClose?.addEventListener('click', closeEmailLoginModal);
emailLoginOverlay?.addEventListener('click', (e) => { if(e.target === emailLoginOverlay) closeEmailLoginModal(); });

// Şifreli giriş/kayıt — Supabase panelinde "Confirm email" AÇIK (hoca
// istedi): signUp() bir onay maili gönderir ve data.session null döner —
// hesap gerçek anlamda aktif olmuyor, kullanıcı e-postasındaki linke
// tıklayana kadar. O link tıklandığında Supabase kendi kendine session'ı
// URL'den okuyup kuruyor (bkz. sayfa yüklenişindeki getSession() kontrolü).
emailLoginSendBtn?.addEventListener('click', async () => {
  const email = emailLoginEmailInput.value.trim();
  const password = emailLoginPasswordInput.value;
  const firstName = signupFirstNameInput ? signupFirstNameInput.value.trim() : '';
  const lastName = signupLastNameInput ? signupLastNameInput.value.trim() : '';
  if(authTabMode === 'signup' && (!firstName || !lastName)){
    toast('Ad ve soyad gir.');
    return;
  }
  if(!email || !email.includes('@')){
    toast('Geçerli bir e-posta adresi gir.');
    return;
  }
  if(!password){
    toast('Bir şifre gir.');
    return;
  }
  // Supabase varsayılan minimum şifre uzunluğu 6 — client'ta önceden
  // kontrol etmezsek Supabase'in İngilizce hatası ("Password should be at
  // least 6 characters") kullanıcıya çıplak sızardı.
  if(authTabMode === 'signup' && password.length < 6){
    toast('Şifre en az 6 karakter olmalı.');
    return;
  }
  if(!supabaseClient) return;

  emailLoginErrorEl.hidden = true;
  emailLoginInfoNote.hidden = true;
  emailLoginSendBtn.disabled = true;
  authSelfInitiated = true;
  try {
    const { data, error } = authTabMode === 'signup'
      ? await supabaseClient.auth.signUp({
          email, password,
          options: { emailRedirectTo: AUTH_REDIRECT_URL, data: { first_name: firstName, last_name: lastName } },
        })
      : await supabaseClient.auth.signInWithPassword({ email, password });
    if(error) throw error;

    // Supabase, e-posta zaten kayıtlıysa signUp()'ta bazen açık bir hata
    // yerine "başarılı" gibi görünen ama identities'i boş bir kullanıcı
    // döndürür (e-posta numaralandırma saldırılarına karşı) — bunu ayrıca
    // yakalamak gerekiyor.
    if(authTabMode === 'signup' && data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0){
      emailLoginErrorEl.textContent = 'Bu e-posta zaten kayıtlı — Giriş Yap sekmesini dene.';
      emailLoginErrorEl.hidden = false;
      return;
    }

    // signUp() sonrası data.session null ise onay bekleniyor demektir —
    // henüz "giriş yapılmış" sayılmıyoruz, aynı panelde kalıp bilgi veriyoruz.
    if(authTabMode === 'signup' && !data.session){
      emailLoginInfoNote.textContent = `✓ ${email} adresine bir onay linki gönderdik — gelen kutunu (spam dahil) kontrol et ve linke tıkla.`;
      emailLoginInfoNote.hidden = false;
      emailLoginPasswordInput.value = '';
      return;
    }

    verifiedEmail = data.user?.email || email;
    verifiedUserId = data.user?.id || null;
    verifiedName = fullNameFromUser(data.user);
    updateEmailLoginBtnLabel();
    loadFavorites();
    if(emailLoginTitleEl) emailLoginTitleEl.textContent = 'Biletlerim';
    if(loginSuccessNoteEl) loginSuccessNoteEl.textContent = `✓ ${verifiedEmail} olarak giriş yaptın.`;
    emailLoginPasswordInput.value = '';
    showEmailPanel('tickets');
    loadMyEmailTickets();
    toast(authTabMode === 'signup' ? 'Hesap oluşturuldu.' : 'Giriş yapıldı.');
  } catch(err){
    console.warn('Giriş/kayıt başarısız.', err);
    const msg = err.message || err.code || '';
    emailLoginErrorEl.textContent = /already registered|user_already_exists/i.test(msg)
      ? 'Bu e-posta zaten kayıtlı — Giriş Yap sekmesini dene.'
      : /invalid login|invalid_credentials/i.test(msg)
        ? 'E-posta veya şifre hatalı.'
        : /email not confirmed|email_not_confirmed/i.test(msg)
          ? 'Bu hesabı henüz onaylamadın — e-postana gönderdiğimiz onay linkine tıkla.'
          : /password should be at least|password.*6 char/i.test(msg)
            ? 'Şifre en az 6 karakter olmalı.'
            : err.message || 'İşlem başarısız — buluta bağlanılamadı.';
    emailLoginErrorEl.hidden = false;
  } finally {
    emailLoginSendBtn.disabled = false;
    authSelfInitiated = false;
  }
});
signupFirstNameInput?.addEventListener('keydown', (e) => { if(e.key === 'Enter'){ e.preventDefault(); signupLastNameInput?.focus(); } });
signupLastNameInput?.addEventListener('keydown', (e) => { if(e.key === 'Enter'){ e.preventDefault(); emailLoginEmailInput.focus(); } });
emailLoginEmailInput?.addEventListener('keydown', (e) => { if(e.key === 'Enter'){ e.preventDefault(); emailLoginSendBtn.click(); } });
emailLoginPasswordInput?.addEventListener('keydown', (e) => { if(e.key === 'Enter'){ e.preventDefault(); emailLoginSendBtn.click(); } });

// ===== Şifremi unuttum =====
forgotPasswordBtn?.addEventListener('click', () => {
  emailLoginErrorEl.hidden = true;
  emailLoginInfoNote.hidden = true;
  forgotErrorEl.hidden = true;
  forgotInfoNote.hidden = true;
  forgotEmailInput.value = emailLoginEmailInput.value.trim();
  showEmailPanel('forgot');
  forgotEmailInput.focus();
});
forgotBackBtn?.addEventListener('click', () => { setAuthTab('login'); showEmailPanel('email'); });

forgotSendBtn?.addEventListener('click', async () => {
  const email = forgotEmailInput.value.trim();
  if(!email || !email.includes('@')){
    toast('Geçerli bir e-posta adresi gir.');
    return;
  }
  if(!supabaseClient) return;

  forgotErrorEl.hidden = true;
  forgotSendBtn.disabled = true;
  try {
    const { error } = await supabaseClient.auth.resetPasswordForEmail(email, { redirectTo: AUTH_REDIRECT_URL });
    if(error) throw error;
    forgotInfoNote.textContent = `✓ ${email} adresine bir sıfırlama linki gönderdik — gelen kutunu (spam dahil) kontrol et.`;
    forgotInfoNote.hidden = false;
  } catch(err){
    console.warn('Sıfırlama linki gönderilemedi.', err);
    forgotErrorEl.textContent = 'Gönderilemedi — buluta bağlanılamadı.';
    forgotErrorEl.hidden = false;
  } finally {
    forgotSendBtn.disabled = false;
  }
});
forgotEmailInput?.addEventListener('keydown', (e) => { if(e.key === 'Enter'){ e.preventDefault(); forgotSendBtn.click(); } });

// Sıfırlama linkine tıklayınca Supabase bizi PASSWORD_RECOVERY olayıyla
// geri gönderiyor — modalı açıp doğrudan "yeni şifre belirle" panelini
// gösteriyoruz (kullanıcı ayrıca giriş yapmasına gerek yok, link zaten
// geçici bir oturum kuruyor). emailLoginOverlay yoksa (satis.html/
// yonetici.html — personel sayfaları) resetErrorEl/resetPasswordInput da
// null'dur, erkenden çıkıyoruz — yoksa null referansta patlar.
//
// SIGNED_IN dalı ise "e-posta onay linkine tıklayıp siteye kendiliğinden
// geri dönme" durumunu yakalıyor — o an buton sessizce "Biletlerim"e
// dönüyordu ama kullanıcı bunu fark etmiyordu (bkz. daha önceki OTP/magic
// link akışındaki aynı şikayet). authSelfInitiated true ise (yani bu SIGNED_IN
// zaten kendi buton tıklamamızın sonucuysa) tekrar bildirmiyoruz.
supabaseClient?.auth.onAuthStateChange((event, session) => {
  if(event === 'PASSWORD_RECOVERY'){
    if(!emailLoginOverlay) return;
    emailLoginOverlay.hidden = false;
    resetErrorEl.hidden = true;
    resetPasswordInput.value = '';
    showEmailPanel('reset');
    return;
  }
  // emailLoginOverlay yalnızca index.html'de (misafir sayfası) var --
  // personel sayfalarında da signInWithPassword() çağrılıyor (bkz.
  // tryPasswordLogin) ve o da SIGNED_IN fırlatıyor; bu kontrol olmadan
  // personelin girişi burada "misafir e-postası" olarak yanlışlıkla
  // verifiedEmail'e yazılırdı.
  if(event === 'SIGNED_IN' && emailLoginOverlay && !authSelfInitiated && session?.user?.email){
    verifiedEmail = session.user.email;
    verifiedUserId = session.user.id;
    verifiedName = fullNameFromUser(session.user);
    updateEmailLoginBtnLabel();
    loadFavorites();
    toast(`E-posta onaylandı — ${verifiedEmail} olarak giriş yaptın.`);
  }
});

resetConfirmBtn?.addEventListener('click', async () => {
  const password = resetPasswordInput.value;
  if(!password){
    toast('Bir şifre gir.');
    return;
  }
  if(password.length < 6){
    toast('Şifre en az 6 karakter olmalı.');
    return;
  }
  if(!supabaseClient) return;

  resetErrorEl.hidden = true;
  resetConfirmBtn.disabled = true;
  authSelfInitiated = true;
  try {
    const { data, error } = await supabaseClient.auth.updateUser({ password });
    if(error) throw error;

    verifiedEmail = data.user?.email || verifiedEmail;
    verifiedUserId = data.user?.id || verifiedUserId;
    verifiedName = fullNameFromUser(data.user) || verifiedName;
    updateEmailLoginBtnLabel();
    loadFavorites();
    if(emailLoginTitleEl) emailLoginTitleEl.textContent = 'Biletlerim';
    if(loginSuccessNoteEl) loginSuccessNoteEl.textContent = `✓ ${verifiedEmail} olarak giriş yaptın.`;
    resetPasswordInput.value = '';
    showEmailPanel('tickets');
    loadMyEmailTickets();
    toast('Şifre güncellendi.');
  } catch(err){
    console.warn('Şifre güncellenemedi.', err);
    const msg = err.message || '';
    resetErrorEl.textContent = /password should be at least|password.*6 char/i.test(msg)
      ? 'Şifre en az 6 karakter olmalı.'
      : msg || 'Şifre güncellenemedi — buluta bağlanılamadı.';
    resetErrorEl.hidden = false;
  } finally {
    resetConfirmBtn.disabled = false;
    authSelfInitiated = false;
  }
});
resetPasswordInput?.addEventListener('keydown', (e) => { if(e.key === 'Enter'){ e.preventDefault(); resetConfirmBtn.click(); } });

emailLogoutBtn?.addEventListener('click', performEmailLogout);

document.addEventListener('keydown', (e) => {
  if(e.key !== 'Escape') return;
  if(!seatModalOverlay.hidden) closeSeatModal();
  if(!createEventOverlay.hidden) closeCreateEventModal();
  if(!ticketViewOverlay.hidden) closeTicketView();
  if(!checkinOverlay.hidden) closeCheckinModal();
  if(!myTicketOverlay.hidden) closeMyTicketModal();
  if(emailLoginOverlay && !emailLoginOverlay.hidden) closeEmailLoginModal();
});


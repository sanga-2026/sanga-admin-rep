/*
  /js/sanga-auth.js — PRODUCTION VERSION
  ------------------------------------------------------------------
  Real auth for Sangha, same pattern as Flagship:
    Phone number -> SMS OTP (Firebase Phone Auth) -> 6-digit PIN
    (set on first login, confirmed on every later login)

  Every other page still calls only SanghaAuth.* — the internals below
  now talk to Firebase Auth + Cloud Functions instead of localStorage.

  IMPORTANT — every page must load, in this order, BEFORE this file:
    <script src="https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js"></script>
    <script src="https://www.gstatic.com/firebasejs/10.12.0/firebase-auth-compat.js"></script>
    <script src="https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore-compat.js"></script>
    <script src="https://www.gstatic.com/firebasejs/10.12.0/firebase-functions-compat.js"></script>
    <script src="/js/firebase-config.js"></script>
    <script src="/js/sanga-data.js"></script>
    <script src="/js/sanga-auth.js"></script>
------------------------------------------------------------------ */
(function (global) {
  const PIN_GATE_KEY = 'sangha_pin_verified_v1';
  const DEVICE_ID_KEY = 'sangha_device_id_v1';

  const setUserPinFn = sanghaFunctions.httpsCallable('setUserPin');
  const verifyUserPinFn = sanghaFunctions.httpsCallable('verifyUserPin');
  const checkPhoneDeviceFn = sanghaFunctions.httpsCallable('checkPhoneDevice');

  // A private ID for this browser, generated once and kept in localStorage
  // (not sessionStorage — this needs to survive closing the browser
  // entirely). Purely for the informational "known devices" list on the
  // account — it does not by itself grant access to anything.
  function getDeviceId() {
    try {
      let id = localStorage.getItem(DEVICE_ID_KEY);
      if (!id) {
        id = 'dev_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
        localStorage.setItem(DEVICE_ID_KEY, id);
      }
      return id;
    } catch (e) {
      // Storage unavailable (private browsing, etc.) — fall back to a
      // per-page-load ID. Device tracking just won't persist for them.
      return 'dev_temp_' + Math.random().toString(36).slice(2, 10);
    }
  }

  let currentSession = null; // { id, name, phone } | null — kept in sync below
  let authReadyResolve;
  const authReady = new Promise((res) => { authReadyResolve = res; });
  let confirmationResult = null; // set after sendOtp(), used by verifyOtp()
  let recaptchaVerifier = null;

  /* ---------------------------- profile doc ------------------------------- */
  async function loadProfile(uid) {
    const snap = await sanghaDb.collection('users').doc(uid).get();
    return snap.exists ? snap.data() : null;
  }

  sanghaAuthSDK.onAuthStateChanged(async (user) => {
    if (!user) {
      currentSession = null;
      authReadyResolve();
      return;
    }
    const profile = await loadProfile(user.uid);
    currentSession = {
      id: user.uid,
      name: (profile && profile.name) || '',
      phone: user.phoneNumber || '',
      hasPin: !!(profile && profile.pinSet),
    };
    authReadyResolve();
  });

  /* --------------------------- session getters ---------------------------- */
  // Synchronous, like the old version — safe to call once whenReady() has
  // resolved. Pages that run on load should `await SanghaAuth.whenReady()`
  // once (e.g. /login.html's "already logged in?" check).
  function getSession() {
    if (!currentSession) return null;
    // Once the PIN is confirmed, it stays confirmed on this device — in
    // every tab, and across closing/reopening the browser — until they
    // explicitly log out. Deliberately using localStorage rather than
    // sessionStorage here: sessionStorage is scoped per-tab in every
    // browser, which meant opening a new tab (or just pasting the link
    // again) looked like a fresh, unconfirmed session and asked for the
    // PIN again, even though it's the same person on the same device a
    // moment later.
    if (!localStorage.getItem(PIN_GATE_KEY)) return null;
    return { id: currentSession.id, name: currentSession.name, phone: currentSession.phone };
  }

  // True if THIS device already holds a live Firebase session that
  // belongs to the given phone number. This is the only thing that can
  // actually skip OTP — Firebase's own phone-auth system has no other way
  // to sign in without it. /login.html uses this right after the person
  // types their phone number, before deciding whether to send a code at
  // all. If they've genuinely signed in on this browser before (and
  // haven't logged out or cleared storage since), this is true and OTP
  // is skipped; otherwise OTP is always required, new account or not.
  function isKnownDeviceForPhone(phone) {
    return !!(currentSession && currentSession.phone === phone);
  }

  // Looks up a phone number BEFORE any sign-in happens, to find out
  // whether an account already exists for it and how many devices it's
  // known from. Used only to decide what to show on the OTP+PIN screen
  // (the "logged in from more than 5 devices" notice) — never to decide
  // whether OTP itself is needed, which is handled by
  // isKnownDeviceForPhone() above instead.
  async function checkPhoneDevice(phone) {
    const res = await checkPhoneDeviceFn({ phone });
    return res.data; // { accountExists, pinSet, deviceCount }
  }

  // What a host needs on their profile before an event of theirs can go live —
  // the minimum that lets guests know who they're booking with. THIS is the one
  // place the rule lives: /events/create_event.html and /profile/user_profile.html both ask
  // hostProfileStatus(). To require more or less, edit this list.
  const HOST_PROFILE_REQUIRED = [
    { key: 'name',  label: 'Your name', done: (p) => !!(p.name && String(p.name).trim()) },
    { key: 'about', label: 'About me',  done: (p) => !!(p.bio && String(p.bio).trim()) },
    { key: 'city',  label: 'City',      done: (p) => !!(p.location && p.location.city && String(p.location.city).trim()) },
  ];

  // Reads the saved profile fresh each time, so it's always current.
  // -> { complete, items:[{key,label,done}], missing:[{key,label,done}] }
  async function hostProfileStatus() {
    const session = getSession();
    const profile = session ? ((await loadProfile(session.id)) || {}) : {};
    if (session && !profile.name && session.name) profile.name = session.name;
    const items = HOST_PROFILE_REQUIRED.map((r) => ({ key: r.key, label: r.label, done: !!session && r.done(profile) }));
    return { complete: items.every((i) => i.done), items, missing: items.filter((i) => !i.done) };
  }

  function whenReady() { return authReady; }

  function logOut() {
    localStorage.removeItem(PIN_GATE_KEY);
    return sanghaAuthSDK.signOut();
  }

  /* ------------------------------ phone + OTP ------------------------------ */
  function ensureRecaptcha(containerId) {
    if (recaptchaVerifier) return recaptchaVerifier;
    recaptchaVerifier = new firebase.auth.RecaptchaVerifier(containerId, { size: 'invisible' });
    return recaptchaVerifier;
  }

  // phone must be E.164, e.g. +14155552671
  async function sendOtp(phone, recaptchaContainerId) {
    const verifier = ensureRecaptcha(recaptchaContainerId);
    confirmationResult = await sanghaAuthSDK.signInWithPhoneNumber(phone, verifier);
    return true;
  }

  async function verifyOtp(code) {
    if (!confirmationResult) throw new Error('Request a code first.');
    const result = await confirmationResult.confirm(code);
    // Don't rely on Firebase's own isNewUser flag here — it only reflects
    // whether the Auth account was just created, not whether this person
    // ever actually finished setting up a PIN. If an earlier attempt got
    // interrupted after OTP but before the PIN save succeeded, Firebase
    // correctly reports isNewUser: false on the next try, which would
    // incorrectly route a PIN-less account straight to "enter your PIN."
    // Checking their real profile doc directly avoids that.
    const profile = await loadProfile(result.user.uid);
    const hasPin = !!(profile && profile.pinSet);
    return { uid: result.user.uid, isNewUser: !hasPin };
  }

  /* --------------------------------- PIN ----------------------------------- */
  function assertSixDigits(pin) {
    if (!/^\d{6}$/.test(pin)) throw new Error('PIN must be exactly 6 digits.');
  }

  // First-time login: create the profile doc + set the PIN.
  async function setPin(pin, name) {
    assertSixDigits(pin);
    const uid = sanghaAuthSDK.currentUser && sanghaAuthSDK.currentUser.uid;
    if (!uid) throw new Error('Not signed in.');
    await sanghaDb.collection('users').doc(uid).set({
      name: (name || '').trim(),
      phone: sanghaAuthSDK.currentUser.phoneNumber || '',
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    // Force a fresh ID token before the callable request. Right after phone
    // verification, the client can look "signed in" a beat before the token
    // callable functions rely on is actually ready — without this, the
    // Cloud Function sees context.auth as null and rejects with
    // "Must be signed in." even though the user genuinely is.
    await sanghaAuthSDK.currentUser.getIdToken(true);
    await setUserPinFn({ pin, deviceId: getDeviceId() }); // hashes + stores PIN server-side, never in Firestore client-readable form
    localStorage.setItem(PIN_GATE_KEY, '1');
    currentSession = await refreshSession();
    return getSession();
  }

  // Returning login: confirm the PIN they already set.
  async function verifyPin(pin) {
    assertSixDigits(pin);
    if (sanghaAuthSDK.currentUser) {
      // Same fix as setPin() above — force a fresh token before the callable call.
      await sanghaAuthSDK.currentUser.getIdToken(true);
    }
    const res = await verifyUserPinFn({ pin, deviceId: getDeviceId() }); // { success, attemptsRemaining?, deviceCount? }
    if (res.data && res.data.success) {
      localStorage.setItem(PIN_GATE_KEY, '1');
      currentSession = await refreshSession();
      return getSession();
    }
    return null;
  }

  async function refreshSession() {
    const user = sanghaAuthSDK.currentUser;
    if (!user) return null;
    const profile = await loadProfile(user.uid);
    return { id: user.uid, name: (profile && profile.name) || '', phone: user.phoneNumber || '', hasPin: !!(profile && profile.pinSet) };
  }

  /* -------------------------- shared modal UI ------------------------------ */
  // Flow: phone -> otp -> (new user: choose name + set pin) | (returning: enter pin)
  let mounted = false;
  let step = 'phone';
  let onSuccessCb = null;
  let pendingIsNewUser = false;

  function ensureModal() {
    if (mounted) return;
    mounted = true;
    const style = document.createElement('style');
    style.textContent = `
      .sga-overlay{position:fixed;inset:0;background:rgba(13,13,13,.55);display:flex;align-items:center;justify-content:center;z-index:99999;padding:20px;}
      .sga-overlay.hidden{display:none;}
      .sga-card{position:relative;background:#fff;border-radius:20px;padding:30px 26px;max-width:380px;width:100%;font-family:'Lato',sans-serif;color:#0D0D0D;box-shadow:0 20px 60px rgba(0,0,0,.28);}
      .sga-title{font-family:'Poppins',sans-serif;font-weight:700;font-size:19px;margin-bottom:6px;}
      .sga-sub{font-size:13px;opacity:.65;margin-bottom:18px;line-height:1.5;}
      .sga-field{margin-bottom:12px;}
      .sga-field label{display:block;font-size:12.5px;font-weight:700;margin-bottom:5px;}
      .sga-field input{width:100%;padding:11px 13px;border-radius:10px;border:1px solid #E4E4E4;font-size:13.5px;font-family:inherit;box-sizing:border-box;outline:none;letter-spacing:.02em;}
      .sga-field input:focus{border-color:#F2A94E;}
      .sga-btn{width:100%;padding:13px;border-radius:12px;background:#F2A94E;color:#fff;font-weight:700;font-size:14px;border:none;cursor:pointer;margin-top:4px;font-family:inherit;}
      .sga-btn:disabled{opacity:.6;cursor:default;}
      .sga-btn:hover:not(:disabled){opacity:.92;}
      .sga-error{color:#C0392B;font-size:12px;margin:-4px 0 10px;display:none;}
      .sga-error.show{display:block;}
      .sga-close{position:absolute;top:14px;right:16px;background:none;border:none;font-size:20px;cursor:pointer;opacity:.45;line-height:1;}
      .sga-close:hover{opacity:.8;}
      #sgaRecaptchaHolder{height:0;overflow:hidden;}
    `;
    document.head.appendChild(style);

    const overlay = document.createElement('div');
    overlay.className = 'sga-overlay hidden';
    overlay.id = 'sgaOverlay';
    overlay.innerHTML = `
      <div class="sga-card">
        <button type="button" class="sga-close" id="sgaClose">&times;</button>
        <div class="sga-title" id="sgaTitle">Log in</div>
        <div class="sga-sub" id="sgaSub"></div>
        <div id="sgaFormArea"></div>
        <div id="sgaRecaptchaHolder"></div>
      </div>`;
    document.body.appendChild(overlay);
    document.getElementById('sgaClose').addEventListener('click', hideModal);
    overlay.addEventListener('click', (e) => { if (e.target === overlay && overlay.dataset.dismissible === '1') hideModal(); });
  }

  function setErr(msg) {
    const el = document.getElementById('sgaError');
    if (!el) return;
    if (!msg) { el.classList.remove('show'); return; }
    el.textContent = msg; el.classList.add('show');
  }

  function renderStep() {
    const area = document.getElementById('sgaFormArea');
    const errBlock = '<div class="sga-error" id="sgaError"></div>';

    if (step === 'phone') {
      document.getElementById('sgaTitle').textContent = 'Log in with your phone';
      document.getElementById('sgaSub').textContent = "We'll text you a one-time code.";
      area.innerHTML = `
        <div class="sga-field"><label>Phone number</label><input type="tel" id="sgaPhone" placeholder="+1 555 000 0000"></div>
        ${errBlock}
        <button type="button" class="sga-btn" id="sgaSubmit">Send code</button>`;
      document.getElementById('sgaSubmit').addEventListener('click', async () => {
        const phone = document.getElementById('sgaPhone').value.trim();
        if (!/^\+\d{8,15}$/.test(phone)) { setErr('Enter your number in international format, e.g. +14155552671.'); return; }
        setErr(''); const btn = document.getElementById('sgaSubmit'); btn.disabled = true; btn.textContent = 'Checking…';
        try {
          if (isKnownDeviceForPhone(phone)) {
            // This browser already holds a session for this number — skip OTP.
            step = 'checkpin'; renderStep();
            return;
          }
          btn.textContent = 'Sending…';
          await sendOtp(phone, 'sgaRecaptchaHolder');
          step = 'otp'; renderStep();
        } catch (e) {
          setErr(e.message || 'Could not send code — try again.');
          btn.disabled = false; btn.textContent = 'Send code';
        }
      });
      return;
    }

    if (step === 'otp') {
      document.getElementById('sgaTitle').textContent = 'Enter the code';
      document.getElementById('sgaSub').textContent = 'Check your texts for a 6-digit code.';
      area.innerHTML = `
        <div class="sga-field"><label>SMS code</label><input type="text" inputmode="numeric" maxlength="6" id="sgaCode" placeholder="123456"></div>
        ${errBlock}
        <button type="button" class="sga-btn" id="sgaSubmit">Verify</button>`;
      document.getElementById('sgaSubmit').addEventListener('click', async () => {
        const code = document.getElementById('sgaCode').value.trim();
        if (!/^\d{6}$/.test(code)) { setErr('Enter the 6-digit code.'); return; }
        setErr(''); const btn = document.getElementById('sgaSubmit'); btn.disabled = true; btn.textContent = 'Verifying…';
        try {
          const { isNewUser } = await verifyOtp(code);
          pendingIsNewUser = isNewUser;
          step = isNewUser ? 'setpin' : 'checkpin';
          renderStep();
        } catch (e) {
          setErr('That code was incorrect or expired.');
          btn.disabled = false; btn.textContent = 'Verify';
        }
      });
      return;
    }

    if (step === 'setpin') {
      document.getElementById('sgaTitle').textContent = 'Set up your PIN';
      document.getElementById('sgaSub').textContent = "Choose a 6-digit PIN — you'll use it to log in next time.";
      area.innerHTML = `
        <div class="sga-field"><label>Your name</label><input type="text" id="sgaName" placeholder="Your name"></div>
        <div class="sga-field"><label>Create a 6-digit PIN</label><input type="password" inputmode="numeric" maxlength="6" id="sgaPin" placeholder="••••••"></div>
        ${errBlock}
        <button type="button" class="sga-btn" id="sgaSubmit">Finish</button>`;
      document.getElementById('sgaSubmit').addEventListener('click', async () => {
        const name = document.getElementById('sgaName').value.trim();
        const pin = document.getElementById('sgaPin').value.trim();
        if (!name) { setErr('Please add your name.'); return; }
        if (!/^\d{6}$/.test(pin)) { setErr('PIN must be exactly 6 digits.'); return; }
        setErr(''); const btn = document.getElementById('sgaSubmit'); btn.disabled = true; btn.textContent = 'Saving…';
        try {
          await setPin(pin, name);
          const cb = onSuccessCb; hideModal(); if (cb) cb(getSession());
        } catch (e) {
          setErr(e.message || 'Could not save your PIN.');
          btn.disabled = false; btn.textContent = 'Finish';
        }
      });
      return;
    }

    if (step === 'checkpin') {
      document.getElementById('sgaTitle').textContent = 'Enter your PIN';
      document.getElementById('sgaSub').textContent = 'Confirm your 6-digit PIN to finish logging in.';
      area.innerHTML = `
        <div class="sga-field"><label>PIN</label><input type="password" inputmode="numeric" maxlength="6" id="sgaPin" placeholder="••••••"></div>
        ${errBlock}
        <button type="button" class="sga-btn" id="sgaSubmit">Log in</button>`;
      document.getElementById('sgaSubmit').addEventListener('click', async () => {
        const pin = document.getElementById('sgaPin').value.trim();
        if (!/^\d{6}$/.test(pin)) { setErr('Enter your 6-digit PIN.'); return; }
        setErr(''); const btn = document.getElementById('sgaSubmit'); btn.disabled = true; btn.textContent = 'Checking…';
        try {
          const session = await verifyPin(pin);
          if (!session) { setErr('Incorrect PIN — try again.'); btn.disabled = false; btn.textContent = 'Log in'; return; }
          const cb = onSuccessCb; hideModal(); if (cb) cb(session);
        } catch (e) {
          setErr(e.message || 'Something went wrong.');
          btn.disabled = false; btn.textContent = 'Log in';
        }
      });
      return;
    }
  }

  function showModal({ onSuccess, allowDismiss, message } = {}) {
    ensureModal();
    step = 'phone';
    onSuccessCb = onSuccess || null;
    const overlay = document.getElementById('sgaOverlay');
    overlay.dataset.dismissible = allowDismiss === false ? '0' : '1';
    document.getElementById('sgaClose').style.display = allowDismiss === false ? 'none' : '';
    renderStep();
    if (message) document.getElementById('sgaSub').textContent = message;
    overlay.classList.remove('hidden');
  }

  function hideModal() {
    const ov = document.getElementById('sgaOverlay');
    if (ov) ov.classList.add('hidden');
  }

  async function requireLogin({ onSuccess, message } = {}) {
    await whenReady();
    const session = getSession();
    if (session) { if (onSuccess) onSuccess(session); return; }
    showModal({ onSuccess, allowDismiss: false, message: message || 'You need an account to host an experience on Sangha.' });
  }

  global.SanghaAuth = {
    getSession, whenReady, logOut, isKnownDeviceForPhone, checkPhoneDevice, hostProfileStatus,
    showModal, hideModal, requireLogin,
    // Exposed so a full-page flow (/login.html) can build its own screens
    // instead of the popup modal, using the exact same underlying calls.
    sendOtp, verifyOtp, setPin, verifyPin, ensureRecaptcha,
  };
})(window);

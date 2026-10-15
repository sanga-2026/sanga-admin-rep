/* Sanga chat helper: people write to a host (and the host writes back).
   Needs firebase-config.js first (it makes `sanghaDb`); pictures and documents also need firebase-storage-compat.js.
   Database shape (see docs/database_shape.md):
     chats/<eventId>_<guestId>            chat about one event (guest starts it)
     chats/h_<hostId>_<guestId>           chat with a host from their profile (the openHostChat function starts it)
        { eventId, eventTitle, hostId, hostName, guestId, guestName, participants, lastText, lastAt, lastSenderId, createdAt }
     chats/<id>/messages/<auto id>        { senderId, text, attachments, createdAt, deleted }
     attachments: [{ type: 'image' | 'file', name, url, size } | { type: 'location', lat, lng, label }]  (up to 3)   */
(function(){
  const MAX_TEXT = 2000;
  const MAX_ATTACH = 3;
  const MAX_FILE_BYTES = 2 * 1024 * 1024;           // documents and (after squeezing) pictures
  const DOC_TYPES = /^(application\/pdf|application\/msword|application\/vnd\.openxmlformats-officedocument\..*|text\/plain)$/i;
  const EMOJIS = ['😀','😃','😄','😁','😊','🙂','😉','😍','🥰','😘','😎','🤗','🙏','👍','👏','🙌','💪','🎉','✨','🌟','❤️','🧡','💛','💚','💙','🌿','🌸','🌞','🌈','🏔️','🧘','🚶','☕','🍃','😂','🤣','😅','😢','😮','🤔','👋','🤝','✅','📍','📅','⏰'];

  function db(){ return typeof sanghaDb !== 'undefined' ? sanghaDb : null; }
  function chatIdFor(eventId, guestId){ return String(eventId) + '_' + String(guestId); }
  function nowIso(){ return new Date().toISOString(); }
  function safeName(n){ return String(n || 'file').replace(/[^A-Za-z0-9._-]+/g, '_').slice(-80); }
  function esc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

  // Opens (or finds) the chat between this guest and the host of the event. Returns the chat id.
  // event: { id, title, hostId, hostName }   me: { id, name }
  async function ensureChat(event, me){
    const id = chatIdFor(event.id, me.id);
    const ref = db().collection('chats').doc(id);
    const snap = await ref.get();
    if(!snap.exists){
      await ref.set({
        eventId: String(event.id),
        eventTitle: event.title || '',
        hostId: event.hostId,
        hostName: event.hostName || event.host || 'Host',
        guestId: me.id,
        guestName: me.name || 'Guest',
        participants: [event.hostId, me.id],
        lastText: '',
        lastAt: nowIso(),
        lastSenderId: '',
        createdAt: nowIso()
      });
    }
    return id;
  }

  // Opens (or finds) a chat with a host from their profile. The server checks the person is a host who accepts messages.
  async function openHostChat(hostId){
    const res = await sanghaFunctions.httpsCallable('openHostChat')({ hostId });
    return res.data && res.data.chatId;
  }

  function lastLabel(text, attachments){
    if(text) return text.slice(0, 120);
    const a = (attachments || [])[0];
    if(!a) return '';
    return a.type === 'location' ? 'Shared a location' : a.type === 'image' ? 'Sent a picture' : 'Sent a file';
  }

  // payload: a string, or { text, attachments }
  async function send(chatId, me, payload){
    const p = typeof payload === 'string' ? { text: payload } : (payload || {});
    const text = String(p.text || '').trim().slice(0, MAX_TEXT);
    const attachments = (p.attachments || []).slice(0, MAX_ATTACH);
    if(!text && !attachments.length) return false;
    const at = nowIso();
    const ref = db().collection('chats').doc(chatId);
    const msg = { senderId: me.id, text, createdAt: at, deleted: false };
    if(attachments.length) msg.attachments = attachments;
    await ref.collection('messages').add(msg);
    await ref.update({ lastText: lastLabel(text, attachments), lastAt: at, lastSenderId: me.id });
    return true;
  }

  // Anyone can delete their OWN message: it stays in the chat as "Message deleted".
  function deleteMessage(chatId, messageId){
    return db().collection('chats').doc(chatId).collection('messages').doc(messageId).update({ deleted: true, text: '', attachments: [] });
  }

  // Live list of my chats, newest first. Returns the stop function.
  function watchMyChats(myId, cb){
    return db().collection('chats').where('participants', 'array-contains', myId).onSnapshot((snap) => {
      const rows = snap.docs.map((d) => Object.assign({ id: d.id }, d.data()));
      rows.sort((a, b) => String(b.lastAt || '').localeCompare(String(a.lastAt || '')));
      cb(rows);
    }, (err) => { console.warn('SanghaChat: could not load chats', err); cb([], err); });
  }

  function watchChat(chatId, cb){
    return db().collection('chats').doc(chatId).onSnapshot((d) => cb(d.exists ? Object.assign({ id: d.id }, d.data()) : null),
      (err) => { console.warn('SanghaChat: could not load chat', err); cb(null, err); });
  }

  // Live messages of one chat, oldest first. Returns the stop function.
  function watchMessages(chatId, cb){
    return db().collection('chats').doc(chatId).collection('messages').orderBy('createdAt').onSnapshot((snap) => {
      cb(snap.docs.map((d) => Object.assign({ id: d.id }, d.data())));
    }, (err) => { console.warn('SanghaChat: could not load messages', err); cb([], err); });
  }

  /* ---------------- pictures: squeezed instead of refused ---------------- */
  function loadPicture(url){
    return new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = reject; i.src = url; });
  }
  // A picture is saved again as a JPEG (smaller file); if it is still over the limit it is also made a bit smaller in pixels, step by step.
  async function squeezePicture(file){
    if(!/^image\/(jpeg|png|webp|bmp|gif)$/i.test(file.type)) return file;
    const url = URL.createObjectURL(file);
    let img;
    try { img = await loadPicture(url); } finally { URL.revokeObjectURL(url); }
    let scale = Math.min(1, 2000 / Math.max(img.naturalWidth, img.naturalHeight));
    let quality = 0.8;
    for(let i = 0; i < 6; i++){
      const w = Math.max(1, Math.round(img.naturalWidth * scale)), h = Math.max(1, Math.round(img.naturalHeight * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
      if(blob && blob.size <= MAX_FILE_BYTES - 20000){
        const name = String(file.name || 'picture').replace(/\.[A-Za-z0-9]+$/, '') + '.jpg';
        return (blob.size < file.size || file.size > MAX_FILE_BYTES) ? new File([blob], name, { type: 'image/jpeg' }) : file;
      }
      scale *= 0.75; quality = Math.max(0.5, quality - 0.05);
    }
    return file;
  }

  // Uploads one file for the signed-in person and returns the attachment record.
  async function uploadAttachment(me, file){
    const f = file.type.startsWith('image/') ? await squeezePicture(file) : file;
    if(f.size > MAX_FILE_BYTES) throw new Error('too_big');
    const path = 'chatFiles/' + me.id + '/' + Date.now() + '-' + Math.floor(Math.random() * 1e6) + '-' + safeName(f.name);
    const ref = firebase.storage().ref(path);
    await ref.put(f, { contentType: f.type || 'application/octet-stream' });
    const url = await ref.getDownloadURL();
    return { type: f.type.startsWith('image/') ? 'image' : 'file', name: f.name, url, size: f.size };
  }

  /* ---------------- showing attachments inside a message ---------------- */
  function sizeText(b){ return b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB'; }
  function attachmentsHtml(list){
    return (list || []).map((a) => {
      if(a.type === 'image') return `<a class="sgc-img" href="${esc(a.url)}" target="_blank" rel="noopener"><img src="${esc(a.url)}" alt="${esc(a.name)}" loading="lazy"></a>`;
      if(a.type === 'file') return `<a class="sgc-file" href="${esc(a.url)}" target="_blank" rel="noopener"><b>${esc(a.name)}</b><span>${a.size ? esc(sizeText(a.size)) : 'Open'}</span></a>`;
      if(a.type === 'location'){
        const ll = a.lat + ',' + a.lng;
        const g = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(ll);
        const ap = 'https://maps.apple.com/?ll=' + encodeURIComponent(ll) + '&q=' + encodeURIComponent(a.label || 'Shared location');
        return `<div class="sgc-loc"><b>Shared location</b><span>${esc(a.label || ll)}</span><a href="${g}" target="_blank" rel="noopener">Open in Google Maps</a> <a href="${ap}" target="_blank" rel="noopener">Apple Maps</a></div>`;
      }
      return '';
    }).join('');
  }

  /* ---------------- the writing box: text, emojis, up to 3 attachments, a location ---------------- */
  const CSS = `
  .sgc{margin-top:8px;}
  .sgc *{box-sizing:border-box;}
  .sgc-row{display:flex;gap:6px;align-items:flex-end;}
  .sgc-ic{flex:none;width:40px;height:44px;border-radius:12px;border:1px solid #E4E4E4;background:#fff;display:flex;align-items:center;justify-content:center;font-size:19px;cursor:pointer;color:#0D0D0D;}
  .sgc-ic:hover{border-color:#F2A94E;}
  .sgc textarea{flex:1;min-width:0;min-height:44px;max-height:140px;border:1px solid #E4E4E4;border-radius:12px;padding:11px 12px;font-size:14px;line-height:1.4;font-family:inherit;resize:none;outline:none;background:#fff;}
  .sgc textarea:focus{border-color:#F2A94E;}
  .sgc-send{flex:none;height:44px;padding:0 16px;border-radius:12px;background:#F2A94E;color:#fff;font-weight:700;font-size:13px;border:0;cursor:pointer;}
  .sgc-send:disabled{opacity:.5;cursor:default;}
  .sgc-chips{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px;}
  .sgc-chip{display:inline-flex;align-items:center;gap:6px;max-width:100%;padding:5px 8px 5px 10px;border-radius:99px;background:#FBE3B8;font-size:12px;}
  .sgc-chip span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:200px;}
  .sgc-chip button{border:0;background:none;font-size:15px;line-height:1;cursor:pointer;padding:0 2px;}
  .sgc-emoji{display:flex;flex-wrap:wrap;gap:2px;padding:8px;margin-bottom:6px;border:1px solid #E4E4E4;border-radius:12px;background:#fff;max-height:130px;overflow-y:auto;}
  .sgc-emoji button{border:0;background:none;font-size:21px;width:34px;height:34px;cursor:pointer;border-radius:8px;}
  .sgc-emoji button:hover{background:#FBE3B8;}
  .sgc-note{font-size:12px;color:#b3261e;margin-top:6px;min-height:0;}
  .sgc-hidden{display:none !important;}
  .sgc-img img{display:block;max-width:220px;max-height:220px;border-radius:10px;margin-top:6px;}
  .sgc-file,.sgc-loc{display:block;margin-top:6px;padding:8px 10px;border-radius:10px;background:rgba(255,255,255,.9);color:#0D0D0D;font-size:12.5px;text-decoration:none;}
  .sgc-file b,.sgc-loc b{display:block;font-size:12.5px;}
  .sgc-file span,.sgc-loc span{display:block;opacity:.65;font-size:11.5px;margin-top:1px;}
  .sgc-loc a{color:#0D0D0D;text-decoration:underline;font-size:12px;margin-right:8px;}`;

  function ensureCss(){
    if(document.getElementById('sgc-style')) return;
    const s = document.createElement('style');
    s.id = 'sgc-style'; s.textContent = CSS;
    document.head.appendChild(s);
  }

  const ICON_ATTACH = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>';
  const ICON_PIN = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>';

  // el: where to draw it. opts: { me: {id,name}, placeholder, rows, initialText, onSend({text, attachments}) -> Promise }
  function mountComposer(el, opts){
    ensureCss();
    opts = opts || {};
    const files = [];            // File objects waiting to be sent
    let location = null;         // { lat, lng, label }
    el.innerHTML = `
      <div class="sgc">
        <div class="sgc-chips"></div>
        <div class="sgc-emoji sgc-hidden"></div>
        <div class="sgc-row">
          <button type="button" class="sgc-ic" data-act="attach" aria-label="Attach a picture or document">${ICON_ATTACH}</button>
          <button type="button" class="sgc-ic" data-act="loc" aria-label="Share my location">${ICON_PIN}</button>
          <button type="button" class="sgc-ic" data-act="emoji" aria-label="Emojis">😊</button>
          <textarea rows="${opts.rows || 1}" maxlength="${MAX_TEXT}" placeholder="${esc(opts.placeholder || 'Write a message')}"></textarea>
          <button type="button" class="sgc-send">Send</button>
        </div>
        <div class="sgc-note"></div>
        <input type="file" class="sgc-hidden" multiple accept="image/*,.pdf,.doc,.docx,.txt">
      </div>`;
    const $ = (sel) => el.querySelector(sel);
    const chips = $('.sgc-chips'), emojiBox = $('.sgc-emoji'), ta = $('textarea'), sendBtn = $('.sgc-send'), note = $('.sgc-note'), input = $('input[type=file]');

    if(opts.initialText) ta.value = opts.initialText;
    if(opts.suggestion){
      // a dimmed suggestion; Tab or the right arrow on an empty box fills it in
      ta.placeholder = opts.suggestion;
      ta.addEventListener('keydown', (e) => {
        if(ta.value !== '' || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
        if(e.key === 'ArrowRight' || e.key === 'Tab'){ e.preventDefault(); ta.value = opts.suggestion; ta.setSelectionRange(ta.value.length, ta.value.length); }
      });
    }

    EMOJIS.forEach((e) => {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = e;
      b.addEventListener('click', () => {
        const s = ta.selectionStart == null ? ta.value.length : ta.selectionStart, t = ta.selectionEnd == null ? s : ta.selectionEnd;
        ta.value = ta.value.slice(0, s) + e + ta.value.slice(t);
        ta.focus(); ta.selectionStart = ta.selectionEnd = s + e.length;
      });
      emojiBox.appendChild(b);
    });

    function count(){ return files.length + (location ? 1 : 0); }
    function say(t){ note.textContent = t || ''; }
    function drawChips(){
      chips.innerHTML = '';
      files.forEach((f, i) => {
        const c = document.createElement('div');
        c.className = 'sgc-chip';
        c.innerHTML = `<span>${esc(f.name)}</span><button type="button" aria-label="Remove">×</button>`;
        c.querySelector('button').addEventListener('click', () => { files.splice(i, 1); drawChips(); });
        chips.appendChild(c);
      });
      if(location){
        const c = document.createElement('div');
        c.className = 'sgc-chip';
        c.innerHTML = `<span>Location: ${esc(location.label || (location.lat.toFixed(4) + ', ' + location.lng.toFixed(4)))}</span><button type="button" aria-label="Remove">×</button>`;
        c.querySelector('button').addEventListener('click', () => { location = null; drawChips(); });
        chips.appendChild(c);
      }
    }

    $('[data-act=attach]').addEventListener('click', () => input.click());
    input.addEventListener('change', () => {
      say('');
      Array.from(input.files).forEach((f) => {
        if(count() >= MAX_ATTACH){ say('You can attach up to ' + MAX_ATTACH + ' things to one message.'); return; }
        const isPic = /^image\//i.test(f.type);
        if(!isPic && !DOC_TYPES.test(f.type)){ say('Only pictures, PDF, Word and text files can be sent.'); return; }
        if(!isPic && f.size > MAX_FILE_BYTES){ say(f.name + ' is over 2 MB. Documents can be up to 2 MB.'); return; }
        files.push(f);
      });
      input.value = '';
      drawChips();
    });
    $('[data-act=emoji]').addEventListener('click', () => emojiBox.classList.toggle('sgc-hidden'));
    $('[data-act=loc]').addEventListener('click', () => {
      say('');
      if(count() >= MAX_ATTACH && !location){ say('You can attach up to ' + MAX_ATTACH + ' things to one message.'); return; }
      if(!navigator.geolocation){ say('Your browser cannot share a location.'); return; }
      say('Getting your location...');
      navigator.geolocation.getCurrentPosition(async (pos) => {
        const lat = pos.coords.latitude, lng = pos.coords.longitude;
        let label = '';
        try { if(window.SanghaMap) label = await window.SanghaMap.reverse(lat, lng); } catch(e){ /* coordinates are enough */ }
        location = { lat, lng, label: (label || '').slice(0, 200) };
        say(''); drawChips();
      }, () => say('Could not get your location. Please allow location access and try again.'));
    });

    async function doSend(){
      const text = ta.value.trim();
      if(sendBtn.disabled || (!text && !count())) return;
      sendBtn.disabled = true; say(files.length ? 'Sending...' : '');
      try {
        const attachments = [];
        for(const f of files) attachments.push(await uploadAttachment(opts.me, f));
        if(location) attachments.push({ type: 'location', lat: location.lat, lng: location.lng, label: location.label });
        await opts.onSend({ text, attachments });
        ta.value = ''; files.length = 0; location = null; drawChips(); emojiBox.classList.add('sgc-hidden'); say('');
      } catch(e){
        console.warn('SanghaChat: could not send', e);
        say(e && e.message === 'too_big' ? 'One of the files is too big even after making it smaller.' : 'Could not send. Please try again.');
      }
      sendBtn.disabled = false;
      ta.focus();
    }
    sendBtn.addEventListener('click', doSend);
    ta.addEventListener('keydown', (e) => { if(e.key === 'Enter' && !e.shiftKey && !opts.noEnterSend){ e.preventDefault(); doSend(); } });
    return { focus: () => ta.focus(), say };
  }

  window.SanghaChat = {
    MAX_TEXT, MAX_ATTACH, chatIdFor, ensureChat, openHostChat, send, deleteMessage,
    watchMyChats, watchChat, watchMessages, mountComposer, attachmentsHtml
  };
})();

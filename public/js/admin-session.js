/* admin-session.js — signs the person in and checks that they are an admin.
   FAIL-CLOSED: every admin page starts hidden (see the <head> of each page) and is only shown once
   this script has confirmed the person is logged in AND has a record in the Firestore "admins"
   collection. Anything else — not logged in, not an admin, an error — keeps the page hidden.

   Login is the SAME phone + PIN login as the Sanga app (login.html, sanga-auth.js, the same Cloud
   Functions and the same Firebase accounts). Being an admin is separate: it is decided only by the
   "admins/<your account id>" record, which only a main admin can create (see firestore.rules). */
(function () {
  var html = document.documentElement;
  var SanghaAdmin = window.SanghaAdmin = { admin: null, ready: null };

  // Which profile page to open for someone: a MAIN admin gets the full profile (host_profile_view.html);
  // a normal admin gets the privacy-filtered one the app shows (user_profile_view.html).
  SanghaAdmin.profileUrl = function (o) {
    o = o || {};
    var main = !!(SanghaAdmin.admin && SanghaAdmin.admin.role === 'main');
    var q = [];
    if (o.id) q.push('id=' + encodeURIComponent(o.id));
    if (o.name) q.push('name=' + encodeURIComponent(o.name));
    return (main ? '/host_profile_view.html' : '/user_profile_view.html') + (q.length ? '?' + q.join('&') : '');
  };

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function gate(inner) {
    var g = document.getElementById('sgGate');
    if (!g) {
      g = document.createElement('div'); g.id = 'sgGate';
      g.style.cssText = 'visibility:visible;position:fixed;top:0;left:0;right:0;bottom:0;z-index:99999;background:#fff;display:flex;align-items:center;justify-content:center;padding:24px;font-family:Lato,Arial,sans-serif;color:#0D0D0D;text-align:center;line-height:1.6;';
      (document.body || html).appendChild(g);
    }
    g.innerHTML = '<div style="max-width:420px;">' + inner + '</div>';
  }
  function openPage() { var g = document.getElementById('sgGate'); if (g) g.parentNode.removeChild(g); html.classList.remove('sg-locked'); }
  function logOut() { try { SanghaAuth.logOut(); } catch (e) { } window.location.href = '/login.html'; }
  var BTN = 'margin-top:14px;padding:10px 20px;border-radius:10px;border:1px solid #E4E4E4;background:#fff;font-weight:700;cursor:pointer;';

  SanghaAdmin.ready = (async function () {
    gate('<div style="opacity:.6">Checking your access…</div>');
    try { await SanghaAuth.whenReady(); } catch (e) { /* treated as not logged in */ }
    var session = window.SanghaAuth ? SanghaAuth.getSession() : null;

    if (!session) {   // not logged in -> the shared login page, then straight back here
      window.location.replace('/login.html?next=' + encodeURIComponent(window.location.pathname + window.location.search) + '&reason=admin');
      return false;
    }

    var rec;
    try { rec = await sanghaDb.collection('admins').doc(session.id).get(); }
    catch (e) {
      gate('<h2 style="margin:0 0 6px">Could not check your access</h2><div style="opacity:.7">Check your connection and try again.</div><button id="sgRetry" style="' + BTN + '">Try again</button>');
      document.getElementById('sgRetry').onclick = function () { window.location.reload(); };
      return false;
    }

    if (!rec.exists) {   // a normal Sanga account that is not an admin (yet): ask for access automatically
      gate('<div style="opacity:.6">Sending your request…</div>');
      var status = '', why = '';
      try {
        var asked = await sanghaFunctions.httpsCallable('requestAdminAccess')();
        status = (asked && asked.data && asked.data.status) || '';
      } catch (e) {
        status = '';
        why = (e && (e.code || e.message)) || 'unknown error';
        if (window.console) console.warn('requestAdminAccess failed:', e);
      }

      if (status === 'admin') { window.location.reload(); return false; }   // approved while this page was open

      var signedAs = '<div style="opacity:.75">Signed in as <b>' + esc(session.phone || session.name || 'this account') + '</b>.</div>';
      var idBox = '<div style="background:#F2F2F2;border-radius:10px;padding:10px;margin-top:10px;font-family:Consolas,monospace;font-size:13px;word-break:break-all;user-select:all;">' + esc(session.id) + '</div>';
      var idSmall = '<div style="margin-top:14px;font-size:12px;opacity:.5;">Account ID (if support asks): <span style="font-family:Consolas,monospace;word-break:break-all;user-select:all;">' + esc(session.id) + '</span></div>';
      if (status === 'pending') {
        gate('<h2 style="margin:0 0 6px">Your request for admin access is under review</h2>' + signedAs +
          '<div style="margin-top:10px;">It might take up to 24 hours for approval. Once your request is approved, you will be able to log in.</div>' + idSmall +
          '<button id="sgAgain" style="' + BTN + '">Check again</button> <button id="sgOut" style="' + BTN + '">Log out</button>');
        document.getElementById('sgAgain').onclick = function () { window.location.reload(); };
      } else if (status === 'rejected') {
        gate('<h2 style="margin:0 0 6px">Your admin request was not approved</h2>' + signedAs +
          '<div style="margin-top:10px;">If you think this is a mistake, contact the main admin.</div>' + idSmall +
          '<button id="sgOut" style="' + BTN + '">Log out</button>');
      } else {   // we could not ask (for example the function is not deployed yet): the older screen
        gate('<h2 style="margin:0 0 6px">This account isn\'t an admin</h2>' + signedAs.replace('</div>', '<br>We could not send your request automatically. Send this account ID to the main admin:</div>') +
          idBox + '<div style="margin-top:8px;font-size:12px;opacity:.5;">Reason: ' + esc(why || 'no answer') + '</div>' + '<button id="sgOut" style="' + BTN + '">Log out</button>');
      }
      document.getElementById('sgOut').onclick = logOut;
      return false;
    }

    var d = rec.data() || {}, isMain = d.role === 'main';
    SanghaAdmin.admin = {
      role: isMain ? 'main' : 'admin',
      userId: session.id,
      name: d.name || session.name || session.phone || 'Admin',
      roleLabel: isMain ? 'Full access' : 'Admin',
      avatar: '',
      scope: isMain ? null : {
        countries: d.countries || [], states: d.states || [], cities: d.cities || [], zips: d.zips || [], categories: d.categories || []
      }
    };
    openPage();
    // Full-access (main) admins get a round icon at the top right to jump between the review queue
    // and Admin Settings. Normal admins never see it (they cannot open Admin Settings anyway).
    var bar = document.querySelector('.userbar');
    if (bar && isMain && !bar.querySelector('.sg-switch')) {
      var here = window.location.pathname, target = null;
      var GEAR = '<circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>';
      var QUEUE = '<polyline points="9 11 12 14 22 4"></polyline><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path>';
      if (/\/admin_review(\.html)?$/.test(here)) target = { href: '/admin_settings.html', title: 'Admin settings', icon: GEAR };
      else if (/\/admin_settings(\.html)?$/.test(here)) target = { href: '/admin_review.html', title: 'Review queue', icon: QUEUE };
      if (target) {
        if (!document.getElementById('sgSwitchCss')) {
          var st = document.createElement('style'); st.id = 'sgSwitchCss';
          st.textContent = '.sg-switch{position:relative;display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:50%;border:1px solid #E4E4E4;background:#FFFDF8;color:#0D0D0D;text-decoration:none;flex-shrink:0;}.sg-switch:hover{border-color:#F2A94E;}.sg-dot{position:absolute;top:-4px;right:-4px;min-width:16px;height:16px;border-radius:999px;background:#C0392B;color:#fff;font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center;padding:0 4px;box-sizing:border-box;}';
          document.head.appendChild(st);
        }
        var sw = document.createElement('a');
        sw.className = 'sg-switch'; sw.href = target.href; sw.title = target.title; sw.setAttribute('aria-label', target.title);
        sw.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + target.icon + '</svg>';
        bar.insertBefore(sw, bar.firstChild);
        if (target.href === '/admin_settings.html') {   // a red number when access requests are waiting
          sanghaDb.collection('adminRequests').get().then(function (snap) {
            var n = 0; snap.forEach(function (d) { if ((d.data() || {}).status === 'pending') n++; });
            if (!n) return;
            var dot = document.createElement('span'); dot.className = 'sg-dot'; dot.textContent = String(n);
            sw.appendChild(dot);
            sw.title = target.title + ' (' + n + ' request' + (n > 1 ? 's' : '') + ' waiting)';
          }).catch(function () { /* the icon still works without the number */ });
        }
      }
    }
    var who = document.querySelector('.userbar .who');   // a small "Log out" under the name
    if (who) {
      var a = document.createElement('a'); a.href = '#'; a.textContent = 'Log out';
      a.style.cssText = 'font-size:11.5px;color:inherit;opacity:.7;text-decoration:underline;';
      a.onclick = function (ev) { ev.preventDefault(); logOut(); };
      who.appendChild(a);
    }
    return true;
  })();
})();

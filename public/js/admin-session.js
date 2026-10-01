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

    if (!rec.exists) {   // a normal Sanga account, not an admin
      gate('<h2 style="margin:0 0 6px">This account isn\'t an admin</h2>' +
        '<div style="opacity:.75">Signed in as <b>' + esc(session.phone || session.name || 'this account') + '</b>.<br>If you should have access, send this account ID to the main admin:</div>' +
        '<div style="background:#F2F2F2;border-radius:10px;padding:10px;margin-top:10px;font-family:Consolas,monospace;font-size:13px;word-break:break-all;user-select:all;">' + esc(session.id) + '</div>' +
        '<button id="sgOut" style="' + BTN + '">Log out</button>');
      document.getElementById('sgOut').onclick = logOut;
      return false;
    }

    var d = rec.data() || {}, isMain = d.role === 'main';
    SanghaAdmin.admin = {
      role: isMain ? 'main' : 'admin',
      userId: session.id,
      name: d.name || session.name || session.phone || 'Admin',
      roleLabel: isMain ? 'Full access' : 'Admin · review only',
      avatar: '',
      scope: isMain ? null : {
        countries: d.countries || [], states: d.states || [], cities: d.cities || [], zips: d.zips || [], categories: d.categories || []
      }
    };
    openPage();
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

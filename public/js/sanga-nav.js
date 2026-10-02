/*
  /js/sanga-nav.js — ADMIN SITE version.

  Why this file exists: event_detail_view.html is IDENTICAL in the Sanga app and the admin site, so
  that one page is maintained once. It loads a script called /js/sanga-nav.js near the end of the page
  (the app uses it for the Home + Profile icons). On the admin site this file takes that place and
  does the site-specific work, so the page itself never needs an "admin" edit:

    1. Hides the page until the admin check passes (loads /js/admin-session.js: same phone + PIN login,
       then the Firestore "admins" record). Not logged in -> login page. Not an admin -> blocked.
    2. Shows one Home icon -> the review queue (the app's Profile icon makes no sense here).
    3. Sends host links to the right profile page: a MAIN admin gets the full profile
       (host_profile_view.html), a normal admin the privacy-filtered one (user_profile_view.html).
    4. On this site the page is always the read-only reviewer view (no Book, no messaging): if the
       address lacks review=1 / readonly=1 they are added.

  The same file name exists in the app repo with different content. Do not copy this file there.
*/
(function () {
  var HOME_URL = '/admin_review.html';
  var HOME_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>';
  var CSS =
    '.sg-nav{display:flex;align-items:center;gap:8px;margin-left:auto;flex-shrink:0;}' +
    '.sg-nav a{display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:50%;' +
      'border:1px solid var(--line,#E4E4E4);background:var(--card,#FFFDF8);color:var(--ink,#0D0D0D);text-decoration:none;}' +
    '.sg-nav a:hover{border-color:var(--rust,#F2A94E);}' +
    '.sg-nav a svg{stroke:currentColor;}' +
    '.sg-nav-row{display:flex;justify-content:flex-end;padding:20px 0 8px;}';

  // 1. hide everything until we know this person is an admin (fail-closed)
  var lock = document.createElement('style');
  lock.textContent = 'html.sg-locked body{visibility:hidden}';
  document.head.appendChild(lock);
  document.documentElement.classList.add('sg-locked');

  function mountHome() {
    if (document.querySelector('.sg-nav')) return;
    var style = document.createElement('style'); style.textContent = CSS; document.head.appendChild(style);
    var nav = document.createElement('div'); nav.className = 'sg-nav';
    nav.innerHTML = '<a href="' + HOME_URL + '" title="Review queue" aria-label="Review queue">' + HOME_ICON + '</a>';
    var slot = document.querySelector('[data-sg-nav]');
    if (slot) { slot.style.marginLeft = 'auto'; slot.style.flexShrink = '0'; slot.appendChild(nav); return; }
    var host = document.querySelector('.wrap') || document.body;
    var row = document.createElement('div'); row.className = 'sg-nav-row'; row.appendChild(nav);
    host.insertBefore(row, host.firstChild);
  }

  function afterAdmin() {
    mountHome();

    // 3. the host's name and avatar open the right profile page for this kind of admin
    var hostName = (document.getElementById('hostName') || {}).textContent || '';
    var links = document.querySelectorAll('.host-row a');
    for (var i = 0; i < links.length; i++) {
      if (/^\/profile\/user_profile_view\.html/.test(links[i].getAttribute('href') || '')) {
        links[i].setAttribute('href', SanghaAdmin.profileUrl({ name: hostName }));
      }
    }

    // 4. always the read-only reviewer view on this site
    var u = new URL(window.location.href), changed = false;
    if (u.searchParams.get('review') !== '1') { u.searchParams.set('review', '1'); changed = true; }
    if (u.searchParams.get('readonly') !== '1') { u.searchParams.set('readonly', '1'); changed = true; }
    if (changed) window.location.replace(u.toString());
  }

  function start() { SanghaAdmin.ready.then(function (ok) { if (ok) afterAdmin(); }); }
  if (window.SanghaAdmin) start();
  else {
    var s = document.createElement('script'); s.src = '/js/admin-session.js'; s.onload = start;
    document.body.appendChild(s);
  }
})();

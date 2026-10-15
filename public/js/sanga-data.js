/*
  /js/sanga-data.js — intentionally EMPTY on the admin site (no window.SanghaData object), but NOT a
  no-op file: pages shared with the app (event_detail_view.html) write their main script as
  <script type="text/sanga-deferred">, a type the browser never runs on its own. The app's real
  sanga-data.js turns those into live scripts once its event data has loaded; here there is no event
  data to wait for (the admin site passes everything through the URL instead — see admin_review.html's
  eventDetailUrl()), so this just runs them immediately. Without this, a shared page's entire script
  silently never executes on the admin site. The same file name exists in the app repo with real
  content: do not copy that one here, and do not copy this one there.
*/
(function () {
  function runDeferredScripts() {
    var list = Array.prototype.slice.call(document.querySelectorAll('script[type="text/sanga-deferred"]'));
    list.forEach(function (old) {
      var live = document.createElement('script');
      live.textContent = old.textContent;
      old.parentNode.replaceChild(live, old);
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', runDeferredScripts);
  else runDeferredScripts();
})();

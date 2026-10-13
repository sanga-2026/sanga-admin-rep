// Registers the service worker so Sanga Admin can be installed (home screen / desktop app).
(function () {
  if (!('serviceWorker' in navigator)) return;
  var local = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  if (location.protocol !== 'https:' && !local) return;      // service workers need https
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(function (e) { console.warn('Sanga Admin: service worker not registered', e); });
  });
})();

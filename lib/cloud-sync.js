// cloud-sync.js — mirrors the admin-owned localStorage keys to Cloud Firestore
// so the admin's changes (hero media, products, rates, records) reach the
// storefront on EVERY device, and customer orders / inquiries placed anywhere
// reach the admin console. Loaded by index.html and admin.html AFTER
// firebase-app-compat + firebase-firestore-compat + lib/firebase-config.js.
//
// Design: each synced key gets one Firestore doc at pps_sync/{key} holding the
// raw JSON string. Remote is the source of truth:
//   · on first connect, if the cloud has a value it REPLACES whatever this
//     browser had (so a fresh browser's seed data can never overwrite the
//     live catalogue); if the cloud is empty, the local value is uploaded.
//   · after that, local writes are pushed (debounced) and remote snapshots are
//     pulled into localStorage.
// Pages can list keys in window.PPS_SYNC_RELOAD_KEYS to force a reload when
// those keys are pulled (the storefront reads them once on load). Does NOTHING
// until lib/firebase-config.js is filled in — the site then keeps its
// per-browser localStorage behaviour.
(function () {
  var SYNC_KEYS = [
    'pps_hero_media',      // homepage hero photos & videos
    'pps_products',        // catalogue
    'pps_currency_rates',  // UGX/USD/EUR rates
    'pps_orders',          // customer orders → admin payment verification
    'pps_inquiries',
    'pps_clients',
    'pps_quotes',
    'pps_quotations', 'pps_seq_quotations', 'pps_seq_quote_files',
    'pps_deliveries', 'pps_lpos',
    'pps_notifications',
    'pps_users'            // admin staff accounts (so staff can log in from any computer)
  ];
  var cfg = window.PPS_FIREBASE_CONFIG;
  if (!window.firebase || !firebase.firestore || !cfg || !cfg.apiKey || cfg.apiKey === 'YOUR_API_KEY') return;

  try { if (!firebase.apps.length) firebase.initializeApp(cfg); } catch (e) { return; }
  var db;
  try { db = firebase.firestore(); } catch (e) { return; }

  window.PPS_CLOUD_SYNC = true;
  var origSet = Storage.prototype.setItem;
  var applying = false;   // guard: don't re-push a value we just pulled
  var ready = {};         // key -> first remote snapshot received
  var pending = {};       // key -> local value written before first snapshot
  var timers = {};

  // The admin console runs a one-time "wipe records" migration on browsers
  // that have never seen it. With cloud sync that would wipe the shared data
  // from every new computer, so mark it as already done.
  try { if (!localStorage.getItem('pps_data_reset')) origSet.call(localStorage, 'pps_data_reset', 'true'); } catch (e) {}

  function push(k, v) {
    clearTimeout(timers[k]);
    timers[k] = setTimeout(function () {
      db.collection('pps_sync').doc(k).set({ json: v, updatedAt: Date.now() }).catch(function () {});
    }, 400);
  }

  // ── Pull: remote → localStorage ──
  SYNC_KEYS.forEach(function (k) {
    db.collection('pps_sync').doc(k).onSnapshot(function (snap) {
      var first = !ready[k]; ready[k] = true;
      var d = snap.data();
      if (!d || typeof d.json !== 'string') {
        // Cloud empty: seed it from this browser (first connect only).
        if (first) { var local = localStorage.getItem(k); if (local != null) push(k, local); }
        return;
      }
      delete pending[k];
      if (localStorage.getItem(k) === d.json) return;
      applying = true;
      try { origSet.call(localStorage, k, d.json); } catch (e) {}
      applying = false;
      var reloadKeys = window.PPS_SYNC_RELOAD_KEYS || [];
      if (reloadKeys.indexOf(k) >= 0) { location.reload(); return; }
      try { window.dispatchEvent(new CustomEvent('pps-sync', { detail: { key: k } })); } catch (e) {}
    }, function () { /* permission / network errors: stay local-only */ });
  });

  // ── Push: localStorage → remote (debounced; held until first snapshot) ──
  Storage.prototype.setItem = function (k, v) {
    origSet.apply(this, arguments);
    if (this !== window.localStorage || applying || SYNC_KEYS.indexOf(k) < 0) return;
    if (!ready[k]) { pending[k] = v; return; }   // remote decides on first connect
    push(k, v);
  };
  // Cross-tab: another tab of the same browser wrote a key → push it too.
  window.addEventListener('storage', function (e) {
    if (e.storageArea !== localStorage || SYNC_KEYS.indexOf(e.key) < 0 || e.newValue == null || !ready[e.key]) return;
    push(e.key, e.newValue);
  });
})();

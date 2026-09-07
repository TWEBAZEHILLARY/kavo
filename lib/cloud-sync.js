// cloud-sync.js — mirrors the shared localStorage keys to the KAVO Grid
// Cloudflare D1 database (via worker.js, /api/sync) so the admin's changes
// (hero media, products, rates, records) reach the storefront on EVERY device,
// and customer orders / inquiries placed anywhere reach the admin console.
// Loaded by index.html and admin.html. Works with no configuration: if the
// API is unreachable (e.g. opened as a local file) the site simply stays
// per-browser.
//
// Remote is the source of truth:
//   · on load, every key the database has REPLACES the local copy (so a fresh
//     browser's seed data can never overwrite the live catalogue); keys the
//     database lacks are seeded from this browser.
//   · afterwards local writes are pushed (debounced) and the index is polled
//     every few seconds; changed keys are pulled into localStorage.
// Pages can list keys in window.PPS_SYNC_RELOAD_KEYS to force a reload when
// those keys change (the storefront reads them once on load).
(function () {
  var SYNC_KEYS = [
    'pps_hero_media', 'pps_products', 'pps_currency_rates',
    'pps_orders', 'pps_inquiries', 'pps_clients', 'pps_quotes',
    'pps_quotations', 'pps_seq_quotations', 'pps_seq_quote_files',
    'pps_deliveries', 'pps_lpos', 'pps_notifications', 'pps_users'
  ];
  if (location.protocol === 'file:') return;
  var API = '/api/sync';
  var POLL_MS = 4000;
  var origSet = Storage.prototype.setItem;
  var applying = false;
  var ready = false;
  var known = {};      // key -> updatedAt we have applied
  var pending = {};    // local writes made before first index arrived
  var timers = {};

  function headers() {
    var h = { 'content-type': 'application/json' };
    try { var t = localStorage.getItem('pps_sync_token'); if (t) h['x-admin-token'] = t; } catch (e) {}
    return h;
  }
  function push(k, v) {
    clearTimeout(timers[k]);
    timers[k] = setTimeout(function () {
      fetch(API + '/' + k, { method: 'PUT', headers: headers(), body: JSON.stringify({ json: v }) })
        .then(function (r) { if (r.ok) return r.json(); if (r.status === 401) notifyToken(); })
        .then(function (d) { if (d && d.updatedAt) known[k] = d.updatedAt; })
        .catch(function () {});
    }, 400);
  }
  var toldToken = false;
  function notifyToken() {
    if (toldToken) return; toldToken = true;
    try { window.dispatchEvent(new CustomEvent('pps-sync-unauthorized')); } catch (e) {}
  }
  function apply(k, v) {
    if (localStorage.getItem(k) === v) return false;
    applying = true;
    try { origSet.call(localStorage, k, v); } catch (e) {}
    applying = false;
    try { window.dispatchEvent(new CustomEvent('pps-sync', { detail: { key: k } })); } catch (e) {}
    return true;
  }
  function pull(k) {
    return fetch(API + '/' + k, { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { if (!d) return false; known[k] = d.updatedAt; return apply(k, d.json); })
      .catch(function () { return false; });
  }
  function maybeReload(changed) {
    var rk = window.PPS_SYNC_RELOAD_KEYS || [];
    if (changed.some(function (k) { return rk.indexOf(k) >= 0; })) location.reload();
  }

  function poll(first) {
    return fetch(API, { cache: 'no-store' }).then(function (r) { if (!r.ok) throw 0; return r.json(); }).then(function (index) {
      var remote = {};
      index.forEach(function (row) { remote[row.key] = row.updatedAt; });
      var jobs = [];
      SYNC_KEYS.forEach(function (k) {
        if (remote[k] != null) {
          if (remote[k] !== known[k]) jobs.push(pull(k).then(function (ch) { return ch ? k : null; }));
        } else if (first) {
          var local = localStorage.getItem(k); if (local != null) push(k, local);
        }
      });
      return Promise.all(jobs).then(function (res) {
        if (first) {
          ready = true; window.PPS_CLOUD_SYNC = true;
          // The admin console has a one-time "wipe records" migration for browsers
          // that never ran it; with a shared database that would wipe everyone's
          // data, so mark it as done.
          try { if (!localStorage.getItem('pps_data_reset')) origSet.call(localStorage, 'pps_data_reset', 'true'); } catch (e) {}
          Object.keys(pending).forEach(function (k) { if (remote[k] == null) push(k, pending[k]); });
          pending = {};
        }
        maybeReload(res.filter(Boolean));
      });
    }).catch(function () { /* offline or API missing: stay local */ });
  }

  Storage.prototype.setItem = function (k, v) {
    origSet.apply(this, arguments);
    if (this !== window.localStorage || applying || SYNC_KEYS.indexOf(k) < 0) return;
    if (!ready) { pending[k] = v; return; }
    push(k, v);
  };
  window.addEventListener('storage', function (e) {
    if (e.storageArea !== localStorage || SYNC_KEYS.indexOf(e.key) < 0 || e.newValue == null || !ready) return;
    push(e.key, e.newValue);
  });

  poll(true).then(function () {
    setInterval(function () { if (!document.hidden) poll(false); }, POLL_MS);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) poll(false); });
  });
})();

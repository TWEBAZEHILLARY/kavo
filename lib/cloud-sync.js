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
    'pps_hero_media', 'pps_products', 'pps_currency_rates', 'pps_coming_soon',
    'pps_orders', 'pps_inquiries', 'pps_clients', 'pps_quotes',
    'pps_quotations', 'pps_seq_quotations', 'pps_seq_quote_files',
    'pps_deliveries', 'pps_lpos', 'pps_notifications', 'pps_users',
    'pps_receipts', 'pps_deliveries_seq', 'pps_lpos_seq'
  ];
  if (location.protocol === 'file:') return;
  var IS_ADMIN = /^\/admin/.test(location.pathname);
  // The public website only syncs what it needs; business records stay on the admin side.
  if (!IS_ADMIN) SYNC_KEYS = ['pps_hero_media', 'pps_products', 'pps_currency_rates', 'pps_coming_soon', 'pps_orders', 'pps_inquiries', 'pps_clients'];
  var API = '/api/sync';
  var POLL_MS = IS_ADMIN ? 3000 : 4000;
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
        .then(function (r) {
          if (r.ok) return r.json();
          if (r.status === 401) notifyToken();
          try { window.dispatchEvent(new CustomEvent('pps-sync-error', { detail: { key: k, status: r.status } })); } catch (e) {}
        })
        .then(function (d) { if (d && d.updatedAt) { known[k] = d.updatedAt; if (d.merged) pull(k); } })
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
    return fetch(API + '/' + k, { cache: 'no-store', headers: headers() }).then(function (r) { if (r.status === 401) notifyToken(); return r.ok ? r.json() : null; })
      .then(function (d) { if (!d) return false; known[k] = d.updatedAt; return apply(k, d.json); })
      .catch(function () { return false; });
  }
  function maybeReload(changed) {
    var rk = window.PPS_SYNC_RELOAD_KEYS || [];
    if (changed.some(function (k) { return rk.indexOf(k) >= 0; })) location.reload();
  }

  function poll(first) {
    return fetch(API, { cache: 'no-store', headers: headers() }).then(function (r) { if (!r.ok) throw 0; return r.json(); }).then(function (index) {
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

  // ── Admin: instant alerts for new orders / inquiries / sign-ups ──
  var ALERT = { pps_orders: ['New order', 'clientName'], pps_inquiries: ['New inquiry', 'clientName'], pps_clients: ['New client sign-up', 'name'] };
  var seenIds = {};
  function idsOf(k) { try { var l = JSON.parse(localStorage.getItem(k) || '[]'); return Array.isArray(l) ? l : []; } catch (e) { return []; } }
  function snapshot() { Object.keys(ALERT).forEach(function (k) { seenIds[k] = {}; idsOf(k).forEach(function (x) { if (x) seenIds[k][x.id || x.email] = 1; }); }); }
  var baseTitle = document.title, flashT = null;
  function alertAdmin(title, msg, icon) {
    try { if (window.ToastStore) window.ToastStore.push(msg, { title: title, icon: icon || 'check', tone: 'ok' }); } catch (e) {}
    try { if (window.Notification && Notification.permission === 'granted' && document.hidden) new Notification(title, { body: msg, icon: '/images/brand/app-icon-192.png' }); } catch (e) {}
    try { var C = window.AudioContext || window.webkitAudioContext; if (C) { var c = new C(), o = c.createOscillator(), g = c.createGain(); o.frequency.value = 880; g.gain.setValueAtTime(0.08, c.currentTime); g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.35); o.connect(g); g.connect(c.destination); o.start(); o.stop(c.currentTime + 0.35); } } catch (e) {}
    if (document.hidden) { var on = false; clearInterval(flashT); flashT = setInterval(function () { document.title = (on = !on) ? '\u25CF ' + title : baseTitle; }, 1000); }
  }
  document.addEventListener('visibilitychange', function () { if (!document.hidden && flashT) { clearInterval(flashT); flashT = null; document.title = baseTitle; } });
  if (IS_ADMIN) {
    window.addEventListener('pps-sync', function (e) {
      var k = e.detail && e.detail.key, a = ALERT[k]; if (!a || !ready) return;
      var s = seenIds[k] || (seenIds[k] = {});
      idsOf(k).forEach(function (x) { if (!x) return; var id = x.id || x.email; if (s[id]) return; s[id] = 1; alertAdmin(a[0] + (x.id ? ' ' + x.id : ''), (x[a[1]] || x.email || 'From kavogrid.org') + '', 'check'); });
    });
    document.addEventListener('click', function askPerm() { document.removeEventListener('click', askPerm); try { if (window.Notification && Notification.permission === 'default') Notification.requestPermission(); } catch (e) {} });
  }

  // ── Live visitors: the storefront reports a visit, the admin is alerted ──
  if (!IS_ADMIN) {
    try {
      if (!sessionStorage.getItem('pps_visit_sent')) {
        sessionStorage.setItem('pps_visit_sent', '1');
        fetch('/api/visit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: location.pathname, ref: document.referrer }), keepalive: true }).catch(function () {});
      }
    } catch (e) {}
  } else {
    var visitSince = Date.now();
    var pollVisits = function () {
      fetch('/api/visits?since=' + visitSince, { cache: 'no-store', headers: headers() }).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
        if (!d) return; visitSince = d.now || Date.now();
        window.PPS_VISITS_TODAY = d.today;
        (d.last || []).slice(0, 3).forEach(function (v) {
          var where = [v.city, v.country].filter(Boolean).join(', ');
          alertAdmin('New visitor on kavogrid.org', (v.device || 'Visitor') + (where ? ' \u00B7 ' + where : '') + ' \u00B7 ' + (d.today || 0) + ' today', 'check');
        });
        try { window.dispatchEvent(new CustomEvent('pps-visits', { detail: d })); } catch (e) {}
      }).catch(function () {});
    };
    setInterval(pollVisits, 5000);
  }

  Storage.prototype.setItem = function (k, v) {
    origSet.apply(this, arguments);
    if (this !== window.localStorage || applying || SYNC_KEYS.indexOf(k) < 0) return;
    if (IS_ADMIN && ALERT[k]) { var s = seenIds[k] || (seenIds[k] = {}); idsOf(k).forEach(function (x) { if (x) s[x.id || x.email] = 1; }); }
    if (!ready) { pending[k] = v; return; }
    push(k, v);
  };
  window.addEventListener('storage', function (e) {
    if (e.storageArea !== localStorage || SYNC_KEYS.indexOf(e.key) < 0 || e.newValue == null || !ready) return;
    push(e.key, e.newValue);
  });

  poll(true).then(function () {
    snapshot();
    // The admin keeps listening even when its tab is in the background.
    setInterval(function () { if (IS_ADMIN || !document.hidden) poll(false); }, POLL_MS);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) poll(false); });
  });
})();

// cloud-sync.js — mirrors the shared localStorage keys to the KAVO Grid
// Cloudflare D1 database (via worker.js) so the admin's changes reach the
// storefront on every device, and customer orders / sign-ups / inquiries made
// on ANY device reach the admin console automatically.
//
// Two channels:
//   · Catalogue-type keys (products, hero, rates, records…) — whole value,
//     database is the source of truth (as before).
//   · Customer lists (pps_orders, pps_clients, pps_inquiries) — RECORD LEVEL.
//     Every write is diffed against the previous value; only the added /
//     changed records (and admin deletions) are queued in a durable outbox and
//     sent to /api/rec/:key, which merges them into the live list atomically.
//     A device can never overwrite or wipe records it hasn't seen.
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
  if (!IS_ADMIN) SYNC_KEYS = ['pps_hero_media', 'pps_products', 'pps_currency_rates', 'pps_coming_soon', 'pps_orders', 'pps_inquiries', 'pps_clients'];
  var CUSTOMER = ['pps_orders', 'pps_inquiries', 'pps_clients'];
  var isCust = function (k) { return CUSTOMER.indexOf(k) >= 0 && SYNC_KEYS.indexOf(k) >= 0; };
  // The admin console has a one-time "empty the records" migration. With a
  // shared database it must never run, so mark it done before admin scripts load.
  try { if (!localStorage.getItem('pps_data_reset')) localStorage.setItem('pps_data_reset', 'true'); } catch (e) {}

  var API = '/api/sync';
  var POLL_MS = IS_ADMIN ? 3000 : 4000;
  var origSet = Storage.prototype.setItem;
  var applying = false, ready = false;
  var known = {}, pending = {}, timers = {}, tries = {}, inflight = {}, again = {};

  function headers() {
    var h = { 'content-type': 'application/json' };
    try { var t = localStorage.getItem('pps_sync_token'); if (t) h['x-admin-token'] = t; } catch (e) {}
    return h;
  }
  var toldToken = false;
  function notifyToken() {
    if (toldToken) return; toldToken = true;
    try { window.dispatchEvent(new CustomEvent('pps-sync-unauthorized')); } catch (e) {}
  }
  function syncError(k, status) { try { window.dispatchEvent(new CustomEvent('pps-sync-error', { detail: { key: k, status: status } })); } catch (e) {} }

  // ── Record-level outbox (customer lists) ─────────────────────────────────
  var OPS_KEY = 'pps_sync_ops';
  var OPS = (function () { try { return JSON.parse(localStorage.getItem(OPS_KEY) || '{}') || {}; } catch (e) { return {}; } })();
  function hasOps(k) { var o = OPS[k]; return !!(o && (Object.keys(o.u || {}).length || Object.keys(o.d || {}).length)); }
  function saveOps() {
    try { if (CUSTOMER.some(hasOps)) origSet.call(localStorage, OPS_KEY, JSON.stringify(OPS)); else localStorage.removeItem(OPS_KEY); } catch (e) { /* storage full: kept in memory */ }
  }
  function recId(x) { return x && (x.id != null && x.id !== '' ? String(x.id) : (x.email ? 'e:' + String(x.email).toLowerCase() : null)); }
  function parseList(s) { try { var l = JSON.parse(s); return Array.isArray(l) ? l : null; } catch (e) { return null; } }
  function enqueue(k, prevStr, nextStr) {
    var b = parseList(nextStr); if (!b) return;
    var a = prevStr != null ? parseList(prevStr) : null, am = {}, bm = {};
    (a || []).forEach(function (x) { var i = recId(x); if (i) am[i] = JSON.stringify(x); });
    var o = OPS[k] || (OPS[k] = { u: {}, d: {} }); o.u = o.u || {}; o.d = o.d || {};
    b.forEach(function (x) { var i = recId(x); if (!i) return; bm[i] = 1; if (am[i] !== JSON.stringify(x)) { o.u[i] = x; delete o.d[i]; } });
    if (IS_ADMIN && a) Object.keys(am).forEach(function (i) { if (!bm[i]) { o.d[i] = 1; delete o.u[i]; } });
    saveOps();
    clearTimeout(timers[k]); timers[k] = setTimeout(function () { flush(k); }, 300);
  }
  function retry(k) {
    var n = tries[k] = (tries[k] || 0) + 1;
    clearTimeout(timers[k]); timers[k] = setTimeout(function () { flush(k); }, Math.min(60000, 2000 * Math.pow(2, n - 1)));
  }
  function flush(k) {
    if (!hasOps(k)) return;
    if (inflight[k]) { again[k] = 1; return; }
    var o = OPS[k], sentU = {}, ids = Object.keys(o.u), dels = Object.keys(o.d);
    ids.forEach(function (i) { sentU[i] = o.u[i]; });
    inflight[k] = 1;
    fetch('/api/rec/' + k, { method: 'POST', headers: headers(), body: JSON.stringify({ upserts: ids.map(function (i) { return o.u[i]; }), deletes: dels }) })
      .then(function (r) {
        if (r.ok) return r.json();
        if (r.status === 401) notifyToken();
        if (r.status >= 500 || r.status === 429 || r.status === 404) throw r.status;
        return { failed: r.status };
      })
      .then(function (res) {
        inflight[k] = 0; tries[k] = 0;
        ids.forEach(function (i) { if (o.u[i] === sentU[i]) delete o.u[i]; });
        dels.forEach(function (i) { delete o.d[i]; });
        saveOps();
        if (res && res.failed) syncError(k, res.failed);
        if (again[k] || hasOps(k)) { again[k] = 0; flush(k); } else pull(k);
      })
      .catch(function () { inflight[k] = 0; retry(k); });
  }
  // Migrate the previous whole-list outbox (v18) into record ops.
  try {
    var oldBox = JSON.parse(localStorage.getItem('pps_sync_outbox') || 'null');
    if (oldBox) { Object.keys(oldBox).forEach(function (k) { if (isCust(k)) enqueue(k, null, oldBox[k]); }); localStorage.removeItem('pps_sync_outbox'); }
  } catch (e) {}

  // ── Whole-value channel (everything else) ────────────────────────────────
  function push(k, v) {
    clearTimeout(timers[k]);
    timers[k] = setTimeout(function () {
      fetch(API + '/' + k, { method: 'PUT', headers: headers(), body: JSON.stringify({ json: v }) })
        .then(function (r) {
          if (r.ok) return r.json();
          if (r.status === 401) notifyToken();
          if (r.status >= 500 || r.status === 429) { setTimeout(function () { push(k, localStorage.getItem(k)); }, 5000); return null; }
          syncError(k, r.status);
        })
        .then(function (d) { if (d && d.updatedAt) known[k] = d.updatedAt; })
        .catch(function () { setTimeout(function () { var cur = localStorage.getItem(k); if (cur != null) push(k, cur); }, 5000); });
    }, 400);
  }
  function apply(k, v) {
    if (isCust(k) && hasOps(k)) return false; // never hide records not delivered yet
    if (localStorage.getItem(k) === v) return false;
    applying = true;
    try { origSet.call(localStorage, k, v); } catch (e) {}
    applying = false;
    try { window.dispatchEvent(new CustomEvent('pps-sync', { detail: { key: k } })); } catch (e) {}
    return true;
  }
  function pull(k) {
    return fetch(API + '/' + k, { cache: 'no-store', headers: headers() }).then(function (r) { if (r.status === 401) notifyToken(); return r.ok ? r.json() : null; })
      .then(function (d) { if (!d) return false; var ch = apply(k, d.json); if (!(isCust(k) && hasOps(k))) known[k] = d.updatedAt; return ch; })
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
          var local = localStorage.getItem(k);
          if (local != null) { if (isCust(k)) enqueue(k, null, local); else push(k, local); }
        }
      });
      return Promise.all(jobs).then(function (res) {
        if (first) {
          ready = true; window.PPS_CLOUD_SYNC = true;
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
    setTimeout(function () {
      fetch('/api/health', { cache: 'no-store', headers: headers() }).then(function (r) { return r.json(); }).then(function (h) {
        if (!h || !h.locked || h.admin) return;
        notifyToken();
        try { if (window.ToastStore) window.ToastStore.push('This device has no valid admin password, so your changes to orders and clients will not save. Go to Settings → Cloud sync and enter it.', { title: 'Admin password needed', icon: 'minus', tone: 'error' }); } catch (e) {}
      }).catch(function () {});
    }, 2500);
    document.addEventListener('click', function askPerm() { document.removeEventListener('click', askPerm); try { if (window.Notification && Notification.permission === 'default') Notification.requestPermission(); } catch (e) {} });
  }

  // ── Live visitors ──
  if (!IS_ADMIN) {
    try {
      if (!sessionStorage.getItem('pps_visit_sent')) {
        sessionStorage.setItem('pps_visit_sent', '1');
        fetch('/api/visit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: location.pathname, ref: document.referrer }), keepalive: true }).catch(function () {});
      }
    } catch (e) {}
  } else {
    var visitSince = Date.now();
    setInterval(function () {
      fetch('/api/visits?since=' + visitSince, { cache: 'no-store', headers: headers() }).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
        if (!d) return; visitSince = d.now || Date.now();
        window.PPS_VISITS_TODAY = d.today;
        (d.last || []).slice(0, 3).forEach(function (v) {
          var where = [v.city, v.country].filter(Boolean).join(', ');
          alertAdmin('New visitor on kavogrid.org', (v.device || 'Visitor') + (where ? ' \u00B7 ' + where : '') + ' \u00B7 ' + (d.today || 0) + ' today', 'check');
        });
        try { window.dispatchEvent(new CustomEvent('pps-visits', { detail: d })); } catch (e) {}
      }).catch(function () {});
    }, 5000);
  }

  // ── Hook every localStorage write ──
  Storage.prototype.setItem = function (k, v) {
    var watch = this === window.localStorage && !applying && SYNC_KEYS.indexOf(k) >= 0;
    var prev = watch && isCust(k) ? localStorage.getItem(k) : null;
    origSet.apply(this, arguments);
    if (!watch) return;
    if (isCust(k)) {
      if (IS_ADMIN && ALERT[k]) { var s = seenIds[k] || (seenIds[k] = {}); idsOf(k).forEach(function (x) { if (x) s[x.id || x.email] = 1; }); }
      enqueue(k, prev, v);
      return;
    }
    if (!ready) { pending[k] = v; return; }
    push(k, v);
  };
  window.addEventListener('storage', function (e) {
    if (e.storageArea !== localStorage || SYNC_KEYS.indexOf(e.key) < 0 || isCust(e.key) || e.newValue == null || !ready) return;
    push(e.key, e.newValue);
  });
  window.addEventListener('online', function () { CUSTOMER.forEach(function (k) { tries[k] = 0; flush(k); }); });

  CUSTOMER.forEach(function (k) { if (hasOps(k)) flush(k); });
  poll(true).then(function () {
    snapshot();
    setInterval(function () { if (IS_ADMIN || !document.hidden) poll(false); }, POLL_MS);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) poll(false); });
  });
})();

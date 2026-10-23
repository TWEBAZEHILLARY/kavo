// worker.js — KAVO Grid server: static assets + a tiny sync API backed by
// Cloudflare D1. Every synced localStorage key is one row in `sync`
// (key, json, updated_at). Both the storefront and the admin console talk to
// this via lib/cloud-sync.js.
//
//   GET  /api/sync            -> [{key, updatedAt}]           (index, for polling)
//   GET  /api/sync/:key       -> {key, json, updatedAt} | 404
//   PUT  /api/sync/:key       -> body {json}                   (upsert)
//   POST /api/visit           -> records a storefront visit (public)
//   GET  /api/visits?since=ms -> {count, last:[...]}            (admin)
//   GET  /api/health          -> {ok:true}
//
// SECURITY: set a secret named ADMIN_TOKEN in the Worker's Variables &
// Secrets (Settings → Variables & Secrets → Add → Secret). Once it is set:
//   · business records (staff accounts, quotations, deliveries, LPOs,
//     receipts, notifications, quotes) can only be READ or written with
//     header X-Admin-Token — the public website never sees them;
//   · catalogue / hero / rates / coming-soon can only be written by the admin;
//   · visitors can add or update their own orders, inquiries and sign-ups but
//     can never delete or wipe other records (server-side merge).
// The admin console asks for the token once (Settings → Cloud sync).

const PUBLIC_KEYS = new Set(['pps_hero_media', 'pps_products', 'pps_currency_rates', 'pps_coming_soon']);
const CUSTOMER_KEYS = new Set(['pps_orders', 'pps_inquiries', 'pps_clients']);
const PRIVATE_KEYS = new Set([
  'pps_quotes', 'pps_quotations', 'pps_seq_quotations', 'pps_seq_quote_files',
  'pps_deliveries', 'pps_lpos', 'pps_notifications', 'pps_users',
  'pps_receipts', 'pps_deliveries_seq', 'pps_lpos_seq'
]);
const ALL_KEYS = new Set([...PUBLIC_KEYS, ...CUSTOMER_KEYS, ...PRIVATE_KEYS]);
const MAX_BYTES = 4 * 1024 * 1024;
const IMG_MAX = 1500000;

const SEC_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-frame-options': 'SAMEORIGIN',
};
const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...SEC_HEADERS };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

function safeEqual(a, b) {
  a = String(a || ''); b = String(b || '');
  if (!a || !b || a.length !== b.length) return false;
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
// Admin = token matches. With no ADMIN_TOKEN configured everyone is treated as
// admin (open mode, as before) so nothing breaks until the secret is added.
const isAdmin = (req, env) => !env.ADMIN_TOKEN || safeEqual(req.headers.get('x-admin-token'), env.ADMIN_TOKEN);

// Writes must come from this site (blocks other websites posting into the DB).
function sameOrigin(req, url) {
  const o = req.headers.get('origin');
  if (!o) return true;
  try { return new URL(o).host === url.host; } catch (e) { return false; }
}

// ── Customer-list merging (orders, clients, inquiries) ────────────────────
// Every browser numbers new records from its own copy, so two customers on
// different devices can both create "#KG-0007". The server detects that (same
// id, different customer) and gives the newcomer the next free number instead
// of overwriting. Visitors can only ADD records (and reply on inquiries); they
// can never change or remove existing ones. A stale admin write keeps any
// records that arrived after the admin's last refresh.
const ID_RULES = {
  pps_orders: { re: /^#(?:PPS|KG)-(\d+)$/, make: (n) => '#KG-' + String(n).padStart(4, '0'), who: (x) => [String(x.customerEmail || x.clientId || x.clientName || '').toLowerCase(), x.date || ''].join('|') },
  pps_clients: { re: /^client_(\d+)$/, make: (n) => 'client_' + String(n).padStart(3, '0'), who: (x) => String(x.email || '').trim().toLowerCase() },
  pps_inquiries: { re: /^#INQ-(\d+)$/, make: (n) => '#INQ-' + n, who: (x) => [String(x.email || '').toLowerCase(), x.subject || '', x.date || ''].join('|') },
};
const idOf = (x) => x && (x.id != null && x.id !== '' ? String(x.id) : (x.email ? 'e:' + String(x.email).toLowerCase() : null));
function mergeThreads(a, b) {
  const t = new Map();
  (a || []).forEach((m) => t.set(m && m.id != null ? String(m.id) : JSON.stringify(m), m));
  (b || []).forEach((m) => {
    const k = m && m.id != null ? String(m.id) : JSON.stringify(m), p = t.get(k);
    if (!p) { t.set(k, m); return; }
    const o = { ...p, ...m }; Object.keys(o).forEach((f) => { if (/^readBy/.test(f)) o[f] = !!(p[f] || m[f]); }); t.set(k, o);
  });
  return [...t.values()];
}
function mergeList(key, oldJson, newJson, mode) {
  let a, b;
  try { a = JSON.parse(oldJson); b = JSON.parse(newJson); } catch (e) { return null; }
  if (!Array.isArray(a) || !Array.isArray(b)) return null;
  const rule = ID_RULES[key];
  if (mode === 'admin') {
    const mine = new Set(b.map(idOf).filter(Boolean));
    const extra = a.filter((x) => { const k = idOf(x); return k && !mine.has(k); });
    return JSON.stringify(extra.concat(b));
  }
  const out = a.slice(), pos = new Map();
  out.forEach((x, i) => { const k = idOf(x); if (k) pos.set(k, i); });
  let max = 0;
  if (rule) out.concat(b).forEach((x) => { const m = x && rule.re.exec(String(x.id || '')); if (m) max = Math.max(max, parseInt(m[1], 10)); });
  const fresh = [];
  b.forEach((x) => {
    if (!x || typeof x !== 'object') return;
    const k = idOf(x); if (!k) return;
    const i = pos.get(k);
    if (i == null) { fresh.push(x); pos.set(k, -1); return; }
    if (i < 0) return;
    const prev = out[i];
    if (rule && rule.who(prev) !== rule.who(x)) {
      if (key === 'pps_clients' && out.some((c) => rule.who(c) === rule.who(x))) return;
      const nx = { ...x, id: rule.make(++max) }; fresh.push(nx); pos.set(nx.id, -1); return;
    }
    if (key === 'pps_inquiries' && Array.isArray(x.thread)) out[i] = { ...prev, thread: mergeThreads(prev.thread, x.thread) };
  });
  return JSON.stringify(fresh.concat(out));
}

let tableReady = false;
async function ensureTable(db) {
  if (tableReady) return;
  await db.prepare('CREATE TABLE IF NOT EXISTS sync (key TEXT PRIMARY KEY, json TEXT NOT NULL, updated_at INTEGER NOT NULL)').run();
  await db.prepare('CREATE TABLE IF NOT EXISTS imgs (id TEXT PRIMARY KEY, mime TEXT NOT NULL, data TEXT NOT NULL, updated_at INTEGER NOT NULL)').run();
  await db.prepare('CREATE TABLE IF NOT EXISTS visits (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, path TEXT, ref TEXT, country TEXT, city TEXT, device TEXT, ip TEXT)').run();
  tableReady = true;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);

    if (url.pathname === '/api/health') return json({ ok: true, db: !!env.DB, locked: !!env.ADMIN_TOKEN, admin: isAdmin(request, env) });
    if (!env.DB) return json({ error: 'D1 database not bound. Add [[d1_databases]] to wrangler.toml.' }, 503);
    if (request.method !== 'GET' && request.method !== 'HEAD' && !sameOrigin(request, url)) return json({ error: 'Forbidden' }, 403);
    const admin = isAdmin(request, env);

    try {
      await ensureTable(env.DB);

      // ── Live visitor feed ───────────────────────────────────────────────
      if (url.pathname === '/api/visit' && request.method === 'POST') {
        let b = {}; try { b = await request.json(); } catch (e) {}
        const cf = request.cf || {};
        const ip = request.headers.get('cf-connecting-ip') || '';
        const now = Date.now();
        // One visit per IP per 30 s (stops refresh spam filling the table).
        const dup = await env.DB.prepare('SELECT id FROM visits WHERE ip = ? AND at > ?').bind(ip, now - 30000).first();
        if (!dup) {
          const ua = request.headers.get('user-agent') || '';
          const device = /mobile|android|iphone/i.test(ua) ? 'Mobile' : /ipad|tablet/i.test(ua) ? 'Tablet' : 'Desktop';
          await env.DB.prepare('INSERT INTO visits (at, path, ref, country, city, device, ip) VALUES (?, ?, ?, ?, ?, ?, ?)')
            .bind(now, String(b.path || '/').slice(0, 200), String(b.ref || '').slice(0, 300), cf.country || '', cf.city || '', device, ip).run();
          await env.DB.prepare('DELETE FROM visits WHERE at < ?').bind(now - 30 * 864e5).run();
        }
        return json({ ok: true });
      }
      if (url.pathname === '/api/visits' && request.method === 'GET') {
        if (!admin) return json({ error: 'Admin token required' }, 401);
        const since = parseInt(url.searchParams.get('since') || '0', 10) || 0;
        const { results } = await env.DB.prepare('SELECT id, at, path, ref, country, city, device FROM visits WHERE at > ? ORDER BY at DESC LIMIT 50').bind(since).all();
        const today = await env.DB.prepare('SELECT COUNT(*) AS n FROM visits WHERE at > ?').bind(Date.now() - 864e5).first();
        return json({ now: Date.now(), last: results, today: today ? today.n : 0 });
      }

      // ── Images ──────────────────────────────────────────────────────────
      const im = url.pathname.match(/^\/api\/img\/([a-z0-9_]+)$/);
      if (im) {
        if (request.method === 'GET') {
          const row = await env.DB.prepare('SELECT mime, data FROM imgs WHERE id = ?').bind(im[1]).first();
          if (!row) return new Response('Not found', { status: 404 });
          const bin = atob(row.data), bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          return new Response(bytes, { headers: { 'content-type': row.mime, 'cache-control': 'public, max-age=31536000, immutable', ...SEC_HEADERS } });
        }
        if (request.method === 'PUT' || request.method === 'POST') {
          if (!admin) return json({ error: 'Admin token required' }, 401);
          let body; try { body = await request.json(); } catch (e) { return json({ error: 'Bad JSON' }, 400); }
          const mm = typeof body.data === 'string' && body.data.match(/^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/);
          if (!mm) return json({ error: 'data must be a base64 image data URL' }, 400);
          if (mm[2].length > IMG_MAX) return json({ error: 'Image too large' }, 413);
          await env.DB.prepare('INSERT INTO imgs (id, mime, data, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET mime = excluded.mime, data = excluded.data, updated_at = excluded.updated_at')
            .bind(im[1], mm[1], mm[2], Date.now()).run();
          return json({ url: '/api/img/' + im[1] });
        }
        return json({ error: 'Method not allowed' }, 405);
      }

      // ── Sync ────────────────────────────────────────────────────────────
      const m = url.pathname.match(/^\/api\/sync(?:\/([a-z0-9_]+))?$/);
      if (!m) return json({ error: 'Not found' }, 404);
      const key = m[1];

      if (request.method === 'GET' && !key) {
        const { results } = await env.DB.prepare('SELECT key, updated_at FROM sync').all();
        return json(results.filter(r => admin || !PRIVATE_KEYS.has(r.key)).map(r => ({ key: r.key, updatedAt: r.updated_at })));
      }
      if (!key || !ALL_KEYS.has(key)) return json({ error: 'Unknown key' }, 404);
      if (PRIVATE_KEYS.has(key) && !admin) return json({ error: 'Admin token required' }, 401);

      if (request.method === 'GET') {
        const row = await env.DB.prepare('SELECT key, json, updated_at FROM sync WHERE key = ?').bind(key).first();
        if (!row) return json({ error: 'Empty' }, 404);
        return json({ key: row.key, json: row.json, updatedAt: row.updated_at });
      }

      if (request.method === 'PUT' || request.method === 'POST') {
        if (PUBLIC_KEYS.has(key) && !admin) return json({ error: 'Admin token required' }, 401);
        let body;
        try { body = await request.json(); } catch (e) { return json({ error: 'Bad JSON' }, 400); }
        if (typeof body.json !== 'string') return json({ error: 'json must be a string' }, 400);
        if (body.json.length > MAX_BYTES) return json({ error: 'Too large' }, 413);
        let value = body.json, merged = false;
        if (CUSTOMER_KEYS.has(key)) {
          const row = await env.DB.prepare('SELECT json, updated_at FROM sync WHERE key = ?').bind(key).first();
          const stale = admin && row && body.base != null && Number(body.base) !== row.updated_at;
          if (row && (!admin || stale)) {
            const mj = mergeList(key, row.json, body.json, admin ? 'admin' : 'customer');
            if (mj == null) return json({ error: 'Bad list' }, 400);
            merged = mj !== body.json; value = mj;
          }
        }
        if (value.length > 1900000) return json({ error: 'Too large for database' }, 413);
        const now = Date.now();
        await env.DB.prepare('INSERT INTO sync (key, json, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at')
          .bind(key, value, now).run();
        return json({ key, updatedAt: now, merged });
      }
      return json({ error: 'Method not allowed' }, 405);
    } catch (e) {
      return json({ error: 'Server error' }, 500);
    }
  }
};

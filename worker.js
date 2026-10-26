// worker.js — KAVO Grid server: static assets + a tiny sync API backed by
// Cloudflare D1. Every synced localStorage key is one row in `sync`
// (key, json, updated_at). Both the storefront and the admin console talk to
// this via lib/cloud-sync.js.
//
//   GET  /api/sync            -> [{key, updatedAt}]           (index, for polling)
//   GET  /api/sync/:key       -> {key, json, updatedAt} | 404
//   PUT  /api/sync/:key       -> body {json}                   (upsert)
//   POST /api/rec/:key        -> body {upserts:[], deletes:[]} (orders/clients/inquiries, per record)
//   POST /api/auth/signup|login|social -> client accounts (hashed passwords)
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

function applyOps(key, list, ups, dels, admin) {
  const rule = ID_RULES[key], out = list.slice(), pos = new Map(), renamed = {};
  out.forEach((x, i) => { const k = idOf(x); if (k) pos.set(k, i); });
  let max = 0;
  if (rule) out.concat(ups).forEach((x) => { const m = x && rule.re.exec(String(x.id || '')); if (m) max = Math.max(max, parseInt(m[1], 10)); });
  const dupClient = (x) => key === 'pps_clients' && rule.who(x) && out.concat(fresh).some((c) => c !== x && rule.who(c) === rule.who(x));
  const fresh = [];
  ups.forEach((x) => {
    if (!x || typeof x !== 'object') return;
    const k = idOf(x); if (!k) return;
    const i = pos.get(k);
    if (i == null) { if (!admin && dupClient(x)) return; fresh.push(x); pos.set(k, -1); return; }
    if (i < 0) return;
    const prev = out[i];
    if (admin) { out[i] = key === 'pps_inquiries' ? { ...x, thread: mergeThreads(prev.thread, x.thread) } : x; return; }
    if (rule && rule.who(prev) !== rule.who(x)) {
      if (dupClient(x)) return;
      const nid = rule.make(++max); renamed[x.id] = nid; fresh.push({ ...x, id: nid }); pos.set(nid, -1); return;
    }
    if (key === 'pps_inquiries' && Array.isArray(x.thread)) out[i] = { ...prev, thread: mergeThreads(prev.thread, x.thread) };
  });
  let result = fresh.concat(out);
  if (dels.length) { const d = new Set(dels); result = result.filter((x) => !d.has(idOf(x))); }
  return { list: result, renamed };
}

let tableReady = false;
async function ensureTable(db) {
  if (tableReady) return;
  await db.prepare('CREATE TABLE IF NOT EXISTS sync (key TEXT PRIMARY KEY, json TEXT NOT NULL, updated_at INTEGER NOT NULL)').run();
  await db.prepare('CREATE TABLE IF NOT EXISTS imgs (id TEXT PRIMARY KEY, mime TEXT NOT NULL, data TEXT NOT NULL, updated_at INTEGER NOT NULL)').run();
  await db.prepare('CREATE TABLE IF NOT EXISTS visits (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, path TEXT, ref TEXT, country TEXT, city TEXT, device TEXT, ip TEXT)').run();
  await db.prepare('CREATE TABLE IF NOT EXISTS accounts (email TEXT PRIMARY KEY, client_id TEXT, hash TEXT, salt TEXT, provider TEXT, created_at INTEGER NOT NULL, last_login INTEGER, fails INTEGER NOT NULL DEFAULT 0, locked_until INTEGER NOT NULL DEFAULT 0)').run();
  tableReady = true;
}

// ── Client accounts ───────────────────────────────────────────────────────
// Passwords are never stored in pps_clients (which the website downloads).
// They live only in the accounts table as salted PBKDF2-SHA256 hashes.
// Older plaintext passwords are migrated automatically the first time the
// server sees them. 5 wrong passwords lock the account for 15 minutes.
const enc = new TextEncoder();
const toB64 = (buf) => { const u = new Uint8Array(buf); let s = ''; for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s); };
const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function hashPw(pw, saltB64) {
  const salt = saltB64 ? fromB64(saltB64) : crypto.getRandomValues(new Uint8Array(16));
  const k = await crypto.subtle.importKey('raw', enc.encode(String(pw)), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100000 }, k, 256);
  return { hash: toB64(bits), salt: toB64(salt) };
}
const normEmail = (e) => String(e || '').trim().toLowerCase();
const publicClient = (c) => { if (!c) return c; const o = { ...c }; delete o.password; return o; };
async function casList(db, key, fn) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const row = await db.prepare('SELECT json, updated_at FROM sync WHERE key = ?').bind(key).first();
    let list = []; if (row) { try { list = JSON.parse(row.json); } catch (e) {} if (!Array.isArray(list)) list = []; }
    const res = fn(list);
    if (!res || !res.list) return res ? res.out : undefined;
    const value = JSON.stringify(res.list);
    const now = Math.max(Date.now(), row ? row.updated_at + 1 : 0);
    const r = row
      ? await db.prepare('UPDATE sync SET json = ?, updated_at = ? WHERE key = ? AND updated_at = ?').bind(value, now, key, row.updated_at).run()
      : await db.prepare('INSERT OR IGNORE INTO sync (key, json, updated_at) VALUES (?, ?, ?)').bind(key, value, now).run();
    if (r && r.meta && r.meta.changes === 1) return res.out;
  }
  throw new Error('busy');
}
async function ensureAccount(db, email, password, clientId, provider) {
  email = normEmail(email); if (!email) return;
  const h = password ? await hashPw(password) : { hash: null, salt: null };
  await db.prepare('INSERT OR IGNORE INTO accounts (email, client_id, hash, salt, provider, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(email, clientId || null, h.hash, h.salt, provider || null, Date.now()).run();
}
async function readClients(db) {
  const row = await db.prepare("SELECT json FROM sync WHERE key = 'pps_clients'").first();
  let l = []; if (row) { try { l = JSON.parse(row.json); } catch (e) {} } return Array.isArray(l) ? l : [];
}
// Move any plaintext passwords out of pps_clients into hashed accounts.
async function migratePasswords(db) {
  const list = await readClients(db);
  const withPw = list.filter((c) => c && typeof c.password === 'string' && c.password && c.email);
  for (const c of withPw) await ensureAccount(db, c.email, c.password, c.id, null);
  if (!list.some((c) => c && c.password != null)) return;
  await casList(db, 'pps_clients', (l) => (l.some((c) => c && c.password != null) ? { list: l.map(publicClient) } : null));
}
function nextClientId(list) {
  let max = 0; list.forEach((c) => { const m = /^client_(\d+)$/.exec(String(c && c.id || '')); if (m) max = Math.max(max, parseInt(m[1], 10)); });
  return 'client_' + String(max + 1).padStart(3, '0');
}
function newClient(list, b, provider) {
  const firstName = String(b.firstName || '').trim().slice(0, 60), lastName = String(b.lastName || '').trim().slice(0, 60), now = new Date();
  const email = String(b.email || '').trim().slice(0, 120);
  return {
    id: nextClientId(list), firstName, lastName,
    name: [firstName, lastName].filter(Boolean).join(' ') || email.split('@')[0] || 'Customer',
    email, phone: String(b.phone || '').trim().slice(0, 40), address: String(b.address || '').trim().slice(0, 200),
    registered: now.toISOString().slice(0, 10), registrationDate: now.toISOString(),
    socialProvider: provider || null, status: 'Active', source: provider || 'Website',
    lastLogin: now.toISOString(), loginCount: 1,
  };
}
async function touchLogin(db, email) {
  const e = normEmail(email);
  return casList(db, 'pps_clients', (l) => {
    const i = l.findIndex((c) => c && normEmail(c.email) === e); if (i < 0) return { out: null };
    const c = { ...l[i], lastLogin: new Date().toISOString(), loginCount: (Number(l[i].loginCount) || 0) + 1 };
    delete c.password; const nl = l.slice(); nl[i] = c; return { list: nl, out: c };
  });
}
async function handleAuth(path, request, env) {
  const db = env.DB;
  let b = {}; try { b = await request.json(); } catch (e) { return json({ code: 'bad_request' }, 400); }
  await migratePasswords(db);
  const now = Date.now();

  if (path === 'signup') {
    const email = normEmail(b.email), pw = String(b.password || '');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ code: 'bad_email' }, 400);
    if (pw.length < 4 || pw.length > 128) return json({ code: 'weak_password' }, 400);
    const list = await readClients(db);
    const acct = await db.prepare('SELECT email FROM accounts WHERE email = ?').bind(email).first();
    const hasClient = list.some((c) => c && normEmail(c.email) === email);
    if (hasClient) return json({ code: 'exists' }, 409);
    if (acct) await db.prepare('DELETE FROM accounts WHERE email = ?').bind(email).run(); // client was removed by admin
    const h = await hashPw(pw);
    const ins = await db.prepare('INSERT OR IGNORE INTO accounts (email, hash, salt, created_at, last_login) VALUES (?, ?, ?, ?, ?)').bind(email, h.hash, h.salt, now, now).run();
    if (!ins.meta || ins.meta.changes !== 1) return json({ code: 'exists' }, 409);
    const client = await casList(db, 'pps_clients', (l) => {
      if (l.some((c) => c && normEmail(c.email) === email)) return { out: null };
      const c = newClient(l, b, null); return { list: [c].concat(l), out: c };
    });
    if (!client) return json({ code: 'exists' }, 409);
    await db.prepare('UPDATE accounts SET client_id = ? WHERE email = ?').bind(client.id, email).run();
    return json({ client: publicClient(client) });
  }

  if (path === 'login') {
    const id = String(b.id || '').trim(), pw = String(b.password || '');
    if (!id || !pw) return json({ code: 'bad_request' }, 400);
    const list = await readClients(db);
    let email = id.includes('@') ? normEmail(id) : null;
    if (!email) {
      const lid = id.toLowerCase();
      const hits = list.filter((c) => c && ((c.name && String(c.name).trim().toLowerCase() === lid) || (c.username && String(c.username).toLowerCase() === lid)));
      if (hits.length === 1) email = normEmail(hits[0].email);
      else if (hits.length > 1) return json({ code: 'use_email' }, 409);
    }
    const client = email && list.find((c) => c && normEmail(c.email) === email);
    if (!client) return json({ code: 'no_account' }, 404);
    const acct = await db.prepare('SELECT * FROM accounts WHERE email = ?').bind(email).first();
    if (!acct || !acct.hash) return json({ code: client.socialProvider ? 'social' : 'no_password', provider: client.socialProvider || null }, 409);
    if (acct.locked_until > now) return json({ code: 'locked', retryIn: Math.ceil((acct.locked_until - now) / 60000) }, 429);
    const h = await hashPw(pw, acct.salt);
    if (h.hash !== acct.hash) {
      const fails = (acct.fails || 0) + 1;
      if (fails >= 5) { await db.prepare('UPDATE accounts SET fails = 0, locked_until = ? WHERE email = ?').bind(now + 15 * 60000, email).run(); return json({ code: 'locked', retryIn: 15 }, 429); }
      await db.prepare('UPDATE accounts SET fails = ? WHERE email = ?').bind(fails, email).run();
      return json({ code: 'wrong_password', left: 5 - fails }, 401);
    }
    await db.prepare('UPDATE accounts SET fails = 0, locked_until = 0, last_login = ? WHERE email = ?').bind(now, email).run();
    const c = await touchLogin(db, email);
    return json({ client: publicClient(c || client) });
  }

  if (path === 'social') {
    const email = normEmail(b.email);
    if (!email) return json({ code: 'bad_email' }, 400);
    const list = await readClients(db);
    const existing = list.find((c) => c && normEmail(c.email) === email);
    if (existing) { const c = await touchLogin(db, email); return json({ client: publicClient(c || existing) }); }
    if (b.mode === 'login') return json({ code: 'no_account' }, 404);
    const provider = String(b.provider || 'Social').slice(0, 30);
    const client = await casList(db, 'pps_clients', (l) => {
      const ex = l.find((c) => c && normEmail(c.email) === email); if (ex) return { out: ex };
      const c = newClient(l, b, provider); return { list: [c].concat(l), out: c };
    });
    await ensureAccount(db, email, null, client.id, provider);
    return json({ client: publicClient(client) });
  }

  if (path === 'exists') {
    const email = normEmail(b.email);
    const list = await readClients(db);
    return json({ exists: list.some((c) => c && normEmail(c.email) === email) });
  }
  return json({ code: 'not_found' }, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);

    if (url.pathname === '/api/health') {
      const out = { ok: true, version: 'v21', db: !!env.DB, locked: !!env.ADMIN_TOKEN, admin: isAdmin(request, env), now: Date.now() };
      if (env.DB) {
        try {
          await ensureTable(env.DB);
          const { results } = await env.DB.prepare("SELECT key, json, updated_at FROM sync WHERE key IN ('pps_orders','pps_clients','pps_inquiries')").all();
          out.records = {};
          results.forEach((r) => { let n = 0, last = null; try { const l = JSON.parse(r.json); n = Array.isArray(l) ? l.length : 0; last = n ? (l[0].id || null) : null; } catch (e) {} out.records[r.key] = { count: n, newest: last, updatedAt: r.updated_at }; });
          const v = await env.DB.prepare('SELECT COUNT(*) AS n FROM visits WHERE at > ?').bind(Date.now() - 864e5).first();
          out.visitsToday = v ? v.n : 0;
        } catch (e) { out.dbError = String(e && e.message || e); }
      }
      return json(out);
    }
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

      // ── Record-level saves for orders / clients / inquiries ──────────────
      // Each device sends only the records it added or changed (and, for the
      // admin, the ones it deleted). The server applies them to the live list
      // atomically, so no device can ever overwrite another device's records.
      const am = url.pathname.match(/^\/api\/auth\/(signup|login|social|exists)$/);
      if (am) {
        if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
        return await handleAuth(am[1], request, env);
      }

      const rm = url.pathname.match(/^\/api\/rec\/([a-z_]+)$/);
      if (rm) {
        const key = rm[1];
        if (!CUSTOMER_KEYS.has(key)) return json({ error: 'Unknown key' }, 404);
        if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
        let body; try { body = await request.json(); } catch (e) { return json({ error: 'Bad JSON' }, 400); }
        const ups = Array.isArray(body.upserts) ? body.upserts : [];
        const dels = admin && Array.isArray(body.deletes) ? body.deletes.map(String) : [];
        if (key === 'pps_clients') {
          for (let i = 0; i < ups.length; i++) {
            const c = ups[i];
            if (c && typeof c === 'object' && c.password != null) {
              if (typeof c.password === 'string' && c.password && c.email) await ensureAccount(env.DB, c.email, c.password, c.id, null);
              ups[i] = publicClient(c);
            }
          }
          if (admin && dels.length) {
            const cur = await readClients(env.DB);
            for (const c of cur) if (c && dels.includes(String(c.id)) && c.email) await env.DB.prepare('DELETE FROM accounts WHERE email = ?').bind(normEmail(c.email)).run();
          }
        }
        for (let attempt = 0; attempt < 8; attempt++) {
          const row = await env.DB.prepare('SELECT json, updated_at FROM sync WHERE key = ?').bind(key).first();
          let list = []; if (row) { try { list = JSON.parse(row.json); } catch (e) {} if (!Array.isArray(list)) list = []; }
          const res = applyOps(key, list, ups, dels, admin);
          const value = JSON.stringify(res.list);
          if (value.length > 1900000) return json({ error: 'Too large for database' }, 413);
          const now = Math.max(Date.now(), row ? row.updated_at + 1 : 0);
          const r = row
            ? await env.DB.prepare('UPDATE sync SET json = ?, updated_at = ? WHERE key = ? AND updated_at = ?').bind(value, now, key, row.updated_at).run()
            : await env.DB.prepare('INSERT OR IGNORE INTO sync (key, json, updated_at) VALUES (?, ?, ?)').bind(key, value, now).run();
          if (r && r.meta && r.meta.changes === 1) return json({ key, updatedAt: now, renamed: res.renamed });
        }
        return json({ error: 'Busy, retry' }, 503);
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
        if (key === 'pps_clients') await migratePasswords(env.DB);
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
        if (key === 'pps_clients') { await migratePasswords(env.DB); merged = true; }
        return json({ key, updatedAt: now, merged });
      }
      return json({ error: 'Method not allowed' }, 405);
    } catch (e) {
      return json({ error: 'Server error' }, 500);
    }
  }
};

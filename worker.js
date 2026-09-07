// worker.js — KAVO Grid server: static assets + a tiny sync API backed by
// Cloudflare D1. Every synced localStorage key is one row in `sync`
// (key, json, updated_at). Both the storefront and the admin console talk to
// this via lib/cloud-sync.js.
//
//   GET  /api/sync            -> [{key, updatedAt}]           (index, for polling)
//   GET  /api/sync/:key       -> {key, json, updatedAt} | 404
//   PUT  /api/sync/:key       -> body {json}                   (upsert)
//   GET  /api/health          -> {ok:true}
//
// Optional protection: set a secret named ADMIN_TOKEN in the Worker's
// Variables & Secrets. Then writes to admin-only keys (catalogue, hero media,
// rates, staff accounts) must carry header  X-Admin-Token: <that value>.
// The admin console asks for it once (Settings → Cloud sync) and stores it in
// this browser. Without the secret, all keys are writable (fine to start with).

const ALL_KEYS = new Set([
  'pps_hero_media', 'pps_products', 'pps_currency_rates',
  'pps_orders', 'pps_inquiries', 'pps_clients', 'pps_quotes',
  'pps_quotations', 'pps_seq_quotations', 'pps_seq_quote_files',
  'pps_deliveries', 'pps_lpos', 'pps_notifications', 'pps_users'
]);
const ADMIN_ONLY = new Set(['pps_hero_media', 'pps_products', 'pps_currency_rates', 'pps_users', 'pps_seq_quotations', 'pps_seq_quote_files']);
const MAX_BYTES = 4 * 1024 * 1024; // D1 row limit is ~1MB per value; hero media is stored as URLs so this is generous

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

let tableReady = false;
async function ensureTable(db) {
  if (tableReady) return;
  await db.prepare('CREATE TABLE IF NOT EXISTS sync (key TEXT PRIMARY KEY, json TEXT NOT NULL, updated_at INTEGER NOT NULL)').run();
  tableReady = true;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);

    if (url.pathname === '/api/health') return json({ ok: true, db: !!env.DB });
    if (!env.DB) return json({ error: 'D1 database not bound. Add [[d1_databases]] to wrangler.toml.' }, 503);

    try {
      await ensureTable(env.DB);
      const m = url.pathname.match(/^\/api\/sync(?:\/([a-z0-9_]+))?$/);
      if (!m) return json({ error: 'Not found' }, 404);
      const key = m[1];

      if (request.method === 'GET' && !key) {
        const { results } = await env.DB.prepare('SELECT key, updated_at FROM sync').all();
        return json(results.map(r => ({ key: r.key, updatedAt: r.updated_at })));
      }
      if (!key || !ALL_KEYS.has(key)) return json({ error: 'Unknown key' }, 404);

      if (request.method === 'GET') {
        const row = await env.DB.prepare('SELECT key, json, updated_at FROM sync WHERE key = ?').bind(key).first();
        if (!row) return json({ error: 'Empty' }, 404);
        return json({ key: row.key, json: row.json, updatedAt: row.updated_at });
      }

      if (request.method === 'PUT' || request.method === 'POST') {
        if (env.ADMIN_TOKEN && ADMIN_ONLY.has(key) && request.headers.get('x-admin-token') !== env.ADMIN_TOKEN) {
          return json({ error: 'Admin token required' }, 401);
        }
        let body;
        try { body = await request.json(); } catch (e) { return json({ error: 'Bad JSON' }, 400); }
        if (typeof body.json !== 'string') return json({ error: 'json must be a string' }, 400);
        if (body.json.length > MAX_BYTES) return json({ error: 'Too large' }, 413);
        const now = Date.now();
        await env.DB.prepare('INSERT INTO sync (key, json, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at')
          .bind(key, body.json, now).run();
        return json({ key, updatedAt: now });
      }
      return json({ error: 'Method not allowed' }, 405);
    } catch (e) {
      return json({ error: String(e && e.message || e) }, 500);
    }
  }
};

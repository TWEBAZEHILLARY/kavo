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
  'pps_hero_media', 'pps_products', 'pps_currency_rates', 'pps_coming_soon',
  'pps_orders', 'pps_inquiries', 'pps_clients', 'pps_quotes',
  'pps_quotations', 'pps_seq_quotations', 'pps_seq_quote_files',
  'pps_deliveries', 'pps_lpos', 'pps_notifications', 'pps_users',
  'pps_receipts', 'pps_deliveries_seq', 'pps_lpos_seq'
]);
const ADMIN_ONLY = new Set(['pps_hero_media', 'pps_coming_soon', 'pps_products', 'pps_currency_rates', 'pps_users', 'pps_seq_quotations', 'pps_seq_quote_files']);
const MAX_BYTES = 4 * 1024 * 1024; // D1 row limit is ~1MB per value; hero media is stored as URLs so this is generous

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

let tableReady = false;
async function ensureTable(db) {
  if (tableReady) return;
  await db.prepare('CREATE TABLE IF NOT EXISTS sync (key TEXT PRIMARY KEY, json TEXT NOT NULL, updated_at INTEGER NOT NULL)').run();
  await db.prepare('CREATE TABLE IF NOT EXISTS imgs (id TEXT PRIMARY KEY, mime TEXT NOT NULL, data TEXT NOT NULL, updated_at INTEGER NOT NULL)').run();
  tableReady = true;
}
const IMG_MAX = 1500000; // one image per D1 row, well under the row limit

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);

    if (url.pathname === '/api/health') return json({ ok: true, db: !!env.DB });
    if (!env.DB) return json({ error: 'D1 database not bound. Add [[d1_databases]] to wrangler.toml.' }, 503);

    try {
      await ensureTable(env.DB);
      // Images (e.g. Coming soon photos) are stored one per row and served as
      // real files, so the synced JSON only carries short /api/img/<id> URLs.
      const im = url.pathname.match(/^\/api\/img\/([a-z0-9_]+)$/);
      if (im) {
        if (request.method === 'GET') {
          const row = await env.DB.prepare('SELECT mime, data FROM imgs WHERE id = ?').bind(im[1]).first();
          if (!row) return new Response('Not found', { status: 404 });
          const bin = atob(row.data), bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          return new Response(bytes, { headers: { 'content-type': row.mime, 'cache-control': 'public, max-age=31536000, immutable' } });
        }
        if (request.method === 'PUT' || request.method === 'POST') {
          if (env.ADMIN_TOKEN && request.headers.get('x-admin-token') !== env.ADMIN_TOKEN) return json({ error: 'Admin token required' }, 401);
          let body; try { body = await request.json(); } catch (e) { return json({ error: 'Bad JSON' }, 400); }
          const mm = typeof body.data === 'string' && body.data.match(/^data:(image\/[a-z+]+);base64,(.+)$/);
          if (!mm) return json({ error: 'data must be a base64 image data URL' }, 400);
          if (mm[2].length > IMG_MAX) return json({ error: 'Image too large' }, 413);
          await env.DB.prepare('INSERT INTO imgs (id, mime, data, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET mime = excluded.mime, data = excluded.data, updated_at = excluded.updated_at')
            .bind(im[1], mm[1], mm[2], Date.now()).run();
          return json({ url: '/api/img/' + im[1] });
        }
        return json({ error: 'Method not allowed' }, 405);
      }
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

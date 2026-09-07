# Deploying KAVO Grid to kavogrid.org

Three parts: (1) push to GitHub, (2) connect Cloudflare Pages, (3) turn on the shared database.
Everything in the repo is already prepared — you only run the commands and click through the dashboards.

---

## 1 · Push the site to GitHub (`TWEBAZEHILLARY/kavo`)

Unzip the project, open a terminal inside the folder, then:

```bash
git init
git add .
git commit -m "KAVO Grid storefront + admin console"
git branch -M main
git remote add origin https://github.com/TWEBAZEHILLARY/kavo.git
git push -u origin main
```

If the repo already has a commit and the push is rejected, use `git push -u origin main --force` (the repo is currently empty, so this is safe).

## 2 · Cloudflare Workers (static assets)

1. Cloudflare dashboard → **Workers & Pages → Create → Import a repository** → pick **TWEBAZEHILLARY/kavo**, branch `main`.
2. Build command: **(leave empty)**. Deploy command: `npx wrangler deploy` (wrangler.toml uploads the repo root as static assets).
3. **Save and Deploy**. You get a `kavogrid.<account>.workers.dev` preview URL.
4. Project → **Settings → Domains & Routes → Add → Custom domain** → `kavogrid.org`. Repeat for `www.kavogrid.org`.
   Because the domain is already on Cloudflare, the DNS records are created for you.
6. Wait for the certificate (usually under 5 minutes). Then:
   - `https://kavogrid.org` → storefront
   - `https://kavogrid.org/admin` → admin console
   - `www.kavogrid.org` redirects to the apex (rule in `_redirects`).

Every later `git push` to `main` redeploys automatically.

**Google:** go to https://search.google.com/search-console, add `kavogrid.org` (Domain property, verify with the DNS TXT record Cloudflare lets you add), then submit `https://kavogrid.org/sitemap.xml`. The homepage appears in results within a few days; the `/admin` page is marked no-index and will not.

## 3 · Shared database (Firebase Firestore) — makes admin changes reach every visitor

Without this step the site still works, but each browser keeps its own copy of the catalogue/orders. With it, what the admin publishes is what every customer sees, and every order lands in the admin console.

1. https://console.firebase.google.com → **Add project** → name it `kavogrid` → (Analytics can be off) → Create.
2. Left menu **Build → Firestore Database → Create database** → choose a region (e.g. `europe-west1`) → start in **production mode**.
3. **Rules** tab → replace everything with the contents of `firestore.rules` from this repo → **Publish**.
4. Project settings (gear icon) → **Your apps → Web app (`</>`)** → nickname `kavogrid.org` → Register. Copy the `firebaseConfig` object shown.
5. Paste those values into `lib/firebase-config.js` (replace the `YOUR_…` placeholders), commit, push. Cloudflare redeploys.
6. Optional social login: **Build → Authentication → Sign-in method** → enable Google (and Facebook/Twitter if wanted) → **Settings → Authorized domains** → add `kavogrid.org`.

First time the admin console opens after this, it uploads the existing catalogue to the cloud; from then on the cloud is the source of truth for every device.

## 4 · Email notifications (optional)

`lib/commerce.jsx` (top of file) holds the EmailJS public key, service ID and template IDs. Fill them in to receive an email for every new order/inquiry at kavogrid@gmail.com. The admin password-reset email uses the same account (`admin/auth.jsx`).

---

### File map
- `index.html` — storefront (`/`)
- `admin.html` — admin console (`/admin`)
- `wrangler.toml`, `_redirects`, `_headers` — Cloudflare routing, caching and no-index for admin
- `robots.txt`, `sitemap.xml` — search engines
- `lib/firebase-config.js` — the ONE file you edit to switch on the database
- `firestore.rules` — paste into Firebase

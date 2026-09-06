# KAVO Grid — kavogrid.org

Static site. No build step.

| URL | File |
|---|---|
| https://kavogrid.org/ | `index.html` (storefront) |
| https://kavogrid.org/admin | `admin.html` (admin console, rewritten via `_redirects`) |

Shared code: `lib/` (data layer, commerce, brand, cloud sync), `screens/home-a.jsx` (storefront screen), `admin/` (console modules).

**Deployment and setup steps: see [DEPLOY.md](DEPLOY.md).**

## How the admin controls the storefront
Both pages read/write the same data keys (`pps_products`, `pps_hero_media`, `pps_currency_rates`, `pps_orders`, …).
`lib/cloud-sync.js` mirrors those keys to Cloud Firestore so a change made in the admin console appears on every visitor's device, and every customer order/inquiry reaches the admin. It activates as soon as `lib/firebase-config.js` is filled in.

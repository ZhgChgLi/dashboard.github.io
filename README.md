# Paper Dashboard — static frontend

Static React dashboard. Fetches JSON from the Apps Script web app deployed in `../Dashboard/`.

## Setup

1. Visit `https://<user>.github.io/Dashboard/#key=YOUR_DASHBOARD_KEY` once.
   - The key is read from the URL hash, persisted to `localStorage`, and the hash is stripped.
2. After that, plain `https://<user>.github.io/Dashboard/` works on this device.

To reset the key: open DevTools → Application → Local Storage → delete `DASHBOARD_KEY`.

## Hosting

Repo Settings → Pages → Source: `main` branch / `/Page` folder.

## Files

- `index.html` — entrypoint, registers the service worker, mounts React via Babel-standalone (no build step)
- `sw.js` — cache-first for static assets / CDN, stale-while-revalidate for the GAS JSON endpoint
- `manifest.json` — PWA bits (install to homescreen, theme color)

Bump `CACHE_VERSION` in `sw.js` whenever static assets change to force clients to refresh.

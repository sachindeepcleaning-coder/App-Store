# Sachin App Store

Personal app store hosted on GitHub Pages at **https://sachinapp.store/**.

Upload apps straight from the site, download them later, and keep every download link in one list.

## What is in this repo

| File | Purpose |
| --- | --- |
| `index.html` | The store page, styles and grid rendering. |
| `apps.js` | Reserved for a static catalogue. Empty, because the live catalogue is private. |
| `config.js` | Site configuration. |
| `store.js` | Browser storage (IndexedDB). |
| `vault.js` | Client for the private store. |
| `upload.js` | The upload dialog. |
| `worker/` | Source for the Cloudflare Worker that guards the private store. |
| `CNAME` | Binds the site to `sachinapp.store`. |

The site itself is a login screen. Nothing about your apps is in the page: the app list is served by the Worker only to an unlocked session, and the builds are never on the public repository at all.

## Signing in

Open the site and you get a password prompt. The password is checked by the Worker, not by the page, so it is never embedded in the HTML.

Tick **Remember on this device** and the Worker issues a long-lived signed token that the browser stores; your actual password is **never** written to disk anywhere. Leave it unticked and you are asked every time. Either way, sessions expire after an hour.

## What guards the store

| Control | Detail |
| --- | --- |
| Password | Checked by the Worker against a secret. Never in the page, never in the browser storage, never in a URL or a log. |
| Password policy | The Worker refuses to run if the stored password is under 10 characters. |
| Rate limiting | Two layers. A coarse per-client limit of 10 requests per 60 seconds, plus an exact lockout counter. |
| Failed login backoff | The first 3 wrong passwords are answered normally. After that each further failure backs off: 10s, 60s, 5 min, 15 min. The counter resets the moment you sign in correctly. |
| Write attempts | 30 catalogue or upload operations per 60 seconds. |
| Session token | Signed, scoped to the store, 1 hour. |
| Remember token | Signed, scoped to the store, 30 days, revocable by changing the store password. |
| Download ticket | Signed, scoped to one file, 15 minutes. |
| Share links | Random 96-bit ids, expire in 30 days, revocable with one click. |
| Content-Security-Policy | `default-src 'none'`, scripts and styles from self only, connections limited to the store and GitHub. |
| Response headers | `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Permissions-Policy`. |
| Catalogue | Lives in the private repository, written atomically, retried on conflict. |
| Filenames | Sanitised at every point where they are stored or placed in a header. |

The Worker origin is pinned in both `config.js` and the CSP, so the page can only ever talk to one store. To move it, change both.

## Where you can store an upload

Pick one in the upload dialog.

### Private store — the default

Your builds are kept somewhere only you can reach. Only you can upload, and only you can download, with your password. It also gives you per-app **share links**: a random one-off URL for handing a single build to a friend or a tester, without exposing the rest of your store.

Files up to 2 GB each, with no total size limit and no bandwidth limit. Builds over 95 MB are uploaded straight to the private repository, which needs a GitHub token scoped to it.

### This device

No setup. The file is stored in your browser (IndexedDB), shows up with an **On this device** badge, and gets a working Download button. It survives a refresh, but it lives on that one device and browser profile, and it is gone if you clear site data.

## Editing the catalogue by hand

The catalogue lives in the private repository, in `catalogue.json` at its root. Each entry looks like this:

```json
{
  "id": "my-cool-app",
  "name": "My Cool App",
  "developer": "Sachin",
  "category": "Utilities",
  "version": "1.0.0",
  "size": "12.4 MB",
  "description": "What the app does.",
  "fileName": "my-cool-app-1.0.0.apk",
  "releaseId": 123456,
  "assetId": 234567,
  "updated": "2026-10-20",
  "featured": false,
  "shareId": null
}
```

Editing that file in the private repo updates the store within a minute. Uploading a new build through the site does it for you.

## Field reference

| Field | Required | Notes |
| --- | --- | --- |
| `id` | yes | Unique. Also the folder name under `apps/`. |
| `name` | yes | Shown on the card. |
| `developer` | no | Defaults to "Sachin". |
| `category` | no | Becomes a filter chip automatically. |
| `version` | no | Displayed as `v1.0.0`. |
| `size` | no | Human readable, e.g. `"12.4 MB"`. Used for the total size stat. |
| `description` | no | Shown on the card, clamped to 3 lines. |
| `icon` | no | Path to an image. Falls back to a generated letter tile. |
| `file` | no | Path to the download. **If this is `null` the Download button stays disabled.** |
| `website` | no | External link, opens in a new tab. |
| `updated` | no | `YYYY-MM-DD`. Apps updated within 14 days get a "New" badge. |
| `featured` | no | `true` adds a "Featured" badge. |
| `rating` | no | Reserved, not displayed yet. |

## Limits worth knowing

- Uploads over 95 MB skip the private worker and go straight to the storage backend instead. Everything stays private either way.
- Release assets allow **2 GB per file**, no limit on total size, and no limit on bandwidth.
- The three `Example App` entries in `apps.js` are placeholders. Delete them once you have real apps.

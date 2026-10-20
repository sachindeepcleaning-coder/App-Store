# Sachin App Store

Personal app store hosted on GitHub Pages at **https://sachinapp.store/**.

Upload apps straight from the site, download them later, and keep every download link in one list.

## What is in this repo

| File | Purpose |
| --- | --- |
| `index.html` | The store page, styles and grid rendering. |
| `apps.js` | Catalogue of apps published for everyone. |
| `config.js` | Site configuration. |
| `store.js` | Browser storage (IndexedDB) and public publishing. |
| `vault.js` | Client for the private store. |
| `upload.js` | The upload dialog. |
| `apps/` | Where published build files live, one folder per app. |
| `CNAME` | Binds the site to `sachinapp.store`. |

## Where you can store an upload

Pick one in the upload dialog.

### This device

No setup. The file is stored in your browser (IndexedDB), shows up with an **On this device** badge, and gets a working Download button. It survives a refresh, but it lives on that one device and browser profile, and it is gone if you clear site data.

### Private store

Your builds are kept somewhere only you can reach. Only you can upload, and only you can download, with your password. It also gives you per-app **share links**: a random one-off URL for handing a single build to a friend or a tester, without exposing the rest of your store.

Files up to 2 GB each, with no total size limit and no bandwidth limit.

### GitHub release

Publishes into this repository so the build is available to everyone, on every device. Needs a GitHub token with `Contents: read and write` on this repo only.

## Editing the catalogue by hand

You can still add entries to `apps.js` directly. Upload the build into `apps/<id>/`, add the entry, push.

```js
{
  id: "my-cool-app",
  name: "My Cool App",
  developer: "Sachin",
  category: "Utilities",
  version: "1.0.0",
  size: "12.4 MB",
  description: "What the app does.",
  icon: null,                                 // optional path to an image
  file: "apps/my-cool-app/my-cool-app.apk",   // null keeps the Download button disabled
  website: null,                              // optional external link
  updated: "2026-10-20",
  featured: false,
  rating: null
}
```

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

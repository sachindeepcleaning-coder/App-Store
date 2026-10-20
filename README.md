# Sachin App Store

Personal app store hosted on GitHub Pages at **https://sachinapp.store/**.

Upload apps straight from the site, download them later, and keep every download link in one list.

## How it works

| Piece | Where it lives | Purpose |
| --- | --- | --- |
| `index.html` | this repo (public) | The store page, styles and grid rendering. |
| `apps.js` | this repo (public) | Catalogue of apps published for everyone. |
| `config.js` | this repo (public) | Points the site at your private store. |
| `store.js` | this repo | Browser storage (IndexedDB) and GitHub publishing. |
| `vault.js` | this repo | Client for the private store worker. |
| `upload.js` | this repo | The upload dialog. |
| `worker/` | this repo | Source for the Cloudflare Worker that guards the private store. |
| `my-apps` | **separate private repo** | Your app builds, published as GitHub Releases. |
| `sachinapp.store` | GitHub Pages | The public site. |

The split matters: the **site** is public, the **builds** are not. A Worker sits in between and holds the credentials, so the browser never sees your GitHub token and nobody can push files into your store.

## Three places to store an upload

Pick one in the upload dialog.

### 1. This device

No setup. The file is stored in your browser (IndexedDB), shows up with an **On this device** badge, and gets a working Download button. It survives a refresh, but it lives on that one device and browser profile, and it is gone if you clear site data.

### 2. Private store — recommended

Your builds go to the private `my-apps` repository as GitHub Releases. Only you can upload, and only you can download, with your password.

You also get per-app **share links**: a random one-off URL for handing a single build to a friend or a tester, without exposing the rest of your store.

Files up to 2 GB each. No total size limit, no bandwidth limit, and no credit card anywhere.

### 3. GitHub release

Publishes into this public repository so the build is available to everyone, on every device. Needs a GitHub token with `Contents: read and write` on this repo only.

## Setting up the private store

This is the part that needs your Cloudflare login. It is about twenty minutes.

**Step 1 - the private repository** (already created):

```bash
gh repo create sachindeepcleaning-coder/my-apps --private
```

**Step 2 - a fine-grained token for that repo.**

GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate.

- Repository access: `App-Store` → select **Only select repositories** → pick `my-apps`
- Repository permissions → **Contents**: Read and write

Copy the token. You will need it as the Worker's `GITHUB_TOKEN` secret.

**Step 3 - deploy the Worker.**

```bash
cd worker
npx wrangler login
npx wrangler secret put GITHUB_TOKEN     # paste the token from step 2
npx wrangler secret put STORE_PASSWORD   # your store password
npx wrangler secret put TOKEN_SECRET     # any long random string
npx wrangler deploy
```

`wrangler login` opens a browser so you can approve. The Worker lands on `https://app-store.sachin-cleaner.workers.dev`, which is already set in `config.js`.

**Step 4 - unlock it.** Open the site, hit Upload, choose **Private store**, type your password, and remember it on the device. That is the only credential you need from then on.

For `TOKEN_SECRET`, generate one with:

```bash
openssl rand -hex 32
```

## How the private store protects itself

- `GITHUB_TOKEN` lives only as a Worker secret. It is never in the page, never in the repository, and never sent to the browser.
- `STORE_PASSWORD` is also a Worker secret. The site exchanges it for a signed session token that expires after an hour.
- Downloads use a single-app ticket that expires in 15 minutes, scoped to one file.
- Share links are random 96-bit ids. Rotating one is a click.
- The Worker only ever exposes `/catalogue` publicly, which contains names and versions but no download URLs.

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

- Cloudflare Workers Free allows **100,000 requests a day** and a request body up to **100 MB**. Uploads over 95 MB skip the Worker and go straight to GitHub's release endpoint instead, which needs a GitHub token in the browser. Everything stays private either way, because the repository is private.
- GitHub Releases allow **2 GB per asset**, no limit on total size, and no limit on bandwidth.
- The GitHub API allows 5,000 requests an hour, which is the real ceiling on downloads if a lot of people pull files at once.
- The three `Example App` entries in `apps.js` are placeholders. Delete them once you have real apps.

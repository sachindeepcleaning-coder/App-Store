# Sachin App Store

Personal app store hosted on GitHub Pages at **https://sachinapp.store/**.

You can upload apps straight from the site, download them later, and keep every download link in one list.

## How it works

| File | Purpose |
| --- | --- |
| `index.html` | The store page. Layout, styles and the grid rendering all live here. |
| `apps.js` | **The published catalogue.** One object per app that is live on the site. |
| `store.js` | Storage layer. Saves uploads to the browser (IndexedDB) and publishes to GitHub. |
| `upload.js` | The upload dialog: file picker, drag and drop, metadata form, token handling. |
| `apps/` | Where published build files live, one folder per app. |
| `CNAME` | Binds the site to `sachinapp.store`. |

## Uploading an app

Click **Upload** in the header, or the **Upload an app** button in the hero. Pick a file, fill in the name, and choose one of two destinations.

### 1. Save to my device

No setup, no account, works immediately. The file is stored in your browser (IndexedDB), shows up in the grid with an **On this device** badge, and gets a working **Download** button. It survives closing the tab and reloading the page.

Limits worth knowing:

- It lives in that one browser on that one device. Another device, another browser, or clearing site data means it is gone.
- Use this for a build you are testing, or for a file you just want to grab later.

### 2. Publish to GitHub

This writes the build into the repository, so the app lives on the site permanently and is available to everyone on every device. It needs a GitHub token.

**To get a token:** GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate. Set:

- **Repository access:** only `App-Store`
- **Permissions → Repository contents:** Read and write

Then paste the token into the **Publish to the live site** section of the upload dialog and press **Save token**. Tick *Remember on this device* if you want it kept between visits, otherwise it is discarded when the tab closes.

The token is only ever sent to `api.github.com`. It is never included in the catalogue or shown on the page.

**What publishing does**, in one atomic commit:

1. Uploads the build to `apps/<id>/<filename>`
2. Adds the matching entry to `apps.js`
3. Commits both and updates `main`

GitHub Pages then rebuilds, usually within a minute, and the app appears on the live site with a real public download link.

## Editing the catalogue by hand

You can still add entries to `apps.js` directly, which is the right choice if you want to commit a build together with other changes:

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

Then upload the build into `apps/my-cool-app/` and push.

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
| `icon` | no | Path to an image, e.g. `"apps/my-cool-app/icon.png"`. Falls back to a generated letter tile. |
| `file` | no | Path to the download. **If this is `null` the Download button stays disabled.** |
| `website` | no | External link, opens in a new tab. |
| `updated` | no | `YYYY-MM-DD`. Apps updated within 14 days get a "New" badge. |
| `featured` | no | `true` adds a "Featured" badge. |
| `rating` | no | Reserved, not displayed yet. |

## Notes

- The three `Example App` entries in `apps.js` are placeholders. Delete them once you have real apps.
- GitHub Pages serves files up to 1 GB, and a repository is capped at 1 GB. Very large APKs are better hosted outside the repo and linked with the `website` field. The publish button refuses files over 90 MB.
- Published files and their links are public. GitHub Pages is a static host, so there is no way to make them private.

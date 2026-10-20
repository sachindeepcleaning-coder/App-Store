# Sachin App Store

Personal app store hosted on GitHub Pages at **https://sachinapp.store/**.

Every app you publish shows up on the site automatically, and every download link is listed in one place so you never lose track of it again.

## How it works

| File | Purpose |
| --- | --- |
| `index.html` | The store page. Layout, styles and UI logic all live here. |
| `apps.js` | **The catalogue.** One object per app. This is the only file you edit to publish an app. |
| `apps/` | Where the actual build files are uploaded, one folder per app. |
| `CNAME` | Binds the site to `sachinapp.store`. |

## Publishing a new app

**Step 1 - upload the build.**
Upload the file through the GitHub web UI (or push it) into a folder named after the app id:

```
apps/my-cool-app/my-cool-app.apk
```

**Step 2 - add the entry.**
Open `apps.js` and add an object to the `APPS` array:

```js
{
  id: "my-cool-app",
  name: "My Cool App",
  developer: "Sachin",
  category: "Utilities",
  version: "1.0.0",
  size: "12.4 MB",
  description: "What the app does.",
  icon: null,
  file: "apps/my-cool-app/my-cool-app.apk",
  website: null,
  updated: "2026-10-20",
  featured: false,
  rating: null
}
```

**Step 3 - push.** The site rebuilds in under a minute and the new app appears in the grid, the search results and the "My downloads" list.

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
| `file` | no | Path to the download. **If this is `null` the Download button stays disabled** and the app shows "Not uploaded". |
| `website` | no | External link, opens in a new tab. |
| `updated` | no | `YYYY-MM-DD`. Apps updated within 14 days get a "New" badge. |
| `featured` | no | `true` adds a "Featured" badge. |
| `rating` | no | Reserved, not displayed yet. |

## Notes

- The three `Example App` entries in `apps.js` are placeholders. Delete them once you have real apps.
- GitHub Pages serves files up to 1 GB, and a repository is capped at 1 GB. Very large APKs are better hosted outside the repo and linked with the `website` field.
- Links are public. GitHub Pages is a static host, so there is no way to make the downloads private.

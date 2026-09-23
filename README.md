# Style Image Export

Upload an Excel/CSV with Style Codes in the first column → the site looks up each code's folder in Google Drive → download the same sheet with `Image 1, Image 2, …` links and a `Status` column.

Google access is configured **once on the server** (a service account). Nobody logs in to Google, nobody enters an API key, and no credential ever reaches the browser.

```
Browser (upload sheet)  →  /api/lookup (Vercel, holds the key)  →  Google Drive
                        ←  image IDs                            ←
Browser builds the Excel/CSV from your original rows + links
```

---

## How the lookup works

For each Style Code (e.g. `BLPTSW477`):

1. Search Drive for a **folder named exactly** `BLPTSW477` (case-insensitive, no partial matches).
2. Found → list **every image inside that folder** (`BLPTSW477 (1).JPG`, `(2)`, … any count, 100s are fine), sorted 1, 2, 3 … 10, 11.
3. Folder missing → row kept, `Status = Not Found`, and a warning shows: *Folder "X" does not exist in Drive.*
4. Folder exists but has no images → `Not Found`, with a warning saying so.
5. Google/network failure for that code → `Status = Error` (the reason is shown).

If your sheet holds age-group SKUs like `BLPTSW477-23`, the exact value is tried first, then the part before the last short `-suffix` (`BLPTSW477`). If your sheet holds plain style codes, nothing changes.

Output columns: **all your original columns**, then `Image 1 … Image N` (N = the most images any row has), then `Status`.

---

## Step 1 — Organize images in Drive (one folder per style)

```
New Nightware/                 ← the one folder you share with the service account
├── AIRFORCE NAVY & WHITE/     ← grouping folders are fine, any depth
│   ├── BLPNANW322B/           ← folder name = Style Code, EXACTLY
│   │   ├── BLPNANW322B (1).jpg
│   │   ├── BLPNANW322B (2).jpg
│   │   └── … (7, 8, or any number)
│   └── BLPNANW323F/
└── black/
```

Rules that avoid 95% of problems:

- **Folder name must equal the Style Code exactly.** `BLPTSW477` ≠ `BLPTSW477 ` (trailing space) ≠ `BLPTSW477-old`.
- **Images go directly inside that folder** (not in a sub-folder). JPG/JPEG/PNG/WEBP/GIF/HEIC/etc. are all picked up; other files are ignored.
- **Name images `CODE (1).jpg`, `CODE (2).jpg`…** — this sets the order of Image 1, 2, 3.
  - Windows: select all photos in Explorer → press `F2` → type the style code → Enter. Windows names them `CODE (1)`, `CODE (2)`… automatically.
  - Mac: select photos in Finder → right-click → *Rename* → *Format: Name and Index*. Produces `CODE 1`, `CODE 2` — also sorts correctly.
- **One style code = one folder.** Avoid two folders with the same name (the site will use the one that has images, but it's confusing).
- **Upload the real folder, not a shortcut.** In Drive: *New → Folder upload* (or drag the folder onto the Drive page). "Add shortcut to Drive" does **not** work for the lookup.

---

## Step 2 — Create the Google service account (one time)

If your old site already has a working `GOOGLE_SERVICE_ACCOUNT_JSON`, **reuse it** and skip to Step 3. Otherwise:

1. Go to <https://console.cloud.google.com> and create/select a project.
2. **APIs & Services → Library** → search **Google Drive API** → **Enable**.
3. **APIs & Services → Credentials → Create credentials → Service account**. Name it e.g. `image-export`, click *Done* (no roles needed).
4. Open the service account → **Keys → Add key → Create new key → JSON**. A `.json` file downloads. **Keep it private** — never commit it to GitHub.
5. Copy the service account's email (looks like `image-export@your-project.iam.gserviceaccount.com`).

## Step 3 — Give the service account access to your Drive folder

Drive folders are only visible to the service account if you share them with it.

1. In Drive, right-click your top folder (**New Nightware**) → **Share**.
2. Paste the service-account email → role **Viewer** → uncheck "Notify" → **Share**.
3. Sub-folders and images inherit access automatically.

Your screenshots show these folders are *"Shared with me"* (owner `blushes.kids`). Sharing must be done by someone with permission to share that folder (usually the owner). Being able to *see* a folder yourself does **not** let the service account see it.

Add more collections later by sharing them the same way — no code change.

## Step 4 — Deploy: GitHub → Vercel

1. Put this project in a GitHub repo (`.gitignore` already excludes secrets):
   ```
   git init && git add . && git commit -m "Image export"
   git branch -M main
   git remote add origin https://github.com/YOU/style-image-export.git
   git push -u origin main
   ```
2. <https://vercel.com> → **Add New → Project** → import the repo. Framework preset: **Other**. No build command. Deploy.
3. **Project → Settings → Environment Variables** → add:

   | Name | Value |
   |---|---|
   | `GOOGLE_SERVICE_ACCOUNT_JSON` | Open the downloaded `.json` in a text editor, copy **everything**, paste it as the value |
   | `APP_PASSWORD` *(recommended)* | Any access code. The site asks for it once per browser. Without it, anyone with your URL can use the tool. |

   Tip: if pasting JSON causes trouble, encode it (`base64 -i key.json | tr -d '\n'` on Mac/Linux) and use `GOOGLE_SERVICE_ACCOUNT_B64` instead.
4. **Deployments → ⋯ → Redeploy** (env vars only apply to new deployments).

## Step 5 — Test the connection

Open `https://YOUR-SITE.vercel.app/api/health` (the site's top-right chip also shows this).

| You see | Meaning / fix |
|---|---|
| `"ok": true` and folder names listed | Working. |
| `"ok": true` but `visibleFolders: []` | Credentials fine, but nothing is shared with the service account → redo Step 3. |
| "credentials are missing" | Env var not set, or you didn't redeploy. |
| "not valid JSON" | Paste the *whole* file, from `{` to `}`; or use the B64 variant. |
| "Drive API is not enabled" | Step 2, item 2. |

Then open the site, upload a sheet, click **Find images in Drive**, download the result.

## Running locally (optional)

```
npm install
npm i -g vercel
# put the env vars in a .env.local file (see .env.example)
vercel dev
npm test        # runs the logic tests
```

---

## Sharing the links

The links are normal Drive links. They open for people who **have access to the Drive files**. If the links must work for anyone (e.g. uploading to a marketplace), set the top folder's *General access* to **"Anyone with the link – Viewer"** in Drive (a Drive setting, separate from this site), and use the *Direct image link* option in the site.

## What was fixed vs. the old Image Export code

| Problem in the old code | Now |
|---|---|
| Only column A kept; other columns lost | All original columns preserved |
| Headers `a, b, c` | `Image 1, Image 2, …` + `Status` |
| Links pointed at your own website's `/api/image` proxy | Real Google Drive links |
| Silently searched loose files when the folder was missing | Folder-only; clear "folder doesn't exist" warning |
| Every code in one request (times out on big sheets) | Batches of 10, 3 in parallel, live progress |
| Only the first folder match used; no pagination (max 100 images) | Uses the folder that has images; all pages read |
| No retry on Google rate limits; weak query escaping | Retry with backoff; proper escaping |
| Unclear failures when the key was pasted wrongly | Clear setup messages + `/api/health` |
| Scan Invoice, Style Finder, Gemini, Vercel KV | Removed (not needed) |

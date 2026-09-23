// Google Drive logic for the Image Export site.
// Auth = the same service-account approach as the original project:
// the key lives ONLY in a server-side environment variable.
import { google } from 'googleapis';

const FOLDER_MIME = 'application/vnd.google-apps.folder';
const IMAGE_EXT = /\.(jpe?g|png|webp|gif|bmp|tiff?|heic|heif|avif)$/i;

export class SetupError extends Error {
  constructor(message) { super(message); this.setup = true; }
}

/* ---------- credentials & client ---------- */

export function loadCredentials() {
  let raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw && process.env.GOOGLE_SERVICE_ACCOUNT_B64) {
    raw = Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_B64, 'base64').toString('utf8');
  }
  if (!raw || !raw.trim()) {
    throw new SetupError(
      'Google credentials are missing. Add GOOGLE_SERVICE_ACCOUNT_JSON in Vercel → Settings → Environment Variables, then redeploy.'
    );
  }
  raw = raw.trim();
  // people sometimes paste the value wrapped in quotes
  if ((raw.startsWith("'") && raw.endsWith("'")) || (raw.startsWith('`') && raw.endsWith('`'))) {
    raw = raw.slice(1, -1);
  }
  let creds;
  try {
    creds = JSON.parse(raw);
  } catch {
    throw new SetupError(
      'GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON. Paste the WHOLE key file exactly as downloaded (starting with { and ending with }), or use GOOGLE_SERVICE_ACCOUNT_B64.'
    );
  }
  if (!creds.client_email || !creds.private_key) {
    throw new SetupError('The key JSON is missing client_email or private_key. Make sure it is a *service account* key file.');
  }
  // fix keys whose newlines were pasted as literal "\n"
  creds.private_key = String(creds.private_key).replace(/\\n/g, '\n');
  return creds;
}

let cachedDrive = null;
export function getDrive() {
  if (cachedDrive) return cachedDrive;
  const auth = new google.auth.GoogleAuth({
    credentials: loadCredentials(),
    scopes: ['https://www.googleapis.com/auth/drive.readonly']
  });
  cachedDrive = google.drive({ version: 'v3', auth });
  return cachedDrive;
}

/* ---------- helpers ---------- */

// Escape a value for a Drive query string literal: \ and '
export function escapeQ(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Retry on Google rate limits / transient errors.
async function withRetry(fn, tries = 4) {
  let last;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); }
    catch (e) {
      last = e;
      const status = Number(e?.code || e?.response?.status);
      const reason = e?.errors?.[0]?.reason || e?.response?.data?.error?.errors?.[0]?.reason || '';
      const transient =
        [429, 500, 502, 503, 504].includes(status) ||
        (status === 403 && /rateLimit|quota|backend/i.test(reason));
      if (!transient || i === tries - 1) throw e;
      await sleep(400 * 2 ** i + Math.random() * 250);
    }
  }
  throw last;
}

// Follows nextPageToken so folders with >100 images are never cut off.
async function listAll(drive, params) {
  const files = [];
  let pageToken;
  do {
    const r = await withRetry(() =>
      drive.files.list({
        corpora: 'allDrives',
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
        pageSize: 200,
        ...params,
        pageToken,
        fields: 'nextPageToken, files(id, name, mimeType)'
      })
    );
    files.push(...(r.data.files || []));
    pageToken = r.data.nextPageToken;
  } while (pageToken);
  return files;
}

// Turn Google errors into something a human can act on.
export function friendlyError(e) {
  if (e?.setup) return e;
  const msg = String(e?.message || e);
  const status = Number(e?.code || e?.response?.status);
  if (status === 403 && /has not been used|is disabled|accessNotConfigured|SERVICE_DISABLED/i.test(msg)) {
    return new SetupError('The Google Drive API is not enabled for your Google Cloud project. Enable it in APIs & Services → Library → Google Drive API.');
  }
  if (/invalid_grant|invalid_client|unauthorized_client|DECODER|PEM|private key/i.test(msg) || status === 401) {
    return new SetupError('Google rejected the service-account key. Re-download a fresh key, paste it into GOOGLE_SERVICE_ACCOUNT_JSON, and redeploy. (' + msg + ')');
  }
  return e;
}

/* ---------- style-code logic ---------- */

// "BLPTSW477"     -> ["BLPTSW477"]
// "BLPTSW477-23"  -> ["BLPTSW477-23", "BLPTSW477"]   (age-group suffix)
// The exact value is ALWAYS tried first.
export function candidatesFor(raw) {
  const code = String(raw).trim();
  const out = [code];
  const i = code.lastIndexOf('-');
  if (i > 0) {
    const head = code.slice(0, i).trim();
    const tail = code.slice(i + 1);
    if (head && /^[A-Za-z0-9]{1,5}$/.test(tail)) out.push(head);
  }
  return out;
}

// "X (2).jpg" before "X (10).jpg"; otherwise natural name order.
export function sortImages(files) {
  const num = (n) => { const m = n.match(/\((\d+)\)/); return m ? parseInt(m[1], 10) : null; };
  return files.slice().sort((a, b) => {
    const na = num(a.name), nb = num(b.name);
    if (na !== null && nb !== null && na !== nb) return na - nb;
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
  });
}

const isImage = (f) => (f.mimeType || '').startsWith('image/') || IMAGE_EXT.test(f.name || '');

// Step 1: which of these names exist as EXACTLY-named folders?
// Returns Map(lowercased name -> [{id, name}])
async function findFolders(drive, names) {
  const found = new Map();
  const CHUNK = 8; // several names per query = far fewer API calls
  for (let i = 0; i < names.length; i += CHUNK) {
    const part = names.slice(i, i + CHUNK);
    const nameQ = part.map((n) => `name = '${escapeQ(n)}'`).join(' or ');
    const q = `mimeType = '${FOLDER_MIME}' and trashed = false and (${nameQ})`;
    const files = await listAll(drive, { q });
    for (const f of files) {
      const key = f.name.trim().toLowerCase();
      if (!part.some((n) => n.toLowerCase() === key)) continue; // exact match only
      if (!found.has(key)) found.set(key, []);
      found.get(key).push({ id: f.id, name: f.name });
    }
  }
  return found;
}

// Step 2: images sitting inside one specific folder.
async function listImages(drive, folderId) {
  const files = await listAll(drive, {
    q: `'${escapeQ(folderId)}' in parents and trashed = false and mimeType != '${FOLDER_MIME}'`
  });
  return sortImages(files.filter(isImage)).map((f) => ({ id: f.id, name: f.name }));
}

async function pool(items, limit, worker) {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) { const item = items[i++]; await worker(item); }
    })
  );
}

/**
 * Resolve a batch of style codes.
 * Returns { [rawCode]: { status, matchedCode, images:[{id,name}], message } }
 * status: 'Found' | 'Not Found' | 'Error'
 */
export async function resolveBatch(drive, rawCodes) {
  const codes = [...new Set(rawCodes.map((c) => String(c ?? '').trim()))];
  const results = {};

  const cand = {};
  const allNames = new Set();
  for (const c of codes) {
    if (!c) { results[c] = { status: 'Error', images: [], message: 'Empty style code.' }; continue; }
    cand[c] = candidatesFor(c);
    cand[c].forEach((n) => allNames.add(n));
  }

  let folderMap;
  try {
    folderMap = await findFolders(drive, [...allNames]);
  } catch (e) {
    throw friendlyError(e);
  }

  // pick the folder for each code (exact value first, then stripped suffix)
  const wanted = new Set(); // folder ids we must list
  const pick = {};
  for (const c of Object.keys(cand)) {
    for (const name of cand[c]) {
      const hits = folderMap.get(name.toLowerCase());
      if (hits && hits.length) { pick[c] = { name, folders: hits }; break; }
    }
    if (!pick[c]) {
      results[c] = {
        status: 'Not Found', images: [],
        message: `Folder "${c}" does not exist in Drive.`
      };
    } else {
      pick[c].folders.forEach((f) => wanted.add(f.id));
    }
  }

  const imagesByFolder = {};
  const errorsByFolder = {};
  await pool([...wanted], 4, async (id) => {
    try { imagesByFolder[id] = await listImages(drive, id); }
    catch (e) { errorsByFolder[id] = friendlyError(e); }
  });

  for (const c of Object.keys(pick)) {
    const { name, folders } = pick[c];
    const errs = folders.map((f) => errorsByFolder[f.id]).filter(Boolean);
    if (errs.length === folders.length) {
      if (errs[0].setup) throw errs[0];
      results[c] = { status: 'Error', images: [], matchedCode: name, message: `Could not read folder "${name}": ${errs[0].message}` };
      continue;
    }
    // if duplicate folders share a name, use the first one that has images
    const withImages = folders.find((f) => (imagesByFolder[f.id] || []).length > 0);
    if (!withImages) {
      results[c] = {
        status: 'Not Found', images: [], matchedCode: name,
        message: `Folder "${name}" exists but contains no images.`
      };
      continue;
    }
    results[c] = {
      status: 'Found',
      matchedCode: name,
      images: imagesByFolder[withImages.id],
      message: folders.length > 1 ? `${folders.length} folders are named "${name}"; used the one that has images.` : ''
    };
  }
  return results;
}

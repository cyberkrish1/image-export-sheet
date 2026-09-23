import { getDrive, loadCredentials, friendlyError } from '../lib/drive.js';
import { guard } from '../lib/guard.js';

// Open  https://YOUR-SITE.vercel.app/api/health  to test the Drive setup.
export default async function handler(req, res) {
  if (!guard(req, res)) return;
  try {
    const creds = loadCredentials();
    const drive = getDrive();
    const r = await drive.files.list({
      corpora: 'allDrives', supportsAllDrives: true, includeItemsFromAllDrives: true,
      q: "mimeType = 'application/vnd.google-apps.folder' and trashed = false",
      pageSize: 10, fields: 'files(name)'
    });
    const names = (r.data.files || []).map((f) => f.name);
    return res.status(200).json({
      ok: true,
      serviceAccount: creds.client_email,
      visibleFolders: names,
      hint: names.length
        ? 'Connected. The service account can see your shared folders.'
        : 'Connected, but NO folders are shared with the service account yet. Share your top Drive folder with the serviceAccount email above (Viewer).'
    });
  } catch (e) {
    const err = friendlyError(e);
    return res.status(500).json({ ok: false, error: err.message, setup: !!err.setup });
  }
}

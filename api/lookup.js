import { getDrive, resolveBatch, friendlyError } from '../lib/drive.js';
import { guard } from '../lib/guard.js';

const MAX_CODES = 25; // per request; the browser sends small batches

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!guard(req, res)) return;

  const codes = req.body?.codes;
  if (!Array.isArray(codes) || codes.length === 0) {
    return res.status(400).json({ error: '"codes" (non-empty array) is required.' });
  }
  if (codes.length > MAX_CODES) {
    return res.status(400).json({ error: `Send at most ${MAX_CODES} codes per request.` });
  }

  try {
    const drive = getDrive();
    const results = await resolveBatch(drive, codes);
    return res.status(200).json({ results });
  } catch (e) {
    const err = friendlyError(e);
    if (err.setup) return res.status(500).json({ error: err.message, setup: true });
    // transient problem: report Error per code so the sheet still completes
    const results = {};
    for (const c of codes) {
      results[String(c ?? '').trim()] = { status: 'Error', images: [], message: err.message };
    }
    return res.status(200).json({ results });
  }
}

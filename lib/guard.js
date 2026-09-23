import crypto from 'node:crypto';

const digest = (s) => crypto.createHash('sha256').update(String(s)).digest();

// Optional shared access code. If APP_PASSWORD is not set, the site is open.
// Returns true if the request may continue; otherwise it has already replied.
export function guard(req, res) {
  const expected = process.env.APP_PASSWORD;
  if (!expected) return true;
  const given = req.headers['x-app-password'] || '';
  if (crypto.timingSafeEqual(digest(given), digest(expected))) return true;
  res.status(401).json({ error: 'Access code required.', needsPassword: true });
  return false;
}

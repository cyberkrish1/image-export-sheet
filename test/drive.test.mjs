import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveBatch, candidatesFor, styleCodeOf, sortImages, escapeQ, loadCredentials } from '../lib/drive.js';

const F = 'application/vnd.google-apps.folder';
// fake Drive tree
const db = [
  { id: 'root', name: 'New Nightware', mimeType: F, parents: [] },
  { id: 'c1', name: 'AIRFORCE NAVY & WHITE', mimeType: F, parents: ['root'] },
  { id: 'f322', name: 'BLPNANW322B', mimeType: F, parents: ['c1'] },
  { id: 'f323', name: 'BLPNANW323F', mimeType: F, parents: ['c1'] },      // empty folder
  { id: 'fdup1', name: 'DUP1', mimeType: F, parents: ['c1'] },            // duplicate, empty
  { id: 'fdup2', name: 'DUP1', mimeType: F, parents: ['c1'] },            // duplicate, has image
  { id: 'fq', name: "O'BRIEN1", mimeType: F, parents: ['c1'] },
  { id: 'fbig', name: 'BIG1', mimeType: F, parents: ['c1'] },
  // loose file that must NOT be used when the folder is missing
  { id: 'loose', name: 'NOFOLDER9 (1).jpg', mimeType: 'image/jpeg', parents: ['root'] },
];
for (const n of [10, 2, 1, 3, 8, 7, 6, 5, 4]) db.push({ id: `i${n}`, name: `BLPNANW322B (${n}).jpg`, mimeType: 'image/jpeg', parents: ['f322'] });
db.push({ id: 'note', name: 'readme.txt', mimeType: 'text/plain', parents: ['f322'] });
db.push({ id: 'sub', name: 'subfolder', mimeType: F, parents: ['f322'] });
db.push({ id: 'oct', name: 'BLPNANW322B (11).JPG', mimeType: 'application/octet-stream', parents: ['f322'] }); // wrong mime, image ext
db.push({ id: 'd2img', name: 'DUP1 (1).jpg', mimeType: 'image/jpeg', parents: ['fdup2'] });
db.push({ id: 'q1', name: "O'BRIEN1 (1).jpg", mimeType: 'image/jpeg', parents: ['fq'] });
for (let n = 1; n <= 450; n++) db.push({ id: `big${n}`, name: `BIG1 (${n}).jpg`, mimeType: 'image/png', parents: ['fbig'] });

const unesc = (s) => s.replace(/\\(.)/g, '$1');
let calls = 0;
const fake = {
  files: {
    async list({ q, pageSize = 100, pageToken }) {
      calls++;
      let rows = db;
      const parent = q.match(/'([^']+)' in parents/);
      if (parent) rows = rows.filter((f) => f.parents.includes(parent[1]));
      const names = [...q.matchAll(/name = '((?:\\.|[^'\\])*)'/g)].map((m) => unesc(m[1]));
      if (names.length) rows = rows.filter((f) => names.some((n) => n.toLowerCase() === f.name.toLowerCase()));
      if (q.includes(`mimeType = '${F}'`)) rows = rows.filter((f) => f.mimeType === F);
      if (q.includes(`mimeType != '${F}'`)) rows = rows.filter((f) => f.mimeType !== F);
      const start = pageToken ? Number(pageToken) : 0;
      const page = rows.slice(start, start + pageSize);
      return { data: { files: page, nextPageToken: start + pageSize < rows.length ? String(start + pageSize) : undefined } };
    }
  }
};

test('found: all images, natural order, ignores non-images/subfolders, accepts .JPG w/ odd mime', async () => {
  const r = (await resolveBatch(fake, ['BLPNANW322B'])).BLPNANW322B;
  assert.equal(r.status, 'Found');
  assert.deepEqual(r.images.map((i) => i.name.match(/\((\d+)\)/)[1]), ['1','2','3','4','5','6','7','8','10','11']);
});

test('folder missing -> Not Found with warning; loose file is NOT used', async () => {
  const r = (await resolveBatch(fake, ['NOFOLDER9'])).NOFOLDER9;
  assert.equal(r.status, 'Not Found');
  assert.match(r.message, /does not exist in Drive/);
  assert.equal(r.images.length, 0);
});

test('folder exists but empty -> Not Found (says so)', async () => {
  const r = (await resolveBatch(fake, ['BLPNANW323F'])).BLPNANW323F;
  assert.equal(r.status, 'Not Found');
  assert.match(r.message, /no images/);
});

test('age-group SKUs use ONLY the part before the dash; no-dash codes work too', async () => {
  const res = await resolveBatch(fake, ['BLPNANW322B-23', 'BLPNANW322B-910', 'BLPNANW322B']);
  for (const k of Object.keys(res)) {
    assert.equal(res[k].status, 'Found', k);
    assert.equal(res[k].matchedCode, 'BLPNANW322B');
    assert.equal(res[k].images.length, 10);
  }
});

test('age-group SKU whose style folder is missing warns with the STYLE code', async () => {
  const r = (await resolveBatch(fake, ['NOFOLDER9-45'])) ['NOFOLDER9-45'];
  assert.equal(r.status, 'Not Found');
  assert.match(r.message, /Folder "NOFOLDER9" does not exist in Drive/);
});

test('duplicate-named folders: uses the one with images', async () => {
  const r = (await resolveBatch(fake, ['DUP1'])).DUP1;
  assert.equal(r.status, 'Found');
  assert.equal(r.images[0].id, 'd2img');
});

test('apostrophes are escaped', async () => {
  const r = (await resolveBatch(fake, ["O'BRIEN1"]))["O'BRIEN1"];
  assert.equal(r.status, 'Found');
  assert.equal(escapeQ("a'b\\c"), "a\\'b\\\\c");
});

test('pagination: 450 images all returned', async () => {
  const r = (await resolveBatch(fake, ['BIG1'])).BIG1;
  assert.equal(r.images.length, 450);
  assert.equal(r.images[449].name, 'BIG1 (450).jpg');
});

test('case-insensitive exact folder name, but no partial matches', async () => {
  const res = await resolveBatch(fake, ['blpnanw322b', 'BLPNANW32']);
  assert.equal(res.blpnanw322b.status, 'Found');
  assert.equal(res.BLPNANW32.status, 'Not Found');
});

test('empty code -> Error; batch dedupes; few API calls', async () => {
  calls = 0;
  const res = await resolveBatch(fake, ['', 'BLPNANW322B', 'BLPNANW322B']);
  assert.equal(res[''].status, 'Error');
  assert.ok(calls <= 3, 'calls=' + calls);
});

test('styleCodeOf / candidatesFor', () => {
  assert.equal(styleCodeOf('BLPTSW477'), 'BLPTSW477');
  assert.equal(styleCodeOf(' BLPTSW477-23 '), 'BLPTSW477');
  assert.equal(styleCodeOf('BLPTSW477-910'), 'BLPTSW477');
  assert.equal(styleCodeOf('BLPTSW477-2-3'), 'BLPTSW477');
  assert.deepEqual(candidatesFor('BLPTSPB460-78'), ['BLPTSPB460']);
});

test('credentials: newline fix, b64, and clear errors', () => {
  process.env.GOOGLE_SERVICE_ACCOUNT_JSON = JSON.stringify({ client_email: 'a@b.iam', private_key: 'x\\ny' });
  assert.equal(loadCredentials().private_key, 'x\ny');
  const j = JSON.stringify({ client_email: 'a@b.iam', private_key: 'k' });
  delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  process.env.GOOGLE_SERVICE_ACCOUNT_B64 = Buffer.from(j).toString('base64');
  assert.equal(loadCredentials().client_email, 'a@b.iam');
  delete process.env.GOOGLE_SERVICE_ACCOUNT_B64;
  assert.throws(() => loadCredentials(), /missing/);
  process.env.GOOGLE_SERVICE_ACCOUNT_JSON = '{not json';
  assert.throws(() => loadCredentials(), /not valid JSON/);
});

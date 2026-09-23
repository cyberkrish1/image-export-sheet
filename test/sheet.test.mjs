import test from 'node:test';
import assert from 'node:assert/strict';
await import('../public/sheet-logic.js'); // attaches to globalThis, like window in the browser
const { parseSheet, buildOutput } = globalThis.SheetLogic;

const aoa = [
  ['Sku', 'Price', 'Notes'],
  ['BLPTSW477-23', 499, 'a'],
  ['BLPTSW477-34', 599],           // short row
  [],                               // blank row
  ['MISSING1', 1, 'x'],
  ['BOOM', 2, 'y'],
  ['', 5, 'no code'],
];
const results = {
  'BLPTSW477-23': { status: 'Found', images: Array.from({ length: 8 }, (_, i) => ({ id: 'a' + i })) },
  'BLPTSW477-34': { status: 'Found', images: Array.from({ length: 3 }, (_, i) => ({ id: 'b' + i })) },
  MISSING1: { status: 'Not Found', images: [], message: 'x' },
  BOOM: { status: 'Error', images: [], message: 'x' },
};

test('keeps all columns, adds Image 1..N (max=8) and Status', () => {
  const { header, rows } = parseSheet(aoa, true);
  assert.equal(rows.length, 5);                      // blank row dropped, rest kept
  const out = buildOutput(header, rows, results, 'view');
  assert.deepEqual(out.aoa[0], ['Sku','Price','Notes','Image 1','Image 2','Image 3','Image 4','Image 5','Image 6','Image 7','Image 8','Status']);
  assert.equal(out.aoa[1][1], 499);                  // original col preserved
  assert.equal(out.aoa[1][10], 'https://drive.google.com/file/d/a7/view');
  assert.equal(out.aoa[2][6], '');                   // fewer images -> blank cells
  assert.equal(out.aoa[2][11], 'Found');
  assert.equal(out.aoa[3][11], 'Not Found');
  assert.equal(out.aoa[4][11], 'Error');
  assert.equal(out.aoa[5][11], 'Error');             // empty code row kept
  assert.ok(out.aoa.every((r) => r.length === 12));
});

test('no header mode + direct links + header collision', () => {
  const p = parseSheet([['A1', 'z']], false);
  assert.deepEqual(p.header, ['Style Code', 'Column 2']);
  const p2 = parseSheet([['Sku', 'Status'], ['A1', 'old']], true);
  const o = buildOutput(p2.header, p2.rows, { A1: { status: 'Found', images: [{ id: 'q' }] } }, 'direct');
  assert.deepEqual(o.aoa[0], ['Sku', 'Status', 'Image 1', 'Status (2)']);
  assert.equal(o.aoa[1][2], 'https://drive.google.com/uc?export=view&id=q');
});

test('all-not-found gives no Image columns', () => {
  const p = parseSheet([['Sku'], ['X']], true);
  const o = buildOutput(p.header, p.rows, { X: { status: 'Not Found', images: [] } }, 'view');
  assert.deepEqual(o.aoa[0], ['Sku', 'Status']);
});

import test from 'node:test';
import assert from 'node:assert/strict';
await import('../public/sheet-logic.js'); // attaches to globalThis, like window in the browser
const { parseSheet, buildOutput, styleCodeOf } = globalThis.SheetLogic;

const aoa = [
  ['Sku', 'Price', 'Notes'],
  ['BLPTSW477-23', 499, 'a'],
  ['BLPTSW477-34', 599],           // short row
  [],                               // blank row
  ['MISSING1-45', 1, 'x'],
  ['NODASH1', 2, 'y'],              // style code without age group
  ['', 5, 'no code'],
];
const imgs = (p, n) => Array.from({ length: n }, (_, i) => ({ id: p + i }));
const results = {
  BLPTSW477: { status: 'Found', images: imgs('a', 8) },     // keyed by STYLE code
  MISSING1: { status: 'Not Found', images: [], message: 'x' },
  NODASH1: { status: 'Found', images: imgs('n', 3) },
};

test('every age group gets the same images; keeps columns; NO Status column', () => {
  const { header, rows } = parseSheet(aoa, true);
  assert.equal(rows.length, 5);
  const out = buildOutput(header, rows, results, 'view');
  assert.deepEqual(out.aoa[0], ['Sku','Price','Notes','Image 1','Image 2','Image 3','Image 4','Image 5','Image 6','Image 7','Image 8']);
  assert.ok(!out.aoa[0].includes('Status'));
  assert.deepEqual(out.aoa[1].slice(3), out.aoa[2].slice(3));      // 477-23 and 477-34 identical images
  assert.equal(out.aoa[1][10], 'https://drive.google.com/file/d/a7/view');
  assert.equal(out.aoa[1][1], 499);                                 // original column kept
  assert.equal(out.aoa[3][3], '');                                  // MISSING1-45: blank cells
  assert.equal(out.aoa[4][3], 'https://drive.google.com/file/d/n0/view'); // no-dash code works
  assert.equal(out.aoa[4][6], '');                                  // only 3 images -> rest blank
  assert.ok(out.aoa.every((r) => r.length === 11));
  assert.equal(out.perRow[2].code, 'MISSING1');
  assert.equal(out.perRow[2].res.status, 'Not Found');              // status still available for the UI
});

test('no header mode + direct links + header collision on Image 1', () => {
  const p = parseSheet([['A1-23', 'z']], false);
  assert.deepEqual(p.header, ['Style Code', 'Column 2']);
  const p2 = parseSheet([['Sku', 'Image 1'], ['A1-23', 'old']], true);
  const o = buildOutput(p2.header, p2.rows, { A1: { status: 'Found', images: [{ id: 'q' }] } }, 'direct');
  assert.deepEqual(o.aoa[0], ['Sku', 'Image 1', 'Image 1 (2)']);
  assert.equal(o.aoa[1][2], 'https://drive.google.com/uc?export=view&id=q');
});

test('all not found -> no Image columns', () => {
  const p = parseSheet([['Sku'], ['X-23']], true);
  const o = buildOutput(p.header, p.rows, { X: { status: 'Not Found', images: [] } }, 'view');
  assert.deepEqual(o.aoa[0], ['Sku']);
});

test('styleCodeOf in the browser logic matches server rule', () => {
  assert.equal(styleCodeOf('BLPTSW477-910'), 'BLPTSW477');
  assert.equal(styleCodeOf('BLPTSW477'), 'BLPTSW477');
});

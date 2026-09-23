/* Pure sheet logic (no DOM). Works in the browser and in Node tests. */
(function (root) {
  function isBlank(v) { return v === '' || v === null || v === undefined; }

  // aoa = array of rows from XLSX.utils.sheet_to_json(ws,{header:1,defval:''})
  // Keeps EVERY column of EVERY non-empty row.
  function parseSheet(aoa, hasHeader) {
    const rows = aoa.filter((r) => Array.isArray(r) && r.some((c) => !isBlank(c) && String(c).trim() !== ''));
    if (!rows.length) return { header: [], rows: [] };
    const width = Math.max(...rows.map((r) => r.length));
    const pad = (r) => Array.from({ length: width }, (_, i) => (isBlank(r[i]) ? '' : r[i]));

    let header;
    let body;
    if (hasHeader) {
      header = pad(rows[0]).map((h, i) => (String(h).trim() ? String(h) : 'Column ' + (i + 1)));
      body = rows.slice(1).map(pad);
    } else {
      header = Array.from({ length: width }, (_, i) => (i === 0 ? 'Style Code' : 'Column ' + (i + 1)));
      body = rows.map(pad);
    }
    return { header, rows: body };
  }

  const codeOf = (row) => String(isBlank(row[0]) ? '' : row[0]).trim();

// "BLPTSW477-23" -> "BLPTSW477" (age group after the first dash is ignored).
// A value with no dash is already a style code.
function styleCodeOf(raw) {
  const s = String(raw === null || raw === undefined ? '' : raw).trim();
  const i = s.indexOf('-');
  return (i > 0 ? s.slice(0, i) : s).trim();
}

  function uniqueHeaders(header) {
    const seen = new Set(header.map((h) => String(h).toLowerCase()));
    return (name) => {
      let n = name, k = 2;
      while (seen.has(n.toLowerCase())) n = name + ' (' + k++ + ')';
      seen.add(n.toLowerCase());
      return n;
    };
  }

  function linkFor(id, mode) {
    const e = encodeURIComponent(id);
    if (mode === 'direct') return 'https://drive.google.com/uc?export=view&id=' + e;
    return 'https://drive.google.com/file/d/' + e + '/view';
  }

  /**
   * Original columns + Image 1..N   (no Status column in the sheet).
   * N = the largest image count of any row (so 7, 8, 12... all work).
   * Every age-group row of a style gets that style's images.
   */
  function buildOutput(header, rows, results, linkMode) {
    const perRow = rows.map((row) => {
      const sku = codeOf(row);
      const code = styleCodeOf(sku);
      const res = results[code] || { status: 'Error', images: [], message: code ? 'No result returned.' : 'Empty style code.' };
      const links = (res.images || []).map((f) => linkFor(f.id, linkMode));
      return { row, sku, code, res, links };
    });
    const maxImages = perRow.reduce((m, r) => Math.max(m, r.links.length), 0);

    const uniq = uniqueHeaders(header);
    const imgHeaders = Array.from({ length: maxImages }, (_, i) => uniq('Image ' + (i + 1)));

    const aoa = [[...header, ...imgHeaders]];
    perRow.forEach(({ row, links }) => {
      aoa.push([...row, ...Array.from({ length: maxImages }, (_, i) => links[i] || '')]);
    });
    return { aoa, maxImages, origCols: header.length, perRow };
  }

  const api = { parseSheet, buildOutput, linkFor, codeOf, styleCodeOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SheetLogic = api;
})(typeof window !== 'undefined' ? window : globalThis);

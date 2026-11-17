// Writes a small Excel workbook (.xlsx) in the browser, with no library: each sheet
// is a title, notes, a header row and data rows, with numbers kept as numbers so
// they can be summed, sorted and filtered. The header row is frozen and filterable.

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');

// Cell styles by name, as indexes into styles.xml's cellXfs below.
const STYLE = { text: 0, head: 1, money: 2, money2: 3, pct: 4, qty: 5, title: 6, note: 7, totalText: 8, totalMoney: 9, totalPct: 10, date: 11 };
const TOTAL = { text: 'totalText', money: 'totalMoney', money2: 'totalMoney', pct: 'totalPct', qty: 'totalMoney' };

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="4"><numFmt numFmtId="164" formatCode="#,##0;[Red]-#,##0"/><numFmt numFmtId="165" formatCode="#,##0.00;[Red]-#,##0.00"/><numFmt numFmtId="166" formatCode="0.00%;[Red]-0.00%"/><numFmt numFmtId="167" formatCode="#,##0.########"/></numFmts>
<fonts count="4"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="14"/><name val="Calibri"/></font><font><i/><sz val="10"/><color rgb="FF5D6068"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE8EEF7"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="3"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top/><bottom style="thin"><color rgb="FF9AA3AF"/></bottom><diagonal/></border><border><left/><right/><top style="thin"><color rgb="FF1C1D20"/></top><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="12">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment wrapText="1" vertical="center"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="167" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="2" xfId="0" applyFont="1" applyBorder="1"/>
<xf numFmtId="164" fontId="1" fillId="0" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>
<xf numFmtId="166" fontId="1" fillId="0" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>
<xf numFmtId="14" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

const colName = i => {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + (n - 1) % 26) + s;
  return s;
};

// One cell. Numbers stay numbers; percentages come in as 12.5 and are stored as 0.125.
function cell(ref, value, style) {
  if (value == null || value === '' || (typeof value === 'number' && !Number.isFinite(value))) return style ? `<c r="${ref}" s="${STYLE[style]}"/>` : '';
  if (typeof value === 'number') {
    // Amounts to the paisa or cent, percentages to a hundredth of a percent; quantities as they are.
    const v = style === 'pct' || style === 'totalPct' ? Math.round(value * 100) / 10000
      : style === 'money' || style === 'money2' || style === 'totalMoney' ? Math.round(value * 100) / 100 : value;
    return `<c r="${ref}" s="${STYLE[style] ?? 0}"><v>${v}</v></c>`;
  }
  return `<c r="${ref}" s="${STYLE[style] ?? 0}" t="inlineStr"><is><t xml:space="preserve">${esc(value)}</t></is></c>`;
}

// A sheet: { name, title, notes: [], columns: [{ header, type, width }], rows: [[]], total: [] }.
function sheetXml(sheet) {
  const lines = [];
  let r = 0;
  const put = cells => { r++; lines.push(`<row r="${r}">${cells.map(([v, s], i) => cell(`${colName(i)}${r}`, v, s)).join('')}</row>`); };
  if (sheet.title) put([[sheet.title, 'title']]);
  for (const note of sheet.notes ?? []) put([[note, 'note']]);
  if (sheet.title || sheet.notes?.length) r++;
  const head = r + 1;
  put(sheet.columns.map(c => [c.header, 'head']));
  for (const row of sheet.rows) put(row.map((v, i) => [v, sheet.columns[i]?.type ?? 'text']));
  const last = r;
  if (sheet.total) put(sheet.total.map((v, i) => [v, TOTAL[sheet.columns[i]?.type ?? 'text'] ?? 'totalText']));
  const end = `${colName(sheet.columns.length - 1)}${Math.max(head, last)}`;
  const cols = sheet.columns.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width ?? (c.type === 'text' ? 18 : 14)}" customWidth="1"/>`).join('');
  return {
    filter: `$A$${head}:$${end.replace(/(\d+)$/, '$$$1')}`,
    xml: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetViews><sheetView workbookViewId="0"><pane ySplit="${head}" topLeftCell="A${head + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>
<cols>${cols}</cols>
<sheetData>${lines.join('')}</sheetData>
<autoFilter ref="A${head}:${end}"/>
</worksheet>`,
  };
}

// Sheet names: at most 31 characters, none of []:*?/\, and each different.
function sheetNames(list) {
  const used = new Set();
  return list.map(s => {
    const base = String(s.name).replace(/[[\]:*?/\\]/g, ' ').trim().slice(0, 31) || 'Sheet';
    let name = base, n = 2;
    while (used.has(name.toLowerCase())) name = `${base.slice(0, 27)} (${n++})`;
    used.add(name.toLowerCase());
    return name;
  });
}

export function workbookBlob(sheets) {
  const names = sheetNames(sheets);
  const built = sheets.map(sheetXml);
  const files = [
    ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${built.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`],
    ['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets><definedNames>${built.map((b, i) => `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${esc(names[i].replace(/'/g, "''"))}'!${b.filter}</definedName>`).join('')}</definedNames></workbook>`],
    ['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${built.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${built.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ['xl/styles.xml', STYLES],
    ...built.map((b, i) => [`xl/worksheets/sheet${i + 1}.xml`, b.xml]),
  ];
  return new Blob([zip(files)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

/* ---------- a stored (uncompressed) zip ---------- */

let table;
function crc32(bytes) {
  table ??= Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  let crc = 0xffffffff;
  for (const b of bytes) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function zip(files) {
  const enc = new TextEncoder();
  const chunks = [], central = [];
  let offset = 0;
  const le = (...fields) => {
    const out = new Uint8Array(fields.reduce((n, [, size]) => n + size, 0));
    const view = new DataView(out.buffer);
    let at = 0;
    for (const [v, size] of fields) { if (size === 2) view.setUint16(at, v, true); else view.setUint32(at, v, true); at += size; }
    return out;
  };
  for (const [path, text] of files) {
    const name = enc.encode(path), data = enc.encode(text), crc = crc32(data);
    const common = [[20, 2], [0x800, 2], [0, 2], [0, 2], [33, 2], [crc, 4], [data.length, 4], [data.length, 4], [name.length, 2], [0, 2]];
    const head = le([0x04034b50, 4], ...common);
    chunks.push(head, name, data);
    central.push(le([0x02014b50, 4], [20, 2], ...common, [0, 2], [0, 2], [0, 2], [0, 4], [offset, 4]), name);
    offset += head.length + name.length + data.length;
  }
  const size = central.reduce((n, b) => n + b.length, 0);
  const endRecord = le([0x06054b50, 4], [0, 2], [0, 2], [files.length, 2], [files.length, 2], [size, 4], [offset, 4], [0, 2]);
  const all = [...chunks, ...central, endRecord];
  const out = new Uint8Array(all.reduce((n, b) => n + b.length, 0));
  let at = 0;
  for (const b of all) { out.set(b, at); at += b.length; }
  return out;
}

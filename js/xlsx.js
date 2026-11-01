// Reads spreadsheets in the browser. An .xlsx file is a zip of XML, which the
// platform can unpack by itself, so this needs no library.

async function inflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function unzip(buffer) {
  const view = new DataView(buffer);
  let end = buffer.byteLength - 22;
  while (end >= 0 && view.getUint32(end, true) !== 0x06054b50) end--;
  if (end < 0) throw new Error('This is not a valid .xlsx file.');
  const count = view.getUint16(end + 10, true);
  let p = view.getUint32(end + 16, true);
  const decoder = new TextDecoder();
  const files = {};
  for (let i = 0; i < count; i++) {
    const method = view.getUint16(p + 10, true);
    const size = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const offset = view.getUint32(p + 42, true);
    const name = decoder.decode(new Uint8Array(buffer, p + 46, nameLen));
    const start = offset + 30 + view.getUint16(offset + 26, true) + view.getUint16(offset + 28, true);
    const raw = new Uint8Array(buffer, start, size);
    files[name] = decoder.decode(method ? await inflate(raw) : raw);
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

const xml = text => new DOMParser().parseFromString(text, 'application/xml');
const columnIndex = ref => [...ref.replace(/\d+$/, '')].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

function sheetRows(doc, strings) {
  return [...doc.getElementsByTagName('row')].map(row => {
    const out = [];
    for (const c of row.getElementsByTagName('c')) {
      const type = c.getAttribute('t');
      const v = c.getElementsByTagName('v')[0]?.textContent;
      const value = type === 'inlineStr' ? c.textContent
        : v === undefined ? ''
        : type === 's' ? strings[Number(v)]
        : type === 'str' || type === 'b' || type === 'e' ? v
        : Number(v);
      out[columnIndex(c.getAttribute('r'))] = value;
    }
    return Array.from(out, x => x ?? '');
  });
}

// Every sheet of a workbook, as { name: rows }.
export async function readWorkbook(file) {
  const files = await unzip(await file.arrayBuffer());
  const book = files['xl/workbook.xml'];
  if (!book) throw new Error('This is not a valid .xlsx file.');
  const strings = files['xl/sharedStrings.xml']
    ? [...xml(files['xl/sharedStrings.xml']).getElementsByTagName('si')].map(si => si.textContent)
    : [];
  const rels = Object.fromEntries([...xml(files['xl/_rels/workbook.xml.rels']).getElementsByTagName('Relationship')]
    .map(r => [r.getAttribute('Id'), r.getAttribute('Target')]));
  const sheets = {};
  for (const s of xml(book).getElementsByTagName('sheet')) {
    const target = rels[s.getAttribute('r:id')].replace(/^\/?(xl\/)?/, '');
    sheets[s.getAttribute('name')] = sheetRows(xml(files[`xl/${target}`]), strings);
  }
  return sheets;
}

/* ---------- old .xls files ---------- */

// An .xls file holds a workbook stream inside a small file system, in sectors
// that are chained together by a table.
function workbookStream(buffer) {
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== 0xe011cfd0) throw new Error('This is not a valid .xls file.');
  const sector = 1 << view.getUint16(30, true);
  const at = n => (n + 1) * sector;
  const END = 0xfffffffe;
  const tableSectors = [];
  for (let i = 0; i < 109; i++) {
    const n = view.getUint32(76 + i * 4, true);
    if (n < 0xfffffffc) tableSectors.push(n);
  }
  for (let n = view.getUint32(68, true), left = view.getUint32(72, true); left-- > 0 && n < 0xfffffffc;) {
    const perSector = sector / 4 - 1;
    for (let i = 0; i < perSector; i++) {
      const s = view.getUint32(at(n) + i * 4, true);
      if (s < 0xfffffffc) tableSectors.push(s);
    }
    n = view.getUint32(at(n) + perSector * 4, true);
  }
  const next = n => view.getUint32(at(tableSectors[Math.floor(n / (sector / 4))]) + (n % (sector / 4)) * 4, true);
  const chain = start => {
    const out = [];
    for (let n = start; n !== END && out.length < 1e6; n = next(n)) out.push(n);
    return out;
  };
  const decoder = new TextDecoder('utf-16le');
  for (const dirSector of chain(view.getUint32(48, true))) {
    for (let e = at(dirSector), last = e + sector; e < last; e += 128) {
      const nameLen = view.getUint16(e + 64, true);
      if (nameLen < 2) continue;
      const name = decoder.decode(new Uint8Array(buffer, e, nameLen - 2));
      if (name !== 'Workbook' && name !== 'Book') continue;
      const size = view.getUint32(e + 120, true);
      if (size < view.getUint32(56, true)) throw new Error('This .xls file is too small to read.');
      const data = new Uint8Array(size);
      let filled = 0;
      for (const s of chain(view.getUint32(e + 116, true))) {
        const part = new Uint8Array(buffer, at(s), Math.min(sector, size - filled));
        data.set(part, filled);
        filled += part.length;
        if (filled >= size) break;
      }
      return data;
    }
  }
  throw new Error('This .xls file has no workbook in it.');
}

// Numbers can be stored compactly as a scaled 30-bit integer or the top of a double.
function rkNumber(view, at) {
  const raw = view.getInt32(at, true);
  let value;
  if (raw & 2) value = raw >> 2;
  else {
    const scratch = new DataView(new ArrayBuffer(8));
    scratch.setInt32(4, raw & ~3, true);
    value = scratch.getFloat64(0, true);
  }
  return raw & 1 ? value / 100 : value;
}

const latin = new TextDecoder('windows-1252');
const utf16 = new TextDecoder('utf-16le');

// The shared strings run over CONTINUE records, and each record restarts its
// characters with a fresh flag byte saying how wide they are.
function sharedStrings(parts) {
  const out = [];
  let part = 0, pos = 8;
  const count = new DataView(parts[0].buffer, parts[0].byteOffset).getUint32(4, true);
  const need = n => { if (pos + n > parts[part].length) { part++; pos = 0; } };
  const u16 = () => { need(2); const v = parts[part][pos] | (parts[part][pos + 1] << 8); pos += 2; return v; };
  const u32 = () => { const lo = u16(); return lo + u16() * 65536; };
  const skip = n => {
    let left = n;
    while (left > 0) {
      const take = Math.min(left, parts[part].length - pos);
      pos += take;
      left -= take;
      if (left > 0) { part++; pos = 0; }
    }
  };
  for (let i = 0; i < count && part < parts.length; i++) {
    const length = u16();
    need(1);
    let flags = parts[part][pos++];
    const rich = flags & 8 ? u16() : 0;
    const extra = flags & 4 ? u32() : 0;
    let text = '', left = length;
    while (left > 0) {
      if (pos >= parts[part].length) { part++; pos = 0; flags = parts[part][pos++]; }
      const wide = flags & 1;
      const room = Math.floor((parts[part].length - pos) / (wide ? 2 : 1));
      const take = Math.min(left, room);
      const bytes = parts[part].subarray(pos, pos + take * (wide ? 2 : 1));
      text += (wide ? utf16 : latin).decode(bytes);
      pos += bytes.length;
      left -= take;
    }
    skip(rich * 4 + extra);
    out.push(text);
  }
  return out;
}

// Every sheet of an old workbook, as { name: rows }.
export function readLegacyWorkbook(buffer) {
  const data = workbookStream(buffer);
  const view = new DataView(data.buffer);
  const names = [], sst = [], sheets = {};
  let strings = [], rows = null, inSst = false, sheet = -1;
  const put = (r, c, v) => { (rows[r] ??= [])[c] = v; };
  for (let p = 0; p + 4 <= data.length;) {
    const id = view.getUint16(p, true), len = view.getUint16(p + 2, true), body = p + 4;
    p = body + len;
    if (id === 0x3c && inSst) { sst.push(data.subarray(body, body + len)); continue; }
    inSst = false;
    if (id === 0x85) {
      const length = data[body + 6], wide = data[body + 7] & 1;
      names.push((wide ? utf16 : latin).decode(data.subarray(body + 8, body + 8 + length * (wide ? 2 : 1))));
    } else if (id === 0xfc) { sst.push(data.subarray(body, body + len)); inSst = true; }
    else if (id === 0x809) {
      if (sheet >= 0 || sst.length) strings = strings.length ? strings : sharedStrings(sst);
      sheet++;
      rows = [];
    } else if (id === 0x0a && sheet > 0) {
      sheets[names[sheet - 1] ?? `Sheet${sheet}`] = Array.from(rows, r => Array.from(r ?? [], c => c ?? ''));
    } else if (rows && sheet > 0) {
      const r = view.getUint16(body, true), c = view.getUint16(body + 2, true);
      if (id === 0xfd) put(r, c, strings[view.getUint32(body + 6, true)]);
      else if (id === 0x203) put(r, c, view.getFloat64(body + 6, true));
      else if (id === 0x27e) put(r, c, rkNumber(view, body + 6));
      else if (id === 0xbd) {
        for (let i = 0, at = body + 4; at + 6 <= body + len - 2; i++, at += 6) put(r, c + i, rkNumber(view, at + 2));
      } else if (id === 0x204) {
        const length = view.getUint16(body + 6, true), wide = data[body + 8] & 1;
        put(r, c, (wide ? utf16 : latin).decode(data.subarray(body + 9, body + 9 + length * (wide ? 2 : 1))));
      }
    }
  }
  return sheets;
}

export function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch !== '"') cell += ch;
      else if (text[i + 1] === '"') { cell += '"'; i++; }
      else quoted = false;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (ch !== '\r') cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

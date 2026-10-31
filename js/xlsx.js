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

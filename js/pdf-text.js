// Reads the text of a simple PDF, such as an EPF passbook, with no library: it
// inflates each page's content, decodes fonts through their ToUnicode maps, and
// returns the text as lines, top to bottom. Scanned or encrypted PDFs have no
// text to read, and give back nothing.

const latin1 = bytes => {
  let out = '';
  for (let i = 0; i < bytes.length; i += 8192) out += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return out;
};

async function inflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// Every numbered object, with its dictionary and its stream bytes if it has one.
function readObjects(bytes, text) {
  const objects = new Map();
  const head = /(\d+)\s+0\s+obj\b/g;
  let m;
  while ((m = head.exec(text))) {
    const start = m.index + m[0].length;
    const end = text.indexOf('endobj', start);
    if (end < 0) break;
    const body = text.slice(start, end);
    const at = body.search(/\bstream\r?\n/);
    const obj = { dict: at < 0 ? body : body.slice(0, at) };
    if (at >= 0) {
      // The browser's inflater rejects stray bytes after the data, so this uses
      // the stated length, or trims the line break before endstream.
      const from = start + at + body.slice(at).indexOf('\n') + 1;
      const length = obj.dict.match(/\/Length\s+(\d+)\b(?!\s+\d+\s+R)/);
      let to = text.lastIndexOf('endstream', end);
      while (to > from && (text[to - 1] === '\n' || text[to - 1] === '\r')) to--;
      obj.raw = bytes.subarray(from, length ? Math.min(from + Number(length[1]), to) : to);
    }
    objects.set(Number(m[1]), obj);
    head.lastIndex = end;
  }
  return objects;
}

const refOf = (dict, key) => {
  const m = dict.match(new RegExp(`/${key}\\s+(\\d+)\\s+0\\s+R`));
  return m ? Number(m[1]) : null;
};

async function streamText(obj) {
  if (!obj?.raw) return '';
  const data = /\/FlateDecode/.test(obj.dict) ? await inflate(obj.raw).catch(() => new Uint8Array()) : obj.raw;
  return latin1(data);
}

// A ToUnicode map as code to text, with how many bytes each code takes.
function readCMap(source) {
  const map = new Map();
  const hex = h => h.replace(/\s/g, '');
  const toText = h => {
    const clean = hex(h);
    let out = '';
    for (let i = 0; i < clean.length; i += 4) out += String.fromCharCode(parseInt(clean.slice(i, i + 4), 16));
    return out;
  };
  for (const block of source.match(/beginbfchar[\s\S]*?endbfchar/g) ?? []) {
    for (const [, from, to] of block.matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) map.set(parseInt(from, 16), toText(to));
  }
  for (const block of source.match(/beginbfrange[\s\S]*?endbfrange/g) ?? []) {
    for (const [, a, b, rest] of block.matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(\[[^\]]*\]|<[0-9a-fA-F]+>)/g)) {
      const low = parseInt(a, 16), high = parseInt(b, 16);
      if (rest.startsWith('[')) {
        [...rest.matchAll(/<([0-9a-fA-F]+)>/g)].forEach(([, t], i) => map.set(low + i, toText(t)));
      } else {
        const base = toText(rest.slice(1, -1));
        for (let c = low; c <= high; c++) map.set(c, base.slice(0, -1) + String.fromCharCode(base.charCodeAt(base.length - 1) + c - low));
      }
    }
  }
  const range = source.match(/begincodespacerange\s*<([0-9a-fA-F]+)>/);
  return { map, width: range ? range[1].length / 2 : 2 };
}

// The page's fonts by resource name, each with a decoder for its strings.
async function fontsOf(objects, resources) {
  const fonts = new Map();
  let fontDict = resources.match(/\/Font\s*<<([\s\S]*?)>>/)?.[1];
  if (!fontDict) {
    const ref = refOf(resources, 'Font');
    if (ref != null) fontDict = objects.get(ref)?.dict ?? '';
  }
  for (const [, name, ref] of (fontDict ?? '').matchAll(/\/([\w.+-]+)\s+(\d+)\s+0\s+R/g)) {
    const font = objects.get(Number(ref));
    if (!font) continue;
    const cmapRef = refOf(font.dict, 'ToUnicode');
    const cmap = cmapRef != null ? readCMap(await streamText(objects.get(cmapRef))) : null;
    const wide = /Identity-H|Type0/.test(font.dict);
    fonts.set(name, codes => {
      if (!cmap) return wide ? '' : codes;
      let out = '';
      for (let i = 0; i < codes.length; i += cmap.width) {
        let code = 0;
        for (let k = 0; k < cmap.width; k++) code = code * 256 + (codes.charCodeAt(i + k) || 0);
        out += cmap.map.get(code) ?? '';
      }
      return out;
    });
  }
  return fonts;
}

// Splits content into operands and operators, keeping strings and arrays whole.
function* tokens(src) {
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '%') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '(') {
      let depth = 1, out = '';
      i++;
      while (i < src.length && depth) {
        const ch = src[i];
        if (ch === '\\') {
          const next = src[i + 1];
          const esc = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' }[next];
          if (esc) { out += esc; i += 2; continue; }
          if (/[0-7]/.test(next)) { const oct = src.slice(i + 1, i + 4).match(/^[0-7]{1,3}/)[0]; out += String.fromCharCode(parseInt(oct, 8)); i += 1 + oct.length; continue; }
          out += next; i += 2; continue;
        }
        if (ch === '(') depth++;
        if (ch === ')' && !--depth) { i++; break; }
        out += ch;
        i++;
      }
      yield { str: out };
      continue;
    }
    if (c === '<' && src[i + 1] !== '<') {
      const end = src.indexOf('>', i);
      const h = src.slice(i + 1, end).replace(/\s/g, '');
      let out = '';
      for (let k = 0; k < h.length; k += 2) out += String.fromCharCode(parseInt((h.slice(k, k + 2) + '0').slice(0, 2), 16));
      yield { str: out };
      i = end + 1;
      continue;
    }
    if (c === '[') { yield { open: true }; i++; continue; }
    if (c === ']') { yield { close: true }; i++; continue; }
    if (c === '<' || c === '>') { i += 2; yield { op: c === '<' ? '<<' : '>>' }; continue; }
    const m = src.slice(i).match(/^[^\s()<>[\]/%]+|^\/[^\s()<>[\]/%]*/);
    const word = m ? m[0] : c;
    i += word.length || 1;
    if (word.startsWith('/')) yield { name: word.slice(1) };
    else if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(word)) yield { num: Number(word) };
    else yield { op: word };
  }
}

// Walks one content stream, placing each piece of text where it's drawn on the
// page. Some PDFs move blocks with the graphics matrix and draw letter by letter,
// so positions go through it, and each piece notes roughly how wide it is.
function runs(src, fonts) {
  const out = [];
  const stack = [];
  const saved = [];
  let ctm = [1, 0, 0, 1, 0, 0];
  let font = null, size = 12, x = 0, y = 0, lineX = 0, lineY = 0, leading = 0, array = null;
  let tm = [1, 0, 0, 1];
  const show = value => {
    if (!font) return;
    const text = font(value);
    if (!text) return;
    const px = ctm[4] + x * ctm[0] + y * ctm[2];
    const py = ctm[5] + x * ctm[1] + y * ctm[3];
    const scale = Math.abs(ctm[0] * tm[0]) || 1;
    out.push({ x: px, y: Math.round(py), text, size: size * scale, w: text.length * size * scale * 0.5 });
  };
  for (const t of tokens(src)) {
    if (t.open) { array = []; continue; }
    if (t.close) { stack.push({ array }); array = null; continue; }
    if (array) { if (t.str != null) array.push(t.str); else if (t.num != null && t.num < -200) array.push(' '); continue; }
    if (!t.op) { stack.push(t); continue; }
    const nums = stack.filter(s => s.num != null).map(s => s.num);
    switch (t.op) {
      case 'q': saved.push(ctm); break;
      case 'Q': ctm = saved.pop() ?? ctm; break;
      case 'cm': {
        const [a, b, c, d, e, f] = nums;
        ctm = [a * ctm[0] + b * ctm[2], a * ctm[1] + b * ctm[3], c * ctm[0] + d * ctm[2], c * ctm[1] + d * ctm[3], e * ctm[0] + f * ctm[2] + ctm[4], e * ctm[1] + f * ctm[3] + ctm[5]];
        break;
      }
      case 'BT': x = lineX = 0; y = lineY = 0; tm = [1, 0, 0, 1]; break;
      case 'Tf': font = fonts.get(stack.find(s => s.name)?.name) ?? null; size = nums.at(-1) ?? size; break;
      case 'Tm': tm = nums.slice(0, 4); x = lineX = nums[4]; y = lineY = nums[5]; break;
      case 'Td': case 'TD': x = lineX += nums[0]; y = lineY += nums[1]; if (t.op === 'TD') leading = -nums[1]; break;
      case 'TL': leading = nums[0]; break;
      case 'T*': x = lineX; y = lineY -= leading; break;
      case 'Tj': case "'": case '"': if (t.op !== 'Tj') { x = lineX; y = lineY -= leading; } show(stack.filter(s => s.str != null).at(-1)?.str ?? ''); break;
      case 'TJ': show((stack.find(s => s.array)?.array ?? []).map(p => (p === ' ' ? null : p)).reduce((s, p) => s + (p ?? ''), '')); break;
      default: break;
    }
    stack.length = 0;
  }
  return out;
}

// The text of every page, as lines of words in reading order.
export async function pdfLines(buffer) {
  const bytes = new Uint8Array(buffer);
  const text = latin1(bytes);
  const objects = readObjects(bytes, text);
  const lines = [];
  for (const page of [...objects.values()].filter(o => /\/Type\s*\/Page\b/.test(o.dict))) {
    const resRef = refOf(page.dict, 'Resources');
    const resources = resRef != null ? objects.get(resRef)?.dict ?? '' : page.dict.match(/\/Resources\s*<<([\s\S]*)>>/)?.[1] ?? '';
    const fonts = await fontsOf(objects, resources);
    const list = page.dict.match(/\/Contents\s*\[([^\]]*)\]/)?.[1] ?? page.dict.match(/\/Contents\s+(\d+\s+0\s+R)/)?.[1] ?? '';
    let src = '';
    for (const [, ref] of list.matchAll(/(\d+)\s+0\s+R/g)) src += `${await streamText(objects.get(Number(ref)))}\n`;
    const placed = runs(src, fonts);
    const rows = new Map();
    for (const r of placed) {
      const key = [...rows.keys()].find(k => Math.abs(k - r.y) <= 2) ?? r.y;
      rows.set(key, [...(rows.get(key) ?? []), r]);
    }
    // Letters drawn one at a time join into words when close together. Anything
    // drawn as a longer piece keeps a space around it.
    for (const y of [...rows.keys()].sort((a, b) => b - a)) {
      let line = '', end = -Infinity, single = false;
      for (const r of rows.get(y).sort((a, b) => a.x - b.x)) {
        const glued = single && r.text.length === 1 && r.x - end <= r.size * 0.3;
        line += (line && !glued ? ' ' : '') + r.text;
        end = r.x + r.w;
        single = r.text.length === 1;
      }
      if (line.trim()) lines.push(line.replace(/\s+/g, ' ').trim());
    }
  }
  return lines;
}

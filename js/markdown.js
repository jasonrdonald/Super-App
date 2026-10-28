// Small, dependency-free Markdown renderer. All text is HTML-escaped before
// any markup is added, so note content can never inject HTML or scripts.

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = s => s.replace(/[&<>"']/g, c => ESC[c]);

const FENCE = /^\s*(`{3,}|~{3,})\s*([^\s`]*)/;
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const HR = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const QUOTE = /^ {0,3}>/;
const LIST = /^( *)([-*+]|\d{1,9}[.)])(?:[ \t]+(.*)|$)/;
const TASK_SRC = /^(\s*(?:>\s?)*\s*(?:[-*+]|\d{1,9}[.)])\s+\[)([ xX])(\](?:\s.*)?)$/;

const fenceClose = open => new RegExp(`^\\s*\\${open[0]}{${open.length},}\\s*$`);

export function renderMarkdown(md, { readonly = false } = {}) {
  const lines = md
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0002]/g, '')
    .split('\n')
    .map(l => l.replace(/^\t+/, t => '    '.repeat(t.length)));
  return blocks(lines, { task: 0, readonly });
}

// Flip the checkbox of the n-th task item (document order) in the source.
export function toggleTask(md, index) {
  const lines = md.split('\n');
  let k = 0, close = null;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (close) { if (close.test(l)) close = null; continue; }
    const f = l.match(FENCE);
    if (f) { close = fenceClose(f[1]); continue; }
    const m = l.match(TASK_SRC);
    if (m && k++ === index) {
      lines[i] = m[1] + (m[2] === ' ' ? 'x' : ' ') + m[3];
      break;
    }
  }
  return lines.join('\n');
}

function blocks(lines, ctx) {
  let out = '';
  for (let i = 0; i < lines.length;) {
    const line = lines[i];
    let m;
    if (!line.trim()) { i++; continue; }

    if ((m = line.match(FENCE))) {
      const close = fenceClose(m[1]);
      const buf = [];
      for (i++; i < lines.length && !close.test(lines[i]); i++) buf.push(lines[i]);
      i++;
      out += `<pre><code${m[2] ? ` data-lang="${esc(m[2])}"` : ''}>${esc(buf.join('\n'))}</code></pre>`;
      continue;
    }
    if ((m = line.match(HEADING))) {
      const n = m[1].length;
      out += `<h${n}>${inline(m[2] || '')}</h${n}>`;
      i++;
      continue;
    }
    if (HR.test(line)) { out += '<hr>'; i++; continue; }
    if (QUOTE.test(line)) {
      const buf = [];
      while (i < lines.length && QUOTE.test(lines[i])) buf.push(lines[i++].replace(/^ {0,3}> ?/, ''));
      out += `<blockquote>${blocks(buf, ctx)}</blockquote>`;
      continue;
    }
    if (LIST.test(line)) {
      const r = list(lines, i, ctx);
      out += r.html;
      i = r.next;
      continue;
    }
    if (isTableStart(lines, i)) {
      const r = table(lines, i);
      out += r.html;
      i = r.next;
      continue;
    }
    const buf = [line];
    for (i++; i < lines.length && lines[i].trim() && !startsBlock(lines, i); i++) buf.push(lines[i]);
    out += `<p>${buf.map(l => inline(l.trim())).join('<br>')}</p>`;
  }
  return out;
}

function startsBlock(lines, i) {
  const l = lines[i];
  return FENCE.test(l) || HEADING.test(l) || HR.test(l) || QUOTE.test(l) || LIST.test(l) || isTableStart(lines, i);
}

function list(lines, i, ctx) {
  const first = lines[i].match(LIST);
  const base = first[1].length;
  const ordered = /\d/.test(first[2]);
  const items = [];
  let cur = null, blank = false;

  for (; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) { blank = true; cur.lines.push(''); continue; }
    const indent = line.match(/^ */)[0].length;
    const m = !HR.test(line) && line.match(LIST);
    if (m && indent <= base + 1) {
      if (/\d/.test(m[2]) !== ordered) break;
      cur = { lines: [m[3] || ''], indent: m[1].length + m[2].length + 1 };
      items.push(cur);
      blank = false;
      continue;
    }
    if (indent > base) { cur.lines.push(line.slice(Math.min(indent, cur.indent))); blank = false; continue; }
    if (!blank && !startsBlock(lines, i)) { cur.lines.push(line.trim()); continue; }
    break;
  }

  const tag = ordered ? 'ol' : 'ul';
  const start = ordered ? parseInt(first[2], 10) : 1;
  const html = `<${tag}${start !== 1 ? ` start="${start}"` : ''}>${items.map(it => listItem(it, ctx)).join('')}</${tag}>`;
  return { html, next: i };
}

function listItem(item, ctx) {
  while (item.lines.length > 1 && !item.lines[item.lines.length - 1].trim()) item.lines.pop();
  let [first, ...rest] = item.lines;
  let box = '', cls = '';
  const t = first.match(/^\[([ xX])\](?:\s+(.*)|$)/);
  if (t) {
    const checked = t[1] !== ' ';
    box = `<input type="checkbox" data-task="${ctx.task++}"${checked ? ' checked' : ''}${ctx.readonly ? ' disabled' : ''}>`;
    cls = ` class="task${checked ? ' done' : ''}"`;
    first = t[2] || '';
  }
  return `<li${cls}>${box}${inline(first)}${rest.length ? blocks(rest, ctx) : ''}</li>`;
}

const isTableStart = (lines, i) =>
  lines[i].includes('|') && i + 1 < lines.length &&
  lines[i + 1].includes('|') && lines[i + 1].includes('-') && /^[\s|:-]+$/.test(lines[i + 1]);

function cells(line) {
  let s = line.trim().replace(/\\\|/g, '\u0002');
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').map(c => c.trim().replace(/\u0002/g, '|'));
}

function table(lines, i) {
  const head = cells(lines[i]);
  const aligns = cells(lines[i + 1]).map(c =>
    c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : c.startsWith(':') ? 'left' : '');
  const al = k => (aligns[k] ? ` style="text-align:${aligns[k]}"` : '');
  let html = `<div class="table-wrap"><table><thead><tr>${head.map((c, k) => `<th${al(k)}>${inline(c)}</th>`).join('')}</tr></thead><tbody>`;
  for (i += 2; i < lines.length && lines[i].trim() && lines[i].includes('|'); i++) {
    const row = cells(lines[i]);
    html += `<tr>${head.map((_, k) => `<td${al(k)}>${inline(row[k] || '')}</td>`).join('')}</tr>`;
  }
  return { html: html + '</tbody></table></div>', next: i };
}

function safeUrl(url) {
  const raw = url.replace(/&amp;/g, '&').replace(/[\u0000- ]/g, '');
  const scheme = raw.match(/^([a-z][a-z0-9+.-]*):/i);
  return scheme && !/^(https?|mailto|tel)$/i.test(scheme[1]) ? '#' : url;
}

const emphasis = s => s
  .replace(/\*\*(?=\S)(.*?\S)\*\*/g, '<strong>$1</strong>')
  .replace(/(^|[^\w])__(?=\S)(.*?\S)__(?!\w)/g, '$1<strong>$2</strong>')
  .replace(/\*(?=\S)(.*?\S)\*/g, '<em>$1</em>')
  .replace(/(^|[^\w])_(?=\S)(.*?\S)_(?!\w)/g, '$1<em>$2</em>')
  .replace(/~~(?=\S)(.*?\S)~~/g, '<del>$1</del>')
  .replace(/==(?=\S)(.*?\S)==/g, '<mark>$1</mark>');

function inline(text) {
  const stash = [];
  const keep = html => `\u0001${stash.push(html) - 1}\u0001`;
  const link = (href, label) => keep(`<a href="${safeUrl(href)}" target="_blank" rel="noopener noreferrer">${label}</a>`);

  let s = esc(text);
  s = s.replace(/(`+)(.+?)\1/g, (_, __, c) => keep(`<code>${c.trim() || c}</code>`));
  s = s.replace(/\\([\\`*_{}[\]()#+\-.!~|=])/g, (_, c) => keep(c));
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;[^]*?&quot;)?\)/g,
    (_, alt, url) => keep(`<img src="${safeUrl(url)}" alt="${alt}" loading="lazy">`));
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+&quot;[^]*?&quot;)?\)/g, (_, t, url) => link(url, emphasis(t)));
  s = s.replace(/(^|[\s(])((?:https?:\/\/|www\.)[^\s<\u0001]*[^\s<\u0001.,;:!?)\]'*_~])/gi,
    (_, pre, url) => pre + link(/^www\./i.test(url) ? 'https://' + url : url, url));
  s = emphasis(s);
  for (let k = 0; k < 5 && s.includes('\u0001'); k++) s = s.replace(/\u0001(\d+)\u0001/g, (_, n) => stash[n]);
  return s;
}

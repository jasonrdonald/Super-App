// Portfolio reports for saving as PDF: a print-ready page, laid out for A4, printed
// from a hidden frame so the browser's Save as PDF makes the file. Everything stays
// on the device. The summary covers totals, asset types and each broker's asset
// types; the detailed report adds every broker's holdings.

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const CSS = `
  @page { size: A4; margin: 14mm 12mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 10pt/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #1c1d20; background: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  h1 { margin: 0; font-size: 18pt; }
  h2 { margin: 18px 0 6px; font-size: 12.5pt; break-after: avoid; }
  h3 { margin: 12px 0 4px; font-size: 10.5pt; color: #45474d; break-after: avoid; }
  .head { display: flex; justify-content: space-between; align-items: flex-end; gap: 12px; padding-bottom: 8px; border-bottom: 2px solid #1c1d20; }
  .head p { margin: 2px 0 0; color: #5d6068; font-size: 9pt; }
  .cards { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin: 12px 0 4px; }
  .card { padding: 7px 9px; border: 1px solid #d9dbe0; border-radius: 6px; break-inside: avoid; }
  .card b { display: block; font-size: 12pt; font-variant-numeric: tabular-nums; }
  .card span { color: #5d6068; font-size: 8pt; }
  table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
  th, td { padding: 4px 6px; border-bottom: 1px solid #e6e7eb; text-align: left; vertical-align: top; }
  thead th { font-size: 8pt; color: #5d6068; font-weight: 600; border-bottom: 1px solid #b9bcc4; }
  thead { display: table-header-group; }
  tr { break-inside: avoid; }
  .num { text-align: right; white-space: nowrap; }
  tfoot th, tfoot td { font-weight: 700; border-top: 1px solid #b9bcc4; border-bottom: 0; }
  .up { color: #17803d; } .down { color: #c2262f; }
  .share { display: inline-block; height: 7px; margin-right: 6px; border-radius: 2px; background: #2a78d6; vertical-align: 0; }
  .muted { color: #5d6068; }
  small { display: block; color: #5d6068; font-size: 7.5pt; font-weight: 400; }
  .broker { break-before: page; }
  .broker:first-of-type { break-before: auto; }
  .note { margin-top: 14px; color: #5d6068; font-size: 8pt; }
  .group-row th { background: #f1f2f4; font-size: 8.5pt; }
  .holdings { font-size: 8pt; }
  .holdings th, .holdings td { padding: 3px 4px; }
  .holdings small { font-size: 7pt; }
  .holdings td:first-child { max-width: 150px; overflow-wrap: anywhere; }
`;

// Builds the report page from plain figures. `data` holds the title, totals, asset
// types, brokers (with their asset types and, when detailed, holdings) and notes.
export function reportHtml(data, { detailed }) {
  const inr = new Intl.NumberFormat(data.locale, { style: 'currency', currency: data.currency, maximumFractionDigits: 0 });
  const fmt = (v, currency = data.currency, digits = 0) => (v == null ? '–' : new Intl.NumberFormat(currency === 'USD' ? 'en-US' : data.locale, { style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(v));
  const signed = (v, currency, digits) => (v == null ? '–' : `${v > 0 ? '+' : ''}${fmt(v, currency, digits)}`);
  const pct = v => (v == null ? '–' : `${v > 0 ? '+' : ''}${v.toFixed(2)}%`);
  const tone = v => (v == null || Math.abs(v) < 0.005 ? '' : v > 0 ? 'up' : 'down');
  const qty = v => new Intl.NumberFormat(data.locale, { maximumFractionDigits: Math.abs(v) < 1 ? 8 : 3 }).format(v);
  const shareBar = v => `<span class="share" style="width:${Math.max(1, Math.min(60, v * 0.6))}px"></span>${v.toFixed(1)}%`;
  const t = data.total;

  // One row of asset-type figures: holdings, invested, value, share, gain and XIRR.
  const typeRow = (label, s, share, currency) => `<tr><th scope="row">${esc(label)}</th><td class="num">${s.count}</td><td class="num">${fmt(s.cost, currency)}</td><td class="num">${fmt(s.value, currency)}</td>
    <td class="num">${share == null ? '' : shareBar(share)}</td><td class="num ${tone(s.gain)}">${signed(s.gain, currency)}<small>${pct(s.gainPct)}</small></td><td class="num ${tone(s.xirr)}">${pct(s.xirr)}</td></tr>`;
  const typeHead = first => `<thead><tr><th>${first}</th><th class="num">Holdings</th><th class="num">Invested</th><th class="num">Market value</th><th class="num">Share</th><th class="num">Unrealized gain</th><th class="num">XIRR</th></tr></thead>`;

  // With one broker, its asset types are already the report's, so only its holdings follow.
  const single = data.brokers.length === 1;
  const brokerBlock = b => {
    const cur = b.currency;
    if (single && !detailed) return '';
    const holdings = detailed ? b.types.map(g => `<tr class="group-row"><th colspan="9">${esc(g.label)} · ${g.holdings.length}</th></tr>
      ${g.holdings.map(h => `<tr><td>${esc(h.symbol)}${h.name && h.name !== h.symbol ? `<small>${esc(h.name)}</small>` : ''}</td><td class="num">${qty(h.qty)}</td><td class="num">${fmt(h.avg, cur, 2)}</td><td class="num">${fmt(h.price, cur, 2)}</td>
        <td class="num">${fmt(h.cost, cur)}</td><td class="num">${fmt(h.value, cur)}</td><td class="num ${tone(h.gain)}">${signed(h.gain, cur)}<small>${pct(h.gainPct)}</small></td><td class="num ${tone(h.xirr)}">${pct(h.xirr)}</td><td class="num">${h.weight == null ? '–' : `${h.weight.toFixed(1)}%`}</td></tr>`).join('')}`).join('') : '';
    if (single) return `<section><h2>Holdings${cur !== data.currency ? ` <span class="muted" style="font-weight:400;font-size:9.5pt">· in ${cur}</span>` : ''}</h2><table class="holdings">
        <thead><tr><th>Holding</th><th class="num">Quantity</th><th class="num">Avg cost</th><th class="num">Price</th><th class="num">Invested</th><th class="num">Market value</th><th class="num">Unrealized gain</th><th class="num">XIRR</th><th class="num">Weight</th></tr></thead>
        <tbody>${holdings}</tbody></table></section>`;
    return `<section class="${detailed ? 'broker' : ''}">
      <h2>${esc(b.name)} <span class="muted" style="font-weight:400;font-size:9.5pt">· ${b.broker && b.broker !== b.name ? `${esc(b.broker)} · ` : ''}${esc(b.kind)}${cur !== data.currency ? ` · in ${cur}${b.rupees != null ? `, ${inr.format(b.rupees)}` : ''}` : ''}</span></h2>
      <table>${typeHead('Asset type')}
        <tbody>${b.types.map(g => typeRow(g.label, g.summary, g.share, cur)).join('')}</tbody>
        <tfoot>${typeRow('Total', b.summary, 100, cur)}</tfoot>
      </table>
      <p class="muted" style="margin:4px 0 0;font-size:8.5pt">Realized gain ${signed(b.summary.realized, cur)} · dividends ${fmt(b.summary.dividends, cur)} · XIRR on everything, sold included, ${pct(b.summary.xirrAll)}</p>
      ${detailed ? `<h3>Holdings</h3><table class="holdings">
        <thead><tr><th>Holding</th><th class="num">Quantity</th><th class="num">Avg cost</th><th class="num">Price</th><th class="num">Invested</th><th class="num">Market value</th><th class="num">Unrealized gain</th><th class="num">XIRR</th><th class="num">Weight</th></tr></thead>
        <tbody>${holdings}</tbody>
      </table>` : ''}
    </section>`;
  };

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(data.fileName)}</title><style>${CSS}</style></head><body>
    <div class="head"><div><h1>${esc(data.title)}</h1><p>${esc(data.subtitle)}</p></div><p style="text-align:right">${esc(data.generated)}<br>${esc(data.pricesAt)}</p></div>
    <div class="cards">
      <div class="card"><span>Market value</span><b>${inr.format(t.value)}</b><span>Invested ${inr.format(t.cost)}</span></div>
      <div class="card"><span>Unrealized gain</span><b class="${tone(t.gain)}">${signed(t.gain)}</b><span>${pct(t.gainPct)}</span></div>
      <div class="card"><span>XIRR</span><b class="${tone(t.xirr)}">${pct(t.xirr)}</b><span>Annual return, all time, sold included</span></div>
      <div class="card"><span>Change · ${esc(data.change.label)}</span><b class="${tone(data.change.amount)}">${signed(data.change.amount)}</b><span>${pct(data.change.pct)} ${esc(data.change.name)}</span></div>
      <div class="card"><span>Realized gain</span><b class="${tone(t.realized)}">${signed(t.realized)}</b><span>${pct(t.realizedPct)}</span></div>
      <div class="card"><span>Dividends</span><b>${inr.format(t.dividends)}</b><span>${t.yieldOnCost ? `${t.yieldOnCost.toFixed(2)}% yield on cost` : 'All time'}</span></div>
      <div class="card"><span>Holdings</span><b>${data.holdings}</b><span>Across ${data.brokers.length} ${data.brokers.length === 1 ? 'broker' : 'brokers'}</span></div>
      <div class="card"><span>Brokers</span><b>${data.brokers.length}</b><span>${esc(data.fx)}</span></div>
    </div>
    <h2>By asset type</h2>
    <table>${typeHead('Asset type')}
      <tbody>${data.types.map(g => typeRow(g.label, g.summary, g.share)).join('')}</tbody>
      <tfoot>${typeRow('Total', data.typesTotal, 100)}</tfoot>
    </table>
    ${data.brokers.length > 1 ? `<h2>By broker</h2>
    <table>${typeHead('Broker')}
      <tbody>${data.brokers.map(b => typeRow(b.name, b.rupeeSummary, b.share)).join('')}</tbody>
      <tfoot>${typeRow('Total', data.typesTotal, 100)}</tfoot>
    </table>` : ''}
    ${detailed || single ? '' : '<h2>Each broker by asset type</h2>'}
    ${data.brokers.map(brokerBlock).join('')}
    <p class="note">${data.notes.map(esc).join(' ')}</p>
  </body></html>`;
}

// Prints the page from a hidden frame, which opens the browser's print window with
// Save as PDF. The frame is removed once printing is done.
export function printReport(html) {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
  document.body.append(frame);
  const doc = frame.contentDocument;
  doc.open();
  doc.write(html);
  doc.close();
  const done = () => setTimeout(() => frame.remove(), 1000);
  frame.contentWindow.addEventListener('afterprint', done, { once: true });
  // Give the page a moment to lay out before printing.
  setTimeout(() => {
    const title = document.title;
    document.title = doc.title;
    frame.contentWindow.focus();
    frame.contentWindow.print();
    document.title = title;
    setTimeout(done, 60000);
  }, 150);
  return frame;
}

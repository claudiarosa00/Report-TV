/* =============================================================================
 * ui.js — Componentes de interface reutilizáveis
 *   formatação (pt-PT) · badges de estado · tooltips · multi-select
 *   tabelas ordenáveis com exportação CSV · heatmaps
 * ========================================================================== */
window.TV = window.TV || {};

TV.ui = (function () {
  const E = () => TV.engine;
  const nf = {};
  const fmtN = (v, dec) => {
    if (v === null || v === undefined || !isFinite(v)) return '—';
    const k = dec || 0;
    nf[k] = nf[k] || new Intl.NumberFormat('pt-PT', { minimumFractionDigits: k, maximumFractionDigits: k });
    return nf[k].format(v);
  };
  const fmt = {
    n: fmtN,
    eur: (v, dec) => (v === null || v === undefined || !isFinite(v) ? '—' : fmtN(v, dec || 0) + ' €'),
    pct: (v, dec) => (v === null || v === undefined || !isFinite(v) ? '—' : fmtN(v, dec === undefined ? 1 : dec) + '%'),
    signed: (v, dec, unit) => (v === null || v === undefined || !isFinite(v) ? '—' : (v > 0 ? '+' : v < 0 ? '−' : '') + fmtN(Math.abs(v), dec || 0) + (unit || '')),
    signedPct: (v, dec) => (v === null || v === undefined || !isFinite(v) ? 'n.d.' : (v > 0 ? '+' : v < 0 ? '−' : '') + fmtN(Math.abs(v), dec === undefined ? 1 : dec) + '%'),
    compact: (v) => {
      if (v === null || v === undefined || !isFinite(v)) return '—';
      const a = Math.abs(v);
      return a >= 1e6 ? fmtN(v / 1e6, 2) + ' M' : a >= 1e4 ? fmtN(v / 1e3, 1) + ' mil' : fmtN(v, 0);
    }
  };
  /* Formata valor de um indicador. */
  fmt.ind = (v, ind, short) => {
    const d = E().indicators[ind];
    if (v === null || v === undefined || !isFinite(v)) return '—';
    if (d.unit === '€') return short && Math.abs(v) >= 10000 ? fmt.compact(v) + ' €' : fmt.eur(v, d.dec);
    if (d.unit === '%') return fmt.n(v, d.dec) + '%';
    if (ind === 'avgAud') return fmt.compact(v);
    return fmt.n(v, d.dec) + (d.unit === 's' ? ' s' : '');
  };

  const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const ICON = { pos: '▲', neg: '▼', tol: '●', warn: '◆', na: '·' };
  const STATUS_LABEL = { pos: 'Acima', neg: 'Abaixo', tol: 'Na tolerância', warn: 'Fora da tolerância', na: 'n.d.' };
  /* Badge de desvio % com ícone + texto (nunca só cor). */
  function badge(pct, dir, opts) {
    const st = E().status(pct, dir || 'higher');
    const txt = pct === null || pct === undefined || !isFinite(pct) ? 'n.d.' : fmt.signedPct(pct);
    const title = STATUS_LABEL[st] + (dir === 'lower' ? ' (menor é melhor)' : '');
    return '<span class="badge ' + st + '" title="' + title + '">' + ICON[st] + ' ' + txt + (opts && opts.suffix ? opts.suffix : '') + '</span>';
  }
  function statusBadge(st, text) { return '<span class="badge ' + st + '">' + ICON[st] + ' ' + esc(text) + '</span>'; }
  function info(text) { return '<i class="info" data-tip="' + esc(text) + '">i</i>'; }

  /* ---------- tooltip global ---------- */
  let tipEl;
  function initTips() {
    tipEl = document.getElementById('tip');
    document.addEventListener('mouseover', (e) => {
      const t = e.target.closest('[data-tip]');
      if (!t) return;
      tipEl.innerHTML = t.getAttribute('data-tip-html') === '1' ? t.getAttribute('data-tip') : esc(t.getAttribute('data-tip'));
      tipEl.classList.add('on');
    });
    document.addEventListener('mousemove', (e) => {
      if (!tipEl.classList.contains('on')) return;
      const w = tipEl.offsetWidth, h = tipEl.offsetHeight;
      let x = e.clientX + 14, y = e.clientY + 14;
      if (x + w > window.innerWidth - 8) x = e.clientX - w - 14;
      if (y + h > window.innerHeight - 8) y = e.clientY - h - 14;
      tipEl.style.left = x + 'px'; tipEl.style.top = y + 'px';
    });
    document.addEventListener('mouseout', (e) => { if (e.target.closest('[data-tip]')) tipEl.classList.remove('on'); });
  }

  let toastT;
  function toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg; t.classList.add('on');
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 3800);
  }

  /* ---------- multi-select ---------- */
  function multiselect(el, { options, placeholder, onChange }) {
    let selected = [];
    el.classList.add('ms');
    el.innerHTML = '<button type="button" class="ms-btn" aria-haspopup="listbox"><span></span><svg width="10" height="10" viewBox="0 0 10 10"><path d="M1 3l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.5"/></svg></button><div class="ms-pop" role="listbox"></div>';
    const btn = el.querySelector('.ms-btn'), pop = el.querySelector('.ms-pop');
    function paint() {
      const opts = options();
      pop.innerHTML = '<div class="ms-all"><button type="button" data-a="all">Todos</button><button type="button" data-a="none">Limpar</button></div>' +
        opts.map((o) => '<label><input type="checkbox" value="' + esc(o.value) + '"' + (selected.includes(o.value) ? ' checked' : '') + '> ' + esc(o.label) + '</label>').join('');
      const lbl = !selected.length ? placeholder : selected.length === 1 ? (opts.find((o) => o.value === selected[0]) || {}).label : selected.length + ' selecionados';
      btn.querySelector('span').textContent = lbl;
      btn.classList.toggle('set', selected.length > 0);
    }
    btn.addEventListener('click', (e) => { e.stopPropagation(); document.querySelectorAll('.ms.open').forEach((m) => m !== el && m.classList.remove('open')); el.classList.toggle('open'); });
    pop.addEventListener('click', (e) => e.stopPropagation());
    pop.addEventListener('change', () => {
      const opts = options();
      selected = Array.from(pop.querySelectorAll('input:checked')).map((i) => opts.find((o) => String(o.value) === i.value).value);
      if (selected.length === opts.length) selected = [];
      paint(); onChange(selected.slice());
    });
    pop.addEventListener('click', (e) => {
      const a = e.target.getAttribute('data-a'); if (!a) return;
      selected = []; paint(); onChange([]);
    });
    document.addEventListener('click', () => el.classList.remove('open'));
    paint();
    return { set: (v) => { selected = v.slice(); paint(); }, get: () => selected.slice(), refresh: paint };
  }

  /* ---------- CSV ---------- */
  function toCSV(columns, rows) {
    const cell = (v) => {
      if (v === null || v === undefined || (typeof v === 'number' && !isFinite(v))) return '';
      if (typeof v === 'number') return String(Math.round(v * 10000) / 10000).replace('.', ',');
      const s = String(v);
      return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    return '﻿' + [columns.map((c) => cell(c.csv || c.label)).join(';')]
      .concat(rows.map((r) => columns.map((c) => cell(c.raw ? c.raw(r) : r[c.key])).join(';'))).join('\r\n');
  }
  function download(name, content, mime) {
    const blob = content instanceof Blob ? content : new Blob([content], { type: mime || 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  /* ---------- tabela ordenável ----------
   * columns: [{key,label,tip,align:'l',raw(row)->valor para ordenar/CSV, html(row)->célula, hl(row)->'pos'|'neg'}]
   */
  const tables = {};
  function table(id, { columns, rows, footer, sort, exportName, pageSize, title }) {
    const host = document.getElementById(id);
    if (!host) return;
    const st = tables[id] || (tables[id] = { sort: sort || null, page: 0 });
    st.columns = columns; st.rows = rows; st.footer = footer; st.exportName = exportName; st.pageSize = pageSize;
    tables[id].registry = { title: title || exportName, columns, rows };
    function render() {
      let data = st.rows.slice();
      if (st.sort) {
        const c = st.columns.find((x) => x.key === st.sort.key);
        if (c) {
          const g = c.raw || ((r) => r[c.key]);
          data.sort((a, b) => {
            const va = g(a), vb = g(b);
            if (va === null || va === undefined) return 1;
            if (vb === null || vb === undefined) return -1;
            return (typeof va === 'number' ? va - vb : String(va).localeCompare(String(vb), 'pt')) * (st.sort.dir === 'asc' ? 1 : -1);
          });
        }
      }
      const total = data.length;
      const pages = st.pageSize ? Math.max(1, Math.ceil(total / st.pageSize)) : 1;
      if (st.page >= pages) st.page = pages - 1;
      if (st.pageSize) data = data.slice(st.page * st.pageSize, (st.page + 1) * st.pageSize);
      const th = st.columns.map((c) => '<th data-k="' + c.key + '" class="' + (c.align === 'l' ? 'l ' : '') + (st.sort && st.sort.key === c.key ? 'sorted ' + st.sort.dir : '') + '"' + (c.tip ? ' data-tip="' + esc(c.tip) + '"' : '') + '>' + esc(c.label) + '</th>').join('');
      const tb = data.map((r) => '<tr>' + st.columns.map((c) => {
        const hl = c.hl ? c.hl(r) : null;
        const v = c.html ? c.html(r) : esc(r[c.key]);
        return '<td class="' + (c.align === 'l' ? 'l ' : '') + (hl ? 'hl-' + hl : '') + '">' + v + '</td>';
      }).join('') + '</tr>').join('');
      const tf = st.footer ? '<tfoot><tr>' + st.columns.map((c) => '<td class="' + (c.align === 'l' ? 'l' : '') + '">' + (st.footer[c.key] !== undefined ? st.footer[c.key] : '') + '</td>').join('') + '</tr></tfoot>' : '';
      host.innerHTML = '<div class="table-tools"><span>' + total + ' linha' + (total === 1 ? '' : 's') + ' · clique no cabeçalho para ordenar</span>' +
        (st.exportName ? '<button class="btn sm" data-csv>⇩ CSV</button>' : '') + '</div>' +
        '<div class="table-wrap' + (st.pageSize ? '' : ' scroll-y') + '"><table class="dt"><thead><tr>' + th + '</tr></thead><tbody>' + (tb || '<tr><td class="l" colspan="' + st.columns.length + '">Sem dados para os filtros selecionados.</td></tr>') + '</tbody>' + tf + '</table></div>' +
        (st.pageSize && pages > 1 ? '<div class="pager"><button class="btn sm" data-pg="-1">‹</button> Página ' + (st.page + 1) + ' de ' + pages + ' <button class="btn sm" data-pg="1">›</button></div>' : '');
      host.querySelectorAll('th[data-k]').forEach((h) => h.addEventListener('click', () => {
        const k = h.getAttribute('data-k');
        st.sort = st.sort && st.sort.key === k ? { key: k, dir: st.sort.dir === 'asc' ? 'desc' : 'asc' } : { key: k, dir: 'desc' };
        render();
      }));
      const csvBtn = host.querySelector('[data-csv]');
      if (csvBtn) csvBtn.addEventListener('click', () => download(st.exportName + '.csv', toCSV(st.columns, st.rows)));
      host.querySelectorAll('[data-pg]').forEach((b) => b.addEventListener('click', () => { st.page = Math.max(0, Math.min(pages - 1, st.page + Number(b.getAttribute('data-pg')))); render(); }));
    }
    render();
  }
  const tableRegistry = () => Object.keys(tables).map((k) => tables[k].registry).filter(Boolean);

  /* ---------- cores ---------- */
  const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const hex2rgb = (h) => { h = h.replace('#', ''); if (h.length === 3) h = h.split('').map((x) => x + x).join(''); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); };
  const mix = (a, b, t) => { const A = hex2rgb(a), B = hex2rgb(b); return 'rgb(' + A.map((v, i) => Math.round(v + (B[i] - v) * t)).join(',') + ')'; };
  const lum = (rgb) => { const m = rgb.match(/\d+/g).map(Number).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]; };
  /* Escala divergente (desvio %): azul = acima do plano, vermelho = abaixo, cinzento = neutro. */
  function divergingColor(v, maxAbs, invert) {
    if (v === null || v === undefined || !isFinite(v)) return null;
    const s = invert ? -v : v;
    const t = Math.min(1, Math.abs(s) / (maxAbs || 1));
    return mix(cssVar('--div-mid'), cssVar(s >= 0 ? '--div-pos' : '--div-neg'), Math.pow(t, 0.8) * 0.92);
  }
  function sequentialColor(v, min, max) {
    if (v === null || v === undefined || !isFinite(v)) return null;
    const t = max === min ? 0.5 : (v - min) / (max - min);
    return mix(cssVar('--seq-lo'), cssVar('--seq-hi'), t);
  }
  const textOn = (bg) => (bg && lum(bg) < 0.33 ? '#fff' : '#111');

  /* ---------- heatmap ----------
   * cell(r,c) → { v, text, tip } ; scale: 'div'|'seq' ; invert: menor é melhor
   */
  function heatmap(id, { rows, cols, rowName, colName, cell, scale, invert, legend, rowTotal, colTotal, corner }) {
    const host = document.getElementById(id);
    const vals = [];
    const cells = rows.map((r) => cols.map((c) => { const x = cell(r, c); if (x && isFinite(x.v)) vals.push(x.v); return x; }));
    const maxAbs = Math.max(10, ...vals.map(Math.abs));
    const min = Math.min(...vals), max = Math.max(...vals);
    const color = (v) => (scale === 'seq' ? sequentialColor(v, min, max) : divergingColor(v, maxAbs, invert));
    let h = '<table class="hm"><thead><tr><th class="rh">' + esc(corner || '') + '</th>' + cols.map((c) => '<th>' + esc(colName(c)) + '</th>').join('') + (rowTotal ? '<th>Total</th>' : '') + '</tr></thead><tbody>';
    rows.forEach((r, i) => {
      h += '<tr><th class="rh">' + esc(rowName(r)) + '</th>';
      cols.forEach((c, j) => {
        const x = cells[i][j];
        if (!x || x.v === null || x.v === undefined || !isFinite(x.v)) { h += '<td class="empty"' + (x && x.tip ? ' data-tip-html="1" data-tip="' + esc(x.tip) + '"' : '') + '>' + (x && x.text ? esc(x.text) : '—') + '</td>'; return; }
        const bg = color(x.v);
        h += '<td style="background:' + bg + ';color:' + textOn(bg) + '" data-tip-html="1" data-tip="' + esc(x.tip || '') + '">' + esc(x.text) + '</td>';
      });
      if (rowTotal) { const t = rowTotal(r); h += '<td class="tot" data-tip-html="1" data-tip="' + esc(t.tip || '') + '">' + esc(t.text) + '</td>'; }
      h += '</tr>';
    });
    if (colTotal) h += '<tr><th class="rh">Total</th>' + cols.map((c) => { const t = colTotal(c); return '<td class="tot" data-tip-html="1" data-tip="' + esc(t.tip || '') + '">' + esc(t.text) + '</td>'; }).join('') + (rowTotal ? '<td class="tot"></td>' : '') + '</tr>';
    h += '</tbody></table>';
    const ramp = scale === 'seq' ? 'linear-gradient(90deg,' + cssVar('--seq-lo') + ',' + cssVar('--seq-hi') + ')' :
      'linear-gradient(90deg,' + cssVar(invert ? '--div-pos' : '--div-neg') + ',' + cssVar('--div-mid') + ',' + cssVar(invert ? '--div-neg' : '--div-pos') + ')';
    h += '<div class="hm-legend"><span>' + esc(legend ? legend[0] : '') + '</span><span class="ramp" style="background:' + ramp + '"></span><span>' + esc(legend ? legend[1] : '') + '</span>' + (legend && legend[2] ? '<span>· ' + esc(legend[2]) + '</span>' : '') + '</div>';
    host.innerHTML = '<div style="overflow-x:auto">' + h + '</div>';
  }

  return { fmt, esc, badge, statusBadge, info, initTips, toast, multiselect, table, tableRegistry, toCSV, download, cssVar, heatmap, ICON };
})();

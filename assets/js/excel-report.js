/* =============================================================================
 * excel-report.js — Relatório Excel para o cliente
 * -----------------------------------------------------------------------------
 * Gera um .xlsx formatado (ExcelJS) com:
 *   Resumo · Por canal · Por faixa horária · Por secundagem · Por semana ·
 *   Conclusões · Registo de emissões · Metodologia
 * Os quadros usam fórmulas (diferenças, desvios, CPP, pesos) e os gráficos são
 * gráficos NATIVOS do Excel (editáveis, ligados às células), injetados no
 * ficheiro com JSZip — o ExcelJS não suporta gráficos.
 * Dependências: ExcelJS 4.4.0 e JSZip 3.10.1 (CDN).
 * ========================================================================== */
window.TV = window.TV || {};

TV.excelReport = (function () {
  const E = () => TV.engine, F = () => TV.ui.fmt;
  const isNum = (v) => typeof v === 'number' && isFinite(v);

  /* ---------- identidade visual ---------- */
  const COL = {
    plan: '8D8C85', real: '2A78D6', ink: '1F1F1D', ink2: '52514E', ink3: '8A8984', line: 'E2E1DC', head: 'F0EFEC', band: 'F7F7F5',
    accent: '2A78D6', goodBg: 'E3F4E3', goodFg: '006300', badBg: 'FAE4E4', badFg: 'B42C2C', tolBg: 'ECEBE7', tolFg: '52514E', warnBg: 'FDF2D9', warnFg: '8A5A00'
  };
  const A = (h) => 'FF' + h;
  const FMT = {
    int: '#,##0', d1: '#,##0.0', d2: '#,##0.00', eur: '#,##0 "€"', eur2: '#,##0.00 "€"', pct: '0.0%',
    dpct: '+0.0%;-0.0%;0.0%', d1s: '+#,##0.0;-#,##0.0;0.0', d2s: '+#,##0.00;-#,##0.00;0.00', ints: '+#,##0;-#,##0;0', eurs: '+#,##0 "€";-#,##0 "€";0 "€"', eur2s: '+#,##0.00 "€";-#,##0.00 "€";0.00 "€"'
  };
  const STATUS = {
    pos: { t: '▲ Favorável', bg: COL.goodBg, fg: COL.goodFg },
    neg: { t: '▼ Desfavorável', bg: COL.badBg, fg: COL.badFg },
    tol: { t: '● Em linha', bg: COL.tolBg, fg: COL.tolFg },
    warn: { t: '◆ Desvio relevante', bg: COL.warnBg, fg: COL.warnFg },
    na: { t: 'n.d.', bg: 'FFFFFF', fg: COL.ink3 }
  };
  const thin = { style: 'thin', color: { argb: A(COL.line) } };
  const colL = (n) => { let s = ''; n++; while (n) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }; // 0 → A

  /* ---------- helpers de formatação ---------- */
  function setup(ws, widths, landscape) {
    widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
    ws.pageSetup = { orientation: landscape === false ? 'portrait' : 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } };
    ws.headerFooter = { oddFooter: '&L&8&K8A8984TV Post-Buy · Relatório de pós-avaliação&R&8&K8A8984Página &P de &N' };
  }
  function title(ws, lastCol, text, sub, sub2) {
    ws.mergeCells(1, 1, 1, lastCol);
    const c = ws.getCell(1, 1); c.value = text; c.font = { size: 18, bold: true, color: { argb: A(COL.ink) } };
    ws.getRow(1).height = 30;
    [sub, sub2].forEach((t, i) => {
      if (!t) return;
      ws.mergeCells(2 + i, 1, 2 + i, lastCol);
      const x = ws.getCell(2 + i, 1); x.value = t; x.font = { size: 10, color: { argb: A(i ? COL.ink3 : COL.ink2) }, italic: !!i };
    });
    // faixa de cor da marca
    for (let k = 1; k <= lastCol; k++) ws.getCell(4, k).border = { top: { style: 'medium', color: { argb: A(COL.accent) } } };
    ws.getRow(4).height = 6;
  }
  function section(ws, row, lastCol, text) {
    ws.mergeCells(row, 1, row, lastCol);
    const c = ws.getCell(row, 1); c.value = text; c.font = { size: 12, bold: true, color: { argb: A(COL.ink) } };
    for (let k = 1; k <= lastCol; k++) ws.getCell(row, k).border = { bottom: { style: 'thin', color: { argb: A(COL.ink3) } } };
    ws.getRow(row).height = 22;
  }
  function head(cell, text, align) {
    cell.value = text;
    cell.font = { bold: true, size: 10, color: { argb: A(COL.ink2) } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: A(COL.head) } };
    cell.alignment = { horizontal: align || 'center', vertical: 'middle', wrapText: true };
    cell.border = { top: thin, bottom: thin, left: thin, right: thin };
  }
  function val(cell, v, fmt, opt) {
    opt = opt || {};
    if (opt.formula) cell.value = { formula: opt.formula, result: isNum(v) ? v : '' };
    else cell.value = isNum(v) ? Math.round(v * 1e4) / 1e4 : (v === null || v === undefined ? 'n.d.' : v);
    if (fmt) cell.numFmt = fmt;
    cell.font = { size: 10, bold: !!opt.bold, color: { argb: A(opt.color || (isNum(v) || opt.formula ? COL.ink : COL.ink3)) } };
    cell.alignment = { horizontal: opt.align || (isNum(v) || opt.formula ? 'right' : 'center'), vertical: 'middle', wrapText: !!opt.wrap };
    cell.border = { bottom: thin };
    if (opt.fill) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: A(opt.fill) } };
  }
  function paint(cell, st) {
    const s = STATUS[st] || STATUS.na;
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: A(s.bg) } };
    cell.font = Object.assign({}, cell.font, { color: { argb: A(s.fg) }, bold: st === 'pos' || st === 'neg' });
  }
  function note(ws, row, lastCol, text, opt) {
    opt = opt || {};
    ws.mergeCells(row, 1, row, lastCol);
    const c = ws.getCell(row, 1);
    c.value = opt.rich ? { richText: opt.rich } : text;
    c.font = { size: opt.size || 10, color: { argb: A(opt.color || COL.ink2) }, bold: !!opt.bold, italic: !!opt.italic };
    c.alignment = { wrapText: true, vertical: 'top' };
    if (opt.fill) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: A(opt.fill) } };
    const len = String(text || (opt.rich || []).map((r) => r.text).join('')).length;
    ws.getRow(row).height = Math.max(18, Math.ceil(len / (opt.cpl || 150)) * 15 + 4);
  }
  const richFromSegs = (segs) => segs.map((g) => ({ text: g.text, font: { size: 10, bold: g.cls === 'b' || g.cls === 't-pos' || g.cls === 't-neg', color: { argb: A(g.cls === 't-pos' ? COL.goodFg : g.cls === 't-neg' ? COL.badFg : g.cls === 'b' ? COL.ink : COL.ink2) } } }));

  /* ============================================================
   * FOLHAS
   * ============================================================ */
  function summarySheet(wb, d, charts) {
    const ws = wb.addWorksheet('Resumo', { views: [{ showGridLines: false }], properties: { tabColor: { argb: A(COL.accent) } } });
    setup(ws, [40, 17, 17, 17, 13, 22], false);
    title(ws, 6, 'Relatório de Performance — ' + (d.meta.campanha || 'Campanha TV'), d.headline, d.filters);
    const s = d.s;
    let r = 6;
    // Veredicto
    ws.mergeCells(r, 1, r, 6);
    const v = ws.getCell(r, 1);
    const vs = { pos: STATUS.pos, tol: STATUS.warn, neg: STATUS.neg, na: STATUS.na }[d.verdict.st];
    v.value = { richText: [{ text: d.verdict.title + '\n', font: { size: 13, bold: true, color: { argb: A(vs.fg) } } }, { text: d.verdict.text, font: { size: 10, color: { argb: A(COL.ink) } } }] };
    v.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: A(vs.bg) } };
    v.alignment = { wrapText: true, vertical: 'middle', indent: 1 };
    v.border = { left: { style: 'thick', color: { argb: A(vs.fg) } } };
    ws.getRow(r).height = 48;
    r += 2;

    section(ws, r, 6, 'Indicadores principais — planeado vs real'); r++;
    ['Indicador', 'Planeado', 'Real', 'Diferença', 'Desvio', 'Avaliação'].forEach((h, i) => head(ws.getCell(r, i + 1), h, i ? 'center' : 'left'));
    r++;
    const rating = (a) => E().div(a.grp, a.rated);
    const rows = [
      ['Investimento (€)', s.p.cost, s.r.cost, FMT.eur, FMT.eurs, 'neutral'],
      ['GRPs · ' + d.targetLabel, s.p.grp, s.r.grp, FMT.d1, FMT.d1s, 'higher'],
      ['TRPs · ' + d.buyTargetLabel + ' (target de compra)', s.pT.grp, s.rT.grp, FMT.d1, FMT.d1s, 'higher'],
      ['Nº de spots', s.p.spots, s.r.spots, FMT.int, FMT.ints, 'higher'],
      ['Rating médio (%)', rating(s.p), rating(s.r), FMT.d2, FMT.d2s, 'higher'],
      ['Audiência média por spot (indivíduos)', E().val(s.p, 'avgAud'), E().val(s.r, 'avgAud'), FMT.int, FMT.ints, 'higher'],
      ['CPP — custo por ponto (€)', E().div(s.p.cost, s.p.grp), E().div(s.r.cost, s.r.grp), FMT.eur, FMT.eurs, 'lower'],
      ['CPM — custo por mil contactos (€)', E().val(s.p, 'cpm'), E().val(s.r, 'cpm'), FMT.eur2, FMT.eur2s, 'lower'],
      ['Segundos emitidos', s.p.seconds, s.r.seconds, FMT.int, FMT.ints, 'neutral']
    ];
    if (s.reach.available) {
      rows.push(['Cobertura 1+', s.reach.plan.r1 / 100, s.reach.real.r1 / 100, FMT.pct, '+0.0%;-0.0%', 'higher', true]);
      if (isNum(s.reach.real.r3)) rows.push(['Cobertura 3+', s.reach.plan.r3 / 100, s.reach.real.r3 / 100, FMT.pct, '+0.0%;-0.0%', 'higher', true]);
      rows.push(['Frequência média (contactos)', s.reach.freqP, s.reach.freqR, FMT.d1, FMT.d1s, 'neutral']);
    }
    rows.forEach((x) => {
      val(ws.getCell(r, 1), x[0], null, { align: 'left', color: COL.ink });
      val(ws.getCell(r, 2), x[1], x[3]);
      val(ws.getCell(r, 3), x[2], x[3], { bold: true });
      const ok = isNum(x[1]) && isNum(x[2]);
      val(ws.getCell(r, 4), ok ? x[2] - x[1] : null, x[4], ok ? { formula: 'C' + r + '-B' + r } : {});
      const pct = x[6] ? null : E().devPct(x[2], x[1]); // cobertura: diferença em p.p., não em %
      val(ws.getCell(r, 5), x[6] ? null : (isNum(pct) ? pct / 100 : null), FMT.dpct, !x[6] && ok && x[1] !== 0 ? { formula: '(C' + r + '-B' + r + ')/B' + r } : {});
      if (x[6]) ws.getCell(r, 5).value = '—';
      const st = x[6] ? E().status(E().devPct(x[2], x[1]), x[5]) : E().status(pct, x[5]);
      val(ws.getCell(r, 6), STATUS[st].t, null, { align: 'center' }); paint(ws.getCell(r, 6), st);
      r++;
    });
    if (!s.reach.available) { note(ws, r, 6, 'Cobertura e frequência: indisponíveis — ' + s.reach.reason, { italic: true, color: COL.ink3 }); r++; }
    note(ws, r, 6, 'Avaliação com tolerância de ±' + d.tol + '%. Para CPP e CPM, valores abaixo do plano são favoráveis.', { italic: true, color: COL.ink3, size: 9 });
    r += 2;

    section(ws, r, 6, 'Cumprimento do plano'); r++;
    ['Dimensão', 'Resultado', '', 'Como se calcula', '', 'Avaliação'].forEach((h, i) => head(ws.getCell(r, i + 1), h, i ? 'center' : 'left'));
    ws.mergeCells(r, 2, r, 3); ws.mergeCells(r, 4, r, 5); r++;
    const c = s.compliance;
    [['Volume (spots)', c.volume, 'Spots do plano emitidos nas condições contratadas ÷ planeados', c.parts[0]],
      ['Audiência (GRPs)', c.audience, 'GRPs reais ÷ GRPs planeados', c.parts[1]],
      ['Eficiência de custo', c.costEff, 'CPP planeado ÷ CPP real (>100% = mais barato)', c.parts[2]]].forEach((x) => {
      val(ws.getCell(r, 1), x[0], null, { align: 'left', color: COL.ink });
      ws.mergeCells(r, 2, r, 3); val(ws.getCell(r, 2), x[1], FMT.pct, { bold: true, align: 'center' });
      ws.mergeCells(r, 4, r, 5); val(ws.getCell(r, 4), x[2], null, { align: 'left', wrap: true, color: COL.ink2 });
      val(ws.getCell(r, 6), STATUS[x[3]].t, null); paint(ws.getCell(r, 6), x[3]);
      ws.getRow(r).height = 28; r++;
    });
    r++;
    section(ws, r, 6, 'Destaques'); r++;
    d.conclusions.filter((x) => x.client).slice(0, 6).forEach((x) => {
      note(ws, r, 6, '', { rich: [{ text: ({ pos: '▲  ', neg: '▼  ', warn: '◆  ' }[x.type] || '●  '), font: { size: 10, bold: true, color: { argb: A(x.type === 'pos' ? COL.goodFg : x.type === 'neg' ? COL.badFg : COL.ink3) } } }, { text: x.text, font: { size: 10, color: { argb: A(COL.ink) } } }], cpl: 125 });
      r++;
    });
    r += 1;
    ws.getRow(r - 1).addPageBreak();
    section(ws, r, 6, 'GRPs planeados vs reais'); r++;
    charts.push({ sheet: 'Resumo', from: [0, r], to: [6, r + 18], src: 'channel', metric: 'grp', title: 'GRPs por canal — planeado vs real' });
    charts.push({ sheet: 'Resumo', from: [0, r + 19], to: [6, r + 37], src: 'week', metric: 'grp', title: 'GRPs por semana — planeado vs real' });
    ws.getCell(r + 38, 1).value = ' ';
    return ws;
  }

  /* Folha de dimensão: quadro com todas as métricas + leitura + 4 gráficos. */
  const DIM = {
    channel: { sheet: 'Por canal', label: 'Canal', sec: 'Canais' },
    daypart: { sheet: 'Por faixa horária', label: 'Faixa horária', sec: 'Faixas horárias' },
    duration: { sheet: 'Por secundagem', label: 'Secundagem', sec: 'Secundagem' },
    week: { sheet: 'Por semana', label: 'Semana', sec: 'Semanas' }
  };
  function dimSheet(wb, d, dim, charts, refs) {
    const cfgD = DIM[dim], list = d.dims[dim], s = d.s;
    const ws = wb.addWorksheet(cfgD.sheet, { views: [{ showGridLines: false }] });
    setup(ws, [24].concat(Array(15).fill(11.5)));
    title(ws, 16, cfgD.sheet + ' — planeado vs real', d.targetLabel + ' · ' + d.headline, d.filters);
    let r = 6;
    section(ws, r, 16, 'Leitura'); r++;
    ['grp', 'spots', 'cost', 'cpp'].forEach((m) => {
      note(ws, r, 16, '', { rich: richFromSegs(TV.insights.lead(list, m, E().val(s.p, m), E().val(s.r, m))), cpl: 190 }); r++;
    });
    d.conclusions.filter((x) => x.sec === cfgD.sec).forEach((x) => {
      note(ws, r, 16, '', { rich: [{ text: ({ pos: '▲  ', neg: '▼  ', warn: '◆  ' }[x.type] || '●  '), font: { size: 10, bold: true, color: { argb: A(x.type === 'pos' ? COL.goodFg : x.type === 'neg' ? COL.badFg : COL.ink3) } } }, { text: x.text, font: { size: 10, color: { argb: A(COL.ink) } } }], cpl: 190 });
      r++;
    });
    r++;
    section(ws, r, 16, 'Quadro planeado vs real'); r++;
    // cabeçalho em dois níveis
    const groups = [[2, 4, 'Spots'], [5, 8, 'GRPs · ' + d.targetLabel], [9, 11, 'Investimento (€)'], [12, 14, 'CPP (€)'], [15, 16, 'Peso nos GRPs']];
    head(ws.getCell(r, 1), '', 'left');
    groups.forEach(([a, b, t]) => { ws.mergeCells(r, a, r, b); head(ws.getCell(r, a), t); for (let k = a; k <= b; k++) ws.getCell(r, k).border = { top: thin, bottom: thin, left: thin, right: thin }; });
    r++;
    ['Planeado', 'Real', 'Desvio', 'Planeado', 'Real', 'Diferença', 'Desvio', 'Planeado', 'Real', 'Desvio', 'Planeado', 'Real', 'Desvio', 'Plano', 'Real'].forEach((h, i) => head(ws.getCell(r, i + 2), h));
    head(ws.getCell(r, 1), cfgD.label, 'left');
    ws.mergeCells(r - 1, 1, r, 1);
    ws.getRow(r).height = 18;
    r++;
    const first = r, last = r + list.length - 1, tot = last + 1;
    const totG = { p: list.reduce((a, x) => a + (x.p.grp || 0), 0), r: list.reduce((a, x) => a + (x.r.grp || 0), 0) };
    const write = (row, name, p, rr, isTot) => {
      const o = { bold: isTot, fill: isTot ? COL.head : (row - first) % 2 ? COL.band : null };
      const pct = (a, b) => (isNum(a) && isNum(b) && a !== 0 ? (b - a) / a : null);
      const sum = (col) => 'SUM(' + col + first + ':' + col + last + ')';
      val(ws.getCell(row, 1), name, null, Object.assign({}, o, { align: 'left', color: COL.ink }));
      // Spots
      val(ws.getCell(row, 2), p.spots, FMT.int, Object.assign({}, o, isTot ? { formula: sum('B') } : {}));
      val(ws.getCell(row, 3), rr.spots, FMT.int, Object.assign({}, o, { bold: true }, isTot ? { formula: sum('C') } : {}));
      const sp = pct(p.spots, rr.spots);
      val(ws.getCell(row, 4), sp, FMT.dpct, Object.assign({}, o, { formula: 'IF(B' + row + '=0,"",(C' + row + '-B' + row + ')/B' + row + ')' }));
      // GRPs
      val(ws.getCell(row, 5), p.grp, FMT.d1, Object.assign({}, o, isTot ? { formula: sum('E') } : {}));
      val(ws.getCell(row, 6), rr.grp, FMT.d1, Object.assign({}, o, { bold: true }, isTot ? { formula: sum('F') } : {}));
      val(ws.getCell(row, 7), isNum(rr.grp) && isNum(p.grp) ? rr.grp - p.grp : null, FMT.d1s, Object.assign({}, o, { formula: 'F' + row + '-E' + row }));
      const gp = pct(p.grp, rr.grp);
      val(ws.getCell(row, 8), gp, FMT.dpct, Object.assign({}, o, { formula: 'IF(E' + row + '=0,"",(F' + row + '-E' + row + ')/E' + row + ')' }));
      // Investimento
      val(ws.getCell(row, 9), p.cost, FMT.eur, Object.assign({}, o, isTot ? { formula: sum('I') } : {}));
      val(ws.getCell(row, 10), rr.cost, FMT.eur, Object.assign({}, o, { bold: true }, isTot ? { formula: sum('J') } : {}));
      const ip = pct(p.cost, rr.cost);
      val(ws.getCell(row, 11), ip, FMT.dpct, Object.assign({}, o, { formula: 'IF(I' + row + '=0,"",(J' + row + '-I' + row + ')/I' + row + ')' }));
      // CPP
      const cP = E().div(p.cost, p.grp), cR = E().div(rr.cost, rr.grp);
      val(ws.getCell(row, 12), cP, FMT.eur, Object.assign({}, o, { formula: 'IF(E' + row + '=0,"",I' + row + '/E' + row + ')' }));
      val(ws.getCell(row, 13), cR, FMT.eur, Object.assign({}, o, { bold: true, formula: 'IF(F' + row + '=0,"",J' + row + '/F' + row + ')' }));
      const cp = pct(cP, cR);
      val(ws.getCell(row, 14), cp, FMT.dpct, Object.assign({}, o, { formula: 'IF(OR(L' + row + '="",M' + row + '="",L' + row + '=0),"",(M' + row + '-L' + row + ')/L' + row + ')' }));
      // Pesos
      val(ws.getCell(row, 15), totG.p ? (p.grp || 0) / totG.p : null, FMT.pct, Object.assign({}, o, { formula: 'IF(E$' + tot + '=0,"",E' + row + '/E$' + tot + ')' }));
      val(ws.getCell(row, 16), totG.r ? (rr.grp || 0) / totG.r : null, FMT.pct, Object.assign({}, o, { formula: 'IF(F$' + tot + '=0,"",F' + row + '/F$' + tot + ')' }));
      // Cor dos desvios (fora da tolerância)
      [[4, sp, 'higher'], [8, gp, 'higher'], [11, ip, 'neutral'], [14, cp, 'lower']].forEach(([col, v, dir]) => {
        const st = E().status(isNum(v) ? v * 100 : null, dir);
        if (st === 'pos' || st === 'neg' || st === 'warn') paint(ws.getCell(row, col), st);
      });
      if (isTot) for (let k = 1; k <= 16; k++) ws.getCell(row, k).border = { top: { style: 'thin', color: { argb: A(COL.ink3) } }, bottom: { style: 'thin', color: { argb: A(COL.ink3) } } };
    };
    list.forEach((x, i) => write(first + i, String(x.label), x.p, x.r, false));
    write(tot, 'Total', s.p, s.r, true);
    r = tot + 1;
    note(ws, r, 16, 'Desvio = (real − planeado) ÷ planeado. Verde/vermelho: fora da tolerância de ±' + d.tol + '% (no CPP, abaixo do plano é favorável; no investimento, desvios relevantes a amarelo). Valores calculados por fórmula.', { italic: true, color: COL.ink3, size: 9, cpl: 200 });
    r += 2;
    ws.getRow(r - 1).addPageBreak();
    section(ws, r, 16, 'Gráficos'); r++;
    refs[dim] = { sheet: cfgD.sheet, first, last, labels: list.map((x) => String(x.label)), list };
    const top = r, h = 16;
    charts.push({ sheet: cfgD.sheet, from: [0, top], to: [8, top + h], src: dim, metric: 'grp', title: 'GRPs — planeado vs real' });
    charts.push({ sheet: cfgD.sheet, from: [8, top], to: [16, top + h], src: dim, metric: 'spots', title: 'Spots — planeado vs real' });
    charts.push({ sheet: cfgD.sheet, from: [0, top + h + 1], to: [8, top + 2 * h + 1], src: dim, metric: 'cost', title: 'Investimento (€) — planeado vs real' });
    charts.push({ sheet: cfgD.sheet, from: [8, top + h + 1], to: [16, top + 2 * h + 1], src: dim, metric: 'cpp', title: 'CPP (€) — planeado vs real' });
    ws.getCell(top + 2 * h + 2, 1).value = ' ';
    return ws;
  }

  function conclusionsSheet(wb, d) {
    const ws = wb.addWorksheet('Conclusões', { views: [{ showGridLines: false }] });
    setup(ws, [5, 52, 52, 52, 20]);
    title(ws, 5, 'Conclusões e recomendações', d.targetLabel + ' · ' + d.headline, d.filters);
    let r = 6;
    section(ws, r, 5, 'Principais conclusões'); r++;
    d.conclusions.forEach((x, i) => {
      val(ws.getCell(r, 1), i + 1, null, { align: 'center', color: COL.ink3 });
      ws.mergeCells(r, 2, r, 4);
      const c = ws.getCell(r, 2);
      c.value = { richText: [{ text: ({ pos: '▲  ', neg: '▼  ', warn: '◆  ' }[x.type] || '●  '), font: { size: 10, bold: true, color: { argb: A(x.type === 'pos' ? COL.goodFg : x.type === 'neg' ? COL.badFg : COL.ink3) } } }, { text: x.text, font: { size: 10, color: { argb: A(COL.ink) } } }] };
      c.alignment = { wrapText: true, vertical: 'middle' }; c.border = { bottom: thin };
      val(ws.getCell(r, 5), x.sec, null, { color: COL.ink3, align: 'left' });
      ws.getRow(r).height = Math.max(20, Math.ceil(x.text.length / 140) * 15 + 6);
      r++;
    });
    r++;
    section(ws, r, 5, 'Recomendações para futuras campanhas'); r++;
    ['#', 'Evidência observada', 'Interpretação', 'Ação recomendada', 'Origem'].forEach((h, i) => head(ws.getCell(r, i + 1), h, i ? 'left' : 'center'));
    r++;
    d.recos.concat(d.userRecos.map((x) => Object.assign({ source: 'Analista' }, x))).forEach((x, i) => {
      val(ws.getCell(r, 1), i + 1, null, { align: 'center', color: COL.ink3 });
      val(ws.getCell(r, 2), x.evidence, null, { align: 'left', wrap: true, color: COL.ink });
      val(ws.getCell(r, 3), x.interpretation || '', null, { align: 'left', wrap: true, color: COL.ink2 });
      val(ws.getCell(r, 4), x.action, null, { align: 'left', wrap: true, color: COL.ink, bold: true, fill: 'EEF4FC' });
      val(ws.getCell(r, 5), x.source, null, { align: 'left', color: COL.ink3 });
      [2, 3, 4].forEach((k) => { ws.getCell(r, k).alignment = { wrapText: true, vertical: 'top' }; });
      ws.getRow(r).height = Math.max(32, Math.ceil(Math.max(String(x.evidence).length, String(x.interpretation || '').length, String(x.action).length) / 55) * 14 + 8);
      r++;
    });
    if (d.comments.length) {
      r++;
      section(ws, r, 5, 'Comentários do analista'); r++;
      ['', 'Secção', 'Comentário', '', 'Autor · data'].forEach((h, i) => head(ws.getCell(r, i + 1), h, 'left'));
      ws.mergeCells(r, 3, r, 4); r++;
      d.comments.forEach((c) => {
        val(ws.getCell(r, 2), c.secName, null, { align: 'left', color: COL.ink2 });
        ws.mergeCells(r, 3, r, 4); val(ws.getCell(r, 3), c.text, null, { align: 'left', wrap: true, color: COL.ink });
        val(ws.getCell(r, 5), (c.author || 'Analista') + ' · ' + new Date(c.ts).toLocaleDateString('pt-PT'), null, { align: 'left', color: COL.ink3 });
        ws.getRow(r).height = Math.max(20, Math.ceil(c.text.length / 100) * 15 + 6);
        r++;
      });
    }
    return ws;
  }

  function logSheet(wb, d) {
    const ws = wb.addWorksheet('Registo de emissões', { views: [{ state: 'frozen', ySplit: 6 }] });
    setup(ws, [12, 7, 8, 16, 16, 11, 13, 12, 26, 15, 13, 12]);
    title(ws, 12, 'Registo de emissões', 'Cada spot planeado e emitido (inclui spots não emitidos, adicionais e compensações)', d.filters);
    const hdr = ['Data', 'Dia', 'Hora', 'Canal', 'Faixa horária', 'Secundagem', 'Rating ' + d.targetLabel, 'Custo (€)', 'Estado', 'Validade', 'Linha do plano', 'ID'];
    hdr.forEach((h, i) => head(ws.getCell(6, i + 1), h, 'left'));
    let r = 7;
    d.rows.forEach((x) => {
      const cells = [x.date, x.dow, x.time || '', x.channel, x.daypart, x.duration, x.rating, x.cost, x.status, x.valid ? 'Válida' : 'Não conforme', x.planId || '', x.id];
      cells.forEach((v, i) => {
        const c = ws.getCell(r, i + 1);
        c.value = v === null || v === undefined ? '' : v;
        c.font = { size: 10, color: { argb: A(i === 9 && !x.valid ? COL.badFg : COL.ink) } };
        c.border = { bottom: thin };
      });
      ws.getCell(r, 1).numFmt = 'dd/mm/yyyy'; ws.getCell(r, 7).numFmt = FMT.d2; ws.getCell(r, 8).numFmt = FMT.eur; ws.getCell(r, 6).numFmt = '0"″"';
      r++;
    });
    ws.autoFilter = { from: { row: 6, column: 1 }, to: { row: r - 1, column: 12 } };
    return ws;
  }

  function methodSheet(wb, d) {
    const ws = wb.addWorksheet('Metodologia', { views: [{ showGridLines: false }] });
    setup(ws, [30, 110], false);
    title(ws, 2, 'Metodologia e definições', d.headline);
    let r = 6;
    head(ws.getCell(r, 1), 'Indicador', 'left'); head(ws.getCell(r, 2), 'Definição', 'left'); r++;
    d.method.forEach(([k, v]) => {
      val(ws.getCell(r, 1), k, null, { align: 'left', bold: true, color: COL.ink });
      val(ws.getCell(r, 2), v, null, { align: 'left', wrap: true, color: COL.ink2 });
      ws.getRow(r).height = Math.max(20, Math.ceil(v.length / 120) * 15 + 6);
      r++;
    });
    return ws;
  }

  /* ============================================================
   * GRÁFICOS NATIVOS (DrawingML) — injetados no .xlsx
   * ============================================================ */
  const xesc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const sref = (sheet, col, a, b) => "'" + sheet.replace(/'/g, "''") + "'!$" + col + '$' + a + ':$' + col + '$' + b;
  const METRIC = { grp: ['E', 'F', '#,##0'], spots: ['B', 'C', '#,##0'], cost: ['I', 'J', '#,##0 "€"'], cpp: ['L', 'M', '#,##0 "€"'] };

  function chartXml(spec, ref) {
    const [cp, cr, fmt] = METRIC[spec.metric];
    const vals = (side) => ref.list.map((x) => E().val(x[side], spec.metric));
    const strCache = '<c:strCache><c:ptCount val="' + ref.labels.length + '"/>' + ref.labels.map((l, i) => '<c:pt idx="' + i + '"><c:v>' + xesc(l) + '</c:v></c:pt>').join('') + '</c:strCache>';
    const numCache = (arr) => '<c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="' + arr.length + '"/>' + arr.map((v, i) => (isNum(v) ? '<c:pt idx="' + i + '"><c:v>' + v + '</c:v></c:pt>' : '')).join('') + '</c:numCache>';
    const txt = (sz, color, bold) => '<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="' + sz + '" b="' + (bold ? 1 : 0) + '"><a:solidFill><a:srgbClr val="' + color + '"/></a:solidFill></a:defRPr></a:pPr><a:endParaRPr lang="pt-PT"/></a:p></c:txPr>';
    const ser = (i, name, col, color) => '<c:ser><c:idx val="' + i + '"/><c:order val="' + i + '"/><c:tx><c:v>' + name + '</c:v></c:tx>' +
      '<c:spPr><a:solidFill><a:srgbClr val="' + color + '"/></a:solidFill><a:ln><a:noFill/></a:ln></c:spPr><c:invertIfNegative val="0"/>' +
      (i === 1 ? '<c:dLbls><c:numFmt formatCode="' + xesc(fmt) + '" sourceLinked="0"/><c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr>' + txt(800, COL.ink2, false) + '<c:dLblPos val="outEnd"/><c:showLegendKey val="0"/><c:showVal val="1"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="0"/><c:showBubbleSize val="0"/></c:dLbls>' : '') +
      '<c:cat><c:strRef><c:f>' + xesc(sref(ref.sheet, 'A', ref.first, ref.last)) + '</c:f>' + strCache + '</c:strRef></c:cat>' +
      '<c:val><c:numRef><c:f>' + xesc(sref(ref.sheet, col, ref.first, ref.last)) + '</c:f>' + numCache(vals(i ? 'r' : 'p')) + '</c:numRef></c:val></c:ser>';
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<c:roundedCorners val="0"/><c:chart>' +
      '<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1200" b="1"/></a:pPr><a:r><a:rPr lang="pt-PT" sz="1200" b="1"><a:solidFill><a:srgbClr val="' + COL.ink + '"/></a:solidFill></a:rPr><a:t>' + xesc(spec.title) + '</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>' +
      '<c:autoTitleDeleted val="0"/><c:plotArea><c:layout/>' +
      '<c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:varyColors val="0"/>' +
      ser(0, 'Planeado', cp, COL.plan) + ser(1, 'Real', cr, COL.real) +
      '<c:gapWidth val="70"/><c:overlap val="-8"/><c:axId val="5001"/><c:axId val="5002"/></c:barChart>' +
      '<c:catAx><c:axId val="5001"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:numFmt formatCode="General" sourceLinked="0"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="low"/>' +
      '<c:spPr><a:ln w="9525"><a:solidFill><a:srgbClr val="BFBEB8"/></a:solidFill></a:ln></c:spPr>' + txt(900, COL.ink2, false) + '<c:crossAx val="5002"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx>' +
      '<c:valAx><c:axId val="5002"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:majorGridlines><c:spPr><a:ln w="6350"><a:solidFill><a:srgbClr val="E7E6E2"/></a:solidFill></a:ln></c:spPr></c:majorGridlines>' +
      '<c:numFmt formatCode="' + xesc(fmt) + '" sourceLinked="0"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:spPr><a:ln><a:noFill/></a:ln></c:spPr>' + txt(800, COL.ink3, false) +
      '<c:crossAx val="5001"/><c:crosses val="autoZero"/><c:crossBetween val="between"/></c:valAx>' +
      '<c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr></c:plotArea>' +
      '<c:legend><c:legendPos val="t"/><c:overlay val="0"/>' + txt(900, COL.ink2, false) + '</c:legend><c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart>' +
      '<c:spPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:ln w="9525"><a:solidFill><a:srgbClr val="' + COL.line + '"/></a:solidFill></a:ln></c:spPr>' +
      '<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="900"><a:latin typeface="Calibri"/></a:defRPr></a:pPr><a:endParaRPr lang="pt-PT"/></a:p></c:txPr>' +
      '</c:chartSpace>';
  }

  function anchorXml(spec, i, rid) {
    const pt = (p) => '<xdr:col>' + p[0] + '</xdr:col><xdr:colOff>' + (p === spec.from ? 0 : 0) + '</xdr:colOff><xdr:row>' + p[1] + '</xdr:row><xdr:rowOff>0</xdr:rowOff>';
    return '<xdr:twoCellAnchor editAs="oneCell"><xdr:from>' + pt(spec.from) + '</xdr:from><xdr:to>' + pt(spec.to) + '</xdr:to>' +
      '<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="' + (i + 2) + '" name="Gráfico ' + (i + 1) + '"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>' +
      '<xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart">' +
      '<c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="' + rid + '"/>' +
      '</a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>';
  }

  async function injectCharts(buf, sheetNames, charts, refs) {
    const zip = await JSZip.loadAsync(buf);
    let ct = await zip.file('[Content_Types].xml').async('string');
    let chartN = 0, drawN = 0;
    for (let si = 0; si < sheetNames.length; si++) {
      const mine = charts.filter((c) => c.sheet === sheetNames[si]);
      if (!mine.length) continue;
      const sheetPath = 'xl/worksheets/sheet' + (si + 1) + '.xml';
      const relPath = 'xl/worksheets/_rels/sheet' + (si + 1) + '.xml.rels';
      drawN++;
      const drawPath = 'xl/drawings/drawing' + drawN + '.xml';
      const drawRels = [], anchors = [];
      mine.forEach((spec, k) => {
        chartN++;
        zip.file('xl/charts/chart' + chartN + '.xml', chartXml(spec, refs[spec.src]));
        ct = ct.replace('</Types>', '<Override PartName="/xl/charts/chart' + chartN + '.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/></Types>');
        drawRels.push('<Relationship Id="rId' + (k + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart' + chartN + '.xml"/>');
        anchors.push(anchorXml(spec, k, 'rId' + (k + 1)));
      });
      zip.file(drawPath, '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">' + anchors.join('') + '</xdr:wsDr>');
      zip.file('xl/drawings/_rels/drawing' + drawN + '.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + drawRels.join('') + '</Relationships>');
      ct = ct.replace('</Types>', '<Override PartName="/xl/drawings/drawing' + drawN + '.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>');
      // relação folha → desenho
      let rels = zip.file(relPath) ? await zip.file(relPath).async('string') : '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
      const rid = 'rIdDrw' + drawN;
      rels = rels.replace('</Relationships>', '<Relationship Id="' + rid + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing' + drawN + '.xml"/></Relationships>');
      zip.file(relPath, rels);
      let sx = await zip.file(sheetPath).async('string');
      if (!/xmlns:r=/.test(sx.slice(0, 600))) sx = sx.replace('<worksheet ', '<worksheet xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ');
      const tag = '<drawing r:id="' + rid + '"/>';
      const m = sx.match(/<(legacyDrawing|legacyDrawingHF|picture|oleObjects|controls|webPublishItems|tableParts|extLst)[\s>/]/);
      sx = m ? sx.slice(0, m.index) + tag + sx.slice(m.index) : sx.replace('</worksheet>', tag + '</worksheet>');
      zip.file(sheetPath, sx);
    }
    zip.file('[Content_Types].xml', ct);
    return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', compression: 'DEFLATE' });
  }

  /* ============================================================
   * API
   * ============================================================ */
  async function build(d) {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'TV Post-Buy'; wb.created = new Date();
    wb.title = 'Relatório de Performance — ' + (d.meta.campanha || 'Campanha TV');
    const charts = [], refs = {};
    summarySheet(wb, d, charts);
    Object.keys(DIM).forEach((k) => dimSheet(wb, d, k, charts, refs));
    conclusionsSheet(wb, d);
    logSheet(wb, d);
    methodSheet(wb, d);
    const names = wb.worksheets.map((w) => w.name);
    const buf = await wb.xlsx.writeBuffer();
    return injectCharts(buf, names, charts, refs);
  }
  const available = () => !!(window.ExcelJS && window.JSZip);

  return { build, available };
})();

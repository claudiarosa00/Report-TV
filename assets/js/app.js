/* =============================================================================
 * app.js — Estado, filtros e renderização das secções do dashboard
 * ========================================================================== */
(function () {
  const cfg = TV.config, E = TV.engine, U = TV.ui, F = TV.ui.fmt, C = TV.charts, I = TV.insights;
  const isNum = E.isNum;
  const BASE = { channels: cfg.channels.slice(), targets: cfg.targets.map((t) => Object.assign({}, t)), durations: cfg.durations.slice() };
  const resetDims = () => { cfg.channels = BASE.channels.slice(); cfg.targets = BASE.targets.map((t) => Object.assign({}, t)); cfg.durations = BASE.durations.slice(); };

  /* ---------- armazenamento local (comentários, recomendações, preferências) ---------- */
  const LS = { comments: 'tvpb.comments', recos: 'tvpb.recos', prefs: 'tvpb.prefs', cfg: 'tvpb.cfg' };
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
  };

  /* ---------- estado ---------- */
  const S = {
    raw: null, model: null,
    f: { from: null, to: null, channels: [], dayparts: [], durations: [], dows: [], weeks: [] },
    target: cfg.buyTarget, ind: 'grp', attr: 'aired', view: 'client', theme: 'auto',
    ui: { dpShare: 'spots', hmDpDow: 'dev', chShare: 'cost', duGrp: 'grp', duCpp: 'cpp', evo: 'date', eff: 'channel', wf: 'channel', opp: 'all', log: 'real', qStatus: 'all', hmChDp: 'grpDev', cd: { channel: 'grp', daypart: 'grp', duration: 'grp', week: 'grp' } }
  };
  let ctx = null;
  const ms = {};
  const $ = (id) => document.getElementById(id);
  const targetObj = (t) => cfg.targets.find((x) => x.code === t) || { code: t, label: t };
  const indDef = (k) => E.indicators[k];
  const tol = () => cfg.tolerance;

  /* ============================================================
   * CÁLCULO DO CONTEXTO (tudo o que as secções precisam)
   * ============================================================ */
  function compute() {
    const fr = E.filter(S.model, S.f, S.attr);
    const t = S.target;
    const s = E.summary(S.model, fr, t);
    const dp = I.enrich(E.compare(fr, 'daypart', t));
    const ch = I.enrich(E.compare(fr, 'channel', t));
    const du = I.enrich(E.compare(fr, 'duration', t));
    const dw = I.enrich(E.compare(fr, 'dow', t));
    const wk = I.enrich(E.compare(fr, 'week', t));
    const opp = E.opportunities(fr, t);

    const q = { out: 0, sub: 0, dur: 0, comp: 0, add: 0, ok: 0, compGrp: 0, invalid: 0, invalidGrp: 0, notAired: fr.notAired.length };
    fr.real.forEach((r) => {
      const g = r.ratings[t] || 0;
      if (r.status === 'fora_faixa') q.out++;
      if (r.status === 'substituicao') q.sub++;
      if (r.status === 'desvio_secundagem') q.dur++;
      if (r.status === 'compensacao') { q.comp++; q.compGrp += g; }
      if (r.status === 'adicional') q.add++;
      if (r.status === 'emitido') q.ok++;
      if (!r.valid) { q.invalid++; q.invalidGrp += g; }
    });

    const x = E.cross(fr, 'channel', 'daypart', t);
    let worstCell = null;
    x.rows.forEach((c) => x.cols.forEach((d) => {
      const cell = x.cell(c, d); if (!cell || !isNum(cell.p.grp) || !isNum(cell.r.grp)) return;
      const dv = cell.r.grp - cell.p.grp;
      if (!worstCell || dv < worstCell.dev) worstCell = { channel: c, daypart: d, dev: dv, pct: E.devPct(cell.r.grp, cell.p.grp) };
    }));
    if (worstCell && worstCell.dev >= 0) worstCell = null;

    const top = ch.map((o) => ({ l: o.label, d: o.grpDev })).concat(dp.map((o) => ({ l: 'faixa ' + o.label, d: o.grpDev })))
      .filter((o) => isNum(o.d) && Math.abs(o.d) > 0.5).sort((a, b) => Math.abs(b.d) - Math.abs(a.d)).slice(0, 3);
    const topDevText = top.length ? top.map((o) => o.l + ' (' + F.signed(o.d, 1) + ' GRPs)').join('; ') + '.' : '';

    const primeDp = cfg.dayparts.find((d) => d.prime);
    ctx = { fr, t, s, dp, ch, du, dw, wk, opp, quality: q, worstCell, topDevText, targetLabel: targetObj(t).label, primeKey: primeDp ? primeDp.code : null };
    ctx.recos = I.recommendations(ctx);
    return ctx;
  }

  /* ============================================================
   * HELPERS DE TABELA (colunas planeado/realizado/desvio)
   * ============================================================ */
  const hlPct = (dir) => (r, v) => { const st = E.status(v, dir); return Math.abs(v) > 2 * tol() ? (st === 'neg' ? 'neg' : st === 'pos' ? 'pos' : null) : null; };
  function pctCol(key, label, get, dir, tip) {
    return { key, label, tip, raw: get, html: (r) => U.badge(get(r), dir), hl: (r) => (isNum(get(r)) ? hlPct(dir)(r, get(r)) : null) };
  }
  const numCol = (key, label, get, dec, tip) => ({ key, label, tip, raw: get, html: (r) => F.n(get(r), dec) });
  const eurCol = (key, label, get, tip) => ({ key, label, tip, raw: get, html: (r) => F.eur(get(r)) });
  const shareCol = (key, label, get) => ({ key, label, raw: (r) => (isNum(get(r)) ? get(r) * 100 : null), html: (r) => F.pct(isNum(get(r)) ? get(r) * 100 : null) });
  function sumFooter(list, firstKey) {
    const p = E.agg([].concat(...list.map((x) => x.pRows)), S.target), r = E.agg([].concat(...list.map((x) => x.rRows)), S.target);
    const fx = E.effects(p, r);
    const o = {}; o[firstKey] = 'Total';
    Object.assign(o, {
      sp: F.n(p.spots), sr: F.n(r.spots), sd: U.badge(E.devPct(r.spots, p.spots), 'higher'),
      gp: F.n(p.grp, 1), gr: F.n(r.grp, 1), gdv: F.signed(E.dev(r.grp, p.grp), 1), gd: U.badge(E.devPct(r.grp, p.grp), 'higher'),
      rp: F.n(E.div(p.grp, p.rated), 2), rr: F.n(E.div(r.grp, r.rated), 2), rd: U.badge(E.devPct(E.div(r.grp, r.rated), E.div(p.grp, p.rated)), 'higher'),
      ip: F.eur(p.cost), ir: F.eur(r.cost), cp: F.eur(E.div(p.cost, p.grp)), cr: F.eur(E.div(r.cost, r.grp)),
      cd: U.badge(E.devPct(E.div(r.cost, r.grp), E.div(p.cost, p.grp)), 'lower'), wp: '100%', wr: '100%', spP: '100%', spR: '100%',
      fv: F.signed(fx.volume, 1), fa: F.signed(fx.audience, 1), e3p: F.n(p.eq30, 1), e3r: F.n(r.eq30, 1), ipP: '100%', ipR: '100%'
    });
    return o;
  }
  function cmpColumns(firstKey, firstLabel) {
    return [
      { key: firstKey, label: firstLabel, align: 'l', raw: (r) => r.sortKey !== undefined ? r.sortKey : r.label, html: (r) => '<b>' + U.esc(r.label) + '</b>' },
      numCol('sp', 'Spots P', (r) => r.p.spots), numCol('sr', 'Spots R', (r) => r.r.spots),
      pctCol('sd', 'Δ Spots', (r) => r.spotPct, 'higher', 'Desvio de entrega: (spots realizados − planeados) ÷ planeados'),
      numCol('gp', 'GRPs P', (r) => r.p.grp, 1), numCol('gr', 'GRPs R', (r) => r.r.grp, 1),
      { key: 'gdv', label: 'Δ GRPs', raw: (r) => r.grpDev, html: (r) => F.signed(r.grpDev, 1) },
      pctCol('gd', 'Δ GRPs %', (r) => r.grpPct, 'higher'),
      numCol('rp', 'Rating P', (r) => r.ratingP, 2), numCol('rr', 'Rating R', (r) => r.ratingR, 2),
      pctCol('rd', 'Δ Rating', (r) => r.ratingPct, 'higher', 'Desvio de audiência: variação do rating médio por spot'),
      eurCol('ip', 'Invest. P', (r) => r.p.cost), eurCol('ir', 'Invest. R', (r) => r.r.cost),
      eurCol('cp', 'CPP P', (r) => r.cppP), eurCol('cr', 'CPP R', (r) => r.cppR),
      pctCol('cd', 'Δ CPP', (r) => r.cppPct, 'lower', 'Menor é melhor')
    ];
  }

  /* ============================================================
   * 01 — RESUMO EXECUTIVO
   * ============================================================ */
  function kpiTile(o) {
    if (o.na) {
      return '<div class="kpi na' + (o.tech ? ' tech-only' : '') + '"><div class="kpi-label"><span>' + U.esc(o.label) + U.info(o.tip) + '</span><span class="badge na">n.d.</span></div>' +
        '<div class="kpi-value">Indisponível</div><div class="kpi-plan"><span>' + U.esc(o.naText) + '</span></div></div>';
    }
    const d = E.dev(o.r, o.p), pct = E.devPct(o.r, o.p);
    const ratio = isNum(o.r) && isNum(o.p) && o.p > 0 ? Math.max(0, Math.min(1.5, o.r / o.p)) : null;
    return '<div class="kpi' + (o.hero ? ' hero' : '') + (o.tech ? ' tech-only' : '') + '">' +
      '<div class="kpi-label"><span>' + U.esc(o.label) + (o.tip ? U.info(o.tip) : '') + '</span>' + U.badge(pct, o.dir) + '</div>' +
      '<div class="kpi-value">' + o.f(o.r) + '</div>' +
      '<div class="kpi-plan"><span>Plano ' + o.f(o.p) + '</span><span>Δ ' + (o.fd ? o.fd(d) : F.signed(d, o.dec || 0)) + '</span></div>' +
      (ratio !== null ? '<div class="kpi-bar" title="Realizado em % do planeado"><b style="width:' + (ratio / 1.5 * 100) + '%"></b><em style="left:66.67%"></em></div>' : '') +
      '</div>';
  }

  function renderSummary() {
    const { s } = ctx;
    const t = targetObj(S.target), bt = targetObj(cfg.buyTarget);
    const rating = (a) => E.div(a.grp, a.rated);
    const cpm = (a) => E.val(a, 'cpm');
    const aud = (a) => E.val(a, 'avgAud');
    const tiles = [
      { label: 'Investimento', tip: 'Custo líquido planeado vs faturado (compensações a custo zero).', r: s.r.cost, p: s.p.cost, dir: 'neutral', f: (v) => F.eur(v), fd: (v) => F.signed(v, 0, ' €') },
      { label: 'GRPs · ' + t.label, tip: 'Gross Rating Points = soma dos ratings (%) de todos os spots no target selecionado.', r: s.r.grp, p: s.p.grp, dir: 'higher', f: (v) => F.n(v, 1), dec: 1, hero: true },
      { tech: true, label: 'TRPs · ' + bt.label, tip: 'Target Rating Points = soma dos ratings no target de compra da campanha (' + bt.label + ').' + (S.target === cfg.buyTarget ? ' O target selecionado é o target de compra, pelo que TRPs = GRPs.' : ''), r: s.rT.grp, p: s.pT.grp, dir: 'higher', f: (v) => F.n(v, 1), dec: 1 },
      { label: 'Nº de spots', tip: 'Spots emitidos (inclui adicionais, compensações e emissões fora de condições) vs planeados.', r: s.r.spots, p: s.p.spots, dir: 'higher', f: (v) => F.n(v) },
      { tech: true, label: 'Audiência média por spot', tip: 'Contactos médios por spot = rating médio × universo do target (' + F.n(t.universe || 0) + ' ind.).', r: aud(s.r), p: aud(s.p), dir: 'higher', f: (v) => F.compact(v), fd: (v) => F.signed(v, 0), na: !t.universe, naText: 'Universo do target não definido.' },
      { label: 'Rating médio', tip: 'GRPs ÷ nº de spots com audiência.', r: rating(s.r), p: rating(s.p), dir: 'higher', f: (v) => F.n(v, 2) + '%', fd: (v) => F.signed(v, 2, ' p.p.') },
      s.reach.available
        ? { label: 'Cobertura 1+', tip: '% do target exposto pelo menos uma vez. Valor deduplicado do software de audiências (não é soma de canais/faixas).', r: s.reach.real.r1, p: s.reach.plan.r1, dir: 'higher', f: (v) => F.pct(v), fd: (v) => F.signed(v, 1, ' p.p.') }
        : { label: 'Cobertura 1+', tip: 'Requer dados deduplicados.', na: true, naText: s.reach.reason },
      s.reach.available && isNum(s.reach.real.r3)
        ? { tech: true, label: 'Cobertura 3+', tip: '% do target exposto 3 ou mais vezes (deduplicado).', r: s.reach.real.r3, p: s.reach.plan.r3, dir: 'higher', f: (v) => F.pct(v), fd: (v) => F.signed(v, 1, ' p.p.') }
        : { tech: true, label: 'Cobertura 3+', tip: 'Requer dados deduplicados.', na: true, naText: s.reach.reason || 'Sem dados de cobertura 3+.' },
      s.reach.available
        ? { tech: true, label: 'Frequência média', tip: 'GRPs ÷ Cobertura 1+ (mesmo target, total da campanha).', r: s.reach.freqR, p: s.reach.freqP, dir: 'neutral', f: (v) => F.n(v, 1), dec: 1 }
        : { tech: true, label: 'Frequência média', tip: 'Requer cobertura deduplicada.', na: true, naText: 'Não calculável sem cobertura deduplicada.' },
      { label: 'CPP', tip: 'Cost per Point = investimento ÷ GRPs. Menor é melhor.', r: E.div(s.r.cost, s.r.grp), p: E.div(s.p.cost, s.p.grp), dir: 'lower', f: (v) => F.eur(v), fd: (v) => F.signed(v, 0, ' €') },
      { tech: true, label: 'CPM', tip: 'Cost per Mille = investimento ÷ (contactos ÷ 1000). Menor é melhor.', r: cpm(s.r), p: cpm(s.p), dir: 'lower', f: (v) => F.eur(v, 2), fd: (v) => F.signed(v, 2, ' €'), na: !t.universe, naText: 'Universo do target não definido.' },
      { tech: true, label: 'Segundos emitidos', tip: 'Soma das durações dos spots.', r: s.r.seconds, p: s.p.seconds, dir: 'neutral', f: (v) => F.n(v) + ' s', fd: (v) => F.signed(v, 0, ' s') }
    ];
    $('kpis').innerHTML = tiles.map(kpiTile).join('');

    const c = s.compliance;
    const col = { pos: 'var(--good)', tol: 'var(--plan)', neg: 'var(--bad)', na: 'var(--surface-3)' };
    const gauge = (v, st) => '<div class="gauge"><b style="width:' + (isNum(v) ? Math.min(100, (v / 1.2) * 100) : 0) + '%;background:' + col[st] + '"></b><em></em></div><div class="gauge-scale"><span>0%</span><span>100%</span><span>120%</span></div>';
    const comp = (title, tip, desc, v, st) => '<div class="comp"><h4><span>' + title + ' ' + U.info(tip) + '</span>' + U.statusBadge(st, { pos: 'Acima', tol: 'Na tolerância', neg: 'Abaixo', na: 'n.d.' }[st]) + '</h4><div class="desc">' + desc + '</div><div class="big">' + (isNum(v) ? F.pct(v * 100, 1) : '—') + '</div>' + gauge(v, st) + '</div>';
    const verdict = { pos: ['Plano cumprido', 'var(--good)'], tol: ['Cumprido parcialmente', 'var(--warn)'], neg: ['Plano não cumprido', 'var(--bad)'], na: ['Indeterminado', 'var(--text-3)'] }[c.overall];
    const vtxt = { pos: 'Plano cumprido', tol: 'Plano cumprido parcialmente', neg: 'Plano não cumprido', na: 'Sem dados suficientes' }[c.overall];
    const vcol = { pos: 'var(--good)', tol: 'var(--warn)', neg: 'var(--bad)', na: 'var(--plan)' }[c.overall];
    const gp = E.devPct(s.r.grp, s.p.grp), cp = E.devPct(E.div(s.r.cost, s.r.grp), E.div(s.p.cost, s.p.grp));
    ctx.verdict = { st: c.overall, title: vtxt, text: 'Foram entregues ' + F.n(s.r.grp, 1) + ' GRPs (' + ctx.targetLabel + ') face a ' + F.n(s.p.grp, 1) + ' planeados (' + F.signedPct(gp) + '), com ' + F.n(s.r.spots) + ' spots emitidos (' + F.n(s.p.spots) + ' planeados) e um custo por ponto de ' + F.eur(E.div(s.r.cost, s.r.grp)) + ' (' + F.signedPct(cp) + ' face ao plano).' };
    $('verdict').style.setProperty('--vcol', vcol);
    $('verdict').innerHTML = '<b>' + vtxt + '</b><p>Foram entregues <b>' + F.n(s.r.grp, 1) + ' GRPs</b> (' + U.esc(ctx.targetLabel) + ') face a ' + F.n(s.p.grp, 1) + ' planeados (' + F.signedPct(gp) + '), com ' +
      F.n(s.r.spots) + ' spots emitidos (' + F.n(s.p.spots) + ' planeados) e um custo por ponto de ' + F.eur(E.div(s.r.cost, s.r.grp)) + ' (' + F.signedPct(cp) + ' face ao plano).</p>';
    $('compliance').innerHTML =
      '<div class="comp overall"><h4><span>Cumprimento global do plano ' + U.info('Plano cumprido: as três dimensões estão acima ou dentro da tolerância. Parcial: uma abaixo. Não cumprido: duas ou mais abaixo.') + '</span></h4>' +
      '<div class="verdict"><span class="dot" style="background:' + verdict[1] + '"></span>' + verdict[0] + '</div>' +
      '<div class="desc">Índice médio ' + (isNum(c.score) ? F.pct(c.score * 100, 0) : '—') + ' · tolerância ±' + tol() + '% · ' + U.esc(ctx.targetLabel) + '</div></div>' +
      comp('Volume', 'Spots do plano emitidos nas condições contratadas ÷ spots planeados. Não inclui adicionais nem compensações.', 'Spots do plano emitidos em condições válidas', c.volume, c.parts[0]) +
      comp('Audiência', 'GRPs realizados ÷ GRPs planeados (todas as emissões).', 'GRPs realizados vs planeados', c.audience, c.parts[1]) +
      comp('Eficiência de custo', 'CPP planeado ÷ CPP realizado. Acima de 100% = cada ponto custou menos do que o previsto.', 'CPP planeado ÷ CPP realizado', c.costEff, c.parts[2]);

    $('qa').innerHTML = I.qa(ctx).map((q, i) => '<div class="qa-item"><span class="n">' + (i + 1) + '</span><div><b>' + U.esc(q[0]) + '</b><p>' + U.esc(q[1]) + '</p></div></div>').join('');
  }

  /* ============================================================
   * VISTA CLIENTE — canal, faixa, secundagem e semana (planeado vs real)
   * ============================================================ */
  const CLIENT_DIMS = { channel: 'Canal', daypart: 'Faixa horária', duration: 'Secundagem', week: 'Semana' };
  function renderClientDims() {
    Object.keys(CLIENT_DIMS).forEach((dim) => {
      const list = { channel: ctx.ch, daypart: ctx.dp, duration: ctx.du, week: ctx.wk }[dim];
      const m = S.ui.cd[dim], d = indDef(m);
      const P = (x) => E.val(x.p, m), R = (x) => E.val(x.r, m);
      const unit = d.unit === '€' ? ' €' : '';
      C.planReal('cd-' + dim, list.map((x) => x.label), list.map(P), list.map(R), (v) => F.ind(v, m, true), {
        afterBody: (i) => ['Diferença: ' + F.signed(E.dev(R(list[i]), P(list[i])), d.dec, unit), 'Desvio: ' + F.signedPct(E.devPct(R(list[i]), P(list[i])))]
      });

      // Frase de leitura: total e maiores desvios
      const totP = E.val(ctx.s.p, m), totR = E.val(ctx.s.r, m);
      $('lead-' + dim).innerHTML = I.lead(list, m, totP, totR).map((g) => (g.cls === 'b' ? '<b>' + U.esc(g.text) + '</b>' : g.cls ? '<span class="' + g.cls + '">' + U.esc(g.text) + '</span>' : U.esc(g.text))).join('');

      const tp = list.reduce((a, x) => a + (P(x) || 0), 0), tr = list.reduce((a, x) => a + (R(x) || 0), 0);
      list.forEach((x, i) => { x.sortKey = i; });
      const cols = [
        { key: 'k', label: CLIENT_DIMS[dim], align: 'l', raw: (r) => r.sortKey, html: (r) => (dim === 'channel' ? '<i style="display:inline-block;width:9px;height:9px;border-radius:3px;margin-right:6px;background:' + C.channelColor(r.label) + '"></i>' : '') + '<b>' + U.esc(r.label) + '</b>' },
        { key: 'p', label: 'Planeado', raw: P, html: (r) => F.ind(P(r), m) },
        { key: 'r', label: 'Real', raw: R, html: (r) => '<b>' + F.ind(R(r), m) + '</b>' },
        { key: 'dv', label: 'Diferença', raw: (r) => E.dev(R(r), P(r)), html: (r) => F.signed(E.dev(R(r), P(r)), d.dec, unit) },
        { key: 'pc', label: 'Desvio', raw: (r) => E.devPct(R(r), P(r)), html: (r) => U.badge(E.devPct(R(r), P(r)), d.dir) }
      ];
      if (d.additive) cols.push({ key: 'w', label: 'Peso plano → real', tip: '% do total planeado → % do total realizado', raw: (r) => (tr ? 100 * (R(r) || 0) / tr : null), html: (r) => F.pct(tp ? 100 * (P(r) || 0) / tp : null) + ' → ' + F.pct(tr ? 100 * (R(r) || 0) / tr : null), csv: 'Peso real %' });
      const foot = { k: 'Total', p: F.ind(totP, m), r: '<b>' + F.ind(totR, m) + '</b>', dv: F.signed(E.dev(totR, totP), d.dec, unit), pc: U.badge(E.devPct(totR, totP), d.dir), w: '100%' };
      U.table('cdt-' + dim, { columns: cols, rows: list, footer: foot, exportName: 'planeado_vs_real_' + dim + '_' + m, title: CLIENT_DIMS[dim] + ' ' + d.label });
    });
  }

  /* ============================================================
   * 02 — FAIXAS HORÁRIAS
   * ============================================================ */
  function renderDayparts() {
    const dp = ctx.dp;
    const labels = dp.map((x) => x.label);
    $('dpGrpHint').textContent = ctx.targetLabel + ' · clique numa barra para filtrar pela faixa';
    C.planReal('chDpGrp', labels, dp.map((x) => x.p.grp), dp.map((x) => x.r.grp), (v) => F.n(v, 1), {
      afterBody: (i) => ['Desvio GRPs: ' + F.signed(dp[i].grpDev, 1) + ' (' + F.signedPct(dp[i].grpPct) + ')', 'Spots: ' + dp[i].p.spots + ' → ' + dp[i].r.spots + ' (' + F.signedPct(dp[i].spotPct) + ')', 'Rating médio: ' + F.signedPct(dp[i].ratingPct)],
      onClick: (e, els) => { if (els.length) { const k = dp[els[0].index].key; ms.dayparts.set([k]); S.f.dayparts = [k]; update(); } }
    });

    const v = U.cssVar;
    C.make('chDpDev', {
      type: 'bar',
      data: {
        labels, datasets: [
          { label: 'Entrega (spots)', data: dp.map((x) => x.spotPct), backgroundColor: v('--fx-volume'), borderRadius: 4, maxBarThickness: 16, categoryPercentage: 0.7 },
          { label: 'Audiência (rating médio)', data: dp.map((x) => x.ratingPct), backgroundColor: v('--fx-audience'), borderRadius: 4, maxBarThickness: 16, categoryPercentage: 0.7 }
        ]
      },
      options: {
        indexAxis: 'y', interaction: { mode: 'index', intersect: false },
        scales: {
          x: { grid: { color: (c) => (c.tick.value === 0 ? v('--text-3') : v('--border')) }, border: { display: false }, ticks: { callback: (x) => x + '%' } },
          y: { grid: { display: false } }
        },
        plugins: { tooltip: { callbacks: { label: (c) => ' ' + c.dataset.label + ': ' + F.signedPct(c.raw), footer: (it) => 'GRPs: ' + F.signedPct(dp[it[0].dataIndex].grpPct) + ' · tolerância ±' + tol() + '%' } } }
      }
    });

    C.effects('chDpFx', labels, dp.map((x) => x.volume), dp.map((x) => x.audience));

    const m = S.ui.dpShare;
    const tot = (side) => dp.reduce((a, x) => a + (E.val(x[side], m) || 0), 0);
    const tp = tot('p'), tr = tot('r');
    C.share('chDpShare', labels, dp.map((x) => (tp ? 100 * (E.val(x.p, m) || 0) / tp : null)), dp.map((x) => (tr ? 100 * (E.val(x.r, m) || 0) / tr : null)));

    // Heatmap faixa × dia da semana
    const ind = S.ind, d = indDef(ind);
    const x = E.cross(ctx.fr, 'daypart', 'dow', S.target);
    const mode = S.ui.hmDpDow;
    $('hmDpDowHint').textContent = d.label + (mode === 'dev' ? ' — desvio % realizado vs planeado' + (d.dir === 'lower' ? ' (menor é melhor: azul = mais barato)' : ' (azul = acima do plano)') : ' — valor realizado') + ' · indicador definido no filtro global';
    U.heatmap('hmDpDow', {
      rows: x.rows, cols: x.cols, rowName: (k) => k, colName: (k) => cfg.weekdaysShort[k], corner: 'Faixa \\ Dia',
      scale: mode === 'dev' ? 'div' : 'seq', invert: d.dir === 'lower',
      legend: mode === 'dev' ? (d.dir === 'lower' ? ['Mais barato', 'Mais caro', 'cinzento = em linha'] : ['Abaixo do plano', 'Acima do plano', 'cinzento = em linha']) : ['Menor', 'Maior'],
      cell: (r, c) => {
        const cell = x.cell(r, c); if (!cell) return null;
        const pv = E.val(cell.p, ind), rv = E.val(cell.r, ind), pct = E.devPct(rv, pv);
        const tip = '<b>' + r + ' · ' + cfg.weekdays[c] + '</b>' + d.label + ' plano: ' + F.ind(pv, ind) + '<br>' + d.label + ' real: ' + F.ind(rv, ind) + '<br>Desvio: ' + F.signedPct(pct) + '<br>Spots: ' + cell.p.spots + ' → ' + cell.r.spots;
        return mode === 'dev' ? { v: pct, text: F.signedPct(pct, 0), tip } : { v: rv, text: F.ind(rv, ind, true), tip };
      }
    });

    const cols = cmpColumns('k', 'Faixa').concat([
      shareCol('spP', 'Peso spots P', (r) => r.sP), shareCol('spR', 'Peso spots R', (r) => r.sR),
      shareCol('wp', 'Peso GRPs P', (r) => r.wP), shareCol('wr', 'Peso GRPs R', (r) => r.wR),
      { key: 'fv', label: 'Efeito volume', tip: 'Δ spots × rating planeado (GRPs)', raw: (r) => r.volume, html: (r) => F.signed(r.volume, 1) },
      { key: 'fa', label: 'Efeito audiência', tip: 'Spots reais × Δ rating (GRPs)', raw: (r) => r.audience, html: (r) => F.signed(r.audience, 1) }
    ]);
    dp.forEach((r, i) => { r.sortKey = i; });
    U.table('tbDp', { columns: cols, rows: dp, footer: sumFooter(dp, 'k'), exportName: 'faixas_horarias', title: 'Faixas horarias' });
  }

  /* ============================================================
   * 03 — CANAIS
   * ============================================================ */
  function renderChannels() {
    const ch = ctx.ch, labels = ch.map((x) => x.label);
    C.planReal('chChGrp', labels, ch.map((x) => x.p.grp), ch.map((x) => x.r.grp), (v) => F.n(v, 1), {
      afterBody: (i) => ['Desvio: ' + F.signed(ch[i].grpDev, 1) + ' GRPs (' + F.signedPct(ch[i].grpPct) + ')', 'Rating médio: ' + F.n(ch[i].ratingP, 2) + '% → ' + F.n(ch[i].ratingR, 2) + '%'],
      onClick: (e, els) => { if (els.length) { const k = ch[els[0].index].key; ms.channels.set([k]); S.f.channels = [k]; update(); } }
    });
    const m = S.ui.chShare;
    const tp = ch.reduce((a, x) => a + (E.val(x.p, m) || 0), 0), tr = ch.reduce((a, x) => a + (E.val(x.r, m) || 0), 0);
    C.share('chChShare', labels, ch.map((x) => (tp ? 100 * (E.val(x.p, m) || 0) / tp : null)), ch.map((x) => (tr ? 100 * (E.val(x.r, m) || 0) / tr : null)));
    C.planReal('chChCpp', labels, ch.map((x) => x.cppP), ch.map((x) => x.cppR), (v) => F.eur(v), { afterBody: (i) => ['Desvio CPP: ' + F.signedPct(ch[i].cppPct) + ' (menor é melhor)'] });
    C.deviation('chChDev', labels, ch.map((x) => x.grpPct), { label: 'Desvio GRPs', afterLabel: (i) => ' ' + F.signed(ch[i].grpDev, 1) + ' GRPs' });

    const cppAvg = E.div(ctx.s.r.cost, ctx.s.r.grp);
    const totDev = ch.reduce((a, x) => a + (x.grpDev || 0), 0);
    const totR = ch.reduce((a, x) => a + (x.r.grp || 0), 0);
    const totCostP = ch.reduce((a, x) => a + x.p.cost, 0), totCostR = ch.reduce((a, x) => a + x.r.cost, 0);
    const clamp = (v) => (isNum(v) ? Math.max(0, Math.min(2, v)) : 1);
    const rows = ch.map((x) => Object.assign(x, {
      score: 100 * (0.4 * clamp(E.div(cppAvg, x.cppR)) + 0.35 * clamp(E.div(x.ratingR, x.ratingP)) + 0.25 * clamp(E.div(x.r.grp, x.p.grp))),
      contribR: E.div(x.r.grp, totR), contribDev: x.grpDev,
      invP: E.div(x.p.cost, totCostP), invR: E.div(x.r.cost, totCostR)
    }));
    const ranked = rows.slice().sort((a, b) => b.score - a.score);
    ranked.forEach((x, i) => { x.rank = i + 1; });
    const cls = (x) => (x.rank === 1 ? U.statusBadge('pos', 'Melhor') : x.rank === ranked.length && ranked.length > 1 ? U.statusBadge('neg', 'Pior') : '');
    U.table('tbCh', {
      columns: [
        { key: 'rank', label: '#', raw: (r) => r.rank, html: (r) => r.rank },
        { key: 'k', label: 'Canal', align: 'l', raw: (r) => r.label, html: (r) => '<i style="display:inline-block;width:9px;height:9px;border-radius:3px;margin-right:6px;background:' + C.channelColor(r.label) + '"></i><b>' + U.esc(r.label) + '</b> ' + cls(r) },
        { key: 'score', label: 'Pontuação', tip: '100 = em linha com plano e média de custo', raw: (r) => r.score, html: (r) => '<b>' + F.n(r.score, 0) + '</b>' },
        shareCol('invP', 'Peso invest. P', (r) => r.invP), shareCol('invR', 'Peso invest. R', (r) => r.invR),
        numCol('sp', 'Spots P', (r) => r.p.spots), numCol('sr', 'Spots R', (r) => r.r.spots),
        numCol('gp', 'GRPs P', (r) => r.p.grp, 1), numCol('gr', 'GRPs R', (r) => r.r.grp, 1),
        pctCol('gd', 'Δ GRPs %', (r) => r.grpPct, 'higher'),
        numCol('rp', 'Rating P', (r) => r.ratingP, 2), numCol('rr', 'Rating R', (r) => r.ratingR, 2),
        eurCol('cp', 'CPP P', (r) => r.cppP), eurCol('cr', 'CPP R', (r) => r.cppR), pctCol('cd', 'Δ CPP', (r) => r.cppPct, 'lower'),
        shareCol('cR', 'Contributo GRPs', (r) => r.contribR),
        { key: 'cD', label: 'Contributo p/ desvio', tip: 'GRPs do canal que explicam a diferença global (' + F.signed(totDev, 1) + ' GRPs)', raw: (r) => r.contribDev, html: (r) => F.signed(r.contribDev, 1) }
      ],
      rows: ranked, sort: { key: 'rank', dir: 'asc' }, exportName: 'canais', title: 'Canais'
    });
  }

  /* ============================================================
   * 04 — SECUNDAGEM
   * ============================================================ */
  function renderDurations() {
    const du = ctx.du, labels = du.map((x) => x.label);
    C.planReal('chDuSpots', labels, du.map((x) => x.p.spots), du.map((x) => x.r.spots), (v) => F.n(v));
    const eq = S.ui.duGrp === 'eq30';
    $('duGrpHint').textContent = eq ? 'GRPs equivalentes a 30" (GRP × índice da secundagem)' : 'GRPs brutos (sem normalização)';
    C.planReal('chDuGrp', labels, du.map((x) => (eq ? x.p.eq30 : x.p.grp)), du.map((x) => (eq ? x.r.eq30 : x.r.grp)), (v) => F.n(v, 1));
    C.planReal('chDuRating', labels, du.map((x) => x.ratingP), du.map((x) => x.ratingR), (v) => F.n(v, 2) + '%');
    const ceq = S.ui.duCpp === 'eq30';
    $('duCppHint').textContent = ceq ? 'Investimento ÷ GRPs eq. 30" — compara formatos numa base comum' : 'Investimento ÷ GRPs brutos — formatos curtos parecem mais baratos';
    C.planReal('chDuCpp', labels, du.map((x) => (ceq ? E.div(x.p.cost, x.p.eq30) : x.cppP)), du.map((x) => (ceq ? E.div(x.r.cost, x.r.eq30) : x.cppR)), (v) => F.eur(v));
    $('duRule').innerHTML = 'Regra de normalização: GRP eq. 30" = GRP × índice (' + cfg.durations.map((d) => d + '"=' + F.n(cfg.durationIndex[d] !== undefined ? cfg.durationIndex[d] : d / 30, 2)).join(' · ') + ')';
    const tsP = du.reduce((a, x) => a + x.p.cost, 0), tsR = du.reduce((a, x) => a + x.r.cost, 0);
    du.forEach((r) => { r.sortKey = r.key; r.ipP = E.div(r.p.cost, tsP); r.ipR = E.div(r.r.cost, tsR); });
    U.table('tbDu', {
      columns: [
        { key: 'k', label: 'Formato', align: 'l', raw: (r) => r.key, html: (r) => '<b>' + r.label + '</b>' },
        { key: 'idx', label: 'Índice', raw: (r) => cfg.durationIndex[r.key], html: (r) => F.n(cfg.durationIndex[r.key], 2) },
        numCol('sp', 'Spots P', (r) => r.p.spots), numCol('sr', 'Spots R', (r) => r.r.spots),
        shareCol('spP', 'Peso spots P', (r) => r.sP), shareCol('spR', 'Peso spots R', (r) => r.sR),
        eurCol('ip', 'Invest. P', (r) => r.p.cost), eurCol('ir', 'Invest. R', (r) => r.r.cost),
        shareCol('ipP', 'Peso invest. P', (r) => r.ipP), shareCol('ipR', 'Peso invest. R', (r) => r.ipR),
        numCol('gp', 'GRPs P', (r) => r.p.grp, 1), numCol('gr', 'GRPs R', (r) => r.r.grp, 1), pctCol('gd', 'Δ GRPs %', (r) => r.grpPct, 'higher'),
        numCol('e3p', 'GRPs eq.30" P', (r) => r.p.eq30, 1), numCol('e3r', 'GRPs eq.30" R', (r) => r.r.eq30, 1),
        numCol('rp', 'Rating P', (r) => r.ratingP, 2), numCol('rr', 'Rating R', (r) => r.ratingR, 2),
        eurCol('cp', 'CPP P', (r) => r.cppP), eurCol('cr', 'CPP R', (r) => r.cppR),
        eurCol('ce', 'CPP eq.30" R', (r) => E.div(r.r.cost, r.r.eq30))
      ],
      rows: du, footer: sumFooter(du, 'k'), exportName: 'secundagem', title: 'Secundagem'
    });
  }

  /* ============================================================
   * 05 — EVOLUÇÃO E DIA DA SEMANA
   * ============================================================ */
  function renderTime() {
    const ind = S.ind, d = indDef(ind);
    const fmt = (v) => F.ind(v, ind, true);
    const g = S.ui.evo;
    const list = g === 'week' ? ctx.wk : E.compare(ctx.fr, 'date', S.target);
    $('evoTitle').textContent = d.label + ' — evolução ' + (g === 'week' ? 'semanal' : 'diária');
    C.lines('chEvo', list.map((x) => x.label), list.map((x) => E.val(x.p, ind)), list.map((x) => E.val(x.r, ind)), fmt, { dec: d.dec, unit: d.unit === '€' ? ' €' : '' });

    const cumInd = d.additive ? ind : 'grp';
    const days = E.compare(ctx.fr, 'date', S.target);
    let ap = 0, ar = 0;
    const cp = [], cr = [];
    days.forEach((x) => { ap += E.val(x.p, cumInd) || 0; ar += E.val(x.r, cumInd) || 0; cp.push(ap); cr.push(ar); });
    $('cumTitle').textContent = indDef(cumInd).label + ' acumulados';
    $('cumHint').textContent = (d.additive ? '' : 'Indicador não aditivo — mostrados GRPs. ') + 'Linha azul abaixo da cinzenta = subentrega acumulada.';
    C.lines('chCum', days.map((x) => x.label), cp, cr, (v) => F.ind(v, cumInd, true), { dec: indDef(cumInd).dec });

    const dw = ctx.dw;
    $('dowTitle').textContent = d.label + ' por dia da semana';
    C.planReal('chDow', dw.map((x) => x.label.slice(0, 3)), dw.map((x) => E.val(x.p, ind)), dw.map((x) => E.val(x.r, ind)), fmt, { afterBody: (i) => ['Desvio: ' + F.signedPct(E.devPct(E.val(dw[i].r, ind), E.val(dw[i].p, ind))), 'CPP real: ' + F.eur(dw[i].cppR)] });
    dw.forEach((r) => { r.sortKey = r.key; });
    U.table('tbDow', { columns: cmpColumns('k', 'Dia'), rows: dw, footer: sumFooter(dw, 'k'), exportName: 'dia_semana', title: 'Dia da semana' });
    ctx.wk.forEach((r, i) => { r.sortKey = i; });
    U.table('tbWeek', { columns: cmpColumns('k', 'Semana'), rows: ctx.wk, footer: sumFooter(ctx.wk, 'k'), exportName: 'semanas', title: 'Semanas' });
  }

  /* ============================================================
   * 06 — CANAL × FAIXA
   * ============================================================ */
  function renderCross() {
    const x = E.cross(ctx.fr, 'channel', 'daypart', S.target);
    const m = S.ui.hmChDp;
    const defs = {
      grpDev: { lbl: 'Desvio de GRPs (%)', f: (c) => E.devPct(c.r.grp, c.p.grp), t: (v) => F.signedPct(v, 0), scale: 'div', leg: ['Abaixo', 'Acima'] },
      grpAbs: { lbl: 'Desvio de GRPs', f: (c) => E.dev(c.r.grp, c.p.grp), t: (v) => F.signed(v, 1), scale: 'div', leg: ['Subentrega', 'Sobreentrega'] },
      spotDev: { lbl: 'Desvio de spots (%)', f: (c) => E.devPct(c.r.spots, c.p.spots), t: (v) => F.signedPct(v, 0), scale: 'div', leg: ['Menos spots', 'Mais spots'] },
      ratingDev: { lbl: 'Desvio de rating médio (%)', f: (c) => E.devPct(E.div(c.r.grp, c.r.rated), E.div(c.p.grp, c.p.rated)), t: (v) => F.signedPct(v, 0), scale: 'div', leg: ['Menos audiência', 'Mais audiência'] },
      cppDev: { lbl: 'Desvio de CPP (%)', f: (c) => E.devPct(E.div(c.r.cost, c.r.grp), E.div(c.p.cost, c.p.grp)), t: (v) => F.signedPct(v, 0), scale: 'div', invert: true, leg: ['Mais barato', 'Mais caro'] },
      cppR: { lbl: 'CPP realizado', f: (c) => (c.r.cost > 0 ? E.div(c.r.cost, c.r.grp) : null), t: (v) => F.eur(v), scale: 'seq', leg: ['Mais barato', 'Mais caro'] },
      grpR: { lbl: 'GRPs realizados', f: (c) => c.r.grp, t: (v) => F.n(v, 1), scale: 'seq', leg: ['Menos', 'Mais'] }
    }[m];
    $('hmChDpHint').textContent = defs.lbl + ' · ' + ctx.targetLabel + ' · passe o rato para ver o detalhe';
    const tipOf = (title, c) => '<b>' + title + '</b>Spots: ' + c.p.spots + ' → ' + c.r.spots + '<br>GRPs: ' + F.n(c.p.grp, 1) + ' → ' + F.n(c.r.grp, 1) + ' (' + F.signedPct(E.devPct(c.r.grp, c.p.grp)) + ')<br>Rating médio: ' + F.n(E.div(c.p.grp, c.p.rated), 2) + '% → ' + F.n(E.div(c.r.grp, c.r.rated), 2) + '%<br>CPP: ' + F.eur(E.div(c.p.cost, c.p.grp)) + ' → ' + F.eur(E.div(c.r.cost, c.r.grp));
    const rowAgg = (key, dim) => { const l = (dim === 'channel' ? ctx.ch : ctx.dp).find((o) => o.key === key); return l ? { p: l.p, r: l.r } : null; };
    U.heatmap('hmChDp', {
      rows: x.rows, cols: x.cols, rowName: (k) => k, colName: (k) => k, corner: 'Canal \\ Faixa', scale: defs.scale, invert: defs.invert, legend: defs.leg,
      cell: (r, c) => { const cell = x.cell(r, c); if (!cell) return null; const v = defs.f(cell); return { v, text: defs.t(v), tip: tipOf(r + ' · ' + c, cell) }; },
      rowTotal: (r) => { const a = rowAgg(r, 'channel'); const v = a ? defs.f(a) : null; return { text: defs.t(v), tip: a ? tipOf(r + ' · total', a) : '' }; },
      colTotal: (c) => { const a = rowAgg(c, 'daypart'); const v = a ? defs.f(a) : null; return { text: defs.t(v), tip: a ? tipOf(c + ' · total', a) : '' }; }
    });

    // Concentração da subentrega
    let neg = 0; const byCh = {}, byDp = {}; let worst = null;
    x.rows.forEach((c) => x.cols.forEach((d) => {
      const cell = x.cell(c, d); if (!cell || !isNum(cell.r.grp) || !isNum(cell.p.grp)) return;
      const dv = cell.r.grp - cell.p.grp; if (dv >= 0) return;
      neg += -dv; byCh[c] = (byCh[c] || 0) - dv; byDp[d] = (byDp[d] || 0) - dv;
      if (!worst || dv < worst.dv) worst = { c, d, dv };
    }));
    const top = (o) => Object.keys(o).sort((a, b) => o[b] - o[a])[0];
    if (neg > 0) {
      const tc = top(byCh), td = top(byDp);
      $('concNote').innerHTML = '<b>Concentração da subentrega</b> (soma das células abaixo do plano: ' + F.n(neg, 1) + ' GRPs): ' +
        F.pct(100 * byCh[tc] / neg, 0) + ' está em <b>' + U.esc(tc) + '</b> e ' + F.pct(100 * byDp[td] / neg, 0) + ' na faixa <b>' + U.esc(td) + '</b>. ' +
        'A combinação <b>' + U.esc(worst.c + ' · ' + worst.d) + '</b> explica sozinha ' + F.pct(100 * -worst.dv / neg, 0) + '. ' +
        (100 * byCh[tc] / neg > 50 ? 'Os desvios concentram-se sobretudo num canal.' : 100 * byDp[td] / neg > 50 ? 'Os desvios concentram-se sobretudo numa faixa horária.' : 'Os desvios estão distribuídos por vários canais e faixas.');
    } else $('concNote').textContent = 'Nenhuma combinação canal × faixa ficou abaixo do plano para os filtros ativos.';
  }

  /* ============================================================
   * 07 — EFICIÊNCIA
   * ============================================================ */
  function renderEfficiency() {
    const dim = S.ui.eff;
    const list = { channel: ctx.ch, daypart: ctx.dp, duration: ctx.du }[dim];
    const labels = list.map((x) => x.label);
    C.planReal('chEffCpp', labels, list.map((x) => x.cppP), list.map((x) => x.cppR), (v) => F.eur(v), { afterBody: (i) => ['Desvio: ' + F.signedPct(list[i].cppPct) + ' (menor é melhor)', 'Cumprimento GRPs: ' + F.signedPct(list[i].grpPct)] });
    const t = targetObj(S.target);
    $('cpmHint').textContent = t.universe ? 'Universo ' + t.label + ': ' + F.n(t.universe) + ' indivíduos' : 'Universo do target não definido — CPM indisponível';
    C.planReal('chEffCpm', labels, list.map((x) => E.val(x.p, 'cpm')), list.map((x) => E.val(x.r, 'cpm')), (v) => F.eur(v, 2));
    const pts = ctx.opp.rows.filter((o) => isNum(o.ratingR) && isNum(o.cppR) && o.costR > 0).map((o) => ({ x: o.ratingR, y: o.cppR, cost: o.costR, grp: o.grpR, channel: o.channel, daypart: o.daypart }));
    C.scatter('chBubble', pts);
    $('bubbleLegend').innerHTML = Array.from(new Set(pts.map((p) => p.channel))).map((c) => '<span><i style="background:' + C.channelColor(c) + '"></i>' + U.esc(c) + '</span>').join('');
  }

  /* ============================================================
   * 08 — QUALIDADE DE ENTREGA
   * ============================================================ */
  const ST_COLORS = { emitido: '--real', compensacao: '--fx-audience', adicional: '--fx-volume', fora_faixa: '--warn', substituicao: '--c2', desvio_secundagem: '--c5', nao_emitido: '--bad' };
  function renderQuality() {
    const t = S.target, q = ctx.quality, fr = ctx.fr;
    const grpOf = (st) => fr.real.filter((r) => r.status === st).reduce((a, r) => a + (r.ratings[t] || 0), 0);
    const tile = (label, n, sub, st, tip) => '<div class="kpi"><div class="kpi-label"><span>' + label + (tip ? U.info(tip) : '') + '</span>' + (st ? U.statusBadge(st, { pos: 'Válido', neg: 'Não conforme', warn: 'Atenção', tol: 'Info' }[st]) : '') + '</div><div class="kpi-value">' + F.n(n) + '</div><div class="kpi-plan"><span>' + sub + '</span></div></div>';
    const pl = fr.plan.length;
    $('qTiles').innerHTML = [
      tile('Spots planeados', pl, F.n(ctx.s.p.grp, 1) + ' GRPs planeados', null),
      tile('Emitidos conforme', q.ok, F.pct(pl ? 100 * q.ok / pl : null) + ' do plano · ' + F.n(grpOf('emitido'), 1) + ' GRPs', 'pos', 'Mesmo canal, faixa e secundagem que a linha do plano.'),
      tile('Não emitidos', q.notAired, F.pct(pl ? 100 * q.notAired / pl : null) + ' do plano · ' + F.n(fr.notAired.reduce((a, r) => a + (r.ratings[t] || 0), 0), 1) + ' GRPs previstos perdidos', q.notAired ? 'neg' : 'pos', 'Linhas do plano sem emissão associada.'),
      tile('Fora da faixa comprada', q.out, F.n(grpOf('fora_faixa'), 1) + ' GRPs', q.out ? 'neg' : 'pos', 'Emitidos noutra faixa horária (ou fora de grelha).'),
      tile('Substituições de canal', q.sub, F.n(grpOf('substituicao'), 1) + ' GRPs', q.sub ? 'neg' : 'pos', 'Emitidos num canal diferente do comprado.'),
      tile('Desvios de secundagem', q.dur, F.n(grpOf('desvio_secundagem'), 1) + ' GRPs', q.dur ? 'neg' : 'pos', 'Emitidos com duração diferente da planeada.'),
      tile('Spots adicionais', q.add, F.n(grpOf('adicional'), 1) + ' GRPs · ' + F.eur(fr.real.filter((r) => r.status === 'adicional').reduce((a, r) => a + r.cost, 0)), 'tol', 'Spots fora do plano, pagos e acordados.'),
      tile('Compensações de audiência', q.comp, F.n(q.compGrp, 1) + ' GRPs a custo zero', 'tol', 'Spots gratuitos para compensar subentrega de audiência.')
    ].join('');

    const chans = cfg.channels.filter((c) => fr.real.some((r) => r.channel === c) || fr.notAired.some((r) => r.channel === c));
    const statuses = Object.keys(cfg.statuses);
    const series = statuses.map((st) => ({
      label: cfg.statuses[st].label, color: U.cssVar(ST_COLORS[st]),
      data: chans.map((c) => (st === 'nao_emitido' ? fr.notAired.filter((r) => r.channel === c).length : fr.real.filter((r) => r.channel === c && r.status === st).length))
    })).filter((s) => s.data.some((v) => v > 0));
    C.stacked('chQ', chans, series, true);
    $('qLegend').innerHTML = series.map((s) => '<span><i style="background:' + s.color + '"></i>' + U.esc(s.label) + '</span>').join('');
    C.stacked('chQGrp', chans, [
      { label: 'GRPs válidos', color: U.cssVar('--real'), data: chans.map((c) => Math.round(10 * fr.real.filter((r) => r.channel === c && r.valid).reduce((a, r) => a + (r.ratings[t] || 0), 0)) / 10) },
      { label: 'GRPs fora de condições', color: U.cssVar('--warn'), data: chans.map((c) => Math.round(10 * fr.real.filter((r) => r.channel === c && !r.valid).reduce((a, r) => a + (r.ratings[t] || 0), 0)) / 10) }
    ], false);

    const sel = $('qStatus');
    if (!sel.options.length) {
      sel.innerHTML = '<option value="all">Todas as exceções</option>' + statuses.filter((s) => s !== 'emitido').map((s) => '<option value="' + s + '">' + cfg.statuses[s].label + '</option>').join('');
    }
    const planById = new Map(S.model.plan.map((p) => [p.id, p]));
    const rows = fr.real.filter((r) => r.status !== 'emitido').map((r) => {
      const lp = r.planId ? planById.get(r.planId) : null;
      return { st: r.status, date: r.date, time: r.time, ch: r.airedChannel || r.channel, dp: r.airedDaypart || r.daypart, du: r.airedDuration || r.duration, bch: lp ? lp.channel : '—', bdp: lp ? lp.daypart : '—', bdu: lp ? lp.duration : null, rating: r.ratings[t], cost: r.cost, valid: r.valid, id: r.id };
    }).concat(fr.notAired.map((p) => ({ st: 'nao_emitido', date: p.date, time: p.time, ch: '—', dp: '—', du: null, bch: p.channel, bdp: p.daypart, bdu: p.duration, rating: null, cost: 0, valid: false, id: p.id, plannedRating: p.ratings[t] })))
      .filter((r) => S.ui.qStatus === 'all' || r.st === S.ui.qStatus);
    U.table('tbQ', {
      columns: [
        { key: 'st', label: 'Estado', align: 'l', raw: (r) => cfg.statuses[r.st].label, html: (r) => U.statusBadge(r.valid ? 'tol' : 'neg', cfg.statuses[r.st].label) },
        { key: 'id', label: 'ID', align: 'l' },
        { key: 'date', label: 'Data', align: 'l', html: (r) => E.fmtDM(r.date) + ' ' + cfg.weekdaysShort[(new Date(r.date + 'T00:00:00Z').getUTCDay() + 6) % 7] },
        { key: 'time', label: 'Hora', align: 'l', html: (r) => r.time || '—' },
        { key: 'ch', label: 'Canal emitido', align: 'l', html: (r) => U.esc(r.ch) + (r.bch !== '—' && r.ch !== '—' && r.ch !== r.bch ? ' <span class="t-neg">≠</span>' : '') },
        { key: 'dp', label: 'Faixa emitida', align: 'l', html: (r) => U.esc(r.dp) + (r.bdp !== '—' && r.dp !== '—' && r.dp !== r.bdp ? ' <span class="t-neg">≠</span>' : '') },
        { key: 'du', label: 'Sec.', html: (r) => (r.du ? r.du + '"' : '—') + (r.bdu && r.du && r.du !== r.bdu ? ' <span class="t-neg">≠</span>' : '') },
        { key: 'bch', label: 'Canal comprado', align: 'l' }, { key: 'bdp', label: 'Faixa comprada', align: 'l' },
        { key: 'bdu', label: 'Sec. comprada', html: (r) => (r.bdu ? r.bdu + '"' : '—') },
        { key: 'rating', label: 'Rating', raw: (r) => (r.rating !== null ? r.rating : null), html: (r) => (r.st === 'nao_emitido' ? '<span class="t-mute">prev. ' + F.n(r.plannedRating, 2) + '</span>' : F.n(r.rating, 2)) },
        { key: 'cost', label: 'Custo', raw: (r) => r.cost, html: (r) => F.eur(r.cost) },
        { key: 'valid', label: 'Validade contratual', align: 'l', raw: (r) => (r.valid ? 'Válida' : 'Não conforme'), html: (r) => (r.valid ? '<span class="t-pos">✓ Válida</span>' : '<span class="t-neg">✕ Não conforme</span>') }
      ],
      rows, sort: { key: 'date', dir: 'asc' }, pageSize: 15, exportName: 'excecoes_entrega', title: 'Excecoes de entrega'
    });
  }

  /* ============================================================
   * 09 — CONTRIBUTO PARA O DESVIO (waterfall)
   * ============================================================ */
  function renderWaterfall() {
    const dim = S.ui.wf;
    const ind = indDef(S.ind).additive ? S.ind : 'grp';
    const d = indDef(ind);
    const list = { channel: ctx.ch, daypart: ctx.dp, duration: ctx.du, dow: ctx.dw }[dim];
    const items = list.map((x) => ({ label: dim === 'dow' ? x.label.slice(0, 3) : x.label, full: x.label, p: E.val(x.p, ind) || 0, r: E.val(x.r, ind) || 0 })).map((o) => Object.assign(o, { delta: o.r - o.p }));
    const start = items.reduce((a, o) => a + o.p, 0), end = items.reduce((a, o) => a + o.r, 0);
    $('wfTitle').textContent = d.label + ': do planeado ao realizado, por ' + E.dims[dim].label.toLowerCase();
    $('wfHint').textContent = (indDef(S.ind).additive ? '' : indDef(S.ind).label + ' não é aditivo — a decomposição usa GRPs. ') + 'Desvio total: ' + F.signed(end - start, d.dec, d.unit === '€' ? ' €' : '') + ' (' + F.signedPct(E.devPct(end, start)) + ')';
    C.waterfall('chWf', { start, end, items }, 'Planeado', 'Realizado', (v) => F.ind(v, ind, true));
    const tot = end - start, gross = items.reduce((a, o) => a + Math.abs(o.delta), 0);
    U.table('tbWf', {
      columns: [
        { key: 'full', label: E.dims[dim].label, align: 'l', html: (r) => '<b>' + U.esc(r.full) + '</b>' },
        { key: 'p', label: 'Planeado', raw: (r) => r.p, html: (r) => F.ind(r.p, ind) },
        { key: 'r', label: 'Realizado', raw: (r) => r.r, html: (r) => F.ind(r.r, ind) },
        { key: 'delta', label: 'Contributo', raw: (r) => r.delta, html: (r) => '<span class="' + (r.delta < 0 ? 't-neg' : 't-pos') + '">' + F.signed(r.delta, d.dec) + '</span>' },
        { key: 'sh', label: '% do desvio líquido', tip: 'Contributo ÷ desvio total', raw: (r) => (tot ? 100 * r.delta / tot : null), html: (r) => F.pct(tot ? 100 * r.delta / tot : null) },
        { key: 'gr', label: '% do desvio bruto', tip: '|Contributo| ÷ soma dos |contributos|', raw: (r) => (gross ? 100 * Math.abs(r.delta) / gross : null), html: (r) => F.pct(gross ? 100 * Math.abs(r.delta) / gross : null) }
      ],
      rows: items, sort: { key: 'delta', dir: 'asc' }, exportName: 'contributo_desvio', title: 'Contributo desvio'
    });
  }

  /* ============================================================
   * 10 — OPORTUNIDADES
   * ============================================================ */
  function renderOpportunities() {
    const o = ctx.opp;
    $('oppHint').innerHTML = 'CPP médio realizado da campanha: <b>' + F.eur(o.cppAvg) + '</b>. Potencial = |GRPs realizados − GRPs que o mesmo investimento geraria ao CPP médio|.';
    const actSt = { 'Reforçar': 'pos', 'Reduzir / renegociar': 'neg', 'Exigir compensação': 'warn', 'Manter': 'tol' };
    const rows = o.rows.filter((r) => S.ui.opp === 'all' || r.action === S.ui.opp).map((r) => Object.assign(r, { potential: isNum(r.impact) ? Math.abs(r.impact) : null }));
    U.table('tbOpp', {
      columns: [
        { key: 'channel', label: 'Canal', align: 'l', html: (r) => '<i style="display:inline-block;width:9px;height:9px;border-radius:3px;margin-right:6px;background:' + C.channelColor(r.channel) + '"></i>' + U.esc(r.channel) },
        { key: 'daypart', label: 'Faixa', align: 'l' },
        { key: 'action', label: 'Ação sugerida', align: 'l', html: (r) => U.statusBadge(actSt[r.action], r.action) },
        { key: 'potential', label: 'Potencial (GRPs)', tip: 'GRPs ganhos (combinação eficiente) ou perdidos (ineficiente) face ao CPP médio', raw: (r) => r.potential, html: (r) => '<b>' + F.n(r.potential, 1) + '</b> <span class="t-mute">' + (isNum(r.impact) ? (r.impact >= 0 ? 'ganho' : 'perda') : '') + '</span>' },
        { key: 'score', label: 'Pontuação', tip: '40% custo + 35% audiência + 25% cumprimento (100 = em linha)', raw: (r) => r.score, html: (r) => F.n(r.score, 0) },
        numCol('spotsP', 'Spots P', (r) => r.spotsP), numCol('spotsR', 'Spots R', (r) => r.spotsR),
        numCol('grpP', 'GRPs P', (r) => r.grpP, 1), numCol('grpR', 'GRPs R', (r) => r.grpR, 1),
        { key: 'delivery', label: 'Cumprim. GRPs', raw: (r) => r.delivery, html: (r) => U.badge(isNum(r.delivery) ? (r.delivery - 1) * 100 : null, 'higher') },
        { key: 'audIdx', label: 'Rating vs plano', raw: (r) => r.audIdx, html: (r) => U.badge(isNum(r.audIdx) ? (r.audIdx - 1) * 100 : null, 'higher') },
        eurCol('cppR', 'CPP R', (r) => r.cppR),
        { key: 'costIdx', label: 'CPP vs média', tip: 'CPP médio ÷ CPP da combinação (>100% = mais barato)', raw: (r) => r.costIdx, html: (r) => U.badge(isNum(r.costIdx) ? (r.costIdx - 1) * 100 : null, 'higher') },
        eurCol('costR', 'Invest. R', (r) => r.costR)
      ],
      rows, sort: { key: 'potential', dir: 'desc' }, exportName: 'oportunidades', title: 'Oportunidades'
    });
  }

  /* ============================================================
   * 11 — ANÁLISE E COMENTÁRIOS
   * ============================================================ */
  const SECTIONS = [['geral', 'Geral'], ['resumo', 'Resumo'], ['v-channel', 'Por canal'], ['v-daypart', 'Por faixa horária'], ['v-duration', 'Por secundagem'], ['v-week', 'Por semana'], ['faixas', 'Técnico · Faixas'], ['canais', 'Técnico · Canais'], ['secundagem', 'Técnico · Secundagem'], ['evolucao', 'Evolução e dias'], ['cruzada', 'Canal × faixa'], ['eficiencia', 'Eficiência'], ['qualidade', 'Qualidade de entrega'], ['contributo', 'Contributo p/ desvio'], ['oportunidades', 'Oportunidades']];
  const secName = (k) => (SECTIONS.find((s) => s[0] === k) || [k, k])[1];
  const fmtTs = (ts) => new Date(ts).toLocaleString('pt-PT', { dateStyle: 'short', timeStyle: 'short' });
  function renderAnalysis() {
    const ICON = { pos: '▲', neg: '▼', tol: '●', warn: '!', info: 'i' };
    const items = I.conclusions(ctx);
    const caps = { 'Resumo executivo': 2, 'Canais': 2, 'Faixas horárias': 1, 'Secundagem': 1, 'Semanas': 1, 'Eficiência': 1 }, used = {};
    items.forEach((c) => { used[c.sec] = (used[c.sec] || 0) + 1; c.client = used[c.sec] <= (caps[c.sec] || 0); });
    $('concl').innerHTML = items.length ? items.map((c) => '<li' + (c.client ? '' : ' class="tech-only"') + '><span class="ic ' + c.type + '">' + ICON[c.type] + '</span><div>' + U.esc(c.text) + '<span class="sec">' + U.esc(c.sec) + '</span></div></li>').join('') : '<li><span class="ic info">i</span><div>Sem dados suficientes para gerar conclusões com os filtros ativos.</div></li>';
    $('recoAuto').innerHTML = ctx.recos.map((r, i) => (i < 3 ? '' : '<div class="tech-only">') + recoHtml(r, 'Gerada automaticamente · ' + r.source) + (i < 3 ? '' : '</div>')).join('') || '<p class="note">Sem recomendações automáticas para os filtros ativos.</p>';
    renderComments();
    renderUserRecos();
  }
  const recoHtml = (r, src, del) => '<div class="reco"><div><h5>Evidência observada</h5>' + U.esc(r.evidence) + '</div><div><h5>Interpretação</h5>' + U.esc(r.interpretation) + '</div><div><h5>Ação recomendada</h5>' + U.esc(r.action) + '</div><div class="src"><span>' + U.esc(src) + '</span>' + (del ? '<button class="btn sm ghost no-print" data-del-reco="' + del + '">Remover</button>' : '') + '</div></div>';
  function renderComments() {
    const list = store.get(LS.comments, []);
    const card = (c) => '<div class="comment"><div class="comment-meta"><span><b>' + U.esc(secName(c.sec)) + '</b> · ' + U.esc(c.author || 'Analista') + ' · ' + fmtTs(c.ts) + '</span><button class="btn sm ghost no-print" data-del-comment="' + c.id + '">Remover</button></div><p>' + U.esc(c.text) + '</p></div>';
    $('cList').innerHTML = list.length ? list.slice().reverse().map(card).join('') : '<p class="note">Ainda não há comentários guardados.</p>';
    document.querySelectorAll('.sec-comments').forEach((el) => {
      const mine = list.filter((c) => c.sec === el.getAttribute('data-sec'));
      el.innerHTML = mine.length ? '<div class="note" style="margin-bottom:6px"><b>Comentários do analista</b></div><div class="comment-list" style="margin-top:0">' + mine.map(card).join('') + '</div>' : '';
    });
  }
  function renderUserRecos() {
    const list = store.get(LS.recos, []);
    $('recoUser').innerHTML = list.map((r) => recoHtml(r, 'Analista · ' + fmtTs(r.ts), r.id)).join('');
  }

  /* ============================================================
   * 12 — DADOS (registo linha a linha) + cabeçalho
   * ============================================================ */
  function renderLog() {
    const t = S.target, k = S.ui.log;
    const rows = k === 'real' ? ctx.fr.real : ctx.fr.plan;
    const cols = [
      { key: 'id', label: 'ID', align: 'l' },
      { key: 'date', label: 'Data', align: 'l', html: (r) => E.fmtDM(r.date) },
      { key: 'dow', label: 'Dia', align: 'l', raw: (r) => r.dow, html: (r) => cfg.weekdaysShort[r.dow] },
      { key: 'time', label: 'Hora', align: 'l', html: (r) => r.time || '—' },
      { key: 'channel', label: 'Canal', align: 'l' }, { key: 'daypart', label: 'Faixa', align: 'l' },
      { key: 'duration', label: 'Sec.', html: (r) => r.duration + '"' },
      { key: 'rating', label: 'Rating ' + targetObj(t).label, raw: (r) => r.ratings[t], html: (r) => F.n(r.ratings[t], 2) },
      { key: 'cost', label: 'Custo', raw: (r) => r.cost, html: (r) => F.eur(r.cost) }
    ];
    if (k === 'real') cols.push({ key: 'planId', label: 'Linha plano', align: 'l', html: (r) => r.planId || '—' }, { key: 'status', label: 'Estado', align: 'l', raw: (r) => cfg.statuses[r.status].label, html: (r) => U.statusBadge(r.valid ? 'tol' : 'neg', cfg.statuses[r.status].label) });
    U.table('tbLog', { columns: cols, rows, sort: { key: 'date', dir: 'asc' }, pageSize: 25, exportName: k === 'real' ? 'registo_emissoes' : 'registo_plano', title: k === 'real' ? 'Registo emissoes' : 'Registo plano' });
  }

  function renderHeader() {
    const m = S.model.meta;
    $('campTitle').textContent = 'Relatório de Performance — ' + (m.campanha || 'Campanha TV');
    const bits = [m.anunciante && '<b>' + U.esc(m.anunciante) + '</b>', m.produto && U.esc(m.produto), 'Período ' + E.fmtDM(S.model.period.from) + '–' + E.fmtDM(S.model.period.to) + '/' + S.model.period.to.slice(0, 4),
      'Target de compra: ' + U.esc(targetObj(cfg.buyTarget).label), m.fonte && '<span class="t-warn">' + U.esc(m.fonte) + '</span>'].filter(Boolean);
    $('campSub').innerHTML = bits.join(' · ');
    $('footNote').textContent = 'Fonte: ' + (m.fonte || 'dados importados') + ' · ' + S.model.plan.length + ' linhas de plano · ' + S.model.real.length + ' emissões · Relatório gerado em ' + new Date().toLocaleString('pt-PT');
  }

  function activeFiltersText() {
    const parts = [];
    if (S.f.from !== S.model.period.from || S.f.to !== S.model.period.to) parts.push('Período ' + E.fmtDM(S.f.from) + '–' + E.fmtDM(S.f.to));
    if (S.f.channels.length) parts.push('Canal: ' + S.f.channels.join(', '));
    if (S.f.dayparts.length) parts.push('Faixa: ' + S.f.dayparts.join(', '));
    if (S.f.durations.length) parts.push('Secundagem: ' + S.f.durations.map((d) => d + '"').join(', '));
    if (S.f.weeks.length) parts.push('Semana: ' + S.f.weeks.join(', '));
    if (S.f.dows.length) parts.push('Dia: ' + S.f.dows.map((d) => cfg.weekdaysShort[d]).join(', '));
    const base = 'Target: ' + targetObj(S.target).label + ' · Indicador: ' + indDef(S.ind).label + (S.attr === 'bought' ? ' · Atribuição por linha de compra' : '');
    return { any: parts.length > 0, text: (parts.length ? 'Filtros ativos: ' + parts.join(' · ') + ' · ' : 'Sem filtros · ') + base };
  }

  function renderMethod() {
    const items = [
      ['GRPs', 'Σ ratings (%) dos spots no target selecionado. <span class="formula">GRP = Σ rating</span>'],
      ['TRPs', 'Σ ratings no target de compra (' + U.esc(targetObj(cfg.buyTarget).label) + ').'],
      ['Rating médio', '<span class="formula">GRPs ÷ nº de spots</span>'],
      ['CPP', '<span class="formula">Investimento ÷ GRPs</span> — menor é melhor.'],
      ['CPM', '<span class="formula">Investimento ÷ (contactos ÷ 1000)</span>, contactos = rating × universo do target. Indisponível sem universo.'],
      ['GRP eq. 30"', '<span class="formula">GRP × índice da secundagem</span> (' + cfg.durations.map((d) => d + '"=' + F.n(cfg.durationIndex[d], 2)).join(', ') + '). Não pressupõe que spots longos gerem mais audiência.'],
      ['Desvios', '<span class="formula">Δ = realizado − planeado</span> · <span class="formula">Δ% = (realizado − planeado) ÷ planeado × 100</span>. Se o planeado for 0 → "n.d.". Tolerância: ±' + tol() + '%.'],
      ['Efeito volume / audiência', 'ΔGRPs = <span class="formula">(spots R − spots P) × rating P</span> + <span class="formula">spots R × (rating R − rating P)</span>. Separa desvios de entrega de desvios de audiência.'],
      ['Cobertura e frequência', 'Apenas a partir de dados deduplicados do software de audiências, para o total da campanha. Nunca somadas por canal ou faixa. <span class="formula">Frequência = GRPs ÷ Cobertura 1+</span>.'],
      ['Faixas horárias', cfg.dayparts.map((d) => d.label).join(' · ') + '. Emissões após 00h00 pertencem ao dia TV anterior; fora destes limites = "' + cfg.outOfGrid + '".'],
      ['Validade contratual', 'Válidas: emitido conforme, adicionais acordados, compensações. Não conformes: fora de faixa, substituição de canal, desvio de secundagem. O estado é derivado comparando cada emissão com a linha do plano.'],
      ['Cumprimento do plano', 'Volume = spots do plano emitidos em condições válidas ÷ planeados; Audiência = GRPs R ÷ GRPs P; Eficiência = CPP P ÷ CPP R.'],
      ['Pontuação (ranking)', '40% custo (CPP médio ÷ CPP) + 35% audiência (rating R ÷ rating P) + 25% cumprimento (GRPs R ÷ GRPs P); cada fator limitado a [0; 2]; 100 = em linha.']
    ];
    $('method').innerHTML = items.map((i) => '<dt>' + i[0] + '</dt><dd>' + i[1] + '</dd>').join('');
  }

  /* ============================================================
   * ORQUESTRAÇÃO
   * ============================================================ */
  function renderAll() {
    compute();
    const af = activeFiltersText();
    $('activeFilters').textContent = af.text; $('activeFilters').classList.toggle('on', af.any);
    $('printFilters').textContent = af.text;
    const steps = [renderHeader, renderSummary, renderClientDims, renderDayparts, renderChannels, renderDurations, renderTime, renderCross, renderEfficiency, renderQuality, renderWaterfall, renderOpportunities, renderAnalysis, renderLog, renderMethod];
    steps.forEach((fn) => { try { fn(); } catch (e) { console.error(fn.name, e); } });
  }
  let pending = null;
  function update() { cancelAnimationFrame(pending); pending = requestAnimationFrame(renderAll); savePrefs(); }

  function savePrefs() { store.set(LS.prefs, { target: S.target, ind: S.ind, view: S.view, theme: S.theme, attr: S.attr }); }

  function loadModel(raw) {
    S.raw = raw;
    S.model = E.normalize(raw);
    S.f = { from: S.model.period.from, to: S.model.period.to, channels: [], dayparts: [], durations: [], dows: [], weeks: [] };
    if (!cfg.targets.some((t) => t.code === S.target)) S.target = cfg.targets[0].code;
    ['fFrom', 'fTo'].forEach((id) => { $(id).min = S.model.period.from; $(id).max = S.model.period.to; });
    $('fFrom').value = S.f.from; $('fTo').value = S.f.to;
    $('fTarget').innerHTML = cfg.targets.map((t) => '<option value="' + U.esc(t.code) + '">' + U.esc(t.label) + (t.code === cfg.buyTarget ? ' (compra)' : '') + '</option>').join('');
    $('fTarget').value = S.target;
    Object.values(ms).forEach((m) => m.set([]));
    $('qStatus').innerHTML = '';
  }

  /* ---------- filtros ---------- */
  function initFilters() {
    ms.channels = U.multiselect($('fChannel'), { placeholder: 'Todos', options: () => cfg.channels.filter((c) => S.model.plan.some((r) => r.channel === c) || S.model.real.some((r) => r.channel === c)).map((c) => ({ value: c, label: c })), onChange: (v) => { S.f.channels = v; update(); } });
    ms.dayparts = U.multiselect($('fDaypart'), { placeholder: 'Todas', options: () => cfg.dayparts.map((d) => ({ value: d.code, label: d.label })).concat(S.model.real.some((r) => r.daypart === cfg.outOfGrid) ? [{ value: cfg.outOfGrid, label: cfg.outOfGrid }] : []), onChange: (v) => { S.f.dayparts = v; update(); } });
    ms.durations = U.multiselect($('fDuration'), { placeholder: 'Todas', options: () => cfg.durations.map((d) => ({ value: d, label: d + '"' })), onChange: (v) => { S.f.durations = v; update(); } });
    ms.weeks = U.multiselect($('fWeek'), { placeholder: 'Todas', options: () => S.model.weeks.map((w) => ({ value: w, label: w })), onChange: (v) => { S.f.weeks = v; update(); } });
    ms.dows = U.multiselect($('fDow'), { placeholder: 'Todos', options: () => cfg.weekdays.map((d, i) => ({ value: i, label: d })), onChange: (v) => { S.f.dows = v; update(); } });
    $('fFrom').addEventListener('change', (e) => { S.f.from = e.target.value || S.model.period.from; if (S.f.from > S.f.to) { S.f.to = S.f.from; $('fTo').value = S.f.to; } update(); });
    $('fTo').addEventListener('change', (e) => { S.f.to = e.target.value || S.model.period.to; if (S.f.to < S.f.from) { S.f.from = S.f.to; $('fFrom').value = S.f.from; } update(); });
    $('fTarget').addEventListener('change', (e) => { S.target = e.target.value; update(); });
    $('fInd').addEventListener('change', (e) => { S.ind = e.target.value; update(); });
    $('fAttr').addEventListener('change', (e) => { S.attr = e.target.value; update(); });
    $('btnReset').addEventListener('click', () => {
      S.f = { from: S.model.period.from, to: S.model.period.to, channels: [], dayparts: [], durations: [], dows: [], weeks: [] };
      $('fFrom').value = S.f.from; $('fTo').value = S.f.to;
      Object.values(ms).forEach((m) => m.set([]));
      S.target = cfg.buyTarget; $('fTarget').value = S.target; S.ind = 'grp'; $('fInd').value = 'grp'; S.attr = 'aired'; $('fAttr').value = 'aired';
      update(); U.toast('Filtros repostos.');
    });
  }

  /* Segmented controls locais (cada um altera um parâmetro de visualização). */
  function bindSeg(id, attr, key, after) {
    const el = $(id);
    el.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      el.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
      if (key) S.ui[key] = b.getAttribute(attr);
      after ? after(b.getAttribute(attr)) : update();
    });
  }
  const setSeg = (id, attr, val) => $(id).querySelectorAll('button').forEach((x) => x.classList.toggle('on', x.getAttribute(attr) === val));

  function applyTheme(t) {
    S.theme = t;
    if (t === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', t);
    setSeg('themeSeg', 'data-t', t);
    C.theme(); update();
  }
  function applyView(v) {
    S.view = v;
    document.body.classList.toggle('client', v === 'client'); document.body.classList.toggle('tech', v === 'tech');
    setSeg('viewSeg', 'data-v', v);
    setTimeout(C.resizeAll, 50); savePrefs();
  }

  function initControls() {
    bindSeg('dpShareSeg', 'data-m', 'dpShare');
    bindSeg('hmDpDowSeg', 'data-m', 'hmDpDow');
    bindSeg('chShareSeg', 'data-m', 'chShare');
    bindSeg('duGrpSeg', 'data-m', 'duGrp');
    bindSeg('duCppSeg', 'data-m', 'duCpp');
    bindSeg('evoSeg', 'data-g', 'evo');
    bindSeg('effSeg', 'data-d', 'eff');
    bindSeg('wfSeg', 'data-d', 'wf');
    bindSeg('oppSeg', 'data-f', 'opp');
    bindSeg('logSeg', 'data-k', 'log');
    bindSeg('viewSeg', 'data-v', null, applyView);
    bindSeg('themeSeg', 'data-t', null, applyTheme);
    document.querySelectorAll('.metric-seg').forEach((el) => el.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      el.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
      S.ui.cd[el.getAttribute('data-dim')] = b.getAttribute('data-m'); update();
    }));
    $('hmChDpMetric').addEventListener('change', (e) => { S.ui.hmChDp = e.target.value; update(); });
    $('qStatus').addEventListener('change', (e) => { S.ui.qStatus = e.target.value; update(); });

    // Exportações e impressão
    $('btnXlsx').addEventListener('click', exportClientExcel);
    $('btnXlsxTech').addEventListener('click', () => { TV.io.exportWorkbook(S.raw, U.tableRegistry(), 'pos_avaliacao_tv_dados_tecnicos'); });
    $('btnPrint').addEventListener('click', () => window.print());
    $('btnPdf').addEventListener('click', () => { U.toast('Na janela de impressão escolha "Guardar como PDF" (orientação paisagem).'); setTimeout(() => window.print(), 600); });
    $('btnTemplate').addEventListener('click', () => TV.io.exportTemplate(S.raw));
    $('btnDemo').addEventListener('click', () => { resetDims(); loadModel(TV.demoData.generate()); update(); showMsg('importMsg', 'Dados de demonstração repostos.', true); });

    // Importação
    const fileIn = $('fileIn'), drop = $('drop');
    $('btnImport').addEventListener('click', () => { if (S.view !== 'tech') applyView('tech'); document.getElementById('dados').scrollIntoView(); fileIn.click(); });
    drop.addEventListener('click', () => fileIn.click());
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('drag'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('drag'));
    drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('drag'); doImport(e.dataTransfer.files); });
    fileIn.addEventListener('change', () => { doImport(fileIn.files); fileIn.value = ''; });

    // Comentários e recomendações
    $('cSec').innerHTML = SECTIONS.map((s) => '<option value="' + s[0] + '">' + s[1] + '</option>').join('');
    $('cSave').addEventListener('click', () => {
      const text = $('cText').value.trim(); if (!text) { U.toast('Escreva um comentário antes de guardar.'); return; }
      const list = store.get(LS.comments, []);
      list.push({ id: Date.now().toString(36), sec: $('cSec').value, author: $('cAuthor').value.trim(), text, ts: Date.now() });
      if (!store.set(LS.comments, list)) U.toast('Não foi possível guardar (armazenamento local indisponível).'); else U.toast('Comentário guardado neste browser.');
      $('cText').value = ''; renderComments();
    });
    $('rSave').addEventListener('click', () => {
      const r = { evidence: $('rEv').value.trim(), interpretation: $('rInt').value.trim(), action: $('rAct').value.trim() };
      if (!r.evidence || !r.action) { U.toast('Preencha pelo menos a evidência e a ação recomendada.'); return; }
      const list = store.get(LS.recos, []); list.push(Object.assign(r, { id: Date.now().toString(36), ts: Date.now() }));
      store.set(LS.recos, list); ['rEv', 'rInt', 'rAct'].forEach((id) => { $(id).value = ''; }); renderUserRecos(); U.toast('Recomendação guardada.');
    });
    document.addEventListener('click', (e) => {
      const dc = e.target.getAttribute && e.target.getAttribute('data-del-comment');
      if (dc) { store.set(LS.comments, store.get(LS.comments, []).filter((c) => c.id !== dc)); renderComments(); }
      const dr = e.target.getAttribute && e.target.getAttribute('data-del-reco');
      if (dr) { store.set(LS.recos, store.get(LS.recos, []).filter((c) => c.id !== dr)); renderUserRecos(); }
    });

    // Estrutura de compra
    $('dpStarts').value = cfg.daypartStarts.join(', '); $('dpEnd').value = cfg.daypartEnd; $('tolIn').value = cfg.tolerance; $('primeIn').value = cfg.primeTime;
    $('btnApplyCfg').addEventListener('click', () => {
      const re = /^([01]?\d|2[0-3]):[0-5]\d$/;
      const starts = $('dpStarts').value.split(/[,;\s]+/).filter(Boolean).map((s) => s.replace('h', ':'));
      const end = $('dpEnd').value.trim().replace('h', ':'), prime = $('primeIn').value.trim().replace('h', ':');
      const tolV = Number($('tolIn').value);
      if (!starts.length || !starts.every((s) => re.test(s)) || !re.test(end)) return showMsg('cfgMsg', 'Formato inválido. Use HH:MM separados por vírgula (ex.: 07:00, 10:00, 13:00).', false);
      if (!(tolV >= 0 && tolV <= 50)) return showMsg('cfgMsg', 'A tolerância deve estar entre 0 e 50%.', false);
      cfg.daypartStarts = starts.map((s) => s.padStart(5, '0')); cfg.daypartEnd = end.padStart(5, '0'); cfg.tolerance = tolV; cfg.primeTime = prime.padStart(5, '0');
      store.set(LS.cfg, { daypartStarts: cfg.daypartStarts, daypartEnd: cfg.daypartEnd, tolerance: cfg.tolerance, primeTime: cfg.primeTime });
      loadModel(S.raw); update();
      showMsg('cfgMsg', 'Estrutura aplicada: ' + cfg.dayparts.map((d) => d.label).join(' · ') + ' · tolerância ±' + cfg.tolerance + '%.', true);
    });

    // Scrollspy
    const links = Array.from(document.querySelectorAll('#nav a'));
    const obs = new IntersectionObserver((entries) => {
      entries.forEach((en) => { if (en.isIntersecting) links.forEach((a) => a.classList.toggle('active', a.getAttribute('href') === '#' + en.target.id)); });
    }, { rootMargin: '-30% 0px -60% 0px' });
    document.querySelectorAll('section.sec').forEach((s) => obs.observe(s));
    window.addEventListener('beforeprint', () => { $('printFilters').textContent = activeFiltersText().text; });
  }

  /* Relatório Excel para o cliente (quadros formatados, gráficos nativos e análises). */
  async function exportClientExcel() {
    if (!TV.excelReport.available()) { U.toast('Bibliotecas de Excel indisponíveis (sem internet?) — exportados os dados em formato simples.'); TV.io.exportWorkbook(S.raw, U.tableRegistry(), 'pos_avaliacao_tv'); return; }
    const btn = $('btnXlsx'); btn.disabled = true; U.toast('A gerar o relatório Excel…');
    try {
      const m = S.model.meta, conclusions = I.conclusions(ctx);
      const caps = { 'Resumo executivo': 2, 'Canais': 2, 'Faixas horárias': 1, 'Secundagem': 1, 'Semanas': 1, 'Eficiência': 1 }, used = {};
      conclusions.forEach((c) => { used[c.sec] = (used[c.sec] || 0) + 1; c.client = used[c.sec] <= (caps[c.sec] || 0); });
      const planById = new Map(S.model.plan.map((p) => [p.id, p]));
      const toDate = (iso) => new Date(iso + 'T00:00:00Z');
      const rows = ctx.fr.real.map((r) => ({ date: toDate(r.date), dow: cfg.weekdaysShort[r.dow], time: r.time, channel: r.airedChannel || r.channel, daypart: r.airedDaypart || r.daypart, duration: r.airedDuration || r.duration, rating: r.ratings[S.target], cost: r.cost, status: cfg.statuses[r.status].label, valid: r.valid, planId: r.planId, id: r.id, iso: r.date }))
        .concat(ctx.fr.notAired.map((p) => ({ date: toDate(p.date), dow: cfg.weekdaysShort[p.dow], time: p.time, channel: p.channel, daypart: p.daypart, duration: p.duration, rating: null, cost: 0, status: cfg.statuses.nao_emitido.label, valid: false, planId: p.id, id: '', iso: p.date })))
        .sort((a, b) => (a.iso + (a.time || '')).localeCompare(b.iso + (b.time || '')));
      const blob = await TV.excelReport.build({
        meta: m, s: ctx.s, tol: cfg.tolerance, targetLabel: ctx.targetLabel, buyTargetLabel: targetObj(cfg.buyTarget).label,
        headline: [m.anunciante, m.produto, 'Período ' + E.fmtDM(S.model.period.from) + '–' + E.fmtDM(S.model.period.to) + '/' + S.model.period.to.slice(0, 4), m.fonte].filter(Boolean).join(' · '),
        filters: activeFiltersText().text.replace(/ · Indicador: [^·]+/, ''),
        verdict: ctx.verdict, dims: { channel: ctx.ch, daypart: ctx.dp, duration: ctx.du, week: ctx.wk },
        conclusions, recos: ctx.recos, userRecos: store.get(LS.recos, []),
        comments: store.get(LS.comments, []).map((c) => Object.assign({ secName: secName(c.sec) }, c)),
        rows, method: Array.from($('method').querySelectorAll('dt')).map((dt) => [dt.textContent, dt.nextElementSibling.textContent])
      });
      const name = 'Relatorio_TV_' + String(m.campanha || 'campanha').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]+/g, '_') + '.xlsx';
      U.download(name, blob);
      U.toast('Relatório Excel gerado.');
    } catch (e) { console.error(e); U.toast('Erro ao gerar o Excel: ' + e.message); }
    btn.disabled = false;
  }

  function showMsg(id, text, ok) { const m = $(id); m.textContent = text; m.className = 'msg on ' + (ok ? 'ok' : 'err'); return false; }

  async function doImport(files) {
    if (!files || !files.length) return;
    try {
      const res = await TV.io.importFiles(Array.from(files));
      const meta = { campanha: 'Campanha importada', fonte: 'Dados importados (' + Array.from(files).map((f) => f.name).join(', ') + ')' };
      resetDims();
      loadModel({ meta, plan: res.plan, emissions: res.emissions, reach: res.reach });
      ms.channels.refresh(); ms.durations.refresh(); ms.dayparts.refresh(); ms.weeks.refresh();
      update();
      showMsg('importMsg', 'Importação concluída.\n' + res.log.join('\n') + (S.model.warnings.length ? '\n\nAvisos:\n' + S.model.warnings.slice(0, 12).join('\n') + (S.model.warnings.length > 12 ? '\n…' : '') : ''), true);
    } catch (e) {
      showMsg('importMsg', 'Erro na importação: ' + e.message, false);
    }
  }

  /* ---------- arranque ---------- */
  function init() {
    const saved = store.get(LS.cfg, null);
    if (saved) { Object.assign(cfg, saved); cfg.buildDayparts(); }
    const prefs = store.get(LS.prefs, {});
    U.initTips();
    loadModel(TV.demoData.generate());
    initFilters();
    if (prefs.target && cfg.targets.some((t) => t.code === prefs.target)) { S.target = prefs.target; $('fTarget').value = S.target; }
    if (prefs.ind && E.indicators[prefs.ind]) { S.ind = prefs.ind; $('fInd').value = S.ind; }
    if (prefs.attr) { S.attr = prefs.attr; $('fAttr').value = S.attr; }
    initControls();
    applyView(prefs.view === 'tech' ? 'tech' : 'client');
    applyTheme(prefs.theme || 'auto');
    if (window.matchMedia) window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (S.theme === 'auto') { C.theme(); update(); } });
  }
  document.addEventListener('DOMContentLoaded', init);
})();

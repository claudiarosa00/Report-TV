/* =============================================================================
 * engine.js — Modelo de dados e lógica de cálculo
 * -----------------------------------------------------------------------------
 * Regras (aplicadas de forma consistente em todo o dashboard):
 *   GRPs            = Σ ratings (%) dos spots para o target selecionado
 *   TRPs            = Σ ratings dos spots no target de compra (config.buyTarget)
 *   Rating médio    = GRPs ÷ nº de spots com audiência
 *   CPP             = investimento ÷ GRPs
 *   Contactos       = Σ (rating/100 × universo do target)
 *   CPM             = investimento ÷ (contactos / 1000)
 *   GRP eq. 30"     = Σ rating × índice da secundagem (config.durationIndex)
 *   Desvio absoluto = realizado − planeado
 *   Desvio %        = (realizado − planeado) ÷ planeado × 100  (n.d. se planeado = 0)
 *   Cobertura/Freq. → só a partir de dados deduplicados (nunca somados);
 *                     Frequência média = GRPs ÷ Cobertura 1+ (mesmo target e âmbito)
 * ========================================================================== */
window.TV = window.TV || {};

TV.engine = (function () {
  const cfg = TV.config;

  /* ---------- utilitários numéricos seguros ---------- */
  const isNum = (v) => typeof v === 'number' && isFinite(v);
  const div = (a, b) => (isNum(a) && isNum(b) && b !== 0 ? a / b : null);
  const dev = (r, p) => (isNum(r) && isNum(p) ? r - p : null);
  const devPct = (r, p) => (isNum(r) && isNum(p) && p !== 0 ? ((r - p) / p) * 100 : null);
  const num = (v) => {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'number') return isFinite(v) ? v : null;
    let s = String(v).trim().replace(/\s|€|%/g, '');
    if (/,\d+$/.test(s) && s.indexOf('.') > -1) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(',', '.');
    const n = parseFloat(s);
    return isFinite(n) ? n : null;
  };

  /* ---------- datas e horas ---------- */
  function parseDate(v) {
    if (v === null || v === undefined || v === '') return null;
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if (typeof v === 'number') { // série Excel
      const d = new Date(Date.UTC(1899, 11, 30) + v * 86400000);
      return d.toISOString().slice(0, 10);
    }
    const s = String(v).trim();
    let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return m[1] + '-' + m[2] + '-' + m[3];
    m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/);
    if (m) return m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0');
    return null;
  }
  function parseTime(v) {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'number') { // fração de dia (Excel)
      const mins = Math.round((v % 1) * 1440);
      return String(Math.floor(mins / 60)).padStart(2, '0') + ':' + String(mins % 60).padStart(2, '0');
    }
    const m = String(v).trim().match(/^(\d{1,2})[:h](\d{2})/);
    return m ? m[1].padStart(2, '0') + ':' + m[2] : null;
  }
  const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  function tvMinutes(t) {
    let m = toMin(t);
    if (m < cfg.dayparts[0].start) m += 1440; // madrugada pertence ao dia TV anterior
    return m;
  }
  function classifyDaypart(t) {
    if (!t) return null;
    const m = tvMinutes(t);
    const dp = cfg.dayparts.find((d) => m >= d.start && m < d.end);
    return dp ? dp.code : cfg.outOfGrid;
  }
  function daypartFromLabel(lbl) {
    if (!lbl) return null;
    const norm = (s) => String(s).toLowerCase().replace(/[^0-9]/g, '');
    const hit = cfg.dayparts.find((d) => norm(d.label) === norm(lbl) || norm(d.label).slice(0, 4) === norm(lbl).slice(0, 4));
    return hit ? hit.code : String(lbl);
  }
  const dowOf = (iso) => (new Date(iso + 'T00:00:00Z').getUTCDay() + 6) % 7;
  const fmtDM = (iso) => iso.slice(8, 10) + '/' + iso.slice(5, 7);

  /* ---------- normalização dos dados brutos ---------- */
  function readRatings(row, warnings) {
    const o = {};
    cfg.targets.forEach((t) => { o[t.code] = num(row['rating_' + t.code]); });
    return o;
  }

  function normalize(raw) {
    cfg.buildDayparts();
    // Targets presentes nos ficheiros mas não configurados → adicionados (universo desconhecido).
    const sample = (raw.plan[0] || {});
    Object.keys(sample).filter((k) => k.indexOf('rating_') === 0).forEach((k) => {
      const code = k.slice(7);
      if (!cfg.targets.some((t) => t.code === code)) cfg.targets.push({ code, label: code, universe: null });
    });

    const warnings = [];
    const dates = raw.plan.map((p) => parseDate(p.data)).filter(Boolean).sort();
    const start = parseDate(raw.meta && raw.meta.inicio) || dates[0];
    const startMonday = (() => { const d = new Date(start + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - dowOf(start)); return d; })();
    const weekOf = (iso) => {
      const n = Math.floor((new Date(iso + 'T00:00:00Z') - startMonday) / (7 * 86400000));
      const ws = new Date(startMonday.getTime() + n * 7 * 86400000).toISOString().slice(0, 10);
      return 'S' + (n + 1) + ' · ' + fmtDM(ws);
    };

    const planById = new Map();
    const plan = [];
    raw.plan.forEach((p, i) => {
      const date = parseDate(p.data);
      if (!date) { warnings.push('Plano: linha ' + (i + 2) + ' sem data válida (ignorada).'); return; }
      const time = parseTime(p.hora_prevista);
      const row = {
        kind: 'plan', id: String(p.id_linha || 'P#' + (i + 1)), date, dow: dowOf(date), week: weekOf(date), time,
        channel: String(p.canal || '').trim(), daypart: time ? classifyDaypart(time) : daypartFromLabel(p.faixa),
        duration: num(p.duracao_s), cost: num(p.custo_eur) || 0, ratings: readRatings(p)
      };
      plan.push(row); planById.set(row.id, row);
    });

    const linked = new Set();
    const real = [];
    raw.emissions.forEach((e, i) => {
      const date = parseDate(e.data);
      const time = parseTime(e.hora);
      if (!date || !time) { warnings.push('Emissões: linha ' + (i + 2) + ' sem data/hora válidas (ignorada).'); return; }
      const lp = e.id_linha_plano ? planById.get(String(e.id_linha_plano)) : null;
      if (e.id_linha_plano && !lp) warnings.push('Emissões: ' + (e.id_emissao || 'linha ' + (i + 2)) + ' refere a linha de plano inexistente "' + e.id_linha_plano + '".');
      if (lp) linked.add(lp.id);
      const row = {
        kind: 'real', id: String(e.id_emissao || 'E#' + (i + 1)), planId: lp ? lp.id : null,
        date, dow: dowOf(date), week: weekOf(date), time,
        channel: String(e.canal || '').trim(), daypart: classifyDaypart(time),
        duration: num(e.duracao_s), cost: num(e.custo_eur) || 0, ratings: readRatings(e)
      };
      // Estado: deriva-se dos dados; um estado explícito "não conforme" prevalece.
      let st = String(e.estado || '').trim().toLowerCase();
      if (!cfg.statuses[st] || st === 'nao_emitido') st = '';
      if (lp) {
        if (!st || st === 'emitido') {
          if (row.channel !== lp.channel) st = 'substituicao';
          else if (row.daypart !== lp.daypart) st = 'fora_faixa';
          else if (row.duration !== lp.duration) st = 'desvio_secundagem';
          else st = 'emitido';
        }
        row.bought = { channel: lp.channel, daypart: lp.daypart, duration: lp.duration };
      } else {
        if (!st || st === 'emitido') st = row.cost > 0 ? 'adicional' : 'compensacao';
        row.bought = { channel: row.channel, daypart: row.daypart, duration: row.duration };
      }
      row.status = st;
      row.valid = cfg.statuses[st].valid;
      real.push(row);
    });

    const notAired = plan.filter((p) => !linked.has(p.id)).map((p) => Object.assign({}, p, { status: 'nao_emitido', valid: false }));

    const reach = {};
    (raw.reach || []).forEach((r) => {
      const t = String(r.target || '').trim(); const src = String(r.fonte || '').toLowerCase().indexOf('pl') === 0 ? 'plan' : 'real';
      reach[t] = reach[t] || {};
      reach[t][src] = { r1: num(r.reach1_pct), r3: num(r.reach3_pct) };
    });

    // Canais/faixas/durações presentes nos dados mas não configurados
    const extra = (arr, key, list) => arr.forEach((r) => { if (r[key] !== null && r[key] !== '' && !list.includes(r[key])) list.push(r[key]); });
    extra(plan.concat(real), 'channel', cfg.channels);
    extra(plan.concat(real), 'duration', cfg.durations);
    cfg.durations.sort((a, b) => a - b);

    const allDates = plan.concat(real).map((r) => r.date).sort();
    return {
      meta: Object.assign({}, raw.meta || {}),
      plan, real, notAired, reach, warnings,
      period: { from: allDates[0], to: allDates[allDates.length - 1] },
      weeks: Array.from(new Set(plan.concat(real).map((r) => r.week))).sort((a, b) => parseInt(a.slice(1)) - parseInt(b.slice(1)))
    };
  }

  /* ---------- filtros ---------- */
  function filter(model, f, attribution) {
    const inSet = (arr, v) => !arr || !arr.length || arr.includes(v);
    const pass = (r) => (!f.from || r.date >= f.from) && (!f.to || r.date <= f.to) &&
      inSet(f.channels, r.channel) && inSet(f.dayparts, r.daypart) && inSet(f.durations, r.duration) && inSet(f.dows, r.dow) && inSet(f.weeks, r.week);
    const real = model.real.map((r) => (attribution === 'bought' ? Object.assign({}, r, r.bought, { airedChannel: r.channel, airedDaypart: r.daypart, airedDuration: r.duration }) : r));
    return {
      plan: model.plan.filter(pass),
      real: real.filter(pass),
      notAired: model.notAired.filter(pass),
      restricted: !!((f.channels && f.channels.length) || (f.dayparts && f.dayparts.length) || (f.durations && f.durations.length) ||
        (f.dows && f.dows.length) || (f.weeks && f.weeks.length) || (f.from && f.from > model.period.from) || (f.to && f.to < model.period.to))
    };
  }

  /* ---------- agregação ---------- */
  function universe(t) { const x = cfg.targets.find((o) => o.code === t); return x ? x.universe : null; }
  function agg(rows, t) {
    const a = { spots: 0, grp: 0, cost: 0, seconds: 0, contacts: 0, eq30: 0, rated: 0, hasUniverse: !!universe(t) };
    const u = universe(t);
    rows.forEach((r) => {
      a.spots++; a.cost += r.cost || 0; a.seconds += r.duration || 0;
      const v = r.ratings[t];
      if (isNum(v)) {
        a.grp += v; a.rated++;
        if (u) a.contacts += (v / 100) * u;
        const idx = cfg.durationIndex[r.duration];
        a.eq30 += v * (isNum(idx) ? idx : (r.duration || 30) / 30);
      }
    });
    if (!a.rated) { a.grp = rows.length ? null : 0; a.eq30 = a.grp; }
    return a;
  }

  /* Indicadores disponíveis. dir: direção "boa" (higher/lower/neutral). */
  const indicators = {
    grp: { label: 'GRPs', unit: '', dec: 1, dir: 'higher', additive: true, get: (a) => a.grp },
    spots: { label: 'Spots', unit: '', dec: 0, dir: 'higher', additive: true, get: (a) => a.spots },
    cost: { label: 'Investimento', unit: '€', dec: 0, dir: 'neutral', additive: true, get: (a) => a.cost },
    rating: { label: 'Rating médio', unit: '%', dec: 2, dir: 'higher', additive: false, get: (a) => div(a.grp, a.rated) },
    cpp: { label: 'CPP', unit: '€', dec: 0, dir: 'lower', additive: false, get: (a) => div(a.cost, a.grp) },
    cpm: { label: 'CPM', unit: '€', dec: 2, dir: 'lower', additive: false, get: (a) => (a.hasUniverse ? div(a.cost, a.contacts / 1000) : null) },
    eq30: { label: 'GRPs eq. 30"', unit: '', dec: 1, dir: 'higher', additive: true, get: (a) => a.eq30 },
    seconds: { label: 'Segundos emitidos', unit: 's', dec: 0, dir: 'neutral', additive: true, get: (a) => a.seconds },
    avgAud: { label: 'Audiência média por spot', unit: 'ind.', dec: 0, dir: 'higher', additive: false, get: (a) => (a.hasUniverse ? div(a.contacts, a.rated) : null) }
  };
  const val = (a, ind) => indicators[ind].get(a);

  function status(pct, dir) {
    if (!isNum(pct)) return 'na';
    const tol = cfg.tolerance;
    if (dir === 'neutral') return Math.abs(pct) <= tol ? 'tol' : 'warn';
    const s = dir === 'lower' ? -pct : pct;
    return s > tol ? 'pos' : s < -tol ? 'neg' : 'tol';
  }

  /* ---------- dimensões ---------- */
  const dims = {
    channel: { label: 'Canal', key: (r) => r.channel, order: () => cfg.channels.slice(), name: (k) => k },
    daypart: { label: 'Faixa horária', key: (r) => r.daypart, order: () => cfg.dayparts.map((d) => d.code).concat([cfg.outOfGrid]), name: (k) => k },
    duration: { label: 'Secundagem', key: (r) => r.duration, order: () => cfg.durations.slice(), name: (k) => k + '"' },
    dow: { label: 'Dia da semana', key: (r) => r.dow, order: () => [0, 1, 2, 3, 4, 5, 6], name: (k) => cfg.weekdays[k] },
    week: { label: 'Semana', key: (r) => r.week, order: null, name: (k) => k },
    date: { label: 'Data', key: (r) => r.date, order: null, name: (k) => fmtDM(k) }
  };

  function compare(fr, dim, t, opt) {
    const d = dims[dim];
    const map = new Map();
    const get = (k) => { if (!map.has(k)) map.set(k, { key: k, pRows: [], rRows: [] }); return map.get(k); };
    fr.plan.forEach((r) => get(d.key(r)).pRows.push(r));
    fr.real.forEach((r) => get(d.key(r)).rRows.push(r));
    let keys = Array.from(map.keys());
    if (d.order) { const o = d.order(); keys = o.filter((k) => map.has(k)).concat(keys.filter((k) => !o.includes(k))); }
    else keys.sort((a, b) => (dim === 'week' ? parseInt(String(a).slice(1)) - parseInt(String(b).slice(1)) : String(a).localeCompare(String(b))));
    if (opt && opt.allKeys && d.order) keys = d.order().filter((k) => k !== cfg.outOfGrid || map.has(k)).concat(keys.filter((k) => !d.order().includes(k)));
    return keys.map((k) => { const g = map.get(k) || { pRows: [], rRows: [] }; return { key: k, label: d.name(k), p: agg(g.pRows, t), r: agg(g.rRows, t), rRows: g.rRows, pRows: g.pRows }; });
  }

  function cross(fr, dimA, dimB, t) {
    const A = dims[dimA], B = dims[dimB];
    const map = new Map();
    const get = (a, b) => { const k = a + '||' + b; if (!map.has(k)) map.set(k, { a, b, pRows: [], rRows: [] }); return map.get(k); };
    fr.plan.forEach((r) => get(A.key(r), B.key(r)).pRows.push(r));
    fr.real.forEach((r) => get(A.key(r), B.key(r)).rRows.push(r));
    const present = (dim, idx) => { const s = new Set(Array.from(map.values()).map((v) => v[idx])); const o = dims[dim].order ? dims[dim].order() : Array.from(s).sort(); return o.filter((k) => s.has(k)).concat(Array.from(s).filter((k) => !o.includes(k))); };
    const rows = present(dimA, 'a'), cols = present(dimB, 'b');
    const cell = (a, b) => { const g = map.get(a + '||' + b); return g ? { p: agg(g.pRows, t), r: agg(g.rRows, t), rRows: g.rRows } : null; };
    return { rows, cols, cell, rowName: A.name, colName: B.name };
  }

  /* Decomposição do desvio de GRPs: efeito volume (spots) + efeito audiência (rating). */
  function effects(p, r) {
    if (!isNum(p.grp) || !isNum(r.grp)) return { volume: null, audience: null, total: null };
    const ratingP = div(p.grp, p.rated);
    const total = r.grp - p.grp;
    const volume = ratingP === null ? total : (r.spots - p.spots) * ratingP;
    return { volume, audience: total - volume, total };
  }

  /* ---------- resumo executivo ---------- */
  function summary(model, fr, t) {
    const p = agg(fr.plan, t), r = agg(fr.real, t);
    const pT = agg(fr.plan, cfg.buyTarget), rT = agg(fr.real, cfg.buyTarget);
    const validReal = fr.real.filter((x) => x.valid);
    const contractual = fr.real.filter((x) => x.planId && x.valid).length;
    const rv = agg(validReal, t);

    let reach = { available: false, reason: '' };
    const rd = model.reach[t];
    if (fr.restricted) reach.reason = 'Só existe para o total da campanha (não se obtém por soma de canais, faixas ou semanas).';
    else if (!rd || !rd.plan || !rd.real) reach.reason = 'Sem dados de cobertura deduplicada para o target selecionado.';
    else reach = { available: true, plan: rd.plan, real: rd.real, freqP: div(p.grp, rd.plan.r1), freqR: div(r.grp, rd.real.r1) };

    const volume = div(contractual, fr.plan.length);
    const audience = div(r.grp, p.grp);
    const cppP = div(p.cost, p.grp), cppR = div(r.cost, r.grp);
    const costEff = div(cppP, cppR);
    const tol = cfg.tolerance / 100;
    const st = (x) => (x === null ? 'na' : x >= 1 + tol ? 'pos' : x >= 1 - tol ? 'tol' : 'neg');
    const parts = [st(volume), st(audience), st(costEff)];
    const negs = parts.filter((s) => s === 'neg').length;
    const overall = parts.includes('na') ? 'na' : negs === 0 ? 'pos' : negs === 1 ? 'tol' : 'neg';
    return {
      p, r, pT, rT, rv, reach,
      compliance: {
        volume, audience, costEff, overall, parts,
        score: [volume, audience, costEff].every(isNum) ? (Math.min(volume, 1.2) + Math.min(audience, 1.2) + Math.min(costEff, 1.2)) / 3 : null
      },
      counts: {
        planned: fr.plan.length, aired: fr.real.length, valid: validReal.length, contractual,
        notAired: fr.notAired.length, invalid: fr.real.length - validReal.length
      }
    };
  }

  /* ---------- ranking de oportunidades (canal × faixa) ---------- */
  function opportunities(fr, t) {
    const all = agg(fr.real, t);
    const cppAvg = div(all.cost, all.grp);
    const x = cross(fr, 'channel', 'daypart', t);
    const out = [];
    const clamp = (v) => (isNum(v) ? Math.max(0, Math.min(2, v)) : 1);
    x.rows.forEach((c) => x.cols.forEach((d) => {
      const cell = x.cell(c, d);
      if (!cell || (!cell.p.spots && !cell.r.spots)) return;
      const ratingP = div(cell.p.grp, cell.p.rated), ratingR = div(cell.r.grp, cell.r.rated);
      const cppR = div(cell.r.cost, cell.r.grp);
      const audIdx = div(ratingR, ratingP);
      const costIdx = cppR === null || cell.r.cost === 0 ? null : div(cppAvg, cppR);
      const delivery = div(cell.r.grp, cell.p.grp);
      const score = 100 * (0.4 * clamp(costIdx) + 0.35 * clamp(audIdx) + 0.25 * clamp(delivery));
      const impact = isNum(cppAvg) && cell.r.cost > 0 && isNum(cell.r.grp) ? cell.r.grp - cell.r.cost / cppAvg : null;
      let action = 'Manter';
      if (isNum(delivery) && delivery < 0.9) action = 'Exigir compensação';
      if (isNum(costIdx) && costIdx < 0.9 && ((isNum(audIdx) && audIdx < 0.95) || (isNum(delivery) && delivery < 0.95))) action = 'Reduzir / renegociar';
      else if (isNum(costIdx) && costIdx >= 1.1 && (!isNum(audIdx) || audIdx >= 1)) action = 'Reforçar';
      out.push({ channel: c, daypart: d, spotsP: cell.p.spots, spotsR: cell.r.spots, grpP: cell.p.grp, grpR: cell.r.grp, ratingP, ratingR, cppR, costR: cell.r.cost, audIdx, costIdx, delivery, score, impact, action });
    }));
    return { rows: out, cppAvg };
  }

  return { isNum, div, dev, devPct, num, parseDate, parseTime, classifyDaypart, normalize, filter, agg, indicators, val, status, dims, compare, cross, effects, summary, opportunities, fmtDM };
})();

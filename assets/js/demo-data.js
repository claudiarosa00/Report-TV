/* =============================================================================
 * demo-data.js — Gerador de dados FICTÍCIOS (mas realistas) de demonstração
 * -----------------------------------------------------------------------------
 * Produz exatamente o mesmo formato "plano" que se espera de um ficheiro
 * importado (ver README / secção Dados & Metodologia):
 *   plan      → linhas do plano de media (1 linha = 1 spot planeado)
 *   emissions → registo real de emissões com audiências (pós-avaliação)
 *   reach     → cobertura deduplicada (fonte: software de audiências)
 * Gerador determinístico (seed fixa) → os números são sempre os mesmos.
 * ========================================================================== */
window.TV = window.TV || {};

TV.demoData = (function () {
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const CH = ['RTP1', 'SIC', 'TVI', 'CMTV', 'SIC Notícias', 'CNN Portugal'];
  // Faixas usadas na geração (independentes de eventuais edições posteriores).
  const DP = [[420, 600], [600, 780], [780, 1080], [1080, 1200], [1200, 1380], [1380, 1560]];
  const DP_LABEL = ['07h00–10h00', '10h00–13h00', '13h00–18h00', '18h00–20h00', '20h00–23h00', '23h00–02h00'];

  // Rating base (%) Mulheres 25-54, por canal × faixa, antes da escala.
  const BASE = [
    [0.9, 1.2, 1.8, 2.6, 4.2, 1.6],
    [1.1, 1.6, 2.4, 3.2, 5.6, 2.0],
    [1.0, 1.7, 2.6, 3.0, 5.2, 1.9],
    [0.6, 0.9, 1.4, 1.6, 2.1, 0.9],
    [0.3, 0.35, 0.45, 0.5, 0.7, 0.4],
    [0.25, 0.3, 0.4, 0.45, 0.65, 0.35]
  ];
  const SCALE = 0.47;
  // Spots planeados por semana (canal × faixa).
  const WEEKLY = [
    [3, 3, 5, 4, 6, 2],
    [4, 4, 6, 5, 8, 3],
    [4, 4, 6, 5, 8, 3],
    [3, 4, 5, 3, 4, 2],
    [2, 3, 4, 3, 4, 2],
    [2, 3, 3, 3, 4, 2]
  ];
  const FLIGHT = [1.15, 1.05, 0.95, 0.85]; // peso de cada semana (arranque forte)
  const CPP_CONTRACT = [1150, 1300, 1250, 850, 1000, 1050]; // € por GRP (target compra)
  const DP_MULT = [0.85, 0.85, 0.9, 1.05, 1.15, 0.9];
  const DOW = [1.0, 1.0, 0.98, 1.0, 0.92, 0.95, 1.08];
  // Afinidade de cada target face a Mulheres 25-54 (por canal).
  const AFF = {
    M2554: [1, 1, 1, 1, 1, 1],
    A2554: [0.85, 0.92, 0.90, 0.88, 1.0, 1.02],
    IND4: [1.05, 0.92, 0.95, 1.10, 1.15, 1.10],
    ABC1534: [0.45, 0.75, 0.70, 0.50, 0.55, 0.60]
  };
  // Performance real face ao planeado (canal × faixa).
  const PERF = [
    [1.02, 0.98, 1.00, 1.03, 0.88, 0.95],
    [1.00, 1.04, 1.02, 1.12, 1.05, 1.00],
    [0.98, 1.00, 0.97, 0.92, 0.80, 0.90],
    [1.10, 1.15, 1.18, 1.12, 1.14, 1.08],
    [1.05, 1.03, 1.08, 1.06, 1.04, 1.02],
    [0.95, 0.93, 0.96, 0.94, 0.90, 0.92]
  ];
  const TVI_PRIME_WEEK = [1.08, 1.0, 0.86, 0.92];
  const DUR_INDEX = { 10: 0.55, 15: 0.70, 20: 0.80, 30: 1.00, 45: 1.45, 60: 1.85 };
  const SUBST = { SIC: 'SIC Notícias', TVI: 'CNN Portugal' };
  const DUR_DOWN = { 60: 45, 45: 30, 30: 20, 20: 15, 15: 10 };
  const START = new Date(Date.UTC(2026, 8, 7)); // segunda-feira, 7 set 2026

  const iso = (d) => d.toISOString().slice(0, 10);
  const hhmm = (m) => { m = ((m % 1440) + 1440) % 1440; return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };
  const r2 = (v) => Math.round(v * 100) / 100;
  const price = (c, d, dur) => Math.round(CPP_CONTRACT[c] * DP_MULT[d] * BASE[c][d] * SCALE * DUR_INDEX[dur] / 10) * 10;

  function generate() {
    const rnd = mulberry32(20260907);
    const gauss = () => { let u = 0, v = 0; while (!u) u = rnd(); while (!v) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
    const pickDur = () => {
      const x = rnd();
      return x < 0.50 ? 30 : x < 0.70 ? 20 : x < 0.85 ? 15 : x < 0.93 ? 10 : x < 0.97 ? 45 : 60;
    };
    const ratingsFor = (c, d, dow, factor, jitter) => {
      const base = (d === 6 ? BASE[c][0] * 0.35 : BASE[c][d]) * SCALE * DOW[dow] * factor;
      const o = {};
      Object.keys(AFF).forEach((t) => { o['rating_' + t] = r2(base * AFF[t][c] * (1 + (rnd() - 0.5) * jitter)); });
      return o;
    };

    const plan = [];
    const emissions = [];
    let pid = 0, eid = 0;

    for (let w = 0; w < 4; w++) {
      for (let c = 0; c < CH.length; c++) {
        for (let d = 0; d < DP.length; d++) {
          const n = Math.max(1, Math.round(WEEKLY[c][d] * FLIGHT[w]));
          for (let i = 0; i < n; i++) {
            const dow = Math.floor(rnd() * 7);
            const date = new Date(START.getTime() + (w * 7 + dow) * 86400000);
            const t = DP[d][0] + 5 + Math.floor(rnd() * (DP[d][1] - DP[d][0] - 15));
            const dur = pickDur();
            const row = Object.assign({
              id_linha: 'P' + String(++pid).padStart(4, '0'),
              data: iso(date), hora_prevista: hhmm(t), canal: CH[c], faixa: DP_LABEL[d],
              duracao_s: dur, custo_eur: price(c, d, dur)
            }, ratingsFor(c, d, dow, 0.95 + rnd() * 0.1, 0.06));
            plan.push(row);

            /* --- Realizado ------------------------------------------------ */
            const isPrime = d === 4;
            const pNot = 0.022 + (c === 2 && isPrime ? 0.06 : 0) + (c === 5 ? 0.035 : 0);
            const pOut = 0.018 + (isPrime ? 0.035 : 0);
            const pSub = SUBST[CH[c]] ? 0.025 : 0;
            const pDur = DUR_DOWN[dur] ? 0.018 : 0;
            const x = rnd();
            let status = 'emitido', ac = c, ad = d, adur = dur, at = t + Math.round((rnd() - 0.5) * 20);
            at = Math.min(Math.max(at, DP[d][0] + 1), DP[d][1] - 2);
            if (x < pNot) continue; // não emitido → sem linha de emissão
            else if (x < pNot + pOut) {
              status = 'fora_faixa';
              if (d === 5) { ad = 6; at = 1560 + 5 + Math.floor(rnd() * 40); }
              else if (d === 0) { ad = 6; at = 420 - 10 - Math.floor(rnd() * 25); }
              else { ad = d + 1; at = DP[d + 1][0] + 3 + Math.floor(rnd() * 30); }
            } else if (x < pNot + pOut + pSub) {
              status = 'substituicao'; ac = CH.indexOf(SUBST[CH[c]]);
            } else if (x < pNot + pOut + pSub + pDur) {
              status = 'desvio_secundagem'; adur = DUR_DOWN[dur];
            }
            let perf = (ad === 6 ? 1 : PERF[ac][ad]);
            if (ac === 2 && ad === 4) perf *= TVI_PRIME_WEEK[w];
            if (ac === 0 && ad === 4 && w >= 2) perf *= 0.94;
            const noise = Math.exp(gauss() * 0.14);
            const cost = ad === 6 ? Math.round(price(ac, d, adur) * 0.5 / 10) * 10 : price(ac, ad, adur);
            emissions.push(Object.assign({
              id_emissao: 'E' + String(++eid).padStart(4, '0'), id_linha_plano: row.id_linha,
              data: iso(date), hora: hhmm(at) + ':' + String(Math.floor(rnd() * 60)).padStart(2, '0'),
              canal: CH[ac], duracao_s: adur, custo_eur: cost, estado: status
            }, ratingsFor(ac, ad, dow, perf * noise, 0.08)));
          }
        }
      }
    }

    /* Compensações gratuitas (TVI/RTP1) pela quebra no prime time, semanas 3-4. */
    const comp = [[2, 3, 6], [2, 2, 4], [2, 5, 3], [0, 2, 3], [0, 5, 2]];
    comp.forEach(([c, d, n]) => {
      for (let i = 0; i < n; i++) {
        const day = 14 + Math.floor(rnd() * 14);
        const date = new Date(START.getTime() + day * 86400000);
        const t = DP[d][0] + 5 + Math.floor(rnd() * (DP[d][1] - DP[d][0] - 15));
        emissions.push(Object.assign({
          id_emissao: 'E' + String(++eid).padStart(4, '0'), id_linha_plano: '',
          data: iso(date), hora: hhmm(t) + ':00', canal: CH[c], duracao_s: 30, custo_eur: 0, estado: 'compensacao'
        }, ratingsFor(c, d, (day % 7), PERF[c][d] * Math.exp(gauss() * 0.12), 0.08)));
      }
    });
    /* Spots adicionais pagos e acordados (CMTV), semanas 2-3. */
    [[3, 2, 4], [3, 3, 2]].forEach(([c, d, n]) => {
      for (let i = 0; i < n; i++) {
        const day = 7 + Math.floor(rnd() * 14);
        const date = new Date(START.getTime() + day * 86400000);
        const t = DP[d][0] + 5 + Math.floor(rnd() * (DP[d][1] - DP[d][0] - 15));
        emissions.push(Object.assign({
          id_emissao: 'E' + String(++eid).padStart(4, '0'), id_linha_plano: '',
          data: iso(date), hora: hhmm(t) + ':00', canal: CH[c], duracao_s: 20, custo_eur: price(c, d, 20), estado: 'adicional'
        }, ratingsFor(c, d, (day % 7), PERF[c][d] * Math.exp(gauss() * 0.12), 0.08)));
      }
    });

    emissions.sort((a, b) => (a.data + a.hora).localeCompare(b.data + b.hora));

    const reach = [
      { target: 'M2554', fonte: 'plano', reach1_pct: 78.5, reach3_pct: 57.0 },
      { target: 'M2554', fonte: 'real', reach1_pct: 76.8, reach3_pct: 54.2 },
      { target: 'A2554', fonte: 'plano', reach1_pct: 74.2, reach3_pct: 50.4 },
      { target: 'A2554', fonte: 'real', reach1_pct: 72.9, reach3_pct: 48.6 },
      { target: 'IND4', fonte: 'plano', reach1_pct: 71.0, reach3_pct: 47.9 },
      { target: 'IND4', fonte: 'real', reach1_pct: 70.1, reach3_pct: 46.0 }
      // ABC 15-34: sem dados deduplicados → cobertura apresentada como indisponível.
    ];

    const meta = {
      campanha: 'Lançamento Outono 2026',
      anunciante: 'Lusolac (anunciante fictício)',
      produto: 'Iogurte Natura+',
      agencia: 'Agência de Meios — demo',
      fonte: 'Dados fictícios de demonstração',
      inicio: iso(START),
      fim: iso(new Date(START.getTime() + 27 * 86400000))
    };

    return { meta, plan, emissions, reach };
  }

  return { generate };
})();

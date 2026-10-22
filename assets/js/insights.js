/* =============================================================================
 * insights.js — Conclusões, respostas-chave e recomendações automáticas
 * Todas as frases são construídas a partir dos valores calculados para os
 * filtros ativos; se um dado não existir, a frase não é gerada.
 * ========================================================================== */
window.TV = window.TV || {};

TV.insights = (function () {
  const E = () => TV.engine, F = () => TV.ui.fmt;
  const isNum = (x) => typeof x === 'number' && isFinite(x);

  /* Prepara métricas de cada grupo de uma comparação. */
  function enrich(list) {
    const totP = list.reduce((s, x) => s + (x.p.grp || 0), 0), totR = list.reduce((s, x) => s + (x.r.grp || 0), 0);
    const totPS = list.reduce((s, x) => s + x.p.spots, 0), totRS = list.reduce((s, x) => s + x.r.spots, 0);
    return list.map((x) => {
      const fx = E().effects(x.p, x.r);
      return Object.assign({}, x, {
        grpDev: E().dev(x.r.grp, x.p.grp), grpPct: E().devPct(x.r.grp, x.p.grp), spotPct: E().devPct(x.r.spots, x.p.spots),
        ratingP: E().div(x.p.grp, x.p.rated), ratingR: E().div(x.r.grp, x.r.rated),
        ratingPct: E().devPct(E().div(x.r.grp, x.r.rated), E().div(x.p.grp, x.p.rated)),
        cppP: E().div(x.p.cost, x.p.grp), cppR: E().div(x.r.cost, x.r.grp),
        cppPct: E().devPct(E().div(x.r.cost, x.r.grp), E().div(x.p.cost, x.p.grp)),
        wP: E().div(x.p.grp, totP), wR: E().div(x.r.grp, totR), sP: E().div(x.p.spots, totPS), sR: E().div(x.r.spots, totRS),
        volume: fx.volume, audience: fx.audience
      });
    });
  }
  const maxBy = (arr, f) => arr.filter((x) => isNum(f(x))).sort((a, b) => f(b) - f(a))[0];
  const minBy = (arr, f) => arr.filter((x) => isNum(f(x))).sort((a, b) => f(a) - f(b))[0];

  function conclusions(ctx) {
    const out = [];
    const { s, dp, ch, du, dw } = ctx;
    const tol = TV.config.tolerance;
    const push = (type, text, sec) => out.push({ type, text, sec });
    const gPct = E().devPct(s.r.grp, s.p.grp);

    if (isNum(gPct)) {
      push(E().status(gPct, 'higher'), (gPct >= 0 ? 'A campanha entregou mais GRPs do que o planeado: ' : 'A campanha entregou menos GRPs do que o planeado: ') +
        F().n(s.r.grp, 1) + ' realizados vs ' + F().n(s.p.grp, 1) + ' planeados (' + F().signedPct(gPct) + ', ' + ctx.targetLabel + ').', 'Resumo executivo');
    }
    const cppP = E().div(s.p.cost, s.p.grp), cppR = E().div(s.r.cost, s.r.grp), cppPct = E().devPct(cppR, cppP);
    if (isNum(cppPct)) push(E().status(cppPct, 'lower'), 'O CPP realizado foi ' + (cppPct > 0 ? 'superior' : 'inferior') + ' ao previsto: ' + F().eur(cppR) + ' vs ' + F().eur(cppP) + ' (' + F().signedPct(cppPct) + ').' + (Math.abs(cppPct) <= tol ? ' Dentro da tolerância.' : ''), 'Eficiência');
    if (s.counts.planned) {
      push(s.counts.notAired + s.counts.invalid > 0.08 * s.counts.planned ? 'neg' : 'tol',
        s.counts.contractual + ' de ' + s.counts.planned + ' spots planeados foram emitidos nas condições contratadas (' + F().pct(100 * s.counts.contractual / s.counts.planned) + '); ' +
        s.counts.notAired + ' não foram emitidos e ' + s.counts.invalid + ' emissões ficaram fora das condições acordadas.', 'Qualidade de entrega');
    }
    const worstDp = minBy(dp.filter((x) => x.p.spots), (x) => x.grpDev);
    if (worstDp && worstDp.grpDev < 0) {
      const main = Math.abs(worstDp.audience) > Math.abs(worstDp.volume) ? 'sobretudo por quebra de audiência (rating médio ' + F().signedPct(worstDp.ratingPct) + ')' : 'sobretudo por falta de inserções (spots ' + F().signedPct(worstDp.spotPct) + ')';
      push('neg', 'A faixa ' + worstDp.label + (worstDp.key === ctx.primeKey ? ' (prime time)' : '') + ' é a principal fonte de subentrega: ' + F().signed(worstDp.grpDev, 1) + ' GRPs (' + F().signedPct(worstDp.grpPct) + '), ' + main + '.', 'Faixas horárias');
    }
    const prime = dp.find((x) => x.key === ctx.primeKey);
    if (prime && prime !== worstDp && isNum(prime.ratingPct) && prime.ratingPct < -tol) push('neg', 'O prime time (' + prime.label + ') apresentou uma quebra de audiência: rating médio ' + F().n(prime.ratingR, 2) + '% vs ' + F().n(prime.ratingP, 2) + '% planeado (' + F().signedPct(prime.ratingPct) + ').', 'Faixas horárias');
    const bestDp = maxBy(dp.filter((x) => x.p.spots), (x) => x.grpPct);
    if (bestDp && bestDp.grpPct > tol) push('pos', 'A faixa ' + bestDp.label + ' superou o plano em ' + F().signedPct(bestDp.grpPct) + ' de GRPs (' + F().signed(bestDp.grpDev, 1) + ').', 'Faixas horárias');
    const cheapDp = minBy(dp.filter((x) => x.r.cost > 0), (x) => x.cppR);
    if (cheapDp) push('info', 'Faixa mais eficiente em custo: ' + cheapDp.label + ', com CPP realizado de ' + F().eur(cheapDp.cppR) + (isNum(cppR) ? ' (média da campanha ' + F().eur(cppR) + ').' : '.'), 'Eficiência');

    const shift = maxBy(dp, (x) => (isNum(x.sR) && isNum(x.sP) ? Math.abs(x.sR - x.sP) : null));
    if (shift && Math.abs(shift.sR - shift.sP) * 100 >= 1) push(Math.abs(shift.sR - shift.sP) * 100 > 3 ? 'warn' : 'tol', 'Maior alteração na distribuição de spots: ' + shift.label + ' pesava ' + F().pct(shift.sP * 100) + ' do plano e ' + F().pct(shift.sR * 100) + ' do realizado (' + F().signed((shift.sR - shift.sP) * 100, 1, ' p.p.') + ').', 'Faixas horárias');

    const worstCh = minBy(ch.filter((x) => x.p.spots), (x) => x.grpDev);
    const bestCh = maxBy(ch.filter((x) => x.p.spots), (x) => x.grpDev);
    if (worstCh && worstCh.grpDev < 0) push('neg', worstCh.label + ' foi o canal com maior subentrega: ' + F().signed(worstCh.grpDev, 1) + ' GRPs (' + F().signedPct(worstCh.grpPct) + ').', 'Canais');
    if (bestCh && worstCh && bestCh.grpDev > 0 && worstCh.grpDev < 0) {
      const cover = Math.min(100, 100 * bestCh.grpDev / Math.abs(worstCh.grpDev));
      push('pos', bestCh.label + ' compensou ' + (cover >= 100 ? 'totalmente' : 'parcialmente') + ' a subentrega de ' + worstCh.label + ': ' + F().signed(bestCh.grpDev, 1) + ' GRPs adicionais, equivalentes a ' + F().pct(cover, 0) + ' do défice.', 'Canais');
    }
    const topDu = maxBy(du, (x) => x.r.grp);
    if (topDu && isNum(topDu.wR)) push('info', 'O formato de ' + topDu.label + ' foi o que mais contribuiu para os resultados: ' + F().pct(topDu.wR * 100) + ' dos GRPs realizados.', 'Secundagem');
    const worstDw = minBy(dw.filter((x) => x.p.spots), (x) => x.grpPct);
    if (worstDw && worstDw.grpPct < -tol) push('neg', 'Dia da semana com maior desvio negativo: ' + worstDw.label + ' (' + F().signedPct(worstDw.grpPct) + ' de GRPs).', 'Dia da semana');
    const worstWk = minBy((ctx.wk || []).filter((x) => x.p.spots), (x) => x.grpPct);
    if (worstWk && worstWk.grpPct < -tol) push('neg', 'A semana ' + worstWk.label + ' foi a de maior subentrega: ' + F().signed(worstWk.grpDev, 1) + ' GRPs (' + F().signedPct(worstWk.grpPct) + ').', 'Semanas');
    else if (worstWk) push('tol', 'Nenhuma semana ficou abaixo da tolerância de ±' + tol + '% em GRPs.', 'Semanas');
    const q = ctx.quality;
    if (q && q.comp > 0) push('info', 'Foram emitidos ' + q.comp + ' spots de compensação sem custo, que geraram ' + F().n(q.compGrp, 1) + ' GRPs.', 'Qualidade de entrega');
    if (s.reach.available) {
      const d1 = s.reach.real.r1 - s.reach.plan.r1;
      push(E().status(E().devPct(s.reach.real.r1, s.reach.plan.r1), 'higher'), 'Cobertura 1+ de ' + F().pct(s.reach.real.r1) + ' vs ' + F().pct(s.reach.plan.r1) + ' planeada (' + F().signed(d1, 1, ' p.p.') + '), com frequência média de ' + F().n(s.reach.freqR, 1) + '.', 'Resumo executivo');
    }
    return out;
  }

  function qa(ctx) {
    const { s, dp, ch, du } = ctx;
    const c = s.compliance;
    const tol = TV.config.tolerance;
    const verdict = { pos: 'Sim — plano cumprido ou superado', tol: 'Parcialmente', neg: 'Não', na: 'Indeterminado' }[c.overall];
    const pct = (x) => (isNum(x) ? F().pct(x * 100, 0) : 'n.d.');
    const best = maxBy(ch.filter((x) => x.p.spots), (x) => x.grpPct), worst = minBy(ch.filter((x) => x.p.spots), (x) => x.grpPct);
    const eff = dp.filter((x) => x.r.cost > 0 && isNum(x.cppR)).sort((a, b) => a.cppR - b.cppR);
    const maxShift = maxBy(dp, (x) => (isNum(x.sR) && isNum(x.sP) ? Math.abs(x.sR - x.sP) : null));
    const shiftPP = maxShift ? Math.abs(maxShift.sR - maxShift.sP) * 100 : 0;
    const topDu = maxBy(du, (x) => x.r.grp);
    const cppPct = E().devPct(E().div(s.r.cost, s.r.grp), E().div(s.p.cost, s.p.grp));
    const worstCell = ctx.worstCell;
    const recs = ctx.recos.slice(0, 2).map((r) => r.action).join(' ');
    return [
      ['A campanha cumpriu o plano de televisão?', verdict + '. Volume ' + pct(c.volume) + ', audiência ' + pct(c.audience) + ', eficiência de custo ' + pct(c.costEff) + ' (tolerância ±' + tol + '%).'],
      ['Quantos GRPs foram efetivamente entregues?', F().n(s.r.grp, 1) + ' GRPs ' + ctx.targetLabel + ' (' + F().n(s.rv.grp, 1) + ' em emissões contratualmente válidas) vs ' + F().n(s.p.grp, 1) + ' planeados.'],
      ['Quais foram os principais desvios?', ctx.topDevText || 'Sem desvios relevantes.'],
      ['Que canais tiveram melhor e pior performance?', best && worst ? 'Melhor: ' + best.label + ' (' + F().signedPct(best.grpPct) + ' GRPs). Pior: ' + worst.label + ' (' + F().signedPct(worst.grpPct) + ').' : 'n.d.'],
      ['Que faixas horárias foram mais eficientes?', eff.length ? eff.slice(0, 2).map((x) => x.label + ' (CPP ' + F().eur(x.cppR) + ')').join(' e ') + '.' : 'n.d.'],
      ['A distribuição real respeitou a contratada?', maxShift ? (shiftPP <= 3 ? 'Sim, no essencial: ' : 'Com desvios: ') + 'maior diferença de peso em ' + maxShift.label + ' (' + F().signed((maxShift.sR - maxShift.sP) * 100, 1, ' p.p.') + ' de spots). ' + s.counts.invalid + ' emissões fora das condições.' : 'n.d.'],
      ['Que secundagens contribuíram mais?', topDu ? topDu.label + ' gerou ' + F().pct(topDu.wR * 100) + ' dos GRPs realizados (' + F().pct(topDu.sR * 100) + ' dos spots).' : 'n.d.'],
      ['O investimento foi eficiente?', isNum(cppPct) ? 'CPP realizado ' + F().eur(E().div(s.r.cost, s.r.grp)) + ' vs ' + F().eur(E().div(s.p.cost, s.p.grp)) + ' planeado (' + F().signedPct(cppPct) + '): ' + (cppPct <= tol ? (cppPct < -tol ? 'mais eficiente do que o previsto.' : 'em linha com o previsto.') : 'menos eficiente do que o previsto.') : 'n.d.'],
      ['Onde se concentraram os problemas de entrega?', worstCell ? worstCell.channel + ' · ' + worstCell.daypart + ' (' + F().signed(worstCell.dev, 1) + ' GRPs, ' + F().signedPct(worstCell.pct) + '). ' + s.counts.notAired + ' spots não emitidos.' : 'Sem concentração relevante.'],
      ['Que conclusões e recomendações apresentar?', recs || 'Ver secção Análise e Comentários.']
    ];
  }

  /* Recomendações estruturadas: evidência → interpretação → ação. */
  function recommendations(ctx) {
    const out = [];
    const { dp, ch, du, opp } = ctx;
    const tol = TV.config.tolerance;
    const worstDp = minBy(dp.filter((x) => x.p.spots), (x) => x.grpPct);
    if (worstDp && worstDp.grpPct < -tol) {
      const aud = Math.abs(worstDp.audience) > Math.abs(worstDp.volume);
      out.push({
        evidence: worstDp.label + ': ' + F().signed(worstDp.grpDev, 1) + ' GRPs (' + F().signedPct(worstDp.grpPct) + '); spots ' + F().signedPct(worstDp.spotPct) + ', rating médio ' + F().signedPct(worstDp.ratingPct) + '.',
        interpretation: (aud ? 'A maior parte do desvio vem da audiência por spot' : 'A maior parte do desvio vem do número de inserções') + ' (efeito audiência ' + F().signed(worstDp.audience, 1) + ' GRPs; efeito volume ' + F().signed(worstDp.volume, 1) + ' GRPs). ' + (aud ? 'O risco principal está na previsão de audiência, mais do que na execução.' : 'Há spots em falta ou deslocados para outras faixas.'),
        action: aud ? 'Negociar garantia de GRPs (compra a CPP garantido) ou cláusula de compensação para ' + worstDp.label + '.' : 'Exigir reposição dos spots em falta em ' + worstDp.label + ' e reforçar o controlo de emissões fora de faixa.',
        source: 'Faixas horárias'
      });
    }
    const reinforce = opp.rows.filter((o) => o.action === 'Reforçar').sort((a, b) => b.score - a.score)[0];
    if (reinforce) out.push({
      evidence: reinforce.channel + ' · ' + reinforce.daypart + ': CPP ' + F().eur(reinforce.cppR) + ' (média ' + F().eur(opp.cppAvg) + '), rating ' + F().signedPct((reinforce.audIdx - 1) * 100) + ' vs plano.',
      interpretation: 'Combinação com custo por ponto abaixo da média e audiência igual ou superior à prevista.',
      action: 'Reforçar o peso de ' + reinforce.channel + ' em ' + reinforce.daypart + ' em próximas vagas, respeitando limites de saturação e a afinidade com o target.',
      source: 'Ranking de oportunidades'
    });
    const cut = opp.rows.filter((o) => o.action === 'Reduzir / renegociar').sort((a, b) => a.score - b.score)[0];
    if (cut) out.push({
      evidence: cut.channel + ' · ' + cut.daypart + ': CPP ' + F().eur(cut.cppR) + ', entrega de ' + F().pct((cut.delivery || 0) * 100, 0) + ' dos GRPs planeados.',
      interpretation: 'Combinação cara e abaixo do plano — o investimento aí gera menos pontos do que no resto da campanha.',
      action: 'Reduzir peso ou renegociar o preço desta combinação; transferir investimento para combinações com melhor CPP.',
      source: 'Ranking de oportunidades'
    });
    const q = ctx.quality;
    if (q && q.invalid > 0) out.push({
      evidence: q.invalid + ' emissões fora das condições (' + q.out + ' fora de faixa, ' + q.sub + ' substituições, ' + q.dur + ' desvios de secundagem), com ' + F().n(q.invalidGrp, 1) + ' GRPs.',
      interpretation: 'Estas emissões geram audiência mas não cumprem o contratado; devem ser tratadas separadamente na faturação.',
      action: 'Solicitar nota de crédito ou reposição para as emissões não conformes e incluir penalizações por emissão fora de faixa no próximo contrato.',
      source: 'Qualidade de entrega'
    });
    const best = maxBy(ch.filter((x) => x.p.spots), (x) => x.grpPct);
    if (best && best.grpPct > tol) out.push({
      evidence: best.label + ' entregou ' + F().signedPct(best.grpPct) + ' de GRPs face ao plano com CPP ' + F().eur(best.cppR) + '.',
      interpretation: 'O canal superou a estimativa de audiência; a previsão do plano foi conservadora.',
      action: 'Rever as estimativas de audiência de ' + best.label + ' no próximo plano e considerar aumento de quota.',
      source: 'Canais'
    });
    const d30 = du.find((x) => x.key === 30), dShort = du.filter((x) => x.key < 30 && x.r.cost > 0);
    if (d30 && dShort.length && isNum(d30.cppR)) {
      const eqCpp = (x) => E().div(x.r.cost, x.r.eq30);
      const cheap = minBy(dShort, eqCpp);
      if (cheap && isNum(eqCpp(cheap)) && isNum(eqCpp(d30))) out.push({
        evidence: 'CPP por GRP eq. 30": ' + cheap.label + ' ' + F().eur(eqCpp(cheap)) + ' vs 30" ' + F().eur(eqCpp(d30)) + '.',
        interpretation: 'A diferença reflete a tabela de preços por secundagem; não implica que formatos curtos gerem mais audiência por spot.',
        action: 'Usar formatos curtos para reforço de frequência (reminders) e manter o 30" como formato principal de comunicação.',
        source: 'Secundagem'
      });
    }
    return out;
  }

  return { enrich, conclusions, qa, recommendations };
})();

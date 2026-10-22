/* =============================================================================
 * charts.js — Camada de gráficos (Chart.js 4)
 * Lê as cores dos tokens CSS → os gráficos acompanham o tema claro/escuro.
 * Regras: um único eixo Y por gráfico; planeado = cinzento (referência),
 * realizado = azul; desvios com cor de estado + sinal no rótulo.
 * ========================================================================== */
window.TV = window.TV || {};

TV.charts = (function () {
  const reg = {};
  const v = (n) => TV.ui.cssVar(n);
  const channelColor = (name) => {
    const i = TV.config.channels.indexOf(name);
    return v('--c' + ((i < 0 ? 7 : i % 8) + 1));
  };

  function theme() {
    if (!window.Chart) return;
    Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
    Chart.defaults.font.size = 11.5;
    Chart.defaults.color = v('--text-2');
    Chart.defaults.borderColor = v('--border');
    Chart.defaults.plugins.legend.display = false;
    Chart.defaults.plugins.tooltip.backgroundColor = v('--text');
    Chart.defaults.plugins.tooltip.titleColor = v('--surface');
    Chart.defaults.plugins.tooltip.bodyColor = v('--surface');
    Chart.defaults.plugins.tooltip.padding = 10;
    Chart.defaults.plugins.tooltip.cornerRadius = 8;
    Chart.defaults.plugins.tooltip.boxPadding = 4;
    Chart.defaults.plugins.tooltip.usePointStyle = true;
    Chart.defaults.maintainAspectRatio = false;
    Chart.defaults.animation.duration = 350;
  }

  function make(id, config) {
    const el = document.getElementById(id);
    if (!el || !window.Chart) { if (el) el.parentElement.innerHTML = '<p class="note">Biblioteca de gráficos indisponível (sem ligação à internet?). Os dados estão disponíveis nas tabelas.</p>'; return null; }
    if (reg[id]) reg[id].destroy();
    reg[id] = new Chart(el.getContext('2d'), config);
    return reg[id];
  }

  const grid = () => ({ color: v('--border'), drawTicks: false });
  const axisY = (fmt, extra) => Object.assign({ beginAtZero: true, grid: grid(), border: { display: false }, ticks: { padding: 6, callback: fmt } }, extra || {});
  const axisX = (extra) => Object.assign({ grid: { display: false }, border: { color: v('--border') }, ticks: { padding: 4 } }, extra || {});
  const bar = (label, data, color, extra) => Object.assign({ label, data, backgroundColor: color, borderRadius: 4, borderSkipped: 'start', maxBarThickness: 34, categoryPercentage: 0.72, barPercentage: 0.9, borderColor: v('--surface'), borderWidth: 0 }, extra || {});

  /* Barras agrupadas Planeado vs Realizado. */
  function planReal(id, labels, plan, real, fmt, opts) {
    opts = opts || {};
    return make(id, {
      type: 'bar',
      data: { labels, datasets: [bar('Planeado', plan, v('--plan')), bar('Realizado', real, v('--real'))] },
      options: {
        indexAxis: opts.horizontal ? 'y' : 'x',
        interaction: { mode: 'index', intersect: false },
        scales: opts.horizontal ? { x: axisY(fmt), y: axisX() } : { x: axisX(), y: axisY(fmt) },
        plugins: {
          tooltip: {
            callbacks: {
              label: (c) => ' ' + c.dataset.label + ': ' + fmt(c.raw),
              afterBody: (items) => {
                const p = plan[items[0].dataIndex], r = real[items[0].dataIndex];
                const d = TV.engine.devPct(r, p);
                return opts.afterBody ? opts.afterBody(items[0].dataIndex) : ['Desvio: ' + TV.ui.fmt.signedPct(d)];
              }
            }
          }
        },
        onClick: opts.onClick
      }
    });
  }

  /* Barras de desvio % (cor de estado conforme direção do indicador). */
  function deviation(id, labels, values, opts) {
    opts = opts || {};
    const tol = TV.config.tolerance;
    const col = values.map((x) => {
      const st = TV.engine.status(x, opts.dir || 'higher');
      return st === 'pos' ? v('--good') : st === 'neg' ? v('--bad') : st === 'warn' ? v('--warn') : v('--plan');
    });
    return make(id, {
      type: 'bar',
      data: { labels, datasets: [bar(opts.label || 'Desvio %', values, col, { borderSkipped: false, maxBarThickness: 26 })] },
      options: {
        indexAxis: 'y',
        scales: {
          x: axisY((x) => x + '%', { beginAtZero: true, grid: { color: (c) => (c.tick.value === 0 ? v('--text-3') : v('--border')) } }),
          y: axisX({ grid: { display: false } })
        },
        plugins: { tooltip: { callbacks: { label: (c) => ' ' + (opts.label || 'Desvio') + ': ' + TV.ui.fmt.signedPct(c.raw) + '  (tolerância ±' + tol + '%)', afterLabel: opts.afterLabel ? (c) => opts.afterLabel(c.dataIndex) : undefined } } }
      }
    });
  }

  /* Barras empilhadas de efeitos (volume vs audiência) — eixo único em GRPs. */
  function effects(id, labels, vol, aud) {
    return make(id, {
      type: 'bar',
      data: {
        labels, datasets: [
          bar('Efeito volume (spots)', vol, v('--fx-volume'), { borderSkipped: false, stack: 's', borderWidth: 1 }),
          bar('Efeito audiência (rating)', aud, v('--fx-audience'), { borderSkipped: false, stack: 's', borderWidth: 1 })
        ]
      },
      options: {
        interaction: { mode: 'index', intersect: false },
        scales: { x: axisX({ stacked: true }), y: axisY((x) => TV.ui.fmt.n(x, 0), { stacked: true, beginAtZero: true, grid: { color: (c) => (c.tick.value === 0 ? v('--text-3') : v('--border')) } }) },
        plugins: {
          tooltip: {
            callbacks: {
              label: (c) => ' ' + c.dataset.label + ': ' + TV.ui.fmt.signed(c.raw, 1) + ' GRPs',
              footer: (items) => 'Desvio total: ' + TV.ui.fmt.signed(vol[items[0].dataIndex] + aud[items[0].dataIndex], 1) + ' GRPs'
            }
          }
        }
      }
    });
  }

  /* Linhas Planeado vs Realizado (evolução). */
  function lines(id, labels, plan, real, fmt, opts) {
    opts = opts || {};
    const ds = (label, data, color, dash) => ({ label, data, borderColor: color, backgroundColor: color, borderWidth: 2, pointRadius: labels.length > 20 ? 0 : 3, pointHoverRadius: 5, tension: 0.25, borderDash: dash || [], spanGaps: true, fill: false });
    return make(id, {
      type: 'line',
      data: { labels, datasets: [ds('Planeado', plan, v('--plan'), [5, 4]), ds('Realizado', real, v('--real'))] },
      options: {
        interaction: { mode: 'index', intersect: false },
        scales: { x: axisX({ ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 14 } }), y: axisY(fmt) },
        plugins: {
          tooltip: {
            callbacks: {
              label: (c) => ' ' + c.dataset.label + ': ' + fmt(c.raw),
              footer: (items) => { const i = items[0].dataIndex; return 'Diferença: ' + TV.ui.fmt.signed(real[i] - plan[i], opts.dec || 0, opts.unit || '') + '  (' + TV.ui.fmt.signedPct(TV.engine.devPct(real[i], plan[i])) + ')'; }
            }
          }
        }
      }
    });
  }

  /* Waterfall: Plano → contributos → Realizado. */
  function waterfall(id, steps, startLabel, endLabel, fmt) {
    // Eixo começa perto do menor valor acumulado → os contributos ficam legíveis.
    const cum = [steps.start];
    steps.items.forEach((s) => cum.push(cum[cum.length - 1] + s.delta));
    const lo = Math.min(...cum, steps.end), hi = Math.max(...cum, steps.end);
    const span = Math.max(hi - lo, Math.abs(hi) * 0.02, 1);
    const base = Math.max(0, lo - span * 0.6);
    const labels = [startLabel], data = [[base, steps.start]], colors = [v('--plan')], raw = [steps.start];
    let acc = steps.start;
    steps.items.forEach((s) => {
      labels.push(s.label); data.push([acc, acc + s.delta]); raw.push(s.delta);
      colors.push(s.delta >= 0 ? v('--good') : v('--bad')); acc += s.delta;
    });
    labels.push(endLabel); data.push([base, steps.end]); colors.push(v('--real')); raw.push(steps.end);
    return make(id, {
      type: 'bar',
      data: { labels, datasets: [bar('Contributo', data, colors, { borderSkipped: false, maxBarThickness: 46, categoryPercentage: 0.8, barPercentage: 0.95 })] },
      options: {
        scales: {
          x: axisX({ ticks: { maxRotation: 0, autoSkip: false, font: { size: 10.5 } } }),
          y: axisY(fmt, { beginAtZero: false, min: base, max: hi + span * 0.15 })
        },
        plugins: {
          tooltip: {
            callbacks: {
              label: (c) => {
                const i = c.dataIndex;
                if (i === 0 || i === labels.length - 1) return ' ' + labels[i] + ': ' + fmt(raw[i]);
                return ' Contributo: ' + (raw[i] >= 0 ? '+' : '−') + fmt(Math.abs(raw[i])) + '  · acumulado ' + fmt(data[i][1]);
              }
            }
          }
        }
      }
    });
  }

  /* Barras de peso (%) — Plano vs Realizado. */
  function share(id, labels, plan, real) {
    return planReal(id, labels, plan, real, (x) => TV.ui.fmt.n(x, 1) + '%', { afterBody: (i) => ['Diferença: ' + TV.ui.fmt.signed(real[i] - plan[i], 1, ' p.p.')] });
  }

  /* Dispersão eficiência: rating médio (x) vs CPP (y), tamanho = investimento. */
  function scatter(id, points) {
    const maxCost = Math.max(1, ...points.map((p) => p.cost));
    return make(id, {
      type: 'bubble',
      data: {
        datasets: [{
          label: 'Canal × faixa', data: points.map((p) => ({ x: p.x, y: p.y, r: 4 + 14 * Math.sqrt(p.cost / maxCost), meta: p })),
          backgroundColor: points.map((p) => channelColor(p.channel) + 'cc'), borderColor: v('--surface'), borderWidth: 2
        }]
      },
      options: {
        scales: {
          x: axisY((x) => TV.ui.fmt.n(x, 1) + '%', { title: { display: true, text: 'Rating médio realizado (%)' }, beginAtZero: true }),
          y: axisY((x) => TV.ui.fmt.n(x, 0) + ' €', { title: { display: true, text: 'CPP realizado (€)' } })
        },
        plugins: {
          tooltip: {
            callbacks: {
              title: (items) => items[0].raw.meta.channel + ' · ' + items[0].raw.meta.daypart,
              label: (c) => { const m = c.raw.meta; return [' Rating médio: ' + TV.ui.fmt.n(m.x, 2) + '%', ' CPP: ' + TV.ui.fmt.eur(m.y), ' Investimento: ' + TV.ui.fmt.eur(m.cost), ' GRPs: ' + TV.ui.fmt.n(m.grp, 1)]; }
            }
          }
        }
      }
    });
  }

  /* Barras empilhadas por estado de emissão (qualidade). */
  function stacked(id, labels, series, horizontal) {
    return make(id, {
      type: 'bar',
      data: { labels, datasets: series.map((s) => bar(s.label, s.data, s.color, { stack: 'q', borderSkipped: false, borderWidth: 1, maxBarThickness: 28 })) },
      options: {
        indexAxis: horizontal ? 'y' : 'x',
        interaction: { mode: 'index', intersect: false },
        scales: horizontal ? { x: axisY((x) => x, { stacked: true }), y: axisX({ stacked: true }) } : { x: axisX({ stacked: true }), y: axisY((x) => x, { stacked: true }) },
        plugins: { tooltip: { filter: (i) => i.raw > 0 } }
      }
    });
  }

  function resizeAll() { Object.values(reg).forEach((c) => c.resize()); }

  return { theme, make, planReal, deviation, effects, lines, waterfall, share, scatter, stacked, channelColor, resizeAll, reg };
})();

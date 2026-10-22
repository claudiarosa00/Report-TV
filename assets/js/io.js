/* =============================================================================
 * io.js — Importação (CSV / Excel) e exportação (Excel / CSV / modelo)
 * -----------------------------------------------------------------------------
 * Estrutura esperada (cabeçalhos; ordem indiferente, separador CSV ; ou ,):
 *  PLANO       id_linha, data, hora_prevista*, canal, faixa*, duracao_s, custo_eur, rating_<TARGET>...
 *  EMISSOES    id_emissao, id_linha_plano*, data, hora, canal, duracao_s, custo_eur, estado*, rating_<TARGET>...
 *  COBERTURA*  target, fonte (plano|real), reach1_pct, reach3_pct
 *  (* opcional — hora_prevista OU faixa; estado é derivado se ausente)
 * Um único .xlsx com folhas "Plano", "Emissoes" e "Cobertura" também é aceite.
 * ========================================================================== */
window.TV = window.TV || {};

TV.io = (function () {
  const REQ = {
    plan: ['id_linha', 'data', 'canal', 'duracao_s', 'custo_eur'],
    emissions: ['id_emissao', 'data', 'hora', 'canal', 'duracao_s', 'custo_eur'],
    reach: ['target', 'fonte', 'reach1_pct']
  };
  const normKey = (k) => String(k).trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, '_');
  const normTargetKey = (k) => (k.indexOf('rating_') === 0 ? 'rating_' + k.slice(7).toUpperCase() : k);

  function parseCSV(text) {
    text = text.replace(/^﻿/, '');
    const first = text.split(/\r?\n/)[0];
    const sep = (first.match(/;/g) || []).length >= (first.match(/,/g) || []).length ? ';' : ',';
    const rows = []; let row = [], cur = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
      else if (ch === '"') q = true;
      else if (ch === sep) { row.push(cur); cur = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
      else cur += ch;
    }
    if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
    const head = (rows.shift() || []).map((h) => normTargetKey(normKey(h)));
    return rows.filter((r) => r.some((c) => String(c).trim() !== '')).map((r) => { const o = {}; head.forEach((h, i) => { o[h] = r[i]; }); return o; });
  }
  function normalizeRows(rows) {
    return rows.map((r) => { const o = {}; Object.keys(r).forEach((k) => { o[normTargetKey(normKey(k))] = r[k]; }); return o; });
  }
  function detect(rows) {
    const k = rows.length ? Object.keys(rows[0]) : [];
    if (k.includes('reach1_pct')) return 'reach';
    if (k.includes('id_emissao') || (k.includes('hora') && !k.includes('id_linha'))) return 'emissions';
    if (k.includes('id_linha') || k.includes('hora_prevista') || k.includes('faixa')) return 'plan';
    return null;
  }
  const readText = (f) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsText(f, 'utf-8'); });
  const readBuf = (f) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsArrayBuffer(f); });

  /* Lê um conjunto de ficheiros e devolve {plan, emissions, reach, log}. */
  async function importFiles(files) {
    const found = { plan: null, emissions: null, reach: null };
    const log = [];
    for (const f of files) {
      const ext = f.name.split('.').pop().toLowerCase();
      let sheets = [];
      if (ext === 'csv' || ext === 'txt') sheets = [{ name: f.name, rows: parseCSV(await readText(f)) }];
      else if (ext === 'xlsx' || ext === 'xls') {
        if (!window.XLSX) throw new Error('A biblioteca de leitura de Excel (SheetJS) não foi carregada. Use CSV ou verifique a ligação à internet.');
        const wb = XLSX.read(await readBuf(f), { type: 'array', cellDates: false });
        sheets = wb.SheetNames.map((n) => ({ name: f.name + ' › ' + n, rows: normalizeRows(XLSX.utils.sheet_to_json(wb.Sheets[n], { defval: '', raw: true })) }));
      } else { log.push('Ignorado (formato não suportado): ' + f.name); continue; }
      sheets.forEach((s) => {
        const type = detect(s.rows);
        if (!type) { if (s.rows.length && !/instru/i.test(s.name)) log.push('Não reconhecido: ' + s.name); return; }
        const miss = REQ[type].filter((c) => !Object.keys(s.rows[0]).includes(c));
        if (miss.length) throw new Error(s.name + ': faltam colunas obrigatórias → ' + miss.join(', '));
        found[type] = (found[type] || []).concat(s.rows);
        log.push(s.name + ' → ' + { plan: 'Plano de media', emissions: 'Registo de emissões', reach: 'Cobertura' }[type] + ' (' + s.rows.length + ' linhas)');
      });
    }
    if (!found.plan || !found.emissions) throw new Error('São necessários pelo menos o Plano de media e o Registo de emissões.\n' + log.join('\n'));
    if (!Object.keys(found.plan[0]).some((k) => k.indexOf('rating_') === 0)) throw new Error('O plano não tem colunas de audiência (rating_<TARGET>).');
    return { plan: found.plan, emissions: found.emissions, reach: found.reach || [], log };
  }

  /* Exporta dados brutos + tabelas de análise visíveis num .xlsx (ou CSV). */
  function exportWorkbook(raw, tables, name) {
    const sheetsData = [
      { name: 'Plano', rows: raw.plan },
      { name: 'Emissoes', rows: raw.emissions },
      { name: 'Cobertura', rows: raw.reach }
    ];
    if (!window.XLSX) {
      TV.ui.download((name || 'relatorio') + '_emissoes.csv', TV.ui.toCSV(Object.keys(raw.emissions[0] || {}).map((k) => ({ key: k, label: k })), raw.emissions));
      TV.ui.toast('Excel indisponível offline — exportado CSV do registo de emissões.');
      return;
    }
    const wb = XLSX.utils.book_new();
    (tables || []).forEach((t) => {
      const aoa = [t.columns.map((c) => c.csv || c.label)].concat(t.rows.map((r) => t.columns.map((c) => { const v = c.raw ? c.raw(r) : r[c.key]; return v === null || v === undefined || (typeof v === 'number' && !isFinite(v)) ? '' : (typeof v === 'number' ? Math.round(v * 10000) / 10000 : v); })));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), String(t.title).replace(/[\\/?*[\]:]/g, '').slice(0, 31));
    });
    sheetsData.forEach((s) => XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(s.rows), s.name));
    XLSX.writeFile(wb, (name || 'relatorio') + '.xlsx');
  }

  /* Modelo de importação = dados atuais no formato esperado + instruções. */
  function exportTemplate(raw) {
    if (!window.XLSX) {
      TV.ui.download('modelo_plano.csv', TV.ui.toCSV(Object.keys(raw.plan[0]).map((k) => ({ key: k, label: k })), raw.plan));
      TV.ui.download('modelo_emissoes.csv', TV.ui.toCSV(Object.keys(raw.emissions[0]).map((k) => ({ key: k, label: k })), raw.emissions));
      return;
    }
    const wb = XLSX.utils.book_new();
    const instr = [
      ['Modelo de importação — Pós-avaliação TV'],
      [''],
      ['Folha', 'Coluna', 'Obrigatória', 'Descrição'],
      ['Plano', 'id_linha', 'Sim', 'Identificador único da linha de plano (1 linha = 1 spot planeado)'],
      ['Plano', 'data', 'Sim', 'Data do dia TV (AAAA-MM-DD ou DD/MM/AAAA)'],
      ['Plano', 'hora_prevista', 'Não*', 'Hora prevista (HH:MM). *Se ausente, usar a coluna faixa'],
      ['Plano', 'faixa', 'Não*', 'Faixa horária comprada (ex.: 20h00–23h00)'],
      ['Plano', 'canal', 'Sim', 'Canal (ex.: RTP1, SIC, TVI, CMTV)'],
      ['Plano', 'duracao_s', 'Sim', 'Secundagem em segundos'],
      ['Plano', 'custo_eur', 'Sim', 'Custo líquido planeado do spot (€)'],
      ['Plano / Emissoes', 'rating_<TARGET>', 'Sim (≥1)', 'Rating % do spot por target (ex.: rating_M2554). Targets novos são criados automaticamente'],
      ['Emissoes', 'id_emissao', 'Sim', 'Identificador da emissão'],
      ['Emissoes', 'id_linha_plano', 'Não', 'Ligação à linha de plano. Vazio = spot adicional/compensação'],
      ['Emissoes', 'data / hora', 'Sim', 'Data do dia TV e hora real de emissão (HH:MM[:SS]). Após 00h00 mantém-se a data do dia TV'],
      ['Emissoes', 'custo_eur', 'Sim', 'Custo faturado (0 para compensações)'],
      ['Emissoes', 'estado', 'Não', 'emitido | fora_faixa | substituicao | desvio_secundagem | adicional | compensacao. Se vazio é derivado comparando com o plano'],
      ['Cobertura', 'target, fonte, reach1_pct, reach3_pct', 'Não', 'Cobertura deduplicada (software de audiências). fonte = plano ou real'],
      [''],
      ['Spots planeados sem emissão associada são classificados como "não emitidos".']
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(instr), 'Instrucoes');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(raw.plan), 'Plano');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(raw.emissions), 'Emissoes');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(raw.reach.length ? raw.reach : [{ target: '', fonte: '', reach1_pct: '', reach3_pct: '' }]), 'Cobertura');
    XLSX.writeFile(wb, 'modelo_importacao_tv.xlsx');
  }

  return { parseCSV, importFiles, exportWorkbook, exportTemplate };
})();

/* =============================================================================
 * config.js — Configuração da campanha e das regras de negócio
 * -----------------------------------------------------------------------------
 * Tudo o que é "estrutura de compra" vive aqui: canais, faixas horárias,
 * secundagens, targets, índices de normalização e tolerâncias.
 * Para ligar a dados reais, ajuste estes valores (ou importe ficheiros na
 * secção "Dados & Metodologia" do dashboard).
 * ========================================================================== */
window.TV = window.TV || {};

TV.config = {
  /* Canais considerados (ordem fixa = ordem das cores categóricas). */
  channels: ['RTP1', 'SIC', 'TVI', 'CMTV', 'SIC Notícias', 'CNN Portugal'],

  /* Faixas horárias de compra: horas de início + hora de fim da última faixa.
   * Horas depois da meia-noite pertencem ao "dia TV" anterior (ex.: 01:30 = 25:30).
   * Emissões fora destes limites são classificadas como "Fora de grelha". */
  daypartStarts: ['07:00', '10:00', '13:00', '18:00', '20:00', '23:00'],
  daypartEnd: '02:00',
  primeTime: '20:00', // faixa que começa a esta hora é tratada como prime time

  /* Secundagens (formatos) analisadas. */
  durations: [10, 15, 20, 30, 45, 60],

  /* Regra de normalização explícita para GRPs equivalentes a 30":
   * GRP eq.30" = GRP × índice da secundagem (índice de preço da tabela comercial,
   * 30" = 1,00). Altere aqui se a tabela do operador for diferente. */
  durationIndex: { 10: 0.55, 15: 0.70, 20: 0.80, 30: 1.00, 45: 1.45, 60: 1.85 },

  /* Targets de audiência. universe = população do target (indivíduos),
   * usada para converter rating em contactos (CPM). */
  targets: [
    { code: 'M2554', label: 'Mulheres 25-54', universe: 2210000 },
    { code: 'A2554', label: 'Adultos 25-54', universe: 4250000 },
    { code: 'IND4', label: 'Indivíduos 4+', universe: 9850000 },
    { code: 'ABC1534', label: 'ABC 15-34', universe: 1050000 }
  ],
  buyTarget: 'M2554', // target de compra → TRPs

  /* Tolerância (±%) para considerar um desvio "dentro do aceitável". */
  tolerance: 5,

  weekdays: ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo'],
  weekdaysShort: ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'],

  /* Estados de emissão. valid = emissão contratualmente válida. */
  statuses: {
    emitido: { label: 'Emitido conforme', valid: true },
    compensacao: { label: 'Compensação de audiência', valid: true },
    adicional: { label: 'Spot adicional (acordado)', valid: true },
    fora_faixa: { label: 'Fora da faixa comprada', valid: false },
    substituicao: { label: 'Substituição de canal', valid: false },
    desvio_secundagem: { label: 'Desvio de secundagem', valid: false },
    nao_emitido: { label: 'Não emitido', valid: false }
  }
};

/* Constrói a lista de faixas a partir das horas configuradas. */
TV.config.buildDayparts = function () {
  const toMin = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + (m || 0); };
  const starts = this.daypartStarts.map(toMin).sort((a, b) => a - b);
  let end = toMin(this.daypartEnd);
  if (end <= starts[starts.length - 1]) end += 1440;
  const lbl = (m) => { const h = Math.floor(m / 60) % 24; const mm = m % 60; return String(h).padStart(2, '0') + 'h' + String(mm).padStart(2, '0'); };
  const prime = toMin(this.primeTime);
  this.dayparts = starts.map((s, i) => {
    const e = i < starts.length - 1 ? starts[i + 1] : end;
    return { code: lbl(s) + '–' + lbl(e), label: lbl(s) + '–' + lbl(e), start: s, end: e, prime: s === prime };
  });
  this.outOfGrid = 'Fora de grelha';
  return this.dayparts;
};
TV.config.buildDayparts();

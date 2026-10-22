# Report-TV — Pós-avaliação de campanhas de televisão

Protótipo funcional de um dashboard de BI para comparar o **Plano de Media** com a **Pós-Avaliação** (emissões e audiências reais) de uma campanha de TV comprada por faixa horária no mercado português.

## Como abrir
Abra `index.html` num browser moderno. Não precisa de servidor nem de instalação.
É necessária ligação à internet para carregar as bibliotecas por CDN:

| Dependência | Uso | Origem |
|---|---|---|
| Chart.js 4.4.1 | Gráficos | cdnjs.cloudflare.com |
| SheetJS (xlsx) 0.18.5 | Importar Excel / exportar dados técnicos | cdnjs.cloudflare.com |
| ExcelJS 4.4.0 + JSZip 3.10.1 | Relatório Excel do cliente (formatação + gráficos nativos) | cdnjs.cloudflare.com |
| Inter | Tipografia (opcional) | Google Fonts |

Sem ligação à internet, as tabelas, os KPIs e a importação CSV continuam a funcionar.

## Vistas
- **Cliente** (predefinida): um resumo com o veredicto e 6 indicadores; **Por canal**, **Por faixa horária**, **Por secundagem** e **Por semana**, sempre planeado vs real, com um seletor GRPs / Spots / Investimento / CPP; e as conclusões. É também o que sai na impressão/PDF.
- **Análise técnica**: junta as análises aprofundadas (decomposição de desvios, matrizes, eficiência, qualidade de entrega, waterfall, oportunidades, importação e metodologia).

## Relatório Excel (botão **Excel**)
Gera um `.xlsx` para o cliente, com os filtros ativos:
- **Resumo**: veredicto, indicadores planeado vs real com avaliação colorida, cumprimento do plano, destaques e gráficos de GRPs por canal e por semana.
- **Por canal / Por faixa horária / Por secundagem / Por semana**: leitura automática, um quadro com spots, GRPs, investimento, CPP e peso (desvios, totais e CPP calculados por fórmula) e 4 gráficos nativos do Excel, editáveis e ligados às células.
- **Conclusões** (conclusões, recomendações e comentários do analista), **Registo de emissões** (com filtros) e **Metodologia**.

Em *Dados e metodologia* continua disponível a exportação técnica (todas as tabelas + dados brutos).

## Estrutura
```
index.html              layout e secções
assets/css/styles.css   tokens de design (tema claro/escuro), componentes, impressão
assets/js/config.js     canais, faixas horárias, secundagens, targets, índices, tolerância
assets/js/demo-data.js  gerador determinístico de dados FICTÍCIOS de demonstração
assets/js/engine.js     normalização dos dados, filtros, agregações e regras de cálculo
assets/js/ui.js         formatação pt-PT, tabelas ordenáveis/CSV, heatmaps, multi-select, tooltips
assets/js/charts.js     gráficos (Chart.js) ligados aos tokens de cor
assets/js/insights.js   conclusões, respostas-chave e recomendações automáticas
assets/js/io.js         importação CSV/Excel e exportação técnica/modelo
assets/js/excel-report.js relatório Excel do cliente (ExcelJS + gráficos nativos via JSZip)
assets/js/app.js        estado, filtros e renderização das secções
```

## Dados reais
Em **Dados e metodologia → Modelo de importação** descarrega-se um `.xlsx` com o formato esperado (folhas `Plano`, `Emissoes`, `Cobertura` e instruções). Também são aceites ficheiros CSV separados por `;` ou `,`.

- **Plano**: `id_linha, data, hora_prevista | faixa, canal, duracao_s, custo_eur, rating_<TARGET>…`
- **Emissoes**: `id_emissao, id_linha_plano, data, hora, canal, duracao_s, custo_eur, estado, rating_<TARGET>…`
- **Cobertura** (opcional): `target, fonte (plano|real), reach1_pct, reach3_pct`

Se o estado de uma emissão não vier no ficheiro, é derivado da comparação com a linha do plano (fora de faixa, substituição, desvio de secundagem, adicional ou compensação). As linhas do plano sem emissão são classificadas como não emitidas.

## Regras de cálculo
- GRPs = Σ ratings no target selecionado; TRPs = Σ ratings no target de compra
- CPP = investimento ÷ GRPs; CPM = investimento ÷ (contactos ÷ 1000)
- Desvio = realizado − planeado; Desvio % = (R − P) ÷ P × 100 (n.d. quando P = 0)
- GRP eq. 30" = GRP × índice da secundagem (definido em `config.js`)
- A cobertura e a frequência vêm só de dados deduplicados e nunca são somadas por canal ou faixa. Com filtros, aparecem como indisponíveis.

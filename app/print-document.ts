export type PrintPageMeasurement = { page: number; empty: boolean; overflow: boolean; chartsReady: boolean };

export function collectPrintIssues(pages: PrintPageMeasurement[]): string[] {
  if (!pages.length) return ['印刷対象がありません'];
  return pages.flatMap((page, index) => [
    ...(page.page !== index + 1 ? [`${index + 1}ページ目：ページ番号が不連続`] : []),
    ...(page.empty ? [`${page.page}ページ：内容がありません`] : []),
    ...(page.overflow ? [`${page.page}ページ：用紙内に収まっていません`] : []),
    ...(!page.chartsReady ? [`${page.page}ページ：チャートの描画が未完了`] : []),
  ]);
}

// A4 297×210 mm, 7 mm margins => 283×196 mm. Reserve 1 mm for rounding.
// Fixed page dimensions and footer reserve apply in preview and native print.
export const PRINT_DOCUMENT_CSS = `
@page { size:A4 landscape; margin:7mm; }
@page batter-profile { size:A4 landscape; margin:7mm; }
html { margin:0!important; padding:0!important; width:283mm!important; background:white!important; }
body.print-document { margin:0!important; padding:0!important; width:283mm!important; min-height:0!important; background:white!important; color:#172327; }
body.print-document * { visibility:visible!important; animation:none!important; transition:none!important; }
.print-document-page { box-sizing:border-box; position:relative; display:block; width:283mm; height:195mm; margin:0; padding:0; break-inside:avoid-page; break-after:page; page-break-after:always; page:auto; }
.print-document-page:last-child { break-after:auto; page-break-after:auto; }
.print-document-content { box-sizing:border-box; width:283mm; height:189mm; overflow:visible; display:flow-root; }
.print-document-footer { position:absolute; bottom:0; left:0; right:0; display:flex; align-items:center; justify-content:space-between; gap:4mm; height:5mm; margin:0; padding:0; border-top:.3mm solid #b7c4c5; font-size:7pt; line-height:1.2; color:#45585a; }
.print-document-footer span:first-child { min-width:0; overflow-wrap:anywhere; }
.print-document-footer span:last-child { flex:none; }
body.print-document :is(.count-print-sheet,.count-single-print-content,.scouting-print-sheet,.batter-profile-print-page) { page:auto!important; break-before:auto!important; break-after:auto!important; page-break-before:auto!important; page-break-after:auto!important; }
body.print-document .scouting-print-root { position:static!important; }
body.print-document .count-print-heading strong { overflow-wrap:anywhere; }
body.print-document .count-print-heading > div { max-width:72mm; }
body.print-document .count-print-heading dl { gap:1mm 3mm; }
body.print-document .count-matrix :is(th,td) { padding:.65mm .6mm; }
body.print-document .count-print-key { justify-content:flex-start; flex-wrap:wrap; }
body.print-document .count-low-sample { font-size:7pt; font-weight:normal; white-space:normal; }
body.print-document .count-low-sample small { display:block; font-size:7pt; }
body.print-document .count-matrix td.low-sample { background-image:repeating-linear-gradient(135deg,transparent,transparent 4px,#5552 4px,#5552 5px); }
body.print-document .spray-print-sheet { display:block!important; width:100%; }
body.print-document .spray-print-heading { display:flex; align-items:flex-start; justify-content:space-between; gap:8mm; border-bottom:.4mm solid #426d75; padding-bottom:3mm; }
body.print-document .spray-print-heading h1 { font-size:18pt; margin:0 0 2mm; }
body.print-document .spray-print-heading p { font-size:10pt; line-height:1.5; margin:0; }
body.print-document .spray-print-sheet .spray-chart { padding:0; min-height:0; }
body.print-document .spray-print-sheet svg { display:block; width:100%; height:130mm; }
body.print-document .spray-print-sheet .legend { display:flex; justify-content:center; gap:6mm; font-size:10pt; }
body.print-document .spray-print-sheet .chart-note, body.print-document .spray-print-note { font-size:9pt; line-height:1.5; margin:2mm 0; }
/* Use the same legible report styles for the preview and native print. */
body.print-document :is(.side-report-root,.approach-card-root) { font-variant-numeric:tabular-nums; }
body.print-document :is(.side-report-root,.approach-card-root) .scouting-print-heading > div span { font-size:8pt; letter-spacing:normal; }
body.print-document :is(.side-report-root,.approach-card-root) .scouting-print-heading > div b { font-size:9pt; }
body.print-document :is(.side-report-root,.approach-card-root) .scouting-print-heading dl div { font-size:8pt; line-height:1.35; }
body.print-document :is(.side-report-root,.approach-card-root) .scouting-print-heading dl { max-width:200mm; }
body.print-document :is(.side-report-root,.approach-card-root) .scouting-print-heading dd { overflow-wrap:anywhere; }
body.print-document :is(.side-report-root,.approach-card-root) .rule-summary { margin-top:3mm; padding:2mm; }
body.print-document :is(.side-report-root,.approach-card-root) .rule-summary h3 { font-size:9pt; }
body.print-document :is(.side-report-root,.approach-card-root) .rule-summary :is(li,p) { font-size:8.5pt; line-height:1.4; }
body.print-document :is(.side-report-root,.approach-card-root) .rule-summary > small { font-size:7.5pt; line-height:1.35; }
body.print-document .approach-kpi { padding:2mm; }
body.print-document .approach-kpi > header { min-height:8mm; }
body.print-document .approach-kpi > header span { font-size:8.5pt; line-height:1.3; }
body.print-document .approach-kpi > strong { font-size:18pt; }
body.print-document .approach-kpi > div :is(b,span), body.print-document .approach-kpi > small { font-size:7.5pt; line-height:1.4; }
body.print-document .approach-kpi .sample-flag { font-size:7pt!important; }
body.print-document .approach-main-grid { grid-template-columns:minmax(0,1.35fr) minmax(0,1fr); gap:3mm; margin-top:3mm; }
body.print-document :is(.approach-table-card,.approach-heatmap) h3 { font-size:9pt; }
body.print-document :is(.approach-table-card,.approach-heatmap) header { flex-wrap:wrap; }
body.print-document :is(.approach-table-card,.approach-heatmap) header span { font-size:7pt; }
body.print-document .approach-table { table-layout:fixed; font-size:8pt; }
body.print-document .approach-table :is(th,td) { padding:1.6mm .65mm; white-space:normal; overflow-wrap:anywhere; line-height:1.35; }
body.print-document .approach-table th:first-child { width:22mm; }
body.print-document .approach-table td small { font-size:7pt; }
body.print-document .approach-heat-grid strong { font-size:8pt; }
body.print-document .approach-heat-grid small { font-size:7pt; }
body.print-document .approach-heatmap footer { flex-wrap:wrap; justify-content:center; font-size:7pt; }
@media screen { .print-document-page + .print-document-page { margin-top:16px; } }
`;

/** Pitching reports use the full portrait height; batter reports retain their layout. */
export function getPrintLayout(kind: string) {
  if (kind !== 'count' && kind !== 'side') return { label: '横', width: 283, height: 195, css: PRINT_DOCUMENT_CSS };
  return { label: '縦', width: 196, height: 282, css: PRINT_DOCUMENT_CSS + `
@page { size:A4 portrait; margin:7mm; }
html, body.print-document { width:196mm!important; }
.print-document-page { width:196mm; height:282mm; }
.print-document-content { width:196mm; height:276mm; }
body.print-document :is(.count-print-heading,.scouting-print-heading) { flex-direction:column; gap:3mm; }
body.print-document :is(.count-print-heading,.scouting-print-heading) > div { min-width:0; max-width:100%; }
body.print-document :is(.count-print-heading,.scouting-print-heading) dl { width:100%; max-width:100%; justify-content:flex-start; gap:1.5mm 4mm; }
body.print-document :is(.count-print-heading,.scouting-print-heading) dd { overflow-wrap:anywhere; }
body.print-document .count-matrix :is(th,td) { padding:1.4mm .5mm; overflow-wrap:anywhere; white-space:normal; }
body.print-document .count-matrix td strong { display:block; font-size:10pt; }
body.print-document .count-matrix td em { display:block; margin:.7mm 0 0; font-size:7pt; }
body.print-document .count-matrix td small { margin-top:.7mm; font-size:7pt; }
body.print-document .side-scout-grid { grid-template-columns:minmax(0,1fr); gap:4mm; }
body.print-document .side-scout-card > header { padding:2mm; }
body.print-document .side-scout-card > header span { font-size:12pt; }
body.print-document .side-scout-card > header :is(strong,small) { font-size:8pt; }
body.print-document .side-kpi-grid > div { padding:2mm; }
body.print-document .side-kpi-grid span { font-size:9pt; }
body.print-document .side-kpi-grid strong { font-size:15pt; }
body.print-document .side-kpi-grid small { font-size:8pt; }
body.print-document .side-kpi-grid .sample-flag { font-size:7pt!important; }
body.print-document .side-card-body { grid-template-columns:minmax(0,1fr) 43mm; }
body.print-document .side-pitch-table { table-layout:fixed; font-size:8pt; }
body.print-document .side-pitch-table :is(th,td) { padding:1.2mm .6mm; white-space:normal; overflow-wrap:anywhere; line-height:1.3; }
body.print-document .side-pitch-table th:first-child { width:20mm; }
body.print-document .side-pitch-table th:last-child { width:26mm; }
body.print-document .side-pitch-table tbody th small { font-size:7pt; }
body.print-document .side-location h3 { font-size:8pt; }
body.print-document .side-location .catcher-view-axis.compact { grid-template-columns:1fr 1fr; font-size:7pt; line-height:1.35; }
body.print-document .side-location .catcher-view-axis.compact strong { grid-column:1/-1; grid-row:1; text-align:center; font-size:7pt; }
` };
}

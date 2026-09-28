"use client";

// <stdin>
import { useId, useMemo, useState } from "react";

// lib/catcher-view.ts
function catcherGridIndex(sourceIndex, columns) {
  return Math.floor(sourceIndex / columns) * columns + columns - 1 - sourceIndex % columns;
}

// lib/chart-geometry.ts
function sprayPoint(direction, distance, homeX, homeY, scale) {
  const radians = direction * Math.PI / 180;
  return { x: homeX + Math.sin(radians) * distance * scale, y: homeY - Math.cos(radians) * distance * scale };
}
function fieldSector(homeX, homeY, radius) {
  const left = sprayPoint(-45, radius, homeX, homeY, 1), right = sprayPoint(45, radius, homeX, homeY, 1);
  return `M${homeX} ${homeY} L${left.x} ${left.y} A${radius} ${radius} 0 0 1 ${right.x} ${right.y} Z`;
}

// lib/batter-side-report.ts
var BATTER_FAMILIES = ["\u30B9\u30C8\u30EC\u30FC\u30C8\u7CFB", "\u66F2\u304C\u308B\u7CFB", "\u843D\u3061\u308B\u7CFB"];
function batterFamily(type) {
  if (["\u30B9\u30C8\u30EC\u30FC\u30C8", "\u30AB\u30C3\u30C8\u30DC\u30FC\u30EB", "\u30B7\u30F3\u30AB\u30FC", "\u30C4\u30FC\u30B7\u30FC\u30E0"].includes(type)) return BATTER_FAMILIES[0];
  if (["\u30B9\u30E9\u30A4\u30C0\u30FC", "\u30AB\u30FC\u30D6", "\u30CA\u30C3\u30AF\u30EB", "\u7279\u6B8A\u7403"].includes(type)) return BATTER_FAMILIES[1];
  if (["\u30D5\u30A9\u30FC\u30AF", "\u30B9\u30D7\u30EA\u30C3\u30C8", "\u30C1\u30A7\u30F3\u30B8\u30A2\u30C3\u30D7"].includes(type)) return BATTER_FAMILIES[2];
  return "\u305D\u306E\u4ED6";
}
var isReportHit = (p) => ["\u5358\u6253", "\u4E8C\u5841\u6253", "\u4E09\u5841\u6253", "\u672C\u5841\u6253"].includes(p.playResult);
var isReportAtBat = (p) => {
  if (["\u72A0\u6253", "\u72A0\u98DB", "\u72A0\u6253\u30FB\u72A0\u98DB", "Sacrifice"].includes(p.playResult)) return false;
  return p.result === "\u30A4\u30F3\u30D7\u30EC\u30FC" || p.korbb === "Strikeout" || p.strikes === 2 && ["\u7A7A\u632F\u308A", "\u898B\u9003\u3057\u30B9\u30C8\u30E9\u30A4\u30AF"].includes(p.result);
};
function reportAverage(rows) {
  const ab = rows.filter(isReportAtBat);
  const hits = ab.filter(isReportHit).length;
  return `${ab.length ? (hits / ab.length).toFixed(3).replace(/^0/, "") : "\u2014"}\uFF08${ab.length}\u2013${hits}\uFF09`;
}
var reportContact = (p) => p.result === "\u30A4\u30F3\u30D7\u30EC\u30FC";
function reportZone(p) {
  if (!Number.isFinite(p.plateX) || !Number.isFinite(p.plateZ)) return null;
  const col = p.plateX < -0.254 ? 0 : p.plateX > 0.254 ? 4 : Math.min(3, 1 + Math.floor((p.plateX + 0.254) / (0.508 / 3)));
  const row = p.plateZ > 1.05 ? 0 : p.plateZ < 0.45 ? 4 : Math.min(3, 1 + Math.floor((1.05 - p.plateZ) / 0.2));
  return row * 5 + col;
}
var reportStrikeout = (p) => p.korbb === "Strikeout" || p.strikes === 2 && ["\u7A7A\u632F\u308A", "\u898B\u9003\u3057\u30B9\u30C8\u30E9\u30A4\u30AF"].includes(p.result);
var reportRate = (value) => value === null ? "\u2014" : value.toFixed(3).replace(/^0/, "");
function reportStats(rows) {
  const ab = rows.filter(isReportAtBat);
  const hits = ab.filter(isReportHit).length;
  const totalBases = ab.reduce((n, p) => n + ({ \u5358\u6253: 1, \u4E8C\u5841\u6253: 2, \u4E09\u5841\u6253: 3, \u672C\u5841\u6253: 4 }[p.playResult] ?? 0), 0);
  const walks = rows.filter((p) => ["Walk", "Waik"].includes(p.korbb) || p.balls === 3 && p.result === "\u30DC\u30FC\u30EB").length;
  const hbp = rows.filter((p) => p.result === "\u6B7B\u7403").length;
  const sf = rows.filter((p) => p.playResult === "\u72A0\u98DB").length;
  const ambiguousSacrifice = rows.some((p) => ["\u72A0\u6253\u30FB\u72A0\u98DB", "Sacrifice"].includes(p.playResult));
  const denominator = ab.length + walks + hbp + sf;
  return {
    ab: ab.length,
    hits,
    hr: ab.filter((p) => p.playResult === "\u672C\u5841\u6253").length,
    k: rows.filter(reportStrikeout).length,
    avg: ab.length ? hits / ab.length : null,
    slg: ab.length ? totalBases / ab.length : null,
    obp: denominator && !ambiguousSacrifice ? (hits + walks + hbp) / denominator : null,
    ambiguousSacrifice,
    // RunsScored is not RBI. Only use an explicitly recorded RBI field.
    rbi: rows.length && rows.every((p) => Number.isFinite(p.rbi)) ? rows.reduce((n, p) => n + p.rbi, 0) : null
  };
}
function reportNineZone(p) {
  const zone = reportZone(p);
  if (zone === null) return null;
  return (Math.max(1, Math.min(3, Math.floor(zone / 5))) - 1) * 3 + Math.max(1, Math.min(3, zone % 5)) - 1;
}
function reportRisp(rows) {
  return rows.filter((p) => /^[0-7]$/.test(String(p.runnerStateCode)) && (Number(p.runnerStateCode) & 6) !== 0);
}

// app/print-document.ts
function collectPrintIssues(pages) {
  if (!pages.length) return ["\u5370\u5237\u5BFE\u8C61\u304C\u3042\u308A\u307E\u305B\u3093"];
  return pages.flatMap((page, index) => [
    ...page.page !== index + 1 ? [`${index + 1}\u30DA\u30FC\u30B8\u76EE\uFF1A\u30DA\u30FC\u30B8\u756A\u53F7\u304C\u4E0D\u9023\u7D9A`] : [],
    ...page.empty ? [`${page.page}\u30DA\u30FC\u30B8\uFF1A\u5185\u5BB9\u304C\u3042\u308A\u307E\u305B\u3093`] : [],
    ...page.overflow ? [`${page.page}\u30DA\u30FC\u30B8\uFF1A\u7528\u7D19\u5185\u306B\u53CE\u307E\u3063\u3066\u3044\u307E\u305B\u3093`] : [],
    ...!page.chartsReady ? [`${page.page}\u30DA\u30FC\u30B8\uFF1A\u30C1\u30E3\u30FC\u30C8\u306E\u63CF\u753B\u304C\u672A\u5B8C\u4E86`] : []
  ]);
}
var PRINT_DOCUMENT_CSS = `
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
@media screen { .print-document-page + .print-document-page { margin-top:16px; } }
`;
function getPrintLayout(kind) {
  if (kind !== "count" && kind !== "side") return { label: "\u6A2A", width: 283, height: 195, css: PRINT_DOCUMENT_CSS };
  return { label: "\u7E26", width: 196, height: 282, css: PRINT_DOCUMENT_CSS + `
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
body.print-document .side-pitch-table { font-size:7pt; }
body.print-document .side-pitch-table :is(th,td) { padding:1.2mm .7mm; }
` };
}

// lib/readiness.ts
function waitForReady(work, signal, timeoutMs = 15e3) {
  return new Promise((resolve, reject) => {
    const stop = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
    };
    const abort = () => {
      stop();
      reject(new Error("\u6E96\u5099\u3092\u4E2D\u6B62\u3057\u307E\u3057\u305F\u3002"));
    };
    const timer = setTimeout(() => {
      stop();
      reject(new Error("\u8CC7\u6599\u306E\u8AAD\u307F\u8FBC\u307F\u306B\u6642\u9593\u304C\u304B\u304B\u3063\u3066\u3044\u307E\u3059\u3002\u623B\u3063\u3066\u3082\u3046\u4E00\u5EA6\u304A\u8A66\u3057\u304F\u3060\u3055\u3044\u3002"));
    }, timeoutMs);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) {
      abort();
      return;
    }
    Promise.resolve(work).then((value) => {
      stop();
      resolve(value);
    }, (error) => {
      stop();
      reject(error);
    });
  });
}

// app/print-report.ts
var activePreview = null;
async function printReport(selector, kind, mode = "single") {
  if (activePreview) {
    activePreview.focus();
    return;
  }
  const source = document.querySelector(selector);
  if (!source) return;
  const layout = getPrintLayout(kind);
  const returnFocus = document.activeElement;
  const dialog = document.createElement("dialog");
  dialog.className = "report-preview";
  dialog.setAttribute("aria-label", "\u5370\u5237\u30D7\u30EC\u30D3\u30E5\u30FC");
  dialog.innerHTML = `<div class="report-preview-toolbar"><div><h2>\u5370\u5237\u30D7\u30EC\u30D3\u30E5\u30FC</h2><p class="report-preview-meta">A4${layout.label}\u30FB\u4F59\u767D7mm</p></div><div class="report-preview-actions"><label>\u8868\u793A\u500D\u7387 <select aria-label="\u30D7\u30EC\u30D3\u30E5\u30FC\u8868\u793A\u500D\u7387"><option value="fit">\u753B\u9762\u306B\u5408\u308F\u305B\u308B</option><option value="1">100%</option></select></label><button type="button" data-action="print" disabled>\u5370\u5237\uFF0FPDF\u4FDD\u5B58</button><button type="button" data-action="close">\u623B\u308B</button></div></div><p class="report-preview-status" role="status" aria-live="polite">\u8CC7\u6599\u3068\u30C1\u30E3\u30FC\u30C8\u3092\u6E96\u5099\u3057\u3066\u3044\u307E\u3059\u2026</p><p class="report-preview-settings">\u5370\u5237\u8A2D\u5B9A\uFF1AA4\u30FB${layout.label}\u30FB\u500D\u7387100%\u30FB\u30D8\u30C3\u30C0\u30FC\u3068\u30D5\u30C3\u30BF\u30FC\u3092\u30AA\u30D5\u3002PDF\u4FDD\u5B58\u306F\u5370\u5237\u753B\u9762\u306E\u9001\u4FE1\u5148\u3067\u9078\u3079\u307E\u3059\u3002</p><div class="report-preview-viewport"><div class="report-preview-scaled"><iframe title="\u5370\u5237\u3059\u308B\u8CC7\u6599" sandbox="allow-same-origin allow-modals"></iframe></div></div>`;
  const frame = dialog.querySelector("iframe");
  const printButton = dialog.querySelector('[data-action="print"]');
  const closeButton = dialog.querySelector('[data-action="close"]');
  const status = dialog.querySelector(".report-preview-status");
  const meta = dialog.querySelector(".report-preview-meta");
  const viewport = dialog.querySelector(".report-preview-viewport");
  const scaled = dialog.querySelector(".report-preview-scaled");
  const zoom = dialog.querySelector("select");
  let frameHeight = 0;
  let disposed = false;
  const preparation = new AbortController();
  const resize = () => {
    const width = layout.width * 96 / 25.4;
    const scale = zoom.value === "1" ? 1 : Math.min(1, Math.max(0.1, (viewport.clientWidth - 32) / width), Math.max(0.1, (viewport.clientHeight - 32) / (layout.height * 96 / 25.4)));
    frame.style.width = `${width}px`;
    frame.style.height = `${frameHeight}px`;
    frame.style.transform = `scale(${scale})`;
    scaled.style.width = `${width * scale}px`;
    scaled.style.height = `${frameHeight * scale}px`;
  };
  let observer;
  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    preparation.abort();
    observer?.disconnect();
    window.removeEventListener("resize", resize);
    dialog.remove();
    activePreview = null;
    if (returnFocus?.isConnected) returnFocus.focus();
  };
  dialog.addEventListener("close", cleanup, { once: true });
  closeButton.onclick = () => dialog.close();
  zoom.onchange = resize;
  activePreview = dialog;
  document.body.append(dialog);
  try {
    dialog.showModal();
    closeButton.focus();
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(resize);
      observer.observe(viewport);
    } else window.addEventListener("resize", resize);
    await waitForReady(document.fonts.ready, preparation.signal);
    if (disposed) return;
    const pageSelector = kind === "count" ? mode === "team" ? ".count-bulk-print-root > .count-print-sheet" : ".count-single-print-content" : kind === "spray" ? ".spray-print-sheet" : kind === "batter-profile" ? ".batter-profile-print-page" : kind === "batter-side" ? ".bs-sheet" : ".scouting-print-sheet";
    const sources = Array.from(source.querySelectorAll(pageSelector));
    if (!sources.length) throw new Error("\u5370\u5237\u5BFE\u8C61\u304C\u3042\u308A\u307E\u305B\u3093\u3002\u9078\u624B\u3068\u6761\u4EF6\u3092\u9078\u3073\u76F4\u3057\u3066\u304F\u3060\u3055\u3044\u3002");
    const doc = frame.contentDocument;
    doc.documentElement.lang = "ja";
    doc.head.replaceChildren();
    doc.body.replaceChildren();
    const title = doc.createElement("title");
    const reportName = kind === "spray" ? "\u6253\u7403\u65B9\u5411" : kind === "count" ? "\u30AB\u30A6\u30F3\u30C8\u5225\u6295\u7403\u5206\u6790" : kind === "batter-profile" ? "\u6253\u8005\u30D7\u30ED\u30D5\u30A1\u30A4\u30EB" : kind === "batter-side" ? "\u5DE6\u53F3\u5225\u6253\u8005\u5206\u6790" : kind === "side" ? "\u5DE6\u53F3\u5225\u6295\u7403\u5206\u6790" : "\u6253\u8005\u5206\u6790";
    title.textContent = reportName;
    doc.head.append(title);
    for (const sheet of document.styleSheets) {
      if (sheet.disabled) continue;
      const style2 = doc.createElement("style");
      let css;
      try {
        css = Array.from(sheet.cssRules, (rule) => rule.cssText).join("\n");
      } catch {
        if (!sheet.href) throw new Error("\u5370\u5237\u7528\u306E\u66F8\u5F0F\u3092\u8AAD\u307F\u8FBC\u3081\u307E\u305B\u3093\u3067\u3057\u305F\u3002\u30DA\u30FC\u30B8\u3092\u518D\u8AAD\u307F\u8FBC\u307F\u3057\u3066\u304F\u3060\u3055\u3044\u3002");
        const response = await waitForReady(fetch(sheet.href, { signal: preparation.signal }), preparation.signal);
        if (!response.ok) throw new Error("\u5370\u5237\u7528\u306E\u66F8\u5F0F\u3092\u8AAD\u307F\u8FBC\u3081\u307E\u305B\u3093\u3067\u3057\u305F\u3002\u30DA\u30FC\u30B8\u3092\u518D\u8AAD\u307F\u8FBC\u307F\u3057\u3066\u304F\u3060\u3055\u3044\u3002");
        css = await waitForReady(response.text(), preparation.signal);
      }
      const media = sheet.media?.mediaText;
      if (media && media !== "all") css = `@media ${media} {${css}}`;
      style2.textContent = css.replace(/@media\s+print\b/g, "@media all");
      doc.head.append(style2);
    }
    const style = doc.createElement("style");
    style.textContent = layout.css;
    doc.head.append(style);
    doc.body.dataset.scoutingPrint = kind;
    doc.body.dataset.countPrintMode = mode;
    doc.body.className = "print-document";
    const generatedAt = new Intl.DateTimeFormat("ja-JP", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Tokyo" }).format(/* @__PURE__ */ new Date());
    const names = [];
    sources.forEach((pageSource, index) => {
      const page = doc.createElement("section");
      page.className = "print-document-page";
      const content = doc.createElement("div");
      content.className = "print-document-content";
      const root = source.cloneNode(false);
      root.removeAttribute("id");
      const snapshot = pageSource.cloneNode(true);
      snapshot.removeAttribute("aria-hidden");
      snapshot.querySelectorAll("script, button, input, select, textarea, [role=tooltip], .count-plot-grid, .count-player-selection, .search-analysis-legend").forEach((node) => node.remove());
      const sourceCanvases = pageSource.querySelectorAll("canvas");
      snapshot.querySelectorAll("canvas").forEach((canvas, i) => {
        const img = doc.createElement("img");
        img.src = sourceCanvases[i].toDataURL();
        img.width = sourceCanvases[i].width;
        img.height = sourceCanvases[i].height;
        img.alt = sourceCanvases[i].getAttribute("aria-label") || "\u5206\u6790\u30C1\u30E3\u30FC\u30C8";
        canvas.replaceWith(img);
      });
      snapshot.querySelectorAll("dl > div").forEach((item) => {
        if (item.querySelector("dt")?.textContent === "\u51FA\u529B") {
          const value = item.querySelector("dd");
          if (value) value.textContent = generatedAt;
        }
      });
      root.append(snapshot);
      content.append(root);
      const name = snapshot.querySelector(".bs-heading h2, .spray-print-heading h1, .count-print-heading strong, .scouting-print-heading strong, .batter-profile-print-player h1")?.textContent?.trim() || reportName;
      names.push(name);
      const footer = doc.createElement("div");
      footer.className = "print-document-footer";
      const label = doc.createElement("span");
      label.textContent = `${reportName}\uFF5C\u4F5C\u6210 ${generatedAt}`;
      const number = doc.createElement("span");
      number.textContent = `${index + 1} / ${sources.length}`;
      footer.append(label, number);
      page.append(content, footer);
      doc.body.append(page);
    });
    meta.textContent = `A4${layout.label}\u30FB\u4F59\u767D7mm\uFF5C${reportName}\uFF5C${sources.length}\u30DA\u30FC\u30B8\uFF5C${names.join("\u3001")}`;
    frameHeight = sources.length * layout.height * 96 / 25.4 + (sources.length - 1) * 16;
    resize();
    await waitForReady(doc.fonts.ready, preparation.signal);
    await waitForReady(Promise.all(Array.from(doc.images, (img) => img.decode())), preparation.signal);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    if (disposed) return;
    const validate = () => {
      const issues = inspectPrintDocument(doc);
      printButton.disabled = issues.length > 0;
      status.dataset.state = issues.length ? "warning" : "ready";
      status.textContent = issues.length ? `${issues.join(" \uFF0F ")}\u3002\u623B\u3063\u3066\u5BFE\u8C61\u3084\u6761\u4EF6\u3092\u8ABF\u6574\u3057\u3066\u304F\u3060\u3055\u3044\u3002\u898B\u5207\u308C\u3092\u9632\u3050\u305F\u3081\u5370\u5237\u3092\u505C\u6B62\u3057\u3066\u3044\u307E\u3059\u3002` : `${sources.length}\u30DA\u30FC\u30B8\u306E\u6E96\u5099\u304C\u3067\u304D\u307E\u3057\u305F\u3002\u30D7\u30EC\u30D3\u30E5\u30FC\u5185\u306E\u7A7A\u30DA\u30FC\u30B8\u30FB\u306F\u307F\u51FA\u3057\u691C\u67FB\u3092\u901A\u904E\u3057\u307E\u3057\u305F\u3002\u5B9F\u969B\u306E\u7528\u7D19\u3082\u5370\u5237\u753B\u9762\u3067\u78BA\u8A8D\u3057\u3066\u304F\u3060\u3055\u3044\u3002`;
      return !issues.length;
    };
    validate();
    viewport.scrollTop = 0;
    printButton.onclick = () => {
      if (!validate()) return;
      try {
        frame.contentWindow.focus();
        frame.contentWindow.print();
      } catch {
        status.textContent = "\u5370\u5237\u753B\u9762\u3092\u958B\u3051\u307E\u305B\u3093\u3067\u3057\u305F\u3002\u30D6\u30E9\u30A6\u30B6\u3067\u958B\u304D\u76F4\u3057\u3066\u3001\u3082\u3046\u4E00\u5EA6\u304A\u8A66\u3057\u304F\u3060\u3055\u3044\u3002";
      }
    };
    frame.contentWindow.addEventListener("afterprint", () => {
      if (!disposed) printButton.focus();
    });
  } catch (error) {
    if (!disposed) {
      status.dataset.state = "warning";
      status.textContent = error instanceof Error && /印刷対象|書式|時間がかかって/.test(error.message) ? error.message : "\u8CC7\u6599\u306E\u6E96\u5099\u306B\u5931\u6557\u3057\u307E\u3057\u305F\u3002\u623B\u3063\u3066\u518D\u5EA6\u304A\u8A66\u3057\u304F\u3060\u3055\u3044\u3002";
      if (!dialog.open) {
        const notice = document.createElement("p");
        notice.setAttribute("role", "alert");
        notice.textContent = "\u5370\u5237\u30D7\u30EC\u30D3\u30E5\u30FC\u3092\u958B\u3051\u307E\u305B\u3093\u3067\u3057\u305F\u3002\u30D6\u30E9\u30A6\u30B6\u3067\u958B\u304D\u76F4\u3057\u3066\u304A\u8A66\u3057\u304F\u3060\u3055\u3044\u3002";
        source.append(notice);
        cleanup();
      }
      printButton.disabled = true;
    }
  }
}
function inspectPrintDocument(doc) {
  const measurements = Array.from(doc.querySelectorAll(".print-document-page"), (page, index) => {
    const content = page.querySelector(".print-document-content");
    const bounds = content.getBoundingClientRect();
    let overflow = content.scrollWidth > content.clientWidth + 2 || content.scrollHeight > content.clientHeight + 2;
    const pageBounds = page.getBoundingClientRect();
    const footer = page.querySelector(".print-document-footer");
    if (footer) {
      const rect = footer.getBoundingClientRect();
      if (rect.bottom > pageBounds.bottom + 2 || rect.top < bounds.bottom - 2 || footer.scrollWidth > footer.clientWidth + 2 || footer.scrollHeight > footer.clientHeight + 2) overflow = true;
    }
    let chartsReady = true;
    let visibleText = "";
    for (const node of content.querySelectorAll("*")) {
      const rect = node.getBoundingClientRect();
      const computed = doc.defaultView.getComputedStyle(node);
      if (computed.display === "none" || computed.visibility === "hidden") continue;
      if (node.tagName.toLowerCase() === "svg" && (!rect.width || !rect.height)) chartsReady = false;
      if (!rect.width || !rect.height) continue;
      if (node.namespaceURI === "http://www.w3.org/2000/svg" && node.tagName !== "svg") continue;
      if (rect.left < bounds.left - 2 || rect.right > bounds.right + 2 || rect.top < bounds.top - 2 || rect.bottom > bounds.bottom + 2) overflow = true;
      if (node.namespaceURI !== "http://www.w3.org/2000/svg" && (node.scrollWidth > node.clientWidth + 2 || node.scrollHeight > node.clientHeight + 2) && computed.display !== "inline") overflow = true;
      if (node.tagName === "IMG" && (!node.complete || !node.naturalWidth)) chartsReady = false;
      if (node.tagName.toLowerCase() === "svg" && !node.children.length) chartsReady = false;
      if (!node.children.length) visibleText += node.textContent || "";
    }
    return { page: index + 1, empty: !visibleText.trim(), overflow, chartsReady };
  });
  return collectPrintIssues(measurements);
}

// <stdin>
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
var keyOf = (p) => String(p.batterId || `${p.batterTeam}:${p.batter}`);
var counts = ["0-0", "1-0", "2-0", "3-0", "0-1", "1-1", "2-1", "3-1", "0-2", "1-2", "2-2", "3-2"];
var mixOf = (rows) => [...new Set(rows.map((p) => p.pitchType || "\u4E0D\u660E"))].map((type) => ({ type, n: rows.filter((p) => (p.pitchType || "\u4E0D\u660E") === type).length })).sort((a, b) => b.n - a.n);
function NineMap({ rows, frequency = false }) {
  return /* @__PURE__ */ jsx("svg", { viewBox: "0 0 240 240", role: "img", "aria-label": frequency ? "9\u30A8\u30EA\u30A2\u5225\u6295\u7403\u6570\u3068\u5168\u6295\u7403\u306B\u5BFE\u3059\u308B\u5272\u5408" : "9\u30A8\u30EA\u30A2\u5225\u6253\u6570\u30FB\u5B89\u6253\u30FB\u6253\u7387\u30FB\u672C\u5841\u6253\u30FB\u4E09\u632F", children: Array.from({ length: 9 }, (_, i) => {
    const subset = rows.filter((p) => reportNineZone(p) === i), s = reportStats(subset), x = catcherGridIndex(i, 3) % 3 * 80, y = Math.floor(i / 3) * 80;
    const share = rows.length ? subset.length / rows.length : 0;
    return /* @__PURE__ */ jsxs("g", { children: [
      /* @__PURE__ */ jsx("rect", { x, y, width: "80", height: "80", stroke: "#9aa9b2", fill: frequency && subset.length ? share >= 0.15 ? "#f8d2cb" : share < 0.1 ? "#cce9eb" : "#fff" : "#fff" }),
      frequency ? /* @__PURE__ */ jsxs(Fragment, { children: [
        /* @__PURE__ */ jsx("text", { x: x + 40, y: y + 34, textAnchor: "middle", fontSize: "23", fontWeight: "700", children: subset.length }),
        /* @__PURE__ */ jsx("text", { x: x + 40, y: y + 59, textAnchor: "middle", fontSize: "16", children: rows.length ? `${(share * 100).toFixed(1)}%` : "\u2014" })
      ] }) : /* @__PURE__ */ jsxs(Fragment, { children: [
        /* @__PURE__ */ jsxs("text", { x: x + 40, y: y + 18, textAnchor: "middle", fontSize: "16", children: [
          s.ab,
          "\u2013",
          s.hits
        ] }),
        /* @__PURE__ */ jsx("text", { x: x + 40, y: y + 40, textAnchor: "middle", fontSize: "20", fontWeight: "700", fill: s.ab >= 5 && s.avg !== null && s.avg >= 0.3 ? "#b52b35" : "#173e43", children: reportRate(s.avg) }),
        /* @__PURE__ */ jsxs("text", { x: x + 40, y: y + 57, textAnchor: "middle", fontSize: "13", children: [
          "HR:",
          s.hr,
          " K:",
          s.k
        ] }),
        /* @__PURE__ */ jsx("text", { x: x + 40, y: y + 73, textAnchor: "middle", fontSize: "11", fill: "#53616c", children: s.ab > 0 && s.ab < 5 ? "\u5C11\u6570" : " " })
      ] })
    ] }, i);
  }) });
}
function Spray({ rows }) {
  const valid = rows.filter((p) => reportContact(p) && Number.isFinite(p.sprayAngle ?? p.direction) && Math.abs(p.sprayAngle ?? p.direction) <= 90 && Number.isFinite(p.distance) && p.distance >= 0);
  const max = Math.max(120, ...valid.map((p) => p.distance));
  return /* @__PURE__ */ jsx("div", { children: /* @__PURE__ */ jsxs("svg", { viewBox: "0 0 240 220", role: "img", "aria-label": "\u6253\u7403\u65B9\u5411\u3068\u8DDD\u96E2\uFF08\u6355\u624B\u5074\u304B\u3089\u898B\u305F\u56F3\uFF09", children: [
    /* @__PURE__ */ jsx("path", { d: fieldSector(120, 200, 104), fill: "white", stroke: "#9aa9b2" }),
    valid.map((p, i) => {
      const a = (p.sprayAngle ?? p.direction) * Math.PI / 180, r = p.distance / max * 104, x = 120 + Math.sin(a) * r, y = 200 - Math.cos(a) * r;
      const color = p.playResult === "\u672C\u5841\u6253" ? "#be2637" : ["\u5358\u6253", "\u4E8C\u5841\u6253", "\u4E09\u5841\u6253"].includes(p.playResult) ? "#15806b" : "#596772";
      return /* @__PURE__ */ jsxs("g", { children: [
        /* @__PURE__ */ jsx("line", { x1: "120", y1: "200", x2: x, y2: y, stroke: color, strokeWidth: "1", opacity: ".6" }),
        /* @__PURE__ */ jsx("circle", { cx: x, cy: y, r: "2.5", fill: color })
      ] }, i);
    }),
    /* @__PURE__ */ jsxs("text", { x: "120", y: "27", textAnchor: "middle", fontSize: "14", children: [
      Math.ceil(max),
      " m"
    ] }),
    /* @__PURE__ */ jsxs("text", { x: "120", y: "217", textAnchor: "middle", fontSize: "12", children: [
      "\u63CF\u753B ",
      valid.length,
      " / \u6253\u7403 ",
      rows.filter(reportContact).length
    ] })
  ] }) });
}
function FamilyTable({ rows }) {
  return /* @__PURE__ */ jsx("div", { className: "bp-families", children: BATTER_FAMILIES.map((f) => {
    const subset = rows.filter((p) => batterFamily(p.pitchType) === f), s = reportStats(subset);
    const contact = subset.filter(reportContact);
    return /* @__PURE__ */ jsxs("section", { children: [
      /* @__PURE__ */ jsxs("h4", { children: [
        f,
        " ",
        /* @__PURE__ */ jsx("b", { children: reportAverage(subset) })
      ] }),
      /* @__PURE__ */ jsxs("p", { children: [
        "HR:",
        s.hr,
        "\u3000K:",
        s.k,
        "\u3000",
        subset.length,
        "\u7403"
      ] }),
      /* @__PURE__ */ jsxs("p", { children: [
        "\u30B4:",
        contact.filter((p) => p.hitType === "GroundBall").length,
        "\u3000\u30D5:",
        contact.filter((p) => ["FlyBall", "Popup"].includes(p.hitType)).length,
        "\u3000\u30E9:",
        contact.filter((p) => p.hitType === "LineDrive").length,
        "\u3000\u4ED6:",
        contact.filter((p) => !["GroundBall", "FlyBall", "Popup", "LineDrive"].includes(p.hitType)).length
      ] })
    ] }, f);
  }) });
}
function PitchMix({ rows, colors }) {
  const mix = mixOf(rows);
  const arcs = mix.reduce((result, { type, n }) => {
    const start = result.length ? result[result.length - 1].end : -Math.PI / 2;
    result.push({ type, start, end: start + n / rows.length * Math.PI * 2 });
    return result;
  }, []);
  return /* @__PURE__ */ jsxs("div", { className: "bp-mix", children: [
    /* @__PURE__ */ jsxs("svg", { viewBox: "0 0 200 180", role: "img", "aria-label": "\u7403\u7A2E\u5272\u5408", children: [
      /* @__PURE__ */ jsx("circle", { cx: "100", cy: "85", r: "70", fill: "#edf0f2" }),
      arcs.map(({ type, start, end }) => {
        const path = `M100 85 L${100 + 70 * Math.cos(start)} ${85 + 70 * Math.sin(start)} A70 70 0 ${end - start > Math.PI ? 1 : 0} 1 ${100 + 70 * Math.cos(end)} ${85 + 70 * Math.sin(end)} Z`;
        return /* @__PURE__ */ jsx("g", { children: mix.length === 1 ? /* @__PURE__ */ jsx("circle", { cx: "100", cy: "85", r: "70", fill: colors[type] || "#7a7f86" }) : /* @__PURE__ */ jsx("path", { d: path, fill: colors[type] || "#7a7f86", stroke: "white", strokeWidth: "1" }) }, type);
      }),
      /* @__PURE__ */ jsxs("text", { x: "100", y: "177", textAnchor: "middle", fontSize: "16", children: [
        "\u6295\u7403\u6570\uFF1A",
        rows.length,
        "\u7403"
      ] })
    ] }),
    /* @__PURE__ */ jsx("div", { className: "bp-mix-key", children: mix.map(({ type, n }) => /* @__PURE__ */ jsxs("span", { children: [
      /* @__PURE__ */ jsx("i", { style: { background: colors[type] || "#7a7f86" } }),
      type,
      " ",
      n,
      "\uFF08",
      (n / rows.length * 100).toFixed(1),
      "%\uFF09"
    ] }, type)) })
  ] });
}
function CountChart({ rows, colors }) {
  const mix = mixOf(rows), groups = counts.map((c) => rows.filter((p) => `${p.balls}-${p.strikes}` === c));
  const max = Math.max(4, Math.ceil(Math.max(0, ...groups.map((g) => g.length)) / 4) * 4);
  return /* @__PURE__ */ jsxs("svg", { viewBox: "0 0 430 220", role: "img", "aria-label": "\u30AB\u30A6\u30F3\u30C8\u5225\u306E\u7403\u7A2E\u30FB\u6295\u7403\u6570\uFF08\u6295\u7403\u524D\u306E\u30DC\u30FC\u30EB\u6570\u2212\u30B9\u30C8\u30E9\u30A4\u30AF\u6570\uFF09", children: [
    [0, 0.25, 0.5, 0.75, 1].map((t) => /* @__PURE__ */ jsxs("g", { children: [
      /* @__PURE__ */ jsx("line", { x1: "30", x2: "426", y1: 185 - t * 160, y2: 185 - t * 160, stroke: "#cad3d8" }),
      /* @__PURE__ */ jsx("text", { x: "26", y: 189 - t * 160, textAnchor: "end", fontSize: "12", children: Math.round(max * t) })
    ] }, t)),
    groups.map((g, i) => {
      let y = 185;
      return /* @__PURE__ */ jsxs("g", { children: [
        mix.map(({ type }) => {
          const n = g.filter((p) => (p.pitchType || "\u4E0D\u660E") === type).length, h = n / max * 160;
          y -= h;
          return /* @__PURE__ */ jsx("rect", { x: 36 + i * 32.4, y, width: "21", height: h, fill: colors[type] || "#7a7f86" }, type);
        }),
        /* @__PURE__ */ jsx("text", { x: 46 + i * 32.4, y: "205", textAnchor: "middle", fontSize: "12", children: counts[i] })
      ] }, counts[i]);
    })
  ] });
}
function StatsTable({ rows }) {
  const all = reportStats(rows), rispRows = reportRisp(rows), risp = reportStats(rispRows);
  const metrics = [["\u6253\u6570", "ab", false], ["\u5B89\u6253", "hits", false], ["\u672C\u5841\u6253", "hr", false], ["\u6253\u70B9", "rbi", false], ["\u6253\u7387", "avg", true], ["\u9577\u6253\u7387", "slg", true], ["\u51FA\u5841\u7387", "obp", true]];
  return /* @__PURE__ */ jsxs("table", { className: "bp-stats", children: [
    /* @__PURE__ */ jsx("thead", { children: /* @__PURE__ */ jsxs("tr", { children: [
      /* @__PURE__ */ jsx("th", { scope: "col", children: "\u6210\u7E3E" }),
      /* @__PURE__ */ jsx("th", { scope: "col", children: "\u901A\u7B97" }),
      /* @__PURE__ */ jsx("th", { scope: "col", children: "\u5F97\u70B9\u570F\uFF08\u63A8\u5B9A\uFF09" })
    ] }) }),
    /* @__PURE__ */ jsx("tbody", { children: metrics.map(([name, key, rate]) => /* @__PURE__ */ jsxs("tr", { children: [
      /* @__PURE__ */ jsx("th", { scope: "row", children: name }),
      [all, risp].map((s, i) => /* @__PURE__ */ jsx("td", { children: rate ? reportRate(s[key]) : s[key] === null ? "\u2014" : String(s[key]) }, i))
    ] }, name)) })
  ] });
}
function BatterPdfReport({ pitches, label, locationPlot, legend, pitchColors = {} }) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const groups = useMemo(() => {
    const map = /* @__PURE__ */ new Map();
    for (const p of pitches) {
      const key = keyOf(p);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(p);
    }
    return [...map.values()].sort((a, b) => String(a[0].batterKanji || a[0].batter).localeCompare(String(b[0].batterKanji || b[0].batter), "ja"));
  }, [pitches]);
  const [selected, setSelected] = useState("");
  const current = groups.find((g) => keyOf(g[0]) === selected) || groups[0];
  return /* @__PURE__ */ jsxs("section", { className: "bs-report bp-report", id: `bp-${id}`, children: [
    /* @__PURE__ */ jsxs("div", { className: "bs-actions", children: [
      /* @__PURE__ */ jsxs("label", { children: [
        "\u8868\u793A\u3059\u308B\u9078\u624B ",
        /* @__PURE__ */ jsxs("select", { value: current ? keyOf(current[0]) : "", onChange: (e) => setSelected(e.target.value), disabled: !groups.length, children: [
          !groups.length && /* @__PURE__ */ jsx("option", { value: "", children: "\u5BFE\u8C61\u306A\u3057" }),
          groups.map((g) => /* @__PURE__ */ jsxs("option", { value: keyOf(g[0]), children: [
            g[0].batterKanji || g[0].batter,
            "\uFF08",
            g[0].batterTeam,
            "\uFF09"
          ] }, keyOf(g[0])))
        ] })
      ] }),
      /* @__PURE__ */ jsx("button", { className: "secondary-button", disabled: !current, onClick: () => printReport(`#bp-${id}`, "batter-side"), children: "\u3053\u306E\u9078\u624B\u3092A4\u6A2A\u3067\u5370\u5237" })
    ] }),
    !current ? /* @__PURE__ */ jsx("p", { children: "\u5BFE\u8C61\u30C7\u30FC\u30BF\u304C\u3042\u308A\u307E\u305B\u3093\u3002\u9078\u624B\u30FB\u671F\u9593\u30FB\u691C\u7D22\u6761\u4EF6\u3092\u78BA\u8A8D\u3057\u3066\u304F\u3060\u3055\u3044\u3002" }) : (() => {
      const rows = current, p = rows[0], dates = rows.map((r) => String(r.date)).sort();
      return /* @__PURE__ */ jsxs("article", { className: "bs-sheet bp-sheet", children: [
        /* @__PURE__ */ jsxs("header", { className: "bs-heading bp-heading", children: [
          /* @__PURE__ */ jsxs("div", { children: [
            /* @__PURE__ */ jsx("h2", { children: p.batterKanji || p.batter }),
            /* @__PURE__ */ jsxs("span", { children: [
              p.batterTeam,
              "\u30FB",
              p.batterSide,
              "\u6253"
            ] })
          ] }),
          /* @__PURE__ */ jsxs("div", { children: [
            /* @__PURE__ */ jsx("strong", { children: "\u5DE6\u53F3\u5225\u6295\u7403\u5206\u6790\uFF08\u6253\u8005\uFF09" }),
            /* @__PURE__ */ jsxs("span", { children: [
              "\u53CE\u9332\u671F\u9593 ",
              dates[0],
              "\u301C",
              dates[dates.length - 1],
              "\u30FB",
              rows.length,
              "\u7403"
            ] }),
            /* @__PURE__ */ jsx("span", { children: label })
          ] })
        ] }),
        /* @__PURE__ */ jsx("div", { className: "bp-halves", children: ["\u53F3", "\u5DE6"].map((side) => {
          const subset = rows.filter((r) => r.pitcherThrows === side);
          return /* @__PURE__ */ jsxs("section", { className: "bp-half", children: [
            /* @__PURE__ */ jsxs("h3", { children: [
              "\u5BFE",
              side,
              "\u6295\u624B"
            ] }),
            /* @__PURE__ */ jsxs("div", { className: "bp-top", children: [
              /* @__PURE__ */ jsxs("section", { children: [
                /* @__PURE__ */ jsx("h4", { children: "\u6295\u7403\u7D50\u679C" }),
                locationPlot(subset, rows)
              ] }),
              /* @__PURE__ */ jsxs("section", { children: [
                /* @__PURE__ */ jsx("h4", { children: "9\u30A8\u30EA\u30A2\u5225\u6253\u7387" }),
                /* @__PURE__ */ jsx(NineMap, { rows: subset })
              ] }),
              /* @__PURE__ */ jsxs("section", { children: [
                /* @__PURE__ */ jsx("h4", { children: "9\u30A8\u30EA\u30A2\u5225\u6295\u7403\u5272\u5408" }),
                /* @__PURE__ */ jsx(NineMap, { rows: subset, frequency: true })
              ] })
            ] }),
            /* @__PURE__ */ jsxs("div", { className: "bp-middle", children: [
              /* @__PURE__ */ jsxs("section", { children: [
                /* @__PURE__ */ jsx("h4", { children: "\u6253\u7403\u65B9\u5411\u30FB\u8DDD\u96E2" }),
                /* @__PURE__ */ jsx(Spray, { rows: subset })
              ] }),
              /* @__PURE__ */ jsx(FamilyTable, { rows: subset }),
              /* @__PURE__ */ jsx(PitchMix, { rows: subset, colors: pitchColors })
            ] }),
            /* @__PURE__ */ jsxs("div", { className: "bp-bottom", children: [
              /* @__PURE__ */ jsxs("section", { children: [
                /* @__PURE__ */ jsx("h4", { children: "\u30AB\u30A6\u30F3\u30C8\u5225\u7403\u7A2E\uFF08B\u2212S\uFF09" }),
                /* @__PURE__ */ jsx(CountChart, { rows: subset, colors: pitchColors })
              ] }),
              /* @__PURE__ */ jsx(StatsTable, { rows: subset })
            ] }),
            /* @__PURE__ */ jsxs("p", { className: "bp-missing", children: [
              "\u4F4D\u7F6E\u4E0D\u660E ",
              subset.filter((r) => reportNineZone(r) === null).length,
              "\u7403\u30FB\u8D70\u8005\u4E0D\u660E ",
              subset.filter((r) => !/^[0-7]$/.test(String(r.runnerStateCode))).length,
              "\u7403\u30FB\u305D\u306E\u4ED6\u7403\u7A2E ",
              subset.filter((r) => batterFamily(r.pitchType) === "\u305D\u306E\u4ED6").length,
              "\u7403"
            ] })
          ] }, side);
        }) }),
        /* @__PURE__ */ jsxs("div", { className: "bs-key bp-key", children: [
          legend,
          /* @__PURE__ */ jsx("span", { children: "\u6253\u7403\u7DDA\uFF1A\u8D64\uFF1D\u672C\u5841\u6253\u30FB\u7DD1\uFF1D\u5B89\u6253\u30FB\u7070\uFF1D\u305D\u306E\u4ED6\u3002\u56F3\u306F\u6355\u624B\u8996\u70B9\u3002" })
        ] }),
        /* @__PURE__ */ jsxs("details", { className: "chart-definition bp-definitions", children: [
          /* @__PURE__ */ jsx("summary", { children: "\u96C6\u8A08\u65B9\u6CD5" }),
          /* @__PURE__ */ jsx("p", { children: "\u62EC\u5F27\u5185\u306F\u6253\u6570\u2212\u5B89\u6253\u3002\u72A0\u6253\u30FB\u72A0\u98DB\u306F\u6253\u6570\u304B\u3089\u9664\u5916\u3001\u5931\u7B56\u306F\u542B\u3080\u3002\u30B3\u30FC\u30B9\u56F3\u306F9\u30A8\u30EA\u30A2\uFF08\u30BE\u30FC\u30F3\u5916\u3092\u5916\u5468\u3078\u5408\u7B97\u3001\u4F4D\u7F6E\u4E0D\u660E\u306F\u9664\u5916\uFF0F\u5272\u5408\u306E\u5206\u6BCD\u306F\u5168\u6295\u7403\uFF09\u30025\u6253\u6570\u672A\u6E80\u306F\u5C11\u6570\u3002\u5F97\u70B9\u570F\u306F\u8D70\u8005\u306E\u63A8\u5B9A\u5024\u30FB\u4E0D\u660E\u306F\u9664\u5916\u3002\u6253\u70B9\u672A\u53CE\u9332\u3001\u72A0\u6253\uFF0F\u72A0\u98DB\u3092\u533A\u5225\u3067\u304D\u306A\u3044\u5834\u5408\u306E\u51FA\u5841\u7387\u306F\u300C\u2014\u300D\u3002\u901A\u7B97\u306F\u73FE\u5728\u306E\u691C\u7D22\u6761\u4EF6\u5185\u3002\u7403\u7A2E\u5206\u985E\u306FID\u6771\u90FD\u6E96\u62E0\u3002" })
        ] }),
        rows.some((r) => !["\u53F3", "\u5DE6"].includes(r.pitcherThrows)) && /* @__PURE__ */ jsxs("p", { className: "bp-missing", children: [
          "\u6295\u624B\u5DE6\u53F3\u4E0D\u660E\uFF1A",
          rows.filter((r) => !["\u53F3", "\u5DE6"].includes(r.pitcherThrows)).length,
          "\u7403\uFF08\u5DE6\u53F3\u306E\u56F3\u8868\u304B\u3089\u9664\u5916\uFF09"
        ] })
      ] });
    })()
  ] });
}
export {
  NineMap,
  BatterPdfReport as default
};

import { getPrintLayout, collectPrintIssues, type PrintPageMeasurement } from './print-document';
import { waitForReady } from '../lib/readiness';

let activePreview: HTMLDialogElement | null = null;

/** Only the selected report is copied. Preview and native print share this iframe DOM. */
export async function printReport(selector: string, kind: string, mode = 'single') {
  if (activePreview) { activePreview.focus(); return; }
  const source = document.querySelector<HTMLElement>(selector);
  if (!source) return;
  const layout = getPrintLayout(kind);
  const returnFocus = document.activeElement as HTMLElement | null;
  const dialog = document.createElement('dialog');
  dialog.className = 'report-preview';
  dialog.setAttribute('aria-label', '印刷プレビュー');
  dialog.innerHTML = `<div class="report-preview-toolbar"><div><h2>印刷プレビュー</h2><p class="report-preview-meta">A4${layout.label}・余白7mm</p></div><div class="report-preview-actions"><label>表示倍率 <select aria-label="プレビュー表示倍率"><option value="fit">画面に合わせる</option><option value="1">100%</option></select></label><button type="button" data-action="print" disabled>印刷／PDF保存</button><button type="button" data-action="close">戻る</button></div></div><p class="report-preview-status" role="status" aria-live="polite">資料とチャートを準備しています…</p><p class="report-preview-settings">印刷設定：A4・${layout.label}・倍率100%・ヘッダーとフッターをオフ。PDF保存は印刷画面の送信先で選べます。</p><div class="report-preview-viewport"><div class="report-preview-scaled"><iframe title="印刷する資料" sandbox="allow-same-origin allow-modals"></iframe></div></div>`;
  const frame = dialog.querySelector('iframe')!;
  const printButton = dialog.querySelector<HTMLButtonElement>('[data-action="print"]')!;
  const closeButton = dialog.querySelector<HTMLButtonElement>('[data-action="close"]')!;
  const status = dialog.querySelector<HTMLElement>('.report-preview-status')!;
  const meta = dialog.querySelector<HTMLElement>('.report-preview-meta')!;
  const viewport = dialog.querySelector<HTMLElement>('.report-preview-viewport')!;
  const scaled = dialog.querySelector<HTMLElement>('.report-preview-scaled')!;
  const zoom = dialog.querySelector<HTMLSelectElement>('select')!;
  let frameHeight = 0;
  let disposed = false;
  const preparation = new AbortController();
  const resize = () => {
    const width = layout.width * 96 / 25.4;
    const scale = zoom.value === '1' ? 1 : Math.min(1, Math.max(.1, (viewport.clientWidth - 32) / width), Math.max(.1, (viewport.clientHeight - 32) / (layout.height * 96 / 25.4)));
    frame.style.width = `${width}px`;
    frame.style.height = `${frameHeight}px`;
    frame.style.transform = `scale(${scale})`;
    scaled.style.width = `${width * scale}px`;
    scaled.style.height = `${frameHeight * scale}px`;
  };
  let observer: ResizeObserver | undefined;
  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    preparation.abort();
    observer?.disconnect();
    window.removeEventListener('resize', resize);
    dialog.remove();
    activePreview = null;
    if (returnFocus?.isConnected) returnFocus.focus();
  };
  dialog.addEventListener('close', cleanup, { once: true });
  closeButton.onclick = () => dialog.close();
  zoom.onchange = resize;
  activePreview = dialog;
  document.body.append(dialog);
  try {
    dialog.showModal();
    closeButton.focus();
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(resize);
      observer.observe(viewport);
    } else window.addEventListener('resize', resize);
    await waitForReady(document.fonts.ready, preparation.signal);
    if (disposed) return;
    const pageSelector = kind === 'count'
      ? mode === 'team' ? '.count-bulk-print-root > .count-print-sheet' : '.count-single-print-content'
      : kind === 'spray' ? '.spray-print-sheet' : kind === 'batter-profile' ? '.batter-profile-print-page' : kind === 'batter-side' ? '.bs-sheet' : '.scouting-print-sheet';
    const sources = Array.from(source.querySelectorAll<HTMLElement>(pageSelector));
    if (!sources.length) throw new Error('印刷対象がありません。選手と条件を選び直してください。');
    const doc = frame.contentDocument!;
    doc.documentElement.lang = 'ja';
    doc.head.replaceChildren();
    doc.body.replaceChildren();
    const title = doc.createElement('title');
    const reportName = kind === 'spray' ? '打球方向' : kind === 'count' ? 'カウント別投球分析' : kind === 'batter-profile' ? '打者プロファイル' : kind === 'batter-side' ? '左右別打者分析' : kind === 'side' ? '左右別投球分析' : '打者分析';
    title.textContent = reportName;
    doc.head.append(title);
    // Preserve cascade order and activate print rules for the preview too.
    // Never copy scripts, application state or storage into the document.
    for (const sheet of document.styleSheets) {
      if (sheet.disabled) continue;
      const style = doc.createElement('style');
      let css: string;
      try { css = Array.from(sheet.cssRules, rule => rule.cssText).join('\n'); }
      catch {
        if (!sheet.href) throw new Error('印刷用の書式を読み込めませんでした。ページを再読み込みしてください。');
        const response = await waitForReady(fetch(sheet.href, { signal: preparation.signal }), preparation.signal);
        if (!response.ok) throw new Error('印刷用の書式を読み込めませんでした。ページを再読み込みしてください。');
        css = await waitForReady(response.text(), preparation.signal);
      }
      const media = sheet.media?.mediaText;
      if (media && media !== 'all') css = `@media ${media} {${css}}`;
      style.textContent = css.replace(/@media\s+print\b/g, '@media all');
      doc.head.append(style);
    }
    const style = doc.createElement('style');
    style.textContent = layout.css;
    doc.head.append(style);
    doc.body.dataset.scoutingPrint = kind;
    doc.body.dataset.countPrintMode = mode;
    doc.body.className = 'print-document';
    const generatedAt = new Intl.DateTimeFormat('ja-JP', { dateStyle:'short', timeStyle:'short', timeZone:'Asia/Tokyo' }).format(new Date());
    const names: string[] = [];
    sources.forEach((pageSource, index) => {
      const page = doc.createElement('section');
      page.className = 'print-document-page';
      const content = doc.createElement('div');
      content.className = 'print-document-content';
      const root = source.cloneNode(false) as HTMLElement;
      root.removeAttribute('id');
      const snapshot = pageSource.cloneNode(true) as HTMLElement;
      snapshot.removeAttribute('aria-hidden');
      snapshot.querySelectorAll('script, button, input, select, textarea, [role=tooltip], .count-plot-grid, .count-player-selection, .search-analysis-legend').forEach(node => node.remove());
      // Canvas pixels do not survive cloneNode; preserve their rendered appearance.
      const sourceCanvases = pageSource.querySelectorAll('canvas');
      snapshot.querySelectorAll('canvas').forEach((canvas, i) => {
        const img = doc.createElement('img');
        img.src = sourceCanvases[i].toDataURL();
        img.width = sourceCanvases[i].width;
        img.height = sourceCanvases[i].height;
        img.alt = sourceCanvases[i].getAttribute('aria-label') || '分析チャート';
        canvas.replaceWith(img);
      });
      snapshot.querySelectorAll('dl > div').forEach(item => {
        if (item.querySelector('dt')?.textContent === '出力') { const value = item.querySelector('dd'); if (value) value.textContent = generatedAt; }
      });
      root.append(snapshot);
      content.append(root);
      const name = snapshot.querySelector('.bs-heading h2, .spray-print-heading h1, .count-print-heading strong, .scouting-print-heading strong, .batter-profile-print-player h1')?.textContent?.trim() || reportName;
      names.push(name);
      const footer = doc.createElement('div');
      footer.className = 'print-document-footer';
      const label = doc.createElement('span');
      label.textContent = `${reportName}｜作成 ${generatedAt}`;
      const number = doc.createElement('span');
      number.textContent = `${index + 1} / ${sources.length}`;
      footer.append(label, number);
      page.append(content, footer);
      doc.body.append(page);
    });
    meta.textContent = `A4${layout.label}・余白7mm｜${reportName}｜${sources.length}ページ｜${names.join('、')}`;
    frameHeight = sources.length * layout.height * 96 / 25.4 + (sources.length - 1) * 16;
    resize();
    await waitForReady(doc.fonts.ready, preparation.signal);
    await waitForReady(Promise.all(Array.from(doc.images, img => img.decode())), preparation.signal);
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    if (disposed) return;
    const validate = () => {
      const issues = inspectPrintDocument(doc);
      printButton.disabled = issues.length > 0;
      status.dataset.state = issues.length ? 'warning' : 'ready';
      status.textContent = issues.length
        ? `${issues.join(' ／ ')}。戻って対象や条件を調整してください。見切れを防ぐため印刷を停止しています。`
        : `${sources.length}ページの準備ができました。プレビュー内の空ページ・はみ出し検査を通過しました。実際の用紙も印刷画面で確認してください。`;
      return !issues.length;
    };
    validate();
    viewport.scrollTop = 0;
    printButton.onclick = () => {
      if (!validate()) return;
      try { frame.contentWindow!.focus(); frame.contentWindow!.print(); }
      catch { status.textContent = '印刷画面を開けませんでした。ブラウザで開き直して、もう一度お試しください。'; }
    };
    frame.contentWindow!.addEventListener('afterprint', () => { if (!disposed) printButton.focus(); });
  } catch (error) {
    if (!disposed) {
      status.dataset.state = 'warning';
      status.textContent = error instanceof Error && /印刷対象|書式|時間がかかって/.test(error.message)
        ? error.message : '資料の準備に失敗しました。戻って再度お試しください。';
      if (!dialog.open) {
        const notice = document.createElement('p');
        notice.setAttribute('role', 'alert');
        notice.textContent = '印刷プレビューを開けませんでした。ブラウザで開き直してお試しください。';
        source.append(notice);
        cleanup();
      }
      printButton.disabled = true;
    }
  }
}

export function inspectPrintDocument(doc: Document): string[] {
  const measurements: PrintPageMeasurement[] = Array.from(doc.querySelectorAll<HTMLElement>('.print-document-page'), (page, index) => {
    const content = page.querySelector<HTMLElement>('.print-document-content')!;
    const bounds = content.getBoundingClientRect();
    let overflow = content.scrollWidth > content.clientWidth + 2 || content.scrollHeight > content.clientHeight + 2;
    const pageBounds = page.getBoundingClientRect();
    const footer = page.querySelector<HTMLElement>('.print-document-footer');
    if (footer) {
      const rect = footer.getBoundingClientRect();
      if (rect.bottom > pageBounds.bottom + 2 || rect.top < bounds.bottom - 2 || footer.scrollWidth > footer.clientWidth + 2 || footer.scrollHeight > footer.clientHeight + 2) overflow = true;
    }
    let chartsReady = true;
    let visibleText = '';
    for (const node of content.querySelectorAll<HTMLElement>('*')) {
      const rect = node.getBoundingClientRect();
      const computed = doc.defaultView!.getComputedStyle(node);
      if (computed.display === 'none' || computed.visibility === 'hidden') continue;
      if (node.tagName.toLowerCase() === 'svg' && (!rect.width || !rect.height)) chartsReady = false;
      if (!rect.width || !rect.height) continue;
      if (node.namespaceURI === 'http://www.w3.org/2000/svg' && node.tagName !== 'svg') continue;
      if (rect.left < bounds.left - 2 || rect.right > bounds.right + 2 || rect.top < bounds.top - 2 || rect.bottom > bounds.bottom + 2) overflow = true;
      if (node.namespaceURI !== 'http://www.w3.org/2000/svg' && (node.scrollWidth > node.clientWidth + 2 || node.scrollHeight > node.clientHeight + 2) && computed.display !== 'inline') overflow = true;
      if (node.tagName === 'IMG' && (!(node as HTMLImageElement).complete || !(node as HTMLImageElement).naturalWidth)) chartsReady = false;
      if (node.tagName.toLowerCase() === 'svg' && !node.children.length) chartsReady = false;
      if (!node.children.length) visibleText += node.textContent || '';
    }
    return { page:index + 1, empty:!visibleText.trim(), overflow, chartsReady };
  });
  return collectPrintIssues(measurements);
}

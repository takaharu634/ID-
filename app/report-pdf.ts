import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import { waitForReady } from '../lib/readiness';

const PX_PER_MM = 96 / 25.4;
// Keep each canvas below 3 megapixels, including on high-DPI phones.
const RENDER_SCALE = 1.6;

export function pdfPageLayout(page: HTMLElement) {
  const portrait = page.dataset.orientation === 'portrait' || page.getBoundingClientRect().height > page.getBoundingClientRect().width;
  return portrait
    ? { orientation: 'portrait' as const, width: 196, height: 282 }
    : { orientation: 'landscape' as const, width: 283, height: 195 };
}

/** Render one fixed report page at a time; never allocate a packet-sized canvas. */
export async function createReportPdf(doc: Document, signal: AbortSignal, progress: (page: number, total: number) => void): Promise<Blob> {
  const pages = Array.from(doc.querySelectorAll<HTMLElement>('.print-document-page'));
  if (!pages.length) throw new Error('印刷対象がありません。');
  const initial = pdfPageLayout(pages[0]);
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: initial.orientation, compress: true });
  pdf.setProperties({ title: doc.title, creator: 'ID東都' });
  const frame = document.createElement('iframe');
  frame.title = 'PDF作成用';
  frame.setAttribute('aria-hidden', 'true');
  frame.setAttribute('sandbox', 'allow-same-origin');
  frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:1200px;height:1200px;border:0;pointer-events:none;';
  document.body.append(frame);
  const checkCancelled = () => { if (signal.aborted) throw new Error('PDF作成を中止しました。'); };
  try {
    const target = frame.contentDocument!;
    target.documentElement.lang = 'ja';
    target.head.replaceChildren(...Array.from(doc.head.children, node => node.cloneNode(true)));
    target.body.className = doc.body.className;
    Object.assign(target.body.dataset, doc.body.dataset);
    const pageStyle = target.createElement('style');
    target.head.append(pageStyle);
    for (let i = 0; i < pages.length; i++) {
      checkCancelled();
      progress(i + 1, pages.length);
      const layout = pdfPageLayout(pages[i]);
      pageStyle.textContent = `html, body.print-document { width:${layout.width}mm!important; } .print-document-page { margin:0!important; }`;
      const snapshot = target.importNode(pages[i], true);
      target.body.replaceChildren(snapshot);
      await waitForReady(target.fonts.ready, signal);
      await waitForReady(Promise.all(Array.from(target.images, img => img.decode())), signal);
      checkCancelled();
      const canvas = await html2canvas(snapshot, {
        backgroundColor: '#ffffff', scale: RENDER_SCALE,
        width: Math.ceil(layout.width * PX_PER_MM), height: Math.ceil(layout.height * PX_PER_MM),
        windowWidth: 1200, windowHeight: 1200, scrollX: 0, scrollY: 0,
        logging: false, removeContainer: true,
      });
      try {
        checkCancelled();
        if (i) pdf.addPage('a4', layout.orientation);
        pdf.addImage(canvas.toDataURL('image/jpeg', .95), 'JPEG', 7, 7, layout.width, layout.height);
      } finally {
        canvas.width = 0;
        canvas.height = 0;
      }
      // Release the previous DOM and let progress/close controls repaint on phones.
      target.body.replaceChildren();
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
    checkCancelled();
    return pdf.output('blob');
  } finally {
    frame.remove();
  }
}

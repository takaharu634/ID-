import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
let temp, createReportPdf, jpeg;
before(async () => {
  temp = await mkdtemp(path.join(tmpdir(), 'report-pdf-'));
  jpeg = 'data:image/jpeg;base64,' + (await readFile(new URL('./fixtures/pdf-pixel.jpg', import.meta.url))).toString('base64');
  await build({ entryPoints: ['app/report-pdf.ts'], outfile: path.join(temp, 'pdf.cjs'), bundle: true, platform: 'node', format: 'cjs', plugins: [{
    name: 'mock-browser-rasterizer', setup(b) {
      b.onResolve({ filter: /^jspdf$/ }, () => ({ path: require.resolve('jspdf'), external: true }));
      b.onResolve({ filter: /^html2canvas$/ }, () => ({ path: 'rasterizer', namespace: 'test' }));
      b.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: 'export default (...args) => globalThis.__pdfRender(...args);' }));
    },
  }] });
  ({ createReportPdf } = require(path.join(temp, 'pdf.cjs')));
});
after(async () => { delete globalThis.document; delete globalThis.__pdfRender; await rm(temp, { recursive: true, force: true }); });

function browserDocument(orientations) {
  const pages = orientations.map(orientation => ({ dataset: { orientation }, getBoundingClientRect: () => orientation === 'portrait' ? { width: 741, height: 1066 } : { width: 1070, height: 737 } }));
  let removed = false, children = [];
  const target = {
    documentElement: {}, head: { replaceChildren() {}, append() {} },
    body: { dataset: {}, replaceChildren(...nodes) { children = nodes; } },
    fonts: { ready: Promise.resolve() }, images: [], createElement: () => ({}), importNode: node => node,
  };
  globalThis.document = {
    body: { append() {} },
    createElement: () => ({ contentDocument: target, style: {}, setAttribute() {}, remove() { removed = true; } }),
  };
  const doc = { title: 'ID東都', head: { children: [] }, body: { className: 'print-document', dataset: { scoutingPrint: 'opponent' } }, querySelectorAll: () => pages };
  return { doc, get removed() { return removed; }, get children() { return children; } };
}

test('mixed packet produces a real PDF with one A4 page per report and bounded canvases', async () => {
  const fixture = browserDocument(['portrait', 'landscape', 'portrait']);
  const canvases = [], progress = [];
  globalThis.__pdfRender = async (page, options) => {
    assert.deepEqual(fixture.children, [page]);
    assert.ok(options.width * options.height * options.scale ** 2 < 3_000_000);
    assert.equal(options.windowWidth, 1200);
    if (canvases.length) assert.equal(canvases.at(-1).width, 0);
    const canvas = { width: options.width, height: options.height, toDataURL: () => jpeg };
    canvases.push(canvas);
    return canvas;
  };
  const blob = await createReportPdf(fixture.doc, new AbortController().signal, (...args) => progress.push(args));
  const pdf = Buffer.from(await blob.arrayBuffer()).toString('latin1');
  assert.equal(blob.type, 'application/pdf');
  assert.match(pdf, /^%PDF-/);
  assert.equal([...pdf.matchAll(/\/Type \/Page\b/g)].length, 3);
  const boxes = [...pdf.matchAll(/\/MediaBox \[([^\]]+)\]/g)].map(m => m[1].split(/\s+/).map(Number));
  assert.equal(boxes.length, 3);
  assert.ok(boxes[0][2] < boxes[0][3]);
  assert.ok(boxes[1][2] > boxes[1][3]);
  assert.ok(boxes[2][2] < boxes[2][3]);
  assert.deepEqual(progress, [[1, 3], [2, 3], [3, 3]]);
  assert.ok(canvases.every(c => c.width === 0 && c.height === 0));
  assert.equal(fixture.removed, true);
});

test('closing during preparation cancels before rasterizing and releases its iframe', async () => {
  const fixture = browserDocument(['portrait', 'landscape']);
  const controller = new AbortController();
  globalThis.__pdfRender = () => assert.fail('cancelled report must not render');
  await assert.rejects(createReportPdf(fixture.doc, controller.signal, () => controller.abort()), /中止/);
  assert.equal(fixture.removed, true);
});

test('rasterizer failure releases the temporary document and does not return a partial PDF', async () => {
  const fixture = browserDocument(['landscape']);
  globalThis.__pdfRender = async () => { throw new Error('canvas failure'); };
  await assert.rejects(createReportPdf(fixture.doc, new AbortController().signal, () => {}), /canvas failure/);
  assert.equal(fixture.removed, true);
});

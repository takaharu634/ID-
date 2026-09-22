import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { buildSpinDataset, estimateTrajectorySpin, spinFromLift } from '../lib/trackman-spin.mjs';
import { parseTrackman } from '../lib/trackman-folder-import.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dependencyRoot = process.env.TOHTO_TEST_DEPENDENCY_ROOT || root;
const require = createRequire(resolve(dependencyRoot, 'package.json'));
let spinModule, scratch, dataset, spin, raw;
before(async () => {
  dataset = JSON.parse(await readFile(resolve(root, 'public/data/season-2026-fall.json'), 'utf8'));
  spin = JSON.parse(await readFile(resolve(root, 'public/data/spin-2026-fall.json'), 'utf8'));
  const manifest = JSON.parse(await readFile(resolve(root, 'data/trackman/2026-fall/manifest.json'), 'utf8'));
  raw = (await Promise.all(manifest.files.map(async f => parseTrackman(await readFile(resolve(root, `data/trackman/2026-fall/${f.id}.csv`))).rows))).flat();
  scratch = await mkdtemp(resolve(dependencyRoot, '.spin-render-'));
  const source = await readFile(resolve(root, 'app/pitch-spin-profile.tsx'), 'utf8');
  const result = await require('esbuild').build({ stdin: { contents: source, resolveDir: resolve(root, 'app'), loader: 'tsx' }, bundle: true, write: false, format: 'esm', platform: 'node', packages: 'external', jsx: 'automatic', logLevel: 'silent' });
  const path = resolve(scratch, 'spin.mjs');
  await writeFile(path, result.outputFiles[0].text);
  spinModule = await import(pathToFileURL(path).href);
});
after(async () => { if (scratch) await rm(scratch, { recursive: true, force: true }); });

test('Nathan published CL=.20, S=.24 example recovers roughly 62.5% for prescription b', () => {
  const rpm = 2400, radius = 0.0366, speed = radius * rpm * 2 * Math.PI / 60 / 0.24;
  const estimated = spinFromLift(0.20, speed, rpm);
  assert.ok(Math.abs(estimated.spinEfficiency - 62.5) < 0.2);
  assert.ok(Math.abs(Math.cos(estimated.gyroAngle * Math.PI / 180) * 100 - estimated.spinEfficiency) < 1e-9);
  assert.equal(spinFromLift(0.4, speed, rpm), null);
  assert.equal(spinFromLift(0.2, speed, 100), null);
  assert.equal(estimateTrajectorySpin({}), null);
});

test('autumn animation matches CSV pitch IDs, normalized types, measurements, and null estimates', () => {
  const regenerated = buildSpinDataset(dataset, raw);
  assert.equal(regenerated.length, spin.length);
  regenerated.forEach((row, i) => assert.deepEqual(row, spin[i]));
  const measured = dataset.pitches.filter(row => row.spin > 0 && Number.isFinite(row.spinAxis) && Number.isFinite(row.ivb) && Number.isFinite(row.hb));
  assert.equal(spin.length, measured.length);
  const byId = new Map(dataset.pitches.map(row => [row.id, row]));
  for (const row of spin) {
    const original = byId.get(row.pitchId);
    assert.equal(row.pitcherId, `2026-fall:${original.pitcherId}`);
    assert.equal(row.spinRate, original.spin);
    assert.equal(row.normalizedPitchType, original.pitchType);
    if (row.gyroAngle !== null) {
      assert.ok(row.gyroAngle >= 0 && row.gyroAngle <= 90);
      assert.ok(row.spinEfficiency >= 0 && row.spinEfficiency <= 100);
    } else {
      assert.equal(row.spinEfficiency, null);
      assert.equal(row.activeSpin, null);
    }
  }
  assert.equal(dataset.metadata.trackmanSync.spinPitches, spin.length);
});

test('every measured autumn pitcher has profiles; missing gyro keeps measured animation available', () => {
  for (const id of new Set(spin.map(row => row.pitcherId))) assert.ok(spinModule.buildPitchProfiles(spin.filter(row => row.pitcherId === id)).length > 0);
  const unestimated = { ...spin[0], gyroAngle: null, spinEfficiency: null, activeSpin: null };
  const profile = spinModule.buildPitchProfiles([unestimated])[0];
  assert.equal(profile.count, 1);
  assert.equal(profile.estimateCount, 0);
  assert.equal(profile.spinRate, unestimated.spinRate);
});

test('real canvas drawing advances by rpm, pauses, respects speed and cancels on cleanup', () => {
  const original = { window: globalThis.window, requestAnimationFrame: globalThis.requestAnimationFrame, cancelAnimationFrame: globalThis.cancelAnimationFrame };
  let callback, frameId = 0, cancelled, drawingCalls = 0;
  const context = new Proxy({}, { get(_target, name) {
    if (name === 'createRadialGradient' || name === 'createLinearGradient') return () => ({ addColorStop() {} });
    return (...args) => { for (const value of args) if (typeof value === 'number') assert.ok(Number.isFinite(value), `${String(name)} has NaN`); drawingCalls++; };
  }, set() { return true; } });
  const canvas = { width: 0, height: 0, getContext: () => context, getBoundingClientRect: () => ({ width: 560, height: 440 }) };
  globalThis.window = { devicePixelRatio: 1 };
  globalThis.requestAnimationFrame = fn => { callback = fn; return ++frameId; };
  globalThis.cancelAnimationFrame = id => { cancelled = id; };
  try {
    const profile = spinModule.buildPitchProfiles(spin.slice(0, 20))[0];
    for (const paused of [false, true]) {
      const rotation = { current: 0 };
      const stop = spinModule.startSpinAnimation(canvas, profile, 0.025, paused, rotation);
      const now = performance.now(); callback(now + 16);
      const first = rotation.current; callback(now + 32);
      const expected = paused ? 0 : profile.rotationDirection * profile.spinRate * 2 * Math.PI / 60 * 0.025 * 0.016;
      assert.ok(Math.abs(rotation.current - first - expected) < 1e-9);
      stop(); assert.equal(cancelled, frameId);
    }
    assert.ok(drawingCalls > 1000);
  } finally { Object.assign(globalThis, original); }
});

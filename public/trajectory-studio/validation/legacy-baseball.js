/*
 * ID東都 回転プロファイルの球面モデルを軌道表示へ再利用した描画器。
 * Reference: spin_reference/app/page.tsx, commit
 * 16db37a544ca23a77655a002da2c60d9dcf09741.
 * Reused geometry: seamPoint (Paul Bourke's closed 4π baseball seam),
 * seamFrame, 108 equal-arc-length stitch pairs, and 190 leather-grain points.
 * Reused appearance: leather gradients, recessed cut edges, red thread,
 * and its pitch-specific initial placement: axis-aligned four-seam geometry
 * for Fastball/Sinker, common display pose for the other pitch types.
 *
 * No measured gyro or seam orientation is present in this trajectory dataset.
 * Rotation therefore assumes a transverse axis (gyro = 0) and a shared,
 * illustrative initial seam phase. Seam placement follows the reference's
 * display convention; it is not a measured grip. Gyro is not inferred from
 * pitch type, movement, or spin efficiency. RPM and SpinAxis/Tilt are
 * taken from the individual pitch; missing inputs leave the ball static.
 *
 * World convention matches scene.js: x = -TrackMan Z, y = TrackMan Y,
 * z = TrackMan X - X(home). A pitch travels mainly along world -z.
 * The reference pitcher-view coordinate frame is x/y/z in this same world.
 * tilt = (SpinAxis - 180) degrees; reference axis = (-cos tilt, sin tilt, 0)
 * and reference rotationDirection = -1. The resulting angular velocity is
 * (cos tilt, -sin tilt, 0) * RPM * 2π/60. SpinAxis 180° is thus +x backspin;
 * +x × -z = +y, consistent with upward Magnus force. The camera only
 * changes projection; it never changes the physical axis or angular speed.
 * elapsed is PHYSICAL seconds, not display seconds. Callers clamp it at
 * that pitch's flight endpoint, just as they do for its position.
 */
(function (root) {
  'use strict';
  const TAU = Math.PI * 2;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const scale = (a, v) => a.map(x => x * v);
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const norm = a => scale(a, 1 / (Math.hypot(...a) || 1));
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const finiteInput = v => (typeof v === 'number' || (typeof v === 'string' && v.trim() !== '')) && Number.isFinite(Number(v));

  function seamPoint(t) {
    const a = 0.4;
    const polar = Math.PI / 2 - (Math.PI / 2 - a) * Math.cos(t);
    const azimuth = t / 2 + a * Math.sin(2 * t);
    return [Math.sin(polar) * Math.cos(azimuth), Math.sin(polar) * Math.sin(azimuth), Math.cos(polar)];
  }
  function seamFrame(t) {
    const point = seamPoint(t), before = seamPoint(t - 0.002), after = seamPoint(t + 0.002);
    const tangent = norm(after.map((v, i) => v - before[i]));
    return { point, tangent, normal: norm(cross(point, tangent)) };
  }
  function rotate(point, axis, angle) {
    const c = Math.cos(angle), s = Math.sin(angle), d = dot(point, axis), k = cross(axis, point);
    return point.map((v, i) => v * c + k[i] * s + axis[i] * d * (1 - c));
  }
  function alignAxis(point, from, to) {
    const source = norm(from), target = norm(to), rotationAxis = cross(source, target);
    const sine = Math.hypot(...rotationAxis), cosine = dot(source, target);
    if (sine < 1e-7) {
      if (cosine > 0) return point;
      const fallback = norm(cross(source, Math.abs(source[0]) < .9 ? [1, 0, 0] : [0, 1, 0]));
      return rotate(point, fallback, Math.PI);
    }
    return rotate(point, scale(rotationAxis, 1 / sine), Math.atan2(sine, cosine));
  }
  function initialPose(point, axis, placement) {
    if (placement === 'four-seam') {
      // Restore orientBaseball from the source profile. Its local z equator
      // crosses the seam four times; align that local z axis to the spin axis.
      const phased = rotate(point, [0, 0, 1], Math.PI / 4);
      return alignAxis(phased, [0, 0, 1], axis);
    }
    return rotate(rotate(point, [0, 1, 0], -0.34), [1, 0, 0], 0.18);
  }
  function buildStitches() {
    const resolution = 2160, samples = [{ t: 0, distance: 0 }];
    let distance = 0, previous = seamPoint(0);
    for (let i = 1; i <= resolution; i++) {
      const t = i / resolution * Math.PI * 4, point = seamPoint(t);
      distance += Math.hypot(...point.map((v, j) => v - previous[j]));
      samples.push({ t, distance }); previous = point;
    }
    return Array.from({ length: 108 }, (_, i) => {
      const target = (i + 0.5) / 108 * distance;
      let lo = 0, hi = samples.length - 1;
      while (lo < hi) {
        const m = Math.floor((lo + hi) / 2);
        if (samples[m].distance < target) lo = m + 1; else hi = m;
      }
      const { point, tangent, normal } = seamFrame(samples[lo].t);
      const p = (n, t) => norm(add(add(point, scale(normal, n)), scale(tangent, t)));
      return { center: point, segments: [[p(0.056, -0.026), p(0.056 * 0.12, 0.026)], [p(-0.056, 0.026), p(-0.056 * 0.12, -0.026)]] };
    });
  }
  const stitches = buildStitches();
  const grain = Array.from({ length: 190 }, (_, i) => {
    const z = 1 - 2 * (i + 0.5) / 190, r = Math.sqrt(Math.max(0, 1 - z * z));
    const a = i * Math.PI * (3 - Math.sqrt(5));
    return { point: [Math.cos(a) * r, Math.sin(a) * r, z], size: 0.55 + ((i * 37) % 11) / 16, tone: (i * 53) % 4 };
  });
  // Cache unchanging geometry. Smaller balls retain the closed curve but skip
  // subpixel pores and threads; full geometry is present for close inspection.
  const curves = new Map([72, 160, 520].map(resolution => [resolution,
    [-0.018, 0, 0.018].map(offset => Array.from({ length: resolution + 1 }, (_, i) => {
      const f = seamFrame(i / resolution * Math.PI * 4);
      return norm(add(f.point, scale(f.normal, offset)));
    }))
  ]));

  function spinState(pitch, elapsed) {
    pitch = pitch || {};
    let spinAxis = finiteInput(pitch.spinAxis) ? Number(pitch.spinAxis) : null;
    let axisSource = spinAxis === null ? null : 'SpinAxis';
    if (spinAxis === null && typeof pitch.tilt === 'string') {
      const match = pitch.tilt.trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
      if (match && +match[1] >= 0 && +match[1] <= 12 && +match[2] < 60) {
        spinAxis = ((+match[1] % 12) * 30 + (+match[2] / 60) * 30 + 180) % 360;
        axisSource = 'Tilt';
      }
    }
    const rpm = finiteInput(pitch.spin) && Number(pitch.spin) >= 0 ? Number(pitch.spin) : null;
    const available = rpm !== null && spinAxis !== null;
    const tilt = ((spinAxis ?? 180) - 180) * Math.PI / 180;
    const axis = [-Math.cos(tilt), Math.sin(tilt), 0];
    const time = finiteInput(elapsed) ? Math.max(0, Number(elapsed)) : 0;
    const turns = available ? rpm * time / 60 : 0;
    const seamPlacement = spinAxis !== null && ['Fastball', 'Sinker'].includes(pitch.type) ? 'four-seam' : 'display';
    return { available, rpm, spinAxis, axisSource, axis, angularVelocity: available ? scale(axis, -rpm * TAU / 60) : [0, 0, 0], angle: -(turns % 1) * TAU, turns, time, gyroAssumed: 0, seamPlacement, initialSeam: seamPlacement === 'four-seam' ? 'axis-aligned-four-seam-reference' : 'common-display-pose' };
  }

  function drawSpinningBaseball(ctx, options) {
    const { x, y, radius, pitch, elapsed, color = '#64748b' } = options || {};
    if (!ctx || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(radius) || radius <= 0) return null;
    const r = radius, state = spinState(pitch, elapsed);
    const camera = options.camera || {};
    const right = camera.right || [1, 0, 0], up = camera.up || [0, 1, 0], forward = camera.forward || [0, 0, -1];
    // Compose world rotation and camera projection once; points need only nine
    // multiply-adds after this, even at the full 520-segment seam resolution.
    const columns = [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map(e => {
      const w = rotate(initialPose(e, state.axis, state.seamPlacement), state.axis, state.angle);
      return [dot(w, right), dot(w, up), -dot(w, forward)];
    });
    const transform = p => [0, 1, 2].map(i => columns[0][i] * p[0] + columns[1][i] * p[1] + columns[2][i] * p[2]);
    ctx.save();
    const shadow = clamp(r * 0.12, 0.75, 3);
    ctx.beginPath(); ctx.arc(x + shadow, y + shadow, r + Math.min(1.5, r * 0.08), 0, TAU);
    ctx.fillStyle = 'rgba(0,0,0,.20)'; ctx.fill();
    const leather = ctx.createRadialGradient(x - r * .33, y - r * .39, r * .05, x + r * .08, y + r * .1, r * 1.1);
    [[0, '#fffefa'], [.43, '#f7f3e9'], [.76, '#ddd7ca'], [.94, '#b8b2a8'], [1, '#8f8d89']].forEach(([p, c]) => leather.addColorStop(p, c));
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fillStyle = leather; ctx.fill();
    ctx.save(); ctx.beginPath(); ctx.arc(x, y, Math.max(.1, r - .15), 0, TAU); ctx.clip();
    if (r >= 18) {
      const grainScale = clamp(r / 115, .22, 1.65);
      for (const g of grain) {
        const p = transform(g.point); if (p[2] < .04) continue;
        const depth = Math.min(1, (p[2] - .04) / .96);
        ctx.beginPath(); ctx.arc(x + p[0] * r, y - p[1] * r, g.size * (.55 + depth * .45) * grainScale, 0, TAU);
        ctx.fillStyle = g.tone === 0 ? `rgba(102,86,67,${.055 * depth})` : `rgba(255,255,255,${.11 * depth})`; ctx.fill();
      }
    }
    if (r >= 3.2) {
      const resolution = r < 12 ? 72 : r < 40 ? 160 : 520;
      const drawCurve = (points, stroke, width) => {
        let drawing = false;
        ctx.beginPath();
        for (const point of points) {
          const p = transform(point), px = x + p[0] * r, py = y - p[1] * r;
          if (p[2] > -.015) { if (drawing) ctx.lineTo(px, py); else ctx.moveTo(px, py); drawing = true; }
          else drawing = false;
        }
        ctx.strokeStyle = stroke; ctx.lineWidth = width; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke();
      };
      const [edge1, groove, edge2] = curves.get(resolution);
      if (r >= 12) {
        drawCurve(edge1, 'rgba(113,92,75,.38)', Math.max(.42, r * .007));
        drawCurve(edge2, 'rgba(113,92,75,.38)', Math.max(.42, r * .007));
        drawCurve(groove, 'rgba(74,48,39,.46)', Math.max(.55, r * .012));
        ctx.lineCap = 'round';
        for (const stitch of stitches) {
          if (transform(stitch.center)[2] < .025) continue;
          for (const segment of stitch.segments) {
            const a = transform(segment[0]), b = transform(segment[1]);
            if (a[2] < 0 || b[2] < 0) continue;
            if (r >= 24) {
              ctx.beginPath(); ctx.moveTo(x + a[0] * r, y - a[1] * r); ctx.lineTo(x + b[0] * r, y - b[1] * r);
              ctx.strokeStyle = 'rgba(83,17,27,.42)'; ctx.lineWidth = Math.max(.85, r * .019); ctx.stroke();
            }
            ctx.beginPath(); ctx.moveTo(x + a[0] * r, y - a[1] * r - r * .003); ctx.lineTo(x + b[0] * r, y - b[1] * r - r * .003);
            ctx.strokeStyle = '#c52334'; ctx.lineWidth = Math.max(.6, r * .011); ctx.stroke();
          }
        }
      } else {
        // A red seam is the subpixel aggregate of the full 108 thread pairs.
        drawCurve(groove, 'rgba(175,37,51,.82)', Math.max(.55, r * .075));
      }
    }
    ctx.restore();
    if (options.outline !== false) { ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.strokeStyle = color; ctx.lineWidth = clamp(r * .035, .8, 1.7); ctx.stroke(); }
    ctx.restore();
    return state;
  }
  drawSpinningBaseball.spinState = spinState;
  drawSpinningBaseball.modelInfo = Object.freeze({ seamPeriod: Math.PI * 4, stitchPairs: 108, leatherGrainPoints: 190, displayPose: [-.34, .18], fourSeamTypes: ['Fastball', 'Sinker'], fourSeamPhase: Math.PI / 4, sourceCommit: '16db37a544ca23a77655a002da2c60d9dcf09741' });
  root.drawLegacySpinningBaseball = drawSpinningBaseball;
})(typeof window !== 'undefined' ? window : globalThis);

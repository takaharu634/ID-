/* Measured RPM/axis and the same per-pitch gyro estimates as the spin profile.
 * Gyro sign and initial seam orientation are unmeasured display assumptions.
 * Seam pose is keyed to PitchUID, never pitch type. Filtering integrates only
 * seam orientation at a fixed center; production defaults to no temporal filter.
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
  const curves = new Map([160].map(resolution => [resolution,
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
    const gyroEstimated=finiteInput(pitch.gyroAngle)&&Number(pitch.gyroAngle)>=0&&Number(pitch.gyroAngle)<=90;
    const gyro=(gyroEstimated?Number(pitch.gyroAngle):0)*Math.PI/180;
    const axis = [-Math.cos(tilt)*Math.cos(gyro), Math.sin(tilt)*Math.cos(gyro), Math.sin(gyro)];
    const time = finiteInput(elapsed) ? Math.max(0, Number(elapsed)) : 0;
    const turns = available ? rpm * time / 60 : 0;
    const seamPlacement='id-pose';
    return { available, rpm, spinAxis, axisSource, axis, angularVelocity: available ? scale(axis, -rpm * TAU / 60) : [0, 0, 0], angle: -(turns % 1) * TAU, turns, time, gyroAngle:gyroEstimated?Number(pitch.gyroAngle):null,gyroEstimated,gyroAssumed:gyroEstimated?null:0,gyroSignAssumed:true,estimateMethod:pitch.estimateMethod||null,seamPlacement,initialSeam:'pitch-id-illustrative' };
  }

  function drawSpinningBaseball(ctx, options) {
    const { x, y, radius, pitch, elapsed, color = '#64748b' } = options || {};
    if (!ctx || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(radius) || radius <= 0) return null;
    const r = radius, state = spinState(pitch, elapsed);
    const camera = options.camera || {};
    const right = camera.right || [1, 0, 0], up = camera.up || [0, 1, 0], forward = camera.forward || [0, 0, -1];
    const seed=String(pitch?.id||'unmeasured')+':'+String(options.seamVariant||0);
    let hash=2166136261;for(const ch of seed){hash=Math.imul(hash^ch.charCodeAt(0),16777619)>>>0;}
    const pose=point=>rotate(rotate(point,[0,1,0],(hash%65536)/65536*TAU),[1,0,0],((hash>>>16)/65536-.5)*Math.PI);
    const transformAt=time=>{
      const spin=spinState(pitch,time),columns=[[1,0,0],[0,1,0],[0,0,1]].map(e=>{
       const w=rotate(pose(e),state.axis,spin.angle);return [dot(w,right),dot(w,up),-dot(w,forward)];
      });
      return p=>[0,1,2].map(i=>columns[0][i]*p[0]+columns[1][i]*p[1]+columns[2][i]*p[2]);
    };
    const transform=transformAt(state.time);
    const smooth=(a,b,v)=>{const t=clamp((v-a)/(b-a),0,1);return t*t*(3-2*t);};
    ctx.save();
    const leather = ctx.createRadialGradient(x - r * .33, y - r * .39, r * .05, x + r * .08, y + r * .1, r * 1.1);
    [[0, '#fffefa'], [.43, '#f7f3e9'], [.76, '#ddd7ca'], [.94, '#b8b2a8'], [1, '#8f8d89']].forEach(([p, c]) => leather.addColorStop(p, c));
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fillStyle = leather; ctx.fill();
    ctx.save(); ctx.beginPath(); ctx.arc(x, y, Math.max(.1, r - .15), 0, TAU); ctx.clip();
    if (r > 12) {
      ctx.globalAlpha*=smooth(12,24,r);
      const grainScale = clamp(r / 115, .22, 1.65);
      for (const g of grain) {
        const p = transform(g.point); if (p[2] < .04) continue;
        const depth = Math.min(1, (p[2] - .04) / .96);
        ctx.beginPath(); ctx.arc(x + p[0] * r, y - p[1] * r, g.size * (.55 + depth * .45) * grainScale, 0, TAU);
        ctx.fillStyle = g.tone === 0 ? `rgba(102,86,67,${.055 * depth})` : `rgba(255,255,255,${.11 * depth})`; ctx.fill();
      }
    }
    ctx.restore();ctx.save();ctx.beginPath();ctx.arc(x,y,r,0,TAU);ctx.clip();
    const seamWeight=smooth(.7,4,r),detailWeight=smooth(8,18,r);
    const exposure=finiteInput(options.seamExposure)?clamp(Number(options.seamExposure),0,1/60):0;
    const filtered=exposure>0&&r<=2048&&typeof document!=='undefined';
    const samples=filtered?9:1,side=Math.ceil(r*2+4),baseContext=ctx,density=Number.isFinite(options.pixelRatio)&&options.pixelRatio>0?options.pixelRatio:1;
    const seamLayer=filtered?document.createElement('canvas'):null,averageLayer=filtered?document.createElement('canvas'):null;
    if(filtered){seamLayer.width=averageLayer.width=Math.ceil(side*density);seamLayer.height=averageLayer.height=Math.ceil(side*density);}
    for(let sample=0;sample<samples;sample++){
      const sampleTime=filtered?Math.max(0,state.time-exposure*(sample+.5)/samples):state.time;
      const transform=transformAt(sampleTime);
      if(filtered){ctx=seamLayer.getContext('2d');ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,seamLayer.width,seamLayer.height);ctx.setTransform(density,0,0,density,(side/2-x)*density,(side/2-y)*density);ctx.globalAlpha=1;}
      ctx.save();ctx.globalAlpha*=seamWeight;
    if (seamWeight>0) {
      const resolution=160;
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
      drawCurve(curves.get(resolution)[1],`rgba(175,37,51,${.82*(1-detailWeight)})`,r*.028);
      ctx.globalAlpha*=detailWeight;
      if(detailWeight>0){
        drawCurve(edge1, 'rgba(113,92,75,.38)', r*.007);
        drawCurve(edge2, 'rgba(113,92,75,.38)', r*.007);
        drawCurve(groove, 'rgba(74,48,39,.46)', r*.012);
        ctx.lineCap = 'round';
        for (const stitch of stitches) {
          if (transform(stitch.center)[2] < .025) continue;
          for (const segment of stitch.segments) {
            const a = transform(segment[0]), b = transform(segment[1]);
            if (a[2] < 0 || b[2] < 0) continue;
            if (r>18) {
              ctx.save();ctx.globalAlpha*=smooth(18,30,r);
              ctx.beginPath(); ctx.moveTo(x + a[0] * r, y - a[1] * r); ctx.lineTo(x + b[0] * r, y - b[1] * r);
              ctx.strokeStyle = 'rgba(83,17,27,.42)'; ctx.lineWidth=r*.019;ctx.stroke();ctx.restore();
            }
            ctx.beginPath(); ctx.moveTo(x + a[0] * r, y - a[1] * r - r * .003); ctx.lineTo(x + b[0] * r, y - b[1] * r - r * .003);
            ctx.strokeStyle = '#c52334'; ctx.lineWidth = r*.011; ctx.stroke();
          }
        }
      }
    }
    ctx.restore();
    if(filtered){const acc=averageLayer.getContext('2d');acc.globalCompositeOperation='lighter';acc.globalAlpha=1/samples;acc.drawImage(seamLayer,0,0);ctx=baseContext;}
    }
    if(filtered)ctx.drawImage(averageLayer,0,0,averageLayer.width,averageLayer.height,x-side/2,y-side/2,side,side);
    ctx.restore();
    if (options.outline !== false) { ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.strokeStyle = color; ctx.lineWidth = clamp(r * .035, .8, 1.7); ctx.stroke(); }
    ctx.restore();
    return {...state,seamExposureApplied:filtered?exposure:0};
  }
  drawSpinningBaseball.spinState = spinState;
  drawSpinningBaseball.modelInfo = Object.freeze({ seamPeriod: Math.PI * 4, stitchPairs: 108, leatherGrainPoints: 190, initialPose:'pitch-id-illustrative',gyroSource:'shared-spin-profile-estimate', sourceCommit: '16db37a544ca23a77655a002da2c60d9dcf09741' });
  root.drawSpinningBaseball = drawSpinningBaseball;
})(typeof window !== 'undefined' ? window : globalThis);

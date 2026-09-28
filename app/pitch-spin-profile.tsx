"use client";
/* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import { catcherX } from "../lib/catcher-view";
import { pitchProjection } from "../lib/chart-geometry";
import { loadStaticDataset } from "../lib/dataset-loader";
import { useSeasonCatalog } from "../lib/season-catalog";

export type PitchMeasurement = {
  pitchId?: string;
  estimateMethod?: string;
  pitcherId: string;
  pitchType: string;
  normalizedPitchType?: string;
  rawPitchType?: string;
  date: string;
  pitchNo: number | null;
  velocity: number;
  spinRate: number;
  spinAxis: number;
  measuredTilt: string;
  ivb: number;
  hb: number;
  gyroAngle: number | null;
  spinEfficiency: number | null;
  activeSpin: number | null;
  estimateClamped: boolean;
  plateLocHeight: number | null;
  plateLocSide: number | null;
};

type SavantPitch = Record<string, unknown>;
type SeasonId = import('../lib/dataset-types').SeasonKey;

type PitchSpinProfileProps = {
  season: SeasonId;
  playerId: string;
  playerName: string;
  pitches: SavantPitch[];
  filtersActive: boolean;
  initialPitchType?: string;
};

type PitchProfile = {
  id: string;
  label: string;
  short: string;
  color: string;
  count: number;
  estimateCount: number;
  velocity: number;
  spinRate: number;
  spinAxis: number;
  measuredTilt: string;
  ivb: number;
  hb: number;
  gyroAngle: number;
  spinEfficiency: number;
  activeSpin: number;
  confidence: "中" | "参考" | "低";
  clampedShare: number;
  rotationDirection: 1 | -1;
  seamPlacement: "four-seam" | "display";
};

type Point3D = { x: number; y: number; z: number };

const pitchDefinitions = [
  { id: "fastball", label: "ストレート", short: "FB", color: "#e73d4f", seamPlacement: "four-seam" },
  { id: "sinker", label: "シンカー", short: "SI", color: "#f28b38", seamPlacement: "four-seam" },
  { id: "cutter", label: "カットボール", short: "CT", color: "#735fe0", seamPlacement: "display" },
  { id: "slider", label: "スライダー", short: "SL", color: "#4ba6ee", seamPlacement: "display" },
  { id: "curveball", label: "カーブ", short: "CB", color: "#22a37a", seamPlacement: "display" },
  { id: "changeup", label: "チェンジアップ", short: "CH", color: "#e39a13", seamPlacement: "display" },
  { id: "splitter", label: "フォーク", short: "FO", color: "#ba5878", seamPlacement: "display" },
  { id: "other", label: "その他", short: "OT", color: "#607d8b", seamPlacement: "display" },
  { id: "knuckleball", label: "ナックル", short: "KN", color: "#596577", seamPlacement: "display" },
] as const;

function mean(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function median(values: number[]) {
  const sorted = [...values].filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function circularMean(values: number[]) {
  const radians = values.filter(Number.isFinite).map((value) => value * Math.PI / 180);
  const angle = Math.atan2(mean(radians.map(Math.sin)), mean(radians.map(Math.cos))) * 180 / Math.PI;
  return (angle + 360) % 360;
}

function modalTilt(values: string[]) {
  const counts = new Map<string, number>();
  values.filter((value) => value && value !== "—").forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1));
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "—";
}

export function buildPitchProfiles(pitches: PitchMeasurement[]): PitchProfile[] {
  return pitchDefinitions.flatMap((definition) => {
    const rows = pitches.filter((pitch) => pitch.pitchType === definition.id);
    if (!rows.length) return [];
    const estimates = rows.filter((pitch) => Number.isFinite(pitch.gyroAngle) && Number.isFinite(pitch.spinEfficiency) && Number.isFinite(pitch.activeSpin));
    return [{
      ...definition,
      count: rows.length,
      estimateCount: estimates.length,
      velocity: mean(rows.map((pitch) => pitch.velocity)),
      spinRate: mean(rows.map((pitch) => pitch.spinRate)),
      spinAxis: circularMean(rows.map((pitch) => pitch.spinAxis)),
      measuredTilt: modalTilt(rows.map((pitch) => pitch.measuredTilt)),
      ivb: mean(rows.map((pitch) => pitch.ivb)),
      hb: mean(rows.map((pitch) => pitch.hb)),
      gyroAngle: median(estimates.map((pitch) => pitch.gyroAngle as number)),
      spinEfficiency: median(estimates.map((pitch) => pitch.spinEfficiency as number)),
      activeSpin: median(estimates.map((pitch) => pitch.activeSpin as number)),
      confidence: rows.length >= 20 ? "中" : rows.length >= 5 ? "参考" : "低",
      clampedShare: rows.filter((pitch) => pitch.estimateClamped).length / rows.length,
      rotationDirection: -1,
    } satisfies PitchProfile];
  });
}

const speedOptions = [
  { value: 0.01, label: "0.01×" },
  { value: 0.025, label: "0.025×" },
  { value: 0.05, label: "0.05×" },
];

function clockFromAxis(axis: number) {
  const clockMinutes = (((axis - 180 + 360) % 360) / 360) * 720;
  const rounded = Math.round(clockMinutes);
  const hour = Math.floor(rounded / 60) % 12 || 12;
  const minute = rounded % 60;
  return `${hour}:${String(minute).padStart(2, "0")}`;
}

function signed(value: number) {
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}`;
}

function rotateAroundAxis(point: Point3D, axis: Point3D, angle: number): Point3D {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dot = point.x * axis.x + point.y * axis.y + point.z * axis.z;
  return {
    x: point.x * cos + (axis.y * point.z - axis.z * point.y) * sin + axis.x * dot * (1 - cos),
    y: point.y * cos + (axis.z * point.x - axis.x * point.z) * sin + axis.y * dot * (1 - cos),
    z: point.z * cos + (axis.x * point.y - axis.y * point.x) * sin + axis.z * dot * (1 - cos),
  };
}

function add3(a: Point3D, b: Point3D): Point3D {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function scale3(point: Point3D, amount: number): Point3D {
  return { x: point.x * amount, y: point.y * amount, z: point.z * amount };
}

function normalize3(point: Point3D): Point3D {
  const length = Math.hypot(point.x, point.y, point.z) || 1;
  return scale3(point, 1 / length);
}

function cross3(a: Point3D, b: Point3D): Point3D {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}

function seamPoint(t: number): Point3D {
  // Paul Bourke's spherical baseball seam curve. One closed 4π path
  // reproduces the boundary between the two hourglass-shaped leather panels.
  const a = 0.4;
  const polar = Math.PI / 2 - (Math.PI / 2 - a) * Math.cos(t);
  const azimuth = t / 2 + a * Math.sin(2 * t);
  return {
    x: Math.sin(polar) * Math.cos(azimuth),
    y: Math.sin(polar) * Math.sin(azimuth),
    z: Math.cos(polar),
  };
}

function seamFrame(t: number) {
  const point = seamPoint(t);
  const before = seamPoint(t - 0.002);
  const after = seamPoint(t + 0.002);
  const tangent = normalize3({ x: after.x - before.x, y: after.y - before.y, z: after.z - before.z });
  const normal = normalize3(cross3(point, tangent));
  return { point, tangent, normal };
}

function alignAxis(point: Point3D, from: Point3D, to: Point3D): Point3D {
  const source = normalize3(from);
  const target = normalize3(to);
  const rotationAxis = cross3(source, target);
  const sine = Math.hypot(rotationAxis.x, rotationAxis.y, rotationAxis.z);
  const cosine = source.x * target.x + source.y * target.y + source.z * target.z;
  if (sine < 1e-7) {
    if (cosine > 0) return point;
    const fallback = Math.abs(source.x) < 0.9 ? normalize3(cross3(source, { x: 1, y: 0, z: 0 })) : normalize3(cross3(source, { x: 0, y: 1, z: 0 }));
    return rotateAroundAxis(point, fallback, Math.PI);
  }
  return rotateAroundAxis(point, scale3(rotationAxis, 1 / sine), Math.atan2(sine, cosine));
}

function orientBaseball(point: Point3D, axis: Point3D, placement: PitchProfile["seamPlacement"]): Point3D {
  if (placement === "four-seam") {
    // The Bourke seam crosses the local z-axis equator four times at exact 90°
    // intervals. Aligning that local axis with the measured 3D spin axis creates
    // the conventional four-seam rotation while retaining the inferred gyro tilt.
    const phased = rotateAroundAxis(point, { x: 0, y: 0, z: 1 }, Math.PI / 4);
    return alignAxis(phased, { x: 0, y: 0, z: 1 }, axis);
  }
  const yawed = rotateAroundAxis(point, { x: 0, y: 1, z: 0 }, -0.34);
  return rotateAroundAxis(yawed, { x: 1, y: 0, z: 0 }, 0.18);
}

function buildStitchFrames() {
  const resolution = 2160;
  const samples: Array<{ t: number; distance: number }> = [{ t: 0, distance: 0 }];
  let distance = 0;
  let previous = seamPoint(0);
  for (let index = 1; index <= resolution; index += 1) {
    const t = index / resolution * Math.PI * 4;
    const point = seamPoint(t);
    distance += Math.hypot(point.x - previous.x, point.y - previous.y, point.z - previous.z);
    samples.push({ t, distance });
    previous = point;
  }
  return Array.from({ length: 108 }, (_, stitchIndex) => {
    const target = (stitchIndex + 0.5) / 108 * distance;
    let low = 0;
    let high = samples.length - 1;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (samples[middle].distance < target) low = middle + 1; else high = middle;
    }
    return seamFrame(samples[low].t);
  });
}

const baseballStitches = buildStitchFrames();
const leatherGrain = Array.from({ length: 190 }, (_, index) => {
  const z = 1 - 2 * (index + 0.5) / 190;
  const radius = Math.sqrt(Math.max(0, 1 - z * z));
  const angle = index * Math.PI * (3 - Math.sqrt(5));
  return {
    point: { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius, z },
    size: 0.55 + ((index * 37) % 11) / 16,
    tone: (index * 53) % 4,
  };
});

function SpinScene({ profile, speed, paused }: { profile: PitchProfile; speed: number; paused: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rotationRef = useRef(0);

  useEffect(() => {
    if (canvasRef.current) return startSpinAnimation(canvasRef.current, profile, speed, paused, rotationRef);
  }, [profile, speed, paused]);

  return <canvas ref={canvasRef} className="spin-canvas" role="img" data-view="pitcher" data-rotation-direction={profile.rotationDirection < 0 ? "clockwise" : "counterclockwise"} data-seam-placement={profile.seamPlacement} aria-label={`${profile.label}の投手後方視点・推定3D回転アニメーション`} />;
}

export function startSpinAnimation(canvas: HTMLCanvasElement, profile: PitchProfile, speed: number, paused: boolean, rotationRef: { current: number }) {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let frame = 0;
    let last = performance.now();
    const tilt = ((profile.spinAxis - 180 + 360) % 360) * Math.PI / 180;
    const gyro = profile.gyroAngle * Math.PI / 180;
    const transverseSpin = Math.cos(gyro);
    const axis: Point3D = {
      x: -Math.cos(tilt) * transverseSpin,
      y: Math.sin(tilt) * transverseSpin,
      z: Math.sin(gyro),
    };

    const drawArrow = (x: number, y: number, angle: number, size: number) => {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle);
      ctx.beginPath();
      ctx.moveTo(size, 0);
      ctx.lineTo(-size * 0.55, -size * 0.58);
      ctx.lineTo(-size * 0.35, 0);
      ctx.lineTo(-size * 0.55, size * 0.58);
      ctx.closePath();
      ctx.fillStyle = profile.color;
      ctx.strokeStyle = "rgba(255,255,255,.96)";
      ctx.lineWidth = Math.max(2, size * 0.28);
      ctx.stroke();
      ctx.fill();
      ctx.restore();
    };

    const render = (now: number) => {
      frame = requestAnimationFrame(render);
      const elapsed = Math.max(0, Math.min((now - last) / 1000, 0.04));
      last = now;
      if (!paused) rotationRef.current += profile.rotationDirection * profile.spinRate * Math.PI * 2 / 60 * speed * elapsed;

      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.max(rect.width, 1);
      const height = Math.max(rect.height, 1);
      if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      const cx = width * 0.53;
      const cy = height * 0.47;
      const radius = Math.min(width, height) * 0.265;
      const transformSurface = (point: Point3D) => rotateAroundAxis(orientBaseball(point, axis, profile.seamPlacement), axis, rotationRef.current);

      ctx.save();
      ctx.filter = "blur(15px)";
      ctx.fillStyle = "rgba(13,36,74,.16)";
      ctx.beginPath();
      ctx.ellipse(cx + radius * 0.13, cy + radius * 1.18, radius * 0.88, radius * 0.18, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      const ballGradient = ctx.createRadialGradient(cx - radius * 0.33, cy - radius * 0.39, radius * 0.05, cx + radius * 0.08, cy + radius * 0.1, radius * 1.1);
      ballGradient.addColorStop(0, "#fffefa");
      ballGradient.addColorStop(0.43, "#f7f3e9");
      ballGradient.addColorStop(0.76, "#ddd7ca");
      ballGradient.addColorStop(0.94, "#b8b2a8");
      ballGradient.addColorStop(1, "#8f8d89");
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fillStyle = ballGradient;
      ctx.shadowColor = "rgba(28,43,67,.23)";
      ctx.shadowBlur = 24;
      ctx.shadowOffsetY = 11;
      ctx.fill();
      ctx.shadowColor = "transparent";

      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, radius - 1, 0, Math.PI * 2);
      ctx.clip();

      const gleam = ctx.createRadialGradient(cx - radius * .42, cy - radius * .5, 0, cx - radius * .42, cy - radius * .5, radius * .68);
      gleam.addColorStop(0, "rgba(255,255,255,.72)");
      gleam.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = gleam;
      ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);

      // Subtle pores and grain rotate with the ball, so the surface reads as leather.
      leatherGrain.forEach((grain) => {
        const point = transformSurface(grain.point);
        if (point.z < 0.04) return;
        const depth = Math.min(1, (point.z - 0.04) / 0.96);
        ctx.beginPath();
        ctx.arc(cx + point.x * radius, cy - point.y * radius, grain.size * (0.55 + depth * 0.45), 0, Math.PI * 2);
        ctx.fillStyle = grain.tone === 0 ? `rgba(102,86,67,${0.055 * depth})` : `rgba(255,255,255,${0.11 * depth})`;
        ctx.fill();
      });

      const drawSeamCurve = (offset: number, color: string, lineWidth: number) => {
        let drawing = false;
        ctx.beginPath();
        for (let index = 0; index <= 520; index += 1) {
          const t = index / 520 * Math.PI * 4;
          const frameAtPoint = seamFrame(t);
          const surfacePoint = normalize3(add3(frameAtPoint.point, scale3(frameAtPoint.normal, offset)));
          const point = transformSurface(surfacePoint);
          const x = cx + point.x * radius;
          const y = cy - point.y * radius;
          const visible = point.z > -0.015;
          if (visible && !drawing) { ctx.moveTo(x, y); drawing = true; }
          else if (visible) ctx.lineTo(x, y);
          else drawing = false;
        }
        ctx.strokeStyle = color;
        ctx.lineWidth = lineWidth;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.stroke();
      };

      // Two leather cut edges, a recessed groove, then the modeled red thread.
      drawSeamCurve(-0.018, "rgba(113,92,75,.38)", Math.max(0.8, radius * 0.007));
      drawSeamCurve(0.018, "rgba(113,92,75,.38)", Math.max(0.8, radius * 0.007));
      drawSeamCurve(0, "rgba(74,48,39,.46)", Math.max(1.2, radius * 0.012));

      baseballStitches.forEach(({ point, tangent, normal }) => {
        const center = transformSurface(point);
        if (center.z < 0.025) return;
        const stitchWidth = 0.056;
        const stitchLength = 0.026;
        const makePoint = (normalAmount: number, tangentAmount: number) => normalize3(add3(add3(point, scale3(normal, normalAmount)), scale3(tangent, tangentAmount)));
        const segments = [
          [makePoint(stitchWidth, -stitchLength), makePoint(stitchWidth * 0.12, stitchLength)],
          [makePoint(-stitchWidth, stitchLength), makePoint(-stitchWidth * 0.12, -stitchLength)],
        ];
        segments.forEach(([startPoint, endPoint]) => {
          const start = transformSurface(startPoint);
          const end = transformSurface(endPoint);
          if (start.z < 0 || end.z < 0) return;
          ctx.beginPath();
          ctx.moveTo(cx + start.x * radius, cy - start.y * radius);
          ctx.lineTo(cx + end.x * radius, cy - end.y * radius);
          ctx.strokeStyle = "rgba(83,17,27,.42)";
          ctx.lineWidth = Math.max(2.8, radius * 0.019);
          ctx.lineCap = "round";
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(cx + start.x * radius, cy - start.y * radius - radius * 0.003);
          ctx.lineTo(cx + end.x * radius, cy - end.y * radius - radius * 0.003);
          ctx.strokeStyle = "#c52334";
          ctx.lineWidth = Math.max(1.55, radius * 0.011);
          ctx.stroke();
        });
      });
      ctx.restore();

      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(61,67,76,.22)";
      ctx.lineWidth = 1;
      ctx.stroke();

      const axisScreen = { x: axis.x, y: -axis.y };
      const frontAxisX = cx + axisScreen.x * radius;
      const frontAxisY = cy + axisScreen.y * radius;
      const backAxisX = cx - axisScreen.x * radius;
      const backAxisY = cy - axisScreen.y * radius;

      const transverseLength = Math.hypot(axis.x, axis.y);
      const ringU: Point3D = transverseLength > 0.001
        ? { x: -axis.y / transverseLength, y: axis.x / transverseLength, z: 0 }
        : { x: 1, y: 0, z: 0 };
      const ringV: Point3D = {
        x: axis.y * ringU.z - axis.z * ringU.y,
        y: axis.z * ringU.x - axis.x * ringU.z,
        z: axis.x * ringU.y - axis.y * ringU.x,
      };
      const ringRadius = radius * 1.22;
      ctx.beginPath();
      for (let i = 0; i <= 120; i += 1) {
        const phi = i / 120 * Math.PI * 2;
        const x = cx + (ringU.x * Math.cos(phi) + ringV.x * Math.sin(phi)) * ringRadius;
        const y = cy - (ringU.y * Math.cos(phi) + ringV.y * Math.sin(phi)) * ringRadius;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = "rgba(255,255,255,.93)";
      ctx.globalAlpha = 1;
      ctx.lineWidth = Math.max(8, radius * 0.063);
      ctx.stroke();
      ctx.beginPath();
      for (let i = 0; i <= 120; i += 1) {
        const phi = i / 120 * Math.PI * 2;
        const x = cx + (ringU.x * Math.cos(phi) + ringV.x * Math.sin(phi)) * ringRadius;
        const y = cy - (ringU.y * Math.cos(phi) + ringV.y * Math.sin(phi)) * ringRadius;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = profile.color;
      ctx.globalAlpha = 0.94;
      ctx.lineWidth = Math.max(4, radius * 0.034);
      ctx.stroke();
      [0.28, 1.32, 2.36, 3.42, 4.48, 5.52].forEach((phi) => {
        const x = cx + (ringU.x * Math.cos(phi) + ringV.x * Math.sin(phi)) * ringRadius;
        const y = cy - (ringU.y * Math.cos(phi) + ringV.y * Math.sin(phi)) * ringRadius;
        const tangentX = (-ringU.x * Math.sin(phi) + ringV.x * Math.cos(phi)) * profile.rotationDirection;
        const tangentY = (ringU.y * Math.sin(phi) - ringV.y * Math.cos(phi)) * profile.rotationDirection;
        drawArrow(x, y, Math.atan2(tangentY, tangentX), Math.max(8, radius * 0.075));
      });

      // Rapsodo/TrackMan-inspired high-contrast axis rod. The filled endpoint is
      // the pitcher-facing end; the dashed endpoint is behind the ball.
      const rodScale = 1.48;
      const rodStartX = cx - axisScreen.x * radius * rodScale;
      const rodStartY = cy - axisScreen.y * radius * rodScale;
      const rodEndX = cx + axisScreen.x * radius * rodScale;
      const rodEndY = cy + axisScreen.y * radius * rodScale;
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.moveTo(rodStartX, rodStartY);
      ctx.lineTo(rodEndX, rodEndY);
      ctx.strokeStyle = "rgba(255,255,255,.97)";
      ctx.lineWidth = Math.max(11, radius * 0.08);
      ctx.lineCap = "round";
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(rodStartX, rodStartY);
      ctx.lineTo(rodEndX, rodEndY);
      ctx.strokeStyle = "#0b1f42";
      ctx.lineWidth = Math.max(4.5, radius * 0.033);
      ctx.stroke();

      ctx.save();
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.arc(backAxisX, backAxisY, Math.max(7, radius * (0.046 - axis.z * 0.01)), 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255,255,255,.9)";
      ctx.fill();
      ctx.strokeStyle = "#0b1f42";
      ctx.lineWidth = Math.max(2, radius * 0.014);
      ctx.stroke();
      ctx.restore();

      ctx.beginPath();
      ctx.arc(frontAxisX, frontAxisY, Math.max(9, radius * (0.055 + axis.z * 0.026)), 0, Math.PI * 2);
      ctx.fillStyle = profile.color;
      ctx.shadowColor = "rgba(11,31,66,.28)";
      ctx.shadowBlur = 9;
      ctx.fill();
      ctx.shadowColor = "transparent";
      ctx.strokeStyle = "rgba(255,255,255,.98)";
      ctx.lineWidth = Math.max(3, radius * 0.021);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(frontAxisX, frontAxisY, Math.max(2.4, radius * 0.016), 0, Math.PI * 2);
      ctx.fillStyle = "#0b1f42";
      ctx.fill();
    };

    frame = requestAnimationFrame(render);
    return () => cancelAnimationFrame(frame);
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function PitchLocationChart({ pitch, color }: { pitch: PitchMeasurement; color: string }) {
  const hasLocation = Number.isFinite(pitch.plateLocHeight) && Number.isFinite(pitch.plateLocSide);
  const extent = Math.max(.55, hasLocation ? Math.abs(pitch.plateLocSide!) + .05 : 0);
  const projection = pitchProjection(130, 130, {left:-extent,right:extent,bottom:Math.min(.15,hasLocation ? pitch.plateLocHeight!-.05 : .15),top:Math.max(1.35,hasLocation ? pitch.plateLocHeight!+.05 : 1.35)},8);
  const x = projection.x(hasLocation ? catcherX(pitch.plateLocSide!) : 0);
  const y = projection.y(hasLocation ? pitch.plateLocHeight! : .75);
  const zoneLeft=projection.x(-.254),zoneRight=projection.x(.254),zoneTop=projection.y(1.05),zoneBottom=projection.y(.45);
  const inZone = hasLocation && Math.abs(pitch.plateLocSide!) <= 0.254 && pitch.plateLocHeight! >= 0.45 && pitch.plateLocHeight! <= 1.05;
  return (
    <section className="mini-chart" aria-label="捕手側から見た9分割ストライクゾーンの投球位置">
      <div><strong>PITCH LOCATION</strong><span>{hasLocation ? (inZone ? "ZONE" : "OUT") : "NO DATA"}</span></div>
      <svg viewBox="0 0 130 130" role="img" aria-label={hasLocation ? `プレート横位置${pitch.plateLocSide!.toFixed(2)}メートル、高さ${pitch.plateLocHeight!.toFixed(2)}メートル` : "投球位置データなし"}>
        <rect x={zoneLeft} y={zoneTop} width={zoneRight-zoneLeft} height={zoneBottom-zoneTop} className="chart-zone" />
        {[1,2].map(i=><g key={i} className="chart-grid"><line x1={zoneLeft+(zoneRight-zoneLeft)*i/3} x2={zoneLeft+(zoneRight-zoneLeft)*i/3} y1={zoneTop} y2={zoneBottom}/><line x1={zoneLeft} x2={zoneRight} y1={zoneTop+(zoneBottom-zoneTop)*i/3} y2={zoneTop+(zoneBottom-zoneTop)*i/3}/></g>)}
        <path d={`M${projection.x(0)} 6V124M8 ${projection.y(.75)}H122`} className="chart-crosshair" />
        {hasLocation ? <><circle cx={x} cy={y} r="8" fill="white" opacity=".95" /><circle cx={x} cy={y} r="5.2" fill={color} /></> : <text x="65" y="70" textAnchor="middle">位置データなし</text>}
      </svg>
      <p>{hasLocation ? `捕手視点｜Side ${signed(pitch.plateLocSide! * 100)} / Height ${(pitch.plateLocHeight! * 100).toFixed(1)} cm` : "捕手視点｜PlateLoc未記録"}</p>
    </section>
  );
}

function MovementCrossChart({ pitch, color, average = false }: { pitch: Pick<PitchMeasurement, "ivb" | "hb">; color: string; average?: boolean }) {
  const range = 70;
  const x = 65 + clamp(pitch.hb, -range, range) / range * 49;
  const y = 65 - clamp(pitch.ivb, -range, range) / range * 49;
  return (
    <section className="mini-chart" aria-label={average ? "球種平均の縦横変化量" : "投球別の縦横変化量"}>
      <div><strong>{average ? "AVERAGE MOVEMENT" : "MOVEMENT"}</strong><span>±70 cm</span></div>
      <svg viewBox="0 0 130 130" role="img" aria-label={`投手後方視点、IVB ${signed(pitch.ivb)}センチ、HB ${signed(pitch.hb)}センチ`}>
        <rect x="10" y="10" width="110" height="110" rx="7" className="chart-frame" />
        <path d="M65 10V120M10 65H120" className="chart-crosshair strong" />
        <text x="65" y="8" textAnchor="middle">+IVB</text><text x="65" y="129" textAnchor="middle">−IVB</text>
        <text x="121" y="61" textAnchor="end">+HB 投手右</text><text x="11" y="61">投手左 −HB</text>
        <circle cx={x} cy={y} r="8" fill="white" opacity=".95" /><circle cx={x} cy={y} r="5.2" fill={color} />
      </svg>
      <p>IVB {signed(pitch.ivb)} / HB {signed(pitch.hb)} cm</p>
    </section>
  );
}

const japanesePitchIds: Record<string, string> = {
  "ストレート": "fastball",
  "シンカー": "sinker",
  "カットボール": "cutter",
  "カット": "cutter",
  "スライダー": "slider",
  "カーブ": "curveball",
  "チェンジアップ": "changeup",
  "フォーク": "splitter",
  "スプリット": "splitter",
  "ナックル": "knuckleball",
};

function metricToken(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(1) : "—";
}

function savantMatchKey(pitch: SavantPitch) {
  return [
    pitch.date,
    japanesePitchIds[String(pitch.pitchType)] ?? pitch.pitchType,
    metricToken(pitch.velocity),
    metricToken(pitch.spin),
    metricToken(pitch.spinAxis),
    metricToken(pitch.ivb),
    metricToken(pitch.hb),
  ].join("|");
}

function spinMatchKey(pitch: PitchMeasurement) {
  return [
    pitch.date,
    pitch.pitchType,
    metricToken(pitch.velocity),
    metricToken(pitch.spinRate),
    metricToken(pitch.spinAxis),
    metricToken(pitch.ivb),
    metricToken(pitch.hb),
  ].join("|");
}

export default function PitchSpinProfile({ season, playerId, playerName, pitches: filteredPitches, filtersActive, initialPitchType }: PitchSpinProfileProps) {
  const { revision } = useSeasonCatalog();
  const [seasonPitches, setSeasonPitches] = useState<PitchMeasurement[]>([]);
  const [dataState, setDataState] = useState<"loading" | "ready" | "error">("loading");
  const [selectedId, setSelectedId] = useState(japanesePitchIds[initialPitchType ?? ""] ?? "fastball");
  const [speed, setSpeed] = useState(0.025);
  const [paused, setPaused] = useState(false);
  const [mode, setMode] = useState<"average" | "pitch">("average");
  const [pitchIndex, setPitchIndex] = useState(0);

  useEffect(() => {
    const next = japanesePitchIds[initialPitchType ?? ""];
    if (next) {
      setSelectedId(next);
      setPitchIndex(0);
    }
  }, [initialPitchType]);

  useEffect(() => {
    let active = true;
    setDataState("loading");
    loadStaticDataset<PitchMeasurement[]>(`/data/spin-${season}.json`)
      .then((rows) => {
        if (!active) return;
        setSeasonPitches(rows.filter((pitch) => pitch.pitcherId === `${season}:${playerId}`));
        setDataState("ready");
      })
      .catch(() => { if (active) setDataState("error"); });
    return () => { active = false; };
  }, [season, playerId, revision]);

  const playerPitches = useMemo(() => {
    if (!filtersActive) return seasonPitches;
    if (!filteredPitches.length) return [];
    const ids = new Set(filteredPitches.map((row) => row.id));
    if (seasonPitches.every((row) => row.pitchId)) return seasonPitches.filter((row) => ids.has(row.pitchId));
    const remaining = new Map<string, number>();
    filteredPitches.forEach((pitch) => {
      const key = savantMatchKey(pitch);
      remaining.set(key, (remaining.get(key) ?? 0) + 1);
    });
    return seasonPitches.filter((pitch) => {
      const key = spinMatchKey(pitch);
      const count = remaining.get(key) ?? 0;
      if (!count) return false;
      remaining.set(key, count - 1);
      return true;
    });
  }, [filteredPitches, filtersActive, seasonPitches]);

  const pitchProfiles = useMemo(() => buildPitchProfiles(playerPitches), [playerPitches]);
  const profile = pitchProfiles.find((row) => row.id === selectedId) ?? pitchProfiles[0];
  const pitchRows = useMemo(() => profile ? playerPitches.filter((row) => row.pitchType === profile.id) : [], [playerPitches, profile]);
  const pitch = pitchRows[Math.min(pitchIndex, Math.max(pitchRows.length - 1, 0))];
  const displayProfile = profile && mode === "pitch" && pitch
    ? { ...profile, velocity: pitch.velocity, spinRate: pitch.spinRate, spinAxis: pitch.spinAxis, measuredTilt: pitch.measuredTilt, ivb: pitch.ivb, hb: pitch.hb, gyroAngle: pitch.gyroAngle ?? 0, spinEfficiency: pitch.spinEfficiency ?? 0, activeSpin: pitch.activeSpin ?? 0, estimateCount: pitch.gyroAngle === null ? 0 : 1 }
    : profile;

  useEffect(() => {
    if (profile && profile.id !== selectedId) setSelectedId(profile.id);
  }, [profile?.id]);

  if (dataState !== "ready") {
    return <section className="spin-embed"><div className={`data-status-card ${dataState}`} role="status"><span className="status-ball" /><div><strong>{dataState === "error" ? "回転データを読み込めませんでした" : "回転データを読み込み中"}</strong><p>{dataState === "error" ? "ページを再読み込みしてください。" : "実測値と推定3D回転を準備しています。"}</p></div></div></section>;
  }
  if (!profile || !displayProfile) {
    return <section className="spin-embed"><div className="data-status-card"><div><strong>選択シーズンに回転数・回転軸の計測データがありません</strong><p>別のシーズンを選択してください。</p></div></div></section>;
  }

  return (
    <section className="spin-embed" style={{ "--pitch-color": displayProfile.color, "--navy": "#0b1f42" } as CSSProperties}>
      <header className="spin-embed-heading"><div><span>TRACKMAN SPIN LAB</span><h2>{playerName}｜回転アニメーション</h2><p>選択シーズンの回転計測 {playerPitches.length} 球</p></div><b>投手後方視点</b></header>
      <nav className="pitch-tabs" aria-label="回転を表示する球種">
        {pitchProfiles.map((item) => <button key={item.id} type="button" className={item.id === profile.id ? "active" : ""} onClick={() => { setSelectedId(item.id); setPitchIndex(0); }}><span className="pitch-code" style={{ backgroundColor: item.color }}>{item.short}</span><span className="pitch-name">{item.label}</span><span className="pitch-count">n={item.count}</span></button>)}
      </nav>

      <div className="dashboard-grid">
        <article className="visual-card">
          <div className="card-topline">
            <div className="visual-title"><span className="live-dot" /><span>{mode === "average" ? "AVERAGE SPIN VISUAL" : "SINGLE PITCH VISUAL"}</span>{mode === "pitch" && pitch && <div className="inline-pitch-nav"><button type="button" aria-label="前の投球" onClick={() => setPitchIndex((value) => Math.max(0, value - 1))} disabled={pitchIndex === 0}>‹</button><span>{pitchIndex + 1} / {pitchRows.length}</span><input aria-label="投球を選択" type="range" min="0" max={Math.max(pitchRows.length - 1, 0)} value={pitchIndex} onChange={(event) => setPitchIndex(Number(event.target.value))} /><button type="button" aria-label="次の投球" onClick={() => setPitchIndex((value) => Math.min(pitchRows.length - 1, value + 1))} disabled={pitchIndex >= pitchRows.length - 1}>›</button></div>}</div>
            <div className="mode-switch" aria-label="表示単位"><button type="button" className={mode === "average" ? "active" : ""} onClick={() => setMode("average")}>球種平均</button><button type="button" className={mode === "pitch" ? "active" : ""} onClick={() => setMode("pitch")}>1球ずつ</button></div>
          </div>
          <div className="visual-stage">
            <SpinScene profile={displayProfile} speed={speed} paused={paused} />
            <div className="orientation"><span className="orientation-n">12</span><span className="orientation-e">3</span><span className="orientation-s">6</span><span className="orientation-w">9</span><div className="orientation-ring" /></div>
            <div className="axis-guide" aria-label="回転軸端の見方"><strong>3D SPIN AXIS</strong><span><i className="axis-front-marker" />手前側</span><span><i className="axis-back-marker" />奥側</span></div>
            <div className="axis-readout"><small>回転方向（クロック）</small><strong>{clockFromAxis(displayProfile.spinAxis)}</strong><span>Spin Axis {displayProfile.spinAxis.toFixed(1)}° · {displayProfile.estimateCount ? `Gyro ${displayProfile.gyroAngle.toFixed(1)}°（推定）` : "傾き推定不可・平面表示"}</span><em>投手後方視点</em></div>
            <div className={`pitch-data-charts ${mode === "average" ? "average-only" : ""}`}>{mode === "pitch" && pitch ? <><PitchLocationChart pitch={pitch} color={displayProfile.color} /><MovementCrossChart pitch={pitch} color={displayProfile.color} /></> : <MovementCrossChart pitch={displayProfile} color={displayProfile.color} average />}</div>
          </div>
          <div className="playback-bar"><button type="button" className="play-button" onClick={() => setPaused((value) => !value)} aria-label={paused ? "再生" : "一時停止"}>{paused ? "▶" : "Ⅱ"}</button><div className="speed-control"><span>表示速度</span><div>{speedOptions.map((option) => <button key={option.value} type="button" className={speed === option.value ? "active" : ""} onClick={() => setSpeed(option.value)}>{option.label}</button>)}</div></div><p><span className="axis-key" /> 白縁ライン＝推定回転軸 <span className="arrow-key" /> 回転方向</p></div>
        </article>

        <aside className="metrics-panel">
          <div className="primary-metrics"><div className="metric-card"><span>{mode === "average" ? "平均球速" : "球速"}</span><strong>{displayProfile.velocity.toFixed(1)}</strong><small>km/h</small></div><div className="metric-card"><span>{mode === "average" ? "平均回転数" : "回転数"}</span><strong>{Math.round(displayProfile.spinRate).toLocaleString("ja-JP")}</strong><small>rpm</small></div></div>
          <div className="spin3d-card"><div className="section-label"><span>INFERRED 3D SPIN</span><small>{mode === "average" ? "球種中央値" : "投球別推定"}</small></div><div className="spin3d-grid"><div><span>Gyro Angle</span><strong>{displayProfile.estimateCount ? `${displayProfile.gyroAngle.toFixed(1)}°` : "—"}</strong></div><div><span>Spin Efficiency</span><strong>{displayProfile.estimateCount ? `${displayProfile.spinEfficiency.toFixed(1)}%` : "—"}</strong></div><div><span>Active Spin</span><strong>{displayProfile.estimateCount ? Math.round(displayProfile.activeSpin).toLocaleString("ja-JP") : "—"}</strong><small>rpm</small></div></div><p>0° = transverse · 90° = pure gyro</p></div>
          <div className="measured-card"><div className="section-label"><span>TRACKMAN MEASURED</span><small>実測</small></div><div><span>Spin Axis<strong>{displayProfile.spinAxis.toFixed(1)}°</strong></span><span>Measured Tilt<strong>{displayProfile.measuredTilt}</strong></span></div></div>
          <div className="movement-card"><div className="section-label"><span>MOVEMENT</span><small>{mode === "average" ? "平均変化量" : "投球別変化量"}</small></div><div className="movement-grid"><div><span>IVB</span><strong>{signed(displayProfile.ivb)}</strong><small>cm</small></div><div><span>HB</span><strong>{signed(displayProfile.hb)}</strong><small>cm</small></div></div></div>
          <div className="data-card"><div className="section-label"><span>DATA BASIS</span><small>表示根拠</small></div><dl><div><dt>球種分類</dt><dd>分析画面と同じ球種</dd></div>{mode === "average" ? <><div><dt>対象球数</dt><dd>{profile.count} 球</dd></div><div><dt>標本数の目安</dt><dd>{profile.confidence}</dd></div><div><dt>回転軸集計</dt><dd>円周平均</dd></div><div><dt>3D推定対象</dt><dd>{profile.estimateCount}球の中央値</dd></div></> : <><div><dt>元分類</dt><dd>{pitch?.rawPitchType || "—"}</dd></div><div><dt>計測日</dt><dd>{pitch?.date || "—"}</dd></div><div><dt>Pitch No.</dt><dd>{pitch?.pitchNo ?? "—"}</dd></div><div><dt>3D推定値</dt><dd>{displayProfile.estimateCount ? "当該投球" : "モデル範囲外・計算不可"}</dd></div></>}<div><dt>ボールモデル</dt><dd>108ダブルステッチ</dd></div><div><dt>縫い目配置</dt><dd>{profile.seamPlacement === "four-seam" ? "4シーム基準" : "表示用初期位相"}</dd></div></dl></div>
          {!["2025-fall", "2026-spring"].includes(season) && <details className="chart-definition"><summary>推定方法</summary><p>秋の推定は標準空気密度を仮定した<a href="https://baseball.physics.illinois.edu/trackman/SpinAxis.pdf" target="_blank" rel="noreferrer">Nathanモデル</a>を使用します。天候や縫い目による空力の影響は未補正で、実測3D回転ではありません。</p></details>}
          <details className="accuracy-note chart-definition"><summary>計測・推定の区分</summary><p><strong>軌道データからの推定</strong>Spin Rate・Spin Axis・Measured Tilt・IVB・HBはTrackMan実測値です。Gyro Angle・Spin Efficiency・Active Spinは軌道からの参考推定です。推定不能の球は数値を補わず、回転軸の傾きを付けない平面アニメーションで表示します。縫い目の配置と軸の前後方向は表示上の仮定です。平均表示の変化量チャートは平均IVB・平均HB、1球表示は当該投球の値です。</p></details>
        </aside>
      </div>
    </section>
  );
}

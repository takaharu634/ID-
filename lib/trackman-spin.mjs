// Nathan 2020, SpinAxis.pdf equations 2, 7-9; Addendum prescription b.
// https://baseball.physics.illinois.edu/trackman/SpinAxis.pdf
// https://baseball.physics.illinois.edu/trackman/SpinAxisAddendum.pdf
// SI units. Standard-air K is assumed; weather and seam forces are unmeasured.
export const SPIN_METHOD = 'nathan-2020-b-standard-air-v1';
const K = 0.005356 / 0.3048;
const RADIUS = 0.0366;
const A = 0.336, B = 6.041, G = 9.80665;
const number = value => value != null && String(value).trim() !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
const round = (value, digits = 1) => value === null ? null : Number(value.toFixed(digits));
const pitchIds = { 'ストレート': 'fastball', 'シンカー': 'sinker', 'カットボール': 'cutter', 'スライダー': 'slider', 'カーブ': 'curveball', 'チェンジアップ': 'changeup', 'フォーク': 'splitter', 'ナックル': 'knuckleball', 'その他': 'other' };

export function spinFromLift(lift, speed, totalRpm) {
  if (![lift, speed, totalRpm].every(Number.isFinite) || lift < 0 || lift >= A || speed <= 0 || totalRpm <= 0) return null;
  const activeRpm = -Math.log1p(-lift / A) / B * speed / RADIUS * 60 / (2 * Math.PI);
  const efficiency = activeRpm / totalRpm;
  // A model/measurement mismatch cannot become a fabricated 100%-efficient pitch.
  if (efficiency > 1) return null;
  return { activeSpin: activeRpm, spinEfficiency: efficiency * 100, gyroAngle: Math.acos(efficiency) * 180 / Math.PI };
}

export function estimateTrajectorySpin(raw) {
  const values = ['vx0', 'vy0', 'vz0', 'ax0', 'ay0', 'az0', 'y0', 'Extension', 'SpinRate'].map(key => number(raw[key]));
  if (values.some(value => value === null)) return null;
  const [vx, vy, vz, ax, ay, az, y0, extension, spin] = values;
  if (vy >= 0 || y0 < 10 || y0 > 20 || extension <= 0 || extension > 4) return null;
  // Stable quadratic root, valid before (negative t) and after the 50-foot origin.
  const timeAt = (target) => {
    const c = y0 - target, discriminant = vy * vy - 2 * ay * c;
    return discriminant > 0 ? 2 * c / (-vy + Math.sqrt(discriminant)) : NaN;
  };
  const releaseTime = timeAt(18.44 - extension), plateTime = timeAt(0.4318);
  if (!Number.isFinite(releaseTime) || !Number.isFinite(plateTime) || plateTime <= releaseTime) return null;
  const middleTime = (releaseTime + plateTime) / 2;
  const velocity = [vx + ax * middleTime, vy + ay * middleTime, vz + az * middleTime];
  const speed = Math.hypot(...velocity);
  if (speed < 15 || speed > 55) return null;
  const unit = velocity.map(value => value / speed);
  const withoutGravity = [ax, ay, az + G];
  const parallel = withoutGravity.reduce((sum, value, i) => sum + value * unit[i], 0);
  const magnus = withoutGravity.map((value, i) => value - parallel * unit[i]);
  return spinFromLift(Math.hypot(...magnus) / (K * speed * speed), speed, spin);
}

/** Generate the animation feed from this same normalized snapshot, by PitchUID. */
export function buildSpinDataset(dataset, sourceRows, season = '2026-fall') {
  const source = new Map(sourceRows.map(row => [row.PitchUID, row]));
  const rows = [];
  for (const pitch of dataset.pitches) {
    const raw = source.get(pitch.id);
    if (!raw) throw new Error(`回転の元CSVがありません: ${pitch.id}`);
    const spinRate = number(raw.SpinRate), spinAxis = number(raw.SpinAxis);
    if (!pitchIds[pitch.pitchType] || spinRate === null || spinRate <= 0 || spinAxis === null || !Number.isFinite(pitch.velocity) || !Number.isFinite(pitch.ivb) || !Number.isFinite(pitch.hb)) continue;
    const estimate = estimateTrajectorySpin(raw);
    rows.push({
      pitchId: pitch.id, pitcherId: `${season}:${pitch.pitcherId}`, pitchType: pitchIds[pitch.pitchType],
      normalizedPitchType: pitch.pitchType, rawPitchType: pitch.rawPitchType ?? raw.TaggedPitchType ?? raw.AutoPitchType ?? '',
      date: pitch.date, pitchNo: number(raw.PitchNo), velocity: pitch.velocity,
      spinRate: round(spinRate, 0), spinAxis: round(((spinAxis % 360) + 360) % 360), measuredTilt: raw.Tilt || '—',
      ivb: pitch.ivb, hb: pitch.hb, plateLocHeight: pitch.plateZ, plateLocSide: pitch.plateX,
      gyroAngle: round(estimate?.gyroAngle ?? null), spinEfficiency: round(estimate?.spinEfficiency ?? null),
      activeSpin: round(estimate?.activeSpin ?? null, 0), estimateClamped: false,
      estimateMethod: SPIN_METHOD, estimateReason: estimate ? null : '軌道データの不足、またはモデルの物理範囲外',
    });
  }
  if (dataset.pitches.some(pitch => Number.isFinite(pitch.spin) && pitch.spin > 0) && !rows.length) throw new Error('回転計測値があるのに回転表示データを生成できませんでした。');
  return rows;
}

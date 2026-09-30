import type { Row } from './dataset-types';
import { isSwing } from './scouting-analytics.ts';

export const REPORT_SIDES = ['左', '右'] as const;
export const REPORT_PITCH_GROUPS = ['ストレート', '変化球'] as const;
const breakingTypes = new Set(['カットボール','シンカー','ツーシーム','スライダー','カーブ','ナックル','特殊球','フォーク','スプリット','チェンジアップ']);
export function reportPitchGroup(row: Row) {
  return row.pitchType === 'ストレート' ? 'ストレート' : breakingTypes.has(row.pitchType) ? '変化球' : null;
}
// Source PlateLocSide: positive is inside to a right-handed batter. Include
// the inner third of the analysis zone and pitches further toward the batter.
export function isInsideFastball(row: Row) {
  if (reportPitchGroup(row) !== 'ストレート' || !Number.isFinite(row.plateX)) return false;
  return row.batterSide === '右' ? row.plateX >= .254 / 3 : row.batterSide === '左' && row.plateX <= -.254 / 3;
}
export function insideFastballCount(rows: Row[]) {
  return { n: rows.filter(isInsideFastball).length, total: rows.length,
    missing: rows.filter(p => reportPitchGroup(p) === 'ストレート' && (!Number.isFinite(p.plateX) || !REPORT_SIDES.includes(p.batterSide))).length };
}
export function groupReportPlayers(pitches: Row[], team: string, role: 'pitcher' | 'batter') {
  const groups = new Map<string, { id: string; name: string; pitches: Row[] }>();
  for (const row of pitches) {
    if (row[`${role}Team`] !== team) continue;
    const id = String(row[`${role}Id`] || `${team}:${row[role]}`);
    if (!groups.has(id)) groups.set(id, { id, name: row[`${role}Kanji`] || row[role] || '不明', pitches: [] });
    groups.get(id)!.pitches.push(row);
  }
  return [...groups.values()].sort((a,b) => a.name.localeCompare(b.name,'ja'));
}
export function reportBattedShape(row: Row) {
  return row.hitType === 'GroundBall' ? 'ゴロ' : row.hitType === 'LineDrive' ? 'ライナー' : ['FlyBall','Popup'].includes(row.hitType) ? 'フライ' : null;
}
export const reportLineDash = (shape: string | null) => shape === 'ゴロ' ? '1 3' : shape === 'フライ' ? '9 5' : undefined;
export const reportHit = (row: Row) => ['単打','二塁打','三塁打','本塁打'].includes(row.playResult);
export function validDirection(row: Row) {
  const a = row.sprayAngle ?? row.direction;
  return row.result === 'インプレー' && row.hitType !== 'Bunt' && Number.isFinite(a) && Math.abs(a) <= 45;
}
export function drawableBattedBall(row: Row) {
  return validDirection(row) && Number.isFinite(row.distance) && row.distance >= 0;
}
const rate = (n: number, total: number) => ({ n, total, value: total ? n/total : null });
// FS must be annotated on complete plate appearances BEFORE search filtering.
export function teamBattingSummary(rows: Row[]) {
  const fs = rows.filter(p => p._isPaFirstStrike);
  const straight = fs.filter(p => reportPitchGroup(p) === 'ストレート');
  const breaking = fs.filter(p => reportPitchGroup(p) === '変化球');
  const outside = rows.filter(p => reportPitchGroup(p) === '変化球' && Number.isFinite(p.plateX) && (p.batterSide === '右' ? p.plateX < -.25 : p.batterSide === '左' && p.plateX > .25));
  const swings = outside.filter(isSwing);
  const balls = rows.filter(p => validDirection(p) && REPORT_SIDES.includes(p.batterSide));
  const directions = { pull: 0, center: 0, opposite: 0 };
  for (const p of balls) {
    const angle = p.sprayAngle ?? p.direction;
    if (Math.abs(angle) <= 15) directions.center++;
    else if (p.batterSide === '右' ? angle < -15 : angle > 15) directions.pull++;
    else directions.opposite++;
  }
  return { fsStraight:rate(straight.filter(isSwing).length,straight.length), fsBreaking:rate(breaking.filter(isSwing).length,breaking.length),
    outsideSwing:rate(swings.length,outside.length), outsideWhiff:rate(swings.filter(p => p.result === '空振り').length,swings.length),
    directions, batted:balls.length, pitches:rows.length };
}

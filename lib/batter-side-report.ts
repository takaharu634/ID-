import { maxValue } from './extrema.mjs';
import type { Row } from './dataset-types';

export type ReportPerspective = 'batter' | 'pitcher';
export function reportPlayer(p: Row, perspective: ReportPerspective = 'batter') {
  const pitcher = perspective === 'pitcher';
  return {
    key: String(pitcher ? p.pitcherId || `${p.pitcherTeam}:${p.pitcher}` : p.batterId || `${p.batterTeam}:${p.batter}`),
    name: pitcher ? p.pitcherKanji || p.pitcher : p.batterKanji || p.batter,
    team: pitcher ? p.pitcherTeam : p.batterTeam,
    side: pitcher ? p.pitcherThrows : p.batterSide,
  };
}
export function reportPlayerGroups(pitches: Row[], perspective: ReportPerspective = 'batter') {
  const groups = new Map<string, Row[]>();
  for (const p of pitches) {
    const key = reportPlayer(p, perspective).key;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(p);
  }
  return [...groups.values()].sort((a, b) => String(reportPlayer(a[0], perspective).name).localeCompare(String(reportPlayer(b[0], perspective).name), 'ja'));
}
export const reportOpponentSide = (p: Row, perspective: ReportPerspective = 'batter') => perspective === 'pitcher' ? p.batterSide : p.pitcherThrows;

export function reportPeriod(rows: Row[]) {
  const dates = rows.flatMap(p => {
    const match = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(String(p.date ?? '').trim());
    if (!match) return [];
    const [, year, month, day] = match;
    const normalized = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    const date = new Date(`${normalized}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === normalized ? [normalized] : [];
  }).sort();
  return dates.length ? `${dates[0]}〜${dates[dates.length - 1]}` : '不明';
}

export const BATTER_FAMILIES = ['ストレート系', '曲がる系', '落ちる系'] as const;
export function batterFamily(type: string): string {
  if (['ストレート', 'シンカー', 'ツーシーム'].includes(type)) return BATTER_FAMILIES[0];
  if (['カットボール', 'スライダー', 'カーブ', 'ナックル', '特殊球'].includes(type)) return BATTER_FAMILIES[1];
  if (['フォーク', 'スプリット', 'チェンジアップ'].includes(type)) return BATTER_FAMILIES[2];
  return 'その他';
}
export const isReportHit = (p: Row) => ['単打', '二塁打', '三塁打', '本塁打'].includes(p.playResult);
export const isReportAtBat = (p: Row) => {
  if (['犠打', '犠飛', '犠打・犠飛', 'Sacrifice'].includes(p.playResult)) return false;
  return p.result === 'インプレー' || p.korbb === 'Strikeout' ||
    (p.strikes === 2 && ['空振り', '見逃しストライク'].includes(p.result));
};
export function reportAverage(rows: Row[]) {
  const ab = rows.filter(isReportAtBat);
  const hits = ab.filter(isReportHit).length;
  return `${ab.length ? (hits / ab.length).toFixed(3).replace(/^0/, '') : '—'}（${ab.length}–${hits}）`;
}
export const reportContact = (p: Row) => p.result === 'インプレー';
export const measuredEV = (p: Row) => reportContact(p) && Number.isFinite(p.exitVelocity) && p.exitVelocity > 0;
export function reportEV(rows: Row[]) {
  const values = rows.filter(measuredEV).map(p => p.exitVelocity as number);
  return { n: values.length, avg: values.length ? values.reduce((a,b)=>a+b,0)/values.length : null, max: values.length ? maxValue(values) : null };
}
export function reportDirection(p: Row) {
  const a = p.sprayAngle ?? p.direction;
  if (!Number.isFinite(a) || Math.abs(a) > 90 || !['右','左'].includes(p.batterSide)) return null;
  if (Math.abs(a) <= 15) return '中堅';
  return (p.batterSide === '左' ? a > 15 : a < -15) ? '引張' : '逆方向';
}
export function reportZone(p: Row) {
  if (!Number.isFinite(p.plateX) || !Number.isFinite(p.plateZ)) return null;
  const col = p.plateX < -.254 ? 0 : p.plateX > .254 ? 4 : Math.min(3, 1 + Math.floor((p.plateX + .254) / (.508 / 3)));
  const row = p.plateZ > 1.05 ? 0 : p.plateZ < .45 ? 4 : Math.min(3, 1 + Math.floor((1.05 - p.plateZ) / .2));
  return row * 5 + col;
}

export const reportStrikeout = (p: Row) => p.korbb === 'Strikeout' ||
  (p.strikes === 2 && ['空振り', '見逃しストライク'].includes(p.result));
export const reportRate = (value: number | null) => value === null ? '—' : value.toFixed(3).replace(/^0/, '');
export function reportStats(rows: Row[]) {
  const ab = rows.filter(isReportAtBat);
  const hits = ab.filter(isReportHit).length;
  const totalBases = ab.reduce((n,p) => n + ({単打:1,二塁打:2,三塁打:3,本塁打:4}[p.playResult as string] ?? 0), 0);
  const walks = rows.filter(p => p.result !== '死球' && (['Walk','Waik'].includes(p.korbb) || (p.balls === 3 && p.result === 'ボール'))).length;
  const hbp = rows.filter(p => p.result === '死球').length;
  const sf = rows.filter(p => p.playResult === '犠飛').length;
  // The imported Sacrifice value does not distinguish bunts from sacrifice flies.
  const ambiguousSacrifice = rows.some(p => ['犠打・犠飛','Sacrifice'].includes(p.playResult));
  const denominator = ab.length + walks + hbp + sf;
  return { ab:ab.length, hits, hr:ab.filter(p=>p.playResult==='本塁打').length,
    k:rows.filter(reportStrikeout).length, avg:ab.length ? hits/ab.length : null,
    slg:ab.length ? totalBases/ab.length : null,
    obp:denominator && !ambiguousSacrifice ? (hits+walks+hbp)/denominator : null,
    ambiguousSacrifice,
    // RunsScored is not RBI. Only use an explicitly recorded RBI field.
    rbi:rows.length && rows.every(p=>Number.isFinite(p.rbi)) ? rows.reduce((n,p)=>n+p.rbi,0) : null,
  };
}
/** Nine directional areas; outer pitches extend into the nearest edge area. */
export function reportNineZone(p: Row) {
  const zone=reportZone(p);
  if(zone===null)return null;
  return (Math.max(1,Math.min(3,Math.floor(zone/5)))-1)*3 + Math.max(1,Math.min(3,zone%5))-1;
}
export function reportRisp(rows: Row[]) {
  return rows.filter(p=>/^[0-7]$/.test(String(p.runnerStateCode)) && (Number(p.runnerStateCode)&6)!==0);
}

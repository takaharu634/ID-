// Parsing and validation are deterministic. Original input is archived separately.
import { isSeasonKey } from './seasons.mjs';
export { seasonLabel } from './seasons.mjs';
export const IMPORT_RULE_VERSION = 'tohto-import-2026-09-28-v2';
export const decodeUtf8 = bytes => new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);
/** @returns {{headers: string[], rows: Record<string,string>[]}} */
export function csvRows(text) {
  const rows = [];
  /** @type {string[] | null} */
  let headers = null;
  let row = [], value = '', quoted = false, closed = false, line = 0;
  const push = () => {
    row.push(value); line++;
    if (row.some(v => v !== '')) {
      if (!headers) {
        headers = row;
        if (headers.some(h => !h || ['__proto__', 'constructor', 'prototype'].includes(h)) || new Set(headers).size !== headers.length) throw new Error('CSVの列名が不正です。');
      } else {
        if (row.length !== headers.length) throw new Error(`${line}行目の列数が一致しません。`);
        const obj = {}; for (let j=0;j<headers.length;j++) obj[headers[j]] = row[j].trim(); rows.push(obj);
      }
    }
    row = []; value = ''; closed = false;
  };
  text = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) { if (c === '"' && text[i + 1] === '"') { value += '"'; i++; } else if (c === '"') { quoted = false; closed = true; } else value += c; }
    else if (c === '"' && !value && !closed) quoted = true;
    else if (c === ',') { row.push(value); value = ''; closed = false; }
    else if (c === '\r' || c === '\n') { if (c === '\r' && text[i + 1] === '\n') i++; push(); }
    else { if (closed || c === '"') throw new Error('CSVの引用符が不正です。'); value += c; }
  }
  if (quoted) throw new Error('CSVが途中で切れています。');
  if (row.length || value || closed) push();
  if (!headers) throw new Error('CSVの列名がありません。');
  for (const key of ['Date', 'PitchUID', 'GameUID', 'PitchNo', 'Pitcher', 'Batter', 'PitcherTeam', 'BatterTeam', 'PitchCall', 'RelSpeed','HomeTeam','AwayTeam','Inning','Top/Bottom','PlayResult']) if (!headers.includes(key)) throw new Error(`必須列がありません: ${key}`);
  if (!rows.length) throw new Error('投球が空です。');
  return { headers, rows };
}
export function dateValue(raw) {
  const m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(raw || '');
  if (!m) return null;
  const d = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  const time = Date.parse(d);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === d ? d : null;
}
export function detectSeason(rows) {
  const dates = new Map();
  for (const row of rows) {
    const d = dateValue(row.Date);
    if (row.Date && !d) throw new Error(`日付が不正です: ${row.Date}`);
    if (d) { if (dates.has(row.GameUID) && dates.get(row.GameUID) !== d) throw new Error('同じ試合IDに複数の日付があります。'); dates.set(row.GameUID, d); }
  }
  let recoveredDates = 0; const seasons = new Set();
  for (const row of rows) {
    const own = dateValue(row.Date);
    const d = own || dates.get(row.GameUID);
    if (!d) throw new Error('同じ試合内でも日付を確認できない投球があります。');
    if (!own) recoveredDates++;
    row.Date = d;
    const month = Number(d.slice(5, 7));
    if (month < 3) throw new Error('1〜2月は春秋を自動判定できません。');
    seasons.add(`${d.slice(0, 4)}-${month < 8 ? 'spring' : 'fall'}`);
  }
  if (seasons.size !== 1) throw new Error('複数シーズンのCSVは、シーズンごとに分けてください。');
  const season = [...seasons][0];
  if (!isSeasonKey(season)) throw new Error('シーズンが不正です。');
  return { season, recoveredDates };
}
const comparable = row => JSON.stringify(Object.entries(row).filter(([k,v]) => k !== 'SourceFile' && v !== '').sort(([a],[b]) => a.localeCompare(b)));
export function encodeCsv(headers, rows) {
  const field = x => { const s = String(x ?? ''); return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s; };
  return [headers.map(field).join(','), ...rows.map(row => headers.map(h => field(row[h])).join(','))].join('\r\n') + '\r\n';
}
export function mergeImport(baseText, incomingText) {
  const incoming = csvRows(incomingText); const detected = detectSeason(incoming.rows);
  const base = baseText ? csvRows(baseText) : { headers: [], rows: [] };
  if (base.rows.length && detectSeason(base.rows).season !== detected.season) throw new Error('保存済みデータと追加データのシーズンが違います。');
  const headers = [...new Set([...base.headers, ...incoming.headers])], map = new Map(), positions = new Map(); let duplicates = 0;
  const warnings = new Map(), existingWarnings = new Map(), previousIds = new Set(base.rows.map(r=>r.PitchUID));
  let isNew = false;
  const warn = (key, message) => { const target = isNew ? warnings : existingWarnings; const old = target.get(key); target.set(key, { message, count: (old?.count || 0) + 1 }); };
  for (const row of [...base.rows, ...incoming.rows]) {
    isNew = !previousIds.has(row.PitchUID);
    if (!row.PitchUID || !row.GameUID || !/^[1-9]\d*$/.test(row.PitchNo)) throw new Error('投球ID・試合ID・球番号が欠けています。');
    if (!row.Pitcher || !row.Batter || !row.PitcherTeam || !row.BatterTeam) throw new Error('選手名・所属大学が欠けています。');
    if (!row.HomeTeam || !row.AwayTeam || !/^[1-9]\d*$/.test(row.Inning) || !['Top','Bottom'].includes(row['Top/Bottom'])) throw new Error('試合の所属・回・表裏を確認してください。');
    const calls = ['BallCalled','BallinDirt','BallIntentional','StrikeCalled','StrikeSwinging','FoulBallNotFieldable','foulBallNotFieldable','FoulBallFieldable','InPlay','HitByPitch','Undefined'];
    if (!calls.includes(row.PitchCall)) throw new Error(`投球結果が不正です: ${row.PitchCall}`);
    const pos = `${row.GameUID}|${row.PitchNo}`;
    if (positions.has(pos) && positions.get(pos) !== row.PitchUID) throw new Error('同じ試合・球番号に異なる投球IDがあります。');
    positions.set(pos,row.PitchUID);
    for (const key of ['RelSpeed', 'SpinRate', 'ExitSpeed', 'InducedVertBreak', 'HorzBreak', 'PlateLocHeight', 'PlateLocSide']) {
      if (row[key] && !Number.isFinite(Number(row[key]))) throw new Error(`${key}に数値以外の値があります。`);
    }
    if (row.RelSpeed && (Number(row.RelSpeed) <= 0 || Number(row.RelSpeed) > 200)) throw new Error('球速の単位・値を確認してください。');
    const previous = map.get(row.PitchUID);
    if (previous) { if (comparable(previous) !== comparable(row)) throw new Error(`同じ投球IDの内容が違います: ${row.PitchUID}。自動上書きを停止しました。`); duplicates++; continue; }
    map.set(row.PitchUID, row);
    if (row.PitchCall === 'Undefined' || row.PitchCall === 'InPlay' && (!row.PlayResult || row.PlayResult === 'Undefined')) warn('outcome','投球・打球結果が不明の投球');
    if (!row.RelSpeed) warn('velocity', '球速が未計測の投球');
    else if (Number(row.RelSpeed) < 70 || Number(row.RelSpeed) > 170) warn('speedRange', '球速が70〜170km/hの範囲外');
    if (row.SpinRate && (Number(row.SpinRate) < 0 || Number(row.SpinRate) > 5000)) warn('spin', '回転数が0〜5,000rpmの範囲外');
    if (!row.PitcherId || !row.BatterId) warn('ids', '選手IDが欠けている投球');
    if (row.ExitSpeed && (Number(row.ExitSpeed) < 0 || Number(row.ExitSpeed) > 200)) warn('exit', '打球速度が0〜200km/hの範囲外');
  }
  const rows = [...map.values()].sort((a,b) => a.Date.localeCompare(b.Date) || a.GameUID.localeCompare(b.GameUID) || Number(a.PitchNo)-Number(b.PitchNo));
  detectSeason(rows); // also checks game dates across both files
  return { season: detected.season, rows, addedIds: new Set(rows.filter(r=>!previousIds.has(r.PitchUID)).map(r=>r.PitchUID)), csv: encodeCsv(headers, rows), report: { ruleVersion: IMPORT_RULE_VERSION, inputRows: incoming.rows.length, previousRows: base.rows.length, totalRows: rows.length, addedRows: rows.length - previousIds.size, duplicates, recoveredDates: detected.recoveredDates, warnings: [...warnings.values()], existingWarnings: [...existingWarnings.values()] } };
}

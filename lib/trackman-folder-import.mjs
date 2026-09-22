import { createHash } from 'node:crypto';

export const AUTUMN_FOLDER_ID = '1eQhb4GYv3zlP-74BAK3g8xzkO3htUCr6';
export const AUTUMN_SEASON = '2026-fall';
export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

// Strict RFC 4180 parsing: reject incomplete downloads instead of accepting a
// short final row, and preserve quoted commas, escaped quotes and newlines.
export function parseTrackman(bytes) {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '');
  const records = [];
  let row = [], field = '', quoted = false, closed = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') { quoted = false; closed = true; }
      else field += c;
    } else if (c === '"' && !field && !closed) quoted = true;
    else if (c === ',') { row.push(field); field = ''; closed = false; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      if (row.some(Boolean)) records.push(row);
      row = []; field = ''; closed = false;
    } else {
      if (closed || c === '"') throw new Error('CSVの引用符が不正です。');
      field += c;
    }
  }
  if (quoted) throw new Error('CSVが途中で切れています。');
  if (row.length || field || closed) { row.push(field); records.push(row); }
  const headers = records.shift();
  const required = ['Date', 'PitchUID', 'GameUID', 'PitchNo', 'Pitcher', 'Batter', 'PitchCall', 'RelSpeed', 'PitcherTeam', 'BatterTeam'];
  if (!headers || new Set(headers).size !== headers.length || headers.some(h => !h) || required.some(h => !headers.includes(h))) throw new Error('TrackMan CSVの必須列がありません。');
  if (!records.length) throw new Error('CSVに投球がありません。');
  const rows = records.map((values, i) => {
    if (values.length !== headers.length) throw new Error(`CSV ${i + 2}行目の列数が一致しません。`);
    const r = Object.fromEntries(headers.map((h, j) => [h, values[j]]));
    if (!/^2026-(?:0[89]|1[012])-\d{2}$/.test(r.Date) || new Date(r.Date).toISOString().slice(0, 10) !== r.Date) throw new Error('2026秋以外の日付、または不正な日付です。');
    if (!r.PitchUID.trim() || !r.GameUID.trim() || !/^[1-9]\d*$/.test(r.PitchNo)) throw new Error('投球ID・試合ID・球番号を確認できません。');
    return r;
  });
  return { headers, rows };
}

const canonical = row => JSON.stringify(Object.entries(row).filter(([, value]) => value !== '').sort(([a], [b]) => a.localeCompare(b)));
const escapeField = value => /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;

export function mergeAutumnSources(sources) {
  const headers = [], pitches = new Map(), gameDates = new Map();
  let duplicates = 0, inputRows = 0;
  for (const source of sources) {
    const parsed = parseTrackman(source.bytes);
    for (const h of parsed.headers) if (!headers.includes(h)) headers.push(h);
    const nameDate = /^(2026)(\d{2})(\d{2})-/.exec(source.name);
    for (const row of parsed.rows) {
      inputRows++;
      if (nameDate && row.Date !== `${nameDate[1]}-${nameDate[2]}-${nameDate[3]}`) throw new Error(`${source.name}: ファイル名と試合日が一致しません。`);
      if (gameDates.has(row.GameUID) && gameDates.get(row.GameUID) !== row.Date) throw new Error('同じ試合IDに異なる日付があります。');
      gameDates.set(row.GameUID, row.Date);
      const previous = pitches.get(row.PitchUID);
      if (previous) {
        if (canonical(previous) !== canonical(row)) throw new Error(`投球IDの内容が競合しています: ${row.PitchUID}`);
        duplicates++;
      } else pitches.set(row.PitchUID, row);
    }
  }
  const rows = [...pitches.values()].sort((a, b) => a.Date.localeCompare(b.Date) || a.GameUID.localeCompare(b.GameUID) || Number(a.PitchNo) - Number(b.PitchNo));
  const csv = [headers, ...rows.map(r => headers.map(h => r[h] ?? ''))].map(r => r.map(escapeField).join(',')).join('\r\n') + '\r\n';
  return { csv, rows, duplicates, inputRows, games: gameDates.size };
}

export function normalizeBatch(batch) {
  if (batch.folderId !== AUTUMN_FOLDER_ID || !Array.isArray(batch.files)) throw new Error('2026秋の指定フォルダではありません。');
  const ids = new Set();
  return batch.files.map(f => {
    if (!/^[A-Za-z0-9_-]+$/.test(f.id) || ids.has(f.id) || typeof f.name !== 'string' || !f.name.endsWith('.csv') || !Number.isSafeInteger(f.size) || f.size <= 0 || !Number.isFinite(Date.parse(f.modifiedTime))) throw new Error('フォルダ一覧のID・名前・更新日時・サイズが不正です。');
    ids.add(f.id);
    return { id: f.id, name: f.name, modifiedTime: f.modifiedTime, size: f.size, ...(f.path ? { path: f.path } : {}) };
  }).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

export const listingFingerprint = files => sha256(JSON.stringify(files.map(f => [f.id, f.name, f.modifiedTime, f.size])));

export function folderChanges(files, previous = []) {
  return files.filter(f => !previous.some(p => p.id === f.id && p.name === f.name && p.modifiedTime === f.modifiedTime && p.size === f.size));
}

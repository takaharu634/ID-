/** Season identity is data, never an enumerated release-specific allowlist. */
export const isSeasonKey = value => typeof value === 'string' && /^[1-9]\d{3}-(spring|fall)$/.test(value);
export function seasonInfo(key) {
  if (!isSeasonKey(key)) throw new Error('シーズンが不正です。');
  const year = key.slice(0, 4), term = key.endsWith('fall') ? '秋季' : '春季';
  return { key, label: `${year}年 ${term}リーグ`, shortLabel: `${year}${term[0]}`, year, term, path: `/data/season-${key}.json` };
}
export const seasonLabel = key => { const s = seasonInfo(key); return `${s.year}年${s.term}`; };
export const sortSeasons = keys => [...new Set(keys)].filter(isSeasonKey).sort((a,b) => Number(b.slice(0,4))-Number(a.slice(0,4)) || Number(b.endsWith('fall'))-Number(a.endsWith('fall')));
export function seasonFromLabel(label) {
  const match = /(\d{4})年?\s*(春|秋)/.exec(String(label));
  return match ? `${match[1]}-${match[2] === '秋' ? 'fall' : 'spring'}` : null;
}

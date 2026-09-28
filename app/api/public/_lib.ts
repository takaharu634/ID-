import { applyPitchQuality } from '../../../lib/pitch-quality.mjs';
import { repairLegacyAggregates } from '../../../lib/repair-legacy-aggregates.ts';
export type PublicDataset = {
  metadata?: Record<string, unknown>;
  league?: Record<string, unknown>;
  teams?: Array<Record<string, unknown>>;
  games?: Array<Record<string, unknown>>;
  players?: Array<Record<string, unknown>>;
  batters?: Array<Record<string, unknown>>;
  pitchers?: Array<Record<string, unknown>>;
  pitchTypes?: Array<Record<string, unknown>>;
  pitches?: Array<Record<string, unknown>>;
};

type StorageEnv = { BUCKET?: R2Bucket };

export const jsonHeaders = {
  "access-control-allow-origin": "*",
  "cache-control": "no-store",
  "content-language": "ja",
};

export async function loadPublicDataset(request: Request): Promise<PublicDataset> {
  let runtime: StorageEnv = {};
  try { const {env}=await import("cloudflare:workers"); runtime=env as unknown as StorageEnv; }
  catch(error) { if ((error as {code?:string}).code !== 'ERR_UNSUPPORTED_ESM_URL_SCHEME') throw error; }
  const { activeObject } = await import("../../../server/import-store.mjs");
  const { isSeasonKey, seasonLabel } = await import("../../../lib/seasons.mjs");
  const { listSeasons } = await import("../../../server/season-catalog.mjs");
  const season = new URL(request.url).searchParams.get("season") || (await listSeasons(runtime.BUCKET)).latest;
  if (!isSeasonKey(season)) throw new Error("シーズンが不正です。");
  const bucket = runtime.BUCKET;
  if (bucket) {
    const current = await activeObject(bucket,season);
    if (current) return applyPitchQuality(repairLegacyAggregates(await current.json())) as PublicDataset;
    const legacy = await bucket.get("datasets/current.json");
    if (legacy) { const value = await legacy.json() as PublicDataset; if (value.metadata?.season === seasonLabel(season)) return applyPitchQuality(repairLegacyAggregates(value)); }
  }
  const response = await fetch(new URL(`/data/season-${season}.json`, request.url), { cache: "no-store" });
  if (!response.ok) throw new Error("公開データを読み込めませんでした。");
  return applyPitchQuality(repairLegacyAggregates(await response.json())) as PublicDataset;
}

export function normalize(value: unknown) {
  return String(value ?? "").normalize("NFKC").toLowerCase()
    .replace(/[\s,，.．・'’\-ー_]/g, "");
}

const teamAliases: Record<string, string> = {
  中央大: "中央大学", 東洋大: "東洋大学", 青学: "青山学院大学", 青山学院大: "青山学院大学",
  國學院大: "國學院大學", 国学院大: "國學院大學", 国学院大学: "國學院大學",
  亜細亜大: "亜細亜大学", 立正大: "立正大学",
};

const pitchAliases: Record<string, string> = {
  フォーシーム: "ストレート", 四シーム: "ストレート", "4シーム": "ストレート",
  fastball: "ストレート", fb: "ストレート", splitter: "フォーク", split: "フォーク",
  slider: "スライダー", curveball: "カーブ", curve: "カーブ", cutter: "カットボール",
  changeup: "チェンジアップ", sinker: "シンカー", "two-seam": "ツーシーム", twoseam: "ツーシーム",
};

const playerAliases: Record<string, string> = {
  鈴木たいせい: "鈴木泰成", すずきたいせい: "鈴木泰成",
};

export function canonicalTeam(value: string | null) {
  const raw = String(value ?? "").trim();
  return teamAliases[raw] ?? raw;
}

export function canonicalPitchType(value: string | null) {
  const raw = String(value ?? "").trim();
  return pitchAliases[raw] ?? pitchAliases[raw.toLowerCase()] ?? raw;
}

export function playerNeedle(value: string | null) {
  const raw = String(value ?? "").trim();
  return normalize(playerAliases[raw] ?? raw);
}

export function publicPlayer(row: Record<string, unknown>) {
  return {
    id: row.id,
    nameJa: row.kanji || row.name,
    nameRoman: row.romanName || row.name,
    team: row.team,
    roles: row.roles ?? [],
  };
}

export function findPlayers(dataset: PublicDataset, query: string | null, team: string | null, role = "") {
  const needle = playerNeedle(query);
  const teamName = canonicalTeam(team);
  return (dataset.players ?? []).filter((row) => {
    if (teamName && row.team !== teamName) return false;
    if (role && !((row.roles as unknown[]) ?? []).includes(role)) return false;
    if (!needle) return true;
    const haystack = normalize([row.id, row.kanji, row.name, row.romanName, ...((row.aliases as unknown[]) ?? [])].join(" "));
    return haystack.includes(needle);
  });
}

export function numberParam(value: string | null, fallback: number, min: number, max: number) {
  if (value === null || value.trim() === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, Math.floor(parsed))) : fallback;
}

export function apiError(message: string, status = 400) {
  return Response.json({ error: message }, { status, headers: jsonHeaders });
}

export function datasetInfo(dataset: PublicDataset) {
  return {
    title: dataset.metadata?.title,
    season: dataset.metadata?.season,
    generatedAt: dataset.metadata?.generatedAt,
    pitchQuality: dataset.metadata?.pitchQuality,
    source: "ID東都公開集計データ",
  };
}

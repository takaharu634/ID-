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
  "cache-control": "public, max-age=300, s-maxage=900",
  "content-language": "ja",
};

export async function loadPublicDataset(request: Request): Promise<PublicDataset> {
  try {
    const { env } = await import("cloudflare:workers");
    const bucket = (env as unknown as StorageEnv).BUCKET;
    const current = bucket ? await bucket.get("datasets/current.json") : null;
    if (current) return await current.json() as PublicDataset;
  } catch {
    // Local builds do not expose Cloudflare bindings. Use the bundled public dataset.
  }
  const response = await fetch(new URL("/data/initial-data.json", request.url), { cache: "no-store" });
  if (!response.ok) throw new Error("公開データを読み込めませんでした。");
  return await response.json() as PublicDataset;
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
    source: "ID東都公開集計データ",
  };
}

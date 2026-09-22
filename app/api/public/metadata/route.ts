import { datasetInfo, jsonHeaders, loadPublicDataset } from "../_lib.ts";

export const runtime = "edge";

export async function GET(request: Request) {
  const dataset = await loadPublicDataset(request);
  return Response.json({
    dataset: datasetInfo(dataset),
    teams: (dataset.teams ?? []).map((row) => row.name),
    counts: {
      teams: dataset.metadata?.teams,
      games: dataset.metadata?.games,
      pitches: dataset.metadata?.pitches,
      pitchers: dataset.metadata?.pitchers,
      batters: dataset.metadata?.batters,
    },
    pitchTypeNormalization: dataset.metadata?.pitchTypeNormalization ?? null,
    units: { avgVelocity: "km/h", maxVelocity: "km/h", avgIvb: "cm", avgHb: "cm", avgSpin: "rpm", avgVaa: "degrees", avgExtension: "cm", rates: "0-1" },
    definitions: {
      avgIvb: "Induced Vertical Breakの球種別平均。重力による落下を除いた縦変化量。",
      avgHb: "投手視点を基準とする横変化量の球種別平均。符号と投手左右を併せて解釈します。",
      whiffRate: "スイングした投球のうち空振りになった割合。",
      cswRate: "全投球のうち空振りまたは見逃しストライクになった割合。",
      minimumSample: "ランキングはminPitchesで指定した最低球数以上のみ表示します。",
      firstPitchSwingRate: "打席の1球目に対するスイング数÷打席の1球目の投球数。",
      firstStrikeSwingRate: "各打席で最初にストライク相当となった投球へのスイング数÷同投球数。初球とは別に判定します。",
      preTwoStrikeChaseRate: "投球前ストライク数が0または1のゾーン外投球へのスイング数÷同投球数。",
      twoStrikeChaseRate: "投球前ストライク数が2のゾーン外投球へのスイング数÷同投球数。",
      twoStrikeExpansion: "2ストライク時ボール球スイング率－追い込まれる前のボール球スイング率。",
      pitchTypeNormalization: "Raw Fastball/Four-Seam/Sinkerのみ、投手・シーズン別Raw Fastball平均球速の96%以下をSinker、それより速い球をFastballとして分析。Raw分類は各投球に保持。",
      scoutingDefinitionVersion: "tohto-scouting-2026-09-v1",
    },
  }, { headers: jsonHeaders });
}

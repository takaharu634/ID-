import { datasetInfo, jsonHeaders, loadPublicDataset } from "./_lib.ts";

export const runtime = "edge";

export async function GET(request: Request) {
  const dataset = await loadPublicDataset(request);
  const origin = new URL(request.url).origin;
  return Response.json({
    name: "ID東都 公開読み取り専用API",
    description: "公開済みの選手・投手・球種集計をAIや外部ツールから取得できます。書き込み機能はありません。",
    dataset: datasetInfo(dataset),
    documentation: `${origin}/ai`,
    openapi: `${origin}/openapi.json`,
    endpoints: {
      metadata: `${origin}/api/public/metadata`,
      players: `${origin}/api/public/players?q=鈴木泰成&role=投手`,
      arsenal: `${origin}/api/public/arsenal?player=鈴木泰成&team=青山学院大学&minPitches=5`,
      rankings: `${origin}/api/public/rankings/pitchers?team=中央大学&pitchType=ストレート&metric=avgIvb&minPitches=20`,
      pitcherScouting: `${origin}/api/public/scouting/pitcher?player=鈴木泰成&team=青山学院大学&minSample=5`,
      batterApproach: `${origin}/api/public/scouting/batter?player=渡部海&team=青山学院大学&minSample=5`,
      batterProfile: `${origin}/api/public/scouting/batter-profile?player=渡部海&team=青山学院大学`,
    },
  }, { headers: jsonHeaders });
}

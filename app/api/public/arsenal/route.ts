import { withPitchTypeExtrema } from "../../../../lib/pitch-extrema.ts";
import { apiError, canonicalTeam, datasetInfo, findPlayers, jsonHeaders, loadPublicDataset, numberParam, publicPlayer } from "../_lib.ts";

export const runtime = "edge";

const arsenalFields = ["pitchType", "pitches", "usageRate", "avgVelocity", "maxVelocity", "avgSpin", "avgIvb", "maxIvb", "avgHb", "maxHb", "avgVaa", "maxVaa", "avgExtension", "whiffRate", "cswRate", "hardHitRateAllowed", "pitchValuePer100"];

export async function GET(request: Request) {
  const dataset = await loadPublicDataset(request);
  const params = new URL(request.url).searchParams;
  const playerQuery = params.get("player");
  if (!playerQuery) return apiError("playerを指定してください。例: ?player=鈴木泰成");
  const matches = findPlayers(dataset, playerQuery, params.get("team"), "投手");
  if (!matches.length) return apiError("一致する投手が見つかりません。", 404);
  if (matches.length > 1) return Response.json({
    error: "複数の投手が一致しました。teamまたは正確な選手名を指定してください。",
    candidates: matches.slice(0, 20).map(publicPlayer),
  }, { status: 409, headers: jsonHeaders });
  const player = matches[0];
  const minPitches = numberParam(params.get("minPitches"), 1, 1, 10000);
  const pitches = withPitchTypeExtrema(dataset.pitchTypes ?? [], dataset.pitches ?? [])
    .filter((row) => row.pitcherId === player.id && Number(row.pitches) >= minPitches)
    .sort((a, b) => Number(b.pitches) - Number(a.pitches))
    .map((row) => Object.fromEntries(arsenalFields.map((field) => [field, row[field]])));
  return Response.json({
    dataset: datasetInfo(dataset),
    player: publicPlayer(player),
    query: { team: canonicalTeam(params.get("team")), minPitches },
    units: { avgVelocity: "km/h", maxVelocity: "km/h", avgIvb: "cm", maxIvb: "cm", avgHb: "cm", maxHb: "cm", avgSpin: "rpm", avgVaa: "degrees", maxVaa: "degrees", avgExtension: "cm", rates: "0-1" },
    arsenal: pitches,
  }, { headers: jsonHeaders });
}

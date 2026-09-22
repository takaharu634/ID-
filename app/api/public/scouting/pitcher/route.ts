import { annotatePlateAppearances, buildCountReport, buildPitcherSideReport, SCOUTING_DEFINITION_VERSION, SCOUTING_DEFINITIONS } from "../../../../../lib/scouting-analytics.ts";
import { apiError, datasetInfo, findPlayers, jsonHeaders, loadPublicDataset, numberParam, publicPlayer } from "../../_lib.ts";
import { datasetZone, filterScoutingPitches, readScoutingFilters } from "../_shared.ts";

export const runtime = "edge";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = url.searchParams.get("player");
  if (!query) return apiError("playerを指定してください。", 400);
  const dataset = await loadPublicDataset(request);
  const candidates = findPlayers(dataset, query, url.searchParams.get("team"), "投手");
  if (!candidates.length) return apiError("条件に一致する投手が見つかりません。", 404);
  if (candidates.length > 1) return apiError("候補が複数あります。teamを指定してください。", 409);

  const player = candidates[0];
  const filters = readScoutingFilters(url);
  const minimumSample = numberParam(url.searchParams.get("minSample"), 5, 1, 100);
  const allPitches = annotatePlateAppearances((dataset.pitches ?? []) as Array<Record<string, unknown>>);
  const playerPitches = filterScoutingPitches(allPitches.filter((pitch) => pitch.pitcherId === player.id), filters, "pitcher");
  const zone = datasetZone(dataset);

  return Response.json({
    dataset: datasetInfo(dataset),
    player: publicPlayer(player),
    filters: { ...filters, minimumSample },
    sample: { pitches: playerPitches.length },
    definitionVersion: SCOUTING_DEFINITION_VERSION,
    definitions: SCOUTING_DEFINITIONS,
    units: { avgVelocity: "km/h", avgIvb: "cm", avgHb: "cm", rates: "0-1", plateLocation: "meter" },
    countAnalysis: buildCountReport(playerPitches, minimumSample, zone),
    sideAnalysis: buildPitcherSideReport(playerPitches, minimumSample, zone),
  }, { headers: jsonHeaders });
}

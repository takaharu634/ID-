import { annotatePlateAppearances } from "../../../../../lib/scouting-analytics.ts";
import { BATTER_PROFILE_DEFINITIONS, BATTER_PROFILE_DEFINITION_VERSION, buildBatterProfile } from "../../../../../lib/batter-profile.ts";
import { apiError, datasetInfo, findPlayers, jsonHeaders, loadPublicDataset, publicPlayer } from "../../_lib.ts";
import { datasetZone, filterScoutingPitches, readScoutingFilters } from "../_shared.ts";

export const runtime = "edge";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = url.searchParams.get("player");
  if (!query) return apiError("playerを指定してください。", 400);
  const dataset = await loadPublicDataset(request);
  const candidates = findPlayers(dataset, query, url.searchParams.get("team"), "打者");
  if (!candidates.length) return apiError("条件に一致する打者が見つかりません。", 404);
  if (candidates.length > 1) return apiError("候補が複数あります。teamを指定してください。", 409);

  const player = candidates[0];
  const filters = readScoutingFilters(url);
  const annotated = annotatePlateAppearances((dataset.pitches ?? []) as Array<Record<string, unknown>>);
  const leaguePitches = filterScoutingPitches(annotated, filters, "batter");
  const playerPitches = leaguePitches.filter((pitch) => pitch.batterId === player.id);
  const profile = buildBatterProfile(playerPitches, leaguePitches, datasetZone(dataset), annotated);
  const batting = (dataset.batters ?? []).find((row) => row.id === player.id);

  return Response.json({
    dataset: datasetInfo(dataset),
    player: { ...publicPlayer(player), officialBatting: batting ? {
      games: batting.games, pa: batting.pa, battingAverage: batting.battingAverage,
      onBasePercentage: batting.onBasePercentage, sluggingPercentage: batting.sluggingPercentage,
      strikeouts: batting.strikeouts, walks: batting.walks,
    } : null },
    filters,
    profile,
    definitionVersion: BATTER_PROFILE_DEFINITION_VERSION,
    definitions: BATTER_PROFILE_DEFINITIONS,
    units: { rates: "0-1", differences: "percentage-point", velocity: "km/h", movement: "cm", plateLocation: "meter" },
    readOnly: true,
  }, { headers: jsonHeaders });
}

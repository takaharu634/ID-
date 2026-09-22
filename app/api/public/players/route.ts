import { canonicalTeam, findPlayers, jsonHeaders, loadPublicDataset, numberParam, publicPlayer } from "../_lib.ts";

export const runtime = "edge";

export async function GET(request: Request) {
  const dataset = await loadPublicDataset(request);
  const params = new URL(request.url).searchParams;
  const role = params.get("role") ?? "";
  const limit = numberParam(params.get("limit"), 50, 1, 200);
  const rows = findPlayers(dataset, params.get("q"), params.get("team"), role).slice(0, limit).map(publicPlayer);
  return Response.json({
    query: { q: params.get("q") ?? "", team: canonicalTeam(params.get("team")), role, limit },
    count: rows.length,
    players: rows,
  }, { headers: jsonHeaders });
}

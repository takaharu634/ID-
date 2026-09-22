import { apiError, canonicalPitchType, canonicalTeam, datasetInfo, jsonHeaders, loadPublicDataset, numberParam } from "../../_lib.ts";

export const runtime = "edge";

const metricFields: Record<string, string> = {
  avgVelocity: "平均球速", maxVelocity: "最高球速", avgSpin: "平均回転数", avgIvb: "平均IVB", avgHb: "平均横変化量",
  avgVaa: "平均VAA", avgExtension: "平均Extension", whiffRate: "空振り率", cswRate: "CSW%",
  pitchValuePer100: "100球得点価値", stuffPlus: "球質指数+", locationPlus: "コース指数+", pitchingPlus: "総合投球指数+",
};

const unitFor = (metric: string) => metric.includes("Velocity") ? "km/h" : metric === "avgSpin" ? "rpm" : ["avgIvb", "avgHb", "avgExtension"].includes(metric) ? "cm" : metric === "avgVaa" ? "degrees" : ["whiffRate", "cswRate"].includes(metric) ? "0-1" : "index";

export async function GET(request: Request) {
  const dataset = await loadPublicDataset(request);
  const params = new URL(request.url).searchParams;
  const metric = params.get("metric") ?? "avgIvb";
  if (!metricFields[metric]) return apiError(`metricは${Object.keys(metricFields).join("、")}から指定してください。`);
  const team = canonicalTeam(params.get("team"));
  const pitchType = canonicalPitchType(params.get("pitchType"));
  const minPitches = numberParam(params.get("minPitches"), 20, 1, 10000);
  const limit = numberParam(params.get("limit"), 20, 1, 100);
  const direction = params.get("sort") === "asc" ? "asc" : "desc";
  const rows = (dataset.pitchTypes ?? [])
    .filter((row) => (!team || row.team === team) && (!pitchType || row.pitchType === pitchType) && Number(row.pitches) >= minPitches && Number.isFinite(Number(row[metric])))
    .sort((a, b) => direction === "asc" ? Number(a[metric]) - Number(b[metric]) : Number(b[metric]) - Number(a[metric]))
    .slice(0, limit)
    .map((row, index) => ({ rank: index + 1, playerId: row.pitcherId, nameJa: row.pitcherKanji || row.pitcher, nameRoman: row.pitcher, team: row.team, pitchType: row.pitchType, pitches: row.pitches, metric, value: row[metric], unit: unitFor(metric) }));
  return Response.json({
    dataset: datasetInfo(dataset),
    query: { team, pitchType, metric, metricLabel: metricFields[metric], minPitches, sort: direction, limit },
    count: rows.length,
    rankings: rows,
  }, { headers: jsonHeaders });
}

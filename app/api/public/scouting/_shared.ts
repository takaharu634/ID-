import { canonicalPitchType, type PublicDataset } from "../_lib.ts";
import { DEFAULT_ZONE, type ScoutingPitch, type ZoneBounds } from "../../../../lib/scouting-analytics.ts";

export type ScoutingApiFilters = {
  gameId: string;
  fromDate: string;
  toDate: string;
  pitcherThrows: string;
  batterSide: string;
  pitchType: string;
  opponent: string;
};

export function readScoutingFilters(url: URL): ScoutingApiFilters {
  return {
    gameId: url.searchParams.get("gameId") ?? "",
    fromDate: url.searchParams.get("fromDate") ?? "",
    toDate: url.searchParams.get("toDate") ?? "",
    pitcherThrows: url.searchParams.get("pitcherThrows") ?? "",
    batterSide: url.searchParams.get("batterSide") ?? "",
    pitchType: canonicalPitchType(url.searchParams.get("pitchType")),
    opponent: url.searchParams.get("opponent") ?? "",
  };
}

function dateKey(value: unknown) {
  const [year, month, day] = String(value ?? "").replaceAll("/", "-").split("-");
  return [year, month?.padStart(2, "0"), day?.padStart(2, "0")].filter(Boolean).join("-");
}

export function filterScoutingPitches(pitches: ScoutingPitch[], filters: ScoutingApiFilters, role: "batter" | "pitcher") {
  return pitches.filter((pitch) =>
    (!filters.gameId || pitch.gameId === filters.gameId) &&
    (!filters.fromDate || dateKey(pitch.date) >= filters.fromDate) &&
    (!filters.toDate || dateKey(pitch.date) <= filters.toDate) &&
    (!filters.pitcherThrows || pitch.pitcherThrows === filters.pitcherThrows) &&
    (!filters.batterSide || pitch.batterSide === filters.batterSide) &&
    (!filters.pitchType || pitch.pitchType === filters.pitchType) &&
    (!filters.opponent || (role === "batter" ? pitch.pitcherTeam === filters.opponent : pitch.batterTeam === filters.opponent))
  );
}

export function datasetZone(dataset: PublicDataset): ZoneBounds {
  const candidate = dataset.league?.zone as Partial<ZoneBounds> | undefined;
  return candidate && [candidate.left, candidate.right, candidate.bottom, candidate.top].every((value) => Number.isFinite(value))
    ? candidate as ZoneBounds
    : DEFAULT_ZONE;
}

/** Display early-season records without relaxing the 20-PA evaluation rule. */
/** @param {Array<Record<string, any>>} batters */
export function batterDisplayMinimum(batters) {
  return batters.some((row) => Number(row.pa) >= 20) ? 20 : 1;
}

/** @param {Array<Record<string, any>>} batters */
export function displayedBatters(batters) {
  const minimum = batterDisplayMinimum(batters);
  return batters.filter((row) => Number(row.pa) >= minimum);
}

export function isMeasuredFairBall(row) {
  return row.result === "インプレー" && row.hitType !== "Bunt" && Number.isFinite(row.exitVelocity) && row.exitVelocity > 0 && Number.isFinite(row.launchAngle);
}

/** Keep the display pool separate from qualified league percentiles. */
/** @param {Array<Record<string, any>>} batters */
export function batterDisplayHighlights(batters) {
  const visible = displayedBatters(batters);
  const top = (key) => visible.filter((row) => Number.isFinite(row[key])).sort((a, b) => b[key] - a[key])[0] ?? null;
  return { battingProduction: top("wrcPlus"), exitVelocity: top("maxExitVelocity") };
}

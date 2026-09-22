export const RUNNER_STATE_LABELS = {
  "0": "走者なし",
  "1": "一塁",
  "2": "二塁",
  "3": "一・二塁",
  "4": "三塁",
  "5": "一・三塁",
  "6": "二・三塁",
  "7": "満塁",
};

export const RUNNER_STATE_OPTIONS = [
  ["0", "走者なし"],
  ["1", "一塁"],
  ["2", "二塁"],
  ["4", "三塁"],
  ["3", "一・二塁"],
  ["5", "一・三塁"],
  ["6", "二・三塁"],
  ["7", "満塁"],
];

const bitForBase = (base) => 1 << (base - 1);

function removeLeadRunners(mask, count) {
  let next = mask;
  for (let removed = 0; removed < count; removed += 1) {
    const base = [3, 2, 1].find((candidate) => next & bitForBase(candidate));
    if (!base) break;
    next &= ~bitForBase(base);
  }
  return next;
}

function advanceRunners(mask, bases, batterBase, actualRuns) {
  let next = batterBase ? bitForBase(batterBase) : 0;
  let automaticRuns = 0;
  for (const base of [3, 2, 1]) {
    if (!(mask & bitForBase(base))) continue;
    const destination = base + bases;
    if (destination > 3) automaticRuns += 1;
    else next |= bitForBase(destination);
  }
  return removeLeadRunners(next, Math.max(0, actualRuns - automaticRuns));
}

function forceWalk(mask) {
  let next = mask | bitForBase(1);
  if (mask & bitForBase(1)) next |= bitForBase(2);
  if ((mask & bitForBase(1)) && (mask & bitForBase(2))) next |= bitForBase(3);
  return next;
}

function afterPlateAppearance(mask, pitch) {
  const result = String(pitch.playResult ?? "");
  const korbb = String(pitch.korbb ?? "");
  const runs = Number.isFinite(Number(pitch.runsScored)) ? Number(pitch.runsScored) : 0;
  const outs = Number.isFinite(Number(pitch.outsOnPlay)) ? Number(pitch.outsOnPlay) : 0;

  if (result === "本塁打") return 0;
  if (result === "三塁打") return advanceRunners(mask, 3, 3, runs);
  if (result === "二塁打") return advanceRunners(mask, 2, 2, runs);
  if (result === "単打") return advanceRunners(mask, 1, 1, runs);
  if (["Walk", "Waik"].includes(korbb) || pitch.result === "死球") return forceWalk(mask);
  if (result === "失策") return advanceRunners(mask, 1, 1, runs);
  if (result === "犠打・犠飛") return advanceRunners(mask, 1, 0, runs);
  if (result === "野選") return removeLeadRunners(mask | bitForBase(1), Math.max(outs, runs));
  if (result === "盗塁") return advanceRunners(mask, 1, 0, runs);
  if (result === "盗塁死") return removeLeadRunners(mask, Math.max(1, outs));
  return removeLeadRunners(mask, runs);
}

function isStateChangingPitch(pitch) {
  return Boolean(pitch.playResult) || ["Walk", "Waik", "Strikeout"].includes(String(pitch.korbb ?? "")) || pitch.result === "死球";
}

/**
 * TrackManの標準CSVには塁の占有列がないため、打席結果・得点・アウトから
 * 各投球前の走者状況を復元する。直接記録ではないことを各行にも保持する。
 */
export function annotateRunnerStates(pitches) {
  const annotated = pitches.map((pitch) => ({ ...pitch }));
  const groups = new Map();
  annotated.forEach((pitch, index) => {
    const key = `${pitch.gameId}|${pitch.inning}|${pitch.half}`;
    const group = groups.get(key) ?? [];
    group.push({ pitch, index });
    groups.set(key, group);
  });

  for (const group of groups.values()) {
    group.sort((a, b) => Number(a.pitch.pitchNo ?? 0) - Number(b.pitch.pitchNo ?? 0));
    let mask = 0;
    const startsMidInning = Number(group[0]?.pitch.outs ?? 0) > 0;
    for (const { pitch, index } of group) {
      annotated[index].runnerStateCode = startsMidInning ? "unknown" : String(mask);
      annotated[index].runnerState = startsMidInning ? "不明" : RUNNER_STATE_LABELS[String(mask)];
      annotated[index].runnerStateSource = "inferred";
      if (!startsMidInning && isStateChangingPitch(pitch)) mask = afterPlateAppearance(mask, pitch);
    }
  }
  return annotated;
}

export function matchesRunnerState(pitch, filter) {
  if (!filter) return true;
  const code = String(pitch.runnerStateCode ?? "unknown");
  if (filter === "any") return code !== "0" && code !== "unknown";
  if (filter === "risp") return code !== "unknown" && (Number(code) & (bitForBase(2) | bitForBase(3))) !== 0;
  return code === filter;
}

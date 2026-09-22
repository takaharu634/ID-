import assert from "node:assert/strict";
import test from "node:test";
import { annotateRunnerStates, matchesRunnerState } from "../lib/runner-state.js";

function pitch(overrides: Record<string, unknown>) {
  return { gameId: "g1", inning: 1, half: "表", outs: 0, playResult: "", korbb: "", result: "ボール", outsOnPlay: 0, runsScored: 0, ...overrides };
}

test("四球・安打・長打から各投球前の走者状況を復元する", () => {
  const rows = annotateRunnerStates([
    pitch({ pitchNo: 1, korbb: "Walk" }),
    pitch({ pitchNo: 2, batterId: "b2" }),
    pitch({ pitchNo: 3, batterId: "b2", playResult: "単打" }),
    pitch({ pitchNo: 4, batterId: "b3" }),
    pitch({ pitchNo: 5, batterId: "b3", playResult: "二塁打", runsScored: 2 }),
    pitch({ pitchNo: 6, batterId: "b4" }),
  ]);
  assert.deepEqual(rows.map((row: { runnerState: string }) => row.runnerState), ["走者なし", "一塁", "一塁", "一・二塁", "一・二塁", "二塁"]);
  assert.ok(rows.every((row: { runnerStateSource: string }) => row.runnerStateSource === "inferred"));
});

test("完全一致・走者あり・得点圏を区別する", () => {
  assert.equal(matchesRunnerState({ runnerStateCode: "1" }, "1"), true);
  assert.equal(matchesRunnerState({ runnerStateCode: "1" }, "risp"), false);
  assert.equal(matchesRunnerState({ runnerStateCode: "5" }, "risp"), true);
  assert.equal(matchesRunnerState({ runnerStateCode: "7" }, "any"), true);
  assert.equal(matchesRunnerState({ runnerStateCode: "0" }, "any"), false);
  assert.equal(matchesRunnerState({ runnerStateCode: "unknown" }, "any"), false);
});

test("途中収録のイニングは誤判定せず不明にする", () => {
  const [row] = annotateRunnerStates([pitch({ pitchNo: 20, outs: 1 })]);
  assert.equal(row.runnerStateCode, "unknown");
  assert.equal(row.runnerState, "不明");
});

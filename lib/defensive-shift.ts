import type { Row } from "./dataset-types";

export type ShiftDirection = "pull" | "middle" | "opposite";
export type ShiftCounts = { pull: number; middle: number; opposite: number; total: number; hits: Record<ShiftDirection, number> };
export type ShiftHand = "" | "右" | "左";
export type FieldSector = "左翼" | "中堅" | "右翼";
export type DepthDecision = "前進" | "標準" | "後退" | "維持";
export type DepthProfile = {
  n: number; peerN: number; decision: DepthDecision; confidence: "参考" | "低" | "中";
  avgEV: number | null; avgAngle: number | null; distance75: number | null;
  carry75: number | null; peer75: number | null; delta: number | null;
  longRate: number | null; modelN: number;
};
export type ShiftSplit = { hand: "右" | "左"; n: number; pullRate: number; pullMiddleRate: number; ground: ShiftCounts; air: ShiftCounts; depth: DepthProfile };
export type Outfielder = { sector: FieldSector; depth: DepthProfile };
export type ShiftProfile = {
  playerId: string; name: string; kanji: string; team: string; side: string;
  ground: ShiftCounts; air: ShiftCounts; splits: ShiftSplit[];
  infieldPriority: "A" | "B" | "C" | "参考"; infieldPattern: "pull" | "pull-middle" | "neutral";
  infieldHits: number; conditional: boolean; infieldRecommendation: string;
  outfieldPriority: "A" | "B" | "C" | "参考"; outfieldTarget: ShiftDirection | null;
  outfieldHits: number; outfieldRecommendation: string;
  hand: ShiftHand; depth: DepthProfile; outfielders: Outfielder[]; outfieldConditional: boolean;
};

const SHIFT_HIT_RESULTS = new Set(["単打", "二塁打", "三塁打", "本塁打"]);
export const SHIFT_DIRECTION_LABELS: Record<ShiftDirection, string> = { pull: "引っ張り", middle: "センター", opposite: "逆方向" };

function shiftDirection(row: Row, side: string): ShiftDirection | null {
  const angle = row.sprayAngle ?? row.direction;
  if (!Number.isFinite(angle) || Math.abs(angle) > 45) return null;
  if (Math.abs(angle) <= 15) return "middle";
  const pull = side === "左" ? angle > 15 : angle < -15;
  return pull ? "pull" : "opposite";
}

export function shiftHitType(row: Row) {
  if (row.hitType === "Bunt") return "Bunt";
  if (Number.isFinite(row.launchAngle)) return row.launchAngle < 8 ? "GroundBall" : row.launchAngle <= 50 ? "AirBall" : "Popup";
  return ["LineDrive", "FlyBall"].includes(row.hitType) ? "AirBall" : row.hitType || "";
}

function shiftCounts(rows: Row[], side: string): ShiftCounts {
  const counts: ShiftCounts = { pull: 0, middle: 0, opposite: 0, total: 0, hits: { pull: 0, middle: 0, opposite: 0 } };
  for (const row of rows) {
    const direction = shiftDirection(row, row.batterSide || side);
    if (!direction) continue;
    counts[direction] += 1;
    counts.total += 1;
    if (SHIFT_HIT_RESULTS.has(row.playResult)) counts.hits[direction] += 1;
  }
  return counts;
}

export function buildShiftProfile(player: Row, pitches: Row[], leaguePitches: Row[] = [], hand: ShiftHand = ""): ShiftProfile {
  const side = player.side ?? pitches.find((row) => row.batterSide)?.batterSide ?? "右";
  const allFair = pitches.filter((row) => row.result === "インプレー" && shiftHitType(row) !== "Bunt" && shiftDirection(row, row.batterSide || side));
  const fair = allFair.filter(row => !hand || row.pitcherThrows === hand);
  const peers = leaguePitches.filter(row => row.batterId !== player.id && row.result === "インプレー" && shiftHitType(row) !== "Bunt" && shiftDirection(row, row.batterSide || side));
  const groundRows = fair.filter((row) => shiftHitType(row) === "GroundBall");
  const airRows = fair.filter((row) => shiftHitType(row) === "AirBall");
  const ground = shiftCounts(groundRows, side);
  const air = shiftCounts(airRows, side);
  const splits = (["右", "左"] as const).map((splitHand) => {
    const splitRows = allFair.filter(row => row.pitcherThrows === splitHand);
    const counts = shiftCounts(splitRows.filter(row => shiftHitType(row) === "GroundBall"), side);
    const air = shiftCounts(splitRows.filter(row => shiftHitType(row) === "AirBall"), side);
    const depth = depthProfile(splitRows, peers.filter(row => row.pitcherThrows === splitHand));
    return { hand:splitHand, n: counts.total, pullRate: counts.total ? counts.pull / counts.total : 0, pullMiddleRate: counts.total ? (counts.pull + counts.middle) / counts.total : 0, ground:counts, air, depth };
  });
  const comparableSplits = splits.filter((row) => row.n >= 5);
  const conditional = comparableSplits.length === 2 && Math.abs(comparableSplits[0].pullRate - comparableSplits[1].pullRate) >= .35;
  const pullRate = ground.total ? ground.pull / ground.total : 0;
  const pullMiddleRate = ground.total ? (ground.pull + ground.middle) / ground.total : 0;
  const infieldPattern = pullRate >= .68 ? "pull" : pullMiddleRate >= .87 ? "pull-middle" : "neutral";
  const infieldHits = infieldPattern === "pull" ? ground.hits.pull : infieldPattern === "pull-middle" ? ground.hits.pull + ground.hits.middle : 0;
  let infieldPriority: ShiftProfile["infieldPriority"] = "参考";
  if (ground.total >= 10 && infieldPattern !== "neutral") {
    if (!conditional && ((pullRate >= .72 && ground.total >= 15) || (pullMiddleRate >= .94 && ground.total >= 18 && infieldHits >= 5) || (pullMiddleRate >= .87 && ground.total >= 20 && infieldHits >= 5))) infieldPriority = "A";
    else if (pullRate < .6 && infieldHits <= 2) infieldPriority = "C";
    else infieldPriority = "B";
  }
  const infieldRecommendation = ground.total < 10 ? "ゴロのサンプル不足。通常配置を維持" : conditional ? "投手の左右で偏りが変わるため、投手別に配置を変更" : infieldPattern === "pull" ? (side === "右" ? "三塁手・遊撃手を三遊間寄り、二塁手を二塁ベース寄り" : "遊撃手を二塁寄り、二塁手・一塁手を一塁側へ寄せる") : infieldPattern === "pull-middle" ? (side === "右" ? "三遊間から二塁周辺を厚くし、逆方向は大きく空けない" : "二塁周辺から一塁側を厚くし、逆方向は大きく空けない") : "明確なゴロ偏りなし。通常配置を推奨";

  const airEntries = (["pull", "middle", "opposite"] as ShiftDirection[]).map((key) => [key, air[key]] as const).sort((a, b) => b[1] - a[1]);
  const outfieldTarget = air.total >= (hand ? 5 : 10) && airEntries[0][1] / air.total >= .55 ? airEntries[0][0] : null;
  const outfieldRate = outfieldTarget ? air[outfieldTarget] / air.total : 0;
  const outfieldHits = outfieldTarget ? air.hits[outfieldTarget] : 0;
  let outfieldPriority: ShiftProfile["outfieldPriority"] = !outfieldTarget ? "参考" : outfieldRate >= .8 && outfieldHits >= 4 ? "A" : outfieldRate >= .58 && outfieldHits >= 3 ? "B" : "C";
  const targetSide = outfieldTarget === "pull" ? (side === "右" ? "左翼・左中間" : "右翼・右中間") : outfieldTarget === "opposite" ? (side === "右" ? "右翼・右中間" : "左翼・左中間") : "中堅・両中間";
  const selectedPeers = peers.filter(row => !hand || row.pitcherThrows === hand);
  const depth = depthProfile(fair, selectedPeers);
  const outfielders = (["左翼", "中堅", "右翼"] as FieldSector[]).map(sector => ({sector, depth: depthProfile(fair.filter(row => fieldSectorOf(row) === sector), selectedPeers.filter(row => fieldSectorOf(row) === sector))}));
  const moved = outfielders.filter(f => f.depth.decision === "前進" || f.depth.decision === "後退");
  if (moved.length && outfieldPriority === "参考") outfieldPriority = moved.some(f=>f.depth.n>=10) ? "B" : "C";
  const lateral = outfieldTarget ? `${targetSide}寄り` : "左右標準";
  const outfieldRecommendation = `${lateral}｜${moved.length ? moved.map(f=>`${f.sector} ${f.depth.decision}`).join("・") : "前後維持"}`;
  const airSplits = splits.filter(split => split.air.total >= 5);
  const outfieldConditional = airSplits.length === 2 && ((["pull","middle","opposite"] as ShiftDirection[]).some(dir=>Math.abs(airSplits[0].air[dir]/airSplits[0].air.total-airSplits[1].air[dir]/airSplits[1].air.total)>=.25) || (airSplits.every(split=>split.depth.n>=5) && airSplits[0].depth.decision!==airSplits[1].depth.decision));
  return { playerId: player.id, name: player.name, kanji: player.kanji ?? player.name, team: player.team, side, ground, air, splits, infieldPriority, infieldPattern, infieldHits, conditional, infieldRecommendation, outfieldPriority, outfieldTarget, outfieldHits, outfieldRecommendation, hand, depth, outfielders, outfieldConditional };
}


export function fieldSectorOf(row: Row): FieldSector | null {
  const angle = row.sprayAngle ?? row.direction;
  return !Number.isFinite(angle) || Math.abs(angle)>45 ? null : angle < -15 ? "左翼" : angle > 15 ? "右翼" : "中堅";
}
const average = (xs:number[]) => xs.length ? xs.reduce((a,b)=>a+b,0)/xs.length : null;
export function quantile(xs:number[], q:number) {
  if (!xs.length) return null;
  const sorted=[...xs].sort((a,b)=>a-b), i=(sorted.length-1)*q, lo=Math.floor(i), hi=Math.ceil(i);
  return sorted[lo]+(sorted[hi]-sorted[lo])*(i-lo);
}
export function validDepthBall(row:Row) {
  return row.result === "インプレー" && row.hitType !== "Bunt" && fieldSectorOf(row)!==null &&
    Number.isFinite(row.exitVelocity) && row.exitVelocity>=50 && row.exitVelocity<=200 &&
    Number.isFinite(row.launchAngle) && row.launchAngle>=8 && row.launchAngle<=50 &&
    Number.isFinite(row.distance) && row.distance>=0 && row.distance<=180;
}
// Empirical estimate, scoped to season / pitcher hand / field sector by the caller.
// No ballistic model or assumption of observed initial fielder positions.
function estimatedCarry(ball:Row, peers:Row[]): number | null {
  const close=peers.filter(p=>Math.abs(p.exitVelocity-ball.exitVelocity)<=15 && Math.abs(p.launchAngle-ball.launchAngle)<=10);
  if (close.length<8) return null;
  let sum=0,weights=0;
  for(const p of close){const w=Math.exp(-.5*((p.exitVelocity-ball.exitVelocity)/10)**2-.5*((p.launchAngle-ball.launchAngle)/7)**2);sum+=p.distance*w;weights+=w;}
  return weights ? sum/weights : null;
}
export function depthProfile(rows:Row[], reference:Row[]): DepthProfile {
  const balls=rows.filter(validDepthBall), peers=reference.filter(validDepthBall);
  let modelN=0;
  const carries=balls.map(ball=>{const estimated=estimatedCarry(ball,peers);if(estimated!==null)modelN++;return estimated===null?ball.distance:(ball.distance+estimated)/2;});
  const distance75=quantile(balls.map(p=>p.distance),.75),carry75=quantile(carries,.75),peer75=quantile(peers.map(p=>p.distance),.75);
  const delta=carry75===null||peer75===null?null:(carry75-peer75)*balls.length/(balls.length+6);
  // Keep front positioning conservative when a material deep/hard-air tail exists.
  const longRate=balls.length?balls.filter(p=>p.distance>=100||(p.exitVelocity>=155&&p.launchAngle>=15&&p.launchAngle<=40)).length/balls.length:null;
  let decision:DepthDecision="維持";
  if(balls.length>=5 && peers.length>=20 && delta!==null){
    decision=delta<=-6 && longRate!==null && longRate<=.15 ? "前進" : delta>=6 ? "後退" : "標準";
  }
  return {n:balls.length,peerN:peers.length,decision,confidence:balls.length<5||peers.length<20?"参考":balls.length<10?"低":"中",avgEV:average(balls.map(p=>p.exitVelocity)),avgAngle:average(balls.map(p=>p.launchAngle)),distance75,carry75,peer75,delta,longRate,modelN};
}

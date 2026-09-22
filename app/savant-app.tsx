"use client";
/* eslint-disable @typescript-eslint/no-explicit-any, react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */

import { createContext, lazy, Suspense, ReactNode, useContext, useEffect, useId, useMemo, useRef, useState } from "react";
import { buildShiftProfile, SHIFT_DIRECTION_LABELS, type ShiftProfile, type ShiftCounts, type ShiftDirection, type ShiftHand } from "../lib/defensive-shift";
import { pitchProjection, fieldSector, fieldFence, sprayPoint } from "../lib/chart-geometry";
import { PlayerOptions, comparePlayerNames } from './player-options';
import { createPortal } from "react-dom";
import { batterDisplayMinimum, displayedBatters, batterDisplayHighlights, isMeasuredFairBall } from "../lib/batter-display";
import { type Row, type Dataset, type SeasonKey, SEASONS } from "../lib/dataset-types";
import { loadStaticDataset, loadUploadedDataset, createLatestRequest, readPreference, savePreference } from "../lib/dataset-loader";
import { METRIC_INFO, METRIC_KEY_BY_LABEL, getMetricInfo, type MetricInfo } from "../lib/metric-definitions";
import { printReport } from "./print-report";
import LeagueComparison from "./league-comparison";
import GameScoreboard from "./game-scoreboard";
import BatterSideReport from './batter-side-report';
import { isReportHit } from '../lib/batter-side-report';
const UmpireAnalysis = lazy(() => import("./umpire-analysis"));
const PitchSpinProfile = lazy(() => import("./pitch-spin-profile"));
const BarrelZoneView = lazy(() => import("./barrel-zone"));
import { playUiSound } from "./ui-sound";
import { matchesRunnerState, RUNNER_STATE_OPTIONS } from "../lib/runner-state";
import {
  annotatePlateAppearances,
  buildBatterApproachReport,
  buildPitcherSideReport,
  DEFAULT_MINIMUM_SAMPLE,
  DEFAULT_ZONE,
  isSwing as isScoutingSwing,
  SCOUTING_DEFINITION_VERSION,
  type RateMetric,
  type ZoneBounds,
} from "../lib/scouting-analytics";
import {
  BATTER_PROFILE_DEFINITION_VERSION,
  PITCH_GROUP_ORDER,
  buildBatterProfile,
  buildStrongContactThresholds,
  catcherViewZoneOrder,
  calculateProfileMetrics,
  compareProfileMetrics,
  filterBatterProfilePitches,
  type DetailFilters,
  type ProfileMetric,
  type ProfileMetrics,
  type Rating,
} from "../lib/batter-profile";

type ViewName = "umpires" | "home" | "games" | "search" | "visuals" | "barrel" | "compare" | "stats" | "leaders" | "quality" | "player" | "spin" | "shift" | "news" | "glossary";
type RouteState = { view: ViewName; playerId?: string; board?: string };
type NewsItem = {
  id: string; team: string; playerKanji?: string; playerRoman?: string; playerId?: string;
  publishedAt: string; category: string; headline: string; fact: string; savant: string;
  sourceName: string; sourceUrl: string;
  isFeatured?: boolean; tags?: string[];
};
type Column = { key: string; label: string; format?: "number" | "decimal" | "rate" | "plus" | "time" | "seconds" | "innings"; player?: boolean };
type Benchmark = {
  average: number;
  excellent: number | null;
  veryExcellent: number | null;
  caution: number | null;
  direction: "higher" | "lower";
  format: Column["format"];
  qualified: number;
};
type BenchmarkSet = {
  pitching: Record<string, Benchmark>;
  batting: Record<string, Benchmark>;
  catching: Record<string, Benchmark>;
};
const MetricBenchmarkContext = createContext<BenchmarkSet | null>(null);
const PITCH_COLORS: Record<string, string> = {
  "ストレート": "#d7263d",
  "スライダー": "#2878b5",
  "カーブ": "#6e44aa",
  "フォーク": "#2a9d8f",
  "チェンジアップ": "#e9a23b",
  "カットボール": "#d56f3e",
  "シンカー": "#4f7cac",
  "ナックル": "#888888",
  "その他": "#7a7f86",
  "不明": "#b5b8bd",
};

const BOARD_LABELS: Record<string, string> = {
  batting_profile: "打撃・打球プロファイル",
  batting_ev: "打撃・打球速度とバレル",
  batting_expected: "打撃・推定成績",
  batting_hr: "打撃・本塁打",
  batting_percentile: "打撃・パーセンタイル",
  batting_pitch_types: "打撃・球種別成績",
  batting_value: "打撃・得点価値",
  pitching_profile: "投球・被打球プロファイル",
  pitching_ev: "投球・被打球速度とバレル",
  pitching_expected: "投球・推定成績",
  pitching_hr: "投球・被本塁打",
  pitching_percentile: "投球・パーセンタイル",
  pitching_value: "投球・得点価値",
  pitching_arsenal: "投球・球種構成",
  pitching_movement: "投球・変化量",
  pitching_angle: "投球・リリース角度",
  pitching_spin: "投球・回転方向",
  pitching_tempo: "投球・投球間隔",
  catching_framing: "捕手・フレーミング",
  catching_pop: "捕手・二塁送球",
};

const NAV_SECTIONS = [
  {
    title: "打撃",
    items: [
      ["打球プロファイル", "batting_profile"],
      ["打球速度・バレル", "batting_ev"],
      ["推定成績", "batting_expected"],
      ["本塁打", "batting_hr"],
      ["パーセンタイル", "batting_percentile"],
      ["球種別成績", "batting_pitch_types"],
      ["得点価値", "batting_value"],
    ],
  },
  {
    title: "投球",
    items: [
      ["被打球プロファイル", "pitching_profile"],
      ["被打球速度・バレル", "pitching_ev"],
      ["推定成績", "pitching_expected"],
      ["被本塁打", "pitching_hr"],
      ["パーセンタイル", "pitching_percentile"],
      ["得点価値", "pitching_value"],
      ["球種構成", "pitching_arsenal"],
      ["変化量", "pitching_movement"],
      ["リリース角度", "pitching_angle"],
      ["回転方向", "pitching_spin"],
      ["投球間隔", "pitching_tempo"],
    ],
  },
  {
    title: "捕手",
    items: [
      ["フレーミング", "catching_framing"],
      ["二塁送球", "catching_pop"],
    ],
  },
];

function readRoute(): RouteState {
  if (typeof window === "undefined") return { view: "home" };
  const params = new URLSearchParams(window.location.search);
  const view = (params.get("表示") ?? "home") as ViewName;
  const requestedBoard = params.get("指標") ?? undefined;
  return {
    view: ["umpires", "home", "games", "search", "visuals", "barrel", "compare", "stats", "leaders", "quality", "player", "spin", "shift", "news", "glossary"].includes(view) ? view : "home",
    playerId: params.get("選手") ?? undefined,
    board: requestedBoard === "catching_throwing" ? "catching_pop" : requestedBoard,
  };
}

function formatValue(value: any, format: Column["format"] = "number") {
  if (value === null || value === undefined || value === "" || Number.isNaN(value)) return "—";
  if (format === "rate") return `${(Number(value) * 100).toFixed(1)}%`;
  if (format === "decimal") return Number(value).toFixed(3).replace(/^0/, "");
  if (format === "plus") return Math.round(Number(value)).toString();
  if (format === "time") return `${Number(value).toFixed(2)}秒`;
  if (format === "seconds") return `${Number(value).toFixed(3)}秒`;
  if (format === "innings") return String(value);
  if (Number.isFinite(Number(value))) {
    const displayed = Number(value).toLocaleString("ja-JP", { maximumFractionDigits: 1 });
    return displayed === "-0" ? "0" : displayed;
  }
  return String(value);
}

function numericValue(value: any) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function quantile(values: number[], probability: number) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function weightedAverage(rows: Row[], key: string, weightKey?: string) {
  let weightedSum = 0;
  let weightSum = 0;
  for (const row of rows) {
    const value = numericValue(row[key]);
    if (value === null) continue;
    const weight = weightKey ? numericValue(row[weightKey]) : 1;
    if (weight === null || weight <= 0) continue;
    weightedSum += value * weight;
    weightSum += weight;
  }
  return weightSum ? weightedSum / weightSum : null;
}

function createBenchmark(rows: Row[], key: string, options: {
  format?: Column["format"];
  direction?: "higher" | "lower";
  weightKey?: string;
  fixedAverage?: number | null;
  qualifies: (row: Row) => boolean;
  averageOnly?: boolean;
}) {
  const qualifiedValues = rows.filter(options.qualifies).map((row) => numericValue(row[key])).filter((value): value is number => value !== null);
  const average = options.fixedAverage ?? weightedAverage(rows, key, options.weightKey);
  if (average === null || !qualifiedValues.length) return null;
  const direction = options.direction ?? "higher";
  const excellent = options.averageOnly ? null : quantile(qualifiedValues, direction === "higher" ? 0.75 : 0.25);
  const veryExcellent = options.averageOnly ? null : quantile(qualifiedValues, direction === "higher" ? 0.9 : 0.1);
  const caution = options.averageOnly ? null : quantile(qualifiedValues, direction === "higher" ? 0.25 : 0.75);
  return {
    average,
    excellent,
    veryExcellent,
    caution,
    direction,
    format: options.format ?? "number",
    qualified: qualifiedValues.length,
  } satisfies Benchmark;
}

function buildLeagueBenchmarks(data: Dataset): BenchmarkSet {
  const pitching: Record<string, Benchmark> = {};
  const batting: Record<string, Benchmark> = {};
  const catching: Record<string, Benchmark> = {};
  const pitcherQualifies = (row: Row) => row.pitches >= 100;
  const batterQualifies = (row: Row) => row.pa >= 20;
  const framingQualifies = (row: Row) => row.shadowPitches >= 100;
  const add = (target: Record<string, Benchmark>, rows: Row[], key: string, options: Parameters<typeof createBenchmark>[2]) => {
    const benchmark = createBenchmark(rows, key, options);
    if (benchmark) target[key] = benchmark;
  };

  add(pitching, data.pitchers, "pitchingPlus", { format: "plus", fixedAverage: 100, weightKey: "pitches", qualifies: pitcherQualifies });
  add(pitching, data.pitchers, "stuffPlus", { format: "plus", fixedAverage: 100, weightKey: "pitches", qualifies: pitcherQualifies });
  add(pitching, data.pitchers, "locationPlus", { format: "plus", fixedAverage: 100, weightKey: "pitches", qualifies: pitcherQualifies });
  add(pitching, data.pitchers, "pitchValuePer100", { weightKey: "pitches", qualifies: pitcherQualifies });
  add(pitching, data.pitchers, "xera", { direction: "lower", weightKey: "pa", qualifies: pitcherQualifies });
  add(pitching, data.pitchers, "whiffRate", { format: "rate", weightKey: "pitches", qualifies: pitcherQualifies });
  add(pitching, data.pitchers, "cswRate", { format: "rate", weightKey: "pitches", qualifies: pitcherQualifies });
  add(pitching, data.pitchers, "avgExitVelocityAllowed", { direction: "lower", weightKey: "pa", qualifies: pitcherQualifies });

  add(batting, data.batters, "wrcPlus", { format: "plus", fixedAverage: 100, weightKey: "pa", qualifies: batterQualifies });
  add(batting, data.batters, "xwoba", { format: "decimal", fixedAverage: data.league.xwoba, weightKey: "pa", qualifies: batterQualifies });
  add(batting, data.batters, "xba", { format: "decimal", weightKey: "pa", qualifies: batterQualifies });
  add(batting, data.batters, "xslg", { format: "decimal", weightKey: "pa", qualifies: batterQualifies });
  add(batting, data.batters, "avgExitVelocity", { weightKey: "bbe", qualifies: batterQualifies });
  add(batting, data.batters, "ev90", { weightKey: "bbe", qualifies: batterQualifies });
  add(batting, data.batters, "hardHitRate", { format: "rate", weightKey: "bbe", qualifies: batterQualifies });
  add(batting, data.batters, "barrelRate", { format: "rate", weightKey: "bbe", qualifies: batterQualifies });
  add(batting, data.batters, "whiffRate", { format: "rate", direction: "lower", weightKey: "pitches", qualifies: batterQualifies });

  add(catching, data.catchers, "actualStrikeRate", { format: "rate", weightKey: "shadowPitches", qualifies: framingQualifies, averageOnly: true });
  add(catching, data.catchers, "expectedStrikeRate", { format: "rate", weightKey: "shadowPitches", qualifies: framingQualifies, averageOnly: true });
  add(catching, data.catchers, "extraStrikes", { qualifies: framingQualifies });
  add(catching, data.catchers, "framingRuns", { qualifies: framingQualifies });
  add(catching, data.catchers, "framingPer1000", { weightKey: "shadowPitches", qualifies: framingQualifies });

  return { pitching, batting, catching };
}

function shortName(name: string) {
  return name?.includes(",") ? name.split(",")[0] : name;
}

function normalizeSearch(value: string) {
  return value.normalize("NFKC").toLowerCase().replace(/[\s,，.．・'’\-ー_]/g, "");
}

function romanToHiragana(value: string) {
  let source = normalizeSearch(value).replace(/[^a-z]/g, "");
  const map: Record<string, string> = {
    kya:"きゃ",kyu:"きゅ",kyo:"きょ",sha:"しゃ",shu:"しゅ",sho:"しょ",cha:"ちゃ",chu:"ちゅ",cho:"ちょ",nya:"にゃ",nyu:"にゅ",nyo:"にょ",
    hya:"ひゃ",hyu:"ひゅ",hyo:"ひょ",mya:"みゃ",myu:"みゅ",myo:"みょ",rya:"りゃ",ryu:"りゅ",ryo:"りょ",gya:"ぎゃ",gyu:"ぎゅ",gyo:"ぎょ",
    ja:"じゃ",ju:"じゅ",jo:"じょ",bya:"びゃ",byu:"びゅ",byo:"びょ",pya:"ぴゃ",pyu:"ぴゅ",pyo:"ぴょ",shi:"し",chi:"ち",tsu:"つ",
    fu:"ふ",ji:"じ",ka:"か",ki:"き",ku:"く",ke:"け",ko:"こ",sa:"さ",su:"す",se:"せ",so:"そ",ta:"た",te:"て",to:"と",
    na:"な",ni:"に",nu:"ぬ",ne:"ね",no:"の",ha:"は",hi:"ひ",he:"へ",ho:"ほ",ma:"ま",mi:"み",mu:"む",me:"め",mo:"も",
    ya:"や",yu:"ゆ",yo:"よ",ra:"ら",ri:"り",ru:"る",re:"れ",ro:"ろ",wa:"わ",wo:"を",ga:"が",gi:"ぎ",gu:"ぐ",ge:"げ",go:"ご",
    za:"ざ",zu:"ず",ze:"ぜ",zo:"ぞ",da:"だ",de:"で",do:"ど",ba:"ば",bi:"び",bu:"ぶ",be:"べ",bo:"ぼ",pa:"ぱ",pi:"ぴ",pu:"ぷ",pe:"ぺ",po:"ぽ",
    a:"あ",i:"い",u:"う",e:"え",o:"お",n:"ん",
  };
  let result = "";
  while (source) {
    if (source.length > 1 && source[0] === source[1] && !"aeioun".includes(source[0])) { result += "っ"; source = source.slice(1); continue; }
    let matched = false;
    for (const size of [3, 2, 1]) {
      const token = source.slice(0, size);
      if (map[token]) { result += map[token]; source = source.slice(size); matched = true; break; }
    }
    if (!matched) source = source.slice(1);
  }
  return result;
}

function PlayerName({ row, compact = false }: { row: Row; compact?: boolean }) {
  const roman = row.romanName ?? row.name ?? row.pitcher ?? row.batter ?? "—";
  const kanji = row.kanji ?? row.pitcherKanji ?? row.batterKanji ?? "";
  return <span className={`player-name ${compact ? "compact" : ""}`}>{kanji && <strong>{kanji}</strong>}<small>{roman}</small></span>;
}

function roleLabel(player: Row) {
  return (player.roles ?? []).join("・");
}

export default function SavantApp() {
  const [data, setData] = useState<Dataset | null>(null);
  const [season, setSeason] = useState<SeasonKey>("2026-fall");
  const [route, setRoute] = useState<RouteState>({ view: "home" });
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [loadError, setLoadError] = useState("");
  const [news, setNews] = useState<NewsItem[]>([]);
  const [muted, setMuted] = useState(false);
  const latestLoad = useRef(createLatestRequest());
  const [loadingSeason, setLoadingSeason] = useState<SeasonKey | null>(null);
  const requestedSeason = useRef<SeasonKey>("2026-fall");

  async function loadDataset(targetSeason: SeasonKey = season) {
    const isCurrent = latestLoad.current.start();
    requestedSeason.current = targetSeason;
    setLoadingSeason(targetSeason);
    setLoadError("");
    try {
      // Uploaded data is dynamic and must not share the static-season cache.
      // Try it first so an upload does not force downloading two complete datasets.
      let selected: Dataset | null = null;
      let notice = "";
      if (targetSeason === "2026-spring") {
        try {
          selected = await loadUploadedDataset();
        } catch (error) {
          // Keep a previously loaded current dataset rather than replacing it after a network failure.
          if (data && season === targetSeason) throw error;
          notice = "最新データを確認できないため、同梱の2026年春季データを表示しています。接続後に再読み込みしてください。";
        }
      }
      if (!isCurrent()) return;
      selected ??= await loadStaticDataset<Dataset>(SEASONS[targetSeason].path);
      if (!isCurrent()) return;
      setData(selected);
      setSeason(targetSeason);
      setLoadError(notice);
      savePreference("tohto-savant-season", targetSeason);
    } catch (error) {
      if (isCurrent()) setLoadError(error instanceof Error ? error.message : "データを読み込めませんでした。");
    } finally {
      if (isCurrent()) setLoadingSeason(null);
    }
  }

  useEffect(() => {
    setRoute(readRoute());
    const saved = readPreference("tohto-savant-season") as SeasonKey | null;
    loadDataset(saved && SEASONS[saved] ? saved : "2026-fall");
    fetch("/data/news_feed.json", { cache: "no-store" }).then((response) => response.ok ? response.json() : [])
      .then((items) => setNews(Array.isArray(items) ? items : items.items ?? [])).catch(() => setNews([]));
    setMuted(readPreference("tohto-savant-muted") === "true");
    const pop = () => setRoute(readRoute());
    window.addEventListener("popstate", pop);
    return () => { latestLoad.current.cancel(); window.removeEventListener("popstate", pop); };
  }, []);

  useEffect(() => {
    if ("serviceWorker" in window.navigator) {
      window.navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined);
    }
  }, []);

  function navigate(next: RouteState) {
    const params = new URLSearchParams();
    if (next.view !== "home") params.set("表示", next.view);
    if (next.playerId) params.set("選手", next.playerId);
    if (next.board) params.set("指標", next.board);
    const query = params.toString();
    window.history.pushState({}, "", query ? `/?${query}` : "/");
    setRoute(next);
    setMenuOpen(false);
    setSearchText("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const suggestions = useMemo(() => {
    if (!data || searchText.trim().length < 1) return [];
    const query = normalizeSearch(searchText);
    return data.players.filter((player) => {
      const romans = [player.romanName, player.name, ...(player.aliases ?? [])].filter(Boolean);
      const tokens = [player.kanji, player.team, ...romans, ...romans.map(romanToHiragana)].map((value) => normalizeSearch(String(value ?? "")));
      return tokens.some((token) => token.includes(query));
    }).sort(comparePlayerNames).slice(0, 8);
  }, [data, searchText]);
  const allBenchmarks = useMemo(() => data ? buildLeagueBenchmarks(data) : null, [data]);

  if (!data) {
    return (
      <main className="loading-screen">
        <BrandMark />
        <div className="loader" />
        <p>{loadError || "TrackManデータを読み込んでいます"}</p>
        {loadError && <button className="primary-button" onClick={() => loadDataset(requestedSeason.current)}>再読み込み</button>}
      </main>
    );
  }

  const selectedPlayer = route.playerId ? data.players.find((player) => player.id === route.playerId) : null;

  return (
    <MetricBenchmarkContext.Provider value={allBenchmarks}>
    <div className="site-shell" onClickCapture={(event) => {
      const target = event.target as HTMLElement;
      if (target.closest(".metric-term")) playUiSound("pop", muted);
      else if (target.closest(".player-link,.team-strip button")) playUiSound("slide", muted);
      else if (target.closest("button,a,select,[role='button']")) playUiSound("click", muted);
    }}>
      <Header
        searchText={searchText}
        setSearchText={setSearchText}
        suggestions={suggestions}
        onPlayer={(id) => navigate({ view: "player", playerId: id })}
        navigate={navigate}
        onMenu={() => setMenuOpen(true)}
        muted={muted}
        onMuted={(value) => {
          setMuted(value);
          savePreference("tohto-savant-muted", String(value));
          if (!value) playUiSound("pop", false);
        }}
        season={loadingSeason ?? season}
        onSeason={(value) => { setRoute({ view: route.view === "umpires" ? "umpires" : "home" }); loadDataset(value); }}
      />
      {(loadingSeason || loadError) && <div className="dataset-status" role="status" aria-live="polite">{loadingSeason ? `${SEASONS[loadingSeason].label}を読み込んでいます。現在の表示は${SEASONS[season].label}です。` : <>{loadError}<button type="button" onClick={() => loadDataset(requestedSeason.current)}>再読み込み</button></>}</div>}
      <TeamStrip teams={data.teams} season={season} onTeam={() => navigate({ view: "stats" })} />
      {menuOpen && <MenuOverlay close={() => setMenuOpen(false)} navigate={navigate} data={data} />}

      <main className="page-wrap"><Suspense fallback={<div className="loading-panel" role="status">分析画面を準備しています…</div>}>
        {route.view === "home" && <HomeView data={data} navigate={navigate} />}
        {route.view === "umpires" && <UmpireAnalysis key={season} data={data} />}
        {route.view === "games" && <GamesView data={data} />}
        {route.view === "search" && <SearchView data={data} navigate={navigate} />}
        {route.view === "visuals" && <VisualsView key={`${season}:${route.board ?? ""}`} data={data} navigate={navigate} />}
        {route.view === "barrel" && <BarrelZoneView key={season} initialSeason={season} initialData={data} />}
        {route.view === "compare" && <CompareView key={`${season}:${route.board ?? ""}`} data={data} navigate={navigate} />}
        {route.view === "stats" && <StatsView data={data} navigate={navigate} />}
        {route.view === "leaders" && <LeaderboardsView key={`${season}:${route.board ?? ""}`} data={data} board={route.board ?? "pitching_percentile"} navigate={navigate} />}
        {route.view === "quality" && <PitchQualityView data={data} navigate={navigate} />}
        {route.view === "spin" && <SpinView data={data} season={season} />}
        {route.view === "shift" && <ShiftView data={data} navigate={navigate} />}
        {route.view === "player" && selectedPlayer && <PlayerView key={`${season}:${selectedPlayer.id}`} season={season} data={data} player={selectedPlayer} navigate={navigate} news={news} />}
        {route.view === "player" && !selectedPlayer && <EmptyState title="選手が見つかりません" action={() => navigate({ view: "search" })} />}
        {route.view === "news" && <NewsView items={news} data={data} navigate={navigate} />}
        {route.view === "glossary" && <GlossaryView />}
      </Suspense></main>

      <Footer navigate={navigate} />
    </div>
    </MetricBenchmarkContext.Provider>
  );
}

function BrandMark() {
  return (
    <div className="brand" aria-label="ID東都">
      <span className="brand-ball" aria-hidden="true"><i /><b /></span>
      <span className="brand-copy"><strong>ID東都</strong><small>TrackMan データ分析</small></span>
    </div>
  );
}

function Header({ searchText, setSearchText, suggestions, onPlayer, navigate, onMenu, muted, onMuted, season, onSeason }: {
  searchText: string; setSearchText: (value: string) => void; suggestions: Row[];
  onPlayer: (id: string) => void; navigate: (route: RouteState) => void; onMenu: () => void;
  muted: boolean; onMuted: (value: boolean) => void;
  season: SeasonKey; onSeason: (value: SeasonKey) => void;
}) {
  return (
    <header className="site-header">
      <div className="header-top">
        <button className="brand-button" onClick={() => navigate({ view: "home" })}><BrandMark /></button>
        <label className="season-picker"><span>シーズン</span><select value={season} onChange={(event) => onSeason(event.target.value as SeasonKey)} aria-label="表示シーズン">{Object.entries(SEASONS).map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}</select></label>
        <div className="global-search">
          <span className="search-icon">⌕</span>
          <input value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder="選手名または大学名を検索" aria-label="選手名または大学名を検索" />
          {suggestions.length > 0 && (
            <div className="suggestions">
              {suggestions.map((player) => (
                <button className="player-link" key={player.id} onClick={() => onPlayer(player.id)}>
                  <PlayerName row={player} compact /><small>{player.team}・{roleLabel(player)}</small>
                </button>
              ))}
            </div>
          )}
        </div>
        <button className="sound-button" onClick={() => onMuted(!muted)} aria-label={muted ? "効果音をオンにする" : "効果音をオフにする"}>{muted ? "🔇" : "🔊"}</button>
        <button className="menu-button" onClick={onMenu} aria-label="メニューを開く"><span /><span /><span /></button>
      </div>
      <nav className="desktop-nav" aria-label="主要メニュー">
        <button onClick={() => navigate({ view: "home" })}>ホーム</button>
        <button onClick={() => navigate({ view: "games" })}>試合一覧</button>
        <button onClick={() => navigate({ view: "search" })}>投球検索</button>
        <button onClick={() => navigate({ view: "visuals" })}>可視化</button>
        <button onClick={() => navigate({ view: "leaders", board: "pitching_percentile" })}>ランキング</button>
        <button onClick={() => navigate({ view: "compare" })}>選手比較</button>
        <button onClick={() => navigate({ view: "stats" })}>リーグ統計</button>
        <button onClick={() => navigate({ view: "quality" })}>PITCH QUALITY</button>
        <button onClick={() => navigate({ view: "spin" })}>回転アニメーション</button>
        <button onClick={() => navigate({ view: "barrel" })}>バレルゾーン</button>
        <button onClick={() => navigate({ view: "umpires" })}>審判分析</button>
        <button onClick={() => navigate({ view: "shift" })}>SHIFT</button>
        <button onClick={() => navigate({ view: "news" })}>NEWS</button>
        <button className="admin-nav" onClick={() => window.location.assign("/admin")}>管理者</button>
      </nav>
    </header>
  );
}

function TeamStrip({ teams, season, onTeam }: { teams: Row[]; season: SeasonKey; onTeam: (team: string) => void }) {
  return (
    <div className="team-strip-wrap">
      <div className="team-strip">
        <div className="season-cell"><strong>{SEASONS[season].year}</strong><span>{SEASONS[season].term}</span></div>
        {teams.map((team) => (
          <button key={team.name} onClick={() => onTeam(team.name)}>
            <span className="team-dot">{team.name.slice(0, 1)}</span>
            <span><strong>{team.name.replace("大学", "大")}</strong><small>{team.wins}勝{team.losses}敗{team.ties ? `${team.ties}分` : ""}</small></span>
            <em>{team.pitchingPlus}</em>
          </button>
        ))}
      </div>
    </div>
  );
}

function MenuOverlay({ close, navigate, data }: { close: () => void; navigate: (route: RouteState) => void; data: Dataset }) {
  return (
    <div className="menu-overlay" role="dialog" aria-modal="true" aria-label="サイトメニュー">
      <div className="menu-panel">
        <div className="menu-head"><BrandMark /><button onClick={close} aria-label="閉じる">×</button></div>
        <div className="menu-main-links">
          <button onClick={() => navigate({ view: "games" })}>試合別データ</button>
          <button onClick={() => navigate({ view: "search" })}>投球・打球検索</button>
          <button onClick={() => navigate({ view: "visuals" })}>可視化</button>
          <button onClick={() => navigate({ view: "leaders", board: "pitching_percentile" })}>ランキング</button>
          <button onClick={() => navigate({ view: "compare" })}>選手比較</button>
          <button onClick={() => navigate({ view: "stats" })}>リーグ統計 <small>{data.metadata.season}</small></button>
          <button onClick={() => navigate({ view: "quality" })}>PITCH QUALITY / 投球品質</button>
          <button onClick={() => navigate({ view: "spin" })}>回転アニメーション / SPIN LAB</button>
          <button onClick={() => navigate({ view: "barrel" })}>バレルゾーン</button>
          <button onClick={() => navigate({ view: "umpires" })}>審判分析</button>
        <button onClick={() => navigate({ view: "shift" })}>SHIFT / 守備配置</button>
          <button onClick={() => navigate({ view: "news" })}>NEWS / TRAINING WATCH</button>
        </div>
        <div className="mega-grid">
          {NAV_SECTIONS.map((section) => (
            <section key={section.title}>
              <h3>{section.title}</h3>
              {section.items.map(([label, board]) => <button key={board} onClick={() => navigate({ view: "leaders", board })}>{label}</button>)}
            </section>
          ))}
          <section>
            <h3>データ機能</h3>
            <button onClick={() => navigate({ view: "leaders", board: "pitching_percentile" })}>主要成績</button>
            <button onClick={() => navigate({ view: "search" })}>カスタム検索</button>
            <button onClick={() => navigate({ view: "glossary" })}>指標解説</button>
            <button onClick={() => window.location.assign("/admin")}>管理者ログイン</button>
          </section>
        </div>
      </div>
    </div>
  );
}

function SpinView({ data, season }: { data: Dataset; season: SeasonKey }) {
  const pitchers = useMemo(() => data.players.filter((player) => (player.roles ?? []).includes("投手")).sort((a, b) => `${a.team}|${a.kanji || a.name}`.localeCompare(`${b.team}|${b.kanji || b.name}`, "ja")), [data]);
  const [playerId, setPlayerId] = useState(pitchers[0]?.id ?? "");
  useEffect(() => {
    if (!pitchers.some((player) => player.id === playerId)) setPlayerId(pitchers[0]?.id ?? "");
  }, [pitchers, playerId]);
  const player = pitchers.find((row) => row.id === playerId) ?? pitchers[0];
  if (!player) return <EmptyState title="投手データが見つかりません" action={() => undefined} />;
  const playerPitches = data.pitches.filter((row) => row.pitcherId === player.id);
  return <PageSection eyebrow="SPIN LAB / TRACKMAN" title="投手の回転アニメーション" description="投手後方視点で、球種ごとの回転軸・回転方向・推定Gyro Angleを確認します。">
    <div className="toolbar spin-picker"><label>投手<select value={player.id} onChange={(event) => setPlayerId(event.target.value)}><PlayerOptions players={pitchers} /></select></label><span>{playerPitches.length.toLocaleString("ja-JP")}球・{data.metadata.season}</span></div>
    <PitchSpinProfile season={season} playerId={player.id} playerName={player.kanji || player.name} pitches={playerPitches} filtersActive={false} />
  </PageSection>;
}

function HomeView({ data, navigate }: { data: Dataset; navigate: (route: RouteState) => void }) {
  const topPitchers = [...data.pitchers].filter((row) => row.pitches >= 100).sort((a, b) => b.pitchingPlus - a.pitchingPlus).slice(0, 5);
  const battingHighlights = batterDisplayHighlights(data.batters);
  const earlyBatting = batterDisplayMinimum(data.batters) === 1;
  const topBatters = displayedBatters(data.batters).sort((a, b) => b.wrcPlus - a.wrcPlus).slice(0, 5);
  return (
    <>
      <section className="home-intro">
        <div>
          <p className="eyebrow">東都大学野球・TrackManデータベース</p>

          <div className="hero-actions">
            <button className="primary-button" onClick={() => navigate({ view: "search" })}>投球データを検索</button>
            <button className="secondary-button" onClick={() => navigate({ view: "leaders", board: "pitching_percentile" })}>ランキングを見る</button>
          </div>
        </div>
        <DataSummary metadata={data.metadata} />
      </section>

      <section className="home-grid">
        <div className="home-main">
          <SectionTitle title="主要成績" action="すべて表示" onAction={() => navigate({ view: "leaders", board: "pitching_percentile" })} />
          {earlyBatting && <details className="chart-definition"><summary>集計条件</summary><p>打者は20打席未満の参考値です。打席数・有効打球数は一覧と選手詳細で確認できます。</p></details>}
          <div className="feature-grid">
            <FeatureCard kicker="総合投球指数+" value={data.highlights.pitchingPlus?.pitchingPlus} unit="" row={data.highlights.pitchingPlus} onClick={() => navigate({ view: "player", playerId: data.highlights.pitchingPlus?.id })} />
            <FeatureCard kicker="打撃生産指数+" value={battingHighlights.battingProduction?.wrcPlus} unit="" row={battingHighlights.battingProduction} onClick={() => navigate({ view: "player", playerId: battingHighlights.battingProduction?.id })} />
            <FeatureCard kicker="最高打球速度" value={battingHighlights.exitVelocity?.maxExitVelocity} unit="km/h" row={battingHighlights.exitVelocity} onClick={() => navigate({ view: "player", playerId: battingHighlights.exitVelocity?.id })} />
            <FeatureCard kicker="球種別・球質指数+" value={data.highlights.stuffPitch?.stuffPlus} unit="" row={{ name: data.highlights.stuffPitch?.pitcher, team: `${data.highlights.stuffPitch?.team}・${data.highlights.stuffPitch?.pitchType}` }} onClick={() => navigate({ view: "player", playerId: data.highlights.stuffPitch?.pitcherId })} />
          </div>
          <div className="two-table-grid">
            <CompactRanking title="投手" rows={topPitchers} metric="pitchingPlus" metricLabel="総合投球指数+" onPlayer={(id) => navigate({ view: "player", playerId: id })} />
            <CompactRanking title={earlyBatting ? "打者（20打席未満・参考）" : "打者"} rows={topBatters} metric="wrcPlus" metricLabel="打撃生産指数+" onPlayer={(id) => navigate({ view: "player", playerId: id })} />
          </div>
        </div>
        <aside className="home-aside">
          <h2>クイック分析</h2>
          <QuickLink title="投球品質" detail="球質指数+・コース指数+" onClick={() => navigate({ view: "leaders", board: "pitching_percentile" })} />
          <QuickLink title="打球分析" detail="打球速度・角度・バレル" onClick={() => navigate({ view: "leaders", board: "batting_ev" })} />
          <QuickLink title="投手の球種構成" detail="球速・回転・変化量" onClick={() => navigate({ view: "leaders", board: "pitching_arsenal" })} />
          <QuickLink title="捕手成績" detail="フレーミング・追加ストライク" onClick={() => navigate({ view: "leaders", board: "catching_framing" })} />
          <div className="data-note"><span className="live-dot" />現在のデータ<p>{data.metadata.sourceName}</p><small>{data.metadata.games}試合・{data.metadata.battedBalls.toLocaleString("ja-JP")}打球</small></div>
        </aside>
      </section>
    </>
  );
}

function DataSummary({ metadata }: { metadata: Row }) {
  return (
    <div className="data-summary">
      <div><strong>{metadata.pitches.toLocaleString("ja-JP")}</strong><span>投球</span></div>
      <div><strong>{metadata.games}</strong><span>試合</span></div>
      <div><strong>{metadata.pitchers}</strong><span>投手</span></div>
      <div><strong>{metadata.batters}</strong><span>打者</span></div>
    </div>
  );
}

function SectionTitle({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return <div className="section-title"><h2>{title}</h2>{action && <button onClick={onAction}>{action} →</button>}</div>;
}

function FeatureCard({ kicker, value, unit, row, onClick }: { kicker: string; value: any; unit: string; row: Row; onClick: () => void }) {
  return (
    <article className="feature-card">
      <button className="feature-card-hitbox" type="button" onClick={onClick} aria-label={`${row?.name ?? "選手"}の詳細を見る`} />
      <MetricLabel label={kicker} className="feature-metric-label" /><strong>{formatValue(value)}<small>{unit}</small></strong>
      <h3><PlayerName row={row ?? {}} /></h3><p>{row?.team ?? ""}</p><i>詳細を見る →</i>
    </article>
  );
}

function CompactRanking({ title, rows, metric, metricLabel, onPlayer }: { title: string; rows: Row[]; metric: string; metricLabel: string; onPlayer: (id: string) => void }) {
  return (
    <div className="compact-ranking">
      <h3>{title}<MetricLabel label={metricLabel} metricKey={metric} className="compact-metric-label" /></h3>
      {rows.map((row, index) => (
        <button className="player-link" key={row.id} onClick={() => onPlayer(row.id)}><b>{index + 1}</b><span><PlayerName row={row} compact /><small>{row.team}</small></span><strong>{formatValue(row[metric], "plus")}</strong></button>
      ))}
    </div>
  );
}

function QuickLink({ title, detail, onClick }: { title: string; detail: string; onClick: () => void }) {
  return <button className="quick-link" onClick={onClick}><span><strong>{title}</strong><small>{detail}</small></span><b>›</b></button>;
}

function GamesView({ data }: { data: Dataset }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [team, setTeam] = useState("すべて");
  const filtered = team === "すべて" ? data.games : data.games.filter((game) => game.homeTeam === team || game.awayTeam === team);
  const selected = filtered.find(game => game.id === selectedId);
  return (
    <PageSection eyebrow="試合別データ" title={`${data.metadata.season} 試合一覧`} description="各試合のスコアと収録球数。大学を選ぶと対象試合だけに絞れます。">
      <div className="toolbar"><label>大学<select value={team} onChange={(event) => setTeam(event.target.value)}><option>すべて</option>{data.teams.map((row) => <option key={row.name}>{row.name}</option>)}</select></label><span>{filtered.length}試合</span></div>
      {selected && <><button className="secondary-button" onClick={() => setSelectedId(null)}>スコアボードを閉じる</button><GameScoreboard game={selected} pitches={data.pitches}/></>}
      <div className="games-grid">
        {filtered.map((game) => (
          <article key={game.id} className="game-card">
            <time>{game.date}</time>
            <button className="game-score-open" aria-pressed={selectedId === game.id} onClick={() => setSelectedId(game.id)}>スコアを見る</button>
            <div><span>{game.awayTeam}</span><strong>{game.awayRuns}</strong></div>
            <div><span>{game.homeTeam}</span><strong>{game.homeRuns}</strong></div>
            <small>{game.pitches.toLocaleString("ja-JP")}球収録</small>
          </article>
        ))}
      </div>
    </PageSection>
  );
}

function SearchView({ data, navigate }: { data: Dataset; navigate: (route: RouteState) => void }) {
  const [analysisMode, setAnalysisMode] = useState<"list" | "sides" | "pitchTypes" | "counts" | "approach" | "batterSides">("list");
  const [pitcher, setPitcher] = useState("");
  const [batter, setBatter] = useState("");
  const [catcher, setCatcher] = useState("");
  const [team, setTeam] = useState("");
  const [pitchType, setPitchType] = useState("");
  const [batterSide, setBatterSide] = useState("");
  const [pitcherThrows, setPitcherThrows] = useState("");
  const [pitchResult, setPitchResult] = useState("");
  const [playResult, setPlayResult] = useState("");
  const [hitType, setHitType] = useState("");
  const [course, setCourse] = useState("");
  const [year, setYear] = useState("");
  const [season, setSeason] = useState("");
  const [opponent, setOpponent] = useState("");
  const [count, setCount] = useState("");
  const [outs, setOuts] = useState("");
  const [runnerState, setRunnerState] = useState("");
  const [inning, setInning] = useState("");
  const [half, setHalf] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [gameId, setGameId] = useState("");
  const [minimumSample, setMinimumSample] = useState(DEFAULT_MINIMUM_SAMPLE);
  const [ranges, setRanges] = useState<Record<string, string>>({});
  const [showAdvanced, setShowAdvanced] = useState(false);
  const zone = (data.league?.zone ?? DEFAULT_ZONE) as ZoneBounds;
  const annotatedPitches = useMemo(() => annotatePlateAppearances(data.pitches), [data.pitches]);
  const pitchTypes = [...new Set(annotatedPitches.map((row) => row.pitchType))].sort();
  const pitchResults = [...new Set(annotatedPitches.map((row) => row.result).filter(Boolean))].sort();
  const playResults = [...new Set(annotatedPitches.map((row) => row.playResult).filter(Boolean))].sort();
  const setRange = (key: string, value: string) => setRanges((current) => ({ ...current, [key]: value }));
  const inRange = (value: unknown, minKey: string, maxKey: string) => {
    const min = ranges[minKey], max = ranges[maxKey];
    if (!min && !max) return true;
    const numeric = Number(value);
    return Number.isFinite(numeric) && (!min || numeric >= Number(min)) && (!max || numeric <= Number(max));
  };
  const matchesCourse = (row: Row) => {
    if (!course) return true;
    const x = Number(row.plateX), z = Number(row.plateZ);
    if (!Number.isFinite(x) || !Number.isFinite(z)) return false;
    const zone = x >= -.254 && x <= .254 && z >= .45 && z <= 1.05;
    if (course === "ゾーン内") return zone;
    if (course === "ボールゾーン") return !zone;
    if (course === "真ん中") return Math.abs(x) <= .085 && z >= .65 && z <= .85;
    return zone && Math.min(Math.abs(x + .254), Math.abs(x - .254), Math.abs(z - .45), Math.abs(z - 1.05)) <= .085;
  };
  const rangeInput = (label: string, minKey: string, maxKey: string, unit: string, step = "0.1") => <label>{label}<span className="range-inputs"><input type="number" step={step} value={ranges[minKey] ?? ""} onChange={(event) => setRange(minKey, event.target.value)} placeholder="下限" /><i>〜</i><input type="number" step={step} value={ranges[maxKey] ?? ""} onChange={(event) => setRange(maxKey, event.target.value)} placeholder="上限" /><small>{unit}</small></span></label>;
  const matchesOpponent = (row: Row) => {
    if (!opponent) return true;
    if (pitcher) return row.batterTeam === opponent;
    if (batter) return row.pitcherTeam === opponent;
    if (team) return (row.pitcherTeam === team && row.batterTeam === opponent) || (row.batterTeam === team && row.pitcherTeam === opponent);
    return row.pitcherTeam === opponent || row.batterTeam === opponent;
  };
  const dateKey = (value: unknown) => {
    const [y, m, d] = String(value ?? "").replaceAll("/", "-").split("-");
    return [y, m?.padStart(2, "0"), d?.padStart(2, "0")].filter(Boolean).join("-");
  };
  const runnerStateLabel = !runnerState ? "全走者状況" : runnerState === "any" ? "走者あり" : runnerState === "risp" ? "得点圏に走者あり" : RUNNER_STATE_OPTIONS.find(([value]) => value === runnerState)?.[1] ?? "不明";
  const filtered = useMemo(() => annotatedPitches.filter((row) =>
    (!pitcher || row.pitcherId === pitcher) && (!batter || row.batterId === batter) && (!catcher || row.catcherId === catcher) &&
    (!team || row.pitcherTeam === team || row.batterTeam === team) && (!pitchType || row.pitchType === pitchType) &&
    (!batterSide || row.batterSide === batterSide) && (!pitcherThrows || row.pitcherThrows === pitcherThrows) &&
    (!pitchResult || row.result === pitchResult) && (!playResult || row.playResult === playResult) && (!hitType || row.hitType === hitType) && matchesCourse(row) &&
    inRange(row.velocity, "velocityMin", "velocityMax") && inRange(row.spin, "spinMin", "spinMax") &&
    inRange(row.ivb, "ivbMin", "ivbMax") && inRange(row.hb, "hbMin", "hbMax") &&
    inRange(row.plateX, "plateXMin", "plateXMax") && inRange(row.plateZ, "plateZMin", "plateZMax") &&
    inRange(row.exitVelocity, "exitVelocityMin", "exitVelocityMax") && inRange(row.launchAngle, "launchAngleMin", "launchAngleMax") &&
    inRange(row.releaseHeight, "releaseHeightMin", "releaseHeightMax") && inRange(row.releaseSide, "releaseSideMin", "releaseSideMax") &&
    (!year || String(row.year) === year) &&
    (!season || row.season === season) && matchesOpponent(row) &&
    (!count || `${row.balls}-${row.strikes}` === count) && (!outs || String(row.outs) === outs) && matchesRunnerState(row, runnerState) &&
    (!inning || String(row.inning) === inning) && (!half || row.half === half) &&
    (!gameId || row.gameId === gameId) && (!fromDate || dateKey(row.date) >= fromDate) && (!toDate || dateKey(row.date) <= toDate)
  ), [annotatedPitches, pitcher, batter, catcher, team, pitchType, batterSide, pitcherThrows, pitchResult, playResult, hitType, course, year, season, opponent, count, outs, runnerState, inning, half, gameId, fromDate, toDate, ranges]);

  const pitcherReportPitches = useMemo(() => filtered.filter((row) => !team || Boolean(batter) || row.pitcherTeam === team), [filtered, team, batter]);
  const leagueComparisonPitches = useMemo(() => annotatedPitches.filter((row) =>
    (!pitcherThrows || row.pitcherThrows === pitcherThrows) && (!pitchType || row.pitchType === pitchType) &&
    (!year || String(row.year) === year) && (!season || row.season === season)
  ), [annotatedPitches, pitcherThrows, pitchType, year, season]);

  function resetFilters() {
    setPitcher(""); setBatter(""); setCatcher(""); setTeam(""); setPitchType(""); setBatterSide(""); setPitcherThrows("");
    setPitchResult(""); setPlayResult(""); setHitType(""); setCourse(""); setYear(""); setSeason(""); setOpponent("");
    setCount(""); setOuts(""); setRunnerState(""); setInning(""); setHalf(""); setFromDate(""); setToDate(""); setGameId(""); setMinimumSample(DEFAULT_MINIMUM_SAMPLE); setRanges({});
  }

  function downloadCsv() {
    const headers = ["日付", "投手", "投手大学", "捕手", "捕手大学", "打者", "打者大学", "走者状況", "球種", "球速", "回転数", "縦変化", "横変化", "進入角", "エクステンション", "リリース高", "リリース横", "コース横", "コース高", "投球結果", "打球結果", "打球タイプ", "打球速度", "打球角度"];
    const keys = ["date", "pitcher", "pitcherTeam", "catcher", "catcherTeam", "batter", "batterTeam", "runnerState", "pitchType", "velocity", "spin", "ivb", "hb", "vaa", "extension", "releaseHeight", "releaseSide", "plateX", "plateZ", "result", "playResult", "hitType", "exitVelocity", "launchAngle"];
    const escape = (value: any) => `"${String(value ?? "").replaceAll('"', '""')}"`;
    const csv = [headers.map(escape).join(","), ...filtered.map((row) => keys.map((key) => escape(row[key])).join(","))].join("\n");
    const url = URL.createObjectURL(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = "ID東都_検索結果.csv"; anchor.click(); URL.revokeObjectURL(url);
  }

  return (
    <PageSection eyebrow="カスタム検索" title="投球・打球検索" description="選手・試合条件に加え、球質・コース・打球品質の範囲を指定してTrackManの1球単位データを検索できます。">
      <div className="filter-panel search-filters">
        <label>投手<select value={pitcher} onChange={(event) => setPitcher(event.target.value)}><option value="">すべて</option>{<PlayerOptions players={data.pitchers} />}</select></label>
        <label>打者<select value={batter} onChange={(event) => setBatter(event.target.value)}><option value="">すべて</option>{<PlayerOptions players={data.batters} />}</select></label>
        <label>捕手<select value={catcher} onChange={(event) => setCatcher(event.target.value)}><option value="">すべて</option>{<PlayerOptions players={data.catchers} />}</select></label>
        <label>大学<select value={team} onChange={(event) => setTeam(event.target.value)}><option value="">すべて</option>{data.teams.map((row) => <option key={row.name}>{row.name}</option>)}</select></label>
        <label>球種<select value={pitchType} onChange={(event) => setPitchType(event.target.value)}><option value="">すべて</option>{pitchTypes.map((value) => <option key={value}>{value}</option>)}</select></label>
        <label>打者の左右<select value={batterSide} onChange={(event) => setBatterSide(event.target.value)}><option value="">すべて</option><option>右</option><option>左</option></select></label>
        <label>投手の左右<select value={pitcherThrows} onChange={(event) => setPitcherThrows(event.target.value)}><option value="">すべて</option><option>右</option><option>左</option></select></label>
        <label>投球結果<select value={pitchResult} onChange={(event) => setPitchResult(event.target.value)}><option value="">すべて</option>{pitchResults.map((value) => <option key={value}>{value}</option>)}</select></label>
        <label>打球結果<select value={playResult} onChange={(event) => setPlayResult(event.target.value)}><option value="">すべて</option>{playResults.map((value) => <option key={value}>{value}</option>)}</select></label>
        <label>年度<select value={year} onChange={(event) => setYear(event.target.value)}><option value="">すべて</option>{[...new Set(data.pitches.map((row) => row.year).filter(Boolean))].map((value) => <option key={value}>{value}</option>)}</select></label>
        <label>春／秋<select value={season} onChange={(event) => setSeason(event.target.value)}><option value="">すべて</option><option>春</option><option>秋</option></select></label>
        <label>対戦大学<select value={opponent} onChange={(event) => setOpponent(event.target.value)}><option value="">すべて</option>{data.teams.map((row) => <option key={row.name}>{row.name}</option>)}</select></label>
        <label>カウント<select value={count} onChange={(event) => setCount(event.target.value)}><option value="">すべて</option>{["0-0","0-1","0-2","1-0","1-1","1-2","2-0","2-1","2-2","3-0","3-1","3-2"].map((value) => <option key={value}>{value}</option>)}</select></label>
        <label>アウト<select value={outs} onChange={(event) => setOuts(event.target.value)}><option value="">すべて</option><option value="0">0</option><option value="1">1</option><option value="2">2</option></select></label>
        <label>走者状況（推定）<select value={runnerState} onChange={(event) => setRunnerState(event.target.value)}><option value="">すべて</option><option value="any">走者あり</option><option value="risp">得点圏に走者あり</option>{RUNNER_STATE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>イニング<select value={inning} onChange={(event) => setInning(event.target.value)}><option value="">すべて</option>{[...new Set(data.pitches.map((row) => row.inning).filter(Boolean))].sort((a, b) => a - b).map((value) => <option key={value}>{value}</option>)}</select></label>
        <label>表／裏<select value={half} onChange={(event) => setHalf(event.target.value)}><option value="">すべて</option><option>表</option><option>裏</option></select></label>
        <label>開始日<input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} /></label>
        <label>終了日<input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} /></label>
        <label>対象試合<select value={gameId} onChange={(event) => setGameId(event.target.value)}><option value="">全試合</option>{data.games.map((game) => <option key={game.id} value={game.id}>{game.date} {game.awayTeam}－{game.homeTeam}</option>)}</select></label>
        <label>最低対象数<select value={minimumSample} onChange={(event) => setMinimumSample(Number(event.target.value))}><option value="1">1（すべて表示）</option><option value="5">5（推奨）</option><option value="10">10</option><option value="20">20</option></select></label>
      </div>
      <div className="search-filter-actions"><button className={showAdvanced ? "active" : ""} onClick={() => setShowAdvanced(!showAdvanced)}>{showAdvanced ? "詳細条件を閉じる" : "詳細条件を追加"}</button><button onClick={resetFilters}>条件をリセット</button></div>
      {showAdvanced && <section className="search-advanced"><header><span>ADVANCED FILTERS</span><strong>球質・コース・打球品質</strong><small>数値は下限・上限のどちらか片方だけでも指定できます。</small></header><div className="filter-panel search-filters">
        {rangeInput("球速", "velocityMin", "velocityMax", "km/h")}
        {rangeInput("回転数", "spinMin", "spinMax", "rpm", "1")}
        {rangeInput("縦変化", "ivbMin", "ivbMax", "cm")}
        {rangeInput("横変化", "hbMin", "hbMax", "cm")}
        {rangeInput("コース横", "plateXMin", "plateXMax", "m", "0.01")}
        {rangeInput("コース高", "plateZMin", "plateZMax", "m", "0.01")}
        {rangeInput("打球速度", "exitVelocityMin", "exitVelocityMax", "km/h")}
        {rangeInput("打球角度", "launchAngleMin", "launchAngleMax", "°")}
        {rangeInput("リリース高", "releaseHeightMin", "releaseHeightMax", "cm")}
        {rangeInput("リリース横", "releaseSideMin", "releaseSideMax", "cm")}
        <label>コース分類<select value={course} onChange={(event) => setCourse(event.target.value)}><option value="">すべて</option><option>ゾーン内</option><option>ボールゾーン</option><option>真ん中</option><option>エッジ</option></select></label>
        <label>打球タイプ<select value={hitType} onChange={(event) => setHitType(event.target.value)}><option value="">すべて</option><option value="GroundBall">ゴロ</option><option value="LineDrive">ライナー</option><option value="FlyBall">フライ</option></select></label>
      </div></section>}
      <div className="result-head"><div><strong>{filtered.length.toLocaleString("ja-JP")}</strong>球<span>・現在の検索条件を全分析に適用</span></div><button className="secondary-button" onClick={downloadCsv}>検索結果をCSV保存</button></div>
      <nav className="search-analysis-tabs" aria-label="検索結果の分析方法">
        {[
          ["list", "一球一覧", "1球単位"],
          ["sides", "左右別投球", "右打者／左打者"],
          ["pitchTypes", "左右×球種", "球種別投球位置"],
          ["counts", "カウント別", "配球マトリクス"],
          ["batterSides", "左右別打者分析", "対右投手／対左投手"],
          ["approach", "打者カード", "振る条件・Chase"],
        ].map(([value, label, detail]) => <button type="button" key={value} className={analysisMode === value ? "active" : ""} onClick={() => setAnalysisMode(value as typeof analysisMode)}><strong>{label}</strong><small>{detail}</small></button>)}
      </nav>
      {analysisMode === "list" && <>
        <div className="table-scroll"><table className="data-table"><thead><tr><th>日付</th><th>投手</th><th>捕手</th><th>打者</th><th>走者</th><th>球種</th><th>球速</th><th>回転数</th><th>縦変化</th><th>横変化</th><th>結果</th><th>打球速度</th></tr></thead><tbody>
          {filtered.slice(0, 250).map((row) => <tr key={row.id}><td>{row.date}</td><td><button className="text-link player-link" onClick={() => navigate({ view: "player", playerId: row.pitcherId })}><PlayerName row={{ name: row.pitcher, kanji: row.pitcherKanji }} compact /></button><small>{row.pitcherTeam}</small></td><td>{row.catcherId ? <><button className="text-link player-link" onClick={() => navigate({ view: "player", playerId: row.catcherId })}><PlayerName row={{ name: row.catcher, kanji: row.catcherKanji }} compact /></button><small>{row.catcherTeam}</small></> : "—"}</td><td><button className="text-link player-link" onClick={() => navigate({ view: "player", playerId: row.batterId })}><PlayerName row={{ name: row.batter, kanji: row.batterKanji }} compact /></button><small>{row.batterTeam}</small></td><td>{row.runnerState ?? "不明"}</td><td title={`元分類: ${row.rawPitchType || row.taggedPitchType || row.autoPitchType || "不明"}`}><span className="pitch-tag" style={{ borderColor: PITCH_COLORS[row.pitchType] }}>{row.pitchType}</span>{row.pitchTypeChanged && <small>元: {row.rawPitchTypeDisplay}</small>}</td><td>{formatValue(row.velocity)} km/h</td><td>{formatValue(row.spin)}</td><td>{formatValue(row.ivb)} cm</td><td>{formatValue(row.hb)} cm</td><td>{row.playResult || row.result}</td><td>{row.exitVelocity ? `${row.exitVelocity} km/h` : "—"}</td></tr>)}
        </tbody></table></div>
        {filtered.length > 250 && <details className="chart-definition"><summary>集計条件</summary><p>画面は先頭250球を表示しています。CSVには{filtered.length.toLocaleString("ja-JP")}球すべてを出力します。</p></details>}
      </>}
      {analysisMode === "sides" && <SearchSideAnalysis pitches={pitcherReportPitches} minimumSample={minimumSample} zone={zone} filters={{
        player: data.pitchers.find((row) => row.id === pitcher)?.kanji || data.pitchers.find((row) => row.id === pitcher)?.name || (team ? `${team} 投手陣` : "全投手"),
        team: team || data.pitchers.find((row) => row.id === pitcher)?.team || "全大学", season: [year, season].filter(Boolean).join("年") || data.metadata.season,
        game: gameId ? `${data.games.find((row) => row.id === gameId)?.date ?? ""} ${data.games.find((row) => row.id === gameId)?.awayTeam ?? ""}－${data.games.find((row) => row.id === gameId)?.homeTeam ?? ""}` : "全試合",
        period: fromDate || toDate ? `${fromDate || "開始指定なし"}〜${toDate || "終了指定なし"}` : "全期間",
        batterSide: batterSide ? `${batterSide}打者・${runnerStateLabel}` : `左右比較・${runnerStateLabel}`, pitchType: pitchType || "全球種", minimumSample: `n=${minimumSample}`,
      }} />}
      {analysisMode === "pitchTypes" && <SearchPitchTypeAnalysis pitches={filtered} />}
      {analysisMode === "batterSides" && <BatterSideReport pitchColors={PITCH_COLORS} pitches={filtered.filter(row=>!team||row.batterTeam===team)} label={[data.metadata.season, fromDate||toDate ? `${fromDate||'開始指定なし'}〜${toDate||'終了指定なし'}` : '全期間', pitcher ? `投手:${data.pitchers.find(p=>p.id===pitcher)?.kanji||pitcher}` : '全対戦投手', catcher ? `捕手:${data.catchers.find(p=>p.id===catcher)?.kanji||catcher}` : '全対戦捕手', opponent, pitchType, count&&`${count}カウント`, pitcherThrows&&`${pitcherThrows}投手`,pitchResult,playResult,hitType,course,outs&&`${outs}アウト`,runnerState&&runnerStateLabel,inning&&`${inning}回`,half,gameId&&`試合:${data.games.find(g=>g.id===gameId)?.date||gameId}`, ...Object.entries(ranges).filter(([,v])=>v).map(([k,v])=>`${({velocity:'球速',spin:'回転数',ivb:'縦変化',hb:'横変化',plateX:'横位置',plateZ:'高さ',exitVelocity:'打球速度',launchAngle:'打球角度',releaseHeight:'リリース高',releaseSide:'リリース横'} as Record<string,string>)[k.replace(/Min|Max/,'')]||k}${k.endsWith('Min')?'下限':'上限'}:${v}`)].filter(Boolean).join('・')} locationPlot={(rows,scaleRows)=><SearchPitchLocationPlot pitches={rows} scalePitches={scaleRows} compact showLegend={false} batterReport/>} legend={<div className="search-outcome-legend">{[['空振り',SEARCH_RESULT_COLORS.whiff],['見逃し',SEARCH_RESULT_COLORS.called],['ファウル',SEARCH_RESULT_COLORS.foul],['凡打',SEARCH_RESULT_COLORS.out],['ボール',SEARCH_RESULT_COLORS.ball],['安打',SEARCH_RESULT_COLORS.hit],['本塁打',SEARCH_RESULT_COLORS.homeRun]].map(([name,color])=><span key={name}><i style={{background:color}}/>{name}</span>)}</div>}/>}
      {analysisMode === "counts" && <SearchCountAnalysis pitches={pitcherReportPitches} pitcher={data.pitchers.find((row) => row.id === pitcher)} minimumSample={minimumSample} filters={{
        team,
        pitcher,
        season: [year, season].filter(Boolean).join("年") || data.metadata.season,
        opponent: opponent || "全対戦",
        batterSide: batterSide ? `${batterSide}打者` : "左右合算",
        pitchType: pitchType || "全球種",
        period: fromDate || toDate ? `${fromDate || "開始指定なし"}〜${toDate || "終了指定なし"}` : "全期間",
        count: count || "全カウント",
        outs: outs ? `${outs}アウト` : "全アウト",
        details: `走者: ${runnerStateLabel}`,
        game: gameId ? `${data.games.find((row) => row.id === gameId)?.date ?? ""} ${data.games.find((row) => row.id === gameId)?.awayTeam ?? ""}－${data.games.find((row) => row.id === gameId)?.homeTeam ?? ""}` : "全試合",
        minimumSample: `n=${minimumSample}`,
      }} />}
      {analysisMode === "approach" && <BatterApproachCard
        pitches={filtered}
        leaguePitches={leagueComparisonPitches}
        batter={data.batters.find((row) => row.id === batter)}
        minimumSample={minimumSample}
        zone={zone}
        filters={{
          team: data.batters.find((row) => row.id === batter)?.team || team || "全大学",
          season: [year, season].filter(Boolean).join("年") || data.metadata.season,
          game: gameId ? `${data.games.find((row) => row.id === gameId)?.date ?? ""} ${data.games.find((row) => row.id === gameId)?.awayTeam ?? ""}－${data.games.find((row) => row.id === gameId)?.homeTeam ?? ""}` : "全試合",
          period: fromDate || toDate ? `${fromDate || "開始指定なし"}〜${toDate || "終了指定なし"}` : "全期間",
          pitcherThrows: pitcherThrows ? `対${pitcherThrows}投手・${runnerStateLabel}` : `投手左右合算・${runnerStateLabel}`, pitchType: pitchType || "全球種", minimumSample: `n=${minimumSample}`,
        }}
      />}
    </PageSection>
  );
}

const SEARCH_RESULT_COLORS = {
  whiff: "#1747d1",
  called: "#26c947",
  foul: "#12cbd3",
  out: "#171b1c",
  ball: "#ffffff",
  hit: "#e02d3f",
  homeRun: "#f2b51d",
};

function pitchFamily(pitchType: string) {
  if (["ストレート", "カットボール", "シンカー", "ツーシーム"].includes(pitchType)) return "真っすぐ系";
  if (["スライダー", "カーブ", "ナックル", "特殊球"].includes(pitchType)) return "曲がる系";
  if (["フォーク", "スプリット", "チェンジアップ"].includes(pitchType)) return "落ちる系";
  return "その他";
}

function pitchOutcomeColor(row: Row) {
  if (row.playResult === "本塁打") return SEARCH_RESULT_COLORS.homeRun;
  if (["単打", "二塁打", "三塁打"].includes(row.playResult)) return SEARCH_RESULT_COLORS.hit;
  if (row.result === "空振り") return SEARCH_RESULT_COLORS.whiff;
  if (row.result === "見逃しストライク") return SEARCH_RESULT_COLORS.called;
  if (["ファウル", "ファウルフライ"].includes(row.result)) return SEARCH_RESULT_COLORS.foul;
  if (["ボール", "ワンバウンド", "敬遠", "死球"].includes(row.result)) return SEARCH_RESULT_COLORS.ball;
  return SEARCH_RESULT_COLORS.out;
}

function pitchMarkerName(row: Row) {
  if (row.pitchType === "ストレート") return "circle";
  if (row.pitchType === "カーブ") return "triangleUp";
  if (row.pitchType === "スライダー") return row.pitcherThrows === "左" ? "triangleLeft" : "triangleRight";
  if (row.pitchType === "フォーク") return "square";
  if (row.pitchType === "チェンジアップ") return "diamond";
  if (row.pitchType === "カットボール") return "hexagon";
  if (row.pitchType === "シンカー") return "triangleDown";
  if (row.pitchType === "ツーシーム") return "plus";
  if (row.pitchType === "スプリット") return "cross";
  if (row.pitchType === "ナックル") return "star";
  return "ring";
}

function SearchPitchMarker({ row, x, y, size = 5 }: { row: Row; x: number; y: number; size?: number }) {
  const fill = pitchOutcomeColor(row);
  const stroke = "#263638";
  const common = { fill, stroke, strokeWidth: 1.25 };
  const marker = pitchMarkerName(row);
  if (marker === "circle") return <circle cx={x} cy={y} r={size} {...common} />;
  if (marker === "triangleUp") return <polygon points={`${x},${y-size-1} ${x-size-1},${y+size} ${x+size+1},${y+size}`} {...common} />;
  if (marker === "triangleDown") return <polygon points={`${x-size-1},${y-size} ${x+size+1},${y-size} ${x},${y+size+1}`} {...common} />;
  if (marker === "triangleRight") return <polygon points={`${x-size},${y-size-1} ${x+size+1},${y} ${x-size},${y+size+1}`} {...common} />;
  if (marker === "triangleLeft") return <polygon points={`${x+size},${y-size-1} ${x-size-1},${y} ${x+size},${y+size+1}`} {...common} />;
  if (marker === "square") return <rect x={x-size} y={y-size} width={size*2} height={size*2} {...common} />;
  if (marker === "diamond") return <polygon points={`${x},${y-size-1} ${x+size+1},${y} ${x},${y+size+1} ${x-size-1},${y}`} {...common} />;
  if (marker === "hexagon") return <polygon points={`${x-size},${y} ${x-size/2},${y-size} ${x+size/2},${y-size} ${x+size},${y} ${x+size/2},${y+size} ${x-size/2},${y+size}`} {...common} />;
  if (marker === "plus") return <path d={`M${x-size} ${y-2}H${x-2}V${y-size}H${x+2}V${y-2}H${x+size}V${y+2}H${x+2}V${y+size}H${x-2}V${y+2}H${x-size}Z`} {...common} />;
  if (marker === "cross") return <path d={`M${x-size} ${y-size+1}L${x-1} ${y}L${x-size} ${y+size-1}L${x-size+2} ${y+size+1}L${x} ${y+1}L${x+size-2} ${y+size+1}L${x+size} ${y+size-1}L${x+1} ${y}L${x+size} ${y-size+1}L${x+size-2} ${y-size-1}L${x} ${y-1}L${x-size+2} ${y-size-1}Z`} {...common} />;
  if (marker === "star") return <polygon points={`${x},${y-size-2} ${x+2},${y-2} ${x+size+2},${y-2} ${x+3},${y+2} ${x+4},${y+size+2} ${x},${y+4} ${x-4},${y+size+2} ${x-3},${y+2} ${x-size-2},${y-2} ${x-2},${y-2}`} {...common} />;
  return <circle cx={x} cy={y} r={size} fill="none" stroke={fill === "#ffffff" ? stroke : fill} strokeWidth="2.2" />;
}

function sampleRows(rows: Row[], maximum: number) {
  const step = Math.max(1, Math.ceil(rows.length / maximum));
  return rows.filter((_, index) => index % step === 0).slice(0, maximum);
}

function CatcherViewAxis({ compact = false }: { compact?: boolean }) {
  return <div className={`catcher-view-axis${compact ? " compact" : ""}`} aria-label="捕手側から見た左右方向"><span>捕手から見て左</span><strong>捕手視点</strong><span>捕手から見て右</span></div>;
}

function SearchPitchLocationPlot({ pitches, compact = false, showLegend = true, batterReport = false, scalePitches }: { pitches: Row[]; compact?: boolean; showLegend?: boolean; batterReport?: boolean; scalePitches?: Row[] }) {
  const valid = pitches.filter((row) => Number.isFinite(row.plateX) && Number.isFinite(row.plateZ));
  const plotted = batterReport ? valid : sampleRows(valid, compact ? 140 : 520);
  const scaleRows = (scalePitches || valid).filter(p=>Number.isFinite(p.plateX)&&Number.isFinite(p.plateZ));
  const extentX = Math.max(.65,...scaleRows.map(p=>Math.abs(p.plateX)+.04));
  const minZ = Math.min(.15,...scaleRows.map(p=>p.plateZ-.04));
  const maxZ = Math.max(1.4,...scaleRows.map(p=>p.plateZ+.04));
  const projection = pitchProjection(420, 350, { left: -extentX, right: extentX, bottom: minZ, top: maxZ });
  const { x, y } = projection;
  const zoneLeft=x(-.254), zoneRight=x(.254), zoneTop=y(1.05), zoneBottom=y(.45);
  const types = [...new Set(valid.map((row) => row.pitchType))];
  return <div className={`search-pitch-plot${compact ? " compact" : ""}`}>
    <svg viewBox="0 0 420 350" role="img" aria-label="捕手側から見た、投球結果と球種記号による投球位置図">
      <rect x={projection.left} y={projection.top} width={projection.width} height={projection.height} fill="#fbfcfc" stroke="#d8dcde" />
      <rect x={zoneLeft} y={zoneTop} width={zoneRight-zoneLeft} height={zoneBottom-zoneTop} fill="white" stroke="#263638" strokeWidth="2" />
      {[1,2].map((index)=><line key={`v${index}`} x1={zoneLeft+(zoneRight-zoneLeft)*index/3} x2={zoneLeft+(zoneRight-zoneLeft)*index/3} y1={zoneTop} y2={zoneBottom} stroke="#aeb7b9" />)}
      {[1,2].map((index)=><line key={`h${index}`} x1={zoneLeft} x2={zoneRight} y1={zoneTop+(zoneBottom-zoneTop)*index/3} y2={zoneTop+(zoneBottom-zoneTop)*index/3} stroke="#aeb7b9" />)}
      {plotted.map((row,index)=><g key={`${row.id}-${index}`}><SearchPitchMarker row={row} x={x(row.plateX)} y={y(row.plateZ)} size={compact?5.3:5.8}/>{batterReport&&isReportHit(row)&&<circle cx={x(row.plateX)} cy={y(row.plateZ)} r="8" fill="none" stroke="#e02d3f" strokeWidth="1.3"/>}<title>{row.pitchType}・{row.result}{row.playResult?`・${row.playResult}`:""}・{row.velocity??"—"}km/h</title></g>)}
    </svg>
    <CatcherViewAxis compact={compact}/>
    {showLegend && <><div className="search-outcome-legend"><span><i style={{background:SEARCH_RESULT_COLORS.whiff}}/>空振り</span><span><i style={{background:SEARCH_RESULT_COLORS.called}}/>見逃し</span><span><i style={{background:SEARCH_RESULT_COLORS.foul}}/>ファウル</span><span><i style={{background:SEARCH_RESULT_COLORS.out}}/>凡打</span><span><i className="white"/>ボール</span><span><i style={{background:SEARCH_RESULT_COLORS.hit}}/>安打</span><span><i style={{background:SEARCH_RESULT_COLORS.homeRun}}/>本塁打</span></div><div className="search-pitch-shape-legend">{types.map((type)=><span key={type}><svg viewBox="0 0 24 24"><SearchPitchMarker row={{pitchType:type,pitcherThrows:"右",result:"ボール"}} x={12} y={12} size={5}/></svg>{type}{type==="スライダー"&&"（投手左右で向き変更）"}</span>)}</div></>}
    {!valid.length&&<p className="empty-chart">投球位置の計測データがありません。</p>}
  </div>;
}

function formatScoutingRate(metric: RateMetric | undefined, digits = 1) {
  return metric?.value === null || metric?.value === undefined ? "—" : `${(metric.value * 100).toFixed(digits)}%`;
}

function formatScoutingNumber(value: number | null | undefined, suffix = "") {
  return value === null || value === undefined ? "—" : `${value.toFixed(1)}${suffix}`;
}

function SampleFlag({ metric }: { metric: RateMetric }) {
  if (metric.sampleStatus === "none") return <small className="sample-flag no-data">データなし</small>;
  if (metric.sampleStatus === "reference") return <small className="sample-flag reference">参考値</small>;
  return null;
}

function triggerScoutingPrint(kind: "side" | "approach" | "batter-profile") {
  const selectors = { side: ".side-report-root", approach: ".approach-card-root", "batter-profile": ".batter-profile-print-root" };
  void printReport(selectors[kind], kind);
}

function ScoutingPrintHeading({ title, player, team, filters, sample }: { title: string; player: string; team: string; filters: Record<string, string>; sample: string }) {
  const printedAt = new Intl.DateTimeFormat("ja-JP", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Tokyo" }).format(new Date());
  return <div className="scouting-print-heading"><div><span>{title}</span><strong>{player}</strong><b>{team}</b></div><dl>
    <div><dt>シーズン</dt><dd>{filters.season}</dd></div><div><dt>対象試合</dt><dd>{filters.game}</dd></div>
    <div><dt>期間</dt><dd>{filters.period}</dd></div><div><dt>条件</dt><dd>{filters.batterSide || filters.pitcherThrows}</dd></div>
    <div><dt>球種</dt><dd>{filters.pitchType}</dd></div><div><dt>対象数</dt><dd>{sample}</dd></div><div><dt>出力</dt><dd>{printedAt}</dd></div>
  </dl></div>;
}

function SearchSideAnalysis({ pitches, minimumSample, zone, filters }: { pitches: Row[]; minimumSample: number; zone: ZoneBounds; filters: Record<string, string> }) {
  const report = buildPitcherSideReport(pitches, minimumSample, zone);
  return <section className="search-analysis-workspace scouting-print-root side-report-root"><div className="scouting-print-sheet side-print-sheet">
    <ScoutingPrintHeading title="左右別投球分析" player={filters.player} team={filters.team} filters={filters} sample={`${pitches.length.toLocaleString("ja-JP")}球`} />
    <header><div><span>BATTER SIDE SCOUTING</span><h2>右打者と左打者への攻め方を1枚で比較</h2><p>球種構成、球質、ゾーン率、空振り・見逃し、ボール球への反応を同じ定義で比較します。</p></div><button type="button" className="secondary-button scouting-print-button" onClick={() => triggerScoutingPrint("side")}>A4横で印刷</button></header>
    <div className="side-scout-grid">{report.sides.map((sideReport) => {
      const summary = sideReport.summary;
      return <article key={sideReport.side} className="side-scout-card"><header><div><span>{sideReport.side}打者</span><strong>n={summary.pitches.toLocaleString("ja-JP")}</strong></div><small>{summary.mainLocation}</small></header>
        <div className="side-kpi-grid">
          {[["ゾーン率", summary.zone], ["Whiff%", summary.whiff], ["CSW%", summary.csw], ["Chase%", summary.chase]].map(([label, metric]) => <div key={String(label)}><span>{String(label)}</span><strong>{formatScoutingRate(metric as RateMetric)}</strong><small>n={(metric as RateMetric).denominator ?? 0}</small><SampleFlag metric={metric as RateMetric} /></div>)}
        </div>
        <div className="side-card-body"><div className="side-table-scroll"><table className="side-pitch-table"><thead><tr><th>球種</th><th>n / 使用%</th><th>球速</th><th>IVB</th><th>横変化</th><th>Zone%</th><th>Whiff%</th><th>CSW%</th><th>Chase%</th><th>主位置</th></tr></thead><tbody>
          {sideReport.pitchTypes.map((row) => <tr key={row.pitchType} className={row.pitches < minimumSample ? "low-sample-row" : ""}><th>{row.pitchType}{row.pitches < minimumSample && <small>参考値</small>}</th><td>{row.pitches} / {row.value === null ? "—" : `${(row.value * 100).toFixed(0)}%`}</td><td>{formatScoutingNumber(row.avgVelocity)}</td><td>{formatScoutingNumber(row.avgIvb)}</td><td>{formatScoutingNumber(row.avgHb)}</td><td>{formatScoutingRate(row.zone)}</td><td>{formatScoutingRate(row.whiff)}</td><td>{formatScoutingRate(row.csw)}</td><td>{formatScoutingRate(row.chase)}</td><td>{row.mainLocation}</td></tr>)}
          {!sideReport.pitchTypes.length && <tr><td colSpan={10}>対象データなし</td></tr>}
        </tbody></table></div><div className="side-location"><h3>主な投球位置</h3><SearchPitchLocationPlot pitches={pitches.filter((row) => row.batterSide === sideReport.side)} compact showLegend={false} /></div></div>
      </article>;
    })}</div>
    <section className="rule-summary"><h3>左右差の要約</h3>{report.differences.length ? <ul>{report.differences.map((text) => <li key={text}>{text}</li>)}</ul> : <p>両側の母数を満たす大きな差（球種10pt、率指標8pt以上）はありません。</p>}<small>母数が{minimumSample}未満の項目は断定に使用していません。</small></section>
  </div></section>;
}

function SearchPitchTypeAnalysis({ pitches }: { pitches: Row[] }) {
  const [family,setFamily]=useState("すべて");const allTypes=[...new Set(pitches.map((row)=>row.pitchType))].sort();const types=family==="すべて"?allTypes:allTypes.filter((type)=>pitchFamily(type)===family);const total=Math.max(1,pitches.length);
  const summary=types.map((type)=>{const rows=pitches.filter((row)=>row.pitchType===type);const speeds=rows.map((row)=>row.velocity).filter(Number.isFinite);return {type,family:pitchFamily(type),n:rows.length,usage:rows.length/total,max:speeds.length?Math.max(...speeds):null,min:speeds.length?Math.min(...speeds):null,avg:meanOf(rows,"velocity"),right:rows.filter((row)=>row.batterSide==="右").length,left:rows.filter((row)=>row.batterSide==="左").length};});
  return <section className="search-analysis-workspace"><header><span>PITCH TYPE × SIDE</span><h2>左右・球種別投球分析</h2><p>球種はID東都の分析用正規化分類。真っすぐ系・曲がる系・落ちる系で切り替えられます。</p></header><div className="pitch-family-switch">{["すべて","真っすぐ系","曲がる系","落ちる系","その他"].map((value)=><button key={value} className={family===value?"active":""} onClick={()=>setFamily(value)}>{value}</button>)}</div><div className="table-scroll"><table className="data-table pitch-type-summary"><thead><tr><th>分類</th><th>球種</th><th>球数</th><th>使用率</th><th>最高球速</th><th>最低球速</th><th>平均球速</th><th>右打者</th><th>左打者</th></tr></thead><tbody>{summary.map((row)=><tr key={row.type}><td><span className="pitch-family-tag">{row.family}</span></td><td>{row.type}</td><td>{row.n}</td><td>{(row.usage*100).toFixed(1)}%</td><td>{row.max===null?"—":`${row.max.toFixed(1)}`}</td><td>{row.min===null?"—":`${row.min.toFixed(1)}`}</td><td>{row.avg===null?"—":`${row.avg.toFixed(1)}`}</td><td>{row.right}</td><td>{row.left}</td></tr>)}</tbody></table></div><div className="pitch-type-side-rows">{["右","左"].map((side)=><section key={side}><header><strong>{side}打者への投球</strong><span>{pitches.filter((row)=>row.batterSide===side&&types.includes(row.pitchType)).length.toLocaleString("ja-JP")}球</span></header><div className="pitch-type-plot-grid">{types.map((type)=>{const rows=pitches.filter((row)=>row.batterSide===side&&row.pitchType===type);return <article key={type}><header><span>{type}</span><b>n={rows.length}</b></header><SearchPitchLocationPlot pitches={rows} compact showLegend={false}/><small>{pitchFamily(type)}</small></article>})}</div></section>)}</div><SearchAnalysisLegend/></section>;
}

function isBallResult(row: Row) { return ["ボール","ワンバウンド","敬遠","死球"].includes(row.result); }

const COUNT_ANALYSIS_COUNTS=["0-0","1-0","2-0","3-0","0-1","1-1","2-1","3-1","0-2","1-2","2-2","3-2"];

function CountPrintHeading({ pitcherName, filters, printedAt, sample, pitches = [] }: { pitcherName: string; filters: Record<string,string>; printedAt: string; sample: number; pitches?: Row[] }) {
  return <div className="count-print-heading"><div><span>カウント別投球分析</span><strong>{pitcherName}</strong><b>{filters.team || "全大学"}・{filters.batterSide}</b></div><dl><div><dt>シーズン</dt><dd>{filters.season}</dd></div><div><dt>対象</dt><dd>{filters.opponent}</dd></div><div><dt>試合</dt><dd>{filters.game}</dd></div><div><dt>条件</dt><dd>{filters.count}・{filters.outs}</dd></div><div><dt>球種</dt><dd>{filters.pitchType}</dd></div><div><dt>期間</dt><dd>{filters.period}</dd></div><div><dt>対象球</dt><dd>n={sample.toLocaleString("ja-JP")}</dd></div><div><dt>対右／左</dt><dd>{pitches.filter(row=>row.batterSide==="右").length}／{pitches.filter(row=>row.batterSide==="左").length}球</dd></div><div><dt>投手左右</dt><dd>{[...new Set(pitches.map(row=>row.pitcherThrows).filter(Boolean))].join("・")||"不明"}</dd></div><div><dt>出力</dt><dd>{printedAt}</dd></div>{filters.details && <div><dt>詳細条件</dt><dd>{filters.details}</dd></div>}</dl></div>;
}

function CountAnalysisMatrix({ pitches, minimumSample = DEFAULT_MINIMUM_SAMPLE }: { pitches: Row[]; minimumSample?: number }) {
  const counts=COUNT_ANALYSIS_COUNTS;const types=[...new Set(pitches.map((row)=>row.pitchType))].sort((a,b)=>pitches.filter((row)=>row.pitchType===b).length-pitches.filter((row)=>row.pitchType===a).length);const countTotals=new Map(counts.map((count)=>[count,pitches.filter((row)=>`${row.balls}-${row.strikes}`===count).length]));
  const countMaxima=new Map(counts.map((count)=>[count,Math.max(0,...types.map((type)=>pitches.filter((row)=>row.pitchType===type&&`${row.balls}-${row.strikes}`===count).length))]));
  return <><div className="table-scroll count-print-matrix"><table className="count-matrix"><thead><tr><th>球種</th>{counts.map((count)=><th key={count}>{count}<span className="count-low-sample"><small>n={countTotals.get(count)}</small>{(countTotals.get(count)||0)>0&&(countTotals.get(count)||0)<minimumSample&&<small>参考値</small>}</span></th>)}<th>合計</th></tr></thead><tbody>{types.map((type)=>{const typeRows=pitches.filter((row)=>row.pitchType===type);return <tr key={type}><th>{type}</th>{counts.map((count)=>{const rows=typeRows.filter((row)=>`${row.balls}-${row.strikes}`===count);const balls=rows.filter(isBallResult).length;const total=countTotals.get(count)||0;const percentage=rows.length/Math.max(1,total)*100;const intensity=percentage>=90?" tendency-90":percentage>=80?" tendency-80":rows.length>0&&rows.length===countMaxima.get(count)?" tendency-max":"";return <td key={count} className={`${rows.length?"has-data":""}${intensity}${total>0&&total<minimumSample?" low-sample":""}`}><strong>{rows.length||"—"}</strong>{rows.length>0&&<><em>{percentage.toFixed(0)}%</em><small>B:{balls} S:{rows.length-balls}</small></>}</td>})}<td className="total"><strong>{typeRows.length}</strong><em>{(typeRows.length/Math.max(1,pitches.length)*100).toFixed(0)}%</em><small>B:{typeRows.filter(isBallResult).length} S:{typeRows.length-typeRows.filter(isBallResult).length}</small></td></tr>})}<tr className="count-total-row"><th>合計</th>{counts.map((count)=>{const rows=pitches.filter((row)=>`${row.balls}-${row.strikes}`===count);return <td key={count}><strong>{rows.length}</strong><small>B:{rows.filter(isBallResult).length} S:{rows.length-rows.filter(isBallResult).length}</small></td>})}<td><strong>{pitches.length}</strong></td></tr></tbody></table></div><div className="count-print-key"><span><i className="tendency-max"/>カウント内最多</span><span><i className="tendency-80"/>80%以上</span><span><i className="tendency-90"/>90%以上</span><span>参考値・斜線：同カウント{minimumSample}球未満</span></div></>;
}

function SearchCountAnalysis({ pitches, pitcher, filters, minimumSample }: { pitches: Row[]; pitcher?: Row; filters: Record<string, string>; minimumSample: number }) {
  const pitcherName=pitcher?.kanji||pitcher?.name||([...new Set(pitches.map((row)=>row.pitcherKanji||row.pitcher))].length===1?(pitches[0]?.pitcherKanji||pitches[0]?.pitcher):"全投手");
  const printedAt=new Intl.DateTimeFormat("ja-JP",{dateStyle:"medium",timeStyle:"short",timeZone:"Asia/Tokyo"}).format(new Date());
  const displayFilters={...filters,team:filters.team||pitcher?.team||"全大学"};
  const teamPitchers = useMemo(() => {
    if (!filters.team || filters.pitcher) return [];
    const grouped = new Map<string, { id: string; name: string; pitches: Row[] }>();
    for (const row of pitches) {
      if (row.pitcherTeam !== filters.team) continue;
      const id = String(row.pitcherId || row.pitcher);
      if (!grouped.has(id)) grouped.set(id, { id, name: row.pitcherKanji || row.pitcher, pitches: [] });
      grouped.get(id)!.pitches.push(row);
    }
    return [...grouped.values()].sort((a,b) => a.name.localeCompare(b.name,"ja"));
  }, [pitches, filters.team, filters.pitcher]);
  const [printSelection, setPrintSelection] = useState<{ team: string; ids: string[] }>({ team: filters.team, ids: [] });
  const selectedIds = printSelection.team === filters.team ? printSelection.ids : [];
  const selectedPitchers = teamPitchers.filter(row => selectedIds.includes(row.id));
  function togglePrintPitcher(id: string) {
    setPrintSelection({ team: filters.team, ids: selectedIds.includes(id) ? selectedIds.filter(value => value !== id) : [...selectedIds, id] });
  }
  function print(mode: "single" | "team") {
    if (mode === "team" && !selectedPitchers.length) return;
    void printReport(".count-print-root", "count", mode);
  }
  return <section className="search-analysis-workspace count-print-root"><div className="count-single-print-content"><CountPrintHeading pitcherName={pitcherName} filters={displayFilters} printedAt={printedAt} sample={pitches.length} pitches={pitches}/><header><div><span>COUNT ANALYSIS</span><h2>カウント別投球分析</h2><p>球種ごとの球数・割合・ボール／ストライクをカウント別に比較します。印刷はA4縦。投手ごとに改ページします。</p></div><div className="count-print-actions">{teamPitchers.length>0&&<details className="count-player-selection"><summary>印刷する選手を選択（{selectedPitchers.length}人）</summary><fieldset><legend>{filters.team}</legend><div className="count-selection-actions"><button type="button" className="secondary-button" onClick={()=>setPrintSelection({team:filters.team,ids:teamPitchers.map(row=>row.id)})}>全選択</button><button type="button" className="secondary-button" onClick={()=>setPrintSelection({team:filters.team,ids:[]})}>選択解除</button></div><div className="count-player-options">{teamPitchers.map(row=><label key={row.id}><input type="checkbox" checked={selectedIds.includes(row.id)} onChange={()=>togglePrintPitcher(row.id)}/><span>{row.name}</span></label>)}</div><button type="button" className="secondary-button count-print-button count-team-print-button" disabled={!selectedPitchers.length} onClick={()=>print("team")}>選択した選手を印刷（{selectedPitchers.length}人）</button></fieldset></details>}<button type="button" className="secondary-button count-print-button" disabled={!pitches.length} onClick={()=>print("single")}>現在の資料を印刷</button></div></header><CountAnalysisMatrix pitches={pitches} minimumSample={minimumSample}/><div className="count-plot-grid">{COUNT_ANALYSIS_COUNTS.map((count)=>{const rows=pitches.filter((row)=>`${row.balls}-${row.strikes}`===count);const swings=rows.filter(isScoutingSwing).length;return <article key={count}><header><strong>{count}</strong><span>n={rows.length}</span></header><SearchPitchLocationPlot pitches={rows} compact showLegend={false}/><footer><span>ボール {rows.filter(isBallResult).length}</span><span>スイング {swings}</span></footer></article>})}</div><SearchAnalysisLegend/></div><div className="count-bulk-print-root" aria-hidden="true">{selectedPitchers.map((row)=><article className="count-print-sheet" key={row.id}><CountPrintHeading pitcherName={row.name} filters={displayFilters} printedAt={printedAt} sample={row.pitches.length} pitches={row.pitches}/><CountAnalysisMatrix pitches={row.pitches} minimumSample={minimumSample}/></article>)}</div></section>;
}

function ApproachMetricCard({ label, metric }: { label: string; metric: RateMetric }) {
  const delta = metric.delta;
  const denominator = metric.unit === "percentage-point"
    ? `n=${metric.comparisonDenominators?.before ?? 0}/${metric.comparisonDenominators?.twoStrike ?? 0}`
    : `n=${metric.denominator ?? 0}`;
  return <article className={`approach-kpi ${metric.sampleStatus}`}><header><span>{label}</span><SampleFlag metric={metric} /></header><strong>{formatScoutingRate(metric)}</strong><div><b>{denominator}</b><span>平均との差 {delta === null || delta === undefined ? "—" : `${delta >= 0 ? "+" : ""}${(delta * 100).toFixed(1)}pt`}</span><span>{metric.percentile === null || metric.percentile === undefined ? "—" : `${metric.percentile}パーセンタイル`}</span></div><small>リーグ {formatScoutingRate({ ...metric, value: metric.leagueAverage ?? null })}</small></article>;
}

function ApproachHeatmap({ title, cells }: { title: string; cells: ReturnType<typeof buildBatterApproachReport>["heatmaps"]["beforeTwoStrikes"] }) {
  return <section className="approach-heatmap"><header><h3>{title}</h3><span>ゾーン外Swing% / n</span></header><div className="approach-heat-grid">{cells.map((cell) => {
    const intensity = cell.value ?? 0;
    const background = cell.inZone ? "#eef2f2" : cell.denominator ? `rgba(181, 42, 55, ${0.12 + intensity * 0.72})` : "#fafbfb";
    return <div key={cell.id} className={`${cell.inZone ? "in-zone" : "out-zone"} ${cell.sampleStatus}`} style={{ background }}><strong>{cell.inZone ? "ZONE" : cell.value === null ? "—" : `${(cell.value * 100).toFixed(0)}%`}</strong><small>{cell.inZone ? "対象外" : `n=${cell.denominator}`}</small></div>;
  })}</div><footer><span>捕手から見て左</span><strong>捕手視点</strong><span>捕手から見て右</span></footer></section>;
}

function BatterApproachCard({ pitches, leaguePitches, batter, minimumSample, zone, filters }: { pitches: Row[]; leaguePitches: Row[]; batter?: Row; minimumSample: number; zone: ZoneBounds; filters: Record<string, string> }) {
  if (!batter) return <section className="search-analysis-workspace approach-empty"><header><span>BATTER APPROACH CARD</span><h2>相手打者を選択してください</h2><p>上の「打者」から1人を選ぶと、初球・最初のストライク・追い込まれた後のゾーン拡張をA4横1枚で表示します。</p></header></section>;
  const report = buildBatterApproachReport(pitches, leaguePitches, minimumSample, zone);
  const metricRows: Array<[string, RateMetric]> = [
    ["初球Swing%", report.metrics.firstPitchSwing], ["First Strike Swing%", report.metrics.firstStrikeSwing],
    ["追込前Chase%", report.metrics.preTwoStrikeChase], ["2S Chase%", report.metrics.twoStrikeChase],
    ["2S Expansion Δ", report.metrics.twoStrikeExpansion], ["Contact%", report.metrics.contact],
  ];
  const pitchTypeRows = report.pitchTypes.filter((row) => row.relevance >= minimumSample);
  const rateCell = (metric: RateMetric) => metric.denominator ? <>{formatScoutingRate(metric)}{metric.sampleStatus === "reference" && <small>参考</small>}</> : <>—</>;
  return <section className="search-analysis-workspace scouting-print-root approach-card-root"><div className="scouting-print-sheet approach-print-sheet">
    <ScoutingPrintHeading title="打者アプローチカード" player={batter.kanji || batter.name} team={batter.team} filters={filters} sample={`${report.plateAppearances}打席 / ${report.pitches}球`} />
    <header><div><span>BATTER APPROACH CARD</span><h2>{batter.kanji || batter.name}を、振る条件から読む</h2><p>初球とその打席最初のストライクを分け、投球前カウントで追い込まれる前後を比較します。</p></div><button type="button" className="secondary-button scouting-print-button" onClick={() => triggerScoutingPrint("approach")}>A4横で印刷</button></header>
    <div className="approach-kpi-grid">{metricRows.map(([label, metric]) => <ApproachMetricCard key={label} label={label} metric={metric} />)}</div>
    <div className="approach-main-grid"><section className="approach-table-card"><header><h3>球種別アプローチ</h3><span>最低対象数 {minimumSample}</span></header><div className="approach-table-scroll"><table className="approach-table"><thead><tr><th>球種</th><th>初球n</th><th>初球Swing%</th><th>FS n</th><th>FS Swing%</th><th>追込前外n</th><th>追込前Chase%</th><th>2S外n</th><th>2S Chase%</th><th>Whiff%</th></tr></thead><tbody>
      {pitchTypeRows.map((row) => <tr key={row.pitchType}><th>{row.pitchType}</th><td>{row.metrics.firstPitchSwing.denominator ?? 0}</td><td>{rateCell(row.metrics.firstPitchSwing)}</td><td>{row.metrics.firstStrikeSwing.denominator ?? 0}</td><td>{rateCell(row.metrics.firstStrikeSwing)}</td><td>{row.metrics.preTwoStrikeChase.denominator ?? 0}</td><td>{rateCell(row.metrics.preTwoStrikeChase)}</td><td>{row.metrics.twoStrikeChase.denominator ?? 0}</td><td>{rateCell(row.metrics.twoStrikeChase)}</td><td>{rateCell(row.metrics.whiff)}</td></tr>)}
      {!pitchTypeRows.length && <tr><td colSpan={10}>最低対象数を満たす球種がありません。</td></tr>}
    </tbody></table></div></section><div className="approach-heatmaps"><ApproachHeatmap title="追い込まれる前" cells={report.heatmaps.beforeTwoStrikes}/><ApproachHeatmap title="2ストライク時" cells={report.heatmaps.twoStrikes}/></div></div>
    <section className="rule-summary approach-summary"><h3>配球準備メモ</h3><ul>{report.summaries.map((text) => <li key={text}>{text}</li>)}</ul><small>リーグ平均・パーセンタイルは同一シーズン、選択中の投手左右・球種条件で比較。母数{minimumSample}未満は断定に使用しません。</small></section>
    <details className="chart-definition"><summary>集計方法</summary><p>最終的なプレート通過位置だけから「ストライクからボールへ逃げた球」とは断定していません。この資料はゾーン外投球へのスイング率を正式指標として表示します。定義 {SCOUTING_DEFINITION_VERSION}</p></details>
  </div></section>;
}

function SearchAnalysisLegend() {
  const examples=["ストレート","カーブ","スライダー","フォーク","チェンジアップ","カットボール","シンカー","ツーシーム","スプリット","ナックル"];
  return <section className="search-analysis-legend"><h3>記号・色の凡例</h3><div className="search-outcome-legend"><span><i style={{background:SEARCH_RESULT_COLORS.whiff}}/>空振り</span><span><i style={{background:SEARCH_RESULT_COLORS.called}}/>見逃し</span><span><i style={{background:SEARCH_RESULT_COLORS.foul}}/>ファウル</span><span><i style={{background:SEARCH_RESULT_COLORS.out}}/>凡打</span><span><i className="white"/>ボール</span><span><i style={{background:SEARCH_RESULT_COLORS.hit}}/>安打</span><span><i style={{background:SEARCH_RESULT_COLORS.homeRun}}/>本塁打</span></div><div className="search-pitch-shape-legend">{examples.map((type)=><span key={type}><svg viewBox="0 0 24 24"><SearchPitchMarker row={{pitchType:type,pitcherThrows:"右",result:"ボール"}} x={12} y={12} size={5}/></svg>{type}</span>)}</div></section>;
}

function VisualsView({ data, navigate }: { data: Dataset; navigate: (route: RouteState) => void }) {
  const [role, setRole] = useState<"pitcher" | "batter">("pitcher");
  const candidates = role === "pitcher" ? data.pitchers : data.batters;
  const [playerId, setPlayerId] = useState(data.pitchers[0]?.id ?? "");
  useEffect(() => { if (!candidates.some((row) => row.id === playerId)) setPlayerId(candidates[0]?.id ?? ""); }, [role, data.metadata.season]);
  const player = data.players.find((row) => row.id === playerId);
  return (
    <PageSection eyebrow="可視化" title="選手ビジュアル" description="球種の変化量、投球位置、打球品質を選手単位で確認します。">
      <div className="visual-selector"><div className="segmented"><button className={role === "pitcher" ? "active" : ""} onClick={() => setRole("pitcher")}>投手</button><button className={role === "batter" ? "active" : ""} onClick={() => setRole("batter")}>打者</button></div><select value={playerId} onChange={(event) => setPlayerId(event.target.value)}><PlayerOptions players={candidates} /></select><button className="secondary-button" onClick={() => navigate({ view: "player", playerId })}>選手詳細</button></div>
      {player && <div className="chart-grid"><ChartCard title={role === "pitcher" ? "球種別変化量" : "打球方向"}>{role === "pitcher" ? <MovementChart pitches={data.pitches.filter((row) => row.pitcherId === playerId)} /> : <SprayChart pitches={data.pitches.filter((row) => row.batterId === playerId)} />}</ChartCard><ChartCard title="ゾーン別打球速度"><ZoneHeatmap pitches={data.pitches} playerId={playerId} role={role} /></ChartCard></div>}
    </PageSection>
  );
}

function CompareView({ data, navigate }: { data: Dataset; navigate: (route: RouteState) => void }) {
  const [mode, setMode] = useState<"players" | "delta">("delta");
  const [role, setRole] = useState<"pitcher" | "batter">("pitcher");
  const candidates = (role === "pitcher" ? data.pitchers.filter((row) => row.pitches >= 100) : displayedBatters(data.batters));
  const [ids, setIds] = useState<string[]>([data.pitchers[0]?.id, data.pitchers[1]?.id].filter(Boolean));
  useEffect(() => { setIds(candidates.slice(0, 2).map((row) => row.id)); }, [role, data.metadata.season]);
  const rows = candidates.filter((row) => ids.includes(row.id));
  const metrics = role === "pitcher"
    ? [["総合投球指数+", "pitchingPlus", "plus"], ["球質指数+", "stuffPlus", "plus"], ["コース指数+", "locationPlus", "plus"], ["空振り率", "whiffRate", "rate"], ["見逃し・空振り率", "cswRate", "rate"], ["推定失点率", "xera", "number"]]
    : [["打撃生産指数+", "wrcPlus", "plus"], ["推定加重出塁率", "xwoba", "decimal"], ["平均打球速度", "avgExitVelocity", "number"], ["強打率", "hardHitRate", "rate"], ["バレル率", "barrelRate", "rate"], ["空振り率", "whiffRate", "rate"]];
  const benchmarks = useMemo(() => buildLeagueBenchmarks(data), [data]);
  const roleBenchmarks = role === "pitcher" ? benchmarks.pitching : benchmarks.batting;
  function update(index: number, value: string) { const next = [...ids]; next[index] = value; setIds(next); }
  return (
    <PageSection eyebrow="選手比較" title={mode === "delta" ? "DELTA VIEW" : "選手比較"} description={mode === "delta" ? "比較する2シーズンを選び、同じ投手の球種・登板役割・打者左右をそろえて比較します。数値は改善・悪化ではなく変化として表示します。" : "同じ役割の選手を最大3人まで、主要指標とリーグ内パーセンタイルで比較します。"}>
      <div className="compare-mode-switch segmented" aria-label="比較方法"><button className={mode === "delta" ? "active" : ""} onClick={() => setMode("delta")}>DELTA VIEW</button><button className={mode === "players" ? "active" : ""} onClick={() => setMode("players")}>選手を横並び</button></div>
      {mode === "delta" ? <DeltaViewPanel initialBefore={data.metadata.season.includes("秋") && data.metadata.season.includes("2026") ? "2026-spring" : "2025-fall"} initialAfter={data.metadata.season.includes("秋") && data.metadata.season.includes("2026") ? "2026-fall" : "2026-spring"} /> : <>
        <div className="compare-controls"><div className="segmented"><button className={role === "pitcher" ? "active" : ""} onClick={() => setRole("pitcher")}>投手</button><button className={role === "batter" ? "active" : ""} onClick={() => setRole("batter")}>打者</button></div>{[0, 1, 2].map((index) => <select key={index} value={ids[index] ?? ""} onChange={(event) => update(index, event.target.value)}><option value="">選択なし</option><PlayerOptions players={candidates} /></select>)}</div>
        <div className="compare-grid">{rows.map((row) => <article className="compare-card" key={row.id}><button className="compare-name" onClick={() => navigate({ view: "player", playerId: row.id })}><PlayerName row={row} /><small>{row.team}</small></button>{metrics.map(([label, key, format]) => <div className="compare-metric" key={key}><MetricLabel label={label} metricKey={key} /><strong>{formatValue(row[key], format as Column["format"])}</strong><BenchmarkBadges benchmark={roleBenchmarks[key]} currentValue={row[key]} compact />{Number.isFinite(row.percentiles?.[key]) ? <PercentBar value={row.percentiles[key]} /> : <small>リーグ内評価は未算出</small>}</div>)}</article>)}</div>
        <BenchmarkGuide text={role === "pitcher" ? "投手100球以上" : `表示：${batterDisplayMinimum(data.batters)}打席以上／リーグ内評価：20打席以上`} />
      </>}
    </PageSection>
  );
}

type DeltaRoleFilter = "all" | "starter" | "reliever";
type DeltaSideFilter = "all" | "右" | "左";
type DeltaSummary = {
  pitches: number;
  pa: number;
  avgVelocity: number | null;
  avgIvb: number | null;
  avgHb: number | null;
  avgVaa: number | null;
  avgExtension: number | null;
  avgReleaseHeight: number | null;
  avgReleaseSide: number | null;
  releaseSd: number | null;
  kMinusBbRate: number | null;
  cswRate: number | null;
  avgExitVelocityAllowed: number | null;
  actualExpectedGap: number | null;
};

function deltaPlayerKey(row: Row) {
  return `${row.team}|${normalizeSearch(row.romanName ?? row.name ?? row.kanji ?? "")}`;
}

function isDeltaTerminalPitch(row: Row) {
  return ["Strikeout", "Walk", "Waik"].includes(row.korbb) || ["インプレー", "死球", "敬遠"].includes(row.result);
}

function deltaActualWobaWeight(row: Row) {
  if (["Walk", "Waik"].includes(row.korbb) || row.result === "敬遠") return 0.69;
  if (row.result === "死球") return 0.72;
  if (row.playResult === "単打") return 0.88;
  if (row.playResult === "二塁打") return 1.247;
  if (row.playResult === "三塁打") return 1.578;
  if (row.playResult === "本塁打") return 2.031;
  return 0;
}

function deltaExpectedWobaWeight(row: Row) {
  if (["Walk", "Waik"].includes(row.korbb) || row.result === "敬遠") return 0.69;
  if (row.result === "死球") return 0.72;
  return Number.isFinite(row.expectedWoba) ? row.expectedWoba : 0;
}

function summarizeDeltaPitcher(data: Dataset, player: Row, pitchType: string, role: DeltaRoleFilter, side: DeltaSideFilter): DeltaSummary {
  const playerPitches = data.pitches.filter((row) => row.pitcherId === player.id);
  const firstInningByGame = new Map<string, number>();
  playerPitches.forEach((row) => {
    const inning = Number(row.inning);
    if (!Number.isFinite(inning)) return;
    const current = firstInningByGame.get(row.gameId);
    if (current === undefined || inning < current) firstInningByGame.set(row.gameId, inning);
  });
  const sameRole = playerPitches.filter((row) => {
    if (role === "all") return true;
    const appearanceRole = firstInningByGame.get(row.gameId) === 1 ? "starter" : "reliever";
    return appearanceRole === role;
  });
  const sameSide = sameRole.filter((row) => side === "all" || row.batterSide === side);
  const shapePitches = sameSide.filter((row) => row.pitchType === pitchType);
  const terminal = sameSide.filter(isDeltaTerminalPitch);
  const strikeouts = terminal.filter((row) => row.korbb === "Strikeout").length;
  const walks = terminal.filter((row) => ["Walk", "Waik"].includes(row.korbb) || row.result === "敬遠").length;
  const csw = shapePitches.filter((row) => row.result === "空振り" || row.result === "見逃しストライク").length;
  const batted = shapePitches.filter((row) => Number.isFinite(row.exitVelocity));
  const releaseHeightSd = sdOf(shapePitches, "releaseHeight");
  const releaseSideSd = sdOf(shapePitches, "releaseSide");
  const actualWoba = terminal.length ? terminal.reduce((sum, row) => sum + deltaActualWobaWeight(row), 0) / terminal.length : null;
  const expectedWoba = terminal.length ? terminal.reduce((sum, row) => sum + deltaExpectedWobaWeight(row), 0) / terminal.length : null;
  return {
    pitches: shapePitches.length,
    pa: terminal.length,
    avgVelocity: meanOf(shapePitches, "velocity"),
    avgIvb: meanOf(shapePitches, "ivb"),
    avgHb: meanOf(shapePitches, "hb"),
    avgVaa: meanOf(shapePitches, "vaa"),
    avgExtension: meanOf(shapePitches, "extension"),
    avgReleaseHeight: meanOf(shapePitches, "releaseHeight"),
    avgReleaseSide: meanOf(shapePitches, "releaseSide"),
    releaseSd: releaseHeightSd !== null && releaseSideSd !== null ? Math.hypot(releaseHeightSd, releaseSideSd) : null,
    kMinusBbRate: terminal.length ? (strikeouts - walks) / terminal.length : null,
    cswRate: shapePitches.length ? csw / shapePitches.length : null,
    avgExitVelocityAllowed: meanOf(batted, "exitVelocity"),
    actualExpectedGap: actualWoba !== null && expectedWoba !== null ? actualWoba - expectedWoba : null,
  };
}

function deltaMetricValue(value: number | null, format: Column["format"], unit = "") {
  if (value === null) return "—";
  return `${formatValue(value, format)}${unit}`;
}

function deltaChangeValue(fall: number | null, spring: number | null, format: Column["format"], unit = "") {
  if (fall === null || spring === null) return "—";
  const change = spring - fall;
  const sign = change > 0 ? "+" : "";
  if (format === "rate") return `${sign}${(change * 100).toFixed(1)}pt`;
  if (format === "decimal") return `${sign}${change.toFixed(3).replace(/^(-?)0/, "$1")}`;
  return `${sign}${change.toFixed(1)}${unit}`;
}

function DeltaMetricCard({ label, metricKey, fall, spring, format = "number", unit = "", note, beforeLabel, afterLabel }: { label: string; metricKey?: string; fall: number | null; spring: number | null; format?: Column["format"]; unit?: string; note?: string; beforeLabel: string; afterLabel: string }) {
  return <article className="delta-metric-card"><header>{metricKey ? <MetricLabel label={label} metricKey={metricKey} /> : <span>{label}</span>}{note && <small>{note}</small>}</header><div className="delta-values"><div><span>{beforeLabel}</span><strong>{deltaMetricValue(fall, format, unit)}</strong></div><div className="delta-change"><span>変化</span><b>{deltaChangeValue(fall, spring, format, unit)}</b></div><div><span>{afterLabel}</span><strong>{deltaMetricValue(spring, format, unit)}</strong></div></div></article>;
}

function DeltaViewPanel({ initialBefore = "2026-spring", initialAfter = "2026-fall" }: { initialBefore?: SeasonKey; initialAfter?: SeasonKey }) {
  const [beforeSeason, setBeforeSeason] = useState<SeasonKey>(initialBefore);
  const [afterSeason, setAfterSeason] = useState<SeasonKey>(initialAfter);
  const [retry, setRetry] = useState(0);
  const beforeLabel = SEASONS[beforeSeason].label, afterLabel = SEASONS[afterSeason].label;
  const [datasets, setDatasets] = useState<{ fall: Dataset; spring: Dataset } | null>(null);
  const [loadError, setLoadError] = useState("");
  const [playerKey, setPlayerKey] = useState("");
  const [pitchType, setPitchType] = useState("ストレート");
  const [role, setRole] = useState<DeltaRoleFilter>("all");
  const [side, setSide] = useState<DeltaSideFilter>("all");

  useEffect(() => {
    let active = true;
    setDatasets(null); setLoadError(""); setPlayerKey("");
    Promise.all([
      loadStaticDataset<Dataset>(SEASONS[beforeSeason].path),
      loadStaticDataset<Dataset>(SEASONS[afterSeason].path),
    ]).then(([fall, spring]) => { if (active) setDatasets({ fall, spring }); })
      .catch(() => { if (active) setLoadError("シーズン比較データを読み込めませんでした。"); });
    return () => { active = false; };
  }, [beforeSeason, afterSeason, retry]);

  const pairs = useMemo(() => {
    if (!datasets) return [] as { key: string; fall: Row; spring: Row }[];
    const springByKey = new Map(datasets.spring.pitchers.map((row) => [deltaPlayerKey(row), row]));
    return datasets.fall.pitchers.map((fall) => ({ key: deltaPlayerKey(fall), fall, spring: springByKey.get(deltaPlayerKey(fall)) }))
      .filter((pair): pair is { key: string; fall: Row; spring: Row } => pair.spring !== undefined && pair.fall.pitches >= 20 && pair.spring.pitches >= 20)
      .sort((a, b) => String(a.fall.team).localeCompare(String(b.fall.team), "ja") || String(a.fall.kanji ?? a.fall.name).localeCompare(String(b.fall.kanji ?? b.fall.name), "ja"));
  }, [datasets]);

  useEffect(() => {
    if (!pairs.length || pairs.some((pair) => pair.key === playerKey)) return;
    const ohtsubo = pairs.find((pair) => normalizeSearch(pair.fall.romanName ?? pair.fall.name).includes("ohtsuboren"));
    setPlayerKey((ohtsubo ?? pairs[0]).key);
  }, [pairs, playerKey]);

  const pair = pairs.find((row) => row.key === playerKey) ?? pairs[0] ?? null;
  const pitchTypes = useMemo(() => {
    if (!datasets || !pair) return [] as string[];
    const fallTypes = new Set(datasets.fall.pitches.filter((row) => row.pitcherId === pair.fall.id).map((row) => row.pitchType));
    const springTypes = new Set(datasets.spring.pitches.filter((row) => row.pitcherId === pair.spring.id).map((row) => row.pitchType));
    return [...fallTypes].filter((value) => springTypes.has(value)).sort((a, b) => (a === "ストレート" ? -1 : b === "ストレート" ? 1 : a.localeCompare(b, "ja")));
  }, [datasets, pair]);

  useEffect(() => { if (pitchTypes.length && !pitchTypes.includes(pitchType)) setPitchType(pitchTypes[0]); }, [pitchTypes, pitchType]);

  const seasonControls = <div className="delta-controls"><label>比較元<select value={beforeSeason} onChange={(event) => setBeforeSeason(event.target.value as SeasonKey)}>{Object.entries(SEASONS).map(([key, value]) => <option key={key} value={key} disabled={key === afterSeason}>{value.label}</option>)}</select></label><label>比較先<select value={afterSeason} onChange={(event) => setAfterSeason(event.target.value as SeasonKey)}>{Object.entries(SEASONS).map(([key, value]) => <option key={key} value={key} disabled={key === beforeSeason}>{value.label}</option>)}</select></label></div>;
  if (loadError) return <div>{seasonControls}<div className="empty-state"><h2>{loadError}</h2><button className="secondary-button" onClick={() => setRetry(value => value + 1)}>再読み込み</button></div></div>;
  if (!datasets) return <div>{seasonControls}<div className="delta-loading"><div className="loader" /><p>比較データを準備しています</p></div></div>;
  if (!pair) return <div>{seasonControls}<p className="empty-state">両シーズンに20球以上の記録がある同一投手がいません。比較するシーズンを変更してください。</p></div>;

  const fall = summarizeDeltaPitcher(datasets.fall, pair.fall, pitchType, role, side);
  const spring = summarizeDeltaPitcher(datasets.spring, pair.spring, pitchType, role, side);
  const shapeMetrics = [
    ["平均球速", "avgVelocity", "number", " km/h", "avgVelocity"],
    ["IVB", "avgIvb", "number", " cm", "avgIvb"],
    ["横変化", "avgHb", "number", " cm", "avgHb"],
    ["VAA", "avgVaa", "number", "°", "avgVaa"],
    ["エクステンション", "avgExtension", "number", " cm", "avgExtension"],
    ["リリース高", "avgReleaseHeight", "number", " cm", "avgReleaseHeight"],
    ["リリース横", "avgReleaseSide", "number", " cm", "avgReleaseSide"],
    ["リリース位置SD", "releaseSd", "number", " cm", "releaseSd"],
  ] as const;
  const outcomeMetrics = [
    ["K-BB%", "kMinusBbRate", "rate", "", "kMinusBbRate", "選択役割・打者左右の全球種"],
    ["CSW%", "cswRate", "rate", "", "cswRate", `選択中の${pitchType}`],
    ["平均被打球速度", "avgExitVelocityAllowed", "number", " km/h", "avgExitVelocityAllowed", `選択中の${pitchType}`],
    ["実wOBA－推定wOBA", "actualExpectedGap", "decimal", "", "", "選択役割・打者左右の全球種"],
  ] as const;

  return <div className="delta-view">
    {seasonControls}
    <div className="delta-controls">
      <label>投手<select value={playerKey} onChange={(event) => setPlayerKey(event.target.value)}><PlayerOptions players={pairs.map(row => ({...row.fall, key: row.key}))} valueKey="key" /></select></label>
      <label>球種<select value={pitchType} onChange={(event) => setPitchType(event.target.value)}>{pitchTypes.map((value) => <option key={value}>{value}</option>)}</select></label>
      <label>登板役割<select value={role} onChange={(event) => setRole(event.target.value as DeltaRoleFilter)}><option value="all">すべて</option><option value="starter">先発</option><option value="reliever">救援</option></select></label>
      <label>打者左右<select value={side} onChange={(event) => setSide(event.target.value as DeltaSideFilter)}><option value="all">すべて</option><option value="右">右打者</option><option value="左">左打者</option></select></label>
    </div>
    <div className="delta-player-head"><PlayerName row={pair.spring} /><span>{pair.spring.team}</span><div><b>{beforeLabel} {fall.pitches}球</b><i>→</i><b>{afterLabel} {spring.pitches}球</b><small>選択球種・条件の球数</small></div></div>
    {(fall.pitches < 10 || spring.pitches < 10) && <div className="sample-alert">片方のシーズンが10球未満です。変化は参考値として見てください。</div>}
    <SectionTitle title={`${pitchType}の形状・リリース変化`} />
    <div className="delta-metric-grid">{shapeMetrics.map(([label, key, format, unit, metricKey]) => <DeltaMetricCard beforeLabel={beforeLabel} afterLabel={afterLabel} key={key} label={label} metricKey={metricKey} fall={fall[key]} spring={spring[key]} format={format} unit={unit} />)}</div>
    <SectionTitle title="投球結果と内容の変化" />
    <div className="delta-metric-grid outcome">{outcomeMetrics.map(([label, key, format, unit, metricKey, note]) => <DeltaMetricCard beforeLabel={beforeLabel} afterLabel={afterLabel} key={key} label={label} metricKey={metricKey || undefined} fall={fall[key]} spring={spring[key]} format={format} unit={unit} note={note} />)}</div>
    <details className="method-card chart-definition"><summary>DELTA VIEWの読み方</summary><p>差は「{afterLabel}－{beforeLabel}」です。プラス・マイナスを良否として色分けせず、変化量だけを示します。先発はその試合で1回から投げた投手として推定しています。K-BB%と実績－推定差は選択した登板役割・打者左右の全球種、CSW%と平均被打球速度は選択球種で集計しています。</p></details>
  </div>;
}

function StatsView({ data, navigate }: { data: Dataset; navigate: (route: RouteState) => void }) {
  const columns: Column[] = [
    { key: "name", label: "大学" }, { key: "games", label: "試合" }, { key: "wins", label: "勝" },
    { key: "losses", label: "敗" }, { key: "wrcPlus", label: "打撃生産指数+", format: "plus" },
    { key: "homeRuns", label: "本塁打" }, { key: "pitchingPlus", label: "総合投球指数+", format: "plus" },
    { key: "pitchValuePer100", label: "100球得点価値" },
  ];
  const mean = (key: string) => {
    const values = data.teams.map((row) => numericValue(row[key])).filter((value): value is number => value !== null);
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  };
  const leagueAverageRow = {
    isLeagueAverage: true,
    name: "リーグ平均",
    games: mean("games"),
    wins: mean("wins"),
    losses: mean("losses"),
    wrcPlus: 100,
    homeRuns: mean("homeRuns"),
    pitchingPlus: 100,
    pitchValuePer100: mean("pitchValuePer100"),
  };
  return (
    <PageSection eyebrow="リーグ統計" title={`${data.metadata.season} 大学別比較`} description="最下段にリーグ平均を表示しています。下線と i が付いた指標名を押すと、意味・計算・見方・注意点が開きます。">
      <SimpleTable rows={[...data.teams, leagueAverageRow]} columns={columns} rowKey="name" />
      <details className="chart-definition"><summary>集計条件</summary><p>指数系はリーグ平均を100、勝敗・試合・本塁打・100球得点価値は6大学の単純平均で表示しています。</p></details>
      <LeagueComparison data={data} />
      <div className="center-action"><button className="secondary-button" onClick={() => navigate({ view: "glossary" })}>すべての指標解説を見る</button></div>
    </PageSection>
  );
}

function batterPitchTypeRows(data: Dataset) {
  const groups = new Map<string, Row>();
  const playersById = new Map(data.players.map(player => [player.id, player]));
  for (const pitch of data.pitches) {
    const key = `${pitch.batterId}|${pitch.pitchType}`;
    const player = playersById.get(pitch.batterId);
    const row = groups.get(key) ?? { batterId: pitch.batterId, batter: pitch.batter, team: pitch.batterTeam, pitchType: pitch.pitchType, pitches: 0, swings: 0, whiffs: 0, bbe: 0, evSum: 0, hardHit: 0 };
    row.pitches += 1;
    const swing = ["空振り", "インプレー", "ファウル", "ファウルフライ"].includes(pitch.result);
    if (swing) row.swings += 1;
    if (pitch.result === "空振り") row.whiffs += 1;
    if (isMeasuredFairBall(pitch)) { row.bbe += 1; row.evSum += pitch.exitVelocity; if (pitch.exitVelocity >= 152.9) row.hardHit += 1; }
    row.side = player?.batting?.side;
    row.kanji = player?.kanji || pitch.batterKanji;
    groups.set(key, row);
  }
  return [...groups.values()].map((row) => ({ ...row, swingRate: row.swings / row.pitches, whiffRate: row.swings ? row.whiffs / row.swings : null, avgExitVelocity: row.bbe ? row.evSum / row.bbe : null, hardHitRate: row.bbe ? row.hardHit / row.bbe : null }));
}

function pitchingTempoRows(data: Dataset) {
  const aggregates = new Map<string, { sum: number; n: number }>();
  const last = new Map<string, number>();
  const seconds = (value: string) => { const parts = String(value ?? "").split(":").map(Number); return parts.length === 3 && parts.every(Number.isFinite) ? parts[0] * 3600 + parts[1] * 60 + parts[2] : null; };
  for (const pitch of data.pitches) {
    const current = seconds(pitch.time);
    if (current === null) continue;
    const key = `${pitch.gameId}|${pitch.pitcherId}`;
    const previous = last.get(key);
    if (previous !== undefined) {
      const difference = current - previous;
      if (difference >= 5 && difference <= 40) {
        const aggregate = aggregates.get(pitch.pitcherId) ?? { sum: 0, n: 0 };
        aggregate.sum += difference; aggregate.n += 1; aggregates.set(pitch.pitcherId, aggregate);
      }
    }
    last.set(key, current);
  }
  return data.pitchers.map((pitcher) => { const aggregate = aggregates.get(pitcher.id); return { ...pitcher, tempoSamples: aggregate?.n ?? 0, avgPitchInterval: aggregate?.n ? aggregate.sum / aggregate.n : null }; });
}

function boardConfig(data: Dataset, board: string): { rows: Row[]; columns: Column[]; minKey: string; minDefault: number; playerKey: string; defaultSort: string; defaultDirection: "asc" | "desc" } {
  const battingBase: Column[] = [{ key: "name", label: "打者", player: true }, { key: "team", label: "大学" }, { key: "pa", label: "打席" }, { key: "bbe", label: "有効打球数" }];
  const pitchingBase: Column[] = [{ key: "name", label: "投手", player: true }, { key: "team", label: "大学" }, { key: "pitches", label: "球数" }];
  const configs: Record<string, Column[]> = {
    batting_profile: [...battingBase, { key: "battingAverage", label: "打率", format: "decimal" }, { key: "avgExitVelocity", label: "平均打球速度" }, { key: "avgLaunchAngle", label: "平均打球角度" }, { key: "hardHitRate", label: "強打率", format: "rate" }, { key: "sweetSpotRate", label: "適正角度率", format: "rate" }],
    batting_ev: [...battingBase, { key: "avgExitVelocity", label: "平均打球速度" }, { key: "maxExitVelocity", label: "最高打球速度" }, { key: "ev90", label: "上位10%打球速度" }, { key: "barrelRate", label: "バレル率", format: "rate" }, { key: "hardHitRate", label: "強打率", format: "rate" }],
    batting_expected: [...battingBase, { key: "xba", label: "推定打率", format: "decimal" }, { key: "xslg", label: "推定長打率", format: "decimal" }, { key: "xwoba", label: "推定加重出塁率", format: "decimal" }, { key: "woba", label: "加重出塁率", format: "decimal" }],
    batting_hr: [...battingBase, { key: "homeRuns", label: "本塁打" }, { key: "maxDistance", label: "最長飛距離" }, { key: "maxExitVelocity", label: "最高打球速度" }, { key: "barrelRate", label: "バレル率", format: "rate" }],
    batting_percentile: [...battingBase, { key: "wrcPlus", label: "打撃生産指数+", format: "plus" }, { key: "xwoba", label: "推定加重出塁率", format: "decimal" }, { key: "avgExitVelocity", label: "平均打球速度" }, { key: "chaseRate", label: "ボール球スイング率", format: "rate" }, { key: "whiffRate", label: "空振り率", format: "rate" }],
    batting_pitch_types: [{ key: "batter", label: "打者", player: true }, { key: "team", label: "大学" }, { key: "pitchType", label: "球種" }, { key: "pitches", label: "球数" }, { key: "bbe", label: "有効打球数" }, { key: "swingRate", label: "スイング率", format: "rate" }, { key: "whiffRate", label: "空振り率", format: "rate" }, { key: "avgExitVelocity", label: "平均打球速度" }, { key: "hardHitRate", label: "強打率", format: "rate" }],
    batting_value: [...battingBase, { key: "wrcPlus", label: "打撃生産指数+", format: "plus" }, { key: "woba", label: "加重出塁率", format: "decimal" }, { key: "ops", label: "出塁率＋長打率", format: "decimal" }],
    pitching_profile: [...pitchingBase, { key: "avgExitVelocityAllowed", label: "平均被打球速度" }, { key: "hardHitRateAllowed", label: "被強打率", format: "rate" }, { key: "barrelRateAllowed", label: "被バレル率", format: "rate" }, { key: "heartRate", label: "真ん中率", format: "rate" }],
    pitching_ev: [...pitchingBase, { key: "avgExitVelocityAllowed", label: "平均被打球速度" }, { key: "hardHitRateAllowed", label: "被強打率", format: "rate" }, { key: "barrelRateAllowed", label: "被バレル率", format: "rate" }, { key: "maxVelocity", label: "最高球速" }],
    pitching_expected: [...pitchingBase, { key: "era", label: "失点率" }, { key: "xera", label: "推定失点率" }, { key: "xwobaAllowed", label: "推定被加重出塁率", format: "decimal" }, { key: "whip", label: "1回あたり走者" }],
    pitching_hr: [...pitchingBase, { key: "homeRuns", label: "被本塁打" }, { key: "barrelRateAllowed", label: "被バレル率", format: "rate" }, { key: "heartRate", label: "真ん中率", format: "rate" }],
    pitching_percentile: [...pitchingBase, { key: "pitchingPlus", label: "総合投球指数+", format: "plus" }, { key: "stuffPlus", label: "球質指数+", format: "plus" }, { key: "locationPlus", label: "コース指数+", format: "plus" }, { key: "whiffRate", label: "空振り率", format: "rate" }, { key: "cswRate", label: "見逃し・空振り率", format: "rate" }],
    pitching_value: [...pitchingBase, { key: "pitchValuePer100", label: "100球得点価値" }, { key: "pitchValue", label: "得点価値" }, { key: "kMinusBbRate", label: "三振率－四球率", format: "rate" }],
    pitching_arsenal: [{ key: "pitcher", label: "投手", player: true }, { key: "team", label: "大学" }, { key: "pitchType", label: "球種" }, { key: "pitches", label: "球数" }, { key: "usageRate", label: "使用率", format: "rate" }, { key: "avgVelocity", label: "平均球速" }, { key: "stuffPlus", label: "球質指数+", format: "plus" }, { key: "pitchingPlus", label: "総合投球指数+", format: "plus" }],
    pitching_movement: [{ key: "pitcher", label: "投手", player: true }, { key: "team", label: "大学" }, { key: "pitchType", label: "球種" }, { key: "pitches", label: "球数" }, { key: "avgIvb", label: "縦変化" }, { key: "avgHb", label: "横変化" }, { key: "avgVaa", label: "進入角" }, { key: "avgExtension", label: "エクステンション" }],
    pitching_angle: [{ key: "pitcher", label: "投手", player: true }, { key: "team", label: "大学" }, { key: "pitchType", label: "球種" }, { key: "pitches", label: "球数" }, { key: "avgReleaseHeight", label: "リリース高" }, { key: "avgReleaseSide", label: "リリース横" }, { key: "avgVerticalReleaseAngle", label: "縦リリース角" }, { key: "avgHorizontalReleaseAngle", label: "横リリース角" }],
    pitching_spin: [{ key: "pitcher", label: "投手", player: true }, { key: "team", label: "大学" }, { key: "pitchType", label: "球種" }, { key: "pitches", label: "球数" }, { key: "avgSpin", label: "平均回転数" }, { key: "avgIvb", label: "縦変化" }, { key: "avgHb", label: "横変化" }],
    pitching_tempo: [...pitchingBase, { key: "tempoSamples", label: "計測間隔数" }, { key: "avgPitchInterval", label: "平均投球間隔", format: "time" }, { key: "firstPitchStrikeRate", label: "初球ストライク率", format: "rate" }],
    catching_framing: [{ key: "name", label: "捕手", player: true }, { key: "team", label: "大学" }, { key: "received", label: "捕球数" }, { key: "shadowPitches", label: "境界球" }, { key: "actualStrikeRate", label: "実ストライク率", format: "rate" }, { key: "expectedStrikeRate", label: "期待ストライク率", format: "rate" }, { key: "extraStrikes", label: "追加ストライク" }, { key: "framingRuns", label: "フレーミング得点" }, { key: "framingPer1000", label: "境界1000球換算" }],
    catching_pop: [{ key: "name", label: "捕手", player: true }, { key: "team", label: "大学" }, { key: "popTimeSamples", label: "二塁送球数" }, { key: "avgPopTime", label: "平均ポップタイム", format: "seconds" }, { key: "fastestPopTime", label: "最速ポップタイム", format: "seconds" }, { key: "medianPopTime", label: "中央値ポップタイム", format: "seconds" }],
  };
  const isPitchType = board.startsWith("pitching_") && ["pitching_arsenal", "pitching_movement", "pitching_angle", "pitching_spin"].includes(board);
  const isCatcher = board.startsWith("catching_");
  const isFraming = board === "catching_framing";
  const isPopTime = board === "catching_pop";
  const isBatterPitchType = board === "batting_pitch_types";
  const isTempo = board === "pitching_tempo";
  const defaultSorts: Record<string, [string, "asc" | "desc"]> = {
    batting_profile: ["avgExitVelocity", "desc"], batting_ev: ["ev90", "desc"],
    batting_expected: ["xwoba", "desc"], batting_hr: ["homeRuns", "desc"],
    batting_percentile: ["wrcPlus", "desc"], batting_value: ["wrcPlus", "desc"],
    batting_pitch_types: ["avgExitVelocity", "desc"],
    pitching_profile: ["avgExitVelocityAllowed", "asc"], pitching_ev: ["hardHitRateAllowed", "asc"],
    pitching_expected: ["xera", "asc"], pitching_hr: ["homeRuns", "asc"],
    pitching_percentile: ["pitchingPlus", "desc"], pitching_value: ["pitchValuePer100", "desc"],
    pitching_arsenal: ["stuffPlus", "desc"], pitching_movement: ["avgIvb", "desc"],
    pitching_angle: ["avgReleaseHeight", "desc"], pitching_spin: ["avgSpin", "desc"],
    pitching_tempo: ["avgPitchInterval", "asc"],
    catching_framing: ["framingRuns", "desc"],
    catching_pop: ["fastestPopTime", "asc"],
  };
  const selectedColumns = configs[board] ?? configs.pitching_percentile;
  const [defaultSort, defaultDirection] = defaultSorts[board] ?? [selectedColumns[selectedColumns.length - 1]?.key ?? "pitches", "desc"];
  return {
    rows: isBatterPitchType ? batterPitchTypeRows(data) : isTempo ? pitchingTempoRows(data) : isPitchType ? data.pitchTypes : isCatcher ? data.catchers : board.startsWith("batting_") ? data.batters : data.pitchers,
    columns: selectedColumns,
    minKey: isPitchType || isBatterPitchType ? "pitches" : isFraming ? "shadowPitches" : isPopTime ? "popTimeSamples" : isCatcher ? "received" : board.startsWith("batting_") ? "pa" : "pitches",
    minDefault: isBatterPitchType ? (batterDisplayMinimum(data.batters) === 1 ? 1 : 25) : isPitchType ? 25 : isPopTime ? 1 : isCatcher ? 100 : board.startsWith("batting_") ? batterDisplayMinimum(data.batters) : 100,
    playerKey: isBatterPitchType ? "batterId" : isPitchType ? "pitcherId" : "id",
    defaultSort,
    defaultDirection,
  };
}

function LeaderboardsView({ data, board, navigate }: { data: Dataset; board: string; navigate: (route: RouteState) => void }) {
  const config = useMemo(() => boardConfig(data, board), [data, board]);
  const [team, setTeam] = useState("");
  const [minimum, setMinimum] = useState(config.minDefault);
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState(config.defaultSort);
  const [direction, setDirection] = useState<"asc" | "desc">(config.defaultDirection);
  useEffect(() => { setMinimum(config.minDefault); setSortKey(config.defaultSort); setDirection(config.defaultDirection); }, [board, data.metadata.season]);
  const normalizedQuery = normalizeSearch(query);
  const rows = config.rows.filter((row) => (row[config.minKey] ?? 0) >= minimum && (!team || row.team === team) && (!normalizedQuery || [row.kanji,row.romanName,row.name,row.pitcher,row.team,row.pitchType,...(row.aliases??[])].some((value)=>normalizeSearch(String(value??"")).includes(normalizedQuery))))
    .sort((a, b) => { const av = a[sortKey] ?? -Infinity; const bv = b[sortKey] ?? -Infinity; if (typeof av === "string") return direction === "asc" ? av.localeCompare(bv) : bv.localeCompare(av); return direction === "asc" ? av - bv : bv - av; });
  function sort(key: string) { if (sortKey === key) setDirection(direction === "desc" ? "asc" : "desc"); else { setSortKey(key); setDirection("desc"); } }
  return (
    <PageSection eyebrow="ランキング" title={BOARD_LABELS[board] ?? "投球・パーセンタイル"} description={board === "catching_pop" ? "二塁送球のポップタイムを捕手別に比較します。初期表示は最速値の速い順です。" : "列名で並べ替えできます。下線付きの指標名を押すと説明が開きます。規定値と大学も変更できます。"}>
      <div className="leader-layout">
        <aside className="leader-menu">{NAV_SECTIONS.map((section) => <div key={section.title}><h3>{section.title}</h3>{section.items.map(([label, key]) => <button className={key === board ? "active" : ""} key={key} onClick={() => navigate({ view: "leaders", board: key })}>{label}</button>)}</div>)}</aside>
        <div className="leader-content">
          {board.startsWith("batting_") && <details className="chart-definition"><summary>集計条件</summary><p>{batterDisplayMinimum(data.batters) === 1 ? "20打席に達した打者がまだいないため、1打席以上から表示しています。" : "最低打席数を変更すると、出場の少ない打者も表示できます。"} 20打席未満は参考値です。打球未計測の項目は「—」で表示します。</p></details>}
          <div className="toolbar leaderboard-toolbar"><label>大学<select value={team} onChange={(event) => setTeam(event.target.value)}><option value="">すべて</option>{data.teams.map((row) => <option key={row.name}>{row.name}</option>)}</select></label><label>最低{config.minKey === "pa" ? "打席" : config.minKey === "received" ? "捕球" : config.minKey === "shadowPitches" ? "境界球" : config.minKey === "popTimeSamples" ? "二塁送球" : "球数"}<input type="number" min="0" value={minimum} onChange={(event) => setMinimum(Number(event.target.value))} /></label><label>選手検索<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="選手名" /></label><span>{rows.length}人</span></div>
          <div className="table-scroll"><table className="data-table leaderboard-table"><thead><tr><th>順位</th>{config.columns.map((column) => <th key={column.key} aria-sort={sortKey === column.key ? (direction === "asc" ? "ascending" : "descending") : "none"}><div className="leader-column-head">{getMetricInfo(column.key, column.label) ? <MetricLabel label={column.label} metricKey={column.key} /> : <button type="button" onClick={() => sort(column.key)}>{column.label}</button>}<button className="sort-control" type="button" data-direction={sortKey === column.key ? direction : "none"} onClick={() => sort(column.key)} aria-label={`${column.label}を${sortKey === column.key && direction === "desc" ? "昇順" : "降順"}に並べ替え`}><svg viewBox="0 0 16 20" width="16" height="20" aria-hidden="true" focusable="false"><path className="sort-up" d="m4 7 4-4 4 4"/><path className="sort-down" d="m4 13 4 4 4-4"/></svg></button></div></th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={`${row[config.playerKey]}-${row.pitchType ?? ""}-${index}`}><td className="rank-cell">{index + 1}</td>{config.columns.map((column) => <td key={column.key}>{column.player ? <button className="text-link" onClick={() => navigate({ view: "player", playerId: row[config.playerKey] })}>{row.kanji || row.pitcherKanji || row.batterKanji || row[column.key]}</button> : formatValue(row[column.key], column.format)}</td>)}</tr>)}</tbody></table></div>
          {!rows.length && <div className="empty-state"><p>現在の条件に合う記録がありません。</p><button className="secondary-button" onClick={() => { setMinimum(0); setTeam(""); setQuery(""); }}>条件を解除して収録済みの記録を表示</button></div>}
          {board === "catching_pop" && <details className="method-card chart-definition"><summary>二塁送球の集計条件</summary><p>二塁への送球と判定できる記録のうち、ポップタイム1.60〜2.50秒で、捕球・リリース信頼度がLowではない送球を集計しています。最速値は最大出力、中央値は外れ値の影響を抑えた代表値です。送球数が少ない捕手は参考値として見てください。</p></details>}
        </div>
      </div>
    </PageSection>
  );
}

function qualityBand(value: number | null) {
  if (!Number.isFinite(value)) return "—";
  const score = Math.round(value as number);
  if (score >= 115) return "非常に優秀";
  if (score >= 105) return "平均以上";
  if (score >= 95) return "平均付近";
  if (score >= 85) return "平均以下";
  return "改善余地";
}

function QualityScore({ label, metricKey, value }: { label: string; metricKey: string; value: number }) {
  const width = Math.max(4, Math.min(100, ((value - 70) / 60) * 100));
  return <div className="quality-score"><span><MetricLabel label={label} metricKey={metricKey} /><small>{qualityBand(value)}</small></span><strong>{formatValue(value, "plus")}</strong><i><b style={{ width: `${width}%` }} /></i></div>;
}

function QualityFactors({ row }: { row: Row }) {
  return <div className="quality-factors"><span className="positive">強み：{row.qualityStrength ?? "—"}</span><span className="negative">改善：{row.qualityRisk ?? "—"}</span></div>;
}

function PitchQualityView({ data, navigate }: { data: Dataset; navigate: (route: RouteState) => void }) {
  const [mode, setMode] = useState<"pitch" | "pitcher">("pitch");
  const [team, setTeam] = useState("");
  const [pitchType, setPitchType] = useState("");
  const [minimum, setMinimum] = useState(25);
  const [query, setQuery] = useState("");
  const needle = normalizeSearch(query);
  const pitchTypes = [...new Set(data.pitchTypes.map((row) => row.pitchType))];
  const source = mode === "pitch" ? data.pitchTypes : data.pitchers;
  const rows = source.filter((row) => (row.pitches ?? 0) >= minimum && (!team || row.team === team) && (mode === "pitcher" || !pitchType || row.pitchType === pitchType) && (!needle || [row.kanji,row.pitcherKanji,row.name,row.pitcher,row.team,row.pitchType].some((value)=>normalizeSearch(String(value??"")).includes(needle))))
    .sort((a,b)=>(b.pitchingPlus??-Infinity)-(a.pitchingPlus??-Infinity));
  return <PageSection eyebrow="PITCH QUALITY / TOHTO MODEL" title="投球品質" description="球質指数+、コース指数+、総合投球指数+をすべて100＝東都リーグ平均で比較します。結果指標ではなく、TrackMan計測値から投球内容を分解する東都版モデルです。">
    <div className="quality-definition-grid">
      <article><span>STUFF+</span><h2>球質指数+</h2><strong>球そのもの</strong><p>球速45%、回転・エクステンション・変化15%ずつ、進入角10%。同じ球種の中で比較します。</p></article>
      <article><span>LOCATION+</span><h2>コース指数+</h2><strong>到達位置の価値</strong><p>真ん中を避け、ゾーン端や追わせる位置へ届いた度合い。狙った場所との差を測るCommandではありません。</p></article>
      <article><span>PITCHING+</span><h2>総合投球指数+</h2><strong>球質 × コース</strong><p>球質指数+とコース指数+を1対1で統合。投手総合は球種を球数で加重します。</p></article>
    </div>
    <div className="toolbar quality-toolbar"><div className="segmented"><button className={mode==="pitch"?"active":""} onClick={()=>{setMode("pitch");setMinimum(25)}}>球種別</button><button className={mode==="pitcher"?"active":""} onClick={()=>{setMode("pitcher");setMinimum(100)}}>投手総合</button></div><label>大学<select value={team} onChange={(event)=>setTeam(event.target.value)}><option value="">すべて</option>{data.teams.map((row)=><option key={row.name}>{row.name}</option>)}</select></label>{mode==="pitch"&&<label>球種<select value={pitchType} onChange={(event)=>setPitchType(event.target.value)}><option value="">すべて</option>{pitchTypes.map((value)=><option key={value}>{value}</option>)}</select></label>}<label>最低球数<input type="number" min="0" value={minimum} onChange={(event)=>setMinimum(Number(event.target.value))}/></label><label>投手検索<input value={query} onChange={(event)=>setQuery(event.target.value)} placeholder="選手名"/></label><span>{rows.length}件</span></div>
    <div className="quality-list">{rows.map((row)=><article key={`${row.id??row.pitcherId}-${row.pitchType??"all"}`}><header><button onClick={()=>navigate({view:"player",playerId:row.id??row.pitcherId})}><PlayerName row={{name:row.name??row.pitcher,kanji:row.kanji??row.pitcherKanji}}/><small>{row.team}{row.pitchType?`・${row.pitchType}`:""}</small></button><div><b className={`confidence confidence-${row.qualityConfidence??(row.pitches>=100?"高":"中")}`}>信頼度 {row.qualityConfidence??(row.pitches>=100?"高":"中")}</b><span>n={row.pitches}</span></div></header><QualityScore label="総合投球指数+" metricKey="pitchingPlus" value={row.pitchingPlus}/><div className="quality-sub-scores"><QualityScore label="球質指数+" metricKey="stuffPlus" value={row.stuffPlus}/><QualityScore label="コース指数+" metricKey="locationPlus" value={row.locationPlus}/></div>{mode==="pitch"&&<QualityFactors row={row}/>}</article>)}</div>
    <details className="method-card chart-definition"><summary>モデルと信頼度</summary><p>球種別に標準化し、投球数が少ない値は20球分のリーグ平均へ縮小しています。信頼度は50球以上＝高、25〜49球＝中、24球以下＝低。100は平均であり「100点満点」ではありません。球場・対戦打者・投球意図は完全には補正できないため、育成と配球判断の補助として使います。</p></details>
  </PageSection>;
}

type TendencyGroup = { key: string; label: string; n: number; raw: number; adjusted: number };

function pitcherResultValue(row: Row) {
  const playValues: Record<string, number> = {
    "単打": -0.47,
    "二塁打": -0.78,
    "三塁打": -1.05,
    "本塁打": -1.4,
    "アウト": 0.25,
    "犠打・犠飛": 0.12,
    "野選": 0.15,
    "失策": -0.35,
  };
  if (row.playResult && playValues[row.playResult] !== undefined) return playValues[row.playResult];
  if (row.result === "死球") return -0.35;
  if (row.result === "敬遠") return -0.33;
  if ((row.result === "空振り" || row.result === "見逃しストライク") && row.strikes === 2) return 0.28;
  if ((row.result === "ボール" || row.result === "ワンバウンド") && row.balls === 3) return -0.33;
  if (row.result === "空振り") return 0.045;
  if (row.result === "見逃しストライク") return 0.035;
  if (row.result === "ファウル" || row.result === "ファウルフライ") return 0.018;
  if (row.result === "ワンバウンド") return -0.033;
  if (row.result === "ボール") return -0.028;
  return 0;
}

function batterRelativeZone(row: Row) {
  if (!Number.isFinite(row.plateX) || !Number.isFinite(row.plateZ)) return null;
  if (row.plateX < -0.254 || row.plateX > 0.254 || row.plateZ < 0.45 || row.plateZ > 1.05) return null;
  const vertical = row.plateZ >= 0.85 ? "高め" : row.plateZ < 0.65 ? "低め" : "中央";
  const column = row.plateX < -0.085 ? 0 : row.plateX > 0.085 ? 2 : 1;
  const horizontal = column === 1 ? "中央" : row.batterSide === "左" ? (column === 0 ? "内角" : "外角") : (column === 0 ? "外角" : "内角");
  return `${vertical}・${horizontal}`;
}

function buildTendencyGroups(playerPitches: Row[], leaguePitches: Row[], role: "pitcher" | "batter", dimension: "pitchType" | "zone") {
  const keyOf = (row: Row) => dimension === "zone" ? batterRelativeZone(row) : row.pitchType && row.pitchType !== "不明" ? row.pitchType : null;
  const valueOf = (row: Row) => role === "pitcher" ? pitcherResultValue(row) : -pitcherResultValue(row);
  const aggregate = (rows: Row[]) => {
    const groups = new Map<string, { sum: number; n: number }>();
    for (const row of rows) {
      const key = keyOf(row);
      if (!key) continue;
      const group = groups.get(key) ?? { sum: 0, n: 0 };
      group.sum += valueOf(row);
      group.n += 1;
      groups.set(key, group);
    }
    return groups;
  };
  const leagueGroups = aggregate(leaguePitches);
  const playerGroups = aggregate(playerPitches);
  const leagueFallback = leaguePitches.length ? leaguePitches.reduce((sum, row) => sum + valueOf(row), 0) / leaguePitches.length : 0;
  const prior = 12;
  const groups: TendencyGroup[] = [...playerGroups.entries()].map(([key, playerGroup]) => {
    const leagueGroup = leagueGroups.get(key);
    const leagueAverage = leagueGroup?.n ? leagueGroup.sum / leagueGroup.n : leagueFallback;
    const raw = playerGroup.sum / playerGroup.n;
    return {
      key,
      label: key,
      n: playerGroup.n,
      raw: raw * 100,
      adjusted: ((playerGroup.sum + prior * leagueAverage) / (playerGroup.n + prior)) * 100,
    };
  });
  const minimum = dimension === "pitchType" ? 8 : 3;
  const qualified = groups.filter((group) => group.n >= minimum);
  return (qualified.length ? qualified : groups).sort((a, b) => a.adjusted - b.adjusted);
}

function signed(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}`;
}

function MatchupInsights({ role, playerPitches, allPitches }: { role: "pitcher" | "batter"; playerPitches: Row[]; allPitches: Row[] }) {
  const pitchGroups = useMemo(() => buildTendencyGroups(playerPitches, allPitches, role, "pitchType"), [playerPitches, allPitches, role]);
  const zoneGroups = useMemo(() => buildTendencyGroups(playerPitches, allPitches, role, "zone"), [playerPitches, allPitches, role]);
  if (!pitchGroups.length && !zoneGroups.length) return null;
  const lowPitch = pitchGroups[0];
  const highPitch = pitchGroups[pitchGroups.length - 1];
  const lowZone = zoneGroups[0];
  const highZone = zoneGroups[zoneGroups.length - 1];
  const cards = role === "batter"
    ? [
      { kicker: "苦手傾向", kind: "球種", group: lowPitch, tone: "warning" },
      { kicker: "苦手傾向", kind: "コース", group: lowZone, tone: "warning" },
    ]
    : [
      { kicker: "最も打たれていない", kind: "球種", group: highPitch, tone: "positive" },
      { kicker: "最も打たれていない", kind: "コース", group: highZone, tone: "positive" },
      { kicker: "最も打たれている", kind: "球種", group: lowPitch, tone: "warning" },
      { kicker: "最も打たれている", kind: "コース", group: lowZone, tone: "warning" },
    ];
  return (
    <section className="tendency-panel">
      <header><div><p>球種・コース別</p><h2>{role === "batter" ? "苦手傾向" : "被打傾向"}</h2></div><span>少数標本補正あり</span></header>
      <div className={`tendency-grid ${role}`}>{cards.map((card) => card.group && (
        <article className={`tendency-card ${card.tone}`} key={`${card.kicker}-${card.kind}`}>
          <span>{card.kicker}・{card.kind}</span>
          <strong>{card.group.label}</strong>
          <div><MetricLabel label="補正100球価値" metricKey="tendencyValue" /><b>{signed(card.group.adjusted)}</b></div>
          <small>n={card.group.n}球{card.group.n < (card.kind === "球種" ? 8 : 3) ? "・参考" : ""}</small>
        </article>
      ))}</div>
      <p>得点価値を選手側から評価し、同じ球種・コースのリーグ平均へ補正しています。「苦手」「打たれている」は、この期間内での相対的な傾向です。</p>
    </section>
  );
}


function ShiftBars({ counts }: { counts: ShiftCounts }) {
  return <div className="shift-bars">{(["pull", "middle", "opposite"] as ShiftDirection[]).map((key) => <div key={key}><span>{SHIFT_DIRECTION_LABELS[key]}</span><i><b style={{ width: `${counts.total ? counts[key] / counts.total * 100 : 0}%` }} /></i><strong>{counts[key]} <small>{counts.total ? `${(counts[key] / counts.total * 100).toFixed(1)}%` : "—"}</small></strong></div>)}</div>;
}

function ShiftField({ profile, mode, compact = false }: { profile: ShiftProfile; mode: "infield" | "outfield"; compact?: boolean }) {
  const target = mode === "infield" ? (profile.infieldPattern === "pull" ? "pull" : profile.infieldPattern === "pull-middle" ? "middle" : null) : profile.outfieldTarget;
  const leftField = (target === "pull" && profile.side === "右") || (target === "opposite" && profile.side === "左");
  const rightField = (target === "pull" && profile.side === "左") || (target === "opposite" && profile.side === "右");
  const infieldNormal = [[122, 204, "三"], [174, 160, "遊"], [246, 160, "二"], [298, 204, "一"]] as const;
  const outfieldNormal = [[92, 100, "左"], [210, 52, "中"], [328, 100, "右"]] as const;
  const shiftedInfield = !target ? infieldNormal : profile.side === "右"
    ? (profile.infieldPattern === "pull"
      ? [[104, 211, "三"], [151, 174, "遊"], [221, 172, "二"], [292, 204, "一"]] as const
      : [[112, 208, "三"], [160, 169, "遊"], [229, 161, "二"], [295, 204, "一"]] as const)
    : (profile.infieldPattern === "pull"
      ? [[128, 204, "三"], [198, 160, "遊"], [269, 174, "二"], [316, 211, "一"]] as const
      : [[125, 204, "三"], [192, 161, "遊"], [260, 169, "二"], [308, 208, "一"]] as const);
  const lateralOutfield = !target ? outfieldNormal : leftField
    ? [[76, 90, "左"], [164, 70, "中"], [311, 104, "右"]] as const
    : rightField
      ? [[109, 104, "左"], [256, 70, "中"], [344, 90, "右"]] as const
      : [[108, 103, "左"], [210, 34, "中"], [312, 103, "右"]] as const;
  const shiftedOutfield = lateralOutfield.map(([x,y,label],i) => {
    const normal = outfieldNormal[i];
    const decision = profile.outfielders[i].depth.decision;
    const radius = Math.hypot(normal[0]-210,normal[1]-278) * (decision === "前進" ? .86 : decision === "後退" ? 1.08 : 1);
    const length = Math.hypot(x-210,y-278);
    return [210+(x-210)/length*radius,278+(y-278)/length*radius,label] as const;
  });
  const hasMove = target || (mode === "outfield" && profile.outfielders.some(f=>f.depth.decision === "前進" || f.depth.decision === "後退"));
  const normalMarkers = mode === "infield" ? infieldNormal : outfieldNormal;
  const shiftedMarkers = mode === "infield" ? shiftedInfield : shiftedOutfield;
  return <div className={`shift-field${compact ? " compact" : ""}`}><svg viewBox="0 0 420 300" role="img" aria-label={`${mode === "infield" ? "内野" : "外野"}推奨配置図${profile.hand ? `・対${profile.hand}投手` : "・左右合算"}`}>
    <path d="M210 278 L34 102 Q210 -45 386 102 Z" fill="#edf4e9" stroke="#78907d" />
    <path d="M151 219 L210 160 L269 219 L210 278 Z" fill="#d8b27b" stroke="#9b784d" />
    {target && <path d={leftField ? "M210 278 L34 102 Q102 5 210 0 Z" : rightField ? "M210 278 L386 102 Q318 5 210 0 Z" : "M155 219 L210 75 L265 219 Z"} fill="rgba(197,38,54,.17)" />}
    {hasMove && <g className="shift-movement">{normalMarkers.map(([x, y, label], index) => <line key={String(label)} x1={x} y1={y} x2={shiftedMarkers[index][0]} y2={shiftedMarkers[index][1]} />)}</g>}
    <g className="shift-normal-markers">{normalMarkers.map(([x, y, label]) => <g key={String(label)} transform={`translate(${x} ${y})`}><circle r="15"/><text>{label}</text></g>)}</g>
    <g className="shift-markers">{shiftedMarkers.map(([x, y, label]) => <g key={String(label)} transform={`translate(${x} ${y})`}><circle r="15"/><text>{label}</text></g>)}</g>
    <text x="210" y="294" textAnchor="middle">本塁</text>
  </svg><div className="legend"><span>○ 通常位置</span><span>● 推奨位置</span></div></div>;
}

function ShiftHandControl({ value, onChange }: { value: ShiftHand; onChange: (value: ShiftHand) => void }) {
  return <div className="segmented" aria-label="対戦投手の左右">{(["", "右", "左"] as ShiftHand[]).map(hand=><button key={hand} className={value===hand?"active":""} aria-pressed={value===hand} onClick={()=>onChange(hand)}>{hand?`対${hand}投手`:"左右合算"}</button>)}</div>;
}
const shiftNumber = (n: number | null, unit = "") => n === null ? "—" : `${n.toFixed(1)}${unit}`;
function OutfieldDepth({ profile }: { profile: ShiftProfile }) {
  return <div className="outfield-depth">
    <div className="outfield-depth-positions">{profile.outfielders.map(({sector,depth})=><div key={sector} className={`depth-${depth.decision}`}><span>{sector}</span><strong>{depth.decision}</strong><small>{depth.confidence === "参考" ? "データ不足" : depth.confidence === "低" ? "参考候補" : "配置候補"}</small></div>)}</div>
    <dl className="outfield-depth-metrics"><div><dt>平均打球速度</dt><dd>{shiftNumber(profile.depth.avgEV," km/h")}</dd></div><div><dt>平均打球角度</dt><dd>{shiftNumber(profile.depth.avgAngle,"°")}</dd></div><div><dt>距離75%点</dt><dd>{shiftNumber(profile.depth.distance75," m")}</dd></div><div><dt>深い打球率</dt><dd>{profile.depth.longRate===null?"—":`${(profile.depth.longRate*100).toFixed(1)}%`}</dd></div></dl>
    <details className="chart-definition"><summary>方向別の数値</summary><div className="shift-table-scroll"><table><thead><tr><th>方向</th><th>有効打球</th><th>平均速度</th><th>平均角度</th><th>距離75%点</th><th>前後</th></tr></thead><tbody>{profile.outfielders.map(({sector,depth})=><tr key={sector}><th>{sector}</th><td>{depth.n}</td><td>{shiftNumber(depth.avgEV," km/h")}</td><td>{shiftNumber(depth.avgAngle,"°")}</td><td>{shiftNumber(depth.distance75," m")}</td><td>{depth.decision}</td></tr>)}</tbody></table></div></details>
  </div>;
}
function ShiftSplitTable({ profile }: { profile: ShiftProfile }) {
  const pct=(n:number,total:number)=>total?`${(n/total*100).toFixed(0)}%`:"—";
  return <div className="shift-table-scroll"><table className="shift-split-table"><thead><tr><th>投手</th><th>外野・引張</th><th>中</th><th>逆</th><th>平均速度</th><th>平均角度</th><th>距離75%点</th><th>ゴロ・引張</th></tr></thead><tbody>{profile.splits.map(split=><tr key={split.hand}><th>対{split.hand}</th><td>{pct(split.air.pull,split.air.total)}</td><td>{pct(split.air.middle,split.air.total)}</td><td>{pct(split.air.opposite,split.air.total)}</td><td>{shiftNumber(split.depth.avgEV," km/h")}</td><td>{shiftNumber(split.depth.avgAngle,"°")}</td><td>{shiftNumber(split.depth.distance75," m")}</td><td>{pct(split.ground.pull,split.ground.total)}</td></tr>)}</tbody></table></div>;
}
function ShiftMethod() {
  return <details className="method-card chart-definition"><summary>判定方法</summary><p>選択シーズン・対戦投手の左右で集計。バント・方向未計測・ファウル方向を除き、打球角度8度未満を内野、8〜50度を外野として分類します。角度未計測は既存の打球種別を方向集計だけに使用します。方向は捕手視点、左右15度以内が中堅です。</p><p>外野の前後は左翼・中堅・右翼ごとに判定。有効な打球速度・角度・距離がそろった球を使用します。記録距離と、同じシーズン・投手左右・方向における近い速度と角度の他打者の距離を平均し、75%点を比較します。近傍が8球未満なら記録距離のみを使用します。</p><p>有効打球5球以上・比較対象20球以上で判定し、6球分の平均への補正後に6m以上短ければ前進、6m以上長ければ後退候補とします。100m以上、または155km/h以上かつ15〜40度の打球が15%を超える場合は前進させません。5〜9球は参考候補です。データ不足の方向は維持します。</p><p>図は配置の方向を示す模式図です。実際の守備開始位置・滞空時間・走力・風を使った最適位置ではなく、移動距離は指定しません。前進は同じ方向の深い打球への対応と併せて現場で調整してください。投手左右で外野方向の割合が25ポイント以上異なる場合などに「投手左右差」を表示します。</p></details>;
}
function ShiftPlayerPanel({ player, pitches, allPitches }: { player: Row; pitches: Row[]; allPitches: Row[] }) {
  const [hand,setHand]=useState<ShiftHand>("");
  const profile = useMemo(() => buildShiftProfile(player, pitches, allPitches, hand), [player, pitches, allPitches, hand]);
  return <div className="profile-body shift-player-panel">
    <ShiftHandControl value={hand} onChange={setHand}/>
    <div className="shift-detail-grid"><section><header><h3>内野シフト</h3><b>{profile.ground.total}打球</b></header><ShiftField profile={profile} mode="infield"/><ShiftBars counts={profile.ground}/><p>{profile.infieldRecommendation}</p></section><section><header><h3>外野シフト</h3><b>{profile.air.total}打球</b></header><ShiftField profile={profile} mode="outfield"/><OutfieldDepth profile={profile}/><ShiftBars counts={profile.air}/><p>{profile.outfieldRecommendation}</p></section></div>
    <h3>対右・対左投手</h3><ShiftSplitTable profile={profile}/><ShiftMethod/>
  </div>;
}

function ShiftView({ data, navigate }: { data: Dataset; navigate: (route: RouteState) => void }) {
  const [mode, setMode] = useState<"infield" | "outfield">("outfield");
  const [team, setTeam] = useState("");
  const [side, setSide] = useState("");
  const [hand,setHand]=useState<ShiftHand>("");
  const [query, setQuery] = useState("");
  const [candidatesOnly,setCandidatesOnly]=useState(false);
  const profiles = useMemo(() => {
    const byBatter = new Map<string, Row[]>();
    for (const pitch of data.pitches) {
      const rows = byBatter.get(pitch.batterId) ?? [];
      rows.push(pitch); byBatter.set(pitch.batterId, rows);
    }
    return data.batters.filter(player => player.team !== "中央大学").map(player => buildShiftProfile(player, byBatter.get(player.id) ?? [], data.pitches, hand));
  }, [data,hand]);
  const rows = profiles.filter((profile) => (!candidatesOnly || (mode === "infield" ? profile.infieldPriority !== "参考" : profile.outfieldPriority !== "参考")) && (!team || profile.team === team) && (!side || profile.side === side) && (!query || normalizeSearch(`${profile.kanji} ${profile.name}`).includes(normalizeSearch(query)))).sort((a, b) => {
    const priority = { A: 3, B: 2, C: 1, "参考": 0 };
    const pa = mode === "infield" ? priority[a.infieldPriority] : priority[a.outfieldPriority];
    const pb = mode === "infield" ? priority[b.infieldPriority] : priority[b.outfieldPriority];
    return pb - pa || b.depth.n-a.depth.n || comparePlayerNames(a,b);
  });
  return <PageSection eyebrow="" title="守備シフト" description="">
    <div className="toolbar shift-toolbar"><div className="segmented"><button className={mode === "infield" ? "active" : ""} onClick={() => setMode("infield")}>内野</button><button className={mode === "outfield" ? "active" : ""} onClick={() => setMode("outfield")}>外野</button></div><ShiftHandControl value={hand} onChange={setHand}/><label>大学<select value={team} onChange={(event) => setTeam(event.target.value)}><option value="">対戦5大学</option>{data.teams.filter((row) => row.name !== "中央大学").map((row) => <option key={row.name}>{row.name}</option>)}</select></label><label>打席<select value={side} onChange={(event) => setSide(event.target.value)}><option value="">左右すべて</option><option>右</option><option>左</option></select></label><label>選手検索<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="選手名" /></label><label className="shift-candidates"><input type="checkbox" checked={candidatesOnly} onChange={e=>setCandidatesOnly(e.target.checked)}/>配置変更候補のみ</label></div>
    <div className="shift-list">{rows.map((profile) => { const counts = mode === "infield" ? profile.ground : profile.air; const recommendation = mode === "infield" ? profile.infieldRecommendation : profile.outfieldRecommendation; return <article key={profile.playerId}><button className="shift-player-link" onClick={() => navigate({ view: "player", playerId: profile.playerId })}><PlayerName row={profile} /><small>{profile.team}・{profile.side}打</small></button><div className="shift-card-condition">{hand?`対${hand}投手`:"左右合算"}{(mode==="infield"?profile.conditional:profile.outfieldConditional)&&<span>投手左右差</span>}</div><ShiftField profile={profile} mode={mode} compact />{mode==="outfield"&&<OutfieldDepth profile={profile}/>}<ShiftBars counts={counts}/><p>{recommendation}</p><details className="chart-definition"><summary>対右・対左比較</summary><ShiftSplitTable profile={profile}/></details><div className="shift-card-foot"><span>{mode === "infield" ? "ゴロ" : "外野方向"} {counts.total}打球</span>{mode==="outfield"&&<span>前後判定 {profile.depth.n}打球</span>}</div></article>; })}</div>
    {!rows.length && <div className="empty-news"><h2>該当する選手はいません</h2></div>}
    <ShiftMethod/>
  </PageSection>;
}

type PlayerFilterState = { year: string; season: string; opponent: string; side: string; pitchType: string; count: string; outs: string; from: string; to: string };
const EMPTY_PLAYER_FILTERS: PlayerFilterState = { year: "", season: "", opponent: "", side: "", pitchType: "", count: "", outs: "", from: "", to: "" };

function applyPlayerFilters(pitches: Row[], filters: PlayerFilterState, role: "投手" | "打者" = "投手") {
  return pitches.filter((row) => (!filters.year || String(row.year) === filters.year) && (!filters.season || row.season === filters.season) &&
    (!filters.opponent || row.pitcherTeam === filters.opponent || row.batterTeam === filters.opponent) &&
    (!filters.pitchType || row.pitchType === filters.pitchType) && (!filters.count || `${row.balls}-${row.strikes}` === filters.count) &&
    (!filters.side || (role === "打者" ? row.pitcherThrows === filters.side : row.batterSide === filters.side)) &&
    (!filters.outs || String(row.outs) === filters.outs) && (!filters.from || row.date >= filters.from) && (!filters.to || row.date <= filters.to));
}

function deriveBatterSummary(base: Row, pitches: Row[], league: Row) {
  const swings=pitches.filter((row)=>["空振り","インプレー","ファウル","ファウルフライ"].includes(row.result));
  const contacts=pitches.filter(isMeasuredFairBall); const evs=contacts.map((row)=>row.exitVelocity).sort((a,b)=>a-b);
  const terminal=pitches.filter((row)=>row.playResult||((row.balls===3)&&["ボール","ワンバウンド"].includes(row.result))||((row.strikes===2)&&["空振り","見逃しストライク"].includes(row.result))||row.result==="死球");
  const ab=terminal.filter((row)=>!((row.balls===3)&&["ボール","ワンバウンド"].includes(row.result))&&row.result!=="死球");
  const hits=terminal.filter((row)=>["単打","二塁打","三塁打","本塁打"].includes(row.playResult));const walks=terminal.filter((row)=>row.balls===3&&["ボール","ワンバウンド"].includes(row.result));const hbp=terminal.filter((row)=>row.result==="死球");
  const expectedHit=pitches.reduce((sum,row)=>sum+(Number.isFinite(row.expectedHit)?row.expectedHit:0),0),expectedTb=pitches.reduce((sum,row)=>sum+(Number.isFinite(row.expectedTb)?row.expectedTb:0),0),expectedWoba=pitches.reduce((sum,row)=>sum+(Number.isFinite(row.expectedWoba)?row.expectedWoba:0),0);
  const xwoba=terminal.length?(expectedWoba+.69*walks.length+.72*hbp.length)/terminal.length:null;
  const totalBases=terminal.reduce((sum,row)=>sum+(({"単打":1,"二塁打":2,"三塁打":3,"本塁打":4} as Record<string,number>)[row.playResult]??0),0);
  const avg=ab.length?hits.length/ab.length:null,obp=terminal.length?(hits.length+walks.length+hbp.length)/terminal.length:null,slg=ab.length?totalBases/ab.length:null;
  return {...base,pitches:pitches.length,bbe:contacts.length,percentiles:{},avgLaunchAngle:meanOf(contacts,"launchAngle"),pa:terminal.length,homeRuns:terminal.filter((row)=>row.playResult==="本塁打").length,battingAverage:avg,onBasePercentage:obp,sluggingPercentage:slg,ops:obp===null||slg===null?null:obp+slg,xba:ab.length?expectedHit/ab.length:null,xslg:ab.length?expectedTb/ab.length:null,xwoba,wrcPlus:xwoba&&league.woba?100*xwoba/league.woba:null,avgExitVelocity:meanOf(contacts,"exitVelocity"),maxExitVelocity:evs.at(-1)??null,ev90:evs.length?evs[Math.floor((evs.length-1)*.9)]:null,hardHitRate:contacts.length?contacts.filter((row)=>row.exitVelocity>=152.9).length/contacts.length:null,barrelRate:contacts.length?contacts.filter((row)=>{const mph=row.exitVelocity/1.609344,over=mph-98;return mph>=98&&row.launchAngle>=Math.max(8,26-over)&&row.launchAngle<=Math.min(50,30+over*1.5)}).length/contacts.length:null,whiffRate:swings.length?swings.filter((row)=>row.result==="空振り").length/swings.length:null};
}

function derivePitcherSummary(base: Row,pitches:Row[],league:Row){const swings=pitches.filter((row)=>["空振り","インプレー","ファウル","ファウルフライ"].includes(row.result));const contacts=pitches.filter(isMeasuredFairBall);const csw=pitches.filter((row)=>row.result==="空振り"||row.result==="見逃しストライク").length;const terminal=pitches.filter((row)=>row.playResult||((row.balls===3)&&["ボール","ワンバウンド"].includes(row.result))||((row.strikes===2)&&["空振り","見逃しストライク"].includes(row.result))||row.result==="死球");const walks=terminal.filter((row)=>["Walk","Waik"].includes(row.korbb)||(row.balls===3&&["ボール","ワンバウンド"].includes(row.result)));const strikeouts=terminal.filter((row)=>row.korbb==="Strikeout"||(row.strikes===2&&["空振り","見逃しストライク"].includes(row.result)));const hbp=terminal.filter((row)=>row.result==="死球");const hits=terminal.filter((row)=>["単打","二塁打","三塁打","本塁打"].includes(row.playResult));const outs=terminal.reduce((sum,row)=>{const recorded=row.outsOnPlay??0;return sum+recorded+(strikeouts.includes(row)&&recorded===0?1:0)},0);const runs=terminal.reduce((sum,row)=>sum+(row.runsScored??0),0);const expected=pitches.reduce((sum,row)=>sum+(Number.isFinite(row.expectedWoba)?row.expectedWoba:0),0);const xwobaAllowed=terminal.length?(expected+.69*walks.length+.72*hbp.length)/terminal.length:null;return {...base,pitches:pitches.length,pa:terminal.length,innings:`${Math.floor(outs/3)}.${outs%3}`,era:outs?runs*27/outs:null,strikeouts:strikeouts.length,walks:walks.length,hitsAllowed:hits.length,maxVelocity:Math.max(...pitches.map((row)=>row.velocity).filter(Number.isFinite),0)||null,avgVelocity:meanOf(pitches,"velocity"),whiffRate:swings.length?swings.filter((row)=>row.result==="空振り").length/swings.length:null,cswRate:pitches.length?csw/pitches.length:null,avgExitVelocityAllowed:meanOf(contacts,"exitVelocity"),hardHitRateAllowed:contacts.length?contacts.filter((row)=>row.exitVelocity>=152.9).length/contacts.length:null,xwobaAllowed,xera:xwobaAllowed===null?null:Math.max(0,(league.era??4)+(xwobaAllowed-(league.xwoba??.32))*25)};}

function PlayerFilters({ filters, setFilters, data, role }: { filters: PlayerFilterState; setFilters: (value: PlayerFilterState) => void; data: Dataset; role: string }) {
  const update = (key: keyof PlayerFilterState, value: string) => setFilters({ ...filters, [key]: value });
  const types = [...new Set(data.pitches.map((row) => row.pitchType))].sort();
  return <section className="player-filter-panel"><header><div><span>全タブ共通</span><strong>分析条件</strong></div><button onClick={() => setFilters(EMPTY_PLAYER_FILTERS)}>リセット</button></header><div>
    <label>年度<select value={filters.year} onChange={(event) => update("year", event.target.value)}><option value="">すべて</option>{[...new Set(data.pitches.map((row) => row.year).filter(Boolean))].map((value) => <option key={value}>{value}</option>)}</select></label>
    <label>春／秋<select value={filters.season} onChange={(event) => update("season", event.target.value)}><option value="">すべて</option><option>春</option><option>秋</option></select></label>
    <label>対戦大学<select value={filters.opponent} onChange={(event) => update("opponent", event.target.value)}><option value="">すべて</option>{data.teams.map((row) => <option key={row.name}>{row.name}</option>)}</select></label>
    <label>{role === "打者" ? "相手投手" : "打者"}の左右<select value={filters.side} onChange={(event) => update("side", event.target.value)}><option value="">すべて</option><option>右</option><option>左</option></select></label>
    <label>球種<select value={filters.pitchType} onChange={(event) => update("pitchType", event.target.value)}><option value="">すべて</option>{types.map((value) => <option key={value}>{value}</option>)}</select></label>
    <label>カウント<select value={filters.count} onChange={(event) => update("count", event.target.value)}><option value="">すべて</option>{["0-0","0-1","0-2","1-0","1-1","1-2","2-0","2-1","2-2","3-0","3-1","3-2"].map((value) => <option key={value}>{value}</option>)}</select></label>
    <label>アウト<select value={filters.outs} onChange={(event) => update("outs", event.target.value)}><option value="">すべて</option><option value="0">0</option><option value="1">1</option><option value="2">2</option></select></label>
    <label>開始日<input type="date" value={filters.from} onChange={(event) => update("from", event.target.value)} /></label><label>終了日<input type="date" value={filters.to} onChange={(event) => update("to", event.target.value)} /></label>
  </div><p>走者状況は元CSVに走者占有列がないため表示しません。条件変更はグラフ・表・AIレポートへ共通反映されます。</p></section>;
}

function PlayerView({ season, data, player, navigate, news }: { season: SeasonKey; data: Dataset; player: Row; navigate: (route: RouteState) => void; news: NewsItem[] }) {
  const roles = player.roles ?? [];
  const [role, setRole] = useState<string>(roles.includes("投手") ? "投手" : roles.includes("打者") ? "打者" : "捕手");
  const [tab, setTab] = useState("概要");
  const [spinPitchType, setSpinPitchType] = useState("");
  const [filters, setFilters] = useState<PlayerFilterState>(EMPTY_PLAYER_FILTERS);
  const pitcherPitches = useMemo(() => applyPlayerFilters(data.pitches.filter((row) => row.pitcherId === player.id), filters, "投手"), [data.pitches, player.id, filters]);
  const batterPitches = useMemo(() => applyPlayerFilters(data.pitches.filter((row) => row.batterId === player.id), filters, "打者"), [data.pitches, player.id, filters]);
  const annotatedProfileSource = useMemo(() => annotatePlateAppearances(data.pitches), [data.pitches]);
  const profileLeaguePitches = useMemo(() => applyPlayerFilters(annotatedProfileSource, filters, "打者"), [annotatedProfileSource, filters]);
  const profileBatterPitches = useMemo(() => profileLeaguePitches.filter((row) => row.batterId === player.id), [profileLeaguePitches, player.id]);
  const profileThresholdPitches = useMemo(() => annotatedProfileSource.filter((row) => (!filters.year || String(row.year) === filters.year) && (!filters.season || row.season === filters.season)), [annotatedProfileSource, filters.year, filters.season]);
  const arsenal = data.pitchTypes.filter((row) => row.pitcherId === player.id).sort((a, b) => b.pitches - a.pitches);
  const benchmarks = useMemo(() => buildLeagueBenchmarks(data), [data]);
  const filtersActive = Object.values(filters).some(Boolean);
  const filteredPitcher = useMemo(() => player.pitching ? {...derivePitcherSummary(player.pitching, pitcherPitches, data.league), ...(filtersActive ? { pitchingPlus:null, stuffPlus:null, locationPlus:null, pitchValuePer100:null } : {})} : null, [player.pitching, pitcherPitches, data.league, filtersActive]);
  const filteredBatter = useMemo(() => player.batting
    ? (filtersActive ? deriveBatterSummary(player.batting, batterPitches, data.league) : player.batting)
    : null, [player.batting, batterPitches, data.league, filtersActive]);
  const allRolePitches = useMemo(() => applyPlayerFilters(data.pitches, filters, role === "投手" ? "投手" : "打者"), [data.pitches, filters, role]);
  const tabs = role === "投手" ? ["概要", "PITCH QUALITY", "球種", "回転", "コース", "打球", "試合推移", "配球", "NEWS", "AIレポート"] : role === "打者" ? ["概要", "打者プロファイル", "球種", "コース", "打球", "試合推移", ...(player.team !== "中央大学" ? ["シフト"] : []), "NEWS", "AIレポート"] : ["概要", "コース", "NEWS"];
  useEffect(() => { if (!tabs.includes(tab)) setTab("概要"); }, [role, data.metadata.season]);
  return (
    <>
      <section className="player-hero">
        <div className="player-monogram">{shortName(player.name).slice(0, 2).toUpperCase()}</div>
        <div><p>{player.team}</p><h1>{player.kanji || player.name}</h1><h2>{player.romanName ?? player.name}</h2><span>{roleLabel(player)}</span></div>
        <button className="secondary-button" onClick={() => navigate({ view: "compare" })}>選手比較に進む</button>
      </section>
      {roles.length > 1 && <div className="role-tabs">{roles.map((value: string) => <button key={value} className={role === value ? "active" : ""} onClick={() => { setRole(value); setTab("概要"); }}>{value}</button>)}</div>}
      <div className="player-tabs" role="tablist">{tabs.map((value) => <button key={value} className={tab === value ? "active" : ""} onClick={() => setTab(value)}>{value}</button>)}</div>
      {role !== "捕手" && <PlayerFilters filters={filters} setFilters={setFilters} data={data} role={role} />}
      {role === "投手" && filteredPitcher && <PitcherTab tab={tab} season={season} player={filteredPitcher} pitches={pitcherPitches} allPitches={allRolePitches} arsenal={arsenal} benchmarks={benchmarks.pitching} filtersActive={filtersActive} spinPitchType={spinPitchType} onOpenSpin={(pitchType) => { setSpinPitchType(pitchType); setTab("回転"); }} />}
      {role === "打者" && filteredBatter && <BatterTab tab={tab} player={filteredBatter} officialPlayer={player.batting??filteredBatter} pitches={batterPitches} allPitches={allRolePitches} profilePitches={profileBatterPitches} profileLeaguePitches={profileLeaguePitches} profileThresholdPitches={profileThresholdPitches} seasonLabel={SEASONS[season].label} benchmarks={benchmarks.batting} />}
      {role === "捕手" && player.catching && tab === "概要" && <CatcherProfile player={player.catching} benchmarks={benchmarks.catching} />}
      {role === "捕手" && player.catching && tab === "コース" && <ChartCard title="シームレス・フレーミングマップ"><CatcherFramingHeatmap player={player.catching} /></ChartCard>}
      {tab === "NEWS" && <NewsTimeline items={news.filter((item) => item.playerId === player.id || (item.playerKanji && item.playerKanji === player.kanji) || normalizeSearch(item.playerRoman ?? "") === normalizeSearch(player.name))} />}
    </>
  );
}

function meanOf(rows: Row[], key: string) {
  const values = rows.map((row) => Number(row[key])).filter(Number.isFinite);
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function sdOf(rows: Row[], key: string) {
  const values = rows.map((row) => Number(row[key])).filter(Number.isFinite);
  if (values.length < 2) return null;
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / values.length);
}

function summarizeByPitchType(pitches: Row[], role: "pitcher" | "batter") {
  const groups = new Map<string, Row[]>();
  pitches.forEach((row) => { const rows = groups.get(row.pitchType) ?? []; rows.push(row); groups.set(row.pitchType, rows); });
  return [...groups.entries()].map(([pitchType, rows]) => {
    const swings = rows.filter((row) => ["空振り", "インプレー", "ファウル", "ファウルフライ"].includes(row.result)).length;
    const whiffs = rows.filter((row) => row.result === "空振り").length;
    const contacts = rows.filter((row) => Number.isFinite(row.exitVelocity));
    const hard = contacts.filter((row) => row.exitVelocity >= 152.9).length;
    const csw = rows.filter((row) => row.result === "空振り" || row.result === "見逃しストライク").length;
    const hits = rows.filter((row) => ["単打", "二塁打", "三塁打", "本塁打"].includes(row.playResult)).length;
    return { pitchType, pitches: rows.length, usageRate: pitches.length ? rows.length / pitches.length : null, avgVelocity: meanOf(rows, "velocity"), maxVelocity: Math.max(...rows.map((row) => row.velocity).filter(Number.isFinite), 0) || null,
      avgSpin: meanOf(rows, "spin"), avgIvb: meanOf(rows, "ivb"), avgHb: meanOf(rows, "hb"), avgVaa: meanOf(rows, "vaa"), avgExtension: meanOf(rows, "extension"),
      whiffRate: swings ? whiffs / swings : null, swingingStrikeRate: rows.length ? whiffs / rows.length : null, cswRate: rows.length ? csw / rows.length : null, avgExitVelocity: meanOf(contacts, "exitVelocity"),
      hardHitRate: contacts.length ? hard / contacts.length : null, battingAverage: contacts.length ? hits / contacts.length : null,
      sampleNote: rows.length < (role === "pitcher" ? 20 : 12) ? "サンプル不足" : "" };
  }).sort((a, b) => b.pitches - a.pitches);
}

function locationMetrics(pitches: Row[]) {
  const located = pitches.filter((row) => Number.isFinite(row.plateX) && Number.isFinite(row.plateZ));
  const zone = located.filter((row) => row.plateX >= -0.254 && row.plateX <= 0.254 && row.plateZ >= 0.45 && row.plateZ <= 1.05);
  const edge = located.filter((row) => classifyAttackZone(row) === "edge");
  const heart = located.filter((row) => Math.abs(row.plateX) <= .085 && row.plateZ >= .65 && row.plateZ <= .85);
  const xSd = sdOf(located, "plateX") ?? 0, zSd = sdOf(located, "plateZ") ?? 0;
  const rhSd = sdOf(pitches, "releaseHeight") ?? 0, rsSd = sdOf(pitches, "releaseSide") ?? 0;
  return { n: located.length, zoneRate: located.length ? zone.length / located.length : null, edgeRate: located.length ? edge.length / located.length : null,
    heartRate: located.length ? heart.length / located.length : null, locationSd: located.length > 1 ? Math.hypot(xSd, zSd) * 100 : null,
    releaseSd: pitches.length > 1 ? Math.hypot(rhSd, rsSd) : null };
}

type AttackZone = "core" | "edge" | "chase" | "waste";

function classifyAttackZone(row: Row): AttackZone | null {
  if (!Number.isFinite(row.plateX) || !Number.isFinite(row.plateZ)) return null;
  const left = -0.254, right = 0.254, bottom = 0.45, top = 1.05, band = 0.085;
  const inside = row.plateX >= left && row.plateX <= right && row.plateZ >= bottom && row.plateZ <= top;
  const outsideX = row.plateX < left ? left - row.plateX : row.plateX > right ? row.plateX - right : 0;
  const outsideZ = row.plateZ < bottom ? bottom - row.plateZ : row.plateZ > top ? row.plateZ - top : 0;
  const outsideDistance = Math.hypot(outsideX, outsideZ);
  if (inside) {
    const insideDistance = Math.min(row.plateX - left, right - row.plateX, row.plateZ - bottom, top - row.plateZ);
    return insideDistance <= band ? "edge" : "core";
  }
  if (outsideDistance <= band) return "edge";
  if (outsideDistance <= band * 2) return "chase";
  return "waste";
}

function AttackZoneProfile({ pitches }: { pitches: Row[] }) {
  const located = pitches.filter((row) => classifyAttackZone(row));
  const definitions: { key: AttackZone; label: string; detail: string }[] = [
    { key: "core", label: "CORE", detail: "ゾーン内部" },
    { key: "edge", label: "EDGE", detail: "境界±8.5cm" },
    { key: "chase", label: "CHASE", detail: "境界外8.5〜17cm" },
    { key: "waste", label: "WASTE", detail: "境界外17cm超" },
  ];
  const rows = definitions.map((definition) => {
    const group = located.filter((row) => classifyAttackZone(row) === definition.key);
    const csw = group.filter((row) => row.result === "空振り" || row.result === "見逃しストライク").length;
    return { ...definition, n: group.length, share: located.length ? group.length / located.length : null, cswRate: group.length ? csw / group.length : null, avgExitVelocity: meanOf(group, "exitVelocity") };
  });
  if (!located.length) return null;
  return (
    <section className="attack-zone-profile">
      <header><div><span>TOHTO ATTACK ZONES</span><h2>投球位置フィンガープリント</h2></div><p>全投球を重ならない4領域へ分類</p></header>
      <div className="attack-zone-share" aria-label="投球位置4領域の構成比">{rows.map((row) => <i key={row.key} className={`zone-${row.key}`} style={{ width: `${(row.share ?? 0) * 100}%` }}><span>{row.share && row.share >= .08 ? `${Math.round(row.share * 100)}%` : ""}</span></i>)}</div>
      <div className="attack-zone-grid">{rows.map((row) => <article key={row.key} className={`zone-${row.key}`}><span>{row.label}</span><strong>{formatValue(row.share, "rate")}</strong><small>{row.detail}・n={row.n}</small><div><b>CSW {formatValue(row.cswRate, "rate")}</b><b>被EV {formatValue(row.avgExitVelocity)}</b></div></article>)}</div>
      <p>MLB Baseball SavantのHeart / Shadow / Chase / Wasteという考え方を参考にした東都版です。固定ゾーン境界からの距離で分類し、狙った位置や因果関係は示しません。</p>
    </section>
  );
}

function SampleNotice({ n, threshold = 20 }: { n: number; threshold?: number }) {
  return n < threshold ? <p className="sample-warning">サンプル不足：n={n}。傾向は参考値として表示しています。</p> : <p className="sample-ok">対象 n={n}</p>;
}

function PitcherTab({ tab, season, player, pitches, allPitches, arsenal, benchmarks, filtersActive, spinPitchType, onOpenSpin }: { tab: string; season: SeasonKey; player: Row; pitches: Row[]; allPitches: Row[]; arsenal: Row[]; benchmarks: Record<string, Benchmark>; filtersActive: boolean; spinPitchType: string; onOpenSpin: (pitchType: string) => void }) {
  if (tab === "概要") return <><SampleNotice n={pitches.length} threshold={50} /><MatchupInsights role="pitcher" playerPitches={pitches} allPitches={allPitches} /><PitcherProfile player={player} pitches={pitches} allPitches={allPitches} arsenal={summarizeByPitchType(pitches, "pitcher")} benchmarks={benchmarks} onOpenSpin={onOpenSpin} /></>;
  if (tab === "PITCH QUALITY") return <PitchQualityPlayerPanel player={player} arsenal={arsenal} />;
  if (tab === "球種") return <div className="profile-body"><SampleNotice n={pitches.length} threshold={50} /><div className="chart-grid"><ChartCard title="投球位置"><PitchPlot pitches={pitches} /></ChartCard><ChartCard title="リリース位置"><ReleasePlot pitches={pitches} /></ChartCard></div><SectionTitle title="球種別成績" /><SimpleTable rows={summarizeByPitchType(pitches, "pitcher")} rowKey="pitchType" onRowKeyClick={(row) => onOpenSpin(String(row.pitchType))} columns={[{key:"pitchType",label:"球種"},{key:"pitches",label:"球数"},{key:"avgVelocity",label:"平均球速"},{key:"maxVelocity",label:"最高球速"},{key:"avgSpin",label:"回転数"},{key:"avgIvb",label:"縦変化"},{key:"avgHb",label:"横変化"},{key:"avgVaa",label:"進入角"},{key:"avgExtension",label:"エクステンション"},{key:"whiffRate",label:"空振り率",format:"rate"},{key:"swingingStrikeRate",label:"SwStr%",format:"rate"},{key:"cswRate",label:"見逃し・空振り率",format:"rate"},{key:"avgExitVelocity",label:"平均被打球速度"},{key:"hardHitRate",label:"被強打率",format:"rate"},{key:"sampleNote",label:"標本"}]} /></div>;
  if (tab === "回転") return <PitchSpinProfile season={season} playerId={player.id} playerName={player.kanji || player.name} pitches={pitches} filtersActive={filtersActive} initialPitchType={spinPitchType} />;
  if (tab === "コース") return <PitcherLocationPanel pitches={pitches} />;
  if (tab === "打球") return <div className="profile-body"><SampleNotice n={pitches.filter((row) => Number.isFinite(row.exitVelocity)).length} threshold={20} /><div className="chart-grid"><ChartCard title="被打球方向"><SprayChart pitches={pitches} /></ChartCard><ChartCard title="シームレス被打球ヒートマップ"><ContinuousZoneHeatmap pitches={pitches} role="pitcher" /></ChartCard></div></div>;
  if (tab === "試合推移") return <div className="profile-body"><MetricTrendChart pitches={pitches} role="pitcher" /></div>;
  if (tab === "配球") return <div className="profile-body"><div className="chart-grid"><ChartCard title="球種シーケンス"><PitchSequence pitches={pitches} /></ChartCard><ChartCard title="球種トンネル"><PitchTunnel pitches={pitches} /></ChartCard></div><ChartCard title="カウント別成績"><CountTable pitches={pitches} role="pitcher" /></ChartCard></div>;
  if (tab === "AIレポート") return <AIReport role="pitcher" pitches={pitches} allPitches={allPitches} />;
  return null;
}

function PitchQualityPlayerPanel({ player, arsenal }: { player: Row; arsenal: Row[] }) {
  const strongStuff = Math.round(Number(player.stuffPlus)) >= 105;
  const strongLocation = Math.round(Number(player.locationPlus)) >= 105;
  const diagnosis = strongStuff && strongLocation ? "球質とコースがともに平均以上。現在の球種構成を軸に配球最適化を進められます。" : strongStuff ? "球質が先行しています。出力向上より、真ん中率と決め球の到達位置を優先して改善する段階です。" : strongLocation ? "コースで補えている投手です。球速、変化量、進入角のうち球種別の弱点を改良すると上積みが見込めます。" : "球質と到達位置の両方に改善余地があります。まず使用率の高い球種から一要素ずつ修正するのが合理的です。";
  return <div className="profile-body quality-player-panel"><section className="quality-player-hero"><div><span>PITCH QUALITY</span><h2>{qualityBand(player.pitchingPlus)}</h2><p>{diagnosis}</p></div><strong>{formatValue(player.pitchingPlus,"plus")}<small>総合投球指数+</small></strong></section><div className="quality-player-scores"><QualityScore label="球質指数+" metricKey="stuffPlus" value={player.stuffPlus}/><QualityScore label="コース指数+" metricKey="locationPlus" value={player.locationPlus}/></div><SectionTitle title="球種別 PITCH QUALITY"/><div className="quality-arsenal-grid">{arsenal.map((row)=><article key={row.pitchType}><header><span className="pitch-tag" style={{borderColor:PITCH_COLORS[row.pitchType]??"#777"}}>{row.pitchType}</span><b>n={row.pitches}・信頼度 {row.qualityConfidence??"—"}</b></header><QualityScore label="総合投球指数+" metricKey="pitchingPlus" value={row.pitchingPlus}/><div className="quality-sub-scores"><QualityScore label="球質指数+" metricKey="stuffPlus" value={row.stuffPlus}/><QualityScore label="コース指数+" metricKey="locationPlus" value={row.locationPlus}/></div><QualityFactors row={row}/></article>)}</div><details className="method-card chart-definition"><summary>このタブの値</summary><p>シーズン全体の球種モデルです。上部の期間・相手・カウントフィルターでは再計算されません。球種改良前後を比較する場合は、CSV更新後の値と実測の球速・変化量を併用してください。</p></details></div>;
}

function formatProfileMetric(metric: ProfileMetric | undefined) {
  if (!metric || metric.value === null) return "—";
  return metric.unit === "rate" ? `${(metric.value * 100).toFixed(1)}%` : metric.unit === "km/h" ? `${metric.value.toFixed(1)}` : metric.value.toFixed(3);
}

function profileDelta(metric: ProfileMetric | undefined) {
  if (!metric || metric.delta === null || metric.delta === undefined) return "—";
  const scale = metric.unit === "rate" ? 100 : 1;
  const suffix = metric.unit === "rate" ? "pt" : metric.unit === "km/h" ? "km/h" : "";
  return `${metric.delta >= 0 ? "+" : ""}${(metric.delta * scale).toFixed(1)}${suffix}`;
}

function ProfileMetricTile({ label, metric, invert = false }: { label: string; metric: ProfileMetric; invert?: boolean }) {
  const positive = metric.delta === null || metric.delta === undefined ? null : invert ? metric.delta < 0 : metric.delta > 0;
  return <article className={`batter-profile-metric ${metric.confidence === "判定しない" ? "insufficient" : positive === null ? "neutral" : positive ? "positive" : "negative"}`} title={metric.definition}>
    <header><span>{label}</span><b>信頼度 {metric.confidence}</b></header><strong>{formatProfileMetric(metric)}{metric.unit === "km/h" && <small> km/h</small>}</strong>
    <div><span>リーグ {metric.leagueAverage === null || metric.leagueAverage === undefined ? "—" : metric.unit === "rate" ? `${(metric.leagueAverage * 100).toFixed(1)}%` : metric.leagueAverage.toFixed(1)}</span><em>{profileDelta(metric)}</em></div><small>n={metric.denominator}</small>
  </article>;
}

function ratingClass(rating: Rating) {
  if (["得意", "やや得意"].includes(rating)) return "positive";
  if (["苦手", "やや苦手"].includes(rating)) return "negative";
  if (rating === "データ不足") return "insufficient";
  return "neutral";
}

function ProfileZoneMap({ title, zones, metricKey, batterSide }: { title: string; zones: ReturnType<typeof buildBatterProfile>["zones"]; metricKey: "contact" | "avgExitVelocity"; batterSide: string }) {
  const style = (metric: ProfileMetric) => {
    if (metric.confidence === "判定しない" || metric.delta === null || metric.delta === undefined) return { background: "#eef1f1", color: "#748082" };
    const limit = metric.unit === "rate" ? .14 : 10;
    const intensity = Math.min(1, Math.abs(metric.delta) / limit);
    return metric.delta >= 0
      ? { background: `rgba(25, 137, 145, ${.18 + intensity * .64})`, color: intensity > .65 ? "white" : "#153e42" }
      : { background: `rgba(190, 47, 61, ${.16 + intensity * .66})`, color: intensity > .65 ? "white" : "#651d25" };
  };
  const displayedZones = catcherViewZoneOrder(zones, batterSide);
  return <section className="batter-profile-zone"><header><h3>{title}</h3><span>リーグ平均との差｜捕手側から見た図</span></header><div className="batter-profile-zone-grid">{displayedZones.map((zone) => {
    const metric = zone.metrics[metricKey];
    return <div key={zone.index} style={style(metric)} title={`${zone.vertical}・${zone.horizontal}／選手 ${formatProfileMetric(metric)}／リーグ ${metric.leagueAverage === null || metric.leagueAverage === undefined ? "—" : metric.unit === "rate" ? `${(metric.leagueAverage * 100).toFixed(1)}%` : metric.leagueAverage.toFixed(1)}／${profileDelta(metric)}／n=${metric.denominator}`}><strong>{metric.confidence === "判定しない" ? "n不足" : profileDelta(metric)}</strong><small>{zone.vertical}・{zone.horizontal}</small><em>n={metric.denominator}</em></div>;
  })}</div><footer><span>苦手側</span><i /><span>平均</span><i /><span>得意側</span></footer></section>;
}

function ProfileSprayChart({ split }: { split: ReturnType<typeof buildBatterProfile>["spray"][number] }) {
  const points = split.points.filter(p => Number.isFinite(p.distance) && p.distance >= 0);
  const scale = 125 / Math.max(120, ...points.map(p => p.distance));
  const x = (direction: number, distance: number) => sprayPoint(direction, distance, 130, 140, scale).x;
  const y = (direction: number, distance: number) => sprayPoint(direction, distance, 130, 140, scale).y;
  const colors: Record<string,string> = { ゴロ: "#ad6c29", ライナー: "#c5313e", フライ: "#257a81", ポップフライ: "#6d7477", その他: "#879294" };
  return <article className="batter-profile-spray"><header><strong>対{split.pitcherThrows}投手</strong><span>有効打球 n={split.n}</span></header><svg viewBox="0 0 260 155" role="img" aria-label={`対${split.pitcherThrows}投手の打球方向`}><path d={fieldSector(130,140,120*scale)} fill="#f2f7ef" stroke="#829285"/>{points.map((point,index)=><circle key={index} cx={x(point.direction,point.distance)} cy={y(point.direction,point.distance)} r={Math.max(2.2,Math.min(5.5,(point.exitVelocity-100)/12))} fill={colors[point.shape]??colors.その他} opacity=".7"><title>{point.shape}・{point.exitVelocity.toFixed(1)}km/h</title></circle>)}</svg><div className="batter-profile-spray-stats"><span>引っ張り <b>{split.pullRate===null?"—":`${(split.pullRate*100).toFixed(0)}%`}</b></span><span>中 <b>{split.centerRate===null?"—":`${(split.centerRate*100).toFixed(0)}%`}</b></span><span>逆 <b>{split.oppositeRate===null?"—":`${(split.oppositeRate*100).toFixed(0)}%`}</b></span><span>GB <b>{split.groundRate===null?"—":`${(split.groundRate*100).toFixed(0)}%`}</b></span><span>LD <b>{split.lineRate===null?"—":`${(split.lineRate*100).toFixed(0)}%`}</b></span><span>FB <b>{split.flyRate===null?"—":`${(split.flyRate*100).toFixed(0)}%`}</b></span><span>Pop <b>{split.popupRate===null?"—":`${(split.popupRate*100).toFixed(0)}%`}</b></span><span>平均EV <b>{split.avgExitVelocity===null?"—":split.avgExitVelocity.toFixed(1)}</b></span><span>強い打球 <b>{split.hardHitRate===null?"—":`${(split.hardHitRate*100).toFixed(0)}%`}</b></span></div></article>;
}

function condensedProfileRating(rating: Rating) {
  if (["得意", "やや得意"].includes(rating)) return "得意";
  if (["苦手", "やや苦手"].includes(rating)) return "苦手";
  if (rating === "データ不足") return "データ不足";
  return "平均";
}

function BatterProfilePrintMetric({ label, metric, invert = false }: { label: string; metric: ProfileMetric; invert?: boolean }) {
  const positive = metric.delta === null || metric.delta === undefined ? null : invert ? metric.delta < 0 : metric.delta > 0;
  return <div className={`batter-profile-print-metric ${metric.confidence === "判定しない" ? "insufficient" : positive === null ? "neutral" : positive ? "positive" : "negative"}`}>
    <span>{label}</span><strong>{formatProfileMetric(metric)}</strong><small>平均との差 {profileDelta(metric)}・n={metric.denominator}</small>
  </div>;
}

function BatterProfilePrintZone({ title, zones, metricKey, batterSide }: { title: string; zones: ReturnType<typeof buildBatterProfile>["zones"]; metricKey: "contact" | "avgExitVelocity"; batterSide: string }) {
  const color = (metric: ProfileMetric) => {
    if (metric.confidence === "判定しない" || metric.delta === null || metric.delta === undefined) return { background: "#eef1f1", color: "#748082" };
    const limit = metric.unit === "rate" ? .14 : 10;
    const intensity = Math.min(1, Math.abs(metric.delta) / limit);
    return metric.delta >= 0
      ? { background: `rgba(25, 137, 145, ${.18 + intensity * .64})`, color: intensity > .65 ? "white" : "#153e42" }
      : { background: `rgba(190, 47, 61, ${.16 + intensity * .66})`, color: intensity > .65 ? "white" : "#651d25" };
  };
  const displayedZones = catcherViewZoneOrder(zones, batterSide);
  return <section className="batter-profile-print-zone"><h3>{title}（{metricKey === "avgExitVelocity" ? "km/h" : "pt"}）</h3><div>{displayedZones.map((zone) => {
    const metric = zone.metrics[metricKey];
    return <span key={zone.index} style={color(metric)}><b>{metric.confidence === "判定しない" ? "n不足" : profileDelta(metric).replace(/km\/h$|pt$/g, "")}</b><small>n={metric.denominator}</small></span>;
  })}</div></section>;
}

function BatterProfilePrintSpray({ split }: { split: ReturnType<typeof buildBatterProfile>["spray"][number] }) {
  const points = split.points.filter(p => Number.isFinite(p.distance) && p.distance >= 0);
  const scale = 125 / Math.max(120, ...points.map(p => p.distance));
  const x = (direction: number, distance: number) => sprayPoint(direction, distance, 130, 140, scale).x;
  const y = (direction: number, distance: number) => sprayPoint(direction, distance, 130, 140, scale).y;
  const colors: Record<string,string> = { ゴロ: "#ad6c29", ライナー: "#c5313e", フライ: "#257a81", ポップフライ: "#6d7477", その他: "#879294" };
  const rate = (value: number | null) => value === null ? "—" : `${(value * 100).toFixed(0)}%`;
  return <section className="batter-profile-print-spray"><header><h3>対{split.pitcherThrows}投手</h3><span>有効打球 n={split.n}</span></header><svg viewBox="0 0 260 150" role="img" aria-label={`印刷用・対${split.pitcherThrows}投手の打球方向`}><path d={fieldSector(130,140,120*scale)} fill="#f2f7ef" stroke="#829285"/>{points.map((point,index)=><circle key={index} cx={x(point.direction,point.distance)} cy={y(point.direction,point.distance)} r={Math.max(2.2,Math.min(5.5,(point.exitVelocity-100)/12))} fill={colors[point.shape]??colors.その他} opacity=".72"/>)}</svg><dl><div><dt>引張</dt><dd>{rate(split.pullRate)}</dd></div><div><dt>中</dt><dd>{rate(split.centerRate)}</dd></div><div><dt>逆</dt><dd>{rate(split.oppositeRate)}</dd></div><div><dt>平均EV</dt><dd>{split.avgExitVelocity===null?"—":split.avgExitVelocity.toFixed(1)}</dd></div><div><dt>強打</dt><dd>{rate(split.hardHitRate)}</dd></div><div><dt>打球</dt><dd>{split.n}</dd></div></dl></section>;
}

function BatterProfilePrintPage({ player, profile, seasonLabel, plateAppearances, thresholdText, verticalRows }: {
  player: Row;
  profile: ReturnType<typeof buildBatterProfile>;
  seasonLabel: string;
  plateAppearances: number | null | undefined;
  thresholdText: string;
  verticalRows: Array<{ label: string; pitches: number; metrics: ProfileMetrics }>;
}) {
  const mainMetrics: Array<[string, keyof ProfileMetrics, boolean?]> = [["初球Swing", "firstPitchSwing"], ["Swing", "swing"], ["Chase", "chase", true], ["Contact", "contact"], ["Whiff", "whiff", true], ["平均EV", "avgExitVelocity"], ["強い打球", "hardHit"]];
  const printGroups = profile.pitchGroups.filter((row) => PITCH_GROUP_ORDER.slice(0, 6).includes(row.group));
  const confidence = (metrics: ProfileMetrics) => `P${metrics.swing.confidence}/S${metrics.contact.confidence}/B${metrics.hardHit.confidence}`;
  return <article className="batter-profile-print-page">
    <header className="batter-profile-print-top">
      <section className="batter-profile-print-player"><span>BATTER PROFILE</span><h1>{player.kanji||player.name}</h1><b>{player.team}・{profile.batterSide}打</b><dl><div><dt>シーズン</dt><dd>{seasonLabel}</dd></div><div><dt>打席</dt><dd>{plateAppearances??profile.counts.plateAppearances}</dd></div><div><dt>対象投球</dt><dd>{profile.counts.pitches}</dd></div><div><dt>有効打球</dt><dd>{profile.counts.validBattedBalls}</dd></div><div><dt>対右／左</dt><dd>{profile.counts.vsRightPitches}／{profile.counts.vsLeftPitches}</dd></div></dl><small>強い打球基準：{thresholdText}</small></section>
      <section className="batter-profile-print-features"><div>{profile.tags.slice(0,4).map((tag)=><b key={tag.label}>{tag.label}</b>)}{!profile.tags.length&&<b className="empty">判定データ不足</b>}</div><h2>数値から見える特徴</h2>{profile.summaries.length?<ol>{profile.summaries.slice(0,3).map((text)=><li key={text}>{text}</li>)}</ol>:<p>リーグ平均との差と母数を満たす明確な特徴はありません。</p>}</section>
      <section className="batter-profile-print-kpis"><h2>主要指標</h2><div>{mainMetrics.map(([label,key,invert])=><BatterProfilePrintMetric key={key} label={label} metric={profile.metrics[key]} invert={invert}/>)}</div></section>
    </header>
    <div className="batter-profile-print-middle">
      <section className="batter-profile-print-table batter-profile-print-groups"><h2>球種グループ別</h2><table><thead><tr><th>グループ</th><th>n</th><th>Swing</th><th>Contact</th><th>Whiff</th><th>平均EV</th><th>強打</th><th>評価</th><th>信頼度</th></tr></thead><tbody>{printGroups.map((row)=><tr key={row.group}><th>{row.group}</th><td>{row.pitches}</td><td>{formatProfileMetric(row.metrics.swing)}</td><td>{formatProfileMetric(row.metrics.contact)}</td><td>{formatProfileMetric(row.metrics.whiff)}</td><td>{formatProfileMetric(row.metrics.avgExitVelocity)}</td><td>{formatProfileMetric(row.metrics.hardHit)}</td><td className={ratingClass(row.rating)}>{condensedProfileRating(row.rating)}</td><td>{confidence(row.metrics)}</td></tr>)}</tbody></table></section>
      <div className="batter-profile-print-mini-tables">
        <section className="batter-profile-print-table"><h2>ストレート球速帯</h2><table><thead><tr><th>球速帯</th><th>n</th><th>Contact</th><th>Whiff</th><th>平均EV</th><th>強打</th></tr></thead><tbody>{profile.velocityBands.map((row)=><tr key={row.band}><th>{row.band}</th><td>{row.pitches}</td><td>{formatProfileMetric(row.metrics.contact)}</td><td>{formatProfileMetric(row.metrics.whiff)}</td><td>{formatProfileMetric(row.metrics.avgExitVelocity)}</td><td>{formatProfileMetric(row.metrics.hardHit)}</td></tr>)}</tbody></table></section>
        <section className="batter-profile-print-table"><h2>入る／逃げる球</h2><table><thead><tr><th>方向</th><th>n</th><th>Contact</th><th>Whiff</th><th>平均EV</th><th>平均との差</th></tr></thead><tbody>{profile.movement.map((row)=><tr key={row.direction}><th>{row.direction}</th><td>{row.pitches}</td><td>{formatProfileMetric(row.metrics.contact)}</td><td>{formatProfileMetric(row.metrics.whiff)}</td><td>{formatProfileMetric(row.metrics.avgExitVelocity)}</td><td>{profileDelta(row.metrics.avgExitVelocity)}</td></tr>)}</tbody></table></section>
        <section className="batter-profile-print-table"><h2>上下変化別</h2><table><thead><tr><th>区分</th><th>n</th><th>Contact</th><th>Whiff</th><th>平均EV</th><th>平均との差</th></tr></thead><tbody>{verticalRows.map((row)=><tr key={row.label}><th>{row.label}</th><td>{row.pitches}</td><td>{formatProfileMetric(row.metrics.contact)}</td><td>{formatProfileMetric(row.metrics.whiff)}</td><td>{formatProfileMetric(row.metrics.avgExitVelocity)}</td><td>{profileDelta(row.metrics.avgExitVelocity)}</td></tr>)}</tbody></table></section>
      </div>
    </div>
    <div className="batter-profile-print-bottom">
      <section className="batter-profile-print-zones"><div><BatterProfilePrintZone title="9エリア別 Contact差" zones={profile.zones} metricKey="contact" batterSide={profile.batterSide}/><BatterProfilePrintZone title="9エリア別 平均EV差" zones={profile.zones} metricKey="avgExitVelocity" batterSide={profile.batterSide}/></div><footer><span>苦手側</span><i/><span>平均</span><i/><span>得意側</span></footer></section>
      <section className="batter-profile-print-sprays"><h2>対右／対左投手の打球方向</h2><div>{profile.spray.map((split)=><BatterProfilePrintSpray key={split.pitcherThrows} split={split}/>)}</div></section>
    </div>

  </article>;
}

const EMPTY_DETAIL_FILTERS: DetailFilters = { pitcherThrows:"", batterSide:"", pitchGroup:"", pitchType:"", velocityMin:null, velocityMax:null, movementDirection:"", movementBand:"", movementMin:null, verticalClass:"", horizontal:"", vertical:"", zone:"", count:"", situation:"", hitType:"" };
const PROFILE_PRESETS: Record<string, DetailFilters> = {
  "外の変化球": { pitchGroup:"変化球系", horizontal:"外角" },
  "外角ゾーン外の変化球": { pitchGroup:"変化球系", horizontal:"外角", zone:"ゾーン外" },
  "外の横変化系": { pitchGroup:"横変化系", horizontal:"外角" },
  "外の縦変化系": { pitchGroup:"縦変化系", horizontal:"外角" },
  "外の落ち球系": { pitchGroup:"落ち球系", horizontal:"外角" },
  "外のチェンジ系": { pitchGroup:"チェンジ系", horizontal:"外角" },
  "打者から逃げる変化球": { pitchGroup:"変化球系", movementDirection:"打者から逃げる" },
  "打者へ入ってくる速球": { pitchGroup:"動く速球系", movementDirection:"打者へ入る" },
  "高めストレート": { pitchGroup:"直球系", vertical:"高め" },
  "低め落ち球": { pitchGroup:"落ち球系", vertical:"低め" },
  "145km/h以上のストレート": { pitchGroup:"直球系", velocityMin:145 },
  "初球変化球": { situation:"初球" },
  "2ストライク後のボール球": { situation:"2ストライク・ゾーン外" },
};

function BatterProfileWorkspace({ player, pitches, leaguePitches, thresholdLeaguePitches, seasonLabel }: { player: Row; pitches: Row[]; leaguePitches: Row[]; thresholdLeaguePitches: Row[]; seasonLabel: string }) {
  const [mode,setMode]=useState<"sheet"|"detail">("sheet");
  const [detailFilters,setDetailFilters]=useState<DetailFilters>(EMPTY_DETAIL_FILTERS);
  const profile=useMemo(()=>buildBatterProfile(pitches,leaguePitches,DEFAULT_ZONE,thresholdLeaguePitches),[pitches,leaguePitches,thresholdLeaguePitches]);
  const thresholds=useMemo(()=>buildStrongContactThresholds(thresholdLeaguePitches),[thresholdLeaguePitches]);
  const printVerticalRows=useMemo(()=>{
    const comparableLeague=leaguePitches.filter((row)=>row.batterSide===profile.batterSide);
    return [["上方向成分が大きい","上位25%"],["標準","中央50%"],["下方向成分が大きい","下位25%"]].map(([label,verticalClass])=>{
      const playerRows=filterBatterProfilePitches(pitches,{verticalClass},leaguePitches);
      const comparisonRows=filterBatterProfilePitches(comparableLeague,{verticalClass},leaguePitches);
      return {label,pitches:playerRows.length,metrics:compareProfileMetrics(calculateProfileMetrics(playerRows,thresholds),calculateProfileMetrics(comparisonRows,thresholds))};
    });
  },[pitches,leaguePitches,profile.batterSide,thresholds]);
  const comparisonSide=detailFilters.batterSide||profile.batterSide;
  const exactLeague=useMemo(()=>filterBatterProfilePitches(leaguePitches,{...detailFilters,batterSide:comparisonSide},leaguePitches),[leaguePitches,detailFilters,comparisonSide]);
  const comparison=useMemo(()=>{
    if(exactLeague.length>=15)return {rows:exactLeague,label:`同シーズン・${comparisonSide}打者・選択条件`};
    if(detailFilters.pitcherThrows){const rows=filterBatterProfilePitches(leaguePitches,{...detailFilters,pitcherThrows:"",batterSide:comparisonSide},leaguePitches);if(rows.length>=15)return {rows,label:`同シーズン・${comparisonSide}打者（投手左右を統合）`};}
    const rows=filterBatterProfilePitches(leaguePitches,{...detailFilters,pitcherThrows:"",batterSide:""},leaguePitches);return {rows,label:"同シーズン・リーグ全体"};
  },[exactLeague,leaguePitches,detailFilters,comparisonSide]);
  const detailedPitches=useMemo(()=>filterBatterProfilePitches(pitches,detailFilters,leaguePitches),[pitches,detailFilters,leaguePitches]);
  const detailMetrics=useMemo(()=>compareProfileMetrics(calculateProfileMetrics(detailedPitches,thresholds),calculateProfileMetrics(comparison.rows,thresholds)),[detailedPitches,comparison.rows,thresholds]);
  const detailProfile=useMemo(()=>buildBatterProfile(detailedPitches,comparison.rows,DEFAULT_ZONE,thresholdLeaguePitches),[detailedPitches,comparison.rows,thresholdLeaguePitches]);
  const pitchTypes=[...new Set(leaguePitches.map((row)=>row.pitchType))].sort();
  const update=(key:keyof DetailFilters,value:string|number|null)=>setDetailFilters({...detailFilters,[key]:value});
  const printedAt=new Intl.DateTimeFormat("ja-JP",{dateStyle:"medium",timeStyle:"short",timeZone:"Asia/Tokyo"}).format(new Date());
  const thresholdText=profile.thresholds.map((row)=>`${row.season} ${row.value===null?"—":`${row.value.toFixed(1)}km/h以上`}（n=${row.n}）`).join("／");
  const displayPlateAppearances=profile.counts.pitches===Number(player.pitches)?player.pa:profile.counts.plateAppearances;
  const keyMetrics:Array<[string,keyof typeof profile.metrics,boolean?]>=[["初球Swing%","firstPitchSwing"],["Swing%","swing"],["Zone Swing%","zoneSwing"],["Chase%","chase",true],["Contact%","contact"],["Zone Contact%","zoneContact"],["Chase Contact%","chaseContact"],["Whiff%","whiff",true],["見逃しS%","calledStrike",true],["ファウル率","foul"],["平均EV","avgExitVelocity"],["強い打球率","hardHit"]];
  if(!pitches.length)return <div className="profile-body"><p className="sample-warning">現在の条件に該当する投球がありません。</p></div>;
  return <div className="batter-profile-workspace">
    <div className="batter-profile-mode"><button className={mode==="sheet"?"active":""} onClick={()=>setMode("sheet")}>概要シート</button><button className={mode==="detail"?"active":""} onClick={()=>setMode("detail")}>詳細分析</button></div>
    {mode==="sheet"?<section className="scouting-print-root batter-profile-print-root"><div className="batter-profile-sheet batter-profile-screen-sheet">
      <div className="batter-profile-heading"><div><span>BATTER PROFILE</span><h2>{player.kanji||player.name}</h2><b>{player.team}・{profile.batterSide}打</b></div><dl><div><dt>対象</dt><dd>{seasonLabel}</dd></div><div><dt>試合</dt><dd>{profile.counts.games}</dd></div><div><dt>打席</dt><dd>{displayPlateAppearances??profile.counts.plateAppearances}</dd></div><div><dt>投球</dt><dd>{profile.counts.pitches}</dd></div><div><dt>有効打球</dt><dd>{profile.counts.validBattedBalls}</dd></div><div><dt>対右／左</dt><dd>{profile.counts.vsRightPitches}／{profile.counts.vsLeftPitches}</dd></div><div><dt>出力</dt><dd>{printedAt}</dd></div></dl><button className="secondary-button scouting-print-button" onClick={()=>triggerScoutingPrint("batter-profile")}>A4横で印刷</button></div>
      <div className="batter-profile-official"><span>打率 <b>{formatValue(player.battingAverage,"decimal")}</b></span><span>出塁率 <b>{formatValue(player.onBasePercentage,"decimal")}</b></span><span>長打率 <b>{formatValue(player.sluggingPercentage,"decimal")}</b></span><span>三振率 <b>{player.pa?formatValue(player.strikeouts/player.pa,"rate"):"—"}</b></span><span>四球率 <b>{player.pa?formatValue(player.walks/player.pa,"rate"):"—"}</b></span><em>既存の正式成績定義を使用</em></div>
      <div className="batter-profile-top"><section className="batter-profile-tags"><h3>打者タイプ</h3><div>{profile.tags.length?profile.tags.map((tag)=><details key={tag.label}><summary>{tag.label}</summary><p>{tag.reason}</p></details>):<span>判定に必要な差・母数なし</span>}</div></section><section className="batter-profile-summary"><h3>数値から見える特徴</h3>{profile.summaries.length?<ul>{profile.summaries.map((text)=><li key={text}>{text}</li>)}</ul>:<p>リーグ平均から大きく外れ、かつ母数を満たす特徴はありません。</p>}</section></div>
      <p className="batter-profile-threshold"><strong>強い打球基準：</strong>{thresholdText}<span>選択シーズンの東都リーグ有効打球速度75パーセンタイル。固定値ではありません。</span></p>
      <div className="batter-profile-ev-strip"><span>平均EV <b>{formatProfileMetric(profile.metrics.avgExitVelocity)}</b></span><span>中央値 <b>{formatProfileMetric(profile.metrics.medianExitVelocity)}</b></span><span>最大EV <b>{formatProfileMetric(profile.metrics.maxExitVelocity)}</b></span><span>強打EV <b>{formatProfileMetric(profile.metrics.strongContactEv)}</b><small>有効打球速度上位50%の平均</small></span></div>
      <div className="batter-profile-metrics">{keyMetrics.map(([label,key,invert])=><ProfileMetricTile key={key} label={label} metric={profile.metrics[key]} invert={invert}/>)}</div>
      <section className="batter-profile-groups"><header><h3>球種グループ別</h3><span>見極め・コンタクト・打球品質の2軸以上が一致した場合だけ総合判定</span></header><div className="batter-profile-table-scroll"><table><thead><tr><th>グループ</th><th>球数／割合</th><th>Swing</th><th>Chase</th><th>Contact</th><th>Whiff</th><th>InPlay</th><th>平均EV</th><th>強い打球</th><th>差</th><th>判定</th><th>信頼度</th></tr></thead><tbody>{profile.pitchGroups.map((row)=><tr key={row.group}><th>{row.group}<small>{row.componentTypes.join("・")}</small></th><td>{row.pitches}／{row.usageRate===null?"—":`${(row.usageRate*100).toFixed(0)}%`}</td><td>{formatProfileMetric(row.metrics.swing)}</td><td>{formatProfileMetric(row.metrics.chase)}</td><td>{formatProfileMetric(row.metrics.contact)}</td><td>{formatProfileMetric(row.metrics.whiff)}</td><td>{row.metrics.avgExitVelocity.denominator}</td><td>{formatProfileMetric(row.metrics.avgExitVelocity)}</td><td>{formatProfileMetric(row.metrics.hardHit)}</td><td>{profileDelta(row.metrics.hardHit)}</td><td><b className={ratingClass(row.rating)}>{row.rating}</b></td><td>{row.metrics.swing.confidence}</td></tr>)}</tbody></table></div></section>
      <div className="batter-profile-middle"><ProfileZoneMap title="コース別コンタクト" zones={profile.zones} metricKey="contact" batterSide={profile.batterSide}/><ProfileZoneMap title="コース別打球品質" zones={profile.zones} metricKey="avgExitVelocity" batterSide={profile.batterSide}/><section className="batter-profile-sprays"><header><h3>対右／対左投手の打球方向</h3><span>方向と飛距離／点サイズは打球速度</span></header><div>{profile.spray.map((split)=><ProfileSprayChart key={split.pitcherThrows} split={split}/>)}</div></section></div>
      <div className="batter-profile-bottom"><section><h3>入る／逃げる球</h3><table><thead><tr><th>方向</th><th>n／変化幅</th><th>Swing／Chase</th><th>Contact／Whiff</th><th>平均EV／強打</th><th>判定／差／信頼度</th></tr></thead><tbody>{profile.movement.map((row)=><tr key={row.direction}><th>{row.direction}</th><td>{row.pitches}<small>{row.commonMagnitude??"—"}</small></td><td>{formatProfileMetric(row.metrics.swing)}<small>{formatProfileMetric(row.metrics.chase)}</small></td><td>{formatProfileMetric(row.metrics.contact)}<small>{formatProfileMetric(row.metrics.whiff)}</small></td><td>{formatProfileMetric(row.metrics.avgExitVelocity)}<small>{formatProfileMetric(row.metrics.hardHit)}</small></td><td className={ratingClass(row.rating)}>{row.rating}<small>{profileDelta(row.metrics.hardHit)}・P/S/B {row.metrics.swing.confidence}/{row.metrics.contact.confidence}/{row.metrics.hardHit.confidence}</small></td></tr>)}</tbody></table></section><section><h3>上下変化別</h3><table><thead><tr><th>球種群</th><th>区分／n</th><th>Swing／Contact／Whiff</th><th>平均EV／強打</th><th>差／信頼度</th></tr></thead><tbody>{profile.vertical.map((row)=><tr key={`${row.group}-${row.classification}`}><th>{row.group}</th><td>{row.label}<small>n={row.pitches}</small></td><td>{formatProfileMetric(row.metrics.swing)}／{formatProfileMetric(row.metrics.contact)}<small>{formatProfileMetric(row.metrics.whiff)}</small></td><td>{formatProfileMetric(row.metrics.avgExitVelocity)}<small>{formatProfileMetric(row.metrics.hardHit)}</small></td><td>{profileDelta(row.metrics.hardHit)}<small>P/S/B {row.metrics.swing.confidence}/{row.metrics.contact.confidence}/{row.metrics.hardHit.confidence}</small></td></tr>)}</tbody></table></section><section><h3>ストレート球速帯</h3><table><thead><tr><th>球速帯／n</th><th>Swing／Contact／Whiff</th><th>InPlay／平均EV</th><th>強打／差</th><th>打率／長打率</th><th>信頼度</th></tr></thead><tbody>{profile.velocityBands.map((row)=><tr key={row.band}><th>{row.band}<small>n={row.pitches}</small></th><td>{formatProfileMetric(row.metrics.swing)}／{formatProfileMetric(row.metrics.contact)}<small>{formatProfileMetric(row.metrics.whiff)}</small></td><td>{row.metrics.avgExitVelocity.denominator}<small>{formatProfileMetric(row.metrics.avgExitVelocity)}</small></td><td>{formatProfileMetric(row.metrics.hardHit)}<small>{profileDelta(row.metrics.hardHit)}</small></td><td>{formatProfileMetric(row.metrics.battingAverage)}<small>{formatProfileMetric(row.metrics.sluggingPercentage)}</small></td><td>P/S/B<small>{row.metrics.swing.confidence}/{row.metrics.contact.confidence}/{row.metrics.hardHit.confidence}</small></td></tr>)}</tbody></table></section></div>

    </div><BatterProfilePrintPage player={player} profile={profile} seasonLabel={seasonLabel} plateAppearances={displayPlateAppearances} thresholdText={thresholdText} verticalRows={printVerticalRows}/></section>:<section className="batter-profile-detail">
      <header><span>CONDITION EXPLORER</span><h2>{player.kanji||player.name} 詳細分析</h2><p>条件を組み合わせ、実際の投球・スイング・打球だけを再集計します。</p></header>
      <div className="batter-profile-presets">{Object.keys(PROFILE_PRESETS).map((name)=><button key={name} onClick={()=>setDetailFilters({...EMPTY_DETAIL_FILTERS,...PROFILE_PRESETS[name]})}>{name}</button>)}<button onClick={()=>setDetailFilters(EMPTY_DETAIL_FILTERS)}>全条件を解除</button></div>
      <div className="batter-profile-filter-grid">
        <label>投手左右<select value={detailFilters.pitcherThrows||""} onChange={e=>update("pitcherThrows",e.target.value)}><option value="">すべて</option><option>右</option><option>左</option></select></label><label>打者左右<select value={detailFilters.batterSide||""} onChange={e=>update("batterSide",e.target.value)}><option value="">登録左右</option><option>右</option><option>左</option></select></label><label>球種グループ<select value={detailFilters.pitchGroup||""} onChange={e=>update("pitchGroup",e.target.value)}><option value="">すべて</option><option>変化球系</option>{PITCH_GROUP_ORDER.map(v=><option key={v}>{v}</option>)}</select></label><label>個別球種<select value={detailFilters.pitchType||""} onChange={e=>update("pitchType",e.target.value)}><option value="">すべて</option>{pitchTypes.map(v=><option key={v}>{v}</option>)}</select></label>
        <label>最低球速<input type="number" inputMode="decimal" value={detailFilters.velocityMin??""} onChange={e=>update("velocityMin",e.target.value?Number(e.target.value):null)} placeholder="km/h"/></label><label>最高球速<input type="number" inputMode="decimal" value={detailFilters.velocityMax??""} onChange={e=>update("velocityMax",e.target.value?Number(e.target.value):null)} placeholder="km/h"/></label><label>横変化方向<select value={detailFilters.movementDirection||""} onChange={e=>update("movementDirection",e.target.value)}><option value="">すべて</option><option>打者へ入る</option><option>ほぼ真っすぐ</option><option>打者から逃げる</option></select></label><label>横変化帯<select value={detailFilters.movementBand||""} onChange={e=>update("movementBand",e.target.value)}><option value="">すべて</option><option>10cm未満</option><option>10～20cm</option><option>20～30cm</option><option>30cm以上</option></select></label><label>横変化量下限<input type="number" inputMode="decimal" value={detailFilters.movementMin??""} onChange={e=>update("movementMin",e.target.value?Number(e.target.value):null)} placeholder="cm以上"/></label>
        <label>上下変化区分<select value={detailFilters.verticalClass||""} onChange={e=>update("verticalClass",e.target.value)}><option value="">すべて</option><option>上位25%</option><option>中央50%</option><option>下位25%</option></select></label><label>内外<select value={detailFilters.horizontal||""} onChange={e=>update("horizontal",e.target.value)}><option value="">すべて</option><option>内角</option><option>中央</option><option>外角</option></select></label><label>高低<select value={detailFilters.vertical||""} onChange={e=>update("vertical",e.target.value)}><option value="">すべて</option><option>高め</option><option>中段</option><option>低め</option></select></label><label>ゾーン<select value={detailFilters.zone||""} onChange={e=>update("zone",e.target.value)}><option value="">すべて</option><option>ゾーン内</option><option>ゾーン外</option></select></label>
        <label>カウント<select value={detailFilters.count||""} onChange={e=>update("count",e.target.value)}><option value="">すべて</option>{["0-0","0-1","0-2","1-0","1-1","1-2","2-0","2-1","2-2","3-0","3-1","3-2"].map(v=><option key={v}>{v}</option>)}</select></label><label>局面<select value={detailFilters.situation||""} onChange={e=>update("situation",e.target.value)}><option value="">すべて</option><option>初球</option><option>2ストライク後</option><option>2ストライク・ゾーン外</option></select></label><label>打球種類<select value={detailFilters.hitType||""} onChange={e=>update("hitType",e.target.value)}><option value="">すべて</option><option>ゴロ</option><option>ライナー</option><option>フライ</option><option>ポップフライ</option></select></label>
      </div>
      <div className="batter-profile-detail-summary"><strong>対象 {detailedPitches.length.toLocaleString("ja-JP")}球／スイング {(detailMetrics.swing.numerator??0).toLocaleString("ja-JP")}／インプレー {detailedPitches.filter((row)=>row.result==="インプレー").length.toLocaleString("ja-JP")}／有効打球 {detailMetrics.avgExitVelocity.denominator.toLocaleString("ja-JP")}</strong><span>比較基準：{comparison.label}（n={comparison.rows.length.toLocaleString("ja-JP")}）</span></div>
      <div className="batter-profile-metrics detail">{keyMetrics.map(([label,key,invert])=><ProfileMetricTile key={key} label={label} metric={detailMetrics[key]} invert={invert}/>)}</div>
      <div className="chart-grid"><ChartCard title="選択条件の投球位置"><SearchPitchLocationPlot pitches={detailedPitches}/></ChartCard><section className="batter-profile-sprays detail-sprays"><header><h3>選択条件の打球方向</h3><span>対右／対左投手別</span></header><div>{detailProfile.spray.map((split)=><ProfileSprayChart key={split.pitcherThrows} split={split}/>)}</div></section></div>

    </section>}
  </div>;
}

function BatterTab({ tab, player, officialPlayer, pitches, allPitches, profilePitches, profileLeaguePitches, profileThresholdPitches, seasonLabel, benchmarks }: { tab: string; player: Row; officialPlayer: Row; pitches: Row[]; allPitches: Row[]; profilePitches: Row[]; profileLeaguePitches: Row[]; profileThresholdPitches: Row[]; seasonLabel: string; benchmarks: Record<string, Benchmark> }) {
  if (tab === "概要") return <><SampleNotice n={pitches.length} threshold={30} /><MatchupInsights role="batter" playerPitches={pitches} allPitches={allPitches} /><BatterProfile player={player} pitches={pitches} allPitches={allPitches} benchmarks={benchmarks} seasonLabel={seasonLabel} /></>;
  if (tab === "打者プロファイル") return <BatterProfileWorkspace player={officialPlayer} pitches={profilePitches} leaguePitches={profileLeaguePitches} thresholdLeaguePitches={profileThresholdPitches} seasonLabel={seasonLabel}/>;
  if (tab === "球種") return <div className="profile-body"><SampleNotice n={pitches.length} threshold={30} /><SimpleTable rows={summarizeByPitchType(pitches, "batter")} rowKey="pitchType" columns={[{key:"pitchType",label:"球種"},{key:"pitches",label:"球数"},{key:"battingAverage",label:"打球安打率",format:"decimal"},{key:"avgExitVelocity",label:"平均打球速度"},{key:"hardHitRate",label:"強打率",format:"rate"},{key:"whiffRate",label:"空振り率",format:"rate"},{key:"sampleNote",label:"標本"}]} /></div>;
  if (tab === "コース") return <div className="profile-body"><ChartCard title="9・25・81分割 シームレスヒートマップ"><ContinuousZoneHeatmap pitches={pitches} role="batter" /></ChartCard><ChartCard title="カウント別成績"><CountTable pitches={pitches} role="batter" /></ChartCard></div>;
  if (tab === "打球") return <BattedBallAnalysis pitches={pitches} player={player} seasonLabel={seasonLabel} />;
  if (tab === "試合推移") return <div className="profile-body"><MetricTrendChart pitches={pitches} role="batter" /></div>;
  if (tab === "シフト") return <ShiftPlayerPanel player={player} pitches={pitches} allPitches={allPitches} />;
  if (tab === "AIレポート") return <AIReport role="batter" pitches={pitches} allPitches={allPitches} />;
  return null;
}

function PitchPlot({ pitches }: { pitches: Row[] }) {
  const rows = pitches.filter((row) => Number.isFinite(row.plateX) && Number.isFinite(row.plateZ));
  const extent = Math.max(.65, ...rows.map(p => Math.abs(p.plateX)+.04));
  const { x, y } = pitchProjection(420, 360, {left:-extent,right:extent,bottom:Math.min(.15,...rows.map(p=>p.plateZ-.04)),top:Math.max(1.4,...rows.map(p=>p.plateZ+.04))});
  return <div className="chart-inner"><svg viewBox="0 0 420 360" role="img" aria-label="捕手側から見た投球位置"><rect x={x(-.254)} y={y(1.05)} width={x(.254)-x(-.254)} height={y(.45)-y(1.05)} fill="none" stroke="#263638" strokeWidth="2" />{rows.slice(-700).map((row, index) => <circle key={`${row.id}-${index}`} cx={x(row.plateX)} cy={y(row.plateZ)} r="4" fill={PITCH_COLORS[row.pitchType] ?? "#777"} opacity=".55"><title>{row.pitchType} {row.velocity ?? "—"}km/h</title></circle>)}</svg><CatcherViewAxis/><div className="legend">{[...new Set(rows.map((row) => row.pitchType))].map((type) => <span key={type}><i style={{background:PITCH_COLORS[type]}} />{type}</span>)}</div></div>;
}

function ReleasePlot({ pitches }: { pitches: Row[] }) {
  const rows = pitches.filter((row) => Number.isFinite(row.releaseSide) && Number.isFinite(row.releaseHeight));
  if (!rows.length) return <p className="empty-chart">リリース位置の計測データがありません。</p>;
  const xs = rows.map((row) => row.releaseSide), ys = rows.map((row) => row.releaseHeight);
  const xmin = Math.min(...xs)-10, xmax = Math.max(...xs)+10, ymin = Math.min(...ys)-10, ymax = Math.max(...ys)+10;
  const x = (v:number) => 40 + (v-xmin)/Math.max(1,xmax-xmin)*350, y=(v:number)=>320-(v-ymin)/Math.max(1,ymax-ymin)*270;
  return <div className="chart-inner"><svg viewBox="0 0 420 350" role="img" aria-label="リリース位置"><rect x="40" y="30" width="350" height="290" fill="#fafafa" stroke="#d8dcde" />{rows.slice(-700).map((row,index)=><circle key={`${row.id}-${index}`} cx={x(row.releaseSide)} cy={y(row.releaseHeight)} r="4" fill={PITCH_COLORS[row.pitchType]??"#777"} opacity=".5"><title>{row.pitchType} 横{row.releaseSide}cm 高さ{row.releaseHeight}cm</title></circle>)}</svg><p>横位置 × リリース高（cm）</p></div>;
}

function PitcherLocationPanel({ pitches }: { pitches: Row[] }) {
  const metrics = locationMetrics(pitches);
  const byType = summarizeByPitchType(pitches,"pitcher").map((type) => {
    const rows = pitches.filter((row) => row.pitchType===type.pitchType); const values=locationMetrics(rows);
    return { pitchType:type.pitchType,pitches:rows.length,...values,sampleNote:rows.length<20?"サンプル不足":"" };
  });
  return <div className="profile-body"><div className="metric-strip"><MetricBlock label="ゾーン率" metricKey="zoneRate" value={metrics.zoneRate} format="rate" /><MetricBlock label="エッジ率" metricKey="edgeRate" value={metrics.edgeRate} format="rate" /><MetricBlock label="真ん中率" metricKey="heartRate" value={metrics.heartRate} format="rate" /><MetricBlock label="投球位置SD" metricKey="locationSd" value={metrics.locationSd} /><MetricBlock label="リリース再現性" metricKey="releaseSd" value={metrics.releaseSd} /></div><AttackZoneProfile pitches={pitches} /><details className="method-card chart-definition"><summary>Commandではありません</summary><p>TrackManには投手が狙った位置がありません。そのため、ここでは実際の到達位置、ばらつき、リリース位置の再現性だけを表示しています。</p></details><div className="chart-grid"><ChartCard title="投球位置"><PitchPlot pitches={pitches}/></ChartCard><ChartCard title="投球密度"><ContinuousZoneHeatmap pitches={pitches} role="pitcher" metric="density" /></ChartCard></div><SectionTitle title="球種別ロケーション安定性"/><SimpleTable rows={byType} rowKey="pitchType" columns={[{key:"pitchType",label:"球種"},{key:"pitches",label:"球数"},{key:"zoneRate",label:"ゾーン率",format:"rate"},{key:"edgeRate",label:"エッジ率",format:"rate"},{key:"heartRate",label:"真ん中率",format:"rate"},{key:"locationSd",label:"投球位置SD"},{key:"releaseSd",label:"リリース再現性"},{key:"sampleNote",label:"標本"}]} /></div>;
}

function ContinuousZoneHeatmap({ pitches, role: _role, metric = "ev" }: { pitches: Row[]; role: "pitcher" | "batter"; metric?: "ev" | "density" }) {
  const [gridSize,setGridSize]=useState<3|5|9>(3);
  const { x, y } = pitchProjection(450, 500, {left:-.45,right:.45,bottom:.25,top:1.25}, 0); const [side,setSide]=useState("");
  const rows=pitches.filter((row)=>Number.isFinite(row.plateX)&&Number.isFinite(row.plateZ)&&(!side||row.batterSide===side));
  const cells=Array.from({length:gridSize*gridSize},()=>({n:0,sum:0}));
  rows.forEach((row)=>{ if(row.plateX<-.45||row.plateX>.45||row.plateZ<.25||row.plateZ>1.25)return; const c=Math.min(gridSize-1,Math.max(0,Math.floor((row.plateX+.45)/.9*gridSize))); const r=Math.min(gridSize-1,Math.max(0,gridSize-1-Math.floor((row.plateZ-.25)/1*gridSize))); const cell=cells[r*gridSize+c]; if(metric==="density"){cell.n++;cell.sum++;} else if(Number.isFinite(row.exitVelocity)){cell.n++;cell.sum+=row.exitVelocity;} });
  const values=cells.map((cell)=>metric==="density"?cell.n:(cell.n?cell.sum/cell.n:null)).filter(Number.isFinite) as number[]; const min=values.length?Math.min(...values):0,max=values.length?Math.max(...values):1;
  const color=(value:number|null,n:number)=>{if(value===null||!n)return "transparent";const t=(value-min)/Math.max(.001,max-min);return `rgba(${Math.round(34+195*t)},${Math.round(142-93*t)},${Math.round(151-100*t)},${Math.min(.86,.18+Math.sqrt(n)/8)})`;};
  const blurId=`zone-blur-${useId().replace(/:/g,"")}`;
  return <div className="smooth-heatmap"><div className="heatmap-controls"><div className="segmented">{[[3,"9分割"],[5,"25分割"],[9,"81分割"]].map(([size,label])=><button key={size} className={gridSize===size?"active":""} onClick={()=>setGridSize(size as 3|5|9)}>{label}</button>)}</div><select value={side} onChange={(event)=>setSide(event.target.value)}><option value="">左右すべて</option><option>右</option><option>左</option></select></div><svg viewBox="0 0 450 500" role="img" aria-label="捕手側から見たシームレスヒートマップ"><defs><filter id={blurId} x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation={gridSize===3?34:gridSize===5?22:12}/></filter><clipPath id={`${blurId}-clip`}><rect x="0" y="0" width="450" height="500"/></clipPath></defs><g clipPath={`url(#${blurId}-clip)`} filter={`url(#${blurId})`}>{cells.map((cell,index)=>{const row=Math.floor(index/gridSize),col=index%gridSize,value=metric==="density"?cell.n:(cell.n?cell.sum/cell.n:null);return <rect key={index} x={col*450/gridSize} y={row*500/gridSize} width={450/gridSize} height={500/gridSize} fill={color(value,cell.n)} />;})}</g><rect x={x(-.254)} y={y(1.05)} width={x(.254)-x(-.254)} height={y(.45)-y(1.05)} fill="none" stroke="#263638" strokeWidth="3"/>{[1,2].map(i=><g key={i}><line x1={x(-.254+.508*i/3)} x2={x(-.254+.508*i/3)} y1={y(1.05)} y2={y(.45)} stroke="#263638" opacity=".45"/><line x1={x(-.254)} x2={x(.254)} y1={y(.45+.6*i/3)} y2={y(.45+.6*i/3)} stroke="#263638" opacity=".45"/></g>)}</svg><CatcherViewAxis/><div className="heat-scale"><span>{metric==="density"?"少":"遅い"}</span><i/><span>{metric==="density"?"多":"速い"}</span></div></div>;
}

function CountTable({ pitches, role }: { pitches: Row[]; role: "pitcher"|"batter" }) {
  const counts=["0-0","0-1","0-2","1-0","1-1","1-2","2-0","2-1","2-2","3-0","3-1","3-2"];
  const rows=counts.map((count)=>{const group=pitches.filter((row)=>`${row.balls}-${row.strikes}`===count);const swings=group.filter((row)=>["空振り","インプレー","ファウル","ファウルフライ"].includes(row.result)).length; const whiffs=group.filter((row)=>row.result==="空振り").length;const csw=group.filter((row)=>row.result==="空振り"||row.result==="見逃しストライク").length;return {count,pitches:group.length,whiffRate:swings?whiffs/swings:null,cswRate:group.length?csw/group.length:null,avgExitVelocity:meanOf(group,"exitVelocity"),sampleNote:group.length<10?"参考":""};}).filter((row)=>row.pitches);
  return <SimpleTable rows={rows} rowKey="count" columns={[{key:"count",label:"カウント"},{key:"pitches",label:"球数"},{key:"whiffRate",label:"空振り率",format:"rate"},{key:"cswRate",label:role==="pitcher"?"見逃し・空振り率":"被CSW率",format:"rate"},{key:"avgExitVelocity",label:role==="pitcher"?"平均被打球速度":"平均打球速度"},{key:"sampleNote",label:"標本"}]} />;
}

function MetricTrendChart({ pitches, role }: { pitches: Row[]; role: "pitcher"|"batter" }) {
  const options=role==="pitcher"?["velocity","spin","ivb","hb","releaseHeight","releaseSide"]:["exitVelocity","launchAngle"];const [metric,setMetric]=useState(options[0]);
  const groups=new Map<string,Row[]>();pitches.forEach((row)=>{const arr=groups.get(row.gameId)??[];arr.push(row);groups.set(row.gameId,arr)});const points=[...groups.entries()].map(([id,rows])=>({id,date:rows[0]?.date,value:meanOf(rows,metric),n:rows.filter((row)=>Number.isFinite(row[metric])).length})).filter((row)=>row.value!==null).sort((a,b)=>a.date.localeCompare(b.date));
  const values=points.map((row)=>row.value as number); const min=values.length?Math.min(...values):0,max=values.length?Math.max(...values):1;const x=(i:number)=>50+i/Math.max(1,points.length-1)*430,y=(v:number)=>300-(v-min)/Math.max(.001,max-min)*235;
  const labels:Row={velocity:"平均球速",spin:"平均回転数",ivb:"IVB",hb:"横変化",releaseHeight:"リリース高",releaseSide:"リリース横",exitVelocity:"平均打球速度",launchAngle:"平均打球角度"};
  return <ChartCard title="試合内・試合別推移"><div className="trend-control"><label>表示<select value={metric} onChange={(event)=>setMetric(event.target.value)}>{options.map((value)=><option value={value} key={value}>{labels[value]}</option>)}</select></label></div>{points.length?<svg className="trend-svg" viewBox="0 0 520 340" role="img" aria-label={`${labels[metric]}推移`}><line x1="50" x2="480" y1="300" y2="300" stroke="#aeb5b7"/><polyline points={points.map((row,index)=>`${x(index)},${y(row.value as number)}`).join(" ")} fill="none" stroke="#318b93" strokeWidth="4"/>{points.map((row,index)=><g key={row.id}><circle cx={x(index)} cy={y(row.value as number)} r="5" fill="#c52636"><title>{row.date} {Number(row.value).toFixed(1)} n={row.n}</title></circle><text x={x(index)} y="322" textAnchor="middle">{row.date?.slice(5)}</text></g>)}</svg>:<p className="empty-chart">該当する計測値がありません。</p>}</ChartCard>;
}

function PitchSequence({ pitches }: { pitches: Row[] }) {
  const ordered=[...pitches].sort((a,b)=>`${a.gameId}|${a.inning}|${a.time}|${a.id}`.localeCompare(`${b.gameId}|${b.inning}|${b.time}|${b.id}`));const pairs=new Map<string,number>();for(let i=1;i<ordered.length;i++){if(ordered[i-1].gameId!==ordered[i].gameId)continue;const key=`${ordered[i-1].pitchType} → ${ordered[i].pitchType}`;pairs.set(key,(pairs.get(key)??0)+1)}const rows=[...pairs.entries()].map(([sequence,count])=>({sequence,count})).sort((a,b)=>b.count-a.count).slice(0,12);return <SimpleTable rows={rows} rowKey="sequence" columns={[{key:"sequence",label:"連続球種"},{key:"count",label:"回数"}]} />;
}

function PitchTunnel({ pitches }: { pitches: Row[] }) {
  const types=summarizeByPitchType(pitches,"pitcher").filter((row)=>row.pitches>=8);const rows=[] as Row[];for(let i=0;i<types.length;i++)for(let j=i+1;j<types.length;j++){const a=pitches.filter((row)=>row.pitchType===types[i].pitchType),b=pitches.filter((row)=>row.pitchType===types[j].pitchType);const release=Math.hypot((meanOf(a,"releaseSide")??0)-(meanOf(b,"releaseSide")??0),(meanOf(a,"releaseHeight")??0)-(meanOf(b,"releaseHeight")??0));const plate=Math.hypot(((meanOf(a,"plateX")??0)-(meanOf(b,"plateX")??0))*100,((meanOf(a,"plateZ")??0)-(meanOf(b,"plateZ")??0))*100);rows.push({pair:`${types[i].pitchType} × ${types[j].pitchType}`,releaseGap:release,plateGap:plate,tunnelScore:plate-Math.min(plate,release)});}rows.sort((a,b)=>b.tunnelScore-a.tunnelScore);return <div><SimpleTable rows={rows.slice(0,8)} rowKey="pair" columns={[{key:"pair",label:"球種ペア"},{key:"releaseGap",label:"リリース差"},{key:"plateGap",label:"到達点差"},{key:"tunnelScore",label:"トンネル差"}]} /><details className="chart-definition"><summary>集計条件</summary><p>リリース平均の近さとホームベース上の分離を比較した簡易値です。軌道全体を再現する正式なトンネル指標ではありません。</p></details></div>;
}

function BattedBallAnalysis({ pitches, player, seasonLabel }: { pitches: Row[]; player: Row; seasonLabel: string }) {
  const rows=pitches.filter((row)=>Number.isFinite(row.exitVelocity));const evs=rows.map((row)=>row.exitVelocity).sort((a,b)=>a-b);const q=(p:number)=>evs.length?evs[Math.min(evs.length-1,Math.floor((evs.length-1)*p))]:null;const hard=rows.filter((row)=>row.exitVelocity>=152.9).length;const barrels=rows.filter((row)=>{const mph=row.exitVelocity/1.609344;if(mph<98||!Number.isFinite(row.launchAngle))return false;const over=mph-98;return row.launchAngle>=Math.max(8,26-over)&&row.launchAngle<=Math.min(50,30+over*1.5)}).length;
  return <div className="profile-body"><SampleNotice n={rows.length} threshold={20}/><div className="metric-strip"><MetricBlock label="平均打球速度" value={meanOf(rows,"exitVelocity")}/><MetricBlock label="中央値打球速度" value={q(.5)}/><MetricBlock label="最高打球速度" value={evs.length?evs[evs.length-1]:null}/><MetricBlock label="上位10%打球速度" value={q(.9)}/><MetricBlock label="強打率" value={rows.length?hard/rows.length:null} format="rate"/><MetricBlock label="Barrel相当" value={rows.length?barrels/rows.length:null} format="rate"/></div><div className="chart-grid"><ChartCard title="打球方向"><PrintableBatterSpray pitches={rows} player={player} seasonLabel={seasonLabel}/></ChartCard><ChartCard title="打球角度分布"><LaunchAngleDistribution pitches={rows}/></ChartCard></div><details className="method-card chart-definition"><summary>Barrel相当</summary><p>MLB公式モデルを完全再現したBarrelではありません。98mph以上を起点に、球速が上がるほど許容角度を広げる簡易条件で表示します。</p></details></div>;
}

function LaunchAngleDistribution({pitches}:{pitches:Row[]}){const buckets=[{label:"ゴロ <0°",min:-90,max:0},{label:"低い打球 0–10°",min:0,max:10},{label:"ライナー 10–25°",min:10,max:25},{label:"フライ 25–50°",min:25,max:50},{label:"高いフライ 50°+",min:50,max:91}].map((bucket)=>({...bucket,n:pitches.filter((row)=>row.launchAngle>=bucket.min&&row.launchAngle<bucket.max).length}));const max=Math.max(...buckets.map((b)=>b.n),1);return <div className="bar-list">{buckets.map((bucket)=><div key={bucket.label}><span>{bucket.label}</span><i style={{width:`${bucket.n/max*100}%`}}/><b>{bucket.n}</b></div>)}</div>}

function AIReport({role,pitches,allPitches}:{role:"pitcher"|"batter";pitches:Row[];allPitches:Row[]}){const groups=summarizeByPitchType(pitches,role);const tendenciesPitch=buildTendencyGroups(pitches,allPitches,role,"pitchType");const tendenciesZone=buildTendencyGroups(pitches,allPitches,role,"zone");const best=tendenciesPitch[tendenciesPitch.length-1],worst=tendenciesPitch[0],bestZone=tendenciesZone[tendenciesZone.length-1],worstZone=tendenciesZone[0];const enough=pitches.length>=(role==="pitcher"?50:30);const topUsage=groups[0];const late=pitches.filter((row)=>row.strikes===2);const lateWhiff=late.filter((row)=>row.result==="空振り").length/Math.max(1,late.filter((row)=>["空振り","インプレー","ファウル","ファウルフライ"].includes(row.result)).length);return <article className="ai-report"><header><span>TRACKMAN GROUNDED</span><h2>AIレポート</h2><p>現在のフィルター条件・n={pitches.length}球</p></header>{!enough&&<p className="sample-warning">サンプル不足。以下は断定ではなく参考傾向です。</p>}<section><h3>{role==="pitcher"?"武器球と注意球種":"得意球種と苦手球種"}</h3><p>{best?`${best.label}は補正100球価値${signed(best.adjusted)}、n=${best.n}で、この条件では最も良い傾向です。`:"サンプル不足"} {worst?`${worst.label}は${signed(worst.adjusted)}、n=${worst.n}で注意が必要です。`:""}</p></section><section><h3>コース傾向</h3><p>{bestZone?`${bestZone.label}が相対的に有効（${signed(bestZone.adjusted)}、n=${bestZone.n}）。`:"サンプル不足"} {worstZone?`${worstZone.label}は相対的に不利（${signed(worstZone.adjusted)}、n=${worstZone.n}）。`:""}</p></section><section><h3>{role==="pitcher"?"左右・カウント別と改善案":"追い込まれてからと対戦時の注意点"}</h3><p>{topUsage?`最多は${topUsage.pitchType}の${topUsage.pitches}球。`:""} 2ストライク後の空振り率は{Number.isFinite(lateWhiff)?`${(lateWhiff*100).toFixed(1)}%（n=${late.length}）`:"サンプル不足"}です。{role==="pitcher"?"危険傾向の球種・コースを早いカウントで試し、武器球を追い込みで使えるか検証してください。":"苦手球種・コースを中心に攻められる可能性があるため、同条件の打球速度とコンタクト率を練習評価に使ってください。"}</p></section><footer>数値から生成した期間内レポートです。因果関係や将来成績を断定しません。</footer></article>}

function NewsTimeline({items}:{items:NewsItem[]}){if(!items.length)return <div className="empty-news"><h2>関連NEWSはまだありません</h2><p>公開情報が検証され、選手名マスターと一致した記事だけを表示します。</p></div>;return <div className="news-grid">{items.sort((a,b)=>b.publishedAt.localeCompare(a.publishedAt)).map((item)=><NewsCard key={item.id} item={item}/>)}</div>}

function NewsCard({item}:{item:NewsItem}){return <article className="news-card"><div className="news-card-body"><header><div><span>{item.team}</span><b>{item.category}</b></div><time>{item.publishedAt}</time></header><p className="news-player">選手：{item.playerKanji || "チーム全体"}{item.playerRoman?` / ${item.playerRoman}`:""}</p><h2>{item.headline}</h2><section className="fact"><h3>事実</h3><p>{item.fact}</p></section><section className="savant"><h3>ID東都で見る</h3><p>{item.savant}</p></section><a href={item.sourceUrl} target="_blank" rel="noreferrer">出典：{item.sourceName} ↗</a></div></article>}

function NewsView({items,data}:{items:NewsItem[];data:Dataset;navigate:(route:RouteState)=>void}){const [team,setTeam]=useState("");const [category,setCategory]=useState("");const [query,setQuery]=useState("");const [featured,setFeatured]=useState(false);const categories=[...new Set(items.map((item)=>item.category))];const needle=normalizeSearch(query);const filtered=items.filter((item)=>(!team||item.team===team)&&(!category||item.category===category)&&(!featured||item.isFeatured)&&(!needle||normalizeSearch([item.team,item.playerKanji,item.playerRoman,item.headline,item.fact,...(item.tags||[])].join(" ")).includes(needle)));return <PageSection eyebrow="NEWS / TRAINING WATCH" title="ニュース" description="事実とID東都の分析を分け、因果関係を断定せずにTrackManで確認すべきポイントを示します。"><div className="news-status"><b>毎朝更新</b><span>6大学の公式発信・取材記事・TRAINING WATCHを重複確認して追加</span></div><div className="toolbar news-toolbar"><label className="news-search">選手・話題<input value={query} onChange={(event)=>setQuery(event.target.value)} placeholder="例：鈴木泰成、球速、キャンプ"/></label><label>大学<select value={team} onChange={(event)=>setTeam(event.target.value)}><option value="">6大学すべて</option>{data.teams.map((row)=><option key={row.name}>{row.name}</option>)}</select></label><label>カテゴリ<select value={category} onChange={(event)=>setCategory(event.target.value)}><option value="">すべて</option>{categories.map((value)=><option key={value}>{value}</option>)}</select></label><button className={featured?"active":""} onClick={()=>setFeatured(!featured)}>注目のみ</button><span>{filtered.length}件</span></div><NewsTimeline items={filtered}/><details className="method-card chart-definition"><summary>更新方針</summary><p>対象は東都1部6大学の公式・大学スポーツ新聞・信頼できるスポーツメディア・公開された本人SNSです。毎朝、重複・公開日・出典・選手名を検証して更新します。</p></details></PageSection>}

function PitcherProfile({ player, pitches, allPitches, arsenal, benchmarks, onOpenSpin }: { player: Row; pitches: Row[]; allPitches: Row[]; arsenal: Row[]; benchmarks: Record<string, Benchmark>; onOpenSpin: (pitchType: string) => void }) {
  const swingingStrikeRate = pitches.length ? pitches.filter((row) => row.result === "空振り").length / pitches.length : null;
  const metrics = [
    ["総合投球指数+", "pitchingPlus", "plus"], ["球質指数+", "stuffPlus", "plus"],
    ["コース指数+", "locationPlus", "plus"], ["100球得点価値", "pitchValuePer100", "number"],
    ["推定失点率", "xera", "number"], ["空振り率", "whiffRate", "rate"],
    ["見逃し・空振り率", "cswRate", "rate"], ["平均被打球速度", "avgExitVelocityAllowed", "number"],
  ];
  const percentileRows = [
    ["総合投球指数+", player.percentiles?.pitchingPlus],
    ["球質指数+", player.percentiles?.stuffPlus],
    ["コース指数+", player.percentiles?.locationPlus],
    ["100球得点価値", player.percentiles?.pitchValuePer100],
    ["推定失点率", player.percentiles?.xera],
    ["空振り率", player.percentiles?.whiffRate],
    ["見逃し・空振り率", player.percentiles?.cswRate],
    ["強打抑制", player.percentiles?.hardHitRateAllowed],
  ].map(([label, value]) => ({ label, value: value ?? 50 }));
  return (
    <div className="profile-body">
      <div className="metric-strip">{metrics.map(([label, key, format]) => <MetricBlock key={key} label={label} metricKey={key} value={player[key]} format={format as Column["format"]} benchmark={benchmarks[key]} />)}</div>
      <BenchmarkGuide text="投手100球以上" />
      <div className="traditional-line"><span><MetricLabel label="投球回" metricKey="innings" /> {player.innings}</span><span><MetricLabel label="失点率" metricKey="era" /> {formatValue(player.era)}</span><span><MetricLabel label="奪三振" metricKey="strikeouts" /> {player.strikeouts}</span><span><MetricLabel label="四球" metricKey="walks" /> {player.walks}</span><span><MetricLabel label="SwStr%" metricKey="swingingStrikeRate" /> {formatValue(swingingStrikeRate, "rate")}</span><span><MetricLabel label="最高球速" metricKey="maxVelocity" /> {formatValue(player.maxVelocity)} km/h</span></div>
      <PercentilePanel title="リーグ内評価" rows={percentileRows} />
      <div className="chart-grid"><ChartCard title="球種別変化量"><MovementChart pitches={pitches} /></ChartCard><ChartCard title="左右別・ゾーン別被打球速度"><ZoneHeatmap pitches={allPitches} playerId={player.id} role="pitcher" /></ChartCard></div>
      <SectionTitle title="球種構成" />
      <SimpleTable rows={arsenal} rowKey="pitchType" onRowKeyClick={(row) => onOpenSpin(String(row.pitchType))} columns={[{ key: "pitchType", label: "球種" }, { key: "pitches", label: "球数" }, { key: "usageRate", label: "使用率", format: "rate" }, { key: "avgVelocity", label: "平均球速" }, { key: "maxVelocity", label: "最高球速" }, { key: "avgSpin", label: "回転数" }, { key: "avgIvb", label: "縦変化" }, { key: "avgHb", label: "横変化" }, { key: "whiffRate", label: "空振り率", format: "rate" }, { key: "swingingStrikeRate", label: "SwStr%", format: "rate" }, { key: "stuffPlus", label: "球質指数+", format: "plus" }]} />
      <ChartCard title="試合別ストレート平均球速推移"><RollingChart pitches={pitches.filter((row) => row.pitchType === "ストレート")} mode="pitcher" /></ChartCard>
    </div>
  );
}

function BatterProfile({ player, pitches, allPitches, benchmarks, seasonLabel }: { player: Row; pitches: Row[]; allPitches: Row[]; benchmarks: Record<string, Benchmark>; seasonLabel: string }) {
  const metrics = [
    ["打撃生産指数+", "wrcPlus", "plus"], ["推定加重出塁率", "xwoba", "decimal"],
    ["推定打率", "xba", "decimal"], ["推定長打率", "xslg", "decimal"],
    ["平均打球速度", "avgExitVelocity", "number"], ["上位10%打球速度", "ev90", "number"],
    ["強打率", "hardHitRate", "rate"], ["バレル率", "barrelRate", "rate"],
  ];
  return (
    <div className="profile-body">
      {player.officialRecord && <section className="official-record-card">
        <header><div><span>OFFICIAL RECORD</span><h3>公式個人成績</h3></div><b>公式記録優先</b></header>
        <div>
          {[["試合", player.games], ["打席", player.pa], ["打数", player.ab], ["安打", player.hits], ["二塁打", player.doubles], ["三塁打", player.triples], ["本塁打", player.homeRuns], ["打点", player.rbi], ["盗塁", player.stolenBases], ["四死球", player.walksHbp], ["三振", player.strikeouts], ["打率", formatValue(player.battingAverage, "decimal")]].map(([label, value]) => <span key={String(label)}><small>{label}</small><strong>{value}</strong></span>)}
        </div>
        <p>{player.officialSource}。打席・安打・本塁打などは公式値です。打球速度・角度・空振り率に加え、四死球と犠打飛の内訳が必要なOPS・加重指標はTrackMan集計を使用しています。</p>
      </section>}
      <div className="metric-strip">{metrics.map(([label, key, format]) => <MetricBlock key={key} label={label} metricKey={key} value={player[key]} format={format as Column["format"]} benchmark={benchmarks[key]} />)}</div>
      <BenchmarkGuide text="リーグ内評価：打者20打席以上" />
      {player.pa < 20 && <details className="chart-definition"><summary>集計条件</summary><p>20打席未満のため、各成績は参考値です。リーグ内評価は必要なデータが揃ってから表示します。</p></details>}
      <div className="traditional-line"><span><MetricLabel label="打席" metricKey="pa" /> {player.pa}</span><span>有効打球数 {player.bbe ?? 0}</span><span><MetricLabel label="打率" metricKey="battingAverage" /> {formatValue(player.battingAverage, "decimal")}</span><span><MetricLabel label="本塁打" metricKey="homeRuns" /> {player.homeRuns}</span><span><MetricLabel label={player.officialRecord ? "TrackMan OPS" : "出塁率＋長打率"} metricKey="ops" /> {formatValue(player.ops, "decimal")}</span><span><MetricLabel label="最高打球速度" metricKey="maxExitVelocity" /> {formatValue(player.maxExitVelocity)} km/h</span></div>
      <PercentilePanel title="リーグ内評価" rows={Object.entries(player.percentiles ?? {}).map(([key, value]) => ({ label: ({ wrcPlus: "打撃生産指数+", xwoba: "推定加重出塁率", avgExitVelocity: "平均打球速度", maxExitVelocity: "最高打球速度", hardHitRate: "強打率", barrelRate: "バレル率", whiffRate: "空振り抑制", chaseRate: "選球" } as Row)[key] ?? key, metricKey: key, value }))} />
      <div className="chart-grid"><ChartCard title="打球方向"><PrintableBatterSpray pitches={pitches} player={player} seasonLabel={seasonLabel} /></ChartCard><ChartCard title="左右投手別・ゾーン別打球速度"><ZoneHeatmap pitches={allPitches} playerId={player.id} role="batter" /></ChartCard></div>
      <ChartCard title="試合別打球速度推移"><RollingChart pitches={pitches} mode="batter" /></ChartCard>
    </div>
  );
}

function CatcherProfile({ player, benchmarks }: { player: Row; benchmarks: Record<string, Benchmark> }) {
  const areaRows = [
    ["低め", player.framingAreas?.low],
    ["高め", player.framingAreas?.high],
    ["内角側", player.framingAreas?.inside],
    ["外角側", player.framingAreas?.outside],
  ].map(([area, values]: any) => ({ area, ...(values ?? {}) }));
  const percentileRows = player.percentiles ? [
    { label: "追加ストライク", value: player.percentiles.extraStrikes },
    { label: "フレーミング得点", value: player.percentiles.framingRuns },
    { label: "境界1000球換算", value: player.percentiles.framingPer1000 },
  ] : [];
  return (
    <div className="profile-body">
      <div className="metric-strip">
        <MetricBlock label="捕球数" value={player.received} />
        <MetricBlock label="二塁送球数" value={player.popTimeSamples} />
        <MetricBlock label="平均ポップタイム" value={player.avgPopTime} format="seconds" />
        <MetricBlock label="最速ポップタイム" value={player.fastestPopTime} format="seconds" />
        <MetricBlock label="中央値ポップタイム" value={player.medianPopTime} format="seconds" />
        <MetricBlock label="境界球" value={player.shadowPitches} />
        <MetricBlock label="実ストライク率" value={player.actualStrikeRate} format="rate" benchmark={benchmarks.actualStrikeRate} />
        <MetricBlock label="期待ストライク率" metricKey="expectedStrikeRate" value={player.expectedStrikeRate} format="rate" benchmark={benchmarks.expectedStrikeRate} />
        <MetricBlock label="追加ストライク" value={player.extraStrikes} benchmark={benchmarks.extraStrikes} />
        <MetricBlock label="フレーミング得点" value={player.framingRuns} benchmark={benchmarks.framingRuns} />
        <MetricBlock label="境界1000球換算" value={player.framingPer1000} benchmark={benchmarks.framingPer1000} />
      </div>
      <BenchmarkGuide text="境界球100球以上の捕手" suffix="捕球数・境界球・二塁送球数は母数です。ポップタイムは有効な二塁送球のみを表示し、少数標本では参考値として扱います。" />
      {percentileRows.length > 0 && <PercentilePanel title="リーグ内フレーミング評価" rows={percentileRows} />}
      <div className="chart-grid">
        <ChartCard title="左右打者別フレーミング分布"><CatcherFramingHeatmap player={player} /></ChartCard>
        <ChartCard title="ゾーン端別フレーミング">
          <SimpleTable rows={areaRows} rowKey="area" columns={[{ key: "area", label: "ゾーン端" }, { key: "pitches", label: "境界球" }, { key: "actualStrikeRate", label: "実率", format: "rate" }, { key: "expectedStrikeRate", label: "期待率", format: "rate" }, { key: "extraStrikes", label: "追加S" }]} />
        </ChartCard>
      </div>
      <details className="method-card chart-definition"><summary>二塁送球ポップタイム</summary><p>BasePositionXが35m以上の二塁送球から、1.60〜2.50秒かつ捕球・リリース信頼度がLowでない記録を集計しています。平均は全記録の代表値、最速は最大出力、中央値は外れ値の影響を抑えた代表値です。件数が少ない場合は順位ではなく参考値として見てください。</p></details>
      <details className="method-card chart-definition"><summary>捕手指標の見方</summary><p>見逃し球からリーグ全体のコース別ストライク確率を推定し、実判定との差を捕手ごとに集計しています。期待確率10〜90%の境界球を評価対象とし、打者の左右、内外角、高低まで分解しています。この従来指標は球審補正を含みません。2026年秋の登録済み球審の判定差と参考補正は「審判分析」で確認できます。投手の制球・構えとの差は完全には分離できません。</p></details>
    </div>
  );
}

function CatcherFramingHeatmap({ player }: { player: Row }) {
  const [side, setSide] = useState<"右" | "左">("右");
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const filterId = `framing-blur-${useId().replace(/:/g, "")}`;
  const clipId = `framing-clip-${useId().replace(/:/g, "")}`;
  const rawCells = player.framingHeatmaps?.[side] ?? [];
  const cells = Array.from({ length: 25 }, (_, index) => rawCells[index] ?? { pitches: 0, extraStrikeRate: null, actualStrikeRate: null, expectedStrikeRate: null });
  const labels = side === "右" ? ["外角外", "外角", "中央", "内角", "内角外"] : ["内角外", "内角", "中央", "外角", "外角外"];
  const verticalLabels = ["高め外", "高め", "中央", "低め", "低め外"];
  const color = (value: number | null) => {
    if (value === null) return "#f1f3f4";
    const clamped = Math.max(-0.18, Math.min(0.18, value));
    if (clamped < 0) {
      const t = Math.abs(clamped) / 0.18;
      return `rgb(${Math.round(245 - 195 * t)},${Math.round(248 - 116 * t)},${Math.round(250 - 69 * t)})`;
    }
    const t = clamped / 0.18;
    return `rgb(${Math.round(250 - 61 * t)},${Math.round(247 - 195 * t)},${Math.round(247 - 190 * t)})`;
  };
  const selected = activeIndex === null ? null : cells[activeIndex];
  const selectedValue = selected?.pitches ? selected.extraStrikeRate : null;
  const selectSide = (value: "右" | "左") => { setSide(value); setActiveIndex(null); };
  return (
    <div className="framing-heatmap-wrap">
      <div className="segmented small"><button className={side === "右" ? "active" : ""} onClick={() => selectSide("右")}>右打者</button><button className={side === "左" ? "active" : ""} onClick={() => selectSide("左")}>左打者</button></div>
      <div className="framing-labels">{labels.map((label, index) => <span key={`${label}-${index}`}>{label}</span>)}</div>
      <div className="framing-surface">
        <svg viewBox="0 0 450 500" role="img" aria-label={`${side}打者に対するシームレスなフレーミングヒートマップ`}>
          <defs>
            <filter id={filterId} x="-18%" y="-18%" width="136%" height="136%"><feGaussianBlur stdDeviation="34" /></filter>
            <clipPath id={clipId}><rect x="0" y="0" width="450" height="500" rx="12" /></clipPath>
          </defs>
          <rect x="0" y="0" width="450" height="500" rx="12" fill="#f6f8f8" />
          <g clipPath={`url(#${clipId})`} filter={`url(#${filterId})`}>
            {cells.map((cell: Row, index: number) => {
              const value = cell.pitches ? cell.extraStrikeRate : null;
              const confidence = cell.pitches ? Math.max(0.28, Math.min(1, cell.pitches / 12)) : 0.2;
              const col = index % 5;
              const row = Math.floor(index / 5);
              return <rect key={`color-${index}`} x={col * 90 - 10} y={row * 100 - 10} width="110" height="120" fill={color(value)} opacity={confidence} />;
            })}
          </g>
          <rect x="98" y="100" width="254" height="300" fill="none" stroke="rgba(23,35,39,.72)" strokeWidth="4" />
          <rect x="1.5" y="1.5" width="447" height="497" rx="12" fill="none" stroke="#c8d0d1" strokeWidth="3" />
          {cells.map((cell: Row, index: number) => {
            const col = index % 5;
            const row = Math.floor(index / 5);
            const value = cell.pitches ? cell.extraStrikeRate : null;
            const label = `${verticalLabels[row]}・${labels[col]}`;
            const aria = value === null ? `${label}、データなし` : `${label}、期待との差${value >= 0 ? "プラス" : "マイナス"}${Math.abs(value * 100).toFixed(1)}パーセント、${cell.pitches}球`;
            return <rect key={`target-${index}`} className={activeIndex === index ? "active-target" : ""} x={col * 90} y={row * 100} width="90" height="100" fill="transparent" role="button" tabIndex={0} aria-label={aria} onMouseEnter={() => setActiveIndex(index)} onFocus={() => setActiveIndex(index)} onClick={() => setActiveIndex(index)}><title>{aria}</title></rect>;
          })}
        </svg>
      </div>
      <CatcherViewAxis/>
      <div className="framing-scale"><span>期待以下</span><i /><span>期待以上</span></div>
      <div className="framing-surface-detail" aria-live="polite">
        {selected && selected.pitches ? <><strong>{verticalLabels[Math.floor(activeIndex! / 5)]}・{labels[activeIndex! % 5]}</strong><span>期待との差 <b>{selectedValue >= 0 ? "+" : ""}{(selectedValue * 100).toFixed(1)}%</b></span><span>実率 {formatValue(selected.actualStrikeRate, "rate")}</span><span>期待率 {formatValue(selected.expectedStrikeRate, "rate")}</span><span>n={selected.pitches}</span></> : <span>ヒートマップをタップすると元の領域データを表示します。</span>}
      </div>

    </div>
  );
}

function MetricInfoDialog({ info, onClose, benchmarks }: { info: MetricInfo; onClose: () => void; benchmarks: { role: string; value: Benchmark }[] }) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);
  return createPortal(
    <div className="metric-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="metric-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header>
          <div><span>指標解説</span><h2 id={titleId}>{info.title}</h2><p>{info.catchline}</p></div>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="説明を閉じる">×</button>
        </header>
        <div className="metric-dialog-reading"><span>数値の見方</span><strong>{info.reading}</strong></div>
        {benchmarks.length > 0 && <div className="metric-dialog-benchmarks">{benchmarks.map(({role,value}) => <section key={role}><b>{role}</b><span>リーグ平均<strong>{formatValue(value.average,value.format)}</strong></span>{value.excellent!==null&&<span>優秀ライン<strong>{value.direction==="higher"?"≥":"≤"} {formatValue(value.excellent,value.format)}</strong></span>}{value.veryExcellent!==null&&<span>非常に優秀<strong>{value.direction==="higher"?"≥":"≤"} {formatValue(value.veryExcellent,value.format)}</strong></span>}{value.caution!==null&&<span>注意ライン<strong>{value.direction==="higher"?"≤":"≥"} {formatValue(value.caution,value.format)}</strong></span>}</section>)}</div>}
        <div className="metric-dialog-content">
          <section><h3>何を表すか</h3><p>{info.meaning}</p></section>
          <section><h3>東都版での計算</h3><p>{info.calculation}</p></section>
          <section><h3>実際の成績との比べ方</h3><p>{info.comparison}</p></section>
          <section className="metric-dialog-caution"><h3>注意点</h3><p>{info.caution}</p></section>
        </div>
        <button className="metric-dialog-done" type="button" onClick={onClose}>閉じる</button>
      </section>
    </div>,
    document.body,
  );
}

function MetricLabel({ label, metricKey, className = "" }: { label: string; metricKey?: string; className?: string }) {
  const info = getMetricInfo(metricKey, label);
  const benchmarkSet = useContext(MetricBenchmarkContext);
  const resolvedKey = (label && METRIC_KEY_BY_LABEL[label]) || metricKey;
  const benchmarks = resolvedKey && benchmarkSet ? ([
    { role: "投手", value: benchmarkSet.pitching[resolvedKey] },
    { role: "打者", value: benchmarkSet.batting[resolvedKey] },
    { role: "捕手", value: benchmarkSet.catching[resolvedKey] },
  ].filter((item) => item.value) as { role: string; value: Benchmark }[]) : [];
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const close = () => {
    setOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  };
  if (!info) return <span className={className}>{label}</span>;
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`metric-term${className ? ` ${className}` : ""}`}
        aria-haspopup="dialog"
        aria-label={`${label}の説明を開く`}
        onClick={(event) => { event.stopPropagation(); setOpen(true); }}
      >
        {label}<b aria-hidden="true">i</b>
      </button>
      {open && <MetricInfoDialog info={info} onClose={close} benchmarks={benchmarks} />}
    </>
  );
}

function isExcellent(value: any, benchmark?: Benchmark) {
  const numeric = numericValue(value);
  if (numeric === null || benchmark?.excellent === null || benchmark?.excellent === undefined) return false;
  return benchmark.direction === "higher" ? numeric >= benchmark.excellent : numeric <= benchmark.excellent;
}

function BenchmarkBadges({ benchmark, currentValue, compact = false }: { benchmark?: Benchmark; currentValue: any; compact?: boolean }) {
  if (!benchmark) return null;
  const excellent = isExcellent(currentValue, benchmark);
  const range = benchmark.direction === "higher" ? "以上" : "以下";
  return (
    <div className={`metric-benchmark${compact ? " compact" : ""}`} aria-label={`リーグ平均${formatValue(benchmark.average, benchmark.format)}${benchmark.excellent === null ? "" : `、優秀の目安${formatValue(benchmark.excellent, benchmark.format)}${range}`}`}>
      <span className="average">リーグ平均 <b>{formatValue(benchmark.average, benchmark.format)}</b></span>
      {benchmark.excellent !== null && <span className={`excellent${excellent ? " reached" : ""}`}>優秀 <b>{formatValue(benchmark.excellent, benchmark.format)}{range}</b>{excellent && <i aria-hidden="true">✓</i>}</span>}
    </div>
  );
}

function BenchmarkGuide({ text, suffix }: { text: string; suffix?: string }) {
  return <p className="benchmark-guide">リーグ平均は全選手を球数・打席数などで加重。優秀は<span>{text}</span>の上位25%に入る境界です。{suffix && ` ${suffix}`}</p>;
}

function MetricBlock({ label, value, format = "number", benchmark, metricKey }: { label: string; value: any; format?: Column["format"]; benchmark?: Benchmark; metricKey?: string }) {
  return <div className={`metric-block${isExcellent(value, benchmark) ? " is-excellent" : ""}`}><MetricLabel label={label} metricKey={metricKey} /><strong>{formatValue(value, format)}</strong><BenchmarkBadges benchmark={benchmark} currentValue={value} /></div>;
}

function PercentilePanel({ title, rows }: { title: string; rows: Row[] }) {
  return <section className="percentile-panel"><h2>{title}</h2><div className="percentile-grid">{!rows.length && <p>リーグ内評価に必要なデータがまだ揃っていません。</p>}{rows.map((row) => <div key={row.label}><MetricLabel label={row.label} metricKey={row.metricKey} /><strong>{formatValue(row.value)}</strong>{Number.isFinite(row.value) && <PercentBar value={row.value} />}</div>)}</div><small>100に近いほどリーグ内で上位</small></section>;
}

function PercentBar({ value }: { value: number }) {
  const clamped = Math.max(0, Math.min(100, value));
  return <div className="percent-bar"><i style={{ width: `${clamped}%`, background: clamped >= 70 ? "#c5313e" : clamped <= 30 ? "#2f78aa" : "#6d8588" }} /></div>;
}

function ChartCard({ title, children }: { title: string; children: ReactNode }) {
  return <section className="chart-card"><h2>{title}</h2>{children}</section>;
}

function MovementChart({ pitches }: { pitches: Row[] }) {
  const plotted = pitches.filter((row) => Number.isFinite(row.hb) && Number.isFinite(row.ivb));
  const step = Math.max(1, Math.ceil(plotted.length / 700));
  const sample = plotted.filter((_, index) => index % step === 0);
  const types = [...new Set(plotted.map((row) => row.pitchType))];
  const x = (value: number) => 46 + ((value + 75) / 150) * 470;
  const y = (value: number) => 312 - ((value + 70) / 150) * 260;
  return (
    <div className="chart-inner"><svg viewBox="0 0 560 340" role="img" aria-label="捕手側から見た球種別変化量散布図"><rect x="46" y="52" width="470" height="260" fill="#fafafa" stroke="#d8dcde" /><line x1={x(0)} x2={x(0)} y1="52" y2="312" stroke="#aeb5b7" /><line x1="46" x2="516" y1={y(0)} y2={y(0)} stroke="#aeb5b7" />{[-50, 0, 50].map((tick) => <g key={`x${tick}`}><line x1={x(tick)} x2={x(tick)} y1="308" y2="316" stroke="#777" /><text x={x(tick)} y="330" textAnchor="middle">{tick}</text></g>)}{[-50, 0, 50].map((tick) => <g key={`y${tick}`}><text x="38" y={y(tick) + 4} textAnchor="end">{tick}</text></g>)}{sample.map((row, index) => <circle key={`${row.id}-${index}`} cx={x(row.hb)} cy={y(row.ivb)} r="3.1" fill={PITCH_COLORS[row.pitchType] ?? "#777"} opacity="0.55" />)}<text x="280" y="16" textAnchor="middle" className="axis-title">縦変化（cm）</text><text x="280" y="338" textAnchor="middle" className="axis-title">横変化（cm・捕手視点）</text></svg><div className="legend">{types.map((type) => <span key={type}><i style={{ background: PITCH_COLORS[type] ?? "#777" }} />{type}</span>)}</div></div>
  );
}

function ZoneHeatmap({ pitches, playerId, role }: { pitches: Row[]; playerId: string; role: "pitcher" | "batter" }) {
  const [side, setSide] = useState<"右" | "左">("右");
  const [mode, setMode] = useState<"adjusted" | "raw">("adjusted");
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const playerBatterSide = pitches.find((row) => row.batterId === playerId)?.batterSide ?? "右";
  const battingSideForLabels = role === "pitcher" ? side : playerBatterSide;
  const labels = battingSideForLabels === "右" ? ["外角", "中央", "内角"] : ["内角", "中央", "外角"];
  const verticalLabels = ["高め", "中央", "低め"];
  const bins = useMemo(() => {
    const isEligible = (row: Row) => isMeasuredFairBall(row) && row.plateX >= -0.254 && row.plateX <= 0.254 && row.plateZ >= 0.45 && row.plateZ <= 1.05;
    const matchesSide = (row: Row) => role === "pitcher" ? row.batterSide === side : row.pitcherThrows === side;
    const matchesPlayer = (row: Row) => role === "pitcher" ? row.pitcherId === playerId : row.batterId === playerId;
    const zoneIndex = (row: Row) => {
      const col = Math.min(2, Math.max(0, Math.floor(((row.plateX + 0.254) / 0.508) * 3)));
      const rowIndex = Math.min(2, Math.max(0, 2 - Math.floor(((row.plateZ - 0.45) / 0.6) * 3)));
      return rowIndex * 3 + col;
    };
    const eligible = pitches.filter(isEligible);
    const sidePool = eligible.filter(matchesSide);
    const peerPool = sidePool.filter((row) => !matchesPlayer(row));
    const peers = peerPool.length ? peerPool : sidePool;
    const conditionPeers = new Map<string, { sum: number; n: number }>();
    const zonePeers = new Map<number, { sum: number; n: number }>();
    let peerSum = 0;
    let peerCount = 0;
    for (const row of peers) {
      const index = zoneIndex(row);
      const conditionKey = `${index}|${row.pitchType ?? "不明"}`;
      const condition = conditionPeers.get(conditionKey) ?? { sum: 0, n: 0 };
      condition.sum += row.exitVelocity;
      condition.n += 1;
      conditionPeers.set(conditionKey, condition);
      const zone = zonePeers.get(index) ?? { sum: 0, n: 0 };
      zone.sum += row.exitVelocity;
      zone.n += 1;
      zonePeers.set(index, zone);
      peerSum += row.exitVelocity;
      peerCount += 1;
    }
    const working = Array.from({ length: 9 }, () => ({ rows: [] as Row[], sum: 0 }));
    for (const row of sidePool.filter(matchesPlayer)) {
      const bin = working[zoneIndex(row)];
      bin.rows.push(row);
      bin.sum += row.exitVelocity;
    }
    return working.map((bin, index) => {
      const n = bin.rows.length;
      const raw = n ? bin.sum / n : null;
      const zone = zonePeers.get(index);
      const zoneMean = zone?.n ? zone.sum / zone.n : peerCount ? peerSum / peerCount : raw;
      const priors = bin.rows.map((row) => {
        const condition = conditionPeers.get(`${index}|${row.pitchType ?? "不明"}`);
        if (!condition?.n) return zoneMean;
        const conditionMean = condition.sum / condition.n;
        if (zoneMean === null) return conditionMean;
        const conditionWeight = condition.n / (condition.n + 5);
        return conditionWeight * conditionMean + (1 - conditionWeight) * zoneMean;
      }).filter((value): value is number => value !== null && Number.isFinite(value));
      const prior = priors.length ? priors.reduce((sum, value) => sum + value, 0) / priors.length : zoneMean;
      const adjusted = raw === null ? null : prior === null ? raw : (n * raw + 5 * prior) / (n + 5);
      return { n, raw, prior, adjusted, values: bin.rows.map((row) => row.exitVelocity) };
    });
  }, [pitches, playerId, role, side]);
  const baseColor = (value: number) => {
    const t = Math.max(0, Math.min(1, (value - 115) / 50));
    if (t < 0.5) { const u = t * 2; return [Math.round(45 + 210 * u), Math.round(111 + 144 * u), Math.round(170 + 85 * u)]; }
    const u = (t - 0.5) * 2;
    return [Math.round(255 - 65 * u), Math.round(255 - 209 * u), Math.round(255 - 207 * u)];
  };
  const cellStyle = (value: number | null, n: number) => {
    if (value === null || n === 0) return { background: "#f1f3f4", color: "#778083" };
    const confidence = n <= 2 ? 0.32 : n <= 4 ? 0.5 : n <= 9 ? 0.76 : 1;
    const mixed = baseColor(value).map((channel) => Math.round(255 - (255 - channel) * confidence));
    const luminance = mixed[0] * 0.299 + mixed[1] * 0.587 + mixed[2] * 0.114;
    return { background: `rgb(${mixed.join(",")})`, color: luminance < 145 ? "white" : "#172327" };
  };
  const reliability = (n: number) => n <= 2 ? "参考" : n <= 4 ? "少数" : n <= 9 ? "標準" : "高信頼";
  const selected = selectedIndex === null ? null : bins[selectedIndex];
  const selectedLabel = selectedIndex === null ? "" : `${verticalLabels[Math.floor(selectedIndex / 3)]}・${labels[selectedIndex % 3]}`;
  const changeSide = (value: "右" | "左") => { setSide(value); setSelectedIndex(null); };
  return (
    <div className="heatmap-wrap">
      <div className="heatmap-controls">
        <div><span>対戦</span><div className="segmented small"><button className={side === "右" ? "active" : ""} onClick={() => changeSide("右")}>{role === "pitcher" ? "右打者" : "右投手"}</button><button className={side === "左" ? "active" : ""} onClick={() => changeSide("左")}>{role === "pitcher" ? "左打者" : "左投手"}</button></div></div>
        <div><span>表示値</span><div className="segmented small"><button className={mode === "adjusted" ? "active" : ""} onClick={() => setMode("adjusted")}>補正値</button><button className={mode === "raw" ? "active" : ""} onClick={() => setMode("raw")}>生データ</button></div></div>
      </div>
      <div className="heat-labels"><span />{labels.map((label) => <span key={label}>{label}</span>)}</div>
      <div className="heatmap-matrix">
        <div className="heat-row-labels">{verticalLabels.map((label) => <span key={label}>{label}</span>)}</div>
        <div className="heatmap-grid">{bins.map((bin, index) => {
          const value = mode === "adjusted" ? bin.adjusted : bin.raw;
          const zoneName = `${verticalLabels[Math.floor(index / 3)]}・${labels[index % 3]}`;
          return <button type="button" className={selectedIndex === index ? "active" : ""} key={index} style={cellStyle(value, bin.n)} disabled={!bin.n} onClick={() => setSelectedIndex(selectedIndex === index ? null : index)} aria-label={`${zoneName}、${value === null ? "データなし" : `${value.toFixed(1)}km/h、${bin.n}打球`}`} aria-pressed={selectedIndex === index}><strong>{value === null ? "—" : value.toFixed(1)}</strong><small>{bin.n ? `n=${bin.n}・${reliability(bin.n)}` : "n=0"}</small></button>;
        })}</div>
      </div>
      <CatcherViewAxis/>
      <div className="heat-scale"><span>遅い</span><i /><span>速い</span></div>


      {selected && selected.n > 0 && <section className="heat-detail" aria-live="polite">
        <header><strong>{selectedLabel}</strong><button type="button" onClick={() => setSelectedIndex(null)} aria-label="詳細を閉じる">×</button></header>
        <div><span>補正平均<b>{selected.adjusted?.toFixed(1)} km/h</b></span><span>生平均<b>{selected.raw?.toFixed(1)} km/h</b></span><span>リーグ基準<b>{selected.prior?.toFixed(1) ?? "—"} km/h</b></span><span>打球数<b>{selected.n}</b></span></div>
        <p>個別打球速度</p><div className="heat-values">{[...selected.values].sort((a, b) => b - a).map((value, index) => <span key={`${value}-${index}`}>{value.toFixed(1)}</span>)}</div>
      </section>}
    </div>
  );
}

function PrintableBatterSpray({ pitches, player, seasonLabel }: { pitches: Row[]; player: Row; seasonLabel: string }) {
  const id = useId();
  const balls = pitches.filter(isPlottableBattedBall);
  const dates = [...new Set(pitches.map(row => row.date).filter(Boolean))].sort();
  const period = dates.length ? `${dates[0]}〜${dates[dates.length - 1]}` : '対象データなし';
  return <div className="batter-spray-report" data-spray-report={id}>
    <button className="secondary-button" disabled={!balls.length} onClick={() => void printReport(`[data-spray-report="${id}"]`, 'spray')}>打球方向を印刷／PDF保存</button>
    <SprayChart pitches={pitches}/>
    <section className="spray-print-sheet" aria-hidden="true">
      <header className="spray-print-heading"><div><h1>{player.kanji || player.name}</h1><p>{player.team}｜{seasonLabel}｜打球方向</p></div><p>{period}<br/>現在の表示条件・対象投球 {pitches.length}球／描画可能な打球 {balls.length}球</p></header>
      <SprayChart pitches={pitches} allPoints/>

    </section>
  </div>;
}

function isPlottableBattedBall(row: Row) {
  const angle = row.sprayAngle ?? row.direction;
  return row.result === "インプレー" && Number.isFinite(angle) && Math.abs(angle) <= 45 &&
    (Number.isFinite(row.distance) && row.distance >= 0);
}

function SprayChart({ pitches, allPoints = false }: { pitches: Row[]; allPoints?: boolean }) {
  const balls = pitches.filter(isPlottableBattedBall);
  const scale = 315 / Math.max(143.2, ...balls.map(row => row.distance));
  const homeX = 280;
  const homeY = 350;

  const step = allPoints ? 1 : Math.max(1, Math.ceil(balls.length / 500));
  const plotted = balls.filter((_, index) => index % step === 0).sort((a, b) => Number(a.playResult === "本塁打") - Number(b.playResult === "本塁打"));
  return (
    <div className="chart-inner spray-chart">
      <svg viewBox="0 0 560 390" role="img" aria-label="打球の推定着弾位置図">
        <path d={fieldFence(homeX, homeY, scale)} fill="#edf4e9" stroke="#78907d" strokeWidth="1.5" />
        <path d={`M${homeX-19.397*scale} ${homeY-19.397*scale} L${homeX} ${homeY-38.795*scale} L${homeX+19.397*scale} ${homeY-19.397*scale} L${homeX} ${homeY} Z`} fill="#e1ccb0" stroke="#9b784d" />
        <circle cx={homeX} cy={homeY-18.44*scale} r="3" fill="#b98d59" />
        <text x={homeX} y={homeY-120*scale-8} textAnchor="middle">120 m</text>
        <text x={homeX-98*scale/Math.sqrt(2)-8} y={homeY-98*scale/Math.sqrt(2)} textAnchor="end">98 m</text>
        <text x={homeX+98*scale/Math.sqrt(2)+8} y={homeY-98*scale/Math.sqrt(2)}>98 m</text>
        {plotted.map((row, index) => {
          const degrees = row.sprayAngle ?? row.direction;
          const angle = (degrees * Math.PI) / 180;
          const recordedDistance = Number.isFinite(row.distance) ? row.distance : 0;
          const radius = recordedDistance * scale;
          const cx = homeX + Math.sin(angle) * radius;
          const cy = homeY - Math.cos(angle) * radius;
          const color = row.playResult === "本塁打" ? "#c5313e" : row.exitVelocity >= 152.9 ? "#e58a34" : "#318b93";
          const distanceLabel = Number.isFinite(row.distance) ? `${row.distance}m` : "距離未計測";
          return <circle key={`${row.id}-${index}`} cx={cx} cy={cy} r={row.playResult === "本塁打" ? 5.2 : 3.7} fill={color} stroke={row.playResult === "本塁打" ? "white" : "none"} strokeWidth="1.2" opacity="0.78"><title>{`${row.playResult || "インプレー"}・${distanceLabel}${Number.isFinite(row.exitVelocity) ? `・${row.exitVelocity}km/h` : ""}`}</title></circle>;
        })}
        <rect x="273.5" y="343.5" width="13" height="13" transform="rotate(45 280 350)" fill="white" stroke="#6f6f6f" />
      </svg>
      <div className="legend"><span><i style={{ background: "#c5313e" }} />本塁打</span><span><i style={{ background: "#e58a34" }} />強い打球</span><span><i style={{ background: "#318b93" }} />その他</span></div>

    </div>
  );
}

function RollingChart({ pitches, mode }: { pitches: Row[]; mode: "pitcher" | "batter" }) {
  const grouped = new Map<string, number[]>();
  for (const row of pitches) {
    if (mode === "batter" && !isMeasuredFairBall(row)) continue;
    const value = mode === "pitcher" ? row.velocity : row.exitVelocity;
    if (!Number.isFinite(value)) continue;
    if (!grouped.has(row.date)) grouped.set(row.date, []);
    grouped.get(row.date)!.push(value);
  }
  const points = [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, values]) => ({ date, value: values.reduce((a, b) => a + b, 0) / values.length }));
  if (!points.length) return <p className="empty-chart">対象データがありません。</p>;
  const min = Math.min(...points.map((row) => row.value)) - 3;
  const max = Math.max(...points.map((row) => row.value)) + 3;
  const x = (index: number) => points.length === 1 ? 280 : 48 + (index / (points.length - 1)) * 468;
  const y = (value: number) => 278 - ((value - min) / (max - min || 1)) * 220;
  const path = points.map((row, index) => `${index ? "L" : "M"}${x(index)},${y(row.value)}`).join(" ");
  return <div className="chart-inner"><svg viewBox="0 0 560 320"><rect x="48" y="40" width="468" height="238" fill="#fafafa" stroke="#d8dcde" /><path d={path} fill="none" stroke="#318b93" strokeWidth="3" />{points.map((row, index) => <g key={row.date}><circle cx={x(index)} cy={y(row.value)} r="4" fill="#c5313e" /><text x={x(index)} y="300" textAnchor="middle">{row.date.slice(5)}</text><text x={x(index)} y={y(row.value) - 10} textAnchor="middle">{row.value.toFixed(1)}</text></g>)}</svg></div>;
}

function GlossaryView() {
  const groups = [
    ["打撃", [["平均打球速度", "計測できた打球の速度平均。単位はkm/h。"], ["上位10%打球速度", "選手の打球速度の90パーセンタイル。最高値1球より再現性を見やすい指標。"], ["強打率", "打球速度152.9km/h以上の打球割合。"], ["バレル率", "高い打球速度と適切な打球角度を同時に満たした打球の割合。"], ["推定打率", METRIC_INFO.xba.meaning], ["推定長打率", METRIC_INFO.xslg.meaning], ["推定加重出塁率", METRIC_INFO.xwoba.meaning], ["打撃生産指数+", "リーグ平均を100とした加重出塁率の指数。球場補正は含まない。"]]],
    ["投球", [["球質指数+", "球種別に球速、回転数、変化量、進入角、エクステンションを標準化した球そのものの指数。平均100。"], ["コース指数+", "真ん中を避け、境界や追いかけさせる位置へ投げた度合いを評価。平均100。"], ["総合投球指数+", "球質指数+とコース指数+を同じ比率で統合。平均100。"], ["100球得点価値", "各球のカウント・結果価値を投手側の得点抑止として100球換算。正の値ほど投手有利。"], ["推定被加重出塁率", METRIC_INFO.xwobaAllowed.meaning], ["推定失点率", METRIC_INFO.xera.meaning], ["SwStr%", METRIC_INFO.swingingStrikeRate.meaning], ["進入角", "ホームベース到達時のボールの縦方向角度。値が小さいほど下向き。"], ["真ん中率", "ストライクゾーン中央3分の1へ投げた割合。"]]],
    ["捕手", [["期待ストライク率", METRIC_INFO.expectedStrikeRate.meaning], ["追加ストライク", METRIC_INFO.extraStrikes.meaning], ["フレーミング得点", METRIC_INFO.framingRuns.meaning], ["境界1000球換算", METRIC_INFO.framingPer1000.meaning]]],
  ];
  return <PageSection eyebrow="指標解説" title="ID東都用語集" description="サイトに表示する指標の意味と計算方針です。指標名を押すと詳しい説明が開きます。"><div className="glossary-grid"><section><h2>コース図・打球図</h2><div><h3>分析ゾーン</h3><p>横位置 −0.254〜0.254 m、高さ 0.45〜1.05 m の固定範囲。打者別の上下限ではありません。縦横を同じ縮尺で表示します。</p></div><div><h3>打球位置</h3><p>BearingとDistanceの記録値を使用。捕手視点で左が負、右が正、中央が0度です。距離未計測は描画しません。本塁打も記録距離のまま表示します。球場の外周は参考形状です。</p></div><div><h3>コース別打球速度</h3><p>補正値は同じゾーン・球種・左右のリーグ平均へ補正。少数領域は薄色です。領域を選択すると元の数値を確認できます。</p></div><div><h3>フレーミング分布</h3><p>実ストライク率と期待ストライク率の差。25領域を平滑化して表示します。</p></div></section>{groups.map(([title, items]: any) => <section key={title}><h2>{title}</h2>{items.map(([term, description]: string[]) => <div key={term}><h3><MetricLabel label={term} /></h3><p>{description}</p></div>)}</section>)}</div><details className="method-card chart-definition"><summary>比較上の注意</summary><p>TrackManで計測できたプレーを対象とするため、公式記録と完全には一致しない場合があります。サンプルが少ない選手はランキングの最低打席・最低球数で除外してください。推定指標は東都リーグ内比較用で、プロ野球やMLBの値と直接比較するものではありません。</p></details></PageSection>;
}

function PageSection({ title, children }: { eyebrow: string; title: string; description: string; children: ReactNode }) {
  return <section className="page-section"><header className="page-heading"><h1>{title}</h1></header>{children}</section>;
}

function SimpleTable({ rows, columns, rowKey, onRowKeyClick }: { rows: Row[]; columns: Column[]; rowKey: string; onRowKeyClick?: (row: Row) => void }) {
  return <div className="table-scroll"><table className="data-table"><thead><tr>{columns.map((column) => <th key={column.key}><MetricLabel label={column.label} metricKey={column.key} /></th>)}</tr></thead><tbody>{rows.map((row, index) => <tr className={row.isLeagueAverage ? "league-average-row" : ""} key={`${row[rowKey]}-${index}`}>{columns.map((column) => <td key={column.key}>{column.player ? <PlayerName row={{ name: row[column.key], romanName: row[column.key], kanji: row.kanji ?? row[`${column.key}Kanji`] }} compact /> : column.key === rowKey && onRowKeyClick ? <button type="button" className="table-row-link" onClick={() => onRowKeyClick(row)}>{formatValue(row[column.key], column.format)} <span aria-hidden="true">↻</span></button> : formatValue(row[column.key], column.format)}</td>)}</tr>)}</tbody></table></div>;
}

function MetricExplanation({ value, label, text, format = "number" }: { value: any; label: string; text: string; format?: Column["format"] }) {
  return <article><MetricLabel label={label} /><strong>{formatValue(value, format)}</strong><p>{text}</p></article>;
}

function EmptyState({ title, action }: { title: string; action: () => void }) {
  return <div className="empty-state"><h1>{title}</h1><button className="primary-button" onClick={action}>選手を検索</button></div>;
}

function Footer({ navigate }: { navigate: (route: RouteState) => void }) {
  return <footer><div><BrandMark /></div><div><h3>データ</h3><button onClick={() => navigate({ view: "search" })}>投球検索</button><button onClick={() => navigate({ view: "barrel" })}>バレルゾーン</button><button onClick={() => navigate({ view: "quality" })}>PITCH QUALITY</button><button onClick={() => navigate({ view: "spin" })}>回転アニメーション</button><button onClick={() => navigate({ view: "leaders", board: "pitching_percentile" })}>ランキング</button><button onClick={() => navigate({ view: "shift" })}>守備シフト</button><button onClick={() => navigate({ view: "glossary" })}>指標解説</button><button onClick={() => window.location.assign("/ai")}>AI向けデータ案内</button></div><div><h3>管理</h3><button onClick={() => window.location.assign("/admin")}>管理者ログイン</button><small>CSV更新は管理者のみ</small></div></footer>;
}

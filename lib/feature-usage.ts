// Public menu items only. Do not record player IDs, searches, filters or visitor identifiers.
export const FEATURE_LABELS: Record<string, string> = {
  home: "ホーム", games: "試合一覧", search: "投球検索", visuals: "可視化",
  compare: "選手比較", stats: "リーグ統計", quality: "PITCHスコア",
  spin: "回転", trajectory: "投球軌道", barrel: "バレルゾーン（旧）", umpires: "審判分析",
  shift: "SHIFT", news: "NEWS", glossary: "指標解説", player: "選手詳細",
  "leaders:batting_average": "ランキング・打率",
  "leaders:batting_ops": "ランキング・OPS",
  "leaders:batting_qab": "ランキング・QAB",
  "leaders:batting_profile": "ランキング・打球の速さと角度",
  "leaders:batting_ev": "ランキング・打球速度とバレル",
  "leaders:batting_expected": "ランキング・打撃推定成績",
  "leaders:batting_hr": "ランキング・本塁打",
  "leaders:batting_percentile": "ランキング・総合打撃成績",
  "leaders:batting_pitch_types": "ランキング・球種別成績",
  "leaders:batting_value": "ランキング・打撃得点価値",
  "leaders:pitching_strikeouts": "ランキング・奪三振数",
  "leaders:pitching_strikeout_rate": "ランキング・奪三振率",
  "leaders:pitching_strikeout_pitches": "ランキング・三振を取った球種",
  "leaders:pitching_profile": "ランキング・打たれた打球の強さ",
  "leaders:pitching_ev": "ランキング・被打球速度とバレル",
  "leaders:pitching_expected": "ランキング・投球推定成績",
  "leaders:pitching_hr": "ランキング・被本塁打",
  "leaders:pitching_percentile": "ランキング・投球総合スコア",
  "leaders:pitching_value": "ランキング・投球得点価値",
  "leaders:pitching_arsenal": "ランキング・球種別の球速と球質",
  "leaders:pitching_movement": "ランキング・球種別の変化量",
  "leaders:pitching_angle": "ランキング・ボールを放す位置と角度",
  "leaders:pitching_spin": "ランキング・球種別の回転数",
  "leaders:catching_framing": "ランキング・フレーミング",
  "leaders:catching_pop": "ランキング・二塁送球",
};

export function usageFeature(view: string, board?: string): string | null {
  const key = view === "leaders" ? `leaders:${board || "pitching_percentile"}` : view;
  return Object.hasOwn(FEATURE_LABELS, key) ? key : null;
}

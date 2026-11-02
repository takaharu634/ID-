"use client";

import { useMemo } from "react";
import type { SeasonKey } from "../lib/dataset-types";
import type { ComparisonEntry } from "../lib/player-comparison";
import { seasonInfo } from "../lib/seasons.mjs";

const PITCH_ORDER = ["ストレート", "シンカー", "カットボール", "スライダー", "カーブ", "フォーク", "チェンジアップ", "ナックル", "その他", "不明"];
const COMPONENTS = [
  { key: "pitches", label: "球数", unit: "球", digits: 0 },
  { key: "avgVelocity", label: "平均球速", unit: "km/h", digits: 1 },
  { key: "maxVelocity", label: "最高球速", unit: "km/h", digits: 1 },
  { key: "avgSpin", label: "平均回転数", unit: "rpm", digits: 0 },
  { key: "avgIvb", label: "縦変化量（IVB）", unit: "cm", digits: 1 },
  { key: "avgHb", label: "横変化量", unit: "cm", digits: 1 },
  { key: "avgExtension", label: "エクステンション", unit: "cm", digits: 1 },
  { key: "avgReleaseHeight", label: "リリース高", unit: "cm", digits: 1 },
  { key: "avgReleaseSide", label: "リリース横", unit: "cm", digits: 1 },
  { key: "avgVaa", label: "進入角（VAA）", unit: "°", digits: 1 },
];

function componentValue(value: unknown, digits: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return Number(value.toFixed(digits)).toLocaleString("ja-JP", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export default function PitchComponentComparison({ entries, pitchType, onPitchTypeChange, onSelectPlayer }: {
  entries: ComparisonEntry[];
  pitchType: string;
  onPitchTypeChange: (value: string) => void;
  onSelectPlayer: (id: string, season: SeasonKey) => void;
}) {
  // Use the same normalized, season-specific arsenal as the player detail.
  const arsenals = useMemo(() => new Map(entries.map(entry => [entry.key,
    new Map(entry.pitchTypes.map(row => [row.pitchType, row])),
  ])), [entries]);
  const types = [...new Set([...arsenals.values()].flatMap(arsenal => [...arsenal.keys()]))].sort((a, b) => {
    const aRank = PITCH_ORDER.indexOf(a), bRank = PITCH_ORDER.indexOf(b);
    return (aRank < 0 ? PITCH_ORDER.length : aRank) - (bRank < 0 ? PITCH_ORDER.length : bRank) || a.localeCompare(b, "ja");
  });
  const activeType = types.includes(pitchType) ? pitchType : "";
  const visibleTypes = activeType ? [activeType] : types;

  if (!entries.length) return <p className="pitch-compare-empty">比較する投手を選択してください。</p>;
  if (!types.length) return <p className="pitch-compare-empty">選択した投手の球種データがありません。</p>;

  return <div className="pitch-component-comparison">
    <label className="pitch-compare-filter">球種
      <select value={activeType} onChange={event => onPitchTypeChange(event.target.value)}>
        <option value="">すべての球種</option>
        {types.map(type => <option key={type} value={type}>{type}</option>)}
      </select>
    </label>
    {visibleTypes.map(type => <section className="pitch-compare-section" key={type}>
      <h2>{type}</h2>
      <div className="pitch-compare-scroll" role="region" aria-label={`${type}の球種成分比較`} tabIndex={0}>
        <table className="pitch-compare-table" style={{ minWidth: `${11 + entries.length * 10}rem` }}>
          <thead><tr><th scope="col">成分</th>{entries.map(entry => <th scope="col" key={entry.key}>
            <button type="button" onClick={() => onSelectPlayer(entry.player.id, entry.season)}>{entry.player.kanji || entry.player.name}</button>
            <span>{entry.player.team}</span><span>{seasonInfo(entry.season).label}</span>
          </th>)}</tr></thead>
          <tbody>{COMPONENTS.map(component => <tr key={component.key}>
            <th scope="row">{component.label}<span>{component.unit}</span></th>
            {entries.map(entry => {
              const arsenal = arsenals.get(entry.key)?.get(type);
              return <td key={entry.key}>{componentValue(arsenal?.[component.key], component.digits)}</td>;
            })}
          </tr>)}</tbody>
        </table>
      </div>
    </section>)}
  </div>;
}

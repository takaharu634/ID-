"use client";

import { useEffect, useState } from 'react';
import type { Dataset, SeasonKey } from '../lib/dataset-types';
import { loadStaticDataset, useDatasetRevision } from '../lib/dataset-loader';
import { usePublicDataNotice } from '../lib/public-data-notice';
import { seasonInfo } from '../lib/seasons.mjs';
import { buildComparisonEntries, updateComparisonSlot, type ComparisonDatasets, type ComparisonSlot } from '../lib/player-comparison';
import { PlayerOptions } from './player-options';
import PitchComponentComparison from './pitch-component-comparison';

function ComparisonSelector({ index, slot, available, data, error, onChange, onRetry }: {
  index: number; slot: ComparisonSlot; available: SeasonKey[]; data?: Dataset; error?: string;
  onChange: (value: ComparisonSlot) => void; onRetry: () => void;
}) {
  const notice = usePublicDataNotice(slot.season);
  const valid = data?.pitchers.some(player => player.id === slot.playerId);
  return <fieldset className="pitch-compare-slot">
    <legend>投手{index + 1}</legend>
    <label>シーズン<select value={slot.season} onChange={event => onChange({ season: event.target.value as SeasonKey, playerId: '' })}>
      {available.map(season => <option key={season} value={season}>{seasonInfo(season).label}</option>)}
    </select></label>
    <label>投手<select value={valid ? slot.playerId : ''} disabled={!data} onChange={event => onChange({ ...slot, playerId: event.target.value })}>
      <option value="">{data ? '選択なし' : error ? '読み込み失敗' : '読み込み中…'}</option>
      <PlayerOptions players={data?.pitchers ?? []} />
    </select></label>
    {!data && !error && <p role="status">読み込み中…</p>}
    {error && <p role="alert">{error}<button type="button" className="secondary-button" onClick={onRetry}>再読み込み</button></p>}
    {notice && data && <p role="status">{notice.message}</p>}
    {data && slot.playerId && !valid && <p role="status">選択した投手はこのシーズンに登録されていません。選び直してください。</p>}
    {data && !data.pitchers.length && <p role="status">このシーズンの投手データはありません。</p>}
  </fieldset>;
}

export default function PlayerComparison({ data, currentSeason, available, revision, slots, onSlotsChange, pitchType, onPitchTypeChange, onSelectPlayer }: {
  data: Dataset; currentSeason: SeasonKey; available: SeasonKey[]; revision: string; slots: ComparisonSlot[];
  onSlotsChange: (value: ComparisonSlot[]) => void; pitchType: string; onPitchTypeChange: (value: string) => void;
  onSelectPlayer: (id: string, season: SeasonKey) => void;
}) {
  const datasetRevision = useDatasetRevision();
  const [retry, setRetry] = useState(0);
  const requested = [...new Set(slots.map(slot => slot.season))].filter(season => season !== currentSeason).sort().join('|');
  const signature = `${revision}:${datasetRevision}:${retry}:${requested}`;
  const [loaded, setLoaded] = useState<{ signature: string; datasets: ComparisonDatasets; errors: Partial<Record<SeasonKey, string>> }>({ signature: '', datasets: {}, errors: {} });
  useEffect(() => {
    let active = true;
    setLoaded({ signature, datasets: {}, errors: {} });
    const seasons = requested ? requested.split('|') as SeasonKey[] : [];
    for (const season of seasons) {
      void loadStaticDataset<Dataset>(seasonInfo(season).path).then(dataset => {
        if (active) setLoaded(previous => ({ ...previous, datasets: { ...previous.datasets, [season]: dataset } }));
      }).catch(() => {
        if (active) setLoaded(previous => ({ ...previous, errors: { ...previous.errors, [season]: 'シーズンデータを読み込めませんでした。' } }));
      });
    }
    return () => { active = false; };
  }, [signature, requested]);
  // Never label a response from a previous request with the newly selected season.
  const datasets: ComparisonDatasets = { ...(loaded.signature === signature ? loaded.datasets : {}), [currentSeason]: data };
  const entries = buildComparisonEntries(slots, datasets);
  return <>
    <div className="compare-controls pitch-compare-controls">{slots.map((slot, index) => <ComparisonSelector key={index}
      index={index} slot={slot} available={available} data={datasets[slot.season]}
      error={loaded.signature === signature ? loaded.errors[slot.season] : undefined}
      onChange={selected => onSlotsChange(updateComparisonSlot(slots, index, selected))} onRetry={() => setRetry(value => value + 1)} />)}</div>
    <PitchComponentComparison entries={entries} pitchType={pitchType} onPitchTypeChange={onPitchTypeChange} onSelectPlayer={onSelectPlayer} />
  </>;
}

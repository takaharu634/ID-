'use client';
import { useId, useMemo, useState, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import type { Row } from '../lib/dataset-types';
import { reportPlayer, reportPlayerGroups, type ReportPerspective } from '../lib/batter-side-report';
import { printReport } from './print-report';

/** Candidates and pages always use the already filtered rows of this analysis. */
export default function AnalysisPrintSelection({ pitches, perspective = 'pitcher', kind, renderPages }: {
  pitches: Row[]; perspective?: ReportPerspective; kind: string;
  renderPages: (rows: Row[]) => ReactNode;
}) {
  const id = `analysis-print-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const groups = useMemo(() => reportPlayerGroups(pitches, perspective).sort((a, b) => {
    const left = reportPlayer(a[0], perspective), right = reportPlayer(b[0], perspective);
    return String(left.team).localeCompare(String(right.team), 'ja') || String(left.name).localeCompare(String(right.name), 'ja');
  }), [pitches, perspective]);
  const [ids, setIds] = useState<string[]>([]);
  const [printing, setPrinting] = useState(false);
  const selected = groups.filter(rows => ids.includes(reportPlayer(rows[0], perspective).key));
  async function printSelected() {
    if (!selected.length) return;
    // Mount reports only for the snapshot; large team selections do not slow normal browsing.
    flushSync(() => setPrinting(true));
    try { await printReport(`#${id}`, kind, 'selected'); }
    finally { setPrinting(false); }
  }
  return <>
    <details className="count-player-selection analysis-print-picker">
      <summary>印刷する選手を選択（{selected.length}人）</summary>
      <fieldset><legend>{perspective === 'pitcher' ? '投手' : '打者'}</legend>
        <div className="count-selection-actions"><button type="button" className="secondary-button" onClick={() => setIds(groups.map(rows => reportPlayer(rows[0], perspective).key))}>全選択</button><button type="button" className="secondary-button" onClick={() => setIds([])}>選択解除</button></div>
        <div className="count-player-options">{groups.map(rows => {
          const player = reportPlayer(rows[0], perspective);
          return <label key={player.key}><input type="checkbox" checked={ids.includes(player.key)} onChange={() => setIds(previous => previous.includes(player.key) ? previous.filter(value => value !== player.key) : [...previous, player.key])}/><span>{player.name}<small>（{player.team}）</small></span></label>;
        })}</div>
        {!groups.length && <p>対象選手がいません。検索条件を確認してください。</p>}
        <button type="button" className="secondary-button" disabled={!selected.length || printing} onClick={() => void printSelected()}>選択した選手を印刷（{selected.length}人）</button>
      </fieldset>
    </details>
    {printing && <section id={id} className={`analysis-selected-print-source ${kind === 'side' ? 'side-report-root' : kind === 'approach' ? 'approach-card-root' : kind === 'batter-side' ? 'bs-report bp-report' : ''}`} aria-hidden="true">{selected.map(rows => <div key={reportPlayer(rows[0], perspective).key}>{renderPages(rows)}</div>)}</section>}
  </>;
}

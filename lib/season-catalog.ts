'use client';
import { useEffect, useSyncExternalStore } from 'react';
import bundled from './generated/seasons.json';
import { seasonInfo, sortSeasons } from './seasons.mjs';
import type { SeasonKey } from './dataset-types';
import { resetDatasetCache } from './dataset-loader';
import { publicOfflineStore, validatePublicCatalog } from './public-offline.mjs';
import { setSavedCatalogNotice } from './public-data-notice';
export type SeasonEntry = ReturnType<typeof seasonInfo> & { version?: string; pitches?: number; games?: number };
type Catalog = { seasons: Record<SeasonKey, SeasonEntry>; latest: SeasonKey; revision: string };
const initial: Catalog = { seasons: Object.fromEntries(bundled.map(k=>[k,seasonInfo(k)])), latest: bundled[0] as SeasonKey, revision: 'bundled' };
let state = initial;
let pending: Promise<Catalog> | null = null;
const listeners = new Set<()=>void>();
const subscribe = (fn:()=>void) => { listeners.add(fn); return ()=>{listeners.delete(fn);}; };
export async function refreshSeasonCatalog(): Promise<Catalog> {
  if (pending) return pending;
  pending = (async()=>{
    let data;
    try {
      const r = await fetch('/api/seasons',{cache:'no-store',signal:AbortSignal.timeout(15000)});
      if (!r.ok) throw new Error('シーズン一覧を取得できません。');
      data = validatePublicCatalog(await r.json());
      await publicOfflineStore.saveCatalog(data);
      setSavedCatalogNotice(false);
    } catch (error) {
      // A failed disk write must not roll back a newer catalog already obtained
      // in this session. Disk is a startup fallback, not an authority over memory.
      if (state !== initial) { setSavedCatalogNotice(true); return state; }
      data = await publicOfflineStore.readCatalog();
      if (!data) throw error;
      setSavedCatalogNotice(true);
    }
    if (state.revision === data.revision) return state;
    const rows = new Map<string,SeasonEntry>(data.seasons.map((s:SeasonEntry)=>[s.key,s]));
    // Subscribers may fetch immediately: invalidate before publishing the new revision.
    resetDatasetCache();
    state = { seasons: Object.fromEntries(sortSeasons([...rows.keys()]).map((k:string)=>[k,{...rows.get(k),...seasonInfo(k)}])), latest: data.latest, revision: data.revision };
    listeners.forEach(fn=>fn());
    return state;
  })().finally(()=>{pending=null;});
  return pending;
}
export function useSeasonCatalog() {
  const value = useSyncExternalStore(subscribe,()=>state,()=>initial);
  useEffect(()=>{ void refreshSeasonCatalog().catch(()=>{}); },[]);
  return value;
}

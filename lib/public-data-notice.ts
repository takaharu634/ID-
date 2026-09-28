'use client';
import { useSyncExternalStore } from 'react';
import { seasonInfo } from './seasons.mjs';

type Notice = { message: string; savedAt?: number };
const notices = new Map<string, Notice>();
let catalogNotice: Notice | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach(listener => listener());
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export function setSavedPublicDataNotice(season: string, savedAt: number | null) {
  if (savedAt === null) { if (notices.delete(season)) notify(); return; }
  const previous = notices.get(season);
  if (previous?.savedAt === savedAt) return;
  notices.set(season, { savedAt, message: `最新データを確認できないため、端末に保存済みの${seasonInfo(season).label}を表示しています。` });
  notify();
}
export function setSavedCatalogNotice(saved: boolean) {
  if (!!catalogNotice === saved) return;
  catalogNotice = saved ? { message: '通信できないため、端末に保存済みのシーズン一覧を表示しています。' } : null;
  notify();
}
export function hasSavedPublicDataNotice(season?: string) { return !!catalogNotice || (season ? notices.has(season) : notices.size > 0); }
export function usePublicDataNotice(season: string) {
  return useSyncExternalStore(subscribe, () => notices.get(season) ?? catalogNotice, () => null);
}

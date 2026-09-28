import { useEffect, useRef, useState, type SetStateAction } from 'react';

function clean(value: unknown, fallback: unknown): unknown {
  if (fallback === null) return typeof value === 'number' && Number.isFinite(value) ? value : null;
  if (typeof fallback === 'string') return typeof value === 'string' && value.length <= 500 ? value : fallback;
  if (typeof fallback === 'number') return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1000000 ? value : fallback;
  if (typeof fallback === 'boolean') return typeof value === 'boolean' ? value : fallback;
  if (Array.isArray(fallback)) return Array.isArray(value) ? value.filter(v => typeof v === 'string').slice(0, 500) : fallback;
  if (fallback && typeof fallback === 'object') {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
    const entries = Object.entries(fallback);
    // Range inputs are an open string record; never copy prototype properties.
    return entries.length ? Object.fromEntries(entries.map(([key, item]) => [key, clean(source[key], item)]))
      : Object.fromEntries(Object.entries(source).filter(([key, v]) => /^[a-zA-Z]+$/.test(key) && typeof v === 'string' && v.length <= 100));
  }
  return fallback;
}
export function restoreViewState<T extends object>(scope: string, defaults: T, search: string, stored: string | null): T {
  const params = new URLSearchParams(search);
  const value = params.get('条件先') === scope ? params.get('条件') : stored;
  try { return clean(value ? JSON.parse(value) : {}, defaults) as T; } catch { return defaults; }
}
export function readViewState<T extends object>(scope: string, defaults: T, preferDefaults = false): T {
  if (typeof window === 'undefined') return defaults;
  let stored: string | null = null;
  try { stored = window.sessionStorage.getItem(`tohto-view-v1:${scope}`); } catch { /* Optional session memory. */ }
  return restoreViewState(scope, defaults, window.location.search, preferDefaults ? null : stored);
}
export function persistViewState(scope: string, state: object) {
  if (typeof window === 'undefined') return;
  const value = JSON.stringify(state);
  try { window.sessionStorage.setItem(`tohto-view-v1:${scope}`, value); } catch { /* URL still preserves the current selection. */ }
  const url = new URL(window.location.href), [view, season, ...rest] = scope.split('|'), context = rest.join('|');
  const seasonKey = season?.replace('年春季', '-spring').replace('年秋季', '-fall');
  if (url.searchParams.has('シーズン') && url.searchParams.get('シーズン') !== seasonKey) return;
  if ((url.searchParams.get('表示') || 'home') !== view) return;
  if (['player', 'compare'].includes(view) && context && url.searchParams.get('選手') !== context) return;
  if (view === 'leaders' && (url.searchParams.get('指標') || 'pitching_percentile') !== context) return;
  url.searchParams.set('条件先', scope); url.searchParams.set('条件', value);
  window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
}
export function useViewState<T extends object>(scope: string, defaults: T, preferDefaults = false) {
  const defaultsRef = useRef(defaults); defaultsRef.current = defaults;
  const [state, setState] = useState<T>(() => readViewState(scope, defaults, preferDefaults));
  useEffect(() => {
    const restore = () => setState(readViewState(scope, defaultsRef.current));
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, [scope]);
  useEffect(() => { persistViewState(scope, state); }, [scope, state]);
  function set<K extends keyof T>(key: K, value: SetStateAction<T[K]>) {
    setState(previous => ({ ...previous, [key]: typeof value === 'function' ? (value as (old: T[K]) => T[K])(previous[key]) : value }));
  }
  return { state, set, setState };
}

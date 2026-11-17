import { useCallback, useEffect, useState } from 'react';

export type ThemePref = 'system' | 'light' | 'dark';
const KEY = 'asset-review:theme';
const ORDER: ThemePref[] = ['system', 'light', 'dark'];
const media = () => window.matchMedia('(prefers-color-scheme: dark)');

export function readThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

export function resolveTheme(pref: ThemePref): 'light' | 'dark' {
  return pref === 'system' ? (media().matches ? 'dark' : 'light') : pref;
}

/** shadcn / Tailwind dark mode is driven by a `dark` class on <html>. */
export function applyTheme(resolved: 'light' | 'dark') {
  document.documentElement.classList.toggle('dark', resolved === 'dark');
  document.documentElement.style.colorScheme = resolved;
}

export function useTheme() {
  const [pref, setPref] = useState<ThemePref>(readThemePref);
  const [resolved, setResolved] = useState<'light' | 'dark'>(() => resolveTheme(readThemePref()));
  useEffect(() => {
    const update = () => {
      const r = resolveTheme(pref);
      setResolved(r);
      applyTheme(r);
    };
    update();
    try {
      if (pref === 'system') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, pref);
    } catch {
      /* storage unavailable: theme still applies for this session */
    }
    // Follow OS changes while on "system".
    if (pref !== 'system') return;
    const m = media();
    m.addEventListener('change', update);
    return () => m.removeEventListener('change', update);
  }, [pref]);
  const cycle = useCallback(() => setPref((p) => ORDER[(ORDER.indexOf(p) + 1) % ORDER.length]), []);
  return { pref, resolved, setPref, cycle };
}

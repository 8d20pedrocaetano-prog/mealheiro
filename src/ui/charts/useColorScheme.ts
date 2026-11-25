import { useEffect, useState } from 'react';

/** Re-renders when the system switches light/dark, so charts follow the theme. */
export function useColorScheme(): 'light' | 'dark' {
  const q = typeof matchMedia !== 'undefined' ? matchMedia('(prefers-color-scheme: dark)') : null;
  const [dark, setDark] = useState(q?.matches ?? false);
  useEffect(() => {
    if (!q) return;
    const on = () => setDark(q.matches);
    q.addEventListener('change', on);
    return () => q.removeEventListener('change', on);
  }, [q]);
  return dark ? 'dark' : 'light';
}

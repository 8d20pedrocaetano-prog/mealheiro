/**
 * Group colours (SPEC §6: fixed, colour-blind-safe; groups get hues, categories get tints).
 * Hues are the validated 8-slot categorical palette from the dataviz reference (adjacent CVD ΔE ≥ 10
 * in both modes). Colour follows the group, never its rank; groups without a slot fold into "Other".
 */
export const SLOTS_LIGHT = [
  '#257de0',
  '#f47230',
  '#00b894',
  '#f2a600',
  '#ee7fac',
  '#008a17',
  '#6a4ce2',
  '#ec4647',
];
export const SLOTS_DARK = [
  '#338ced',
  '#e76624',
  '#00a888',
  '#d28e05',
  '#e24d8b',
  '#0aac23',
  '#9887ef',
  '#eb6263',
];
export const OTHER_LIGHT = '#9a9f9c';
export const OTHER_DARK = '#6b716e';

/** Fixed slot per spending group, in the validated order. */
export const GROUP_SLOT: Record<string, number> = {
  Home: 0,
  Food: 1,
  Transport: 2,
  Shopping: 3,
  Leisure: 4,
  'Bills & subscriptions': 5,
  Travel: 6,
  Unitemized: 7,
};

export const OTHER_GROUP = 'Other groups';

export function isDark(): boolean {
  return (
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches === true
  );
}

export function groupColor(group: string, dark = isDark()): string {
  const slot = GROUP_SLOT[group];
  if (slot === undefined) return dark ? OTHER_DARK : OTHER_LIGHT;
  return (dark ? SLOTS_DARK : SLOTS_LIGHT)[slot];
}

/** Groups that get their own colour; anything else is folded into OTHER_GROUP in charts. */
export function chartGroup(group: string): string {
  return group in GROUP_SLOT ? group : OTHER_GROUP;
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** A tint of a hue toward the surface (t = 0 → hue, 1 → surface), for category-within-group shades. */
export function tint(hex: string, t: number, dark = isDark()): string {
  const [r, g, b] = hexToRgb(hex);
  const [sr, sg, sb] = dark ? [24, 28, 27] : [255, 255, 255];
  const mix = (a: number, s: number) => Math.round(a + (s - a) * t);
  return `#${[mix(r, sr), mix(g, sg), mix(b, sb)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** Chart chrome that follows the theme (ECharts needs concrete colours). */
export function chartTheme(dark = isDark()) {
  return dark
    ? {
        surface: '#181c1b',
        ink: '#eceeed',
        ink2: '#aab1ae',
        ink3: '#7c8481',
        grid: '#2c3331',
        accent: '#2dd4bf',
      }
    : {
        surface: '#ffffff',
        ink: '#1b1d1c',
        ink2: '#555a57',
        ink3: '#828884',
        grid: '#e2e2dc',
        accent: '#0f766e',
      };
}

function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Black or white text, whichever contrasts more with the fill. */
export function onColor(hex: string): string {
  const l = luminance(hex);
  return (l + 0.05) / 0.05 > 1.05 / (l + 0.05) ? '#111111' : '#ffffff';
}

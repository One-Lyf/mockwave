// Theme mode: light / dark / system, the WaveRider pattern (see Rackwave's
// app/src/theme.ts). The palette lives in index.css as [data-theme] blocks;
// this module only stores the choice and applies the resolved theme to <html>.
export type ThemeMode = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'mockwave-theme';
const DEFAULT_MODE: ThemeMode = 'system';

function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-color-scheme: dark)').matches;
}

export function resolveTheme(mode: ThemeMode): ResolvedTheme {
  return mode === 'system' ? (systemPrefersDark() ? 'dark' : 'light') : mode;
}

export function getStoredThemeMode(): ThemeMode {
  if (typeof window === 'undefined') return DEFAULT_MODE;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : DEFAULT_MODE;
  } catch {
    return DEFAULT_MODE; // storage blocked (private mode, sandboxed frame)
  }
}

function applyResolvedTheme(mode: ThemeMode) {
  if (typeof document === 'undefined') return;
  const theme = resolveTheme(mode);
  document.documentElement.setAttribute('data-theme', theme);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#000000' : '#ffffff');
}

export function setThemeMode(mode: ThemeMode) {
  try {
    window.localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    /* not persisted; still applied for this session */
  }
  applyResolvedTheme(mode);
}

/** Apply the stored mode before first paint, and follow OS changes while in System mode. */
export function initTheme(): ThemeMode {
  const mode = getStoredThemeMode();
  applyResolvedTheme(mode);
  // Registered unconditionally and re-reading the stored mode on each change, so a
  // later switch to System follows the OS and an explicit Light/Dark is never clobbered.
  if (typeof window !== 'undefined' && window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
      applyResolvedTheme(getStoredThemeMode());
    });
  }
  return mode;
}

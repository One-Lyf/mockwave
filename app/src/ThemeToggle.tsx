import { useState } from 'react';
import { getStoredThemeMode, setThemeMode, type ThemeMode } from './theme';

const ORDER: ThemeMode[] = ['system', 'light', 'dark'];
const LABEL: Record<ThemeMode, string> = { system: 'System', light: 'Light', dark: 'Dark' };

/** Header theme control: cycles System -> Light -> Dark; the choice persists. */
export default function ThemeToggle() {
  // Read from storage on first render: main.tsx's initTheme() already applied it to <html>
  const [mode, setMode] = useState<ThemeMode>(() => getStoredThemeMode());

  const cycle = () => {
    const next = ORDER[(ORDER.indexOf(mode) + 1) % ORDER.length];
    setThemeMode(next);
    setMode(next);
  };

  return (
    <button
      type="button"
      className="btn theme-toggle"
      onClick={cycle}
      title="Theme"
      aria-label={`Theme: ${LABEL[mode]}. Click to change.`}
    >
      Theme: {LABEL[mode]}
    </button>
  );
}

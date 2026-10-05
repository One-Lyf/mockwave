const svg = (d: React.ReactNode) => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    {d}
  </svg>
);

export const IconMeal = () => svg(<><rect x="3" y="5" width="18" height="15" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></>);
export const IconFood = () => svg(<path d="M6 3v8a3 3 0 0 0 3 3v7M9 3v6M12 3v8a3 3 0 0 1-3 3M17 3c-2 2-3 5-3 8h3v10" />);
export const IconGoal = () => svg(<><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="4.5" /><circle cx="12" cy="12" r=".8" /></>);
export const IconPlus = () => svg(<path d="M12 5v14M5 12h14" />);
export const IconChevron = () => svg(<path d="M9 6l6 6-6 6" />);

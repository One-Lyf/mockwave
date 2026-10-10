const svg = (d: React.ReactNode) => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    {d}
  </svg>
);

export const IconPlus = () => svg(<path d="M12 5v14M5 12h14" />);
export const IconChevron = () => svg(<path d="M9 6l6 6-6 6" />);
export const IconBack = () => svg(<path d="M15 6l-6 6 6 6" />);
export const IconMore = () => svg(<><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>);

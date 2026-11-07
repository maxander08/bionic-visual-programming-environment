const P: Record<string, string> = {
  play: 'M7 4.5v15l12-7.5z',
  pause: 'M7 5v14M17 5v14',
  stop: 'M6 6h12v12H6z',
  step: 'M5 5v14M10 5l9 7-9 7z',
  undo: 'M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3',
  redo: 'M15 14l5-5-5-5M20 9H10a6 6 0 0 0 0 12h3',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  fit: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  focus: 'M12 8v8M8 12h8M3 12a9 9 0 1 0 18 0 9 9 0 0 0-18 0',
  file: 'M6 3h8l4 4v14H6zM14 3v4h4',
  folder: 'M3 7h6l2 2h10v10H3z',
  save: 'M5 4h12l3 3v13H5zM8 4v5h8M8 20v-6h8v6',
  share: 'M12 15V3M8 7l4-4 4 4M5 12v8h14v-8',
  docs: 'M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3zM9 9h6M9 13h6',
  gear: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM4 12h2M18 12h2M12 4v2M12 18v2M6.3 6.3l1.4 1.4M16.3 16.3l1.4 1.4M17.7 6.3l-1.4 1.4M7.7 16.3l-1.4 1.4',
  expand: 'M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7',
  close: 'M6 6l12 12M18 6L6 18',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4',
  chevron: 'M9 6l6 6-6 6',
  trash: 'M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13',
  copy: 'M8 8h11v12H8zM5 16V4h11',
  group: 'M4 4h7v7H4zM13 13h7v7h-7zM11 7.5h2.5V13M7.5 11v2.5H13',
  open: 'M4 6h16v12H4zM9 12l3-3 3 3M12 9v6',
  panelL: 'M4 5h16v14H4zM9 5v14',
  panelR: 'M4 5h16v14H4zM15 5v14',
  alert: 'M12 4l9 16H3zM12 10v4M12 17v.5',
  check: 'M5 12.5l4.5 4.5L19 7',
  map: 'M4 6l5-2 6 2 5-2v14l-5 2-6-2-5 2zM9 4v14M15 6v14',
  menu: 'M4 7h16M4 12h16M4 17h16',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3A4 4 0 0 0 11 18.7l1-1',
  power: 'M12 3v8M7 6.5a7 7 0 1 0 10 0',
};

export function Icon({ name, size = 16 }: { name: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={P[name] ?? ''} />
    </svg>
  );
}

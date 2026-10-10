const PATHS: Record<string, string> = {
  search: 'M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13Z M15.2 15.2 20 20',
  ask: 'M4.5 5.5h15v10h-8l-4.5 3.5v-3.5H4.5Z M8.5 10.5h7 M8.5 8h4',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z M19.4 13.5l1.6 1-2 3.4-1.8-.7a7 7 0 0 1-2 1.2L15 20.5h-4l-.3-2.1a7 7 0 0 1-2-1.2l-1.8.7-2-3.4 1.6-1a7 7 0 0 1 0-2.4l-1.6-1 2-3.4 1.8.7a7 7 0 0 1 2-1.2L11 3.5h4l.3 2.1a7 7 0 0 1 2 1.2l1.8-.7 2 3.4-1.6 1a7 7 0 0 1 0 2.4Z',
  atlas: 'M12 3 20 7.5 12 12 4 7.5Z M4 12l8 4.5 8-4.5 M4 16.5 12 21l8-4.5',
  rooms: 'M4 5h16v14H4Z M4 11h9 M13 5v14',
  upkeep: 'M14.5 5.5a4 4 0 0 0-5 5L4 16l4 4 5.5-5.5a4 4 0 0 0 5-5l-2.5 2.5-2.5-.5-.5-2.5Z',
  network: 'M12 5.5a2 2 0 1 0 0-.1Z M5.5 18.5a2 2 0 1 0 0-.1Z M18.5 18.5a2 2 0 1 0 0-.1Z M12 7.5v4 M12 11.5 6.5 17 M12 11.5l5.5 5.5',
  library: 'M5 4.5h4v15H5Z M10 4.5h4v15h-4Z M15.2 5.3l3.6-.9 3 14.5-3.6.9Z',
  changes: 'M5 8h12l-3-3 M19 16H7l3 3',
  close: 'M6 6l12 12 M18 6 6 18',
  rotl: 'M5 9.5A7.5 7.5 0 1 1 6.5 16 M5 4.5v5h5',
  rotr: 'M19 9.5A7.5 7.5 0 1 0 17.5 16 M19 4.5v5h-5',
  plus: 'M12 5v14 M5 12h14',
  minus: 'M5 12h14',
  fit: 'M4 9V4h5 M15 4h5v5 M20 15v5h-5 M9 20H4v-5',
  explode: 'M12 3 19 6.5 12 10 5 6.5Z M5 11.5l7 3.5 7-3.5 M5 17l7 3.5 7-3.5',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  alert: 'M12 4 21 19.5H3Z M12 10v4.5 M12 17v.1',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1 M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  file: 'M6 3.5h8l4 4v13H6Z M14 3.5v4h4 M9 12h6 M9 15.5h6',
  photo: 'M4 6.5h16v12H4Z M4 15l4.5-4 3.5 3 3-2.5 5 4 M15.5 10a1.2 1.2 0 1 0 0-.1Z',
  chevron: 'M9 6l6 6-6 6',
  chevronDown: 'M6 9l6 6 6-6',
  back: 'M15 6l-6 6 6 6',
  history: 'M4.5 12a7.5 7.5 0 1 0 2.2-5.3 M4.5 4.5v3.5H8 M12 8v4.5l3 2',
  edit: 'M5 19l1-4L15.5 5.5l3 3L9 18Z M13.5 7.5l3 3',
  plug: 'M9 3v5 M15 3v5 M6.5 8h11v3a5.5 5.5 0 0 1-11 0Z M12 16.5V21',
  valve: 'M4 12h16 M12 12V6 M8.5 6h7 M7 9v6 M17 9v6',
  wifi: 'M3.5 9a12 12 0 0 1 17 0 M6.5 12.5a7.5 7.5 0 0 1 11 0 M9.5 16a3 3 0 0 1 5 0 M12 19v.1',
  box: 'M12 3 20 7.5v9L12 21l-8-4.5v-9Z M4 7.5 12 12l8-4.5 M12 12v9',
  calendar: 'M4.5 6h15v13.5h-15Z M4.5 10h15 M8.5 3.5v4 M15.5 3.5v4',
  external: 'M14 4.5h5.5V10 M19.5 4.5 11 13 M17 14v5.5H4.5V7H10',
  copy: 'M8 8h11v12H8Z M5 16V4h11',
  cloudOff: 'M7 18h10a4 4 0 0 0 1-7.9A6 6 0 0 0 6.6 9 4.5 4.5 0 0 0 7 18Z M4 4l16 16',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z M12 11v5.5 M12 7.5v.1',
  menu: 'M4 7h16 M4 12h16 M4 17h16',
  sun: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z M12 2.5v2 M12 19.5v2 M2.5 12h2 M19.5 12h2',
  person: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z M4.5 20.5a7.5 7.5 0 0 1 15 0',
  layers: 'M12 4 20 8.5 12 13 4 8.5Z M4 13l8 4.5 8-4.5',
};

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 18, className }: { name: IconName | string; size?: number; className?: string }) {
  return (
    <svg className={`icon${className ? ` ${className}` : ''}`} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={PATHS[name] ?? PATHS.info} fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

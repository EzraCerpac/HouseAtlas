import type { ReactNode } from 'react';

/** Demo "photos": stylised vector scenes standing in for attached images. */
export const MEDIA_TRAY: { id: string; title: string; scene: string }[] = [
  { id: 'rating-plate', title: 'Rating plate close-up', scene: 'plate' },
  { id: 'installed', title: 'Installed in place', scene: 'installed' },
  { id: 'serial', title: 'Serial number sticker', scene: 'serial' },
  { id: 'valve-handle', title: 'Valve handle position', scene: 'valve' },
  { id: 'label', title: 'Handwritten label', scene: 'label' },
  { id: 'wide', title: 'Wide shot of the room corner', scene: 'wide' },
];

export function MediaScene({ scene }: { scene: string }) {
  let body: ReactNode;
  switch (scene) {
    case 'plate':
      body = (
        <>
          <rect x="22" y="18" width="76" height="54" rx="3" className="p-metal" />
          <path d="M30 30h40 M30 38h56 M30 46h30 M30 54h48 M30 62h22" className="p-ink" />
          <circle cx="88" cy="28" r="4" className="p-ink" />
        </>
      );
      break;
    case 'installed':
      body = (
        <>
          <rect x="0" y="58" width="120" height="32" className="p-floor" />
          <rect x="18" y="22" width="40" height="44" rx="2" className="p-unit" />
          <rect x="62" y="22" width="40" height="44" rx="2" className="p-unit2" />
          <path d="M14 22h92" className="p-ink" />
        </>
      );
      break;
    case 'serial':
      body = (
        <>
          <rect x="0" y="0" width="120" height="90" className="p-unit" />
          <rect x="26" y="26" width="68" height="36" rx="2" className="p-sticker" />
          <path d="M32 36h2 M36 36h1 M39 36h3 M44 36h1 M47 36h2 M51 36h1 M54 36h3 M59 36h1 M62 36h2 M66 36h1 M69 36h3" className="p-bar" />
          <path d="M32 50h42 M32 55h28" className="p-ink" />
        </>
      );
      break;
    case 'valve':
      body = (
        <>
          <path d="M0 52h120" className="p-pipe" />
          <rect x="50" y="42" width="20" height="20" rx="3" className="p-metal" />
          <path d="M60 42V26 M46 26h28" className="p-handle" />
        </>
      );
      break;
    case 'label':
      body = (
        <>
          <rect x="16" y="20" width="88" height="50" rx="2" className="p-sticker" />
          <path d="M24 38c6-6 10 4 16-2s8 2 14-3 M24 52c8-4 12 3 20-2s10 3 18-1" className="p-hand" />
        </>
      );
      break;
    default:
      body = (
        <>
          <path d="M0 62 40 50l80 16v24H0Z" className="p-floor" />
          <path d="M40 0v50 M0 10l40 40" className="p-ink" />
          <rect x="54" y="28" width="22" height="30" className="p-unit" />
          <rect x="10" y="44" width="16" height="16" className="p-unit2" />
        </>
      );
  }
  return (
    <svg className="scene" viewBox="0 0 120 90" aria-hidden="true">
      <rect width="120" height="90" className="p-bg" />
      {body}
    </svg>
  );
}

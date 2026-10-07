import type { ReactNode } from 'react';
import type { Illustration } from '../data/types';

// Line illustrations for belongings. Drawn in a 120 x 90 box.
const ART: Record<Illustration, ReactNode> = {
  dishwasher: (
    <>
      <rect x="36" y="14" width="48" height="64" rx="3" className="a-fill" />
      <path d="M36 28h48 M44 21h14 M72 21h4" />
      <rect x="44" y="36" width="32" height="34" rx="2" className="a-fill2" />
      <path d="M48 46h24 M48 54h24 M48 62h24" className="a-thin" />
    </>
  ),
  fridge: (
    <>
      <rect x="40" y="6" width="40" height="78" rx="4" className="a-fill" />
      <path d="M40 34h40 M46 14v12 M46 42v14" />
    </>
  ),
  oven: (
    <>
      <rect x="32" y="14" width="56" height="62" rx="3" className="a-fill" />
      <path d="M32 28h56 M42 21h.1 M50 21h.1 M58 21h.1" />
      <rect x="40" y="36" width="40" height="30" rx="3" className="a-fill2" />
      <path d="M44 33h32" />
    </>
  ),
  washer: (
    <>
      <rect x="34" y="12" width="52" height="66" rx="4" className="a-fill" />
      <path d="M34 26h52 M42 19h12" />
      <circle cx="60" cy="52" r="17" className="a-fill2" />
      <circle cx="60" cy="52" r="10" />
    </>
  ),
  boiler: (
    <>
      <rect x="40" y="8" width="40" height="58" rx="5" className="a-fill" />
      <rect x="50" y="18" width="20" height="9" rx="1.5" className="a-fill2" />
      <path d="M48 66v14 M56 66v14 M64 66v14 M72 66v14 M54 40h12" />
    </>
  ),
  sofa: (
    <>
      <path d="M18 40h84v26H18Z" className="a-fill" />
      <path d="M24 40V28h72v12 M18 66v8 M102 66v8 M60 40v26" />
      <path d="M12 44h6v22h-6Z M102 44h6v22h-6Z" className="a-fill2" />
    </>
  ),
  tv: (
    <>
      <rect x="18" y="14" width="84" height="50" rx="3" className="a-fill2" />
      <path d="M50 64l-6 14h32l-6-14" />
    </>
  ),
  piano: (
    <>
      <path d="M26 12h68v66H26Z" className="a-fill" />
      <path d="M26 44h68 M20 44h80v8H20Z" />
      <path d="M30 44v8 M36 44v5 M42 44v5 M50 44v8 M56 44v5 M62 44v5 M70 44v8 M76 44v5 M84 44v5 M90 44v8" className="a-thin" />
      <path d="M30 78v-26 M90 78v-26" />
    </>
  ),
  desk: (
    <>
      <path d="M16 34h88v6H16Z" className="a-fill" />
      <path d="M26 40v38 M94 40v38 M20 78h12 M88 78h12" />
      <rect x="46" y="18" width="28" height="16" rx="1.5" className="a-fill2" />
    </>
  ),
  router: (
    <>
      <rect x="28" y="44" width="64" height="20" rx="4" className="a-fill" />
      <path d="M40 44 34 20 M80 44l6-24 M40 54h.1 M48 54h.1 M56 54h.1" />
    </>
  ),
  printer: (
    <>
      <rect x="26" y="34" width="68" height="30" rx="4" className="a-fill" />
      <path d="M38 34V18h44v16 M38 56h44v20H38Z" />
      <path d="M44 64h32 M44 70h22" className="a-thin" />
    </>
  ),
  clock: (
    <>
      <path d="M46 8h28v74H46Z" className="a-fill" />
      <circle cx="60" cy="24" r="10" className="a-fill2" />
      <path d="M60 24v-6 M60 24l4 3 M60 40v26" />
      <circle cx="60" cy="68" r="4" />
    </>
  ),
  tent: (
    <>
      <path d="M14 74 60 16l46 58Z" className="a-fill" />
      <path d="M60 16v58 M48 74l12-22 12 22" />
    </>
  ),
  drill: (
    <>
      <path d="M30 28h46l8 6v8l-8 6H30Z" className="a-fill" />
      <path d="M84 38h18 M44 48l-6 26h18l4-26" />
    </>
  ),
  bike: (
    <>
      <circle cx="32" cy="58" r="17" />
      <circle cx="88" cy="58" r="17" />
      <path d="M32 58 48 32h30L88 58 M48 32l14 26h-30 M62 58l16-26 M44 26h10 M78 32l-4-10h8" />
    </>
  ),
  freezer: (
    <>
      <rect x="18" y="30" width="84" height="46" rx="3" className="a-fill" />
      <path d="M18 40h84 M50 35h20" />
    </>
  ),
  alarm: (
    <>
      <circle cx="60" cy="45" r="28" className="a-fill" />
      <circle cx="60" cy="45" r="14" className="a-fill2" />
      <path d="M52 45h.1 M60 45h.1 M68 45h.1" />
    </>
  ),
  lamp: (
    <>
      <path d="M42 14h36l8 24H34Z" className="a-fill2" />
      <path d="M60 38v38 M44 78h32" />
    </>
  ),
  box: (
    <>
      <path d="M60 12 94 28v36L60 80 26 64V28Z" className="a-fill" />
      <path d="M26 28l34 16 34-16 M60 44v36 M43 20l34 16" />
    </>
  ),
  stove: (
    <>
      <path d="M36 30h48v44H36Z" className="a-fill" />
      <path d="M54 30V8h12v22 M42 74v6 M78 74v6" />
      <rect x="44" y="40" width="32" height="24" rx="2" className="a-fill2" />
    </>
  ),
  mower: (
    <>
      <path d="M24 50h56l8 14H24Z" className="a-fill" />
      <path d="M80 50 100 14 M96 14h10" />
      <circle cx="34" cy="68" r="8" />
      <circle cx="78" cy="68" r="8" />
    </>
  ),
  dehumidifier: (
    <>
      <rect x="40" y="12" width="40" height="66" rx="6" className="a-fill" />
      <path d="M48 22h24 M48 28h24 M48 34h24" className="a-thin" />
      <rect x="46" y="52" width="28" height="18" rx="2" className="a-fill2" />
    </>
  ),
};

export function ItemArt({ kind, label }: { kind: Illustration; label?: string }) {
  return (
    <svg className="art" viewBox="0 0 120 90" role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <g className="art-lines">{ART[kind]}</g>
    </svg>
  );
}

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

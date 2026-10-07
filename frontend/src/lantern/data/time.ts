// Display-only clock supplied by the current authorized saved view.
function localDay(d: Date) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
// Callers with a saved view pass its display time; dormant callers use wall time.
const currentDay = () => localDay(new Date());
/** Dormant prototype form compatibility, using the real local calendar day. */
export const DEMO_TODAY = currentDay();

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function parse(iso: string): Date {
  // Date-only strings are treated as local midnight, not UTC.
  return iso.length === 10 ? new Date(`${iso}T00:00:00`) : new Date(iso);
}

function validDate(iso: string): Date | undefined {
  const calendarDay = iso.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(calendarDay) && localDay(parse(calendarDay)) !== calendarDay) return undefined;
  const d = parse(iso);
  if (!Number.isFinite(d.getTime())) return undefined;
  return d;
}

function referenceDate(now?: string): Date | undefined {
  return now === undefined ? new Date() : validDate(now);
}

export function fmtDate(iso?: string): string {
  if (!iso) return 'No date';
  const d = validDate(iso);
  if (!d) return 'Unknown';
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export function fmtShortDate(iso?: string, now?: string): string {
  if (!iso) return 'No date';
  const d = validDate(iso);
  const reference = referenceDate(now);
  if (!d || !reference) return 'Unknown';
  const sameYear = d.getFullYear() === reference.getFullYear();
  return sameYear ? `${d.getDate()} ${MONTHS[d.getMonth()]}` : `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export function fmtTime(iso: string): string {
  const d = validDate(iso);
  if (!d) return 'Unknown';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function fmtDateTime(iso?: string): string {
  if (!iso) return 'Unknown time';
  return `${fmtDate(iso)}, ${fmtTime(iso)}`;
}

/** "3 h ago", "yesterday", "in 4 days". */
export function rel(iso?: string, now?: string): string {
  if (!iso) return 'Unknown';
  const d = validDate(iso);
  const reference = referenceDate(now);
  if (!d || !reference) return 'Unknown';
  if (iso.length === 10) {
    const days = daysBetween(localDay(reference), iso);
    if (days === 0) return 'today';
    if (days === 1) return 'tomorrow';
    if (days === -1) return 'yesterday';
  }
  const diff = reference.getTime() - d.getTime();
  const abs = Math.abs(diff);
  const min = 60_000;
  const hr = 60 * min;
  const day = 24 * hr;
  const future = diff < 0;
  if (abs < min) return 'just now';
  if (abs < hr) {
    const m = Math.round(abs / min);
    return future ? `in ${m} min` : `${m} min ago`;
  }
  if (abs < day && iso.length > 10) {
    const h = Math.round(abs / hr);
    return future ? `in ${h} h` : `${h} h ago`;
  }
  const days = daysBetween(localDay(reference), iso.slice(0, 10));
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  if (days > 0) return days < 45 ? `in ${days} days` : `in ${Math.round(days / 30)} months`;
  const past = -days;
  if (past < 45) return `${past} days ago`;
  if (past < 540) return `${Math.round(past / 30)} months ago`;
  return `${Math.round(past / 365)} years ago`;
}

export function daysBetween(fromDate: string, toDate: string): number {
  const a = parse(fromDate.slice(0, 10)).getTime();
  const b = parse(toDate.slice(0, 10)).getTime();
  return Math.round((b - a) / 86_400_000);
}

export function daysUntil(date?: string, now?: string): number | undefined {
  if (!date) return undefined;
  const reference = referenceDate(now);
  if (!reference || !validDate(date)) return undefined;
  const days = daysBetween(localDay(reference), date);
  return Number.isFinite(days) ? days : undefined;
}

export function addDays(date: string, n: number): string {
  const d = parse(date.slice(0, 10));
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Compatibility for inactive prototype forms; real commands own timestamps. */
export function demoNowIso(): string { return new Date().toISOString(); }

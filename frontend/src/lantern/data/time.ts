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

// Display the recorded calendar, not the browser's conversion of its instant.
function recordedCalendar(iso: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:$|[Tt ])/u.exec(iso);
  return match ? { year: match[1]!, month: Number(match[2]) - 1, day: Number(match[3]) } : null;
}

function referenceCalendarDay(now: string | undefined, reference: Date): string | undefined {
  return now === undefined ? localDay(reference) : recordedCalendar(now) ? now.slice(0, 10) : undefined;
}

export function fmtDate(iso?: string): string {
  if (!iso) return 'No date';
  const d = validDate(iso);
  if (!d) return 'Unknown';
  const recorded = recordedCalendar(iso);
  return recorded ? `${recorded.day} ${MONTHS[recorded.month]} ${recorded.year}` : iso;
}

export function fmtShortDate(iso?: string, now?: string): string {
  if (!iso) return 'No date';
  const d = validDate(iso);
  const reference = referenceDate(now);
  if (!d || !reference) return 'Unknown';
  const recorded = recordedCalendar(iso);
  if (!recorded) return iso;
  const referenceYear = now === undefined ? String(reference.getFullYear()) : recordedCalendar(now)?.year;
  return recorded.year === referenceYear ? `${recorded.day} ${MONTHS[recorded.month]}`
    : `${recorded.day} ${MONTHS[recorded.month]} ${recorded.year}`;
}

export function fmtTime(iso: string): string {
  const d = validDate(iso);
  if (!d) return 'Unknown';
  const clock = /^\d{4}-\d{2}-\d{2}[Tt ](.+)$/u.exec(iso);
  // Keep supplied seconds, fractional precision and offset; no zone is inferred.
  return clock ? clock[1]! : iso;
}

export function fmtDateTime(iso?: string): string {
  if (!iso) return 'Unknown time';
  // Source/retrieval timestamps retain their complete original text and offset.
  return validDate(iso) ? iso : 'Unknown';
}

/** "3 h ago", "yesterday", "in 4 days". */
export function rel(iso?: string, now?: string): string {
  if (!iso) return 'Unknown';
  const d = validDate(iso);
  const reference = referenceDate(now);
  if (!d || !reference) return 'Unknown';
  const referenceDay = referenceCalendarDay(now, reference);
  if (iso.length === 10) {
    if (referenceDay === undefined) return 'Unknown';
    const days = daysBetween(referenceDay, iso);
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
  if (referenceDay === undefined) return 'Unknown';
  const days = daysBetween(referenceDay, iso.slice(0, 10));
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
  const referenceDay = referenceCalendarDay(now, reference);
  if (referenceDay === undefined) return undefined;
  const days = daysBetween(referenceDay, date);
  return Number.isFinite(days) ? days : undefined;
}

export function addDays(date: string, n: number): string {
  const d = parse(date.slice(0, 10));
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Compatibility for inactive prototype forms; real commands own timestamps. */
export function demoNowIso(): string { return new Date().toISOString(); }

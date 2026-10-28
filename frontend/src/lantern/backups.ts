import { formatDate } from '../app/copy.ts';

/** How long the server's nightly iCloud backups are kept. The server stores
 * the choice; the backup job applies it on its next verified run and reports
 * back through the same route. */
export type Retention =
  | { readonly keep: 'forever' }
  | { readonly keep: 'recent'; readonly nights: number; readonly months: number };

export interface BackupStatus {
  readonly lastSuccess: { readonly finished: string; readonly archiveBytes: number } | null;
  readonly lastFailure: { readonly at: string; readonly step: string } | null;
  readonly removed: { readonly archives: number; readonly modelFiles: number; readonly bytes: number } | null;
  readonly stored: { readonly archives: number; readonly bytes: number } | null;
  readonly problem: string | null;
}
export interface BackupSettingsView {
  readonly retention: Retention;
  readonly status: BackupStatus | null;
}

const ROUTE = '/api/atlas/backup/v1/settings';
const TIMEOUT_MS = 15_000;
export const NIGHTS = [7, 14, 30, 60, 90, 180, 365];
export const MONTHS = [0, 3, 6, 12, 24, 36, 60];
export const RECENT = { keep: 'recent', nights: 30, months: 12 } as const;

export type Load = { readonly kind: 'loading' } | { readonly kind: 'absent' } | { readonly kind: 'unreachable' }
  | { readonly kind: 'ready'; readonly view: BackupSettingsView };

const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const when = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));

export function decodeRetention(value: unknown): Retention {
  const row = record(value);
  if (row?.keep === 'forever') return { keep: 'forever' };
  if (row?.keep === 'recent' && count(row.nights) && count(row.months)) return { keep: 'recent', nights: row.nights, months: row.months };
  throw new TypeError('Invalid backup retention');
}

/** Missing or odd parts of the job's summary are left out, never guessed. */
export function decodeBackupSettings(value: unknown): BackupSettingsView {
  const row = record(value);
  if (row?.schemaVersion !== 1) throw new TypeError('Invalid backup settings');
  const status = record(row.status);
  const success = record(status?.lastSuccess), failure = record(status?.lastFailure);
  const removed = record(status?.removed), stored = record(status?.stored);
  return {
    retention: decodeRetention(row.retention),
    status: status && {
      lastSuccess: success && when(success.finished) && count(success.archiveBytes)
        ? { finished: success.finished, archiveBytes: success.archiveBytes } : null,
      lastFailure: failure && when(failure.at) && typeof failure.step === 'string' ? { at: failure.at, step: failure.step } : null,
      removed: removed && count(removed.archives) && count(removed.modelFiles) && count(removed.bytes)
        ? { archives: removed.archives, modelFiles: removed.modelFiles, bytes: removed.bytes } : null,
      stored: stored && count(stored.archives) && count(stored.bytes) ? { archives: stored.archives, bytes: stored.bytes } : null,
      problem: typeof status.problem === 'string' && status.problem ? status.problem : null,
    },
  };
}

export function formatBytes(bytes: number): string {
  const units = ['bytes', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes, unit = 0;
  while (value >= 1000 && unit < units.length - 1) { value /= 1000; unit += 1; }
  return unit === 0 ? `${bytes} bytes` : `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// The choice is about the iCloud copies only; say so, so it never reads as a policy for the working data.
const SCOPE = 'This choice covers the iCloud backups only, never the server’s own data or copies saved on your devices.';

export function describeRetention(retention: Retention): string {
  if (retention.keep === 'forever') return `Every nightly iCloud backup is kept. ${SCOPE}`;
  const monthly = retention.months > 0 ? ` and the first one of each of the last ${plural(retention.months, 'month', 'months')}` : '';
  return `Keeps the last ${plural(retention.nights, 'nightly backup', 'nightly backups')}${monthly}. The next nightly backup deletes older ones from iCloud. ${SCOPE}`;
}

/** One or two short lines: how the last run went, and what iCloud holds. */
export function describeStatus(status: BackupStatus | null): readonly string[] {
  if (!status || (!status.lastSuccess && !status.lastFailure)) return ['No nightly backup has reported yet.'];
  const lines: string[] = [];
  const { lastSuccess: success, lastFailure: failure } = status;
  if (failure && (!success || Date.parse(failure.at) > Date.parse(success.finished))) {
    lines.push(`The backup on ${formatDate(failure.at)} stopped at “${failure.step}”.`
      + (success ? ` The newest good one is from ${formatDate(success.finished)}.` : ''));
  } else if (success) {
    // A passed test restore shows the copy is complete; it is not a recovery of the house, so never call it one.
    lines.push(`Last backup ${formatDate(success.finished)}, ${formatBytes(success.archiveBytes)}, saved to iCloud. Its test restore passed; that checks the copy, it is not a full recovery.`);
  }
  if (status.stored) {
    const removed = status.removed && status.removed.archives + status.removed.modelFiles > 0
      ? ` The last run deleted ${plural(status.removed.archives, 'older backup', 'older backups')}`
        + (status.removed.modelFiles ? ` and ${plural(status.removed.modelFiles, 'unused model file', 'unused model files')}` : '')
        + ` (${formatBytes(status.removed.bytes)}).` : '';
    lines.push(`iCloud holds ${plural(status.stored.archives, 'backup', 'backups')}, ${formatBytes(status.stored.bytes)} in all.${removed}`);
  }
  if (status.problem) lines.push(status.problem);
  return lines;
}

export async function readSettings(transport: typeof fetch): Promise<Load> {
  const response = await transport(ROUTE, {
    method: 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
    headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (response.status === 404) return { kind: 'absent' };
  if (!response.ok) throw new Error(`Backup settings: HTTP ${response.status}`);
  return { kind: 'ready', view: decodeBackupSettings(await response.json()) };
}

export async function saveRetention(retention: Retention, transport: typeof fetch): Promise<BackupSettingsView> {
  const options = { credentials: 'same-origin', cache: 'no-store', redirect: 'error' } as const;
  const session = await transport('/api/atlas/auth/session', {
    ...options, method: 'GET', headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const csrf = session.ok ? record(await session.json())?.csrfToken : null;
  if (typeof csrf !== 'string' || !csrf) throw new Error('Signed out');
  const response = await transport(ROUTE, {
    ...options, method: 'POST', signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Atlas-CSRF': csrf },
    body: JSON.stringify(retention),
  });
  if (response.status === 403) throw new Error('denied');
  if (!response.ok) throw new Error(`Backup settings: HTTP ${response.status}`);
  return decodeBackupSettings(await response.json());
}

/** Saves a choice and says what the server now holds. A refusal is final;
 * any other failure may have happened after the server wrote the file, so
 * the saved choice is read again rather than assumed. */
export async function chooseRetention(retention: Retention, transport: typeof fetch):
  Promise<{ readonly load: Load; readonly error: 'denied' | 'not-saved' | null }> {
  try {
    return { load: { kind: 'ready', view: await saveRetention(retention, transport) }, error: null };
  } catch (failure) {
    if (failure instanceof Error && failure.message === 'denied') throw failure;
  }
  const load = await readSettings(transport).catch((): Load => ({ kind: 'unreachable' }));
  const saved = load.kind === 'ready' && JSON.stringify(load.view.retention) === JSON.stringify(retention);
  return { load, error: load.kind === 'ready' && !saved ? 'not-saved' : null };
}

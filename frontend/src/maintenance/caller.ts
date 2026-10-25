import { correlate, decode, fingerprint, identifier, need, outcome, request, terminal } from './contract';
import type { Command, Operation, Result, Selection } from './contract';

/** Host adapter to the existing dispatcher; no default HTTP route or MCP client.
 * Must bound its I/O and return the original result JSON. Abort means stop
 * waiting, never proof that a dispatched target operation was cancelled.
 */
export type MaintenanceTransport = (command: Command, requestJson: string, signal: AbortSignal) => Promise<string>;
export interface Pending { owner: string; operation: Operation; last: Result | null }
export interface Snapshot {
  availability: 'unavailable' | 'available'; waiting: boolean;
  selection: Selection | null; result: Result | null; outcome: string;
  canCheck: boolean; canApply: boolean; canPoll: boolean;
}
const copy = <T>(v: T): T => structuredClone(v);

export class MaintenanceCaller {
  private epoch = 0;
  private owner: string | null = null;
  private selection: Selection | null = null;
  private checked = false;
  private result: Result | null = null;
  private unresolved: Pending | null = null;
  private waiting = false;
  private active: AbortController | null = null;
  private used = new Set<string>();
  private polling = false;
  private wake: (() => void) | null = null;
  constructor(private readonly transport: MaintenanceTransport | null = null,
    private readonly timeoutMs = 30_000) { need(Number.isInteger(timeoutMs) && timeoutMs >= 1 && timeoutMs <= 120_000); }

  snapshot(): Snapshot { return copy({ availability: this.transport ? 'available' : 'unavailable', waiting: this.waiting,
    selection: this.selection, result: this.result, outcome: outcome(this.result),
    canCheck: !!(this.transport && this.selection && !this.waiting && !this.unresolved),
    canApply: !!(this.transport && this.selection && this.checked && !this.waiting && !this.unresolved),
    canPoll: !!(this.transport && this.unresolved && !this.waiting && this.owner === this.unresolved.owner &&
      this.selection && fingerprint(this.selection) === fingerprint(this.unresolved.operation)) }); }
  pending(): Pending | null { return copy(this.unresolved); }
  /** owner identifies the host's actor/home/session lifetime, never a wire grant. */
  select(owner: string, selection: Selection): void {
    need(owner.length > 0); fingerprint(selection); this.retire();
    this.owner = owner; this.selection = copy(selection);
  }
  /** Keep pending identity for explicit recovery; retire all repaint authority. */
  retire(): void {
    this.epoch++; this.active?.abort(); this.wake?.(); this.wake = null;
    this.owner = null; this.selection = null; this.checked = false; this.result = null; this.waiting = false;
  }
  private operation(action: 'check' | 'apply', operationId: string): Operation {
    need(this.transport && this.selection && this.owner && !this.waiting && !this.unresolved);
    identifier(operationId); need(!this.used.has(operationId) && this.used.size < 256);
    this.used.add(operationId); return copy({ ...this.selection, action, operationId });
  }
  async check(operationId: string): Promise<void> {
    const op = this.operation('check', operationId); this.checked = false;
    const epoch = this.epoch; const result = await this.exchange('check', op, epoch);
    if (epoch === this.epoch) this.checked = !!(result?.ok && result.code === 'none' && result.status?.phase === 'checked' &&
      result.status.compatibility === 'compatible' && result.status.code === 'none' && !result.status.recoveryNeeded);
  }
  async apply(operationId: string): Promise<void> {
    need(this.checked); const op = this.operation('apply', operationId); this.checked = false;
    const pending: Pending = { owner: this.owner!, operation: op, last: null };
    this.unresolved = pending; // Retain before dispatch, including synchronous transport exceptions.
    await this.exchange('apply', op, this.epoch, pending);
  }
  async poll(): Promise<void> {
    const p = this.unresolved;
    need(p && this.owner === p.owner && this.selection && fingerprint(this.selection) === fingerprint(p.operation) && !this.waiting);
    await this.exchange('status', p.operation, this.epoch, p);
  }
  /** Finite, explicitly invoked polling; status only. Lifecycle retirement wakes
   * the delay and aborts the local wait. Exhaustion leaves pending identity intact. */
  async recover(maxPolls = 3, intervalMs = 1000): Promise<void> {
    need(!this.polling && Number.isInteger(maxPolls) && maxPolls >= 1 && maxPolls <= 20 &&
      Number.isInteger(intervalMs) && intervalMs >= 1000 && intervalMs <= 30_000);
    this.polling = true; const epoch = this.epoch;
    try {
      for (let i = 0; i < maxPolls && epoch === this.epoch && this.unresolved; i++) {
        await this.poll();
        if (i + 1 < maxPolls && epoch === this.epoch && this.unresolved) await new Promise<void>(resolve => {
          const timer = setTimeout(done, intervalMs); const self = this;
          function done() { clearTimeout(timer); self.wake = null; resolve(); }
          this.wake = done;
        });
      }
    } finally { this.polling = false; }
  }
  private async exchange(command: Command, op: Operation, epoch: number, pending?: Pending): Promise<Result | null> {
    need(this.transport); const transport = this.transport;
    const raw = request(command, op); const abort = new AbortController(); this.active = abort;
    this.waiting = true; this.result = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const stopped = new Promise<never>((_, reject) => {
        abort.signal.addEventListener('abort', () => reject(new Error('Maintenance wait ended')), { once: true });
        timer = setTimeout(() => abort.abort(), this.timeoutMs);
      });
      const result = decode(await Promise.race([stopped, Promise.resolve().then(() => {
        if (abort.signal.aborted) throw new Error('Maintenance wait ended');
        return transport(command, raw, abort.signal);
      })]));
      correlate(result, op);
      // A settled response may win the race before retirement queues its abort
      // rejection. Fence retained-operation mutations as well as repaint.
      if (epoch !== this.epoch || this.active !== abort || abort.signal.aborted ||
          (pending && this.unresolved !== pending)) return null;
      if (pending && result.ok && result.status) {
        need(!pending.last?.status || result.status.sequence >= pending.last.status.sequence);
        pending.last = result;
        // An apply refusal without status is not proof of no activation. Keep
        // unknowns and recovery-needed fenced for owner reconciliation.
        if (terminal(result.status) && !result.status.recoveryNeeded && this.unresolved === pending) this.unresolved = null;
      }
      this.result = result;
      return result;
    } catch {
      if (epoch === this.epoch && this.active === abort) this.result = null;
      return null;
    } finally {
      clearTimeout(timer); abort.abort();
      if (this.active === abort) {
        this.active = null;
        if (epoch === this.epoch) this.waiting = false;
      }
    }
  }
}

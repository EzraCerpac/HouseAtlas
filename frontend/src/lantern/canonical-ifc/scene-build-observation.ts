/** Opt-in wall-clock observations only. Never schedules, draws or waits for GPU work. */
export const BUILD_PHASES = ['module-import', 'adapter-and-renderer-construction', 'renderer-init', 'scene-graph',
  'geometry-material-assembly', 'effect-graph', 'direct-preparation', 'lighting-preparation',
  'contact-target-preparation', 'effect-preparation'] as const;
export type BuildPhase = typeof BUILD_PHASES[number];
interface Phase {
  wallMs: number; waitMs: number; compileCalls: number; compileWallMs: number; creationRequests: number;
}
export interface SceneBuildSnapshot {
  readonly phases: readonly Readonly<{ name: BuildPhase; wallMs: number; waitMs: number;
    compileCalls: number | null; compileWallMs: number | null; creationRequests: number | null }>[];
  readonly buildWallMs: number | null;
  readonly firstDrawCpuMs: number | null;
  readonly firstDrawCreationRequests: number | null;
  readonly compileCounter: 'observed' | 'unavailable' | 'incomplete';
  readonly creationCounter: 'observed' | 'unavailable' | 'incomplete';
}
/** This intentionally measures backend creation REQUESTS, not completed native GPU pipelines.
 * Compile calls can hit caches; a call with no observed creation is not labelled a cache hit.
 * Unsupported shapes are unavailable, never zero. Original returns/errors are untouched. */
export class SceneBuildObservation {
  private readonly start: number;
  private at: number;
  private active: BuildPhase | null = null;
  private readonly phases = new Map<BuildPhase, Phase>(BUILD_PHASES.map(name => [name,
    { wallMs: 0, waitMs: 0, compileCalls: 0, compileWallMs: 0, creationRequests: 0 }]));
  private buildWallMs: number | null = null;
  private firstDrawCpuMs: number | null = null;
  private firstDrawCreationRequests: number | null = null;
  private requests = 0;
  private compileCounter: SceneBuildSnapshot['compileCounter'] = 'unavailable';
  private creationCounter: SceneBuildSnapshot['creationCounter'] = 'unavailable';
  private restores: (() => void)[] = [];
  private closed = false;

  constructor(private readonly now: () => number = () => performance.now()) {
    this.start = this.at = now();
  }
  phase(name: BuildPhase): void {
    if (this.closed || this.buildWallMs !== null) return;
    const at = this.now();
    if (this.active) this.phases.get(this.active)!.wallMs += Math.max(0, at - this.at);
    this.active = name; this.at = at;
  }
  /** Wait time is a SUBSET of the phase's wall time, not an additional cost. */
  wait(): () => void {
    const row = this.active && this.phases.get(this.active), start = this.now();
    return () => { if (row && !this.closed) row.waitMs += Math.max(0, this.now() - start); };
  }
  /** Attach only to the unpublished, owned renderer. No global/prototype hooks. */
  watch(renderer: object): void {
    if (this.closed || this.restores.length) return;
    const install = (owner: object, key: string, wrap: (original: (...args: unknown[]) => unknown) => (...args: unknown[]) => unknown,
      kind: 'compileCounter' | 'creationCounter') => {
      try {
        const descriptor = Object.getOwnPropertyDescriptor(owner, key);
        if (descriptor && (!descriptor.configurable || !('value' in descriptor))) return;
        const original: unknown = Reflect.get(owner, key);
        if (typeof original !== 'function') return;
        const wrapped = wrap(original as (...args: unknown[]) => unknown);
        Object.defineProperty(owner, key, descriptor ? { ...descriptor, value: wrapped }
          : { configurable: true, writable: true, value: wrapped });
        this[kind] = 'observed';
        this.restores.push(() => {
          try {
            if (Object.getOwnPropertyDescriptor(owner, key)?.value !== wrapped) { this[kind] = 'incomplete'; return; }
            if (descriptor) Object.defineProperty(owner, key, descriptor); else Reflect.deleteProperty(owner, key);
          } catch { this[kind] = 'incomplete'; }
        });
      } catch { /* A diagnostic cannot make a supported renderer fail. */ }
    };
    const observer = this;
    install(renderer, 'compileAsync', original => function(this: unknown, ...args: unknown[]) {
      if (observer.closed) return Reflect.apply(original, this, args);
      const row = observer.active && observer.phases.get(observer.active), start = observer.now();
      if (row) row.compileCalls++;
      const finish = () => {
        try { if (row && !observer.closed) row.compileWallMs += Math.max(0, observer.now() - start); }
        catch { observer.compileCounter = 'incomplete'; }
      };
      try {
        const result = Reflect.apply(original, this, args);
        // Three's method is async. Preserve its ORIGINAL promise identity and rejection.
        // Both observer continuations consume their own outcome, never change the caller's.
        if (result instanceof Promise) void result.then(finish, finish);
        else { observer.compileCounter = 'incomplete'; finish(); }
        return result;
      } catch (error) { finish(); throw error; }
    }, 'compileCounter');
    try {
      const backend: unknown = Reflect.get(renderer, 'backend');
      if (backend && typeof backend === 'object') install(backend, 'createRenderPipeline', original =>
        function(this: unknown, ...args: unknown[]) {
          if (observer.closed) return Reflect.apply(original, this, args);
          observer.requests++;
          if (observer.active) observer.phases.get(observer.active)!.creationRequests++;
          return Reflect.apply(original, this, args);
        }, 'creationCounter');
    } catch { /* Unsupported instrumentation is explicitly unavailable. */ }
  }
  finishBuild(): void {
    if (this.closed || this.buildWallMs !== null) return;
    const at = this.now();
    if (this.active) this.phases.get(this.active)!.wallMs += Math.max(0, at - this.at);
    this.active = null; this.buildWallMs = Math.max(0, at - this.start);
  }
  /** Called around the first actual successful render call, not hidden readiness.
   * Its CPU duration is NOT GPU completion, browser paint or physical visibility. */
  firstDraw(): (() => void) | undefined {
    if (this.closed || this.firstDrawCpuMs !== null) return;
    const at = this.now(), before = this.requests;
    return () => {
      if (this.closed || this.firstDrawCpuMs !== null) return;
      this.firstDrawCpuMs = Math.max(0, this.now() - at);
      if (this.creationCounter === 'observed') this.firstDrawCreationRequests = this.requests - before;
      this.close();
    };
  }
  close(): void {
    if (this.closed) return;
    for (const restore of this.restores.reverse()) restore();
    this.restores = []; this.closed = true;
  }
  snapshot(): SceneBuildSnapshot {
    return { phases: BUILD_PHASES.map(name => {
      const row = this.phases.get(name)!;
      return { name, wallMs: row.wallMs, waitMs: row.waitMs,
        compileCalls: this.compileCounter === 'observed' ? row.compileCalls : null,
        compileWallMs: this.compileCounter === 'observed' ? row.compileWallMs : null,
        creationRequests: this.creationCounter === 'observed' ? row.creationRequests : null };
    }), buildWallMs: this.buildWallMs, firstDrawCpuMs: this.firstDrawCpuMs,
      firstDrawCreationRequests: this.creationCounter === 'observed' ? this.firstDrawCreationRequests : null,
      compileCounter: this.compileCounter, creationCounter: this.creationCounter };
  }
}

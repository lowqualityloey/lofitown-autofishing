// Shared JSDoc / TypeScript contracts for lofitown-autofishing (dev-only; never shipped).

interface Rect {
    x: number;
    y: number;
    w: number;
    h: number;
  }

  interface Point {
    x: number;
    y: number;
  }

  interface Size {
    w: number;
    h: number;
  }

  type PlaceResult = Rect | 'pill';

  interface PlaceOpts {
    panel: Size;
    viewport: Size;
    margin?: number;
    topInset?: number;
    exclude?: Rect | null;
    preferred?: Point | null;
  }

  type SessionPhase = 'idle' | 'running' | 'paused' | 'waiting' | 'cooldown';

  type SessionMode = 'flow' | 'timed';

  type PauseReason =
    | 'user'
    | 'hidden'
    | 'seat'
    | 'focus'
    | 'no-catch'
    | 'cast-stall'
    | 'player-block'
    | 'profile-open'
    | 'result-missing';

  type StopReason =
    | PauseReason
    | 'duration'
    | 'daily-cap'
    | 'window'
    | 'errors'
    | 'no-seat'
    | 'core-crash';

  interface ScheduleWindow {
    on: boolean;
    start: string;
    stop: string;
  }

  interface SessionState {
    mode: SessionMode;
    phase: SessionPhase;
    durationMs: number;
    cooldownMs: number;
    dailyCapMs: number;
    hiddenStopMs: number;
    chain: boolean;
    window: ScheduleWindow;
    fishingMs: number;
    todayMs: number;
    carriedMs: number;
    dayStartMs: number;
    startedAt: number | null;
    lastTickAt: number | null;
    pauseReason: PauseReason | null;
    pausedAt: number | null;
    hiddenSince: number | null;
    visibleSince: number | null;
    seatSince?: number | null;
    retryAt: number | null;
    retries: number;
    seatOverrideUntil: number | null;
    cooldownUntil: number | null;
    lastCatchAt: number | null;
    catchCount: number;
    errWindowAt: number | null;
    errCount: number;
    errTotal: number;
    stopReason: string | null;
    stalled: boolean;
    blindPauseMs: number;
    blindPauseAt: number | null;
    blindBubbleMs: number | null;
    blindDialMs: number | null;
    blindHiddenPause: boolean;
  }

  interface SessionConfigPatch {
    mode?: SessionMode;
    durationMs?: number;
    cooldownMs?: number;
    dailyCapMs?: number;
    hiddenStopMs?: number;
    chain?: boolean;
    window?: Partial<ScheduleWindow>;
    todayMs?: number;
    cooldownUntil?: number | null;
    phase?: SessionPhase;
  }

  type SessionFact =
    | { type: 'config'; at?: number; patch?: SessionConfigPatch }
    | { type: 'start'; at?: number }
    | { type: 'stop'; at?: number; reason?: string; diag?: Record<string, unknown> | null }
    | { type: 'pause'; at?: number; reason?: 'focus' | 'user' }
    | { type: 'resume'; at?: number }
    | { type: 'skip-cooldown'; at?: number }
    | { type: 'hidden-start'; at?: number }
    | { type: 'hidden-return'; at?: number; hiddenMs?: number }
    | {
        type: 'tick';
        at?: number;
        visible?: boolean;
        catches?: number;
        errors?: number;
        todayMs?: number;
        seat?: boolean;
        resultMissing?: boolean;
        stalled?: boolean;
        sinceBubbleMs?: number | null;
        sinceDialMs?: number | null;
        playerBlocked?: boolean;
        profileOpen?: boolean;
        focus?: boolean;
      };

  type SessionAction =
    | { type: 'startCore'; maxMinutes: number }
    | { type: 'stopCore' }
    | { type: 'pauseCore' }
    | { type: 'resumeCore' }
    | { type: 'holdCasts'; on: boolean }
    | { type: 'wakeLock' }
    | { type: 'releaseWakeLock' }
    | { type: 'persist' }
    | {
        type: 'sessionRow';
        reason: string;
        minutes: number;
        catches: number;
        diag: Record<string, unknown> | null;
      }
    | { type: 'refuse'; reason: 'cooldown' | 'daily-cap' | 'window' | 'result-missing' };

  interface ReduceResult {
    state: SessionState;
    actions: SessionAction[];
  }

  interface ReviveGateResult {
    allow: boolean;
    times: number[];
  }

  interface BlindFacts {
    phase: SessionPhase | null;
    pauseReason: PauseReason | null;
    running: boolean;
    stalled: boolean;
    visible: boolean;
    sinceBubbleMs: number | null;
    sinceDialMs: number | null;
    startedAt: number | null;
    runAgeMs: number | null;
    pauseMs: number;
    now: number;
  }

  interface CoreStatusLike {
    running?: boolean;
  }

  interface AutoFishLayoutApi {
    MARGIN: number;
    inflate(rect: Rect | null | undefined, by: number): Rect | null;
    intersects(a: Rect | null | undefined, b: Rect | null | undefined): boolean;
    unionRect(rects: Array<Rect | null | undefined>): Rect | null;
    place(opts: PlaceOpts): PlaceResult;
  }

  interface AutoFishSessionApi {
    DEFAULTS: {
      mode: SessionMode;
      durationMs: number;
      cooldownMs: number;
      dailyCapMs: number;
      hiddenStopMs: number;
      chain: boolean;
      window: ScheduleWindow;
    };
    createState(overrides?: Partial<SessionState>): SessionState;
    reduce(state: SessionState, fact: SessionFact): ReduceResult;
    withinWindow(win: ScheduleWindow | null | undefined, at: number): boolean;
    parseClock(hhmm: string): number;
    coreGuard(state: SessionState | null | undefined, status: CoreStatusLike | null | undefined): 'revive' | null;
    reviveGate(times: number[] | null | undefined, now: number): ReviveGateResult;
    reloadGate(times: number[] | null | undefined, now: number): ReviveGateResult;
    blindSilence(s: BlindFacts | null | undefined): number | null;
    blindWarning(s: BlindFacts | null | undefined): number | null;
    clearBlindPause(s: SessionState): SessionState;
  }

  interface FishRow {
    t: number;
    species: string;
    rarity: string;
    raritySource?: 'card' | 'catalogue';
    shiny: boolean;
    golden?: boolean;
    profile?: string;
    quality?: string;
    weight?: string;
    value?: string;
    [key: string]: any;
  }

  interface FishStatus {
    running: boolean;
    paused: boolean;
    stalled: boolean;
    postRender?: boolean;
    lastTickAgoMs?: number | null;
    runAgeMs: number | null;
    catchCount: number;
    hidden?: boolean;
    geo: { cx: number; cy: number; R: number; width?: number } | null;
    hint?: Point | null;
    pxScale?: number | null;
    needsSeat: boolean;
    resultMissing: boolean;
    resultMissingAt?: number | null;
    resultMissingAttempt?: number | null;
    playerBlocked: boolean;
    profileOpen: boolean;
    lastDialCause?: unknown;
    lastAttemptLoss?: unknown;
    sinceBubbleMs: number | null;
    sinceDialMs: number | null;
    stats: Record<string, any>;
    accuracy?: Record<string, any>;
    pressesThisDial?: number;
    pendingMs?: number | null;
    ledger?: { total: number; species: number; shiny: number };
    logTail?: unknown[];
    [key: string]: any;
  }

  interface FishStartOpts {
    maxMinutes?: number;
    logUrl?: string | null;
    fastFirstPress?: boolean;
    [key: string]: unknown;
  }

  interface FishApi {
    version: string;
    start(opts?: FishStartOpts): unknown;
    stop(): unknown;
    pause(): unknown;
    resume(): unknown;
    holdCasts(on?: boolean): boolean;
    status(): FishStatus;
    doctor(): { verdict?: string; ok?: boolean; severity?: string; issue?: string; fix?: string; action?: string; [key: string]: unknown };
    accuracy(): Record<string, unknown>;
    perf(): Record<string, any>;
    log(n?: number): { entries?: unknown[]; unknown?: unknown[]; profile?: string; [key: string]: unknown };
    logCsv?(): string;
    logProfile(name?: string): string;
    logProfiles?(): string[];
    logReset?(): void;
    calibration?(): unknown;
    zones?(): { bubble?: Rect | null; dial?: Rect | null; card?: Rect | null; hintZone?: Rect | null; [key: string]: unknown };
    captureUI?(): void;
    _shot?: string | null;
    stats?: Record<string, any>;
    setPromptMask(opts?: unknown): unknown;
    tune(opts?: unknown): unknown;
    exportRun(opts?: { reset?: boolean }): string;
    exportDiag?(): Record<string, unknown>;
    exportMissions?(): Record<string, unknown> | null;
    pressElement?(el: Element | null): boolean;
    exportClaimState?(): Record<string, unknown> | null;
    [key: string]: any;
  }

  interface OvernightStatus {
    stopped: boolean;
    posts: number;
    last: { at: string; reason: string; attempts: number; file: unknown } | null;
    lastError: string | null;
  }

  interface OvernightApi {
    now(): Promise<unknown>;
    stop(): void;
    status(): OvernightStatus;
  }

  interface PanelApi {
    mounted?: boolean;
    mountError?: string;
    state?: (() => SessionState | null) | SessionState | null;
    resumeAfterReload?: boolean;
    localCapture?: boolean;
    postCatches?: boolean;
    hideUpsell?: boolean;
    focusMode?: boolean;
    rareChime?: boolean;
    fastFirstPress?: boolean;
    overnight?: boolean;
    dispatch?(fact: SessionFact): ReduceResult;
    unmount?(): void;
    focus?(on?: boolean): unknown;
    setFocusMode?(on?: boolean): unknown;
    setFastFirstPress?(on?: boolean): unknown;
    armOvernight?(on?: boolean): unknown;
    captureDiag?(note?: string): void;
    guard?(): unknown;
    [key: string]: unknown;
  }

  type DialVerdict = 'hit' | 'miss' | 'ghost' | 'skipped' | 'stalled' | 'no-press';

  interface GeoLock {
    cx: number;
    cy: number;
    R: number;
    width?: number;
    t?: number;
    [key: string]: any;
  }

  interface DialSample {
    t: number;
    mid: number;
    width?: number;
    [key: string]: any;
  }

  interface PlanResult {
    fire: boolean;
    delayMs?: number;
    triggerAt?: number;
    why?: string;
    [key: string]: any;
  }

  interface BubbleHit {
    x: number;
    y: number;
    w: number;
    h: number;
    [key: string]: any;
  }

  interface CatchCard {
    species: string;
    rarity?: string;
    quality?: string;
    weight?: string;
    value?: string | number;
    derived?: boolean;
    [key: string]: any;
  }

  interface DoctorVerdict {
    verdict: string;
    severity: 'none' | 'low' | 'medium' | 'high' | string;
    action?: string;
    ok?: boolean;
    [key: string]: any;
  }

  interface FishOpts {
    maxMinutes?: number;
    logUrl?: string | null;
    fastFirstPress?: boolean;
    press?: boolean;
    pressWith?: string;
    hitMs?: number;
    skipMs?: number;
    ghostCooldownMs?: number;
    seatHoldRetryMs?: number;
    castRetryMs?: number;
    seatWatchdogMs?: number;
    [key: string]: any;
  }

  interface AttemptRecord {
    n: number;
    startedAt: number;
    touched: number;
    presses: number;
    dials: number;
    skipped: number;
    maxOmega: number;
    pressAccepted: number;
    pressRejected: number;
    dialHits: number;
    dialMisses: number;
    widthSum: number;
    widthN: number;
    maxWidth: number;
    minWidth: number;
    arm: string | null;
    armCfg: Record<string, any> | null;
    verdict?: string;
    why?: string | null;
    ms?: number;
    avgWidth?: number | null;
    widthBand?: string | null;
    pressHitRate?: number | null;
    dialHitRate?: number | null;
    [key: string]: any;
  }

  interface FishPerf {
    gaps: number[];
    n: number;
    last: number;
    startedAt: number;
    stoppedAt: number;
    snap: number;
    snapN: number;
    bubble: number;
    bubbleN: number;
    lock: number;
    lockN: number;
    sample: number;
    sampleN: number;
    card: number;
    cardN: number;
    readN: number;
    readGL: number;
    read2d: number;
    readMB: number;
    allocMB: number;
    snapGL: number;
    snap2d: number;
    ltN: number;
    ltMax: number;
    ltRing: Array<{ t: number; ms: number }>;
    lockMemo: number;
    lockMemoN: number;
    lockMemoSkipped: number;
    lockMemoCold: number;
    lockGrab: number;
    lockMask: number;
    lockScan: number;
    lockRefine: number;
    [key: string]: any;
  }

  type FishCore = {
    version: string;
    [key: string]: any;
  };

  interface LoopIo {
    isVisible(): boolean;
    now(): number;
    stop(): void;
    findCatch(): any;
    findBubble(): any;
    sample(geo: GeoLock): any;
    lockDial(hx: number, hy: number, span?: number): GeoLock | null;
    dialAnywhere(t: number): GeoLock | null;
    recordCatch(card: any): string;
    captureTextCursor(): void;
    tap(x: number, y: number): boolean;
    space(target?: any): boolean;
    clearPendingWin(): void;
    startAttempt(t: number): any;
    resolveAttempt(verdict: string, t: number, why?: string | null): any;
    sameDial(a: any, b: any): boolean;
    saveDialMemory(g: GeoLock): boolean;
    tryEscapeProfile(t: number): void;
    log(msg: string, extra?: Record<string, any>): void;
    noteBubbleTap?(t: number): void;
    bubbleConfirmed?(b: any, t: number): boolean;
    clearResultMissing?(why: string): void;
    markResultMissing?(t: number, why: string): void;
    markShapeHit?(t: number): void;
    setTimeout?(fn: () => void, ms: number): any;
    clearTimeout?(id: any): void;
  }

  interface AutoFishLoopApi {
    DIAL_COUNTER: Record<DialVerdict, string>;
    refreshLossDiagnostic(attempt: any, b: any, t: number, prev: any, cardPending: boolean): any;
    cancelPend(F: FishCore, io?: Partial<LoopIo>): void;
    doPress(F: FishCore, s: any, how: string, t: number, io?: Partial<LoopIo>): void;
    closeDial(F: FishCore, t: number, ring?: any, io?: Partial<LoopIo>): void;
    stepFrame(F: FishCore, t: number, io?: Partial<LoopIo>): void;
    [key: string]: any;
  }

  interface Window {
    AutoFishLayout?: AutoFishLayoutApi;
    AutoFishSession?: AutoFishSessionApi;
    AutoFishTiming?: Record<string, any>;
    AutoFishVision?: Record<string, any>;
    AutoFishLedger?: Record<string, any>;
    AutoFishMissions?: Record<string, any>;
    AutoFishDiagnostics?: Record<string, any>;
    AutoFishLoop?: AutoFishLoopApi;
    __fish?: FishApi | FishCore | null;
    __panel?: PanelApi | null;
    __overnight?: OvernightApi | null;
    __overnightBase?: string;
    __overnightPort?: number;
    __PIXI_DEVTOOLS__?: any;
    __txtBuf?: any[];
    __txtHook?: boolean;
  }

  var Buffer: any;
  declare var module: { exports: any };
  declare var __dirname: string;
  declare var __filename: string;
  declare var require: {
    (id: string): any;
    main?: unknown;
  };
  declare var process: {
    argv: string[];
    env: Record<string, string | undefined>;
    exitCode?: number;
    cwd(): string;
    exit(code?: number): never;
    stdout: { write(chunk: string): boolean };
    stderr: { write(chunk: string): boolean };
    on(event: string, listener: (...args: any[]) => void): any;
  };

declare module 'fs' { const x: any; export = x; }
declare module 'node:fs' { const x: any; export = x; }
declare module 'path' { const x: any; export = x; }
declare module 'node:path' { const x: any; export = x; }
declare module 'http' { const x: any; export = x; }
declare module 'os' { const x: any; export = x; }
declare module 'crypto' { const x: any; export = x; }
declare module 'child_process' {
  export const execFileSync: any;
  export const spawnSync: any;
  const x: any;
  export default x;
}

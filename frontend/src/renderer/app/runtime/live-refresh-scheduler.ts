import { APP_LIVE_REFRESH_INTERVAL_MS } from "@/app/runtime/live-refresh-constants";

type LiveRefreshSchedulerFlush<TKey extends string, TPayload> = (
  batches: ReadonlyMap<TKey, readonly TPayload[]>,
) => void;

type LiveRefreshSchedulerOptions<TKey extends string, TPayload> = {
  intervalMs?: number;
  onFlush: LiveRefreshSchedulerFlush<TKey, TPayload>;
};

export class LiveRefreshScheduler<TKey extends string, TPayload> {
  private readonly interval_ms: number;
  private readonly on_flush: LiveRefreshSchedulerFlush<TKey, TPayload>;
  private readonly pending_payloads = new Map<TKey, TPayload[]>();
  private timer_id: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(options: LiveRefreshSchedulerOptions<TKey, TPayload>) {
    this.interval_ms = options.intervalMs ?? APP_LIVE_REFRESH_INTERVAL_MS;
    this.on_flush = options.onFlush;
  }

  enqueue(key: TKey, payload: TPayload): void {
    if (this.disposed) {
      return;
    }

    const payloads = this.pending_payloads.get(key) ?? [];
    payloads.push(payload);
    this.pending_payloads.set(key, payloads);

    if (this.timer_id !== null) {
      return;
    }

    this.timer_id = setTimeout(() => {
      this.flush();
    }, this.interval_ms);
  }

  flush(): void {
    if (this.timer_id !== null) {
      clearTimeout(this.timer_id);
      this.timer_id = null;
    }

    if (this.pending_payloads.size === 0 || this.disposed) {
      return;
    }

    const batches = new Map<TKey, readonly TPayload[]>();
    for (const [key, payloads] of this.pending_payloads.entries()) {
      batches.set(key, [...payloads]);
    }
    this.pending_payloads.clear();
    this.on_flush(batches);
  }

  dispose(): void {
    if (this.timer_id !== null) {
      clearTimeout(this.timer_id);
      this.timer_id = null;
    }

    this.pending_payloads.clear();
    this.disposed = true;
  }
}

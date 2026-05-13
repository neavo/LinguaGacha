export const LOG_APPEND_BATCH_INTERVAL_MS = 250; // 日志渲染 append batch 固定为每秒 4 帧

type LogAppendBufferOptions<TEvent> = {
  intervalMs?: number;
  onFlush: (events: TEvent[]) => void;
};

/**
 * 日志窗口私有 append buffer，只负责降低 append-only 渲染频率
 */
export class LogAppendBuffer<TEvent> {
  private readonly interval_ms: number; // interval_ms 固定表达日志渲染批次窗口，不参与任务或项目事实同步

  private readonly on_flush: (events: TEvent[]) => void; // on_flush 是页面 setState 的唯一回调

  private readonly events: TEvent[] = []; // events 保存当前窗口内收到的日志事件

  private timer: ReturnType<typeof setTimeout> | null = null; // timer 只在存在待刷日志时存活

  /**
   * 注入日志批处理窗口，默认保持每秒 4 帧
   */
  public constructor(options: LogAppendBufferOptions<TEvent>) {
    this.interval_ms = options.intervalMs ?? LOG_APPEND_BATCH_INTERVAL_MS;
    this.on_flush = options.onFlush;
  }

  /**
   * 追加日志事件；首个事件启动下一次 flush 计时
   */
  public append(event: TEvent): void {
    this.events.push(event);
    if (this.timer !== null) {
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, this.interval_ms);
  }

  /**
   * 立即刷出当前窗口内的日志事件
   */
  public flush(): void {
    if (this.events.length === 0) {
      return;
    }
    const events = this.events.splice(0, this.events.length);
    this.on_flush(events);
  }

  /**
   * 页面卸载时清理 timer 并刷出最后一批日志
   */
  public dispose(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.flush();
  }
}

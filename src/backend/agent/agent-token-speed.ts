import { count_text_tokens } from "../llm/token-counter";

const WINDOW_MS = 1000;
const MIN_SPAN_MS = 100;
type TokenSample = { start: number; end: number; tokens: number };

/** 同批增量按内容块合并后估算，真实 `usage.output` 校准回合平均。 */
export class AgentTokenSpeed {
  private samples: TokenSample[] = []; // 最近窗口内的分批计数
  private pending = new Map<number, string[]>(); // `contentIndex` 在单个模型响应内标识正文、思考或工具参数块
  private response_start: number | null = null; // 首个有效增量时刻
  private counted_at = 0; // 上一批结束时刻，包含两批间的输出停顿
  private response_tokens = 0;
  private total_tokens = 0;
  private total_ms = 0; // 仅累计模型生成时间，排除工具和首段等待

  /** 新回合清除响应采样与累计统计。 */
  public reset(): void {
    this.clear_response();
    this.total_tokens = 0;
    this.total_ms = 0;
  }

  /** 累积同一内容块的增量，分词延迟到更新或结算时执行。 */
  public record(delta: string, content_index: number, now: number): void {
    if (delta === "") return;
    if (this.response_start === null) {
      this.response_start = now;
      this.counted_at = now;
    }
    const chunks = this.pending.get(content_index);
    if (chunks === undefined) this.pending.set(content_index, [delta]);
    else chunks.push(delta);
  }

  /** 由服务的同一个更新节奏触发分词和显示，停顿期间不主动计算。 */
  public measure(now: number): number | null {
    this.flush(now);
    this.samples = this.samples.filter((sample) => sample.end >= now - WINDOW_MS);
    const first = this.samples[0];
    if (first === undefined) return null;
    const tokens = this.samples.reduce((total, sample) => total + sample.tokens, 0);
    return (tokens * 1000) / Math.max(now - first.start, MIN_SPAN_MS);
  }

  /** 每次模型响应独立结算，工具执行和下一次首段输出前的等待自然排除。 */
  public finish_response(now: number, output_tokens?: number): void {
    this.flush(now);
    if (this.response_start !== null) {
      this.total_ms += now - this.response_start;
      // SDK 未取得 usage 时初始化为零，不能用它覆盖已经观察到的输出。
      this.total_tokens +=
        output_tokens !== undefined && Number.isFinite(output_tokens) && output_tokens > 0
          ? output_tokens
          : this.response_tokens;
    }
    this.clear_response();
  }

  /** 停止时先结算开放响应，保留累计值供失败后的 `continue` 复用。 */
  public finish_round(now: number): number | null {
    this.finish_response(now);
    return this.total_ms > 0 ? (this.total_tokens * 1000) / this.total_ms : null;
  }

  /** 更新时刻即末次增量时刻，终态生成的窗口随后随响应清理。 */
  private flush(now: number): void {
    if (this.pending.size === 0) return;
    let tokens = 0;
    for (const chunks of this.pending.values()) tokens += count_text_tokens(chunks.join(""));
    // 批次包含此前采样点到本次更新的间隔，防止集中发布制造速度尖峰。
    this.samples.push({ start: this.counted_at, end: now, tokens });
    this.response_tokens += tokens;
    this.counted_at = now;
    this.pending.clear();
  }

  /** 响应边界只清除局部数据，回合累计留给最终平均值。 */
  private clear_response(): void {
    this.samples = [];
    this.pending.clear();
    this.response_start = null;
    this.response_tokens = 0;
  }
}

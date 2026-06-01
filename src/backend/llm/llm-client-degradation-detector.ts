const STREAM_DEGRADATION_REPEAT_THRESHOLD = 50; // 退化阈值沿用既有 LLM 请求策略，保证任务重试语义不因迁移变松
const STREAM_DEGRADATION_FALLBACK_WINDOW_CHARS = 512;

/**
 * 请求客户端响应退化检测器，识别单字符、双字符和三字符周期性重复输出。
 */
export class LLMClientDegradationDetector {
  private last_char: string | null = null; // 三元窗口必须跨 delta 记忆，否则流式切片会漏判边界重复
  private second_last_char: string | null = null;
  private third_last_char: string | null = null;
  private single_run = 0; // 统计同字符连续重复，是最直接的退化形态
  private alternating_run = 0; // 统计 ABAB 周期次数，char_run 先保留字符级长度便于跨 delta 延续
  private alternating_char_run = 0;
  private period_3_run = 0; // 统计 ABCABC 周期次数，覆盖三字符循环输出
  private period_3_char_run = 0;

  /**
   * 喂入一段增量文本；一旦检测到退化立即返回 true
   */
  public feed(text: string): boolean {
    for (const ch of text) {
      if (/\s/u.test(ch)) {
        continue;
      }

      if (this.last_char === null) {
        this.last_char = ch;
        this.single_run = 1;
        this.alternating_char_run = 1;
        this.alternating_run = 0;
        this.period_3_char_run = 1;
        this.period_3_run = 0;
        continue;
      }

      this.single_run = ch === this.last_char ? this.single_run + 1 : 1;
      if (this.single_run >= STREAM_DEGRADATION_REPEAT_THRESHOLD) {
        return true;
      }

      if (
        this.second_last_char !== null &&
        ch === this.second_last_char &&
        this.second_last_char !== this.last_char
      ) {
        this.alternating_char_run += 1;
      } else {
        this.alternating_char_run = ch !== this.last_char ? 2 : 1;
      }
      this.alternating_run = Math.trunc(this.alternating_char_run / 2);
      if (this.alternating_run >= STREAM_DEGRADATION_REPEAT_THRESHOLD) {
        return true;
      }

      if (
        this.third_last_char !== null &&
        this.second_last_char !== null &&
        ch === this.third_last_char &&
        this.third_last_char !== this.second_last_char &&
        this.second_last_char !== this.last_char &&
        this.third_last_char !== this.last_char
      ) {
        this.period_3_char_run += 1;
      } else if (
        this.second_last_char !== null &&
        ch !== this.last_char &&
        ch !== this.second_last_char &&
        this.last_char !== this.second_last_char
      ) {
        this.period_3_char_run = 3;
      } else {
        this.period_3_char_run = 1;
      }
      this.period_3_run = Math.trunc(this.period_3_char_run / 3);
      if (this.period_3_run >= STREAM_DEGRADATION_REPEAT_THRESHOLD) {
        return true;
      }

      this.third_last_char = this.second_last_char;
      this.second_last_char = this.last_char;
      this.last_char = ch;
    }
    return false;
  }

  /**
   * 最终兜底只看尾部窗口，避免长响应末端退化被流式切片漏过
   */
  public static has_output_degradation(text: string): boolean {
    if (text === "") {
      return false;
    }
    const detector = new LLMClientDegradationDetector();
    return detector.feed(text.slice(-STREAM_DEGRADATION_FALLBACK_WINDOW_CHARS));
  }
}

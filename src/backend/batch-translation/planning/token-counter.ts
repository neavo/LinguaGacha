import { count_text_tokens } from "../../llm/token-counter";
import { setMergeCacheSize } from "gpt-tokenizer/encoding/o200k_base";

// 每个 worker 独占模块实例和 BPE 缓存；整条文本的结果由父线程缓存。
const TOKEN_MERGE_CACHE_CAPACITY = 8192;
const TOKEN_COUNT_TIME_SLICE_MS = 8;
setMergeCacheSize(TOKEN_MERGE_CACHE_CAPACITY);

/** 线程和显式同进程执行共用计数循环；条目保持完整，时间片之间响应取消。 */
export async function count_token_batch(
  texts: readonly string[],
  signal: AbortSignal,
): Promise<number[]> {
  const counts: number[] = [];
  let deadline = performance.now() + TOKEN_COUNT_TIME_SLICE_MS;
  for (const text of texts) {
    signal.throwIfAborted();
    counts.push(count_text_tokens(text));
    if (performance.now() >= deadline) {
      await new Promise<void>((resolve) => setImmediate(resolve));
      deadline = performance.now() + TOKEN_COUNT_TIME_SLICE_MS;
    }
  }
  signal.throwIfAborted();
  return counts;
}

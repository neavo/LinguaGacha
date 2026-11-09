import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import path from "node:path";
import { npm } from "@lg/npm";

const SAMPLE_RATE = 16000; // TEN-VAD 与 SenseVoice 的输入采样率。
const VAD_FRAME = 256; // TEN-VAD 的帧长。sherpa 每次调用只合并判断一次，必须逐帧送入。
const VAD_BUFFER_SECONDS = 90; // 须大于 maxSpeechDuration。
// 参数按加权错误（插入计两倍）在英日样本上选定，调整后需重新评估。
const VAD = Object.freeze({
  threshold: 0.3,
  minSilenceDuration: 0.1,
  minSpeechDuration: 0.1,
  windowSize: VAD_FRAME,
  maxSpeechDuration: 60,
});
const ASR_WINDOW_SECONDS = 20; // 实测 60 秒整窗明显掉字，20 秒内基本完整。
const ASR_THREADS = 4; // 每个识别窗口的原生线程数。
const ASR_CONCURRENCY = 2; // 同时持有原生流的窗口上限。与画面检测（2×4）各占一半 CPU，两者可以同时运行。
const PUNCTUATION = /[\s\p{P}]/gu; // 只含标点的识别结果没有台词。

// 句级条目的显示限制。时间超限或字数超限的句子按 token 边界均衡拆开。
const CUE_SECONDS = 7;
const DENSE_CHARS = 30; // 中日韩文字的单条字数上限。
const SPACED_CHARS = 84; // 以空格分词文字的单条字数上限。
const SHORT_SECONDS = 1; // 更短的片段并入相邻句，避免 `Mr.` 这类缩写单独闪烁。
const TAIL_SECONDS = 0.6; // token 只有起点，句尾最多延到末 token 起点后这么久。
const DENSE = /[\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}\p{sc=Hangul}]/u; // 按字计长的文字。
const UNSPACED = "\\p{sc=Han}\\p{sc=Hiragana}\\p{sc=Katakana}ー"; // 词间不用空格的文字，任意字间可切。
const UNSPACED_START = new RegExp(`^[${UNSPACED}]`, "u");
// SenseVoice 会在日文词间插入空格，至少一侧是这类文字时去掉。
const UNSPACED_GAP = new RegExp(
  `(?<=[${UNSPACED}、。，！？「」])\\s+(?=[${UNSPACED}\\d])|(?<=[${UNSPACED}\\d])\\s+(?=[${UNSPACED}])`,
  "gu",
);
const SENTENCE_END = /[.?!。？！…]$/u;
const CLAUSE_END = /[,，、;；:：]$/u;
const CLAUSE_PREFERENCE = 0.25; // 逗号边界相对均分目标的偏好权重。

/** 工程原文语言到 SenseVoice 语言的映射。有音轨的素材只支持这些语言，对白全部来自本地识别。 */
export const ASR_LANGUAGES = Object.freeze({
  ZH: "zh",
  EN: "en",
  JA: "ja",
  KO: "ko",
  ALL: "auto",
});

/** 共享 npm 工程固定为 userdata/node，模型放在同级的 userdata/models，所有工程共用。 */
export const MODELS_DIRECTORY = path.resolve(npm.directory, "..", "models");
// SenseVoiceSmall 来自阿里巴巴 FunASR，许可要求使用时注明来源与作者并保留模型名。
const SENSEVOICE =
  "https://huggingface.co/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/2365baeacb507f821a0c8120fcee3d484dba7a07";
/** 固定版本的模型。sherpa 加载缺失或损坏的模型时不一定报错，只能按哈希判断可用。 */
export const MODELS = Object.freeze({
  // TEN-VAD 来自 Agora，许可为 Apache 2.0 附加条件，只用于本应用及其直接用户。
  vad: Object.freeze({
    file: path.join(MODELS_DIRECTORY, "ten_vad", "ten-vad.onnx"),
    url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/ten-vad.onnx",
    sha256: "718cb7eef47e3cf5ddbe7e967a7503f46b8b469c0706872f494dfa921b486206",
  }),
  asr: Object.freeze({
    file: path.join(MODELS_DIRECTORY, "sensevoice", "2024-07-17", "model.int8.onnx"),
    url: `${SENSEVOICE}/model.int8.onnx`,
    sha256: "c71f0ce00bec95b07744e116345e33d8cbbe08cef896382cf907bf4b51a2cd51",
  }),
  tokens: Object.freeze({
    file: path.join(MODELS_DIRECTORY, "sensevoice", "2024-07-17", "tokens.txt"),
    url: `${SENSEVOICE}/tokens.txt`,
    sha256: "f449eb28dc567533d7fa59be34e2abca8784f771850c78a47fb731a31429a1dc",
  }),
});

const round = (value) => Number(value.toFixed(2)); // 区间时间统一保留两位小数。

/** 模型存在且与固定版本一致。 */
export async function ready(model) {
  const hash = createHash("sha256");
  try {
    for await (const chunk of createReadStream(model.file)) hash.update(chunk);
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
  return hash.digest("hex") === model.sha256;
}

/** 排序并合并相接或重叠的区间。 */
export function union(spans) {
  const result = [];
  for (const [start, end] of [...spans].sort((a, b) => a[0] - b[0])) {
    const last = result.at(-1);
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else result.push([start, end]);
  }
  return result;
}

/**
 * 消费 16 kHz 单声道 s16le 流，返回整片人声区间与本地识别的句级条目，单位为整片秒数。
 * 只识别人声区间：实测识别整条时间轴新增的误识别多于补回的漏句。
 * 语言须在 `ASR_LANGUAGES` 中，由调用者在解码前检查。
 */
export async function analyze(stream, source_language) {
  for (const model of Object.values(MODELS))
    if (!(await ready(model))) throw new Error("语音模型缺失或不一致，先按 media.missing() 补齐");
  const { default: sherpa } = await import("sherpa-onnx-node");
  const vad = new sherpa.Vad(
    {
      tenVad: { model: MODELS.vad.file, ...VAD },
      sampleRate: SAMPLE_RATE,
      numThreads: 1,
      provider: "cpu",
      debug: 0,
    },
    VAD_BUFFER_SECONDS,
  );
  const recognizer = new sherpa.OfflineRecognizer({
    featConfig: { sampleRate: SAMPLE_RATE, featureDim: 80 },
    modelConfig: {
      senseVoice: {
        model: MODELS.asr.file,
        language: ASR_LANGUAGES[source_language],
        useInverseTextNormalization: 1,
      },
      tokens: MODELS.tokens.file,
      numThreads: ASR_THREADS,
      provider: "cpu",
      debug: 0,
    },
    decodingMethod: "greedy_search",
  });
  return analyze_pcm(stream, vad, recognizer);
}

/** PCM 解帧保持采样顺序，未配对字节跨块保留。 */
async function* pcm_frames(stream) {
  let frame = new Float32Array(VAD_FRAME),
    filled = 0,
    low; // 未配对的低字节跨数据块保留。
  for await (const chunk of stream) {
    for (const byte of chunk) {
      if (low === undefined) {
        low = byte;
        continue;
      }
      frame[filled++] = (((byte << 24) >> 16) | low) / 32768;
      low = undefined;
      if (filled === VAD_FRAME) {
        yield frame;
        frame = new Float32Array(VAD_FRAME);
        filled = 0;
      }
    }
  }
  if (low !== undefined) throw new Error("PCM 采样不完整");
  if (filled) yield frame.slice(0, filled);
}

/** 一个识别器共用固定配置，每个异步任务独占窗口流。 */
export async function analyze_pcm(stream, vad, recognizer) {
  const spans = [],
    asr = [];
  const pending = new Set();
  let failure; // 首个失败原因在全部窗口收尾后抛出。
  // 输入消费与窗口提交共用首个失败原因。
  const check = () => {
    if (failure !== undefined) throw failure;
  };
  /** 取得额度后才提交窗口，完成回调持有原生流直到解码结束。 */
  const schedule = async (samples, from) => {
    while (pending.size >= ASR_CONCURRENCY) {
      await Promise.race(pending);
      check();
    }
    check();
    const input = recognizer.createStream();
    input.acceptWaveform({ samples, sampleRate: SAMPLE_RATE });
    const index = asr.length; // 提交顺序固定输出位置，完成顺序不改变时间轴。
    asr.push([]);
    const task = Promise.resolve()
      .then(() => recognizer.decodeAsync(input))
      .then(({ tokens, timestamps }) => {
        asr[index] = sentences(
          from / SAMPLE_RATE,
          (from + samples.length) / SAMPLE_RATE,
          tokens,
          timestamps,
        );
      })
      .catch((error) => {
        // 立即处理拒绝，避免等待并发额度时出现未处理异常。
        failure ??= error;
      })
      .finally(() => pending.delete(task));
    pending.add(task);
  };
  /** 逐段均分过长人声，减少整段音频的复制与驻留。 */
  const drain = async () => {
    for (; !vad.isEmpty(); vad.pop()) {
      const { start, samples } = vad.front(false); // Electron 不支持外部 ArrayBuffer。
      spans.push([start / SAMPLE_RATE, (start + samples.length) / SAMPLE_RATE]);
      const count = Math.ceil(samples.length / (ASR_WINDOW_SECONDS * SAMPLE_RATE));
      for (let i = 0; i < count; i++) {
        const from = Math.round((samples.length * i) / count),
          to = Math.round((samples.length * (i + 1)) / count);
        await schedule(samples.subarray(from, to), start + from);
      }
    }
  };
  try {
    for await (const frame of pcm_frames(stream)) {
      check();
      vad.acceptWaveform(frame);
      await drain();
    }
    vad.flush();
    await drain();
  } catch (error) {
    failure ??= error;
  } finally {
    await Promise.all(pending);
  }
  check();
  return {
    // 模型会按 maxSpeechDuration 拆开长语音，相接的区间不是停顿。
    speech: union(spans).map(([start, end]) => [round(start), round(end)]),
    asr: asr.flat(),
  };
}

/** 识别文字的显示整理只动空白，不增删字词。 */
const tidy = (text) => text.trim().replace(UNSPACED_GAP, "");

/**
 * 将窗口内 token 时间换算为整片秒数，生成句级条目 `{ start, end, text, tokens }`。
 * 标点 token 的时间常落在窗口末尾，句子边界只参考文字 token。
 * `tokens` 只保留文字 token 的 `[原文, 起点]`，供按硬字幕拆句、合句时取切点。
 */
export function sentences(from, end, tokens, timestamps) {
  const limit = DENSE.test(tokens.join("")) ? DENSE_CHARS : SPACED_CHARS;
  const at = (k) => (k < tokens.length ? from + timestamps[k] : end); // token 起点，越界为窗口终点。
  const word = (k) => tokens[k].replace(PUNCTUATION, "") !== ""; // 排除标点与空白 token。
  /** [i, j) 的首个文字 token 起点。 */
  const begin = (i, j) => {
    let k = i;
    while (k < j - 1 && !word(k)) k++;
    return at(k);
  };
  /** 句尾避开标点时间，保留有限阅读留白。 */
  const close = (i, j) => {
    let k = j - 1,
      next = j;
    while (k > i && !word(k)) k--;
    while (next < tokens.length && !word(next)) next++;
    return Math.min(at(next), at(k) + TAIL_SECONDS);
  };
  const text = (i, j) => tidy(tokens.slice(i, j).join("")); // 区间内的显示正文。
  // 字数与时长同时限制，避免字幕过密。
  const fits = (i, j) =>
    close(i, j) - begin(i, j) <= CUE_SECONDS && [...text(i, j)].length <= limit;
  // 以空格分词的文字只在词首切开，不切开子词。前后 token 相隔过久说明前一个已经说完，也可切开。
  const breakable = (b) =>
    /^\s/u.test(tokens[b]) ||
    UNSPACED_START.test(tokens[b]) ||
    /\p{P}$/u.test(tokens[b - 1]) ||
    at(b) - at(b - 1) > TAIL_SECONDS;
  /** 每次切下约 1/n，n 是满足时长与字数所需的最少条数。 */
  const split = (i, j) => {
    if (fits(i, j)) return [[i, j]];
    const total = [...text(i, j)].length;
    const share =
      1 /
      Math.max(2, Math.ceil((close(i, j) - begin(i, j)) / CUE_SECONDS), Math.ceil(total / limit));
    let best, cost; // 当前切点与偏离均分目标的代价。
    for (let b = i + 1; b < j; b++) {
      if (!breakable(b)) continue;
      const score =
        Math.abs([...text(i, b)].length / total - share) -
        (CLAUSE_END.test(tokens[b - 1].trim()) ? CLAUSE_PREFERENCE * share : 0);
      if (cost === undefined || score < cost) [best, cost] = [b, score];
    }
    return best === undefined ? [[i, j]] : [...split(i, best), ...split(best, j)];
  };
  const pieces = [];
  let start = 0;
  tokens.forEach((token, k) => {
    // 只有数字间的小数点跳过断句，数字前的其它句末标点仍然生效。
    const decimal =
      /\d\.$/u.test((tokens[k - 1] ?? "") + token.trim()) && /^\d/u.test(tokens[k + 1] ?? "");
    if (SENTENCE_END.test(token.trim()) && !decimal) {
      pieces.push(...split(start, k + 1));
      start = k + 1;
    }
  });
  if (start < tokens.length) pieces.push(...split(start, tokens.length));
  const cues = [];
  const short = (a, b) => close(a, b) - begin(a, b) < SHORT_SECONDS; // 判断是否需要合并短句。
  for (const [i, j] of pieces) {
    const last = cues.at(-1);
    if (last && (short(...last) || short(i, j)) && fits(last[0], j)) last[1] = j;
    else cues.push([i, j]);
  }
  return cues.flatMap(([i, j]) => {
    const message = text(i, j);
    if (!message.replace(PUNCTUATION, "")) return [];
    const start = round(begin(i, j));
    const words = [];
    for (let k = i; k < j; k++) if (word(k)) words.push([tokens[k], round(at(k))]);
    // 相邻 token 起点可能相同，取整后仍须保持合法区间。
    return [
      {
        start,
        end: Math.max(round(close(i, j)), round(start + 0.01)),
        text: message,
        tokens: words,
      },
    ];
  });
}

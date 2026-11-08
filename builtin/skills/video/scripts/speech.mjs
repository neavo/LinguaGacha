import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import path from "node:path";
import { npm } from "@lg/npm";

const SAMPLE_RATE = 16000; // Silero 与 SenseVoice 的输入采样率。
const VAD_FRAME = 512; // sherpa 每次调用只合并判断一次，必须逐帧送入。
const VAD_BUFFER_SECONDS = 90; // 须大于 maxSpeechDuration。
// Silero 参数是漏句检出与复核量的实测折中，调整后需重新评估。
const VAD = Object.freeze({
  threshold: 0.3,
  minSilenceDuration: 0.1,
  minSpeechDuration: 0.1,
  windowSize: VAD_FRAME,
  maxSpeechDuration: 60,
});
const ASR_WINDOW_SECONDS = 20; // 实测 60 秒整窗明显掉字，20 秒内基本完整。
const ASR_GAP_SECONDS = 0.5; // 更短的空隙并入后一个人声窗口，避免语气词碎片窗口。
const ASR_THREADS = 4;
// VAD 尚未结束的人声最早从 maxSpeechDuration 之前开始，更早的空隙已不会被人声区间切开，可以先识别。
const ASR_HORIZON_SECONDS = VAD_BUFFER_SECONDS;
const PUNCTUATION = /[\s\p{P}]/gu; // 静音与配乐处模型只输出标点。

/** 工程原文语言到 SenseVoice 语言的映射。其他语言不做本地识别，质控退回人声区间。 */
const ASR_LANGUAGES = Object.freeze({ ZH: "zh", EN: "en", JA: "ja", KO: "ko", ALL: "auto" });

/** 共享 npm 工程固定为 userdata/node，模型放在同级的 userdata/models，所有工程共用。 */
const MODELS_DIRECTORY = path.resolve(npm.directory, "..", "models");
// SenseVoiceSmall 来自阿里巴巴 FunASR，许可要求使用时注明来源与作者并保留模型名。
const SENSEVOICE =
  "https://huggingface.co/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/2365baeacb507f821a0c8120fcee3d484dba7a07";
/** 固定版本的模型。sherpa 加载缺失或损坏的模型时不一定报错，只能按哈希判断可用。 */
export const MODELS = Object.freeze({
  vad: Object.freeze({
    file: path.join(MODELS_DIRECTORY, "silero_vad", "v6.2.3.onnx"),
    url: "https://raw.githubusercontent.com/snakers4/silero-vad/v6.2.3/src/silero_vad/data/silero_vad.onnx",
    sha256: "1a153a22f4509e292a94e67d6f9b85e8deb25b4988682b7e174c65279d8788e3",
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
 * 消费 16 kHz 单声道 s16le 流，返回整片人声区间与本地识别文本，单位为整片秒数。
 * 识别覆盖整条时间轴：人声检测会漏掉成段对白，空隙里的台词同样需要线索。
 * 窗口按人声区间边界切分，过长的窗口等分。只保留含文字的窗口，不支持的语言 `asr` 为 null。
 */
export async function analyze(stream, source_language) {
  const language = ASR_LANGUAGES[source_language] ?? null;
  for (const model of language ? Object.values(MODELS) : [MODELS.vad])
    if (!(await ready(model))) throw new Error("语音模型缺失或不一致，先按 media.missing() 补齐");
  const { default: sherpa } = await import("sherpa-onnx-node");
  const vad = new sherpa.Vad(
    {
      sileroVad: { model: MODELS.vad.file, ...VAD },
      sampleRate: SAMPLE_RATE,
      numThreads: 1,
      provider: "cpu",
      debug: 0,
    },
    VAD_BUFFER_SECONDS,
  );
  const recognizer =
    language &&
    new sherpa.OfflineRecognizer({
      featConfig: { sampleRate: SAMPLE_RATE, featureDim: 80 },
      modelConfig: {
        senseVoice: { model: MODELS.asr.file, language, useInverseTextNormalization: 1 },
        tokens: MODELS.tokens.file,
        numThreads: ASR_THREADS,
        provider: "cpu",
        debug: 0,
      },
      decodingMethod: "greedy_search",
    });
  const spans = [],
    asr = [];
  // 只为尚未识别的时间保留音频帧，长素材的内存与时长无关。
  const frames = [];
  let base = 0, // frames[0] 的起始样本
    total = 0, // 已送入的样本数
    done = 0; // 识别已覆盖到的样本
  const slice = (from, to) => {
    const samples = new Float32Array(to - from);
    for (let i = Math.floor((from - base) / VAD_FRAME); i < frames.length; i++) {
      const start = base + i * VAD_FRAME;
      if (start >= to) break;
      const frame = frames[i].subarray(Math.max(0, from - start), Math.min(VAD_FRAME, to - start));
      samples.set(frame, Math.max(0, start - from));
    }
    return samples;
  };
  const recognize = (to) => {
    if (to <= done) return;
    const count = Math.ceil((to - done) / (ASR_WINDOW_SECONDS * SAMPLE_RATE));
    for (let i = 0; i < count; i++) {
      const from = done + Math.round(((to - done) * i) / count),
        end = done + Math.round(((to - done) * (i + 1)) / count);
      const input = recognizer.createStream();
      input.acceptWaveform({ samples: slice(from, end), sampleRate: SAMPLE_RATE });
      recognizer.decode(input);
      const text = recognizer.getResult(input).text.trim();
      if (text.replace(PUNCTUATION, ""))
        asr.push([round(from / SAMPLE_RATE), round(end / SAMPLE_RATE), text]);
    }
    done = to;
    while (frames.length && base + VAD_FRAME <= done) {
      frames.shift();
      base += VAD_FRAME;
    }
  };
  // 及时取出已完成的人声区间，检测器不再积累音频样本。
  const drain = () => {
    for (; !vad.isEmpty(); vad.pop()) {
      const { start, samples } = vad.front(false); // Electron 不支持外部 ArrayBuffer。
      spans.push([start / SAMPLE_RATE, (start + samples.length) / SAMPLE_RATE]);
      if (recognizer) {
        if (start - done >= ASR_GAP_SECONDS * SAMPLE_RATE) recognize(start); // 前面的空隙
        recognize(start + samples.length);
      }
    }
  };
  const accept = (frame) => {
    vad.acceptWaveform(frame);
    total += frame.length;
    if (!recognizer) return drain();
    frames.push(frame);
    drain();
    const horizon = total - ASR_HORIZON_SECONDS * SAMPLE_RATE;
    if (horizon - done >= ASR_WINDOW_SECONDS * SAMPLE_RATE) recognize(horizon);
  };
  let frame = new Float32Array(VAD_FRAME),
    filled = 0,
    low; // 跨数据块保留尚未配对的低字节。
  for await (const chunk of stream) {
    for (const byte of chunk) {
      if (low === undefined) {
        low = byte;
        continue;
      }
      frame[filled++] = (((byte << 24) >> 16) | low) / 32768; // 小端 s16，高字节带符号。
      low = undefined;
      if (filled === VAD_FRAME) {
        accept(frame);
        frame = new Float32Array(VAD_FRAME); // 识别需要保留已送入的帧。
        filled = 0;
      }
    }
  }
  if (low !== undefined) throw new Error("PCM 采样不完整");
  if (filled) accept(frame.slice(0, filled));
  vad.flush();
  drain();
  if (recognizer) recognize(total);
  return {
    // 模型会按 maxSpeechDuration 拆开长语音，相接的区间不是停顿。
    speech: union(spans).map(([start, end]) => [round(start), round(end)]),
    asr: recognizer ? asr : null,
  };
}

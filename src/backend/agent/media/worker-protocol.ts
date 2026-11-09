import type { ChannelHeader } from "./channel";

/** Worker 只承担这三类模型任务，不扩展为通用远程调用。 */
export type MediaTask = "vad" | "asr" | "det";
/** 只支持 CPU 与 WebGPU 两种执行配置。 */
export type MediaDevice = "cpu" | "webgpu";
export type MediaModelConfig = Readonly<{ file: string; device: MediaDevice; threads: number }>;
export type MediaCandidate = Readonly<{ file: string; threads: number }>;

/** 启动参数。`calibrate` 存在时只做配置测量，否则按 `models` 提供推理。 */
export type MediaWorkerConfig = Readonly<{
  ort: string; // onnxruntime-node 入口的文件 URL，由根脚本在共享 npm 工程中解析。
  tokens: string;
  models?: Readonly<Record<MediaTask, MediaModelConfig>>;
  calibrate?: Readonly<Record<"asr" | "det", Partial<Record<MediaDevice, MediaCandidate>>>>;
}>;

export type MediaWorkerRequest =
  | Readonly<{
      type: "infer";
      id: number;
      stream: number; // 发起请求的 helper，区分各路 VAD 状态。
      kind: MediaTask;
      header: ChannelHeader;
      payload: ArrayBuffer;
    }>
  | Readonly<{ type: "release"; stream: number }>
  | Readonly<{ type: "close" }>;

export type MediaWorkerReply =
  | Readonly<{ id: number; header: ChannelHeader; payload?: ArrayBuffer }>
  | Readonly<{ id: number; error: string; device: MediaDevice }>;

/** 每项任务各配置的稳定耗时（毫秒），失败时为原因。 */
export type MediaCalibration = Record<
  "asr" | "det",
  Partial<Record<MediaDevice, number[] | string>>
>;

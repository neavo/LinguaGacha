import type { ChannelHeader } from "./channel";

/** Worker 只承担这三类模型任务，不扩展为通用远程调用。 */
export type MediaTask = "vad" | "asr" | "det";
/** 只支持 CPU 与 WebGPU 两种执行配置。 */
export type MediaDevice = "cpu" | "webgpu";
export type MediaModelConfig = Readonly<{ file: string; device: MediaDevice; threads: number }>;
/** 本机选定的完整推理配置。ASR 始终单路，检测可选 GPU 单路或双路。 */
export type MediaProfile = Readonly<{
  asr: MediaDevice;
  det: "cpu" | "webgpu_single" | "webgpu_dual";
}>;

/** 父进程解析好的 ORT 入口与模型路径，Worker 和校准子进程不访问共享环境绑定。 */
export type MediaWorkerConfig = Readonly<{
  ort: string;
  tokens: string;
  models: Readonly<Record<MediaTask, MediaModelConfig>>;
}>;

/** 一次校准子进程的测量：两个输入档各一行批次耗时，另记准备与释放耗时，单位毫秒。 */
export type MediaMeasurement = Readonly<{
  timings: readonly (readonly number[])[];
  prepare: number;
  close: number;
}>;
/** 各任务候选的多次独立启动测量，键为候选名。 */
export type MediaCalibration = Record<"asr" | "det", Record<string, MediaMeasurement[]>>;
/** `probe` 只验证 GPU 能运行并正常退出，`mixed` 验证最终组合。 */
export type MediaCalibrationJob = Readonly<{
  profile: MediaProfile;
  config: MediaWorkerConfig;
  worker: string;
  task: "asr" | "det" | "mixed";
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

/** 失败应答只带消息，设备归因由派发方按实际通道判断。 */
export type MediaWorkerReply =
  | Readonly<{ id: number; header: ChannelHeader; payload?: ArrayBuffer }>
  | Readonly<{ id: number; error: string }>;

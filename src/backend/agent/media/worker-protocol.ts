import type { ChannelHeader } from "./channel";

/** Worker 只承担这三类模型任务，不扩展为通用远程调用。 */
export type MediaTask = "vad" | "asr" | "det";
/** 只支持 CPU 与 WebGPU 两种执行配置。 */
export type MediaDevice = "cpu" | "webgpu";
export type MediaModelConfig = Readonly<{ file: string; device: MediaDevice; threads: number }>;
/** 显式设备只覆盖当前调用。省略时使用自动配置。 */
export type DeviceOptions = Readonly<{ device?: "cpu" | "gpu" | undefined }>;
/** 返回实际执行路径，供调用方确认手动纠错或自动回退。 */
export type MediaExecution = Readonly<{
  requested: "auto" | "cpu" | "gpu";
  actual: "cpu" | "gpu";
  fallback_reason?: string;
}>;
export type MediaResult<T> = Readonly<{ result: T; execution: MediaExecution }>;

/** 父进程解析好的 ORT 入口与模型路径，Worker 和校准子进程不访问共享环境绑定。 */
export type MediaWorkerConfig = Readonly<{
  ort: string;
  tokens: string;
  models: Readonly<Record<MediaTask, MediaModelConfig>>;
}>;

/** 单次 20 秒输入的测量，单位毫秒；首次推理不包含会话创建。 */
export type MediaMeasurement = Readonly<{ inference: number; prepare: number; close: number }>;
export type MediaCalibrationJob = Readonly<{
  config: MediaWorkerConfig;
  worker: string;
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

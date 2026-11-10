import type { ChannelHeader } from "./channel";

/** Worker 只承担这三类模型任务，不扩展为通用远程调用。 */
export type MediaTask = "vad" | "asr" | "det";
/** 只支持 CPU 与 WebGPU 两种执行配置。 */
export type MediaDevice = "cpu" | "webgpu";
export type MediaModelConfig = Readonly<{ file: string; device: MediaDevice; threads: number }>;
/** 推理设备由调用者明确选择，不读取默认配置。 */
export type DeviceOptions = Readonly<{ device: "cpu" | "gpu" }>;

/** 父进程解析好的 ORT 入口与模型路径，Worker 不访问共享环境绑定。 */
export type MediaWorkerConfig = Readonly<{
  ort: string;
  tokens: string;
  models: Readonly<Record<MediaTask, MediaModelConfig>>;
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

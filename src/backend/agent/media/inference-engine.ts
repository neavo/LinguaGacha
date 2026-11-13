import { InferenceClient } from "../inference/client";
import type { ChannelHeader } from "../inference/channel";
import type { MediaTask, MediaWorkerConfig } from "./worker-protocol";

/** 媒体独占音频流与双视觉路由，共享客户端只管理传输和线程收尾。 */
export class Engine {
  private readonly client: InferenceClient;
  private vision = 0; // 检测与识别共用两条 CPU 视觉通道。
  private streams = 0; // 各 helper 的音频流拥有独立 VAD 状态。
  /** 配置跟随单次操作，客户端按首次请求创建对应 Worker。 */
  constructor(
    private readonly config: MediaWorkerConfig,
    worker_file: string,
  ) {
    this.client = new InferenceClient(config, worker_file);
  }
  /** 为 helper 分配音频状态身份。 */
  open(): number {
    return this.streams++;
  }
  /** helper 结束后释放其 VAD 循环状态。 */
  release(stream: number): void {
    this.client.send("audio", { type: "release", stream });
  }
  /** 媒体决定路由，共享客户端只关联请求与应答。 */
  request(
    stream: number,
    kind: MediaTask,
    header: ChannelHeader,
    payload: Uint8Array<ArrayBuffer>,
  ) {
    const lane =
      this.config.models[kind].device === "webgpu"
        ? "gpu"
        : kind === "det" || kind === "rec"
          ? `vision${this.vision++ % 2}`
          : "audio";
    return this.client.request(lane, { stream, kind }, header, payload);
  }
  /** 实际线程退出后才完成领域操作。 */
  close(): Promise<void> {
    return this.client.close();
  }
}
